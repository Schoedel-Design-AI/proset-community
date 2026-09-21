import express, { type Request, type Response } from "express";
import { createHash, randomUUID } from "node:crypto";
import { createWriteStream, promises as fsp } from "node:fs";
import * as path from "node:path";
import { pipeline } from "node:stream/promises";
import { z } from "zod";

import { requireAuth } from "../../auth";
import { getRequiredRouteUserId } from "../shared-utils";
import { storage } from "../../storage";
import { trackEvent } from "../../analytics-service";
import {
  createPresignedUploadUrl,
  deleteFile as deleteBucketObject,
  detectMimeType,
  downloadFileAsStream,
  getObjectSize,
  isBucketKeyOwnedByUser,
  uploadFile as bucketUploadFile,
} from "../../object-storage";
import { getBucketStorageUsed } from "../../bucket-routes";
import {
  checkTranscriptionLimit,
  deductTranscriptionTokens,
  getMaxMediaImportSeconds,
  getMaxMediaUploadSize,
  getStorageLimit,
  getUserTier,
} from "../../usage-service";
import { paragraphizeTranscript } from "@shared/transcript-format";
import { isMediaImportFileName, MEDIA_IMPORT_EXTENSIONS } from "@shared/plan-limits";
import {
  describeAudioUploadStorageReason,
  describeAudioUploadStorageRejection,
  evaluateAudioUploadStorage,
} from "./audio-upload-policy";
import {
  MediaIngestError,
  createWorkDir,
  prepareStoredAudio,
  probeMediaDuration,
  removeWorkDir,
  transcribeMediaFile,
} from "./media-ingest";

/**
 * Import an uploaded audio or video file as a new recording.
 *
 * Three steps, because the bytes never travel through this service:
 *   1. POST /media/upload-target — the server mints a URL for the client
 *   2. the client uploads straight to object storage
 *   3. POST /recordings/from-media — the server reads the object, extracts and
 *      normalises the audio, transcribes it, and keeps only the audio
 *
 * Step 1 and 2 exist because Cloud Run refuses HTTP/1 request bodies over
 * 32 MiB before application code runs. A 60-minute 16 kHz mono WAV is ~115 MB
 * and a lecture video is far larger, so proxying the upload through the API
 * would cap the feature at roughly 16 minutes and make video impossible.
 */

const router = express.Router();

/** Signed URL lifetime. Long enough for a slow phone upload, short enough to expire. */
const UPLOAD_URL_TTL_SECONDS = 1800;

/**
 * Raw-body ceiling for the local-filesystem storage provider only (development,
 * where there is no S3 endpoint to sign a URL for). The real ceiling for a
 * given plan comes from maxMediaUploadMB; this is the parser's backstop.
 */
const LOCAL_UPLOAD_PARSER_LIMIT = "2048mb";

const localMediaUpload = express.raw({ type: () => true, limit: LOCAL_UPLOAD_PARSER_LIMIT });

const fromMediaSchema = z.object({
  bucketKey: z.string().min(1).max(1024),
  fileName: z.string().max(512).optional(),
  language: z.string().max(16).optional(),
  title: z.string().max(300).optional(),
});

function videoExtensions(): string[] {
  return [".mp4", ".m4v", ".mov", ".webm", ".mkv", ".avi", ".wmv", ".flv", ".3gp", ".mpeg", ".mpg", ".ts"];
}

function isVideoFileName(fileName: string): boolean {
  const lower = fileName.trim().toLowerCase();
  const dot = lower.lastIndexOf(".");
  return dot >= 0 && videoExtensions().includes(lower.slice(dot));
}

function safeExtension(fileName: string): string {
  const ext = path.extname(fileName.trim()).toLowerCase();
  if (!/^\.[a-z0-9]{1,8}$/.test(ext)) return "";
  return ext;
}

/** A friendly default title from the uploaded file's own name. */
function deriveTitle(fileName: string): string {
  const base = path.basename(fileName.trim() || "").replace(/\.[a-z0-9]{1,8}$/i, "");
  const cleaned = base.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  if (!cleaned) return "Imported audio";
  return cleaned.length > 120 ? `${cleaned.slice(0, 117)}...` : cleaned;
}

function formatMinutes(seconds: number): string {
  const minutes = Math.max(1, Math.round(seconds / 60));
  return `${minutes} minute${minutes === 1 ? "" : "s"}`;
}

function mediaBucketKey(userId: string, fileName: string): string {
  return `users/${userId}/uploads/${randomUUID()}${safeExtension(fileName)}`;
}

async function streamObjectToFile(bucketKey: string, destination: string): Promise<void> {
  const source = await downloadFileAsStream(bucketKey);
  await pipeline(source, createWriteStream(destination));
}

/** Best-effort cleanup: a failed delete must never mask the real response. */
async function discardUpload(bucketKey: string, reason: string): Promise<void> {
  try {
    await deleteBucketObject(bucketKey);
  } catch (error) {
    console.warn(`[media-import] could not discard ${reason} upload ${bucketKey}:`, error);
  }
}

/**
 * Step 1: hand the client a place to put the bytes.
 *
 * Returns a presigned PUT when object storage is S3-compatible. With the local
 * filesystem provider (development) it returns this service's own upload route
 * instead, which carries the same request-size ceiling Cloud Run imposes — fine
 * locally, which is exactly why production must not rely on it.
 */
router.post("/media/upload-target", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = getRequiredRouteUserId(req);
    const fileName = typeof req.body?.fileName === "string" ? req.body.fileName.trim() : "";
    if (!fileName || !isMediaImportFileName(fileName)) {
      return res.status(400).json({
        error: "unsupported_media_type",
        message: "Upload an audio or video file.",
        allowedExtensions: MEDIA_IMPORT_EXTENSIONS,
      });
    }

    const maxBytes = await getMaxMediaUploadSize(userId);
    if (maxBytes <= 0) {
      // Mirrors the audio-upload gate's vocabulary so the client can show the
      // same "this plan does not include cloud storage" state.
      return res.status(403).json({
        error: "Storage limit exceeded",
        code: "storage_not_included",
        message: "Importing audio and video needs cloud storage, which this plan does not include.",
      });
    }

    const contentType = typeof req.body?.contentType === "string" && req.body.contentType.trim()
      ? req.body.contentType.trim()
      : detectMimeType(fileName);
    const bucketKey = mediaBucketKey(userId, fileName);
    const signedUrl = await createPresignedUploadUrl(bucketKey, contentType, UPLOAD_URL_TTL_SECONDS);

    if (signedUrl) {
      return res.json({
        mode: "signed",
        method: "PUT",
        url: signedUrl,
        headers: { "Content-Type": contentType },
        bucketKey,
        maxBytes,
        expiresInSeconds: UPLOAD_URL_TTL_SECONDS,
      });
    }

    return res.json({
      mode: "direct",
      method: "PUT",
      url: `/api/media/upload-direct?bucketKey=${encodeURIComponent(bucketKey)}`,
      headers: { "Content-Type": contentType },
      bucketKey,
      maxBytes,
    });
  } catch (error) {
    console.error("[media-import] upload target failed:", error);
    return res.status(500).json({ error: "We couldn't start that upload. Please try again." });
  }
});

/**
 * Local-provider upload target. Only reached when there is no S3-compatible
 * backend (development). Ownership is re-checked against the user's key prefix.
 */
router.put(
  "/media/upload-direct",
  requireAuth,
  localMediaUpload,
  async (req: Request, res: Response) => {
    try {
      const userId = getRequiredRouteUserId(req);
      const bucketKey = typeof req.query.bucketKey === "string" ? req.query.bucketKey : "";
      if (!isBucketKeyOwnedByUser(bucketKey, userId)) {
        return res.status(403).json({ error: "That upload target is not yours." });
      }
      const body = req.body as Buffer;
      if (!Buffer.isBuffer(body) || body.length === 0) {
        return res.status(400).json({ error: "No file data was received." });
      }
      const maxBytes = await getMaxMediaUploadSize(userId);
      if (maxBytes <= 0) {
        return res.status(403).json({ error: "Storage limit exceeded", code: "storage_not_included" });
      }
      if (body.length > maxBytes) {
        return res.status(413).json({
          error: "file_too_large",
          message: "That file is larger than your plan allows.",
          maxBytes,
          fileSize: body.length,
        });
      }
      await bucketUploadFile(bucketKey, body);
      return res.json({ ok: true, bucketKey, bytes: body.length });
    } catch (error) {
      console.error("[media-import] direct upload failed:", error);
      return res.status(500).json({ error: "We couldn't store that upload. Please try again." });
    }
  },
);

/**
 * Step 3: turn the uploaded object into a recording.
 *
 * The recording row is created only once the audio has been extracted and
 * stored, so anything the user can see always has playable audio, and the
 * existing playback, download, conversion and retry paths work on it unchanged.
 */
router.post("/recordings/from-media", requireAuth, async (req: Request, res: Response) => {
  const userId = getRequiredRouteUserId(req);
  const parsed = fromMediaSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_request", message: "A bucket key is required." });
  }

  const { bucketKey, language } = parsed.data;
  const fileName = parsed.data.fileName?.trim() || path.basename(bucketKey);

  if (!isBucketKeyOwnedByUser(bucketKey, userId)) {
    return res.status(403).json({ error: "not_your_upload", message: "That upload does not belong to this account." });
  }
  if (!isMediaImportFileName(fileName)) {
    return res.status(400).json({
      error: "unsupported_media_type",
      message: "Upload an audio or video file.",
      allowedExtensions: MEDIA_IMPORT_EXTENSIONS,
    });
  }

  const maxBytes = await getMaxMediaUploadSize(userId);
  if (maxBytes <= 0) {
    return res.status(403).json({
      error: "Storage limit exceeded",
      code: "storage_not_included",
      message: "Importing audio and video needs cloud storage, which this plan does not include.",
    });
  }

  const uploadedBytes = await getObjectSize(bucketKey);
  if (uploadedBytes == null) {
    return res.status(404).json({
      error: "upload_not_found",
      message: "We couldn't find that upload. Please try uploading the file again.",
    });
  }
  if (uploadedBytes > maxBytes) {
    await discardUpload(bucketKey, "oversized");
    return res.status(413).json({
      error: "file_too_large",
      message: "That file is larger than your plan allows. Try a shorter file, or upgrade for larger uploads.",
      maxBytes,
      fileSize: uploadedBytes,
    });
  }

  const workDir = await createWorkDir();
  try {
    const sourcePath = path.join(workDir, `source${safeExtension(fileName) || ".bin"}`);
    await streamObjectToFile(bucketKey, sourcePath);

    const durationSeconds = await probeMediaDuration(sourcePath);
    if (durationSeconds == null) {
      await discardUpload(bucketKey, "unreadable");
      return res.status(400).json({
        error: "unreadable_media",
        message: "We couldn't read any audio from that file. Check that it plays, then try again.",
      });
    }

    const maxSeconds = await getMaxMediaImportSeconds(userId);
    // One second of tolerance: containers round their duration, and a file
    // exactly at the limit must not be refused.
    if (durationSeconds > maxSeconds + 1) {
      await discardUpload(bucketKey, "too long");
      return res.status(413).json({
        error: "media_too_long",
        message:
          `That file is ${formatMinutes(durationSeconds)} long. Your plan transcribes up to ` +
          `${Math.round(maxSeconds / 60)} minutes at a time, so split it into shorter files and upload them one at a time.`,
        durationSeconds,
        maxSeconds,
      });
    }

    const limitCheck = await checkTranscriptionLimit(userId, durationSeconds);
    if (!limitCheck.allowed) {
      // The upload is deliberately KEPT: this is the one rejection the user can
      // clear without re-sending the bytes (by adding credits), and for a large
      // file that re-upload is the expensive part.
      return res.status(429).json({
        error: "insufficient_tokens",
        code: "insufficient_tokens",
        message: "You've used your monthly AI Credits. Upgrade for more credits — they reset each month.",
        cost: limitCheck.cost,
        limitType: "transcription",
        bucketKey,
      });
    }

    // Keep the normalised audio, not the original upload.
    const { storedAudioPath } = await prepareStoredAudio(sourcePath, workDir);
    const storedStat = await fsp.stat(storedAudioPath);

    const tier = await getUserTier(userId);
    const storageDecision = evaluateAudioUploadStorage({
      storageLimitBytes: await getStorageLimit(userId),
      usedBytes: await getBucketStorageUsed(userId),
      fileSizeBytes: storedStat.size,
    });
    if (storageDecision.reject && storageDecision.code) {
      const reason = describeAudioUploadStorageReason(storageDecision.code);
      console.warn(`[media-import] rejected (${reason}): ${JSON.stringify({ userId, bytes: storedStat.size })}`);
      await discardUpload(bucketKey, "storage-rejected");
      return res.status(413).json(
        describeAudioUploadStorageRejection(storageDecision.code, {
          storageLimitBytes: await getStorageLimit(userId),
          usedBytes: await getBucketStorageUsed(userId),
          fileSizeBytes: storedStat.size,
          tier,
        }),
      );
    }

    const recordingId = randomUUID();
    const storedKey = `users/${userId}/recordings/${recordingId}.m4a`;
    await bucketUploadFile(storedKey, await fsp.readFile(storedAudioPath));

    // The original upload is transient by design: only the normalised audio is kept.
    await discardUpload(bucketKey, "processed");

    const title = parsed.data.title?.trim() || deriveTitle(fileName);
    const recording = await storage.createRecording({
      id: recordingId,
      userId,
      title,
      duration: durationSeconds,
      audioUri: `bucket://${storedKey}`,
      transcript: "",
      transcriptRevision: 1,
      transcriptHash: createHash("sha256").update("").digest("hex"),
      transcriptUpdatedAt: null,
      conversions: [],
      needsUpload: false,
      uploadStatus: "uploaded",
      uploadErrorCode: null,
      uploadRetryable: null,
      isTranscribing: true,
      transcriptionStatus: "transcribing",
      transcriptionErrorCode: null,
      transcriptionError: null,
      transcriptionRetryable: null,
    });

    trackEvent("media_import_started", userId, {
      durationSeconds: Math.round(durationSeconds),
      isVideo: isVideoFileName(fileName),
      bytes: uploadedBytes,
    });

    try {
      const result = await transcribeMediaFile({
        sourcePath,
        fileName,
        durationSeconds,
        language,
        workDir,
      });
      const transcript = paragraphizeTranscript(result.text);

      await storage.updateRecording(recordingId, userId, {
        transcript,
        transcriptRevision: 1,
        transcriptHash: createHash("sha256").update(transcript).digest("hex"),
        transcriptUpdatedAt: new Date().toISOString(),
        isTranscribing: false,
        transcriptionStatus: "succeeded",
        transcriptionErrorCode: null,
        transcriptionError: null,
        transcriptionRetryable: null,
        transcriptionAttempts: 0,
        transcriptSource: "cloud",
      });
      await deductTranscriptionTokens(userId, durationSeconds);

      trackEvent("media_import_succeeded", userId, {
        durationSeconds: Math.round(durationSeconds),
        segments: result.segmentCount,
        providers: result.providers.join(","),
      });

      return res.status(201).json({
        recordingId,
        recording,
        transcript,
        durationSeconds,
        segmentCount: result.segmentCount,
        providers: result.providers,
      });
    } catch (transcriptionError) {
      // The recording and its audio survive, so the existing retry path can
      // pick it up: no credits were deducted, and nothing was lost.
      const ingestError = transcriptionError instanceof MediaIngestError ? transcriptionError : null;
      const message = ingestError
        ? ingestError.message
        : "We had trouble transcribing that file. Your audio is saved — try again when ready.";
      console.error("[media-import] transcription failed:", transcriptionError);

      await storage.updateRecording(recordingId, userId, {
        isTranscribing: false,
        transcriptionStatus: "failed",
        transcriptionErrorCode: ingestError?.code ?? "transcription_failed",
        transcriptionError: message,
        transcriptionRetryable: true,
        transcriptionAttempts: 1,
      });

      return res.status(502).json({
        error: ingestError?.code ?? "transcription_failed",
        message,
        recordingId,
        durationSeconds,
      });
    }
  } catch (error) {
    console.error("[media-import] failed:", error);
    await discardUpload(bucketKey, "failed");
    return res.status(500).json({ error: "We had trouble processing that file. Please try again." });
  } finally {
    await removeWorkDir(workDir);
  }
});

export default router;
