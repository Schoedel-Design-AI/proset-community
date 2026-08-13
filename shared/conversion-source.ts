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
