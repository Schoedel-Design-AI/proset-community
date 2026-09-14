import type { DiscordLocale } from "@shared/schema";

/**
 * Discord deliberately exposes only Proset's universal core conversions.
 * Pack-specific types (academic, research, slide deck, music, productivity
 * packs, and future specialty packs) must never be added implicitly.
 */
export const DISCORD_CORE_CONVERSIONS = [
  "summary",
  "bullet_points",
  "notes",
  "email",
  "todo_list",
  "outline",
  "text_message",
] as const;

export type DiscordConversionType = typeof DISCORD_CORE_CONVERSIONS[number];

export const DISCORD_CAPTURE_TTL_MS = 5 * 60 * 1000;
export const DISCORD_LINK_TTL_MS = 10 * 60 * 1000;
export const DISCORD_MAX_AUDIO_BYTES = 25 * 1024 * 1024;

export function isDiscordConversionType(value: unknown): value is DiscordConversionType {
  return typeof value === "string"
    && (DISCORD_CORE_CONVERSIONS as readonly string[]).includes(value);
}

export function discordLocale(value: unknown): DiscordLocale {
  return typeof value === "string" && value.toLowerCase().startsWith("es") ? "es" : "en";
}

export function discordPublicBaseUrl(): string {
  return (process.env.PUBLIC_APP_URL || "https://proset.ai").replace(/\/+$/, "");
}

export function isDiscordGatewayEnabled(): boolean {
  return process.env.DISCORD_GATEWAY_ENABLED === "true";
}

export function requireDiscordApplicationId(): string {
  const value = process.env.DISCORD_APPLICATION_ID?.trim();
  if (!value) throw new Error("DISCORD_APPLICATION_ID is required");
  return value;
}

export function requireDiscordBotToken(): string {
  const value = process.env.DISCORD_BOT_TOKEN?.trim();
  if (!value) throw new Error("DISCORD_BOT_TOKEN is required");
  return value;
}
