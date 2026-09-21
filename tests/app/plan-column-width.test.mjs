import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * The plan route used to render each card as wide as the window — measured
 * 1865px inside a 1905px laptop viewport — because the scroll content had no
 * width cap. The list is now one capped, centered column (same 720px as the
 * recordings list). These assertions guard the MECHANISM; the measured width is
 * guarded by the runtime probe described in the commit message.
 */
const source = readFileSync("app/choose-plan.tsx", "utf8");

test("the plan list is a capped, centered column", () => {
  const block = source.match(/scrollContent: \{[\s\S]*?\n    \},/);
  assert.ok(block, "scrollContent style block not found");

  // Full width up to a ceiling, then centered — a percentage width alone (or a
  // missing cap) is what let the cards stretch the whole window.
  assert.match(block[0], /width: "100%"/);
  assert.match(block[0], /maxWidth: \d+/);
  assert.match(block[0], /alignSelf: "center"/);
});

test("plan cards do not size themselves to the window", () => {
  const block = source.match(/planCard: \{[\s\S]*?\n    \},/);
  assert.ok(block, "planCard style block not found");
  assert.doesNotMatch(block[0], /[^a-zA-Z]width:/);
});
