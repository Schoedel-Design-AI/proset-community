import { Platform } from "react-native";
import appConfig from "../app.json";
import {
  CLIENT_SURFACE_HEADER,
  encodeSurfaceHeader,
  type ClientSurface,
  type SurfaceSnapshot,
} from "@shared/client-surface";

/**
 * Runtime detection of the surface this copy of Proset is running on.
 *
 * Why app.json is the version source: `scripts/build-android.sh` refuses to
 * build unless `package.json`, `app.json`, and Gradle's `versionName` all
 * match, so app.json is already a guarded single source of truth. Reading it
 * here avoids inventing a fourth place to bump on every release, and needs no
 * extra build-time env plumbing (babel/vite/build script) to work on both
 * native and web.
 *
 * Nothing here is a secret: app.json ships inside the app already.
 */

type AppConfig = {
  version?: string;
  android?: { versionCode?: number };
};

const config = appConfig as AppConfig;

/** `Platform.constants` is Android/iOS-shaped and absent on react-native-web. */
function nativeConstants(): Record<string, unknown> {
  const constants = (Platform as unknown as { constants?: unknown }).constants;
  return constants && typeof constants === "object" ? (constants as Record<string, unknown>) : {};
}

function asText(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim().length > 0) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

function currentSurface(): ClientSurface {
  const os = Platform.OS;
  if (os === "android" || os === "ios" || os === "web") return os;
  return "web";
}

function browserUserAgent(): string {
  if (typeof navigator === "undefined") return "";
  return typeof navigator.userAgent === "string" ? navigator.userAgent : "";
}

/** Browser name + major version only — enough to reproduce, no fingerprinting. */
function describeBrowser(userAgent: string): string | undefined {
  const rules: [RegExp, string][] = [
    [/Edg\/(\d+)/, "Edge"],
    [/OPR\/(\d+)/, "Opera"],
    [/SamsungBrowser\/(\d+)/, "Samsung Internet"],
    [/Firefox\/(\d+)/, "Firefox"],
    [/Chrome\/(\d+)/, "Chrome"],
    [/Version\/(\d+)[\d.]*\s+(?:Mobile\/\S+\s+)?Safari/, "Safari"],
  ];
  for (const [pattern, name] of rules) {
    const match = pattern.exec(userAgent);
    if (match) return `${name} ${match[1]}`;
  }
  return undefined;
}

/**
 * The OS *behind* a browser matters: "Web on Android 14" and "Android app" are
 * different bugs with the same user, which is exactly the confusion this whole
 * module exists to remove.
 */
function describeWebOs(userAgent: string): string | undefined {
  const android = /Android\s+([\d.]+)/.exec(userAgent);
  if (android) return `Android ${android[1]}`;
  if (/iPhone|iPad|iPod/.test(userAgent)) {
    const ios = /OS\s+(\d+[_\d]*)\s+like\s+Mac/.exec(userAgent);
    return ios ? `iOS ${ios[1].replace(/_/g, ".")}` : "iOS";
  }
  if (/Windows NT 10/.test(userAgent)) return "Windows";
  if (/Mac OS X/.test(userAgent)) return "macOS";
  if (/CrOS/.test(userAgent)) return "ChromeOS";
  if (/Linux/.test(userAgent)) return "Linux";
  return undefined;
}

function buildSnapshot(): SurfaceSnapshot {
  const surface = currentSurface();
  const appVersion = asText(config.version);

  if (surface === "web") {
    const userAgent = browserUserAgent();
    const host =
      typeof window !== "undefined" && window.location ? asText(window.location.host) : undefined;
    return {
      surface,
      appVersion,
      osVersion: describeWebOs(userAgent),
      device: describeBrowser(userAgent),
      origin: host,
    };
  }

  const constants = nativeConstants();
  if (surface === "android") {
    return {
      surface,
      appVersion,
      build: asText(config.android?.versionCode),
      osVersion: `Android ${asText(constants.Release) ?? asText(Platform.Version) ?? "?"}`,
      device: asText(constants.Model) ?? asText(constants.Brand),
    };
  }

  return {
    surface,
    appVersion,
    osVersion: `iOS ${asText(Platform.Version) ?? "?"}`,
    device: asText(constants.systemName),
  };
}

let cached: SurfaceSnapshot | null = null;

/** Memoized: none of these values change while the app is running. */
export function getSurfaceSnapshot(): SurfaceSnapshot {
  if (!cached) {
    try {
      cached = buildSnapshot();
    } catch {
      cached = { surface: currentSurface() };
    }
  }
  return cached;
}

/** Encoded form, reused for both the request header and multipart form fields. */
export function getEncodedSurface(): string {
  try {
    return encodeSurfaceHeader(getSurfaceSnapshot());
  } catch {
    return currentSurface();
  }
}

/**
 * Sent on every authenticated request (see `lib/query-client.ts`). That is what
 * lets the server learn that an account uses Android *and* Web instead of
 * guessing from whichever surface happened to file a report.
 */
export function getSurfaceHeaders(): Record<string, string> {
  try {
    return { [CLIENT_SURFACE_HEADER]: getEncodedSurface() };
  } catch {
    return {};
  }
}
