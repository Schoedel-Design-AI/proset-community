import assert from "node:assert/strict";
import test from "node:test";

import {
  getTranscriptionRoutes,
  runHedgedTranscription,
  type TranscriptionRoute,
} from "../../server/transcription-routing";

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
