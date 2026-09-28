import assert from "node:assert/strict";
import test from "node:test";

import { findPrintFont, SYSTEM_SERIF_STACK } from "../../lib/print/print-fonts";
import {
  buildFontSampleHtml,
  buildInlinedFontFaceCss,
  buildPreviewCssUrl,
  planFontWeights,
  type FontFetchDeps,
} from "../../lib/print/print-font-css";

const INTER = findPrintFont("Inter")!;
const MEIE = findPrintFont("Meie Script")!;

const WOFF2_LATIN = new Uint8Array([0x77, 0x4f, 0x46, 0x32, 1, 2, 3, 4, 5, 6, 7, 8]);

function deps(overrides: Partial<FontFetchDeps> = {}): FontFetchDeps & { calls: string[] } {
  const calls: string[] = [];
  const base: FontFetchDeps = {
    async fetchBytes(url: string) {
      calls.push(url);
      return { bytes: WOFF2_LATIN, contentType: "font/woff2" };
    },
    async fetchText(url: string) {
      calls.push(url);
      return `/* latin */\n@font-face{font-family:'Inter';src:url(https://fonts.gstatic.com/s/inter/v1/latin.woff2)}`;
    },
  };
  return Object.assign({ ...base, ...overrides }, { calls });
}

const budget = { timeoutMs: 500, maxBytesPerFile: 200_000 };

test("planFontWeights asks for regular plus real bold, and never invents a bold", () => {
  assert.deepEqual(planFontWeights(INTER), [
    { weight: 400, style: "normal" },
    { weight: 700, style: "normal" },
  ]);
  assert.deepEqual(planFontWeights(MEIE), [{ weight: 400, style: "normal" }], "400-only families must not request 700");
  assert.deepEqual(planFontWeights(INTER, { includeItalic: true }), [
    { weight: 400, style: "normal" },
    { weight: 700, style: "normal" },
    { weight: 400, style: "italic" },
  ]);
  // Jost ships true italics, so an italic face is planned for it.
  assert.deepEqual(planFontWeights(findPrintFont("Jost")!, { includeItalic: true }).length, 3);
  // A family with no true italic gets no italic face at all: fetching one that does not exist
  // would either fail or hand the renderer a synthetic oblique dressed up as a real face.
  assert.deepEqual(planFontWeights(findPrintFont("Outfit")!, { includeItalic: true }), [
    { weight: 400, style: "normal" },
    { weight: 700, style: "normal" },
  ]);
});

test("print font faces are inlined as data URIs and block rather than swap", async () => {
  const d = deps();
  const result = await buildInlinedFontFaceCss(INTER, planFontWeights(INTER), d, budget);

  assert.equal(result.failed.length, 0);
  assert.equal(result.inlined.length, 2);
  assert.match(result.css, /@font-face/);
  assert.match(result.css, /font-family: 'Inter'/);
  assert.match(result.css, /font-weight: 400/);
  assert.match(result.css, /font-weight: 700/);
  assert.match(result.css, /url\(data:font\/woff2;base64,/);
  // font-display: swap would let the renderer paginate with fallback metrics first.
  assert.match(result.css, /font-display: block/);
  assert.equal(result.css.includes("swap"), false);
  assert.equal(result.bytes > 0, true, "the inline cost must be measurable");
  assert.equal(d.calls.length > 0, true);
});

test("a failing font fetch degrades to fewer faces instead of failing the print job", async () => {
  const warnings: string[] = [];
  const d = deps({
    async fetchBytes() {
      throw new Error("network down");
    },
    warn: (message) => warnings.push(message),
  });
  const result = await buildInlinedFontFaceCss(INTER, planFontWeights(INTER), d, budget);

  assert.equal(result.inlined.length, 0);
  assert.equal(result.failed.length, 2);
  assert.equal(result.css, "", "no css is better than a broken @font-face");
  assert.equal(warnings.length, 2);
});

test("a font file over the byte budget is skipped, not embedded", async () => {
  const d = deps({
    fetchBytes: async () => ({ bytes: new Uint8Array(500_000), contentType: "font/woff2" }),
  });
  const result = await buildInlinedFontFaceCss(INTER, planFontWeights(INTER), d, {
    ...budget,
    maxBytesPerFile: 100_000,
  });
  assert.equal(result.inlined.length, 0);
  assert.equal(result.failed.length, 2);
  assert.equal(result.failed.every((f) => f.reason === "too-large"), true);
});

test("the browser preview URL is the Google Fonts CSS API, lazy and not inlined", () => {
  const url = buildPreviewCssUrl(INTER, planFontWeights(INTER));
  assert.equal(url.startsWith("https://fonts.googleapis.com/css2?"), true);
  assert.match(url, /family=Inter/);
  assert.match(url, /wght%40400%3B700|wght@400;700/);
  assert.match(url, /display=swap/);
  assert.equal(url.includes("data:"), false);
  assert.equal(buildPreviewCssUrl(MEIE, planFontWeights(MEIE)).includes("700"), false);
  // Italic previews use the ital axis, not a separate family.
  assert.match(buildPreviewCssUrl(INTER, planFontWeights(INTER, { includeItalic: true })), /ital,wght@/);
});

test("the sample document shows real text in the chosen family", () => {
  const html = buildFontSampleHtml(INTER, "Weekly sync <script>alert(1)</script>");
  assert.match(html, /^<!DOCTYPE html>/);
  assert.match(html, /<link rel="stylesheet" href="https:\/\/fonts\.googleapis\.com\/css2\?/);
  assert.match(html, /font-family: 'Inter'/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/, "sample text must be escaped");
  assert.equal(html.includes("<script>alert(1)</script>"), false, "the sample must not execute pasted markup");
  assert.match(html, /Proset AI/);
});

test("a system-stack preview performs no network fetches at all", () => {
  const html = buildFontSampleHtml(null, "plain text");
  assert.equal(html.includes("fonts.googleapis.com"), false);
  assert.match(html, /Georgia/);
  assert.equal(html.includes(SYSTEM_SERIF_STACK.slice(0, 20)), true);
});
