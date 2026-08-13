import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";

import {
  countsTowardRecordingAllowance,
  FREE_RECORDING_COUNT_MIN_SECONDS,
} from "../../shared/plan-limits";

test("Free recordings under one minute do not consume the saved-recording allowance", async (t) => {
  const mockPath = join(tmpdir(), `proset-recording-allowance-${randomUUID()}.json`);
  process.env.MOCK_DB_PATH = mockPath;
  process.env.NODE_ENV = "test";

  const [{ default: recordingsRouter }, { storage }] = await Promise.all([
    import("../../server/modules/recordings/router"),
    import("../../server/storage"),
  ]);

  assert.equal(FREE_RECORDING_COUNT_MIN_SECONDS, 60);
  assert.equal(countsTowardRecordingAllowance("free", 0), false);
  assert.equal(countsTowardRecordingAllowance("free", 59.999), false);
  assert.equal(countsTowardRecordingAllowance("free", 60), true);
  assert.equal(countsTowardRecordingAllowance("base", 10), true);

  const userId = `free-user-${randomUUID()}`;
  await storage.users.create({
    id: userId,
    email: `${userId}@example.test`,
    name: "Free User",
    firstName: "Free",
    jobType: "other",
    emailVerified: 1,
    cachedTier: "free",
    tierCachedAt: new Date().toISOString(),
    cloudSyncEnabled: 0,
  });
  for (let index = 0; index < 3; index += 1) {
    await storage.recordings.create({
      id: `long-${index}-${randomUUID()}`,
      userId,
      title: `Long ${index}`,
      duration: 60 + index,
      audioUri: `bucket://long-${index}`,
      transcript: "",
      conversions: [],
      createdAt: new Date().toISOString(),
    });
  }

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: userId, email: `${userId}@example.test`, name: "Free User" };
    next();
  });
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

  const saveRecording = async (duration: number) => {
    const response = await fetch(`${baseUrl}/api/recordings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: `new-${duration}-${randomUUID()}`,
        title: `New ${duration}`,
        duration,
        audioUri: "",
      }),
    });
    return { response, body: await response.json() };
  };

  const shortRecording = await saveRecording(59);
  assert.equal(shortRecording.response.status, 201);
  assert.equal(shortRecording.body.countsTowardRecordingAllowance, false);
  assert.equal(shortRecording.body.recordingAllowanceUsed, 3);

  const oneMinuteRecording = await saveRecording(60);
  assert.equal(oneMinuteRecording.response.status, 409);
  assert.equal(oneMinuteRecording.body.error, "recording_limit_reached");
  assert.equal(oneMinuteRecording.body.current, 3);
  assert.equal(oneMinuteRecording.body.exemptUnderSeconds, 60);
});
