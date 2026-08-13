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
