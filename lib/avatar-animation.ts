import { Animated, Easing } from "react-native";

/**
 * Native internal-avatar animation (2026-08-15).
 *
 * DiceBear animated packs embed CSS keyframes (blink / stretch / lift / sway /
 * bob) inside the SVG's <style> block. Browsers execute that CSS on the web
 * <Image> path. React Native cannot run SVG CSS (react-native-svg's SvgXml
 * parses elements only; its SvgCss middleware applies static style rules but
 * has NO keyframe support; the Animated namespace was removed in v15), so we
 * drive the same motions with plain RN Animated.
 *
 * Design (chosen for robustness over cleverness):
 *   - String-split the animated SVG into layers (lib/avatar-animation-core.ts,
 *     pure + unit-tested): a STATIC BASE (the full SVG with the <style> block
 *     and the classed elements removed) plus one OVERLAY per animated element
 *     (the element + a copy of <defs>, so <use href> references resolve).
 *   - Each overlay renders through the same SvgXml already used everywhere,
 *     wrapped in a plain Animated.View. Transforms/opacity are driven by the
 *     exact DiceBear keyframe timings.
 *   - No react-native-svg internals are touched (no parse middleware, no
 *     createAnimatedComponent, no transform stringification).
 *
 * If extraction fails for any class, that layer is skipped — the avatar still
 * renders (static base) and never crashes. The reduced-motion setting disables
 * all motion (WCAG).
 */

export {
  ANIMATION_SPECS,
  getAnimationSpecForClass,
  splitAnimatedAvatarSvg,
  type AnimatedAvatarSplit,
  type AvatarAnimationSpec,
  type AvatarKeyframe,
  type AvatarLayer,
} from "./avatar-animation-core";

import type { AvatarAnimationSpec } from "./avatar-animation-core";

/** Animated style for an overlay at progress t (0..1 across one cycle). */
export function animatedLayerStyle(
  spec: AvatarAnimationSpec,
  progress: Animated.Value,
  size: number,
  originX?: number,
  originY?: number,
): { opacity?: Animated.AnimatedInterpolation<number>; transform?: { [k: string]: Animated.AnimatedInterpolation<number> }[] } {
  const { input, output } = spec.keyframes;
  const interp = (out: number[]) =>
    progress.interpolate({ inputRange: input, outputRange: out }) as unknown as Animated.AnimatedInterpolation<number>;
  switch (spec.prop) {
    case "opacity":
      return { opacity: interp(output) };
    case "translateY":
      // Spec values are PHYSICAL-PIXEL targets; convert to viewBox units
      // (the SVG is a 128-unit viewBox rendered at `size` px).
      return { transform: [{ translateY: interp(output.map((v) => v * (128 / size))) }] };
    case "rotate": {
      const rotate = progress.interpolate({ inputRange: input, outputRange: output.map((d) => `${d}deg`) }) as unknown as Animated.AnimatedInterpolation<number>;
      // Rotate around the ELEMENT's center (matches CSS fill-box origin),
      // not the view center: translate to origin -> rotate -> translate back.
      if (originX !== undefined && originY !== undefined) {
        const sx = originX * (size / 128);
        const sy = originY * (size / 128);
        return {
          transform: [
            { translateX: sx },
            { translateY: sy },
            { rotate },
            { translateX: -sx },
            { translateY: -sy },
          ] as { [k: string]: Animated.AnimatedInterpolation<number> }[],
        };
      }
      return { transform: [{ rotate }] };
    }
    default:
      return {};
  }
}

/** Start the looping progress value for a spec. Returns a stop function. */
export function startAvatarLayerLoop(spec: AvatarAnimationSpec): {
  progress: Animated.Value;
  stop: () => void;
} {
  const progress = new Animated.Value(0);
  const loop = Animated.loop(
    Animated.timing(progress, {
      toValue: 1,
      duration: Math.round(spec.duration * 1000),
      easing: Easing.linear,
      useNativeDriver: true,
    }),
  );
  loop.start();
  return { progress, stop: () => loop.stop() };
}
