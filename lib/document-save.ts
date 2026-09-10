/**
 * "Save As" adapter — the native destination picker (Storage Access Framework
 * on Android, the document export sheet on iOS).
 *
 * Ticket #327 / #190 / #201: an Android MediaStore write is invisible while it
 * happens and can fail for reasons the app cannot fix (provider refusal, quota,
 * managed-device policy). The user therefore needs a destination they choose
 * themselves, in system UI they can see. This wraps
 * `@react-native-documents/picker` `saveDocuments()` — already a dependency, so
 * no new native module.
 *
 * `createDocumentSaver()` takes the picker API as an argument so Node tests can
 * inject a fake without loading React Native.
 */

export type DocumentSaveResult =
  | { status: "saved"; fileName: string; uri: string }
  | { status: "cancelled" };

export type DocumentSaveRequest = {
  /** Local file to hand to the picker (must exist for the duration of the call). */
  fileUri: string;
  /** Pre-filled name in the system dialog. */
  fileName: string;
  mimeType: string;
};

/** The slice of the picker module this adapter uses. */
export type PickerApi = {
  saveDocuments: (options: {
    sourceUris: string[];
    mimeType?: string;
    fileName?: string;
    copy?: boolean;
  }) => Promise<Array<{ uri: string; name: string | null; error: string | null }>>;
  isErrorWithCode: (error: any) => boolean;
  errorCodes: { OPERATION_CANCELED: string };
};

/**
 * Percent-encoding matters: the picker documents `sourceUris` as
 * percent-encoded, and an unencoded space or `#` in a generated file name would
 * otherwise truncate the path.
 */
export function encodeSourceUri(fileUri: string): string {
  const withScheme = fileUri.startsWith("file://") ? fileUri : `file://${fileUri}`;
  // encodeURI leaves an already-encoded "%20" intact; re-encoding would double it.
  return /%[0-9A-Fa-f]{2}/.test(withScheme) ? withScheme : encodeURI(withScheme);
}

export function createDocumentSaver(picker: PickerApi) {
  return async function saveDocument(request: DocumentSaveRequest): Promise<DocumentSaveResult> {
    try {
      const results = await picker.saveDocuments({
        sourceUris: [encodeSourceUri(request.fileUri)],
        mimeType: request.mimeType,
        fileName: request.fileName,
        copy: true,
      });
      const first = results?.[0];
      if (!first) {
        throw new Error("Destination picker returned no result");
      }
      if (first.error) {
        // The picker reports per-file write failures in `error` rather than
        // rejecting; surfacing it keeps the UI honest.
        throw new Error(first.error);
      }
      return { status: "saved", fileName: first.name || request.fileName, uri: first.uri };
    } catch (err: any) {
      // Dismissing the system dialog is a neutral outcome, never an error.
      if (picker.isErrorWithCode(err) && err?.code === picker.errorCodes.OPERATION_CANCELED) {
        return { status: "cancelled" };
      }
      throw err;
    }
  };
}

/** Production entry point: loads the picker lazily so web bundles stay clean. */
export async function saveDocumentToLocation(
  request: DocumentSaveRequest,
): Promise<DocumentSaveResult> {
  const picker = require("@react-native-documents/picker");
  return createDocumentSaver({
    saveDocuments: picker.saveDocuments,
    isErrorWithCode: picker.isErrorWithCode,
    errorCodes: picker.errorCodes,
  })(request);
}
