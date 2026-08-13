import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const recordScreen = readFileSync(
  new URL("../app/record.tsx", import.meta.url),
  "utf8",
);
const i18n = readFileSync(
  new URL("../lib/i18n.tsx", import.meta.url),
  "utf8",
);
const spanishTranslations = i18n.slice(i18n.indexOf("  es: {"));

test("recording actions and discard dialog use localization keys", () => {
  assert.match(recordScreen, /accessibilityLabel=\{t\("record\.discard"\)\}/);
  assert.match(recordScreen, /\{t\("record\.discard"\)\}<\/Text>/);
  assert.match(recordScreen, /accessibilityLabel=\{t\("common\.done"\)\}/);
  assert.match(recordScreen, /\{t\("common\.done"\)\}<\/Text>/);
  assert.match(recordScreen, /t\("record\.discardTitle"\)/);
  assert.match(recordScreen, /t\("record\.discardLeaveMessage"\)/);
  assert.match(recordScreen, /t\("record\.discardConfirmMessage"\)/);

  assert.doesNotMatch(recordScreen, />Discard<\/Text>/);
  assert.doesNotMatch(recordScreen, />Done<\/Text>/);
  assert.doesNotMatch(recordScreen, /accessibilityLabel="(?:Discard|Done)"/);
});

test("Spanish recording actions have complete translations", () => {
  assert.match(spanishTranslations, /"common\.done": "Listo"/);
  assert.match(spanishTranslations, /"record\.discard": "Descartar"/);
  assert.match(
    spanishTranslations,
    /"record\.discardTitle": "¿Descartar la grabación\?"/,
  );
  assert.match(
    spanishTranslations,
    /"record\.discardLeaveMessage": "Si sales ahora, se detendrá y descartará la grabación actual\."/,
  );
  assert.match(
    spanishTranslations,
    /"record\.discardConfirmMessage": "¿Seguro que quieres descartar esta grabación\?"/,
  );
  assert.match(spanishTranslations, /"record\.stay": "Quedarme"/);
});
