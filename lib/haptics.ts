import { Platform, Vibration } from "react-native";

export enum NotificationFeedbackType {
  Success = "success",
  Warning = "warning",
  Error = "error",
}

export enum ImpactFeedbackStyle {
  Light = "light",
  Medium = "medium",
  Heavy = "heavy",
}

export async function notificationAsync(type: NotificationFeedbackType): Promise<void> {
  if (Platform.OS === "web") return;
  try {
    const ReactNativeHapticFeedback = require("react-native-haptic-feedback").default;
    let nativeType = "notificationSuccess";
    if (type === NotificationFeedbackType.Warning) nativeType = "notificationWarning";
    if (type === NotificationFeedbackType.Error) nativeType = "notificationError";
    ReactNativeHapticFeedback.trigger(nativeType, {
      enableVibrateFallback: true,
      ignoreAndroidSystemSettings: false,
    });
  } catch {
    Vibration.vibrate(100);
  }
}

export async function impactAsync(style: ImpactFeedbackStyle): Promise<void> {
  if (Platform.OS === "web") return;
  try {
    const ReactNativeHapticFeedback = require("react-native-haptic-feedback").default;
    let nativeType = "impactLight";
    if (style === ImpactFeedbackStyle.Medium) nativeType = "impactMedium";
    if (style === ImpactFeedbackStyle.Heavy) nativeType = "impactHeavy";
    ReactNativeHapticFeedback.trigger(nativeType, {
      enableVibrateFallback: true,
      ignoreAndroidSystemSettings: false,
    });
  } catch {
    Vibration.vibrate(50);
  }
}

export async function selectionAsync(): Promise<void> {
  if (Platform.OS === "web") return;
  try {
    const ReactNativeHapticFeedback = require("react-native-haptic-feedback").default;
    ReactNativeHapticFeedback.trigger("selection", {
      enableVibrateFallback: true,
      ignoreAndroidSystemSettings: false,
    });
  } catch {
    Vibration.vibrate(20);
  }
}
