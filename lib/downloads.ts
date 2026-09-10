/**
 * Unified "save this file to the user's device" path for every platform.
 *
 * Ticket #327 / issues #190, #201. Two generations of defect are fixed here:
 *
 *   1. Downloads were written into app-private storage and then handed to
 *      react-native-share, whose FileProvider cannot expose that directory —
 *      the error was swallowed, so a tapped download did nothing at all.
 *   2. The first fix still let a failed Downloads write slide into a share
 *      sheet, so the outcome of a tap was unpredictable and unreadable.
 *
 * Now every save has one visible destination derived from explicit user intent,
 * and a failure is reported to the caller with the recovery actions the user can
 * choose from — never taken silently:
 *
 * - web:              blob + anchor → browser download manager
 * - Android `auto`:   MediaStore Downloads (visible in Files → Downloads)
 * - iOS `auto`:       document export sheet ("Save file…")
 * - `choose-location`: native Save As picker (SAF / Files)
 * - `share`:          the platform share sheet, only when the user asked
 */
import { Platform } from "react-native";
import * as FileSystem from "./file-system";
import * as Sharing from "./sharing";
import { saveDocumentToLocation } from "./document-save";
import {
  downloadFailureActions,
  isLocalFileUri,
  planDelivery,
  sanitizeDownloadName,
  shouldConfirmDownload,
  type DownloadDelivery,
  type DownloadFailureAction,
  type DownloadIntent,
  type DownloadOutcome,
  type DownloadPlatform,
} from "./download-plan";

export type {
  DownloadDelivery,
  DownloadFailureAction,
  DownloadIntent,
  DownloadOutcome,
} from "./download-plan";
export { downloadOutcomeMessageKey, intentForFailureAction, sanitizeDownloadName } from "./download-plan";

export type SaveToDeviceInput = {
  /** Desired file name, extension included (sanitized before writing). */
  fileName: string;
  mimeType: string;
  /** UTF-8 payload. */
  text?: string;
  /** Base64 payload for binary formats (pdf, docx, xlsx, pptx). */
  base64?: string;
  /** Web-only: an already-built blob (e.g. a server response). */
  blob?: Blob;
  /** Native-only: a file already on the device. */
  fileUri?: string;
  /** Native-only: stream this URL to disk instead of buffering it in JS. */
  remoteUrl?: string;
  /** Headers for `remoteUrl` (auth). */
  headers?: Record<string, string>;
  /** Title for the share sheet. */
  dialogTitle?: string;
  /** What the user asked for. Defaults to the platform's normal save. */
  intent?: DownloadIntent;
};

export type SaveToDeviceResult = {
  /** What actually happened, including `cancelled`. */
  delivery: DownloadOutcome;
  fileName: string;
  /** True when the caller should show its own "saved" confirmation. */
  confirmed: boolean;
};

/**
 * A save that did not happen. Carries the recovery actions the UI should offer,
 * so the user chooses the next step instead of the app guessing.
 */
export class DownloadFailedError extends Error {
  readonly attempted: DownloadDelivery;
  readonly actions: DownloadFailureAction[];
  readonly cause?: unknown;

  constructor(attempted: DownloadDelivery, actions: DownloadFailureAction[], cause?: unknown) {
    super(`Download failed (${attempted})`);
    this.name = "DownloadFailedError";
    this.attempted = attempted;
    this.actions = actions;
    this.cause = cause;
  }
}

/** Web: hand a blob to the browser's download manager. */
export function triggerWebDownload(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 200);
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

/** Converts an arbitrary binary response into base64 for the native writer. */
export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const CHUNK = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(
      null,
      Array.from(bytes.subarray(i, i + CHUNK)) as unknown as number[],
    );
  }
  return btoa(binary);
}

function currentPlatform(): DownloadPlatform {
  if (Platform.OS === "web") return "web";
  return Platform.OS === "android" ? "android" : "ios";
}

/**
 * Saves a file where the user can find it.
 *
 * Resolves with the real outcome (including `cancelled`). Rejects with
 * `DownloadFailedError` when the save failed, so the caller can show the
 * failure plus the recovery actions.
 */
export async function saveToDevice(input: SaveToDeviceInput): Promise<SaveToDeviceResult> {
  const fileName = sanitizeDownloadName(input.fileName);
  const platform = currentPlatform();
  const intent: DownloadIntent = input.intent ?? "auto";
  const delivery = planDelivery(intent, platform);

  if (platform === "web") {
    let blob = input.blob;
    if (!blob) {
      if (typeof input.text === "string") {
        blob = new Blob([input.text], { type: input.mimeType });
      } else if (input.base64) {
        blob = new Blob([base64ToArrayBuffer(input.base64)], { type: input.mimeType });
      }
    }
    if (!blob) throw new Error("saveToDevice: no payload to save");
    triggerWebDownload(blob, fileName);
    return { delivery: "browser", fileName, confirmed: true };
  }

  // Native: stage the bytes inside the cache dir. It is the only local root
  // react-native-share's FileProvider can expose, and a temp copy keeps the
  // picker from handing the app's own private file to another process.
  let sourceUri: string;
  let isTemporary = false;

  if (input.fileUri && isLocalFileUri(input.fileUri)) {
    sourceUri = input.fileUri;
  } else {
    sourceUri = `${FileSystem.cacheDirectory}${fileName}`;
    isTemporary = true;
    if (input.remoteUrl) {
      await FileSystem.fetchToFileAsync(input.remoteUrl, sourceUri, input.headers ?? {});
    } else if (input.base64) {
      await FileSystem.writeAsStringAsync(sourceUri, input.base64, {
        encoding: FileSystem.EncodingType.Base64,
      });
    } else if (typeof input.text === "string") {
      await FileSystem.writeAsStringAsync(sourceUri, input.text, {
        encoding: FileSystem.EncodingType.UTF8,
      });
    } else {
      throw new Error("saveToDevice: no payload to save");
    }
  }

  try {
    if (delivery === "downloads") {
      try {
        await FileSystem.copyToDownloadsAsync(sourceUri, fileName);
      } catch (err) {
        // MediaStore refused (provider policy, quota, storage state). Report it
        // with the recovery actions instead of quietly opening something else.
        throw new DownloadFailedError("downloads", downloadFailureActions(platform, "downloads"), err);
      }
      return { delivery: "downloads", fileName, confirmed: shouldConfirmDownload("downloads") };
    }

    if (delivery === "picker") {
      let picked;
      try {
        picked = await saveDocumentToLocation({ fileUri: sourceUri, fileName, mimeType: input.mimeType });
      } catch (err) {
        throw new DownloadFailedError("picker", downloadFailureActions(platform, "picker"), err);
      }
      if (picked.status === "cancelled") {
        return { delivery: "cancelled", fileName, confirmed: false };
      }
      return { delivery: "picker", fileName: picked.fileName, confirmed: shouldConfirmDownload("picker") };
    }

    try {
      await Sharing.shareAsync(sourceUri, {
        mimeType: input.mimeType,
        dialogTitle: input.dialogTitle,
      });
    } catch (err) {
      throw new DownloadFailedError("share", downloadFailureActions(platform, "share"), err);
    }
    return { delivery: "share", fileName, confirmed: shouldConfirmDownload("share") };
  } finally {
    if (isTemporary) {
      await FileSystem.deleteAsync(sourceUri);
    }
  }
}
