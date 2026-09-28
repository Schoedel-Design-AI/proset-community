/**
 * Base64 helpers shared by the download and print paths.
 *
 * `btoa` is available in Node >= 16 and in the React Native / browser runtimes this
 * app ships to (the download pipeline already relies on it on the Android path).
 * `String.fromCharCode.apply` is called on bounded 32 KiB chunks: a single call with a
 * multi-megabyte array overflows the JS argument limit and throws
 * "Maximum call stack size exceeded" — exactly the failure a 20-page inlined-image
 * document would hit.
 *
 * This module exists so pure (React-Native-free) modules can encode bytes: importing
 * it through lib/downloads.ts would drag `react-native` into the Node test runner.
 */

const CHUNK_SIZE = 0x8000; // 32768 bytes

export function bytesToBase64(bytes: Uint8Array): string {
  if (bytes.length === 0) return "";
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
    binary += String.fromCharCode.apply(
      null,
      Array.from(bytes.subarray(i, i + CHUNK_SIZE)) as unknown as number[],
    );
  }
  return btoa(binary);
}

/** Converts an arbitrary binary response into base64 for the native writer. */
export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  return bytesToBase64(new Uint8Array(buffer));
}
