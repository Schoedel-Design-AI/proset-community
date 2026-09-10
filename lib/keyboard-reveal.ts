/**
 * Keyboard reveal math for scroll views that contain a focused input.
 *
 * Why this exists (issue #198): on Android 15+ the platform enforces
 * edge-to-edge, and `android:windowSoftInputMode="adjustResize"` no longer
 * resizes the window — the IME simply draws over the content. A `TextInput`
 * sitting low in a `ScrollView` therefore ends up underneath the keyboard with
 * no way to see what is being typed. React Native gives us the keyboard height
 * (`Keyboard.addListener`) and the field's on-screen box
 * (`measureInWindow`); this module turns those into the scroll offset that
 * lifts the field clear of the keyboard.
 *
 * Kept pure so the behaviour is unit-testable without a device or a renderer.
 */

export interface KeyboardRevealInput {
  /** Bottom edge of the field in window coordinates (y + height). */
  fieldBottom: number;
  /** Top edge of the keyboard in window coordinates. */
  keyboardTop: number;
  /** The scroll view's current vertical content offset. */
  currentOffset: number;
  /** Breathing room to keep between the field and the keyboard. */
  margin?: number;
}

export const DEFAULT_REVEAL_MARGIN = 12;

/**
 * The offset to scroll to so the field clears the keyboard, or `null` when the
 * field is already fully visible (no scroll needed — never scroll for nothing,
 * it fights the user mid-typing).
 */
export function keyboardRevealOffset({
  fieldBottom,
  keyboardTop,
  currentOffset,
  margin = DEFAULT_REVEAL_MARGIN,
}: KeyboardRevealInput): number | null {
  if (!Number.isFinite(fieldBottom) || !Number.isFinite(keyboardTop) || !Number.isFinite(currentOffset)) {
    return null;
  }
  const overlap = fieldBottom + margin - keyboardTop;
  if (overlap <= 0) return null;
  return Math.max(0, currentOffset + overlap);
}

/**
 * Top edge of the keyboard. A zero height means "no keyboard" (web, hardware
 * keyboard, or dismissed), which yields the window bottom so nothing overlaps.
 */
export function keyboardTopEdge(windowHeight: number, keyboardHeight: number): number {
  if (!Number.isFinite(windowHeight)) return 0;
  if (!Number.isFinite(keyboardHeight) || keyboardHeight <= 0) return windowHeight;
  return windowHeight - keyboardHeight;
}

/**
 * Extra bottom padding a scroll view needs so its last elements can be
 * scrolled above the keyboard: the keyboard height replaces the safe-area
 * inset while the IME is up (the inset sits behind the keyboard).
 */
export function keyboardScrollPadding(basePadding: number, keyboardHeight: number): number {
  if (!Number.isFinite(keyboardHeight) || keyboardHeight <= 0) return basePadding;
  return basePadding + keyboardHeight;
}
