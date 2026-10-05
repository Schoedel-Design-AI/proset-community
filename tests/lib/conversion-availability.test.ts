import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { SELF_SERVICE_MODULE_CATALOG } from "../../shared/self-service-modules";
import { CONVERSION_TYPES } from "../../lib/utils";
import {
  UNSHIPPED_PACK_MODULES,
  filterOfferedConversionTypes,
  isConversionTypeOffered,
  listablePackModules,
  moduleStatesKnown,
  shippedModuleNames,
  type ConversionAccess,
} from "../../lib/conversion-availability";

/**
 * The client half of the unshipped-pack gate.
 *
 * `/api/modules/self` returns a state per SHIPPED module only — unshipped packs are
 * absent for every role, admins and Friends-of-Barry included — so the state list is
 * the client's source of truth for what exists. A chip for a type whose module is
 * missing from it is a dead end: the server refuses the conversion.
 *
 * The reported defect: the Thought Thread page listed the Saint Pack's six types for
 * a super admin, because its own filter short-circuited on `isSuperAdmin` before any
 * module check.
 */

const SAINT_TYPES = [
  "christian_prayer",
  "saints_devotional_prayer",
  "bulletin_insert",
  "catechesis_lesson",
  "pastoral_plan",
  "ocia_planning",
];

const ACADEMIC_TYPES = ["academic_research", "statistics", "study_guide", "quiz"];

const statesWithAcademic = [
  { moduleName: "academic", effectiveEnabled: true },
  { moduleName: "music", effectiveEnabled: false },
];

const values = (types: { value: string }[]) => types.map((type) => type.value);

test("an unshipped pack is not offered to any role, super admin included", () => {
  const cases: Array<[string, ConversionAccess]> = [
    ["super admin", { tier: "pro", isSuperAdmin: true, moduleStates: statesWithAcademic }],
    ["pro", { tier: "pro", moduleStates: statesWithAcademic }],
    ["base", { tier: "base", moduleStates: statesWithAcademic }],
    ["no module data yet", { tier: "pro", moduleStates: [] }],
  ];
  for (const [label, access] of cases) {
    const offered = values(filterOfferedConversionTypes(CONVERSION_TYPES, access));
    for (const type of SAINT_TYPES) {
      assert.equal(offered.includes(type), false, `${label}: ${type} belongs to an unshipped pack`);
      assert.equal(isConversionTypeOffered(type, access), false, `${label}: single check must agree`);
    }
  }
});

test("a shipped, enabled pack is offered to an eligible subscriber and to a super admin", () => {
  const pro = values(filterOfferedConversionTypes(CONVERSION_TYPES, { tier: "pro", moduleStates: statesWithAcademic }));
  for (const type of ACADEMIC_TYPES) {
    assert.equal(pro.includes(type), true, `an enabled Academic Pack type must be offered: ${type}`);
  }
  const admin = values(filterOfferedConversionTypes(CONVERSION_TYPES, {
    tier: "base",
    isSuperAdmin: true,
    moduleStates: statesWithAcademic,
  }));
  for (const type of ACADEMIC_TYPES) {
    assert.equal(admin.includes(type), true, `a super admin keeps every shipped type: ${type}`);
  }
  // The super-admin shortcut must not become a way around the shipped check.
  const adminWithoutModules = values(filterOfferedConversionTypes(CONVERSION_TYPES, {
    tier: "pro",
    isSuperAdmin: true,
    moduleStates: [],
  }));
  assert.equal(adminWithoutModules.some((type) => SAINT_TYPES.includes(type)), false);
});

test("a pack the subscriber's tier does not include stays out", () => {
  const statesWithDisabledPack = [{ moduleName: "academic", effectiveEnabled: false }];
  const base = values(filterOfferedConversionTypes(CONVERSION_TYPES, {
    tier: "base",
    moduleStates: statesWithDisabledPack,
  }));
  for (const type of ACADEMIC_TYPES) {
    assert.equal(base.includes(type), false, `an ineligible subscriber must not be offered ${type}`);
  }
  // Core types are decided by the tier map, not by modules.
  assert.equal(base.includes("summary"), true);
});

test("the shipped set is exactly what /api/modules/self returned", () => {
  assert.deepEqual([...shippedModuleNames(statesWithAcademic)], ["academic", "music"]);
  assert.deepEqual([...shippedModuleNames(undefined)], []);
  assert.deepEqual([...shippedModuleNames(null)], []);
});

test("an unanswered module fetch does not lock a pack the account may own", () => {
  // The defect this covers: with no module data the shipped set is empty, so every pack
  // type read as unshipped and a Pro subscriber saw their own Academic Pack locked when
  // /api/modules/self had not landed or had failed.
  const inFlight: ConversionAccess = { tier: "pro", moduleStates: [], moduleStatesLoaded: false };
  const beforeAnswer: ConversionAccess = { tier: "pro", moduleStates: undefined };
  for (const [label, access] of [["in flight/failed", inFlight], ["not answered yet", beforeAnswer]] as const) {
    for (const type of ACADEMIC_TYPES) {
      assert.equal(isConversionTypeOffered(type, access), true, `${label}: ${type} must stay open while unknown`);
    }
    // Unshipped is not unknown: the pack stays out with or without server data.
    for (const type of SAINT_TYPES) {
      assert.equal(isConversionTypeOffered(type, access), false, `${label}: ${type} is unshipped`);
    }
    assert.equal(moduleStatesKnown(access), false, `${label}: must report the state as unknown`);
  }
});

test("unknown skips only what the tier already rules out; an answer decides again", () => {
  const baseUnknown: ConversionAccess = { tier: "base", moduleStatesLoaded: false };
  const baseOffered = values(filterOfferedConversionTypes(CONVERSION_TYPES, baseUnknown));
  for (const type of ACADEMIC_TYPES) {
    assert.equal(baseOffered.includes(type), false, `the Academic Pack requires Pro: ${type}`);
  }
  // Core types never depend on module data.
  assert.equal(isConversionTypeOffered("summary", baseUnknown), true);
  assert.equal(isConversionTypeOffered("white_paper", { tier: "free", moduleStatesLoaded: false }), false);

  // Once the server answers, its answer decides — "no modules" is a real answer.
  const answeredEmpty: ConversionAccess = { tier: "pro", moduleStates: [], moduleStatesLoaded: true };
  for (const type of ACADEMIC_TYPES) {
    assert.equal(isConversionTypeOffered(type, answeredEmpty), false, `${type}: it is not in the shipped set`);
  }
  // A pack the server listed as disabled stays locked, unknown or not.
  const disabledPack: ConversionAccess = {
    tier: "pro",
    moduleStates: [{ moduleName: "academic", effectiveEnabled: false }],
    moduleStatesLoaded: true,
  };
  assert.equal(isConversionTypeOffered("academic_research", disabledPack), false);
  // And a super admin keeps every shipped type either way.
  assert.equal(
    isConversionTypeOffered("academic_research", { tier: "base", isSuperAdmin: true }),
    true,
    "an admin does not need the module payload to see a shipped pack",
  );
});

test("a menu lists the catalog's packs until the server answers, then only what it returned", () => {
  const unknown = listablePackModules({ tier: "pro", moduleStatesLoaded: false });
  assert.equal(unknown.has("academic"), true, "a menu must not go empty just because a fetch is pending");
  assert.equal(unknown.has("saint"), false, "an unready pack is never listed");
  const known = listablePackModules({ tier: "pro", moduleStates: statesWithAcademic });
  assert.deepEqual([...known], ["academic", "music"], "once answered, the server's list is the list");
});

test("the client's unshipped list is the server's, item for item", () => {
  const server = readFileSync("server/usage-service.ts", "utf8");
  const declaration = server.match(/UNSHIPPED_MODULES\s*=\s*new Set<string>\(\[([^\]]*)\]\)/);
  assert.ok(declaration, "server/usage-service.ts must still declare UNSHIPPED_MODULES");
  const serverSet = declaration[1]
    .split(",")
    .map((entry) => entry.trim().replace(/^"|"$/g, ""))
    .filter(Boolean);
  assert.deepEqual(
    [...UNSHIPPED_PACK_MODULES].sort(),
    serverSet.sort(),
    "the client mirror must name exactly the packs the server refuses",
  );
  for (const name of UNSHIPPED_PACK_MODULES) {
    assert.ok(
      Object.prototype.hasOwnProperty.call(SELF_SERVICE_MODULE_CATALOG, name),
      `${name} must be a real module in the shared catalog`,
    );
  }
});
