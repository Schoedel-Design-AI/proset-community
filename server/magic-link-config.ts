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

export function buildMagicLinkLoginUrl(token: string, baseUrl?: string): string {
  const origin = normalizeOrigin(baseUrl || process.env.PUBLIC_APP_URL || process.env.AIFORMS_PUBLIC_DOMAIN || "proset.ai");
  const url = new URL("/login", origin);
  url.searchParams.set("magic_token", token);
  return url.toString();
}
