import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_PRINT_OPTIONS,
  PAPER_SIZES_PT,
  PRINT_PAPER_SIZES,
  resolveFileName,
  resolveMarginsPt,
  resolvePaperSizePt,
} from "../../lib/print/print-types";

test("paper sizes are declared in PostScript points", () => {
  assert.deepEqual(PAPER_SIZES_PT.Letter, { width: 612, height: 792 });
  assert.equal(Math.round(PAPER_SIZES_PT.A4.width), 595);
  assert.equal(Math.round(PAPER_SIZES_PT.A4.height), 842);
  assert.equal(PRINT_PAPER_SIZES.length, 6);
});

test("orientation swaps the page axes without changing the paper", () => {
  assert.deepEqual(resolvePaperSizePt("A4", "portrait"), { widthPt: 595.28, heightPt: 841.89 });
  assert.deepEqual(resolvePaperSizePt("A4", "landscape"), { widthPt: 841.89, heightPt: 595.28 });
});

test("margin presets resolve to points and custom margins pass through", () => {
  assert.deepEqual(resolveMarginsPt("none"), { top: 0, right: 0, bottom: 0, left: 0 });
  assert.equal(resolveMarginsPt("normal").left, 56.7); // 20 mm
  const custom = { top: 10, right: 11, bottom: 12, left: 13 };
  assert.deepEqual(resolveMarginsPt(custom), custom);
});

test("resolved margins are a copy: mutating the result cannot poison the preset table", () => {
  const first = resolveMarginsPt("narrow");
  first.left = 999;
  assert.equal(resolveMarginsPt("narrow").left, 28.35);
});

test("defaults are print-safe: Letter, portrait, light theme, CSS margins on body", () => {
  assert.equal(DEFAULT_PRINT_OPTIONS.paperSize, "Letter");
  assert.equal(DEFAULT_PRINT_OPTIONS.orientation, "portrait");
  assert.equal(DEFAULT_PRINT_OPTIONS.theme, "print-light");
  assert.equal(DEFAULT_PRINT_OPTIONS.marginStrategy, "body-padding");
  assert.equal(DEFAULT_PRINT_OPTIONS.generationTimeoutMs, 45000);
});

test("file names are filesystem-safe and always end in .pdf", () => {
  assert.equal(resolveFileName("Weekly sync / 2026-09-28"), "Weekly_sync_2026-09-28_transcript.pdf");
  assert.equal(resolveFileName("   "), "proset_transcript.pdf");
  assert.equal(resolveFileName("a", "notes").endsWith(".pdf"), true);
});
