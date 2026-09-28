/**
 * Print font catalog — GENERATED FILE, DO NOT EDIT BY HAND.
 *
 * Regenerate:  node scripts/refresh-print-font-catalog.mjs
 * Generated:   2026-09-28
 * Families:    28 (Barry's curated selection, all verified present in the live catalog)
 *
 * Sources, all authoritative and re-read on every regeneration:
 *   - fonts.google.com/metadata/fonts          → popularity rank, category, subsets
 *   - github.com/google/fonts/{ofl,apache,ufl} → license, from the directory the family lives in
 *   - fonts.gstatic.com                        → real latin-subset woff2 byte sizes
 *
 * Purity: plain TypeScript. No react-native import, no DOM access. The picker, the preview
 * and the print document all read this one list, so there is exactly one place a font can
 * be added or reordered.
 */

export type PrintFontCategory = "sans-serif" | "serif" | "monospace" | "handwriting" | "display";

/** Resolved from the google/fonts directory the family ships in, never from memory. */
export type PrintFontLicense = "OFL-1.1" | "UFL-1.1";

export type PrintFontFamily = {
  family: string;
  slug: string;
  /** Live popularity rank at generation time (lower is more used). */
  rank: number;
  category: PrintFontCategory;
  license: PrintFontLicense;
  /** Upright weights available. A family absent from here cannot render that weight. */
  weights: number[];
  italics: number[];
  /** False when the family ships a single weight, so bold would be synthesised. */
  hasBold: boolean;
  /** True for the twelve families shown on the picker's first screen. */
  shortlist: boolean;
  /** Ready-to-use CSS font-family value: the family first, a generic fallback last. */
  stack: string;
  printSubsets: string[];
  /** Measured latin-subset woff2 sizes, for the inline byte budget. */
  latinBytes: { regular: number | null; bold: number | null; italic: number | null };
  isBrandFont: boolean;
};

/** The default print face: a system stack, so the common path makes no network calls. */
export const SYSTEM_SERIF_STACK = "Georgia, 'Times New Roman', 'Noto Serif', serif";

/** After this many days the catalog is considered stale and a test fails. */
export const PRINT_FONT_STALE_AFTER_DAYS = 180;

export const PRINT_FONT_CATALOG_GENERATED_AT = "2026-09-28";

export const PRINT_FONT_FAMILIES: PrintFontFamily[] = [
  {
    family: "Open Sans",
    slug: "opensans",
    rank: 3,
    category: "sans-serif",
    license: "OFL-1.1",
    weights: [
      300,
      400,
      500,
      600,
      700,
      800
    ],
    italics: [
      300,
      400,
      500,
      600,
      700,
      800
    ],
    hasBold: true,
    shortlist: true,
    stack: "'Open Sans', system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif",
    printSubsets: [
      "latin",
      "latin-ext"
    ],
    latinBytes: {
      regular: 18640,
      bold: 18204,
      italic: 19304
    },
    isBrandFont: false
  },
  {
    family: "Google Sans",
    slug: "googlesans",
    rank: 4,
    category: "sans-serif",
    license: "OFL-1.1",
    weights: [
      400,
      500,
      600,
      700
    ],
    italics: [
      400,
      500,
      600,
      700
    ],
    hasBold: true,
    shortlist: true,
    stack: "'Google Sans', system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif",
    printSubsets: [
      "latin",
      "latin-ext"
    ],
    latinBytes: {
      regular: 22048,
      bold: 22872,
      italic: 23468
    },
    isBrandFont: true
  },
  {
    family: "Inter",
    slug: "inter",
    rank: 5,
    category: "sans-serif",
    license: "OFL-1.1",
    weights: [
      100,
      200,
      300,
      400,
      500,
      600,
      700,
      800,
      900
    ],
    italics: [
      100,
      200,
      300,
      400,
      500,
      600,
      700,
      800,
      900
    ],
    hasBold: true,
    shortlist: true,
    stack: "'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif",
    printSubsets: [
      "latin",
      "latin-ext"
    ],
    latinBytes: {
      regular: 23664,
      bold: 24356,
      italic: 25040
    },
    isBrandFont: false
  },
  {
    family: "Lato",
    slug: "lato",
    rank: 10,
    category: "sans-serif",
    license: "OFL-1.1",
    weights: [
      100,
      300,
      400,
      700,
      900
    ],
    italics: [
      100,
      300,
      400,
      700,
      900
    ],
    hasBold: true,
    shortlist: true,
    stack: "'Lato', system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif",
    printSubsets: [
      "latin",
      "latin-ext"
    ],
    latinBytes: {
      regular: 23580,
      bold: 23040,
      italic: 24408
    },
    isBrandFont: false
  },
  {
    family: "Roboto Mono",
    slug: "robotomono",
    rank: 15,
    category: "monospace",
    license: "OFL-1.1",
    weights: [
      100,
      200,
      300,
      400,
      500,
      600,
      700
    ],
    italics: [
      100,
      200,
      300,
      400,
      500,
      600,
      700
    ],
    hasBold: true,
    shortlist: true,
    stack: "'Roboto Mono', 'SF Mono', Menlo, Consolas, 'DejaVu Sans Mono', monospace",
    printSubsets: [
      "latin",
      "latin-ext"
    ],
    latinBytes: {
      regular: 12680,
      bold: 12696,
      italic: 13928
    },
    isBrandFont: true
  },
  {
    family: "Nunito",
    slug: "nunito",
    rank: 25,
    category: "sans-serif",
    license: "OFL-1.1",
    weights: [
      200,
      300,
      400,
      500,
      600,
      700,
      800,
      900,
      1000
    ],
    italics: [
      200,
      300,
      400,
      500,
      600,
      700,
      800,
      900,
      1000
    ],
    hasBold: true,
    shortlist: false,
    stack: "'Nunito', system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif",
    printSubsets: [
      "latin",
      "latin-ext"
    ],
    latinBytes: {
      regular: 16316,
      bold: 16228,
      italic: 17140
    },
    isBrandFont: false
  },
  {
    family: "Outfit",
    slug: "outfit",
    rank: 31,
    category: "sans-serif",
    license: "OFL-1.1",
    weights: [
      100,
      200,
      300,
      400,
      500,
      600,
      700,
      800,
      900
    ],
    italics: [],
    hasBold: true,
    shortlist: true,
    stack: "'Outfit', system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif",
    printSubsets: [
      "latin",
      "latin-ext"
    ],
    latinBytes: {
      regular: 14032,
      bold: 14060,
      italic: null
    },
    isBrandFont: false
  },
  {
    family: "Ubuntu",
    slug: "ubuntu",
    rank: 34,
    category: "sans-serif",
    license: "UFL-1.1",
    weights: [
      300,
      400,
      500,
      700
    ],
    italics: [
      300,
      400,
      500,
      700
    ],
    hasBold: true,
    shortlist: false,
    stack: "'Ubuntu', system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif",
    printSubsets: [
      "latin",
      "latin-ext"
    ],
    latinBytes: {
      regular: 34924,
      bold: 29844,
      italic: 36468
    },
    isBrandFont: false
  },
  {
    family: "Lora",
    slug: "lora",
    rank: 38,
    category: "serif",
    license: "OFL-1.1",
    weights: [
      400,
      500,
      600,
      700
    ],
    italics: [
      400,
      500,
      600,
      700
    ],
    hasBold: true,
    shortlist: true,
    stack: "'Lora', Georgia, 'Times New Roman', 'Noto Serif', serif",
    printSubsets: [
      "latin",
      "latin-ext"
    ],
    latinBytes: {
      regular: 21148,
      bold: 21044,
      italic: 22756
    },
    isBrandFont: false
  },
  {
    family: "Mulish",
    slug: "mulish",
    rank: 46,
    category: "sans-serif",
    license: "OFL-1.1",
    weights: [
      200,
      300,
      400,
      500,
      600,
      700,
      800,
      900,
      1000
    ],
    italics: [
      200,
      300,
      400,
      500,
      600,
      700,
      800,
      900,
      1000
    ],
    hasBold: true,
    shortlist: false,
    stack: "'Mulish', system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif",
    printSubsets: [
      "latin",
      "latin-ext"
    ],
    latinBytes: {
      regular: 13364,
      bold: 13336,
      italic: 14280
    },
    isBrandFont: false
  },
  {
    family: "Jost",
    slug: "jost",
    rank: 52,
    category: "sans-serif",
    license: "OFL-1.1",
    weights: [
      100,
      200,
      300,
      400,
      500,
      600,
      700,
      800,
      900
    ],
    italics: [
      100,
      200,
      300,
      400,
      500,
      600,
      700,
      800,
      900
    ],
    hasBold: true,
    shortlist: false,
    stack: "'Jost', system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif",
    printSubsets: [
      "latin",
      "latin-ext"
    ],
    latinBytes: {
      regular: 9404,
      bold: 10520,
      italic: 11088
    },
    isBrandFont: false
  },
  {
    family: "Cormorant Garamond",
    slug: "cormorantgaramond",
    rank: 65,
    category: "serif",
    license: "OFL-1.1",
    weights: [
      300,
      400,
      500,
      600,
      700
    ],
    italics: [
      300,
      400,
      500,
      600,
      700
    ],
    hasBold: true,
    shortlist: false,
    stack: "'Cormorant Garamond', Georgia, 'Times New Roman', 'Noto Serif', serif",
    printSubsets: [
      "latin",
      "latin-ext"
    ],
    latinBytes: {
      regular: 22876,
      bold: 22340,
      italic: 23660
    },
    isBrandFont: false
  },
  {
    family: "Google Sans Flex",
    slug: "googlesansflex",
    rank: 70,
    category: "sans-serif",
    license: "OFL-1.1",
    weights: [
      1,
      100,
      200,
      300,
      400,
      500,
      600,
      700,
      800,
      900,
      1000
    ],
    italics: [],
    hasBold: true,
    shortlist: false,
    stack: "'Google Sans Flex', system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif",
    printSubsets: [
      "latin",
      "latin-ext"
    ],
    latinBytes: {
      regular: 20076,
      bold: 21408,
      italic: null
    },
    isBrandFont: true
  },
  {
    family: "EB Garamond",
    slug: "ebgaramond",
    rank: 81,
    category: "serif",
    license: "OFL-1.1",
    weights: [
      400,
      500,
      600,
      700,
      800
    ],
    italics: [
      400,
      500,
      600,
      700,
      800
    ],
    hasBold: true,
    shortlist: true,
    stack: "'EB Garamond', Georgia, 'Times New Roman', 'Noto Serif', serif",
    printSubsets: [
      "latin",
      "latin-ext"
    ],
    latinBytes: {
      regular: 23820,
      bold: 25292,
      italic: 25388
    },
    isBrandFont: false
  },
  {
    family: "Josefin Sans",
    slug: "josefinsans",
    rank: 86,
    category: "sans-serif",
    license: "OFL-1.1",
    weights: [
      100,
      200,
      300,
      400,
      500,
      600,
      700
    ],
    italics: [
      100,
      200,
      300,
      400,
      500,
      600,
      700
    ],
    hasBold: true,
    shortlist: false,
    stack: "'Josefin Sans', system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif",
    printSubsets: [
      "latin",
      "latin-ext"
    ],
    latinBytes: {
      regular: 12372,
      bold: 12072,
      italic: 12992
    },
    isBrandFont: false
  },
  {
    family: "Nanum Gothic",
    slug: "nanumgothic",
    rank: 99,
    category: "sans-serif",
    license: "OFL-1.1",
    weights: [
      400,
      700,
      800
    ],
    italics: [],
    hasBold: true,
    shortlist: false,
    stack: "'Nanum Gothic', system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif",
    printSubsets: [
      "latin"
    ],
    latinBytes: {
      regular: 17472,
      bold: 17824,
      italic: null
    },
    isBrandFont: false
  },
  {
    family: "Geist",
    slug: "geist",
    rank: 108,
    category: "sans-serif",
    license: "OFL-1.1",
    weights: [
      100,
      200,
      300,
      400,
      500,
      600,
      700,
      800,
      900
    ],
    italics: [
      100,
      200,
      300,
      400,
      500,
      600,
      700,
      800,
      900
    ],
    hasBold: true,
    shortlist: false,
    stack: "'Geist', system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif",
    printSubsets: [
      "latin",
      "latin-ext"
    ],
    latinBytes: {
      regular: 12956,
      bold: 13364,
      italic: 13432
    },
    isBrandFont: false
  },
  {
    family: "Newsreader",
    slug: "newsreader",
    rank: 127,
    category: "serif",
    license: "OFL-1.1",
    weights: [
      200,
      300,
      400,
      500,
      600,
      700,
      800
    ],
    italics: [
      200,
      300,
      400,
      500,
      600,
      700,
      800
    ],
    hasBold: true,
    shortlist: true,
    stack: "'Newsreader', Georgia, 'Times New Roman', 'Noto Serif', serif",
    printSubsets: [
      "latin",
      "latin-ext"
    ],
    latinBytes: {
      regular: 22480,
      bold: 23796,
      italic: 24340
    },
    isBrandFont: false
  },
  {
    family: "Crimson Text",
    slug: "crimsontext",
    rank: 131,
    category: "serif",
    license: "OFL-1.1",
    weights: [
      400,
      600,
      700
    ],
    italics: [
      400,
      600,
      700
    ],
    hasBold: true,
    shortlist: true,
    stack: "'Crimson Text', Georgia, 'Times New Roman', 'Noto Serif', serif",
    printSubsets: [
      "latin",
      "latin-ext"
    ],
    latinBytes: {
      regular: 25184,
      bold: 25540,
      italic: 26052
    },
    isBrandFont: false
  },
  {
    family: "Spectral",
    slug: "spectral",
    rank: 183,
    category: "serif",
    license: "OFL-1.1",
    weights: [
      200,
      300,
      400,
      500,
      600,
      700,
      800
    ],
    italics: [
      200,
      300,
      400,
      500,
      600,
      700,
      800
    ],
    hasBold: true,
    shortlist: false,
    stack: "'Spectral', Georgia, 'Times New Roman', 'Noto Serif', serif",
    printSubsets: [
      "latin",
      "latin-ext"
    ],
    latinBytes: {
      regular: 21696,
      bold: 23036,
      italic: 22712
    },
    isBrandFont: false
  },
  {
    family: "IBM Plex Serif",
    slug: "ibmplexserif",
    rank: 194,
    category: "serif",
    license: "OFL-1.1",
    weights: [
      100,
      200,
      300,
      400,
      500,
      600,
      700
    ],
    italics: [
      100,
      200,
      300,
      400,
      500,
      600,
      700
    ],
    hasBold: true,
    shortlist: true,
    stack: "'IBM Plex Serif', Georgia, 'Times New Roman', 'Noto Serif', serif",
    printSubsets: [
      "latin",
      "latin-ext"
    ],
    latinBytes: {
      regular: 19580,
      bold: 19904,
      italic: 20900
    },
    isBrandFont: false
  },
  {
    family: "Sorts Mill Goudy",
    slug: "sortsmillgoudy",
    rank: 401,
    category: "serif",
    license: "OFL-1.1",
    weights: [
      400
    ],
    italics: [
      400
    ],
    hasBold: false,
    shortlist: false,
    stack: "'Sorts Mill Goudy', Georgia, 'Times New Roman', 'Noto Serif', serif",
    printSubsets: [
      "latin",
      "latin-ext"
    ],
    latinBytes: {
      regular: 22804,
      bold: null,
      italic: 24744
    },
    isBrandFont: false
  },
  {
    family: "Mrs Saint Delafield",
    slug: "mrssaintdelafield",
    rank: 412,
    category: "handwriting",
    license: "OFL-1.1",
    weights: [
      400
    ],
    italics: [],
    hasBold: false,
    shortlist: true,
    stack: "'Mrs Saint Delafield', 'Segoe Script', 'Brush Script MT', cursive",
    printSubsets: [
      "latin",
      "latin-ext"
    ],
    latinBytes: {
      regular: 18812,
      bold: null,
      italic: null
    },
    isBrandFont: false
  },
  {
    family: "Basic",
    slug: "basic",
    rank: 561,
    category: "sans-serif",
    license: "OFL-1.1",
    weights: [
      400
    ],
    italics: [],
    hasBold: false,
    shortlist: false,
    stack: "'Basic', system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif",
    printSubsets: [
      "latin",
      "latin-ext"
    ],
    latinBytes: {
      regular: 18544,
      bold: null,
      italic: null
    },
    isBrandFont: false
  },
  {
    family: "Bellefair",
    slug: "bellefair",
    rank: 631,
    category: "serif",
    license: "OFL-1.1",
    weights: [
      400
    ],
    italics: [],
    hasBold: false,
    shortlist: false,
    stack: "'Bellefair', Georgia, 'Times New Roman', 'Noto Serif', serif",
    printSubsets: [
      "latin",
      "latin-ext"
    ],
    latinBytes: {
      regular: 16536,
      bold: null,
      italic: null
    },
    isBrandFont: false
  },
  {
    family: "Herr Von Muellerhoff",
    slug: "herrvonmuellerhoff",
    rank: 694,
    category: "handwriting",
    license: "OFL-1.1",
    weights: [
      400
    ],
    italics: [],
    hasBold: false,
    shortlist: false,
    stack: "'Herr Von Muellerhoff', 'Segoe Script', 'Brush Script MT', cursive",
    printSubsets: [
      "latin",
      "latin-ext"
    ],
    latinBytes: {
      regular: 17720,
      bold: null,
      italic: null
    },
    isBrandFont: false
  },
  {
    family: "Meie Script",
    slug: "meiescript",
    rank: 1057,
    category: "handwriting",
    license: "OFL-1.1",
    weights: [
      400
    ],
    italics: [],
    hasBold: false,
    shortlist: false,
    stack: "'Meie Script', 'Segoe Script', 'Brush Script MT', cursive",
    printSubsets: [
      "latin",
      "latin-ext"
    ],
    latinBytes: {
      regular: 40456,
      bold: null,
      italic: null
    },
    isBrandFont: false
  },
  {
    family: "Wittgenstein",
    slug: "wittgenstein",
    rank: 1249,
    category: "serif",
    license: "OFL-1.1",
    weights: [
      400,
      500,
      600,
      700,
      800,
      900
    ],
    italics: [
      400,
      500,
      600,
      700,
      800,
      900
    ],
    hasBold: true,
    shortlist: false,
    stack: "'Wittgenstein', Georgia, 'Times New Roman', 'Noto Serif', serif",
    printSubsets: [
      "latin",
      "latin-ext"
    ],
    latinBytes: {
      regular: 17144,
      bold: 18480,
      italic: 16080
    },
    isBrandFont: false
  }
];

export const PRINT_FONT_SHORTLIST: string[] = [
  "Open Sans",
  "Google Sans",
  "Inter",
  "Lato",
  "Outfit",
  "Roboto Mono",
  "Lora",
  "EB Garamond",
  "Newsreader",
  "Crimson Text",
  "IBM Plex Serif",
  "Mrs Saint Delafield"
];

const INDEX = new Map<string, PrintFontFamily>();
for (const font of PRINT_FONT_FAMILIES) {
  INDEX.set(font.slug, font);
}

function normalize(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Case- and spacing-insensitive lookup. Returns null for anything not in the catalog. */
export function findPrintFont(name: string | null | undefined): PrintFontFamily | null {
  if (!name || typeof name !== "string") return null;
  const key = normalize(name);
  if (!key) return null;
  return INDEX.get(key) ?? null;
}

/**
 * The CSS stack to use for a requested family. Unknown or absent families resolve to the
 * system serif stack rather than throwing: a print job must never fail because a stored
 * preference names a font that has since been removed from the catalog.
 */
export function resolveFontStack(name: string | null | undefined): string {
  return findPrintFont(name)?.stack ?? SYSTEM_SERIF_STACK;
}

export type PrintFontFilter = {
  category?: PrintFontCategory;
  shortlistOnly?: boolean;
  /** Case-insensitive substring match against the family name. */
  query?: string;
};

/** Filtering for the picker. Order is the catalog order (most used first). */
export function listPrintFonts(filter: PrintFontFilter = {}): PrintFontFamily[] {
  const query = filter.query ? filter.query.trim().toLowerCase() : "";
  return PRINT_FONT_FAMILIES.filter((font) => {
    if (filter.category && font.category !== filter.category) return false;
    if (filter.shortlistOnly && !font.shortlist) return false;
    if (query && !font.family.toLowerCase().includes(query)) return false;
    return true;
  });
}

export function catalogGeneratedAt(): Date {
  return new Date(PRINT_FONT_CATALOG_GENERATED_AT + "T00:00:00Z");
}

export function catalogAgeDays(now: Date = new Date()): number {
  return Math.floor((now.getTime() - catalogGeneratedAt().getTime()) / 86400000);
}

/** True once the recorded data is older than PRINT_FONT_STALE_AFTER_DAYS. */
export function catalogIsStale(now: Date = new Date()): boolean {
  return catalogAgeDays(now) > PRINT_FONT_STALE_AFTER_DAYS;
}
