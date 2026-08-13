import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("Packs UI prevents duplicate mutations and rolls back failed optimistic state", () => {
  const screen = readFileSync("app/settings/ai-config.tsx", "utf8");
  assert.match(screen, /if \(togglingPacksRef\.current\.has\(moduleName\)\) return;/);
  assert.match(screen, /disabled=\{!pack\.userCanToggle \|\| packIsUpdating\}/);
  assert.match(screen, /updateSelfServicePack\(/);
  assert.match(screen, /replacePackWithServerState\(prev, authoritative\)/);
  assert.match(screen, /rollbackPackState\(prev, previousPack\)/);
  assert.match(screen, /accessibilityState=\{\{ disabled: !pack\.userCanToggle \|\| packIsUpdating, busy: packIsUpdating \}\}/);
});

test("Packs accessibility copy has complete English and Spanish translations", () => {
  const translations = readFileSync("lib/i18n.tsx", "utf8");
  const requiredKeys = [
    "settings.packExpand",
    "settings.packCollapse",
    "settings.packEnable",
    "settings.packDisable",
    "settings.packCustomizeInstructions",
    "settings.packEnableFirst",
    "settings.packInstructionsFor",
    "settings.packRemoveRule",
    "settings.packRemoveCriterion",
    "settings.packResetInstructions",
    "settings.packSaveInstructions",
  ];

  for (const key of requiredKeys) {
    assert.equal(
      translations.split(`"${key}"`).length - 1,
      2,
      `${key} must exist once in English and once in Spanish`,
    );
  }
  assert.match(translations, /"module\.academic": "Academic Pack"/);
  assert.match(translations, /"module\.academic": "Paquete académico"/);
});

test("pack catalog is Pro-only and no longer advertises standalone pricing", () => {
  const catalog = readFileSync("shared/self-service-modules.ts", "utf8");
  const router = readFileSync("server/modules/ai-customization/router.ts", "utf8");
  assert.match(catalog, /requiredTier: "pro"/);
  assert.doesNotMatch(router, /PACK_PRICING|monthlyPrice|yearlyPrice|isPaid/);
});

test("Packs tab has a package icon, consistent with other AI Config tabs", () => {
  const screen = readFileSync("app/settings/ai-config.tsx", "utf8");
  // Whitespace-tolerant: key→icon mapping must hold regardless of formatting
  assert.match(screen, /key:\s*"prompts"[^}]*icon:\s*"sliders"/s);
  assert.match(screen, /key:\s*"memory"[^}]*icon:\s*"cpu"/s);
  assert.match(screen, /key:\s*"packs"[^}]*icon:\s*"package"/s);
  // The tab bar Pressable must render the icon unconditionally (not inside a conditional)
  assert.match(screen, /<Feather name=\{tab\.icon\} size=/);
  assert.doesNotMatch(screen, /tab\.icon\s*&&/);
});

test("Feather web SVG shim includes the package icon used by the Packs tab", () => {
  const shim = readFileSync("lib/Feather.web.tsx", "utf8");
  assert.match(shim, /"package":\s*`/, "package icon must be present in the Feather web shim");
});
