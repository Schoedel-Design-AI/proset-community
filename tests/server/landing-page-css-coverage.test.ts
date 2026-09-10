// Guard test: every CSS class used in the landing/support templates must actually
// be defined in the stylesheet they load.
//
// WHY THIS EXISTS
// `server/templates/landing-page.css` is a hand-maintained subset of Tailwind
// utilities (see the header comment in that file — the Tailwind CLI is not run
// here because of npm override conflicts). That makes an entire class of bug
// completely silent: the HTML can reference a utility such as `p-6`, the
// stylesheet can simply not define it, and the browser applies nothing. No
// error, no warning — just a broken layout. That is exactly how the
// open-source/self-hosted compare cards lost their padding and rendered their
// checkmark lists flush against the card edge.
//
// This test turns that silent visual bug into a failing assertion.
//
// WHEN THIS TEST FAILS
// Add the missing utility to `server/templates/landing-page.css` (copy the real
// Tailwind value — do not invent one), then bump the `?v=` cache-buster on every
// template that links the stylesheet, because it is served with
// `Cache-Control: public, max-age=86400`.
//
// If the class is legitimately not ours to define (injected by a third-party
// script), add it to THIRD_PARTY_CLASSES below with a comment naming the owner.

import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const STYLESHEET = "server/templates/landing-page.css";

// Templates that load STYLESHEET. Keep in sync when a new template links it.
const TEMPLATES = [
  "server/templates/landing-page.html",
  "server/templates/support-form.html",
  "server/templates/support-thanks.html",
];

// Classes present in markup but intentionally NOT defined by our stylesheet.
const THIRD_PARTY_CLASSES = new Set([
  // Cloudflare Turnstile finds this hook and styles/populates the widget itself.
  "cf-turnstile",
]);

const read = (relativePath: string): string =>
  readFileSync(join(process.cwd(), relativePath), "utf8");

/**
 * Resolve CSS identifier escapes so a selector token can be compared to the
 * literal class string used in HTML.
 *   `md\:text-xl`            -> `md:text-xl`
 *   `rgba\(0\2c 180\)`       -> `rgba(0,180)`   (`\2c ` is a hex-escaped comma)
 */
const unescapeCssIdentifier = (token: string): string =>
  token
    .replace(/\\([0-9a-fA-F]{1,6})[ ]?/g, (_match: string, hex: string) =>
      String.fromCodePoint(parseInt(hex, 16)),
    )
    .replace(/\\(.)/g, "$1");

/** Collect every class name a stylesheet defines. */
function definedClasses(cssText: string): Set<string> {
  const defined = new Set<string>();
  const withoutComments = cssText.replace(/\/\*[\s\S]*?\*\//g, "");

  // Everything before a `{` is a selector list; the text after the previous `}`
  // isolates it from the preceding declaration block.
  const beforeBraces = withoutComments.split("{");
  for (let i = 0; i < beforeBraces.length - 1; i += 1) {
    const selector = beforeBraces[i].split("}").pop() ?? "";
    // A class token may contain escaped characters, including hex escapes that
    // carry a single trailing space (`\2c `), so match those before `\\.`.
    for (const match of selector.matchAll(
      /\.((?:\\[0-9a-fA-F]{1,6}[ ]?|\\.|[A-Za-z0-9_-])+)/g,
    )) {
      defined.add(unescapeCssIdentifier(match[1]));
    }
  }
  return defined;
}

/** Collect every class name a template applies, with the count of usages. */
function usedClasses(htmlText: string): Map<string, number> {
  const used = new Map<string, number>();
  for (const match of htmlText.matchAll(/\sclass\s*=\s*("([^"]*)"|'([^']*)')/g)) {
    const value = match[2] ?? match[3] ?? "";
    for (const className of value.split(/\s+/)) {
      if (className) used.set(className, (used.get(className) ?? 0) + 1);
    }
  }
  return used;
}

/** Inline `<style>` blocks legitimately define classes too. */
function inlineStyleText(htmlText: string): string {
  let combined = "";
  for (const match of htmlText.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)) {
    combined += `${match[1]}\n`;
  }
  return combined;
}

const stylesheet = read(STYLESHEET);
const sharedClasses = definedClasses(stylesheet);

test("stylesheet parses into a meaningful set of class definitions", () => {
  // Guards the parser itself: if a refactor breaks selector extraction, the
  // per-template checks below would vacuously "pass" against an empty set.
  assert.ok(
    sharedClasses.size > 200,
    `expected the stylesheet to define 200+ classes, parsed ${sharedClasses.size}`,
  );
  for (const sentinel of ["p-6", "flex", "md:grid-cols-2", "hero-cta"]) {
    assert.ok(
      sharedClasses.has(sentinel),
      `parser failed to find the known class '${sentinel}'`,
    );
  }
});

for (const template of TEMPLATES) {
  test(`${template} uses only classes defined in the stylesheet`, () => {
    const html = read(template);
    const localClasses = definedClasses(inlineStyleText(html));
    const undefinedClasses = [];

    for (const [className, count] of usedClasses(html)) {
      if (sharedClasses.has(className)) continue;
      if (localClasses.has(className)) continue;
      if (THIRD_PARTY_CLASSES.has(className)) continue;
      undefinedClasses.push(`${className} (used ${count}x)`);
    }

    assert.deepEqual(
      undefinedClasses.sort(),
      [],
      `${template} references classes that no stylesheet defines, so they ` +
        `silently do nothing. Define them in ${STYLESHEET} (and bump the ?v= ` +
        `cache-buster), or allowlist genuinely third-party classes:\n  ` +
        undefinedClasses.sort().join("\n  "),
    );
  });
}

test("every template linking the stylesheet shares one cache-buster version", () => {
  const versions = new Map();
  for (const template of TEMPLATES) {
    const match = read(template).match(/landing-page\.css\?v=(\d+)/);
    assert.ok(match, `${template} should link ${STYLESHEET} with a ?v= version`);
    versions.set(template, match[1]);
  }

  const distinct = new Set(versions.values());
  assert.equal(
    distinct.size,
    1,
    "templates share one stylesheet, so a stale ?v= would serve stale CSS " +
      `(max-age=86400). Bump all of them together: ${JSON.stringify(
        Object.fromEntries(versions),
      )}`,
  );
});

// Append-only ledger pinning each published ?v= to the exact stylesheet body it
// shipped. This exists because of a real incident: `?v=10` was published twice
// with two different stylesheets, so Cloudflare kept serving the first body
// (`cf-cache-status: HIT`, max-age=86400) and the second deploy's new utilities
// never reached browsers even though the Cloud Run revision was correct.
//
// EDITING THE STYLESHEET? Append a NEW entry with the new hash and bump the ?v=
// in every template. Never edit the last entry's hash in place — that is exactly
// the mistake this ledger prevents.
const STYLESHEET_RELEASES: ReadonlyArray<{ version: number; sha256: string }> = [
  // v10 shipped twice (commits 9b29278 then a768b1d) — the incident above.
  { version: 10, sha256: "de30e68ad27a94df858084b0ee685774bbc2fbc248aeed5e1df7fc360d48d6ad" },
  { version: 11, sha256: "15509b3858996c18cf69e6b1bedaaee6ebcd74f15219238760e91d1d77dc211c" },
  { version: 12, sha256: "e1411acbea0955ad18445799e923f07c531e208bc19ca3e543140bcb750c54e8" },
];

test("stylesheet content matches the current published cache-buster version", () => {
  const seenVersions = new Set<number>();
  let previousVersion = 0;
  for (const release of STYLESHEET_RELEASES) {
    assert.ok(
      release.version > previousVersion,
      `ledger must be append-only and ascending; ${release.version} follows ${previousVersion}`,
    );
    assert.ok(
      !seenVersions.has(release.version),
      `?v=${release.version} appears twice in the ledger; each version must pin one stylesheet body`,
    );
    seenVersions.add(release.version);
    previousVersion = release.version;
  }

  const current = STYLESHEET_RELEASES[STYLESHEET_RELEASES.length - 1];
  const actualSha = createHash("sha256").update(read(STYLESHEET)).digest("hex");

  assert.equal(
    actualSha,
    current.sha256,
    `${STYLESHEET} changed but is still published as ?v=${current.version}. ` +
      "The CDN caches by URL for 24h, so the edit would never reach browsers. " +
      `Append { version: ${current.version + 1}, sha256: "${actualSha}" } to ` +
      `STYLESHEET_RELEASES and bump ?v=${current.version} to ` +
      `?v=${current.version + 1} in every template.`,
  );

  for (const template of TEMPLATES) {
    assert.match(
      read(template),
      new RegExp(`landing-page\\.css\\?v=${current.version}\\b`),
      `${template} must link ?v=${current.version} to match the pinned stylesheet`,
    );
  }
});
