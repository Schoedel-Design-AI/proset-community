import assert from "node:assert/strict";
import test from "node:test";

import {
  SelfServicePackRequestError,
  fetchSelfServicePacks,
  replacePackWithServerState,
  rollbackPackState,
  setOptimisticPackState,
  updateSelfServicePack,
} from "../../lib/self-service-packs";
import type { SelfServiceModuleState } from "../../shared/self-service-modules";

const disabledPack: SelfServiceModuleState = {
  moduleName: "academic",
  requiredTier: "pro",
  eligible: true,
  enabled: false,
  effectiveEnabled: false,
  userCanToggle: true,
  displayName: "Academic Pack",
  conversionTypes: ["academic_research"],
};

test("pack loading fails on non-2xx responses instead of presenting an empty catalog", async () => {
  await assert.rejects(
    fetchSelfServicePacks(
      async () => new Response(
        JSON.stringify({ error: "Please sign in to continue." }),
        { status: 401, headers: { "Content-Type": "application/json" } },
      ),
      "https://proset.ai/api/modules/self",
      {},
    ),
    (error: unknown) => {
      assert.ok(error instanceof SelfServicePackRequestError);
      assert.equal(error.status, 401);
      assert.equal(error.code, "Please sign in to continue.");
      return true;
    },
  );
});

test("pack updates reject HTTP failures so the UI can restore its prior state", async () => {
  await assert.rejects(
    updateSelfServicePack(
      async () => new Response(
        JSON.stringify({ error: "module_plan_required", requiredTier: "pro" }),
        { status: 403, headers: { "Content-Type": "application/json" } },
      ),
      "https://proset.ai/api/modules/self/academic",
      {},
      true,
    ),
    (error: unknown) => {
      assert.ok(error instanceof SelfServicePackRequestError);
      assert.equal(error.status, 403);
      assert.equal(error.code, "module_plan_required");
      return true;
    },
  );
});

test("authoritative server state replaces optimistic UI state", async () => {
  const optimistic = setOptimisticPackState([disabledPack], "academic", true);
  assert.equal(optimistic[0].effectiveEnabled, true);

  const authoritative: SelfServiceModuleState = {
    ...disabledPack,
    enabled: false,
    effectiveEnabled: false,
    userCanToggle: false,
  };
  const fromServer = await updateSelfServicePack(
    async () => new Response(
      JSON.stringify({ success: true, module: authoritative }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    ),
    "https://proset.ai/api/modules/self/academic",
    {},
    true,
  );
  const reconciled = replacePackWithServerState(optimistic, fromServer);
  assert.deepEqual(reconciled, [authoritative]);
});

test("failed optimistic updates restore the exact previous pack state", () => {
  const optimistic = setOptimisticPackState([disabledPack], "academic", true);
  const rolledBack = rollbackPackState(optimistic, disabledPack);
  assert.deepEqual(rolledBack, [disabledPack]);
});

test("successful pack responses must contain the complete state contract", async () => {
  await assert.rejects(
    fetchSelfServicePacks(
      async () => new Response(
        JSON.stringify({ modules: [{ moduleName: "academic" }] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
      "https://proset.ai/api/modules/self",
      {},
    ),
    (error: unknown) => {
      assert.ok(error instanceof SelfServicePackRequestError);
      assert.equal(error.code, "invalid_module_response");
      return true;
    },
  );
});
