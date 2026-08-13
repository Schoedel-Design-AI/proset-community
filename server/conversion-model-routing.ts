import { type AIClientProvider, getAIModel, hasDedicatedAIProviderConfig } from "./openai-client";

export type ConversionModelBucket = "regular" | "advanced";
export type UserSelectableConversionModelId =
  | "qwen_35_14b"
  | "deepseek_v4_flash"
  | "deepseek_v4_flash_fireworks"
  | "deepseek_v4_pro"
  | "groq_qwen_36_27b"
  | "groq_gpt_oss_120b";

export interface UserConversionModelPreferences {
  regularModelId: UserSelectableConversionModelId | null;
  advancedModelId: UserSelectableConversionModelId | null;
}

export interface UserSelectableConversionModelOption {
  id: UserSelectableConversionModelId;
  label: string;
  description: string;
  provider: Exclude<AIClientProvider, "default">;
  model: string;
  bucket: ConversionModelBucket;
}

export interface ConversionModelRoute {
  provider: AIClientProvider;
  model: string;
  reason: string;
  bucket: ConversionModelBucket;
  selectedModelId: UserSelectableConversionModelId | null;
}

const DEFAULT_CONTEXT_WINDOWS: Partial<Record<UserSelectableConversionModelId, number>> = {
  qwen_35_14b: 64_000,
  deepseek_v4_flash: 1_000_000,
  deepseek_v4_flash_fireworks: 1_000_000,
  deepseek_v4_pro: 256_000,
  groq_qwen_36_27b: 131_072,
  groq_gpt_oss_120b: 131_072,
};

export function getConversionModelInputLimit(
  route: ConversionModelRoute,
  reservedTokens = 12_000,
): number {
  const providerOverride = Number(
    process.env[`AI_CONTEXT_WINDOW_${route.provider.toUpperCase()}`],
  );
  const configuredWindow = Number.isFinite(providerOverride) && providerOverride > 0
    ? providerOverride
    : route.selectedModelId
      ? DEFAULT_CONTEXT_WINDOWS[route.selectedModelId]
      : route.model.toLowerCase().includes("gpt-5.4")
        ? 192_000
        : 64_000;
  return Math.max(16_000, (configuredWindow || 64_000) - reservedTokens);
}

/** Ordered fallback chain: primary → backup → legacy OpenAI. */
export interface ConversionModelRouteChain {
  routes: ConversionModelRoute[];
  bucket: ConversionModelBucket;
}

const SCAFFOLDED_CONVERSION_TYPES = new Set([
  "scaffolded_project_plan",
  "scaffolded_action_items",
]);

const DATA_CREATION_CONVERSION_TYPES = new Set([
  "calendar_event",
  "requirements",
  "spreadsheet",
]);

const ADVANCED_COMPLEXITY_CONVERSION_TYPES = new Set([
  "academic_research",
  "bibliography",
  "course_syllabus",
  "prompt",
]);

const MODEL_DEFINITIONS: Record<UserSelectableConversionModelId, Omit<UserSelectableConversionModelOption, "model">> = {
  qwen_35_14b: {
    id: "qwen_35_14b",
    label: "Qwen 3.5 14B",
    description: "Fast, cost-efficient model for everyday writing and document conversions.",
    provider: "qwen",
    bucket: "regular",
  },
  deepseek_v4_flash: {
    id: "deepseek_v4_flash",
    label: "DeepSeek V4 Flash",
    description: "Primary model. 1M context at $0.14/M input.",
    provider: "deepseek",
    bucket: "regular",
  },
  deepseek_v4_flash_fireworks: {
    id: "deepseek_v4_flash_fireworks",
    label: "DeepSeek V4 Flash (Fireworks)",
    description: "DeepSeek V4 Flash served by Fireworks — same model, ~176 t/s output, lower first-token latency. Primary.",
    provider: "fireworks",
    bucket: "regular",
  },
  groq_qwen_36_27b: {
    id: "groq_qwen_36_27b",
    label: "Groq Qwen 3.6 27B",
    description: "Fast backup. 662 TPS at $0.29/M input via Groq LPU.",
    provider: "groq",
    bucket: "regular",
  },
  deepseek_v4_pro: {
    id: "deepseek_v4_pro",
    label: "DeepSeek V4 Pro",
    description: "Flagship model for advanced reasoning and research. $0.44/M input after permanent 75% price cut.",
    provider: "deepseek",
    bucket: "advanced",
  },
  groq_gpt_oss_120b: {
    id: "groq_gpt_oss_120b",
    label: "Groq GPT-OSS 120B",
    description: "Production-grade 120B reasoning fallback. About 500 TPS at $0.15/M input and $0.60/M output.",
    provider: "groq",
    bucket: "advanced",
  },
};

const DEFAULT_MODEL_ORDER: Record<ConversionModelBucket, UserSelectableConversionModelId[]> = {
  // Fireworks-hosted DeepSeek V4 Flash is primary (same model, ~176 t/s,
  // lower TTFT). When Fireworks is not configured, official DeepSeek V4
  // Flash takes its place as primary (same quality). Groq Qwen 3.6 27B is
  // the fast cross-provider backup. Groq-first for mechanical types was
  // evaluated and rejected: DeepSeek V4 Flash beats Qwen3.6 27B on quality
  // (AA Intelligence Index 50 vs 37) and price ($0.06 vs $0.90/M blended).
  regular: ["deepseek_v4_flash_fireworks", "deepseek_v4_flash", "groq_qwen_36_27b"],
  advanced: ["deepseek_v4_pro", "groq_gpt_oss_120b"],
};

function parseModelListEnv(name: string): UserSelectableConversionModelId[] | null {
  const raw = process.env[name]?.trim();
  if (!raw) return null;

  const ids = raw
    .split(",")
    .map((value) => value.trim())
    .filter((value): value is UserSelectableConversionModelId => value in MODEL_DEFINITIONS);

  return ids.length > 0 ? ids : [];
}

function getBucketModelOrder(bucket: ConversionModelBucket): UserSelectableConversionModelId[] {
  const envName = bucket === "regular" ? "AI_REGULAR_MODEL_OPTIONS" : "AI_ADVANCED_MODEL_OPTIONS";
  return parseModelListEnv(envName) ?? DEFAULT_MODEL_ORDER[bucket];
}

function getConfiguredModelName(id: UserSelectableConversionModelId): string {
  switch (id) {
    case "deepseek_v4_flash":
      return process.env.AI_DEEPSEEK_FLASH_MODEL?.trim() || "deepseek-v4-flash";
    case "deepseek_v4_flash_fireworks":
      return process.env.AI_FIREWORKS_MODEL?.trim() || "accounts/fireworks/models/deepseek-v4-flash";
    case "deepseek_v4_pro":
      return process.env.AI_DEEPSEEK_PRO_MODEL?.trim() || "deepseek-v4-pro";
    case "groq_gpt_oss_120b":
      return process.env.GROQ_ADVANCED_MODEL?.trim() || "openai/gpt-oss-120b";
    default:
      return getAIModel(MODEL_DEFINITIONS[id].provider);
  }
}

function getConfiguredModelOption(id: UserSelectableConversionModelId): UserSelectableConversionModelOption | null {
  const definition = MODEL_DEFINITIONS[id];
  if (!definition || !hasDedicatedAIProviderConfig(definition.provider)) {
    return null;
  }

  return {
    ...definition,
    model: getConfiguredModelName(id),
  };
}

export function getConversionModelBucket(type: string): ConversionModelBucket {
  const normalizedType = type.trim();
  if (
    SCAFFOLDED_CONVERSION_TYPES.has(normalizedType) ||
    DATA_CREATION_CONVERSION_TYPES.has(normalizedType) ||
    ADVANCED_COMPLEXITY_CONVERSION_TYPES.has(normalizedType)
  ) {
    return "advanced";
  }
  return "regular";
}

function getConfiguredOptionsForBucket(bucket: ConversionModelBucket): UserSelectableConversionModelOption[] {
  return getBucketModelOrder(bucket)
    .filter((id) => MODEL_DEFINITIONS[id]?.bucket === bucket)
    .map((id) => getConfiguredModelOption(id))
    .filter((option): option is UserSelectableConversionModelOption => !!option);
}

export function getConfiguredConversionModelCatalog() {
  const regular = getConfiguredOptionsForBucket("regular");
  const advanced = getConfiguredOptionsForBucket("advanced");

  return {
    regular,
    advanced,
    defaults: {
      regularModelId: regular[0]?.id ?? null,
      advancedModelId: advanced[0]?.id ?? null,
    } satisfies UserConversionModelPreferences,
  };
}

function resolveLegacyOpenAIConversionModel(type: string, bucket: ConversionModelBucket): ConversionModelRoute {
  const simpleTypesNano = new Set([
    "bullet_points",
    "notes",
    "outline",
    "questions",
    "summary",
    "todo_list",
    "text_message",
    "project_plan",
  ]);

  if (type === "academic_research") {
    return {
      provider: "default",
      model: "gpt-5.4",
      reason: "legacy_openai_research_fallback",
      bucket,
      selectedModelId: null,
    };
  }

  if (simpleTypesNano.has(type)) {
    return {
      provider: "default",
      model: "gpt-5.4-nano",
      reason: "legacy_openai_simple_fallback",
      bucket,
      selectedModelId: null,
    };
  }

  return {
    provider: "default",
    model: bucket === "advanced" ? "gpt-5.4" : "gpt-5.4-mini",
    reason: "legacy_openai_default_fallback",
    bucket,
    selectedModelId: null,
  };
}

export function resolveConversionModelRoute(
  type: string,
  preferences?: Partial<UserConversionModelPreferences> | null,
): ConversionModelRoute {
  return resolveConversionModelRouteChain(type, preferences).routes[0];
}

/** Build the policy-ordered primary and fallback chain. */
export function resolveConversionModelRouteChain(
  type: string,
  preferences?: Partial<UserConversionModelPreferences> | null,
): ConversionModelRouteChain {
  const normalizedType = type.trim();
  const bucket = getConversionModelBucket(normalizedType);
  const catalog = getConfiguredConversionModelCatalog();
  const bucketOptions = bucket === "regular" ? catalog.regular : catalog.advanced;
  const selectedPreference = bucket === "regular"
    ? preferences?.regularModelId ?? null
    : preferences?.advancedModelId ?? null;

  // User explicitly picked a model — don't fall back
  if (selectedPreference) {
    const option = bucketOptions.find((o) => o.id === selectedPreference);
    if (option) {
      return {
        routes: [{
          provider: option.provider,
          model: option.model,
          reason: "user_selected_model",
          bucket,
          selectedModelId: option.id,
        }],
        bucket,
      };
    }
  }

  const configuredRoutes: ConversionModelRoute[] = bucketOptions.map((option) => ({
    provider: option.provider,
    model: option.model,
    reason: "configured_bucket_default",
    bucket,
    selectedModelId: option.id,
  }));
  const openAIFallback = resolveLegacyOpenAIConversionModel(normalizedType, bucket);

  // Advanced policy is DeepSeek V4 Pro → OpenAI GPT-5.4 → Groq GPT-OSS 120B.
  // Missing providers are skipped without changing the relative slot order.
  const routes = bucket === "advanced"
    ? [
        ...configuredRoutes.filter((route) => route.selectedModelId === "deepseek_v4_pro"),
        openAIFallback,
        ...configuredRoutes.filter((route) => route.selectedModelId !== "deepseek_v4_pro"),
      ]
    : [...configuredRoutes, openAIFallback];

  return { routes, bucket };
}
