import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (relativePath) => readFileSync(join(root, relativePath), "utf8");

const feedbackButton = read("components/FeedbackIconButton.tsx");
const recordings = read("app/recordings.tsx");
const recordingDetail = read("app/recording/[id].tsx");
const home = read("app/index.tsx");
const record = read("app/record.tsx");

test("every feedback action must declare its surface", () => {
  assert.match(feedbackButton, /surface: FloatingActionSurface/);
  assert.match(
    feedbackButton,
    /<FloatingActionHalo buttonSize=\{FEEDBACK_ACTION_SIZE\} surface=\{surface\} \/>/,
  );
  assert.match(
    feedbackButton,
    /surface === "scrolling" && styles\.btnFloating/,
  );
});

test("both corner actions use fading halos on scrolling screens", () => {
  assert.match(recordings, /surface="scrolling"/);
  assert.match(
    recordings,
    /<FloatingActionHalo[\s\S]*?buttonSize=\{CORNER_TEXT_ACTION_SIZE\}[\s\S]*?surface="scrolling"/,
  );
  assert.match(recordingDetail, /surface="scrolling"/);
  assert.match(
    recordingDetail,
    /<FloatingActionHalo[\s\S]*?buttonSize=\{RECORDING_DETAIL_ACTION_SIZE\}[\s\S]*?surface="scrolling"/,
  );
});

test("solid home and record screens render no halos", () => {
  for (const source of [home, record]) {
    assert.match(source, /surface="solid"/);
    assert.doesNotMatch(source, /surface="scrolling"/);
    assert.doesNotMatch(source, /<FloatingActionHalo/);
  }
});

test("old hard-edged backdrop implementations stay removed", () => {
  assert.doesNotMatch(feedbackButton, /bgOverlay/);
  assert.doesNotMatch(recordingDetail, /fabBackground/);
});

test("home identity stays the logo above the slide-to-record control", () => {
  assert.match(home, /testID="home-logo"/);
  assert.match(home, /testID="home-slide-track"/);
  assert.match(
    home,
    /<SlideToRecord onSlideComplete=\{\(\) => router\.push\("\/record"\)\} \/>/,
  );
});

test("right and left actions use the shared vertical centerline", () => {
  for (const source of [home, recordings, recordingDetail]) {
    assert.match(source, /getFloatingActionBottomOffset/);
  }
});
