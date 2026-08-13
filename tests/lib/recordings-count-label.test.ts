import assert from "node:assert/strict";
import test from "node:test";

import { getRecordingsCountKey } from "../../lib/recordings-count-label";

test("returns singular key for one recording", () => {
  assert.equal(getRecordingsCountKey(1), "recordings.count");
});

test("returns plural key for zero and many recordings", () => {
  assert.equal(getRecordingsCountKey(0), "recordings.countPlural");
  assert.equal(getRecordingsCountKey(20), "recordings.countPlural");
});
