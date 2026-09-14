import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveConversionModelId,
  resolveConversionModelRoute,
  resolveConversionModelRouteChain,
} from "../../server/conversion-model-routing";

const DEDICATED_MODEL_ENV = [
  "AI_QWEN_BASE_URL",
  "QWEN_BASE_URL",
  "AI_DEEPSEEK_BASE_URL",
  "DEEPSEEK_BASE_URL",
  "AI_DEEPSEEK_API_KEY",
  "DEEPSEEK_API_KEY",
  "AI_DEEPSEEK_FLASH_MODEL",
  "AI_DEEPSEEK_PRO_MODEL",
  "GROQ_API_KEY",
  "GROQ_BASE_URL",
  "GROQ_MODEL",
  "GROQ_ADVANCED_MODEL",
  "AI_FIREWORKS_BASE_URL",
  "FIREWORKS_BASE_URL",
  "AI_FIREWORKS_API_KEY",
  "FIREWORKS_API_KEY",
  "AI_FIREWORKS_MODEL",
  "FIREWORKS_MODEL",
  "OPENAI_API_KEY",
  "AI_INTEGRATIONS_OPENAI_API_KEY",
];

function withoutDedicatedModelEnv(run: () => void) {
  const previous = Object.fromEntries(DEDICATED_MODEL_ENV.map((key) => [key, process.env[key]]));
  for (const key of DEDICATED_MODEL_ENV) delete process.env[key];
  try {
    run();
  } finally {
    for (const key of DEDICATED_MODEL_ENV) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
}

test("advanced conversions fall back to gpt-5.4 without dedicated model providers", () => {
  withoutDedicatedModelEnv(() => {
    const route = resolveConversionModelRoute("prompt");

    assert.equal(route.bucket, "advanced");
    assert.equal(route.provider, "default");
    assert.equal(route.model, "gpt-5.4");
  });
});

test("regular conversions keep the mini OpenAI fallback", () => {
  withoutDedicatedModelEnv(() => {
    const route = resolveConversionModelRoute("email");

    assert.equal(route.bucket, "regular");
    assert.equal(route.provider, "default");
    assert.equal(route.model, "gpt-5.4-mini");
  });
});

test("DeepSeek routing requires a DeepSeek key instead of borrowing the OpenAI key", () => {
  withoutDedicatedModelEnv(() => {
    process.env.AI_DEEPSEEK_BASE_URL = "https://api.deepseek.com";
    process.env.OPENAI_API_KEY = "test-openai-key";

    const route = resolveConversionModelRoute("email");
    assert.equal(route.provider, "default");
    assert.equal(route.model, "gpt-5.4-mini");
  });
});

test("deepseek-flash serves both regular and advanced DeepSeek conversions", () => {
  withoutDedicatedModelEnv(() => {
    process.env.AI_DEEPSEEK_BASE_URL = "https://api.deepseek.com";
    process.env.AI_DEEPSEEK_API_KEY = "test-deepseek-key";

    const regular = resolveConversionModelRoute("email");
    assert.equal(regular.bucket, "regular");
    assert.equal(regular.provider, "deepseek");
    assert.equal(regular.model, "deepseek-flash");

    const advanced = resolveConversionModelRoute("prompt");
    assert.equal(advanced.bucket, "advanced");
    assert.equal(advanced.provider, "deepseek");
    assert.equal(advanced.model, "deepseek-flash");
  });
});

test("default conversion chain retains lower-cost and cross-provider fallbacks", () => {
  withoutDedicatedModelEnv(() => {
    process.env.AI_DEEPSEEK_BASE_URL = "https://api.deepseek.com";
    process.env.AI_DEEPSEEK_API_KEY = "test-deepseek-key";
    process.env.GROQ_API_KEY = "test-groq-key";

    const chain = resolveConversionModelRouteChain("email");
    assert.deepEqual(
      chain.routes.map(({ provider, model }) => ({ provider, model })),
      [
        { provider: "deepseek", model: "deepseek-flash" },
        { provider: "groq", model: "qwen/qwen3.6-27b" },
        { provider: "default", model: "gpt-5.4-mini" },
      ],
    );
  });
});

test("advanced conversion chain puts OpenAI before the funded Groq GPT-OSS fallback", () => {
  withoutDedicatedModelEnv(() => {
    process.env.AI_DEEPSEEK_BASE_URL = "https://api.deepseek.com";
    process.env.AI_DEEPSEEK_API_KEY = "test-deepseek-key";
    process.env.GROQ_API_KEY = "test-groq-key";

    const chain = resolveConversionModelRouteChain("prompt");
    assert.deepEqual(
      chain.routes.map(({ provider, model }) => ({ provider, model })),
      [
        { provider: "deepseek", model: "deepseek-flash" },
        { provider: "default", model: "gpt-5.4" },
        { provider: "groq", model: "openai/gpt-oss-120b" },
      ],
    );
    assert.deepEqual(
      resolveConversionModelRoute("prompt"),
      chain.routes[0],
    );
  });
});

test("Fireworks DeepSeek is the primary regular-bucket model when configured", () => {
  withoutDedicatedModelEnv(() => {
    process.env.AI_FIREWORKS_BASE_URL = "https://api.fireworks.ai/inference/v1";
    process.env.AI_FIREWORKS_API_KEY = "test-fireworks-key";

    const chain = resolveConversionModelRouteChain("todo_list");
    assert.equal(chain.routes[0].selectedModelId, "deepseek_flash_fireworks");
    assert.equal(chain.routes[0].provider, "fireworks");
    assert.equal(chain.routes[0].model, "accounts/fireworks/models/deepseek-v4p1-flash");

    const regular = resolveConversionModelRoute("email");
    assert.equal(regular.provider, "fireworks");
    assert.equal(regular.model, "accounts/fireworks/models/deepseek-v4p1-flash");
  });
});

test("Fireworks primary falls back to Groq then official DeepSeek when all configured", () => {
  withoutDedicatedModelEnv(() => {
    process.env.AI_FIREWORKS_BASE_URL = "https://api.fireworks.ai/inference/v1";
    process.env.AI_FIREWORKS_API_KEY = "test-fireworks-key";
    process.env.AI_DEEPSEEK_BASE_URL = "https://api.deepseek.com";
    process.env.AI_DEEPSEEK_API_KEY = "test-deepseek-key";
    process.env.GROQ_API_KEY = "test-groq-key";

    const chain = resolveConversionModelRouteChain("email");
    assert.deepEqual(
      chain.routes.map(({ provider, model }) => ({ provider, model })),
      [
        { provider: "fireworks", model: "accounts/fireworks/models/deepseek-v4p1-flash" },
        { provider: "deepseek", model: "deepseek-flash" },
        { provider: "groq", model: "qwen/qwen3.6-27b" },
        { provider: "default", model: "gpt-5.4-mini" },
      ],
    );
  });
});

test("advanced types still prefer the DeepSeek advanced-lane model first with Fireworks configured", () => {
  withoutDedicatedModelEnv(() => {
    process.env.AI_FIREWORKS_BASE_URL = "https://api.fireworks.ai/inference/v1";
    process.env.AI_FIREWORKS_API_KEY = "test-fireworks-key";
    process.env.AI_DEEPSEEK_BASE_URL = "https://api.deepseek.com";
    process.env.AI_DEEPSEEK_API_KEY = "test-deepseek-key";

    const chain = resolveConversionModelRouteChain("academic_research");
    assert.equal(chain.routes[0].selectedModelId, "deepseek_advanced");
  });
});

test("Fireworks is omitted from the catalog when its key is unset (no OpenAI-key fallback)", () => {
  withoutDedicatedModelEnv(() => {
    // OpenAI key present but NO Fireworks key: the Fireworks provider must NOT
    // appear (sending the OpenAI key to Fireworks would 401 every call).
    process.env.OPENAI_API_KEY = "test-openai-key";
    process.env.AI_DEEPSEEK_BASE_URL = "https://api.deepseek.com";
    process.env.AI_DEEPSEEK_API_KEY = "test-deepseek-key";

    const chain = resolveConversionModelRouteChain("email");
    assert.ok(
      chain.routes.every((r) => r.provider !== "fireworks"),
      "Fireworks route must not appear without its own key",
    );
    assert.equal(chain.routes[0].provider, "deepseek", "DeepSeek stays primary");
  });
});

test("retired catalog ids resolve to their current replacement", () => {
  // Stored user preferences and older client payloads still carry the
  // pre-2026-09 ids. They must map forward rather than fail validation, which
  // would silently reset the user's saved model choice to the default.
  assert.equal(resolveConversionModelId("deepseek_v4_flash"), "deepseek_flash");
  assert.equal(resolveConversionModelId("deepseek_v4_flash_fireworks"), "deepseek_flash_fireworks");
  assert.equal(resolveConversionModelId("deepseek_v4_pro"), "deepseek_advanced");
  assert.equal(resolveConversionModelId("  deepseek_v4_pro  "), "deepseek_advanced");
  assert.equal(resolveConversionModelId("deepseek_flash"), "deepseek_flash");
  assert.equal(resolveConversionModelId("qwen_35_14b"), "qwen_35_14b");
  assert.equal(resolveConversionModelId("not_a_real_model"), null);
  assert.equal(resolveConversionModelId(undefined), null);
  assert.equal(resolveConversionModelId(""), null);
});
