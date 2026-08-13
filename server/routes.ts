import type { Express, Request, Response } from "express";
import express from "express";
import { createServer, type Server } from "node:http";
import { randomBytes, randomUUID } from "node:crypto";
import { toFile } from "openai";
import multer from "multer";
import Tesseract from "tesseract.js";
import * as fs from "fs";
import * as path from "path";
import { Document, Packer, Paragraph, TextRun, HeadingLevel } from "docx";
import { generateMarkdownPdf } from "./pdf-generator";
import { generateSpreadsheetXlsx } from "./spreadsheet-service";
import { requireAuth, getSessionFromRequest } from "./auth";
import { auth as adminAuth, firebaseAuthMode } from "./firebase-admin";
import { storage } from "./storage";
import {
  SkillDefinition,
  parseSkillContent,
  serializeSkillContent,
  type KnowledgebaseResource,
  type ThoughtThreadConversionRun,
} from "@shared/schema";
import { stripeService } from "./stripe-service";
import { trackEvent } from "./analytics-service";
import {
  getAllProviders,
  getBackupLogs,
  addProvider,
  updateProvider,
  removeProvider,
  testProviderConnection,
  backupRecordingFiles,
  toPublicBackupProvider,
  type ProviderType,
} from "./backup-service";
import {
  getAllTaskProviders,
  addTaskProvider,
  updateTaskProvider,
  removeTaskProvider,
  testTaskProvider,
  exportTasks,
  parseTodoMarkdown,
  toPublicTaskProvider,
  type TaskProviderType,
} from "./task-service";
import {
  parseEventJson,
  generateIcsContent,
  generateGoogleCalendarUrl,
  generateOutlookCalendarUrl,
  getAllCalendarProviders,
  addCalendarProvider,
  updateCalendarProvider,
  removeCalendarProvider,
  exportToCalendarProvider,
  toPublicCalendarProvider,
  type CalendarProviderType,
} from "./calendar-service";
import {
  getAvailableConnectorsForUser,
  getRelevantConnectorsForUser,
  exportToConnector,
  getUserConnectorProviders,
  addConnectorProvider,
  removeConnectorProvider,
  toPublicConnectorProvider,
  type ConnectorType,
} from "./connector-service";
import { checkLimit, incrementUsage, reportExtendedAccessIfNeeded, getUserUsageSummary, getStorageLimit, MAX_RECORDING_SECONDS, BETA_LIMITS, getMaxFileImportSize, isConversionTypeAllowed, getUserTier, FREE_CONVERSION_TYPES, getAllowedFileTypes, getRequiredTierForFileType, TIER_CONVERSION_TYPES, getUserModules, MODULE_CONVERSION_TYPES, ALL_MODULE_TYPES, getMaxItems, getSelfServiceModuleState, getSelfServiceModulesForUser } from "./usage-service";
import { CONVERSION_COMPLEXITY_MAP } from "../lib/utils";
import { registerBucketRoutes } from "./bucket-routes";
import { registerKbRoutes } from "./kb-routes";
import { deleteAllUserBucketFiles, deleteFile as deleteBucketObject } from "./object-storage";
import { deleteAuthUserIfPresent } from "./account-deletion-service";
import { sanitizeConversionOutput, sanitizePromptContextForTarget } from "./conversion-post-processor";
import { createOpenAIClient, getAIModel, getChatCompletionTokenOptions, hasDedicatedAIProviderConfig } from "./openai-client";
import {
  getConfiguredConversionModelCatalog,
  resolveConversionModelRouteChain,
  type UserConversionModelPreferences,
  type UserSelectableConversionModelId,
  type ConversionModelRoute,
} from "./conversion-model-routing";
import { getUpdateLogEntries } from "./update-log";
import { sendPasswordResetEmail, addEmailToWaitlist } from "./email-service";
import type { UserRole } from "./password-policy";
import { getDeploymentInfo } from "./deployment-info";
import { validateEmailAddress } from "@shared/email-validation";
import aiCustomizationRouter from "./modules/ai-customization/router";
import recordingsRouter from "./modules/recordings/router";
import slideDeckRouter from "./modules/slide-deck/router";

import thoughtThreadsRouter from "./modules/thought-threads/router";
import {
  beginThoughtThreadRunConversion,
  failThoughtThreadRun,
  finalizeThoughtThreadRun,
  loadRunConversionSource,
} from "./modules/thought-threads/service";
import { 
  GENEROUS_PARSING_PREAMBLE, 
  CONVERSION_PROMPTS, 
  CONVERSION_SKILLS, 
  CONVERSION_KNOWLEDGEBASES,
  ACADEMIC_CITATION_PROMPTS,
  BIBLIOGRAPHY_PROMPTS,
  BIBLIOGRAPHY_ANNOTATED_INSTRUCTIONS,
  LEARNING_CATEGORIES,
  formatSkillForPrompt,
} from "./modules/ai-customization/prompts";
import { getUserConversionModelPreferences } from "./modules/ai-customization/utils";
import { ensureSystemFolders } from "./modules/recordings/utils";

const openai = createOpenAIClient();

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 500 * 1024 * 1024 } });

// Types that produce structured non-Markdown output (JSON, CSV) or must be plain text for downstream consumers.
// These are excluded from the positive markdown format instruction.
const STRUCTURED_OUTPUT_TYPES = new Set([
  "calendar_event", // JSON array
  "spreadsheet",    // CSV
  "github_issue",   // structured title/body format
  "video_script",   // plain spoken text for TTS/ElevenLabs
  "text_message",   // SMS – no markdown
]);

type RouteUser = NonNullable<Request["user"]>;

function getRequiredRouteUser(req: Request): RouteUser {
  if (!req.user) {
    throw new Error("Authenticated user missing");
  }
  return req.user;
}

function getRequiredRouteUserId(req: Request): string {
  if (!req.userId) {
    throw new Error("Authenticated user ID missing");
  }
  return req.userId;
}

function getRouteParam(value: string | string[] | undefined, name: string): string {
  if (typeof value === "string" && value) return value;
  if (Array.isArray(value) && typeof value[0] === "string" && value[0]) return value[0];
  throw new Error(`${name} is required`);
}

function getPublicAppBaseUrl(): string {
  const configured = String(process.env.PUBLIC_APP_URL || "").trim();
  if (configured) {
    return configured.replace(/\/$/, "");
  }
  const domain = String(process.env.AIFORMS_PUBLIC_DOMAIN || "").trim();
  if (domain) {
    return `https://${domain.replace(/^https?:\/\//, "").replace(/\/$/, "")}`;
  }
  return "https://proset.ai";
}

function createTemporaryAccountPassword(): string {
  return `Barry_${randomBytes(18).toString("base64url")}A1!`;
}

// (AI constants and model preference helpers moved to server/modules/ai-customization)

async function runReflection(userId: string, conversionType: string, transcript: string, conversionOutput: string) {
  try {
    const existingLearnings = (await storage.userLearnings.getByUser(userId))
      .sort((a, b) => new Date(b.updatedAt || b.createdAt).getTime() - new Date(a.updatedAt || a.createdAt).getTime())
      .slice(0, 30);

    const recentFeedback = (await storage.stylePreferences.getByUser(userId))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 10);

    const existingInsights = existingLearnings.map((l) =>
      `[id: ${l.id}] [${l.category}${l.conversionType ? ` / ${l.conversionType}` : ""}] ${l.insight} (confidence: ${l.confidence})`
    ).join("\n");

    const feedbackText = recentFeedback.map((f) => `- [${f.conversionType}] ${f.feedback}`).join("\n");

    const reflectionPrompt = `You are a learning system that builds a persistent profile of a user based on their voice transcripts and conversion outputs. Your job is to extract durable, reusable insights — things that will help future conversions be better tailored to this person.

EXISTING LEARNINGS ABOUT THIS USER (with IDs):
${existingInsights || "(none yet)"}

RECENT USER FEEDBACK ON CONVERSIONS:
${feedbackText || "(none)"}

LATEST TRANSCRIPT (what the user said):
${transcript.slice(0, 2000)}

CONVERSION OUTPUT (${conversionType}):
${conversionOutput.slice(0, 1500)}

CATEGORIES TO ANALYZE:
${Object.entries(LEARNING_CATEGORIES).map(([k, v]) => `- ${k}: ${v}`).join("\n")}

INSTRUCTIONS:
1. Analyze the transcript and output for patterns worth remembering about this user.
2. Look for: speaking patterns, preferred tone, domain expertise, recurring topics, formatting preferences.
3. CRITICALLY compare with existing learnings before adding anything new:
   - If an existing learning already captures the same idea (even in different words), use "reinforce" with that learning's ID — do NOT add a near-duplicate.
   - Only use "add" for genuinely NEW insights not covered by any existing learning.
4. Do NOT store one-time facts or content from a single recording. Only store durable patterns.
5. Prefer general insights (conversionType: null) unless the pattern is clearly type-specific.
6. Return a JSON array of insights. Each object must have:
   - "category": one of ${Object.keys(LEARNING_CATEGORIES).join(", ")}
   - "conversionType": the specific type this applies to, or null if general
   - "insight": a concise, actionable observation (max 150 chars)
   - "action": "add" for new insights, "reinforce" to strengthen an existing one (include "existingId"), or "none" if nothing new
   - "existingId": (only for "reinforce") the id of the existing learning being reinforced

If there are no meaningful new patterns to learn, return: []
Return ONLY the JSON array, no other text.`;

    const response = await openai.chat.completions.create({
      model: "gpt-5.4-mini",
      messages: [
        { role: "system", content: reflectionPrompt },
      ],
      max_completion_tokens: 800,
      temperature: 0.3,
    });

    const raw = response.choices[0]?.message?.content?.trim() || "[]";
    let insights: any[];
    try {
      const cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      insights = JSON.parse(cleaned);
    } catch {
      return;
    }

    if (!Array.isArray(insights)) return;

    for (const insight of insights) {
      if (!insight.category || !insight.insight || !LEARNING_CATEGORIES[insight.category as keyof typeof LEARNING_CATEGORIES]) continue;

      if (insight.action === "reinforce" && insight.existingId) {
        const existing = existingLearnings.find(l => l.id === insight.existingId);
        if (existing) {
          await storage.userLearnings.update(existing.id, {
            confidence: Math.min((existing.confidence || 0) + 1, 10),
            updatedAt: new Date().toISOString() as any,
          });
        }
      } else if (insight.action === "add") {
        const learningsList = await storage.userLearnings.getByUser(userId);
        if (learningsList.length >= 50) {
          const sorted = [...learningsList].sort((a, b) => {
            if (a.confidence !== b.confidence) return a.confidence - b.confidence;
            return new Date(a.updatedAt || a.createdAt).getTime() - new Date(b.updatedAt || b.createdAt).getTime();
          });
          const toDelete = sorted[0];
          if (toDelete) {
            await storage.userLearnings.delete(toDelete.id);
          }
        }

        await storage.userLearnings.create({
          id: `learn_${Math.random().toString(36).substring(2, 11)}`,
          userId,
          category: insight.category,
          conversionType: insight.conversionType || null,
          insight: insight.insight.slice(0, 300),
          confidence: 1,
          source: "reflection",
          createdAt: new Date().toISOString() as any,
          updatedAt: new Date().toISOString() as any,
        });
      }
    }
  } catch (err) {
    console.error("Reflection error (non-blocking):", err);
  }
}

async function getUserLearningsContext(userId: string, conversionType: string): Promise<string> {
  const learnings = (await storage.userLearnings.getByUser(userId))
    .sort((a, b) => {
      if (b.confidence !== a.confidence) return b.confidence - a.confidence;
      return new Date(b.updatedAt || b.createdAt).getTime() - new Date(a.updatedAt || a.createdAt).getTime();
    })
    .slice(0, 30);

  if (learnings.length === 0) return "";

  const typeLearnings = learnings.filter((l) => l.conversionType === conversionType);
  const generalLearnings = learnings.filter((l) => !l.conversionType);
  const crossTypeLearnings = learnings.filter((l) =>
    l.conversionType && l.conversionType !== conversionType &&
    ["style_preference", "tone_preference", "speech_pattern"].includes(l.category)
  ).slice(0, 5);

  const lines: string[] = [];
  if (typeLearnings.length > 0) {
    lines.push(`Specific to "${conversionType.replace(/_/g, " ")}" conversions:`);
    for (const l of typeLearnings) {
      lines.push(`  - [${l.category}] ${l.insight}`);
    }
  }
  if (generalLearnings.length > 0) {
    lines.push(`General patterns:`);
    for (const l of generalLearnings) {
      lines.push(`  - [${l.category}] ${l.insight}`);
    }
  }
  if (crossTypeLearnings.length > 0) {
    lines.push(`Also observed in other conversions:`);
    for (const l of crossTypeLearnings) {
      lines.push(`  - [${l.category}] ${l.insight}`);
    }
  }

  if (lines.length === 0) return "";

  return `\n\nUSER MEMORY (persistent learnings about this user — apply these to produce output that matches their preferences and communication style):\n${lines.join("\n")}`;
}

import { bugReportRouter } from "./bug-report";

export async function registerRoutes(app: Express): Promise<Server> {
  app.use("/api/bugs", bugReportRouter);

  app.use("/api", aiCustomizationRouter);
  app.use("/api", recordingsRouter);
  app.use("/api", slideDeckRouter);
  app.use("/api", thoughtThreadsRouter);
  app.get("/api/usage", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.userId!;
      const summary = await getUserUsageSummary(userId);
      res.json(summary);
    } catch (error: any) {
      res.status(500).json({ error: "We had trouble loading your usage info. Please try again." });
    }
  });

  // Legacy recordings may still point at files in audio-uploads. Keep those
  // recordings playable without exposing the directory as a public static
  // mount: the requested path must belong to one of the signed-in user's
  // recordings before the file is read.
  app.get("/api/audio-files/*key", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = getRequiredRouteUserId(req);
      const keyParam = req.params.key;
      let relativePath = Array.isArray(keyParam) ? keyParam.join("/") : keyParam;
      try {
        relativePath = decodeURIComponent(relativePath);
      } catch {
        return res.status(404).json({ error: "File not found." });
      }

      if (!relativePath || relativePath.includes("\0") || relativePath.split("/").includes("..")) {
        return res.status(404).json({ error: "File not found." });
      }

      const requestedUri = `/api/audio-files/${relativePath}`;
      const normalizeAudioUri = (audioUri: unknown): string => {
        if (typeof audioUri !== "string" || !audioUri.trim()) return "";
        try {
          const parsed = new URL(audioUri, "http://proset.local");
          if (!parsed.pathname.startsWith("/api/audio-files/")) return "";
          return decodeURIComponent(parsed.pathname);
        } catch {
          return "";
        }
      };
      const recordings = await storage.getRecordingsByUser(userId);
      const ownsFile = recordings.some((recording) => normalizeAudioUri(recording.audioUri) === requestedUri);
      if (!ownsFile) {
        return res.status(404).json({ error: "File not found." });
      }

      const audioUploadsDir = path.resolve(process.cwd(), "audio-uploads");
      const filePath = path.resolve(audioUploadsDir, relativePath);
      if (filePath !== audioUploadsDir && !filePath.startsWith(`${audioUploadsDir}${path.sep}`)) {
        return res.status(404).json({ error: "File not found." });
      }

      const realUploadsDir = await fs.promises.realpath(audioUploadsDir).catch(() => null);
      const realFilePath = await fs.promises.realpath(filePath).catch(() => null);
      if (!realUploadsDir || !realFilePath) {
        return res.status(404).json({ error: "File not found." });
      }
      const relativeRealPath = path.relative(realUploadsDir, realFilePath);
      if (!relativeRealPath || relativeRealPath.startsWith("..") || path.isAbsolute(relativeRealPath)) {
        return res.status(404).json({ error: "File not found." });
      }

      const fileInfo = await fs.promises.stat(realFilePath).catch(() => null);
      if (!fileInfo?.isFile()) {
        return res.status(404).json({ error: "File not found." });
      }

      res.type(realFilePath);
      res.setHeader("Cache-Control", "private, max-age=3600");
      return fs.createReadStream(realFilePath).pipe(res);
    } catch (error) {
      console.error("Legacy audio file error:", error);
      return res.status(500).json({ error: "We had trouble loading that recording. Please try again." });
    }
  });

  app.post("/api/convert/clarify", requireAuth, async (req: Request, res: Response) => {
    try {
      let {
        transcript,
        type,
        customPrompt,
        citationStyle,
        bibliographyType,
        language: reqLanguage,
        sourceThoughtThreadId,
        sourceThoughtThreadRunId,
      } = req.body;
      const clarifyUserId = req.userId!;
      if (sourceThoughtThreadId || sourceThoughtThreadRunId) {
        if (!sourceThoughtThreadId || !sourceThoughtThreadRunId) {
          return res.status(400).json({
            error: "A Thought Thread clarification requires both its thread ID and run ID.",
          });
        }
        const run = await storage.thoughtThreadRuns.get(
          String(sourceThoughtThreadRunId),
          String(sourceThoughtThreadId),
          clarifyUserId,
        );
        if (!run) return res.status(404).json({ error: "Conversion run not found." });
        if (run.status !== "prepared") {
          return res.status(409).json({ error: "This conversion run is not ready for clarification." });
        }
        transcript = await loadRunConversionSource(run);
        type = run.conversionType;
        customPrompt = run.customPrompt || undefined;
        citationStyle = run.citationStyle || undefined;
        bibliographyType = run.bibliographyType || undefined;
        reqLanguage = run.language || reqLanguage;
      }

      if (!transcript || !type) {
        return res.status(400).json({ error: "Please provide some text and choose a conversion type." });
      }
      if (customPrompt && typeof customPrompt === "string" && customPrompt.length > 5000) {
        return res.status(400).json({ error: "Custom prompt is too long (max 5,000 characters)." });
      }

      const typeCheck = await isConversionTypeAllowed(clarifyUserId, type);
      if (!typeCheck.allowed) {
        return res.status(403).json({
          error: "conversion_type_locked",
          tier: typeCheck.tier,
          requiredTier: typeCheck.requiredTier,
          requiredModule: typeCheck.requiredModule,
          moduleEligible: typeCheck.moduleEligible,
          moduleEnabled: typeCheck.moduleEnabled,
          allowedTypes: TIER_CONVERSION_TYPES[typeCheck.tier],
        });
      }

      let defaultPrompt: string | undefined;
      if (type === "academic_research") {
        defaultPrompt = citationStyle && ACADEMIC_CITATION_PROMPTS[citationStyle]
          ? ACADEMIC_CITATION_PROMPTS[citationStyle]
          : ACADEMIC_CITATION_PROMPTS["apa7"];
      } else if (type === "bibliography") {
        const style = citationStyle && BIBLIOGRAPHY_PROMPTS[citationStyle] ? citationStyle : "apa7";
        defaultPrompt = BIBLIOGRAPHY_PROMPTS[style];
        if (bibliographyType === "annotated") {
          defaultPrompt = defaultPrompt + BIBLIOGRAPHY_ANNOTATED_INSTRUCTIONS;
        }
      } else {
        defaultPrompt = CONVERSION_PROMPTS[type];
      }
      if (!defaultPrompt) {
        return res.status(400).json({ error: `Invalid conversion type: ${type}` });
      }

      const systemPrompt = customPrompt && customPrompt.trim() ? customPrompt.trim() : defaultPrompt;

      const complexity = CONVERSION_COMPLEXITY_MAP[type] || "simple";
      let countInstruction = "If mildly ambiguous, ask 1 extremely brief question (max 10-15 words). If significantly ambiguous, ask 2. Never ask more than 2. Format as a numbered list in the \"question\" string. ALWAYS provide 2-3 short, likely answer options as \"options\" so the user can answer by tapping. Ask about:";
      let questionPlaceholder = "Your single short question?";
      
      if (complexity === "intermediate") {
        countInstruction = "Ask 2 extremely brief questions (max 10-15 words each) if mildly ambiguous, 3 if significantly ambiguous. Format them together as a numbered list in the \"question\" string. ALWAYS provide 2-3 short, likely answer options as \"options\" so the user can answer by tapping (they cover the question set). Ask about:";
        questionPlaceholder = "1. First short question?\\n2. Second short question?";
      } else if (complexity === "advanced") {
        countInstruction = "Ask 3 extremely brief questions (max 10-15 words each). Format them together as a numbered list in the \"question\" string. ALWAYS provide 2-3 short, likely answer options as \"options\" so the user can answer by tapping (they cover the question set). Ask about:";
        questionPlaceholder = "1. First short question?\\n2. Second short question?\\n3. Third short question?";
      }

      const langInstruction = reqLanguage === "es" ? `\nIMPORTANT: Write all questions in natural Mexican Spanish. Be warm and direct.` : "";
      const clarifyPrompt = `Review this content for ambiguities that would hurt a "${type}" conversion. The content may be prose text, a voice transcript, or tabular/CSV data. Reply ONLY with JSON.

If the content is clear enough to convert confidently WITHOUT asking: {"hasQuestions":false,"question":"","options":[]}
Only ask when a wrong assumption would materially change the output. Then: {"hasQuestions":true,"question":"${questionPlaceholder}","options":["Option 1","Option 2"]}

${countInstruction}
- For text/transcripts: unclear names/acronyms, ambiguous dates/times/places, vague references that change meaning.
- For tabular/CSV data: which columns are most relevant, what the data represents if unclear, how to interpret ambiguous values, what specific analysis or output the user wants.
Be concise. When in doubt, prefer NOT asking — converting with reasonable assumptions beats interrupting the user.${langInstruction}`;

      const timeoutMs = sourceThoughtThreadId ? 30_000 : 12_000;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const clarifyPreferences = await getUserConversionModelPreferences(clarifyUserId);
        const clarifyChain = resolveConversionModelRouteChain(type, clarifyPreferences);
        // Judge on the fastest available model: ambiguity classification is a
        // cheap task and Groq's LPU answers in well under a second, so the
        // pre-conversion check stays nearly invisible. Falls back to the
        // conversion's primary route when Groq isn't configured.
        const clarifyRoute = hasDedicatedAIProviderConfig("groq")
          ? { provider: "groq" as const, model: getAIModel("groq") }
          : clarifyChain.routes[0];
        const clarifyClient = createOpenAIClient(clarifyRoute.provider);
        const response = await clarifyClient.chat.completions.create({
          model: clarifyRoute.model,
          messages: [
            { role: "system", content: clarifyPrompt },
            { role: "user", content: transcript },
          ],
          ...getChatCompletionTokenOptions(clarifyRoute.provider, 300),
        }, { signal: controller.signal });

        clearTimeout(timer);

        const raw = response.choices[0]?.message?.content?.trim() || "";
        const jsonMatch = raw.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          return res.json({
            hasQuestions: !!parsed.hasQuestions,
            question: typeof parsed.question === "string" ? parsed.question : (Array.isArray(parsed.questions) ? parsed.questions[0] : ""),
            options: Array.isArray(parsed.options) ? parsed.options.slice(0, 3) : [],
          });
        }
      } catch (timeoutErr: any) {
        clearTimeout(timer);
        if (timeoutErr?.name === "AbortError") {
          console.log("Clarify timed out, skipping questions");
          return res.json({ hasQuestions: false, question: "", options: [] });
        }
        throw timeoutErr;
      }

      res.json({ hasQuestions: false, question: "", options: [] });
    } catch (error: any) {
      console.error("Clarify error:", error);
      res.json({ hasQuestions: false, question: "", options: [] });
    }
  });

  app.post("/api/convert", requireAuth, async (req: Request, res: Response) => {
    let activeThoughtThreadRun: { id: string; threadId: string } | null = null;
    let activeThoughtThreadRunRecord: ThoughtThreadConversionRun | null = null;
    let thoughtThreadUsageReserved = false;
    try {
      let {
        transcript,
        type,
        customPrompt,
        citationStyle,
        bibliographyType,
        clarifications,
        outputFormat,
        timezone,
        language: reqLanguage,
        sourceThoughtThreadId,
        sourceThoughtThreadRunId,
      } = req.body;
      const convUserId = req.userId!;

      if (sourceThoughtThreadId || sourceThoughtThreadRunId) {
        if (!sourceThoughtThreadId || !sourceThoughtThreadRunId) {
          return res.status(400).json({
            error: "A Thought Thread conversion requires both its thread ID and run ID.",
          });
        }
        const run = await storage.thoughtThreadRuns.get(
          String(sourceThoughtThreadRunId),
          String(sourceThoughtThreadId),
          convUserId,
        );
        if (!run) return res.status(404).json({ error: "Conversion run not found." });
        activeThoughtThreadRunRecord = run;
        thoughtThreadUsageReserved =
          run.usageStatus === "reserved"
          || (run.usageStatus === undefined && run.usageReserved === true);
        type = run.conversionType;
        citationStyle = run.citationStyle || undefined;
        bibliographyType = run.bibliographyType || undefined;
        outputFormat = run.outputFormat || "markdown";
        reqLanguage = run.language || reqLanguage;
        customPrompt = run.customPrompt || undefined;
        clarifications = run.clarificationQuestion && run.clarificationAnswer
          ? [{ question: run.clarificationQuestion, answer: run.clarificationAnswer }]
          : undefined;
        transcript = "[SERVER-OWNED THOUGHT THREAD SOURCE]";
      }

      if (!transcript || !type) {
        return res.status(400).json({ error: "Please provide some text and choose a conversion type." });
      }
      if (customPrompt && typeof customPrompt === "string" && customPrompt.length > 5000) {
        return res.status(400).json({ error: "Custom prompt is too long (max 5,000 characters)." });
      }

      const limitCheck = thoughtThreadUsageReserved
        ? null
        : await checkLimit(convUserId, "conversion", type);
      if (limitCheck && !limitCheck.allowed) {
        if (limitCheck.spendingCapReached) {
          return res.status(429).json({
            error: "spending_cap_reached",
            message: "You've reached your monthly spending cap for Pro plan overages.",
            current: limitCheck.current,
            limit: limitCheck.limit,
            extendedCostSoFar: limitCheck.extendedCostSoFar,
          });
        }
        return res.status(429).json({
          error: "monthly_limit_reached",
          message: `You've used all ${limitCheck.limit} included conversions this month. Upgrade to Base for more included conversions or Pro for uninterrupted overage access.`,
          current: limitCheck.current,
          limit: limitCheck.limit,
        });
      }
      if (limitCheck?.isExtendedAccess && !limitCheck.proAccessEnabled && !req.body?.confirmExtendedAccess) {
        return res.status(402).json({
          error: "pro_access_required",
          actionType: "conversion",
          unitCost: limitCheck.extendedUnitCost,
          current: limitCheck.current,
          limit: limitCheck.limit,
          extendedCostSoFar: limitCheck.extendedCostSoFar,
          pricing: { transcription: 0.15, conversion: 0.10 },
        });
      }

      const typeCheck = await isConversionTypeAllowed(convUserId, type);
      if (!typeCheck.allowed) {
        return res.status(403).json({
          error: "conversion_type_locked",
          tier: typeCheck.tier,
          requiredTier: typeCheck.requiredTier,
          requiredModule: typeCheck.requiredModule,
          moduleEligible: typeCheck.moduleEligible,
          moduleEnabled: typeCheck.moduleEnabled,
          allowedTypes: TIER_CONVERSION_TYPES[typeCheck.tier],
        });
      }

      if (sourceThoughtThreadId && sourceThoughtThreadRunId) {
        const begun = await beginThoughtThreadRunConversion(
          String(sourceThoughtThreadRunId),
          String(sourceThoughtThreadId),
          convUserId,
        );
        activeThoughtThreadRun = { id: begun.run.id, threadId: begun.run.threadId };
        activeThoughtThreadRunRecord = begun.run;
        transcript = begun.source;
      }

      let defaultPrompt: string | undefined;

      if (type === "academic_research") {
        const effectiveStyle = (citationStyle && ACADEMIC_CITATION_PROMPTS[citationStyle]) ? citationStyle : "apa7";
        defaultPrompt = ACADEMIC_CITATION_PROMPTS[effectiveStyle];
      } else if (type === "bibliography") {
        const effectiveStyle = (citationStyle && BIBLIOGRAPHY_PROMPTS[citationStyle]) ? citationStyle : "apa7";
        defaultPrompt = BIBLIOGRAPHY_PROMPTS[effectiveStyle];
        if (bibliographyType === "annotated") {
          defaultPrompt = defaultPrompt + BIBLIOGRAPHY_ANNOTATED_INSTRUCTIONS;
        }
      } else {
        defaultPrompt = CONVERSION_PROMPTS[type];
      }

      if (!defaultPrompt) {
        return res.status(400).json({ error: `Invalid conversion type: ${type}` });
      }

      const basePrompt = customPrompt && customPrompt.trim() ? customPrompt.trim() : defaultPrompt;

      const userTz = timezone && typeof timezone === "string" ? timezone : "UTC";
      const now = new Date();
      const dateLocale = reqLanguage === "es" ? "es-MX" : "en-US";
      const dateContext = `\n\nCONTEXT — Current date and time: ${now.toLocaleDateString(dateLocale, { weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: userTz })} at ${now.toLocaleTimeString(dateLocale, { hour: "2-digit", minute: "2-digit", timeZoneName: "short", timeZone: userTz })}. Use this for any time-sensitive content such as deadlines, scheduling, calendar events, or date references.`;

      const typeLabel = type.replace(/_/g, " ");

      let userProfileContext = "";
      let styleContext = "";
      let historyContext = "";
      let skillContext = "";
      let knowledgebaseContext = "";
      let learningsContext = "";

      try {
        const user = await storage.getUser(convUserId);
        if (user) {
          const parts: string[] = [];
          if (user.firstName) parts.push(`Name: ${user.firstName}`);
          if (user.jobType) parts.push(`Industry/Role: ${user.jobType}`);
          if (parts.length > 0) {
            userProfileContext = `\n\nUSER PROFILE: ${parts.join(". ")}. Tailor the tone, vocabulary, and style of your output to suit this person's professional background. For example, use industry-appropriate terminology and a level of formality that matches their field.`;
          }
        }
      } catch (e) {
        console.warn(`[convert] Failed to load user profile for ${convUserId}:`, e);
      }

      // Simple conversion types (to-do list, bullets, summary, notes, etc.)
      // don't benefit from the user's cross-session learnings or past
      // conversion history — skipping those lookups shrinks the prefill and
      // removes two storage round-trips from the latency-critical path.
      // Style preferences and the user profile are still applied.
      const isSimpleConversionType = (CONVERSION_COMPLEXITY_MAP[type] || "simple") === "simple";

      try {
        if (!isSimpleConversionType) {
          learningsContext = await getUserLearningsContext(convUserId, type);
        }
      } catch (e) {
        console.warn(`[convert] Failed to load learnings for ${convUserId}/${type}:`, e);
      }

      try {
        const recentFeedback = (await storage.stylePreferences.getByUser(convUserId))
          .filter((f) => f.conversionType === type)
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
          .slice(0, 5);

        if (recentFeedback.length > 0) {
          const feedbackList = recentFeedback.map((f) => `- ${f.feedback}`).join("\n");
          styleContext = `\n\nSTYLE PREFERENCES (the user has given this feedback on previous "${typeLabel}" conversions — apply these preferences):\n${feedbackList}`;
        }
      } catch (e) {
        console.warn(`[convert] Failed to load style preferences for ${convUserId}/${type}:`, e);
      }

      try {
        if (!isSimpleConversionType) {
          const allRecordings = await storage.recordings.getByUser(convUserId);
          const recentRecordings = allRecordings
            .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
            .slice(0, 10);

          const pastConversions: string[] = [];
          for (const rec of recentRecordings) {
            const convs = rec.conversions as any[];
            if (!Array.isArray(convs)) continue;
            for (const c of convs) {
              if (c.type === type && c.content) {
                const snippet = c.content.slice(0, 150).replace(/\n/g, " ");
                pastConversions.push(`"${rec.title}": ${snippet}...`);
              }
            }
            if (pastConversions.length >= 5) break;
          }

          if (pastConversions.length > 0) {
            historyContext = `\n\nPREVIOUS "${typeLabel.toUpperCase()}" CONVERSIONS (the user has created these recently — avoid repeating the same content and build on prior work when relevant):\n${pastConversions.map((p) => `- ${p}`).join("\n")}`;
          }
        }
      } catch (e) {
        console.warn(`[convert] Failed to load conversion history for ${convUserId}/${type}:`, e);
      }

      try {
        const userSkill = await storage.userSkills.get(convUserId, type);
        if (userSkill) {
          const parsed = parseSkillContent(userSkill.skillContent);
          skillContext = formatSkillForPrompt(parsed, typeLabel);
        } else if (CONVERSION_SKILLS[type]) {
          skillContext = formatSkillForPrompt(CONVERSION_SKILLS[type], typeLabel);
        }
      } catch (e) {
        console.warn(`[convert] Failed to load skills for ${convUserId}/${type}:`, e);
      }

      try {
        const userKb = await storage.userKnowledgebases.get(convUserId, type);
        let kbResources: KnowledgebaseResource[] | null = null;
        if (userKb) {
          try { kbResources = JSON.parse(userKb.resources); } catch (parseErr) {
            console.warn(`[convert] Failed to parse knowledgebase resources for ${convUserId}/${type}:`, parseErr);
          }
        }
        if (!kbResources) {
          kbResources = CONVERSION_KNOWLEDGEBASES[type] || null;
        }
        if (kbResources && kbResources.length > 0) {
          const kbList = kbResources.map((r) => `- ${r.title}: ${r.url} — ${r.description}`).join("\n");
          const isResearchKb = type === "quick_research" || type === "academic_research" || type === "bibliography";
          knowledgebaseContext = isResearchKb
            ? `\n\nREFERENCE KNOWLEDGEBASE (search and consult these authoritative sources to inform your "${typeLabel}" conversion — cite them where applicable):\n${kbList}`
            : `\n\nREFERENCE KNOWLEDGEBASE (these are authoritative standards in this domain — align your output with their conventions and best practices, but do not cite or link to them as you have not accessed their content):\n${kbList}`;
        }
      } catch (e) {
        console.warn(`[convert] Failed to load knowledgebase for ${convUserId}/${type}:`, e);
      }

      if (!skillContext) {
        const defaultSkill = CONVERSION_SKILLS[type];
        if (defaultSkill) {
          skillContext = formatSkillForPrompt(defaultSkill, typeLabel);
        }
      }

      if (!knowledgebaseContext) {
        const defaultKb = CONVERSION_KNOWLEDGEBASES[type];
        if (defaultKb && defaultKb.length > 0) {
          const kbList = defaultKb.map((r) => `- ${r.title}: ${r.url} — ${r.description}`).join("\n");
          const isResearchDefault = type === "quick_research" || type === "academic_research" || type === "bibliography";
          knowledgebaseContext = isResearchDefault
            ? `\n\nREFERENCE KNOWLEDGEBASE (search and consult these authoritative sources to inform your "${typeLabel}" conversion — cite them where applicable):\n${kbList}`
            : `\n\nREFERENCE KNOWLEDGEBASE (these are authoritative standards in this domain — align your output with their conventions and best practices, but do not cite or link to them as you have not accessed their content):\n${kbList}`;
        }
      }

      const isResearchType = type === "quick_research" || type === "academic_research" || type === "bibliography";

      const formatInstruction = outputFormat === "markdown" && !STRUCTURED_OUTPUT_TYPES.has(type)
        ? `\n\nOUTPUT FORMAT — MARKDOWN: Format your entire response using standard Markdown. Use # for the document title, ## for major section headers, and ### for sub-section headers. Use **bold** for key terms and important points. Use unordered lists (- item) for bullet points and ordered lists (1. item) for sequential steps or ranked items. Use > for blockquotes when highlighting key information. Use \`code\` for inline technical terms or values. Use --- for horizontal rules between major sections when appropriate. Follow standard CommonMark Markdown conventions consistently throughout. Do not mix plain-text heading styles (e.g., UPPERCASE or underlines) with Markdown.`
        : outputFormat !== "markdown"
          ? `\n\nOUTPUT FORMAT — THIS OVERRIDES ALL OTHER FORMATTING INSTRUCTIONS ABOVE: Return clean plain text only. Do not use Markdown headings, emphasis, links, checkboxes, code fences, blockquotes, or horizontal rules. Use UPPERCASE or Title Case headings, plain dashes or numbers for lists, blank lines for section separation, and indentation for hierarchy. The output must be readable without a Markdown renderer.`
          : "";

      const spanishInstruction = reqLanguage === "es"
        ? `\n\nLANGUAGE — OUTPUT IN SPANISH: You MUST write your entire output in natural Mexican Spanish. Use warm, direct, professional language typical of Mexico. All headings, body text, labels, and explanations must be in Spanish. Do NOT mix English into the output unless the original transcript contains English terms that should be preserved (e.g. proper nouns, brand names, technical terms the user said in English). This applies regardless of the language of the transcript — always output in Spanish.`
        : "";

      const researchIntegrityInstruction = isResearchType
        ? `\n\nRESEARCH INTEGRITY: Use only facts and source metadata present in the transcript or the WEB RESEARCH context. Never invent or autocomplete a citation, DOI, URL, quotation, statistic, method, or finding. Keep claims attributable to their supplied sources. When evidence is missing or conflicting, state the limitation instead of guessing.`
        : "";

      const estimateTokens = (text: string) => Math.ceil(text.split(/\s+/).length * 1.3);
      const SYSTEM_PROMPT_TOKEN_BUDGET = 6000;

      const effectiveSkillContext = sanitizePromptContextForTarget(type, skillContext);
      const effectiveStyleContext = sanitizePromptContextForTarget(type, styleContext);

      const coreSections = GENEROUS_PARSING_PREAMBLE + basePrompt + effectiveSkillContext + formatInstruction + spanishInstruction + researchIntegrityInstruction;

      const trimOrder = ["history", "style", "learnings", "userProfile", "dateContext", "knowledgebase"];

      const sectionMap: Record<string, string> = {
        knowledgebase: knowledgebaseContext,
        dateContext: dateContext,
        userProfile: userProfileContext,
        learnings: learningsContext,
        style: effectiveStyleContext,
        history: historyContext,
      };

      const assemblyOrder = ["knowledgebase", "dateContext", "userProfile", "learnings", "style", "history"];

      let totalTokens = estimateTokens(coreSections + Object.values(sectionMap).join(""));
      const trimmedSections: string[] = [];
      const excluded = new Set<string>();

      for (const name of trimOrder) {
        if (totalTokens <= SYSTEM_PROMPT_TOKEN_BUDGET) break;
        const text = sectionMap[name];
        if (!text) continue;
        totalTokens -= estimateTokens(text);
        excluded.add(name);
        trimmedSections.push(name);
      }

      let systemPrompt = coreSections;
      for (const name of assemblyOrder) {
        if (!excluded.has(name) && sectionMap[name]) {
          systemPrompt += sectionMap[name];
        }
      }

      if (trimmedSections.length > 0) {
        console.warn(`[convert] System prompt trimmed (~${totalTokens} tokens after trim, budget ${SYSTEM_PROMPT_TOKEN_BUDGET}). Dropped: ${trimmedSections.join(", ")} for ${convUserId}/${type}`);
      }

      let userContent = transcript;
      if (clarifications && Array.isArray(clarifications) && clarifications.length > 0) {
        const clarificationText = clarifications
          .map((c: { question: string; answer: string }) => `Q: ${c.question}\nA: ${c.answer}`)
          .join("\n\n");
        userContent = `${transcript}\n\n---\nAdditional clarifications provided by the user:\n${clarificationText}`;
      }

      let webResearchContext = "";
      if (isResearchType) {
        try {
          const citationRequest = citationStyle ? `Requested citation style: ${citationStyle}.` : "";
          const bibliographyRequest = bibliographyType ? `Bibliography mode: ${bibliographyType}.` : "";
          const researchResponse = await openai.responses.create({
            model: "gpt-5.4-mini",
            tools: [{ type: "web_search" }],
            input: `Build a structured source-verification ledger for a ${typeLabel} conversion. ${citationRequest} ${bibliographyRequest}

Identify the research question, key concepts, and useful inclusion boundaries before searching. Search multiple query formulations. For academic topics, prioritize records and metadata from OpenAlex, Crossref, Semantic Scholar, PubMed or Europe PMC, DOI landing pages, and primary publisher pages. Prefer peer-reviewed primary studies and rigorous reviews, while using discipline-appropriate authoritative sources when journal articles are not the right evidence.

For every source, assign a stable label such as [S1] and report only metadata visible in the source: authors, exact title, publication, date, DOI or canonical URL, source type, peer-review status when verifiable, and the specific claim it supports. Note corrections or retractions when visible. Separate direct evidence from interpretation, identify conflicting findings and research gaps, and disclose important search limitations. Never invent or autocomplete a detail. Do not describe this as a systematic review unless the supplied material includes a reproducible protocol, complete search strategy, and screening record.

Requested reference resources:
${knowledgebaseContext || "No additional reference list supplied."}

Transcript:
${transcript}`,
          });
          const researchText = researchResponse.output_text || "";
          if (researchText) {
            const annotations = researchResponse.output?.flatMap((item: any) =>
              item.content?.flatMap((c: any) => c.annotations?.filter((a: any) => a.type === "url_citation") || []) || []
            ) || [];
            const sourcesText = annotations.length > 0
              ? "\n\nSources found:\n" + annotations.map((a: any) => `- ${a.title || a.url}: ${a.url}`).join("\n")
              : "";
            webResearchContext = `\n\n---\nWEB RESEARCH (this is the only external source material available; cite only metadata and claims present here):\n${researchText}${sourcesText}`;
          }
        } catch (researchErr) {
          console.error("Web research source-verification step failed:", researchErr);
          throw Object.assign(
            new Error(
              "Verified research sources are temporarily unavailable. No research conversion was generated; retry when source verification is available.",
            ),
            { status: 503 },
          );
        }
      }

      if (webResearchContext) {
        userContent += webResearchContext;
      }

      let clientDisconnected = false;
      res.on("close", () => { clientDisconnected = true; });

      const frozenRoutes = activeThoughtThreadRunRecord?.modelRoutes?.map(
        ({ inputTokenLimit: _inputTokenLimit, ...route }) => route as ConversionModelRoute,
      );
      const conversionRoutes = frozenRoutes && frozenRoutes.length > 0
        ? frozenRoutes
        : resolveConversionModelRouteChain(
            type,
            await getUserConversionModelPreferences(convUserId),
          ).routes;

      // SSE headers must be set before the first res.write below (streaming
      // responses are emitted as chunks arrive, which now happens inside the
      // provider loop so a first-token stall can fall through).
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");

      // First-token deadline: if a provider produces NO content within this
      // window, abort that attempt and let the chain try the next provider.
      // A hung primary used to block the whole request until the stream
      // ended or the client disconnected — the fallback chain only helped on
      // hard failures, not stalls.
      const FIRST_TOKEN_TIMEOUT_MS = Number(process.env.AI_FIRST_TOKEN_TIMEOUT_MS ?? 20_000);

      // Try each provider in the fallback chain until one succeeds. The
      // stream is created AND consumed here so a stall is treated like any
      // other failed attempt (abort → next route).
      let stream: AsyncIterable<any> | null = null;
      let lastError: unknown = null;
      let usedRoute: ConversionModelRoute | null = null;
      let fullResponse = "";

      for (const route of conversionRoutes) {
        let receivedFirstChunk = false;
        const controller = new AbortController();
        res.on("close", () => { controller.abort(); });

        try {
          const client = createOpenAIClient(route.provider);

          stream = await client.chat.completions.create({
            model: route.model,
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userContent },
            ],
            stream: true,
            ...getChatCompletionTokenOptions(route.provider, 8192),
          }, { signal: controller.signal });

          usedRoute = route;
          const isFallback = route !== conversionRoutes[0];
          if (isFallback) {
            console.log(`[convert] Fallback: ${route.provider}/${route.model} (${route.reason})`);
          }

          const firstChunkTimer = setTimeout(() => {
            if (!receivedFirstChunk && !clientDisconnected) {
              console.warn(
                `[convert] No first token from ${route.provider}/${route.model} within ${FIRST_TOKEN_TIMEOUT_MS}ms — aborting attempt`,
              );
              controller.abort();
            }
          }, FIRST_TOKEN_TIMEOUT_MS);

          try {
            for await (const chunk of stream) {
              if (clientDisconnected) break;
              const content = chunk.choices[0]?.delta?.content || "";
              if (!content) continue;

              receivedFirstChunk = true;
              clearTimeout(firstChunkTimer);
              fullResponse += content;

              if (!clientDisconnected) {
                res.write(`data: ${JSON.stringify({ content })}\n\n`);
              }
            }
          } finally {
            clearTimeout(firstChunkTimer);
          }

          if (!receivedFirstChunk) {
            throw new Error(
              `No first token from ${route.provider}/${route.model} within ${FIRST_TOKEN_TIMEOUT_MS}ms`,
            );
          }

          break; // success — exit the retry loop
        } catch (err: any) {
          lastError = err;
          // Don't retry if client disconnected
          if (clientDisconnected) break;
          // Discard any partial response from the failed attempt (on a
          // first-token stall nothing was sent yet, so this is a no-op there).
          fullResponse = "";
          console.warn(`[convert] Provider ${route.provider}/${route.model} failed, trying next:`, err?.message || err);
        }
      }

      if (!stream || !usedRoute) {
        console.error("[convert] All providers failed:", lastError);
        return res.status(502).json({
          error: "All conversion providers are currently unavailable. Please try again later.",
        });
      }

      if (clientDisconnected && activeThoughtThreadRun) {
        throw new Error("The conversion stream was interrupted before completion.");
      }

      fullResponse = sanitizeConversionOutput(type, fullResponse);

      if (type === "github_issue" && fullResponse.trim()) {
        let title = "AI Generated Issue";
        let body = fullResponse;

        const lines = fullResponse.split("\n");
        const firstLine = lines[0]?.trim();
        if (firstLine && (firstLine.startsWith("# TITLE:") || firstLine.startsWith("#Title:") || firstLine.startsWith("# "))) {
          title = firstLine.replace(/^#\s*(TITLE:)?\s*/i, "").trim();
          body = lines.slice(1).join("\n").trim();
        }

        try {
          const { createGitHubIssue } = await import("./github-feedback-service");
          const issue = await createGitHubIssue(title, body, ["bug", "ai-generated"]);
          if (issue) {
            const footer = `\n\n---\n**GitHub Issue Created:** [#${issue.number}](${issue.web_url})`;
            fullResponse += footer;
            if (!clientDisconnected) {
              res.write(`data: ${JSON.stringify({ content: footer })}\n\n`);
            }
          }
        } catch (githubErr) {
          console.error("[convert] Failed to create GitHub issue:", githubErr);
        }
      }

      if (!thoughtThreadUsageReserved) {
        await incrementUsage(convUserId, "conversion");
      }
      if (!activeThoughtThreadRun) {
        reportExtendedAccessIfNeeded(convUserId, "conversion", type);
      }

      if (fullResponse.length > 50 && transcript.length > 80) {
        runReflection(convUserId, type, transcript, fullResponse).catch(() => {});
      }
      trackEvent('conversion_completed', convUserId, { conversionType: type, citationStyle: citationStyle || null });
      let thoughtThreadResult: Awaited<ReturnType<typeof finalizeThoughtThreadRun>> | null = null;
      if (activeThoughtThreadRun) {
        thoughtThreadResult = await finalizeThoughtThreadRun(
          activeThoughtThreadRun.id,
          activeThoughtThreadRun.threadId,
          convUserId,
          fullResponse,
          { provider: usedRoute.provider, model: usedRoute.model },
        );
        reportExtendedAccessIfNeeded(convUserId, "conversion", type);
      }
      if (!clientDisconnected) {
        res.write(`data: ${JSON.stringify({
          done: true,
          fullContent: fullResponse,
          ...(thoughtThreadResult ? {
            thoughtThreadRunId: thoughtThreadResult.run.id,
            file: {
              id: thoughtThreadResult.file.id,
              name: thoughtThreadResult.file.name,
            },
          } : {}),
        })}\n\n`);
        res.end();
      }
    } catch (error: any) {
      if (activeThoughtThreadRun) {
        await failThoughtThreadRun(
          activeThoughtThreadRun.id,
          activeThoughtThreadRun.threadId,
          req.userId!,
          error,
        ).catch(() => undefined);
      }
      if (error?.name === "AbortError" || error?.name === "APIUserAbortError") return;
      console.error("Conversion error:", error);
      if (res.headersSent) {
        try { res.write(`data: ${JSON.stringify({ error: error.message || "Conversion failed" })}\n\n`); res.end(); } catch {}
      } else {
        res.status(error?.status || 500).json({ error: error.message || "We had trouble converting your text. Please try again." });
      }
    }
  });

  app.post("/api/generate-docx", requireAuth, async (req: Request, res: Response) => {
    try {
      const { content, title } = req.body;
      if (!content) {
        return res.status(400).json({ error: "Please add some content first." });
      }

      function parseInlineFormatting(text: string): TextRun[] {
        const runs: TextRun[] = [];
        const inlineRegex = /(\*\*\*(.*?)\*\*\*|\*\*(.*?)\*\*|\*(.*?)\*|`(.*?)`)/g;
        let lastIndex = 0;
        let match;
        while ((match = inlineRegex.exec(text)) !== null) {
          if (match.index > lastIndex) {
            runs.push(new TextRun({ text: text.slice(lastIndex, match.index), size: 22 }));
          }
          if (match[2] !== undefined) {
            runs.push(new TextRun({ text: match[2], bold: true, italics: true, size: 22 }));
          } else if (match[3] !== undefined) {
            runs.push(new TextRun({ text: match[3], bold: true, size: 22 }));
          } else if (match[4] !== undefined) {
            runs.push(new TextRun({ text: match[4], italics: true, size: 22 }));
          } else if (match[5] !== undefined) {
            runs.push(new TextRun({ text: match[5], font: "Courier New", size: 20 }));
          }
          lastIndex = match.index + match[0].length;
        }
        if (lastIndex < text.length) {
          runs.push(new TextRun({ text: text.slice(lastIndex), size: 22 }));
        }
        if (runs.length === 0) {
          runs.push(new TextRun({ text, size: 22 }));
        }
        return runs;
      }

      const lines = content.split("\n");
      const paragraphs: Paragraph[] = [];
      let inCodeBlock = false;

      for (const line of lines) {
        const trimmed = line.trim();

        if (trimmed.startsWith("```")) {
          inCodeBlock = !inCodeBlock;
          continue;
        }

        if (inCodeBlock) {
          paragraphs.push(new Paragraph({
            children: [new TextRun({ text: line, font: "Courier New", size: 18 })],
            spacing: { after: 40 },
          }));
          continue;
        }

        if (trimmed.startsWith("# ")) {
          paragraphs.push(new Paragraph({
            children: [new TextRun({ text: trimmed.slice(2), bold: true, size: 32 })],
            heading: HeadingLevel.HEADING_1,
            spacing: { after: 200 },
          }));
        } else if (trimmed.startsWith("## ")) {
          paragraphs.push(new Paragraph({
            children: [new TextRun({ text: trimmed.slice(3), bold: true, size: 28 })],
            heading: HeadingLevel.HEADING_2,
            spacing: { after: 150 },
          }));
        } else if (trimmed.startsWith("### ")) {
          paragraphs.push(new Paragraph({
            children: [new TextRun({ text: trimmed.slice(4), bold: true, size: 24 })],
            heading: HeadingLevel.HEADING_3,
            spacing: { after: 100 },
          }));
        } else if (trimmed.startsWith("- [ ] ") || trimmed.startsWith("- [x] ")) {
          const checked = trimmed.startsWith("- [x] ");
          const text = trimmed.slice(6);
          paragraphs.push(new Paragraph({
            children: [new TextRun({ text: `${checked ? "☑" : "☐"} `, size: 22 }), ...parseInlineFormatting(text)],
            spacing: { after: 80 },
          }));
        } else if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
          paragraphs.push(new Paragraph({
            children: [new TextRun({ text: "• ", size: 22 }), ...parseInlineFormatting(trimmed.slice(2))],
            spacing: { after: 80 },
          }));
        } else if (/^\d+\.\s/.test(trimmed)) {
          const numMatch = trimmed.match(/^(\d+\.\s)(.*)/);
          if (numMatch) {
            paragraphs.push(new Paragraph({
              children: [new TextRun({ text: numMatch[1], size: 22 }), ...parseInlineFormatting(numMatch[2])],
              spacing: { after: 80 },
            }));
          }
        } else if (trimmed === "") {
          paragraphs.push(new Paragraph({ children: [], spacing: { after: 100 } }));
        } else {
          paragraphs.push(new Paragraph({ children: parseInlineFormatting(trimmed), spacing: { after: 100 } }));
        }
      }

      const doc = new Document({
        sections: [{
          properties: {},
          children: paragraphs,
        }],
      });

      const buffer = await Packer.toBuffer(doc);
      const fileName = `${(title || "document").replace(/\s+/g, "_")}.docx`;

      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
      res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
      res.send(buffer);
    } catch (error: any) {
      console.error("DOCX generation error:", error);
      res.status(500).json({ error: error.message || "We had trouble creating the document. Please try again." });
    }
  });

  app.post("/api/generate-pdf", requireAuth, async (req: Request, res: Response) => {
    try {
      const { content, title } = req.body;
      const safeTitle = String(title || "document")
        .replace(/[^\p{L}\p{N}._-]+/gu, "_")
        .replace(/^_+|_+$/g, "")
        .slice(0, 120) || "document";
      const buffer = await generateMarkdownPdf(String(content || ""), safeTitle);

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${safeTitle}.pdf"`);
      res.send(buffer);
    } catch (error: any) {
      const message = error?.message || "We had trouble creating the PDF. Please try again.";
      const status = /add some content|too large/i.test(message) ? 400 : 500;
      console.error("PDF generation error:", error);
      res.status(status).json({ error: message });
    }
  });

  app.post("/api/generate-xlsx", requireAuth, async (req: Request, res: Response) => {
    try {
      const { content, title } = req.body;
      const safeTitle = String(title || "spreadsheet")
        .replace(/[^\p{L}\p{N}._-]+/gu, "_")
        .replace(/^_+|_+$/g, "")
        .slice(0, 120) || "spreadsheet";
      const buffer = await generateSpreadsheetXlsx(String(content || ""), safeTitle);

      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      );
      res.setHeader("Content-Disposition", `attachment; filename="${safeTitle}.xlsx"`);
      res.send(buffer);
    } catch (error: any) {
      const message = error?.message || "We had trouble creating the spreadsheet. Please try again.";
      const status = Number.isInteger(error?.status) ? error.status : 500;
      console.error("XLSX generation error:", error);
      res.status(status).json({ error: message });
    }
  });



  app.get("/api/oauth/available", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.userId!;
      const { getAvailableOAuthProvidersForUser } = await import("./connector-service");
      const providers = await getAvailableOAuthProvidersForUser(userId);
      res.json({ providers });
    } catch (error: any) {
      console.error("OAuth availability check error:", error);
      res.json({ providers: [] });
    }
  });

  // ── Backup OAuth routes ──────────────────────────────────────────────────

  app.get("/api/backup/oauth/available", requireAuth, async (_req: Request, res: Response) => {
    try {
      const { getAvailableBackupOAuthProviders } = await import("./oauth-backup");
      res.json({ providers: getAvailableBackupOAuthProviders() });
    } catch (error: any) {
      console.error("Backup OAuth availability error:", error);
      res.json({ providers: [] });
    }
  });

  app.get("/api/backup/oauth/:provider/authorize", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.userId!;
      const provider = req.params.provider as string;
      const returnTo = typeof req.query.returnTo === "string" ? req.query.returnTo : undefined;
      const { generateAuthorizationUrl } = await import("./oauth-backup");
      const url = generateAuthorizationUrl(userId, provider, returnTo);
      if (!url) {
        return res.status(400).json({ error: "This backup provider is not available. The server may be missing credentials for it." });
      }
      res.json({ url });
    } catch (error: any) {
      console.error("Backup OAuth authorize error:", error);
      res.status(500).json({ error: "We had trouble starting the connection. Please try again." });
    }
  });

  app.get("/api/backup/oauth/:provider/callback", async (req: Request, res: Response) => {
    try {
      const code = req.query.code as string;
      const state = req.query.state as string;
      const error = req.query.error as string;
      const defaultReturnPath = "/settings/integrations";

      const redirectWithParams = (returnTo: string | undefined, params: Record<string, string>) => {
        const target = returnTo || defaultReturnPath;
        if (/^aiforms:\/\//i.test(target)) {
          const url = new URL(target);
          Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
          return res.redirect(url.toString());
        }

        const url = new URL(target, getPublicAppBaseUrl());
        Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
        return res.redirect(`${url.pathname}${url.search}`);
      };

      const { handleOAuthCallback, getPendingBackupOAuthReturnTo } = await import("./oauth-backup");
      const pendingReturnTo = getPendingBackupOAuthReturnTo(state);

      if (error) {
        return redirectWithParams(pendingReturnTo, { backup_error: "denied", tab: "backup" });
      }

      if (!code || !state) {
        return redirectWithParams(pendingReturnTo, { backup_error: "missing_params", tab: "backup" });
      }

      const result = await handleOAuthCallback(code, state);

      if (result.ok) {
        return redirectWithParams(result.returnTo, { backup_connected: result.provider || "connected", tab: "backup" });
      } else {
        return redirectWithParams(result.returnTo, { backup_error: result.error || "unknown", tab: "backup" });
      }
    } catch (error: any) {
      console.error("Backup OAuth callback error:", error);
      return res.redirect("/settings/integrations?backup_error=server_error&tab=backup");
    }
  });

  // Backup provider management routes
  app.get("/api/backup/providers", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.userId!;
      const providers = await getAllProviders(userId);
      res.json(providers.map(toPublicBackupProvider));
    } catch (error: any) {
      console.error("Get backup providers error:", error);
      res.status(500).json({ error: "We had trouble loading your backup providers. Please try again." });
    }
  });

  app.post("/api/backup/providers", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.userId!;
      const { provider, config } = req.body;

      const validProviders: ProviderType[] = ["google_drive", "onedrive", "dropbox", "webdav"];
      if (!validProviders.includes(provider)) {
        return res.status(400).json({ error: "That provider type isn't supported. Please choose a different one." });
      }

      if (provider === "webdav" && (!config?.webdavUrl || !config?.webdavUsername || !config?.webdavPassword)) {
        return res.status(400).json({ error: "Please fill in the WebDAV URL, username, and password." });
      }

      if (provider !== "webdav" && !config?.accessToken && !config?.useOAuth) {
        return res.status(400).json({ error: "Please provide an access token for this provider." });
      }

      const bp = await addProvider(userId, provider, config);
      res.status(201).json(toPublicBackupProvider(bp));
    } catch (error: any) {
      console.error("Add backup provider error:", error);
      res.status(500).json({ error: "We had trouble adding that provider. Please check the details and try again." });
    }
  });

  app.put("/api/backup/providers/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.userId as string;
      const id = req.params.id as string;
      const { enabled, config } = req.body;

      const updated = await updateProvider(id, userId, { enabled, config });
      if (!updated) {
        return res.status(404).json({ error: "We couldn't find that provider. It may have been removed." });
      }

      res.json(toPublicBackupProvider(updated));
    } catch (error: any) {
      console.error("Update backup provider error:", error);
      res.status(500).json({ error: "We had trouble updating that provider. Please try again." });
    }
  });

  app.delete("/api/backup/providers/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.userId as string;
      const id = req.params.id as string;

      const deleted = await removeProvider(id, userId);
      if (!deleted) {
        return res.status(404).json({ error: "We couldn't find that provider. It may have been removed." });
      }

      res.json({ ok: true });
    } catch (error: any) {
      console.error("Delete backup provider error:", error);
      res.status(500).json({ error: "We had trouble removing that provider. Please try again." });
    }
  });

  app.post("/api/backup/providers/:id/test", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.userId!;
      const id = req.params.id;

      const providers = await getAllProviders(userId);
      const provider = providers.find((p) => p.id === id);
      if (!provider) {
        return res.status(404).json({ error: "We couldn't find that provider. It may have been removed." });
      }

      const result = await testProviderConnection(provider, userId);
      res.json(result);
    } catch (error: any) {
      console.error("Test backup provider error:", error);
      res.status(500).json({ error: "The connection test didn't work. Please check your settings and try again." });
    }
  });

  app.get("/api/backup/logs", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.userId!;
      const limit = parseInt(req.query.limit as string) || 50;
      const logs = await getBackupLogs(userId, limit);
      res.json(logs);
    } catch (error: any) {
      console.error("Get backup logs error:", error);
      res.status(500).json({ error: "We had trouble loading backup history. Please try again." });
    }
  });

  app.post("/api/backup/recording/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.userId as string;

      const subStatus = await stripeService.getUserSubscriptionStatus(userId);
      if (!subStatus.cloudSync.syncAllowed) {
        return res.status(403).json({ error: "Cloud Sync is no longer active. Backup requires an active Cloud Sync subscription.", cloudSyncDisabled: true });
      }

      const recordingId = req.params.id as string;
      const { fileTypes } = req.body;

      const recording = await storage.getRecording(recordingId, userId);
      if (!recording) {
        return res.status(404).json({ error: "We couldn't find that recording. It may have been deleted." });
      }

      const types = fileTypes || ["audio", "transcript", "conversion"];
      await backupRecordingFiles(userId, recording, types);
      res.json({ ok: true, message: "Backup initiated" });
    } catch (error: any) {
      console.error("Backup recording error:", error);
      res.status(500).json({ error: "We had trouble backing up that recording. Please try again." });
    }
  });

  app.get("/api/oauth/status", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.userId!;
      const { getAvailableOAuthProvidersForUser } = await import("./connector-service");
      const providers = await getAvailableOAuthProvidersForUser(userId);
      res.json({ providers });
    } catch (error: any) {
      console.error("OAuth status error:", error);
      res.json({ providers: [] });
    }
  });

  app.get("/api/tasks/providers", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.userId!;
      const providers = await getAllTaskProviders(userId);
      res.json(providers.map(toPublicTaskProvider));
    } catch (error: any) {
      console.error("Get task providers error:", error);
      res.status(500).json({ error: "We had trouble loading your task integrations. Please try again." });
    }
  });

  app.post("/api/tasks/providers", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.userId!;
      const { provider, label, config } = req.body;
      const validProviders: TaskProviderType[] = ["google_tasks", "microsoft_todo", "todoist", "custom_api", "asana", "jira", "linear", "monday", "github_issues"];
      if (!validProviders.includes(provider)) {
        return res.status(400).json({ error: "That provider type isn't supported. Please choose a different one." });
      }
      if (!label) {
        return res.status(400).json({ error: "Please give this integration a name." });
      }
      const result = await addTaskProvider(userId, provider, label, config || {});
      res.json(toPublicTaskProvider(result));
    } catch (error: any) {
      console.error("Add task provider error:", error);
      res.status(500).json({ error: "We had trouble adding that integration. Please check the details and try again." });
    }
  });

  app.put("/api/tasks/providers/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.userId as string;
      const providerId = req.params.id as string;
      const updates = req.body;
      const result = await updateTaskProvider(userId, providerId, updates);
      if (!result) return res.status(404).json({ error: "We couldn't find that provider. It may have been removed." });
      res.json(toPublicTaskProvider(result));
    } catch (error: any) {
      console.error("Update task provider error:", error);
      res.status(500).json({ error: "We had trouble updating that integration. Please try again." });
    }
  });

  app.delete("/api/tasks/providers/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.userId as string;
      const providerId = req.params.id as string;
      const removed = await removeTaskProvider(userId, providerId);
      if (!removed) return res.status(404).json({ error: "We couldn't find that provider. It may have been removed." });
      res.json({ ok: true });
    } catch (error: any) {
      console.error("Delete task provider error:", error);
      res.status(500).json({ error: "We had trouble removing that integration. Please try again." });
    }
  });

  app.post("/api/tasks/providers/:id/test", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.userId!;
      const providerId = getRouteParam(req.params.id, "provider id");
      const providers = await getAllTaskProviders(userId);
      const provider = providers.find((p) => p.id === providerId);
      if (!provider) return res.status(404).json({ error: "We couldn't find that provider. It may have been removed." });
      const result = await testTaskProvider(provider.provider as TaskProviderType, provider.config as any, userId);
      res.json(result);
    } catch (error: any) {
      console.error("Test task provider error:", error);
      res.status(500).json({ error: "The connection test didn't work. Please check your settings.", details: error.message });
    }
  });

  app.post("/api/tasks/export", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.userId!;
      const tier = await getUserTier(userId);
      if (tier !== "base") {
        return res.status(403).json({ error: "integration_locked", requiredTier: "base" });
      }
      const { providerId, content } = req.body;
      if (!providerId || !content) {
        return res.status(400).json({ error: "Provider ID and content are required" });
      }

      const providers = await getAllTaskProviders(userId);
      const provider = providers.find((p) => p.id === providerId);
      if (!provider) return res.status(404).json({ error: "We couldn't find that provider. It may have been removed." });
      if (!provider.enabled) return res.status(400).json({ error: "Provider is disabled" });

      const tasks = parseTodoMarkdown(content);
      if (tasks.length === 0) {
        return res.status(400).json({ error: "No tasks found in content" });
      }

      const result = await exportTasks(
        provider.provider as TaskProviderType,
        tasks,
        provider.config as any,
        userId
      );

      res.json({ ...result, totalParsed: tasks.length });
    } catch (error: any) {
      console.error("Export tasks error:", error);
      res.status(500).json({ error: "We had trouble exporting the tasks. Please try again." });
    }
  });

  app.post("/api/tasks/parse", requireAuth, async (req: Request, res: Response) => {
    try {
      const { content } = req.body;
      if (!content) return res.status(400).json({ error: "Please add some content first." });
      const tasks = parseTodoMarkdown(content);
      res.json({ tasks, count: tasks.length });
    } catch (error: any) {
      console.error("Parse tasks error:", error);
      res.status(500).json({ error: "We had trouble reading the tasks from this content." });
    }
  });

  app.post("/api/generate-ics", requireAuth, async (req: Request, res: Response) => {
    try {
      const { content, events: eventsData } = req.body;
      let events;
      if (eventsData && Array.isArray(eventsData)) {
        events = eventsData;
      } else if (content) {
        events = parseEventJson(content);
      } else {
        return res.status(400).json({ error: "Content or events data is required" });
      }

      if (events.length === 0) {
        return res.status(400).json({ error: "No events found in content" });
      }

      const icsContent = generateIcsContent(events);
      res.setHeader("Content-Type", "text/calendar; charset=utf-8");
      res.setHeader("Content-Disposition", 'attachment; filename="event.ics"');
      res.send(icsContent);
    } catch (error: any) {
      console.error("ICS generation error:", error);
      res.status(500).json({ error: "We had trouble creating the calendar file. Please try again." });
    }
  });

  app.post("/api/calendar/parse-events", requireAuth, async (req: Request, res: Response) => {
    try {
      const { content } = req.body;
      if (!content) return res.status(400).json({ error: "Please add some content first." });
      const events = parseEventJson(content);
      const urls = events.map(e => ({
        event: e,
        googleUrl: generateGoogleCalendarUrl(e),
        outlookUrl: generateOutlookCalendarUrl(e),
      }));
      res.json({ events: urls, count: events.length });
    } catch (error: any) {
      console.error("Parse events error:", error);
      res.status(500).json({ error: "We had trouble reading calendar events from this content." });
    }
  });

  app.get("/api/calendar/providers", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.userId!;
      const providers = await getAllCalendarProviders(userId);
      res.json(providers.map(toPublicCalendarProvider));
    } catch (error: any) {
      console.error("Get calendar providers error:", error);
      res.status(500).json({ error: "We had trouble loading your calendar integrations. Please try again." });
    }
  });

  app.post("/api/calendar/providers", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.userId!;
      const { provider, label, config } = req.body;
      const validProviders: CalendarProviderType[] = ["google_calendar", "outlook", "ical_download", "custom_api", "caldav_nextcloud"];
      if (!validProviders.includes(provider)) {
        return res.status(400).json({ error: "That provider type isn't supported. Please choose a different one." });
      }
      if (!label) {
        return res.status(400).json({ error: "Please give this integration a name." });
      }
      const result = await addCalendarProvider(userId, provider, label, config || {});
      res.json(toPublicCalendarProvider(result));
    } catch (error: any) {
      console.error("Add calendar provider error:", error);
      res.status(500).json({ error: "We had trouble adding that calendar integration. Please try again." });
    }
  });

  app.put("/api/calendar/providers/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.userId!;
      const providerId = req.params.id as string;
      const updates = req.body;
      const result = await updateCalendarProvider(providerId, userId, updates);
      if (!result) return res.status(404).json({ error: "We couldn't find that provider. It may have been removed." });
      res.json(toPublicCalendarProvider(result));
    } catch (error: any) {
      console.error("Update calendar provider error:", error);
      res.status(500).json({ error: "We had trouble updating that calendar integration. Please try again." });
    }
  });

  app.delete("/api/calendar/providers/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.userId!;
      const providerId = req.params.id as string;
      const removed = await removeCalendarProvider(providerId, userId);
      if (!removed) return res.status(404).json({ error: "We couldn't find that provider. It may have been removed." });
      res.json({ ok: true });
    } catch (error: any) {
      console.error("Delete calendar provider error:", error);
      res.status(500).json({ error: "We had trouble removing that calendar integration. Please try again." });
    }
  });

  app.post("/api/calendar/export", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.userId!;
      const tier = await getUserTier(userId);
      if (tier !== "base") {
        return res.status(403).json({ error: "integration_locked", requiredTier: "base" });
      }
      const { providerId, content, confirmed, timeZone } = req.body;
      if (!providerId || !content) {
        return res.status(400).json({ error: "Provider ID and content are required" });
      }

      const providers = await getAllCalendarProviders(userId);
      const provider = providers.find(p => p.id === providerId);
      if (!provider) return res.status(404).json({ error: "We couldn't find that provider. It may have been removed." });
      if (!provider.enabled) return res.status(400).json({ error: "Provider is disabled" });

      const events = parseEventJson(content);
      if (events.length === 0) {
        return res.status(400).json({ error: "No events found in content" });
      }

      const result = await exportToCalendarProvider(provider, events, userId, timeZone);
      res.json({ ...result, totalEvents: events.length });
    } catch (error: any) {
      console.error("Export calendar events error:", error);
      res.status(500).json({ error: "We had trouble exporting the events. Please try again." });
    }
  });

  app.get("/api/connectors/available", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.userId!;
      const connectors = await getAvailableConnectorsForUser(userId);
      res.json(connectors);
    } catch (error: any) {
      console.error("Get connectors error:", error);
      res.status(500).json({ error: "We had trouble loading connectors. Please try again." });
    }
  });

  app.get("/api/connectors/relevant/:conversionType", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.userId!;
      const conversionType = req.params.conversionType as string;
      const connectors = await getRelevantConnectorsForUser(userId, conversionType);
      res.json(connectors);
    } catch (error: any) {
      console.error("Get relevant connectors error:", error);
      res.status(500).json({ error: "We had trouble finding matching connectors." });
    }
  });

  app.post("/api/connectors/export", requireAuth, async (req: Request, res: Response) => {
    try {
      const connUserId = req.userId!;
      const tier = await getUserTier(connUserId);
      if (tier !== "base") {
        return res.status(403).json({ error: "integration_locked", requiredTier: "base" });
      }
      const { connectorType, content, title, conversionType, config } = req.body;
      if (!connectorType || !content || !title) {
        return res.status(400).json({ error: "Connector type, content, and title are required" });
      }

      const exportConfig = config || {};

      const result = await exportToConnector(
        connectorType as ConnectorType,
        content,
        title,
        conversionType || "summary",
        exportConfig
      );

      if (result.success) {
        res.json(result);
      } else {
        res.status(400).json(result);
      }
    } catch (error: any) {
      console.error("Connector export error:", error);
      res.status(500).json({ error: "We had trouble sending to that connector. Please try again." });
    }
  });

  const ALLOWED_CONNECTOR_PROVIDERS = ["elevenlabs", "google_calendar", "todoist", "github", "linear", "asana"];

  app.get("/api/connectors/providers", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.userId!;
      const providers = await getUserConnectorProviders(userId);
      res.json(providers.map(toPublicConnectorProvider));
    } catch (error: any) {
      console.error("Get connector providers error:", error);
      res.status(500).json({ error: "We had trouble loading your connectors. Please try again." });
    }
  });

  app.post("/api/connectors/providers", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.userId!;
      const { provider, label, config } = req.body;
      if (!provider || !label || !config) {
        return res.status(400).json({ error: "Provider, label, and config are required." });
      }
      if (!ALLOWED_CONNECTOR_PROVIDERS.includes(provider)) {
        return res.status(400).json({ error: `Invalid connector provider: ${provider}` });
      }
      const result = await addConnectorProvider(userId, provider, label, config);
      res.json(toPublicConnectorProvider(result));
    } catch (error: any) {
      console.error("Add connector provider error:", error);
      res.status(500).json({ error: "We had trouble saving that connector. Please try again." });
    }
  });

  app.delete("/api/connectors/providers/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.userId!;
      const providerId = getRouteParam(req.params.id, "provider id");
      const deleted = await removeConnectorProvider(userId, providerId);
      if (!deleted) {
        return res.status(404).json({ error: "Connector not found." });
      }
      res.json({ success: true });
    } catch (error: any) {
      console.error("Delete connector provider error:", error);
      res.status(500).json({ error: "We had trouble removing that connector. Please try again." });
    }
  });

  app.post("/api/feedback", requireAuth, upload.single("image"), async (req: Request, res: Response) => {
    try {
      const { category, message, userEmail } = req.body;
      const file = req.file;
      if (!category || !message) {
        return res.status(400).json({ error: "Category and message are required" });
      }
      if (typeof message === "string" && message.length > 2000) {
        return res.status(400).json({ error: "Feedback message is too long (max 2,000 characters)." });
      }

      const { isEmailServiceAvailable, sendFeedbackEmail, sendFeedbackAcknowledgmentEmail } = await import("./email-service");
      const { isGitHubFeedbackSyncConfigured, createFeedbackGitHubIssue } = await import("./github-feedback-service");
      if (!isEmailServiceAvailable()) {
        return res.status(503).json({ error: "Email service is not configured. Please contact the developer directly." });
      }

      const user = await storage.getUser(req.userId!);
      const feedbackOpts: any = {
        category,
        message: message.trim(),
        userEmail: userEmail || user?.email || undefined,
        userName: user?.firstName || undefined,
        userNumber: user?.userNumber ? String(user.userNumber) : undefined,
      };

      if (file) {
        feedbackOpts.attachment = {
          filename: file.originalname || "attachment.jpg",
          content: file.buffer.toString("base64"),
          type: file.mimetype || "image/jpeg",
        };
      }
      console.log("Sending feedback email:", JSON.stringify({ category, userEmail: feedbackOpts.userEmail, userName: feedbackOpts.userName }));
      const sent = await sendFeedbackEmail(feedbackOpts);
      if (!sent) {
        console.error("sendFeedbackEmail returned false - email service may not be configured");
        return res.status(503).json({ error: "Email service is not configured" });
      }

      const recipientEmail = user?.email;
      if (recipientEmail) {
        sendFeedbackAcknowledgmentEmail({
          to: recipientEmail,
          firstName: feedbackOpts.userName,
          category,
          message: message.trim(),
        }).catch((err: any) => {
          console.error("Feedback acknowledgment email failed (non-blocking):", err?.message || err);
        });
      }

      if (isGitHubFeedbackSyncConfigured()) {
        try {
          await createFeedbackGitHubIssue(feedbackOpts);
        } catch (err: any) {
          console.error("Feedback GitHub issue creation failed (non-blocking):", err?.message || err);
        }
      }

      // Keep internal tracker details behind the server boundary. Customers
      // only need confirmation that their feedback was accepted.
      res.json({ success: true });
    } catch (error: any) {
      console.error("Feedback send error:", error?.response?.body || error?.message || error);
      res.status(500).json({ error: "We had trouble sending your feedback. Please try again in a moment." });
    }
  });

  app.get("/api/folders", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.userId!;
      await ensureSystemFolders(userId);
      const folders = await storage.userFolders.getByUser(userId);
      const sortedFolders = folders.sort((a, b) => {
        if (a.isSystem !== b.isSystem) {
          return (b.isSystem || 0) - (a.isSystem || 0);
        }
        return (a.name || "").localeCompare(b.name || "");
      });

      const files = await storage.userFiles.getByUser(userId);
      const countMap: Record<string, number> = {};
      for (const f of files) {
        if (f.folderId) {
          countMap[f.folderId] = (countMap[f.folderId] || 0) + 1;
        }
      }

      const foldersWithCounts = sortedFolders.map(f => ({ ...f, fileCount: countMap[f.id] || 0 }));
      res.json(foldersWithCounts);
    } catch (error: any) {
      res.status(500).json({ error: "We had trouble loading your folders. Please try again." });
    }
  });



  app.get("/api/cloud-sync", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.userId!;
      const userRecord = await storage.users.get(userId);

      const subStatus = await stripeService.getUserSubscriptionStatus(userId);
      const isPaidPlan = subStatus.tier !== "free" && subStatus.active;

      // Report the effective enabled state without permanently modifying the
      // database. Disabling cloudSyncEnabled in a GET endpoint is a destructive
      // side-effect that can permanently revoke a user's sync preference if a
      // subscription check is temporarily incorrect (e.g., immediately after a
      // server update or a transient API error). The payment-processor webhooks
      // (Stripe, RevenueCat) are the authoritative source for subscription-driven
      // changes to cloudSyncEnabled and must handle those transitions instead.
      const effectiveEnabled =
        userRecord?.cloudSyncEnabled === 1 &&
        (subStatus.cloudSync.syncAllowed || subStatus.cloudSync.inGracePeriod);

      res.json({
        enabled: effectiveEnabled,
        entitled: subStatus.cloudSync.entitled,
        syncAllowed: subStatus.cloudSync.syncAllowed,
        inGracePeriod: subStatus.cloudSync.inGracePeriod,
        grandfathered: subStatus.cloudSync.grandfathered,
        isPaidPlan,
        isBasePlan: isPaidPlan,
        cloudSyncSubscriptionId: subStatus.cloudSync.subscriptionId,
        gracePeriodEnd: subStatus.cloudSync.gracePeriodEnd,
        tier: subStatus.tier,
        displayTier: subStatus.displayTier,
      });
    } catch {
      res.status(500).json({ error: "Failed to get cloud sync preference." });
    }
  });

  app.put("/api/cloud-sync", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.userId!;
      const enabled = req.body.enabled === true;

      if (enabled) {
        const subStatus = await stripeService.getUserSubscriptionStatus(userId);
        if (!subStatus.cloudSync.syncAllowed) {
          return res.status(403).json({ error: "Cloud Sync add-on required. You need an active Base or Pro plan plus the Cloud Sync add-on.", requiresAddon: true });
        }
      }

      await storage.users.update(userId, { cloudSyncEnabled: enabled ? 1 : 0 });
      res.json({ enabled });
    } catch {
      res.status(500).json({ error: "Failed to update cloud sync preference." });
    }
  });




  app.get("/api/account/export", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.userId!;
      const [
        userRecordings,
        userFilesData,
        userFoldersData,
        userData,
        thoughtThreads,
        thoughtThreadItems,
        thoughtThreadContexts,
        thoughtThreadRuns,
      ] = await Promise.all([
        storage.recordings.getByUser(userId),
        storage.userFiles.getByUser(userId),
        storage.userFolders.getByUser(userId),
        storage.users.get(userId),
        storage.thoughtThreads.getByUser(userId),
        storage.thoughtThreadItems.getByUser(userId),
        storage.thoughtThreadContexts.getByUser(userId),
        storage.thoughtThreadRuns.getByUser(userId),
      ]);
      const recordingContexts = (
        await Promise.all(
          userRecordings.map((recording) =>
            storage.recordingContexts.getByRecording(recording.id, userId)),
        )
      ).flat();
      const runSnapshots = await Promise.all(thoughtThreadRuns.map(async (run) => {
        const chunks = await storage.thoughtThreadRunChunks.getByRun(
          run.id,
          run.threadId,
          userId,
        );
        const sourceSnapshot = chunks
          .filter((chunk) => chunk.kind === "source")
          .map((chunk) => chunk.text)
          .join("") || run.sourceSnapshot || null;
        const preparedSource = chunks
          .filter((chunk) => chunk.kind === "prepared")
          .map((chunk) => chunk.text)
          .join("") || run.preparedSource || null;
        return {
          ...run,
          sourceSnapshot,
          preparedSource,
          output: undefined,
        };
      }));

      const exportData = {
        exportedAt: new Date().toISOString(),
        account: userData || {},
        recordings: userRecordings.map(r => ({
          id: r.id,
          title: r.title,
          transcript: r.transcript,
          conversions: r.conversions,
          duration: r.duration,
          createdAt: r.createdAt,
          updatedAt: (r as any).updatedAt,
        })),
        recordingContexts,
        files: userFilesData.map(f => ({
          id: f.id,
          name: f.name,
          content: f.content,
          conversionType: f.conversionType,
          mimeType: f.mimeType,
          createdAt: f.createdAt,
        })),
        folders: userFoldersData.map(f => ({
          id: f.id,
          name: f.name,
          isSystem: f.isSystem,
          createdAt: f.createdAt,
        })),
        thoughtThreads: {
          threads: thoughtThreads,
          items: thoughtThreadItems,
          contexts: thoughtThreadContexts,
          runs: runSnapshots,
        },
      };

      res.setHeader("Content-Type", "application/json");
      res.setHeader("Content-Disposition", `attachment; filename="promptforms-export-${new Date().toISOString().slice(0, 10)}.json"`);
      res.json(exportData);
    } catch (error: any) {
      res.status(500).json({ error: "We had trouble exporting your data. Please try again." });
    }
  });

  app.delete("/api/account", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.userId!;

      const user = await storage.users.get(userId);
      if (!user) return res.status(404).json({ error: "User not found" });

      if (req.authSource === "firebase") {
        const authTime = typeof req.authTime === "number" ? req.authTime : 0;
        const ageSeconds = Math.floor(Date.now() / 1000) - authTime;
        if (!authTime || ageSeconds > 5 * 60) {
          return res.status(403).json({
            error: "Sign in again before deleting your account.",
            code: "REQUIRES_RECENT_LOGIN",
          });
        }
      } else {
        const password = typeof req.body?.password === "string" ? req.body.password : "";
        if (!password) {
          return res.status(400).json({ error: "Enter your current password to delete your account." });
        }

        const credentialAccount = await storage.accounts.getByUserAndProvider(userId, "credential");
        if (!credentialAccount?.password) {
          return res.status(409).json({ error: "This account cannot be password-confirmed. Contact support for account deletion." });
        }

        const bcrypt = await import("bcryptjs");
        const passwordMatches = await bcrypt.compare(password, credentialAccount.password);
        if (!passwordMatches) {
          return res.status(403).json({ error: "The password is incorrect." });
        }
      }

      if (user.stripeCustomerId) {
        await stripeService.cancelCustomerSubscriptionsForAccountDeletion(user.stripeCustomerId);
      }

      await deleteAllUserBucketFiles(userId);
      await storage.clearUserData(userId);
      // Remove the identity only after all personal data cleanup succeeds. If
      // cleanup fails, the user can still authenticate and retry deletion.
      await deleteAuthUserIfPresent(adminAuth, userId);

      res.json({ success: true });
    } catch (error: any) {
      console.error("Delete account error:", error);
      res.status(500).json({ error: error.message || "We had trouble processing your account deletion. Please try again." });
    }
  });

  registerBucketRoutes(app);
  registerKbRoutes(app, requireAuth);

  // Early bird consent collection
  app.post("/api/user/consent", requireAuth, async (_req: Request, res: Response) => {
    // Consent is recorded via the form submission itself.
    // The user's email is already on their account.
    res.json({ ok: true });
  });

  const httpServer = createServer(app);

  return httpServer;
}
