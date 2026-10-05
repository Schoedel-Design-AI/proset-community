import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The Thought Thread page exists TWICE: the live screen and a Community Edition
 * override that the exporter copies over the assembled tree
 * (`scripts/ce-export/overrides/`). A fix applied only to the live file ships
 * broken in the CE, so both copies are asserted here.
 *
 * Two things are locked, both decided 2026-09-29:
 *
 *   1. The "Source" card is REMOVED. It was the conversion-source panel
 *      (token estimate, source counts, conversion strategy, missing-source
 *      warning), stripped to an empty container in b969b8a; it rendered a
 *      heading with no body unless a source recording had gone missing.
 *      Barry removed the card and the warning entirely.
 *   2. The title field WRAPS, because a single-line field scrolled a long
 *      title's first characters out of view (the reported "hought Thread").
 *
 * A third is locked from 2026-09-30:
 *
 *   3. The convert-options card is REMOVED ("Clarify first" switch plus a local
 *      Markdown / Plain text pair). The switch duplicated Preferences -> Clarify
 *      mode, and both conversions options are device preferences: clarify mode
 *      from lib/clarify-mode.ts and the output format from lib/output-format.ts
 *      (the recording screen's "Code block" switch). A local copy is what made
 *      this screen convert differently from a recording, so it must not come
 *      back.
 *
 * A removal is proven by ABSENCE, so these assertions check that the retired
 * fingerprints are gone, not merely that something else is present.
 */
const read = (path) => readFileSync(join(process.cwd(), path), "utf8");

const LIVE = "app/thought-thread/[id].tsx";
const CE_OVERRIDE = "scripts/ce-export/overrides/app/thought-thread/[id].tsx";
const I18N = "lib/i18n.tsx";

const live = read(LIVE);
const ce = read(CE_OVERRIDE);
const i18n = read(I18N);

const RETIRED_KEYS = [
  "thread.conversionSource",
  "thread.sourceMissing",
  "thread.sourceMissingOne",
  "thread.strategyDirect",
  "thread.strategyHierarchical",
  "thread.strategyBlocked",
  "thread.strategyChecking",
];

test("the Source card is gone from both copies, not just hidden", () => {
  for (const [label, source] of [["live", live], ["CE override", ce]]) {
    assert.equal(source.includes("styles.summaryCard"), false, `${label}: the card container must be gone`);
    assert.equal(source.includes("styles.summaryTop"), false, `${label}: the card header row must be gone`);
    assert.equal(source.includes("missingRecordingCount"), false, `${label}: the warning must be gone`);
    assert.equal(
      source.includes("summaryCard: {"),
      false,
      `${label}: the card style definition must be gone`,
    );
  }
});

test("the retired strings are gone from the shared dictionaries", () => {
  for (const key of RETIRED_KEYS) {
    assert.equal(
      i18n.includes(`"${key}"`),
      false,
      `${key} is still defined; a dead key in both languages is what this cleanup removed`,
    );
  }
});

test("the title field wraps in both copies", () => {
  for (const [label, source] of [["live", live], ["CE override", ce]]) {
    assert.equal(source.includes("titleFieldHeight"), true, `${label}: the web height state must exist`);
    assert.equal(
      /multiline/.test(source.slice(source.indexOf("value={titleDraft}"), source.indexOf("value={titleDraft}") + 800)),
      true,
      `${label}: the title field must be multiline`,
    );
  }
});

test("the two copies' title field never drift apart", () => {
  // The strongest parity assertion available: the control itself must be byte
  // identical in both files. If a genuine CE variant is ever needed here, this
  // failing test is the prompt to say so out loud rather than to delete it.
  const region = (source) => source.slice(source.indexOf("value={titleDraft}"), source.indexOf("/>", source.indexOf("value={titleDraft}")));
  assert.equal(region(live), region(ce));
  assert.ok(region(live).length > 200, "the extracted region must be the whole field, not an empty slice");
});

const RETIRED_CONVERT_KEYS = [
  "thread.askBefore",
  "thread.askBeforeHelp",
  "thread.markdown",
  "thread.plainText",
];

test("the convert-options card is gone from both copies, and its strings with it", () => {
  for (const [label, source] of [["live", live], ["CE override", ce]]) {
    for (const fingerprint of ["thread.askBefore", "thread.markdown", "thread.plainText", "styles.toggleRow"]) {
      assert.equal(
        source.includes(fingerprint),
        false,
        `${label}: ${fingerprint} is the removed card; a re-introduced local control is what this guards`,
      );
    }
    assert.equal(
      /useState<"markdown" \| "plaintext">/.test(source),
      false,
      `${label}: the screen must not keep its own output-format state`,
    );
  }
  for (const key of RETIRED_CONVERT_KEYS) {
    assert.equal(i18n.includes(`"${key}"`), false, `${key} is still defined in the dictionaries`);
  }
});

test("both copies convert the way a recording does: device preferences, not screen state", () => {
  for (const [label, source] of [["live", live], ["CE override", ce]]) {
    assert.match(
      source,
      /if \(clarifyMode !== "never"\) \{/,
      `${label}: the clarify step must follow the Clarify mode preference`,
    );
    assert.match(
      source,
      /const outputFormat = await readConversionOutputFormat\(\);/,
      `${label}: the output format must be read from the shared preference`,
    );
    assert.match(
      source,
      /import \{ readConversionOutputFormat \} from "@\/lib\/output-format";/,
      `${label}: the shared preference reader must be the source, not a local literal`,
    );
  }
  // The preference itself has one definition; a second copy of the storage key is
  // how the recording and thread screens drifted apart in the first place.
  const outputFormatLib = read("lib/output-format.ts");
  assert.match(outputFormatLib, /"@voicenote_use_markdown"/);
  for (const [label, source] of [["live", live], ["CE override", ce]]) {
    assert.equal(
      source.includes("@voicenote_use_markdown"),
      false,
      `${label}: the storage key belongs to lib/output-format.ts only`,
    );
  }
});

// Locked 2026-09-30: the Open / Ready / Archived selector became a badge plus one
// action. Only Archived was ever user-set (it moves the Thread out of the active
// list); Open is the default and Ready is written by the server when a conversion
// completes, so two of the three chips changed nothing when pressed.
test("the three-way status selector is gone, replaced by badges and a header menu", () => {
  for (const [label, source] of [["live", live], ["CE override", ce]]) {
    assert.equal(
      source.includes("styles.statusChip"),
      false,
      `${label}: a selectable status chip is the control this change removed`,
    );
    assert.equal(
      source.includes("statusChip: {"),
      false,
      `${label}: the chip style must not linger unused`,
    );
    assert.equal(
      source.includes("styles.statusAction"),
      false,
      `${label}: the row under the title must not carry an action (Barry, 2026-09-30: it took key real estate)`,
    );
    assert.match(
      source,
      /const isThreadArchived = detail\?\.thread\.status === "archived";/,
      `${label}: the menu reads the archived flag`,
    );
    assert.match(
      source,
      /updateThread\(\{ status: isThreadArchived \? "open" : "archived" \}\)/,
      `${label}: one action toggles archived and back to open`,
    );
    assert.match(
      source,
      /detail\.thread\.status === "ready" && detail\.thread\.lastConvertedAt/,
      `${label}: the ready badge is shown, not selected`,
    );
    assert.match(
      source,
      /thread\.convertedBadge", \{ date: formatDate\(String\(detail\.thread\.lastConvertedAt\), language\) \}/,
      `${label}: the badge reports when the conversion completed`,
    );
    assert.match(
      source,
      /<Feather name="archive" size=\{14\} color=\{Colors\.textSecondary\} \/>\s*\n\s*<Text style=\{styles\.statusBadgeText\}>\{t\("thread\.archivedBadge"\)\}<\/Text>/,
      `${label}: an archived thread says so on the page`,
    );
  }
  for (const key of ["thread.open", "thread.ready"]) {
    assert.equal(
      i18n.includes(`"${key}"`),
      false,
      `${key} is still defined; the labels for the removed chips must go with them`,
    );
  }
  for (const key of ["thread.archive", "thread.unarchive", "thread.convertedBadge", "thread.archivedBadge", "thread.actions"]) {
    assert.equal(i18n.includes(`"${key}"`), true, `${key} must exist in both dictionaries`);
  }
});

// Locked 2026-09-30: the thread-level actions moved into a header overflow menu.
// Before, Delete was a bare trash icon in the corner and Archive was a button in the
// row under the title — one mis-tap from a destructive action, and a rare action
// occupying prime space.
test("thread actions live in an anchored header menu", () => {
  for (const [label, source] of [["live", live], ["CE override", ce]]) {
    assert.match(
      source,
      /accessibilityLabel=\{t\("thread\.actions"\)\}/,
      `${label}: the header button must be labelled as the actions menu`,
    );
    assert.match(
      source,
      /<Feather name="more-vertical" size=\{20\} color=\{Colors\.text\} \/>/,
      `${label}: the corner shows an overflow icon, not the trash can`,
    );
    assert.match(
      source,
      /onLayout=\{\(event\) => setHeaderBottom\(event\.nativeEvent\.layout\.height\)\}/,
      `${label}: the menu is anchored to the measured header row`,
    );
    assert.match(
      source,
      /top: headerBottom \+ AVATAR_MENU_ANCHOR_GAP, right: contentColumnRightInset\(layout\)/,
      `${label}: anchored the same way the avatar menu is, insets included`,
    );
    assert.match(
      source,
      /onPress=\{\(\) => \{\s*\n\s*setShowThreadMenu\(false\);\s*\n\s*deleteThread\(\);/,
      `${label}: Delete is an entry in the menu`,
    );
    assert.equal(
      /style=\{styles\.iconButton\}\s*\n\s*accessibilityRole="button"\s*\n\s*accessibilityLabel=\{t\("thread\.delete"\)\}/.test(source),
      false,
      `${label}: the destructive action must not sit uncovered in the header`,
    );
  }
});
