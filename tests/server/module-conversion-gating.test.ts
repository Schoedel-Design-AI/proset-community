import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("Conversion type gating and self-service modules work correctly for Pro subscribers", async (t) => {
  const mockPath = join(tmpdir(), `proset-module-gating-${randomUUID()}.json`);
  process.env.MOCK_DB_PATH = mockPath;
  process.env.NODE_ENV = "test";

  const [
    { storage },
    { isConversionTypeAllowed, getSelfServiceModuleState }
  ] = await Promise.all([
    import("../../server/storage"),
    import("../../server/usage-service")
  ]);

  t.after(async () => {
    await unlink(mockPath).catch(() => undefined);
  });

  const freeUserId = `free-user-${randomUUID()}`;
  const proUserId = `pro-user-${randomUUID()}`;

  // 1. Create a Free user
  await storage.users.create({
    id: freeUserId,
    email: `${freeUserId}@example.test`,
    name: "Free User",
    firstName: "Free",
    jobType: "other",
    emailVerified: 1,
    cachedTier: "free",
    tierCachedAt: new Date().toISOString(),
    cloudSyncEnabled: 0,
  });

  // 2. Create a Pro user
  await storage.users.create({
    id: proUserId,
    email: `${proUserId}@example.test`,
    name: "Pro User",
    firstName: "Pro",
    jobType: "other",
    emailVerified: 1,
    cachedTier: "pro",
    tierCachedAt: new Date().toISOString(),
    cloudSyncEnabled: 1,
  });

  // Scenario A: Free subscriber tries to access Academic conversions
  const freeAccess = await isConversionTypeAllowed(freeUserId, "academic_research");
  assert.equal(freeAccess.allowed, false);
  assert.equal(freeAccess.requiredTier, "base"); // Needs at least Base to activate the module
  assert.equal(freeAccess.requiredModule, "academic");
  assert.equal(freeAccess.moduleEligible, false);

  const freeModuleState = await getSelfServiceModuleState(freeUserId, "academic");
  assert.ok(freeModuleState);
  assert.equal(freeModuleState.eligible, false);
  assert.equal(freeModuleState.enabled, false);
  assert.equal(freeModuleState.userCanToggle, false);

  // Scenario B: Pro subscriber (with no module explicitly enabled yet)
  const proAccessBefore = await isConversionTypeAllowed(proUserId, "academic_research");
  assert.equal(proAccessBefore.allowed, false);
  assert.equal(proAccessBefore.requiredModule, "academic");
  assert.equal(proAccessBefore.moduleEligible, true); // Pro is eligible for base-gated self-service modules

  const proModuleStateBefore = await getSelfServiceModuleState(proUserId, "academic");
  assert.ok(proModuleStateBefore);
  assert.equal(proModuleStateBefore.eligible, true);
  assert.equal(proModuleStateBefore.enabled, false);
  assert.equal(proModuleStateBefore.userCanToggle, true); // Yes, a Pro user can self-toggle the module

  // Scenario C: Pro subscriber self-enables/toggles the module
  await storage.userModules.assign(proUserId, "academic", null, proUserId);

  const proModuleStateAfter = await getSelfServiceModuleState(proUserId, "academic");
  assert.ok(proModuleStateAfter);
  assert.equal(proModuleStateAfter.eligible, true);
  assert.equal(proModuleStateAfter.enabled, true);
  assert.equal(proModuleStateAfter.effectiveEnabled, true);

  const proAccessAfter = await isConversionTypeAllowed(proUserId, "academic_research");
  assert.equal(proAccessAfter.allowed, true); // Now allowed!

  // Scenario D: Pro subscriber toggles the module off again
  await storage.userModules.remove(proUserId, "academic");

  const proModuleStateDisabled = await getSelfServiceModuleState(proUserId, "academic");
  assert.ok(proModuleStateDisabled);
  assert.equal(proModuleStateDisabled.enabled, false);
  assert.equal(proModuleStateDisabled.effectiveEnabled, false);

  const proAccessDisabled = await isConversionTypeAllowed(proUserId, "academic_research");
  assert.equal(proAccessDisabled.allowed, false); // Locked again
});
