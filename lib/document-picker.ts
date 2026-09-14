import { Platform } from "react-native";

export interface DocumentPickerAsset {
  uri: string;
  name: string;
  mimeType?: string;
  size?: number;
}

export interface DocumentPickerResult {
  canceled: boolean;
  assets: DocumentPickerAsset[] | null;
}

export async function getDocumentAsync(options: {
  type?: string | string[];
  copyToCacheDirectory?: boolean;
  multiple?: boolean;
}): Promise<DocumentPickerResult> {
  if (Platform.OS === "web") {
    return new Promise((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      if (options.multiple) input.multiple = true;
      if (options.type) {
        const types = Array.isArray(options.type) ? options.type.join(",") : options.type;
        input.accept = types;
      }
      input.onchange = (e: any) => {
        const fileList: FileList | null = e.target.files;
        if (!fileList || fileList.length === 0) {
          resolve({ canceled: true, assets: null });
          return;
        }
        resolve({
          canceled: false,
          assets: Array.from(fileList).map((file) => ({
            uri: URL.createObjectURL(file),
            name: file.name,
            mimeType: file.type,
            size: file.size,
          })),
        });
      };
      input.oncancel = () => {
        resolve({ canceled: true, assets: null });
      };
      input.click();
    });
  }

  let DocumentPicker: any;
  try {
    DocumentPicker = require("@react-native-documents/picker");
    const types = Array.isArray(options.type) ? options.type : [options.type || "*/*"];
    const results = await DocumentPicker.pick({
      type: types,
      allowMultiSelection: options.multiple ?? false,
      mode: "import",
    });
    if (results && results.length > 0) {
      let localUris = new Map<string, string>();
      if (options.copyToCacheDirectory) {
        const copies = await DocumentPicker.keepLocalCopy({
          files: results.map((result: any) => ({
            uri: result.uri,
            fileName: result.name || "document",
          })),
          destination: "cachesDirectory",
        });
        localUris = new Map(
          copies
            .filter((copy: any) => copy.status === "success")
            .map((copy: any) => [copy.sourceUri, copy.localUri]),
        );
      }
      return {
        canceled: false,
        assets: results.map((r: any) => ({
          uri: localUris.get(r.uri) || r.uri,
          name: r.name || "document",
          mimeType: r.type || undefined,
          size: r.size ?? undefined,
        })),
      };
    }
    return { canceled: true, assets: null };
  } catch (err: any) {
    if (
      DocumentPicker?.isErrorWithCode(err) &&
      err.code === DocumentPicker.errorCodes.OPERATION_CANCELED
    ) {
      return { canceled: true, assets: null };
    }
    console.error("Native DocumentPicker failed:", err);
    return { canceled: true, assets: null };
  }
}
