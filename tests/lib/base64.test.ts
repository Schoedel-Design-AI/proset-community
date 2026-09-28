import assert from "node:assert/strict";
import test from "node:test";

import { bytesToBase64, arrayBufferToBase64 } from "../../lib/base64";

test("encodes the RFC 4648 vectors", () => {
  assert.equal(bytesToBase64(new Uint8Array([])), "");
  assert.equal(bytesToBase64(new Uint8Array([0x66])), "Zg==");
  assert.equal(bytesToBase64(new Uint8Array([0x66, 0x6f])), "Zm8=");
  assert.equal(bytesToBase64(new Uint8Array([0x66, 0x6f, 0x6f])), "Zm9v");
  assert.equal(bytesToBase64(new Uint8Array([0x66, 0x6f, 0x6f, 0x62])), "Zm9vYg==");
});

test("survives payloads larger than the chunk boundary (0x8000)", () => {
  const HOSTILE_SIZE = 0x8000 + 3; // crosses the chunk edge and leaves a remainder
  const bytes = new Uint8Array(HOSTILE_SIZE);
  for (let i = 0; i < bytes.length; i += 1) bytes[i] = i % 251;
  const encoded = bytesToBase64(bytes);
  assert.equal(encoded, Buffer.from(bytes).toString("base64"));
  assert.equal(Buffer.from(encoded, "base64").length, HOSTILE_SIZE);
});

test("arrayBufferToBase64 agrees with bytesToBase64", () => {
  const bytes = new Uint8Array([1, 2, 3, 254, 255]);
  assert.equal(arrayBufferToBase64(bytes.buffer as ArrayBuffer), bytesToBase64(bytes));
});
