import assert from "node:assert/strict";
import test from "node:test";

import { PrintTimeoutError, createSerialQueue, delay, withTimeout } from "../../lib/print/print-async";

test("withTimeout resolves with the value when the promise wins", async () => {
  const value = await withTimeout(Promise.resolve(42), 100, "fast");
  assert.equal(value, 42);
});

test("withTimeout rejects with PrintTimeoutError carrying the label and timeout", async () => {
  await assert.rejects(
    () => withTimeout(delay(50).then(() => "late"), 5, "pdf-generation"),
    (error: unknown) => {
      assert.ok(error instanceof PrintTimeoutError);
      assert.equal(error.label, "pdf-generation");
      assert.equal(error.timeoutMs, 5);
      return true;
    },
  );
});

test("a rejection is not converted into a timeout by a pending timer", async () => {
  await assert.rejects(
    () => withTimeout(Promise.reject(new Error("native said no")), 1000, "x"),
    /native said no/,
  );
});

test("the serial queue runs jobs one at a time, in order", async () => {
  const queue = createSerialQueue();
  const timeline: string[] = [];

  const job = async (name: string, workMs: number) => {
    const release = await queue.acquire();
    timeline.push(`${name}:start`);
    await delay(workMs);
    timeline.push(`${name}:end`);
    release();
  };

  await Promise.all([job("a", 20), job("b", 1), job("c", 1)]);
  assert.deepEqual(timeline, ["a:start", "a:end", "b:start", "b:end", "c:start", "c:end"]);
});

test("release is idempotent and tracks pending work", async () => {
  const queue = createSerialQueue();
  assert.equal(queue.pending, 0);
  const release = await queue.acquire();
  assert.equal(queue.pending, 1);
  release();
  release(); // must not double-decrement or release a second waiter early
  assert.equal(queue.pending, 0);
});

test("a throwing job still releases its slot", async () => {
  await assert.rejects(async () => {
    const queue = createSerialQueue();
    const release = await queue.acquire();
    try {
      throw new Error("boom");
    } finally {
      release();
    }
  }, /boom/);

  const queue = createSerialQueue();
  const release = await queue.acquire();
  release();
  assert.equal(queue.pending, 0);
});
