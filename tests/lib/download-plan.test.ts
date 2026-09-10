import assert from "node:assert/strict";
import test from "node:test";

import {
  downloadFailureActions,
  downloadOutcomeMessageKey,
  intentForFailureAction,
  isLocalFileUri,
  isShareableFileUri,
  MAX_DOWNLOAD_BASE_LENGTH,
  planDelivery,
  planDownloadDelivery,
  sanitizeDownloadName,
  shouldConfirmDownload,
  toNativePath,
} from "../../lib/download-plan";

test("sanitizeDownloadName replaces unsafe characters and keeps the extension", () => {
  assert.equal(sanitizeDownloadName("Meeting Notes / Q3", "txt"), "Meeting_Notes_Q3.txt");
  assert.equal(sanitizeDownloadName("Résumé draft", "md"), "R_sum_draft.md");
  assert.equal(sanitizeDownloadName("report:2026*final", "pdf"), "report_2026_final.pdf");
});

test("sanitizeDownloadName does not double an extension already present", () => {
  assert.equal(sanitizeDownloadName("presentation.pptx", "pptx"), "presentation.pptx");
  assert.equal(sanitizeDownloadName("presentation.PPTX", "pptx"), "presentation.pptx");
  assert.equal(sanitizeDownloadName("event.ics", "ics"), "event.ics");
});

test("sanitizeDownloadName falls back when nothing usable remains", () => {
  assert.equal(sanitizeDownloadName("", "txt"), "proset-export.txt");
  assert.equal(sanitizeDownloadName("   ", "txt"), "proset-export.txt");
  assert.equal(sanitizeDownloadName("///", "txt"), "proset-export.txt");
  assert.equal(sanitizeDownloadName("...", "txt"), "proset-export.txt");
  assert.equal(sanitizeDownloadName("", "txt", "transcript"), "transcript.txt");
});

test("sanitizeDownloadName caps the base name without leaving a trailing separator", () => {
  const long = "a".repeat(200);
  const name = sanitizeDownloadName(long, "txt");
  assert.equal(name, `${"a".repeat(MAX_DOWNLOAD_BASE_LENGTH)}.txt`);

  const longWithSeparator = `${"b".repeat(MAX_DOWNLOAD_BASE_LENGTH - 1)} tail`;
  assert.equal(sanitizeDownloadName(longWithSeparator, "txt"), `${"b".repeat(MAX_DOWNLOAD_BASE_LENGTH - 1)}.txt`);
});

test("sanitizeDownloadName preserves an existing name when no extension is requested", () => {
  assert.equal(sanitizeDownloadName("presentation.pptx"), "presentation.pptx");
});

test("planDownloadDelivery: Android saves to Downloads, iOS exports via the picker, web uses the browser", () => {
  assert.equal(planDownloadDelivery("android"), "downloads");
  // iOS has no user-browsable Downloads folder; its document export sheet is
  // the platform-correct destination.
  assert.equal(planDownloadDelivery("ios"), "picker");
  assert.equal(planDownloadDelivery("web"), "browser");
});

test("planDelivery maps every explicit intent to exactly one visible outcome", () => {
  assert.equal(planDelivery("auto", "android"), "downloads");
  assert.equal(planDelivery("auto", "ios"), "picker");
  assert.equal(planDelivery("downloads", "android"), "downloads");
  // iOS cannot write to a public Downloads collection — fall to the picker
  // rather than pretending the intent succeeded somewhere else.
  assert.equal(planDelivery("downloads", "ios"), "picker");
  assert.equal(planDelivery("choose-location", "android"), "picker");
  assert.equal(planDelivery("choose-location", "ios"), "picker");
  assert.equal(planDelivery("share", "android"), "share");
  assert.equal(planDelivery("share", "ios"), "share");
});

test("planDelivery keeps the browser in charge on web, whatever the intent", () => {
  for (const intent of ["auto", "downloads", "choose-location", "share"] as const) {
    assert.equal(planDelivery(intent, "web"), "browser");
  }
});

test("shouldConfirmDownload only claims success for outcomes the user cannot see", () => {
  assert.equal(shouldConfirmDownload("downloads"), true);
  assert.equal(shouldConfirmDownload("browser"), true);
  assert.equal(shouldConfirmDownload("picker"), true);
  // A share sheet is its own outcome and may be cancelled.
  assert.equal(shouldConfirmDownload("share"), false);
  assert.equal(shouldConfirmDownload("cancelled"), false);
});

test("outcome messages describe what actually happened", () => {
  assert.equal(downloadOutcomeMessageKey("downloads"), "detail.fileSaved");
  assert.equal(downloadOutcomeMessageKey("browser"), "detail.fileSaved");
  assert.equal(downloadOutcomeMessageKey("picker"), "detail.fileSavedGeneric");
  // Silence is correct for both: the sheet is visible, cancellation is neutral.
  assert.equal(downloadOutcomeMessageKey("share"), null);
  assert.equal(downloadOutcomeMessageKey("cancelled"), null);
});

test("a failed save offers recovery actions instead of redirecting silently", () => {
  assert.deepEqual(downloadFailureActions("android", "downloads"), ["choose-location", "share"]);
  // Never re-offer the route that just failed.
  assert.deepEqual(downloadFailureActions("android", "picker"), ["share"]);
  assert.deepEqual(downloadFailureActions("ios", "share"), ["choose-location"]);
  // The browser owns web failures; the app has nothing to offer.
  assert.deepEqual(downloadFailureActions("web", "browser"), []);
});

test("each recovery action maps back to the intent that performs it", () => {
  assert.equal(intentForFailureAction("choose-location"), "choose-location");
  assert.equal(intentForFailureAction("share"), "share");
});

test("isShareableFileUri accepts cache paths and rejects the private documents dir", () => {
  const cache = "file:///data/user/0/ms.aifor.app/cache/";
  const documents = "file:///data/user/0/ms.aifor.app/files/";
  assert.equal(isShareableFileUri(`${cache}notes.txt`, cache), true);
  // The documents dir is outside react-native-share's FileProvider roots — the
  // regression behind ticket #327 / issue #190.
  assert.equal(isShareableFileUri(`${documents}notes.txt`, cache), false);
  assert.equal(isShareableFileUri("/data/user/0/ms.aifor.app/cache/notes.txt", cache), true);
  assert.equal(isShareableFileUri("", cache), false);
  assert.equal(isShareableFileUri(`${cache}notes.txt`, ""), false);
});

test("isLocalFileUri distinguishes on-device paths from remote references", () => {
  assert.equal(isLocalFileUri("file:///data/user/0/ms.aifor.app/cache/a.m4a"), true);
  assert.equal(isLocalFileUri("/storage/emulated/0/a.m4a"), true);
  assert.equal(isLocalFileUri("bucket://recordings/a.m4a"), false);
  assert.equal(isLocalFileUri("https://proset.ai/api/files/a.m4a"), false);
  assert.equal(isLocalFileUri(""), false);
});

test("toNativePath strips the file scheme", () => {
  assert.equal(toNativePath("file:///tmp/a.txt"), "/tmp/a.txt");
  assert.equal(toNativePath("/tmp/a.txt"), "/tmp/a.txt");
});
