import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("token-based usage: transcription hard gate and conversion soft gate with grace", async (t) => {
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

  // Pure pricing helpers.
  assert.equal(usageService.transcriptionTokenCost(30), 30);
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

  // Transcription hard gate: 30s costs 30 tokens, allowed when balance covers it.
  const gate = await usageService.checkTranscriptionLimit(userId, 30);
  assert.equal(gate.allowed, true);
  assert.equal(gate.cost, 30);

  await usageService.deductTranscriptionTokens(userId, 30);
  assert.equal((await usageService.getUserTokenBalance(userId)).balance, 9970);

  // Hard gate blocks when the cost exceeds the running balance.
  assert.equal((await usageService.checkTranscriptionLimit(userId, 20000)).allowed, false);

  // Conversion soft gate: allowed while balance > 0.
  assert.equal((await usageService.checkConversionLimit(userId, "summary")).allowed, true);

  // Grace conversion: deduct actual tokens, allowing the balance to go negative.
  await usageService.deductConversionTokens(userId, 20000);
  assert.equal((await usageService.getUserTokenBalance(userId)).balance, -10030);

  // Once balance <= 0, further conversions are blocked (debt ≤ one conversion).
  assert.equal((await usageService.checkConversionLimit(userId, "summary")).allowed, false);
});
