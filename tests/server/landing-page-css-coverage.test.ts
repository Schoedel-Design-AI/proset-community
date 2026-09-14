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
import {
  STYLESHEET,
  STYLESHEET_RELEASES,
  TEMPLATES,
} from "../support/stylesheet-releases";

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

// The ?v= cache-buster ledger (STYLESHEET_RELEASES) and the template list live
// in ../support/stylesheet-releases.ts so the routing test can assert the same
// version instead of hardcoding one. See that module for the ?v=10 incident and
// the rule: editing the stylesheet means appending a new entry AND bumping every
// template.

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
