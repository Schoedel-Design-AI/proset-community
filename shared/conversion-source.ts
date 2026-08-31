export interface ConversionSourceAttachment {
  id: string;
  name: string;
  text: string;
  persisted?: boolean;
  revision?: number;
  sourceBucketFileId?: string | null;
  sourceMimeType?: string | null;
  sourceFileSize?: number | null;
  originalFilename?: string | null;
  sourceHash?: string | null;
  parserVersion?: string | null;
  contentEdited?: boolean;
  originalUnavailable?: boolean;
}

export interface ConversionSourceInput {
  transcript?: string | null;
  customText?: string | null;
  attachments?: ConversionSourceAttachment[] | null;
}

function appendSection(sections: string[], label: string, text?: string | null) {
  const normalized = text?.trim();
  if (normalized) {
    sections.push(`[${label}]\n${normalized}`);
  }
}

/**
 * Builds the single, labeled source document sent through clarification and
 * conversion. Labels keep supporting context distinguishable from the user's
 * original voice transcript.
 */
export function buildConversionSource({
  transcript,
  customText,
  attachments,
}: ConversionSourceInput): string {
  const sections: string[] = [];

  appendSection(sections, "VOICE TRANSCRIPT", transcript);
  appendSection(sections, "ADDITIONAL CONTEXT FROM USER", customText);

  for (const attachment of attachments || []) {
    const safeName = attachment.name.trim() || "Untitled file";
    const normalized = attachment.text.trim();
    if (normalized) {
      sections.push(
        `[UPLOADED FILE]\nSOURCE_METADATA ${JSON.stringify({ name: safeName })}\nCONTENT\n${normalized}`,
      );
    }
  }

  return sections.join("\n\n");
}

/**
 * Minimum source length for a TYPED text entry. A text entry has no audio and
 * no transcript, so it is the whole document the model gets — a few words are
 * not a convertible source.
 */
export const MIN_TEXT_ENTRY_CHARS = 100;

export interface ConversionSourceGateInput {
  /** True when the source is typed text with no recording behind it. */
  isTextEntry: boolean;
  /** transcript + custom context + attachment text, already trimmed. */
  sourceContentLength: number;
}

/**
 * Whether a conversion must be blocked because its source is too short.
 *
 * A spoken recording is never blocked for being brief (issue #195): the
 * 100-character floor forced users to pad a real transcript with filler
 * context just to unlock Convert, which degrades the output it was meant to
 * protect. Short voice notes convert as-is; only an empty source is refused,
 * and that case is already reported as "no transcript".
 *
 * Typed text entries keep the floor — there is no recording to fall back on.
 */
export function isConversionSourceTooShort({
  isTextEntry,
  sourceContentLength,
}: ConversionSourceGateInput): boolean {
  if (isTextEntry) return sourceContentLength < MIN_TEXT_ENTRY_CHARS;
  return sourceContentLength === 0;
}
