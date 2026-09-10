import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_REVEAL_MARGIN,
  keyboardRevealOffset,
  keyboardScrollPadding,
  keyboardTopEdge,
} from "../../lib/keyboard-reveal";

test("a field hidden behind the keyboard scrolls up by exactly the overlap (#198)", () => {
  // Pixel-ish window: 2400 tall, keyboard 1000 tall → keyboard top at 1400.
  // Field bottom at 1500 is 100 below the keyboard top, +12 margin.
  const next = keyboardRevealOffset({
    fieldBottom: 1500,
    keyboardTop: 1400,
    currentOffset: 300,
  });
  assert.equal(next, 300 + 100 + DEFAULT_REVEAL_MARGIN);
});

test("a field already above the keyboard does not scroll", () => {
  // Never yank the view while the user is typing in a visible field.
  assert.equal(
    keyboardRevealOffset({ fieldBottom: 900, keyboardTop: 1400, currentOffset: 300 }),
    null,
  );
});

test("a field exactly at the margin boundary does not scroll", () => {
  assert.equal(
    keyboardRevealOffset({ fieldBottom: 1400 - DEFAULT_REVEAL_MARGIN, keyboardTop: 1400, currentOffset: 0 }),
    null,
  );
});

test("the offset never goes negative", () => {
  const next = keyboardRevealOffset({
    fieldBottom: 1500,
    keyboardTop: 1400,
    currentOffset: 0,
    margin: 0,
  });
  assert.equal(next, 100);
  assert.ok(next >= 0);
});

test("non-finite measurements are ignored rather than scrolling to NaN", () => {
  for (const bad of [NaN, Infinity, -Infinity]) {
    assert.equal(keyboardRevealOffset({ fieldBottom: bad, keyboardTop: 1400, currentOffset: 0 }), null);
    assert.equal(keyboardRevealOffset({ fieldBottom: 1500, keyboardTop: bad, currentOffset: 0 }), null);
    assert.equal(keyboardRevealOffset({ fieldBottom: 1500, keyboardTop: 1400, currentOffset: bad }), null);
  }
});

test("keyboardTopEdge falls back to the window bottom when no keyboard is up", () => {
  assert.equal(keyboardTopEdge(2400, 0), 2400, "no keyboard means nothing can overlap");
  assert.equal(keyboardTopEdge(2400, 1000), 1400);
  assert.equal(keyboardTopEdge(2400, -5), 2400, "a nonsense height is treated as no keyboard");
});

test("scroll padding grows by the keyboard height and is untouched without it", () => {
  assert.equal(keyboardScrollPadding(24, 0), 24);
  assert.equal(keyboardScrollPadding(24, 1000), 1024);
});

test("web behaviour: a zero keyboard height is a complete no-op", () => {
  // On web the keyboard listeners never fire, so every helper must be inert.
  const windowHeight = 900;
  const keyboardTop = keyboardTopEdge(windowHeight, 0);
  assert.equal(
    keyboardRevealOffset({ fieldBottom: 880, keyboardTop, currentOffset: 120 }),
    null,
  );
  assert.equal(keyboardScrollPadding(34, 0), 34);
});
