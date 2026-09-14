import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// Regression guard for the "missing icon in the UI" bug: the web build renders
// Feather icons through a hand-curated SVG shim (lib/Feather.web.tsx) instead
// of the @react-native-vector-icons font. A conversion-type icon name that is
// absent from that shim renders as `null` (a blank icon) on web while looking
// fine on native, where the full TTF font is bundled. Every icon referenced by
// CONVERSION_TYPES / PACK_CONFIGURATION_TYPES / group + pack headers in
// lib/utils.ts must therefore exist in the web shim.

function extractIconsFromUtilsTs(): string[] {
  const src = readFileSync("lib/utils.ts", "utf8");
  return [...src.matchAll(/icon:\s*"([^"]+)"/g)].map((m) => m[1]);
}

function extractShimKeys(): Set<string> {
  const shim = readFileSync("lib/Feather.web.tsx", "utf8");
  return new Set([...shim.matchAll(/^\s*"([^"]+)":\s*`/gm)].map((m) => m[1]));
}

test("every conversion-type and pack icon in lib/utils.ts is shimmed for web", () => {
  const icons = [...new Set(extractIconsFromUtilsTs())];
  const shimKeys = extractShimKeys();
  const missing = icons.filter((icon) => !shimKeys.has(icon));
  assert.deepEqual(
    missing,
    [],
    `Icons missing from the web Feather shim (lib/Feather.web.tsx): ${missing.join(", ")}`,
  );
});
