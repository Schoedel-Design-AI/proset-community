import assert from "node:assert/strict";
import { test, before, after } from "node:test";
import { randomUUID } from "node:crypto";
import { unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Developer API key auth: key generation, bearer parsing, and the
// resolveApiKey tri-state (valid / expired / invalid) that backs both the REST
// and MCP entrypoints. Copilot review requested focused coverage here since
// this is a new public authentication surface.
const mockPath = join(tmpdir(), `proset-devkeys-${randomUUID()}.json`);

let generateApiKey: any = null;
let hashApiKey: any = null;
let extractBearerToken: any = null;
let resolveApiKey: any = null;
let storage: any = null;

before(async () => {
  process.env.MOCK_DB_PATH = mockPath;
  process.env.NODE_ENV = "test";
  const keys = await import("../../server/modules/developer-api/api-keys");
  generateApiKey = keys.generateApiKey;
  hashApiKey = keys.hashApiKey;
  extractBearerToken = keys.extractBearerToken;
  resolveApiKey = keys.resolveApiKey;
  storage = (await import("../../server/storage")).storage;
});

after(async () => {
  await unlink(mockPath).catch(() => undefined);
});

async function createUser(): Promise<string> {
  const userId = `dev-user-${randomUUID()}`;
  await storage.users.create({
    id: userId,
    email: `${userId}@example.test`,
    name: "Dev User",
    firstName: "Dev",
    jobType: "other",
    emailVerified: 1,
    cachedTier: "free",
    tierCachedAt: new Date().toISOString(),
    cloudSyncEnabled: 0,
  });
  return userId;
}

async function createKey(userId: string, overrides: Record<string, unknown> = {}) {
  const { key, keyHash, keyPrefix } = generateApiKey!();
  const now = new Date().toISOString();
  await storage.developerApiKeys.create({
    id: `devkey_${randomUUID()}`,
    userId,
    name: "Test key",
    keyPrefix,
    keyHash,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  });
  return { key };
}

test("generateApiKey returns a proset_-prefixed 64-hex key whose hash round-trips", () => {
  const { key, keyHash, keyPrefix } = generateApiKey!();
  assert.match(key, /^proset_[0-9a-f]{64}$/);
  assert.equal(keyPrefix, key.slice(0, 14));
  assert.equal(hashApiKey!(key), keyHash);
});

test("extractBearerToken parses a Bearer header and rejects everything else", () => {
  assert.equal(extractBearerToken!({ headers: { authorization: "Bearer proset_abc" } }), "proset_abc");
  assert.equal(extractBearerToken!({ headers: {} }), null);
  assert.equal(extractBearerToken!({ headers: { authorization: "Basic proset_abc" } }), null);
  assert.equal(extractBearerToken!({ headers: { authorization: "bearer proset_abc" } }), null);
  assert.equal(extractBearerToken!({ headers: { authorization: "Bearer " } }), null);
});

test("resolveApiKey returns ok with the owning user for a valid key", async () => {
  const userId = await createUser();
  const { key } = await createKey(userId);
  const res = await resolveApiKey!(key);
  assert.equal(res.status, "ok");
  assert.equal(res.user.id, userId);
});

test("resolveApiKey returns expired for a key whose expiresAt is in the past", async () => {
  const userId = await createUser();
  const { key } = await createKey(userId, { expiresAt: new Date(Date.now() - 86400000).toISOString() });
  const res = await resolveApiKey!(key);
  assert.equal(res.status, "expired");
});

test("resolveApiKey returns ok for a non-expired key with a future expiresAt", async () => {
  const userId = await createUser();
  const { key } = await createKey(userId, { expiresAt: new Date(Date.now() + 86400000).toISOString() });
  const res = await resolveApiKey!(key);
  assert.equal(res.status, "ok");
});

test("resolveApiKey returns invalid for a revoked key", async () => {
  const userId = await createUser();
  const { key } = await createKey(userId, { revokedAt: new Date().toISOString() });
  const res = await resolveApiKey!(key);
  assert.equal(res.status, "invalid");
});

test("resolveApiKey fast-fails malformed keys before a hash + DB lookup", async () => {
  assert.equal((await resolveApiKey!("not-a-proset-key")).status, "invalid");
  assert.equal((await resolveApiKey!("proset_short")).status, "invalid");
  assert.equal((await resolveApiKey!(`proset_${"z".repeat(64)}`)).status, "invalid");
});

test("resolveApiKey returns invalid for an unknown but well-formed key", async () => {
  const { key } = generateApiKey!(); // valid format, never persisted
  const res = await resolveApiKey!(key);
  assert.equal(res.status, "invalid");
});
