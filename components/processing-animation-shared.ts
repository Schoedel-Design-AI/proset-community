import { useEffect, useState } from "react";
import { AccessibilityInfo } from "react-native";
import type { ProcessingAnimationKind } from "./ProcessingAnimationCanvas";

export interface ProcessingAnimationProps {
  accessibilityLabel: string;
  kind: ProcessingAnimationKind;
  size?: number;
  testID?: string;
}

export function useReducedMotion(): boolean {
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (mounted) setReducedMotion(enabled);
      })
      .catch(() => {});
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", (enabled) => {
      if (mounted) setReducedMotion(enabled);
    });
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  return reducedMotion;
}
