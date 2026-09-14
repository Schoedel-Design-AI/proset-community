// Guard test for the /api/upload-audio storage gate.
//
// WHY THIS EXISTS
// The gate used to be a single boolean in the route with a single 413 response:
//
//     if (storageLimit === 0 || totalUsed + req.file.size > storageLimit) → 413
//     { error: "Storage limit exceeded", used, limit }
//
// Two unrelated conditions therefore produced an identical, unexplained
// rejection. `storageLimit === 0` means the plan includes no cloud storage at all
// (TIER_LIMITS.free.storageMb is 0, and getUserTier answers "free" when the user
// document or its entitlements cannot be read), so EVERY upload is refused
// regardless of size — the production signature was 413s on 19 KB, 1.06 MB and
// 1.29 MB bodies while a 9.4 MB upload succeeded the same week. The other branch
// is a genuine quota boundary.
//
// The client maps any non-auth 4xx to a non-retryable `upload_rejected`, so the
// distinction has to be authoritative on the server: the two cases now report
// different machine-readable codes, and the diagnostic log names the plan tier.

import assert from "node:assert/strict";
import test from "node:test";
import {
  describeAudioUploadStorageReason,
  describeAudioUploadStorageRejection,
  evaluateAudioUploadStorage,
} from "../../server/modules/recordings/audio-upload-policy";

const MB = 1024 * 1024;

test("a plan with no cloud storage is reported as not included, never as quota", () => {
  // TIER_LIMITS.free.storageMb === 0 → getStorageLimit returns 0 bytes.
  for (const fileSizeBytes of [0, 19_578, 1.29 * MB]) {
    const decision = evaluateAudioUploadStorage({
      storageLimitBytes: 0,
      usedBytes: 0,
      fileSizeBytes,
    });
    assert.equal(decision.reject, true);
    assert.equal(
      decision.code,
      "storage_not_included",
      `a 0-byte allowance must not be reported as a full quota (size ${fileSizeBytes})`,
    );
  }
});

test("a non-finite allowance is treated as no storage rather than as unlimited", () => {
  const decision = evaluateAudioUploadStorage({
    storageLimitBytes: Number.NaN,
    usedBytes: 0,
    fileSizeBytes: 1024,
  });
  assert.equal(decision.reject, true);
  assert.equal(decision.code, "storage_not_included");
});

test("exceeding the quota is reported as quota, not as a missing plan feature", () => {
  const decision = evaluateAudioUploadStorage({
    storageLimitBytes: 5 * 1024 * MB, // pro: 5 GB
    usedBytes: 5 * 1024 * MB - 1,
    fileSizeBytes: 2 * MB,
  });
  assert.equal(decision.reject, true);
  assert.equal(decision.code, "storage_quota_exceeded");
});

test("the boundary is unchanged: used + fileSize === limit is allowed", () => {
  const limit = 2048 * MB; // base: 2 GB
  assert.deepEqual(
    evaluateAudioUploadStorage({ storageLimitBytes: limit, usedBytes: limit - MB, fileSizeBytes: MB }),
    { reject: false, code: null },
  );
  assert.equal(
    evaluateAudioUploadStorage({ storageLimitBytes: limit, usedBytes: limit - MB, fileSizeBytes: MB + 1 })
      .code,
    "storage_quota_exceeded",
  );
});

test("an upload inside the allowance is accepted", () => {
  assert.deepEqual(
    evaluateAudioUploadStorage({ storageLimitBytes: 2048 * MB, usedBytes: 3 * MB, fileSizeBytes: 9.4 * MB }),
    { reject: false, code: null },
  );
});

test("negative or non-finite usage cannot manufacture a rejection", () => {
  assert.deepEqual(
    evaluateAudioUploadStorage({ storageLimitBytes: 2048 * MB, usedBytes: -5, fileSizeBytes: 1024 }),
    { reject: false, code: null },
  );
  assert.deepEqual(
    evaluateAudioUploadStorage({ storageLimitBytes: 2048 * MB, usedBytes: Number.NaN, fileSizeBytes: 1024 }),
    { reject: false, code: null },
  );
});

test("the 413 body keeps the historical wording and adds the machine-readable detail", () => {
  const notIncluded = describeAudioUploadStorageRejection("storage_not_included", {
    storageLimitBytes: 0,
    usedBytes: 0,
    fileSizeBytes: 19_578,
    tier: "free",
  });
  assert.equal(notIncluded.error, "Storage limit exceeded");
  assert.equal(notIncluded.code, "storage_not_included");
  assert.equal(notIncluded.tier, "free");
  assert.equal(notIncluded.limit, 0);
  assert.equal(notIncluded.used, 0);
  assert.equal(notIncluded.fileSize, 19_578);
  assert.match(String(notIncluded.message), /does not include cloud storage/);

  const quota = describeAudioUploadStorageRejection("storage_quota_exceeded", {
    storageLimitBytes: 2048 * MB,
    usedBytes: 2048 * MB,
    fileSizeBytes: 1024,
    tier: "base",
  });
  assert.equal(quota.error, "Storage limit exceeded");
  assert.equal(quota.code, "storage_quota_exceeded");
  assert.equal(quota.limit, 2048 * MB);
  assert.match(String(quota.message), /full/);
});

test("diagnostic reasons name the cause and the tier-resolution path", () => {
  assert.match(describeAudioUploadStorageReason("storage_not_included"), /no cloud storage/);
  assert.match(describeAudioUploadStorageReason("storage_quota_exceeded"), /full/);
  assert.notEqual(
    describeAudioUploadStorageReason("storage_not_included"),
    describeAudioUploadStorageReason("storage_quota_exceeded"),
  );
});
