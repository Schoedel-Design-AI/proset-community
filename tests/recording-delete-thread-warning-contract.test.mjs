import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * Deleting a note that a Thought Thread uses must say so first.
 *
 * This asserts the wiring, not the wording: the files that have to agree for the
 * warning to reach a user, in both the live app and the Community Edition build.
 * Every assertion here fails against the code as it was before the change
 * (verified by running these checks over the pre-change text from git), and all
 * of it is either "a call exists in this order" or "these two copies match" --
 * exactly the kind of claim that passes by accident if it is never falsified.
 */

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const LIVE = {
  list: "app/recordings.tsx",
  detail: "app/recording/[id].tsx",
  helper: "lib/thought-threads.ts",
  pure: "shared/recording-delete-warning.ts",
  router: "server/modules/thought-threads/router.ts",
};

const CE = {
  list: "scripts/ce-export/overrides/app/recordings.tsx",
  detail: "scripts/ce-export/overrides/app/recording/[id].tsx",
  router: "scripts/ce-export/overrides/server/modules/thought-threads/router.ts",
};

/**
 * The source between two markers. End markers are the next declaration that
 * follows, never a closing brace: these functions close with `}, [deps]);` or
 * with a brace at the top level, so brace-matching guesses slice too far and
 * then compare two different regions of the two files.
 */
const between = (source, startMarker, endMarker) => {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `expected to find ${startMarker}`);
  const end = source.indexOf(endMarker, start);
  assert.notEqual(end, -1, `expected to find ${endMarker} after ${startMarker}`);
  return source.slice(start, end);
};

const callSites = (source) => source.split("deleteThreadWarning(t, ").length - 1;

/** Used instead of assert.match for whole files: a failure prints this message, not 40KB of source. */
const has = (source, pattern, message) => assert.ok(pattern.test(source), message);

const HANDLE_DELETE = ["const handleDelete = async (id: string) => {", "\n  const handleCombineSelected"];
const HANDLE_BULK = ["const handleDeleteSelected = useCallback(async () => {", "\n  const handleTypeToConvert"];
const HANDLE_DETAIL = ["const handleDeleteRecording = async () => {", "\n  const handleBackPress"];
const USAGE_ROUTE = ['router.get("/thought-threads/using-recording"', "\n\nrouter.post("];

test("the live app asks before deleting, on both screens", () => {
  const list = read(LIVE.list);
  const detail = read(LIVE.detail);

  for (const [name, source] of [[LIVE.list, list], [LIVE.detail, detail]]) {
    has(
      source,
      /import \{[^}]*fetchRecordingThreadUsage[^}]*\} from "@\/lib\/thought-threads"/,
      `${name} must import the usage probe`,
    );
    has(
      source,
      /import \{[^}]*deleteThreadWarning[^}]*\} from "@\/lib\/thought-threads"/,
      `${name} must import the warning`,
    );
  }

  // One single-delete warning in the list, one bulk, one on the detail screen.
  assert.equal(callSites(list), 2, `${LIVE.list} must warn on both single and bulk delete`);
  assert.equal(callSites(detail), 1, `${LIVE.detail} must warn on delete`);
});

test("the probe runs before the confirmation, so the warning cannot arrive after the fact", () => {
  const list = read(LIVE.list);
  const detail = read(LIVE.detail);

  // The invariant is not "the probe is above deleteRecording" -- the bulk handler
  // DEFINES its delete callback above the probe, and only calls it from inside
  // the dialog. The rule that matters is that the answer is known before the
  // dialog that offers the delete is shown, so compare against the dialog.
  const DIALOG = 'if (Platform.OS === "web")';

  for (const [name, source, markers] of [
    [LIVE.list, list, HANDLE_DELETE],
    [LIVE.list, list, HANDLE_BULK],
    [LIVE.detail, detail, HANDLE_DETAIL],
  ]) {
    const handler = between(source, ...markers);
    const probe = handler.indexOf("fetchRecordingThreadUsage");
    const warning = handler.indexOf("deleteThreadWarning(t, ");
    const dialog = handler.indexOf(DIALOG);
    assert.notEqual(probe, -1, `${name}: ${markers[0]} must probe`);
    assert.notEqual(dialog, -1, `${name}: ${markers[0]} must have a confirmation dialog`);
    assert.ok(probe < dialog, `${name}: ${markers[0]} must probe before it asks to confirm`);
    assert.ok(warning < dialog, `${name}: ${markers[0]} must build the warning before it asks`);
  }
});

test("the probe cannot block a delete: it swallows every failure", () => {
  const probe = between(
    read(LIVE.helper),
    "export async function fetchRecordingThreadUsage(",
    "\n\n/**\n * The warning line for a delete",
  );
  assert.match(probe, /catch \{/, "the probe must catch its own failures");
  assert.match(probe, /return \{\};/, 'a failed probe must read as "no threads affected"');
  assert.doesNotMatch(
    probe,
    /throw/,
    "the probe must never throw, or a network failure would block deleting a note",
  );
});

test("the warning is decided by a module that react-native cannot poison", () => {
  const pure = read(LIVE.pure);
  assert.doesNotMatch(
    pure,
    /from "react-native"|@react-native-async-storage/,
    "the pure decision module must stay importable by the node test runner",
  );
  has(pure, /export function deleteThreadWarningCopy\(/, "the decision must live in the pure module");
});

test("the Community Edition build carries the same wiring", () => {
  assert.equal(
    between(read(LIVE.router), ...USAGE_ROUTE),
    between(read(CE.router), ...USAGE_ROUTE),
    "the usage route must be identical in the live router and the Community Edition override",
  );

  for (const [live, ce, markers] of [
    [LIVE.list, CE.list, HANDLE_DELETE],
    [LIVE.list, CE.list, HANDLE_BULK],
    [LIVE.detail, CE.detail, HANDLE_DETAIL],
  ]) {
    assert.equal(
      between(read(live), ...markers),
      between(read(ce), ...markers),
      `${markers[0]} must be identical in ${live} and ${ce} -- the Community Edition must not ship a delete that stays silent`,
    );
  }
});

test("the Community Edition imports the same helpers it calls", () => {
  for (const path of [CE.list, CE.detail]) {
    const source = read(path);
    has(
      source,
      /import \{[^}]*fetchRecordingThreadUsage[^}]*\} from "@\/lib\/thought-threads"/,
      `${path} must import the probe it calls`,
    );
    has(
      source,
      /import \{[^}]*deleteThreadWarning[^}]*\} from "@\/lib\/thought-threads"/,
      `${path} must import the warning it calls`,
    );
  }
});
