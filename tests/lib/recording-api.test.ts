import assert from "node:assert/strict";
import test from "node:test";

import {
  getUploadedAudioUri,
  getTranscriptionText,
  hasTranscriptionContent,
} from "../../lib/recording-api";

test("accepts the current transcribe response shape", () => {
  const text = getTranscriptionText({ text: "Hello world" });

  assert.equal(text, "Hello world");
  assert.equal(hasTranscriptionContent({ text: "Hello world" }), true);
});

test("accepts the legacy transcript response shape", () => {
  const text = getTranscriptionText({ transcript: "Hello again" });

  assert.equal(text, "Hello again");
  assert.equal(hasTranscriptionContent({ transcript: "Hello again" }), true);
});

test("detects empty transcription payloads", () => {
  assert.equal(hasTranscriptionContent({ empty: true, text: "" }), false);
  assert.equal(hasTranscriptionContent({ text: "   " }), false);
});

test("accepts both audioUri and legacy audioUrl upload payloads", () => {
  assert.equal(getUploadedAudioUri({ audioUri: "bucket://audio/test.webm" }), "bucket://audio/test.webm");
  assert.equal(getUploadedAudioUri({ audioUrl: "bucket://audio/legacy.webm" }), "bucket://audio/legacy.webm");
});