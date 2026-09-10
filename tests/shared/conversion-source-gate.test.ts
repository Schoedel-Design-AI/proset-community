import assert from "node:assert/strict";
import test from "node:test";

import {
  MIN_TEXT_ENTRY_CHARS,
  buildConversionSource,
  isConversionSourceTooShort,
} from "../../shared/conversion-source";

test("a short voice transcript is convertible without padded context (#195)", () => {
  // 12-second recording, 70-character transcript — a real case from production.
  assert.equal(
    isConversionSourceTooShort({ isTextEntry: false, sourceContentLength: 70 }),
    false,
  );
  // Two words is still the user's own speech.
  assert.equal(
    isConversionSourceTooShort({ isTextEntry: false, sourceContentLength: 9 }),
    false,
  );
});

test("an empty recording source is still refused", () => {
  assert.equal(
    isConversionSourceTooShort({ isTextEntry: false, sourceContentLength: 0 }),
    true,
  );
});

test("typed text entries keep the character floor", () => {
  assert.equal(
    isConversionSourceTooShort({ isTextEntry: true, sourceContentLength: MIN_TEXT_ENTRY_CHARS - 1 }),
    true,
  );
  assert.equal(
    isConversionSourceTooShort({ isTextEntry: true, sourceContentLength: MIN_TEXT_ENTRY_CHARS }),
    false,
  );
  assert.equal(
    isConversionSourceTooShort({ isTextEntry: true, sourceContentLength: 0 }),
    true,
  );
});

test("the floor constant stays at the documented 100 characters", () => {
  assert.equal(MIN_TEXT_ENTRY_CHARS, 100);
});

test("padding a transcript with context is no longer required to change the outcome", () => {
  // Before the fix a 70-char transcript needed 30 characters of filler; now the
  // gate answer is identical with and without that filler.
  const bare = isConversionSourceTooShort({ isTextEntry: false, sourceContentLength: 70 });
  const padded = isConversionSourceTooShort({ isTextEntry: false, sourceContentLength: 70 + 40 });
  assert.equal(bare, padded);
  // And the built source still labels both parts when context IS supplied.
  const source = buildConversionSource({ transcript: "Call the dentist tomorrow.", customText: "Ask about the crown." });
  assert.match(source, /\[VOICE TRANSCRIPT\]/);
  assert.match(source, /\[ADDITIONAL CONTEXT FROM USER\]/);
});
