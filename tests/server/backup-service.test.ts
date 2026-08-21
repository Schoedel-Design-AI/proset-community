import assert from "node:assert/strict";
import test from "node:test";

import { resolveAudioBackupPayload, buildBackupPaths } from "../../server/backup-service";
import { pool } from "../../server/storage";

test.after(async () => {
  await pool.end();
});

test("resolves data URI audio bytes for backup", async () => {
  const payload = await resolveAudioBackupPayload("data:audio/webm;base64,aGVsbG8=");

  assert.equal(payload.mimeType, "audio/webm");
  assert.equal(payload.buffer.toString("utf-8"), "hello");
});

test("resolves uploaded audio file URLs from the local upload directory", async () => {
  const payload = await resolveAudioBackupPayload("/api/audio-files/recording.m4a", {
    readFile: async (filePath) => Buffer.from(`read:${filePath}`),
  });

  assert.equal(payload.mimeType, "audio/mp4");
  assert.match(payload.buffer.toString("utf-8"), /audio-uploads\/recording\.m4a$/);
});

test("resolves local file URIs as audio bytes", async () => {
  const payload = await resolveAudioBackupPayload("file:///tmp/local-recording.wav", {
    readFile: async (filePath) => Buffer.from(filePath),
  });

  assert.equal(payload.mimeType, "audio/wav");
  assert.equal(payload.buffer.toString("utf-8"), "/tmp/local-recording.wav");
});

test("resolves object-storage bucket URIs as audio bytes", async () => {
  const payload = await resolveAudioBackupPayload("bucket://users/123/audio/recording.webm", {
    bucketDownloader: async (bucketKey) => Buffer.from(`bucket:${bucketKey}`),
  });

  assert.equal(payload.mimeType, "audio/webm");
  assert.equal(payload.buffer.toString("utf-8"), "bucket:users/123/audio/recording.webm");
});

test("resolves remote HTTP audio URLs as bytes", async () => {
  const payload = await resolveAudioBackupPayload("https://example.test/audio.mp3", {
    fetcher: async () => new Response(Buffer.from("remote-audio"), {
      status: 200,
      headers: { "content-type": "audio/mpeg" },
    }),
  });

  assert.equal(payload.mimeType, "audio/mpeg");
  assert.equal(payload.buffer.toString("utf-8"), "remote-audio");
});

// ---- buildBackupPaths ---------------------------------------------------

const FAKE_RECORDING_BASE = {
  id: "rec-123",
  userId: "user-1",
  createdAt: "2026-08-02T10:30:00.000Z",
  title: "My Test Recording",
  transcript: null as string | null,
  audioUri: null as string | null,
  conversions: [] as any[],
};

test("buildBackupPaths produces URL-safe audio path", () => {
  const recording = { ...FAKE_RECORDING_BASE, audioUri: "data:audio/m4a;base64,AA==" };
  const { remotePath, fileName } = buildBackupPaths(recording as any, "audio");

  // Top-level folder is always "Proset"
  assert.ok(remotePath.startsWith("Proset/"), `remotePath should start with Proset/, got: ${remotePath}`);
  // Second segment is the year-month
  assert.match(remotePath, /^Proset\/\d{4}-\d{2}\//);
  // File name should contain "audio_"
  assert.ok(fileName.startsWith("audio_"), `fileName should start with audio_, got: ${fileName}`);
  // Path should end with the audio extension
  assert.ok(remotePath.endsWith(".m4a"), `remotePath should end with .m4a, got: ${remotePath}`);
  // No characters that need URL encoding should be present (all segments are sanitized)
  assert.doesNotMatch(remotePath, /[^a-zA-Z0-9/_\-.]/, "remotePath should only contain URL-safe characters");
});

test("buildBackupPaths produces URL-safe transcript path", () => {
  const recording = { ...FAKE_RECORDING_BASE, transcript: "Hello world" };
  const { remotePath, fileName } = buildBackupPaths(recording as any, "transcript");

  assert.ok(remotePath.startsWith("Proset/"));
  assert.ok(fileName.startsWith("transcript_"), `fileName should start with transcript_, got: ${fileName}`);
  assert.ok(remotePath.endsWith(".txt"), `remotePath should end with .txt, got: ${remotePath}`);
  assert.doesNotMatch(remotePath, /[^a-zA-Z0-9/_\-.]/, "remotePath should only contain URL-safe characters");
});

test("buildBackupPaths produces URL-safe conversion path with subdirectory", () => {
  const recording = { ...FAKE_RECORDING_BASE };
  const { remotePath, fileName } = buildBackupPaths(recording as any, "conversion", "Action Items");

  assert.ok(remotePath.startsWith("Proset/"));
  assert.ok(remotePath.includes("/conversions/"), `remotePath should include /conversions/ subfolder, got: ${remotePath}`);
  assert.ok(remotePath.endsWith(".md"), `remotePath should end with .md, got: ${remotePath}`);
  // "Action Items" sanitized to "Action-Items"
  assert.ok(fileName.startsWith("Action-Items_"), `fileName should start with Action-Items_, got: ${fileName}`);
  assert.doesNotMatch(remotePath, /[^a-zA-Z0-9/_\-.]/, "remotePath should only contain URL-safe characters");
});

test("buildBackupPaths strips special characters from recording title", () => {
  const recording = { ...FAKE_RECORDING_BASE, title: "Q&A Session! (2026) — #1" };
  const { remotePath } = buildBackupPaths(recording as any, "audio");

  // Special chars should be removed by sanitizeFileName; only alphanumeric, hyphens, dots remain
  assert.doesNotMatch(remotePath, /[^a-zA-Z0-9/_\-.]/, "Special chars in title should be stripped from remotePath");
});
