import { spawn } from "node:child_process";
import ffmpegPath from "ffmpeg-static";

/**
 * RMS threshold below which decoded audio is considered silent.
 *
 * Calibrated against a real phone recording (2026-08-28): a quiet 4-second
 * voice note held at arm's length measured RMS 126 with clearly audible
 * speech, while the old threshold of 400 (~ -38 dBFS) declared it "silent" and
 * — because transcription_no_speech was non-retryable — locked the user out
 * of a recording that had real content. Digital silence sits near 0 and
 * room tone is a handful of counts, so 60 keeps a wide margin below real
 * speech while still catching genuinely empty recordings.
 *
 * Only consulted when the ASR provider already returned fewer than 3
 * meaningful characters, so it is a tiebreaker, never a gate on real text.
 */
export const SILENCE_RMS_THRESHOLD = 60;

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

/**
 * Probe the duration of an audio buffer in seconds using ffmpeg (parses the
 * container header's "Duration: hh:mm:ss.xx" line — no full decode). Resolves
 * null when ffmpeg is unavailable or the duration cannot be determined.
 *
 * Used to price transcription at 1 token/second when no Recording.duration is
 * available (developer API / MCP raw-audio endpoints).
 */
export function getAudioDurationSeconds(fileBuffer: Buffer): Promise<number | null> {
  const ffmpegBinary = ffmpegPath;
  if (!ffmpegBinary) {
    return Promise.resolve(null);
  }

  return new Promise<number | null>((resolve) => {
    let settled = false;
    let stderr = "";

    const finish = (result: number | null) => {
      clearTimeout(timer);
      if (!settled) {
        settled = true;
        resolve(result);
      }
    };

    const child = spawn(
      ffmpegBinary,
      ["-hide_banner", "-i", "pipe:0"],
      { stdio: ["pipe", "ignore", "pipe"] },
    );

    const timer = setTimeout(() => {
      console.warn("[audio] ffmpeg duration probe timed out");
      child.kill("SIGKILL");
      finish(null);
    }, FFMPEG_TIMEOUT_MS);

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
      if (stderr.length > 64 * 1024) {
        child.kill("SIGKILL");
        finish(null);
      }
    });

    child.on("error", (error) => {
      console.warn("[audio] ffmpeg duration probe spawn failed (%s)", error.message);
      finish(null);
    });

    child.on("close", () => {
      const match = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
      if (match) {
        const hours = parseInt(match[1], 10);
        const minutes = parseInt(match[2], 10);
        const seconds = parseFloat(match[3]);
        const total = hours * 3600 + minutes * 60 + seconds;
        finish(Number.isFinite(total) && total > 0 ? total : null);
      } else {
        finish(null);
      }
    });

    child.stdin.on("error", () => {
      // Ignore stdin write errors; the close handler resolves the outcome.
    });
    child.stdin.write(fileBuffer);
    child.stdin.end();
  });
}

/**
 * Best-effort audio duration for transcription pricing. Prefers the ffmpeg
 * probe; falls back to a rough ~16 KB/s (128 kbps) size estimate (flagged)
 * when probing is unavailable, so a hard gate always has a cost to check.
 */
export async function estimateAudioDurationSeconds(fileBuffer: Buffer): Promise<number> {
  const probed = await getAudioDurationSeconds(fileBuffer);
  if (probed != null && probed > 0) return probed;
  return Math.max(1, Math.round(fileBuffer.length / 16000));
}
