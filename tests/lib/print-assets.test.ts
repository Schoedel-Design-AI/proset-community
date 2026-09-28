import assert from "node:assert/strict";
import test from "node:test";

import {
  bytesToDataUri,
  extractImageUrls,
  inlineExternalImages,
  sniffImageContentType,
  type InlineImageDeps,
} from "../../lib/print/print-assets";

const PNG_1PX = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
]);

function deps(overrides: Partial<InlineImageDeps> = {}): InlineImageDeps & { calls: string[] } {
  const calls: string[] = [];
  const base: InlineImageDeps = {
    fetchBytes: async (url: string) => {
      calls.push(url);
      return { bytes: PNG_1PX, contentType: "image/png" };
    },
  };
  return Object.assign({ ...base, ...overrides }, { calls });
}

const options = { maxBytesPerImage: 1_000_000, maxTotalBytes: 2_000_000, timeoutMs: 500, concurrency: 2 };

test("only external http(s) image sources are collected, deduplicated, in order", () => {
  const html = `
    <img src="https://cdn.example.com/a.png" />
    <img src='https://cdn.example.com/a.png' />
    <img src="data:image/png;base64,AAAA" />
    <img src="file:///tmp/b.png" />
    <img src="http://cdn.example.com/c.jpg" />`;
  assert.deepEqual(extractImageUrls(html), ["https://cdn.example.com/a.png", "http://cdn.example.com/c.jpg"]);
});

test("content type is sniffed from magic bytes when the server lies", () => {
  assert.equal(sniffImageContentType(PNG_1PX), "image/png");
  assert.equal(sniffImageContentType(new Uint8Array([0xff, 0xd8, 0xff])), "image/jpeg");
  assert.equal(sniffImageContentType(new Uint8Array([0x47, 0x49, 0x46, 0x38])), "image/gif");
  assert.equal(sniffImageContentType(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])), null);
});

test("data URIs are built from the sniffed type, not from a spoofable header", () => {
  const uri = bytesToDataUri(PNG_1PX, "text/html");
  assert.match(uri, /^data:image\/png;base64,/);
});

test("every occurrence of an external image is replaced by the same data URI", async () => {
  const html = `<img src="https://cdn.example.com/a.png" /><p>x</p><img src="https://cdn.example.com/a.png" />`;
  const result = await inlineExternalImages(html, deps(), options);
  assert.equal(result.inlined, 1);
  assert.equal(result.skipped.length, 0);
  assert.equal(result.html.includes("https://cdn.example.com/a.png"), false);
  assert.equal((result.html.match(/data:image\/png;base64,/g) ?? []).length, 2);
});

test("a failing fetch keeps the original URL and reports why, instead of dropping the image", async () => {
  const result = await inlineExternalImages(
    `<img src="https://cdn.example.com/missing.png" />`,
    deps({
      fetchBytes: async () => {
        throw new Error("CORS");
      },
    }),
    options,
  );
  assert.equal(result.inlined, 0);
  assert.deepEqual(result.skipped, [{ url: "https://cdn.example.com/missing.png", reason: "fetch-failed" }]);
  assert.match(result.html, /https:\/\/cdn\.example\.com\/missing\.png/);
});

test("images above the per-image cap are skipped without pulling the body into the document", async () => {
  const result = await inlineExternalImages(
    `<img src="https://cdn.example.com/huge.png" />`,
    deps({ fetchBytes: async () => ({ bytes: new Uint8Array(2000), contentType: "image/png" }) }),
    { ...options, maxBytesPerImage: 1000 },
  );
  assert.deepEqual(result.skipped, [{ url: "https://cdn.example.com/huge.png", reason: "too-large" }]);
});

test("the total budget stops further inlining once exhausted", async () => {
  const html = `<img src="https://cdn.example.com/1.png" /><img src="https://cdn.example.com/2.png" />`;
  const result = await inlineExternalImages(html, deps(), { ...options, maxBytesPerImage: 10_000, maxTotalBytes: 10 });
  assert.equal(result.inlined, 0);
  assert.equal(result.skipped.length, 2);
  assert.equal(result.skipped.every((entry) => entry.reason === "budget-exceeded"), true);
});

test("a slow image that exceeds its own timeout is skipped, not awaited forever", async () => {
  const result = await inlineExternalImages(
    `<img src="https://cdn.example.com/slow.png" />`,
    deps({ fetchBytes: () => new Promise(() => {}) }),
    { ...options, timeoutMs: 5 },
  );
  assert.deepEqual(result.skipped, [{ url: "https://cdn.example.com/slow.png", reason: "timeout" }]);
});

test("concurrency is bounded: at most N fetches are in flight", async () => {
  let inFlight = 0;
  let peak = 0;
  const html = Array.from({ length: 6 }, (_, i) => `<img src="https://cdn.example.com/${i}.png" />`).join("");
  await inlineExternalImages(
    html,
    deps({
      fetchBytes: async () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 5));
        inFlight -= 1;
        return { bytes: PNG_1PX, contentType: "image/png" };
      },
    }),
    { ...options, concurrency: 2 },
  );
  assert.equal(peak <= 2, true, `peak concurrency was ${peak}`);
});

test("HTML with no images is returned untouched and costs nothing", async () => {
  const d = deps();
  const result = await inlineExternalImages("<p>plain</p>", d, options);
  assert.deepEqual(result, { html: "<p>plain</p>", inlined: 0, skipped: [], inlinedBytes: 0 });
  assert.deepEqual(d.calls, [], "a document without images must not touch the network");
});
