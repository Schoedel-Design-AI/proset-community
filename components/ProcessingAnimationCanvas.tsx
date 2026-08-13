import React, { useMemo } from "react";
import { Canvas, Group, Skia, Skottie, useClock } from "@shopify/react-native-skia";
import { useDerivedValue } from "react-native-reanimated";
import conversionAnimation from "@/assets/animations/conversion.json";
import transcriptionAnimation from "@/assets/animations/transcription.json";

export type ProcessingAnimationKind = "conversion" | "transcription";

export interface ProcessingAnimationCanvasProps {
  kind: ProcessingAnimationKind;
  reducedMotion: boolean;
  size: number;
}

const animationSources = {
  conversion: conversionAnimation,
  transcription: transcriptionAnimation,
} as const;

// Skia.Skottie.Make() parses the Lottie/Skottie JSON and constructs a native
// Skia animation object. That work is non-trivial (JSON.stringify + native
// parse) and previously ran on every single component mount via useMemo.
// Since the "checking for clarifications" modal and the inline "generating"
// card in the conversions tab are two separate component trees, every
// conversion paid for this cost TWICE in quick succession (once per mount),
// which is a likely contributor to the jerky, hitching feel when the
// clarify-check modal closes and the generating card mounts. Building each
// animation once per kind, for the lifetime of the app, and sharing the
// parsed object across every mount removes that redundant synchronous work
// from the hot path entirely.
const animationCache = new Map<ProcessingAnimationKind, ReturnType<typeof Skia.Skottie.Make>>();

function getCachedAnimation(kind: ProcessingAnimationKind) {
  if (!animationCache.has(kind)) {
    animationCache.set(kind, Skia.Skottie.Make(JSON.stringify(animationSources[kind])));
  }
  return animationCache.get(kind) ?? null;
}

export default function ProcessingAnimationCanvas({
  kind,
  reducedMotion,
  size,
}: ProcessingAnimationCanvasProps) {
  // Shared across every mount of every kind — never disposed on unmount,
  // since other screens may still be using the same cached animation.
  const animation = useMemo(() => getCachedAnimation(kind), [kind]);
  const clock = useClock();
  const fps = animation?.fps() ?? 60;
  const frameCount = Math.max(1, Math.round((animation?.duration() ?? 1) * fps));
  const frame = useDerivedValue(
    () => reducedMotion ? 0 : Math.floor((clock.value / 1000) * fps) % frameCount,
    [fps, frameCount, reducedMotion],
  );

  if (!animation) return null;

  const animationSize = animation.size();
  const scale = Math.min(size / animationSize.width, size / animationSize.height);
  const translateX = (size - animationSize.width * scale) / 2;
  const translateY = (size - animationSize.height * scale) / 2;

  return (
    <Canvas style={{ width: size, height: size }}>
      <Group transform={[{ translateX }, { translateY }, { scale }]}>
        <Skottie animation={animation} frame={frame} />
      </Group>
    </Canvas>
  );
}
