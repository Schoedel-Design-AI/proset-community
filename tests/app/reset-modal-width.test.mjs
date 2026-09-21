import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * GitHub issue #250 — the password-reset modal rendered too narrow.
 *
 * The sheet asked for `width: "90%"`, but its parent overlay was
 * `alignItems: "center"` + `flex: 1`: `flex: 1` only sizes the MAIN axis, so the
 * overlay shrink-to-fit and the percentage resolved against that shrunken box.
 * Measured on the deployed app: a 334px card in a 411px viewport (81%) on web,
 * and ~58% on Android from the same source. At 320px wide the card exceeded the
 * viewport (334px = 104%) and the dimming backdrop stopped short of the edges.
 *
 * The fix sizes the sheet from the WINDOW and stretches the overlay, so no
 * ancestor can constrain either. These assertions guard the mechanism, not the
 * numbers: the runtime check (`verify-reset-modal.js`) guards the numbers.
 */
test("the reset sheet is sized from the window, not from a shrink-to-fit parent", () => {
  const source = readFileSync("app/login.tsx", "utf8");

  // Window-derived width with the existing 400px ceiling on wide screens.
  assert.match(source, /useWindowDimensions/);
  assert.match(source, /const resetSheetWidth = Math\.min\(windowWidth - 32, 400\);/);
  // ...applied after the styles so it wins over resetSheet/resetSheetCentered.
  assert.match(source, /\{ width: resetSheetWidth \}\]/);
  // A percentage width against an unsized parent is the bug; the sheet must not
  // declare a width of its own (scoped to the block so prose/comments elsewhere
  // cannot satisfy or defeat this).
  const sheetBlock = source.match(/resetSheet: \{[\s\S]*?\n  \},/);
  assert.ok(sheetBlock, "resetSheet style block not found");
  assert.doesNotMatch(sheetBlock[0], /^\s*width:/m, "resetSheet must not declare its own width");
});

test("the reset overlay fills its parent's cross axis so the backdrop is full-bleed", () => {
  const source = readFileSync("app/login.tsx", "utf8");
  const overlay = source.match(/resetOverlay: \{[\s\S]*?\n  \},/);
  assert.ok(overlay, "resetOverlay style block not found");
  assert.match(
    overlay[0],
    /alignSelf: "stretch"/,
    "without alignSelf: stretch the overlay shrink-to-fits and insets the backdrop",
  );
});
