import assert from "node:assert/strict";
import test from "node:test";

import { shouldShowMiniBar } from "../../lib/active-recording-mini-bar";

test("hidden when the persistentRecording flag is off", () => {
  assert.equal(shouldShowMiniBar("recording", "files", false), false);
  assert.equal(shouldShowMiniBar("paused", undefined, false), false);
});

test("hidden when there is no active session", () => {
  for (const state of ["idle", "preparing", "discarded"] as const) {
    assert.equal(shouldShowMiniBar(state, "files", true), false);
  }
});

test("hidden while the user is on the Record screen", () => {
  assert.equal(shouldShowMiniBar("recording", "record", true), false);
  assert.equal(shouldShowMiniBar("paused", "record", true), false);
});

test("visible on every other route while recording or paused", () => {
  for (const state of ["recording", "paused"] as const) {
    assert.equal(shouldShowMiniBar(state, undefined, true), true);
    assert.equal(shouldShowMiniBar(state, "files", true), true);
    assert.equal(shouldShowMiniBar(state, "settings", true), true);
    assert.equal(shouldShowMiniBar(state, "recording", true), true);
  }
});

test("processing remains visible away from the Record screen", () => {
  assert.equal(shouldShowMiniBar("processing", "files", true), true);
});

test("completed bar is hidden on the exact recording it would open", () => {
  assert.equal(
    shouldShowMiniBar("completed", "recording", true, "recording-123", "recording-123"),
    false,
  );
});

test("completed bar remains available everywhere it can still navigate usefully", () => {
  assert.equal(
    shouldShowMiniBar("completed", "files", true, undefined, "recording-123"),
    true,
  );
  assert.equal(
    shouldShowMiniBar("completed", "recording", true, "recording-456", "recording-123"),
    true,
  );
  assert.equal(
    shouldShowMiniBar("completed", "thought-thread", true, "thread-123", "recording-123"),
    true,
  );
});
