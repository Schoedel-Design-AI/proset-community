// Slide Deck conversion: transcript -> LLM deck outline (JSON) -> styled .pptx.
// Gating: base/pro tiers only (shared TIER_CONVERSION_TYPES). Abuse controls:
// per-user monthly quota + global daily quota (shared DECK_LIMITS), slide-count
// clamp, transcript length cap. The Gamma/2Slides-style "pick a look" step is
// client-side; the chosen DeckStyle is applied by the pptx assembler here.
import express, { type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import { storage } from "../../storage";
import { requireAuth } from "../../auth";
import { trackEvent } from "../../analytics-service";
import {
  checkConversionLimit,
  computeConversionTokenCost,
  deductConversionTokens,
  isConversionTypeAllowed,
  TIER_CONVERSION_TYPES,
} from "../../usage-service";
import {
  CONVERSION_PROMPTS,
  CONVERSION_SKILLS,
  CONVERSION_KNOWLEDGEBASES,
  formatSkillForPrompt,
} from "../ai-customization/prompts";
import { getUserConversionModelPreferences } from "../ai-customization/utils";
import { resolveConversionModelRouteChain } from "../../conversion-model-routing";
import { createOpenAIClient, getChatCompletionTokenOptions } from "../../openai-client";
import {
  DECK_LIMITS,
  DECK_STYLES,
  getDeckStyle,
  type DeckDocument,
  type DeckSlide,
} from "@shared/deck-styles";
import { assembleDeckPptx } from "./pptx";
import {
  checkGlobalDailyDeckQuota,
  getDeck,
  recordDeckGeneration,
  saveDeck,
  type DeckRecord,
} from "./store";

const router = express.Router();
const PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const GENERATION_TIMEOUT_MS = 150_000;

function requireString(v: unknown, maxLen: number, name: string): string | null {
  if (typeof v !== "string" || !v.trim()) return `${name} is required.`;
  if (v.length > maxLen) return `${name} is too long (max ${maxLen} characters).`;
  return null;
}

function parseDeckJson(raw: string): DeckDocument | null {
  let text = raw.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();
  // Tolerate a trailing comma before the closing brace (common LLM slip).
  text = text.replace(/,\s*([}\]])/g, "$1");
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object") return null;
    const title = typeof parsed.title === "string" ? parsed.title.trim().slice(0, 200) : "Presentation";
    const subtitle = typeof parsed.subtitle === "string" ? parsed.subtitle.trim().slice(0, 300) : undefined;
    const rawSlides = Array.isArray(parsed.slides) ? parsed.slides : [];
    if (rawSlides.length === 0) return null;
    const slides: DeckSlide[] = rawSlides.slice(0, DECK_LIMITS.maxSlides).map((s: any) => {
      const kind = ["title", "section", "content", "closing"].includes(s?.kind) ? s.kind : "content";
      const slideTitle = typeof s?.title === "string" ? s.title.trim().slice(0, 200) : "";
      const bullets = Array.isArray(s?.bullets)
        ? s.bullets.filter((b: any) => typeof b === "string" && b.trim()).slice(0, 6).map((b: string) => b.trim().slice(0, 200))
        : [];
      const notes = typeof s?.notes === "string" ? s.notes.trim().slice(0, 1000) : undefined;
      return { kind, title: slideTitle || "Untitled", ...(bullets.length ? { bullets } : {}), ...(notes ? { notes } : {}) };
    });
    return { title, ...(subtitle ? { subtitle } : {}), slides };
  } catch {
    return null;
  }
}

async function generateDeck(transcript: string, styleId: string, language: "en" | "es", userId: string): Promise<{ deck: DeckDocument; tokenCost: number }> {
  const style = getDeckStyle(styleId);
  if (!style) throw Object.assign(new Error("Unknown deck style."), { status: 400 });

  const basePrompt = CONVERSION_PROMPTS.slide_deck;
  const skillContext = formatSkillForPrompt(CONVERSION_SKILLS.slide_deck, "Slide Deck");
  const kb = CONVERSION_KNOWLEDGEBASES.slide_deck || [];
  const kbContext = kb.length
    ? `\n\nREFERENCE KNOWLEDGEBASE (align your deck with these conventions and best practices, but do not cite them):\n${kb.map((r) => `- ${r.title}: ${r.url} — ${r.description}`).join("\n")}`
    : "";
  const languageInstruction = language === "es"
    ? `\n\nLANGUAGE: Write ALL slide titles, bullets, and notes in natural Mexican Spanish.`
    : "";

  const systemPrompt =
    `${basePrompt}\n\nDECK STYLE: "${style.labelKey}" — match the tone this look implies (${styleDescription(styleId)}).` +
    `\n\nOUTPUT FORMAT — STRICT JSON ONLY. Respond with a single JSON object, no prose, no code fences:\n` +
    `{"title":"Deck title","subtitle":"optional one-liner","slides":[{"kind":"title","title":"...","bullets":["..."],"notes":"speaker note"},{"kind":"content","title":"...","bullets":["...","..."],"notes":""}]}\n` +
    `KIND must be one of: title, section, content, closing. First slide kind: title. Last slide kind: closing. ` +
    `Between them use content slides (add a section slide every 3-4 content slides to break up the deck). ` +
    `Produce ${DECK_LIMITS.minSlides}-${DECK_LIMITS.maxSlides} slides total. Max 6 bullets per slide, each bullet max 12 words. ` +
    `Keep bullets scannable — short phrases, not sentences. notes holds the speaker note for that slide (may be empty).` +
    skillContext + kbContext + languageInstruction;

  const routes = resolveConversionModelRouteChain("slide_deck", await getUserConversionModelPreferences(userId)).routes;

  let lastError: unknown = null;
  for (const route of routes) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), GENERATION_TIMEOUT_MS);
    try {
      const client = createOpenAIClient(route.provider);
      const completion = await client.chat.completions.create(
        {
          model: route.model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: transcript.slice(0, DECK_LIMITS.maxTranscriptChars) },
          ],
          ...getChatCompletionTokenOptions(route.provider, 8192),
        },
        { signal: controller.signal },
      );
      const raw = completion.choices[0]?.message?.content || "";
      const deck = parseDeckJson(raw);
      if (deck) {
        const tokenCost = computeConversionTokenCost({
          usage: (completion as any)?.usage ?? null,
          inputText: systemPrompt + transcript.slice(0, DECK_LIMITS.maxTranscriptChars),
          outputText: raw,
        });
        return { deck, tokenCost };
      }
      lastError = new Error("Deck output failed JSON validation.");
    } catch (err: any) {
      lastError = err;
      console.warn(`[slide-deck] Provider ${route.provider}/${route.model} failed:`, err?.message || err);
    } finally {
      clearTimeout(timer);
    }
  }
  console.error("[slide-deck] All providers failed:", lastError);
  throw Object.assign(new Error("The deck generator is temporarily unavailable. Please try again later."), { status: 502 });
}

function styleDescription(styleId: string): string {
  const map: Record<string, string> = {
    "executive-navy": "corporate and formal; crisp, confident phrasing",
    vibrant: "bold and energetic; short, punchy statements",
    "minimal-light": "clean and understated; spare, precise wording",
    "academic-serif": "scholarly and considered; formal, evidence-minded prose",
    "bold-impact": "high-contrast and direct; telegraphic, memorable lines",
    "forest-fresh": "friendly and grounded; plain-spoken, approachable phrasing",
  };
  return map[styleId] || "professional and clear";
}

router.post("/slide-deck", requireAuth, async (req: Request, res: Response) => {
  const userId = req.userId!;
  try {
    const { transcript, style, recordingId } = req.body || {};

    const transcriptError = requireString(transcript, DECK_LIMITS.maxTranscriptChars, "Transcript");
    if (transcriptError) return res.status(400).json({ error: transcriptError });

    const deckStyle = getDeckStyle(String(style || ""));
    if (!deckStyle) {
      return res.status(400).json({
        error: "Unknown deck style.",
        available: DECK_STYLES.map((s) => s.id),
      });
    }

    const typeCheck = await isConversionTypeAllowed(userId, "slide_deck");
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

    const limitCheck = await checkConversionLimit(userId, "slide_deck");
    if (!limitCheck.allowed) {
      if (limitCheck.spendingCapReached) {
        return res.status(429).json({
          error: "spending_cap_reached",
          message: "You've reached your monthly spending cap for advanced conversions.",
        });
      }
      return res.status(429).json({
        error: "insufficient_tokens",
        message: "You've used your monthly AI Credits. Upgrade for more credits — they reset each month.",
        balance: limitCheck.balance,
      });
    }
    const globalQuota = await checkGlobalDailyDeckQuota();
    if (!globalQuota.allowed) {
      return res.status(429).json({
        error: "deck_daily_limit_reached",
        message: "Slide deck generation is temporarily at capacity. Please try again later.",
      });
    }

    const language: "en" | "es" = req.body?.language === "es" ? "es" : "en";
    const { deck, tokenCost } = await generateDeck(String(transcript), deckStyle.id, language, userId);

    const pptxBuffer = await assembleDeckPptx(deck, deckStyle);
    const safeName = `${deck.title.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 60) || "presentation"}.pptx`;

    const deckId = `deck_${randomUUID().slice(0, 8)}_${Date.now()}`;
    const record: DeckRecord = {
      id: deckId,
      userId,
      recordingId: typeof recordingId === "string" ? recordingId : undefined,
      style: deckStyle.id,
      title: deck.title,
      slides: deck.slides,
      pptxBase64: pptxBuffer.toString("base64"),
      createdAt: new Date().toISOString(),
    };
    await saveDeck(record);
    await recordDeckGeneration();
    await deductConversionTokens(userId, tokenCost);
    trackEvent("conversion_completed", userId, { conversionType: "slide_deck", style: deckStyle.id, slides: deck.slides.length });

    res.json({
      deckId,
      title: deck.title,
      subtitle: deck.subtitle,
      slides: deck.slides,
      style: deckStyle.id,
      fileName: safeName,
    });
  } catch (err: any) {
    const status = err?.status || 500;
    console.error("[slide-deck] POST /slide-deck error:", err?.message || err);
    res.status(status).json({ error: err?.message || "We had trouble generating your slide deck. Please try again." });
  }
});

router.get("/slide-deck/:id", requireAuth, async (req: Request, res: Response) => {
  const userId = req.userId!;
  const deck = await getDeck(String(req.params.id));
  if (!deck || deck.userId !== userId) {
    return res.status(404).json({ error: "Slide deck not found." });
  }
  res.json({
    deckId: deck.id,
    title: deck.title,
    slides: deck.slides,
    style: deck.style,
    createdAt: deck.createdAt,
  });
});

// Serves the generated .pptx from the deck record (durable Firestore copy).
router.get("/slide-deck/:id/export", requireAuth, async (req: Request, res: Response) => {
  const userId = req.userId!;
  const deck = await getDeck(String(req.params.id));
  if (!deck || deck.userId !== userId) {
    return res.status(404).json({ error: "Slide deck not found." });
  }
  try {
    const fileName = `${deck.title.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 60) || "presentation"}.pptx`;
    const buffer = Buffer.from(deck.pptxBase64, "base64");
    res.setHeader("Content-Type", PPTX_MIME);
    res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(fileName)}"`);
    res.setHeader("Content-Length", String(buffer.length));
    res.setHeader("Cache-Control", "private, max-age=3600");
    res.send(buffer);
  } catch (err: any) {
    console.error("[slide-deck] Export error:", err?.message || err);
    res.status(500).json({ error: "We had trouble exporting that deck." });
  }
});

export default router;
