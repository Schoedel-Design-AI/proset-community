import { NativeModules, Platform } from "react-native";

interface WhisperNative {
  loadModel(modelPath: string): Promise<boolean>;
  transcribe(wavPath: string, maxDurationSec: number): Promise<string>;
  cancel(): Promise<boolean>;
  unload(): Promise<boolean>;
  /** True only when libwhisper-jni.so actually loaded (arm64-v8a only). */
  isAvailable(): Promise<boolean>;
  /** Decode any supported audio file to 16 kHz mono PCM WAV; resolves with sample count. */
  decodeToWav(inputPath: string, outputPath: string): Promise<number>;
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

let runtimeAvailable: boolean | null = null;

/**
 * Whether on-device transcription can ACTUALLY run here. The JS module exists on
 * every Android build, but libwhisper-jni.so only ships for arm64-v8a, so the
 * native side is asked once and the answer cached. Use this — not
 * isWhisperAvailable() — before offering the low-quality fallback to a user.
 */
export async function isOnDeviceTranscriptionAvailable(): Promise<boolean> {
  if (runtimeAvailable !== null) return runtimeAvailable;
  if (!NativeWhisper) {
    runtimeAvailable = false;
    return false;
  }
  try {
    runtimeAvailable = await NativeWhisper.isAvailable();
  } catch {
    runtimeAvailable = false;
  }
  return runtimeAvailable;
}

/**
 * Decode a recording (m4a/AAC) into the 16 kHz mono PCM WAV that whisper.cpp
 * requires. Returns the WAV path, or null when decoding is unsupported/failed.
 */
export async function prepareWavForTranscription(
  inputPath: string
): Promise<string | null> {
  if (!NativeWhisper) return null;
  const { Dirs } = require("react-native-file-access");
  const outPath = `${Dirs.CacheDir}/whisper-${Date.now()}.wav`;
  try {
    const samples = await NativeWhisper.decodeToWav(inputPath, outPath);
    if (!samples || samples <= 0) return null;
    return outPath;
  } catch (e) {
    console.error("[Whisper] Audio decode for on-device transcription failed:", e);
    return null;
  }
}

/** Delete a temporary WAV produced by prepareWavForTranscription. */
export async function discardWav(wavPath: string): Promise<void> {
  try {
    const { FileSystem } = require("react-native-file-access");
    await FileSystem.unlink(wavPath);
  } catch {
    // a leftover cache file is harmless; CacheDir is evictable
  }
}

export type OnDeviceTranscriptionProgress =
  | { phase: "checking" }
  | { phase: "downloading-model"; bytesWritten: number; contentLength: number }
  | { phase: "loading-model" }
  | { phase: "decoding" }
  | { phase: "transcribing" };

/**
 * Full on-device path: capability check -> model (downloading the ~75 MB tiny
 * model on first use) -> decode to WAV -> transcribe -> cleanup.
 *
 * Returns "" when on-device transcription is unavailable or produced nothing;
 * callers must treat an empty result as failure and keep the cloud error state.
 */
export async function transcribeOnDevice(
  inputPath: string,
  onProgress?: (progress: OnDeviceTranscriptionProgress) => void
): Promise<string> {
  onProgress?.({ phase: "checking" });
  if (!(await isOnDeviceTranscriptionAvailable())) return "";

  const modelReady = await ensureModelLoaded((p) =>
    onProgress?.({
      phase: "downloading-model",
      bytesWritten: p.bytesWritten,
      contentLength: p.contentLength,
    })
  );
  if (!modelReady) return "";
  onProgress?.({ phase: "loading-model" });

  onProgress?.({ phase: "decoding" });
  const wavPath = await prepareWavForTranscription(inputPath);
  if (!wavPath) return "";

  try {
    onProgress?.({ phase: "transcribing" });
    return await transcribeLocally(wavPath, 0);
  } finally {
    await discardWav(wavPath);
  }
}
