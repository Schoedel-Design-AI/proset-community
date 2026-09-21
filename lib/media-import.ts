import { Platform } from "react-native";

import { getApiUrl, getAuthHeaders } from "./query-client";
import { getDocumentAsync } from "./document-picker";

/**
 * Import an audio or video file as a new recording.
 *
 * The bytes do not travel through the API. A 60-minute 16 kHz WAV is ~115 MB
 * and a lecture video is larger still, while Cloud Run refuses HTTP/1 request
 * bodies over 32 MiB before application code runs. So the flow is:
 *
 *   1. POST /api/media/upload-target  → a place to put the bytes
 *   2. upload directly to that target (presigned URL in production)
 *   3. POST /api/recordings/from-media → the server extracts the audio,
 *      transcribes it, and returns the new recording
 *
 * Step 3 can take minutes on a long file, so callers should show progress
 * rather than a spinner, and the request timeout is generous.
 */

/** Web `accept` value / native MIME filter. Mirrored by the server's allow-list. */
export const MEDIA_PICKER_TYPES = [
  "audio/*",
  "video/*",
  ".mp3", ".m4a", ".aac", ".wav", ".flac", ".ogg", ".oga", ".opus", ".wma", ".amr", ".aiff",
  ".mp4", ".m4v", ".mov", ".webm", ".mkv", ".avi", ".wmv", ".flv", ".3gp", ".mpeg", ".mpg", ".ts",
];

export type MediaImportPhase = "picking" | "uploading" | "processing" | "done";

export type MediaImportProgress = {
  phase: MediaImportPhase;
  /** Upload percentage, 0-100, when the phase is "uploading". */
  percent?: number;
  fileName?: string;
};

export type MediaImportErrorCode =
  | "cancelled"
  | "unsupported_type"
  | "storage_not_included"
  | "file_too_large"
  | "media_too_long"
  | "insufficient_tokens"
  | "unreadable_media"
  | "upload_failed"
  | "processing_failed"
  | "network";

export class MediaImportError extends Error {
  readonly code: MediaImportErrorCode;
  /** Extra detail from the server, e.g. the plan's limit, for a richer message. */
  readonly detail: Record<string, unknown>;

  constructor(code: MediaImportErrorCode, message: string, detail: Record<string, unknown> = {}) {
    super(message);
    this.name = "MediaImportError";
    this.code = code;
    this.detail = detail;
  }
}

type UploadTarget = {
  mode: "signed" | "direct";
  method: string;
  url: string;
  headers: Record<string, string>;
  bucketKey: string;
  maxBytes: number;
};

export type ImportedMediaResult = {
  recordingId: string;
  title: string;
  transcript: string;
  durationSeconds: number;
  segmentCount: number;
  fileName: string;
};

/** Long files legitimately take minutes to transcribe; do not cut them off early. */
const INGEST_TIMEOUT_MS = 20 * 60 * 1000;
const TARGET_TIMEOUT_MS = 30 * 1000;

/**
 * `processing_failed`, `unreadable_media` and friends are the server's own
 * codes, passed through so the UI can say something specific.
 */
function errorFromResponse(status: number, body: any): MediaImportError {
  const detail = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const serverError = typeof detail.error === "string" ? detail.error : "";

  switch (serverError) {
    case "storage_not_included":
      return new MediaImportError("storage_not_included", "This plan does not include cloud storage.", detail);
    case "file_too_large":
      return new MediaImportError("file_too_large", "That file is larger than your plan allows.", detail);
    case "media_too_long":
      return new MediaImportError("media_too_long", "That file is longer than your plan allows.", detail);
    case "insufficient_tokens":
      return new MediaImportError("insufficient_tokens", "Your monthly AI Credits are used up.", detail);
    case "unreadable_media":
      return new MediaImportError("unreadable_media", "No audio could be read from that file.", detail);
    case "unsupported_media_type":
      return new MediaImportError("unsupported_type", "That file type is not supported.", detail);
    default:
      break;
  }

  if (status === 413) {
    return new MediaImportError("file_too_large", "That file is larger than your plan allows.", detail);
  }
  if (status === 429) {
    return new MediaImportError("insufficient_tokens", "Your monthly AI Credits are used up.", detail);
  }
  return new MediaImportError("processing_failed", "We had trouble processing that file.", detail);
}

async function readJson(response: Response): Promise<any> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

/** Ask the user for a file. Returns null when they cancel. */
export async function pickMediaFile(): Promise<{ uri: string; name: string; mimeType: string } | null> {
  const result = await getDocumentAsync({
    type: MEDIA_PICKER_TYPES,
    copyToCacheDirectory: true,
  });
  if (result.canceled || !result.assets?.length) return null;
  const asset = result.assets[0];
  return {
    uri: asset.uri,
    name: asset.name || "audio",
    mimeType: asset.mimeType || "",
  };
}

async function requestUploadTarget(
  fileName: string,
  contentType: string,
): Promise<UploadTarget> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TARGET_TIMEOUT_MS);
  try {
    const response = await fetch(new URL("/api/media/upload-target", getApiUrl()).toString(), {
      method: "POST",
      credentials: "include",
      headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ fileName, contentType }),
      signal: controller.signal,
    });
    const body = await readJson(response);
    if (!response.ok) throw errorFromResponse(response.status, body);
    return body as UploadTarget;
  } catch (error) {
    if (error instanceof MediaImportError) throw error;
    throw new MediaImportError("network", "Couldn't reach the server to start the upload.");
  } finally {
    clearTimeout(timeout);
  }
}

/** A Blob for the picked asset, or null when the platform cannot produce one. */
async function readAssetBlob(uri: string): Promise<Blob | null> {
  try {
    const response = await fetch(uri);
    if (!response.ok) return null;
    return await response.blob();
  } catch {
    return null;
  }
}

/**
 * Upload with progress. XHR rather than fetch because upload progress events
 * are the only way to show a real percentage for a large file.
 */
function putWithProgress(
  url: string,
  body: Blob,
  headers: Record<string, string>,
  onProgress?: (percent: number) => void,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url, true);
    for (const [key, value] of Object.entries(headers)) {
      xhr.setRequestHeader(key, value);
    }
    if (xhr.upload && onProgress) {
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable && event.total > 0) {
          onProgress(Math.min(100, Math.round((event.loaded / event.total) * 100)));
        }
      };
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new MediaImportError("upload_failed", `Upload failed (${xhr.status}).`));
    };
    xhr.onerror = () => reject(new MediaImportError("upload_failed", "The upload did not complete."));
    xhr.onabort = () => reject(new MediaImportError("upload_failed", "The upload was interrupted."));
    xhr.send(body);
  });
}

/** Fallback for platforms that cannot hand us a Blob: stream through the API. */
async function putViaApi(
  target: UploadTarget,
  assetUri: string,
  fileSizeBytes: number | undefined,
  onProgress?: (percent: number) => void,
): Promise<void> {
  // The API route is a single request, so it carries the same 32 MiB ceiling
  // Cloud Run imposes (about 16 minutes of 16 kHz mono WAV). Refuse locally
  // with a clear reason instead of letting the server reject an opaque 413.
  const DIRECT_UPLOAD_CEILING_BYTES = 24 * 1024 * 1024;
  if (fileSizeBytes && fileSizeBytes > DIRECT_UPLOAD_CEILING_BYTES) {
    throw new MediaImportError(
      "file_too_large",
      "This device can only upload smaller files directly; try a shorter file.",
      { directCeilingBytes: DIRECT_UPLOAD_CEILING_BYTES, fileSizeBytes },
    );
  }

  const blob = await readAssetBlob(assetUri);
  if (!blob) {
    throw new MediaImportError("upload_failed", "This file couldn't be read for upload.");
  }
  if (blob.size > DIRECT_UPLOAD_CEILING_BYTES) {
    throw new MediaImportError("file_too_large", "This file is too large to upload from this device.", {
      directCeilingBytes: DIRECT_UPLOAD_CEILING_BYTES,
      fileSizeBytes: blob.size,
    });
  }
  await putWithProgress(target.url, blob, target.headers, onProgress);
}

/**
 * Pick a file and import it. Resolves with the created recording, or throws a
 * MediaImportError carrying a code the UI can translate.
 */
export async function importMediaFromFile(options: {
  language?: string;
  onProgress?: (progress: MediaImportProgress) => void;
} = {}): Promise<ImportedMediaResult> {
  const { language, onProgress } = options;

  onProgress?.({ phase: "picking" });
  const picked = await pickMediaFile();
  if (!picked) throw new MediaImportError("cancelled", "No file was chosen.");

  const contentType = picked.mimeType || undefined;
  const target = await requestUploadTarget(picked.name, contentType ?? "");

  onProgress?.({ phase: "uploading", percent: 0, fileName: picked.name });

  const reportPercent = (percent: number) =>
    onProgress?.({ phase: "uploading", percent, fileName: picked.name });

  if (target.mode === "signed") {
    const blob = await readAssetBlob(picked.uri);
    if (blob) {
      await putWithProgress(target.url, blob, target.headers, reportPercent);
    } else {
      // Some native pickers hand back a file path rather than a readable blob.
      await putViaApi(target, picked.uri, undefined, reportPercent);
    }
  } else {
    await putViaApi(target, picked.uri, undefined, reportPercent);
  }

  onProgress?.({ phase: "processing", fileName: picked.name });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), INGEST_TIMEOUT_MS);
  try {
    const response = await fetch(new URL("/api/recordings/from-media", getApiUrl()).toString(), {
      method: "POST",
      credentials: "include",
      headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({
        bucketKey: target.bucketKey,
        fileName: picked.name,
        language,
      }),
      signal: controller.signal,
    });
    const body = await readJson(response);
    if (!response.ok) throw errorFromResponse(response.status, body);

    onProgress?.({ phase: "done", fileName: picked.name });
    return {
      recordingId: String(body.recordingId ?? ""),
      title: String(body.recording?.title ?? picked.name),
      transcript: String(body.transcript ?? ""),
      durationSeconds: Number(body.durationSeconds ?? 0),
      segmentCount: Number(body.segmentCount ?? 1),
      fileName: picked.name,
    };
  } catch (error) {
    if (error instanceof MediaImportError) throw error;
    throw new MediaImportError(
      "processing_failed",
      "We had trouble processing that file. Please try again.",
    );
  } finally {
    clearTimeout(timeout);
  }
}

/** True when the platform is likely to hand back a readable Blob (web always does). */
export function supportsSignedUpload(): boolean {
  return Platform.OS === "web";
}
