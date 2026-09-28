/**
 * Tiny async primitives for the print job runner. Pure TypeScript: no platform APIs.
 */

export class PrintTimeoutError extends Error {
  readonly label: string;
  readonly timeoutMs: number;

  constructor(label: string, timeoutMs: number) {
    super(`${label} timed out after ${timeoutMs}ms`);
    this.name = "PrintTimeoutError";
    this.label = label;
    this.timeoutMs = timeoutMs;
  }
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Supervises a promise with a deadline.
 *
 * The underlying work is NOT cancelled (neither the Android TurboModule call nor a
 * browser print can be aborted once started) — the timeout only decides when the
 * caller stops waiting and reports a timeout. The job runner therefore still performs
 * cleanup after a timeout, using whatever the engine handed back.
 */
export function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new PrintTimeoutError(label, timeoutMs));
    }, timeoutMs);

    promise.then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export type SerialQueue = {
  /** Resolves with the release function once this caller owns the slot. */
  acquire(): Promise<() => void>;
  /** Number of holders (waiting or active). Exposed for tests and diagnostics. */
  readonly pending: number;
};

/**
 * FIFO mutex built from a promise chain.
 *
 * Guarantees at most one holder at a time and preserves arrival order, which is exactly
 * the contract the Android PDF converter requires (it is a singleton and rejects a
 * second concurrent conversion with CONVERSION_IN_PROGRESS).
 */
export function createSerialQueue(): SerialQueue {
  let tail: Promise<void> = Promise.resolve();
  let pending = 0;

  return {
    get pending() {
      return pending;
    },
    async acquire(): Promise<() => void> {
      pending += 1;
      let releaseNext!: () => void;
      const held = new Promise<void>((resolve) => {
        releaseNext = resolve;
      });
      const previous = tail;
      tail = previous.then(() => held);
      await previous;

      let released = false;
      return () => {
        if (released) return;
        released = true;
        pending -= 1;
        releaseNext();
      };
    },
  };
}
