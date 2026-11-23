import { hasTranscriptionContent } from "@/lib/recording-api";
import { NativeModules, Platform } from "react-native";

/**
 * On-device transcription facade — Parakeet engine (Replaces the whisper.cpp
 * engine behind the SAME contract lib/whisper.ts held):
 *
 *   - transcribeOnDevice(inputPath, onProgress) resolves the transcript text;
 *     "" (or whitespace/punctuation-only) means failure — callers keep the
 *     cloud error state rather than presenting an empty transcript as success.
 *   - Progress phases are the same vocabulary the recording detail UI renders:
 *     checking → downloading-model → loading-model → decoding → transcribing.
 *   - Model downloads ONCE to DocumentDir (not the evictable CacheDir: at 615 MB
 *     an OS cache eviction would silently re-download mid-flow).
 *
 * Engine: MediaPipe Audio Transcriber, NVIDIA Parakeet TDT 0.6B v3 `.litertlm`
 * (INT8, ~615 MB, 25 European languages, CC-BY-4.0 — attribution lives in the
 * app's open-source notices).
 */

interface ParakeetNative {
  isAvailable(): Promise<boolean>;
  /** Transcribe any recording (native side decodes to 16 kHz mono PCM); resolves "" or whitespace-only on failure. */
  transcribe(inputPath: string, modelPath: string): Promise<string>;
  /** Abort an in-flight run between windows; the pending transcribe() resolves "". */
  cancel(): Promise<boolean>;
  close(): Promise<boolean>;
}

interface DownloadProgress {
  bytesWritten: number;
  contentLength: number;
}

const NativeParakeet: ParakeetNative | undefined =
  Platform.OS === "android"
    ? (NativeModules as { Parakeet?: ParakeetNative }).Parakeet
    : undefined;

// NVIDIA Parakeet TDT 0.6B v3, INT8 stateful (~615 MB), published by
// litert-community under CC-BY-4.0.
const MODEL_URL =
  "https://huggingface.co/litert-community/parakeet-tdt-0.6b-v3/resolve/main/parakeet_tdt_0.6b_v3_5s_i8_stateful.litertlm";

/**
 * Kill switch. Flip to false and ship to disable the Parakeet engine with no
 * other code change — transcribeOnDevice then returns "" and the caller keeps
 * the cloud error state exactly as designed. This is the rollback lever if the
 * rollout surprises (e.g. device-class OOM) before a whisper revert is needed.
 */
const ENGINE_ENABLED = true;

/** Post-download size floor: the INT8 artifact is ~615 MB; anything under this is truncated. */
const MIN_MODEL_BYTES = 600_000_000;

export function getModelPath(): string {
  const { Dirs } = require("react-native-file-access");
  // DocumentDir, NOT CacheDir: the OS evicts cache under storage pressure, which
  // at 75 MB (whisper) was tolerable but at 615 MB would mean the user silently
  // re-download the model mid-flow. CacheDir stays reserved for temp WAVs.
  return `${Dirs.DocumentDir}/parakeet-tdt-0.6b-v3-i8.litertlm`;
}

export async function isModelDownloaded(): Promise<boolean> {
  try {
    const { FileSystem } = require("react-native-file-access");
    return await FileSystem.exists(getModelPath());
  } catch {
    return false;
  }
}

export async function downloadModel(
  onProgress?: (progress: DownloadProgress) => void
): Promise<boolean> {
  const { FileSystem } = require("react-native-file-access");
  const destPath = getModelPath();

  try {
    const download = FileSystem.fetchManaged(
      MODEL_URL,
      { path: destPath },
      (bytesWritten: number, contentLength: number) => {
        onProgress?.({ bytesWritten, contentLength });
      },
    );
    const result = await download.result;
    // A truncated 615 MB file that survives isModelDownloaded() FOREVER would fail
    // silently on every transcribe() afterwards. Validate the artifact before
    // trusting it. The 600 MB floor is ~97% of the true size; delete mismatches.
    if (result.ok) {
      try {
        const stat = await FileSystem.stat(destPath);
        if (!stat?.size || stat.size < MIN_MODEL_BYTES) {
          console.error("[Parakeet] Model download incomplete:", stat?.size);
          try {
            await FileSystem.unlink(destPath);
          } catch {}
          return false;
        }
      } catch (e) {
        console.error("[Parakeet] Model size validation failed:", e);
      }
    }
    return result.ok;
  } catch (e) {
    console.error("[Parakeet] Model download failed:", e);
    return false;
  }
}

export async function isOnDeviceTranscriptionAvailable(): Promise<boolean> {
  if (NativeParakeet === undefined) return false;
  try {
    return await NativeParakeet.isAvailable();
  } catch {
    return false;
  }
}

/** Abort an in-flight transcription between windows; caller keeps cloud error state. */
export async function cancelTranscription(): Promise<void> {
  if (!NativeParakeet) return;
  try {
    await NativeParakeet.cancel();
  } catch {
    // ignore — a missing cancel surface degrades to an uncancellable run
  }
}

/**
 * Pre-provision the engine so the fallback is download-free at the failure
 * moment. Idempotent: calling it on a prepared install reports ready and
 * downloads nothing. The Settings row (app/settings/preferences.tsx) is the
 * only intended caller.
 */
export async function prepareOnDeviceTranscription(
  onProgress?: (percent: number | null) => void
): Promise<"ready" | "unavailable" | "failed"> {
  if (!ENGINE_ENABLED) return "unavailable";
  if (!(await isOnDeviceTranscriptionAvailable())) return "unavailable";
  if (await isModelDownloaded()) {
    onProgress?.(null);
    return "ready";
  }
  const ok = await downloadModel(({ bytesWritten, contentLength }) => {
    onProgress?.(contentLength > 0 ? Math.round((bytesWritten / contentLength) * 100) : null);
  });
  return ok && (await isModelDownloaded()) ? "ready" : "failed";
}

export type OnDeviceTranscriptionProgress =
  | { phase: "checking" }
  | { phase: "downloading-model"; bytesWritten: number; contentLength: number }
  | { phase: "loading-model" }
  | { phase: "decoding" }
  | { phase: "transcribing" };

export async function transcribeOnDevice(
  inputPath: string,
  onProgress?: (progress: OnDeviceTranscriptionProgress) => void
): Promise<string> {
  onProgress?.({ phase: "checking" });
  if (!ENGINE_ENABLED) return "";
  if (!(await isOnDeviceTranscriptionAvailable())) return "";

  const downloaded = await isModelDownloaded();
  if (!downloaded) {
    onProgress?.({ phase: "downloading-model", bytesWritten: 0, contentLength: 0 });
    const ok = await downloadModel((p) =>
      onProgress?.({
        phase: "downloading-model",
        bytesWritten: p.bytesWritten,
        contentLength: p.contentLength,
      })
    );
    if (!ok) return "";
  }
  onProgress?.({ phase: "loading-model" });

  onProgress?.({ phase: "decoding" });
  try {
    // All decoding happens inside ParakeetModule (it instantiates AudioToWavDecoder
    // itself). The facade hands over the raw recording path — no cross-module call
    // into NativeModules.Whisper, so deleting the whisper engine later stays safe.
    onProgress?.({ phase: "transcribing" });
    const text = await NativeParakeet!.transcribe(inputPath, getModelPath());
    // Empty and punctuation-only results are failure, reusing the pipeline's own
    // garbage-transcript guard — never present an empty transcript as success.
    if (!hasTranscriptionContent({ text })) return "";
    return text.trim();
  } catch (e) {
    console.error("[Parakeet] Transcription failed:", e);
    return "";
  }
}
