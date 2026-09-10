import express, { type Request, type Response } from "express";
import multer from "multer";
import { rateLimit } from "express-rate-limit";
import { randomUUID } from "node:crypto";
import { requireAuth } from "../../auth";
import { storage } from "../../storage";
import { apiKeyAuth, generateApiKey } from "./api-keys";
import { runCoreConversion } from "./conversion";
import { transcribeAudioLatencyFirst } from "../../transcription-routing";
import { paragraphizeTranscript } from "@shared/transcript-format";
import { estimateAudioDurationSeconds } from "../../audio-silence";
import {
  checkTranscriptionLimit,
  deductTranscriptionTokens,
  getUserUsageSummary,
} from "../../usage-service";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 500 * 1024 * 1024 },
});

// Per-user AI rate limiter (10/min), applied AFTER apiKeyAuth so it keys on
// the resolved user — mirrors the in-app aiLimiter for /api/transcribe and
// /api/convert. Without it the v1 endpoints fall back to the generic 100/min
// IP limiter, which is too permissive for paid AI calls.
const aiRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many AI requests. Please wait a moment before trying again." },
  keyGenerator: (req) => req.userId || req.socket.remoteAddress || "unknown",
  skip: (req) => req.hostname === "localhost" || req.hostname === "127.0.0.1" || process.env.DISABLE_RATE_LIMIT === "true",
});

/**
 * Key management router (mounted at `/api/developer`).
 * Uses the app's own Firebase-session auth (`requireAuth`) — a signed-in user
 * manages keys for their own account. The secret is returned exactly once.
 */
export const developerKeysRouter = express.Router();

developerKeysRouter.get("/keys", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;
    const keys = await storage.developerApiKeys.getByUser(userId);
    const now = Date.now();
    res.json({
      keys: keys
        .filter((k) => !k.revokedAt)
        .map((k) => ({
          id: k.id,
          name: k.name,
          keyPrefix: k.keyPrefix,
          lastUsedAt: k.lastUsedAt ?? null,
          createdAt: k.createdAt,
          expiresAt: k.expiresAt ?? null,
          expired: Boolean(k.expiresAt && new Date(k.expiresAt).getTime() < now),
        })),
    });
  } catch (error: any) {
    console.error("[developer-api] List keys error:", error);
    res.status(500).json({ error: "We had trouble loading your API keys." });
  }
});

developerKeysRouter.post("/keys", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;
    const name = (typeof req.body?.name === "string" && req.body.name.trim()) || "Untitled key";
    const { key, keyHash, keyPrefix } = generateApiKey();
    const id = `devkey_${randomUUID()}`;
    const now = new Date().toISOString();

    // Expiry: default 90 days (GitHub posture). "never" / null = no expiry.
    const daysRaw = req.body?.expiresInDays;
    let expiresAt: string | null;
    if (daysRaw === "never" || daysRaw === null) {
      expiresAt = null;
    } else {
      const days = Number(daysRaw);
      const n = Number.isFinite(days) && days > 0 ? days : 90;
      expiresAt = new Date(Date.now() + n * 86400000).toISOString();
    }

    await storage.developerApiKeys.create({
      id,
      userId,
      name: name.slice(0, 80),
      keyPrefix,
      keyHash,
      createdAt: now,
      updatedAt: now,
      expiresAt: expiresAt ?? undefined,
    });
    // The full secret is returned only here and never stored.
    res.status(201).json({ id, name, keyPrefix, key, createdAt: now, expiresAt: expiresAt ?? null });
  } catch (error: any) {
    console.error("[developer-api] Create key error:", error);
    res.status(500).json({ error: "We had trouble creating your API key." });
  }
});

developerKeysRouter.delete("/keys/:id", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;
    const id = req.params.id as string;
    const existing = await storage.developerApiKeys.get(id);
    if (!existing || existing.userId !== userId) {
      return res.status(404).json({ error: "API key not found." });
    }
    if (existing.revokedAt) {
      return res.status(409).json({ error: "API key is already revoked." });
    }
    await storage.developerApiKeys.update(id, { revokedAt: new Date().toISOString() });
    res.json({ ok: true, id });
  } catch (error: any) {
    console.error("[developer-api] Revoke key error:", error);
    res.status(500).json({ error: "We had trouble revoking your API key." });
  }
});

/**
 * Public REST API (mounted at `/api/v1`).
 * Every route authenticates via a Proset API key.
 */
export const developerApiRouter = express.Router();

developerApiRouter.get("/me", apiKeyAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;
    const [user, usage] = await Promise.all([
      storage.users.get(userId),
      getUserUsageSummary(userId),
    ]);
    if (!user) {
      return res.status(404).json({ error: "User not found." });
    }
    res.json({
      id: user.id,
      email: user.email,
      name: user.name,
      firstName: user.firstName,
      country: user.country ?? null,
      tier: usage.tier,
      displayTier: usage.displayTier,
      usage: {
        tokenBalance: usage.tokenBalance,
        monthlyTokenAllowance: usage.monthlyTokenAllowance,
        tokensUsedThisMonth: usage.tokensUsedThisMonth,
        storageMb: usage.storageMb,
        maxRecordingSeconds: usage.maxRecordingSeconds,
        maxFileImportMB: usage.maxFileImportMB,
        proAccessEnabled: usage.proAccessEnabled,
      },
    });
  } catch (error: any) {
    console.error("[developer-api] /me error:", error);
    res.status(500).json({ error: "We had trouble loading your profile." });
  }
});

developerApiRouter.get("/usage", apiKeyAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;
    const usage = await getUserUsageSummary(userId);
    res.json(usage);
  } catch (error: any) {
    console.error("[developer-api] /usage error:", error);
    res.status(500).json({ error: "We had trouble loading your usage." });
  }
});

developerApiRouter.get("/recordings", apiKeyAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;
    const page = req.query.page ? parseInt(req.query.page as string, 10) : undefined;
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
    const search = req.query.search as string | undefined;
    if (page || limit || search) {
      const pageNum = page && Number.isFinite(page) && page > 0 ? page : 1;
      const limitNum = Math.min(limit && Number.isFinite(limit) && limit > 0 ? limit : 50, 100);
      const result = await storage.getRecordingsByUserPaginated(userId, {
        page: pageNum,
        limit: limitNum,
        search,
      });
      res.json({
        recordings: result.recordings,
        total: result.total,
        page: pageNum,
        limit: limitNum,
        hasMore: pageNum * limitNum < result.total,
      });
    } else {
      const recordings = await storage.getRecordingsByUser(userId);
      res.json({ recordings, total: recordings.length });
    }
  } catch (error: any) {
    console.error("[developer-api] /recordings error:", error);
    res.status(500).json({ error: "We had trouble loading your recordings." });
  }
});

developerApiRouter.get("/recordings/:id", apiKeyAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;
    const recording = await storage.getRecording(req.params.id as string, userId);
    if (!recording) {
      return res.status(404).json({ error: "Recording not found." });
    }
    res.json(recording);
  } catch (error: any) {
    console.error("[developer-api] /recordings/:id error:", error);
    res.status(500).json({ error: "We had trouble loading that recording." });
  }
});

developerApiRouter.get("/thought-threads", apiKeyAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;
    const threads = await storage.thoughtThreads.getByUser(userId);
    res.json({ threads });
  } catch (error: any) {
    console.error("[developer-api] /thought-threads error:", error);
    res.status(500).json({ error: "We had trouble loading your Thought Threads." });
  }
});

developerApiRouter.get("/thought-threads/:id", apiKeyAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;
    const thread = await storage.thoughtThreads.get(req.params.id as string, userId);
    if (!thread) {
      return res.status(404).json({ error: "Thought Thread not found." });
    }
    const [items, contexts] = await Promise.all([
      storage.thoughtThreadItems.getByThread(thread.id, userId),
      storage.thoughtThreadContexts.getByThread(thread.id, userId),
    ]);
    res.json({ thread, items, contexts });
  } catch (error: any) {
    console.error("[developer-api] /thought-threads/:id error:", error);
    res.status(500).json({ error: "We had trouble loading that Thought Thread." });
  }
});

developerApiRouter.get("/folders", apiKeyAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;
    const folders = await storage.userFolders.getByUser(userId);
    res.json({ folders });
  } catch (error: any) {
    console.error("[developer-api] /folders error:", error);
    res.status(500).json({ error: "We had trouble loading your folders." });
  }
});

developerApiRouter.get("/knowledge-bases", apiKeyAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;
    const knowledgeBases = await storage.userKnowledgebases.getByUser(userId);
    res.json({ knowledgeBases });
  } catch (error: any) {
    console.error("[developer-api] /knowledge-bases error:", error);
    res.status(500).json({ error: "We had trouble loading your knowledge bases." });
  }
});

developerApiRouter.post("/transcribe", apiKeyAuth, aiRateLimiter, upload.single("audio"), async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;
    let fileBuffer: Buffer;
    let fileName: string;
    if (req.file) {
      fileBuffer = req.file.buffer;
      fileName = req.file.originalname || "audio.webm";
    } else if (typeof req.body?.audio_base64 === "string" && req.body.audio_base64) {
      fileBuffer = Buffer.from(req.body.audio_base64, "base64");
      fileName = typeof req.body?.filename === "string" ? req.body.filename : "audio.webm";
    } else {
      return res.status(400).json({
        error: "missing_audio",
        message: "Provide an audio file (multipart field `audio`) or a `audio_base64` JSON field.",
      });
    }

    const language = typeof req.body?.language === "string" ? req.body.language : undefined;
    const prompt = typeof req.body?.prompt === "string" ? req.body.prompt : undefined;

    const durationSeconds = await estimateAudioDurationSeconds(fileBuffer);
    const limitCheck = await checkTranscriptionLimit(userId, durationSeconds);
    if (!limitCheck.allowed) {
      return res.status(429).json({
        error: "insufficient_tokens",
        message: "You've used your monthly AI Credits. Upgrade for more credits — they reset each month.",
      });
    }

    const result = await transcribeAudioLatencyFirst({ fileBuffer, fileName, language, prompt });
    const formatted = paragraphizeTranscript(result.text);

    await deductTranscriptionTokens(userId, durationSeconds);

    res.json({ text: formatted, provider: result.provider, model: result.model });
  } catch (error: any) {
    console.error("[developer-api] /transcribe error:", error);
    res.status(500).json({ error: "We had trouble transcribing that audio." });
  }
});

developerApiRouter.post("/convert", apiKeyAuth, aiRateLimiter, async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;
    const result = await runCoreConversion(userId, {
      transcript: req.body?.transcript,
      type: req.body?.type,
      customPrompt: req.body?.customPrompt,
      citationStyle: req.body?.citationStyle,
      bibliographyType: req.body?.bibliographyType,
      outputFormat: req.body?.outputFormat === "plain" ? "plain" : "markdown",
      language: req.body?.language === "es" ? "es" : "en",
      confirmExtendedAccess: req.body?.confirmExtendedAccess === true || req.body?.confirmExtendedAccess === "true",
    });
    res.json(result);
  } catch (error: any) {
    console.error("[developer-api] /convert error:", error);
    const status = error?.status || 500;
    // Machine-readable error, matching the /transcribe contract: a stable code
    // plus a human message, with plan-specific fields where applicable.
    const body: Record<string, unknown> = {
      error: error?.code || "conversion_failed",
      message: error?.message || "We had trouble converting your text.",
    };
    if (error?.unitCost !== undefined) body.unitCost = error.unitCost;
    if (error?.requiredTier !== undefined) body.requiredTier = error.requiredTier;
    res.status(status).json(body);
  }
});
