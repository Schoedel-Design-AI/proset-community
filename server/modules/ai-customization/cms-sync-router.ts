import { Router, json, type Request, type Response } from "express";
import { CmsBundleSchema } from "./cms-schema";
import { cmsService } from "./cms-service";

export const cmsSyncRouter = Router();

cmsSyncRouter.use(json({ limit: "10mb" }));

function isAuthorized(req: Request): boolean {
  const authHeader = req.headers.authorization?.trim();
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return false;
  }
  const token = authHeader.slice("Bearer ".length).trim();
  const syncSecret = process.env.CMS_SYNC_SECRET?.trim();
  const superAdminPassword = process.env.SUPER_ADMIN_PASSWORD?.trim();

  if (syncSecret && token === syncSecret) {
    return true;
  }
  if (superAdminPassword && token === superAdminPassword) {
    return true;
  }
  return false;
}

/**
 * GET /api/admin/cms-status
 * Returns health and statistics about the active in-memory CMS bundle.
 */
cmsSyncRouter.get("/cms-status", (_req: Request, res: Response) => {
  const status = cmsService.getStatus();
  res.json({
    status: "ok",
    cms: status,
  });
});

/**
 * POST /api/admin/cms-sync
 * Hot-reloads the in-memory CMS service with zero latency and publishes to Firestore.
 */
cmsSyncRouter.post("/cms-sync", async (req: Request, res: Response) => {
  if (!isAuthorized(req)) {
    res.status(401).json({ error: "Unauthorized: valid Bearer token required." });
    return;
  }

  // If request contains a refresh trigger:
  if (req.body && req.body.refresh === true && !req.body.packs) {
    const loaded = await cmsService.loadBundleFromFirestore();
    if (loaded) {
      res.json({
        success: true,
        message: "CMS bundle successfully refreshed from Firestore.",
        status: cmsService.getStatus(),
      });
      return;
    } else {
      res.status(404).json({
        error: "No active CMS bundle found in Firestore to refresh from.",
      });
      return;
    }
  }

  // Validate bundle payload
  const result = CmsBundleSchema.safeParse(req.body);
  if (!result.success) {
    res.status(400).json({
      error: "Invalid CMS bundle payload.",
      details: result.error.format(),
    });
    return;
  }

  const bundle = result.data;

  // 1. Hot-reload in-memory maps in 0ms
  cmsService.applyBundle(bundle);

  // 2. Persist to Firestore for container fleet synchronization
  const persisted = await cmsService.saveBundleToFirestore(bundle);

  res.json({
    success: true,
    message: "CMS bundle hot-reloaded successfully.",
    version: bundle.version,
    exportedAt: bundle.exported_at,
    firestoreSync: persisted ? "persisted" : "skipped",
    counts: cmsService.getStatus().counts,
  });
});
