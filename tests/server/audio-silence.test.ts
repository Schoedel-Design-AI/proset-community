import assert from "node:assert/strict";
import { test } from "node:test";
import {
  computeRmsFromPcm,
  SILENCE_RMS_THRESHOLD,
} from "../../server/audio-silence";

function tonePcm(amplitude: number, samples = 8000): Buffer {
  const pcm = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i += 1) {
    pcm.writeInt16LE(Math.round(Math.sin(i / 8) * amplitude), i * 2);
  }
  return pcm;
}

test("computeRmsFromPcm: digital silence is ~0", () => {
  const pcm = Buffer.alloc(8000, 0);
  const rms = computeRmsFromPcm(pcm);
  assert.ok(rms < 1, `expected near-zero RMS, got ${rms}`);
});

test("computeRmsFromPcm: full-scale square wave ≈ 32768", () => {
  const pcm = Buffer.alloc(8000);
  for (let i = 0; i < 4000; i += 1) {
    pcm.writeInt16LE(i % 2 === 0 ? 32767 : -32768, i * 2);
  }
  const rms = computeRmsFromPcm(pcm);
  assert.ok(rms > 32700, `expected near-full-scale RMS, got ${rms}`);
});

test("computeRmsFromPcm: room-tone (~-45 dBFS) is below the silence threshold", () => {
  const amplitude = 32768 * 10 ** (-45 / 20); // ≈ 184
  const rms = computeRmsFromPcm(tonePcm(amplitude));
  assert.ok(rms < SILENCE_RMS_THRESHOLD, `expected silent, got RMS ${rms}`);
});

test("computeRmsFromPcm: speech-level tone (~-25 dBFS) is above the silence threshold", () => {
  const amplitude = 32768 * 10 ** (-25 / 20); // ≈ 1842
  const rms = computeRmsFromPcm(tonePcm(amplitude));
  assert.ok(rms > SILENCE_RMS_THRESHOLD, `expected audible, got RMS ${rms}`);
});
