import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import { promises as fsp } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ffmpegPath from "ffmpeg-static";

import {
  MediaIngestError,
  chooseSplitPoints,
  createWorkDir,
  detectSilenceRanges,
  extractNormalizedWav,
  parseDurationFromStderr,
  parseSilenceRanges,
  planSegments,
  probeMediaDuration,
  removeWorkDir,
  stitchTranscripts,
  transcribeMediaFile,
} from "../../server/modules/recordings/media-ingest";
import { MEDIA_IMPORT_EXTENSIONS, TIER_LIMITS, isMediaImportFileName } from "../../shared/plan-limits";

/* ------------------------------------------------------------------ *
 * Pure logic
 * ------------------------------------------------------------------ */

test("parseSilenceRanges pairs starts with ends in the order ffmpeg reports them", () => {
  const stderr = [
    "[silencedetect @ 0x1] silence_start: 610.5",
    "[silencedetect @ 0x1] silence_end: 622.25 | silence_duration: 11.75",
    "[silencedetect @ 0x1] silence_start: 900",
    "[silencedetect @ 0x1] silence_end: 905",
  ].join("\n");

  assert.deepEqual(parseSilenceRanges(stderr), [
    { start: 610.5, end: 622.25 },
    { start: 900, end: 905 },
  ]);
});

test("parseSilenceRanges ignores a trailing start with no matching end", () => {
  // A file that simply ends in silence produces an unmatched start.
  const stderr = "silence_start: 12.5\nsilence_end: 20\nsilence_start: 40";
  assert.deepEqual(parseSilenceRanges(stderr), [{ start: 12.5, end: 20 }]);
});

test("parseDurationFromStderr reads the container duration and tolerates garbage", () => {
  assert.equal(parseDurationFromStderr("  Duration: 00:20:52.35, start: 0.000000"), 1252.35);
  assert.equal(parseDurationFromStderr("Duration: 01:00:00.00, bitrate: 64 kb/s"), 3600);
  assert.equal(parseDurationFromStderr("no duration here"), null);
});

test("chooseSplitPoints cuts inside the nearest silence instead of the ideal boundary", () => {
  // Ideal boundary at 600 s; the uploader paused between 610.5 and 622.25.
  // The 1200 s boundary has no silence near it, so it stays exact.
  const points = chooseSplitPoints(1252, [{ start: 610.5, end: 622.25 }], 600);
  assert.equal(points.length, 2);
  assert.ok(points[0] > 610 && points[0] < 623, `expected the cut inside the silence, got ${points[0]}`);
  assert.equal(points[1], 1200);
});

test("chooseSplitPoints falls back to the exact boundary when there is no silence nearby", () => {
  // Silence at 100 s is far outside the +/- 90 s window around 600 s, so the
  // cut stays exactly on the boundary. The second boundary (1200 s) is still
  // emitted: a 1252 s file genuinely needs two cuts.
  const points = chooseSplitPoints(1252, [{ start: 95, end: 105 }], 600);
  assert.deepEqual(points, [600, 1200]);
});

test("chooseSplitPoints emits boundaries for every target multiple, and drops crowded ones", () => {
  const points = chooseSplitPoints(1800, [], 600);
  assert.deepEqual(points, [600, 1200]);
  // A final boundary that would leave a stub segment is dropped.
  const stubby = chooseSplitPoints(1230, [], 600);
  assert.deepEqual(stubby, [600]);
});

test("planSegments turns cut points into contiguous segments covering the whole file", () => {
  const segments = planSegments(1252, [616, 1200]);
  assert.deepEqual(segments, [
    { start: 0, duration: 616 },
    { start: 616, duration: 584 },
    { start: 1200, duration: 52 },
  ]);
  const total = segments.reduce((sum, segment) => sum + segment.duration, 0);
  assert.equal(total, 1252);
  assert.deepEqual(planSegments(0, []), []);
});

test("stitchTranscripts joins segments in order and drops empties", () => {
  assert.equal(stitchTranscripts(["  first  ", "", "  ", "second"]), "first\n\nsecond");
  assert.equal(stitchTranscripts(["\n\n"]), "");
});

/* ------------------------------------------------------------------ *
 * Tier ladder (guards the Pro 30 / Base 15 / Free 3 recording decision and the
 * longer Pro 60 / Base 20 / Free none import ladder)
 * ------------------------------------------------------------------ */

test("media ceilings match the published plan ladder", () => {
  // Live takes: 3 / 15 / 30 minutes.
  assert.equal(TIER_LIMITS.free.maxRecordingSeconds, 180);
  assert.equal(TIER_LIMITS.base.maxRecordingSeconds, 900);
  assert.equal(TIER_LIMITS.pro.maxRecordingSeconds, 1800);

  // Imports carry their own, longer ladder: 3 / 20 / 60 minutes, because an
  // upload is a background job rather than one take on a device.
  assert.equal(TIER_LIMITS.free.maxMediaImportSeconds, 0);
  assert.equal(TIER_LIMITS.base.maxMediaImportSeconds, 1200);
  assert.equal(TIER_LIMITS.pro.maxMediaImportSeconds, 3600);
  assert.ok(TIER_LIMITS.base.maxMediaImportSeconds > TIER_LIMITS.base.maxRecordingSeconds);
  assert.ok(TIER_LIMITS.pro.maxMediaImportSeconds > TIER_LIMITS.pro.maxRecordingSeconds);

  // Imports require cloud storage, which the free tier does not have.
  assert.equal(TIER_LIMITS.free.maxMediaUploadMB, 0);
  assert.ok(TIER_LIMITS.base.maxMediaUploadMB > 0);
  assert.ok(TIER_LIMITS.pro.maxMediaUploadMB > TIER_LIMITS.base.maxMediaUploadMB);
});

test("isMediaImportFileName accepts audio and video containers, not documents", () => {
  assert.ok(isMediaImportFileName("lecture.MP4"));
  assert.ok(isMediaImportFileName("voice note.m4a"));
  assert.ok(isMediaImportFileName("podcast.mp3"));
  assert.ok(isMediaImportFileName("screen-recording.mkv"));
  assert.ok(!isMediaImportFileName("syllabus.pdf"));
  assert.ok(!isMediaImportFileName("no-extension"));
  assert.ok(MEDIA_IMPORT_EXTENSIONS.includes(".wav"));
});

/* ------------------------------------------------------------------ *
 * ffmpeg integration (skipped when the static binary is unavailable)
 * ------------------------------------------------------------------ */

function run(binary: string, args: string[]): Promise<{ code: number | null; stderr: string }> {
  return new Promise((resolve) => {
    let stderr = "";
    const child = spawn(binary, args, { stdio: ["ignore", "ignore", "pipe"] });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", () => resolve({ code: null, stderr }));
    child.on("close", (code) => resolve({ code, stderr }));
  });
}

test("video uploads: the video stream is stripped and the audio normalised to 16 kHz mono", async (t) => {
  if (!ffmpegPath) {
    t.skip("ffmpeg-static binary unavailable");
    return;
  }

  const workDir = await createWorkDir();
  t.after(async () => {
    await removeWorkDir(workDir);
  });

  const videoPath = join(workDir, "clip.mp4");
  const built = await run(ffmpegPath, [
    "-hide_banner", "-y",
    "-f", "lavfi", "-i", "color=c=blue:s=160x120:r=10:d=20",
    "-f", "lavfi", "-i", "sine=frequency=440:duration=20",
    "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-shortest",
    videoPath,
  ]);
  assert.equal(built.code, 0, `could not build the test video: ${built.stderr.slice(-400)}`);

  const probed = await probeMediaDuration(videoPath);
  assert.ok(probed != null && Math.abs(probed - 20) < 1, `expected ~20 s, got ${probed}`);

  const { wavPath, durationSeconds } = await extractNormalizedWav(videoPath, workDir);
  assert.ok(Math.abs(durationSeconds - 20) < 1);

  // The extracted audio must be 16 kHz mono PCM with no video stream left.
  const inspected = await run(ffmpegPath, ["-hide_banner", "-i", wavPath]);
  assert.match(inspected.stderr, /Audio:\s*pcm_s16le/);
  assert.match(inspected.stderr, /16000 Hz/);
  assert.match(inspected.stderr, /mono/);
  assert.ok(!/Video:/.test(inspected.stderr), "the normalised WAV must not contain a video stream");

  const stat = await fsp.stat(wavPath);
  assert.ok(stat.size > 1000, "expected a non-empty normalised WAV");
});

test("long audio: segments land in silence, and the transcript stitches in order", async (t) => {
  if (!ffmpegPath) {
    t.skip("ffmpeg-static binary unavailable");
    return;
  }

  const workDir = await createWorkDir();
  t.after(async () => {
    await removeWorkDir(workDir);
  });

  // 610 s of tone, a 12 s pause, then 630 s more — so the ideal 600 s boundary
  // has a real silence to snap into, while 1200 s has none.
  const longPath = join(workDir, "lecture.m4a");
  const built = await run(ffmpegPath, [
    "-hide_banner", "-y",
    "-f", "lavfi", "-i", "sine=frequency=440:duration=610",
    "-f", "lavfi", "-i", "anullsrc=r=16000:cl=mono:d=12",
    "-f", "lavfi", "-i", "sine=frequency=440:duration=630",
    "-filter_complex", "[0:a][1:a][2:a]concat=n=3:v=0:a=1[a]",
    "-map", "[a]", "-c:a", "aac",
    longPath,
  ]);
  assert.equal(built.code, 0, `could not build the long test audio: ${built.stderr.slice(-400)}`);

  const duration = await probeMediaDuration(longPath);
  assert.ok(duration != null && Math.abs(duration - 1252) < 3, `expected ~1252 s, got ${duration}`);

  const { wavPath, durationSeconds } = await extractNormalizedWav(longPath, workDir);
  const silence = await detectSilenceRanges(wavPath);
  assert.ok(silence.length >= 1, "expected ffmpeg to find the pause");

  const points = chooseSplitPoints(durationSeconds, silence, 600);
  assert.equal(points.length, 2, `expected two cut points, got ${JSON.stringify(points)}`);
  const firstCutLandedInSilence = silence.some(
    (range) => points[0] > range.start && points[0] < range.end,
  );
  assert.ok(firstCutLandedInSilence, `first cut ${points[0]} should sit inside the detected silence`);

  const segments = planSegments(durationSeconds, points);
  assert.equal(segments.length, 3);

  // Inject a fake provider: this asserts the orchestration — one call per
  // segment, stitched in index order even though segments run concurrently.
  const seen: string[] = [];
  const result = await transcribeMediaFile({
    sourcePath: longPath,
    fileName: "lecture.m4a",
    durationSeconds,
    workDir,
    transcribe: async ({ fileName }) => {
      seen.push(fileName);
      return { text: `text for ${fileName}`, provider: "fake", model: "fake-1" };
    },
  });

  assert.equal(seen.length, 3, `expected 3 segment transcriptions, got ${seen.length}`);
  assert.equal(result.segmentCount, 3);
  assert.equal(result.providers.length, 1);
  assert.equal(result.providers[0], "fake");
  assert.equal(
    result.text,
    "text for segment-1.wav\n\ntext for segment-2.wav\n\ntext for segment-3.wav",
  );
  assert.ok(Math.abs(result.durationSeconds - durationSeconds) < 0.01);
});

test("a file whose audio cannot be decoded fails with a typed error", async (t) => {
  if (!ffmpegPath) {
    t.skip("ffmpeg-static binary unavailable");
    return;
  }

  const workDir = await createWorkDir();
  t.after(async () => {
    await removeWorkDir(workDir);
  });

  // A silent clip has audio, so use a text file to stand in for a corrupt upload.
  const junkPath = join(workDir, "not-media.mp4");
  await fsp.writeFile(junkPath, "this is not a media file at all");

  await assert.rejects(
    () => extractNormalizedWav(junkPath, workDir),
    (error: unknown) =>
      error instanceof MediaIngestError && (error.code === "extraction_failed" || error.code === "no_audio_stream"),
  );
});
