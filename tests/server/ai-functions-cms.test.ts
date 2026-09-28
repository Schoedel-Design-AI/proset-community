import assert from "node:assert/strict";
import test from "node:test";

import { cmsService } from "../../server/modules/ai-customization/cms-service";
import { createAIClientForFunction } from "../../server/openai-client";
import { getTranscriptionRoutes } from "../../server/transcription-routing";
import { resolveConversionModelRouteChain } from "../../server/conversion-model-routing";

test("cmsService loads and indexes all 17 AI functions from fallback bundle", () => {
  const functions = cmsService.getAllAiFunctions();
  assert.equal(functions.length, 17, "Should have exactly 17 AI functions registered");

  const expectedFunctionKeys = [
    "transcription_primary",
    "transcription_fallback_1",
    "transcription_fallback_2",
    "conversion_regular",
    "conversion_regular_backup",
    "conversion_advanced",
    "conversion_advanced_backup",
    "conversion_slide_deck",
    "clarify_questions",
    "learning_reflection",
    "research_academic_extraction",
    "research_web_synthesis",
    "thought_thread_extraction",
    "thought_thread_audit",
    "developer_api_conversion",
    "text_to_speech",
    "music_generation",
  ];

  for (const key of expectedFunctionKeys) {
    const fn = cmsService.getAiFunction(key);
    assert.ok(fn, `AI function '${key}' must exist`);
    assert.equal(fn.function_key, key);
    assert.ok(fn.provider, `AI function '${key}' must have a provider`);
    assert.ok(fn.model, `AI function '${key}' must have a model`);
  }
});

test("cmsService indexes AI providers and models with foreign key consistency", () => {
  const providers = ["groq", "fireworks", "deepseek", "mistral", "openai", "qwen", "elevenlabs", "cloudflare"];
  for (const p of providers) {
    const provider = cmsService.getAiProvider(p);
    assert.ok(provider, `Provider '${p}' must be indexed`);
    assert.ok(provider.env_var_name, `Provider '${p}' must have an env_var_name`);
  }

  const fn = cmsService.getAiFunction("transcription_primary");
  assert.ok(fn);
  const model = cmsService.getAiModel(fn.model);
  assert.ok(model, `Model '${fn.model}' referenced by transcription_primary must exist in aiModels`);
  assert.equal(model.provider_key, fn.provider);
});

test("getEffectiveAiConfig resolves default env variables when API key is unset", () => {
  const originalGroqKey = process.env.GROQ_API_KEY;
  try {
    process.env.GROQ_API_KEY = "test-mock-groq-key-12345";
    const config = cmsService.getEffectiveAiConfig("transcription_primary");
    assert.ok(config);
    assert.equal(config.apiKey, "test-mock-groq-key-12345");
    assert.equal(config.provider, "groq");
    assert.equal(config.model, "whisper-large-v3");
    assert.equal(config.baseUrl, "https://api.groq.com/openai/v1");
  } finally {
    if (originalGroqKey !== undefined) {
      process.env.GROQ_API_KEY = originalGroqKey;
    } else {
      delete process.env.GROQ_API_KEY;
    }
  }
});

test("getEffectiveAiConfig respects custom API key and base URL overrides", () => {
  const fn = cmsService.getAiFunction("clarify_questions");
  assert.ok(fn);

  // Temporarily set custom API key & base URL on the function object in memory
  const prevKey = fn.api_key;
  const prevBaseUrl = fn.base_url;
  try {
    fn.api_key = "custom-override-key-xyz";
    fn.base_url = "https://custom.llm.gateway/v1";

    const config = cmsService.getEffectiveAiConfig("clarify_questions");
    assert.ok(config);
    assert.equal(config.apiKey, "custom-override-key-xyz");
    assert.equal(config.baseUrl, "https://custom.llm.gateway/v1");
  } finally {
    fn.api_key = prevKey;
    fn.base_url = prevBaseUrl;
  }
});

test("createAIClientForFunction instantiates an OpenAI client with proper configuration", () => {
  const resolved = createAIClientForFunction("learning_reflection", {
    defaultProvider: "fireworks",
    defaultModel: "accounts/fireworks/models/qwen2p5-72b-instruct",
  });
  assert.ok(resolved, "Should return resolution object");
  assert.ok(resolved.client, "Should have initialized client property");
  assert.equal(resolved.provider, "groq");
  assert.equal(resolved.model, "openai/gpt-oss-120b");
});

test("transcription routes incorporate CMS models and custom settings", () => {
  const mockEnv = {
    GROQ_API_KEY: "mock-groq-key",
    MISTRAL_API_KEY: "mock-mistral-key",
    OPENAI_API_KEY: "mock-openai-key",
  };
  const routes = getTranscriptionRoutes(mockEnv);
  assert.ok(routes.length >= 3, "Should return at least 3 transcription routes");
  assert.equal(routes[0].provider, "groq");
  assert.equal(routes[0].model, "whisper-large-v3");
});

test("conversion model route chain respects function-specific overrides over bucket defaults", () => {
  const emailChain = resolveConversionModelRouteChain("email");
  assert.ok(emailChain.routes.length > 0, "Should return route chain for email conversion");
  assert.ok(emailChain.routes[0].model, "Primary route should have a model");
});
