import assert from "node:assert/strict";
import test from "node:test";

import {
  getRecordingTransferMessageKey,
  normalizeRecordingTransferFields,
  reconcileRecordingTransfer,
} from "../../shared/recording-transfer";

test("explicit terminal upload state survives normalization of a local audio URI", () => {
  const normalized = normalizeRecordingTransferFields(
    {
      needsUpload: true,
      uploadStatus: "failed",
      uploadErrorCode: "upload_file_missing",
      uploadRetryable: false,
    },
    "file:///data/user/0/ms.aifor.app/files/recording.m4a",
  );

  assert.deepEqual(normalized, {
    needsUpload: true,
    uploadStatus: "failed",
    uploadErrorCode: "upload_file_missing",
    uploadRetryable: false,
    isTranscribing: false,
    transcriptionStatus: undefined,
    transcriptionErrorCode: undefined,
    transcriptionError: undefined,
    transcriptionRetryable: undefined,
  });
});

test("legacy recording URIs derive pending and uploaded states without overriding explicit state", () => {
  assert.equal(
    normalizeRecordingTransferFields({}, "file:///recording.m4a").uploadStatus,
    "pending",
  );
  assert.equal(
    normalizeRecordingTransferFields({}, "content://recording/1").uploadStatus,
    "pending",
  );
  assert.equal(
    normalizeRecordingTransferFields({}, "bucket://user/audio/recording.m4a").uploadStatus,
    "uploaded",
  );
});

test("local WorkManager failure terminates polling even when server reporting was unauthorized", () => {
  const result = reconcileRecordingTransfer(
    null,
    {
      state: "failed",
      runAttemptCount: 4,
      uploadStatus: "failed",
      errorCode: "upload_auth_failed",
      retryable: true,
    },
    true,
  );

  assert.equal(result.terminal, true);
  assert.equal(result.continuePolling, false);
  assert.deepEqual(result.updates, {
    needsUpload: true,
    uploadStatus: "failed",
    uploadErrorCode: "upload_auth_failed",
    uploadRetryable: true,
    isTranscribing: false,
  });
});

test("durably uploaded audio wins over a stale local WorkManager failure", () => {
  const result = reconcileRecordingTransfer(
    {
      audioUri: "bucket://user/audio/recording.m4a",
      uploadStatus: "uploaded",
      transcriptionStatus: "transcribing",
      isTranscribing: true,
    },
    {
      state: "failed",
      runAttemptCount: 4,
      uploadStatus: "failed",
      errorCode: "upload_retry_exhausted",
      retryable: true,
    },
    true,
  );

  assert.equal(result.updates.uploadStatus, "uploaded");
  assert.equal(result.updates.needsUpload, false);
  assert.equal(result.continuePolling, true);
  assert.equal(result.terminal, false);
});

test("uploaded audio keeps polling while server transcription is active", () => {
  const result = reconcileRecordingTransfer(
    {
      audioUri: "bucket://user/audio/recording.m4a",
      uploadStatus: "uploaded",
      transcriptionStatus: "transcribing",
      isTranscribing: true,
      transcript: "",
    },
    {
      state: "succeeded",
      runAttemptCount: 0,
      uploadStatus: "uploaded",
    },
    true,
  );

  assert.equal(result.terminal, false);
  assert.equal(result.continuePolling, true);
  assert.equal(result.updates.isTranscribing, true);
});

test("successful or failed server transcription terminates polling", () => {
  const succeeded = reconcileRecordingTransfer(
    {
      audioUri: "bucket://user/audio/recording.m4a",
      uploadStatus: "uploaded",
      transcriptionStatus: "succeeded",
      transcript: "Finished transcript",
    },
    null,
    true,
  );
  const failed = reconcileRecordingTransfer(
    {
      audioUri: "bucket://user/audio/recording.m4a",
      uploadStatus: "uploaded",
      transcriptionStatus: "failed",
      transcriptionErrorCode: "transcription_failed",
      transcriptionRetryable: true,
    },
    null,
    true,
  );

  assert.equal(succeeded.terminal, true);
  assert.equal(succeeded.continuePolling, false);
  assert.equal(failed.terminal, true);
  assert.equal(failed.continuePolling, false);
});

test("stable transfer error codes map to localization keys", () => {
  assert.equal(
    getRecordingTransferMessageKey("upload_auth_failed"),
    "detail.uploadAuthFailed",
  );
  assert.equal(
    getRecordingTransferMessageKey("transcription_failed"),
    "detail.transcriptionFailed",
  );
});
