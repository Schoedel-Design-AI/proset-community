import OpenAI from "openai";

export type AIClientProvider = "default" | "qwen" | "deepseek" | "groq" | "fireworks";

const clientCache = new Map<AIClientProvider, OpenAI>();

function getFirstEnvValue(names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return undefined;
}

function getDefaultOpenAIApiKey(): string | undefined {
  return getFirstEnvValue(["AI_INTEGRATIONS_OPENAI_API_KEY", "OPENAI_API_KEY"]);
}

function getDefaultOpenAIBaseUrl(): string | undefined {
  return getFirstEnvValue(["AI_INTEGRATIONS_OPENAI_BASE_URL", "OPENAI_BASE_URL"]);
}

function getDedicatedProviderBaseUrl(provider: Exclude<AIClientProvider, "default">): string | undefined {
  switch (provider) {
    case "qwen":
      return getFirstEnvValue(["AI_QWEN_BASE_URL", "QWEN_BASE_URL"]);
    case "deepseek":
      return getFirstEnvValue(["AI_DEEPSEEK_BASE_URL", "DEEPSEEK_BASE_URL"]);
    case "groq":
      return getFirstEnvValue(["GROQ_BASE_URL"]) || "https://api.groq.com/openai/v1";
    case "fireworks":
      return getFirstEnvValue(["AI_FIREWORKS_BASE_URL", "FIREWORKS_BASE_URL"]) || "https://api.fireworks.ai/inference/v1";
  }
}

function getDedicatedProviderApiKey(provider: Exclude<AIClientProvider, "default">): string | undefined {
  switch (provider) {
    case "qwen":
      return getFirstEnvValue(["AI_QWEN_API_KEY", "QWEN_API_KEY"]);
    case "deepseek":
      return getFirstEnvValue(["AI_DEEPSEEK_API_KEY", "DEEPSEEK_API_KEY"]);
    case "groq":
      return getFirstEnvValue(["GROQ_API_KEY"]);
    case "fireworks":
      return getFirstEnvValue(["AI_FIREWORKS_API_KEY", "FIREWORKS_API_KEY"]);
  }
}

export function getOpenAIApiKey(provider: AIClientProvider = "default"): string | undefined {
  switch (provider) {
    case "qwen":
      return getDedicatedProviderApiKey("qwen") || getDefaultOpenAIApiKey();
    case "deepseek":
      return getDedicatedProviderApiKey("deepseek") || getDefaultOpenAIApiKey();
    case "groq":
      return getDedicatedProviderApiKey("groq");
    case "fireworks":
      // No OpenAI-key fallback: sending the OpenAI key to Fireworks' endpoint
      // would 401 on every call. If the Fireworks key is unset, the provider
      // is treated as unconfigured and omitted from the catalog (graceful
      // degradation to DeepSeek/Groq/OpenAI).
      return getDedicatedProviderApiKey("fireworks");
    default:
      return getDefaultOpenAIApiKey();
  }
}

export function getOpenAIBaseUrl(provider: AIClientProvider = "default"): string | undefined {
  switch (provider) {
    case "qwen":
      return getDedicatedProviderBaseUrl("qwen") || getDefaultOpenAIBaseUrl();
    case "deepseek":
      return getDedicatedProviderBaseUrl("deepseek") || getDefaultOpenAIBaseUrl();
    case "groq":
      return getDedicatedProviderBaseUrl("groq") || getDefaultOpenAIBaseUrl();
    case "fireworks":
      return getDedicatedProviderBaseUrl("fireworks") || getDefaultOpenAIBaseUrl();
    default:
      return getDefaultOpenAIBaseUrl();
  }
}

export function hasDedicatedAIBaseUrl(provider: Exclude<AIClientProvider, "default">): boolean {
  return !!getDedicatedProviderBaseUrl(provider);
}

export function hasDedicatedAIProviderConfig(provider: Exclude<AIClientProvider, "default">): boolean {
  return hasDedicatedAIBaseUrl(provider) && !!getDedicatedProviderApiKey(provider);
}

export function getAIModel(provider: AIClientProvider): string {
  switch (provider) {
    case "qwen":
      return getFirstEnvValue(["AI_QWEN_MODEL", "QWEN_MODEL"]) || "Qwen/Qwen3.5-14B-Instruct";
    case "deepseek":
      return getFirstEnvValue(["AI_DEEPSEEK_MODEL", "DEEPSEEK_MODEL"]) || "deepseek-v4-flash";
    case "groq":
      return getFirstEnvValue(["GROQ_MODEL"]) || "qwen/qwen3.6-27b";
    case "fireworks":
      return getFirstEnvValue(["AI_FIREWORKS_MODEL", "FIREWORKS_MODEL"]) || "accounts/fireworks/models/deepseek-v4-flash";
    default:
      return "gpt-5.4-mini";
  }
}

export function hasOpenAIConfig(provider: AIClientProvider = "default"): boolean {
  return !!getOpenAIApiKey(provider);
}

export function getChatCompletionTokenOptions(provider: AIClientProvider, maxTokens: number): { max_tokens: number } | { max_completion_tokens: number } {
  if (provider === "default") {
    return { max_completion_tokens: maxTokens };
  }
  // RunPod/vLLM-style OpenAI-compatible servers generally expect max_tokens.
  return { max_tokens: maxTokens };
}

export function createOpenAIClient(provider: AIClientProvider = "default"): OpenAI {
  const cached = clientCache.get(provider);
  if (cached) return cached;

  const apiKey = getOpenAIApiKey(provider) || "missing-openai-api-key";
  const baseURL = getOpenAIBaseUrl(provider);

  const client = new OpenAI({
    apiKey,
    ...(baseURL ? { baseURL } : {}),
  });

  clientCache.set(provider, client);
  return client;
}
