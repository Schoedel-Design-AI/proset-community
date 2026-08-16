import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import express, { type Request, type Response } from "express";
import multer from "multer";
import { z } from "zod";
import type {
  Recording,
  ThoughtThread,
  ThoughtThreadConversionRun,
  ThoughtThreadItem,
  ThoughtThreadModelStrategy,
  ThoughtThreadSourceManifest,
} from "@shared/schema";
import {
  buildThoughtThreadSource,
  THOUGHT_THREAD_MAX_SOURCE_BYTES,
  type ThoughtThreadSourceItem,
} from "@shared/thought-thread-source";
import { requireAuth } from "../../auth";
import { normalizeRevenueCatEntitlements } from "@shared/revenuecat-catalog";
import { trackEvent } from "../../analytics-service";
import {
  getConversionModelInputLimit,
  resolveConversionModelRouteChain,
} from "../../conversion-model-routing";
import { storage } from "../../storage";
import {
  checkLimit,
  getAllowedFileTypes,
  getMaxFileImportSize,
  getRequiredTierForFileType,
  getStorageLimit,
  getUsageReservationCeiling,
  isConversionTypeAllowed,
  reserveUsageForRun,
  settleUsageForRun,
} from "../../usage-service";
import { DOCUMENT_PARSER_VERSION, extractDocumentText } from "../../document-parser";
import {
  createBucketFileRecord,
  deleteBucketFileRecord,
  deleteFile as deleteBucketObject,
  generateBucketKey,
  uploadFile as uploadBucketFile,
} from "../../object-storage";
import { getTotalUserStorageUsed } from "../recordings/utils";
import { getUserConversionModelPreferences } from "../ai-customization/utils";
import { getRequiredRouteUserId, getRouteParam } from "../shared-utils";
import {
  buildRunChunks,
  failThoughtThreadRun,
} from "./service";
import { prepareThoughtThreadRunJob } from "./preparation";
import {
  enqueueThoughtThreadPreparation,
  verifyThoughtThreadTaskAuthorization,
} from "../../thought-thread-task-queue";

const router = express.Router();
const MAX_THREAD_RECORDINGS = 100;
const MAX_THREAD_CONTEXTS = 100;
const MAX_CONTEXT_CHARS = 700_000;
const MAX_CONTEXT_BYTES = 700_000;
const MAX_CONTEXT_AGGREGATE_BYTES = THOUGHT_THREAD_MAX_SOURCE_BYTES;
const THOUGHT_THREAD_PROMPT_VERSION = "thought-thread-2026-07-23.2";
const contextFileUpload = multer({
  storage: multer.memoryStorage(),
  // Multer must allow the largest plan-supported upload. The tier-aware check
  // below applies the user's actual 25 MB/50 MB limit.
  limits: { fileSize: 50 * 1024 * 1024 },
});
const SUPPORTED_CONTEXT_FILE_EXTENSIONS = new Set([
  "txt", "md", "csv", "png", "jpg", "jpeg", "webp", "pdf", "docx", "xlsx",
]);

async function requireThoughtThreadCloudSync(
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
    message: "Thought Threads require Cloud Sync. Enable Cloud Sync in Settings to use this feature.",
  });
  return false;
}

router.post(
  "/internal/thought-thread-preparation",
  async (req: Request, res: Response) => {
    const authorized = await verifyThoughtThreadTaskAuthorization(
      req.headers.authorization,
      req.headers["x-cloudtasks-taskname"],
      req.headers["x-cloudtasks-queuename"],
    );
    if (!authorized) return res.status(401).json({ error: "Unauthorized task delivery." });
    try {
      const input = z.object({
        runId: z.string().trim().min(1),
        threadId: z.string().trim().min(1),
        userId: z.string().trim().min(1),
      }).parse(req.body);
      const retryCount = Number(req.headers["x-cloudtasks-taskretrycount"] || 0);
      const run = await prepareThoughtThreadRunJob(
        input.runId,
        input.threadId,
        input.userId,
        Number.isFinite(retryCount) && retryCount >= 4,
      );
      if (run?.status === "preparing" && run.leaseToken) {
        return res.status(409).json({ error: "Preparation is already leased." });
      }
      return res.json({ ok: true, status: run?.status || "missing" });
    } catch (error: any) {
      return res.status(error instanceof z.ZodError ? 400 : 500).json({
        error: error instanceof z.ZodError
          ? error.issues[0]?.message
          : "Thought Thread preparation failed.",
      });
    }
  },
);

const threadStatusSchema = z.enum(["open", "ready", "archived"]);
const orderingModeSchema = z.enum(["chronological", "manual"]);

const createThreadSchema = z.object({
  title: z.string().trim().min(1).max(160).optional(),
  recordingIds: z.array(z.string().trim().min(1)).max(MAX_THREAD_RECORDINGS).default([]),
  operationId: z.string().trim().min(1).max(200).optional(),
}).superRefine((value, context) => {
  if (new Set(value.recordingIds).size !== value.recordingIds.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["recordingIds"],
      message: "Each recording can be selected only once.",
    });
  }
});

const updateThreadSchema = z.object({
  title: z.string().trim().min(1).max(160).optional(),
  status: threadStatusSchema.optional(),
  orderingMode: orderingModeSchema.optional(),
  expectedVersion: z.number().int().positive().optional(),
}).refine((value) => value.title !== undefined || value.status !== undefined || value.orderingMode !== undefined, {
  message: "No thread changes were provided.",
});

const contextSchema = z.object({
  // File context can only be created by the multipart route so provenance and
  // retained-original metadata cannot be spoofed through JSON.
  kind: z.literal("text"),
  label: z.string().trim().max(240).default(""),
  text: z.string().trim().min(1).max(MAX_CONTEXT_CHARS).refine(
    (text) => Buffer.byteLength(text, "utf8") <= MAX_CONTEXT_BYTES,
    "Context is too large. Split it into smaller entries or upload it as a file.",
  ),
  relationship: z.enum(["continues", "clarifies", "supersedes", "conflicts", "supports"]).nullable().optional(),
  relatedSourceId: z.string().trim().min(1).max(200).nullable().optional(),
}).superRefine((value, context) => {
  const hasRelationship = !!value.relationship;
  const hasRelatedSource = !!value.relatedSourceId;
  if (hasRelationship !== hasRelatedSource) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["relationship"],
      message: "A context relationship and related source must be provided together.",
    });
  }
});

const contextUpdateSchema = z.object({
  label: z.string().trim().max(240).optional(),
  text: z.string().trim().min(1).max(MAX_CONTEXT_CHARS).refine(
    (text) => Buffer.byteLength(text, "utf8") <= MAX_CONTEXT_BYTES,
    "Context is too large. Split it into smaller entries or upload it as a file.",
  ).optional(),
  relationship: z.enum(["continues", "clarifies", "supersedes", "conflicts", "supports"]).nullable().optional(),
  relatedSourceId: z.string().trim().min(1).max(200).nullable().optional(),
}).refine(
  (value) =>
    value.label !== undefined
    || value.text !== undefined
    || value.relationship !== undefined
    || value.relatedSourceId !== undefined,
  "No context changes were provided.",
);

const conversionOptionsSchema = z.object({
  conversionType: z.string().trim().min(1).max(100),
  citationStyle: z.string().trim().min(1).max(30).optional(),
  bibliographyType: z.enum(["standard", "annotated"]).optional(),
  outputFormat: z.enum(["markdown", "plaintext"]).default("markdown"),
  language: z.string().trim().min(2).max(10).optional(),
  customPrompt: z.string().trim().max(5_000).optional(),
  clarificationQuestion: z.string().trim().max(1_000).optional(),
  clarificationAnswer: z.string().trim().max(4_000).optional(),
  confirmExtendedAccess: z.boolean().optional(),
});

function threadId(userId?: string, operationId?: string): string {
  if (userId && operationId) {
    return `thread_${createHash("sha256")
      .update(`${userId}:${operationId}`)
      .digest("hex")
      .slice(0, 40)}`;
  }
  return `thread_${randomUUID()}`;
}

function itemId(): string {
  return `thread_item_${randomUUID()}`;
}

function contextId(): string {
  return `thread_context_${randomUUID()}`;
}

function runId(): string {
  return `thread_run_${randomUUID()}`;
}

function sourceMutationThreadUpdates(
  thread: ThoughtThread,
  updates: Partial<ThoughtThread> = {},
): Partial<ThoughtThread> {
  return {
    status: thread.status === "archived" ? "archived" : "open",
    sourceRevision: (thread.sourceRevision || 1) + 1,
    ...updates,
  };
}

function assertContextAggregateSize(
  contexts: Array<{ id: string; text: string }>,
  nextText: string,
  replacingId?: string,
): void {
  const total = contexts.reduce(
    (sum, context) =>
      sum + (context.id === replacingId ? 0 : Buffer.byteLength(context.text, "utf8")),
    Buffer.byteLength(nextText, "utf8"),
  );
  if (total > MAX_CONTEXT_AGGREGATE_BYTES) {
    const error = new Error(
      "The combined added context is too large for one Thought Thread. Remove or split context before adding more.",
    );
    (error as any).status = 413;
    throw error;
  }
}

async function assertContextRelationshipTarget(
  threadIdValue: string,
  userId: string,
  relationship: string | null | undefined,
  relatedSourceId: string | null | undefined,
  currentContextId?: string,
): Promise<void> {
  if (!relationship && !relatedSourceId) return;
  if (!relationship || !relatedSourceId || relatedSourceId === currentContextId) {
    const error = new Error("Choose a different source for this context relationship.");
    (error as any).status = 400;
    throw error;
  }
  const [items, contexts] = await Promise.all([
    storage.thoughtThreadItems.getByThread(threadIdValue, userId),
    storage.thoughtThreadContexts.getByThread(threadIdValue, userId),
  ]);
  const exists = items.some((item) =>
    item.id === relatedSourceId || item.recordingId === relatedSourceId)
    || contexts.some((context) => context.id === relatedSourceId);
  if (!exists) {
    const error = new Error("The related source is not part of this Thought Thread.");
    (error as any).status = 400;
    throw error;
  }
}

function chronologicalRecordings(recordings: Recording[]): Recording[] {
  return [...recordings].sort((a, b) =>
    new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    || a.id.localeCompare(b.id));
}

async function requireThread(userId: string, id: string): Promise<ThoughtThread> {
  const thread = await storage.thoughtThreads.get(id, userId);
  if (!thread) {
    const error = new Error("Thought Thread not found.");
    (error as any).status = 404;
    throw error;
  }
  return thread;
}

function buildNewItems(
  thread: ThoughtThread,
  existing: ThoughtThreadItem[],
  recordings: Recording[],
): ThoughtThreadItem[] {
  const existingIds = new Set(existing.map((item) => item.recordingId));
  const newRecordings = chronologicalRecordings(recordings)
    .filter((recording) => !existingIds.has(recording.id));
  if (existing.length + newRecordings.length > MAX_THREAD_RECORDINGS) {
    const error = new Error(`A Thought Thread can contain up to ${MAX_THREAD_RECORDINGS} recordings.`);
    (error as any).status = 400;
    throw error;
  }

  const now = new Date().toISOString();
  const nextPosition = existing.reduce((max, item) => Math.max(max, item.position), -1) + 1;
  const created = newRecordings.map((recording, index): ThoughtThreadItem => ({
      id: itemId(),
      userId: thread.userId,
      threadId: thread.id,
      recordingId: recording.id,
      position: nextPosition + index,
      included: true,
      sourceCreatedAt: recording.createdAt,
      attachedTranscriptRevision: recording.transcriptRevision || 1,
      attachedTranscriptHash: recording.transcriptHash
        || createHash("sha256").update(recording.transcript || "").digest("hex"),
      createdAt: now,
      updatedAt: now,
    }));
  return created;
}

function buildSourceManifest(
  assembled: ReturnType<typeof buildThoughtThreadSource>,
  orderingMode: ThoughtThread["orderingMode"],
  assembledSourceHash: string,
): ThoughtThreadSourceManifest {
  return {
    version: 1,
    orderingMode,
    assembledSourceHash,
    recordings: assembled.orderedItems.map((item) => ({
      itemId: item.id,
      recordingId: item.recordingId,
      position: item.position,
      capturedAt: item.recording.createdAt,
      transcriptRevision: item.recording.transcriptRevision || 1,
      transcriptHash: item.recording.transcriptHash
        || createHash("sha256").update(item.recording.transcript.trim()).digest("hex"),
    })),
    contexts: assembled.contexts.map((context) => ({
      contextId: context.id,
      kind: context.kind,
      position: context.position,
      label: context.label,
      revision: context.revision || 1,
      derivedTextHash: context.derivedTextHash
        || createHash("sha256").update(context.text.trim()).digest("hex"),
      originalFilename: context.originalFilename || null,
      sourceMimeType: context.sourceMimeType || null,
      sourceFileSize: context.sourceFileSize || null,
      sourceHash: context.sourceHash || null,
      parserVersion: context.parserVersion || null,
      contentEdited: context.contentEdited === true,
      relationship: context.relationship || null,
      relatedSourceId: context.relatedSourceId || null,
    })),
  };
}

function publicRun(run: ThoughtThreadConversionRun) {
  const {
    sourceSnapshot: _sourceSnapshot,
    preparedSource: _preparedSource,
    output: _output,
    ...summary
  } = run;
  return summary;
}

async function scheduleHierarchicalPreparation(
  run: ThoughtThreadConversionRun,
): Promise<void> {
  const enqueued = await enqueueThoughtThreadPreparation({
    runId: run.id,
    threadId: run.threadId,
    userId: run.userId,
    attempt: run.attemptCount || 0,
  });
  if (!enqueued) {
    setImmediate(() => {
      void prepareThoughtThreadRunJob(run.id, run.threadId, run.userId, true);
    });
  }
}

async function hydrateThread(thread: ThoughtThread) {
  const [items, contexts, runs] = await Promise.all([
    storage.thoughtThreadItems.getByThread(thread.id, thread.userId),
    storage.thoughtThreadContexts.getByThread(thread.id, thread.userId),
    storage.thoughtThreadRuns.getByThread(thread.id, thread.userId),
  ]);
  const hydratedItems = await Promise.all(items.map(async (item) => ({
    ...item,
    recording: await storage.recordings.get(item.recordingId, thread.userId) ?? null,
  })));
  const availableItems = hydratedItems.filter(
    (item): item is ThoughtThreadSourceItem => item.recording !== null,
  );
  const assembled = buildThoughtThreadSource(availableItems, contexts, thread.orderingMode);
  return {
    thread: {
      ...thread,
      hasCurrentOutput:
        thread.lastConvertedSourceRevision != null
        && thread.lastConvertedSourceRevision === thread.sourceRevision,
    },
    items: hydratedItems,
    contexts,
    runs: runs.map(publicRun),
    sourceSummary: {
      includedRecordingCount: assembled.sourceRecordingIds.length,
      contextCount: assembled.contextEntryIds.length,
      estimatedTokens: assembled.estimatedTokens,
      missingRecordingCount: hydratedItems.length - availableItems.length,
    },
  };
}

router.get("/thought-threads", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = getRequiredRouteUserId(req);
    if (!await requireThoughtThreadCloudSync(userId, res)) return;
    const threads = await storage.thoughtThreads.getByUser(userId);
    const summaries = threads.map((thread) => {
      return {
        ...thread,
        recordingCount: thread.recordingCount || 0,
        contextCount: thread.contextCount || 0,
        runCount: thread.runCount || 0,
        hasCurrentOutput:
          thread.lastConvertedSourceRevision != null
          && thread.lastConvertedSourceRevision === thread.sourceRevision,
      };
    });
    res.json({ threads: summaries });
  } catch (error: any) {
    res.status(500).json({ error: "We had trouble loading your Thought Threads." });
  }
});

router.post("/thought-threads", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = getRequiredRouteUserId(req);
    if (!await requireThoughtThreadCloudSync(userId, res)) return;
    const input = createThreadSchema.parse(req.body);
    const uniqueIds = [...new Set(input.recordingIds)];
    const recordings = (await Promise.all(uniqueIds.map((id) => storage.recordings.get(id, userId))))
      .filter((recording): recording is Recording => !!recording);
    if (recordings.length !== uniqueIds.length) {
      return res.status(400).json({ error: "One or more selected recordings are unavailable." });
    }
    const now = new Date().toISOString();
    const ordered = chronologicalRecordings(recordings);
    const thread: ThoughtThread = {
      id: threadId(userId, input.operationId),
      userId,
      title: input.title || (ordered[0] ? `Thought Thread — ${ordered[0].title}` : "Untitled Thought Thread"),
      status: "open",
      orderingMode: "chronological",
      version: 1,
      sourceRevision: 1,
      recordingCount: ordered.length,
      contextCount: 0,
      runCount: 0,
      createdAt: now,
      updatedAt: now,
      lastConvertedAt: null,
      lastConvertedRunId: null,
      lastConvertedSourceRevision: null,
    };
    const items = buildNewItems(thread, [], ordered);
    try {
      await storage.thoughtThreads.createWithItems(thread, items);
    } catch (error) {
      if (!input.operationId) throw error;
      const existing = await storage.thoughtThreads.get(thread.id, userId);
      if (!existing) throw error;
      return res.json(await hydrateThread(existing));
    }
    trackEvent("thought_thread_created", userId, { initialRecordingCount: ordered.length });
    res.status(201).json(await hydrateThread(thread));
  } catch (error: any) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: error.issues[0]?.message });
    res.status(error.status || 500).json({ error: error.message || "We had trouble creating that Thought Thread." });
  }
});

router.post("/thought-threads/from-recording/:recordingId", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = getRequiredRouteUserId(req);
    if (!await requireThoughtThreadCloudSync(userId, res)) return;
    const recordingId = getRouteParam(req.params.recordingId, "recordingId");
    const recording = await storage.recordings.get(recordingId, userId);
    if (!recording) return res.status(404).json({ error: "Recording not found." });
    const requestedThreadId = z.object({
      threadId: z.string().trim().min(1).optional(),
      operationId: z.string().trim().min(1).max(200).optional(),
    }).parse(req.body || {});
    const requestedThread = requestedThreadId.threadId;

    const memberships = await storage.thoughtThreadItems.getByRecording(recordingId, userId);
    const candidates = (await Promise.all(memberships.map((item) => storage.thoughtThreads.get(item.threadId, userId))))
      .filter((thread): thread is ThoughtThread => !!thread && thread.status !== "archived")
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    if (requestedThread) {
      const selected = candidates.find((thread) => thread.id === requestedThread);
      if (!selected) {
        return res.status(400).json({ error: "That recording is not part of the selected active Thought Thread." });
      }
      return res.json({ created: false, ...(await hydrateThread(selected)) });
    }
    if (candidates.length === 1) {
      return res.json({ created: false, ...(await hydrateThread(candidates[0])) });
    }
    if (candidates.length > 1) {
      return res.json({
        created: false,
        requiresChoice: true,
        threads: candidates.map((thread) => ({
          id: thread.id,
          title: thread.title,
          updatedAt: thread.updatedAt,
          recordingCount: thread.recordingCount,
        })),
      });
    }

    const now = new Date().toISOString();
    const thread: ThoughtThread = {
      id: threadId(userId, requestedThreadId.operationId),
      userId,
      title: `Thought Thread — ${recording.title}`,
      status: "open",
      orderingMode: "chronological",
      version: 1,
      sourceRevision: 1,
      recordingCount: 1,
      contextCount: 0,
      runCount: 0,
      createdAt: now,
      updatedAt: now,
      lastConvertedAt: null,
      lastConvertedRunId: null,
      lastConvertedSourceRevision: null,
    };
    const items = buildNewItems(thread, [], [recording]);
    try {
      await storage.thoughtThreads.createWithItems(thread, items);
    } catch (error) {
      if (!requestedThreadId.operationId) throw error;
      const existing = await storage.thoughtThreads.get(thread.id, userId);
      if (!existing) throw error;
      return res.json({ created: false, ...(await hydrateThread(existing)) });
    }
    trackEvent("thought_thread_created", userId, { initialRecordingCount: 1, from: "recording_detail" });
    res.status(201).json({ created: true, ...(await hydrateThread(thread)) });
  } catch (error: any) {
    res.status(error.status || 500).json({ error: error.message || "We had trouble continuing that thought." });
  }
});

router.get("/thought-threads/:id", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = getRequiredRouteUserId(req);
    if (!await requireThoughtThreadCloudSync(userId, res)) return;
    const thread = await requireThread(userId, getRouteParam(req.params.id, "id"));
    res.json(await hydrateThread(thread));
  } catch (error: any) {
    res.status(error.status || 500).json({ error: error.message || "We had trouble loading that Thought Thread." });
  }
});

router.patch("/thought-threads/:id", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = getRequiredRouteUserId(req);
    if (!await requireThoughtThreadCloudSync(userId, res)) return;
    const id = getRouteParam(req.params.id, "id");
    const input = updateThreadSchema.parse(req.body);
    const thread = await requireThread(userId, id);
    if (input.expectedVersion !== undefined && input.expectedVersion !== thread.version) {
      return res.status(409).json({ error: "This Thought Thread changed on another device. Reload it and try again." });
    }
    const updated = await storage.thoughtThreads.commitMutation(
      id,
      userId,
      thread.version,
      {
        threadUpdates: input.orderingMode !== undefined
          ? sourceMutationThreadUpdates(thread, {
            ...(input.title !== undefined ? { title: input.title } : {}),
            ...(input.status !== undefined ? { status: input.status } : {}),
            orderingMode: input.orderingMode,
          })
          : {
            ...(input.title !== undefined ? { title: input.title } : {}),
            ...(input.status !== undefined ? { status: input.status } : {}),
          },
      },
    );
    if (!updated) return res.status(409).json({ error: "This Thought Thread changed on another device. Reload it and try again." });
    res.json(await hydrateThread(updated));
  } catch (error: any) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: error.issues[0]?.message });
    res.status(error.status || 500).json({ error: error.message || "We had trouble updating that Thought Thread." });
  }
});

router.delete("/thought-threads/:id", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = getRequiredRouteUserId(req);
    if (!await requireThoughtThreadCloudSync(userId, res)) return;
    const id = getRouteParam(req.params.id, "id");
    await requireThread(userId, id);
    const ownedContexts = await storage.thoughtThreadContexts.getByThread(id, userId);
    // Delete retained originals first. If object storage is unavailable, the
    // Thread remains discoverable and the entire operation can be retried
    // without orphaning a blob or losing its metadata pointer.
    for (const context of ownedContexts) {
      if (context.sourceBucketFileId) {
        await deleteBucketFileRecord(context.sourceBucketFileId, userId);
      }
    }
    // Keep the parent until every child collection has been cleaned. Each
    // operation is idempotent, so a partial failure remains retryable.
    await storage.thoughtThreadRunChunks.deleteByThread(id, userId);
    await storage.thoughtThreadRuns.deleteByThread(id, userId);
    await storage.thoughtThreadContexts.deleteByThread(id, userId);
    await storage.thoughtThreadItems.deleteByThread(id, userId);
    await storage.thoughtThreads.delete(id, userId);
    trackEvent("thought_thread_deleted", userId, {});
    res.json({ ok: true });
  } catch (error: any) {
    res.status(error.status || 500).json({ error: error.message || "We had trouble deleting that Thought Thread." });
  }
});

router.post("/thought-threads/:id/recordings", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = getRequiredRouteUserId(req);
    if (!await requireThoughtThreadCloudSync(userId, res)) return;
    const id = getRouteParam(req.params.id, "id");
    const input = z.object({
      recordingIds: z.array(z.string().trim().min(1)).min(1).max(MAX_THREAD_RECORDINGS),
      expectedVersion: z.number().int().positive().optional(),
      operationId: z.string().trim().min(1).max(200).optional(),
    }).parse(req.body);
    const thread = await requireThread(userId, id);
    if (input.expectedVersion !== undefined && thread.version !== input.expectedVersion) {
      return res.status(409).json({ error: "This Thought Thread changed on another device. Reload it and try again." });
    }
    const uniqueIds = [...new Set(input.recordingIds)];
    if (uniqueIds.length !== input.recordingIds.length) {
      return res.status(400).json({ error: "Each recording can be added only once." });
    }
    const recordings = (await Promise.all(uniqueIds.map((recordingId) => storage.recordings.get(recordingId, userId))))
      .filter((recording): recording is Recording => !!recording);
    if (recordings.length !== uniqueIds.length) {
      return res.status(400).json({ error: "One or more recordings are unavailable." });
    }
    const existingItems = await storage.thoughtThreadItems.getByThread(id, userId);
    const existingRecordingIds = new Set(existingItems.map((item) => item.recordingId));
    if (recordings.every((recording) => existingRecordingIds.has(recording.id))) {
      return res.json(await hydrateThread(thread));
    }
    const addedCount = recordings.filter((recording) => !existingRecordingIds.has(recording.id)).length;
    const created = buildNewItems(thread, existingItems, recordings);
    const allItems = thread.orderingMode === "chronological"
      ? [...existingItems, ...created].sort((a, b) =>
          new Date(a.sourceCreatedAt).getTime() - new Date(b.sourceCreatedAt).getTime()
          || a.recordingId.localeCompare(b.recordingId))
      : [...existingItems, ...created];
    const desiredPositions = new Map(allItems.map((item, position) => [item.id, position]));
    for (const item of created) item.position = desiredPositions.get(item.id) ?? item.position;
    const updatedThread = await storage.thoughtThreads.commitMutation(
      id,
      userId,
      thread.version,
      {
        threadUpdates: sourceMutationThreadUpdates(thread, {
          recordingCount: existingItems.length + addedCount,
        }),
        createItems: created,
        updateItems: existingItems
          .filter((item) => desiredPositions.get(item.id) !== item.position)
          .map((item) => ({ id: item.id, updates: { position: desiredPositions.get(item.id)! } })),
      },
    );
    if (!updatedThread) {
      return res.status(409).json({ error: "This Thought Thread changed on another device. Reload it and try again." });
    }
    trackEvent("thought_thread_recordings_added", userId, { count: created.length });
    res.status(201).json(await hydrateThread(updatedThread));
  } catch (error: any) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: error.issues[0]?.message });
    res.status(error.status || 500).json({ error: error.message || "We had trouble adding those recordings." });
  }
});

router.patch("/thought-threads/:id/items/:itemId", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = getRequiredRouteUserId(req);
    if (!await requireThoughtThreadCloudSync(userId, res)) return;
    const id = getRouteParam(req.params.id, "id");
    const targetItemId = getRouteParam(req.params.itemId, "itemId");
    const input = z.object({ included: z.boolean() }).parse(req.body);
    const thread = await requireThread(userId, id);
    const items = await storage.thoughtThreadItems.getByThread(id, userId);
    if (!items.some((item) => item.id === targetItemId)) return res.status(404).json({ error: "Thread recording not found." });
    const updatedThread = await storage.thoughtThreads.commitMutation(
      id,
      userId,
      thread.version,
      {
        threadUpdates: sourceMutationThreadUpdates(thread),
        updateItems: [{ id: targetItemId, updates: { included: input.included } }],
      },
    );
    if (!updatedThread) return res.status(409).json({ error: "This Thought Thread changed on another device. Reload it and try again." });
    res.json(await hydrateThread(updatedThread));
  } catch (error: any) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: error.issues[0]?.message });
    res.status(error.status || 500).json({ error: error.message || "We had trouble updating that source." });
  }
});

router.delete("/thought-threads/:id/items/:itemId", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = getRequiredRouteUserId(req);
    if (!await requireThoughtThreadCloudSync(userId, res)) return;
    const id = getRouteParam(req.params.id, "id");
    const targetItemId = getRouteParam(req.params.itemId, "itemId");
    const thread = await requireThread(userId, id);
    const items = await storage.thoughtThreadItems.getByThread(id, userId);
    if (!items.some((item) => item.id === targetItemId)) return res.status(404).json({ error: "Thread recording not found." });
    const remaining = items.filter((item) => item.id !== targetItemId);
    const updatedThread = await storage.thoughtThreads.commitMutation(
      id,
      userId,
      thread.version,
      {
        threadUpdates: sourceMutationThreadUpdates(thread, {
          recordingCount: remaining.length,
        }),
        deleteItemIds: [targetItemId],
        updateItems: remaining
          .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id))
          .map((item, position) => ({ id: item.id, updates: { position } })),
      },
    );
    if (!updatedThread) return res.status(409).json({ error: "This Thought Thread changed on another device. Reload it and try again." });
    res.json(await hydrateThread(updatedThread));
  } catch (error: any) {
    res.status(error.status || 500).json({ error: error.message || "We had trouble removing that source." });
  }
});

router.post("/thought-threads/:id/reorder", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = getRequiredRouteUserId(req);
    if (!await requireThoughtThreadCloudSync(userId, res)) return;
    const id = getRouteParam(req.params.id, "id");
    const input = z.object({
      itemIds: z.array(z.string().trim().min(1)).min(1).max(MAX_THREAD_RECORDINGS),
      expectedVersion: z.number().int().positive().optional(),
    }).parse(req.body);
    const thread = await requireThread(userId, id);
    if (input.expectedVersion !== undefined && thread.version !== input.expectedVersion) {
      return res.status(409).json({ error: "This Thought Thread changed on another device. Reload it and try again." });
    }
    const items = await storage.thoughtThreadItems.getByThread(id, userId);
    if (new Set(input.itemIds).size !== items.length || items.some((item) => !input.itemIds.includes(item.id))) {
      return res.status(400).json({ error: "The order must include every current thread recording exactly once." });
    }
    const updatedThread = await storage.thoughtThreads.commitMutation(
      id,
      userId,
      thread.version,
      {
        threadUpdates: sourceMutationThreadUpdates(thread, {
          orderingMode: "manual",
        }),
        updateItems: input.itemIds.map((value, position) => ({
          id: value,
          updates: { position },
        })),
      },
    );
    if (!updatedThread) return res.status(409).json({ error: "This Thought Thread changed on another device. Reload it and try again." });
    res.json(await hydrateThread(updatedThread));
  } catch (error: any) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: error.issues[0]?.message });
    res.status(error.status || 500).json({ error: error.message || "We had trouble reordering that Thought Thread." });
  }
});

router.post("/thought-threads/:id/reset-chronology", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = getRequiredRouteUserId(req);
    if (!await requireThoughtThreadCloudSync(userId, res)) return;
    const id = getRouteParam(req.params.id, "id");
    const thread = await requireThread(userId, id);
    const items = await storage.thoughtThreadItems.getByThread(id, userId);
    const ordered = [...items].sort((a, b) =>
      new Date(a.sourceCreatedAt).getTime() - new Date(b.sourceCreatedAt).getTime()
      || a.recordingId.localeCompare(b.recordingId));
    const updatedThread = await storage.thoughtThreads.commitMutation(
      id,
      userId,
      thread.version,
      {
        threadUpdates: sourceMutationThreadUpdates(thread, {
          orderingMode: "chronological",
        }),
        updateItems: ordered.map((item, position) => ({
          id: item.id,
          updates: { position },
        })),
      },
    );
    if (!updatedThread) return res.status(409).json({ error: "This Thought Thread changed on another device. Reload it and try again." });
    res.json(await hydrateThread(updatedThread));
  } catch (error: any) {
    res.status(error.status || 500).json({ error: error.message || "We had trouble restoring chronological order." });
  }
});

router.post("/thought-threads/:id/contexts", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = getRequiredRouteUserId(req);
    if (!await requireThoughtThreadCloudSync(userId, res)) return;
    const id = getRouteParam(req.params.id, "id");
    const input = contextSchema.parse(req.body);
    const thread = await requireThread(userId, id);
    const existing = await storage.thoughtThreadContexts.getByThread(id, userId);
    if (existing.length >= MAX_THREAD_CONTEXTS) {
      return res.status(409).json({ error: `A Thought Thread can contain up to ${MAX_THREAD_CONTEXTS} context entries.` });
    }
    assertContextAggregateSize(existing, input.text);
    await assertContextRelationshipTarget(
      id,
      userId,
      input.relationship,
      input.relatedSourceId,
    );
    const now = new Date().toISOString();
    const nextPosition = existing.reduce((max, context) => Math.max(max, context.position), -1) + 1;
    const context = {
      id: contextId(),
      userId,
      threadId: id,
      kind: input.kind,
      label: input.label || "Additional context",
      text: input.text,
      revision: 1,
      derivedTextHash: createHash("sha256").update(input.text.trim()).digest("hex"),
      relationship: input.relationship || null,
      relatedSourceId: input.relatedSourceId || null,
      position: nextPosition,
      createdAt: now,
      updatedAt: now,
    };
    const updatedThread = await storage.thoughtThreads.commitMutation(
      id,
      userId,
      thread.version,
      {
        threadUpdates: sourceMutationThreadUpdates(thread, {
          contextCount: existing.length + 1,
        }),
        createContexts: [context],
      },
    );
    if (!updatedThread) return res.status(409).json({ error: "This Thought Thread changed on another device. Reload it and try again." });
    trackEvent("thought_thread_context_added", userId, { kind: input.kind });
    res.status(201).json(await hydrateThread(updatedThread));
  } catch (error: any) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: error.issues[0]?.message });
    res.status(error.status || 500).json({ error: error.message || "We had trouble adding that context." });
  }
});

router.post(
  "/thought-threads/:id/contexts/file",
  requireAuth,
  contextFileUpload.single("file"),
  async (req: Request, res: Response) => {
    let uploadedBucketKey: string | null = null;
    let bucketFileId: string | null = null;
    try {
      const userId = getRequiredRouteUserId(req);
      if (!await requireThoughtThreadCloudSync(userId, res)) return;
      const id = getRouteParam(req.params.id, "id");
      if (!req.file) return res.status(400).json({ error: "Choose a file to add." });
      const thread = await requireThread(userId, id);
      const existing = await storage.thoughtThreadContexts.getByThread(id, userId);
      if (existing.length >= MAX_THREAD_CONTEXTS) {
        return res.status(409).json({ error: `A Thought Thread can contain up to ${MAX_THREAD_CONTEXTS} context entries.` });
      }

      const dottedExtension = path.extname(req.file.originalname).toLowerCase();
      const extension = dottedExtension.replace(/^\./, "");
      if (!SUPPORTED_CONTEXT_FILE_EXTENSIONS.has(extension)) {
        return res.status(400).json({ error: "We do not support that file type for Thought Thread context." });
      }
      const allowedForUser = await getAllowedFileTypes(userId);
      if (!allowedForUser.includes(dottedExtension)) {
        return res.status(403).json({
          error: "file_type_locked",
          ext: dottedExtension,
          requiredTier: getRequiredTierForFileType(dottedExtension) || "base",
        });
      }
      const maxImportBytes = await getMaxFileImportSize(userId);
      if (req.file.size > maxImportBytes) {
        return res.status(413).json({
          error: "file_too_large",
          size: req.file.size,
          limitBytes: maxImportBytes,
        });
      }

      const parsedText = (await extractDocumentText(req.file.buffer, extension)).trim();
      if (!parsedText) {
        return res.status(400).json({ error: "We could not find any text in that file." });
      }
      const extractedBytes = Buffer.byteLength(parsedText, "utf8");
      if (extractedBytes > MAX_CONTEXT_BYTES || parsedText.length > MAX_CONTEXT_CHARS) {
        return res.status(413).json({
          error: "The extracted file text is too large for one context entry. Split the source file and upload the parts separately.",
          extractedBytes,
          limitBytes: MAX_CONTEXT_BYTES,
          truncated: false,
        });
      }
      assertContextAggregateSize(existing, parsedText);

      const [storageLimit, usedStorageBytes] = await Promise.all([
        getStorageLimit(userId),
        getTotalUserStorageUsed(userId),
      ]);
      if (storageLimit === 0 || usedStorageBytes + req.file.size > storageLimit) {
        return res.status(413).json({ error: "Storage limit exceeded while retaining the supporting file." });
      }

      uploadedBucketKey = generateBucketKey(userId, "file", req.file.originalname);
      await uploadBucketFile(uploadedBucketKey, req.file.buffer);
      const bucketFile = await createBucketFileRecord({
        userId,
        bucketKey: uploadedBucketKey,
        originalName: req.file.originalname,
        mimeType: req.file.mimetype || "application/octet-stream",
        fileSize: req.file.size,
        category: "file",
      });
      bucketFileId = bucketFile.id;

      const now = new Date().toISOString();
      const context = {
        id: contextId(),
        userId,
        threadId: id,
        kind: "file" as const,
        label: req.file.originalname,
        text: parsedText,
        originalFilename: req.file.originalname,
        sourceMimeType: req.file.mimetype || "application/octet-stream",
        sourceFileSize: req.file.size,
        sourceHash: createHash("sha256").update(req.file.buffer).digest("hex"),
        parserVersion: DOCUMENT_PARSER_VERSION,
        truncated: false,
        contentEdited: false,
        revision: 1,
        derivedTextHash: createHash("sha256").update(parsedText).digest("hex"),
        relationship: null,
        relatedSourceId: null,
        sourceBucketFileId: bucketFile.id,
        position: existing.reduce((max, value) => Math.max(max, value.position), -1) + 1,
        createdAt: now,
        updatedAt: now,
      };
      const updatedThread = await storage.thoughtThreads.commitMutation(
        id,
        userId,
        thread.version,
        {
          threadUpdates: sourceMutationThreadUpdates(thread, {
            contextCount: existing.length + 1,
          }),
          createContexts: [context],
        },
      );
      if (!updatedThread) {
        await deleteBucketFileRecord(bucketFile.id, userId);
        bucketFileId = null;
        uploadedBucketKey = null;
        return res.status(409).json({ error: "This Thought Thread changed on another device. Reload it and try again." });
      }
      trackEvent("thought_thread_context_added", userId, { kind: "file" });
      res.status(201).json(await hydrateThread(updatedThread));
    } catch (error: any) {
      if (bucketFileId && req.userId) {
        await deleteBucketFileRecord(bucketFileId, req.userId).catch(() => undefined);
      } else if (uploadedBucketKey) {
        await deleteBucketObject(uploadedBucketKey).catch(() => undefined);
      }
      res.status(error?.status || 500).json({
        error: error?.message || "We had trouble retaining and reading that file.",
      });
    }
  },
);

router.patch("/thought-threads/:id/contexts/:contextId", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = getRequiredRouteUserId(req);
    if (!await requireThoughtThreadCloudSync(userId, res)) return;
    const id = getRouteParam(req.params.id, "id");
    const targetContextId = getRouteParam(req.params.contextId, "contextId");
    const input = contextUpdateSchema.parse(req.body);
    const thread = await requireThread(userId, id);
    const contexts = await storage.thoughtThreadContexts.getByThread(id, userId);
    const targetContext = contexts.find((context) => context.id === targetContextId);
    if (!targetContext) return res.status(404).json({ error: "Context not found." });
    if (input.text !== undefined) {
      assertContextAggregateSize(contexts, input.text, targetContextId);
    }
    const nextRelationship = input.relationship !== undefined
      ? input.relationship
      : targetContext.relationship;
    const nextRelatedSourceId = input.relatedSourceId !== undefined
      ? input.relatedSourceId
      : targetContext.relatedSourceId;
    await assertContextRelationshipTarget(
      id,
      userId,
      nextRelationship,
      nextRelatedSourceId,
      targetContextId,
    );
    const updatedThread = await storage.thoughtThreads.commitMutation(
      id,
      userId,
      thread.version,
      {
        threadUpdates: sourceMutationThreadUpdates(thread),
        updateContexts: [{
          id: targetContextId,
          updates: {
            ...input,
            revision: (targetContext.revision || 1) + 1,
            ...(input.text !== undefined
              ? {
                  derivedTextHash: createHash("sha256")
                    .update(input.text.trim())
                    .digest("hex"),
                }
              : {}),
            ...(targetContext.kind === "file" && input.text !== undefined
              ? { contentEdited: input.text.trim() !== targetContext.text.trim() || targetContext.contentEdited === true }
              : {}),
          },
        }],
      },
    );
    if (!updatedThread) return res.status(409).json({ error: "This Thought Thread changed on another device. Reload it and try again." });
    res.json(await hydrateThread(updatedThread));
  } catch (error: any) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: error.issues[0]?.message });
    res.status(error.status || 500).json({ error: error.message || "We had trouble updating that context." });
  }
});

router.delete("/thought-threads/:id/contexts/:contextId", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = getRequiredRouteUserId(req);
    if (!await requireThoughtThreadCloudSync(userId, res)) return;
    const id = getRouteParam(req.params.id, "id");
    const targetContextId = getRouteParam(req.params.contextId, "contextId");
    const initialContexts = await storage.thoughtThreadContexts.getByThread(id, userId);
    const initialTarget = initialContexts.find((context) => context.id === targetContextId);
    if (!initialTarget) return res.status(404).json({ error: "Context not found." });

    // Preserve a retry path: the context and its bucket pointer stay intact if
    // object deletion fails. Bucket deletion itself is idempotent.
    if (initialTarget.sourceBucketFileId) {
      await deleteBucketFileRecord(initialTarget.sourceBucketFileId, userId);
    }

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const thread = await requireThread(userId, id);
      const contexts = await storage.thoughtThreadContexts.getByThread(id, userId);
      if (!contexts.some((context) => context.id === targetContextId)) {
        return res.json(await hydrateThread(thread));
      }
      const remaining = contexts.filter((context) => context.id !== targetContextId);
      const updatedThread = await storage.thoughtThreads.commitMutation(
        id,
        userId,
        thread.version,
        {
          threadUpdates: sourceMutationThreadUpdates(thread, {
            contextCount: remaining.length,
          }),
          deleteContextIds: [targetContextId],
          updateContexts: remaining
            .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id))
            .map((context, position) => ({ id: context.id, updates: { position } })),
        },
      );
      if (updatedThread) return res.json(await hydrateThread(updatedThread));
    }
    return res.status(409).json({
      error: "The retained file was removed, but the Thread changed concurrently. Retry removing the context to finish.",
    });
  } catch (error: any) {
    res.status(error.status || 500).json({ error: error.message || "We had trouble removing that context." });
  }
});

router.post("/thought-threads/:id/conversion-plan", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = getRequiredRouteUserId(req);
    if (!await requireThoughtThreadCloudSync(userId, res)) return;
    const id = getRouteParam(req.params.id, "id");
    const input = conversionOptionsSchema.pick({ conversionType: true }).parse(req.body);
    const thread = await requireThread(userId, id);
    const [items, contexts, preferences] = await Promise.all([
      storage.thoughtThreadItems.getByThread(id, userId),
      storage.thoughtThreadContexts.getByThread(id, userId),
      getUserConversionModelPreferences(userId),
    ]);
    const sourceItems = (await Promise.all(items.map(async (item) => {
      const recording = await storage.recordings.get(item.recordingId, userId);
      return recording ? { ...item, recording } : null;
    }))).filter((item): item is ThoughtThreadSourceItem => item !== null);
    const assembled = buildThoughtThreadSource(sourceItems, contexts, thread.orderingMode);
    const routeChain = resolveConversionModelRouteChain(input.conversionType, preferences);
    const typeCheck = await isConversionTypeAllowed(userId, input.conversionType);
    if (!typeCheck.allowed) {
      return res.status(403).json({
        error: "conversion_type_locked",
        message: "This conversion type is not available on your current plan or enabled modules.",
        requiredTier: typeCheck.requiredTier,
        requiredModule: typeCheck.requiredModule,
        moduleEligible: typeCheck.moduleEligible,
        moduleEnabled: typeCheck.moduleEnabled,
      });
    }
    const directTokenLimit = Math.min(
      ...routeChain.routes.map((route) => getConversionModelInputLimit(route)),
    );
    const blocked = assembled.byteLength > THOUGHT_THREAD_MAX_SOURCE_BYTES;
    res.json({
      estimatedTokens: assembled.estimatedTokens,
      sourceBytes: assembled.byteLength,
      directTokenLimit,
      absoluteTokenLimit: Math.floor(THOUGHT_THREAD_MAX_SOURCE_BYTES / 2),
      absoluteByteLimit: THOUGHT_THREAD_MAX_SOURCE_BYTES,
      strategy: blocked
        ? "blocked"
        : assembled.estimatedTokens <= directTokenLimit ? "direct" : "hierarchical",
      model: routeChain.routes[0].model,
      sourceRecordingCount: assembled.sourceRecordingIds.length,
      contextCount: assembled.contextEntryIds.length,
    });
  } catch (error: any) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: error.issues[0]?.message });
    res.status(error.status || 500).json({ error: error.message || "We had trouble planning that conversion." });
  }
});

router.post("/thought-threads/:id/prepare-conversion", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = getRequiredRouteUserId(req);
    if (!await requireThoughtThreadCloudSync(userId, res)) return;
    const id = getRouteParam(req.params.id, "id");
    const input = conversionOptionsSchema.parse(req.body);
    const thread = await requireThread(userId, id);
    const typeCheck = await isConversionTypeAllowed(userId, input.conversionType);
    if (!typeCheck.allowed) {
      return res.status(403).json({
        error: "conversion_type_locked",
        message: "This conversion type is not available on your current plan or enabled modules.",
        tier: typeCheck.tier,
        requiredTier: typeCheck.requiredTier,
        requiredModule: typeCheck.requiredModule,
        moduleEligible: typeCheck.moduleEligible,
        moduleEnabled: typeCheck.moduleEnabled,
      });
    }
    const [items, contexts, preferences] = await Promise.all([
      storage.thoughtThreadItems.getByThread(id, userId),
      storage.thoughtThreadContexts.getByThread(id, userId),
      getUserConversionModelPreferences(userId),
    ]);
    const sourceItems = (await Promise.all(items.map(async (item) => {
      const recording = await storage.recordings.get(item.recordingId, userId);
      return recording ? { ...item, recording } : null;
    }))).filter((item): item is ThoughtThreadSourceItem => item !== null);
    const assembled = buildThoughtThreadSource(sourceItems, contexts, thread.orderingMode);
    if (assembled.sourceRecordingIds.length === 0 && assembled.contextEntryIds.length === 0) {
      return res.status(400).json({ error: "Include at least one transcribed recording or context entry before converting." });
    }
    if (assembled.byteLength > THOUGHT_THREAD_MAX_SOURCE_BYTES) {
      return res.status(413).json({
        error: "This Thought Thread exceeds the maximum immutable source size.",
        estimatedTokens: assembled.estimatedTokens,
        sourceBytes: assembled.byteLength,
        limitBytes: THOUGHT_THREAD_MAX_SOURCE_BYTES,
      });
    }

    const routeChain = resolveConversionModelRouteChain(input.conversionType, preferences);
    const modelRoutes = routeChain.routes.map((route) => ({
      ...route,
      inputTokenLimit: getConversionModelInputLimit(route),
    }));
    // A direct snapshot must fit every configured fallback, not just the
    // primary model. Otherwise fallback routing can fail on source size.
    const directLimit = Math.min(...modelRoutes.map((route) => route.inputTokenLimit));
    const modelStrategy: ThoughtThreadModelStrategy =
      assembled.estimatedTokens <= directLimit ? "direct" : "hierarchical";
    const currentThread = await storage.thoughtThreads.get(id, userId);
    if (!currentThread || currentThread.version !== thread.version) {
      return res.status(409).json({
        error: "This Thought Thread changed while its source was being prepared. Reload it and try again.",
      });
    }
    const now = new Date().toISOString();
    const sourceHash = createHash("sha256").update(assembled.source).digest("hex");
    const existingRuns = await storage.thoughtThreadRuns.getByThread(id, userId);
    const matchesRequestedRun = (candidate: ThoughtThreadConversionRun) =>
      candidate.sourceHash === sourceHash
      && candidate.conversionType === input.conversionType
      && (candidate.citationStyle || null) === (input.citationStyle || null)
      && (candidate.bibliographyType || null) === (input.bibliographyType || null)
      && (candidate.outputFormat || "markdown") === input.outputFormat
      && (candidate.language || null) === (input.language || null)
      && (candidate.customPrompt || null) === (input.customPrompt || null);
    const reusable = existingRuns.find((candidate) =>
      candidate.status === "prepared" && matchesRequestedRun(candidate));
    if (reusable) {
      return res.json({
        run: publicRun(reusable),
        directTokenLimit: directLimit,
        threadVersion: currentThread.version,
        reused: true,
      });
    }
    const retryable = existingRuns.find((candidate) =>
      candidate.status === "failed"
      && !!candidate.preparedHash
      && matchesRequestedRun(candidate));
    if (retryable) {
      return res.json({
        run: publicRun(retryable),
        directTokenLimit: directLimit,
        threadVersion: currentThread.version,
        reused: true,
        requiresRetry: true,
      });
    }
    const limitCheck = await checkLimit(userId, "conversion", input.conversionType);
    if (!limitCheck.allowed) {
      return res.status(429).json({
        error: limitCheck.spendingCapReached ? "spending_cap_reached" : "monthly_limit_reached",
        message: limitCheck.spendingCapReached
          ? "You have reached your monthly spending cap for conversion overages."
          : "You have used all included conversions for this month.",
        current: limitCheck.current,
        limit: limitCheck.limit,
      });
    }
    if (limitCheck.isExtendedAccess && !limitCheck.proAccessEnabled && !input.confirmExtendedAccess) {
      return res.status(402).json({
        error: "pro_access_required",
        message: "This conversion requires confirmation before using paid overage capacity.",
        actionType: "conversion",
        unitCost: limitCheck.extendedUnitCost,
        current: limitCheck.current,
        limit: limitCheck.limit,
        extendedCostSoFar: limitCheck.extendedCostSoFar,
      });
    }
    const newRunId = runId();
    const reservation = await reserveUsageForRun(
      userId,
      "conversion",
      newRunId,
      getUsageReservationCeiling("conversion", limitCheck),
    );
    if (!reservation) {
      return res.status(429).json({
        error: "monthly_limit_reached",
        message: "Your remaining conversion capacity was reserved by another request. Retry after it completes or expires.",
        current: limitCheck.current,
        limit: limitCheck.limit,
      });
    }
    let run: ThoughtThreadConversionRun = {
      id: newRunId,
      userId,
      threadId: id,
      conversionType: input.conversionType,
      status: modelStrategy === "direct" ? "prepared" : "preparing",
      sourceRecordingIds: assembled.sourceRecordingIds,
      contextEntryIds: assembled.contextEntryIds,
      sourceSnapshot: null,
      preparedSource: null,
      sourceHash,
      preparedHash: modelStrategy === "direct" ? sourceHash : null,
      sourceVersion: thread.sourceRevision || 1,
      sourceByteLength: assembled.byteLength,
      preparedByteLength: modelStrategy === "direct" ? assembled.byteLength : null,
      estimatedTokens: assembled.estimatedTokens,
      modelStrategy,
      modelRoutes,
      directTokenLimit: directLimit,
      promptVersion: THOUGHT_THREAD_PROMPT_VERSION,
      customPromptHash: input.customPrompt
        ? createHash("sha256").update(input.customPrompt.trim()).digest("hex")
        : null,
      modelPreferenceHash: createHash("sha256")
        .update(JSON.stringify(preferences))
        .digest("hex"),
      sourceManifest: buildSourceManifest(
        assembled,
        thread.orderingMode,
        sourceHash,
      ),
      citationStyle: input.citationStyle || null,
      bibliographyType: input.bibliographyType || null,
      outputFormat: input.outputFormat,
      language: input.language || null,
      customPrompt: input.customPrompt || null,
      clarificationQuestion: input.clarificationQuestion || null,
      clarificationAnswer: input.clarificationAnswer || null,
      usageReserved: !!reservation,
      usageStatus: reservation ? "reserved" : "not_required",
      usageReservationId: reservation?.id || null,
      attemptCount: 0,
      progressCompleted: modelStrategy === "direct" ? 1 : 0,
      progressTotal: modelStrategy === "direct" ? 1 : null,
      leaseExpiresAt: null,
      leaseToken: null,
      startedAt: null,
      updatedAt: now,
      actualProvider: null,
      actualModel: null,
      output: null,
      fileId: null,
      error: null,
      createdAt: now,
      completedAt: null,
    };
    const sourceChunks = buildRunChunks(run, "source", assembled.source);
    const runThread = await storage.thoughtThreads.createRunWithChunks(
      id,
      userId,
      thread.version,
      run,
      sourceChunks,
    );
    if (!runThread) {
      if (reservation) {
        await settleUsageForRun(userId, reservation.id, "released").catch(() => undefined);
      }
      return res.status(409).json({
        error: "This Thought Thread changed while its snapshot was being frozen. Reload it and try again.",
      });
    }
    if (modelStrategy === "hierarchical") {
      try {
        // Local development uses the same durable, leased worker in-process;
        // deployed environments enqueue an authenticated Cloud Task.
        await scheduleHierarchicalPreparation(run);
      } catch (preparationError: any) {
        await failThoughtThreadRun(run.id, id, userId, preparationError);
        throw preparationError;
      }
    }
    trackEvent("thought_thread_conversion_prepared", userId, {
      recordingCount: run.sourceRecordingIds.length,
      contextCount: run.contextEntryIds.length,
      strategy: modelStrategy,
      estimatedTokens: run.estimatedTokens,
    });
    res.status(modelStrategy === "hierarchical" ? 202 : 201).json({
      run: publicRun(run),
      directTokenLimit: directLimit,
      threadVersion: runThread.version,
      reused: false,
    });
  } catch (error: any) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: error.issues[0]?.message });
    res.status(error.status || 500).json({ error: error.message || "We had trouble preparing that Thought Thread." });
  }
});

router.post("/thought-threads/:id/runs/:runId/complete", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = getRequiredRouteUserId(req);
    if (!await requireThoughtThreadCloudSync(userId, res)) return;
    const id = getRouteParam(req.params.id, "id");
    const targetRunId = getRouteParam(req.params.runId, "runId");
    await requireThread(userId, id);
    const run = await storage.thoughtThreadRuns.get(targetRunId, id, userId);
    if (!run) return res.status(404).json({ error: "Conversion run not found." });
    if (run.status === "completed") return res.json({ run: publicRun(run) });
    return res.status(409).json({
      error: "Thought Thread runs are finalized by the server-owned conversion stream.",
    });
  } catch (error: any) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: error.issues[0]?.message });
    res.status(error.status || 500).json({ error: error.message || "We had trouble completing that conversion run." });
  }
});

router.get("/thought-threads/:id/runs/:runId", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = getRequiredRouteUserId(req);
    if (!await requireThoughtThreadCloudSync(userId, res)) return;
    const id = getRouteParam(req.params.id, "id");
    const targetRunId = getRouteParam(req.params.runId, "runId");
    await requireThread(userId, id);
    const run = await storage.thoughtThreadRuns.get(targetRunId, id, userId);
    if (!run) return res.status(404).json({ error: "Conversion run not found." });
    return res.json({ run: publicRun(run) });
  } catch (error: any) {
    return res.status(error.status || 500).json({
      error: error.message || "We had trouble loading that conversion run.",
    });
  }
});

router.post("/thought-threads/:id/runs/:runId/cancel", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = getRequiredRouteUserId(req);
    if (!await requireThoughtThreadCloudSync(userId, res)) return;
    const id = getRouteParam(req.params.id, "id");
    const targetRunId = getRouteParam(req.params.runId, "runId");
    await requireThread(userId, id);
    const current = await storage.thoughtThreadRuns.get(targetRunId, id, userId);
    if (!current) return res.status(404).json({ error: "Conversion run not found." });
    if (current.status === "completed" || current.status === "cancelled") {
      return res.json({ run: publicRun(current) });
    }
    const cancelledAt = new Date().toISOString();
    let cancelled = await storage.thoughtThreadRuns.transition(
      targetRunId,
      id,
      userId,
      ["preparing", "prepared", "converting", "failed"],
      {
        status: "cancelled",
        error: null,
        completedAt: cancelledAt,
        updatedAt: cancelledAt,
        leaseToken: null,
        leaseExpiresAt: null,
      },
    );
    if (!cancelled) {
      const winner = await storage.thoughtThreadRuns.get(targetRunId, id, userId);
      return res.status(409).json({
        error: `This conversion run is already ${winner?.status || "changing"}.`,
      });
    }
    if (cancelled.usageStatus === "reserved" || cancelled.usageReserved === true) {
      const settled = await settleUsageForRun(
        userId,
        cancelled.usageReservationId,
        "released",
      );
      if (settled?.status === "released") {
        cancelled = await storage.thoughtThreadRuns.update(targetRunId, userId, {
          usageStatus: "released",
          usageReserved: false,
          updatedAt: new Date().toISOString(),
        }) || cancelled;
      }
    }
    return res.json({ run: publicRun(cancelled) });
  } catch (error: any) {
    return res.status(error.status || 500).json({
      error: error.message || "We had trouble cancelling that conversion run.",
    });
  }
});

router.post("/thought-threads/:id/runs/:runId/retry", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = getRequiredRouteUserId(req);
    if (!await requireThoughtThreadCloudSync(userId, res)) return;
    const id = getRouteParam(req.params.id, "id");
    const targetRunId = getRouteParam(req.params.runId, "runId");
    const input = z.object({ confirmExtendedAccess: z.boolean().optional() }).parse(req.body || {});
    await requireThread(userId, id);
    const current = await storage.thoughtThreadRuns.get(targetRunId, id, userId);
    if (!current) return res.status(404).json({ error: "Conversion run not found." });
    if (current.status === "completed") {
      return res.json({ run: publicRun(current) });
    }
    if (current.status === "prepared") {
      if (current.usageStatus !== "reserved" || !current.usageReservationId) {
        return res.json({ run: publicRun(current) });
      }
      const existingReservation = await storage.usageReservations.get(
        current.usageReservationId,
        userId,
      );
      const reservationCurrent = existingReservation?.status === "committed"
        || (
          existingReservation?.status === "reserved"
          && new Date(existingReservation.expiresAt).getTime() > Date.now()
        );
      if (reservationCurrent) {
        return res.json({ run: publicRun(current) });
      }
    }
    if (current.status === "converting") {
      const leaseExpiresAt = current.leaseExpiresAt
        ? new Date(current.leaseExpiresAt).getTime()
        : 0;
      if (Number.isFinite(leaseExpiresAt) && leaseExpiresAt > Date.now()) {
        return res.status(409).json({ error: "This conversion is still active." });
      }
    }
    const limitCheck = await checkLimit(userId, "conversion", current.conversionType);
    if (!limitCheck.allowed) {
      return res.status(429).json({
        error: limitCheck.spendingCapReached ? "spending_cap_reached" : "monthly_limit_reached",
        message: "No conversion capacity is currently available for this retry.",
        current: limitCheck.current,
        limit: limitCheck.limit,
      });
    }
    if (limitCheck.isExtendedAccess && !limitCheck.proAccessEnabled && !input.confirmExtendedAccess) {
      return res.status(402).json({
        error: "pro_access_required",
        message: "This retry requires confirmation before using paid overage capacity.",
        actionType: "conversion",
        unitCost: limitCheck.extendedUnitCost,
        current: limitCheck.current,
        limit: limitCheck.limit,
        extendedCostSoFar: limitCheck.extendedCostSoFar,
      });
    }
    const nextAttempt = (current.attemptCount || 0) + 1;
    const reservation = await reserveUsageForRun(
      userId,
      "conversion",
      current.id,
      getUsageReservationCeiling("conversion", limitCheck),
      `${current.id}_attempt_${nextAttempt}`,
    );
    if (!reservation) {
      return res.status(429).json({
        error: "monthly_limit_reached",
        message: "Conversion capacity is reserved by another request. Retry shortly.",
      });
    }
    const targetStatus = current.preparedHash ? "prepared" : "preparing";
    const retried = await storage.thoughtThreadRuns.transition(
      current.id,
      id,
      userId,
      ["failed", "cancelled", "converting", "preparing", "prepared"],
      {
        status: targetStatus,
        error: null,
        completedAt: null,
        updatedAt: new Date().toISOString(),
        usageStatus: reservation ? "reserved" : "not_required",
        usageReservationId: reservation?.id || null,
        usageReserved: !!reservation,
        leaseToken: null,
        leaseExpiresAt: null,
        progressCompleted: targetStatus === "prepared" ? current.progressCompleted : 0,
        attemptCount: nextAttempt,
      },
    );
    if (!retried) {
      if (reservation) {
        await settleUsageForRun(userId, reservation.id, "released").catch(() => undefined);
      }
      return res.status(409).json({ error: "This conversion run changed while it was being retried." });
    }
    if (retried.status === "preparing") await scheduleHierarchicalPreparation(retried);
    return res.status(retried.status === "preparing" ? 202 : 200).json({
      run: publicRun(retried),
    });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.issues[0]?.message });
    }
    return res.status(error.status || 500).json({
      error: error.message || "We had trouble retrying that conversion run.",
    });
  }
});

router.patch("/thought-threads/:id/runs/:runId/clarification", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = getRequiredRouteUserId(req);
    if (!await requireThoughtThreadCloudSync(userId, res)) return;
    const id = getRouteParam(req.params.id, "id");
    const targetRunId = getRouteParam(req.params.runId, "runId");
    const input = z.object({
      question: z.string().trim().min(1).max(1_000),
      answer: z.string().trim().min(1).max(4_000),
    }).parse(req.body);
    await requireThread(userId, id);
    const updated = await storage.thoughtThreadRuns.transition(
      targetRunId,
      id,
      userId,
      ["prepared"],
      {
        status: "prepared",
        clarificationQuestion: input.question,
        clarificationAnswer: input.answer,
      },
    );
    if (!updated) {
      const current = await storage.thoughtThreadRuns.get(targetRunId, id, userId);
      if (!current) return res.status(404).json({ error: "Conversion run not found." });
      return res.status(409).json({ error: "This conversion run is no longer awaiting clarification." });
    }
    res.json({ run: publicRun(updated) });
  } catch (error: any) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: error.issues[0]?.message });
    res.status(error.status || 500).json({ error: error.message || "We had trouble saving that clarification." });
  }
});

router.post("/thought-threads/:id/runs/:runId/failed", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = getRequiredRouteUserId(req);
    if (!await requireThoughtThreadCloudSync(userId, res)) return;
    const id = getRouteParam(req.params.id, "id");
    const targetRunId = getRouteParam(req.params.runId, "runId");
    const input = z.object({ error: z.string().trim().max(500).default("Conversion failed.") }).parse(req.body);
    await requireThread(userId, id);
    const run = await storage.thoughtThreadRuns.get(targetRunId, id, userId);
    if (!run) return res.status(404).json({ error: "Conversion run not found." });
    if (run.status === "completed" || run.status === "failed") {
      return res.json({ run: publicRun(run) });
    }
    const updatedRun = await failThoughtThreadRun(targetRunId, id, userId, input.error);
    res.json({ run: updatedRun ? publicRun(updatedRun) : null });
  } catch (error: any) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: error.issues[0]?.message });
    res.status(error.status || 500).json({ error: error.message || "We had trouble recording that failed run." });
  }
});

export default router;
