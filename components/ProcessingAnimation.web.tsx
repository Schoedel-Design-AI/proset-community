import React from "react";
import { View } from "react-native";
import ProcessingAnimationSVG from "./ProcessingAnimationSVG.web";
import {
  type ProcessingAnimationProps,
  useReducedMotion,
} from "./processing-animation-shared";

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
      <ProcessingAnimationSVG kind={kind} reducedMotion={reducedMotion} size={size} />
    </View>
  );
}
