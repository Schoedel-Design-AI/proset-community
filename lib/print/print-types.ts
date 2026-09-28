/**
 * Print module — shared configuration schema.
 *
 * PURITY RULE: every file in lib/print/ that is NOT suffixed `.web.ts` /
 * `.android.ts` / `.ios.ts` must be plain TypeScript. No `react-native` import
 * (the Node test runner cannot load it), no DOM access at module scope. This is
 * the same contract lib/document-save.ts documents for the download path.
 *
 * UNITS: all lengths in this module are PostScript points (1 pt = 1/72 inch),
 * because that is the unit the Android converter accepts for page width/height.
 * Convert to mm only when writing CSS that targets browsers.
 */

/** US/ISO paper sizes this module can produce. */
export type PrintPaperSize = "A3" | "A4" | "A5" | "Letter" | "Legal" | "Tabloid";

export type PrintOrientation = "portrait" | "landscape";

/** Named margin presets, so the UI never has to invent numbers. */
export type PrintMarginPreset = "none" | "narrow" | "normal" | "wide";

export type PrintMargins = { top: number; right: number; bottom: number; left: number };

/**
 * How margins reach the page.
 *
 * - "body-padding" — margins as `body { padding }`. REQUIRED on Android: the
 *   native converter lays the WebView out on a full-bleed page and sets
 *   PrintAttributes.Margins.NO_MARGINS, so `@page { margin }` is unreliable there.
 * - "css-page"     — margins as `@page { margin }`. Correct for browsers, and the
 *   right choice on web where `@page` is honoured.
 *
 * Applying both at once would double the margin on browsers, which is why this is
 * an explicit, per-platform choice instead of "just set both".
 */
export type PrintMarginStrategy = "css-page" | "body-padding";

/** Light printing by default: a dark transcript wastes toner and hides text on paper. */
export type PrintTheme = "print-light" | "app-dark";

export type PrintOptions = {
  paperSize: PrintPaperSize;
  orientation: PrintOrientation;
  margins: PrintMarginPreset | PrintMargins;
  marginStrategy: PrintMarginStrategy;
  /**
   * Rasterisation resolution. Recorded and passed to the platforms that accept a
   * hint; the Android converter fixes its own PrintAttributes resolution at
   * 600x600 dpi, so treat this value as advisory (documented in
   * docs/architecture/printing-module.md, not silently ignored).
   */
  dpi: number;
  baseFontSizePt: number;
  lineHeight: number;
  fontFamily: string;
  theme: PrintTheme;
  includeTitle: boolean;
  includeGeneratedAt: boolean;
  /** Repeats `<thead>` on every page of a long table (display: table-header-group). */
  repeatTableHeaders: boolean;
  /** `break-inside: avoid` on paragraphs, rows, list items, blockquotes and pre blocks. */
  avoidBreaksInsideBlocks: boolean;
  inlineImages: boolean;
  maxInlineImageBytes: number;
  /** Total byte budget for inlined images; stops a 20-page doc from exploding. */
  maxTotalInlineImageBytes: number;
  imageTimeoutMs: number;
  generationTimeoutMs: number;
  fileName: string;
  /** Optional base URL so relative image/link paths resolve inside the converter. */
  baseUrl?: string;
};

/** Paper dimensions in points, portrait. Source: ISO 216 / ANSI. */
export const PAPER_SIZES_PT: Record<PrintPaperSize, { width: number; height: number }> = {
  A3: { width: 841.89, height: 1190.55 },
  A4: { width: 595.28, height: 841.89 },
  A5: { width: 419.53, height: 595.28 },
  Letter: { width: 612, height: 792 },
  Legal: { width: 612, height: 1008 },
  Tabloid: { width: 792, height: 1224 },
};

export const PRINT_PAPER_SIZES: PrintPaperSize[] = ["A3", "A4", "A5", "Letter", "Legal", "Tabloid"];

export const MARGIN_PRESETS_PT: Record<PrintMarginPreset, PrintMargins> = {
  none: { top: 0, right: 0, bottom: 0, left: 0 },
  narrow: { top: 28.35, right: 28.35, bottom: 28.35, left: 28.35 }, // 10 mm
  normal: { top: 56.7, right: 56.7, bottom: 56.7, left: 56.7 }, // 20 mm
  wide: { top: 85.05, right: 85.05, bottom: 85.05, left: 85.05 }, // 30 mm
};

export const DEFAULT_PRINT_OPTIONS: PrintOptions = {
  paperSize: "Letter",
  orientation: "portrait",
  margins: "normal",
  marginStrategy: "body-padding",
  dpi: 600,
  baseFontSizePt: 11,
  lineHeight: 1.45,
  fontFamily: "Georgia, 'Times New Roman', 'Noto Serif', serif",
  theme: "print-light",
  includeTitle: true,
  includeGeneratedAt: false,
  repeatTableHeaders: true,
  avoidBreaksInsideBlocks: true,
  inlineImages: true,
  maxInlineImageBytes: 1_500_000,
  maxTotalInlineImageBytes: 6_000_000,
  imageTimeoutMs: 8000,
  generationTimeoutMs: 45000,
  fileName: "proset-transcript",
};

export function resolvePaperSizePt(
  size: PrintPaperSize,
  orientation: PrintOrientation,
): { widthPt: number; heightPt: number } {
  const paper = PAPER_SIZES_PT[size];
  return orientation === "landscape"
    ? { widthPt: paper.height, heightPt: paper.width }
    : { widthPt: paper.width, heightPt: paper.height };
}

/** Always returns a fresh object: callers must not be able to mutate the preset table. */
export function resolveMarginsPt(margins: PrintMarginPreset | PrintMargins): PrintMargins {
  if (typeof margins === "string") {
    const preset = MARGIN_PRESETS_PT[margins];
    return { top: preset.top, right: preset.right, bottom: preset.bottom, left: preset.left };
  }
  return { top: margins.top, right: margins.right, bottom: margins.bottom, left: margins.left };
}

/**
 * Human-safe base file name for the generated PDF.
 *
 * Runs intentionally collapse into a single separator, so "Weekly sync / 2026-09-28"
 * becomes "Weekly_sync_2026-09-28" rather than a run of underscores.
 */
export function resolveFileName(title: string, suffix = "transcript"): string {
  const cleaned = sanitizeForFileName(title).slice(0, 80) || "proset";
  return `${cleaned}_${sanitizeForFileName(suffix) || "export"}.pdf`;
}

function sanitizeForFileName(value: string): string {
  return value
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "");
}
