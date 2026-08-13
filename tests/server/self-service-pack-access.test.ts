import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";

test("conversion packs are a Pro-only benefit across Stripe and RevenueCat tiers", async (t) => {
  const mockPath = join(tmpdir(), `proset-pack-access-${randomUUID()}.json`);
  process.env.MOCK_DB_PATH = mockPath;
  process.env.NODE_ENV = "test";

  const [
    { default: aiCustomizationRouter },
    { storage },
    {
      getSelfServiceModuleState,
      isConversionTypeAllowed,
    },
  ] = await Promise.all([
    import("../../server/modules/ai-customization/router"),
    import("../../server/storage"),
    import("../../server/usage-service"),
  ]);

  const now = new Date().toISOString();
  const ids = {
    free: `free-${randomUUID()}`,
    stripeBase: `stripe-base-${randomUUID()}`,
    stripePro: `stripe-pro-${randomUUID()}`,
    revenueCatBase: `revenuecat-base-${randomUUID()}`,
    revenueCatPro: `revenuecat-pro-${randomUUID()}`,
    superAdmin: `super-admin-${randomUUID()}`,
  };

  const createUser = async (
    id: string,
    cachedTier: "free" | "base" | "pro",
    overrides: Record<string, unknown> = {},
  ) => {
    await storage.users.create({
      id,
      email: `${id}@example.test`,
      name: id,
      firstName: "Pack",
      jobType: "other",
      emailVerified: 1,
      forcePasswordChange: 0,
      twoFactorEnabled: 0,
      cachedTier,
      tierCachedAt: now,
      cloudSyncEnabled: 0,
      ...overrides,
    } as any);
  };

  await createUser(ids.free, "free");
  await createUser(ids.stripeBase, "base", {
    stripeSubscriptionId: "sub_test_pack_base",
  });
  await createUser(ids.stripePro, "pro", {
    stripeSubscriptionId: "sub_test_pack_pro",
  });
  await createUser(ids.revenueCatBase, "free", {
    revenueCatEntitlements: ["base"],
  });
  await createUser(ids.revenueCatPro, "free", {
    revenueCatEntitlements: ["pro"],
  });
  await createUser(ids.superAdmin, "free", {
    role: "super_admin",
    twoFactorEnabled: 1,
  });

  for (const userId of [ids.free, ids.stripeBase, ids.revenueCatBase]) {
    const state = await getSelfServiceModuleState(userId, "academic");
    assert.ok(state);
    assert.equal(state.requiredTier, "pro");
    assert.equal(state.eligible, false);
    assert.equal(state.userCanToggle, false);
    assert.equal(state.effectiveEnabled, false);
  }

  for (const userId of [ids.stripePro, ids.revenueCatPro]) {
    const state = await getSelfServiceModuleState(userId, "academic");
    assert.ok(state);
    assert.equal(state.requiredTier, "pro");
    assert.equal(state.eligible, true);
    assert.equal(state.userCanToggle, true);
    assert.equal(state.effectiveEnabled, false);
  }

  const superAdminState = await getSelfServiceModuleState(ids.superAdmin, "academic");
  assert.ok(superAdminState);
  assert.equal(superAdminState.eligible, true);
  assert.equal(superAdminState.effectiveEnabled, true);
  assert.equal(superAdminState.userCanToggle, false);

  await storage.userModules.assign(ids.stripeBase, "academic", null, ids.stripeBase);
  const assignedBaseState = await getSelfServiceModuleState(ids.stripeBase, "academic");
  assert.equal(assignedBaseState?.enabled, true);
  assert.equal(assignedBaseState?.effectiveEnabled, false);
  assert.equal(
    (await isConversionTypeAllowed(ids.stripeBase, "academic_research")).allowed,
    false,
  );

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const id = String(req.headers["x-test-user"] || ids.free);
    req.user = { id, email: `${id}@example.test`, name: id };
    req.authSource = "development";
    next();
  });
  app.use("/api", aiCustomizationRouter);

  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  t.after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await unlink(mockPath).catch(() => undefined);
  });

  const address = server.address();
  assert.ok(address && typeof address === "object");
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const request = async (
    path: string,
    userId: string,
    options: RequestInit = {},
  ) => {
    const response = await fetch(`${baseUrl}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        "x-test-user": userId,
        ...options.headers,
      },
    });
    return { response, body: await response.json() as Record<string, any> };
  };

  const baseToggle = await request(
    "/api/modules/self/academic",
    ids.stripeBase,
    { method: "PUT", body: JSON.stringify({ enabled: true }) },
  );
  assert.equal(baseToggle.response.status, 403);
  assert.equal(baseToggle.body.error, "module_plan_required");
  assert.equal(baseToggle.body.requiredTier, "pro");

  const proModules = await request("/api/modules/self", ids.stripePro);
  assert.equal(proModules.response.status, 200);
  assert.equal(proModules.body.modules.length, 1);
  assert.equal(proModules.body.modules[0].moduleName, "academic");
  assert.equal(proModules.body.modules[0].requiredTier, "pro");
  assert.equal(proModules.body.modules[0].isPaid, undefined);
  assert.equal(proModules.body.modules[0].monthlyPrice, undefined);
  assert.equal(proModules.body.modules[0].yearlyPrice, undefined);

  const proToggle = await request(
    "/api/modules/self/academic",
    ids.stripePro,
    { method: "PUT", body: JSON.stringify({ enabled: true }) },
  );
  assert.equal(proToggle.response.status, 200);
  assert.equal(proToggle.body.module.enabled, true);
  assert.equal(proToggle.body.module.effectiveEnabled, true);
  assert.equal(
    (await isConversionTypeAllowed(ids.stripePro, "academic_research")).allowed,
    true,
  );
});
