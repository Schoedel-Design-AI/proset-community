import assert from "node:assert/strict";
import test from "node:test";

import { shouldPromptDiscardOnLeave } from "../../lib/record-navigation";

test("does not prompt when there is no active recording", () => {
  for (const state of ["idle", "preparing", "processing", "discarded"] as const) {
    assert.equal(shouldPromptDiscardOnLeave(state, false), false);
    assert.equal(shouldPromptDiscardOnLeave(state, true), false);
  }
});

test("prompts on leave with active recording when persistence is off", () => {
  assert.equal(shouldPromptDiscardOnLeave("recording", false), true);
  assert.equal(shouldPromptDiscardOnLeave("paused", false), true);
});

test("does not prompt on leave with active recording when persistence is on", () => {
  assert.equal(shouldPromptDiscardOnLeave("recording", true), false);
  assert.equal(shouldPromptDiscardOnLeave("paused", true), false);
});
