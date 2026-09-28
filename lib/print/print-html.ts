/**
 * HTML preparation for long documents.
 *
 * Everything here is pure and Node-testable. The rules exist because a 20-page
 * transcript is laid out by a print engine, not by the app's flex layout:
 *
 *  - The paper size must be declared in the document, or the platform default wins
 *    (Android's converter defaults to 612x792 pt = US Letter).
 *  - Margins must be expressed the way each engine reads them (see PrintMarginStrategy).
 *  - Paragraphs, table rows, images and code blocks must not be split across pages.
 *  - `<thead>` must repeat, or page 14 of a table is unreadable.
 *  - Code blocks must wrap; a horizontal scrollbar does not exist on paper.
 */

import { paragraphizeTranscript } from "@shared/transcript-format";

import { PrintMargins, PrintOptions, resolveMarginsPt, resolvePaperSizePt } from "./print-types";

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ESCAPES[char] ?? char);
}

/** Two decimals: enough for mm-accurate margins, short enough to keep the CSS readable. */
function pt(value: number): string {
  return String(Number(value.toFixed(2)));
}

/**
 * Transcript text -> paragraphs of escaped HTML.
 *
 * Reuses the app's own paragraphizer so the printed document breaks text exactly the way
 * the on-screen transcript does (never lose, reorder or rewrite words).
 */
export function textToBodyHtml(text: string): string {
  const paragraphs = paragraphizeTranscript(text)
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
  return paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join("\n");
}

const LIGHT_PALETTE = { background: "#ffffff", text: "#111111" };
const DARK_PALETTE = { background: "#0A1628", text: "#F0F4F8" };

/**
 * The flag `avoidBreaksInsideBlocks` owns exactly one rule (the block-level one).
 * Headings and images keep their break avoidance unconditionally: a heading orphaned at
 * the foot of a page, or an image sliced in half, is never the intended output, so those
 * rules are not something a configuration flag should be able to break.
 */
const BLOCK_BREAK_SELECTOR = ".print-block, .print-transcript p, tr, li, blockquote, pre, figure";

export function buildPageCss(options: PrintOptions): string {
  const { widthPt, heightPt } = resolvePaperSizePt(options.paperSize, options.orientation);
  const margins: PrintMargins = resolveMarginsPt(options.margins);
  const cssMargins = `${pt(margins.top)}pt ${pt(margins.right)}pt ${pt(margins.bottom)}pt ${pt(margins.left)}pt`;
  const pageMargin = options.marginStrategy === "css-page" ? cssMargins : "0";
  const bodyPadding = options.marginStrategy === "body-padding" ? cssMargins : "0";
  const palette = options.theme === "app-dark" ? DARK_PALETTE : LIGHT_PALETTE;

  const rules: string[] = [
    `@page { size: ${pt(widthPt)}pt ${pt(heightPt)}pt; margin: ${pageMargin}; }`,
    `* { box-sizing: border-box; }`,
    `html, body { margin: 0; padding: 0; background: ${palette.background}; color: ${palette.text}; }`,
    `body { padding: ${bodyPadding}; font-family: ${options.fontFamily}; font-size: ${pt(options.baseFontSizePt)}pt; line-height: ${options.lineHeight}; -webkit-print-color-adjust: exact; print-color-adjust: exact; }`,
    `h1, h2, h3, h4, h5, h6 { break-after: avoid-page; page-break-after: avoid; break-inside: avoid; }`,
    `h1 { font-size: ${pt(options.baseFontSizePt * 1.8)}pt; margin: 0 0 ${pt(options.baseFontSizePt * 1.2)}pt; }`,
    `p { margin: 0 0 ${pt(options.baseFontSizePt * 0.6)}pt; orphans: 3; widows: 3; text-align: left; }`,
    `img { max-width: 100%; height: auto; break-inside: avoid; page-break-inside: avoid; }`,
    `table { width: 100%; border-collapse: collapse; }`,
    `th, td { border: 0.5pt solid ${palette.text}; padding: 4pt 6pt; text-align: left; vertical-align: top; }`,
    `pre, code { white-space: pre-wrap; overflow-wrap: anywhere; word-break: break-word; }`,
    `blockquote { margin: 0 0 ${pt(options.baseFontSizePt * 0.6)}pt; padding-left: 12pt; border-left: 2pt solid ${palette.text}; }`,
    `a { color: inherit; text-decoration: underline; }`,
    `[data-print-break="before"] { break-before: page; page-break-before: always; }`,
    `[data-print-break="after"] { break-after: page; page-break-after: always; }`,
  ];

  if (options.repeatTableHeaders) {
    // Chrome/WebView repeat a <thead> on every page when it is a table-header-group.
    rules.push(`thead { display: table-header-group; }`, `tfoot { display: table-footer-group; }`);
  }
  if (options.avoidBreaksInsideBlocks) {
    rules.push(`${BLOCK_BREAK_SELECTOR} { break-inside: avoid; page-break-inside: avoid; }`);
  }

  return rules.join("\n");
}

export type PrintDocumentInput = {
  title: string;
  bodyHtml: string;
  options: PrintOptions;
  /** ISO timestamp; only rendered when options.includeGeneratedAt is true. */
  generatedAt?: string;
  /** Optional @font-face rules (data URIs) prepended to the document stylesheet. */
  fontFaceCss?: string;
};

export type PrintDocument = {
  html: string;
  pageSizePt: { widthPt: number; heightPt: number };
  marginsPt: PrintMargins;
};

export function buildPrintDocument(input: PrintDocumentInput): PrintDocument {
  const { title, bodyHtml, options } = input;
  const themeClass = options.theme === "app-dark" ? "print-theme-dark" : "print-theme-light";
  const showMeta = options.includeGeneratedAt && Boolean(input.generatedAt);
  const header =
    options.includeTitle || showMeta
      ? [
          `<header class="print-header">`,
          options.includeTitle ? `<h1>${escapeHtml(title)}</h1>` : "",
          showMeta ? `<p class="print-meta">${escapeHtml(String(input.generatedAt))}</p>` : "",
          `</header>`,
        ]
          .filter(Boolean)
          .join("")
      : "";

  const html = [
    `<!DOCTYPE html>`,
    `<html lang="en">`,
    `<head>`,
    `<meta charset="utf-8" />`,
    `<meta name="viewport" content="width=device-width, initial-scale=1" />`,
    `<title>${escapeHtml(title)}</title>`,
    `<style>`,
    input.fontFaceCss ?? "",
    buildPageCss(options),
    `</style>`,
    `</head>`,
    `<body class="print-body ${themeClass}">`,
    header,
    `<main class="print-transcript print-block">${bodyHtml}</main>`,
    `</body>`,
    `</html>`,
  ].join("\n");

  return {
    html,
    pageSizePt: resolvePaperSizePt(options.paperSize, options.orientation),
    marginsPt: resolveMarginsPt(options.margins),
  };
}

const REFERENCE_PAGE = {
  widthPt: 612,
  heightPt: 792,
  marginsPt: 56.7,
  charsPerPage: 3200,
  fontPt: 11,
};

/**
 * Heuristic page count, used to size the supervision timeout and to decide whether the UI
 * should show the long-run state. Deliberately rough: it is never shown to the user as a
 * promise of a page count.
 *
 * Characters per page scale linearly with usable page area and inversely with the square
 * of the font size (a font twice as large fits a quarter of the characters).
 */
export function estimatePageCount(text: string, options: PrintOptions): number {
  const trimmed = text.trim();
  if (!trimmed) return 1;

  const { widthPt, heightPt } = resolvePaperSizePt(options.paperSize, options.orientation);
  const margins = resolveMarginsPt(options.margins);
  const usableArea = Math.max(1, (widthPt - margins.left - margins.right) * (heightPt - margins.top - margins.bottom));
  const referenceArea =
    (REFERENCE_PAGE.widthPt - 2 * REFERENCE_PAGE.marginsPt) *
    (REFERENCE_PAGE.heightPt - 2 * REFERENCE_PAGE.marginsPt);
  const fontScale = (REFERENCE_PAGE.fontPt / Math.max(4, options.baseFontSizePt)) ** 2;
  const charsPerPage = Math.max(
    400,
    REFERENCE_PAGE.charsPerPage * (usableArea / referenceArea) * fontScale,
  );
  return Math.max(1, Math.ceil(trimmed.length / charsPerPage));
}

/**
 * Supervision timeout for one generation.
 *
 * NOTE (honest limitation): the native converter enforces its own 30 s watchdog
 * (CONVERSION_TIMEOUT_MS in PdfConverter.kt), so this value only governs how long WE wait.
 * Read the plan's Q4 before assuming a 20-page document can take longer than 30 s on
 * Android. For a short document this is a ceiling, never a delay.
 */
export function resolveGenerationTimeoutMs(options: PrintOptions, estimatedPages: number | null): number {
  const perPageMs = 4000;
  const scaled = (estimatedPages ?? 1) * perPageMs;
  return Math.min(Math.max(options.generationTimeoutMs, scaled), 180_000);
}
