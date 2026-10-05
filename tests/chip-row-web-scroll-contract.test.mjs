import assert from "node:assert/strict";
import test from "node:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * A horizontal ScrollView with hidden indicators is unreachable with a mouse.
 *
 * react-native-web renders it as an overflow container, so a vertical wheel
 * scrolls the page rather than the row, and `showsHorizontalScrollIndicator={false}`
 * removes the only other affordance: the scrollbar a mouse could drag. Barry,
 * 2026-09-30: "the conversion types are not scrollable on web with a mouse".
 *
 * components/ChipRow.tsx is the fix — horizontal scroll on native (drag with a
 * finger), wrapping chips on web (nothing to scroll, every option visible). The
 * sweep below keeps new instances from appearing silently: a file may only keep the
 * pattern if it is listed with a reason.
 */
const HIDDEN_INDICATOR_PATTERN = "showsHorizontalScrollIndicator={false}";

const ALLOWED = new Map([
  // The shared component's own native branch; on native a finger drag is the gesture
  // and the indicator is intentionally hidden.
  ["components/ChipRow.tsx", "the ChipRow implementation itself"],
  // Avatar pack tabs are scrolled into view through a measured ref
  // (packTabsViewW + scrollTo), so wrapping them needs its own design pass.
  ["app/settings/account.tsx", "avatar pack tabs scroll the active tab into view via a measured ref"],
  ["scripts/ce-export/overrides/app/settings/account.tsx", "CE copy of the avatar pack tabs"],
  // The Music Pack screen is gated off in the UI (no drawer row, no AI Configuration
  // card) while PROSET_MUSIC_PACK_ENABLED is parked.
  ["app/music.tsx", "reached only through the parked Music Pack"],
]);

function collectTsxFiles(root, found = []) {
  for (const entry of readdirSync(root)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const path = join(root, entry);
    if (statSync(path).isDirectory()) collectTsxFiles(path, found);
    else if (entry.endsWith(".tsx")) found.push(path);
  }
  return found;
}

test("no new horizontal chip row hides its indicator", () => {
  const offenders = collectTsxFiles("app")
    .concat(collectTsxFiles("components"), collectTsxFiles("scripts/ce-export/overrides"))
    .filter((path) => readFileSync(path, "utf8").includes(HIDDEN_INDICATOR_PATTERN))
    .filter((path) => !ALLOWED.has(path));

  assert.deepEqual(
    offenders,
    [],
    "These files hide a horizontal scrollbar, which leaves the row unreachable with a " +
      `mouse on web: ${offenders.join(", ")}. Use components/ChipRow.tsx, or add the file ` +
      "to ALLOWED in this test with the reason it must scroll.",
  );
});

const CHIP_ROW_SOURCES = [
  "app/thought-thread/[id].tsx",
  "scripts/ce-export/overrides/app/thought-thread/[id].tsx",
];

test("the Thought Thread chip rows go through ChipRow in both copies", () => {
  for (const file of CHIP_ROW_SOURCES) {
    const source = readFileSync(file, "utf8");
    assert.equal(
      source.includes(HIDDEN_INDICATOR_PATTERN),
      false,
      `${file}: the citation styles and relationship rows must not hide their indicators`,
    );
    assert.match(
      source,
      /import \{ ChipRow \} from "@\/components\/ChipRow";/,
      `${file}: ChipRow must be imported`,
    );
    assert.equal(
      (source.match(/<ChipRow /g) || []).length,
      3,
      `${file}: citation styles, context relationships and relationship targets use ChipRow; the conversion types moved to the picker sheet`,
    );
    assert.equal(
      (source.match(/<\/ChipRow>/g) || []).length,
      3,
      `${file}: every ChipRow must be closed`,
    );
  }
});

test("ChipRow wraps on web and scrolls on native", () => {
  const source = readFileSync("components/ChipRow.tsx", "utf8");
  assert.match(source, /Platform\.OS === "web"/, "ChipRow must branch on the platform");
  assert.match(source, /flexWrap: "wrap"/, "the web branch must wrap the chips");
  assert.match(
    source,
    /horizontal\n\s+showsHorizontalScrollIndicator=\{false\}/,
    "the native branch must stay a horizontal scroller",
  );
});
