/**
 * Medium-sensitivity voice metering.
 *
 * - Below -55 dB is treated as room noise/silence.
 * - Typical conversational speech (-35 dB to -20 dB) occupies the useful
 *   middle-to-upper portion of the visualizer.
 * - -12 dB and above reaches full scale without requiring clipping.
 */
export const METERING_DB_FLOOR = -55;
export const METERING_DB_CEILING = -12;
export const METERING_RESPONSE_GAMMA = 0.85;
export const VISUALIZER_RESPONSE_EXPONENT = 1.35;

export function normalizeMeteringDb(db: number): number {
  if (!Number.isFinite(db) || db >= 0) return 0;

  const clamped = Math.max(
    METERING_DB_FLOOR,
    Math.min(METERING_DB_CEILING, db),
  );
  const linear =
    (clamped - METERING_DB_FLOOR) /
    (METERING_DB_CEILING - METERING_DB_FLOOR);

  return Math.pow(linear, METERING_RESPONSE_GAMMA);
}

export function scaleVisualizerLevel(normalized: number): number {
  const clamped = Math.max(0, Math.min(1, normalized));
  return Math.pow(clamped, VISUALIZER_RESPONSE_EXPONENT);
}
