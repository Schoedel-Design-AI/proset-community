import assert from "node:assert/strict";
import test from "node:test";

import {
  PRINT_FONT_CATALOG_GENERATED_AT,
  PRINT_FONT_FAMILIES,
  PRINT_FONT_SHORTLIST,
  PRINT_FONT_STALE_AFTER_DAYS,
  SYSTEM_SERIF_STACK,
  catalogAgeDays,
  catalogIsStale,
  findPrintFont,
  listPrintFonts,
  resolveFontStack,
} from "../../lib/print/print-fonts";

/**
 * Barry's curated list, verbatim (Ubuntu appeared twice in his message; the catalog holds
 * one entry per family). This array is the contract: if the refresh script ever drops or
 * renames a family, this test fails rather than the picker silently losing a choice.
 */
const REQUESTED = [
  "Roboto Mono", "Google Sans", "Lato", "Nunito", "Ubuntu", "Mulish", "Jost",
  "Google Sans Flex", "EB Garamond", "Josefin Sans", "Meie Script",
  "Herr Von Muellerhoff", "Mrs Saint Delafield", "IBM Plex Serif", "Basic",
  "Nanum Gothic", "Open Sans", "Inter", "Outfit", "Lora", "Cormorant Garamond",
  "Geist", "Crimson Text", "Sorts Mill Goudy", "Bellefair", "Newsreader",
  "Spectral", "Wittgenstein",
];

/** Families that ship a single weight, so a renderer must synthesise bold. */
const NO_BOLD = ["Sorts Mill Goudy", "Mrs Saint Delafield", "Basic", "Bellefair", "Herr Von Muellerhoff", "Meie Script"];

test("every requested family is present exactly once", () => {
  assert.equal(PRINT_FONT_FAMILIES.length, REQUESTED.length);
  assert.equal(PRINT_FONT_FAMILIES.length, 28);
  const names = PRINT_FONT_FAMILIES.map((f) => f.family);
  assert.deepEqual([...names].sort(), [...REQUESTED].sort());
  assert.equal(new Set(names).size, names.length, "duplicate family in the catalog");
});

test("each entry carries the metadata the picker and the printer need", () => {
  for (const font of PRINT_FONT_FAMILIES) {
    assert.ok(font.rank >= 1, `${font.family} has no popularity rank`);
    assert.ok(font.license === "OFL-1.1" || font.license === "UFL-1.1", `${font.family} license is ${font.license}`);
    assert.ok(font.weights.length >= 1, `${font.family} declares no weights`);
    assert.ok(font.weights.includes(font.weights.includes(400) ? 400 : font.weights[0]));
    assert.ok(font.printSubsets.includes("latin"), `${font.family} has no latin subset`);
    assert.equal(font.stack.startsWith(`'${font.family}'`), true, `${font.family} stack does not lead with the family`);
    assert.match(font.stack, /(serif|sans-serif|monospace|cursive)$/, `${font.family} stack has no generic fallback`);
    assert.ok(font.latinBytes.regular && font.latinBytes.regular > 0, `${font.family} has no measured regular size`);
  }
});

test("Ubuntu is the one UFL family", () => {
  const ufl = PRINT_FONT_FAMILIES.filter((f) => f.license === "UFL-1.1").map((f) => f.family);
  assert.deepEqual(ufl, ["Ubuntu"]);
  assert.equal(findPrintFont("Ubuntu")?.license, "UFL-1.1");
});

test("hasBold tells the truth about which families can render a real bold", () => {
  for (const font of PRINT_FONT_FAMILIES) {
    assert.equal(font.hasBold, font.weights.includes(700), `${font.family} hasBold disagrees with its weights`);
  }
  for (const name of NO_BOLD) {
    assert.equal(findPrintFont(name)?.hasBold, false, `${name} should be 400-only`);
  }
  assert.equal(findPrintFont("Inter")?.hasBold, true);
});

test("the shortlist is twelve families that exist, flagged consistently", () => {
  assert.equal(PRINT_FONT_SHORTLIST.length, 12);
  assert.equal(new Set(PRINT_FONT_SHORTLIST).size, 12);
  for (const name of PRINT_FONT_SHORTLIST) {
    assert.ok(findPrintFont(name), `shortlist entry ${name} is not in the catalog`);
    assert.equal(findPrintFont(name)?.shortlist, true);
  }
  const flagged = PRINT_FONT_FAMILIES.filter((f) => f.shortlist).map((f) => f.family);
  assert.deepEqual([...flagged].sort(), [...PRINT_FONT_SHORTLIST].sort());
});

test("the shortlist spans the categories a transcript needs", () => {
  const categories = new Set(PRINT_FONT_SHORTLIST.map((name) => findPrintFont(name)?.category));
  for (const needed of ["sans-serif", "serif", "monospace"]) {
    assert.equal(categories.has(needed as never), true, `shortlist has no ${needed} family`);
  }
});

test("lookup is forgiving about case and spacing, and returns null for anything else", () => {
  assert.equal(findPrintFont("inter")?.family, "Inter");
  assert.equal(findPrintFont("  GOOGLE SANS  ")?.family, "Google Sans");
  assert.equal(findPrintFont("EB Garamond")?.family, "EB Garamond");
  assert.equal(findPrintFont("Times New Roman"), null);
  assert.equal(findPrintFont(""), null);
  assert.equal(findPrintFont(null), null);
  assert.equal(findPrintFont(undefined), null);
});

test("the default stays a system serif stack so the short-document path needs no network", () => {
  assert.match(SYSTEM_SERIF_STACK, /Georgia/);
  assert.equal(resolveFontStack(null), SYSTEM_SERIF_STACK);
  assert.equal(resolveFontStack(undefined), SYSTEM_SERIF_STACK);
  assert.equal(resolveFontStack("Times New Roman"), SYSTEM_SERIF_STACK, "unknown families must fall back, not throw");
  assert.equal(resolveFontStack("newsreader"), findPrintFont("Newsreader")?.stack);
});

test("staleness is measured from the recorded generation date", () => {
  assert.match(PRINT_FONT_CATALOG_GENERATED_AT, /^\d{4}-\d{2}-\d{2}$/);
  const generated = new Date(`${PRINT_FONT_CATALOG_GENERATED_AT}T00:00:00Z`);
  const at = (days: number) => new Date(generated.getTime() + days * 86_400_000);
  assert.equal(catalogAgeDays(at(0)), 0);
  assert.equal(catalogIsStale(at(PRINT_FONT_STALE_AFTER_DAYS)), false);
  assert.equal(catalogIsStale(at(PRINT_FONT_STALE_AFTER_DAYS + 1)), true);
  assert.equal(catalogIsStale(new Date(generated.getTime() - 86_400_000)), false, "a future date is not stale");
});

test("filtering supports the picker's three interactions", () => {
  const serif = listPrintFonts({ category: "serif" });
  assert.ok(serif.length > 0);
  assert.equal(serif.every((f) => f.category === "serif"), true);

  const short = listPrintFonts({ shortlistOnly: true });
  assert.equal(short.length, 12);

  const mono = listPrintFonts({ query: "mono" });
  assert.equal(mono.some((f) => f.family === "Roboto Mono"), true);
  assert.equal(mono.every((f) => /mono/i.test(f.family) || f.category === "monospace"), true);

  assert.equal(listPrintFonts().length, 28);
  assert.equal(listPrintFonts({ query: "zzzz" }).length, 0);
});
