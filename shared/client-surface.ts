/**
 * Client surface identity — "which Proset did this come from?"
 *
 * Proset ships ONE React Native codebase to three surfaces (Android app, iOS
 * app, browser). Two consequences shape this module:
 *
 *   1. A defect reported from one surface usually exists on the others, because
 *      they share the same TypeScript.
 *   2. The same person routinely uses Android *and* Web.
 *
 * So a report is never described with a single exclusive platform. Two separate
 * facts are modelled instead:
 *
 *   - `SurfaceSnapshot`  — where one report was filed (a fact about a request).
 *   - `ClientSurface[]`  — every surface an account has actually been seen on
 *     (a fact about the person), so triage never assumes "Android only".
 *
 * This module is pure: no React Native, no Express, no I/O. The app and the
 * server both import it so the wire format has exactly one definition.
 */

export type ClientSurface = "android" | "ios" | "web";

/**
 * Lowercase on purpose. HTTP header names are case-insensitive and Express
 * lowercases them on `req.headers`, so keeping one lowercase constant means the
 * client, the CORS allow-list, and the reader can never drift apart.
 */
export const CLIENT_SURFACE_HEADER = "x-proset-surface";

export const SURFACE_LABELS: Record<ClientSurface, string> = {
  android: "Android app",
  ios: "iOS app",
  web: "Web",
};

/** Short form for listing a set: "Android + Web" reads better than "Android app + Web". */
export const SURFACE_SHORT_LABELS: Record<ClientSurface, string> = {
  android: "Android",
  ios: "iOS",
  web: "Web",
};

/** Stable display order, so "Android + Web" never renders as "Web + Android". */
const SURFACE_ORDER: ClientSurface[] = ["android", "ios", "web"];

export type SurfaceSnapshot = {
  /** Where the report was filed. */
  surface: ClientSurface;
  /** App/bundle version (app.json version, kept in sync with Gradle versionName). */
  appVersion?: string;
  /** Android versionCode / build number. */
  build?: string;
  /** "Android 14", "iOS 18.1", or the host OS behind a browser. */
  osVersion?: string;
  /** Device model on native; browser name + major version on web. */
  device?: string;
  /** Web only: the host the app was served from. */
  origin?: string;
};

/**
 * Every field here is CLIENT-SUPPLIED and ends up in an email (HTML) and a
 * GitHub issue (Markdown). Allow only characters that cannot break an HTTP
 * header, an HTML attribute, or Markdown structure, and cap the length so a
 * hostile client cannot pad an issue body. Anything else is dropped, not
 * escaped — no legitimate device model needs it.
 */
const SAFE_VALUE = /[^A-Za-z0-9 ._+()/:-]/g;
const MAX_VALUE_LENGTH = 48;

export function sanitizeSurfaceValue(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const cleaned = raw.replace(SAFE_VALUE, " ").replace(/\s+/g, " ").trim().slice(0, MAX_VALUE_LENGTH).trim();
  return cleaned.length > 0 ? cleaned : undefined;
}

export function isClientSurface(value: unknown): value is ClientSurface {
  return typeof value === "string" && (SURFACE_ORDER as string[]).includes(value);
}

/**
 * Compact, header-safe wire format:
 *   `android; v=1.0.61; b=96; os=Android 14; d=Pixel 7`
 * Short keys keep every request header small; the parser is the only consumer.
 */
export function encodeSurfaceHeader(snapshot: SurfaceSnapshot): string {
  const parts: string[] = [snapshot.surface];
  const push = (key: string, value?: string) => {
    const safe = sanitizeSurfaceValue(value);
    if (safe) parts.push(`${key}=${safe}`);
  };
  push("v", snapshot.appVersion);
  push("b", snapshot.build);
  push("os", snapshot.osVersion);
  push("d", snapshot.device);
  push("o", snapshot.origin);
  return parts.join("; ");
}

export function parseSurfaceHeader(raw: unknown): SurfaceSnapshot | null {
  if (typeof raw !== "string" || raw.trim().length === 0) return null;
  const [head, ...rest] = raw.split(";").map((segment) => segment.trim());
  const surface = head?.toLowerCase();
  if (!isClientSurface(surface)) return null;

  const snapshot: SurfaceSnapshot = { surface };
  for (const segment of rest) {
    const index = segment.indexOf("=");
    if (index <= 0) continue;
    const key = segment.slice(0, index).trim().toLowerCase();
    const value = sanitizeSurfaceValue(segment.slice(index + 1));
    if (!value) continue;
    if (key === "v") snapshot.appVersion = value;
    else if (key === "b") snapshot.build = value;
    else if (key === "os") snapshot.osVersion = value;
    else if (key === "d") snapshot.device = value;
    else if (key === "o") snapshot.origin = value;
  }
  return snapshot;
}

/** Human line for an email row or issue body: "Android app 1.0.61 (build 96) · Android 14 · Pixel 7". */
export function formatSurface(snapshot: SurfaceSnapshot | null | undefined): string {
  if (!snapshot) return "Unknown surface";
  const label = SURFACE_LABELS[snapshot.surface];
  const head = snapshot.appVersion ? `${label} ${snapshot.appVersion}` : label;
  return [
    snapshot.build ? `${head} (build ${snapshot.build})` : head,
    snapshot.osVersion,
    snapshot.device,
    snapshot.origin,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** Keep only real surfaces, deduplicated, in stable order. */
export function normalizeSurfaces(value: unknown): ClientSurface[] {
  const input = Array.isArray(value) ? value : [];
  const seen = new Set<ClientSurface>();
  for (const entry of input) {
    const candidate = typeof entry === "string" ? entry.toLowerCase() : entry;
    if (isClientSurface(candidate)) seen.add(candidate);
  }
  return SURFACE_ORDER.filter((surface) => seen.has(surface));
}

export function mergeSurfaces(known: unknown, incoming?: ClientSurface | null): ClientSurface[] {
  const merged = new Set(normalizeSurfaces(known));
  if (incoming && isClientSurface(incoming)) merged.add(incoming);
  return SURFACE_ORDER.filter((surface) => merged.has(surface));
}

/** "Android + Web" — the answer to "is this Android or Web?" is often "both". */
export function formatSurfaces(surfaces: unknown): string {
  const list = normalizeSurfaces(surfaces);
  if (list.length === 0) return "Unknown";
  return list.map((surface) => SURFACE_SHORT_LABELS[surface]).join(" + ");
}

export function isCrossSurface(surfaces: unknown): boolean {
  return normalizeSurfaces(surfaces).length > 1;
}

/**
 * Fallback for clients that predate the surface header (already-installed
 * Android builds, or any request that lost the header to a proxy).
 *
 * Order matters: React Native's Android fetch sends `okhttp/…` and its iOS
 * fetch sends `CFNetwork/…`, while browsers always send a `Mozilla/5.0`
 * product token. Checking the native markers first prevents an Android WebView
 * UA — which also contains "Mozilla" and "Android" — from masking a real app.
 */
export function surfaceFromUserAgent(userAgent: unknown): ClientSurface | null {
  if (typeof userAgent !== "string" || userAgent.length === 0) return null;
  if (/okhttp|dalvik|android[\s/][\d.]+\)?\s*$/i.test(userAgent) && !/mozilla/i.test(userAgent)) return "android";
  if (/cfnetwork|darwin/i.test(userAgent) && !/mozilla/i.test(userAgent)) return "ios";
  if (/mozilla|chrome|safari|firefox|edg\/|opr\//i.test(userAgent)) return "web";
  return null;
}
