/**
 * Long-document asset handling.
 *
 * A remote image inside a 20-page document is a race the print engine loses: it paginates
 * before the fetch resolves and emits empty boxes. Converting external images to `data:`
 * URIs before generation removes the race completely.
 *
 * Three safety valves, because "inline everything" is how a print job becomes a 60 MB
 * string and an out-of-memory crash on a mid-range phone:
 *   1. maxBytesPerImage — anything larger keeps its URL (and may simply not render)
 *   2. maxTotalBytes    — a document-wide budget; once spent, remaining images keep URLs
 *   3. concurrency      — bounded parallel fetches; a serial loop would take minutes
 *
 * Purity: the network and the encoder are injected (`InlineImageDeps`), so this module is
 * fully testable in Node without a browser, a device, or a network.
 */

import { bytesToBase64 } from "../base64";
import { PrintTimeoutError, withTimeout } from "./print-async";

export type InlineSkipReason = "too-large" | "budget-exceeded" | "fetch-failed" | "timeout" | "empty";

export type InlineImageDeps = {
  fetchBytes: (url: string) => Promise<{ bytes: Uint8Array; contentType: string | null }>;
  warn?: (message: string, detail?: unknown) => void;
};

export type InlineImageOptions = {
  maxBytesPerImage: number;
  maxTotalBytes: number;
  timeoutMs: number;
  concurrency: number;
};

export type InlineImageSummary = {
  html: string;
  inlined: number;
  skipped: Array<{ url: string; reason: InlineSkipReason }>;
  inlinedBytes: number;
};

const IMG_SRC_PATTERN = /<img\b[^>]*?\bsrc\s*=\s*("([^"]*)"|'([^']*)')/gi;

/** External, fetchable image sources in document order, deduplicated. */
export function extractImageUrls(html: string): string[] {
  const found: string[] = [];
  for (const match of html.matchAll(IMG_SRC_PATTERN)) {
    const url = (match[2] ?? match[3] ?? "").trim();
    if (!/^https?:\/\//i.test(url)) continue;
    if (!found.includes(url)) found.push(url);
  }
  return found;
}

/** Magic-byte sniffing: servers return wrong or missing Content-Types surprisingly often. */
export function sniffImageContentType(bytes: Uint8Array): string | null {
  const has = (...prefix: number[]) => prefix.every((byte, index) => bytes[index] === byte);
  if (has(0x89, 0x50, 0x4e, 0x47)) return "image/png";
  if (has(0xff, 0xd8, 0xff)) return "image/jpeg";
  if (has(0x47, 0x49, 0x46, 0x38)) return "image/gif";
  if (has(0x52, 0x49, 0x46, 0x46) && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42) {
    return "image/webp";
  }
  if (has(0x42, 0x4d)) return "image/bmp";
  return null;
}

export function bytesToDataUri(bytes: Uint8Array, contentType: string | null): string {
  const sniffed = sniffImageContentType(bytes);
  const declared = contentType && /^image\//i.test(contentType) ? contentType.toLowerCase() : null;
  const mediaType = sniffed ?? declared ?? "application/octet-stream";
  return `data:${mediaType};base64,${bytesToBase64(bytes)}`;
}

/**
 * Replace every external image with an inlined data URI.
 *
 * Failures are never fatal: a document that prints with one missing remote image is useful,
 * a document that refuses to print is not. Every skip is reported so the caller can log it.
 */
export async function inlineExternalImages(
  html: string,
  deps: InlineImageDeps,
  options: InlineImageOptions,
): Promise<InlineImageSummary> {
  const urls = extractImageUrls(html);
  if (urls.length === 0) return { html, inlined: 0, skipped: [], inlinedBytes: 0 };

  const skipped: Array<{ url: string; reason: InlineSkipReason }> = [];
  const replacements = new Map<string, string>();
  let inlinedBytes = 0;
  let cursor = 0;

  const worker = async (): Promise<void> => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      const url = urls[index];
      if (!url) return;

      if (inlinedBytes >= options.maxTotalBytes) {
        skipped.push({ url, reason: "budget-exceeded" });
        continue;
      }

      try {
        const { bytes, contentType } = await withTimeout(
          deps.fetchBytes(url),
          options.timeoutMs,
          `image ${url}`,
        );
        if (bytes.length === 0) {
          skipped.push({ url, reason: "empty" });
          continue;
        }
        if (bytes.length > options.maxBytesPerImage) {
          skipped.push({ url, reason: "too-large" });
          continue;
        }
        if (inlinedBytes + bytes.length > options.maxTotalBytes) {
          skipped.push({ url, reason: "budget-exceeded" });
          continue;
        }
        replacements.set(url, bytesToDataUri(bytes, contentType));
        inlinedBytes += bytes.length;
      } catch (error) {
        const reason: InlineSkipReason = error instanceof PrintTimeoutError ? "timeout" : "fetch-failed";
        skipped.push({ url, reason });
        deps.warn?.("print: image could not be inlined", { url, reason });
      }
    }
  };

  const workerCount = Math.max(1, Math.min(options.concurrency, urls.length));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  let output = html;
  for (const [url, dataUri] of replacements) {
    output = output.split(url).join(dataUri);
  }

  return { html: output, inlined: replacements.size, skipped, inlinedBytes };
}
