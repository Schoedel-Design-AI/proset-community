function extractHost(hostOrOrigin: string): string {
  return hostOrOrigin.replace(/^https?:\/\//i, "").replace(/\/+$/, "");
}

function isLocalOrigin(hostOrOrigin: string): boolean {
  const host = extractHost(hostOrOrigin);
  return host.startsWith("localhost") || host.startsWith("127.0.0.1");
}

export function normalizeOrigin(hostOrOrigin: string): string {
  const trimmed = hostOrOrigin.trim().replace(/\/+$/, "");
  if (!trimmed) return "https://proset.ai";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  const protocol = isLocalOrigin(trimmed) ? "http" : "https";
  return `${protocol}://${trimmed}`;
}

export function parseBooleanEnv(value?: string | null): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

export function isMagicLinkEnabled(): boolean {
  return parseBooleanEnv(process.env.AUTH_MAGIC_LINK_ENABLED);
}

/**
 * Lifetime of one magic link, in minutes. Defaults to 72 hours (3 days) —
 * the deliberate Friends-of-Barry sign-in window, matching the invite
 * password-reset link's 3-day expiry rather than the 10-minute reset-link
 * habit; override only with a reason.
 */
export function getMagicLinkExpiryMinutes(defaultMinutes = 60 * 24 * 3): number {
  const raw = Number(process.env.AUTH_MAGIC_LINK_EXPIRY_MINUTES);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : defaultMinutes;
}

export function buildMagicLinkLoginUrl(token: string, baseUrl?: string): string {
  const origin = normalizeOrigin(baseUrl || process.env.PUBLIC_APP_URL || process.env.AIFORMS_PUBLIC_DOMAIN || "proset.ai");
  const url = new URL("/login", origin);
  url.searchParams.set("magic_token", token);
  return url.toString();
}
