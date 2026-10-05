import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The Thought Thread title field must never hide the beginning of its own value.
 *
 * Observed 2026-09-29 on Android production: a stored title of
 * "Thought Thread — Sep 28, 5:25 PM" rendered as "hought Thread — Sep 28, 5:25 PM".
 * The value was intact in Firestore (first bytes 54 68 6f = "Tho") and nothing in
 * the code sliced or transformed it. The cause is the control, not the data: a
 * SINGLE-LINE field whose text is wider than the field scrolls horizontally to
 * keep the caret visible, and Android keeps that scroll offset after the field
 * loses focus — so the first characters stay out of view with no cursor on screen.
 *
 * The fix is wrapping. A multiline field grows to its content instead of scrolling,
 * so position 0 is always visible regardless of how long the title is. Two rules
 * follow and both are asserted here:
 *   - no line cap (a cap makes the control scroll internally, which hides the TOP);
 *   - the value stays one line of DATA, so wrapping in the field cannot put a
 *     newline into a title the list card renders with numberOfLines={1}.
 */
const source = readFileSync(join(process.cwd(), "app/thought-thread/[id].tsx"), "utf8");
const fieldStart = source.indexOf("value={titleDraft}");
// Comments are stripped before matching: the explanation above legitimately names
// `numberOfLines={1}` (the list card's rule), and a grep-based invariant that reads
// comments fails on prose that merely NAMES the thing it forbids.
const field = source.slice(fieldStart, fieldStart + 1600).replace(/\/\/[^\n]*/g, "");

test("the title field is multiline so a long title wraps instead of scrolling", () => {
  assert.ok(fieldStart > -1, "the title TextInput must still be found by its value binding");
  assert.match(field, /\bmultiline\b/, "the title field must wrap");
  assert.doesNotMatch(field, /numberOfLines=/, "a line cap would hide the title's beginning vertically");
});

test("the web textarea grows to the height it reports", () => {
  // react-native-web renders multiline as a <textarea rows={numberOfLines ?? 1}>,
  // which does NOT auto-grow; it only reports its content height through
  // onContentSizeChange, so the height has to be applied by us on web.
  assert.match(field, /onContentSizeChange/, "the field must react to its content height");
  assert.match(field, /Platform\.OS === "web"/, "the measured height is a web-only concern");
  assert.match(field, /height/, "the measured height must be applied to the style");
});

test("a wrapped title is still stored as a single line of data", () => {
  assert.match(field, /replace\(\/\\n\/g/, "newlines must be stripped from the title value");
});

test("the underline treatment is unchanged", () => {
  const styles = source.slice(source.indexOf("titleInput: {"));
  assert.match(styles.slice(0, 300), /borderBottomWidth: 1/);
  assert.match(styles.slice(0, 300), /fontFamily: "Inter_700Bold"/);
});
