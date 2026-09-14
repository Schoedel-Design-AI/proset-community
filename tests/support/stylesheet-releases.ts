// Single source of truth for the landing/support stylesheet cache-buster.
//
// WHY THIS EXISTS
// `server/templates/landing-page.css` is served with
// `Cache-Control: public, max-age=86400`, so the `?v=` query string is the only
// thing that makes an edit reach browsers. Two rules, both enforced by tests:
//
//   1. Every template that links the stylesheet uses the version in the LAST
//      entry of the ledger below.
//   2. The stylesheet's sha256 equals that entry's sha256.
//
// Editing the stylesheet without appending a ledger entry (and bumping every
// template) is the failure this module exists to catch. It happened on
// 2026-09-08: the pitch-deck styles shipped as `?v=13` in landing-page.html
// while the ledger still ended at v12 and both support templates still linked
// `?v=12` — so the guard tests were red on main for four days.
//
// Shared by tests/server/landing-page-css-coverage.test.ts (classes + hashes)
// and tests/server/landing-page-routing.test.ts (routing + metadata), so the
// version is stated once and cannot drift between them.

export const STYLESHEET = "server/templates/landing-page.css";

// Templates that load STYLESHEET. Keep in sync when a new template links it.
export const TEMPLATES = [
  "server/templates/landing-page.html",
  "server/templates/support-form.html",
  "server/templates/support-thanks.html",
];

// Append-only ledger pinning each published ?v= to the exact stylesheet body it
// shipped. Append-only because of a real incident: `?v=10` was published twice
// with two different stylesheets, so Cloudflare kept serving the first body
// (`cf-cache-status: HIT`, max-age=86400) and the second deploy's new utilities
// never reached browsers even though the Cloud Run revision was correct.
//
// EDITING THE STYLESHEET? Append a NEW entry with the new hash and bump the ?v=
// in every template. Never edit the last entry's hash in place — that is exactly
// the mistake this ledger prevents.
export const STYLESHEET_RELEASES: ReadonlyArray<{
  version: number;
  sha256: string;
}> = [
  // v10 shipped twice (commits 9b29278 then a768b1d) — the incident above.
  { version: 10, sha256: "de30e68ad27a94df858084b0ee685774bbc2fbc248aeed5e1df7fc360d48d6ad" },
  { version: 11, sha256: "15509b3858996c18cf69e6b1bedaaee6ebcd74f15219238760e91d1d77dc211c" },
  { version: 12, sha256: "e1411acbea0955ad18445799e923f07c531e208bc19ca3e543140bcb750c54e8" },
  // v13: pitch-deck download styles added to the landing page (3f9baad).
  { version: 13, sha256: "f564205d28e1d548f75890af9cc34e528b322bbcf439f0283796e0b4bf1f0efa" },
];

/** The release every template must currently link and the stylesheet must match. */
export const currentStylesheetRelease = () => {
  const latest = STYLESHEET_RELEASES[STYLESHEET_RELEASES.length - 1];
  if (!latest) throw new Error("STYLESHEET_RELEASES must not be empty");
  return latest;
};
