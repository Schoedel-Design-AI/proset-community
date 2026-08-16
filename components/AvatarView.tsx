import React, { useEffect, useMemo, useRef } from "react";
import {
  Animated,
  Image,
  Platform,
  StyleSheet,
  View,
  type AccessibilityRole,
} from "react-native";
import { SvgXml } from "react-native-svg";
import { getAvatarDataUri, getAvatarSvg, getPackKeyFromAvatarId } from "@/lib/avatars";
import { useReducedMotion } from "@/lib/useReducedMotion";
import { isProAnimatedAvatarId } from "@shared/avatar-catalog";
import {
  splitAnimatedAvatarSvg,
  animatedLayerStyle,
  startAvatarLayerLoop,
  type AvatarLayer,
} from "@/lib/avatar-animation";

type AvatarViewProps = {
  avatarId: string;
  size: number;
  animate?: boolean;
  accessibilityLabel?: string;
  testID?: string;
};

const IMAGE_ROLE: AccessibilityRole = "image";

export default function AvatarView({
  avatarId,
  size,
  animate = true,
  accessibilityLabel = "Avatar",
  testID,
}: AvatarViewProps) {
  const reduceMotion = useReducedMotion();
  const animated = animate && isProAnimatedAvatarId(avatarId);
  const allowAnimation = animated && !reduceMotion;

  // Web: load the animated SVG as an <Image> so the BROWSER runs DiceBear's
  // embedded CSS keyframes (blink, breathe). This is the only place CSS runs.
  const webAnimatedSvg = getAvatarSvg(avatarId, { animate: allowAnimation });
  const dataUri = getAvatarDataUri(avatarId, { animate: allowAnimation });

  // Native: react-native-svg cannot execute the SVG's CSS, so DiceBear's
  // keyframes never fire. We split the animated SVG into a static base +
  // per-element overlays (lib/avatar-animation-core) and drive each overlay's
  // motion with a plain Animated.View — the figure animates internally while
  // the overall avatar stays put.
  const nativeAnimatedSvg = useMemo(
    () => (Platform.OS === "web" ? null : getAvatarSvg(avatarId, { animate: true })),
    [avatarId],
  );
  const split = useMemo(
    () => (nativeAnimatedSvg ? splitAnimatedAvatarSvg(nativeAnimatedSvg) : null),
    [nativeAnimatedSvg],
  );

  // One looping progress value per animation CLASS (layers sharing a class
  // — e.g. critters' three eye elements — animate in lockstep).
  const progressRef = useRef<Map<string, Animated.Value>>(new Map());
  const stopFnsRef = useRef<(() => void)[]>([]);

  useEffect(() => {
    if (Platform.OS === "web" || !split || !allowAnimation) return;
    const progressMap = new Map<string, Animated.Value>();
    const stops: (() => void)[] = [];
    for (const layer of split.layers) {
      if (!progressMap.has(layer.className)) {
        const { progress, stop } = startAvatarLayerLoop(layer.spec);
        progressMap.set(layer.className, progress);
        stops.push(stop);
      }
    }
    progressRef.current = progressMap;
    stopFnsRef.current = stops;
    return () => {
      for (const stop of stops) stop();
      progressRef.current = new Map();
      stopFnsRef.current = [];
    };
  }, [split, allowAnimation]);

  if (!webAnimatedSvg) return null;

  // Browsers execute DiceBear's CSS keyframes when the SVG is loaded as an
  // image. SvgXml deliberately parses SVG elements and cannot run that CSS.
  if (Platform.OS === "web" && animated && dataUri) {
    return (
      <Image
        source={{ uri: dataUri }}
        style={{ width: size, height: size }}
        resizeMode="contain"
        accessibilityRole={IMAGE_ROLE}
        accessibilityLabel={accessibilityLabel}
        testID={testID}
      />
    );
  }

  const baseXml = split ? split.baseXml : webAnimatedSvg;

  // Native animated path: static base + per-element Animated.View overlays.
  if (Platform.OS !== "web" && split && allowAnimation) {
    const overlays = split.layers.map((layer: AvatarLayer, i: number) => {
      const progress = progressRef.current.get(layer.className);
      if (!progress) return null;
      return (
        <Animated.View
          key={`${layer.className}-${i}`}
          style={[
            StyleSheet.absoluteFill,
            animatedLayerStyle(layer.spec, progress, size, layer.originX, layer.originY),
          ] as any}
          pointerEvents="none"
        >
          <SvgXml xml={layer.xml} width={size} height={size} />
        </Animated.View>
      );
    });

    return (
      <View
        style={{ width: size, height: size }}
        accessibilityRole={IMAGE_ROLE}
        accessibilityLabel={accessibilityLabel}
        testID={testID}
      >
        <SvgXml xml={baseXml} width={size} height={size} />
        {overlays}
      </View>
    );
  }

  // Static (non-animated pack, reduced motion, or failed split): plain render.
  return (
    <View
      style={{ width: size, height: size }}
      accessibilityRole={IMAGE_ROLE}
      accessibilityLabel={accessibilityLabel}
      testID={testID}
    >
      <SvgXml xml={baseXml} width={size} height={size} />
    </View>
  );
}
