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

// The Save as / Share as dialog on the recording screen maps a format value to
// a Feather name in a ternary chain. That chain lives outside lib/utils.ts, so
// the guard above never saw it: the Word (.docx) row asked for "file-plus",
// which was absent from the shim, so web drew a blank icon next to the label
// while Android (full TTF font) drew one. Pin the chain in the app and in the
// Community Edition override that mirrors the same file.
const EXPORT_ICON_SOURCES = [
  "app/recording/[id].tsx",
  "scripts/ce-export/overrides/app/recording/[id].tsx",
];

const FORMAT_VALUES = new Set(["txt", "md", "pdf", "docx", "csv", "xlsx"]);

function extractExportIconNames(source: string, file: string): string[] {
  const anchor = source.indexOf('format.value === "txt"');
  assert.notEqual(anchor, -1, `${file}: the export-format icon chain is gone; update this guard`);
  const end = source.indexOf("size=", anchor);
  assert.notEqual(end, -1, `${file}: the export-format icon chain has no size prop to bound it`);
  const chain = source.slice(anchor, end);
  return [...new Set([...chain.matchAll(/"([a-z0-9-]+)"/g)].map((m) => m[1]))].filter(
    (name) => !FORMAT_VALUES.has(name),
  );
}

test("every icon in the export-format dialog is shimmed for web", () => {
  const shimKeys = extractShimKeys();
  const missing = EXPORT_ICON_SOURCES.flatMap((file) =>
    extractExportIconNames(readFileSync(file, "utf8"), file)
      .filter((name) => !shimKeys.has(name))
      .map((name) => `${name} (${file})`),
  );
  assert.deepEqual(
    missing,
    [],
    `Export-format icons missing from the web Feather shim (lib/Feather.web.tsx): ${missing.join(", ")}`,
  );
});

// Screen-scoped sweep, added 2026-09-30 with the Thought Thread status rework.
// That screen asked the shim for git-branch, paperclip and rotate-cw, none of
// which were present: three blank icons on web, invisible on Android where the
// full TTF font ships. Extend SCREEN_ICON_SOURCES with any screen whose icons
// must render on web.
const SCREEN_ICON_SOURCES = [
  "app/thought-thread/[id].tsx",
  "scripts/ce-export/overrides/app/thought-thread/[id].tsx",
  "components/ConversionTypePicker.tsx",
  "app/recording/[id].tsx",
  "scripts/ce-export/overrides/app/recording/[id].tsx",
];

function extractIconNames(source: string): string[] {
  const names: string[] = [];
  // Only <Feather> elements: the app also renders FontAwesome through
  // lib/FontAwesome.web.tsx (ConversionIcon maps "linkedin" to it), and those names
  // are not Feather names.
  for (const element of source.matchAll(/<Feather\b([\s\S]{0,600}?)(?:\/>|>)/g)) {
    const props = element[1];
    const staticName = props.match(/name="([a-z0-9-]+)"/);
    if (staticName) names.push(staticName[1]);
    const expression = props.match(/name=\{([^}]*)\}/);
    if (expression) {
      // Only the branches are icon names: "failed" in `status === "failed"` is a
      // status value, and "mp3" in `format === "mp3"` is a format.
      const withoutComparisons = expression[1].replace(/[!=]==\s*"[^"]*"/g, "");
      const branches = withoutComparisons.split(/[?:]/).slice(1).join(" ");
      for (const literal of branches.matchAll(/"([a-z0-9-]+)"/g)) names.push(literal[1]);
    }
  }
  return [...new Set(names)];
}

test("every icon the Thought Thread screen asks for is shimmed for web", () => {
  const shimKeys = extractShimKeys();
  const missing = SCREEN_ICON_SOURCES.flatMap((file) => {
    const names = extractIconNames(readFileSync(file, "utf8"));
    assert.ok(names.length >= 3, `${file}: no icon names found; the extractor needs updating`);
    return names.filter((name) => !shimKeys.has(name)).map((name) => `${name} (${file})`);
  });
  assert.deepEqual(
    missing,
    [],
    `Icons missing from the web Feather shim (lib/Feather.web.tsx): ${missing.join(", ")}`,
  );
});
