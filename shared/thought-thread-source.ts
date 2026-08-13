import type {
  Recording,
  ThoughtThreadContext,
  ThoughtThreadItem,
  ThoughtThreadModelStrategy,
  ThoughtThreadOrderingMode,
} from "./schema";

export interface ThoughtThreadSourceItem extends ThoughtThreadItem {
  recording: Recording;
}

export interface ThoughtThreadSourceResult {
  source: string;
  orderedItems: ThoughtThreadSourceItem[];
  contexts: ThoughtThreadContext[];
  sourceRecordingIds: string[];
  contextEntryIds: string[];
  estimatedTokens: number;
  byteLength: number;
}

export const THOUGHT_THREAD_DIRECT_TOKEN_LIMIT = 48_000;
export const THOUGHT_THREAD_MAX_SOURCE_BYTES = 8 * 1024 * 1024;
export const THOUGHT_THREAD_CHUNK_MAX_BYTES = 180_000;

function timestamp(value: Date | string): number {
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

export function sortThoughtThreadItems(
  items: ThoughtThreadSourceItem[],
  orderingMode: ThoughtThreadOrderingMode,
): ThoughtThreadSourceItem[] {
  return [...items].sort((a, b) => {
    if (orderingMode === "manual") {
      return a.position - b.position || a.id.localeCompare(b.id);
    }
    return timestamp(a.recording.createdAt) - timestamp(b.recording.createdAt)
      || a.recording.id.localeCompare(b.recording.id);
  });
}

export function estimateThoughtThreadTokens(text: string): number {
  let asciiChars = 0;
  let nonAsciiBytes = 0;
  for (const character of text) {
    const codePoint = character.codePointAt(0) || 0;
    const bytes = codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;
    if (bytes === 1) asciiChars += 1;
    else nonAsciiBytes += bytes;
  }
  return Math.ceil((asciiChars / 4) + (nonAsciiBytes / 2));
}

export function thoughtThreadByteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

export function splitTextByUtf8Bytes(
  text: string,
  maxBytes = THOUGHT_THREAD_CHUNK_MAX_BYTES,
): string[] {
  if (maxBytes < 1) throw new Error("maxBytes must be positive");
  if (!text) return [];
  const chunks: string[] = [];
  let current = "";
  let currentBytes = 0;
  for (const character of text) {
    const codePoint = character.codePointAt(0) || 0;
    const characterBytes = codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;
    if (current && currentBytes + characterBytes > maxBytes) {
      chunks.push(current);
      current = "";
      currentBytes = 0;
    }
    current += character;
    currentBytes += characterBytes;
  }
  if (current) chunks.push(current);
  return chunks;
}

export function selectThoughtThreadModelStrategy(
  estimatedTokens: number,
): ThoughtThreadModelStrategy {
  return estimatedTokens <= THOUGHT_THREAD_DIRECT_TOKEN_LIMIT
    ? "direct"
    : "hierarchical";
}

export function buildThoughtThreadSource(
  items: ThoughtThreadSourceItem[],
  contexts: ThoughtThreadContext[],
  orderingMode: ThoughtThreadOrderingMode,
): ThoughtThreadSourceResult {
  const orderedItems = sortThoughtThreadItems(items, orderingMode)
    .filter((item) => item.included && item.recording.transcript.trim());
  const orderedContexts = [...contexts]
    .filter((context) => context.text.trim())
    .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));

  const sections: string[] = [
    [
      "[THOUGHT THREAD SOURCE RULES]",
      "Voice notes are immutable transcripts captured at different times.",
      "Later notes may clarify or explicitly supersede earlier notes.",
      "Preserve unresolved conflicts and uncertainty instead of inventing a resolution.",
      "Thread context and supporting files are not spoken transcript.",
    ].join("\n"),
  ];

  orderedItems.forEach((item, index) => {
    const date = new Date(item.recording.createdAt);
    const sourceDate = Number.isFinite(date.getTime())
      ? date.toISOString()
      : String(item.recording.createdAt);
    sections.push(
      [
        `[VOICE NOTE ${index + 1}]`,
        `SOURCE_METADATA ${JSON.stringify({
          recordingId: item.recording.id,
          capturedAt: sourceDate,
          title: item.recording.title.trim() || "Untitled",
          transcriptRevision: item.recording.transcriptRevision || 1,
        })}`,
        "TRANSCRIPT",
        item.recording.transcript.trim(),
      ].join("\n"),
    );
  });

  orderedContexts.forEach((context) => {
    const label = context.label.trim() || (context.kind === "file" ? "Untitled file" : "User context");
    sections.push([
      context.kind === "file" ? "[SUPPORTING FILE]" : "[THREAD CONTEXT]",
      `SOURCE_METADATA ${JSON.stringify({
        contextId: context.id,
        label,
        revision: context.revision || 1,
        originalFilename: context.originalFilename || undefined,
        sourceMimeType: context.sourceMimeType || undefined,
        sourceFileSize: context.sourceFileSize || undefined,
        sourceHash: context.sourceHash || undefined,
        parserVersion: context.parserVersion || undefined,
        contentEdited: context.contentEdited === true,
        relationship: context.relationship || undefined,
        relatedSourceId: context.relatedSourceId || undefined,
      })}`,
      "CONTENT",
      context.text.trim(),
    ].join("\n"));
  });

  const source = sections.join("\n\n");
  return {
    source,
    orderedItems,
    contexts: orderedContexts,
    sourceRecordingIds: orderedItems.map((item) => item.recordingId),
    contextEntryIds: orderedContexts.map((context) => context.id),
    estimatedTokens: estimateThoughtThreadTokens(source),
    byteLength: thoughtThreadByteLength(source),
  };
}
