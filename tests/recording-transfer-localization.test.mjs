import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const i18n = readFileSync(
  new URL("../lib/i18n.tsx", import.meta.url),
  "utf8",
);
const spanishTranslations = i18n.slice(i18n.indexOf("  es: {"));
const recordingScreen = readFileSync(
  new URL("../app/recording/[id].tsx", import.meta.url),
  "utf8",
);

const spanishTransferMessages = [
  ["detail.uploading", "Subiendo la grabación..."],
  ["detail.retryUpload", "Reintentar la carga"],
  ["detail.uploadAuthFailed", "Inicia sesión de nuevo"],
  ["detail.uploadFileMissing", "El audio original ya no está disponible"],
  ["detail.uploadRejected", "El servidor no pudo aceptar esta grabación"],
  ["detail.uploadRetryExhausted", "La carga no terminó después de varios intentos"],
  ["detail.uploadFailed", "No se pudo subir la grabación"],
  ["detail.transcriptionFailed", "La transcripción no terminó"],
  ["detail.reportIssue", "Reportar este problema"],
];

test("Spanish upload and transcription failures are complete and user-facing", () => {
  for (const [key, copy] of spanishTransferMessages) {
    assert.match(spanishTranslations, new RegExp(`"${key}": "${copy}`));
  }
});

test("recording detail uses localization keys instead of persisted English worker messages", () => {
  assert.match(recordingScreen, /getRecordingTransferMessageKey/);
  assert.match(recordingScreen, /t\("detail\.uploading"/);
  assert.match(recordingScreen, /t\("detail\.retryUpload"/);
  assert.match(recordingScreen, /t\("detail\.reportIssue"/);
  assert.doesNotMatch(recordingScreen, /"Authentication failed\."/);
  assert.doesNotMatch(recordingScreen, /"Upload failed\."/);
});
