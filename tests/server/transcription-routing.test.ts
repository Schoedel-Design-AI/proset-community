import assert from "node:assert/strict";
import test from "node:test";

import {
  applyDurationAwareHedge,
  getTranscriptionRoutes,
  runHedgedTranscription,
  type TranscriptionRoute,
} from "../../server/transcription-routing";
import { cmsService } from "../../server/modules/ai-customization/cms-service";

function route(
  provider: TranscriptionRoute["provider"],
  overrides: Partial<TranscriptionRoute> = {},
): TranscriptionRoute {
  return {
    provider,
    model: `${provider}-model`,
    timeoutMs: 500,
    hedgeAfterMs: 20,
    ...overrides,
  };
}

function pendingUntilAborted(signal: AbortSignal): Promise<string> {
  return new Promise((_resolve, reject) => {
    signal.addEventListener(
      "abort",
      () => reject(signal.reason || new Error("aborted")),
      { once: true },
    );
  });
}

// The cmsService singleton loads the bundled catalog snapshot (which carries
// DB-authoritative transcription rows) at import time. These tests assert the
// ENV-DRIVEN defaults, so neutralize the catalog maps: every
// getEffectiveAiConfig call then returns undefined and the env/code defaults
// are what actually routes. Deterministic regardless of which models the live
// catalog carries.
cmsService.applyBundle({
  version: "test",
  exported_at: "1970-01-01T00:00:00Z",
  packs: [],
  conversion_types: [],
  prompts: [],
  skills: [],
  examples: [],
  knowledgebases: [],
  dialogue_steps: [],
  taxonomies: [],
  ai_providers: [],
  ai_models: [],
  ai_functions: [],
  global_memory: [],
});

test("transcription routes use Groq, Mistral, then OpenAI when all are configured", () => {
  const routes = getTranscriptionRoutes({
    GROQ_API_KEY: "test-groq",
    MISTRAL_API_KEY: "test-mistral",
    OPENAI_API_KEY: "test-openai",
  });

  assert.deepEqual(
    routes.map(({ provider, model }) => ({ provider, model })),
    [
      { provider: "groq", model: "whisper-large-v3-turbo" },
      { provider: "mistral", model: "voxtral-mini-2602" },
      { provider: "openai", model: "gpt-4o-transcribe" },
    ],
  );
});

test("unconfigured providers are skipped without changing the remaining order", () => {
  const routes = getTranscriptionRoutes({
    GROQ_API_KEY: "test-groq",
    OPENAI_API_KEY: "test-openai",
  });

  assert.deepEqual(
    routes.map(({ provider }) => provider),
    ["groq", "openai"],
  );
});

test("a pending primary is hedged and the first successful transcript wins", async () => {
  const started: string[] = [];
  const result = await runHedgedTranscription(
    [
      route("groq", { hedgeAfterMs: 10 }),
      route("mistral", { hedgeAfterMs: 100 }),
      route("openai"),
    ],
    async (candidate, signal) => {
      started.push(candidate.provider);
      if (candidate.provider === "groq") return pendingUntilAborted(signal);
      if (candidate.provider === "mistral") return "fast transcript";
      return "should not start";
    },
    500,
  );

  assert.equal(result.provider, "mistral");
  assert.equal(result.text, "fast transcript");
  assert.deepEqual(started, ["groq", "mistral"]);
});

test("provider failure starts the next route immediately instead of waiting for the hedge", async () => {
  const startedAt = Date.now();
  const result = await runHedgedTranscription(
    [
      route("groq", { hedgeAfterMs: 1_000 }),
      route("mistral"),
    ],
    async (candidate) => {
      if (candidate.provider === "groq") throw new Error("provider unavailable");
      return "fallback transcript";
    },
    500,
  );

  assert.equal(result.provider, "mistral");
  assert.ok(Date.now() - startedAt < 250);
});

test("a provider deadline advances to the next route without a same-provider retry", async () => {
  const starts = new Map<string, number>();
  const result = await runHedgedTranscription(
    [
      route("groq", { timeoutMs: 15, hedgeAfterMs: 1_000 }),
      route("mistral"),
    ],
    async (candidate, signal) => {
      starts.set(candidate.provider, (starts.get(candidate.provider) || 0) + 1);
      if (candidate.provider === "groq") return pendingUntilAborted(signal);
      return "deadline fallback";
    },
    500,
  );

  assert.equal(result.provider, "mistral");
  assert.equal(starts.get("groq"), 1);
  assert.equal(starts.get("mistral"), 1);
});

test("the overall latency budget aborts a transcription that never completes", async () => {
  await assert.rejects(
    runHedgedTranscription(
      [route("groq", { timeoutMs: 1_000, hedgeAfterMs: 1_000 })],
      async (_candidate, signal) => pendingUntilAborted(signal),
      25,
    ),
    /latency budget/,
  );
});

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test("applyDurationAwareHedge keeps short-audio hedges unchanged", () => {
  const routes = [route("groq", { hedgeAfterMs: 3_000 }), route("mistral", { hedgeAfterMs: 15_000 })];
  assert.deepEqual(applyDurationAwareHedge(routes, 45), routes);
  assert.deepEqual(applyDurationAwareHedge(routes, undefined), routes); // unknown duration: conservative default
});

test("applyDurationAwareHedge disables the speculative hedge at 60s and above", () => {
  const hedged = applyDurationAwareHedge(
    [route("groq", { hedgeAfterMs: 3_000, timeoutMs: 15_000 }), route("mistral", { hedgeAfterMs: 15_000, timeoutMs: 30_000 })],
    550.3,
  );
  assert.deepEqual(
    hedged.map(({ provider, hedgeAfterMs, timeoutMs }) => ({ provider, hedgeAfterMs, timeoutMs })),
    [
      { provider: "groq", hedgeAfterMs: 0, timeoutMs: 15_000 },
      { provider: "mistral", hedgeAfterMs: 0, timeoutMs: 30_000 },
    ],
  );
});

test("a 0 hedgeAfterMs never speculatively launches: the primary wins outright", async () => {
  const started: string[] = [];
  const result = await runHedgedTranscription(
    [route("groq", { hedgeAfterMs: 0 }), route("mistral")],
    async (candidate) => {
      started.push(candidate.provider);
      // Longer than the old fixed hedge window would wait: with the timer
      // wrongly present at 0 ms this would double-bill; guarded, mistral
      // must never start while groq succeeds.
      await delay(80);
      return `${candidate.provider} transcript`;
    },
    500,
  );
  assert.equal(result.provider, "groq");
  assert.deepEqual(started, ["groq"]);
});

test("with the speculative hedge disabled, failure-based failover still launches the fallback", async () => {
  const started: string[] = [];
  const result = await runHedgedTranscription(
    [route("groq", { hedgeAfterMs: 0 }), route("mistral")],
    async (candidate) => {
      started.push(candidate.provider);
      if (candidate.provider === "groq") throw new Error("provider unavailable");
      return "fallback transcript";
    },
    500,
  );
  assert.equal(result.provider, "mistral");
  assert.deepEqual(started, ["groq", "mistral"]);
});
