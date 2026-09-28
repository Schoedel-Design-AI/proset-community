import { test } from "node:test";
import assert from "node:assert";
import { executeConversionEval } from "../../server/modules/ai-customization/eval-service";
import { cmsService } from "../../server/modules/ai-customization/cms-service";

test("executeConversionEval should be exported correctly", async () => {
  cmsService.applyBundle({
    version: "1.0.0",
    exported_at: "2026-09-22T00:00:00Z",
    packs: [],
    conversion_types: [],
    prompts: [],
    skills: [],
    knowledgebases: [],
    dialogue_steps: [],
    examples: [],
    ai_functions: [],
    ai_models: [],
    ai_providers: [],
    taxonomies: [],
    global_memory: []
  });

  assert.strictEqual(typeof executeConversionEval, "function");
});
