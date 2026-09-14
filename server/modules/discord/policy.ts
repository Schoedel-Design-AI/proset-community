import type { DiscordGuildSettings } from "@shared/schema";

export function shouldCaptureDiscordVoice(input: {
  isDirectMessage: boolean;
  hasArmedSession: boolean;
  isConfiguredInbox: boolean;
}): boolean {
  return input.isDirectMessage || input.hasArmedSession || input.isConfiguredInbox;
}

export function canPublishDiscordResult(
  settings: DiscordGuildSettings | undefined,
  sourceChannelId: string,
): boolean {
  return settings?.publishingEnabled !== false
    && (!settings?.publishChannelIds.length || settings.publishChannelIds.includes(sourceChannelId));
}

export function splitDiscordContent(value: string, size = 1900): string[] {
  const chunks: string[] = [];
  let remaining = value.trim();
  while (remaining.length > size) {
    let split = remaining.lastIndexOf("\n", size);
    if (split < size * 0.5) split = remaining.lastIndexOf(" ", size);
    if (split < size * 0.5) split = size;
    chunks.push(remaining.slice(0, split).trim());
    remaining = remaining.slice(split).trim();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}
