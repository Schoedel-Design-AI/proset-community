/**
 * Source-scan guards for the module → conversion-types mapping.
 *
 * The mapping used to live in THREE places:
 *   1. shared/self-service-modules.ts (SELF_SERVICE_MODULE_CATALOG)
 *   2. lib/utils.ts (MODULE_CONVERSION_TYPES)
 *   3. server/usage-service.ts (also called MODULE_CONVERSION_TYPES)
 *
 * The 2026-09-17 refactor made (1) the single source of truth: server and
 * client both derive from SELF_SERVICE_MODULE_CATALOG.conversionTypes.
 * This test fails if anyone reintroduces a hand-maintained list that
 * disagrees with the catalog.
 *
 * The scripts/ce-export/overrides/lib/utils.ts CE mirror is DELIBERATELY
 * different — CE excludes bibliography and questions because they call
 * external research services CE users don't necessarily wire up. That
 * exception is enforced separately: this test asserts the CE list is a
 * SUBSET of the catalog, never a superset.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SELF_SERVICE_MODULE_CATALOG } from "@shared/self-service-modules";
import { MODULE_CONVERSION_TYPES } from "@/lib/utils";

test("lib/utils.ts MODULE_CONVERSION_TYPES matches SELF_SERVICE_MODULE_CATALOG", () => {
  for (const [moduleName, moduleEntry] of Object.entries(SELF_SERVICE_MODULE_CATALOG)) {
    if (!("conversionTypes" in moduleEntry)) continue;
    const catalogTypes = [...moduleEntry.conversionTypes].sort();
    const derivedTypes = [...(MODULE_CONVERSION_TYPES[moduleName as keyof typeof MODULE_CONVERSION_TYPES] ?? [])].sort();
    assert.deepEqual(
      derivedTypes,
      catalogTypes,
      `lib/utils.ts MODULE_CONVERSION_TYPES.${moduleName} drifted from SELF_SERVICE_MODULE_CATALOG.${moduleName}.conversionTypes. ` +
        `Do not hand-maintain the client list — it must derive from the catalog. ` +
        `Catalog: ${catalogTypes.join(", ")} — Client: ${derivedTypes.join(", ")}`,
    );
  }
});

test("lib/utils.ts does not hand-maintain a module conversion-type list", () => {
  const source = readFileSync("lib/utils.ts", "utf8");
  // The derivation line must exist AND no hand-maintained hard-coded array
  // that names conversion types like "academic_research" should live as the
  // value of MODULE_CONVERSION_TYPES.academic.
  assert.match(
    source,
    /MODULE_CONVERSION_TYPES.*=\s*{\s*academic:\s*\[\s*\.\.\.\(?SELF_SERVICE_MODULE_CATALOG\.academic\.conversionTypes/s,
    "MODULE_CONVERSION_TYPES.academic must derive from SELF_SERVICE_MODULE_CATALOG. Do not hand-maintain the list.",
  );
});

test("CE mirror MODULE_CONVERSION_TYPES is a subset of the full catalog", () => {
  // CE excludes bibliography + questions on purpose (external service deps).
  // The mirror MUST be a subset — never a superset — of the catalog.
  const ceSource = readFileSync("scripts/ce-export/overrides/lib/utils.ts", "utf8");
  const ceMatch = ceSource.match(/MODULE_CONVERSION_TYPES[^{]*{\s*academic:\s*\[([^\]]+)\]/);
  if (!ceMatch) {
    throw new Error("CE mirror lib/utils.ts no longer declares MODULE_CONVERSION_TYPES.academic — refactor may have broken the override.");
  }
  const ceTypes = [...ceMatch[1].matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
  const catalogTypes = new Set<string>(SELF_SERVICE_MODULE_CATALOG.academic.conversionTypes);
  for (const type of ceTypes) {
    assert.ok(
      catalogTypes.has(type),
      `CE mirror MODULE_CONVERSION_TYPES.academic lists "${type}" but the main catalog does not. ` +
        `CE may only be a SUBSET, never a superset — add it to SELF_SERVICE_MODULE_CATALOG first.`,
    );
  }
});
