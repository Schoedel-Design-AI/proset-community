import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeMeteringDb,
  scaleVisualizerLevel,
} from "../../lib/audio-metering";

test("medium metering rejects room noise and dead native meter values", () => {
  assert.equal(normalizeMeteringDb(-60), 0);
  assert.equal(normalizeMeteringDb(-55), 0);
  assert.equal(normalizeMeteringDb(0), 0);
  assert.equal(normalizeMeteringDb(1), 0);
  assert.equal(normalizeMeteringDb(Number.NaN), 0);
});

test("medium metering gives conversational speech useful visual range", () => {
  const quietSpeech = normalizeMeteringDb(-45);
  const mediumSpeech = normalizeMeteringDb(-35);
  const strongSpeech = normalizeMeteringDb(-25);

  assert.ok(quietSpeech > 0.2 && quietSpeech < 0.4);
  assert.ok(mediumSpeech > 0.45 && mediumSpeech < 0.6);
  assert.ok(strongSpeech > 0.65 && strongSpeech < 0.85);
  assert.ok(quietSpeech < mediumSpeech);
  assert.ok(mediumSpeech < strongSpeech);
  assert.equal(normalizeMeteringDb(-12), 1);
  assert.equal(normalizeMeteringDb(-3), 1);
});

test("visualizer response remains moderate rather than over-amplified", () => {
  assert.equal(scaleVisualizerLevel(0), 0);
  assert.equal(scaleVisualizerLevel(1), 1);
  assert.ok(scaleVisualizerLevel(0.5) > 0.35);
  assert.ok(scaleVisualizerLevel(0.5) < 0.45);
});
