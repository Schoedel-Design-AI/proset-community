import React from "react";
import { View, Platform, type ViewProps } from "react-native";

export interface LinearGradientProps extends ViewProps {
  colors: readonly string[];
  start?: { x: number; y: number } | null;
  end?: { x: number; y: number } | null;
  locations?: readonly number[] | null;
}

export const LinearGradient: React.FC<LinearGradientProps> = ({
  colors,
  start,
  end,
  locations,
  style,
  children,
  ...props
}) => {
  if (Platform.OS === "web") {
    const angle = getGradientAngle(start, end);
    const colorStops = colors
      .map((color, index) => {
        if (locations && locations[index] !== undefined) {
          return `${color} ${locations[index] * 100}%`;
        }
        return color;
      })
      .join(", ");

    const gradientStyle = {
      backgroundImage: `linear-gradient(${angle}deg, ${colorStops})`,
    };

    return (
      <View style={[style, gradientStyle as any]} {...props}>
        {children}
      </View>
    );
  }

  try {
    const NativeLinearGradient = require("react-native-linear-gradient").default;
    return (
      <NativeLinearGradient
        colors={colors}
        start={start || undefined}
        end={end || undefined}
        locations={locations || undefined}
        style={style}
        {...props}
      >
        {children}
      </NativeLinearGradient>
    );
  } catch {
    return (
      <View style={[style, { backgroundColor: colors[0] }]} {...props}>
        {children}
      </View>
    );
  }
};

function getGradientAngle(
  start?: { x: number; y: number } | null,
  end?: { x: number; y: number } | null
): number {
  if (!start || !end) return 180;
  const dy = end.y - start.y;
  const dx = end.x - start.x;
  let angle = (Math.atan2(dy, dx) * 180) / Math.PI;
  angle = (angle + 90) % 360;
  return angle;
}
