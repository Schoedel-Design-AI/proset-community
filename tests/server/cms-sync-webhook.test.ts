import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import type { Server } from "http";

import { cmsSyncRouter } from "../../server/modules/ai-customization/cms-sync-router";
import { cmsService } from "../../server/modules/ai-customization/cms-service";

test("cmsSyncRouter provides status and hot-reload webhook", async () => {
  const app = express();
  app.use(express.json({ limit: "10mb" }));
  app.use("/api/admin", cmsSyncRouter);

  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const address = server.address() as { port: number };
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    // 1. GET /api/admin/cms-status
    const statusRes = await fetch(`${baseUrl}/api/admin/cms-status`);
    assert.equal(statusRes.status, 200);
    const statusData = await statusRes.json();
    assert.equal(statusData.status, "ok");
    assert.ok(statusData.cms.isInitialized);
    assert.equal(statusData.cms.counts.aiFunctions, 17);
    assert.equal(statusData.cms.counts.aiModels, 19);

    // 2. POST /api/admin/cms-sync without token -> 401
    const unauthRes = await fetch(`${baseUrl}/api/admin/cms-sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh: true }),
    });
    assert.equal(unauthRes.status, 401);

    // 3. POST /api/admin/cms-sync with wrong token -> 401
    const wrongTokenRes = await fetch(`${baseUrl}/api/admin/cms-sync`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer invalid-secret",
      },
      body: JSON.stringify({ refresh: true }),
    });
    assert.equal(wrongTokenRes.status, 401);

    // Setup mock secret
    const originalSecret = process.env.CMS_SYNC_SECRET;
    try {
      process.env.CMS_SYNC_SECRET = "test-sync-secret-123";

      // 4. POST /api/admin/cms-sync with invalid bundle payload -> 400
      const badPayloadRes = await fetch(`${baseUrl}/api/admin/cms-sync`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer test-sync-secret-123",
        },
        body: JSON.stringify({ invalidField: "bad" }),
      });
      assert.equal(badPayloadRes.status, 400);

      // 5. POST /api/admin/cms-sync with valid bundle payload -> 200 & hot-reload
      const currentBundle = cmsService.getBundle();
      assert.ok(currentBundle, "Must have an initial bundle");

      // Clone bundle and alter version in memory to verify hot-reload
      const modifiedBundle = JSON.parse(JSON.stringify(currentBundle));
      modifiedBundle.version = "1.0.1-test";
      const promptToModify = modifiedBundle.prompts.find((p: any) => p.type_key === "email");
      if (promptToModify) {
        promptToModify.temperature = 0.95;
      }

      const syncRes = await fetch(`${baseUrl}/api/admin/cms-sync`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer test-sync-secret-123",
        },
        body: JSON.stringify(modifiedBundle),
      });

      assert.equal(syncRes.status, 200);
      const syncData = await syncRes.json();
      assert.equal(syncData.success, true);
      assert.equal(syncData.version, "1.0.1-test");

      // Verify in-memory state updated immediately (0ms hot reload)
      const newStatus = cmsService.getStatus();
      assert.equal(newStatus.version, "1.0.1-test");

      // Restore original bundle
      cmsService.applyBundle(currentBundle);
    } finally {
      if (originalSecret !== undefined) {
        process.env.CMS_SYNC_SECRET = originalSecret;
      } else {
        delete process.env.CMS_SYNC_SECRET;
      }
    }
  } finally {
    server.close();
  }
});
