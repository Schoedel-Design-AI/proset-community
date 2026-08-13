import { NativeModules, Platform } from "react-native";

interface WhisperNative {
  loadModel(modelPath: string): Promise<boolean>;
  transcribe(wavPath: string, maxDurationSec: number): Promise<string>;
  cancel(): Promise<boolean>;
  unload(): Promise<boolean>;
}

interface DownloadProgress {
  bytesWritten: number;
  contentLength: number;
}

const NativeWhisper: WhisperNative | undefined =
  Platform.OS === "android"
    ? (NativeModules as { Whisper?: WhisperNative }).Whisper
    : undefined;

let modelLoaded = false;

const MODEL_URL =
  "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin";

/**
 * Get the path where the model should be stored.
 */
export function getModelPath(): string {
  const { Dirs } = require("react-native-file-access");
  return `${Dirs.CacheDir}/whisper-tiny.bin`;
}

/**
 * Check if the model file exists locally.
 */
export async function isModelDownloaded(): Promise<boolean> {
  try {
    const { FileSystem } = require("react-native-file-access");
    return await FileSystem.exists(getModelPath());
  } catch {
    return false;
  }
}

/**
 * Download the Whisper Tiny GGUF model (~75 MB) with progress callback.
 * Returns true if download completed successfully.
 */
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

    return result.ok;
  } catch (e) {
    console.error("[Whisper] Model download failed:", e);
    try { await FileSystem.unlink(destPath); } catch {}
    return false;
  }
}

/**
 * Download the model (if needed) and load it. Call once on app init.
 * onProgress receives download progress for the initial download.
 */
export async function ensureModelLoaded(
  onProgress?: (progress: DownloadProgress) => void
): Promise<boolean> {
  if (modelLoaded) return true;
  if (!NativeWhisper) return false;

  const downloaded = await isModelDownloaded();
  if (!downloaded) {
    const ok = await downloadModel(onProgress);
    if (!ok) return false;
  }

  return loadWhisperModel(getModelPath());
}

/**
 * Load the Whisper Tiny GGUF model. Call once on app startup or first use.
 * Model path should point to a .bin GGUF file in app storage.
 */
export async function loadWhisperModel(modelPath: string): Promise<boolean> {
  if (!NativeWhisper) return false;
  if (modelLoaded) return true;
  try {
    modelLoaded = await NativeWhisper.loadModel(modelPath);
    return modelLoaded;
  } catch (e) {
    console.error("[Whisper] Failed to load model:", e);
    return false;
  }
}

/**
 * Transcribe a WAV file (16kHz mono PCM). For preview, pass maxDurationSec=30
 * to only transcribe the first 30 seconds. Returns text or empty string.
 */
export async function transcribeLocally(
  wavPath: string,
  maxDurationSec: number = 0 // 0 = full file
): Promise<string> {
  if (!NativeWhisper || !modelLoaded) return "";
  try {
    return await NativeWhisper.transcribe(wavPath, maxDurationSec);
  } catch (e) {
    console.error("[Whisper] Transcription failed:", e);
    return "";
  }
}

/**
 * Cancel a running transcription.
 */
export async function cancelTranscription(): Promise<void> {
  if (!NativeWhisper) return;
  try {
    await NativeWhisper.cancel();
  } catch (e) {
    // ignore
  }
}

/**
 * Unload the model to free memory.
 */
export async function unloadWhisperModel(): Promise<void> {
  if (!NativeWhisper) return;
  try {
    await NativeWhisper.unload();
    modelLoaded = false;
  } catch (e) {
    // ignore
  }
}

/**
 * Check if on-device whisper is available on this platform.
 */
export function isWhisperAvailable(): boolean {
  return NativeWhisper !== undefined;
}
