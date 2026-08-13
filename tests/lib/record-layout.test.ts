import assert from "node:assert/strict";
import test from "node:test";

import {
  COMPOSE_ACTION_BOTTOM_OFFSET,
  COMPOSE_ACTION_SIZE,
  FEEDBACK_ACTION_BOTTOM_OFFSET,
  FEEDBACK_ACTION_SIZE,
  FLOATING_ACTION_CENTER_BOTTOM_OFFSET,
  FLOATING_ACTION_ROW_TOP_OFFSET,
  getFloatingActionBottomOffset,
  RECORD_CARD_CONTENT_BOTTOM_PADDING,
  RECORD_CARD_CONTENT_TOP_PADDING,
  RECORD_CARD_EDGE_GAP,
  RECORDING_INDICATOR_BOTTOM_GAP,
} from "../../constants/record-layout";

test("record actions share one vertical center and top-edge boundary", () => {
  assert.equal(
    COMPOSE_ACTION_BOTTOM_OFFSET + COMPOSE_ACTION_SIZE / 2,
    FLOATING_ACTION_CENTER_BOTTOM_OFFSET,
  );
  assert.equal(
    FEEDBACK_ACTION_BOTTOM_OFFSET + FEEDBACK_ACTION_SIZE / 2,
    FLOATING_ACTION_CENTER_BOTTOM_OFFSET,
  );
  assert.equal(COMPOSE_ACTION_SIZE, FEEDBACK_ACTION_SIZE);
  assert.equal(
    FEEDBACK_ACTION_BOTTOM_OFFSET + FEEDBACK_ACTION_SIZE,
    FLOATING_ACTION_ROW_TOP_OFFSET,
  );
});

test("different action diameters still resolve to the shared centerline", () => {
  for (const actionSize of [48, 54, 56]) {
    assert.equal(
      getFloatingActionBottomOffset(actionSize) + actionSize / 2,
      FLOATING_ACTION_CENTER_BOTTOM_OFFSET,
    );
  }
});

test("the recording card uses the requested 52px edge gap", () => {
  assert.equal(RECORD_CARD_EDGE_GAP, 52);
});

test("timer breathing room preserves the visualizer's vertical budget", () => {
  assert.equal(RECORD_CARD_CONTENT_TOP_PADDING, 28);
  assert.equal(
    RECORD_CARD_CONTENT_TOP_PADDING +
      RECORD_CARD_CONTENT_BOTTOM_PADDING +
      RECORDING_INDICATOR_BOTTOM_GAP,
    44,
  );
});
