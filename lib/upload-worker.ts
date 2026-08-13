import { NativeModules, Platform } from "react-native";
import type { BackgroundUploadWorkStatus } from "@shared/recording-transfer";

interface UploadWorkerNative {
  enqueue(
    fileUri: string,
    uploadUrl: string,
    authToken: string,
    recordingId: string,
    autoTranscribe: boolean,
    language: string
  ): Promise<boolean>;
  cancel(recordingId: string): Promise<boolean>;
  getStatus(recordingId: string): Promise<BackgroundUploadWorkStatus | null>;
}

const NativeUploadWorker: UploadWorkerNative | undefined =
  Platform.OS === "android"
    ? (NativeModules as { UploadWorker?: UploadWorkerNative }).UploadWorker
    : undefined;

/**
 * Schedule a background upload via Android WorkManager.
 * The upload survives app backgrounding and process death.
 * Requires network connectivity — WorkManager waits until connected.
 */
export function enqueueBackgroundUpload(
  fileUri: string,
  uploadUrl: string,
  authToken: string,
  recordingId: string,
  autoTranscribe: boolean,
  language: string
): void {
  if (!NativeUploadWorker) {
    console.warn("[UploadWorker] Not available on this platform");
    return;
  }
  NativeUploadWorker.enqueue(fileUri, uploadUrl, authToken, recordingId, autoTranscribe, language).catch(
    (err) => console.error("[UploadWorker] Failed to enqueue:", err)
  );
}

/**
 * Cancel a pending background upload.
 */
export function cancelBackgroundUpload(recordingId: string): void {
  if (!NativeUploadWorker) return;
  NativeUploadWorker.cancel(recordingId).catch((err) =>
    console.error("[UploadWorker] Failed to cancel:", err)
  );
}

export async function getBackgroundUploadStatus(
  recordingId: string
): Promise<BackgroundUploadWorkStatus | null> {
  if (!NativeUploadWorker) return null;
  try {
    return await NativeUploadWorker.getStatus(recordingId);
  } catch (err) {
    console.warn("[UploadWorker] Failed to read local work status:", err);
    return null;
  }
}
