import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useEffect, useState } from "react";

// Clarifying-questions mode: how aggressively the app asks a pre-conversion
// clarifying question. Default is "when_needed" (the center option).
export type ClarifyMode = "always" | "when_needed" | "never";

export const CLARIFY_MODE_STORAGE_KEY = "@barry_clarify_mode";
export const DEFAULT_CLARIFY_MODE: ClarifyMode = "when_needed";

export function isClarifyMode(value: unknown): value is ClarifyMode {
  return value === "always" || value === "when_needed" || value === "never";
}

// Device-level preference (AsyncStorage), consistent with the text-size pref.
// Used on the Preferences screen (setting) and the recording detail screen
// (conversion flow) — the two are separate screens, so a plain hook is fine.
export function useClarifyMode() {
  const [clarifyMode, setClarifyModeState] = useState<ClarifyMode>(DEFAULT_CLARIFY_MODE);

  useEffect(() => {
    let isMounted = true;
    AsyncStorage.getItem(CLARIFY_MODE_STORAGE_KEY).then((val) => {
      if (isMounted && isClarifyMode(val)) setClarifyModeState(val);
    }).catch(() => {});
    return () => {
      isMounted = false;
    };
  }, []);

  const setClarifyMode = useCallback(async (mode: ClarifyMode) => {
    setClarifyModeState(mode);
    try {
      await AsyncStorage.setItem(CLARIFY_MODE_STORAGE_KEY, mode);
    } catch {}
  }, []);

  return { clarifyMode, setClarifyMode };
}
