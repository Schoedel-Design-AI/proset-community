import React, { useId } from "react";
import { StyleSheet, View } from "react-native";
import { Circle, Defs, RadialGradient, Stop, Svg } from "react-native-svg";

export type FloatingActionSurface = "scrolling" | "solid";

type Props = {
  buttonSize: number;
  surface: FloatingActionSurface;
};

const HALO_SPREAD = 20;

/**
 * A shared backdrop for corner actions that sit above scrolling content or
 * fields. Solid screens intentionally render no halo.
 */
export default function FloatingActionHalo({ buttonSize, surface }: Props) {
  const reactId = useId();

  if (surface === "solid") return null;

  const haloSize = buttonSize + HALO_SPREAD * 2;
  const gradientId = `floatingActionHalo${reactId.replace(/:/g, "")}`;

  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        styles.halo,
        {
          width: haloSize,
          height: haloSize,
          left: -HALO_SPREAD,
          top: -HALO_SPREAD,
        },
      ]}
      testID="floating-action-halo"
    >
      <Svg width="100%" height="100%" viewBox="0 0 100 100">
        <Defs>
          <RadialGradient id={gradientId} cx="50%" cy="50%" rx="50%" ry="50%">
            <Stop offset="0%" stopColor="#000" stopOpacity={0.46} />
            <Stop offset="52%" stopColor="#000" stopOpacity={0.4} />
            <Stop offset="76%" stopColor="#000" stopOpacity={0.22} />
            <Stop offset="100%" stopColor="#000" stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Circle cx="50" cy="50" r="50" fill={`url(#${gradientId})`} />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  halo: {
    position: "absolute",
  },
});
