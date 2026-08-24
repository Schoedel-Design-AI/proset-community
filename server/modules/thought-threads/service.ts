import { createHash } from "node:crypto";
import type {
  Recording,
  ThoughtThreadConversionRun,
  ThoughtThreadRunChunk,
  ThoughtThreadRunChunkKind,
  UserFile,
} from "@shared/schema";
import {
  splitTextByUtf8Bytes,
  thoughtThreadByteLength,
} from "@shared/thought-thread-source";
import { CONVERSION_TYPES } from "../../../lib/utils";
import { storage } from "../../storage";
import { trackEvent } from "../../analytics-service";
import { getStorageLimit } from "../../usage-service";
import {
  COMBINED_FOLDER_NAME,
  ensureSystemFolders,
  getTotalUserStorageUsed,
} from "../recordings/utils";

function digest(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export function buildRunChunks(
  run: Pick<ThoughtThreadConversionRun, "id" | "threadId" | "userId" | "createdAt">,
  kind: ThoughtThreadRunChunkKind,
  text: string,
): ThoughtThreadRunChunk[] {
  return splitTextByUtf8Bytes(text).map((chunkText, index) => ({
    id: `${run.id}_${kind}_${String(index).padStart(4, "0")}`,
    userId: run.userId,
    threadId: run.threadId,
    runId: run.id,
    kind,
    index,
    text: chunkText,
    byteLength: thoughtThreadByteLength(chunkText),
    hash: digest(chunkText),
    createdAt: run.createdAt,
  }));
}

async function loadChunkedText(
  run: ThoughtThreadConversionRun,
  kind: ThoughtThreadRunChunkKind,
): Promise<string> {
  const chunks = await storage.thoughtThreadRunChunks.getByRun(
    run.id,
    run.threadId,
    run.userId,
    kind,
  );
  if (chunks.length === 0) {
    const legacy = kind === "prepared" ? run.preparedSource : run.sourceSnapshot;
    if (legacy) return legacy;
    throw new Error(`The immutable ${kind} source for this run is unavailable.`);
  }
  for (const chunk of chunks) {
    if (thoughtThreadByteLength(chunk.text) !== chunk.byteLength || digest(chunk.text) !== chunk.hash) {
      throw new Error("A Thought Thread source chunk failed its integrity check.");
    }
  }
  return chunks.map((chunk) => chunk.text).join("");
}

export async function loadRunConversionSource(
  run: ThoughtThreadConversionRun,
): Promise<string> {
  const kind: ThoughtThreadRunChunkKind =
    run.modelStrategy === "hierarchical" ? "prepared" : "source";
  const source = await loadChunkedText(run, kind);
  const expectedHash = kind === "prepared" ? run.preparedHash : run.sourceHash;
  if (expectedHash && digest(source) !== expectedHash) {
    throw new Error("The immutable Thought Thread source failed its run-level integrity check.");
  }
  return source;
}

export async function loadRunSourceSnapshot(
  run: ThoughtThreadConversionRun,
): Promise<string> {
  const source = await loadChunkedText(run, "source");
  if (digest(source) !== run.sourceHash) {
    throw new Error("The immutable Thought Thread source failed its run-level integrity check.");
  }
  return source;
}

export async function invalidateThoughtThreadsForRecording(
  recordingId: string,
  userId: string,
  recording?: Recording | null,
): Promise<void> {
  const memberships = await storage.thoughtThreadItems.getByRecording(recordingId, userId);
  for (const membership of memberships) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const thread = await storage.thoughtThreads.get(membership.threadId, userId);
      if (!thread) break;
      const updated = await storage.thoughtThreads.commitMutation(
        thread.id,
        userId,
        thread.version,
        {
          threadUpdates: {
            status: thread.status === "archived" ? "archived" : "open",
            sourceRevision: (thread.sourceRevision || 1) + 1,
          },
          ...(recording
            ? {
                updateItems: [{
                  id: membership.id,
                  updates: {
                    attachedTranscriptRevision: recording.transcriptRevision || 1,
                    attachedTranscriptHash: recording.transcriptHash
                      || digest(recording.transcript || ""),
                  },
                }],
              }
            : {}),
        },
      );
      if (updated) break;
    }
  }
}

export async function beginThoughtThreadRunConversion(
  runId: string,
  threadId: string,
  userId: string,
): Promise<{ run: ThoughtThreadConversionRun; source: string }> {
  const current = await storage.thoughtThreadRuns.get(runId, threadId, userId);
  if (!current) throw Object.assign(new Error("Conversion run not found."), { status: 404 });
  if (current.status === "completed") {
    throw Object.assign(new Error("This conversion run is already complete."), { status: 409 });
  }
  if (current.status !== "prepared") {
    throw Object.assign(new Error("This conversion run is not ready to start."), { status: 409 });
  }
  const startedAt = new Date();
  const transitioned = await storage.thoughtThreadRuns.transition(
    runId,
    threadId,
    userId,
    ["prepared"],
    {
      status: "converting",
      error: null,
      startedAt: current.startedAt || startedAt.toISOString(),
      updatedAt: startedAt.toISOString(),
      attemptCount: (current.attemptCount || 0) + 1,
      leaseExpiresAt: new Date(startedAt.getTime() + 15 * 60 * 1000).toISOString(),
    },
  );
  if (!transitioned) {
    throw Object.assign(new Error("This conversion run was started elsewhere."), { status: 409 });
  }
  try {
    return { run: transitioned, source: await loadRunConversionSource(transitioned) };
  } catch (error) {
    await failThoughtThreadRun(runId, threadId, userId, error);
    throw error;
  }
}

export async function failThoughtThreadRun(
  runId: string,
  threadId: string,
  userId: string,
  reason: unknown,
): Promise<ThoughtThreadConversionRun | undefined> {
  const current = await storage.thoughtThreadRuns.get(runId, threadId, userId);
  if (!current || current.status === "completed" || current.status === "failed") return current;
  const failed = await storage.thoughtThreadRuns.transition(
    runId,
    threadId,
    userId,
    ["preparing", "prepared", "converting"],
    {
      status: "failed",
      error: String(reason instanceof Error ? reason.message : reason || "Conversion failed.").slice(0, 500),
      completedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      leaseExpiresAt: null,
    },
  );
  if (failed?.status === "failed") {
    trackEvent("thought_thread_conversion_failed", userId, {
      strategy: failed.modelStrategy,
    });
  }
  return failed;
}

function outputFileId(runId: string): string {
  return `thread_output_${digest(runId).slice(0, 32)}`;
}

async function touchCompletedThread(
  run: ThoughtThreadConversionRun,
  completedAt: string,
) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const thread = await storage.thoughtThreads.get(run.threadId, run.userId);
    if (!thread) return;
    // A completed historical run is still valid history, but it cannot claim
    // that an edited Thread's current source has been converted.
    if ((thread.sourceRevision || 1) !== run.sourceVersion) return;
    const updated = await storage.thoughtThreads.commitMutation(
      thread.id,
      run.userId,
      thread.version,
      {
        threadUpdates: {
          status: thread.status === "archived" ? "archived" : "ready",
          lastConvertedAt: completedAt,
          lastConvertedRunId: run.id,
          lastConvertedSourceRevision: run.sourceVersion,
        },
      },
    );
    if (updated) return;
  }
}

export async function finalizeThoughtThreadRun(
  runId: string,
  threadId: string,
  userId: string,
  output: string,
  actualRoute?: { provider: string; model: string },
): Promise<{ run: ThoughtThreadConversionRun; file: UserFile }> {
  const current = await storage.thoughtThreadRuns.get(runId, threadId, userId);
  if (!current) throw Object.assign(new Error("Conversion run not found."), { status: 404 });
  if (current.status === "completed" && current.fileId) {
    const existing = await storage.userFiles.get(current.fileId);
    if (existing && existing.userId === userId) {
      return {
        run: await storage.thoughtThreadRuns.get(runId, threadId, userId) || current,
        file: existing,
      };
    }
  }
  if (current.status !== "converting") {
    throw Object.assign(new Error("This conversion run cannot be finalized from its current state."), { status: 409 });
  }

  const thread = await storage.thoughtThreads.get(threadId, userId);
  if (!thread) throw Object.assign(new Error("Thought Thread not found."), { status: 404 });
  const fileSize = Buffer.byteLength(output, "utf8");
  const fileId = outputFileId(runId);
  let file = await storage.userFiles.get(fileId);
  if (file && file.userId !== userId) {
    throw new Error("The deterministic output file ID is already in use.");
  }
  if (!file) {
    const used = await getTotalUserStorageUsed(userId);
    const limit = await getStorageLimit(userId);
    if (limit === 0 || used + fileSize > limit) {
      throw Object.assign(new Error("Storage limit exceeded while saving the conversion output."), {
        status: 413,
      });
    }
    await ensureSystemFolders(userId);
    const folders = await storage.userFolders.getByUser(userId);
    const combinedFolder = folders.find(
      (folder) => folder.name === COMBINED_FOLDER_NAME && folder.isSystem === 1,
    );
    const typeInfo = CONVERSION_TYPES.find((type) => type.value === current.conversionType);
    const conversionLabel = typeInfo?.label || current.conversionType.replace(/_/g, " ");
    const suffix = current.citationStyle
      ? ` (${current.citationStyle.toUpperCase()}${current.bibliographyType === "annotated" ? ", Annotated" : ""})`
      : "";
    const now = new Date().toISOString();
    file = await storage.userFiles.create({
      id: fileId,
      userId,
      name: `${thread.title} — ${conversionLabel}${suffix}`.slice(0, 200),
      content: output,
      conversionType: `${conversionLabel}${suffix}`,
      folderId: combinedFolder?.id || null,
      sourceRecordingId:
        current.sourceRecordingIds.length === 1 ? current.sourceRecordingIds[0] : null,
      sourceRecordingIds: current.sourceRecordingIds,
      sourceThoughtThreadId: threadId,
      sourceThoughtThreadRunId: runId,
      fileSize,
      mimeType: current.outputFormat === "plaintext" ? "text/plain" : "text/markdown",
      createdAt: now,
      updatedAt: now,
    });
  }

  const completedAt = new Date().toISOString();
  const completed = await storage.thoughtThreadRuns.transition(
    runId,
    threadId,
    userId,
    ["converting"],
    {
      status: "completed",
      fileId: file.id,
      completedAt,
      error: null,
      usageStatus: current.usageStatus,
      actualProvider: actualRoute?.provider || current.actualProvider || null,
      actualModel: actualRoute?.model || current.actualModel || null,
      updatedAt: completedAt,
      leaseExpiresAt: null,
    },
  );
  if (!completed) {
    const winner = await storage.thoughtThreadRuns.get(runId, threadId, userId);
    if (!winner || winner.status !== "completed" || winner.fileId !== file.id) {
      throw new Error("The conversion output was saved, but its run could not be finalized.");
    }
    return { run: winner, file };
  }
  const settledRun = completed;
  await touchCompletedThread(settledRun, completedAt);
  trackEvent("thought_thread_conversion_completed", userId, {
    strategy: settledRun.modelStrategy,
    recordingCount: settledRun.sourceRecordingIds.length,
    contextCount: settledRun.contextEntryIds.length,
  });
  return { run: settledRun, file };
}
