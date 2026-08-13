// Hermes (React Native native runtime) ships TextEncoder but NOT TextDecoder,
// so SSE streaming code that does `new TextDecoder()` works on web but throws
// "Property 'TextDecoder' doesn't exist" on Android. createUtf8Decoder()
// returns a TextDecoder-compatible object: the real one when available, or a
// manual UTF-8 decoder that buffers incomplete multi-byte sequences between
// streamed chunks.

interface Utf8DecoderLike {
  decode(input: Uint8Array, options?: { stream?: boolean }): string;
}

function trailingIncompleteCount(bytes: number[]): number {
  let cont = 0;
  let i = bytes.length - 1;
  while (i >= 0 && (bytes[i] & 0xc0) === 0x80) {
    cont++;
    i--;
  }
  if (i < 0) return 0;
  const lead = bytes[i];
  let needed = 0;
  if (lead >= 0xf0) needed = 3;
  else if (lead >= 0xe0) needed = 2;
  else if (lead >= 0xc0) needed = 1;
  else return 0;
  if (cont >= needed) return 0; // sequence is complete
  return cont + 1; // hold the lead byte + its continuations
}

function decodeUtf8Bytes(bytes: number[]): string {
  let out = "";
  let i = 0;
  const n = bytes.length;
  while (i < n) {
    const b = bytes[i];
    if (b < 0x80) {
      out += String.fromCharCode(b);
      i++;
    } else if (b >= 0xc0 && b < 0xe0 && i + 1 < n) {
      out += String.fromCharCode(((b & 0x1f) << 6) | (bytes[i + 1] & 0x3f));
      i += 2;
    } else if (b >= 0xe0 && b < 0xf0 && i + 2 < n) {
      out += String.fromCharCode(
        ((b & 0x0f) << 12) | ((bytes[i + 1] & 0x3f) << 6) | (bytes[i + 2] & 0x3f)
      );
      i += 3;
    } else if (b >= 0xf0 && b < 0xf8 && i + 3 < n) {
      const cp =
        ((b & 0x07) << 18) |
        ((bytes[i + 1] & 0x3f) << 12) |
        ((bytes[i + 2] & 0x3f) << 6) |
        (bytes[i + 3] & 0x3f);
      const offset = cp - 0x10000;
      out += String.fromCharCode(0xd800 + (offset >> 10), 0xdc00 + (offset & 0x3ff));
      i += 4;
    } else {
      out += "\uFFFD"; // malformed byte
      i++;
    }
  }
  return out;
}

export function createUtf8Decoder(): Utf8DecoderLike {
  if (typeof TextDecoder !== "undefined") {
    return new TextDecoder() as unknown as Utf8DecoderLike;
  }
  let pending: number[] = [];
  return {
    decode(input, options) {
      const bytes = pending.length
        ? pending.concat(Array.from(input))
        : Array.from(input);
      if (options?.stream) {
        const keep = trailingIncompleteCount(bytes);
        pending = keep > 0 ? bytes.slice(bytes.length - keep) : [];
        if (keep > 0) bytes.length -= keep;
      } else {
        pending = [];
      }
      return decodeUtf8Bytes(bytes);
    },
  };
}
