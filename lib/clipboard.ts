import { Platform } from "react-native";

export async function getStringAsync(): Promise<string> {
  if (Platform.OS === "web") {
    try {
      return await navigator.clipboard.readText();
    } catch {
      return "";
    }
  }

  try {
    const Clipboard = require("@react-native-clipboard/clipboard").default;
    return (await Clipboard.getString()) ?? "";
  } catch {
    try {
      const { Clipboard } = require("react-native");
      return (await Clipboard.getString()) ?? "";
    } catch {
      return "";
    }
  }
}

export async function setStringAsync(text: string): Promise<boolean> {
  if (Platform.OS === "web") {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (err) {
      console.error("Web clipboard write failed:", err);
      return false;
    }
  }

  try {
    const Clipboard = require("@react-native-clipboard/clipboard").default;
    Clipboard.setString(text);
    return true;
  } catch {
    try {
      const { Clipboard } = require("react-native");
      Clipboard.setString(text);
      return true;
    } catch (err) {
      console.error("Native clipboard write failed:", err);
      return false;
    }
  }
}
