import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { TRANSCRIPTION_TOKENS_PER_SECOND } from "../../shared/plan-limits";

test("token-based usage: transcription hard gate and conversion soft gate without overage debt", async (t) => {
  const mockPath = join(tmpdir(), `proset-token-usage-${randomUUID()}.json`);
  process.env.MOCK_DB_PATH = mockPath;
  process.env.NODE_ENV = "test";

  const [{ storage }, usageService] = await Promise.all([
    import("../../server/storage"),
    import("../../server/usage-service"),
  ]);

  t.after(async () => {
    await unlink(mockPath).catch(() => undefined);
  });

  const userId = `token-user-${randomUUID()}`;
  await storage.users.create({
    id: userId,
    email: `${userId}@example.test`,
    name: "Token User",
    firstName: "Token",
    jobType: "other",
    emailVerified: 1,
    cachedTier: "free",
    tierCachedAt: new Date().toISOString(),
    cloudSyncEnabled: 0,
    tokenBalance: 0,
  });

  // Pure pricing helpers. Rate comes from the shared constant so a policy
  // change (e.g. 1 → 2 tokens/sec, 2026-09-17) does not silently break this
  // test — it either updates or fails loudly at the constant's site.
  const rate = TRANSCRIPTION_TOKENS_PER_SECOND;
  assert.equal(usageService.transcriptionTokenCost(30), 30 * rate);
  assert.equal(usageService.transcriptionTokenCost(0), 0);
  assert.equal(usageService.computeConversionTokenCost({ usage: { prompt_tokens: 100, completion_tokens: 50 } }), 150);
  assert.equal(usageService.computeConversionTokenCost({ usage: { input_tokens: 10, output_tokens: 5 } }), 15);
  assert.equal(usageService.computeConversionTokenCost({ usage: { total_tokens: 42 } }), 42);
  // No usage object → ~4 chars/token estimate: (40 + 40) / 4 = 20.
  assert.equal(
    usageService.computeConversionTokenCost({ inputText: "x".repeat(40), outputText: "y".repeat(40) }),
    20,
  );

  // Lazy monthly credit: the first read credits the Free allowance (10,000).
  const first = await usageService.getUserTokenBalance(userId);
  assert.equal(first.balance, 10000);
  assert.equal(first.monthlyAllowance, 10000);
  assert.equal(first.credited, true);

  // A second read in the same month must not double-credit.
  const second = await usageService.getUserTokenBalance(userId);
  assert.equal(second.balance, 10000);
  assert.equal(second.credited, false);

  // Transcription hard gate: at rate=r, 30s costs 30 × r tokens.
  const gateCost = 30 * rate;
  const gate = await usageService.checkTranscriptionLimit(userId, 30);
  assert.equal(gate.allowed, true);
  assert.equal(gate.cost, gateCost);

  await usageService.deductTranscriptionTokens(userId, 30);
  assert.equal((await usageService.getUserTokenBalance(userId)).balance, 10000 - gateCost);

  // Hard gate blocks when the cost exceeds the running balance.
  assert.equal((await usageService.checkTranscriptionLimit(userId, 20000)).allowed, false);

  // Conversion soft gate: allowed while balance > 0.
  assert.equal((await usageService.checkConversionLimit(userId, "summary")).allowed, true);

  // A conversion can consume the remaining balance, but prepaid billing never
  // creates an automatic negative overage.
  await usageService.deductConversionTokens(userId, 20000);
  assert.equal((await usageService.getUserTokenBalance(userId)).balance, 0);

  // Once balance reaches zero, further conversions are blocked.
  assert.equal((await usageService.checkConversionLimit(userId, "summary")).allowed, false);
});

test("concurrent pack redemptions preserve both purchased-credit increments", async () => {
  const { storage } = await import("../../server/storage");
  const userId = `concurrent-pack-${randomUUID()}`;
  await storage.users.create({
    id: userId,
    email: `${userId}@example.test`,
    name: "Concurrent Pack User",
    firstName: "Concurrent",
    jobType: "other",
    emailVerified: 1,
    cachedTier: "pro",
    cloudSyncEnabled: 1,
    tokenBalance: 0,
    monthlyTokenBalance: 0,
    purchasedTokenBalance: 0,
    tokenAllowanceMonth: new Date().toISOString().slice(0, 7),
  });

  const results = await Promise.all([
    storage.billingRedemptions.apply({
      id: `pi_${randomUUID()}`,
      userId,
      kind: "token_pack",
      productId: "tokens_25k",
    }, {}, 25_000),
    storage.billingRedemptions.apply({
      id: `pi_${randomUUID()}`,
      userId,
      kind: "token_pack",
      productId: "tokens_25k",
    }, {}, 25_000),
  ]);

  assert.deepEqual(results, ["applied", "applied"]);
  const user = await storage.users.get(userId);
  assert.equal(user?.monthlyTokenBalance, 0);
  assert.equal(user?.purchasedTokenBalance, 50_000);
  assert.equal(user?.tokenBalance, 50_000);
});
