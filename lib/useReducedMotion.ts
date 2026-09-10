import { useState, useEffect } from "react";
import { Platform, AccessibilityInfo } from "react-native";

export function useReducedMotion(): boolean {
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let isMounted = true;
    if (Platform.OS === "web") {
      if (typeof window !== "undefined" && window.matchMedia) {
        const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
        setReduceMotion(mq.matches);
        const handler = (e: MediaQueryListEvent) => {
          if (isMounted) setReduceMotion(e.matches);
        };
        mq.addEventListener("change", handler);
        return () => {
          isMounted = false;
          mq.removeEventListener("change", handler);
        };
      }
    } else {
      AccessibilityInfo.isReduceMotionEnabled()
        .then((enabled) => {
          if (isMounted) setReduceMotion(enabled);
        })
        .catch(() => {});
      const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", (enabled) => {
        if (isMounted) setReduceMotion(enabled);
      });
      return () => {
        isMounted = false;
        sub.remove();
      };
    }
  }, []);

  return reduceMotion;
}
