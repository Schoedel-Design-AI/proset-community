/**
 * The print job runner: one serialized job at a time, with observable state.
 *
 * Responsibilities (and why each one lives here rather than in an engine):
 *  - SERIALIZE: the Android converter is a singleton (PdfConverter.getInstance()) and
 *    rejects a concurrent conversion with CONVERSION_IN_PROGRESS. A queue removes that
 *    failure mode instead of repeatedly handling it.
 *  - SUPERVISE: a deadline turns a hung generation into a typed "pdf_generation_timeout"
 *    instead of a spinner that never stops.
 *  - RETRY ONCE on conversion_in_progress, passing attempt=2 so the engine can ask the
 *    converter to forceReset() (the library exposes `forceReset` for exactly this).
 *  - CLEAN UP: the artifact (a temp PDF in the Android cache dir) is discarded in a
 *    finally block. Cleanup failures are logged, never surfaced as print failures.
 *  - EXPOSE STATE: subscribers receive a fresh immutable snapshot per transition, so React
 *    can bind with useSyncExternalStore and the UI derives isGeneratingPdf / isPrinting /
 *    printError from one machine.
 *
 * The engine is injected, which is what makes all of the above testable without a device,
 * a browser, or a PDF library.
 */

import { PrintError, classifyPrintFailure, isPrintError } from "./print-errors";
import { SerialQueue, createSerialQueue, withTimeout } from "./print-async";
import { DEFAULT_PRINT_OPTIONS, PrintOptions, resolveFileName } from "./print-types";
import { resolveGenerationTimeoutMs } from "./print-html";

export type PrintPlatform = "android" | "ios" | "web" | "unsupported";

export type PrintGenerateRequest = {
  html: string;
  title: string;
  fileName: string;
  options: PrintOptions;
  estimatedPages: number | null;
  /** 1-based. attempt > 1 tells the Android engine to forceReset() the converter first. */
  attempt: number;
};

export type PrintArtifact = {
  platform: PrintPlatform;
  /** Native cache path (Android/iOS). Absent on web, where the browser owns the PDF. */
  filePath?: string;
  bytes?: number;
  pages?: number | null;
  /** Paths the runner is allowed to delete after the job. */
  tempPaths: string[];
};

export type PrintPresentMode = "native-print-dialog" | "system-share-sheet" | "browser-print-dialog";

export type PrintPresentResult = { mode: PrintPresentMode; dismissed: boolean };

export type PrintEngine = {
  readonly platform: PrintPlatform;
  /** Build the platform artifact. Must throw (or reject) with a native code when it fails. */
  generate(request: PrintGenerateRequest): Promise<PrintArtifact>;
  /** Hand the artifact to the user: native print dialog, share sheet, or browser print. */
  present(artifact: PrintArtifact, request: PrintGenerateRequest): Promise<PrintPresentResult>;
  /** Best-effort removal of temporary files. Must not throw for a missing file. */
  discard(artifact: PrintArtifact): Promise<void>;
};

export type PrintJobPhase = "idle" | "preparing" | "generating" | "presenting" | "done" | "error" | "cancelled";

export type PrintJobState = {
  phase: PrintJobPhase;
  jobId: string | null;
  startedAt: number | null;
  finishedAt: number | null;
  fileName: string | null;
  estimatedPages: number | null;
  /** Non-fatal notes (skipped images, cleanup problems). Diagnostics, not UI copy. */
  warnings: string[];
  error: PrintError | null;
};

export type PrintOutcome =
  | { status: "printed"; present: PrintPresentResult; warnings: string[] }
  | { status: "cancelled"; warnings: string[] }
  | { status: "failed"; error: PrintError; warnings: string[] };

export type PrintRunInput = {
  /** Fully prepared HTML (buildPrintDocument + inlineExternalImages already applied). */
  html: string;
  title: string;
  estimatedPages?: number | null;
  options?: Partial<PrintOptions>;
  /** Non-fatal notes from the preparation stage. */
  warnings?: string[];
};

export type PrintRunnerDeps = {
  engine: PrintEngine;
  queue?: SerialQueue;
  now?: () => number;
  newJobId?: () => string;
  /** Default true. Set false when the caller keeps the generated file. */
  cleanupTempFiles?: boolean;
  /** Total generation attempts per job. Default 2 (one retry for conversion_in_progress). */
  maxGenerateAttempts?: number;
  /**
   * Explicit supervision deadline, overriding the page-count-derived one. Use when the
   * caller knows better than the heuristic (a platform with no native watchdog, or a
   * diagnostics/test path that must fail fast). Not a way to make a long document succeed:
   * the Android converter enforces its own 30 s watchdog regardless.
   */
  timeoutMs?: number;
  log?: (message: string, detail?: unknown) => void;
};

export type PrintRunner = {
  run(input: PrintRunInput): Promise<PrintOutcome>;
  /** Stops the CURRENT job before presentation. Native work already started cannot be aborted. */
  cancel(): void;
  reset(): void;
  getState(): PrintJobState;
  subscribe(listener: (state: PrintJobState) => void): () => void;
};

const IDLE_STATE: PrintJobState = {
  phase: "idle",
  jobId: null,
  startedAt: null,
  finishedAt: null,
  fileName: null,
  estimatedPages: null,
  warnings: [],
  error: null,
};

/**
 * UI policy, kept pure so it is testable: a print job that finishes quickly must not flash
 * a spinner. The button shows its busy state only after `delayMs` in a running phase.
 */
export const PRINT_BUSY_DELAY_MS = 200;

export function shouldShowBusyIndicator(phase: PrintJobPhase, elapsedMs: number, delayMs: number): boolean {
  if (phase !== "preparing" && phase !== "generating" && phase !== "presenting") return false;
  return elapsedMs >= Math.max(0, delayMs);
}

export function createPrintRunner(deps: PrintRunnerDeps): PrintRunner {
  const queue = deps.queue ?? createSerialQueue();
  const now = deps.now ?? (() => Date.now());
  const newJobId = deps.newJobId ?? (() => `print-${Math.random().toString(36).slice(2, 10)}`);
  const log = deps.log ?? (() => {});
  const cleanupTempFiles = deps.cleanupTempFiles ?? true;
  const maxAttempts = Math.max(1, deps.maxGenerateAttempts ?? 2);

  let state: PrintJobState = IDLE_STATE;
  let cancelled = false;
  let activeJobId: string | null = null;
  const listeners = new Set<(state: PrintJobState) => void>();

  function setState(patch: Partial<PrintJobState>): void {
    state = { ...state, ...patch };
    for (const listener of listeners) listener(state);
  }

  async function run(input: PrintRunInput): Promise<PrintOutcome> {
    const options: PrintOptions = { ...DEFAULT_PRINT_OPTIONS, ...input.options };
    const warnings = [...(input.warnings ?? [])];
    const jobId = newJobId();
    const fileName = resolveFileName(input.title, "transcript");
    const estimatedPages = input.estimatedPages ?? null;

    cancelled = false;
    activeJobId = jobId;
    setState({
      phase: "preparing",
      jobId,
      startedAt: now(),
      finishedAt: null,
      fileName,
      estimatedPages,
      warnings,
      error: null,
    });

    // Waiting for the queue is part of "preparing": a second tap must show a busy state,
    // not a silent stall.
    const release = await queue.acquire();
    let artifact: PrintArtifact | null = null;
    let failurePhase: "generate" | "present" = "generate";

    try {
      const request: PrintGenerateRequest = {
        html: input.html,
        title: input.title,
        fileName,
        options,
        estimatedPages,
        attempt: 1,
      };
      const timeoutMs = deps.timeoutMs ?? resolveGenerationTimeoutMs(options, estimatedPages);
      if (warnings.length > 0) log("print: preparing with warnings", { warnings });
      setState({ phase: "generating" });

      let attempt = 1;
      for (;;) {
        try {
          artifact = await withTimeout(deps.engine.generate({ ...request, attempt }), timeoutMs, "pdf-generation");
          break;
        } catch (raw) {
          const error = classifyPrintFailure(raw, "generate");
          const retryNow = error.code === "conversion_in_progress" && attempt < maxAttempts && !cancelled;
          if (!retryNow) throw error;
          attempt += 1;
          log("print: converter was busy, retrying", { attempt });
        }
      }

      if (cancelled) {
        warnings.push("cancelled-before-present");
        setState({ phase: "cancelled", finishedAt: now() });
        return { status: "cancelled", warnings };
      }

      failurePhase = "present";
      setState({ phase: "presenting" });
      const present = await deps.engine.present(artifact, request);
      setState({ phase: "done", finishedAt: now() });
      return { status: "printed", present, warnings };
    } catch (raw) {
      const error = classifyPrintFailure(raw, failurePhase);
      const cancelledByUser = error.code === "user_cancelled";
      setState({
        phase: cancelledByUser ? "cancelled" : "error",
        error: cancelledByUser ? null : error,
        finishedAt: now(),
      });
      if (!cancelledByUser) log("print: job failed", error.toJSON());
      return cancelledByUser ? { status: "cancelled", warnings } : { status: "failed", error, warnings };
    } finally {
      release();
      activeJobId = null;
      if (artifact && cleanupTempFiles) {
        try {
          await deps.engine.discard(artifact);
        } catch (cleanupError) {
          // A temp file left in the cache directory is the OS's problem, not the user's.
          // Never let it turn a successful print into a failure.
          log("print: temp cleanup failed", isPrintError(cleanupError) ? cleanupError.toJSON() : cleanupError);
        }
      }
    }
  }

  function cancel(): void {
    if (activeJobId === null) return;
    cancelled = true;
  }

  function reset(): void {
    if (activeJobId !== null) return;
    cancelled = false;
    setState(IDLE_STATE);
  }

  return {
    run,
    cancel,
    reset,
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
