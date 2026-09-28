/**
 * Font plumbing for the print document and for the on-screen font picker.
 *
 * Two transports, deliberately different:
 *
 *  1. PRINT → inlined `data:` URIs. A remote font that resolves after the renderer has
 *     paginated makes the layout use fallback metrics and shifts every page break. A 20-page
 *     document can then paginate twice, differently. Inlining (16-63 KB for latin
 *     regular+bold) makes the layout deterministic. `font-display: block`, never `swap`, for
 *     the same reason: swap would render fallback text first.
 *
 *  2. PICKER PREVIEW → the Google Fonts CSS API, loaded lazily by the browser/WebView. The
 *     preview is a live screen, so it wants the cheapest path to seeing text in the real
 *     face — one stylesheet per visible family, no bytes embedded in the app bundle.
 *
 * Purity: no react-native import and no DOM access. Fetching is injected, so every branch
 * (success, failure, oversize, timeout) is provable in the Node test runner.
 */

import { bytesToBase64 } from "../base64";
import { PrintTimeoutError, withTimeout } from "./print-async";
import { SYSTEM_SERIF_STACK, type PrintFontFamily } from "./print-fonts";
import { escapeHtml } from "./print-html";

export type FontFaceStyle = "normal" | "italic";
export type FontFacePlan = { weight: number; style: FontFaceStyle };

export type FontFetchDeps = {
  fetchBytes: (url: string) => Promise<{ bytes: Uint8Array; contentType: string | null }>;
  fetchText: (url: string) => Promise<string>;
  warn?: (message: string, detail?: unknown) => void;
};

export type FontInlineOptions = {
  timeoutMs: number;
  maxBytesPerFile: number;
};

export type FontInlineFailureReason = "fetch-failed" | "timeout" | "too-large" | "no-latin" | "empty";

export type InlineFontResult = {
  css: string;
  inlined: FontFacePlan[];
  failed: Array<FontFacePlan & { reason: FontInlineFailureReason }>;
  bytes: number;
};

export type PlanFontWeightsOptions = { includeItalic?: boolean };

/**
 * Which faces to embed. Regular, plus a real bold only when the family ships one: asking a
 * single-weight family such as Meie Script for weight 700 makes Google return a synthesised
 * or missing face, so we do not ask.
 *
 * A family with no true italic gets no italic face; italic text then renders as a synthetic
 * oblique, which is honest about the font rather than fetching a face that does not exist.
 */
export function planFontWeights(font: PrintFontFamily, options: PlanFontWeightsOptions = {}): FontFacePlan[] {
  const regular = font.weights.includes(400) ? 400 : font.weights[0];
  const plan: FontFacePlan[] = [{ weight: regular, style: "normal" }];
  if (font.hasBold && font.weights.includes(700)) plan.push({ weight: 700, style: "normal" });
  if (options.includeItalic && font.italics.length > 0) {
    const italicWeight = font.italics.includes(400) ? 400 : font.italics.reduce((best, w) => (Math.abs(w - 400) < Math.abs(best - 400) ? w : best), font.italics[0]);
    plan.push({ weight: italicWeight, style: "italic" });
  }
  return plan;
}

/**
 * Google Fonts CSS API URL for a set of faces. Used for on-screen preview only — never for
 * the print document, which inlines (§ header).
 */
export function buildPreviewCssUrl(font: PrintFontFamily, wanted: FontFacePlan[]): string {
  const family = encodeURIComponent(font.family);
  const hasItalic = wanted.some((face) => face.style === "italic");
  const axis = hasItalic
    ? "ital,wght@" + wanted.map((face) => (face.style === "italic" ? "1," : "0,") + face.weight).join(";")
    : "wght@" + wanted.map((face) => face.weight).join(";");
  return "https://fonts.googleapis.com/css2?family=" + family + ":" + axis + "&display=swap";
}

/** The latin-subset woff2 URL inside a Google Fonts stylesheet, or null when absent. */
function latinUrlFromStylesheet(css: string): string | null {
  const blocks = css.split(/\/\*\s*([a-z0-9-]+)\s*\*\//).slice(1);
  for (let i = 0; i < blocks.length; i += 2) {
    if (blocks[i] !== "latin") continue;
    return /url\((https:[^)]+\.woff2)\)/.exec(blocks[i + 1] ?? "")?.[1] ?? null;
  }
  return null;
}

/**
 * Media type from magic bytes. A server's Content-Type is a claim; the bytes are evidence,
 * and the type ends up inside a data URI that a WebView must decode.
 */
export function sniffFontContentType(bytes: Uint8Array): string | null {
  const has = (...prefix: number[]) => prefix.every((byte, index) => bytes[index] === byte);
  if (has(0x77, 0x4f, 0x46, 0x32)) return "font/woff2"; // wOF2
  if (has(0x77, 0x4f, 0x46, 0x46)) return "font/woff"; // wOFF
  if (has(0x4f, 0x54, 0x54, 0x4f)) return "font/otf"; // OTTO
  if (has(0x00, 0x01, 0x00, 0x00) || has(0x74, 0x72, 0x75, 0x65)) return "font/ttf"; // 0x00010000 / true
  return null;
}

function fontDataUri(bytes: Uint8Array, contentType: string | null): string {
  const sniffed = sniffFontContentType(bytes);
  const declared = contentType && /^font\//i.test(contentType) ? contentType.toLowerCase() : null;
  return "data:" + (sniffed ?? declared ?? "font/woff2") + ";base64," + bytesToBase64(bytes);
}

/**
 * Build the `@font-face` CSS that goes into the print document.
 *
 * Failure is never fatal: if a font cannot be fetched, the document still prints with the
 * fallback stack. An unstyled-but-complete transcript beats a print job that refuses to run.
 */
export async function buildInlinedFontFaceCss(
  font: PrintFontFamily,
  wanted: FontFacePlan[],
  deps: FontFetchDeps,
  options: FontInlineOptions,
): Promise<InlineFontResult> {
  const blocks: string[] = [];
  const inlined: FontFacePlan[] = [];
  const failed: Array<FontFacePlan & { reason: FontInlineFailureReason }> = [];
  let bytes = 0;

  for (const face of wanted) {
    try {
      const css = await withTimeout(deps.fetchText(buildPreviewCssUrl(font, [face])), options.timeoutMs, "font-css");
      const url = latinUrlFromStylesheet(css);
      if (!url) {
        failed.push({ ...face, reason: "no-latin" });
        deps.warn?.("print: font face has no latin subset", { family: font.family, face });
        continue;
      }
      const { bytes: data, contentType } = await withTimeout(deps.fetchBytes(url), options.timeoutMs, "font-bytes");
      if (data.length === 0) {
        failed.push({ ...face, reason: "empty" });
        continue;
      }
      if (data.length > options.maxBytesPerFile) {
        failed.push({ ...face, reason: "too-large" });
        deps.warn?.("print: font file exceeds the inline budget", { family: font.family, face, bytes: data.length });
        continue;
      }
      blocks.push(
        "@font-face {\n" +
          "  font-family: '" + font.family + "';\n" +
          "  font-style: " + face.style + ";\n" +
          "  font-weight: " + face.weight + ";\n" +
          "  font-display: block;\n" +
          "  src: url(" + fontDataUri(data, contentType) + ") format('" + (sniffFontContentType(data) === "font/woff2" ? "woff2" : "woff") + "');\n" +
          "}",
      );
      inlined.push(face);
      bytes += data.length;
    } catch (error) {
      const reason: FontInlineFailureReason = error instanceof PrintTimeoutError ? "timeout" : "fetch-failed";
      failed.push({ ...face, reason });
      deps.warn?.("print: font face could not be inlined", { family: font.family, face, reason });
    }
  }

  return { css: blocks.join("\n"), inlined, failed, bytes };
}

/**
 * A small self-contained document showing sample text in a family.
 *
 * This is how the selector lets a user see their own text in the family: the same builder
 * feeds a preview box on web (iframe) and a WebView on native — the same architecture as the
 * print path, so a font that previews correctly renders correctly.
 *
 * Passing `null` renders the default system stack and loads nothing from the network.
 */
export function buildFontSampleHtml(font: PrintFontFamily | null, sampleText: string): string {
  const stack = font ? font.stack : SYSTEM_SERIF_STACK;
  const label = font ? font.family : "System serif (default)";
  const link = font
    ? '<link rel="stylesheet" href="' + buildPreviewCssUrl(font, planFontWeights(font)) + '" />'
    : "";
  return [
    "<!DOCTYPE html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8" />',
    '<meta name="viewport" content="width=device-width, initial-scale=1" />',
    "<title>Proset AI font preview</title>",
    link,
    "<style>",
    "body { margin: 0; padding: 16px; background: #fff; color: #111; }",
    ".label { font: 12px system-ui, sans-serif; opacity: 0.6; margin-bottom: 8px; }",
    ".sample { font-family: " + stack + "; font-size: 18px; line-height: 1.5; white-space: pre-wrap; }",
    "</style>",
    "</head>",
    "<body>",
    '<div class="label">Proset AI — ' + escapeHtml(label) + "</div>",
    '<p class="sample">' + escapeHtml(sampleText) + "</p>",
    "</body>",
    "</html>",
  ].join("\n");
}
