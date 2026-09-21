import { spawn } from "node:child_process";
import { promises as fsp } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import ffmpegPath from "ffmpeg-static";

import { transcribeAudioLatencyFirst } from "../../transcription-routing";

/**
 * Turns an uploaded audio or video file into a transcript.
 *
 * Video files are handled by the same path as audio: ffmpeg's `-vn` drops the
 * video stream and the audio is normalised to the 16 kHz mono PCM WAV that ASR
 * providers expect. Nothing here needs to know which it was given.
 *
 * Why segmentation exists: the hedged provider chain has a 60-second total
 * latency budget and each provider caps a single request at 25 MB (Groq) /
 * 25 MB (OpenAI). A 60-minute 16 kHz mono WAV is ~115 MB, so one request
 * cannot carry it. Segments are cut at detected silence boundaries so the
 * joins fall in pauses instead of mid-word, then transcribed and stitched.
 *
 * Everything is staged in a private temp directory and cleaned up in `finally`;
 * ffmpeg runs with file arguments rather than stdin/stdout pipes because a
 * large static ffmpeg deadlocks on a full 64 KB pipe buffer.
 */

/** 10 minutes keeps a 16 kHz mono WAV segment (~19 MB) under every provider cap. */
export const DEFAULT_TARGET_SEGMENT_SECONDS = 600;

/** Silence detection parameters. 0.4 s avoids splitting inside a normal pause. */
const SILENCE_NOISE_DB = -35;
const SILENCE_MIN_DURATION_SECONDS = 0.4;

/** How far from an ideal boundary we will look for a silence to cut in. */
export const SILENCE_SEARCH_WINDOW_SECONDS = 90;

/** Never emit a segment shorter than this, even if silence suggests it. */
const MIN_SEGMENT_SECONDS = 30;

const PROBE_TIMEOUT_MS = 60_000;
const EXTRACT_TIMEOUT_MS = 20 * 60 * 1000;
const SILENCE_TIMEOUT_MS = 20 * 60 * 1000;
const SPLIT_TIMEOUT_MS = 10 * 60 * 1000;
const STDERR_LIMIT = 512 * 1024;
/** Two at a time: enough to overlap provider latency without multiplying cost. */
const SEGMENT_CONCURRENCY = 2;

export type MediaIngestErrorCode =
  | "ffmpeg_unavailable"
  | "no_audio_stream"
  | "extraction_failed"
  | "empty_transcript";

export class MediaIngestError extends Error {
  readonly code: MediaIngestErrorCode;

  constructor(code: MediaIngestErrorCode, message: string) {
    super(message);
    this.name = "MediaIngestError";
    this.code = code;
  }
}

export type SilenceRange = { start: number; end: number };
export type SegmentPlan = { start: number; duration: number };

export type MediaIngestProgress = {
  phase: "extracting" | "segmenting" | "transcribing" | "stitching";
  segmentIndex?: number;
  segmentCount?: number;
};

export type SegmentTranscriber = (input: {
  fileBuffer: Buffer;
  fileName: string;
  language?: string;
  prompt?: string;
  /** Segment duration in seconds — passed through to transcription log lines. */
  durationSec?: number;
}) => Promise<{ text: string; provider: string; model: string }>;

export type MediaIngestResult = {
  text: string;
  durationSeconds: number;
  segmentCount: number;
  providers: string[];
};

/* ------------------------------------------------------------------ *
 * Pure logic (unit-tested without ffmpeg)
 * ------------------------------------------------------------------ */

/**
 * Parse ffmpeg's `silencedetect` output. ffmpeg reports the start of a silence
 * immediately and its end when the silence finishes, so ranges are paired up
 * in order; a trailing start with no matching end is ignored (the file simply
 * ended in silence).
 */
export function parseSilenceRanges(stderr: string): SilenceRange[] {
  const ranges: SilenceRange[] = [];
  let pendingStart: number | null = null;

  const startPattern = /silence_start:\s*(-?\d+(?:\.\d+)?)/g;
  const endPattern = /silence_end:\s*(-?\d+(?:\.\d+)?)/g;
  const events: Array<{ kind: "start" | "end"; at: number; index: number }> = [];

  for (const match of stderr.matchAll(startPattern)) {
    const at = Number(match[1]);
    if (Number.isFinite(at)) {
      events.push({ kind: "start", at, index: match.index ?? 0 });
    }
  }
  for (const match of stderr.matchAll(endPattern)) {
    const at = Number(match[1]);
    if (Number.isFinite(at)) {
      events.push({ kind: "end", at, index: match.index ?? 0 });
    }
  }

  events.sort((a, b) => a.index - b.index);

  for (const event of events) {
    if (event.kind === "start") {
      pendingStart = event.at;
    } else if (pendingStart != null) {
      const start = Math.max(0, Math.min(pendingStart, event.at));
      const end = Math.max(pendingStart, event.at);
      if (end > start) ranges.push({ start, end });
      pendingStart = null;
    }
  }

  return ranges;
}

/** Parse the container duration ffmpeg prints on its first stderr lines. */
export function parseDurationFromStderr(stderr: string): number | null {
  const match = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (!match) return null;
  const total =
    parseInt(match[1], 10) * 3600 + parseInt(match[2], 10) * 60 + parseFloat(match[3]);
  return Number.isFinite(total) && total > 0 ? total : null;
}

/**
 * Choose where to cut. For each ideal boundary (a multiple of the target
 * length) cut inside the nearest detected silence within the search window;
 * when there is no silence nearby, fall back to the exact boundary so the
 * caller still gets a complete transcript rather than a truncated one.
 */
export function chooseSplitPoints(
  durationSeconds: number,
  silenceRanges: SilenceRange[],
  targetSeconds: number = DEFAULT_TARGET_SEGMENT_SECONDS,
  searchWindowSeconds: number = SILENCE_SEARCH_WINDOW_SECONDS,
): number[] {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return [];
  if (!Number.isFinite(targetSeconds) || targetSeconds <= 0) return [];

  const points: number[] = [];
  for (let ideal = targetSeconds; ideal < durationSeconds - MIN_SEGMENT_SECONDS; ideal += targetSeconds) {
    let best: number | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const range of silenceRanges) {
      const midpoint = (range.start + range.end) / 2;
      const distance = Math.abs(midpoint - ideal);
      if (distance <= searchWindowSeconds && distance < bestDistance) {
        bestDistance = distance;
        best = midpoint;
      }
    }
    points.push(best ?? ideal);
  }

  points.sort((a, b) => a - b);

  // Enforce a minimum segment length so two cuts never crowd each other.
  const deduped: number[] = [];
  for (const point of points) {
    const previous = deduped.length ? deduped[deduped.length - 1] : 0;
    if (point - previous >= MIN_SEGMENT_SECONDS && durationSeconds - point >= MIN_SEGMENT_SECONDS) {
      deduped.push(point);
    }
  }

  return deduped;
}

/** Turn cut points into the segments that will be transcribed. */
export function planSegments(durationSeconds: number, splitPoints: number[]): SegmentPlan[] {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return [];
  const boundaries = [0, ...splitPoints.filter((p) => p > 0 && p < durationSeconds), durationSeconds];
  const segments: SegmentPlan[] = [];
  for (let i = 0; i < boundaries.length - 1; i += 1) {
    const start = boundaries[i];
    const duration = boundaries[i + 1] - start;
    if (duration > 0) segments.push({ start, duration });
  }
  return segments;
}

/** Join segment transcripts, dropping any segment that produced nothing. */
export function stitchTranscripts(texts: string[]): string {
  return texts
    .map((text) => text.trim())
    .filter((text) => text.length > 0)
    .join("\n\n");
}

/* ------------------------------------------------------------------ *
 * ffmpeg wrapper
 * ------------------------------------------------------------------ */

function getFfmpegPath(): string {
  if (!ffmpegPath) {
    throw new MediaIngestError(
      "ffmpeg_unavailable",
      "ffmpeg is not available on this server, so uploaded media cannot be processed.",
    );
  }
  return ffmpegPath;
}

type FfmpegRunResult = { stderr: string; code: number | null; timedOut: boolean };

function runFfmpeg(args: string[], timeoutMs: number): Promise<FfmpegRunResult> {
  const binary = getFfmpegPath();
  return new Promise<FfmpegRunResult>((resolve) => {
    let settled = false;
    let stderr = "";
    let timedOut = false;

    const child = spawn(binary, args, { stdio: ["ignore", "ignore", "pipe"] });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);

    const finish = (code: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ stderr, code, timedOut });
    };

    child.stderr.on("data", (chunk: Buffer) => {
      if (stderr.length < STDERR_LIMIT) stderr += chunk.toString();
    });
    child.on("error", () => finish(null));
    child.on("close", (code) => finish(code));
  });
}

export async function createWorkDir(): Promise<string> {
  return fsp.mkdtemp(path.join(os.tmpdir(), "media-ingest-"));
}

export async function removeWorkDir(dir: string): Promise<void> {
  await fsp.rm(dir, { recursive: true, force: true }).catch(() => undefined);
}

/**
 * Read a media file's duration without decoding it. Works for audio and video
 * containers alike, which is what lets the route enforce the tier cap on a
 * file the user uploaded rather than trusting a client-supplied number.
 */
export async function probeMediaDuration(filePath: string): Promise<number | null> {
  const result = await runFfmpeg(["-hide_banner", "-i", filePath], PROBE_TIMEOUT_MS);
  return parseDurationFromStderr(result.stderr);
}

/**
 * Strip any video stream and normalise the audio to 16 kHz mono PCM WAV —
 * the format every provider downsamples to anyway, and the format the
 * on-device whisper path expects.
 */
export async function extractNormalizedWav(
  sourcePath: string,
  workDir: string,
): Promise<{ wavPath: string; durationSeconds: number }> {
  const wavPath = path.join(workDir, "normalized.wav");
  const result = await runFfmpeg(
    [
      "-hide_banner",
      "-y",
      "-i", sourcePath,
      "-vn",
      "-ac", "1",
      "-ar", "16000",
      "-c:a", "pcm_s16le",
      wavPath,
    ],
    EXTRACT_TIMEOUT_MS,
  );

  if (result.code !== 0) {
    const detail = result.stderr.slice(-500);
    const noAudio = /does not contain any stream|Output file does not contain any stream|Stream map '0:a'/i.test(
      result.stderr,
    );
    throw new MediaIngestError(
      noAudio ? "no_audio_stream" : "extraction_failed",
      noAudio
        ? "That file has no audio track to transcribe."
        : `We couldn't read the audio from that file. ${detail}`,
    );
  }

  const durationSeconds = parseDurationFromStderr(result.stderr);
  if (durationSeconds == null) {
    throw new MediaIngestError(
      "extraction_failed",
      "We couldn't determine the length of that file's audio.",
    );
  }

  return { wavPath, durationSeconds };
}

/** Find silence ranges in a normalised WAV (used to place the cuts). */
export async function detectSilenceRanges(wavPath: string): Promise<SilenceRange[]> {
  const result = await runFfmpeg(
    [
      "-hide_banner",
      "-i", wavPath,
      "-af", `silencedetect=noise=${SILENCE_NOISE_DB}dB:d=${SILENCE_MIN_DURATION_SECONDS}`,
      "-f", "null",
      "-",
    ],
    SILENCE_TIMEOUT_MS,
  );
  return parseSilenceRanges(result.stderr);
}

/** Cut one segment out of the normalised WAV without re-encoding. */
export async function cutSegment(
  wavPath: string,
  segment: SegmentPlan,
  outPath: string,
): Promise<void> {
  const result = await runFfmpeg(
    [
      "-hide_banner",
      "-y",
      "-ss", segment.start.toFixed(3),
      "-t", segment.duration.toFixed(3),
      "-i", wavPath,
      "-c", "copy",
      outPath,
    ],
    SPLIT_TIMEOUT_MS,
  );
  if (result.code !== 0) {
    throw new MediaIngestError(
      "extraction_failed",
      `We couldn't split that audio for processing. ${result.stderr.slice(-300)}`,
    );
  }
}

/* ------------------------------------------------------------------ *
 * Orchestration
 * ------------------------------------------------------------------ */

/**
 * Transcribe a media file that has already been staged locally and probed.
 *
 * The caller owns the tier and token gating (it has the probed duration before
 * calling this), so this function only does the audio work.
 */
export async function transcribeMediaFile(params: {
  sourcePath: string;
  fileName: string;
  durationSeconds: number;
  language?: string;
  prompt?: string;
  targetSegmentSeconds?: number;
  workDir?: string;
  transcribe?: SegmentTranscriber;
  onProgress?: (progress: MediaIngestProgress) => void;
}): Promise<MediaIngestResult> {
  const transcribe: SegmentTranscriber =
    params.transcribe ??
    (async (input) => {
      const result = await transcribeAudioLatencyFirst({
        fileBuffer: input.fileBuffer,
        fileName: input.fileName,
        language: input.language,
        prompt: input.prompt,
        durationSec: input.durationSec,
      });
      return { text: result.text, provider: result.provider, model: result.model };
    });

  const workDir = params.workDir ?? (await createWorkDir());
  const ownsWorkDir = !params.workDir;
  const providers: string[] = [];

  try {
    params.onProgress?.({ phase: "extracting" });
    const { wavPath, durationSeconds } = await extractNormalizedWav(params.sourcePath, workDir);

    params.onProgress?.({ phase: "segmenting" });
    const target = params.targetSegmentSeconds ?? DEFAULT_TARGET_SEGMENT_SECONDS;
    let segments: SegmentPlan[];
    if (durationSeconds <= target) {
      segments = [{ start: 0, duration: durationSeconds }];
    } else {
      const silence = await detectSilenceRanges(wavPath);
      segments = planSegments(durationSeconds, chooseSplitPoints(durationSeconds, silence, target));
    }

    params.onProgress?.({ phase: "transcribing", segmentCount: segments.length });

    // Any failure inside a segment aborts the whole ingest: a partial
    // transcript presented as complete would be worse than an error the user
    // can retry.
    const texts: string[] = new Array(segments.length).fill("");
    let nextIndex = 0;
    const workers = new Array(Math.min(SEGMENT_CONCURRENCY, segments.length))
      .fill(null)
      .map(async () => {
        while (true) {
          const index = nextIndex;
          nextIndex += 1;
          if (index >= segments.length) return;

          const segment = segments[index];
          const segmentPath = path.join(workDir, `segment-${String(index).padStart(3, "0")}.wav`);
          await cutSegment(wavPath, segment, segmentPath);
          try {
            const buffer = await fsp.readFile(segmentPath);
            const result = await transcribe({
              fileBuffer: buffer,
              // The extension matters: providers infer the container from it.
              fileName: `segment-${index + 1}.wav`,
              language: params.language,
              prompt: params.prompt,
              durationSec: segment.duration,
            });
            texts[index] = result.text;
            providers.push(result.provider);
          } finally {
            // Bound disk use: drop each segment as soon as it has been used.
            await fsp.rm(segmentPath, { force: true }).catch(() => undefined);
          }
          params.onProgress?.({
            phase: "transcribing",
            segmentIndex: index + 1,
            segmentCount: segments.length,
          });
        }
      });
    await Promise.all(workers);

    params.onProgress?.({ phase: "stitching" });
    const text = stitchTranscripts(texts);
    if (!text) {
      throw new MediaIngestError(
        "empty_transcript",
        "No speech was detected in that file.",
      );
    }

    return {
      text,
      durationSeconds,
      segmentCount: segments.length,
      providers: Array.from(new Set(providers)),
    };
  } finally {
    if (ownsWorkDir) await removeWorkDir(workDir);
  }
}

/**
 * Keep only the normalised audio for storage: re-encode the WAV to AAC so a
 * 60-minute file occupies ~30 MB instead of ~115 MB, which matters against a
 * 5 GB tier allowance. Returns the path of the m4a to upload.
 */
export async function encodeStoredAudio(wavPath: string, workDir: string): Promise<string> {
  const outPath = path.join(workDir, "stored.m4a");
  const result = await runFfmpeg(
    [
      "-hide_banner",
      "-y",
      "-i", wavPath,
      "-vn",
      "-c:a", "aac",
      "-b:a", "64k",
      "-ac", "1",
      "-ar", "16000",
      "-movflags", "+faststart",
      outPath,
    ],
    EXTRACT_TIMEOUT_MS,
  );
  if (result.code !== 0) {
    throw new MediaIngestError(
      "extraction_failed",
      `We couldn't prepare the audio for storage. ${result.stderr.slice(-300)}`,
    );
  }
  return outPath;
}

/**
 * Extract the normalised WAV for a caller that wants both the transcript and a
 * storable audio file, keeping one ffmpeg pass for extraction and a second for
 * the storage encode.
 */
export async function prepareStoredAudio(
  sourcePath: string,
  workDir: string,
): Promise<{ wavPath: string; durationSeconds: number; storedAudioPath: string }> {
  const { wavPath, durationSeconds } = await extractNormalizedWav(sourcePath, workDir);
  const storedAudioPath = await encodeStoredAudio(wavPath, workDir);
  return { wavPath, durationSeconds, storedAudioPath };
}
