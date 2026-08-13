import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("../components/FeedbackModal.tsx", import.meta.url),
  "utf8",
);

test("feedback modal keeps the form flexible but collapses the sent confirmation card", () => {
  assert.match(source, /modal:\s*\{[\s\S]*?flex:\s*1,[\s\S]*?\}/);
  assert.match(source, /modalSent:\s*\{\s*flex:\s*0,\s*\}/);
  assert.match(
    source,
    /<View style=\{\[styles\.modal, sent && styles\.modalSent, \{ maxHeight: modalMaxHeight \}\]\}>/,
  );
});

test("feedback sent confirmation card is tappable (Pressable) and dismisses on tap", () => {
  // sentContainer is rendered as a Pressable with onPress={handleClose}
  assert.match(
    source,
    /<Pressable style=\{styles\.sentContainer\} onPress=\{handleClose\} hitSlop=\{8\} accessibilityRole="button" accessibilityLabel=\{t\("common\.done"\)\}/,
  );
});

test("feedback sent state centers the card rather than anchoring to the bottom", () => {
  // keyboardSpacerSent overrides justifyContent to center
  assert.match(source, /keyboardSpacerSent:\s*\{[\s\S]*?justifyContent:\s*["']center["']/);
  // keyboardSpacer applies keyboardSpacerSent when sent is true
  assert.match(
    source,
    /styles\.keyboardSpacer, sent && styles\.keyboardSpacerSent/,
  );
});
