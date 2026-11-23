import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

/**
 * Contract for the Parakeet on-device transcription engine (MediaPipe Audio
 * Transcriber, NVIDIA Parakeet TDT 0.6B v3), which replaces the whisper.cpp
 * ggml-tiny device fallback.
 *
 * These assertions read the source on purpose: the behaviours that make the
 * flow work are the affordances present (and absent) in these files.
 *
 * Contract pillars (plan: .hermes/plans/2026-11-17_134556-parakeet-ondevice-transcription.md):
 *   1. JS facade lib/parakeet.ts mirrors the lib/whisper.ts contract
 *      (empty result = failure, punctuated-only = failure, progress phases).
 *   2. Kill switch: ENGINE_ENABLED gates the whole engine.
 *   3. Model integrity: a truncated ~615 MB download can never be accepted.
 *   4. Native side decodes + feeds bounded windows and is safely cancellable.
 *   5. The caller swaps to @/lib/parakeet; billing/status writing is untouched
 *      (billing endpoint files are not modified by the swap).
 *   6. Cancel affordance in the fallback UI while download/transcribe runs.
 *   7. The engine is pre-provisionable from Settings so the fallback is
 *      download-free at the failure moment, with a ready-variant offer copy.
 *   8. Bilingual strings exist for every new user-facing key.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => readFile(path.join(repoRoot, relative), "utf8");

test("lib/parakeet.ts keeps the on-device facade contract", async () => {
  const source = await read("lib/parakeet.ts");

  // Public surface the caller relies on (mirrors lib/whisper.ts).
  for (const symbol of [
    "export async function transcribeOnDevice",
    "export async function isOnDeviceTranscriptionAvailable",
    "export async function cancelTranscription",
    "export async function prepareOnDeviceTranscription",
    "export async function isModelDownloaded",
  ]) {
    assert.ok(source.includes(symbol), `facade must export: ${symbol}`);
  }

  // Model: NVIDIA Parakeet TDT 0.6B v3 (LiteRT-LM, litert-community, CC-BY-4.0).
  assert.match(
    source,
    /litert-community\/parakeet-tdt-0\.6b-v3\/resolve\/main\/parakeet_tdt_0\.6b_v3/,
    "MODEL_URL must point at the litert-community Parakeet artifact",
  );

  // Kill switch gates the engine.
  assert.match(
    source,
    /const ENGINE_ENABLED = (true|false);?\s*\n[\s\S]*?if \(!ENGINE_ENABLED\) return "";/,
    "ENGINE_ENABLED kill switch must gate transcribeOnDevice",
  );

  // Truncated-download guard: a 615 MB artifact smaller than the floor is deleted.
  assert.match(
    source,
    /600_000_000/,
    "downloadModel must validate the model against a 600 MB size floor",
  );
  assert.match(
    source,
    /FileSystem\.unlink\(destPath\)/,
    "an incomplete model must be deleted, not kept for isModelDownloaded()",
  );

  // Storage location: DocumentDir, not the evictable CacheDir.
  assert.match(
    source,
    /Dirs\.DocumentDir\}?\/parakeet-tdt-0\.6b-v3-i8\.litertlm/,
    "the 615 MB model must live in DocumentDir, not the evictable CacheDir",
  );

  // No cross-module decode: the facade must not call the Whisper native module.
  assert.doesNotMatch(
    source,
    /decodeToWav|NativeModules as \{ Whisper/,
    "lib/parakeet.ts must not reach into the Whisper native module",
  );

  // Empty/punctuated results are failures, reusing the pipeline's own guard (DRY).
  assert.match(
    source,
    /@\/lib\/recording-api/,
    "the facade must reuse hasTranscriptionContent from lib/recording-api.ts",
  );
  assert.match(
    source,
    /!hasTranscriptionContent\(\{ text \}\)\s*\)\s*return "";?/,
    "empty or punctuation-only native results must resolve as failure (empty string)",
  );

  // Progress phases are the same vocabulary the detail UI already renders.
  for (const phase of ["checking", "downloading-model", "loading-model", "decoding", "transcribing"]) {
    assert.ok(source.includes(phase), `facade must report phase ${phase}`);
  }

  // Pre-provisioning is idempotent and gates on the same availability check.
  assert.match(
    source,
    /isModelDownloaded\(\)\)\s*{[\s\S]*?return "ready";/,
    "prepareOnDeviceTranscription must short-circuit to ready when the model exists",
  );
});

test("the Parakeet native module decodes itself, feeds bounded windows, and is cancellable", async () => {
  const source = await read("android/app/src/main/java/ms/aifor/app/parakeet/ParakeetModule.kt");

  assert.match(source, /override fun getName\(\)\s*=\s*"Parakeet"/, "RN module name must be Parakeet");

  // No cross-module decode into the Whisper JNI module; AudioToWavDecoder is instantiated here.
  assert.match(
    source,
    /AudioToWavDecoder/,
    "ParakeetModule must reuse AudioToWavDecoder.kt for decoding",
  );
  assert.doesNotMatch(
    source,
    /import\s+ms\.aifor\.app\.whisper/,
    "ParakeetModule must not import the Whisper JNI module classes",
  );

  // Bounded windows: never materialize a whole-recording float[] (~160 MB churn at 20 min).
  assert.match(
    source,
    /CHUNK_SAMPLES\s*=\s*16000\s*\*\s*\d+/,
    "transcription must feed bounded sample windows",
  );
  assert.match(
    source,
    /RandomAccessFile\(/,
    "WAV reading must stream windows from the file, not buffer the whole artifact",
  );

  // Cancellation is honored between windows.
  assert.match(source, /@Volatile[\s\S]*?cancelled/, "a @Volatile cancel flag must exist");
  assert.match(
    source,
    /if \(cancelled\)/,
    "the transcription loop must check the cancel flag",
  );
  assert.match(source, /fun cancel\(promise: Promise\)/, "JS-reachable cancel() must exist");

  // API surface verified against tasks-audio 1.2.3 (Task 2 audit, 2026-11-17).
  assert.match(source, /createFromOptions\(/, "must build the transcriber from options");
  assert.match(
    source,
    /setCacheDir\(/,
    "compiled-model caching must be enabled for faster subsequent startups",
  );
  assert.match(
    source,
    /finishStream\(\)/,
    "the stateful stream must be finalized so the tail of the recording is transcribed",
  );

  // Failure contract: ordinary failures resolve "" (never throw to JS).
  assert.match(
    source,
    /promise\.resolve\(""\)/,
    "native failures must resolve an empty string, mirroring the whisper contract",
  );
});

test("the module is registered with zero whisper-engine changes", async () => {
  const gradle = await read("android/app/build.gradle");
  assert.match(
    gradle,
    /com\.google\.mediapipe:tasks-audio:1\.2\.3/,
    "the pinned artifact version audited in Task 2",
  );

  const app = await read("android/app/src/main/java/ms/aifor/app/MainApplication.kt");
  assert.match(app, /ParakeetPackage\(\)/, "ParakeetPackage must be registered");
  assert.match(app, /import ms\.aifor\.app\.parakeet\.ParakeetPackage/);
});

test("the caller swaps engines and gains a cancel affordance", async () => {
  const source = await read("app/recording/[id].tsx");

  assert.match(
    source,
    /from "@\/lib\/parakeet"/,
    "the on-device facade import must come from lib/parakeet",
  );
  assert.match(
    source,
    /import \{ transcribeOnDevice, isOnDeviceTranscriptionAvailable, cancelTranscription, isModelDownloaded \} from "@\/lib\/parakeet";/,
    "the facade import must carry the cancel + prepared-check symbols",
  );
  assert.match(
    source,
    /testID="on-device-transcribe-cancel"/,
    "a cancel affordance must exist while download/transcribe runs",
  );

  // Ready-variant offer copy: when prepared, the offer must not advertise a download.
  assert.match(
    source,
    /devicePrepared \? "detail\.localFallbackDescReady" : "detail\.localFallbackDesc"/,
    "the fallback offer must switch copy based on the prepared state",
  );
});

test("pre-provisioning exists in Settings, Android only", async () => {
  const source = await read("app/settings/preferences.tsx");

  assert.match(
    source,
    /prepareOnDeviceTranscription/,
    "preferences.tsx must call the preparation API",
  );
  assert.match(
    source,
    /Platform\.OS === "android"/,
    "the prepare row must not render on iOS or web",
  );
});

test("every new user-facing string exists in English and Spanish", async () => {
  const source = await read("lib/i18n.tsx");

  const keys = [
    "detail.localFallbackDownloading",
    "detail.localFallbackDescReady",
    "detail.cancelOnDeviceTranscription",
    "settings.prepareOnDeviceTitle",
    "settings.prepareOnDeviceDesc",
    "settings.prepareOnDeviceAction",
    "settings.prepareOnDevicePreparing",
    "settings.prepareOnDeviceReady",
  ];
  for (const key of keys) {
    // Both language sections carry the key.
    const hits = source.split(`"${key}"`).length - 1;
    assert.ok(hits >= 2, `${key} must exist in both the EN and ES language sections`);
  }

  // The size is disclosed at the offer, not only during the download.
  const enDescIndex = source.indexOf('"detail.localFallbackDesc"');
  const enDescBlock = source.slice(enDescIndex, enDescIndex + 400);
  assert.match(enDescBlock, /615/, "the EN fallback offer must disclose the ~615 MB download");
});
