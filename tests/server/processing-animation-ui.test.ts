import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const recordingScreen = readFileSync(join(root, "app/recording/[id].tsx"), "utf8");
const animationCanvas = readFileSync(join(root, "components/ProcessingAnimationCanvas.tsx"), "utf8");
const animationWeb = readFileSync(join(root, "components/ProcessingAnimation.web.tsx"), "utf8");

test("conversion processing becomes visible on the conversions tab", () => {
  const tabSwitch = recordingScreen.indexOf('setDetailTab("conversions")');
  const processingStart = recordingScreen.indexOf("setConvertingType(type)", tabSwitch);

  assert.ok(tabSwitch >= 0, "conversion should select the conversions tab");
  assert.ok(processingStart > tabSwitch, "the tab should switch before conversion processing starts");
  assert.match(recordingScreen, /testID="conversion-processing-animation"/);
  assert.match(recordingScreen, /testID="clarification-processing-animation"/);
});

test("transcription processing has visible animation states", () => {
  assert.match(recordingScreen, /testID="upload-processing-animation"/);
  assert.match(recordingScreen, /testID="transcription-processing-animation"/);
});

test("bundled Skottie assets are self-contained looping animations", () => {
  for (const name of ["transcription", "conversion"]) {
    const animation = JSON.parse(
      readFileSync(join(root, `assets/animations/${name}.json`), "utf8"),
    );
    assert.ok(animation.w > 0 && animation.h > 0);
    assert.ok(animation.fr > 0 && animation.op > animation.ip);
    assert.ok(Array.isArray(animation.layers) && animation.layers.length > 0);
    assert.deepEqual(animation.assets, []);
  }
});

test("Skottie playback supports reduced motion and shares one cached animation per kind", () => {
  assert.match(animationCanvas, /reducedMotion \? 0 :/);
  // Animations are parsed once per kind and cached for the app's lifetime
  // instead of being rebuilt (and disposed) on every mount. Two separate
  // component trees (the clarify-check modal and the inline "generating"
  // card) both render this component in quick succession during a single
  // conversion, so re-parsing the Skottie JSON on every mount was doubling
  // native parse work on the hot path and contributing to jank.
  assert.match(animationCanvas, /animationCache/);
  assert.match(animationCanvas, /getCachedAnimation/);
  assert.doesNotMatch(animationCanvas, /animation\?\.dispose\(\)/);
});

test("conversion error handling surfaces error card and retry action", () => {
  assert.match(recordingScreen, /testID="conversion-error-card"/);
  assert.match(recordingScreen, /testID="conversion-retry-button"/);
  assert.match(recordingScreen, /setConversionError/);
  assert.match(recordingScreen, /throw new Error\(event\.error\)/);
});

test("conversion stage signifiers show progress during generation", () => {
  assert.match(recordingScreen, /setConversionStage/);
  assert.match(recordingScreen, /conversionStageLabel/);
});

test("conversion result reveals in the same tick the stream completes, not after cleanup", () => {
  // Previously convertingType (and therefore the "generating" card) only
  // cleared in the outer try/finally block, which runs after the network
  // stream fully closes and after an awaited file-save POST. That gap made
  // the in-progress UI linger after the result was already known, then
  // disappear and hand off to the result modal at a moment uncorrelated
  // with real progress — reading as a stall or a failure. The done-event
  // handler must itself clear the in-progress state and reveal the result,
  // and the redundant file-save POST must not block that handoff.
  const doneEventIndex = recordingScreen.indexOf("if (event.done) {");
  assert.ok(doneEventIndex >= 0, "the stream completion handler must exist");
  const handlerSlice = recordingScreen.slice(doneEventIndex, doneEventIndex + 2200);
  assert.match(
    handlerSlice,
    /setConvertingType\(null\)/,
    "the done handler must clear convertingType itself instead of deferring to finally",
  );
  const setConvertingNullIndex = handlerSlice.indexOf("setConvertingType(null)");
  const setSelectedConversionIndex = handlerSlice.indexOf("setSelectedConversion(conversion)");
  assert.ok(
    setSelectedConversionIndex > setConvertingNullIndex,
    "the in-progress state must clear before (or together with) revealing the result",
  );
  assert.doesNotMatch(
    handlerSlice.slice(0, setSelectedConversionIndex),
    /await authFetch\(new URL\("\/api\/files"/,
    "the Files-tab save POST must not be awaited before the result is revealed",
  );
});

test("web processing animation uses lightweight SVG renderer without WASM bloat", () => {
  assert.doesNotMatch(animationWeb, /WithSkiaWeb/);
  assert.doesNotMatch(animationWeb, /canvaskit/);
  assert.match(animationWeb, /ProcessingAnimationSVG/);
});

test("conversion stage progress copy is registered in i18n, not left as raw dead-fallback keys", () => {
  // These stage labels used to be requested via t("...") as any with a
  // string-literal `|| "fallback"`, but the keys were never added to the
  // translation dictionaries. Since t() falls back to returning the raw key
  // string (a truthy value) when a key is missing, the `||` fallback never
  // fired and users saw literal strings like "detail.preparingTranscript"
  // during every single conversion.
  const i18n = readFileSync(join(root, "lib/i18n.tsx"), "utf8");
  const keys = [
    "detail.preparingTranscript",
    "detail.analyzingTranscript",
    "detail.structuringArtifact",
    "detail.receivingResponse",
    "detail.generatingContent",
  ];
  for (const key of keys) {
    const occurrences = i18n.split(`"${key}"`).length - 1;
    assert.ok(occurrences >= 2, `${key} must be defined in both the en and es dictionaries`);
  }
  assert.doesNotMatch(
    recordingScreen,
    /t\("detail\.(preparingTranscript|analyzingTranscript|structuringArtifact|receivingResponse|generatingContent)" as any\)/,
    "conversion stage copy must use registered TranslationKey lookups, not untyped fallback strings",
  );
});

