export function getTranscriptionText(data: Record<string, unknown> | null | undefined): string {
  const raw = typeof data?.text === "string"
    ? data.text
    : typeof data?.transcript === "string"
      ? data.transcript
      : "";

  return raw.trim();
}

export function hasTranscriptionContent(data: Record<string, unknown> | null | undefined): boolean {
  if (data?.empty === true) return false;
  const text = getTranscriptionText(data);
  // Reject content that is just punctuation, whitespace, or trivially short
  if (text.length === 0) return false;
  const meaningful = text.replace(/[\s\p{P}\p{S}]+/gu, "");
  return meaningful.length >= 3;
}

export function getUploadedAudioUri(data: Record<string, unknown> | null | undefined): string {
  if (typeof data?.audioUri === "string" && data.audioUri.trim()) {
    return data.audioUri;
  }

  if (typeof data?.audioUrl === "string" && data.audioUrl.trim()) {
    return data.audioUrl;
  }

  return "";
}