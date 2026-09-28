#!/usr/bin/env node
/**
 * Regenerates lib/print/print-fonts.ts from live Google Fonts data.
 *
 * Run: node scripts/refresh-print-font-catalog.mjs
 *
 * Why this exists: the print catalog must never be a remembered list. A list typed from
 * memory rots silently — the original brief called this out ("not three years ago"). This
 * script re-reads the authoritative sources and rewrites the catalog, so refreshing is one
 * command and the result is reviewable as a diff.
 *
 * Sources, all authoritative:
 *   1. https://fonts.google.com/metadata/fonts         popularity rank, category, subsets
 *   2. https://raw.githubusercontent.com/google/fonts  license, from the ofl/ apache/ ufl/
 *                                                      directory the family lives in
 *   3. https://fonts.googleapis.com/css2 + fonts.gstatic.com  real latin woff2 byte sizes
 *
 * The family list itself is Barry's curated selection, verified present in (1).
 */
import { writeFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "lib/print/print-fonts.ts");

const FAMILIES = [
  "Roboto Mono", "Google Sans", "Lato", "Nunito", "Ubuntu", "Mulish", "Jost",
  "Google Sans Flex", "EB Garamond", "Josefin Sans", "Meie Script",
  "Herr Von Muellerhoff", "Mrs Saint Delafield", "IBM Plex Serif", "Basic",
  "Nanum Gothic", "Open Sans", "Inter", "Outfit", "Lora", "Cormorant Garamond",
  "Geist", "Crimson Text", "Sorts Mill Goudy", "Bellefair", "Newsreader",
  "Spectral", "Wittgenstein",
];

/**
 * The picker's first screen. Twelve families chosen for print usefulness rather than rank
 * alone: readable long-form serifs, clean screen sans, one monospace for code blocks, and
 * one script for titles. Everything else stays one tap away in the full list.
 */
const SHORTLIST = [
  "Open Sans", "Google Sans", "Inter", "Lato", "Outfit", "Roboto Mono",
  "Lora", "EB Garamond", "Newsreader", "Crimson Text", "IBM Plex Serif",
  "Mrs Saint Delafield",
];

const CATEGORY_MAP = {
  "Sans Serif": "sans-serif",
  Serif: "serif",
  Monospace: "monospace",
  Handwriting: "handwriting",
  Display: "display",
};

const GENERIC_FALLBACK = {
  "sans-serif": "system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif",
  serif: "Georgia, 'Times New Roman', 'Noto Serif', serif",
  monospace: "'SF Mono', Menlo, Consolas, 'DejaVu Sans Mono', monospace",
  handwriting: "'Segoe Script', 'Brush Script MT', cursive",
  display: "Georgia, 'Times New Roman', serif",
};

const slugify = (name) => name.toLowerCase().replace(/[^a-z0-9]/g, "");

async function getJson(url) {
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res.json();
}

/** License comes from which directory of google/fonts holds the family. */
async function resolveLicense(family) {
  for (const dir of ["ofl", "apache", "ufl"]) {
    const url = `https://raw.githubusercontent.com/google/fonts/main/${dir}/${slugify(family)}/METADATA.pb`;
    const res = await fetch(url, { headers: { "User-Agent": UA } });
    if (!res.ok) continue;
    const body = await res.text();
    const raw = /license:\s*"([^"]+)"/.exec(body)?.[1] ?? dir.toUpperCase();
    return raw === "OFL" ? "OFL-1.1" : raw === "UFL" ? "UFL-1.1" : raw;
  }
  throw new Error(`no license directory found for ${family}`);
}

function buildAxisUrl(family, weight, style) {
  const axis = style === "italic" ? `ital,wght@1,${weight}` : `wght@${weight}`;
  return `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}:${axis}&display=swap`;
}

/** The latin-subset woff2 URL for one face, or null when the face has no latin block. */
function latinUrlFromStylesheet(css) {
  const blocks = css.split(/\/\*\s*([a-z0-9-]+)\s*\*\//).slice(1);
  for (let i = 0; i < blocks.length; i += 2) {
    if (blocks[i] !== "latin") continue;
    return /url\((https:[^)]+\.woff2)\)/.exec(blocks[i + 1] ?? "")?.[1] ?? null;
  }
  return null;
}

async function measureFace(family, weight, style) {
  try {
    const res = await fetch(buildAxisUrl(family, weight, style), { headers: { "User-Agent": UA } });
    if (!res.ok) return null;
    const url = latinUrlFromStylesheet(await res.text());
    if (!url) return null;
    const font = await fetch(url, { headers: { "User-Agent": UA } });
    if (!font.ok) return null;
    return (await font.arrayBuffer()).byteLength;
  } catch {
    return null;
  }
}

const catalog = await getJson("https://fonts.google.com/metadata/fonts");
const list = catalog.familyMetadataList ?? catalog;
const byName = new Map(list.map((entry) => [slugify(entry.family), entry]));

const missing = FAMILIES.filter((name) => !byName.has(slugify(name)));
if (missing.length) {
  console.error(`ERROR: these families are not in the Google Fonts catalog: ${missing.join(", ")}`);
  process.exit(1);
}

const entries = [];
for (const name of FAMILIES) {
  const meta = byName.get(slugify(name));
  const variantKeys = Object.keys(meta.fonts ?? {});
  const weights = variantKeys.filter((k) => !k.endsWith("i")).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  const italics = variantKeys.filter((k) => k.endsWith("i")).map((k) => Number(k.replace("i", ""))).filter(Number.isFinite).sort((a, b) => a - b);
  const category = CATEGORY_MAP[meta.category] ?? "serif";
  const regular = weights.includes(400) ? 400 : weights[0];
  const bold = weights.includes(700) ? 700 : null;
  const italicWeight = italics.includes(400) ? 400 : (italics[0] ?? null);
  const license = await resolveLicense(name);

  const regularBytes = await measureFace(name, regular, "normal");
  const boldBytes = bold ? await measureFace(name, bold, "normal") : null;
  const italicBytes = italicWeight ? await measureFace(name, italicWeight, "italic") : null;

  entries.push({
    family: meta.family,
    slug: slugify(meta.family),
    rank: meta.popularity ?? 0,
    category,
    license,
    weights,
    italics,
    hasBold: bold !== null,
    shortlist: SHORTLIST.includes(name),
    stack: `'${meta.family}', ${GENERIC_FALLBACK[category]}`,
    printSubsets: (meta.subsets ?? []).filter((s) => s === "latin" || s === "latin-ext"),
    latinBytes: { regular: regularBytes, bold: boldBytes, italic: italicBytes },
    isBrandFont: Boolean(meta.isBrandFont),
  });

  console.log(
    `  ${meta.family.padEnd(30)} rank ${String(meta.popularity).padStart(4)}  ${license.padEnd(7)} ${category.padEnd(11)} ` +
      `w:${weights.join(",")}${italics.length ? ` i:${italics.join(",")}` : ""}  latin ${regularBytes ?? "?"}/${boldBytes ?? "-"}/${italicBytes ?? "-"} B`,
  );
}

entries.sort((a, b) => a.rank - b.rank);

const generatedAt = new Date().toISOString().slice(0, 10);
const data = JSON.stringify(entries, null, 2).replace(/"([a-zA-Z][a-zA-Z0-9]*)":/g, "$1:");

const HEADER = `/**
 * Print font catalog — GENERATED FILE, DO NOT EDIT BY HAND.
 *
 * Regenerate:  node scripts/refresh-print-font-catalog.mjs
 * Generated:   ${generatedAt}
 * Families:    ${entries.length} (Barry's curated selection, all verified present in the live catalog)
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
`;

const TYPES = `
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
`;

const DATA = `
export const PRINT_FONT_FAMILIES: PrintFontFamily[] = ${data};

export const PRINT_FONT_SHORTLIST: string[] = ${JSON.stringify(SHORTLIST, null, 2)};
`;

// Deliberately built with string concatenation, not template literals: the generator embeds
// this text, so a stray backtick or dollar-brace would corrupt the generated file.
const HELPERS = `
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
`;

const body = HEADER + TYPES + `\nexport const PRINT_FONT_CATALOG_GENERATED_AT = ${JSON.stringify(generatedAt)};\n` + DATA + HELPERS;

// Report what changed, so a refresh is reviewable at a glance. The previous content must be
// read BEFORE the write, or the comparison would always be against the new file.
let previous = null;
try {
  previous = readFileSync(OUT, "utf8");
} catch {
  previous = null;
}

writeFileSync(OUT, body);

console.log("");
console.log(`catalog families: ${entries.length}   shortlist: ${SHORTLIST.length}   generated: ${generatedAt}`);
console.log(`wrote ${OUT} (${body.length} bytes)`);
if (previous && previous !== body) console.log("NOTE: content changed vs the previous file — review the diff before committing.");
