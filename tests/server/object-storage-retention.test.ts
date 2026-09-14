import assert from "node:assert/strict";
import test from "node:test";
import { isFeedbackImageKeyExpired } from "../../server/object-storage";

test("feedback image key expiry is driven by its date prefix", () => {
  const cutoff = "2025-09-04";
  // Older than the cutoff → expired.
  assert.equal(isFeedbackImageKeyExpired("feedback/2025-09-03/uuid1234.png", cutoff), true);
  assert.equal(isFeedbackImageKeyExpired("feedback/2024-01-01/uuid1234.jpg", cutoff), true);
  // Same day or newer → retained.
  assert.equal(isFeedbackImageKeyExpired("feedback/2025-09-04/uuid1234.png", cutoff), false);
  assert.equal(isFeedbackImageKeyExpired("feedback/2025-12-31/uuid1234.webp", cutoff), false);
});

test("non-feedback or malformed keys are never auto-deleted", () => {
  const cutoff = "2025-09-04";
  // Other namespaces are untouched.
  assert.equal(isFeedbackImageKeyExpired("users/u1/images/2024-01-01/x.png", cutoff), false);
  assert.equal(isFeedbackImageKeyExpired("audio/2024-01-01/rec.mp3", cutoff), false);
  // Malformed feedback keys (missing date, traversal, wrong ext) → not expired.
  assert.equal(isFeedbackImageKeyExpired("feedback/uuid1234.png", cutoff), false);
  assert.equal(isFeedbackImageKeyExpired("feedback/2025-09-03/../../secret.png", cutoff), false);
  assert.equal(isFeedbackImageKeyExpired("feedback/2025-09-03/uuid1234.exe", cutoff), false);
  assert.equal(isFeedbackImageKeyExpired("feedback/2025-02-29/uuid1234.png", cutoff), false);
  assert.equal(isFeedbackImageKeyExpired("feedback/2025-13-01/uuid1234.png", cutoff), false);
});
