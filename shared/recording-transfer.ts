export const RECORDING_UPLOAD_STATUSES = [
  "pending",
  "uploading",
  "uploaded",
  "failed",
] as const;

export type RecordingUploadStatus = (typeof RECORDING_UPLOAD_STATUSES)[number];

export const RECORDING_TRANSCRIPTION_STATUSES = [
  "idle",
  "queued",
  "transcribing",
  "succeeded",
  "failed",
] as const;

export type RecordingTranscriptionStatus =
  (typeof RECORDING_TRANSCRIPTION_STATUSES)[number];

export type RecordingTransferFields = {
  needsUpload?: boolean;
  uploadStatus?: RecordingUploadStatus;
  uploadErrorCode?: string | null;
  uploadRetryable?: boolean | null;
  isTranscribing?: boolean;
  transcriptionStatus?: RecordingTranscriptionStatus;
  transcriptionErrorCode?: string | null;
  transcriptionError?: string | null;
  transcriptionRetryable?: boolean | null;
};

export type BackgroundUploadWorkState =
  | "unknown"
  | "enqueued"
  | "running"
  | "blocked"
  | "succeeded"
  | "failed"
  | "cancelled";

export type BackgroundUploadWorkStatus = {
  state: BackgroundUploadWorkState;
  runAttemptCount: number;
  uploadStatus?: RecordingUploadStatus;
  errorCode?: string | null;
  retryable?: boolean | null;
};

const uploadStatuses = new Set<string>(RECORDING_UPLOAD_STATUSES);
const transcriptionStatuses = new Set<string>(RECORDING_TRANSCRIPTION_STATUSES);

function isUploadStatus(value: unknown): value is RecordingUploadStatus {
  return typeof value === "string" && uploadStatuses.has(value);
}

function isTranscriptionStatus(value: unknown): value is RecordingTranscriptionStatus {
  return typeof value === "string" && transcriptionStatuses.has(value);
}

function optionalString(value: unknown): string | null | undefined {
  if (value === null) return null;
  return typeof value === "string" ? value : undefined;
}

function optionalBoolean(value: unknown): boolean | null | undefined {
  if (value === null) return null;
  return typeof value === "boolean" ? value : undefined;
}

export function normalizeRecordingTransferFields(
  recording: Record<string, unknown>,
  audioUri: string,
): RecordingTransferFields {
  const explicitUploadStatus = isUploadStatus(recording.uploadStatus)
    ? recording.uploadStatus
    : undefined;
  const explicitTranscriptionStatus = isTranscriptionStatus(recording.transcriptionStatus)
    ? recording.transcriptionStatus
    : undefined;
  const explicitNeedsUpload = typeof recording.needsUpload === "boolean"
    ? recording.needsUpload
    : undefined;
  const localAudio = audioUri.startsWith("file://") || audioUri.startsWith("content://");
  const storedAudio = audioUri.startsWith("bucket://");
  const needsUpload = explicitNeedsUpload
    ?? (explicitUploadStatus
      ? explicitUploadStatus !== "uploaded"
      : localAudio);
  const uploadStatus = explicitUploadStatus
    ?? (storedAudio
      ? "uploaded"
      : needsUpload
        ? "pending"
        : undefined);
  const isTranscribing = typeof recording.isTranscribing === "boolean"
    ? recording.isTranscribing
    : explicitTranscriptionStatus === "queued" || explicitTranscriptionStatus === "transcribing";
  const transcript = typeof recording.transcript === "string" ? recording.transcript.trim() : "";
  const transcriptionStatus = explicitTranscriptionStatus
    ?? (transcript
      ? "succeeded"
      : isTranscribing
        ? "transcribing"
        : undefined);

  return {
    needsUpload,
    uploadStatus,
    uploadErrorCode: optionalString(recording.uploadErrorCode),
    uploadRetryable: optionalBoolean(recording.uploadRetryable),
    isTranscribing,
    transcriptionStatus,
    transcriptionErrorCode: optionalString(recording.transcriptionErrorCode),
    transcriptionError: optionalString(recording.transcriptionError),
    transcriptionRetryable: optionalBoolean(recording.transcriptionRetryable),
  };
}

export function getRecordingTransferMessageKey(
  errorCode: string | null | undefined,
): string | null {
  if (!errorCode) return null;
  const keys: Record<string, string> = {
    upload_auth_failed: "detail.uploadAuthFailed",
    upload_file_missing: "detail.uploadFileMissing",
    upload_rejected: "detail.uploadRejected",
    upload_retry_exhausted: "detail.uploadRetryExhausted",
    upload_failed: "detail.uploadFailed",
    pro_access_required: "detail.transcriptionProRequired",
    monthly_limit_reached: "detail.transcriptionLimitReached",
    spending_cap_reached: "detail.transcriptionSpendingCapReached",
    insufficient_tokens: "detail.transcriptionInsufficientTokens",
    transcription_no_speech: "detail.transcriptionNoSpeech",
    transcription_failed: "detail.transcriptionFailed",
  };
  return keys[errorCode] || "detail.uploadFailed";
}

export type RecordingTransferSnapshot = RecordingTransferFields & {
  audioUri?: string;
  transcript?: string;
};

export type RecordingTransferReconciliation = {
  updates: RecordingTransferSnapshot;
  continuePolling: boolean;
  terminal: boolean;
};

export function reconcileRecordingTransfer(
  remote: RecordingTransferSnapshot | null,
  work: BackgroundUploadWorkStatus | null,
  autoTranscribe: boolean,
): RecordingTransferReconciliation {
  // Durable server storage wins over a stale terminal WorkInfo. WorkManager can
  // fail after the upload completed (for example while requesting
  // transcription), and must never regress a bucket-backed recording to
  // "needs upload".
  if (remote?.audioUri?.startsWith("bucket://")) {
    const transcriptionInProgress =
      remote.transcriptionStatus === "queued"
      || remote.transcriptionStatus === "transcribing"
      || remote.isTranscribing === true;
    const transcriptionFailed = remote.transcriptionStatus === "failed";
    const transcriptionSucceeded =
      remote.transcriptionStatus === "succeeded"
      || Boolean(remote.transcript?.trim());
    const continuePolling =
      autoTranscribe
      && !transcriptionFailed
      && !transcriptionSucceeded
      && (transcriptionInProgress || remote.transcriptionStatus === undefined);

    return {
      updates: {
        ...remote,
        needsUpload: false,
        uploadStatus: "uploaded",
        uploadErrorCode: null,
        uploadRetryable: null,
        isTranscribing: continuePolling,
      },
      continuePolling,
      terminal: !continuePolling,
    };
  }

  if (remote?.uploadStatus === "failed") {
    return {
      updates: {
        ...remote,
        needsUpload: true,
        isTranscribing: false,
      },
      continuePolling: false,
      terminal: true,
    };
  }

  if (work?.state === "failed" || work?.state === "cancelled") {
    return {
      updates: {
        needsUpload: true,
        uploadStatus: "failed",
        uploadErrorCode: work.errorCode || "upload_failed",
        uploadRetryable: work.retryable ?? work.state === "failed",
        isTranscribing: false,
      },
      continuePolling: false,
      terminal: true,
    };
  }

  return {
    updates: remote || {},
    continuePolling: true,
    terminal: false,
  };
}
