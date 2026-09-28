import { createCustomOpenAIClient, createOpenAIClient, getChatCompletionTokenOptions, AIClientProvider } from "../../openai-client";
import { cmsService } from "./cms-service";
import { computeConversionTokenCost } from "../../usage-service";
import { GENEROUS_PARSING_PREAMBLE } from "./prompts";
import { sanitizeConversionOutput } from "../../conversion-post-processor";

export interface ConversionEvalParams {
  typeKey: string;
  testModel?: string | null;
  promptOverride?: string | null;
  inputTranscript: string;
  goldenOutput?: string | null;
  language?: string;
}

export interface ConversionEvalResult {
  success: boolean;
  actualOutput: string;
  latencyMs: number;
  tokenCostCents: number;
  providerUsed: string;
  modelUsed: string;
  promptUsed: string;
  similarityScore?: number;
  judgeReasoning?: string;
  error?: string;
}

// Simple estimated cost mapping in cents per 1,000 tokens (avg input/output)
const COST_ESTIMATES_CENTS_PER_1K: Record<string, number> = {
  "gpt-4o": 0.5,
  "gpt-4o-2024-08-06": 0.5,
  "gpt-4o-mini": 0.035,
  "claude-3-5-sonnet-20240620": 0.9,
  "llama-3.3-70b-versatile": 0.07,
  "deepseek-chat": 0.02,
  "mistral-large-latest": 0.4,
};

async function runJudgeEvaluation(actual: string, golden: string): Promise<{ score: number; reasoning: string }> {
  try {
    const client = createOpenAIClient("default"); // Use Proset default (e.g. OpenAI)
    
    const prompt = `You are an expert evaluator grading the quality of an AI-generated output against a golden reference.
Your goal is to determine if the ACTUAL output fulfills the same structural, formatting, and tonal constraints as the GOLDEN reference. They do not need to match word-for-word, but they must serve the same intent and obey the same rules.

Analyze the two texts and output a JSON object with:
- "score": an integer from 0 to 100 representing how well the actual output matches the golden standard's intent and constraints.
- "reasoning": a concise 1-2 sentence explanation for the score.`;

    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.0,
      messages: [
        { role: "system", content: prompt },
        { role: "user", content: `GOLDEN REFERENCE:\n${golden}\n\nACTUAL OUTPUT:\n${actual}` }
      ],
      response_format: { type: "json_object" },
    });

    const resultText = completion.choices[0]?.message?.content || "{}";
    const resultJson = JSON.parse(resultText);
    return {
      score: typeof resultJson.score === 'number' ? resultJson.score : 0,
      reasoning: resultJson.reasoning || "Failed to parse reasoning."
    };
  } catch (err: any) {
    console.error("[runJudgeEvaluation] Error:", err.message);
    return { score: 0, reasoning: "Judge model error: " + err.message };
  }
}

export async function executeConversionEval(params: ConversionEvalParams): Promise<ConversionEvalResult> {
  const { typeKey, testModel, promptOverride, inputTranscript, language = "en" } = params;

  // 1. Resolve prompt
  let basePrompt = "";
  if (promptOverride && promptOverride.trim()) {
    basePrompt = promptOverride.trim();
  } else {
    basePrompt = cmsService.getPrompt(typeKey) || "";
  }
  
  const skill = cmsService.getSkill(typeKey);
  let skillContext = "";
  if (skill.voice || (skill.rules && skill.rules.length > 0)) {
    skillContext = "\n\nCRITICAL CONSTRAINTS:\n";
    if (skill.voice) skillContext += `- VOICE & TONE: ${skill.voice}\n`;
    skill.rules?.forEach(r => skillContext += `- ${r}\n`);
  }

  const kbs = cmsService.getKnowledgebases(typeKey);
  let kbContext = "";
  if (kbs.length > 0) {
    kbContext = "\n\nKNOWLEDGE BASE CONTEXT:\n";
    kbs.forEach(kb => kbContext += `Source: ${kb.title}\n${kb.description}\n\n`);
  }

  const demosContext = cmsService.getFewShotDemonstrations(typeKey);
  const demosStr = demosContext ? "\n\n" + demosContext : "";

  const formatInstruction = "\n\nOUTPUT FORMAT — MARKDOWN: Format your entire response using standard Markdown.";
  const globalMemoryContext = cmsService.getGlobalMemoryContext();
  
  const systemPrompt = GENEROUS_PARSING_PREAMBLE + globalMemoryContext + basePrompt + skillContext + kbContext + demosStr + formatInstruction;

  // 2. Resolve AI Model Config
  let provider = "openai";
  let model = "gpt-4o-mini";
  let apiKey: string | undefined;
  let baseUrl: string | undefined;
  let temperature = 0.7;

  if (testModel) {
    const aiModel = cmsService.getAiModel(testModel);
    if (aiModel) {
      model = aiModel.model_key;
      provider = aiModel.provider_key;
      // Find a matching function that uses this model to borrow its config/keys, or try to get env keys directly
      // Fortunately we can mock a function config lookup or fallback to default client
      const fns = cmsService.getAllAiFunctions().filter(f => f.model === testModel);
      if (fns.length > 0) {
        const config = cmsService.getEffectiveAiConfig(fns[0].function_key);
        if (config) {
          apiKey = config.apiKey;
          baseUrl = config.baseUrl;
          temperature = config.temperature ?? temperature;
        }
      }
    } else {
      model = testModel; // Fallback to whatever string was provided
    }
  } else {
    // Default fallback to conversion.core
    const coreConfig = cmsService.getEffectiveAiConfig("conversion." + typeKey) || cmsService.getEffectiveAiConfig("conversion.core");
    if (coreConfig) {
      provider = coreConfig.provider;
      model = coreConfig.model;
      apiKey = coreConfig.apiKey;
      baseUrl = coreConfig.baseUrl;
      temperature = coreConfig.temperature ?? temperature;
    }
  }

  const client = (apiKey || baseUrl) 
    ? createCustomOpenAIClient(apiKey || "missing-key", baseUrl) 
    : createOpenAIClient((provider === "default" || provider === "qwen" || provider === "deepseek" || provider === "groq" || provider === "fireworks") ? provider as AIClientProvider : "default");

  const startTime = Date.now();
  let candidate = "";
  let success = false;
  let errorMsg: string | undefined;
  let usage: any = null;

  try {
    const completion = await client.chat.completions.create({
      model: model,
      temperature,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: inputTranscript }
      ],
      ...getChatCompletionTokenOptions((provider as AIClientProvider) || "default", 8192)
    });
    
    candidate = completion.choices[0]?.message?.content ?? "";
    usage = completion.usage;
    success = !!candidate;
  } catch (err: any) {
    errorMsg = err.message || String(err);
  }

  const latencyMs = Date.now() - startTime;
  const actualOutput = candidate ? sanitizeConversionOutput(typeKey, candidate) : "";

  // 3. Compute Tokens and Cost
  const tokenCount = computeConversionTokenCost({ usage, inputText: inputTranscript, outputText: actualOutput });
  let tokenCostCents = 0;
  
  let rate = COST_ESTIMATES_CENTS_PER_1K[model];
  if (!rate) {
    if (model.includes("mini") || model.includes("flash") || model.includes("haiku") || model.includes("8b")) {
      rate = 0.05;
    } else {
      rate = 0.2; // default fallback for mid-tier
    }
  }
  tokenCostCents = Number(((tokenCount / 1000) * rate).toFixed(6));

  let similarityScore: number | undefined;
  let judgeReasoning: string | undefined;

  if (success && params.goldenOutput && actualOutput) {
    const judgeResult = await runJudgeEvaluation(actualOutput, params.goldenOutput);
    similarityScore = judgeResult.score;
    judgeReasoning = judgeResult.reasoning;
  }

  return {
    success,
    actualOutput,
    latencyMs,
    tokenCostCents,
    providerUsed: provider,
    modelUsed: model,
    promptUsed: systemPrompt,
    similarityScore,
    judgeReasoning,
    error: errorMsg
  };
}
