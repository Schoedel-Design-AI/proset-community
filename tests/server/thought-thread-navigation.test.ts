import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const nativeNavigation = read("lib/navigation.tsx");
const webNavigation = read("lib/navigation.web.tsx");
const recordScreen = read("app/record.tsx");
const detailScreen = read("app/recording/[id].tsx");
const recordingsScreen = read("app/recordings.tsx");
const thoughtThreadClient = read("lib/thought-threads.ts");
const thoughtThreadsListScreen = read("app/thought-threads.tsx");

test("Thought Thread list and detail routes are registered on web and Android", () => {
  for (const navigation of [nativeNavigation, webNavigation]) {
    assert.match(navigation, /import ThoughtThreadsScreen from "\.\.\/app\/thought-threads"/);
    assert.match(navigation, /import ThoughtThreadDetailScreen from "\.\.\/app\/thought-thread\/\[id\]"/);
    assert.match(navigation, /thought-threads/);
    assert.match(navigation, /thought-thread\/:id/);
  }
  assert.match(nativeNavigation, /name="thought-threads"/);
  assert.match(nativeNavigation, /name="thought-thread\/\[id\]"/);
});

test("multi-select creates a durable thread and recording detail can continue one", () => {
  assert.match(recordingsScreen, /createThoughtThread\(ids\)/);
  assert.match(recordingsScreen, /pathname: "\/thought-thread\/\[id\]"/);
  assert.match(detailScreen, /continueThoughtFromRecording\(recording\.id\)/);
  assert.match(detailScreen, /t\("thread\.continueThought"\)/);
  assert.match(detailScreen, /thoughtThreadChoices\.map/);
});

test("continuation recording attaches before returning and preserves a recovery marker", () => {
  assert.match(recordScreen, /addRecordingToThoughtThread\(params\.threadId, completionVersion\)/);
  assert.match(thoughtThreadClient, /@thought_thread_pending_attachments_v2/);
  assert.match(recordScreen, /enqueuePendingThoughtThreadAttachment/);
  assert.match(recordScreen, /pathname: "\/thought-thread\/\[id\]"/);
});

test("the upper-right Thought Thread initiation button creates a thread, guards re-entry, and surfaces failures visibly", () => {
  // The button must call the create-thread handler directly (not invoke it
  // eagerly during render) and navigate to the freshly created thread.
  assert.match(thoughtThreadsListScreen, /onPress=\{createEmpty\}/);
  assert.match(thoughtThreadsListScreen, /createThoughtThread\(\[\]\)/);
  assert.match(thoughtThreadsListScreen, /pathname: "\/thought-thread\/\[id\]"/);
  // Re-entrant taps while a request is already in flight must be ignored.
  assert.match(thoughtThreadsListScreen, /if \(creating\) return;/);
  assert.match(thoughtThreadsListScreen, /disabled=\{creating\}/);
  // A failure must never be silent: it has to surface through a platform
  // alert in addition to the inline banner, since the banner alone can be
  // missed above the fold of the scroll view.
  assert.match(thoughtThreadsListScreen, /alert\(message\)/);
  assert.match(thoughtThreadsListScreen, /Alert\.alert\(t\("common\.error"\), message\)/);
  // The button must give immediate pressed feedback rather than staying
  // visually static until the network request resolves.
  assert.match(thoughtThreadsListScreen, /pressed && styles\.pressed/);
});

test("cloud-shaped icon that isn't allowed to continue a thought sends the user to enable Cloud Sync instead of dead-ending", () => {
  // The recording detail screen's cloud icon (handleContinueThought) and the
  // recordings list's combine action (handleCombineSelected) must not leave
  // a gated tap as a silent no-op alert: both need an actionable path to
  // Settings → Integrations, and both must recover from a stale client-side
  // isCloudSyncEnabled flag by honoring the server's authoritative
  // cloud_sync_required error instead of surfacing it as a generic failure.
  for (const screen of [detailScreen, recordingsScreen]) {
    assert.match(screen, /isCloudSyncRequiredError\(error\)/);
    assert.match(screen, /promptCloudSyncRequired\(t, router\.push\)/);
  }
  assert.match(thoughtThreadClient, /export function promptCloudSyncRequired/);
  assert.match(thoughtThreadClient, /export function isCloudSyncRequiredError/);
  assert.match(thoughtThreadClient, /"\/settings\/integrations"/);
});
