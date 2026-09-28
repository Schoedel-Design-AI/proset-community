import * as fs from "fs";
import * as path from "path";
import { 
  type CmsBundle, 
  type CmsConversionType, 
  type CmsPrompt, 
  type CmsSkill, 
  type CmsKnowledgebase, 
  type CmsDialogueStep, 
  type CmsConversionExample,
  type CmsGlobalMemory,
  type CmsAiProvider,
  type CmsAiModel,
  type CmsAiFunction,
  CmsBundleSchema 
} from "./cms-schema";
import { 
  CONVERSION_PROMPTS, 
  CONVERSION_SKILLS, 
  CONVERSION_KNOWLEDGEBASES 
} from "./prompts";
import { type SkillDefinition, type KnowledgebaseResource } from "@shared/schema";

export interface EffectiveAiFunctionConfig {
  functionKey: string;
  displayName: string;
  category: string;
  provider: string;
  model: string;
  apiKey: string | undefined;
  baseUrl: string | undefined;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  isActive: boolean;
}

class CmsService {
  private bundle: CmsBundle | null = null;
  private promptsMap: Map<string, CmsPrompt> = new Map();
  private skillsMap: Map<string, CmsSkill> = new Map();
  private knowledgeMap: Map<string, CmsKnowledgebase[]> = new Map();
  private dialogueMap: Map<string, CmsDialogueStep[]> = new Map();
  private examplesMap: Map<string, CmsConversionExample[]> = new Map();
  private typesMap: Map<string, CmsConversionType> = new Map();
  private aiFunctionsMap: Map<string, CmsAiFunction> = new Map();
  private aiModelsMap: Map<string, CmsAiModel> = new Map();
  private aiProvidersMap: Map<string, CmsAiProvider> = new Map();
  private globalMemoryList: CmsGlobalMemory[] = [];
  private isInitialized = false;

  constructor() {
    this.loadFallbackBundle();
  }

  /**
   * Load the compiled local JSON snapshot into in-memory maps.
   * This guarantees instant synchronous resolution with 0ms database overhead.
   */
  public loadFallbackBundle() {
    try {
      const fallbackPath = path.join(__dirname, "cms-fallback.json");
      if (fs.existsSync(fallbackPath)) {
        const raw = fs.readFileSync(fallbackPath, "utf-8");
        const parsed = JSON.parse(raw);
        const validated = CmsBundleSchema.safeParse(parsed);
        if (validated.success) {
          this.applyBundle(validated.data);
          this.isInitialized = true;
          return;
        } else {
          console.warn("[CmsService] Fallback JSON failed Zod validation:", validated.error.message);
        }
      }
    } catch (err: any) {
      console.warn("[CmsService] Could not read cms-fallback.json:", err.message);
    }
  }

  public applyBundle(bundle: CmsBundle) {
    this.bundle = bundle;
    this.promptsMap.clear();
    this.skillsMap.clear();
    this.knowledgeMap.clear();
    this.dialogueMap.clear();
    this.examplesMap.clear();
    this.typesMap.clear();
    this.aiFunctionsMap.clear();
    this.aiModelsMap.clear();
    this.aiProvidersMap.clear();

    this.globalMemoryList = bundle.global_memory || [];

    for (const ct of bundle.conversion_types) {
      this.typesMap.set(ct.type_key, ct);
    }
    for (const pr of bundle.prompts) {
      this.promptsMap.set(pr.type_key, pr);
    }
    for (const sk of bundle.skills) {
      this.skillsMap.set(sk.type_key, sk);
    }
    for (const ex of bundle.examples) {
      const list = this.examplesMap.get(ex.type_key) || [];
      list.push(ex);
      this.examplesMap.set(ex.type_key, list);
    }
    for (const kb of bundle.knowledgebases) {
      const list = this.knowledgeMap.get(kb.type_key) || [];
      list.push(kb);
      this.knowledgeMap.set(kb.type_key, list);
    }
    for (const ds of bundle.dialogue_steps) {
      const list = this.dialogueMap.get(ds.type_key) || [];
      list.push(ds);
      this.dialogueMap.set(ds.type_key, list);
    }
    for (const ap of bundle.ai_providers || []) {
      this.aiProvidersMap.set(ap.provider_key, ap);
    }
    for (const am of bundle.ai_models || []) {
      this.aiModelsMap.set(am.model_key, am);
    }
    for (const af of bundle.ai_functions || []) {
      this.aiFunctionsMap.set(af.function_key, af);
    }
  }

  /**
   * Resolve effective system prompt for a conversion type.
   */
  public getPrompt(typeKey: string): string {
    const cmsPrompt = this.promptsMap.get(typeKey);
    if (cmsPrompt && cmsPrompt.is_active) {
      return cmsPrompt.system_prompt;
    }
    return CONVERSION_PROMPTS[typeKey] || "";
  }

  /**
   * Resolve effective skill definition (voice, rules, criteria).
   */
  public getSkill(typeKey: string): SkillDefinition {
    const cmsSkill = this.skillsMap.get(typeKey);
    if (cmsSkill) {
      return {
        voice: cmsSkill.voice,
        rules: cmsSkill.rules,
        outputExample: cmsSkill.output_example || "",
        qualityCriteria: cmsSkill.quality_criteria,
      };
    }
    return CONVERSION_SKILLS[typeKey] || { voice: "", rules: [], outputExample: "", qualityCriteria: [] };
  }

  /**
   * Resolve knowledgebase resources.
   */
  public getKnowledgebases(typeKey: string): KnowledgebaseResource[] {
    const cmsKb = this.knowledgeMap.get(typeKey);
    if (cmsKb && cmsKb.length > 0) {
      return cmsKb.map(k => ({
        title: k.title,
        url: k.url,
        description: k.description || "",
      }));
    }
    return CONVERSION_KNOWLEDGEBASES[typeKey] || [];
  }

  /**
   * Resolve dialogue steps (Safeguards 1 & 2).
   */
  public getDialogueSteps(typeKey: string): CmsDialogueStep[] {
    return this.dialogueMap.get(typeKey) || [];
  }

  /**
   * Retrieves all active global system memory insights and formats them for the system prompt.
   */
  public getGlobalMemoryContext(): string {
    const activeInsights = this.globalMemoryList.filter(m => m.is_active);
    if (activeInsights.length === 0) return "";
    
    let block = "\n\nCRITICAL GLOBAL SYSTEM MEMORY (APPLIES TO ALL CONVERSIONS):\n";
    activeInsights.sort((a, b) => a.display_order - b.display_order).forEach(m => {
      block += `- [${m.category || 'General'}] ${m.insight}\n`;
    });
    return block;
  }

  /**
   * Safeguard 5: Dynamic Few-Shot Injection with Anti-Mimicry.
   * Injects targeted examples matching the chosen sub_mode, accompanied by anti-mimicry meta-rules.
   */
  public getFewShotDemonstrations(typeKey: string, requestedSubMode?: string): string {
    const allExamples = this.examplesMap.get(typeKey) || [];
    if (allExamples.length === 0) return "";

    let chosen = allExamples.filter(e => e.is_active);
    if (requestedSubMode) {
      const matched = chosen.filter(e => e.sub_mode === requestedSubMode);
      if (matched.length > 0) {
        chosen = matched;
      }
    }

    // Limit to top 2 examples to prevent context flooding
    chosen = chosen.slice(0, 2);
    if (chosen.length === 0) return "";

    const lines: string[] = [
      "\n### DEMONSTRATION EXAMPLES (FEW-SHOT GUIDANCE)",
      "> CRITICAL INSTRUCTION: Do NOT copy the specific phrases, metaphors, or idioms used in these demonstrations. Learn only the underlying structural and spiritual transformation from raw voice input to refined output.\n"
    ];

    for (const ex of chosen) {
      lines.push(`#### Demonstration: ${ex.scenario_title}`);
      if (ex.sample_transcript) {
        lines.push(`**Spoken Input:**\n"${ex.sample_transcript}"\n`);
      }
      lines.push(`**Refined Output:**\n${ex.golden_output}\n`);
    }

    return lines.join("\n");
  }

  public getConversionTypeMeta(typeKey: string): CmsConversionType | undefined {
    return this.typesMap.get(typeKey);
  }

  public getAllPacks() {
    return this.bundle?.packs || [];
  }

  public getAllConversionTypes() {
    return this.bundle?.conversion_types || [];
  }

  // ---- AI Functions & Model Routing ----

  public getAiFunction(functionKey: string): CmsAiFunction | undefined {
    return this.aiFunctionsMap.get(functionKey);
  }

  public getAllAiFunctions(): CmsAiFunction[] {
    return Array.from(this.aiFunctionsMap.values());
  }

  public getAiModel(modelKey: string): CmsAiModel | undefined {
    return this.aiModelsMap.get(modelKey);
  }

  public getAllAiModels(): CmsAiModel[] {
    return Array.from(this.aiModelsMap.values());
  }

  public getAiProvider(providerKey: string): CmsAiProvider | undefined {
    return this.aiProvidersMap.get(providerKey);
  }

  public getAllAiProviders(): CmsAiProvider[] {
    return Array.from(this.aiProvidersMap.values());
  }

  private getEnvApiKeyForProvider(providerKey: string): string | undefined {
    const prov = this.aiProvidersMap.get(providerKey);
    if (prov?.env_var_name && process.env[prov.env_var_name]?.trim()) {
      return process.env[prov.env_var_name]?.trim();
    }
    switch (providerKey) {
      case "groq":
        return process.env.GROQ_API_KEY?.trim();
      case "fireworks":
        return (process.env.AI_FIREWORKS_API_KEY || process.env.FIREWORKS_API_KEY)?.trim();
      case "deepseek":
        return (process.env.AI_DEEPSEEK_API_KEY || process.env.DEEPSEEK_API_KEY || process.env.PROSET_OPENAI_API_KEY || process.env.OPENAI_API_KEY)?.trim();
      case "mistral":
        return process.env.MISTRAL_API_KEY?.trim();
      case "openai":
        return (process.env.PROSET_OPENAI_API_KEY || process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY)?.trim();
      case "qwen":
        return (process.env.AI_QWEN_API_KEY || process.env.QWEN_API_KEY || process.env.PROSET_OPENAI_API_KEY || process.env.OPENAI_API_KEY)?.trim();
      case "elevenlabs":
        return process.env.ELEVENLABS_API_KEY?.trim();
      case "cloudflare":
        return process.env.CLOUDFLARE_WORKERS_AI_API_TOKEN?.trim();
      default:
        return (process.env.PROSET_OPENAI_API_KEY || process.env.OPENAI_API_KEY)?.trim();
    }
  }

  private getDefaultBaseUrlForProvider(providerKey: string): string | undefined {
    const prov = this.aiProvidersMap.get(providerKey);
    if (prov?.default_base_url?.trim()) {
      return prov.default_base_url.trim();
    }
    switch (providerKey) {
      case "groq":
        return process.env.GROQ_BASE_URL?.trim() || "https://api.groq.com/openai/v1";
      case "fireworks":
        return (process.env.AI_FIREWORKS_BASE_URL || process.env.FIREWORKS_BASE_URL)?.trim() || "https://api.fireworks.ai/inference/v1";
      case "deepseek":
        return (process.env.AI_DEEPSEEK_BASE_URL || process.env.DEEPSEEK_BASE_URL)?.trim() || "https://api.deepseek.com";
      case "mistral":
        return "https://api.mistral.ai/v1";
      case "openai":
        return (process.env.AI_INTEGRATIONS_OPENAI_BASE_URL || process.env.OPENAI_BASE_URL)?.trim();
      case "qwen":
        return (process.env.AI_QWEN_BASE_URL || process.env.QWEN_BASE_URL)?.trim();
      default:
        return undefined;
    }
  }

  /**
   * Resolves the effective AI configuration for a given function key.
   * If a custom API key or base URL was set in Mathesar, it is honored.
   * Otherwise, it seamlessly falls back to system environment variables.
   */
  public getEffectiveAiConfig(functionKey: string): EffectiveAiFunctionConfig | undefined {
    const fn = this.aiFunctionsMap.get(functionKey);
    if (!fn || !fn.is_active) return undefined;

    const apiKey = fn.api_key?.trim() || this.getEnvApiKeyForProvider(fn.provider);
    const baseUrl = fn.base_url?.trim() || this.getDefaultBaseUrlForProvider(fn.provider);

    return {
      functionKey: fn.function_key,
      displayName: fn.display_name,
      category: fn.category,
      provider: fn.provider,
      model: fn.model,
      apiKey: apiKey || undefined,
      baseUrl: baseUrl || undefined,
      temperature: fn.temperature ?? undefined,
      maxTokens: fn.max_tokens ?? undefined,
      timeoutMs: fn.timeout_ms ?? undefined,
      isActive: fn.is_active,
    };
  }

  public getBundle(): CmsBundle | null {
    return this.bundle;
  }

  public getStatus() {
    return {
      isInitialized: this.isInitialized,
      version: this.bundle?.version || "unknown",
      exportedAt: this.bundle?.exported_at || null,
      counts: {
        packs: this.bundle?.packs.length ?? 0,
        conversionTypes: this.typesMap.size,
        prompts: this.promptsMap.size,
        skills: this.skillsMap.size,
        examples: this.bundle?.examples.length ?? 0,
        knowledgebases: this.bundle?.knowledgebases.length ?? 0,
        dialogueSteps: this.bundle?.dialogue_steps.length ?? 0,
        aiFunctions: this.aiFunctionsMap.size,
        aiModels: this.aiModelsMap.size,
        aiProviders: this.aiProvidersMap.size,
      },
    };
  }

  public async saveBundleToFirestore(bundle: CmsBundle): Promise<boolean> {
    try {
      const { getFirestore } = require("firebase-admin/firestore");
      const db = getFirestore();
      await db.collection("system_config").doc("cms_bundle").set(bundle);
      return true;
    } catch (err: any) {
      console.warn("[CmsService] Could not persist bundle to Firestore:", err.message);
      return false;
    }
  }

  public async loadBundleFromFirestore(): Promise<boolean> {
    try {
      const { getFirestore } = require("firebase-admin/firestore");
      const db = getFirestore();
      const snap = await db.collection("system_config").doc("cms_bundle").get();
      if (snap.exists) {
        const data = snap.data();
        const validated = CmsBundleSchema.safeParse(data);
        if (validated.success) {
          this.applyBundle(validated.data);
          this.isInitialized = true;
          console.log(`[CmsService] Successfully loaded live bundle from Firestore (v${validated.data.version}, exported at ${validated.data.exported_at})`);
          return true;
        }
      }
    } catch {
      // Non-fatal if Firestore not configured (e.g. test environment)
    }
    return false;
  }

  public initRealtimeFirestoreListener() {
    try {
      const { getFirestore } = require("firebase-admin/firestore");
      const db = getFirestore();
      db.collection("system_config").doc("cms_bundle").onSnapshot((snap: any) => {
        if (snap && snap.exists) {
          const data = snap.data();
          const validated = CmsBundleSchema.safeParse(data);
          if (validated.success) {
            this.applyBundle(validated.data);
            this.isInitialized = true;
            console.log(`[CmsService] Real-time hot-reload applied from Firestore (v${validated.data.version})`);
          }
        }
      }, () => {});
    } catch {
      // Non-fatal
    }
  }
}

export const cmsService = new CmsService();
