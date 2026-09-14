import React, { useEffect, useMemo, useState } from "react";
import {
  Animated,
  Image,
  Platform,
  StyleSheet,
  View,
  type AccessibilityRole,
} from "react-native";
import { SvgXml } from "react-native-svg";
import { getAvatarDataUri, getAvatarSvg } from "@/lib/avatars";
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
  const staticSvg = getAvatarSvg(avatarId, { animate: false });
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
  // The viewBox width varies by pack (voxel=128, critters/sprouts/moods=100);
  // the animation scaling must use the real width, not a hardcoded 128.
  const viewBoxSize = useMemo(() => {
    if (!split) return 128;
    const w = Number(split.viewBox.split(/\s+/)[2]);
    return Number.isFinite(w) && w > 0 ? w : 128;
  }, [split]);

  // One looping progress value per animation CLASS (layers sharing a class
  // — e.g. critters' three eye elements — animate in lockstep).
  const [progressMap, setProgressMap] = useState<Map<string, Animated.Value>>(new Map());
  const [progressSplit, setProgressSplit] = useState<typeof split>(null);

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
    setProgressMap(progressMap);
    setProgressSplit(split);
    return () => {
      for (const stop of stops) stop();
      setProgressMap(new Map());
      setProgressSplit(null);
    };
  }, [split, allowAnimation]);

  if (!webAnimatedSvg || !staticSvg) return null;

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

  const layersReady =
    progressSplit === split &&
    split?.layers.every((layer) => progressMap.has(layer.className));
  const baseXml = allowAnimation && layersReady && split ? split.baseXml : staticSvg;

  // Native animated path: static base + per-element Animated.View overlays.
  if (Platform.OS !== "web" && split && allowAnimation && layersReady) {
    const overlays = split.layers.map((layer: AvatarLayer, i: number) => {
      const progress = progressMap.get(layer.className);
      if (!progress) return null;
      return (
        <Animated.View
          key={`${layer.className}-${i}`}
          style={[
            StyleSheet.absoluteFill,
            animatedLayerStyle(layer.spec, progress, size, layer.originX, layer.originY, viewBoxSize),
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
