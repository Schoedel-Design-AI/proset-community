import React from "react";
import { ActivityIndicator, View } from "react-native";
import Colors from "@/constants/colors";
import ProcessingAnimationCanvas from "./ProcessingAnimationCanvas";
import { type ProcessingAnimationProps, useReducedMotion } from "./processing-animation-shared";

export default function ProcessingAnimation({
  accessibilityLabel,
  kind,
  size = 72,
  testID,
}: ProcessingAnimationProps) {
  const reducedMotion = useReducedMotion();

  return (
    <View
      accessible
      accessibilityLabel={accessibilityLabel}
      accessibilityLiveRegion="polite"
      accessibilityRole="progressbar"
      style={{ width: size, height: size }}
      testID={testID}
    >
      <React.Suspense fallback={<ActivityIndicator size="small" color={Colors.primary} />}>
        <ProcessingAnimationCanvas kind={kind} reducedMotion={reducedMotion} size={size} />
      </React.Suspense>
    </View>
  );
}
