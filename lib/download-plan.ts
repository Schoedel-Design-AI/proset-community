/**
 * Pure download-planning helpers — no React Native imports, so this module is
 * unit-testable under `tsx --test`.
 *
 * Background (ticket #327 / issue #190): "download" on native used to mean
 * "write into app-private storage, then open a share sheet". Files written to
 * the app sandbox are invisible to the user, and the share sheet is not a
 * download, so a tapped download icon could complete with nothing to show for
 * it. Delivery is now decided explicitly per platform.
 */

/** Platforms that can receive a download. */
export type DownloadPlatform = "web" | "android" | "ios";

/**
 * Where a saved file actually lands:
 * - `browser`   — the browser's download manager (web).
 * - `downloads` — the shared Downloads collection (Android MediaStore).
 * - `picker`    — a destination the user chose in system UI (SAF / Files).
 * - `share`     — handed to the OS share sheet, because the user asked to share.
 */
export type DownloadDelivery = "browser" | "downloads" | "picker" | "share";

/** What the user asked for. Delivery is derived from this plus the platform. */
export type DownloadIntent = "auto" | "downloads" | "choose-location" | "share";

/** Delivery plus the outcomes that are not a delivery at all. */
export type DownloadOutcome = DownloadDelivery | "cancelled";

/** Recovery actions offered when a save fails — never taken automatically. */
export type DownloadFailureAction = "choose-location" | "share";


/** Characters that are unsafe in a file name across web, Android and iOS. */
const UNSAFE_FILE_CHARS = /[^a-zA-Z0-9._-]+/g;

/** Longest base name (extension excluded) we will write. */
export const MAX_DOWNLOAD_BASE_LENGTH = 80;

/**
 * Normalizes an arbitrary label into a safe file name and guarantees `ext`.
 *
 * Accepts names that already carry the extension (`"deck.pptx"` + `"pptx"`)
 * without doubling it.
 */
export function sanitizeDownloadName(
  rawName: string,
  ext?: string,
  fallback = "proset-export",
): string {
  const desiredExt = (ext ?? "").replace(/^\./, "").toLowerCase();
  let base = (rawName ?? "").trim();

  if (desiredExt && base.toLowerCase().endsWith(`.${desiredExt}`)) {
    base = base.slice(0, -(desiredExt.length + 1));
  }

  base = base
    .replace(UNSAFE_FILE_CHARS, "_")
    .replace(/_{2,}/g, "_")
    .replace(/^[._-]+/, "")
    .replace(/[._-]+$/, "");

  if (base.length > MAX_DOWNLOAD_BASE_LENGTH) {
    base = base.slice(0, MAX_DOWNLOAD_BASE_LENGTH).replace(/[._-]+$/, "");
  }

  if (!base) base = fallback;

  return desiredExt ? `${base}.${desiredExt}` : base;
}

/**
 * Delivery for a "save/download" action.
 *
 * Android gets the shared Downloads collection (MediaStore) so the file is
 * findable in Files → Downloads. iOS has no user-browsable Downloads folder;
 * its document export sheet ("Save file…") is the platform-correct destination.
 */
export function planDownloadDelivery(platform: DownloadPlatform): DownloadDelivery {
  if (platform === "web") return "browser";
  if (platform === "android") return "downloads";
  return "picker";
}

/**
 * Delivery for an explicit user intent.
 *
 * The web branch ignores intent because the browser owns the destination; on
 * mobile every intent maps to exactly one visible outcome, so a tap can never
 * end somewhere the user did not ask for (issue #201).
 */
export function planDelivery(
  intent: DownloadIntent,
  platform: DownloadPlatform,
): DownloadDelivery {
  if (platform === "web") return "browser";
  if (intent === "share") return "share";
  if (intent === "choose-location") return "picker";
  if (intent === "downloads") return platform === "android" ? "downloads" : "picker";
  return planDownloadDelivery(platform);
}

/**
 * Whether the app should show its own "saved" confirmation.
 *
 * A share sheet is its own visible outcome (and may be cancelled), so we do not
 * claim success for it. A silent write to Downloads or a picker save must be
 * confirmed.
 */
export function shouldConfirmDownload(delivery: DownloadOutcome): boolean {
  return delivery === "browser" || delivery === "downloads" || delivery === "picker";
}

/**
 * i18n key describing a real outcome. `null` means "say nothing": the share
 * sheet speaks for itself and a cancelled picker is a neutral outcome, not an
 * error and not a success.
 */
export function downloadOutcomeMessageKey(outcome: DownloadOutcome): string | null {
  if (outcome === "downloads" || outcome === "browser") return "detail.fileSaved";
  if (outcome === "picker") return "detail.fileSavedGeneric";
  return null;
}

/**
 * Recovery actions to offer after a failed save. The user picks one — the app
 * never silently redirects a download into a share sheet, which is what made
 * the original failure unreadable.
 */
export function downloadFailureActions(
  platform: DownloadPlatform,
  attempted: DownloadDelivery,
): DownloadFailureAction[] {
  if (platform === "web") return [];
  const actions: DownloadFailureAction[] = [];
  if (attempted !== "picker") actions.push("choose-location");
  if (attempted !== "share") actions.push("share");
  return actions;
}

/** Maps a recovery action back to the intent that performs it. */
export function intentForFailureAction(action: DownloadFailureAction): DownloadIntent {
  return action === "choose-location" ? "choose-location" : "share";
}


/**
 * True when `fileUri` sits under `cacheDirectory`.
 *
 * react-native-share resolves `file://` paths through its own FileProvider,
 * whose roots are the app cache dir and public `Download/` only. Sharing from
 * the app documents dir throws inside the library and yields a null URI, which
 * is why the previous implementation failed with no user-visible sign.
 */
export function isShareableFileUri(fileUri: string, cacheDirectory: string): boolean {
  if (!fileUri || !cacheDirectory) return false;
  const normalize = (value: string) => value.replace(/^file:\/\//, "");
  return normalize(fileUri).startsWith(normalize(cacheDirectory));
}

/** Strips a `file://` scheme for native modules that expect bare paths. */
export function toNativePath(fileUri: string): string {
  return (fileUri ?? "").replace(/^file:\/\//, "");
}

/** True when a URI points at a file already on the device. */
export function isLocalFileUri(uri: string): boolean {
  if (!uri) return false;
  return uri.startsWith("file://") || uri.startsWith("/");
}
