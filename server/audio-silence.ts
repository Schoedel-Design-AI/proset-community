import { spawn } from "node:child_process";
import ffmpegPath from "ffmpeg-static";

/**
 * RMS threshold below which decoded audio is considered silent, ~ -38 dBFS.
 * Real speech (even quiet speech) sits well above this; digital silence and
 * room-tone-only recordings sit below. Only consulted when the ASR provider
 * already returned fewer than 3 meaningful characters, so the stakes are low:
 * the check only decides whether to tell the user "no speech" (re-record)
 * vs "transcription failed" (retry).
 */
export const SILENCE_RMS_THRESHOLD = 400;

/** Cap decoded PCM at ~1.1 hours of 16 kHz mono (matches 16-bit s16le). */
const MAX_PCM_BYTES = 128 * 1024 * 1024;
const FFMPEG_TIMEOUT_MS = 20_000;

export interface SilenceCheck {
  silent: boolean;
  rms: number | null;
  checked: boolean;
}

/**
 * RMS (root-mean-square) of a 16-bit little-endian mono PCM buffer.
 * Pure function — unit-testable without ffmpeg.
 */
export function computeRmsFromPcm(pcm: Buffer): number {
  const sampleCount = Math.floor(pcm.length / 2);
  if (sampleCount === 0) return 0;
  let sumSquares = 0;
  for (let i = 0; i < sampleCount; i += 1) {
    const sample = pcm.readInt16LE(i * 2);
    sumSquares += sample * sample;
  }
  return Math.sqrt(sumSquares / sampleCount);
}

/**
 * Decode the audio buffer to 16 kHz mono PCM and measure its RMS energy.
 *
 * Uses spawn + manual stdin writes: execFile's `input` option is known to hang
 * with large static binaries (stdin never reaches EOF), so the buffer is
 * written and ended explicitly. Errors, non-zero exits, timeouts, and output
 * overruns all resolve to { silent: false, checked: false } — callers must
 * fall back to the conservative "transcription failed, retryable" path
 * rather than mislabeling a real recording as silent.
 */
export function detectSilence(fileBuffer: Buffer): Promise<SilenceCheck> {
  const ffmpegBinary = ffmpegPath;
  if (!ffmpegBinary) {
    console.warn("[silence] ffmpeg-static binary not found; skipping silence check");
    return Promise.resolve({ silent: false, checked: false, rms: null });
  }

  return new Promise<SilenceCheck>((resolve) => {
    const finish = (result: SilenceCheck) => {
      clearTimeout(timer);
      if (!settled) {
        settled = true;
        resolve(result);
      }
    };

    let settled = false;
    let totalBytes = 0;
    const chunks: Buffer[] = [];

    const child = spawn(
      ffmpegBinary,
      [
        "-hide_banner",
        "-loglevel", "error",
        "-i", "pipe:0",
        "-f", "s16le",
        "-ac", "1",
        "-ar", "16000",
        "-acodec", "pcm_s16le",
        "-",
      ],
      { stdio: ["pipe", "pipe", "ignore"] },
    );

    const timer = setTimeout(() => {
      console.warn("[silence] ffmpeg exceeded the silence-check timeout; treating as non-silent");
      child.kill("SIGKILL");
      finish({ silent: false, checked: false, rms: null });
    }, FFMPEG_TIMEOUT_MS);

    child.stdout.on("data", (chunk: Buffer) => {
      totalBytes += chunk.length;
      if (totalBytes > MAX_PCM_BYTES) {
        console.warn("[silence] decoded PCM exceeded the output cap; treating as non-silent");
        child.kill("SIGKILL");
        finish({ silent: false, checked: false, rms: null });
        return;
      }
      chunks.push(chunk);
    });

    child.on("error", (error) => {
      console.warn("[silence] ffmpeg spawn failed (%s); treating as non-silent", error.message);
      finish({ silent: false, checked: false, rms: null });
    });

    child.on("close", (code) => {
      if (code !== 0) {
        console.warn(`[silence] ffmpeg exited with code ${code}; treating as non-silent`);
        finish({ silent: false, checked: false, rms: null });
        return;
      }
      const rms = computeRmsFromPcm(Buffer.concat(chunks));
      finish({ silent: rms < SILENCE_RMS_THRESHOLD, rms, checked: true });
    });

    child.stdin.on("error", (error) => {
      console.warn("[silence] stdin write failed (%s); treating as non-silent", error.message);
    });
    child.stdin.write(fileBuffer);
    child.stdin.end();
  });
}
