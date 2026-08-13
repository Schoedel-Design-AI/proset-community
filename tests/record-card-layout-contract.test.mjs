import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const recordScreen = readFileSync(
  new URL("../app/record.tsx", import.meta.url),
  "utf8",
);
const layoutConstants = readFileSync(
  new URL("../constants/record-layout.ts", import.meta.url),
  "utf8",
);
const browserContract = readFileSync(
  new URL("./e2e/recording-flow.spec.ts", import.meta.url),
  "utf8",
);

test("record card keeps one explicit 52px edge-gap source of truth", () => {
  assert.match(layoutConstants, /export const RECORD_CARD_EDGE_GAP = 52;/);
  assert.match(recordScreen, /paddingTop: RECORD_CARD_EDGE_GAP,/);
  assert.match(
    recordScreen,
    /paddingBottom:\s*insets\.bottom \+\s*FLOATING_ACTION_ROW_TOP_OFFSET \+\s*RECORD_CARD_EDGE_GAP,/,
  );
});

test("both bottom actions derive their position from the shared centerline", () => {
  assert.match(
    layoutConstants,
    /export function getFloatingActionBottomOffset\(actionSize: number\): number/,
  );
  assert.match(
    layoutConstants,
    /export const COMPOSE_ACTION_SIZE = FEEDBACK_ACTION_SIZE;/,
  );
  assert.match(
    layoutConstants,
    /FEEDBACK_ACTION_BOTTOM_OFFSET =\s*getFloatingActionBottomOffset\(FEEDBACK_ACTION_SIZE\);/,
  );
  assert.match(
    layoutConstants,
    /COMPOSE_ACTION_BOTTOM_OFFSET =\s*getFloatingActionBottomOffset\(COMPOSE_ACTION_SIZE\);/,
  );
  assert.match(
    recordScreen,
    /bottom: insets\.bottom \+ COMPOSE_ACTION_BOTTOM_OFFSET/,
  );
  assert.match(
    recordScreen,
    /<FeedbackIconButton[\s\S]*?surface="solid"[\s\S]*?\/>/,
  );
});

test("browser contract measures both 52px card boundaries", () => {
  assert.match(
    browserContract,
    /const headerGap = cardBox!\.y - \(headerBox!\.y \+ headerBox!\.height\);/,
  );
  assert.match(
    browserContract,
    /const feedbackGap = feedbackBox!\.y - \(cardBox!\.y \+ cardBox!\.height\);/,
  );
  assert.match(
    browserContract,
    /const composeGap = composeBox!\.y - \(cardBox!\.y \+ cardBox!\.height\);/,
  );
  assert.equal(
    (browserContract.match(/toBeCloseTo\(52, 0\)/g) || []).length,
    3,
  );
});
