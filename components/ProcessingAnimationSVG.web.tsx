import React from "react";
import { View } from "react-native";
import Svg, { Circle, Path } from "react-native-svg";
import Colors from "@/constants/colors";
import type { ProcessingAnimationCanvasProps } from "./ProcessingAnimationCanvas";

// One shared <style> injected once. CSS transform animation runs on the
// compositor thread — immune to main-thread React re-renders from streaming.
// (The previous web path used Animated with useNativeDriver, which
// react-native-web silently downgrades to the JS driver; every streamed
// chunk re-render starved the rAF loop, so the spinner visibly froze.)
const SPIN_KEYFRAMES = `
@keyframes proset-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) {
  .proset-spinner-ring { animation: none !important; }
}
`;

export default function ProcessingAnimationSVG({
  kind,
  size,
}: ProcessingAnimationCanvasProps) {
  const isConversion = kind === "conversion";
  const strokeColor = isConversion ? Colors.primary : "#8B5CF6";
  const strokeWidth = Math.max(3, Math.round(size * 0.08));
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference * 0.35;

  return (
    <View
      style={{
        width: size,
        height: size,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <style>{SPIN_KEYFRAMES}</style>
      <View
        {...({
          className: "proset-spinner-ring",
          style: {
            width: size,
            height: size,
            position: "absolute",
            // Web-only CSS animation (GPU-composited). react-native-web
            // supports `className` + `animation` in style; RN's ViewProps
            // types don't declare either, hence the spread cast.
            animation: "proset-spin 1.8s linear infinite",
          },
        } as any)}
      >
        <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke={strokeColor}
            strokeOpacity={0.2}
            strokeWidth={strokeWidth}
            fill="none"
          />
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke={strokeColor}
            strokeWidth={strokeWidth}
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            strokeLinecap="round"
            fill="none"
          />
        </Svg>
      </View>
      <Svg width={size * 0.4} height={size * 0.4} viewBox="0 0 24 24" fill="none">
        {isConversion ? (
          <Path
            d="M12 2v4m0 12v4M4.93 4.93l2.83 2.83m8.48 8.48l2.83 2.83M2 12h4m12 0h4M4.93 19.07l2.83-2.83m8.48-8.48l2.83-2.83"
            stroke={Colors.primary}
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ) : (
          <Path
            d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3zM19 10v2a7 7 0 0 1-14 0v-2M12 19v3"
            stroke="#8B5CF6"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}
      </Svg>
    </View>
  );
}
