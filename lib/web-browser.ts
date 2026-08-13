import { Platform, Linking as RNLinking } from "react-native";

export const WebBrowser = {
  maybeCompleteAuthSession: () => {},
  openBrowserAsync: async (url: string) => {
    if (Platform.OS === "web") {
      window.open(url, "_blank");
    } else {
      await RNLinking.openURL(url);
    }
    return { type: "opened" };
  },
  openAuthSessionAsync: async (url: string, returnUrl?: string) => {
    if (Platform.OS === "web") {
      window.open(url, "_blank");
    } else {
      await RNLinking.openURL(url);
    }
    return { type: "success", url };
  },
};
