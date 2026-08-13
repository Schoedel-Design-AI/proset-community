import { Platform } from "react-native";
import { virtualFS } from "./file-system";

export async function isAvailableAsync(): Promise<boolean> {
  return true;
}

export async function shareAsync(fileUri: string, options: { mimeType?: string; dialogTitle?: string; UTI?: string } = {}): Promise<void> {
  if (Platform.OS === "web") {
    const file = virtualFS[fileUri];
    const fileName = fileUri.split("/").pop() || "download";

    let blob: Blob;
    if (file) {
      if (file.encoding === "base64") {
        const byteCharacters = atob(file.content);
        const byteNumbers = new Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
          byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        const byteArray = new Uint8Array(byteNumbers);
        blob = new Blob([byteArray], { type: options.mimeType || "application/octet-stream" });
      } else {
        blob = new Blob([file.content], { type: options.mimeType || "text/plain" });
      }
    } else {
      blob = new Blob([""], { type: "text/plain" });
    }

    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    return Promise.resolve();
  }

  try {
    if (!fileUri) return;
    const Share = require("react-native-share").default;
    await Share.open({
      url: fileUri,
      type: options.mimeType,
      title: options.dialogTitle,
    });
  } catch (err: any) {
    if (err && err.message && err.message.includes("User did not share")) {
      return;
    }
    console.error("Native shareAsync failed:", err);
  }
}
