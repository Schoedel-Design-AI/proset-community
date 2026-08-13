import assert from "node:assert/strict";
import test from "node:test";
import { createHash, randomUUID } from "node:crypto";
import { unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";

test("Thought Thread API persists ordered sources, enforces ownership, and preserves recordings on deletion", async (t) => {
  const mockPath = join(tmpdir(), `aiforms-thought-thread-${randomUUID()}.json`);
  process.env.MOCK_DB_PATH = mockPath;
  process.env.NODE_ENV = "test";

  const [
    { default: thoughtThreadsRouter },
    { default: recordingsRouter },
    { storage },
    { beginThoughtThreadRunConversion, finalizeThoughtThreadRun },
  ] = await Promise.all([
    import("../../server/modules/thought-threads/router"),
    import("../../server/modules/recordings/router"),
    import("../../server/storage"),
    import("../../server/modules/thought-threads/service"),
  ]);

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const id = String(req.headers["x-test-user"] || "owner");
    req.user = { id, email: `${id}@example.test`, name: id };
    next();
  });
  app.use("/api", thoughtThreadsRouter);
  app.use("/api", recordingsRouter);

  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  t.after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await unlink(mockPath).catch(() => undefined);
  });

  const address = server.address();
  assert.ok(address && typeof address === "object");
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const request = async (path: string, options: RequestInit = {}, user = "owner") => {
    const response = await fetch(`${baseUrl}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        "x-test-user": user,
        ...options.headers,
      },
    });
    const body = await response.json();
    return { response, body };
  };

  const older = {
    id: `rec-old-${randomUUID()}`,
    userId: "owner",
    title: "First thought",
    duration: 10,
    audioUri: "gs://first",
    transcript: "The first piece.",
    conversions: {},
    createdAt: "2026-07-20T10:00:00.000Z",
  };
  await storage.users.create({
    id: "owner",
    email: "owner@example.test",
    name: "Owner",
    firstName: "Owner",
    jobType: "other",
    emailVerified: 1,
    cloudSyncEnabled: 1,
    cachedTier: "pro",
  });
  const newer = {
    ...older,
    id: `rec-new-${randomUUID()}`,
    title: "Later thought",
    audioUri: "gs://later",
    transcript: "The later piece.",
    createdAt: "2026-07-22T10:00:00.000Z",
  };
  await storage.recordings.create(newer);
  await storage.recordings.create(older);

  const savedRecordingTextContext = await request(`/api/recordings/${older.id}/contexts/text`, {
    method: "PUT",
    body: JSON.stringify({ text: "Durable context, separate from the transcript." }),
  });
  assert.equal(savedRecordingTextContext.response.status, 200);
  assert.equal(savedRecordingTextContext.body.context.kind, "text");
  assert.equal(savedRecordingTextContext.body.context.revision, 1);
  assert.equal((await storage.recordings.get(older.id, "owner"))?.transcript, older.transcript);

  const revisedRecordingTextContext = await request(`/api/recordings/${older.id}/contexts/text`, {
    method: "PUT",
    body: JSON.stringify({ text: "Revised durable context, still not transcript." }),
  });
  assert.equal(revisedRecordingTextContext.body.context.revision, 2);
  assert.equal((await storage.recordings.get(older.id, "owner"))?.transcript, older.transcript);

  const legacyMigrationBody = {
    migrationId: "device-file-1",
    label: "legacy-notes.txt",
    text: "Previously extracted device-only file context.",
  };
  const migratedOnce = await request(`/api/recordings/${older.id}/contexts/legacy-file`, {
    method: "POST",
    body: JSON.stringify(legacyMigrationBody),
  });
  const migratedTwice = await request(`/api/recordings/${older.id}/contexts/legacy-file`, {
    method: "POST",
    body: JSON.stringify(legacyMigrationBody),
  });
  assert.equal(migratedOnce.response.status, 201);
  assert.equal(migratedTwice.response.status, 200);
  assert.equal(migratedOnce.body.context.id, migratedTwice.body.context.id);

  await storage.users.update("owner", { cloudSyncEnabled: 0 });
  const localOnlyContextRead = await request(`/api/recordings/${older.id}/contexts`);
  assert.equal(localOnlyContextRead.response.status, 403);
  assert.equal(localOnlyContextRead.body.error, "cloud_sync_required");

  // Thought Thread endpoints must also require cloud sync.
  const noSyncListThreads = await request("/api/thought-threads");
  assert.equal(noSyncListThreads.response.status, 403);
  assert.equal(noSyncListThreads.body.error, "cloud_sync_required");
  const noSyncCreateThread = await request("/api/thought-threads", {
    method: "POST",
    body: JSON.stringify({ recordingIds: [older.id] }),
  });
  assert.equal(noSyncCreateThread.response.status, 403);
  assert.equal(noSyncCreateThread.body.error, "cloud_sync_required");
  const noSyncFromRecording = await request(`/api/thought-threads/from-recording/${older.id}`, {
    method: "POST",
    body: JSON.stringify({}),
  });
  assert.equal(noSyncFromRecording.response.status, 403);
  assert.equal(noSyncFromRecording.body.error, "cloud_sync_required");

  await storage.users.update("owner", { cloudSyncEnabled: 1 });

  const created = await request("/api/thought-threads", {
    method: "POST",
    body: JSON.stringify({ recordingIds: [newer.id, older.id] }),
  });
  assert.equal(created.response.status, 201);
  assert.deepEqual(
    created.body.items.map((item: any) => item.recordingId),
    [older.id, newer.id],
  );
  const threadId = created.body.thread.id as string;

  const foreignRead = await request(`/api/thought-threads/${threadId}`, {}, "other-user");
  assert.equal(foreignRead.response.status, 404);

  const duplicate = await request(`/api/thought-threads/${threadId}/recordings`, {
    method: "POST",
    body: JSON.stringify({ recordingIds: [older.id] }),
  });
  assert.equal(duplicate.response.status, 200);
  assert.equal(duplicate.body.items.length, 2);

  const newerItem = created.body.items.find((item: any) => item.recordingId === newer.id);
  const removedItem = await request(`/api/thought-threads/${threadId}/items/${newerItem.id}`, {
    method: "DELETE",
  });
  assert.equal(removedItem.response.status, 200);
  const restoredItem = await request(`/api/thought-threads/${threadId}/recordings`, {
    method: "POST",
    body: JSON.stringify({ recordingIds: [newer.id] }),
  });
  assert.equal(restoredItem.response.status, 201);
  assert.deepEqual(
    restoredItem.body.items.map((item: any) => item.recordingId),
    [older.id, newer.id],
  );
  assert.equal(
    new Set(restoredItem.body.items.map((item: any) => item.position)).size,
    restoredItem.body.items.length,
  );

  const context = await request(`/api/thought-threads/${threadId}/contexts`, {
    method: "POST",
    body: JSON.stringify({
      kind: "text",
      label: "Added later",
      text: "Supporting context that is not transcript.",
    }),
  });
  assert.equal(context.response.status, 201);
  assert.equal(context.body.contexts[0].kind, "text");
  const contextId = context.body.contexts[0].id as string;
  const temporaryContext = await request(`/api/thought-threads/${threadId}/contexts`, {
    method: "POST",
    body: JSON.stringify({ kind: "text", label: "Temporary", text: "Delete this context." }),
  });
  assert.equal(temporaryContext.response.status, 201);
  const temporaryContextId = temporaryContext.body.contexts
    .find((entry: any) => entry.label === "Temporary").id as string;
  const deletedContext = await request(
    `/api/thought-threads/${threadId}/contexts/${temporaryContextId}`,
    { method: "DELETE" },
  );
  assert.equal(deletedContext.response.status, 200);
  const replacementContext = await request(`/api/thought-threads/${threadId}/contexts`, {
    method: "POST",
    body: JSON.stringify({ kind: "text", label: "Replacement", text: "Retained replacement." }),
  });
  assert.equal(replacementContext.response.status, 201);
  assert.equal(
    new Set(replacementContext.body.contexts.map((entry: any) => entry.position)).size,
    replacementContext.body.contexts.length,
  );

  const lockedPreparation = await request(`/api/thought-threads/${threadId}/prepare-conversion`, {
    method: "POST",
    body: JSON.stringify({ conversionType: "academic_research" }),
  });
  assert.equal(lockedPreparation.response.status, 403);
  assert.deepEqual(await storage.thoughtThreadRuns.getByThread(threadId, "owner"), []);

  const preparationAttempts = await Promise.all([
    request(`/api/thought-threads/${threadId}/prepare-conversion`, {
      method: "POST",
      body: JSON.stringify({ conversionType: "summary" }),
    }),
    request(`/api/thought-threads/${threadId}/prepare-conversion`, {
      method: "POST",
      body: JSON.stringify({ conversionType: "summary" }),
    }),
  ]);
  const prepared = preparationAttempts.find(({ response }) => response.status === 201);
  assert.ok(prepared);
  assert.equal(prepared.response.status, 201);
  assert.equal(prepared.body.run.status, "prepared");
  assert.equal(prepared.body.run.modelStrategy, "direct");
  assert.equal(Object.hasOwn(prepared.body, "preparedSource"), false);
  assert.equal(Object.hasOwn(prepared.body.run, "sourceSnapshot"), false);
  const runId = prepared.body.run.id as string;
  const preparedRuns = await storage.thoughtThreadRuns.getByThread(threadId, "owner");
  assert.equal(preparedRuns.length, 1);
  assert.ok(preparationAttempts.every(({ response }) => [200, 201, 409].includes(response.status)));
  assert.equal(
    new Set(preparationAttempts
      .map(({ body }) => body.run?.id)
      .filter(Boolean)).size,
    1,
  );
  const sourceChunks = await storage.thoughtThreadRunChunks.getByRun(
    runId,
    threadId,
    "owner",
    "source",
  );
  const frozenSource = sourceChunks.map((chunk) => chunk.text).join("");
  assert.match(frozenSource, /Supporting context that is not transcript/);
  assert.ok(sourceChunks.length > 0);
  for (const chunk of sourceChunks) {
    assert.equal(Buffer.byteLength(chunk.text, "utf8"), chunk.byteLength);
    assert.equal(createHash("sha256").update(chunk.text).digest("hex"), chunk.hash);
  }
  const listed = await request("/api/thought-threads");
  const listedThread = listed.body.threads.find((thread: any) => thread.id === threadId);
  assert.deepEqual(
    {
      recordingCount: listedThread.recordingCount,
      contextCount: listedThread.contextCount,
      runCount: listedThread.runCount,
    },
    { recordingCount: 2, contextCount: 2, runCount: 1 },
  );

  const editedContext = await request(`/api/thought-threads/${threadId}/contexts/${contextId}`, {
    method: "PATCH",
    body: JSON.stringify({ text: "Updated context after the first snapshot." }),
  });
  assert.equal(editedContext.response.status, 200);
  const storedRun = await storage.thoughtThreadRuns.get(runId, threadId, "owner");
  assert.ok(storedRun);
  assert.equal(storedRun.sourceSnapshot, null);
  const frozenSourceAfterEdit = (
    await storage.thoughtThreadRunChunks.getByRun(runId, threadId, "owner", "source")
  ).map((chunk) => chunk.text).join("");
  assert.equal(frozenSourceAfterEdit, frozenSource);
  assert.doesNotMatch(frozenSourceAfterEdit, /Updated context after the first snapshot/);

  const expectedVersion = editedContext.body.thread.version as number;
  const concurrentUpdates = await Promise.all([
    request(`/api/thought-threads/${threadId}`, {
      method: "PATCH",
      body: JSON.stringify({ title: "First concurrent title", expectedVersion }),
    }),
    request(`/api/thought-threads/${threadId}`, {
      method: "PATCH",
      body: JSON.stringify({ title: "Second concurrent title", expectedVersion }),
    }),
  ]);
  assert.deepEqual(
    concurrentUpdates.map(({ response }) => response.status).sort(),
    [200, 409],
  );

  const clientFinalization = await request(
    `/api/thought-threads/${threadId}/runs/${runId}/complete`,
    {
      method: "POST",
      body: JSON.stringify({ fileId: "client-selected-file" }),
    },
  );
  assert.equal(clientFinalization.response.status, 409);

  const competingStarts = await Promise.allSettled([
    beginThoughtThreadRunConversion(runId, threadId, "owner"),
    beginThoughtThreadRunConversion(runId, threadId, "owner"),
  ]);
  assert.equal(
    competingStarts.filter((result) => result.status === "fulfilled").length,
    1,
  );
  assert.equal(
    competingStarts.filter((result) => result.status === "rejected").length,
    1,
  );
  const alternateThread = await request("/api/thought-threads", {
    method: "POST",
    body: JSON.stringify({ recordingIds: [older.id], title: "Alternate thread" }),
  });
  assert.equal(alternateThread.response.status, 201);
  const continuationChoice = await request(
    `/api/thought-threads/from-recording/${older.id}`,
    { method: "POST", body: JSON.stringify({}) },
  );
  assert.equal(continuationChoice.response.status, 200);
  assert.equal(continuationChoice.body.requiresChoice, true);
  assert.deepEqual(
    new Set(continuationChoice.body.threads.map((thread: any) => thread.id)),
    new Set([threadId, alternateThread.body.thread.id]),
  );

  const finalized = await finalizeThoughtThreadRun(
    runId,
    threadId,
    "owner",
    "# Final conversion\n\nServer-owned output.",
  );
  assert.equal(finalized.run.status, "completed");
  assert.equal(finalized.file.sourceThoughtThreadId, threadId);
  assert.equal(finalized.file.sourceThoughtThreadRunId, runId);
  assert.deepEqual(finalized.file.sourceRecordingIds, [older.id, newer.id]);
  assert.equal(
    (await storage.thoughtThreads.get(threadId, "owner"))?.status,
    "open",
  );
  assert.notEqual(
    (await storage.thoughtThreads.get(threadId, "owner"))?.lastConvertedSourceRevision,
    (await storage.thoughtThreads.get(threadId, "owner"))?.sourceRevision,
  );
  const readyContinuationChoice = await request(
    `/api/thought-threads/from-recording/${older.id}`,
    { method: "POST", body: JSON.stringify({}) },
  );
  assert.equal(readyContinuationChoice.response.status, 200);
  assert.equal(readyContinuationChoice.body.requiresChoice, true);
  assert.ok(
    readyContinuationChoice.body.threads.some((thread: any) => thread.id === threadId),
  );

  const reopenedAfterSourceEdit = await request(
    `/api/thought-threads/${threadId}/contexts/${contextId}`,
    {
      method: "PATCH",
      body: JSON.stringify({ text: "New context after the completed conversion." }),
    },
  );
  assert.equal(reopenedAfterSourceEdit.response.status, 200);
  assert.equal(reopenedAfterSourceEdit.body.thread.status, "open");

  const removed = await request(`/api/thought-threads/${threadId}`, { method: "DELETE" });
  assert.equal(removed.response.status, 200);
  assert.equal(await storage.thoughtThreads.get(threadId, "owner"), undefined);
  assert.deepEqual(await storage.thoughtThreadItems.getByThread(threadId, "owner"), []);
  assert.deepEqual(await storage.thoughtThreadContexts.getByThread(threadId, "owner"), []);
  assert.deepEqual(await storage.thoughtThreadRuns.getByThread(threadId, "owner"), []);
  assert.deepEqual(await storage.thoughtThreadRunChunks.getByRun(runId, threadId, "owner"), []);
  assert.ok(await storage.recordings.get(older.id, "owner"));
  assert.ok(await storage.recordings.get(newer.id, "owner"));
  assert.ok(await storage.userFiles.get(finalized.file.id));
  await request(`/api/thought-threads/${alternateThread.body.thread.id}`, { method: "DELETE" });
});
