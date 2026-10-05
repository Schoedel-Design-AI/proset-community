import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

/**
 * The unshipped-pack gate has two halves, and shipping only one is what produced the
 * reported defect: the server refused the Saint Pack's conversion types while the
 * Thought Thread page still offered them, because the page's own availability filter
 * short-circuited on `isSuperAdmin` before any module check.
 *
 * Both halves must stay in place:
 *   - server: UNSHIPPED_MODULES in server/usage-service.ts (tests/server/unshipped-modules-gate.test.ts)
 *   - client: lib/conversion-availability.ts, fed by /api/modules/self, which lists
 *     shipped modules only for every role.
 */
const read = (path) => readFileSync(path, "utf8");

const THREAD_SOURCES = [
  "app/thought-thread/[id].tsx",
  "scripts/ce-export/overrides/app/thought-thread/[id].tsx",
];

const RECORDING_SOURCES = [
  "app/recording/[id].tsx",
  "scripts/ce-export/overrides/app/recording/[id].tsx",
];

test("no screen decides conversion availability on its own", () => {
  for (const file of [...THREAD_SOURCES, ...RECORDING_SOURCES]) {
    const source = read(file);
    assert.equal(
      /isSuperAdmin\s*(?:=== true)?\s*\|\|/.test(source),
      false,
      `${file}: a super-admin short-circuit in a conversion filter is the bug that showed unshipped packs`,
    );
  }
  // The Thought Thread page lists the whole catalog, so it must go through the helper.
  // The recording screen filters the catalog per rendering section instead; its pack
  // sections are guarded by the shipped set (asserted in the last test).
  for (const file of THREAD_SOURCES) {
    assert.equal(
      /CONVERSION_TYPES\s*\.filter\(/.test(read(file)),
      false,
      `${file}: filtering the catalog directly skips the shipped check; use lib/conversion-availability`,
    );
  }
});

test("the Thought Thread page offers types through the shared helper, in both copies", () => {
  for (const file of THREAD_SOURCES) {
    const source = read(file);
    assert.match(
      source,
      /import \{ filterOfferedConversionTypes \} from "@\/lib\/conversion-availability";/,
      `${file}: must import the shared helper`,
    );
    assert.match(
      source,
      /filterOfferedConversionTypes\(CONVERSION_TYPES, \{/,
      `${file}: must filter the catalog through the helper`,
    );
    assert.match(
      source,
      /moduleStates: moduleData\?\.modules/,
      `${file}: the shipment signal is /api/modules/self`,
    );
  }
});

test("the recording convert menu cannot offer a pack that is not shipped", () => {
  for (const file of RECORDING_SOURCES) {
    const source = read(file);
    assert.match(
      source,
      /import \{ isConversionTypeOffered, listablePackModules, type ConversionAccess \} from "@\/lib\/conversion-availability";/,
      `${file}: must import the shared rule and the shared list`,
    );
    // The menu hands the picker only types whose module ships (or that have no module
    // at all), which is what the old inline pack-section guard used to do. The picker
    // then renders a section only when it has items.
    assert.match(
      source,
      /const listableModules = useMemo\(\(\) => listablePackModules\(conversionAccess\), \[conversionAccess\]\);/,
      `${file}: the listable packs come from the shared helper`,
    );
    assert.match(
      source,
      /const convertMenuTypes = useMemo\(\n\s+\(\) => CONVERSION_TYPES\.filter\(\(type\) => !type\.module \|\| listableModules\.has\(type\.module\)\),/,
      `${file}: the menu must list only shipped pack types`,
    );
    assert.equal(
      /PACK_GROUPS\.map/.test(source),
      false,
      `${file}: pack sections are the picker's job now`,
    );
    // An unanswered /api/modules/self must not read as "this account has no packs":
    // the screen has to say whether the endpoint answered.
    assert.match(
      source,
      /const \[moduleStatesLoaded, setModuleStatesLoaded\] = useState\(false\);/,
      `${file}: must track whether the module fetch answered`,
    );
    assert.match(
      source,
      /const conversionAccess: ConversionAccess = useMemo\(\n\s+\(\) => \(\{ tier: userTier,[^)]*moduleStatesLoaded[^)]*\}\),/,
      `${file}: the access object must carry that answer`,
    );
    assert.match(source, /setModuleStatesLoaded\(true\);/, `${file}: the success path records the answer`);
    assert.match(source, /setModuleStatesLoaded\(false\);/, `${file}: the failure path records that it did not`);
    assert.equal(
      /shippedModuleNames/.test(source),
      false,
      `${file}: the screen must not derive shipment itself — the shared helper owns that`,
    );
  }
  const picker = read("components/ConversionTypePicker.tsx");
  assert.match(
    picker,
    /\.filter\(\(pack\) => pack\.items\.length > 0\)/,
    "the picker must drop a pack section that has no items",
  );
});
