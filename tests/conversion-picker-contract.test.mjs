import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

/**
 * The Thought Thread page offers conversion types through a sheet, not a wall of chips.
 *
 * Barry, 2026-09-30: "this is way too many chips to have all in one place" — 44 chips
 * wrapped over eight rows, with the primary Convert action buried under them. The
 * replacement is the recording screen's picker pattern: one selector row that opens a
 * sheet with a search field, a Recents section, the core types grouped by complexity
 * and one section per pack.
 */
const read = (path) => readFileSync(path, "utf8");

const THREAD_SOURCES = [
  "app/thought-thread/[id].tsx",
  "scripts/ce-export/overrides/app/thought-thread/[id].tsx",
];

const PICKER = "components/ConversionTypePicker.tsx";

test("the page shows one selector instead of a chip wall", () => {
  for (const file of THREAD_SOURCES) {
    const source = read(file);
    assert.match(
      source,
      /import ConversionTypePicker from "@\/components\/ConversionTypePicker";/,
      `${file}: must import the picker`,
    );
    assert.match(
      source,
      /style=\{styles\.typeSelector\}/,
      `${file}: the conversion type is chosen from a single selector row`,
    );
    assert.equal(
      source.includes("styles.typeChip"),
      false,
      `${file}: the conversion-type chips must be gone, not merely hidden`,
    );
    assert.equal(
      source.includes("typeChip: {"),
      false,
      `${file}: the chip style must not linger unused`,
    );
    assert.match(
      source,
      /<ConversionTypePicker[\s\S]{0,400}types=\{availableTypes\}/,
      `${file}: the picker receives the already-offered list`,
    );
    assert.match(
      source,
      /onSelect=\{\(value\) => \{[\s\S]{0,200}recordRecentConversionType\(value\)/,
      `${file}: choosing a type records it as recent, shared with the recording screen`,
    );
    assert.match(
      source,
      /t\(`conversion\.\$\{selectedTypeEntry\.value\}`/,
      `${file}: the selector shows the localized type name`,
    );
  }
});

test("the picker sheet is searchable and grouped", () => {
  const source = read(PICKER);
  assert.match(source, /<TextInput[\s\S]{0,400}placeholder=\{t\("conversionPicker\.search"\)\}/, "the sheet must have a search field");
  assert.match(source, /t\("detail\.recentTypes"\)/, "the sheet must show recent types");
  assert.match(source, /CONVERSION_COMPLEXITY_GROUPS\.map/, "core types must be grouped by complexity");
  assert.match(source, /PACK_GROUPS\.map/, "each pack must get its own section");
  assert.match(source, /t\("conversionPicker\.empty", \{ query: query\.trim\(\) \}\)/, "a search with no match must say so");
  assert.match(source, /const needle = query\.trim\(\)\.toLowerCase\(\)/, "the query must actually filter");
  // Presentation only: access is decided by lib/conversion-availability, upstream.
  assert.equal(
    /from "@\/lib\/conversion-availability"/.test(source),
    false,
    "the picker must not re-derive availability; it presents the list it is given",
  );
});

test("the picker works on web", () => {
  // A Modal-based sheet is the app's pattern for this, and the icons it asks for must
  // exist in the web shim (checked by the shim sweep for this component's sources).
  const shimSweep = read("tests/lib/web-feather-shim-contract.test.ts");
  assert.match(
    shimSweep,
    /"components\/ConversionTypePicker\.tsx"/,
    "the picker must be in the web icon-shim sweep, or a missing icon renders blank on web",
  );
});
