import express, { type Request, type Response } from "express";
import { createHash, randomUUID } from "node:crypto";
import multer from "multer";
import { z } from "zod";
import { storage } from "../../storage";
import { requireAuth } from "../../auth";
import { getRequiredRouteUserId, getRouteParam } from "../shared-utils";
import { trackEvent } from "../../analytics-service";
import { backupRecordingFiles } from "../../backup-service";
import {
  checkTranscriptionLimit,
  deductTranscriptionTokens,
  getAllowedFileTypes,
  getMaxFileImportSize,
  getUserUsageSummary,
  getStorageLimit,
  getRequiredTierForFileType,
} from "../../usage-service";
import { normalizeRevenueCatEntitlements } from "@shared/revenuecat-catalog";
import {
  ensureSystemFolders,
  getTotalUserStorageUsed,
  getUserStorageUsed,
  autoSaveFile,
  autoSaveRecordingFiles,
  COMBINED_FOLDER_NAME
} from "./utils";
import { uploadFile as bucketUploadFile, downloadFile as bucketDownloadFile, deleteFile as deleteBucketObject, fromBucketUri, generateBucketKey, detectMimeType, toBucketUri, createBucketFileRecord, categoryFromMime, deleteBucketFileRecord, getBucketFileByKey } from "../../object-storage";
import { getBucketStorageUsed } from "../../bucket-routes";
import { createOpenAIClient, getChatCompletionTokenOptions } from "../../openai-client";
import { DOCUMENT_PARSER_VERSION, extractDocumentText } from "../../document-parser";
import { invalidateThoughtThreadsForRecording } from "../thought-threads/service";
import {
  getTranscriptionRoutes,
  getTranscriptionTotalTimeoutMs,
  transcribeAudioLatencyFirst,
} from "../../transcription-routing";
import { detectSilence, estimateAudioDurationSeconds } from "../../audio-silence";
import { paragraphizeTranscript } from "@shared/transcript-format";

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 500 * 1024 * 1024 } });
// The route performs the user's tier-aware 25 MB/50 MB check after Multer.
const docUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

// When the transcribe route is called right after an upload, the bucket URI
// write may not be visible yet (Firestore eventual consistency). Wait up to
// 10 x 500ms before answering 409 so callers that do not retry (older native
// workers) don't strand recordings in "queued".
const TRANSCRIBE_URI_WAIT_ATTEMPTS = 10;
const TRANSCRIBE_URI_WAIT_DELAY_MS = 500;

function transcriptRevisionUpdates(
  current: { transcript?: string; transcriptRevision?: number },
  transcript: string,
) {
  return {
    transcript,
    transcriptRevision: (current.transcriptRevision || 1) + 1,
    transcriptHash: createHash("sha256").update(transcript).digest("hex"),
    transcriptUpdatedAt: new Date().toISOString(),
  };
}

async function requireRecordingContextCloudSync(
  userId: string,
  res: Response,
): Promise<boolean> {
  const user = await storage.users.get(userId);
  const revenueCatEntitlements = normalizeRevenueCatEntitlements(
    user?.revenueCatEntitlements,
  );
  if (
    user?.cloudSyncEnabled === 1
    || revenueCatEntitlements.includes("cloud-sync")
    || revenueCatEntitlements.includes("pro")
  ) return true;
  res.status(403).json({
    error: "cloud_sync_required",
    message: "Enable Cloud Sync to retain recording context across devices. Local context can still be used for a conversion without changing the transcript.",
  });
  return false;
}

async function transcribeWithFallback(
  fileBuffer: Buffer,
  fileName: string,
  language?: string,
  prompt?: string,
): Promise<string> {
  const result = await transcribeAudioLatencyFirst({
    fileBuffer,
    fileName,
    language,
    prompt,
  });
  console.log(
    `[transcribe] Winner: ${result.provider} (${result.model}) in ${result.elapsedMs}ms`,
  );
  return result.text;
}

// --- Recordings ---

router.get("/recordings", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = getRequiredRouteUserId(req);
    const page = req.query.page ? parseInt(req.query.page as string, 10) : undefined;
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
    const search = req.query.search as string | undefined;

    if (page || limit || search) {
      const pageNum = page || 1;
      const limitNum = Math.min(limit || 50, 100);
      const result = await storage.getRecordingsByUserPaginated(userId, { page: pageNum, limit: limitNum, search });
      res.json({
        recordings: result.recordings,
        total: result.total,
        page: pageNum,
        limit: limitNum,
        hasMore: pageNum * limitNum < result.total,
      });
    } else {
      const recs = await storage.getRecordingsByUser(userId);
      res.json({ recordings: recs, total: recs.length });
    }
  } catch (error: any) {
    console.error("List recordings error:", error);
    res.status(500).json({ error: "We had trouble loading your recordings. Please try again." });
  }
});

router.post("/recordings", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = getRequiredRouteUserId(req);

    const { id, title, duration, audioUri, transcript, conversions, createdAt } = req.body;

    if (!id || !title) {
      return res.status(400).json({ error: "A title is needed to save this recording." });
    }

    if (typeof audioUri === "string" && audioUri.startsWith("blob:")) {
      return res.status(400).json({ error: "This recording audio was not uploaded to the server. Please record again or upload the audio before saving." });
    }

    const durationSeconds = Number(duration || 0);
    if (!Number.isFinite(durationSeconds) || durationSeconds < 0) {
      return res.status(400).json({ error: "Recording duration must be a non-negative number." });
    }

    const hasStoredAudio = typeof audioUri === "string" && audioUri.startsWith("bucket://");
    const needsAudioUpload = typeof audioUri === "string"
      && (audioUri.startsWith("file://") || audioUri.startsWith("content://"));
    const rec = await storage.createRecording({
      id,
      userId,
      title,
      duration: durationSeconds,
      audioUri: audioUri || "",
      transcript: transcript || "",
      transcriptRevision: 1,
      transcriptHash: createHash("sha256").update(transcript || "").digest("hex"),
      transcriptUpdatedAt: transcript ? new Date().toISOString() : null,
      conversions: conversions || [],
      needsUpload: needsAudioUpload,
      uploadStatus: hasStoredAudio ? "uploaded" : needsAudioUpload ? "pending" : undefined,
      uploadErrorCode: null,
      uploadRetryable: null,
      isTranscribing: false,
      transcriptionStatus: transcript ? "succeeded" : "idle",
      transcriptionErrorCode: null,
      transcriptionError: null,
      transcriptionRetryable: null,
    });

    trackEvent('recording_created', userId, { duration: duration || 0, hasTranscript: !!transcript });
    res.status(201).json(rec);

    const backupTypes: ("audio" | "transcript" | "conversion")[] = [];
    if (audioUri) backupTypes.push("audio");
    if (transcript) backupTypes.push("transcript");
    if (conversions && conversions.length > 0) backupTypes.push("conversion");
    if (backupTypes.length > 0) {
      backupRecordingFiles(userId, rec, backupTypes).catch((err) =>
        console.error("Auto-backup after create failed:", err)
      );
    }
  } catch (error: any) {
    console.error("Create recording error:", error);
    res.status(500).json({ error: "We had trouble saving your recording. Please try again." });
  }
});

router.get("/recordings/:id", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = getRequiredRouteUserId(req);
    const id = req.params.id as string;

    const rec = await storage.getRecording(id, userId);
    if (!rec) {
      return res.status(404).json({ error: "We couldn't find that recording. It may have been deleted." });
    }

    res.json(rec);
  } catch (error: any) {
    console.error("Get recording error:", error);
    res.status(500).json({ error: "We had trouble loading that recording. Please try again." });
  }
});

router.put("/recordings/:id", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = getRequiredRouteUserId(req);

    const id = req.params.id as string;
    const existing = await storage.getRecording(id, userId);
    if (!existing) {
      return res.status(404).json({ error: "We couldn't find that recording. It may have been deleted." });
    }
    const updates = {
      ...req.body,
      ...(typeof req.body?.transcript === "string"
        && req.body.transcript !== existing.transcript
        ? transcriptRevisionUpdates(existing, req.body.transcript)
        : {}),
    };

    const rec = await storage.updateRecording(id, userId, updates);
    if (!rec) {
      return res.status(404).json({ error: "We couldn't find that recording. It may have been deleted." });
    }

    res.json(rec);

    if (updates.transcript !== undefined && updates.transcript !== existing.transcript) {
      await invalidateThoughtThreadsForRecording(id, userId, rec);
    }

    const backupTypes: ("audio" | "transcript" | "conversion")[] = [];
    if (updates.transcript !== undefined) backupTypes.push("transcript");
    if (updates.conversions !== undefined) backupTypes.push("conversion");
    if (backupTypes.length > 0) {
      backupRecordingFiles(userId, rec, backupTypes).catch((err) =>
        console.error("Auto-backup after update failed:", err)
      );
    }
  } catch (error: any) {
    console.error("Update recording error:", error);
    res.status(500).json({ error: "We had trouble updating your recording. Please try again." });
  }
});

router.delete("/recordings/:id", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = getRequiredRouteUserId(req);
    const id = req.params.id as string;

    const recording = await storage.getRecording(id, userId);
    if (!recording) {
      return res.status(404).json({ error: "We couldn't find that recording. It may have been deleted." });
    }

    const recordingContexts = await storage.recordingContexts.getByRecording(id, userId);
    for (const context of recordingContexts) {
      if (context.sourceBucketFileId) {
        await deleteBucketFileRecord(context.sourceBucketFileId, userId);
      }
      await storage.recordingContexts.delete(context.id, id, userId);
    }

    if (recording.audioUri?.startsWith("bucket://")) {
      const bucketKey = fromBucketUri(recording.audioUri);
      const bucketRecord = await getBucketFileByKey(bucketKey);
      if (bucketRecord) {
        await deleteBucketFileRecord(bucketRecord.id, userId);
      }
    }

    const deleted = await storage.deleteRecording(id, userId);
    if (!deleted) {
      return res.status(404).json({ error: "We couldn't find that recording. It may have been deleted." });
    }
    await invalidateThoughtThreadsForRecording(id, userId, null);

    res.json({ ok: true });
  } catch (error: any) {
    console.error("Delete recording error:", error);
    res.status(500).json({ error: "We had trouble deleting that recording. Please try again." });
  }
});

router.get("/recordings/:id/contexts", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = getRequiredRouteUserId(req);
    if (!await requireRecordingContextCloudSync(userId, res)) return;
    const recordingId = getRouteParam(req.params.id, "id");
    if (!await storage.recordings.get(recordingId, userId)) {
      return res.status(404).json({ error: "Recording not found." });
    }
    const contexts = await storage.recordingContexts.getByRecording(recordingId, userId);
    return res.json({ contexts });
  } catch (error: any) {
    return res.status(500).json({ error: error.message || "We had trouble loading conversion context." });
  }
});

router.put("/recordings/:id/contexts/text", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = getRequiredRouteUserId(req);
    if (!await requireRecordingContextCloudSync(userId, res)) return;
    const recordingId = getRouteParam(req.params.id, "id");
    if (!await storage.recordings.get(recordingId, userId)) {
      return res.status(404).json({ error: "Recording not found." });
    }
    const text = String(req.body?.text || "").trim();
    if (text.length > 10_000 || Buffer.byteLength(text, "utf8") > 40_000) {
      return res.status(413).json({ error: "Conversion context is too large." });
    }
    const id = `recording_context_text_${recordingId}`;
    const existing = await storage.recordingContexts.get(id, recordingId, userId);
    if (!text) {
      if (existing) await storage.recordingContexts.delete(id, recordingId, userId);
      return res.json({ context: null });
    }
    const now = new Date().toISOString();
    const context = await storage.recordingContexts.upsert({
      id,
      userId,
      recordingId,
      kind: "text",
      label: "Additional context",
      text,
      revision: (existing?.revision || 0) + 1,
      derivedTextHash: createHash("sha256").update(text).digest("hex"),
      originalFilename: null,
      sourceMimeType: null,
      sourceFileSize: null,
      sourceHash: null,
      parserVersion: null,
      contentEdited: false,
      sourceBucketFileId: null,
      originalUnavailable: false,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    });
    return res.json({ context });
  } catch (error: any) {
    return res.status(500).json({ error: error.message || "We had trouble saving conversion context." });
  }
});

router.post("/recordings/:id/contexts/legacy-file", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = getRequiredRouteUserId(req);
    if (!await requireRecordingContextCloudSync(userId, res)) return;
    const recordingId = getRouteParam(req.params.id, "id");
    if (!await storage.recordings.get(recordingId, userId)) {
      return res.status(404).json({ error: "Recording not found." });
    }
    const input = z.object({
      migrationId: z.string().trim().min(1).max(200),
      label: z.string().trim().min(1).max(240),
      text: z.string().trim().min(1).max(700_000),
    }).parse(req.body);
    if (Buffer.byteLength(input.text, "utf8") > 700_000) {
      return res.status(413).json({ error: "Extracted file context is too large." });
    }
    const id = `recording_context_legacy_${createHash("sha256")
      .update(`${recordingId}:${input.migrationId}`)
      .digest("hex")
      .slice(0, 32)}`;
    const existing = await storage.recordingContexts.get(id, recordingId, userId);
    if (existing) return res.json({ context: existing });
    const now = new Date().toISOString();
    const context = await storage.recordingContexts.upsert({
      id,
      userId,
      recordingId,
      kind: "file",
      label: input.label,
      text: input.text,
      revision: 1,
      derivedTextHash: createHash("sha256").update(input.text).digest("hex"),
      originalFilename: input.label,
      sourceMimeType: null,
      sourceFileSize: null,
      sourceHash: null,
      parserVersion: "legacy-local-extraction",
      contentEdited: false,
      sourceBucketFileId: null,
      originalUnavailable: true,
      createdAt: now,
      updatedAt: now,
    });
    return res.status(201).json({ context });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.issues[0]?.message });
    }
    return res.status(500).json({ error: error.message || "We had trouble migrating file context." });
  }
});

router.post(
  "/recordings/:id/contexts/file",
  requireAuth,
  docUpload.single("file"),
  async (req: Request, res: Response) => {
    let uploadedKey: string | null = null;
    let bucketFileId: string | null = null;
    try {
      const userId = getRequiredRouteUserId(req);
      if (!await requireRecordingContextCloudSync(userId, res)) return;
      const recordingId = getRouteParam(req.params.id, "id");
      if (!await storage.recordings.get(recordingId, userId)) {
        return res.status(404).json({ error: "Recording not found." });
      }
      if (!req.file) return res.status(400).json({ error: "Choose a file to add." });
      const ext = req.file.originalname.split(".").pop()?.toLowerCase() || "";
      const dottedExt = ext ? `.${ext}` : "";
      const allowed = await getAllowedFileTypes(userId);
      if (!dottedExt || !allowed.includes(dottedExt)) {
        return res.status(403).json({
          error: "file_type_locked",
          ext: dottedExt,
          requiredTier: getRequiredTierForFileType(dottedExt) || "base",
        });
      }
      const maxBytes = await getMaxFileImportSize(userId);
      if (req.file.size > maxBytes) {
        return res.status(413).json({
          error: "file_too_large",
          size: req.file.size,
          limitBytes: maxBytes,
        });
      }
      const [usedBytes, storageLimit] = await Promise.all([
        getTotalUserStorageUsed(userId),
        getStorageLimit(userId),
      ]);
      if (storageLimit === 0 || usedBytes + req.file.size > storageLimit) {
        return res.status(413).json({ error: "Storage limit exceeded while retaining the source file." });
      }
      const text = (await extractDocumentText(req.file.buffer, ext)).trim();
      if (!text) return res.status(400).json({ error: "We could not find text in that file." });
      if (text.length > 700_000 || Buffer.byteLength(text, "utf8") > 700_000) {
        return res.status(413).json({ error: "Extracted file context is too large. Split the file and retry." });
      }
      uploadedKey = generateBucketKey(userId, "file", req.file.originalname);
      await bucketUploadFile(uploadedKey, req.file.buffer);
      const bucketFile = await createBucketFileRecord({
        userId,
        bucketKey: uploadedKey,
        originalName: req.file.originalname,
        mimeType: req.file.mimetype || "application/octet-stream",
        fileSize: req.file.size,
        category: "file",
      });
      bucketFileId = bucketFile.id;
      const now = new Date().toISOString();
      const context = await storage.recordingContexts.upsert({
        id: `recording_context_${randomUUID()}`,
        userId,
        recordingId,
        kind: "file",
        label: req.file.originalname,
        text,
        revision: 1,
        derivedTextHash: createHash("sha256").update(text).digest("hex"),
        originalFilename: req.file.originalname,
        sourceMimeType: req.file.mimetype || "application/octet-stream",
        sourceFileSize: req.file.size,
        sourceHash: createHash("sha256").update(req.file.buffer).digest("hex"),
        parserVersion: DOCUMENT_PARSER_VERSION,
        contentEdited: false,
        sourceBucketFileId: bucketFile.id,
        originalUnavailable: false,
        createdAt: now,
        updatedAt: now,
      });
      return res.status(201).json({ context });
    } catch (error: any) {
      if (bucketFileId && req.userId) {
        await deleteBucketFileRecord(bucketFileId, req.userId).catch(() => undefined);
      } else if (uploadedKey) {
        await deleteBucketObject(uploadedKey).catch(() => undefined);
      }
      return res.status(error?.status || 500).json({
        error: error?.message || "We had trouble retaining and reading that file.",
      });
    }
  },
);

router.patch("/recordings/:id/contexts/:contextId", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = getRequiredRouteUserId(req);
    if (!await requireRecordingContextCloudSync(userId, res)) return;
    const recordingId = getRouteParam(req.params.id, "id");
    const contextId = getRouteParam(req.params.contextId, "contextId");
    const text = z.string().trim().min(1).max(700_000).parse(req.body?.text);
    if (Buffer.byteLength(text, "utf8") > 700_000) {
      return res.status(413).json({ error: "Extracted file context is too large." });
    }
    const current = await storage.recordingContexts.get(contextId, recordingId, userId);
    if (!current) return res.status(404).json({ error: "Conversion context not found." });
    const context = await storage.recordingContexts.update(contextId, recordingId, userId, {
      text,
      revision: current.revision + 1,
      derivedTextHash: createHash("sha256").update(text).digest("hex"),
      contentEdited: current.kind === "file"
        ? current.contentEdited === true || text !== current.text
        : false,
    });
    return res.json({ context });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.issues[0]?.message });
    }
    return res.status(500).json({ error: error.message || "We had trouble updating conversion context." });
  }
});

router.delete("/recordings/:id/contexts/:contextId", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = getRequiredRouteUserId(req);
    if (!await requireRecordingContextCloudSync(userId, res)) return;
    const recordingId = getRouteParam(req.params.id, "id");
    const contextId = getRouteParam(req.params.contextId, "contextId");
    const context = await storage.recordingContexts.get(contextId, recordingId, userId);
    if (!context) return res.status(404).json({ error: "Conversion context not found." });
    if (context.sourceBucketFileId) {
      await deleteBucketFileRecord(context.sourceBucketFileId, userId);
    }
    await storage.recordingContexts.delete(contextId, recordingId, userId);
    return res.json({ ok: true });
  } catch (error: any) {
    return res.status(500).json({ error: error.message || "We had trouble removing conversion context." });
  }
});

// --- Folders ---

router.get("/folders", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = getRequiredRouteUserId(req);
    await ensureSystemFolders(userId);
    const folders = await storage.userFolders.getByUser(userId);
    const sortedFolders = folders.sort((a, b) => {
      if (b.isSystem !== a.isSystem) {
        return (b.isSystem || 0) - (a.isSystem || 0);
      }
      return a.name.localeCompare(b.name);
    });

    const allFiles = await storage.userFiles.getByUser(userId);
    const countMap: Record<string, number> = {};
    for (const file of allFiles) {
      if (file.folderId) {
        countMap[file.folderId] = (countMap[file.folderId] || 0) + 1;
      }
    }

    const foldersWithCounts = sortedFolders.map(f => ({ ...f, fileCount: countMap[f.id] || 0 }));
    res.json(foldersWithCounts);
  } catch (error: any) {
    res.status(500).json({ error: "We had trouble loading your folders. Please try again." });
  }
});

router.post("/folders", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = getRequiredRouteUserId(req);
    const { name, parentId } = req.body;
    if (!name || typeof name !== "string" || name.trim().length === 0) {
      return res.status(400).json({ error: "Please enter a name for this folder." });
    }
    const folderName = name.trim().slice(0, 200);
    const folder = await storage.userFolders.create({
      id: "",
      userId,
      name: folderName,
      parentId: parentId || null,
      isSystem: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    res.json(folder);
  } catch (error: any) {
    res.status(500).json({ error: "We had trouble creating that folder. Please try again." });
  }
});

router.patch("/folders/:id", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = getRequiredRouteUserId(req);
    const { name } = req.body;
    const folderId = req.params.id as string;
    const existing = await storage.userFolders.get(folderId);
    if (!existing || existing.userId !== userId) return res.status(404).json({ error: "We couldn't find that folder. It may have been deleted." });
    if (existing.isSystem) return res.status(400).json({ error: "Cannot rename system folders" });
    if (!name || typeof name !== "string" || name.trim().length === 0) {
      return res.status(400).json({ error: "Please enter a name for this folder." });
    }
    const updated = await storage.userFolders.update(folderId, { name: name.trim() });
    res.json(updated);
  } catch (error: any) {
    res.status(500).json({ error: "We had trouble renaming that folder. Please try again." });
  }
});

router.delete("/folders/:id", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = getRequiredRouteUserId(req);
    const delFolderId = req.params.id as string;
    const existing = await storage.userFolders.get(delFolderId);
    if (!existing || existing.userId !== userId) return res.status(404).json({ error: "We couldn't find that folder. It may have been deleted." });
    if (existing.isSystem) return res.status(400).json({ error: "Cannot delete system folders" });
    
    const files = await storage.userFiles.getByFolder(delFolderId);
    await Promise.all(files.map(file => storage.userFiles.update(file.id, { folderId: null })));
    await storage.userFolders.delete(delFolderId);
    res.json({ ok: true });
  } catch (error: any) {
    res.status(500).json({ error: "We had trouble deleting that folder. Please try again." });
  }
});

// --- Files ---

router.get("/files", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = getRequiredRouteUserId(req);
    const { folderId, conversionType } = req.query;
    let files = await storage.userFiles.getByUser(userId);
    
    if (folderId === "unfiled") {
      files = files.filter(f => !f.folderId);
    } else if (folderId && typeof folderId === "string") {
      files = files.filter(f => f.folderId === folderId);
    }
    
    if (conversionType && typeof conversionType === "string") {
      files = files.filter(f => f.conversionType === conversionType);
    }
    
    // Order by createdAt desc
    files.sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
    
    res.json(files);
  } catch (error: any) {
    res.status(500).json({ error: "We had trouble loading your files. Please try again." });
  }
});

router.get("/files/:id", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = getRequiredRouteUserId(req);
    const fileId = req.params.id as string;
    const file = await storage.userFiles.get(fileId);
    if (!file || file.userId !== userId) {
      return res.status(404).json({ error: "We couldn't find that file. It may have been deleted." });
    }
    res.json(file);
  } catch (error: any) {
    res.status(500).json({ error: "We had trouble loading that file. Please try again." });
  }
});

router.post("/files", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = getRequiredRouteUserId(req);
    const {
      name,
      content,
      conversionType,
      folderId,
      sourceRecordingId,
      sourceRecordingIds,
      sourceThoughtThreadId,
      sourceThoughtThreadRunId,
      mimeType,
    } = req.body;
    if (!name || !content) {
      return res.status(400).json({ error: "Please provide a name and content for this file." });
    }
    if (typeof name === "string" && name.length > 200) {
      return res.status(400).json({ error: "File name is too long (max 200 characters)." });
    }
    let normalizedSourceIds: string[] | null = Array.isArray(sourceRecordingIds)
      ? sourceRecordingIds.filter((id: unknown): id is string => typeof id === "string" && id.length > 0)
      : null;
    if (sourceThoughtThreadRunId && !sourceThoughtThreadId) {
      return res.status(400).json({ error: "A Thought Thread run must include its source thread." });
    }
    if (sourceThoughtThreadId) {
      const thread = await storage.thoughtThreads.get(String(sourceThoughtThreadId), userId);
      if (!thread) return res.status(400).json({ error: "The source Thought Thread is unavailable." });
      if (sourceThoughtThreadRunId) {
        const run = await storage.thoughtThreadRuns.get(
          String(sourceThoughtThreadRunId),
          thread.id,
          userId,
        );
        if (!run) return res.status(400).json({ error: "The source conversion run is unavailable." });
        normalizedSourceIds = run.sourceRecordingIds;
      }
    }
    const isCombined = !!normalizedSourceIds && normalizedSourceIds.length > 1;
    const fileSize = Buffer.byteLength(content, "utf-8");
    const used = await getUserStorageUsed(userId);
    const storageLimit = await getStorageLimit(userId);
    if (storageLimit === 0 || used + fileSize > storageLimit) {
      return res.status(413).json({ error: "Storage limit exceeded", used, limit: storageLimit });
    }
    let targetFolderId = folderId || null;
    if (!targetFolderId) {
      if (isCombined) {
        await ensureSystemFolders(userId);
        const folders = await storage.userFolders.getByUser(userId);
        const combinedFolder = folders.find(f => f.name === COMBINED_FOLDER_NAME && f.isSystem === 1);
        if (combinedFolder) targetFolderId = combinedFolder.id;
      } else if (conversionType) {
        await ensureSystemFolders(userId);
        const folders = await storage.userFolders.getByUser(userId);
        const systemFolder = folders.find(f => f.name === conversionType && f.isSystem === 1);
        if (systemFolder) targetFolderId = systemFolder.id;
      }
    }
    const resolvedSourceRecordingId = sourceRecordingId
      || (normalizedSourceIds && normalizedSourceIds.length === 1 ? normalizedSourceIds[0] : null);
      
    const newFileRecord = await storage.userFiles.create({
      id: `file_${Math.random().toString(36).substring(2, 11)}`,
      userId,
      name,
      content,
      conversionType: conversionType || null,
      folderId: targetFolderId,
      sourceRecordingId: resolvedSourceRecordingId,
      sourceRecordingIds: normalizedSourceIds && normalizedSourceIds.length > 0 ? normalizedSourceIds : null,
      sourceThoughtThreadId: sourceThoughtThreadId ? String(sourceThoughtThreadId) : null,
      sourceThoughtThreadRunId: sourceThoughtThreadRunId ? String(sourceThoughtThreadRunId) : null,
      fileSize,
      mimeType: mimeType || "text/plain",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    res.json(newFileRecord);
  } catch (error: any) {
    res.status(500).json({ error: "We had trouble saving that file. Please try again." });
  }
});

router.delete("/files/:id", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = getRequiredRouteUserId(req);
    const fileId = req.params.id as string;
    const file = await storage.userFiles.get(fileId);
    if (file && file.userId === userId) {
      await storage.userFiles.delete(fileId);
    }
    res.json({ ok: true });
  } catch (error: any) {
    res.status(500).json({ error: "We had trouble removing that file. Please try again." });
  }
});

// --- Uploads & Transcription ---

router.post("/upload-audio", requireAuth, upload.single("audio"), async (req: Request, res: Response) => {
  let userId = "";
  let recordingId = "";
  try {
    userId = getRequiredRouteUserId(req);
    recordingId = typeof req.body?.recordingId === "string" ? req.body.recordingId.trim() : "";
    if (!req.file) {
      if (recordingId) {
        await storage.updateRecording(recordingId, userId, {
          needsUpload: true,
          uploadStatus: "failed",
          uploadErrorCode: "upload_rejected",
          uploadRetryable: false,
        });
      }
      return res.status(400).json({ error: "No audio file uploaded" });
    }

    const linkedRecording = recordingId ? await storage.getRecording(recordingId, userId) : null;
    if (recordingId && !linkedRecording) {
      return res.status(409).json({
        error: "recording_not_ready",
        message: "The recording was not ready to receive its uploaded audio. The upload will be retried.",
      });
    }
    if (linkedRecording?.audioUri?.startsWith("bucket://")) {
      await storage.updateRecording(recordingId, userId, {
        needsUpload: false,
        uploadStatus: "uploaded",
        uploadErrorCode: null,
        uploadRetryable: null,
      });
      return res.json({ success: true, audioUri: linkedRecording.audioUri, resumed: true });
    }
    const mimeType = detectMimeType(req.file.originalname);
    const storageLimit = await getStorageLimit(userId);
    const bucketUsed = await getBucketStorageUsed(userId);
    const textUsed = await getUserStorageUsed(userId);
    const totalUsed = bucketUsed + textUsed;
    if (storageLimit === 0 || totalUsed + req.file.size > storageLimit) {
      if (recordingId) {
        await storage.updateRecording(recordingId, userId, {
          needsUpload: true,
          uploadStatus: "failed",
          uploadErrorCode: "upload_rejected",
          uploadRetryable: false,
        });
      }
      return res.status(413).json({ error: "Storage limit exceeded", used: totalUsed, limit: storageLimit });
    }

    if (recordingId) {
      await storage.updateRecording(recordingId, userId, {
        needsUpload: true,
        uploadStatus: "uploading",
        uploadErrorCode: null,
        uploadRetryable: null,
      });
    }

    const key = generateBucketKey(userId, categoryFromMime(mimeType), req.file.originalname);
    const bucketUri = toBucketUri(key);

    await bucketUploadFile(key, req.file.buffer);
    const bucketFile = await createBucketFileRecord({
      userId,
      bucketKey: key,
      originalName: req.file.originalname,
      mimeType: mimeType,
      fileSize: req.file.size,
      category: categoryFromMime(mimeType),
    });

    if (recordingId) {
      await storage.updateRecording(recordingId, userId, {
        audioUri: bucketUri,
        needsUpload: false,
        uploadStatus: "uploaded",
        uploadErrorCode: null,
        uploadRetryable: null,
      });
    }

    res.json({
      success: true,
      audioUri: bucketUri,
      bucketFile,
    });
  } catch (error: any) {
    console.error("Audio upload error:", error);
    if (userId && recordingId) {
      await storage.updateRecording(recordingId, userId, {
        needsUpload: true,
        uploadStatus: "failed",
        uploadErrorCode: "upload_failed",
        uploadRetryable: true,
      }).catch((statusError) => {
        console.error("Failed to persist audio upload failure:", statusError);
      });
    }
    res.status(500).json({ error: "Failed to upload audio file" });
  }
});

router.post("/parse-document", requireAuth, docUpload.single("file"), async (req: Request, res: Response) => {
  try {
    const userId = getRequiredRouteUserId(req);
    if (!req.file) {
      return res.status(400).json({ error: "Please choose a file to upload." });
    }

    const ext = req.file.originalname.split(".").pop()?.toLowerCase();
    const normalizedExt = ext ? `.${ext}` : "";
    const supported = [
      ".txt", ".md", ".docx", ".csv", ".xlsx", ".xls", ".pdf",
      ".png", ".jpg", ".jpeg", ".webp"
    ];
    if (!normalizedExt || !supported.includes(normalizedExt)) {
      return res.status(400).json({ error: "We don't support that file type yet. Please upload a document or image." });
    }
    const allowedForUser = await getAllowedFileTypes(userId);
    if (!allowedForUser.includes(normalizedExt)) {
      return res.status(403).json({
        error: "file_type_locked",
        ext,
        requiredTier: getRequiredTierForFileType(normalizedExt) || "base",
      });
    }
    const maxImportBytes = await getMaxFileImportSize(userId);
    if (req.file.size > maxImportBytes) {
      return res.status(413).json({
        error: "file_too_large",
        size: req.file.size,
        limit: Math.round(maxImportBytes / (1024 * 1024)),
      });
    }
    const fileExt = ext || "";

    const text = await extractDocumentText(req.file.buffer, fileExt);

    if (!text.trim()) {
      return res.status(400).json({ error: "We couldn't find any text in that file. Please try a different one." });
    }

    const normalizedText = text.trim();
    const extractedBytes = Buffer.byteLength(normalizedText, "utf8");
    const maxExtractedBytes = 700_000;
    if (extractedBytes > maxExtractedBytes) {
      return res.status(413).json({
        error: "The extracted file text is too large for one context source. Split the file into smaller sources or reduce it before uploading.",
        extractedBytes,
        limitBytes: maxExtractedBytes,
        truncated: false,
      });
    }
    res.json({
      text: normalizedText,
      filename: req.file.originalname,
      isMarkdown: fileExt === "md",
      extractedBytes,
      truncated: false,
    });
  } catch (error: any) {
    console.error("Document parsing error:", error);
    res.status(error?.status || 500).json({ error: error?.message || "We had trouble reading that document. Please try again." });
  }
});

router.post("/transcribe", requireAuth, upload.single("audio"), async (req: Request, res: Response) => {
  try {
    const userId = getRequiredRouteUserId(req);
    if (!req.file) {
      return res.status(400).json({ error: "No audio file provided" });
    }

    const language = req.body.language as string | undefined;
    const prompt = req.body.prompt as string | undefined;
    const fileBuffer = req.file.buffer;
    const fileName = req.file.originalname;

    const durationSeconds = await estimateAudioDurationSeconds(fileBuffer);
    const limitCheck = await checkTranscriptionLimit(userId, durationSeconds);
    if (!limitCheck.allowed) {
      return res.status(429).json({
        error: "insufficient_tokens",
        message: "You've used your monthly AI Credits. Upgrade for more credits — they reset each month.",
        cost: limitCheck.cost,
        limitType: "transcription",
      });
    }

    const transcriptionText = await transcribeWithFallback(fileBuffer, fileName, language, prompt);
    const formattedTranscript = paragraphizeTranscript(transcriptionText);

    await deductTranscriptionTokens(userId, durationSeconds);

    res.json({ text: formattedTranscript });
  } catch (error: any) {
    console.error("Transcription error:", error);
    res.status(500).json({ error: "We had trouble transcribing that audio. Please try again." });
  }
});

router.post("/recordings/:id/transcribe", requireAuth, async (req: Request, res: Response) => {
  let userId = "";
  let recordingId = "";
  try {
    userId = getRequiredRouteUserId(req);
    recordingId = getRouteParam(req.params.id, "id");
    let recording = await storage.getRecording(recordingId, userId);
    if (!recording) {
      return res.status(404).json({ error: "We couldn't find that recording. It may have been deleted." });
    }
    if (!recording.audioUri?.startsWith("bucket://")) {
      // The native UploadWorker transcribes immediately after upload; a fast
      // read here can miss the bucket URI write (Firestore eventual
      // consistency) and an immediate 409 strands the recording in "queued"
      // if the caller does not retry. Wait briefly for the write to land.
      for (let attempt = 0; attempt < TRANSCRIBE_URI_WAIT_ATTEMPTS; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, TRANSCRIBE_URI_WAIT_DELAY_MS));
        recording = (await storage.getRecording(recordingId, userId)) ?? recording;
        if (recording.audioUri?.startsWith("bucket://")) break;
      }
      if (!recording.audioUri?.startsWith("bucket://")) {
        return res.status(409).json({ error: "The recording audio has not finished uploading." });
      }
    }
    if (recording.transcript?.trim()) {
      await storage.updateRecording(recordingId, userId, {
        isTranscribing: false,
        transcriptionStatus: "succeeded",
        transcriptionErrorCode: null,
        transcriptionError: null,
        transcriptionRetryable: null,
      });
      return res.json({ text: paragraphizeTranscript(recording.transcript), reused: true });
    }

    const durationSeconds = Number(recording.duration) || 0;
    const limitCheck = await checkTranscriptionLimit(userId, durationSeconds);
    if (!limitCheck.allowed) {
      const errorCode = "insufficient_tokens";
      await storage.updateRecording(recordingId, userId, {
        isTranscribing: false,
        transcriptionStatus: "failed",
        transcriptionErrorCode: errorCode,
        transcriptionError: null,
        transcriptionRetryable: false,
      });
      return res.status(429).json({
        error: errorCode,
        message: "You've used your monthly AI Credits. Upgrade for more credits — they reset each month.",
        cost: limitCheck.cost,
        limitType: "transcription",
      });
    }

    await storage.updateRecording(recordingId, userId, {
      isTranscribing: true,
      transcriptionStatus: "transcribing",
      transcriptionErrorCode: null,
      transcriptionError: null,
      transcriptionRetryable: null,
    });

    const bucketKey = fromBucketUri(recording.audioUri);
    const fileBuffer = await bucketDownloadFile(bucketKey);
    const fileName = bucketKey.split("/").pop() || "recording.m4a";
    const language = typeof req.body?.language === "string" ? req.body.language : undefined;
    const prompt = language === "es" ? "Español latinoamericano, acento mexicano." : undefined;
    const transcriptionText = await transcribeWithFallback(fileBuffer, fileName, language, prompt);

    // Reject near-empty garbage (punctuation-only, trivially short).
    // Distinguish true silence from provider garbage: a silent recording gets
    // transcription_no_speech (retrying won't help — the user should re-record),
    // while audio that has real energy but produced no text gets
    // transcription_failed (encoding/provider issue — keep it retryable).
    const meaningful = transcriptionText.replace(/[\s\p{P}\p{S}]+/gu, "");
    if (meaningful.length < 3) {
      const silence = await detectSilence(fileBuffer);
      const noSpeech = silence.silent;
      await storage.updateRecording(recordingId, userId, {
        isTranscribing: false,
        transcriptionStatus: "failed",
        transcriptionErrorCode: noSpeech ? "transcription_no_speech" : "transcription_failed",
        transcriptionError: noSpeech
          ? "No speech was detected in this recording."
          : "Transcription returned no meaningful content. The recording may need to be re-processed.",
        transcriptionRetryable: noSpeech ? false : true,
      });
      return res.json({
        text: "",
        empty: true,
        errorCode: noSpeech ? "transcription_no_speech" : "transcription_failed",
        silenceRms: silence.rms,
      });
    }

    // Whisper (and other ASR models) hallucinate polite filler ("Thank you.",
    // "Thank you for watching.") on genuinely silent audio. Any SHORT result on
    // a silent recording is rejected as no-speech; a short result on audible
    // audio is kept (real one- or two-word recordings must not be discarded).
    if (meaningful.length < 40) {
      const silence = await detectSilence(fileBuffer);
      if (silence.silent) {
        await storage.updateRecording(recordingId, userId, {
          isTranscribing: false,
          transcriptionStatus: "failed",
          transcriptionErrorCode: "transcription_no_speech",
          transcriptionError: "No speech was detected in this recording.",
          transcriptionRetryable: false,
        });
        return res.json({
          text: "",
          empty: true,
          errorCode: "transcription_no_speech",
          silenceRms: silence.rms,
        });
      }
    }

    const formattedTranscript = paragraphizeTranscript(transcriptionText);
    const updated = await storage.updateRecording(
      recordingId,
      userId,
      {
        ...transcriptRevisionUpdates(recording, formattedTranscript),
        isTranscribing: false,
        transcriptionStatus: "succeeded",
        transcriptionErrorCode: null,
        transcriptionError: null,
        transcriptionRetryable: null,
      },
    );
    await deductTranscriptionTokens(userId, durationSeconds);
    if (updated) {
      await invalidateThoughtThreadsForRecording(recordingId, userId, updated);
      backupRecordingFiles(userId, updated, ["transcript"]).catch((err) =>
        console.error("Auto-backup after server transcription failed:", err)
      );
    }

    res.json({ text: formattedTranscript });
  } catch (error: any) {
    console.error("Stored recording transcription error:", error);
    if (userId && recordingId) {
      await storage.updateRecording(recordingId, userId, {
        isTranscribing: false,
        transcriptionStatus: "failed",
        transcriptionErrorCode: "transcription_failed",
        transcriptionError: "Transcription failed. Your recording is safe — tap to retry.",
        transcriptionRetryable: true,
      }).catch((statusError) => {
        console.error("Failed to persist transcription failure:", statusError);
      });
    }
    res.status(500).json({ error: "We had trouble transcribing that audio. Please try again." });
  }
});

// --- Storage ---

router.get("/storage", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = getRequiredRouteUserId(req);
    const summary = await getUserUsageSummary(userId);
    const textFiles = await storage.userFiles.getByUser(userId);
    const used = textFiles.reduce((acc, f) => acc + (f.fileSize || 0), 0);
    const bucketUsed = await getBucketStorageUsed(userId);
    const bucketFiles = await storage.bucketFiles.getByUser(userId);
    const limit = await getStorageLimit(userId);
    const totalUsed = used + bucketUsed;
    res.json({
      ...summary,
      used,
      limit,
      fileCount: textFiles.length,
      percentage: limit > 0 ? Math.round((used / limit) * 100) : 0,
      bucketUsed,
      bucketLimit: limit,
      bucketFileCount: bucketFiles.length,
      bucketPercentage: limit > 0 ? Math.round((bucketUsed / limit) * 100) : 0,
      totalUsed,
      totalPercentage: limit > 0 ? Math.round((totalUsed / limit) * 100) : 0,
    });
  } catch (error: any) {
    res.status(500).json({ error: "We had trouble loading your storage summary." });
  }
});

// Health check: which transcription providers are available?
router.get("/transcription-health", async (_req: Request, res: Response) => {
  const chain = getTranscriptionRoutes();
  res.json({
    providers: chain.map(r => ({
      provider: r.provider,
      model: r.model,
      timeoutMs: r.timeoutMs,
      hedgeAfterMs: r.hedgeAfterMs,
    })),
    primaryConfigured: chain.length > 0,
    hasBackup: chain.length > 1,
    strategy: "latency-first-hedged",
    totalTimeoutMs: getTranscriptionTotalTimeoutMs(),
  });
});

export default router;
