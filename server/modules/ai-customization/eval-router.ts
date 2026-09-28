import { Router } from "express";
import { executeConversionEval, ConversionEvalParams } from "./eval-service";

export const evalRouter = Router();

// Endpoint for the CLI script or frontend to trigger an eval
evalRouter.post("/run", async (req, res) => {
  try {
    // We expect the same auth as cms-sync, but for now we'll allow internal API key or super admin password
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Missing or invalid Authorization header" });
    }

    const token = authHeader.substring(7);
    const validToken = process.env.CMS_SYNC_SECRET || process.env.SUPER_ADMIN_PASSWORD;
    if (!validToken || token !== validToken) {
      return res.status(401).json({ error: "Unauthorized eval access" });
    }

    const params: ConversionEvalParams = req.body;
    if (!params.typeKey || !params.inputTranscript) {
      return res.status(400).json({ error: "typeKey and inputTranscript are required" });
    }

    const result = await executeConversionEval(params);

    return res.json(result);
  } catch (err: any) {
    console.error("[EvalRouter] Error running eval:", err);
    return res.status(500).json({ error: "Internal server error during evaluation", details: err.message });
  }
});

// Status endpoint: returns CMS status plus global memory count
evalRouter.get("/status", async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Missing or invalid Authorization header" });
    }
    const token = authHeader.substring(7);
    const validToken = process.env.CMS_SYNC_SECRET || process.env.SUPER_ADMIN_PASSWORD;
    if (!validToken || token !== validToken) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { cmsService } = await import("./cms-service");
    const status = cmsService.getStatus();
    const globalMemory = cmsService.getGlobalMemoryContext();

    return res.json({
      ...status,
      globalMemoryActive: globalMemory.length > 0,
      globalMemoryPreview: globalMemory.slice(0, 500),
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});
