import { createContext, useContext } from "react";
import { Platform } from "react-native";

export type TextSizePreference = "small" | "medium" | "large";

const WEB_SCALE_FACTOR = 0.85;

export function scaleFont(size: number): number {
  if (Platform.OS === "web") {
    return Math.round(size * WEB_SCALE_FACTOR);
  }
  return size;
}

export interface TextScale {
  xs: number;
  sm: number;
  caption: number;
  body2: number;
  body: number;
  bodyLarge: number;
  subtitle: number;
  subtitle2: number;
  heading3: number;
  heading2: number;
  heading: number;
  display: number;
  timer: number;
}

function applyScale(scale: TextScale): TextScale {
  if (Platform.OS !== "web") return scale;
  return {
    xs: Math.round(scale.xs * WEB_SCALE_FACTOR),
    sm: Math.round(scale.sm * WEB_SCALE_FACTOR),
    caption: Math.round(scale.caption * WEB_SCALE_FACTOR),
    body2: Math.round(scale.body2 * WEB_SCALE_FACTOR),
    body: Math.round(scale.body * WEB_SCALE_FACTOR),
    bodyLarge: Math.round(scale.bodyLarge * WEB_SCALE_FACTOR),
    subtitle: Math.round(scale.subtitle * WEB_SCALE_FACTOR),
    subtitle2: Math.round(scale.subtitle2 * WEB_SCALE_FACTOR),
    heading3: Math.round(scale.heading3 * WEB_SCALE_FACTOR),
    heading2: Math.round(scale.heading2 * WEB_SCALE_FACTOR),
    heading: Math.round(scale.heading * WEB_SCALE_FACTOR),
    display: Math.round(scale.display * WEB_SCALE_FACTOR),
    timer: Math.round(scale.timer * WEB_SCALE_FACTOR),
  };
}

const rawScales: Record<TextSizePreference, TextScale> = {
  small: {
    xs: 14,
    sm: 15,
    caption: 16,
    body2: 17,
    body: 18,
    bodyLarge: 18,
    subtitle: 19,
    subtitle2: 20,
    heading3: 22,
    heading2: 24,
    heading: 30,
    display: 34,
    timer: 56,
  },
  medium: {
    xs: 16,
    sm: 17,
    caption: 18,
    body2: 19,
    body: 20,
    bodyLarge: 20,
    subtitle: 21,
    subtitle2: 22,
    heading3: 24,
    heading2: 26,
    heading: 32,
    display: 36,
    timer: 56,
  },
  large: {
    xs: 18,
    sm: 19,
    caption: 20,
    body2: 21,
    body: 22,
    bodyLarge: 22,
    subtitle: 23,
    subtitle2: 24,
    heading3: 26,
    heading2: 28,
    heading: 34,
    display: 38,
    timer: 60,
  },
};

const scales: Record<TextSizePreference, TextScale> = {
  small: applyScale(rawScales.small),
  medium: applyScale(rawScales.medium),
  large: applyScale(rawScales.large),
};

export function getTextScale(pref: TextSizePreference): TextScale {
  return scales[pref] || scales.medium;
}

export const TEXT_SIZE_STORAGE_KEY = "@barry_text_size_pref";

export const TextScaleContext = createContext<TextScale>(scales.medium);
export const TextSizePrefContext = createContext<{
  pref: TextSizePreference;
  setPref: (p: TextSizePreference) => void;
}>({ pref: "medium", setPref: () => {} });

export function useTextScale(): TextScale {
  return useContext(TextScaleContext);
}

export function useTextSizePref() {
  return useContext(TextSizePrefContext);
}

const SMALL_BODY_BASE = 16;

export function sf(baseSize: number, ts: TextScale): number {
  return Math.round(baseSize * ts.body / SMALL_BODY_BASE);
}
