// Hermes (Android) does not implement `structuredClone`, but dicebear-core
// calls it unconditionally when rendering avatars (Options/Style constructors
// and toJSON/toDataUri). Without a polyfill every AvatarView render crashes
// the app with "ReferenceError: Property 'structuredClone' doesn't exist".
//
// Browsers and Node ship the native implementation, so this is a no-op there.
// Installed at app boot: index.js (native) + index.web.tsx (web).
//
// Minimal implementation: primitives, plain objects, arrays, Date, RegExp,
// Map, Set, ArrayBuffer/TypedArrays. Enough for the avatar option/style
// payloads and spec-compliant for the common cases.

function clonePolyfill<T>(value: T, seen: WeakMap<object, unknown>): T {
  if (value === null || typeof value !== "object") return value;

  if (seen.has(value as object)) return seen.get(value as object) as T;

  if (value instanceof Date) return new Date(value.getTime()) as unknown as T;

  if (value instanceof RegExp) return new RegExp(value.source, value.flags) as unknown as T;

  if (value instanceof ArrayBuffer) {
    return value.slice(0) as unknown as T;
  }

  if (ArrayBuffer.isView(value)) {
    const buffer = (value as ArrayBufferView).buffer;
    const Ctor = (value as { constructor: new (b: ArrayBuffer) => unknown }).constructor;
    return new Ctor(buffer.slice(0) as ArrayBuffer) as unknown as T;
  }

  if (value instanceof Map) {
    const out = new Map();
    seen.set(value as object, out);
    (value as Map<unknown, unknown>).forEach((v, k) => {
      out.set(clonePolyfill(k, seen), clonePolyfill(v, seen));
    });
    return out as unknown as T;
  }

  if (value instanceof Set) {
    const out = new Set();
    seen.set(value as object, out);
    (value as Set<unknown>).forEach((v) => {
      out.add(clonePolyfill(v, seen));
    });
    return out as unknown as T;
  }

  if (Array.isArray(value)) {
    const out: unknown[] = [];
    seen.set(value as object, out);
    for (const item of value) {
      out.push(clonePolyfill(item, seen));
    }
    return out as unknown as T;
  }

  const out: Record<string, unknown> = {};
  seen.set(value as object, out);
  for (const key of Object.keys(value as Record<string, unknown>)) {
    out[key] = clonePolyfill((value as Record<string, unknown>)[key], seen);
  }
  return out as unknown as T;
}

export function installStructuredClonePolyfill(): void {
  const g = globalThis as { structuredClone?: <T>(value: T) => T };
  if (typeof g.structuredClone === "function") return;
  g.structuredClone = <T>(value: T): T => clonePolyfill(value, new WeakMap());
}
