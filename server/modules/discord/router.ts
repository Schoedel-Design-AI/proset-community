import express, { type Request, type Response } from "express";
import { requireAuth } from "../../auth";
import { storage } from "../../storage";
import { beginDiscordOAuth, completeDiscordOAuth } from "./linking";
import { processDiscordJob } from "./worker";
import { verifyDiscordTaskAuthorization } from "./task-queue";

export const discordRouter = express.Router();

discordRouter.get("/link/status", requireAuth, async (req: Request, res: Response) => {
  const account = await storage.accounts.getByUserAndProvider(req.userId!, "discord");
  res.json({ linked: Boolean(account), discordUserId: account?.accountId ?? null });
});

discordRouter.post("/oauth/start", requireAuth, async (req: Request, res: Response) => {
  const state = typeof req.body?.state === "string" ? req.body.state : "";
  if (!state) return res.status(400).json({ error: "missing_state" });
  const authorizeUrl = await beginDiscordOAuth(state, req.userId!);
  if (!authorizeUrl) return res.status(400).json({ error: "invalid_or_expired_state" });
  res.json({ authorizeUrl });
});

discordRouter.get("/oauth/callback", async (req: Request, res: Response) => {
  const code = typeof req.query.code === "string" ? req.query.code : "";
  const state = typeof req.query.state === "string" ? req.query.state : "";
  if (!code || !state) return res.redirect(303, "/discord/link?result=oauth_failed");
  const result = await completeDiscordOAuth(code, state);
  res.redirect(303, `/discord/link?result=${encodeURIComponent(result.result)}&lang=${result.locale || "en"}`);
});

discordRouter.delete("/link", requireAuth, async (req: Request, res: Response) => {
  const unlinked = await storage.accounts.unlinkDiscord(req.userId!);
  res.json({ ok: true, unlinked });
});

discordRouter.post("/internal/jobs", async (req: Request, res: Response) => {
  const authorized = await verifyDiscordTaskAuthorization(
    req.header("authorization"),
    req.headers["x-cloudtasks-taskname"],
    req.headers["x-cloudtasks-queuename"],
  );
  if (!authorized) return res.status(401).json({ error: "unauthorized" });
  const jobId = typeof req.body?.jobId === "string" ? req.body.jobId : "";
  if (!/^discord_job_[a-f0-9]{32}$/.test(jobId)) {
    return res.status(400).json({ error: "invalid_job_id" });
  }
  // The worker records a terminal result and notifies the user. Returning 200
  // for terminal failures prevents a paid AI operation from being repeated by
  // an infrastructure retry without fresh user intent.
  await processDiscordJob(jobId);
  res.json({ ok: true });
});
