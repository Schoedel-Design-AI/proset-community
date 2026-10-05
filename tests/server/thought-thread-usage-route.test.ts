import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";

/**
 * GET /api/thought-threads/using-recording
 *
 * The delete confirmation asks this before deleting a note, so what matters is
 * that it answers per recording, only for the caller's own threads, and that it
 * never invents usage for a recording nothing references. Runs against the mock
 * store (MOCK_DB_PATH), so no production data is read or written.
 */
test("the usage route names the threads that use a recording, and only the caller's", async (t) => {
  const mockPath = join(tmpdir(), `aiforms-thread-usage-${randomUUID()}.json`);
  process.env.MOCK_DB_PATH = mockPath;
  process.env.NODE_ENV = "test";

  const [{ default: thoughtThreadsRouter }, { storage }] = await Promise.all([
    import("../../server/modules/thought-threads/router"),
    import("../../server/storage"),
  ]);

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const id = String(req.headers["x-test-user"] || "owner");
    req.user = { id, email: `${id}@example.test`, name: id };
    next();
  });
  app.use("/api", thoughtThreadsRouter);

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
    return { response, body: await response.json().catch(() => ({})) };
  };

  for (const id of ["owner", "intruder"]) {
    await storage.users.create({
      id,
      email: `${id}@example.test`,
      name: id,
      firstName: id,
      jobType: "other",
      emailVerified: 1,
      cloudSyncEnabled: 1,
      cachedTier: "pro",
      tierCachedAt: new Date().toISOString(),
    });
  }

  const used = {
    id: `rec-used-${randomUUID()}`,
    userId: "owner",
    title: "Used in a thread",
    duration: 10,
    audioUri: "gs://used",
    transcript: "The first piece.",
    conversions: {},
    createdAt: "2026-07-20T10:00:00.000Z",
  };
  const unused = { ...used, id: `rec-unused-${randomUUID()}`, title: "Not in a thread" };
  await storage.recordings.create(used);
  await storage.recordings.create(unused);

  const created = await request("/api/thought-threads", {
    method: "POST",
    body: JSON.stringify({ recordingIds: [used.id], title: "Named thread" }),
  });
  assert.ok(
    created.response.status === 200 || created.response.status === 201,
    `creating the thread: ${JSON.stringify(created.body)}`,
  );
  const threadId = created.body.thread?.id ?? created.body.id;
  assert.ok(threadId, `expected a thread id, got ${JSON.stringify(created.body)}`);

  // The recording that is in a thread is named; the one that is not is absent.
  const both = await request(
    `/api/thought-threads/using-recording?recordingIds=${used.id},${unused.id}`,
  );
  assert.equal(both.response.status, 200);
  assert.deepEqual(both.body.usage[used.id], [{ id: threadId, title: "Named thread" }]);
  assert.equal(
    Object.prototype.hasOwnProperty.call(both.body.usage, unused.id),
    false,
    "a recording nothing references must not appear in the usage map",
  );

  // Another user's request must not learn about a thread they do not own.
  const asIntruder = await request(
    `/api/thought-threads/using-recording?recordingIds=${used.id}`,
    {},
    "intruder",
  );
  assert.equal(asIntruder.response.status, 200);
  assert.deepEqual(asIntruder.body.usage, {}, "usage must never cross users");

  // No ids is an empty answer, not an error: the client sends this for an empty selection.
  const none = await request("/api/thought-threads/using-recording");
  assert.equal(none.response.status, 200);
  assert.deepEqual(none.body.usage, {});

  // The gate is the same one every other Thought Thread route uses.
  await storage.users.create({
    id: "nosync",
    email: "nosync@example.test",
    name: "nosync",
    firstName: "nosync",
    jobType: "other",
    emailVerified: 1,
    cloudSyncEnabled: 0,
    cachedTier: "free",
    tierCachedAt: new Date().toISOString(),
  });
  const gated = await request(
    `/api/thought-threads/using-recording?recordingIds=${used.id}`,
    {},
    "nosync",
  );
  assert.equal(gated.response.status, 403);
  assert.equal(gated.body.error, "cloud_sync_required");
});
