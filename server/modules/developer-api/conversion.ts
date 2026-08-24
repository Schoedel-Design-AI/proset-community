import {
  GENEROUS_PARSING_PREAMBLE,
  CONVERSION_PROMPTS,
  ACADEMIC_CITATION_PROMPTS,
  BIBLIOGRAPHY_PROMPTS,
  BIBLIOGRAPHY_ANNOTATED_INSTRUCTIONS,
} from "../ai-customization/prompts";
import {
  createOpenAIClient,
  getChatCompletionTokenOptions,
} from "../../openai-client";
import { resolveConversionModelRouteChain } from "../../conversion-model-routing";
import { getUserConversionModelPreferences } from "../ai-customization/utils";
import { sanitizeConversionOutput } from "../../conversion-post-processor";
import {
  checkConversionLimit,
  computeConversionTokenCost,
  deductConversionTokens,
  isConversionTypeAllowed,
} from "../../usage-service";

/**
 * Non-streaming "core" conversion used by the public developer API and MCP.
 *
 * Reuses the same prompt templates, model-routing chain, post-processing, and
 * usage metering as the in-app `/api/convert` (SSE) endpoint, but returns the
 * complete artifact as a single string instead of streaming. It intentionally
 * does NOT assemble the in-app personalization context (user profile, style
 * preferences, conversion history, custom skills/knowledge base, learnings) nor
 * the live research ledger — those enrichments are in-app only for v1.
 */

export interface CoreConversionInput {
  transcript: string;
  type: string;
  customPrompt?: string;
  citationStyle?: string;
  bibliographyType?: string;
  outputFormat?: "markdown" | "plain";
  language?: string;
  confirmExtendedAccess?: boolean;
}

export interface CoreConversionResult {
  content: string;
  type: string;
  provider: string;
  model: string;
}

// Types that produce structured non-Markdown output and are excluded from the
// positive markdown format instruction (mirrors server/routes.ts).
const STRUCTURED_OUTPUT_TYPES = new Set([
  "calendar_event",
  "spreadsheet",
  "github_issue",
  "video_script",
  "text_message",
]);

function httpError(status: number, code: string, message: string): Error & { status: number; code: string } {
  return Object.assign(new Error(message), { status, code });
}

export async function runCoreConversion(
  userId: string,
  input: CoreConversionInput,
): Promise<CoreConversionResult> {
  const { transcript, type, customPrompt } = input;
  const citationStyle = input.citationStyle;
  const bibliographyType = input.bibliographyType;
  const outputFormat = input.outputFormat ?? "markdown";
  const language = input.language ?? "en";

  if (!transcript || !transcript.trim()) {
    throw httpError(400, "missing_transcript", "Please provide some text to convert.");
  }
  if (!type) {
    throw httpError(400, "missing_conversion_type", "Please provide a conversion type.");
  }
  if (customPrompt && customPrompt.length > 5000) {
    throw httpError(400, "custom_prompt_too_long", "Custom prompt is too long (max 5,000 characters).");
  }

  // Token gate — soft: allowed while the running balance is positive. A single
  // grace conversion may push the balance negative; the deduction happens after
  // the model responds with its actual token usage.
  const limitCheck = await checkConversionLimit(userId, type);
  if (!limitCheck.allowed) {
    if (limitCheck.spendingCapReached) {
      throw httpError(429, "spending_cap_reached", "You've reached your monthly spending cap for advanced conversions.");
    }
    throw httpError(429, "insufficient_tokens", "You've used your monthly AI Credits. Upgrade for more credits — they reset each month.");
  }

  const typeCheck = await isConversionTypeAllowed(userId, type);
  if (!typeCheck.allowed) {
    throw Object.assign(
      httpError(403, "conversion_type_locked", `The "${type}" conversion type is not available on your plan.`),
      { requiredTier: typeCheck.requiredTier },
    );
  }

  // Build the type-specific prompt (same templates as the in-app endpoint).
  let defaultPrompt: string | undefined;
  if (type === "academic_research") {
    const style = citationStyle && ACADEMIC_CITATION_PROMPTS[citationStyle] ? citationStyle : "apa7";
    defaultPrompt = ACADEMIC_CITATION_PROMPTS[style];
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
    throw httpError(400, "invalid_conversion_type", `Invalid conversion type: ${type}`);
  }
  const basePrompt = customPrompt && customPrompt.trim() ? customPrompt.trim() : defaultPrompt;

  const formatInstruction =
    outputFormat === "markdown" && !STRUCTURED_OUTPUT_TYPES.has(type)
      ? `\n\nOUTPUT FORMAT — MARKDOWN: Format your entire response using standard Markdown. Use # for the document title, ## for major section headers, and ### for sub-section headers. Use **bold** for key terms and important points. Use unordered lists (- item) for bullet points and ordered lists (1. item) for sequential steps or ranked items. Use > for blockquotes when highlighting key information. Use \`code\` for inline technical terms or values. Use --- for horizontal rules between major sections when appropriate. Follow standard CommonMark Markdown conventions consistently throughout. Do not mix plain-text heading styles (e.g., UPPERCASE or underlines) with Markdown.`
      : outputFormat !== "markdown"
        ? `\n\nOUTPUT FORMAT — THIS OVERRIDES ALL OTHER FORMATTING INSTRUCTIONS ABOVE: Return clean plain text only. Do not use Markdown headings, emphasis, links, checkboxes, code fences, blockquotes, or horizontal rules. Use UPPERCASE or Title Case headings, plain dashes or numbers for lists, blank lines for section separation, and indentation for hierarchy. The output must be readable without a Markdown renderer.`
        : "";

  const spanishInstruction =
    language === "es"
      ? `\n\nLANGUAGE — OUTPUT IN SPANISH: You MUST write your entire output in natural Mexican Spanish. Use warm, direct, professional language typical of Mexico. All headings, body text, labels, and explanations must be in Spanish. Do NOT mix English into the output unless the original transcript contains English terms that should be preserved (e.g. proper nouns, brand names, technical terms the user said in English). This applies regardless of the language of the transcript — always output in Spanish.`
      : "";

  const systemPrompt = GENEROUS_PARSING_PREAMBLE + basePrompt + formatInstruction + spanishInstruction;

  // Resolve the same model-routing chain the app uses, honoring the user's
  // model preferences, and fall back through the chain on failure.
  let preferences = null;
  try {
    preferences = await getUserConversionModelPreferences(userId);
  } catch (e) {
    console.warn("[developer-api] Failed to load model preferences:", e);
  }
  const routes = resolveConversionModelRouteChain(type, preferences).routes;

  let content = "";
  let usedProvider = "";
  let usedModel = "";
  let conversionUsage: any = null;
  let lastError: unknown = null;

  for (const route of routes) {
    try {
      const client = createOpenAIClient(route.provider);
      const completion = await client.chat.completions.create({
        model: route.model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: transcript },
        ],
        ...getChatCompletionTokenOptions(route.provider, 8192),
      });
      const candidate = completion.choices[0]?.message?.content ?? "";
      if (!candidate) throw new Error("Empty completion from " + route.provider);
      content = candidate;
      usedProvider = route.provider;
      usedModel = route.model;
      conversionUsage = (completion as any)?.usage ?? null;
      break;
    } catch (err) {
      lastError = err;
      console.warn(
        `[developer-api] convert provider ${route.provider}/${route.model} failed:`,
        (err as any)?.message || err,
      );
    }
  }

  if (!content) {
    console.error("[developer-api] All conversion providers failed:", lastError);
    throw httpError(502, "provider_unavailable", "All conversion providers are currently unavailable. Please try again later.");
  }

  content = sanitizeConversionOutput(type, content);
  if (!limitCheck.friendsAdvancedConversion) {
    await deductConversionTokens(userId, computeConversionTokenCost({
      usage: conversionUsage,
      inputText: `${systemPrompt}\n${transcript}`,
      outputText: content,
    }));
  }

  return { content, type, provider: usedProvider, model: usedModel };
}
