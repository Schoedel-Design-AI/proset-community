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

// A real quiet phone recording measured RMS 126 (issue #196): a 4-second voice
// note at arm's length that Whisper returned no text for but which clearly had
// speech. The threshold must sit well below that so genuine speech is never
// declared silent — the whole point of the recalibration.
test("the threshold is calibrated below real (quiet) phone speech", () => {
  assert.ok(SILENCE_RMS_THRESHOLD < 126, `threshold ${SILENCE_RMS_THRESHOLD} must be below 126 (a measured real recording)`);
  assert.ok(SILENCE_RMS_THRESHOLD > 5, "threshold must stay above digital silence / room-tone noise floor");
});

test("a speech-level tone is above the silence threshold", () => {
  const amplitude = 32768 * 10 ** (-25 / 20); // ≈ 1842, normal speech
  const rms = computeRmsFromPcm(tonePcm(amplitude));
  assert.ok(rms > SILENCE_RMS_THRESHOLD, `expected audible, got RMS ${rms}`);
});

// The real regression case: RMS 126 with real speech must NOT be declared
// silent. We synthesize the same amplitude and assert the classification.
test("quiet phone speech (RMS ~126) is not declared silent", () => {
  const amplitude = Math.round(126 * Math.SQRT2); // RMS of a sine ≈ amplitude / √2
  const rms = computeRmsFromPcm(tonePcm(amplitude));
  assert.ok(rms > SILENCE_RMS_THRESHOLD, `quiet speech (${Math.round(rms)} RMS) must clear the threshold ${SILENCE_RMS_THRESHOLD}`);
});
