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

/**
 * Copies a local file into the device's shared Downloads collection.
 *
 * Android only: uses MediaStore on API 29+ (and the public Downloads directory
 * below that) via react-native-file-access `cpExternal`, so the file is visible
 * in Files → Downloads instead of the app's private sandbox.
 */
export async function copyToDownloadsAsync(fileUri: string, fileName: string): Promise<void> {
  if (Platform.OS !== "android") {
    throw new Error("copyToDownloadsAsync is Android-only");
  }
  const { FileSystem } = require("react-native-file-access");
  await FileSystem.cpExternal(fileUri.replace(/^file:\/\//, ""), fileName, "downloads");
}

/** Deletes a file if present. Never throws for a missing path. */
export async function deleteAsync(fileUri: string): Promise<void> {
  if (Platform.OS === "web") {
    delete virtualFS[fileUri];
    return;
  }
  try {
    const { FileSystem } = require("react-native-file-access");
    const cleanPath = fileUri.replace(/^file:\/\//, "");
    if (await FileSystem.exists(cleanPath)) {
      await FileSystem.unlink(cleanPath);
    }
  } catch (err) {
    // Best-effort cleanup of a temp file; never surface to the caller.
  }
}

/**
 * Streams a network response straight to disk (no base64 round-trip, so large
 * audio files don't have to be held in JS memory).
 */
export async function fetchToFileAsync(
  url: string,
  fileUri: string,
  headers: Record<string, string> = {},
): Promise<void> {
  if (Platform.OS === "web") {
    throw new Error("fetchToFileAsync is native-only");
  }
  const { FileSystem } = require("react-native-file-access");
  const res = await FileSystem.fetch(url, {
    path: fileUri.replace(/^file:\/\//, ""),
    headers,
  });
  if (!res.ok) {
    throw new Error(`Download failed with status ${res.status}`);
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
