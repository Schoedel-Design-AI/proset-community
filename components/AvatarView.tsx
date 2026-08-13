import React, { useEffect, useMemo, useRef } from "react";
import {
  Animated,
  Easing,
  Image,
  Platform,
  View,
  type AccessibilityRole,
} from "react-native";
import { SvgXml } from "react-native-svg";
import { getAvatarDataUri, getAvatarSvg, getPackKeyFromAvatarId } from "@/lib/avatars";
import { useReducedMotion } from "@/lib/useReducedMotion";
import { isProAnimatedAvatarId } from "@shared/avatar-catalog";

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
  const progress = useRef(new Animated.Value(0)).current;
  const animated = animate && isProAnimatedAvatarId(avatarId);
  const packKey = getPackKeyFromAvatarId(avatarId);
  const allowAnimation = animated && !reduceMotion;
  const svg = getAvatarSvg(avatarId, { animate: allowAnimation });
  const dataUri = getAvatarDataUri(avatarId, { animate: allowAnimation });

  useEffect(() => {
    if (Platform.OS === "web" || !animated || reduceMotion) {
      progress.stopAnimation();
      progress.setValue(0);
      return;
    }

    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(progress, {
          toValue: 1,
          duration: 2200,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(progress, {
          toValue: 0,
          duration: 2200,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();

    return () => loop.stop();
  }, [animated, progress, reduceMotion]);

  const nativeMotionStyle = useMemo(() => {
    switch (packKey) {
      case "sprouts":
        return {
          transform: [{ rotate: progress.interpolate({ inputRange: [0, 1], outputRange: ["-2.5deg", "2.5deg"] }) }],
        };
      case "critters":
        return {
          transform: [
            { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [0, -3] }) },
            { scale: progress.interpolate({ inputRange: [0, 1], outputRange: [1, 1.03] }) },
          ],
        };
      case "moods":
        return {
          transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [1, -2] }) }],
        };
      case "voxelArt":
        return {
          transform: [
            { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [0, -2] }) },
            { rotate: progress.interpolate({ inputRange: [0, 1], outputRange: ["-1deg", "1deg"] }) },
          ],
        };
      case "voxelBot":
        return {
          transform: [{ scale: progress.interpolate({ inputRange: [0, 1], outputRange: [1, 1.035] }) }],
        };
      default:
        return undefined;
    }
  }, [packKey, progress]);

  if (!svg) return null;

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

  const artwork = <SvgXml xml={svg} width={size} height={size} />;

  if (!animated || reduceMotion || !nativeMotionStyle) {
    return (
      <View
        style={{ width: size, height: size }}
        accessibilityRole={IMAGE_ROLE}
        accessibilityLabel={accessibilityLabel}
        testID={testID}
      >
        {artwork}
      </View>
    );
  }

  return (
    <Animated.View
      style={[{ width: size, height: size }, nativeMotionStyle]}
      accessibilityRole={IMAGE_ROLE}
      accessibilityLabel={accessibilityLabel}
      testID={testID}
    >
      {artwork}
    </Animated.View>
  );
}
