import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { discordCommandManifest } from "../../server/modules/discord/commands";
import {
  DISCORD_CORE_CONVERSIONS,
  isDiscordConversionType,
} from "../../server/modules/discord/config";
import { decryptDiscordSecret, encryptDiscordSecret, hashDiscordState } from "../../server/modules/discord/crypto";
import { canPublishDiscordResult, shouldCaptureDiscordVoice, splitDiscordContent } from "../../server/modules/discord/policy";
import { beginDiscordOAuth, createDiscordCommandLink } from "../../server/modules/discord/linking";
import { storage } from "../../server/storage";

test("Discord command manifest exposes only the seven universal core conversions", () => {
  const manifest = discordCommandManifest() as any[];
  const proset = manifest.find((command) => command.name === "proset");
  assert.deepEqual(proset.integration_types, [0, 1]);
  assert.deepEqual(proset.contexts, [0, 1, 2]);
  const record = proset.options.find((option: any) => option.name === "record");
  const convert = record.options.find((option: any) => option.name === "convert");
  const values = convert.choices.map((choice: any) => choice.value);
  assert.deepEqual(values, ["none", ...DISCORD_CORE_CONVERSIONS]);
  for (const forbidden of [
    "academic_research", "bibliography", "quick_research", "slide_deck",
    "music", "adhd_plan", "scaffolded_project_plan", "github_issue",
  ]) {
    assert.equal(values.includes(forbidden), false, `${forbidden} must remain unavailable in Discord`);
    assert.equal(isDiscordConversionType(forbidden), false);
  }
});

test("Discord secrets are encrypted at rest and state tokens are one-way hashed", () => {
  const previous = process.env.DISCORD_PAYLOAD_ENCRYPTION_KEY;
  process.env.DISCORD_PAYLOAD_ENCRYPTION_KEY = "unit-test-key-not-used-outside-this-process";
  try {
    const secret = "discord-interaction-token";
    const envelope = encryptDiscordSecret(secret);
    assert.equal(JSON.stringify(envelope).includes(secret), false);
    assert.equal(decryptDiscordSecret(envelope), secret);
    assert.equal(hashDiscordState("state"), hashDiscordState("state"));
    assert.notEqual(hashDiscordState("state"), hashDiscordState("other"));
  } finally {
    if (previous === undefined) delete process.env.DISCORD_PAYLOAD_ENCRYPTION_KEY;
    else process.env.DISCORD_PAYLOAD_ENCRYPTION_KEY = previous;
  }
});

test("account-link state is short-lived, single-use, and preserves the initiating Discord identity", async () => {
  const previousApplicationId = process.env.DISCORD_APPLICATION_ID;
  const previousPublicUrl = process.env.PUBLIC_APP_URL;
  process.env.DISCORD_APPLICATION_ID = "discord-test-app";
  process.env.PUBLIC_APP_URL = "https://test.proset.invalid";
  try {
    const commandUrl = new URL(await createDiscordCommandLink(`discord-${randomUUID()}`, "es"));
    const state = commandUrl.searchParams.get("state");
    assert.ok(state);
    const authorizeUrl = new URL((await beginDiscordOAuth(state!, `user-${randomUUID()}`))!);
    assert.equal(authorizeUrl.hostname, "discord.com");
    assert.equal(authorizeUrl.searchParams.get("client_id"), "discord-test-app");
    assert.equal(await beginDiscordOAuth(state!, `user-${randomUUID()}`), null);
  } finally {
    if (previousApplicationId === undefined) delete process.env.DISCORD_APPLICATION_ID;
    else process.env.DISCORD_APPLICATION_ID = previousApplicationId;
    if (previousPublicUrl === undefined) delete process.env.PUBLIC_APP_URL;
    else process.env.PUBLIC_APP_URL = previousPublicUrl;
  }
});

test("voice capture requires a DM, an armed session, or an admin-configured inbox", () => {
  assert.equal(shouldCaptureDiscordVoice({ isDirectMessage: true, hasArmedSession: false, isConfiguredInbox: false }), true);
  assert.equal(shouldCaptureDiscordVoice({ isDirectMessage: false, hasArmedSession: true, isConfiguredInbox: false }), true);
  assert.equal(shouldCaptureDiscordVoice({ isDirectMessage: false, hasArmedSession: false, isConfiguredInbox: true }), true);
  assert.equal(shouldCaptureDiscordVoice({ isDirectMessage: false, hasArmedSession: false, isConfiguredInbox: false }), false);
});

test("public posting is explicit, channel-scoped, and safely chunked", () => {
  assert.equal(canPublishDiscordResult(undefined, "thread-1"), true);
  assert.equal(canPublishDiscordResult({
    id: "g", guildId: "g", publishingEnabled: false, inboxChannelIds: [], publishChannelIds: [],
    createdAt: new Date(0), updatedAt: new Date(0), updatedByDiscordUserId: "admin",
  }, "thread-1"), false);
  assert.equal(canPublishDiscordResult({
    id: "g", guildId: "g", publishingEnabled: true, inboxChannelIds: [], publishChannelIds: ["thread-2"],
    createdAt: new Date(0), updatedAt: new Date(0), updatedByDiscordUserId: "admin",
  }, "thread-1"), false);
  const chunks = splitDiscordContent("word ".repeat(1000));
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every((chunk) => chunk.length <= 1900));
});

test("linked account, armed capture, and job transitions are atomic and idempotent", async () => {
  const suffix = randomUUID();
  const userId = `discord-test-user-${suffix}`;
  const otherUserId = `discord-test-other-${suffix}`;
  const discordUserId = `discord-user-${suffix}`;
  const firstLink = await storage.accounts.linkDiscord(userId, discordUserId, new Date());
  assert.equal(firstLink.status, "linked");
  assert.equal((await storage.accounts.linkDiscord(userId, discordUserId, new Date())).status, "already_linked");
  assert.equal((await storage.accounts.linkDiscord(otherUserId, discordUserId, new Date())).status, "discord_in_use");

  const sessionId = `discord-capture-${suffix}`;
  const now = new Date();
  await storage.discordCaptureSessions.arm({
    id: sessionId,
    discordUserId,
    userId,
    applicationId: "app",
    guildId: "guild",
    channelId: "thread",
    interactionId: "interaction",
    interactionToken: { ciphertext: "x", iv: "y", authTag: "z" },
    locale: "en",
    conversionType: "summary",
    thoughtThreadId: null,
    status: "armed",
    voiceMessageId: null,
    createdAt: now,
    updatedAt: now,
    expiresAt: new Date(now.getTime() + 60_000),
  });
  const claimed = await storage.discordCaptureSessions.claim(sessionId, discordUserId, "thread", "voice", new Date());
  assert.equal(claimed?.status, "claimed");
  assert.notEqual(claimed?.id, sessionId);
  assert.equal((await storage.discordCaptureSessions.get(sessionId))?.interactionToken, null);
  assert.equal(await storage.discordCaptureSessions.claim(sessionId, discordUserId, "thread", "other", new Date()), undefined);

  const jobId = `discord-job-${suffix}`;
  const job: any = {
    id: jobId, action: "capture", status: "queued", userId, discordUserId,
    applicationId: "app", guildId: "guild", channelId: "thread", locale: "en",
    attemptCount: 0, createdAt: now, updatedAt: now, expiresAt: new Date(now.getTime() + 60_000),
  };
  assert.equal((await storage.discordJobs.createIfAbsent(job)).created, true);
  assert.equal((await storage.discordJobs.createIfAbsent(job)).created, false);
  assert.equal((await storage.discordJobs.claim(jobId, new Date()))?.status, "running");
  assert.equal(await storage.discordJobs.claim(jobId, new Date()), undefined);
  await storage.discordJobs.update(jobId, { status: "succeeded" });
  assert.equal((await storage.discordJobs.claim(jobId, new Date()))?.status, "succeeded");
  assert.equal(await storage.discordJobs.claimPublication(jobId, discordUserId, new Date()), true);
  assert.equal(await storage.discordJobs.claimPublication(jobId, discordUserId, new Date()), false);
});
