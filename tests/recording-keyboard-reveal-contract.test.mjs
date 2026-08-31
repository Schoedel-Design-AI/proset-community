// Contract: the recording screen's custom-text field reveals itself above the
// on-screen keyboard (issue #198), and the CE override stays wired identically.
//
// The fix is invisible on web (the keyboard listeners never fire, so every
// helper is a no-op) and only observable on Android 15+, where edge-to-edge
// stops `adjustResize` from shrinking the window. A source-level contract is
// therefore the only reliable regression guard short of a device run.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const main = readFileSync(path.join(repoRoot, "app/recording/[id].tsx"), "utf8");
const ce = readFileSync(
  path.join(repoRoot, "scripts/ce-export/overrides/app/recording/[id].tsx"),
  "utf8",
);
const keyboardReveal = readFileSync(path.join(repoRoot, "lib/keyboard-reveal.ts"), "utf8");

test("the detail ScrollView tracks its offset and persists taps for keyboard use", () => {
  const block = main.match(/<ScrollView\s+style=\{styles\.scrollView\}[\s\S]*?showsVerticalScrollIndicator=\{false\}/);
  assert.ok(block, "expected the detail ScrollView");
  assert.match(block[0], /ref=\{detailScrollRef\}/);
  assert.match(block[0], /onScroll=\{\(event\) => \{ detailScrollOffsetRef\.current = event\.nativeEvent\.contentOffset\.y; \}\}/);
  assert.match(block[0], /keyboardShouldPersistTaps="handled"/);
  assert.match(block[0], /keyboardScrollPadding\(/);
});

test("the custom-text input reveals itself on focus and clears the flag on blur", () => {
  const input = main.match(/<TextInput\s+style=\{\[styles\.customTextInput\]\}[\s\S]*?maxLength=\{MAX_CUSTOM_TEXT\}/);
  assert.ok(input, "expected the custom-text TextInput");
  assert.match(input[0], /onFocus=\{\(\) => \{\s*customTextFocusedRef\.current = true;\s*revealFieldAboveKeyboard\(\{/);
  assert.match(input[0], /onBlur=\{\(\) => \{ customTextFocusedRef\.current = false; \}\}/);
});

test("the custom-text card carries the ref the reveal measures", () => {
  assert.match(main, /<View style=\{styles\.customTextCard\} ref=\{customTextCardRef\}>/);
});

test("the keyboard listeners are registered and cleaned up", () => {
  assert.match(main, /Keyboard\.addListener\(\s*Platform\.OS === "ios" \? "keyboardWillShow" : "keyboardDidShow"/);
  assert.match(main, /showSub\.remove\(\);\s*hideSub\.remove\(\);/);
});

test("the CE override keeps the same wiring", () => {
  // The CE exports its own copy of this screen; drift here means the Community
  // Edition silently loses the fix.
  assert.match(ce, /ref=\{detailScrollRef\}/);
  assert.match(ce, /keyboardShouldPersistTaps="handled"/);
  assert.match(ce, /keyboardScrollPadding\(/);
  assert.match(ce, /<View style=\{styles\.customTextCard\} ref=\{customTextCardRef\}>/);
  assert.match(ce, /onFocus=\{\(\) => \{\s*customTextFocusedRef\.current = true;\s*revealFieldAboveKeyboard\(\{/);
  assert.match(ce, /function revealFieldAboveKeyboard\(\{/);
});

test("the reveal math is delegated to the pure keyboard-reveal module", () => {
  assert.match(main, /keyboardRevealOffset\(\{[\s\S]*?fieldBottom: y \+ height/);
  assert.match(main, /keyboardTop: keyboardTopEdge\(windowHeight, keyboardHeight\)/);
  // The pure helpers are what the unit tests cover; the screen only measures.
  assert.match(keyboardReveal, /export function keyboardRevealOffset/);
  assert.match(keyboardReveal, /export function keyboardScrollPadding/);
  assert.match(keyboardReveal, /export function keyboardTopEdge/);
});
