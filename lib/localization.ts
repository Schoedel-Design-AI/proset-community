import { NativeModules, Platform } from "react-native";

export function getLocales() {
  if (Platform.OS === "web") {
    if (typeof navigator !== "undefined") {
      const navLangs = navigator.languages || [navigator.language];
      return navLangs.map((lang) => ({
        languageCode: lang.split("-")[0],
        languageTag: lang,
      }));
    }
    return [{ languageCode: "en", languageTag: "en-US" }];
  }

  let locale = "en";
  try {
    if (Platform.OS === "ios") {
      locale =
        NativeModules.SettingsManager?.settings?.AppleLocale ||
        NativeModules.SettingsManager?.settings?.AppleLanguages?.[0] ||
        "en";
    } else {
      locale = NativeModules.I18nManager?.localeIdentifier || "en";
    }
  } catch (e) {
    console.warn("Failed to get native locale, defaulting to en", e);
  }

  const languageCode = locale.split(/[-_]/)[0] || "en";
  return [{ languageCode, languageTag: locale }];
}
