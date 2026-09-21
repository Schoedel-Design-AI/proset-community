import assert from "node:assert/strict";
import test from "node:test";

import { TRANSCRIPTION_TOKENS_PER_SECOND } from "../../shared/plan-limits";
import {
  chargeLocalTranscription,
  isLocalTranscriptionAlreadyCharged,
  normalizeLocalTranscriptionDuration,
  type LocalTranscriptionChargeDeps,
  type LocalTranscriptionChargeResult,
} from "../../server/modules/recordings/local-transcription-usage";
import type { UserUsageSummary } from "../../server/usage-service";

const RATE = TRANSCRIPTION_TOKENS_PER_SECOND;

function summaryFor(tokenBalance: number): UserUsageSummary {
  return {
    tier: "free",
    displayTier: "free",
    tokenBalance,
    monthlyTokenBalance: tokenBalance,
    purchasedTokenBalance: 0,
    monthlyTokenAllowance: 600,
    tokensUsedThisMonth: 0,
    maxRecordingSeconds: 900,
    storageMb: 1024,
    maxFileImportMB: 25,
    maxMediaUploadMB: 0,
    allowedFileTypes: [],
    isSuperAdmin: false,
    proAccessEnabled: false,
    spendingCap: null,
  };
}

type RecordedCalls = {
  limitCalls: Array<{ userId: string; durationSeconds: number }>;
  deductions: Array<{ userId: string; durationSeconds: number }>;
  updates: Array<{ id: string; userId: string; updates: { transcriptSource: string } }>;
  summaryCalls: number;
};

function makeDeps(options: { allowed?: boolean; balance?: number } = {}): {
  calls: RecordedCalls;
  deps: LocalTranscriptionChargeDeps;
} {
  const calls: RecordedCalls = {
    limitCalls: [],
    deductions: [],
    updates: [],
    summaryCalls: 0,
  };
  const deps: LocalTranscriptionChargeDeps = {
    checkTranscriptionLimit: async (userId, durationSeconds) => {
      calls.limitCalls.push({ userId, durationSeconds });
      return { allowed: options.allowed ?? true, cost: Math.round(durationSeconds * RATE) };
    },
    deductTranscriptionTokens: async (userId, durationSeconds) => {
      calls.deductions.push({ userId, durationSeconds });
      return options.balance ?? 0;
    },
    updateRecording: async (id, userId, updates) => {
      calls.updates.push({ id, userId, updates });
      return undefined;
    },
    getUserUsageSummary: async () => {
      calls.summaryCalls += 1;
      return summaryFor(options.balance ?? 0);
    },
  };
  return { calls, deps };
}

function expectCharged(
  result: LocalTranscriptionChargeResult,
): Extract<LocalTranscriptionChargeResult, { kind: "charged" }> {
  assert.equal(result.kind, "charged");
  return result as Extract<LocalTranscriptionChargeResult, { kind: "charged" }>;
}

test("first charge deducts once at the shared transcription rate and marks device provenance", async () => {
  const { calls, deps } = makeDeps({ balance: 500 });

  const result = await chargeLocalTranscription({
    userId: "user-1",
    recording: { id: "rec-1" },
    rawDurationSeconds: 12.4,
    deps,
  });

  const charged = expectCharged(result);
  // Same rate as cloud: round(normalisedSeconds × TRANSCRIPTION_TOKENS_PER_SECOND).
  assert.equal(charged.tokenCost, Math.round(12 * RATE));
  assert.equal(charged.durationSeconds, 12);
  assert.equal(charged.usage.tokenBalance, 500);

  // The gate and the deduction must see the exact same seconds, so the on-device
  // charge can never diverge from the cloud charge.
  assert.deepEqual(calls.limitCalls, [{ userId: "user-1", durationSeconds: 12 }]);
  assert.deepEqual(calls.deductions, [{ userId: "user-1", durationSeconds: 12 }]);
  assert.deepEqual(calls.updates, [
    { id: "rec-1", userId: "user-1", updates: { transcriptSource: "device" } },
  ]);
  assert.equal(calls.summaryCalls, 1);
});

test("a second call for the same recording does not double-charge", async () => {
  const { calls, deps } = makeDeps({ balance: 500 });

  const first = await chargeLocalTranscription({
    userId: "user-1",
    recording: { id: "rec-1" },
    rawDurationSeconds: 30,
    deps,
  });
  assert.equal(first.kind, "charged");

  const second = await chargeLocalTranscription({
    userId: "user-1",
    recording: { id: "rec-1", transcriptSource: "device" },
    rawDurationSeconds: 30,
    deps,
  });

  assert.equal(second.kind, "already_charged");
  assert.equal(calls.deductions.length, 1);
  assert.equal(calls.limitCalls.length, 1);
  assert.equal(calls.updates.length, 1);
  assert.equal(calls.summaryCalls, 1);
});

test("a cloud-billed recording is never billed again through the on-device path", async () => {
  const { calls, deps } = makeDeps();

  const result = await chargeLocalTranscription({
    userId: "user-1",
    recording: { id: "rec-2", transcriptSource: "cloud" },
    rawDurationSeconds: 30,
    deps,
  });

  assert.equal(result.kind, "already_charged");
  assert.equal(calls.deductions.length, 0);
  assert.equal(calls.limitCalls.length, 0);
});

test("an invalid durationSeconds is rejected with no charge and no marker", async () => {
  const invalid: unknown[] = [
    0,
    -5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    "abc",
    "",
    "   ",
    null,
    undefined,
    {},
    0.4,
  ];

  for (const raw of invalid) {
    const { calls, deps } = makeDeps();
    const result = await chargeLocalTranscription({
      userId: "user-1",
      recording: { id: "rec-1" },
      rawDurationSeconds: raw,
      deps,
    });
    assert.equal(result.kind, "invalid_duration", `expected rejection for ${String(raw)}`);
    assert.equal(calls.limitCalls.length, 0);
    assert.equal(calls.deductions.length, 0);
    assert.equal(calls.updates.length, 0);
  }
});

test("a limit failure reports the cloud cost without deducting or marking", async () => {
  const { calls, deps } = makeDeps({ allowed: false });

  const result = await chargeLocalTranscription({
    userId: "user-1",
    recording: { id: "rec-1" },
    rawDurationSeconds: 45,
    deps,
  });

  assert.equal(result.kind, "limit_exceeded");
  if (result.kind === "limit_exceeded") {
    assert.equal(result.cost, Math.round(45 * RATE));
  }
  assert.equal(calls.deductions.length, 0);
  assert.equal(calls.updates.length, 0);
});

test("duration normalisation accepts numeric values and whole-number strings", () => {
  assert.equal(normalizeLocalTranscriptionDuration(12.4), 12);
  assert.equal(normalizeLocalTranscriptionDuration(12.6), 13);
  assert.equal(normalizeLocalTranscriptionDuration("15"), 15);
  assert.equal(normalizeLocalTranscriptionDuration("14.6"), 15);
  assert.equal(normalizeLocalTranscriptionDuration(0), null);
  assert.equal(normalizeLocalTranscriptionDuration(0.4), null);
  assert.equal(normalizeLocalTranscriptionDuration(-1), null);
  assert.equal(normalizeLocalTranscriptionDuration(Number.NaN), null);
  assert.equal(normalizeLocalTranscriptionDuration(Number.POSITIVE_INFINITY), null);
  assert.equal(normalizeLocalTranscriptionDuration("abc"), null);
  assert.equal(normalizeLocalTranscriptionDuration(null), null);
  assert.equal(normalizeLocalTranscriptionDuration(undefined), null);
});

test("the transcript source is the idempotency marker", () => {
  assert.equal(isLocalTranscriptionAlreadyCharged({}), false);
  assert.equal(isLocalTranscriptionAlreadyCharged({ transcriptSource: "device" }), true);
  assert.equal(isLocalTranscriptionAlreadyCharged({ transcriptSource: "cloud" }), true);
});
