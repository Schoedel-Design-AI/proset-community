/**
 * Shared geometry for the record screen's floating actions and recording card.
 *
 * Every lower-corner action is positioned from one vertical centerline. The
 * record screen intentionally uses the same diameter for both actions as well,
 * so their centers and top edges align while preserving the 52px card gap.
 */
export const RECORD_CARD_EDGE_GAP = 52;
export const FLOATING_ACTION_CENTER_BOTTOM_OFFSET = 64;

export function getFloatingActionBottomOffset(actionSize: number): number {
  return FLOATING_ACTION_CENTER_BOTTOM_OFFSET - actionSize / 2;
}

/**
 * Keep this vertical budget stable so moving the timer away from the card's
 * top edge does not reduce the visualizer's flexible height on short screens.
 *
 * Previous distribution: 12px top + 12px bottom + 20px indicator gap = 44px.
 * Current distribution: 28px top + 8px bottom + 8px indicator gap = 44px.
 */
export const RECORD_CARD_CONTENT_TOP_PADDING = 28;
export const RECORD_CARD_CONTENT_BOTTOM_PADDING = 8;
export const RECORDING_INDICATOR_BOTTOM_GAP = 8;

export const FEEDBACK_ACTION_SIZE = 48;
export const COMPOSE_ACTION_SIZE = FEEDBACK_ACTION_SIZE;
export const CORNER_TEXT_ACTION_SIZE = 56;
export const RECORDING_DETAIL_ACTION_SIZE = 54;

export const FLOATING_ACTION_ROW_TOP_OFFSET =
  FLOATING_ACTION_CENTER_BOTTOM_OFFSET + FEEDBACK_ACTION_SIZE / 2;
export const FEEDBACK_ACTION_BOTTOM_OFFSET =
  getFloatingActionBottomOffset(FEEDBACK_ACTION_SIZE);
export const COMPOSE_ACTION_BOTTOM_OFFSET =
  getFloatingActionBottomOffset(COMPOSE_ACTION_SIZE);
