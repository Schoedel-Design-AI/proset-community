import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * Output format for a conversion, shared by every screen that starts one.
 *
 * The preference is device-level and persisted, exactly like the clarify mode in
 * lib/clarify-mode.ts: the recording screen exposes it as the "Code block" switch
 * in its convert options, and other screens read the same key so a conversion
 * produces the same artifact wherever it was started.
 *
 * Default is plain text. A converted artifact is prose the user pastes into
 * email, Word or a document; Markdown is opt-in for the case where the output
 * should be a copyable Markdown code block (headings, lists, bold as markup).
 */
export const MARKDOWN_OUTPUT_STORAGE_KEY = "@voicenote_use_markdown";

export type ConversionOutputFormat = "markdown" | "plaintext";

export async function readConversionOutputFormat(): Promise<ConversionOutputFormat> {
  try {
    const stored = await AsyncStorage.getItem(MARKDOWN_OUTPUT_STORAGE_KEY);
    return stored === "true" ? "markdown" : "plaintext";
  } catch {
    return "plaintext";
  }
}
