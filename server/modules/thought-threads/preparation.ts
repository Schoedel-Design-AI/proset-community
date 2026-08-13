import { createHash, randomUUID } from "node:crypto";
import type {
  ThoughtThreadConversionRun,
  ThoughtThreadModelRouteSnapshot,
} from "@shared/schema";
import {
  estimateThoughtThreadTokens,
  splitTextByUtf8Bytes,
  thoughtThreadByteLength,
} from "@shared/thought-thread-source";
import {
  createOpenAIClient,
  getChatCompletionTokenOptions,
  type AIClientProvider,
} from "../../openai-client";
import type { ConversionModelRoute } from "../../conversion-model-routing";
import { storage } from "../../storage";
import {
  buildRunChunks,
  failThoughtThreadRun,
  loadRunSourceSnapshot,
} from "./service";

const MAX_HIERARCHICAL_CHUNK_BYTES = 24_000;
const PREPARATION_LEASE_MS = 15 * 60 * 1000;

function digest(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function splitForPreparation(text: string): string[] {
  if (thoughtThreadByteLength(text) <= MAX_HIERARCHICAL_CHUNK_BYTES) return [text];
  const chunks: string[] = [];
  let current = "";
  const append = (part: string) => {
    if (!part) return;
    if (thoughtThreadByteLength(part) > MAX_HIERARCHICAL_CHUNK_BYTES) {
      if (current) chunks.push(current);
      current = "";
      chunks.push(...splitTextByUtf8Bytes(part, MAX_HIERARCHICAL_CHUNK_BYTES));
      return;
    }
    if (
      current
      && thoughtThreadByteLength(current + part) > MAX_HIERARCHICAL_CHUNK_BYTES
    ) {
      chunks.push(current);
      current = "";
    }
    current += part;
  };
  for (const line of text.match(/[^\n]*\n|[^\n]+$/g) || [text]) append(line);
  if (current) chunks.push(current);
  return chunks;
}

function frozenRoutes(
  snapshots: ThoughtThreadModelRouteSnapshot[] | undefined,
): ConversionModelRoute[] {
  if (!snapshots?.length) {
    throw new Error("This preparation run does not contain a frozen model route.");
  }
  return snapshots.map(({ inputTokenLimit: _inputTokenLimit, ...route }) => ({
    ...route,
    provider: route.provider as AIClientProvider,
    bucket: route.bucket as ConversionModelRoute["bucket"],
    selectedModelId: route.selectedModelId as ConversionModelRoute["selectedModelId"],
  }));
}

async function extractEvidenceLedger(
  label: string,
  text: string,
  routes: ConversionModelRoute[],
): Promise<string> {
  let lastError: unknown;
  for (const route of routes) {
    try {
      const client = createOpenAIClient(route.provider);
      const outputBudget = Math.min(
        4_096,
        Math.max(1_200, Math.ceil(estimateThoughtThreadTokens(text) * 0.75)),
      );
      const response = await client.chat.completions.create({
        model: route.model,
        messages: [
          {
            role: "system",
            content: [
              "Create a faithful evidence ledger for one immutable source segment in a longer Thought Thread.",
              "Preserve every source label, name, date, number, decision, task, correction, uncertainty, conflict, example, and qualification.",
              "Do not resolve conflicts, add facts, improve the speaker's position, or write the final deliverable.",
              "Use dense atomic bullets and retain the original source labels on every bullet.",
            ].join(" "),
          },
          { role: "user", content: `${label}\n\n${text}` },
        ],
        ...getChatCompletionTokenOptions(route.provider, outputBudget),
      });
      const content = response.choices[0]?.message?.content?.trim();
      if (!content) throw new Error("The evidence extraction returned no content.");
      const audit = await client.chat.completions.create({
        model: route.model,
        messages: [
          {
            role: "system",
            content: [
              "Audit the evidence ledger against the immutable original segment.",
              "Return [COMPLETE] only when every material statement and qualification is represented.",
              "Otherwise return only missing evidence as atomic bullets retaining the original source labels.",
            ].join(" "),
          },
          {
            role: "user",
            content: `${label}\n\nORIGINAL SOURCE:\n${text}\n\nDRAFT LEDGER:\n${content}`,
          },
        ],
        ...getChatCompletionTokenOptions(route.provider, 2_048),
      });
      const missing = audit.choices[0]?.message?.content?.trim();
      return missing && missing !== "[COMPLETE]"
        ? `${content}\n${missing}`
        : content;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError ?? new Error("Could not prepare the large Thought Thread source.");
}

function segmentFrozenSource(source: string): Array<{ label: string; text: string }> {
  const sections = source.split(
    /\n\n(?=\[(?:VOICE NOTE \d+|THREAD CONTEXT|SUPPORTING FILE)\])/,
  );
  const units: Array<{ label: string; text: string }> = [];
  sections.forEach((section, sectionIndex) => {
    const chunks = splitForPreparation(section);
    chunks.forEach((text, chunkIndex) => {
      units.push({
        label: `[FROZEN SOURCE SEGMENT ${sectionIndex + 1} | part:${chunkIndex + 1}/${chunks.length}]`,
        text,
      });
    });
  });
  return units;
}

async function extendLeaseAndProgress(
  run: ThoughtThreadConversionRun,
  leaseToken: string,
  completed: number,
  total: number,
): Promise<void> {
  await storage.thoughtThreadRuns.update(run.id, run.userId, {
    progressCompleted: completed,
    progressTotal: total,
    updatedAt: new Date().toISOString(),
    leaseToken,
    leaseExpiresAt: new Date(Date.now() + PREPARATION_LEASE_MS).toISOString(),
  });
}

async function buildPreparedSource(
  run: ThoughtThreadConversionRun,
  source: string,
  leaseToken: string,
): Promise<string> {
  const routes = frozenRoutes(run.modelRoutes);
  const directTokenLimit = run.directTokenLimit;
  if (!directTokenLimit) throw new Error("This preparation run has no frozen input limit.");
  const units = segmentFrozenSource(source);
  await extendLeaseAndProgress(run, leaseToken, 0, units.length);
  const ledgers: string[] = [];
  for (let index = 0; index < units.length; index += 1) {
    const current = await storage.thoughtThreadRuns.get(run.id, run.threadId, run.userId);
    if (!current || current.status === "cancelled") {
      throw Object.assign(new Error("Thought Thread preparation was cancelled."), {
        code: "preparation_cancelled",
      });
    }
    ledgers.push(await extractEvidenceLedger(units[index].label, units[index].text, routes));
    await extendLeaseAndProgress(run, leaseToken, index + 1, units.length);
  }

  let prepared = [
    "[THOUGHT THREAD HIERARCHICAL SOURCE]",
    "The following evidence ledgers were derived from an immutable, hash-verified source snapshot.",
    "Original source labels are authoritative. Preserve unresolved conflicts.",
    ...ledgers,
  ].join("\n\n");
  for (let level = 2; estimateThoughtThreadTokens(prepared) > directTokenLimit && level <= 4; level += 1) {
    const chunks = splitForPreparation(prepared);
    const merged: string[] = [];
    for (let index = 0; index < chunks.length; index += 1) {
      merged.push(await extractEvidenceLedger(
        `[HIERARCHICAL MERGE | level:${level} | part:${index + 1}/${chunks.length}]`,
        chunks[index],
        routes,
      ));
      await extendLeaseAndProgress(run, leaseToken, units.length + index + 1, units.length + chunks.length);
    }
    prepared = [
      `[THOUGHT THREAD HIERARCHICAL SOURCE | level:${level}]`,
      "Original recording and context labels remain authoritative.",
      ...merged,
    ].join("\n\n");
  }
  if (estimateThoughtThreadTokens(prepared) > directTokenLimit) {
    throw new Error(
      "The audited evidence ledgers still exceed the frozen fallback input limit. Split the Thought Thread and retry.",
    );
  }
  return prepared;
}

export async function prepareThoughtThreadRunJob(
  runId: string,
  threadId: string,
  userId: string,
  terminalFailure: boolean,
): Promise<ThoughtThreadConversionRun | undefined> {
  const leaseToken = randomUUID();
  const claimed = await storage.thoughtThreadRuns.claimLease(
    runId,
    threadId,
    userId,
    ["preparing"],
    leaseToken,
    new Date(Date.now() + PREPARATION_LEASE_MS).toISOString(),
  );
  if (!claimed) return storage.thoughtThreadRuns.get(runId, threadId, userId);
  try {
    const source = await loadRunSourceSnapshot(claimed);
    const preparedSource = await buildPreparedSource(claimed, source, leaseToken);
    const preparedHash = digest(preparedSource);
    await storage.thoughtThreadRunChunks.replaceKind(
      runId,
      threadId,
      userId,
      "prepared",
      buildRunChunks(claimed, "prepared", preparedSource),
    );
    return storage.thoughtThreadRuns.transition(
      runId,
      threadId,
      userId,
      ["preparing"],
      {
        status: "prepared",
        preparedHash,
        preparedByteLength: thoughtThreadByteLength(preparedSource),
        updatedAt: new Date().toISOString(),
        leaseToken: null,
        leaseExpiresAt: null,
        error: null,
      },
    );
  } catch (error: any) {
    if (error?.code === "preparation_cancelled") {
      return storage.thoughtThreadRuns.get(runId, threadId, userId);
    }
    if (terminalFailure) {
      return failThoughtThreadRun(runId, threadId, userId, error);
    }
    await storage.thoughtThreadRuns.update(runId, userId, {
      error: String(error?.message || "Preparation failed.").slice(0, 500),
      updatedAt: new Date().toISOString(),
      leaseToken: null,
      leaseExpiresAt: null,
    });
    throw error;
  }
}
