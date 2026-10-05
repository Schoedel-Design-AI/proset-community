import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

/**
 * The recording screen's convert menu is the shared picker now, in both copies.
 *
 * It used to carry its own sheet: a search query declared with `useState("")` and no
 * setter, and no input rendered for it, so the three filters that read
 * `convertSearchQuery` never fired — the menu was unsearchable while containing the
 * code for a search (Barry, 2026-09-30). It also carried its own availability rule for
 * the locked/unlocked state of each row.
 *
 * The picker owns all of it: the query and its input, the grouping, the recents, the
 * locked/done decoration (through props), and drag-to-elongate on mobile.
 */
const read = (path) => readFileSync(path, "utf8");

const RECORDING_SOURCES = [
  "app/recording/[id].tsx",
  "scripts/ce-export/overrides/app/recording/[id].tsx",
];

test("the convert menu is the shared picker, and its dead search is gone", () => {
  for (const file of RECORDING_SOURCES) {
    const source = read(file);
    assert.match(
      source,
      /import ConversionTypePicker from "@\/components\/ConversionTypePicker";/,
      `${file}: must import the shared picker`,
    );
    assert.match(
      source,
      /<ConversionTypePicker\n\s+visible=\{showConvertMenu\}/,
      `${file}: the convert menu must render through the picker`,
    );
    assert.equal(
      source.includes("convertSearchQuery"),
      false,
      `${file}: the query state with no setter is the defect this migration removed`,
    );
    assert.equal(
      source.includes("convertSearchInput"),
      false,
      `${file}: a style for a search field that never rendered must not linger`,
    );
    // The picker brings its own sheet: no second sheet implementation, no second
    // drag-to-elongate implementation.
    assert.equal(
      source.includes("convertSheetPan"),
      false,
      `${file}: drag-to-elongate moved into the picker`,
    );
    assert.equal(
      source.includes("convertSheetHeight"),
      false,
      `${file}: the sheet's height state moved into the picker`,
    );
  }
});

test("the menu's locked state uses the shared availability rule", () => {
  for (const file of RECORDING_SOURCES) {
    const source = read(file);
    assert.match(
      source,
      /import \{ isConversionTypeOffered, listablePackModules, type ConversionAccess \} from "@\/lib\/conversion-availability";/,
      `${file}: must import the shared rule`,
    );
    assert.match(
      source,
      /return !isConversionTypeOffered\(typeValue, conversionAccess\);/,
      `${file}: locked means "this account may not use it", decided in one place`,
    );
    assert.equal(
      source.includes("isConversionTypeAvailable"),
      false,
      `${file}: the local tier-only rule is what this replaced`,
    );
    // What the menu SHOWS: every core type, plus the packs the shared helper lists
    // (shipped only, and not the known-unready ones while the fetch is outstanding).
    assert.match(
      source,
      /const convertMenuTypes = useMemo\(\n\s+\(\) => CONVERSION_TYPES\.filter\(\(type\) => !type\.module \|\| listableModules\.has\(type\.module\)\),/,
      `${file}: unshipped packs must not be listed`,
    );
  }
});

test("the menu passes the picker everything it used to render itself", () => {
  for (const file of RECORDING_SOURCES) {
    const source = read(file);
    for (const prop of [
      "onSelect={(value) => handleConvert(value)}",
      "recentTypes={recentConversionTypes}",
      "isLocked={isTypeLocked}",
      "onLockedPress={handleLockedConversionPress}",
      "lockedLabelFor={getLockedTierLabel}",
      "isDone={(value) => recording.conversions.some((c) => c.type === value)}",
      "showDoneCounts",
      "headerExtras={",
    ]) {
      assert.ok(source.includes(prop), `${file}: the picker must receive ${prop}`);
    }
    // The two toggles that sat above the list are now the picker's headerExtras.
    assert.match(
      source,
      /headerExtras=\{[\s\S]{0,900}detail\.codeBlockOutput[\s\S]{0,1600}includeWebSources/,
      `${file}: the code-block and web-sources switches must survive the migration`,
    );
  }
});

test("the shared picker supports what the recording menu needs", () => {
  const source = read("components/ConversionTypePicker.tsx");
  for (const capability of [
    "isLocked?: (value: string) => boolean",
    "onLockedPress?: (value: string) => void",
    "lockedLabelFor?: (value: string) => string",
    "isDone?: (value: string) => boolean",
    "showDoneCounts?: boolean",
    "headerExtras?: React.ReactNode",
    "PanResponder.create",
  ]) {
    assert.ok(source.includes(capability), `the picker must expose ${capability}`);
  }
  // Type icons go through the shared wrapper, so linkedin_post (a FontAwesome glyph)
  // is not asked of Feather.
  assert.ok(
    source.includes('import ConversionIcon from "@/components/ConversionIcon";'),
    "the picker must import the shared conversion icon wrapper",
  );
  assert.ok(
    source.includes("<ConversionIcon name={type.icon}"),
    "the picker must render type icons through ConversionIcon",
  );
});
