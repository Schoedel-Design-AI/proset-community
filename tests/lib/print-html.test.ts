import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_PRINT_OPTIONS, type PrintOptions } from "../../lib/print/print-types";
import {
  buildPageCss,
  buildPrintDocument,
  escapeHtml,
  estimatePageCount,
  resolveGenerationTimeoutMs,
  textToBodyHtml,
} from "../../lib/print/print-html";

const options = (patch: Partial<PrintOptions> = {}): PrintOptions => ({ ...DEFAULT_PRINT_OPTIONS, ...patch });

test("escapeHtml neutralises the characters that can break out of markup", () => {
  assert.equal(
    escapeHtml(`<img src=x onerror="alert('1')">&`),
    "&lt;img src=x onerror=&quot;alert(&#39;1&#39;)&quot;&gt;&amp;",
  );
});

test("transcript text becomes escaped paragraphs, never raw markup", () => {
  const html = textToBodyHtml("First sentence. Second one.\n\n<b>not bold</b>");
  assert.equal(html.includes("&lt;b&gt;not bold&lt;/b&gt;"), true);
  assert.equal((html.match(/<p>/g) ?? []).length, 2);
});

test("page CSS declares the paper size in points and the CSS margins only when asked", () => {
  const cssPage = buildPageCss(options({ paperSize: "A4", marginStrategy: "css-page", margins: "normal" }));
  assert.match(cssPage, /@page \{[^}]*size: 595\.28pt 841\.89pt/);
  assert.match(cssPage, /@page \{[^}]*margin: 56\.7pt 56\.7pt 56\.7pt 56\.7pt/);
  assert.match(cssPage, /body \{[^}]*padding: 0/);
});

test("body-padding strategy keeps @page margin at zero and pads the body instead", () => {
  const css = buildPageCss(options({ marginStrategy: "body-padding", margins: "narrow", orientation: "landscape" }));
  assert.match(css, /@page \{[^}]*size: 792pt 612pt/);
  assert.match(css, /@page \{[^}]*margin: 0/);
  assert.match(css, /body \{[^}]*padding: 28\.35pt/);
});

test("multi-page stability rules are present: break avoidance, repeating headers, word wrap", () => {
  const css = buildPageCss(options());
  assert.match(css, /thead \{ display: table-header-group; \}/);
  assert.match(css, /tfoot \{ display: table-footer-group; \}/);
  assert.match(css, /break-inside: avoid/);
  assert.match(css, /page-break-inside: avoid/); // legacy alias for older WebView print engines
  assert.match(css, /orphans: 3/);
  assert.match(css, /white-space: pre-wrap/);
  assert.match(css, /overflow-wrap: anywhere/);
});

test("opt-outs remove the rules they own", () => {
  const css = buildPageCss(options({ repeatTableHeaders: false, avoidBreaksInsideBlocks: false }));
  assert.equal(css.includes("table-header-group"), false);
  assert.equal(css.includes(".print-block, .print-transcript p,"), false);

  const optedIn = buildPageCss(options({ avoidBreaksInsideBlocks: true }));
  assert.match(optedIn, /\.print-block, \.print-transcript p, tr, li, blockquote, pre, figure \{ break-inside: avoid/);

  // Headings and images keep break avoidance regardless of the flag: a heading orphaned at
  // the bottom of a page, or an image sliced in half, is never the intended output.
  const optedOut = buildPageCss(options({ avoidBreaksInsideBlocks: false }));
  assert.match(optedOut, /img \{[^}]*break-inside: avoid/);
  assert.match(optedOut, /h1, h2, h3, h4, h5, h6 \{[^}]*break-after: avoid-page/);
});

test("the document is a complete, self-contained HTML page", () => {
  const doc = buildPrintDocument({
    title: 'Weekly "sync"',
    bodyHtml: "<p>hello</p>",
    options: options(),
  });
  assert.match(doc.html, /^<!DOCTYPE html>/);
  assert.match(doc.html, /<meta charset="utf-8" \/>/);
  assert.match(doc.html, /<title>Weekly &quot;sync&quot;<\/title>/);
  assert.match(doc.html, /<h1>Weekly &quot;sync&quot;<\/h1>/);
  assert.match(doc.html, /<main class="print-transcript print-block"><p>hello<\/p><\/main>/);
  assert.match(doc.html, /print-theme-light/);
});

test("the title can be suppressed without losing the document", () => {
  const doc = buildPrintDocument({ title: "T", bodyHtml: "<p>x</p>", options: options({ includeTitle: false }) });
  assert.equal(doc.html.includes("<h1>"), false);
  assert.match(doc.html, /<p>x<\/p>/);
});

test("page count estimate is monotonic, area-aware and font-aware", () => {
  const text = "x".repeat(20_000);
  const letter = estimatePageCount(text, options());
  const a5 = estimatePageCount(text, options({ paperSize: "A5" }));
  const bigFont = estimatePageCount(text, options({ baseFontSizePt: 22 }));
  assert.ok(letter >= 5, `expected at least 5 pages, got ${letter}`);
  assert.ok(a5 > letter, "smaller paper must estimate more pages");
  assert.ok(bigFont > letter, "a larger font must estimate more pages");
  assert.equal(estimatePageCount("", options()), 1);
});

test("the supervision timeout grows with the document but stays bounded", () => {
  assert.equal(resolveGenerationTimeoutMs(options({ generationTimeoutMs: 45_000 }), 1), 45_000);
  assert.equal(resolveGenerationTimeoutMs(options({ generationTimeoutMs: 45_000 }), 20), 80_000);
  assert.equal(resolveGenerationTimeoutMs(options({ generationTimeoutMs: 45_000 }), 500), 180_000);
});
