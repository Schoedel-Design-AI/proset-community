import { Mistral } from "@mistralai/mistralai";
import { toFile } from "openai";

import {
  createOpenAIClient,
} from "./openai-client";

export type TranscriptionProvider = "groq" | "mistral" | "openai";

export interface TranscriptionRoute {
  provider: TranscriptionProvider;
  model: string;
  timeoutMs: number;
  /**
   * Start the next configured provider after this many milliseconds even when
   * this request is still pending. A failure starts the next provider
   * immediately.
   */
  hedgeAfterMs: number;
}

export interface TranscriptionInput {
  fileBuffer: Buffer;
  fileName: string;
  language?: string;
  prompt?: string;
}

export interface TranscriptionResult {
  text: string;
  provider: TranscriptionProvider;
  model: string;
  elapsedMs: number;
}

type RouteRunner = (
  route: TranscriptionRoute,
  signal: AbortSignal,
) => Promise<string>;

const DEFAULT_GROQ_TIMEOUT_MS = 15_000;
const DEFAULT_MISTRAL_TIMEOUT_MS = 30_000;
const DEFAULT_OPENAI_TIMEOUT_MS = 45_000;
const DEFAULT_PRIMARY_HEDGE_MS = 3_000;
const DEFAULT_SECONDARY_HEDGE_MS = 15_000;
const DEFAULT_TOTAL_TIMEOUT_MS = 60_000;

let mistralClient: Mistral | null = null;

function getPositiveInteger(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
): number {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function getMistralApiKey(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const value = env.MISTRAL_API_KEY?.trim();
  return value || undefined;
}

function getGroqApiKey(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const value = env.GROQ_API_KEY?.trim();
  return value || undefined;
}

function getDefaultOpenAIApiKey(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const value =
    env.AI_INTEGRATIONS_OPENAI_API_KEY?.trim() ||
    env.OPENAI_API_KEY?.trim();
  return value || undefined;
}

function getMistralClient(apiKey: string): Mistral {
  if (!mistralClient) {
    mistralClient = new Mistral({ apiKey });
  }
  return mistralClient;
}

/**
 * Latency-first route order. Missing credentials remove a provider instead of
 * making the request fail at that slot.
 */
export function getTranscriptionRoutes(
  env: NodeJS.ProcessEnv = process.env,
): TranscriptionRoute[] {
  const routes: TranscriptionRoute[] = [];

  if (getGroqApiKey(env)) {
    routes.push({
      provider: "groq",
      model: env.GROQ_TRANSCRIPTION_MODEL || "whisper-large-v3-turbo",
      timeoutMs: getPositiveInteger(
        env,
        "TRANSCRIPTION_GROQ_TIMEOUT_MS",
        DEFAULT_GROQ_TIMEOUT_MS,
      ),
      hedgeAfterMs: getPositiveInteger(
        env,
        "TRANSCRIPTION_PRIMARY_HEDGE_MS",
        DEFAULT_PRIMARY_HEDGE_MS,
      ),
    });
  }

  if (getMistralApiKey(env)) {
    routes.push({
      provider: "mistral",
      model: env.MISTRAL_TRANSCRIPTION_MODEL || "voxtral-mini-2602",
      timeoutMs: getPositiveInteger(
        env,
        "TRANSCRIPTION_MISTRAL_TIMEOUT_MS",
        DEFAULT_MISTRAL_TIMEOUT_MS,
      ),
      hedgeAfterMs: getPositiveInteger(
        env,
        "TRANSCRIPTION_SECONDARY_HEDGE_MS",
        DEFAULT_SECONDARY_HEDGE_MS,
      ),
    });
  }

  if (getDefaultOpenAIApiKey(env)) {
    routes.push({
      provider: "openai",
      model: env.OPENAI_TRANSCRIPTION_MODEL || "gpt-4o-transcribe",
      timeoutMs: getPositiveInteger(
        env,
        "TRANSCRIPTION_OPENAI_TIMEOUT_MS",
        DEFAULT_OPENAI_TIMEOUT_MS,
      ),
      hedgeAfterMs: DEFAULT_SECONDARY_HEDGE_MS,
    });
  }

  return routes;
}

export function getTranscriptionTotalTimeoutMs(
  env: NodeJS.ProcessEnv = process.env,
): number {
  return getPositiveInteger(
    env,
    "TRANSCRIPTION_TOTAL_TIMEOUT_MS",
    DEFAULT_TOTAL_TIMEOUT_MS,
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Launches the next provider when the current one fails or crosses its hedge
 * threshold. The first successful transcript wins and all slower requests are
 * aborted. There are no same-provider retries.
 */
export async function runHedgedTranscription(
  routes: TranscriptionRoute[],
  runRoute: RouteRunner,
  totalTimeoutMs: number,
): Promise<TranscriptionResult> {
  if (routes.length === 0) {
    throw new Error("No transcription providers are configured");
  }

  const startedAt = Date.now();
  const controllers = new Map<number, AbortController>();
  const hedgeTimers = new Map<number, ReturnType<typeof setTimeout>>();
  const errors: Array<{ route: TranscriptionRoute; error: unknown }> = [];
  const launched = new Set<number>();

  return new Promise<TranscriptionResult>((resolve, reject) => {
    let settled = false;
    let activeCount = 0;

    const finish = (
      action: () => void,
      winningIndex?: number,
    ) => {
      if (settled) return;
      settled = true;
      clearTimeout(totalTimer);
      for (const timer of hedgeTimers.values()) clearTimeout(timer);
      for (const [index, controller] of controllers) {
        if (index !== winningIndex) controller.abort();
      }
      action();
    };

    const rejectWhenExhausted = () => {
      if (settled || activeCount > 0 || launched.size < routes.length) return;
      const details = errors
        .map(({ route, error }) => `${route.provider}: ${errorMessage(error)}`)
        .join("; ");
      finish(() =>
        reject(new Error(`All transcription providers failed${details ? ` (${details})` : ""}`)),
      );
    };

    const launch = (index: number) => {
      if (settled || index >= routes.length || launched.has(index)) return;
      launched.add(index);
      activeCount += 1;

      const route = routes[index];
      const controller = new AbortController();
      controllers.set(index, controller);

      if (index + 1 < routes.length) {
        const hedgeTimer = setTimeout(() => launch(index + 1), route.hedgeAfterMs);
        hedgeTimers.set(index, hedgeTimer);
      }

      const routeTimer = setTimeout(() => {
        controller.abort(new Error(`${route.provider} exceeded ${route.timeoutMs}ms`));
      }, route.timeoutMs);

      void runRoute(route, controller.signal)
        .then((text) => {
          if (!text.trim()) {
            throw new Error("Provider returned an empty transcript");
          }
          finish(
            () =>
              resolve({
                text,
                provider: route.provider,
                model: route.model,
                elapsedMs: Date.now() - startedAt,
              }),
            index,
          );
        })
        .catch((error: unknown) => {
          if (settled) return;
          errors.push({ route, error });
          activeCount -= 1;
          const hedgeTimer = hedgeTimers.get(index);
          if (hedgeTimer) clearTimeout(hedgeTimer);
          launch(index + 1);
          rejectWhenExhausted();
        })
        .finally(() => {
          clearTimeout(routeTimer);
        });
    };

    const totalTimer = setTimeout(() => {
      finish(() =>
        reject(
          new Error(
            `Transcription exceeded the ${totalTimeoutMs}ms latency budget`,
          ),
        ),
      );
    }, totalTimeoutMs);

    launch(0);
  });
}

async function transcribeMistral(
  route: TranscriptionRoute,
  input: TranscriptionInput,
  signal: AbortSignal,
): Promise<string> {
  const apiKey = getMistralApiKey();
  if (!apiKey) throw new Error("MISTRAL_API_KEY is not configured");

  const contextBias = input.prompt?.trim() ? [input.prompt.trim()] : undefined;
  const result = await getMistralClient(apiKey).audio.transcriptions.complete(
    {
      model: route.model,
      file: {
        fileName: input.fileName,
        content: new Uint8Array(input.fileBuffer),
      },
      language: input.language,
      contextBias,
      stream: false,
    },
    {
      signal,
      retries: { strategy: "none" },
      timeoutMs: route.timeoutMs,
    },
  );
  return result.text;
}

async function transcribeOpenAICompatible(
  route: TranscriptionRoute,
  input: TranscriptionInput,
  signal: AbortSignal,
): Promise<string> {
  const provider = route.provider === "groq" ? "groq" : "default";
  const client = createOpenAIClient(provider);
  const file = await toFile(input.fileBuffer, input.fileName);
  const result = await client.audio.transcriptions.create(
    {
      file,
      model: route.model,
      language: input.language,
      prompt: input.prompt,
    },
    {
      signal,
      maxRetries: 0,
    },
  );
  return result.text;
}

export async function transcribeAudioLatencyFirst(
  input: TranscriptionInput,
  env: NodeJS.ProcessEnv = process.env,
): Promise<TranscriptionResult> {
  const routes = getTranscriptionRoutes(env);
  const totalTimeoutMs = getTranscriptionTotalTimeoutMs(env);

  return runHedgedTranscription(
    routes,
    async (route, signal) => {
      const providerStartedAt = Date.now();
      console.log(
        `[transcribe] Starting ${route.provider} (model: ${route.model}, deadline: ${route.timeoutMs}ms)`,
      );
      try {
        const text =
          route.provider === "mistral"
            ? await transcribeMistral(route, input, signal)
            : await transcribeOpenAICompatible(route, input, signal);
        console.log(
          `[transcribe] ${route.provider} completed in ${Date.now() - providerStartedAt}ms`,
        );
        return text;
      } catch (error) {
        console.warn(
          `[transcribe] ${route.provider} stopped after ${Date.now() - providerStartedAt}ms: ${errorMessage(error)}`,
        );
        throw error;
      }
    },
    totalTimeoutMs,
  );
}
