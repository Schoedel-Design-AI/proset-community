import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import ffmpegPath from "ffmpeg-static";
import {
  isSupportedAudioFormat,
  convertAudioBuffer,
  AUDIO_FORMAT_CONFIG,
  SUPPORTED_AUDIO_FORMATS,
  type SupportedAudioFormat,
} from "../../server/audio-converter";
import { AUDIO_EXPORT_FORMATS } from "../../lib/utils";

test("supported audio formats include mp3, wav, m4a, flac, ogg", () => {
  const expectedFormats: SupportedAudioFormat[] = ["mp3", "wav", "m4a", "flac", "ogg"];
  assert.deepEqual([...SUPPORTED_AUDIO_FORMATS], expectedFormats);

  for (const fmt of expectedFormats) {
    assert.equal(isSupportedAudioFormat(fmt), true, `${fmt} should be supported`);
    assert.equal(isSupportedAudioFormat(`.${fmt}`), true, `.${fmt} should be supported`);
    assert.equal(isSupportedAudioFormat(fmt.toUpperCase()), true, `${fmt.toUpperCase()} should be supported`);
  }

  assert.equal(isSupportedAudioFormat("txt"), false);
  assert.equal(isSupportedAudioFormat("pdf"), false);
  assert.equal(isSupportedAudioFormat("exe"), false);
});

test("audio format config has mime types and extensions for all 5 formats", () => {
  assert.equal(AUDIO_FORMAT_CONFIG.mp3.mimeType, "audio/mpeg");
  assert.equal(AUDIO_FORMAT_CONFIG.mp3.ext, "mp3");

  assert.equal(AUDIO_FORMAT_CONFIG.wav.mimeType, "audio/wav");
  assert.equal(AUDIO_FORMAT_CONFIG.wav.ext, "wav");

  assert.equal(AUDIO_FORMAT_CONFIG.m4a.mimeType, "audio/mp4");
  assert.equal(AUDIO_FORMAT_CONFIG.m4a.ext, "m4a");

  assert.equal(AUDIO_FORMAT_CONFIG.flac.mimeType, "audio/flac");
  assert.equal(AUDIO_FORMAT_CONFIG.flac.ext, "flac");

  assert.equal(AUDIO_FORMAT_CONFIG.ogg.mimeType, "audio/ogg");
  assert.equal(AUDIO_FORMAT_CONFIG.ogg.ext, "ogg");
});

test("AUDIO_EXPORT_FORMATS exposes all 5 selectable formats for client UI", () => {
  const values = AUDIO_EXPORT_FORMATS.map((f) => f.value);
  assert.deepEqual(values, ["mp3", "wav", "m4a", "flac", "ogg"]);
});

test("convertAudioBuffer converts audio to mp3, wav, m4a, flac, ogg", async () => {
  assert.ok(ffmpegPath, "ffmpeg-static binary must be present");

  // Generate 0.5s test sine audio in WAV
  const gen: SpawnSyncReturns<Buffer> = spawnSync(ffmpegPath!, [
    "-f", "lavfi",
    "-i", "sine=frequency=440:duration=0.5",
    "-f", "wav",
    "pipe:1",
  ]);
  assert.equal(gen.status, 0, "Failed to generate test audio sine wave");
  const testWavBuffer = gen.stdout;
  assert.ok(testWavBuffer.length > 0, "Test audio buffer must not be empty");

  for (const format of SUPPORTED_AUDIO_FORMATS) {
    const converted = await convertAudioBuffer(testWavBuffer, format);
    assert.ok(converted.length > 0, `Converted ${format} buffer must not be empty`);

    // Verify ffmpeg can decode the converted buffer
    const verifyResult: SpawnSyncReturns<Buffer> = spawnSync(ffmpegPath!, [
      "-hide_banner",
      "-loglevel", "error",
      "-i", "pipe:0",
      "-f", "null",
      "-",
    ], { input: converted });

    assert.equal(
      verifyResult.status,
      0,
      `Converted ${format} output must be decodable by ffmpeg (stderr: ${verifyResult.stderr.toString()})`,
    );
  }
});

test("convertAudioBuffer throws error for unsupported format", async () => {
  const dummyBuffer = Buffer.from("not-audio");
  await assert.rejects(
    async () => {
      await convertAudioBuffer(dummyBuffer, "invalid_fmt" as any);
    },
    /Unsupported audio format/,
  );
});
