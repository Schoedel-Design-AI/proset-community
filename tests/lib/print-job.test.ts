import assert from "node:assert/strict";
import test from "node:test";

import { delay } from "../../lib/print/print-async";
import {
  createPrintRunner,
  type PrintArtifact,
  type PrintEngine,
  type PrintGenerateRequest,
  type PrintJobState,
} from "../../lib/print/print-job";

type Recorder = {
  engine: PrintEngine;
  generateCalls: PrintGenerateRequest[];
  readonly presentCalls: number;
  discardCalls: PrintArtifact[];
};

function recorder(overrides: Partial<PrintEngine> = {}, generateDelayMs = 0): Recorder {
  const generateCalls: PrintGenerateRequest[] = [];
  const discardCalls: PrintArtifact[] = [];
  let presentCalls = 0;

  const engine: PrintEngine = {
    platform: "android",
    async generate(request) {
      generateCalls.push(request);
      if (generateDelayMs) await delay(generateDelayMs);
      return { platform: "android", filePath: "/cache/PDF_x.pdf", tempPaths: ["/cache/PDF_x.pdf"] };
    },
    async present() {
      presentCalls += 1;
      return { mode: "system-share-sheet", dismissed: false };
    },
    async discard(artifact) {
      discardCalls.push(artifact);
    },
    ...overrides,
  };

  return {
    engine,
    generateCalls,
    get presentCalls() {
      return presentCalls;
    },
    discardCalls,
  };
}

const input = { html: "<p>hi</p>", title: "Sync", estimatedPages: 3 };

test("happy path: phases run in order, the temp file is discarded, printed returned", async () => {
  const rec = recorder();
  const runner = createPrintRunner({ engine: rec.engine, log: () => {} });
  const seen: PrintJobState["phase"][] = [];
  runner.subscribe((state) => seen.push(state.phase));

  const outcome = await runner.run(input);

  assert.equal(outcome.status, "printed");
  assert.deepEqual(seen, ["preparing", "generating", "presenting", "done"]);
  assert.equal(rec.presentCalls, 1);
  assert.deepEqual(rec.discardCalls.map((artifact) => artifact.filePath), ["/cache/PDF_x.pdf"]);
  assert.equal(runner.getState().phase, "done");
  assert.equal(runner.getState().error, null);
});

test("the file name is resolved from the title and passed to the engine", async () => {
  const rec = recorder();
  const runner = createPrintRunner({ engine: rec.engine, log: () => {} });
  await runner.run({ ...input, title: "Weekly sync / 2026-09-28" });
  assert.equal(rec.generateCalls[0].fileName, "Weekly_sync_2026-09-28_transcript.pdf");
});

test("two runs never overlap: the converter is a singleton on Android", async () => {
  const rec = recorder({}, 20);
  const runner = createPrintRunner({ engine: rec.engine, log: () => {} });

  await Promise.all([
    runner.run({ ...input, title: "first" }),
    runner.run({ ...input, title: "second" }),
  ]);

  assert.equal(rec.generateCalls.length, 2);
  assert.equal(rec.generateCalls[0].title, "first");
  assert.equal(rec.generateCalls[1].title, "second");
  assert.equal(runner.getState().phase, "done");
});

test("CONVERSION_IN_PROGRESS is retried exactly once, and the retry asks for a converter reset", async () => {
  let attempts = 0;
  const rec = recorder({
    async generate(request) {
      attempts += 1;
      if (attempts === 1) throw { code: "CONVERSION_IN_PROGRESS" };
      return { platform: "android", filePath: "/cache/PDF_y.pdf", tempPaths: ["/cache/PDF_y.pdf"] };
    },
  });
  const runner = createPrintRunner({ engine: rec.engine, log: () => {} });

  const outcome = await runner.run(input);
  assert.equal(outcome.status, "printed");
  assert.equal(attempts, 2); // one failure, one successful retry — never more
});

test("the retry attempt number is visible to the engine so it can forceReset the converter", async () => {
  const attempts: number[] = [];
  const rec = recorder({
    async generate(request) {
      attempts.push(request.attempt);
      if (request.attempt === 1) throw { code: "CONVERSION_IN_PROGRESS" };
      return { platform: "android", tempPaths: [] };
    },
  });
  const runner = createPrintRunner({ engine: rec.engine, log: () => {} });
  await runner.run(input);
  assert.deepEqual(attempts, [1, 2]);
});

test("a generation timeout fails the job and is retryable", async () => {
  const rec = recorder({
    async generate() {
      await delay(50);
      return { platform: "android", tempPaths: [] };
    },
  });
  // The page-count heuristic would raise a tiny configured timeout (3 pages -> 12 s), so the
  // deadline is supervised explicitly here — that is what the override exists for.
  const runner = createPrintRunner({ engine: rec.engine, timeoutMs: 5, log: () => {} });
  const outcome = await runner.run(input);

  assert.equal(outcome.status, "failed");
  if (outcome.status !== "failed") return;
  assert.equal(outcome.error.code, "pdf_generation_timeout");
  assert.equal(outcome.error.retryable, true);
  assert.equal(runner.getState().phase, "error");
});

test("a native invalid-HTML failure is reported as non-retryable and never presented", async () => {
  const rec = recorder({
    async generate() {
      throw { code: "INVALID_HTML" };
    },
  });
  const runner = createPrintRunner({ engine: rec.engine, log: () => {} });
  const outcome = await runner.run(input);

  assert.equal(outcome.status, "failed");
  if (outcome.status !== "failed") return;
  assert.equal(outcome.error.code, "invalid_options");
  assert.equal(outcome.error.retryable, false);
  assert.equal(rec.presentCalls, 0);
});

test("cancelling before the dialog opens reports cancelled, not printed", async () => {
  const rec = recorder({}, 30);
  const runner = createPrintRunner({ engine: rec.engine, log: () => {} });
  const pending = runner.run(input);
  await delay(1);
  runner.cancel();
  const outcome = await pending;

  assert.equal(outcome.status, "cancelled");
  assert.equal(runner.getState().phase, "cancelled");
  assert.equal(rec.presentCalls, 0);
  assert.equal(rec.discardCalls.length, 1);
});

test("a cleanup failure never turns a successful print into a failure", async () => {
  const logs: string[] = [];
  const rec = recorder({
    async discard() {
      throw new Error("no such file");
    },
  });
  const runner = createPrintRunner({ engine: rec.engine, log: (message) => logs.push(message) });
  const outcome = await runner.run(input);

  assert.equal(outcome.status, "printed");
  assert.equal(logs.some((line) => line.includes("cleanup")), true);
});

test("cleanup can be disabled for a caller that owns the file", async () => {
  const rec = recorder();
  const runner = createPrintRunner({ engine: rec.engine, cleanupTempFiles: false, log: () => {} });
  await runner.run(input);
  assert.equal(rec.discardCalls.length, 0);
});
