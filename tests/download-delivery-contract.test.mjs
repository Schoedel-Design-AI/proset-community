/**
 * Contract test for ticket #327 / issues #190, #201.
 *
 * Generation 1 (#190): downloads were written into app-private storage and
 * handed to a share sheet whose FileProvider could not expose that path, so a
 * tap produced no file and no error.
 * Generation 2 (#201): the first fix still slid a failed Downloads write into a
 * share sheet, so the outcome of a tap was unpredictable.
 *
 * These assertions lock in the fixed shape:
 *
 * 1. No download path writes to `FileSystem.documentDirectory`.
 * 2. Native share failures propagate instead of being swallowed.
 * 3. Android saves land in the shared Downloads collection.
 * 4. A failed save NEVER silently becomes a share — the user is offered
 *    "Choose location…" / "Share file".
 * 5. Every save reports its real outcome (including cancellation) and shows a
 *    busy state while it runs.
 * 6. The Community Edition override carries the same behavior.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => readFileSync(path.join(repoRoot, relativePath), "utf8");

const recordingScreen = read("app/recording/[id].tsx");
const filesScreen = read("app/files.tsx");
const downloads = read("lib/downloads.ts");
const sharing = read("lib/sharing.ts");
const fileSystem = read("lib/file-system.ts");
const documentSave = read("lib/document-save.ts");
const downloadHook = read("lib/use-file-download.ts");
const i18n = read("lib/i18n.tsx");
const ceOverride = read("scripts/ce-export/overrides/app/recording/[id].tsx");

test("no screen writes downloads into the app-private documents directory", () => {
  for (const [name, source] of [
    ["app/recording/[id].tsx", recordingScreen],
    ["app/files.tsx", filesScreen],
    ["ce override", ceOverride],
  ]) {
    assert.equal(
      source.includes("FileSystem.documentDirectory"),
      false,
      `${name} must not stage downloads in the private documents dir`,
    );
  }
});

test("download handlers route through the shared download hook", () => {
  for (const handler of [
    "handleExportWithFormat",
    "handleDownloadTranscript",
    "handleDownloadRecording",
    "handleDownloadDeck",
    "handleDownloadIcs",
  ]) {
    const start = recordingScreen.indexOf(`const ${handler} = async`);
    assert.ok(start > -1, `${handler} should exist`);
    const body = recordingScreen.slice(start, start + 3000);
    assert.ok(body.includes("saveFile("), `${handler} must save through the shared hook`);
  }
  assert.ok(filesScreen.includes("saveFile("), "files screen must save through the shared hook");
  assert.ok(
    recordingScreen.includes("useFileDownload(") && filesScreen.includes("useFileDownload("),
    "both screens must use the shared hook, not their own save logic",
  );
});

test("Downloads failures never silently open sharing", () => {
  assert.ok(downloads.includes("copyToDownloadsAsync"), "Android must target MediaStore Downloads");
  assert.equal(
    downloads.includes("falling back to share sheet"),
    false,
    "the silent share fallback must be gone (issue #201)",
  );
  assert.ok(downloads.includes("DownloadFailedError"), "failures must be typed so the UI can offer choices");
  assert.ok(
    downloadHook.includes("detail.chooseLocation") && downloadHook.includes("detail.shareFile"),
    "the failure dialog must offer both recovery actions",
  );
});

test("destination picking uses the installed document picker", () => {
  assert.ok(documentSave.includes("saveDocuments("), "Save As must use @react-native-documents/picker");
  assert.ok(documentSave.includes("OPERATION_CANCELED"), "cancellation must be recognised");
  assert.ok(documentSave.includes("copy: true"), "the source file must be copied, not moved");
  assert.ok(downloads.includes('delivery === "picker"'), "saveToDevice must honour the picker delivery");
});

test("a cancelled picker is neutral: no error and no success claim", () => {
  assert.ok(downloads.includes('delivery: "cancelled"'), "cancellation must be a real outcome");
  assert.ok(
    downloadHook.includes('result.delivery === "cancelled"') && downloadHook.includes("return"),
    "the hook must return early on cancellation",
  );
});

test("every save reports its real outcome and guards duplicate taps", () => {
  assert.ok(
    downloadHook.includes("downloadOutcomeMessageKey"),
    "the confirmation text must come from the outcome, not a fixed string",
  );
  assert.ok(downloadHook.includes("inFlight"), "duplicate taps must be blocked while a save runs");
  assert.ok(
    recordingScreen.includes("savingFileId") && recordingScreen.includes("ActivityIndicator"),
    "the active control must show a busy state",
  );
  assert.ok(
    recordingScreen.includes('accessibilityState={{ busy: savingFileId === "transcript" }}'),
    "screen readers must be told the control is busy",
  );
});

test("native share failures are not swallowed", () => {
  assert.ok(sharing.includes("throw err instanceof Error"), "shareAsync must rethrow real failures");
  assert.ok(
    sharing.includes('message.includes("User did not share")'),
    "a cancelled share sheet must stay silent",
  );
});

test("Android downloads are copied into the shared Downloads collection", () => {
  assert.ok(
    fileSystem.includes("cpExternal(") && fileSystem.includes('"downloads"'),
    "file-system must expose a MediaStore Downloads copy",
  );
});

test("saveToDevice stages native temp files in the cache dir and cleans them up", () => {
  assert.ok(downloads.includes("FileSystem.cacheDirectory"), "temp files belong in the cache dir");
  assert.ok(downloads.includes("finally"), "cleanup must run on every path");
  assert.ok(downloads.includes("FileSystem.deleteAsync(sourceUri)"), "temp files must be removed");
});

test("web keeps browser download delivery", () => {
  assert.ok(downloads.includes("triggerWebDownload(blob, fileName)"), "web must hand off to the browser");
  assert.ok(recordingScreen.includes("triggerWebDownload("), "web share fallback still downloads");
});

test("every new download string ships in English and Spanish", () => {
  for (const key of [
    "detail.fileSavedGeneric",
    "detail.saveFailedTitle",
    "detail.chooseLocation",
    "detail.shareFile",
    "detail.preparingDownload",
  ]) {
    const occurrences = i18n.split(`"${key}"`).length - 1;
    assert.equal(occurrences, 2, `${key} must appear once in EN and once in ES (saw ${occurrences})`);
  }
});

test("the Community Edition override carries the same download fix", () => {
  assert.ok(ceOverride.includes("useFileDownload("), "CE override must use the shared hook");
  assert.ok(ceOverride.includes("savingFileId"), "CE override needs the busy state too");
  assert.equal(
    ceOverride.includes("saveToDevice("),
    false,
    "CE override must not call the low-level API directly",
  );
  const ceSaves = ceOverride.match(/await saveFile\(/g) ?? [];
  assert.ok(ceSaves.length >= 5, `CE override should route every download through the hook, saw ${ceSaves.length}`);
});
