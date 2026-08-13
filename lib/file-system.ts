import { Platform } from "react-native";

// Simple in-memory virtual file system for Web
export const virtualFS: Record<string, { content: string; encoding?: string }> = {};

export const EncodingType = {
  UTF8: "utf8",
  Base64: "base64",
};

let cacheDir = "virtual://cache/";
let docDir = "virtual://documents/";

if (Platform.OS !== "web") {
  try {
    const { Dirs } = require("react-native-file-access");
    cacheDir = "file://" + Dirs.CacheDir + "/";
    docDir = "file://" + Dirs.DocumentDir + "/";
  } catch (err) {
    console.error("Failed to initialize native directories:", err);
  }
}

export const cacheDirectory = cacheDir;
export const documentDirectory = docDir;

export async function writeAsStringAsync(
  fileUri: string,
  contents: string,
  options: { encoding?: string } = {}
): Promise<void> {
  if (Platform.OS === "web") {
    virtualFS[fileUri] = {
      content: contents,
      encoding: options.encoding || EncodingType.UTF8,
    };
    return Promise.resolve();
  }

  // Native: write using the New-Architecture file access module.
  try {
    const { FileSystem } = require("react-native-file-access");
    const cleanPath = fileUri.replace(/^file:\/\//, "");
    const encoding = options.encoding === EncodingType.Base64 ? "base64" : "utf8";
    await FileSystem.writeFile(cleanPath, contents, encoding);
  } catch (err) {
    console.error("Native writeAsStringAsync failed:", err);
    throw err;
  }
}

export async function readAsStringAsync(
  fileUri: string,
  options: { encoding?: string } = {}
): Promise<string> {
  if (Platform.OS === "web") {
    const file = virtualFS[fileUri];
    if (!file) {
      throw new Error(`File not found in virtual FS: ${fileUri}`);
    }
    return file.content;
  }

  try {
    const { FileSystem } = require("react-native-file-access");
    const cleanPath = fileUri.replace(/^file:\/\//, "");
    const encoding = options.encoding === EncodingType.Base64 ? "base64" : "utf8";
    return await FileSystem.readFile(cleanPath, encoding);
  } catch (err) {
    console.error("Native readAsStringAsync failed:", err);
    throw err;
  }
}
