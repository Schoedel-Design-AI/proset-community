import assert from "node:assert/strict";
import test from "node:test";

import { CONVERSION_PROMPTS } from "../../server/modules/ai-customization/prompts";

test("nonfiction_draft prompt enforces primary and peer-reviewed sourcing rules", () => {
  const prompt = CONVERSION_PROMPTS.nonfiction_draft;

  assert.ok(prompt.includes("Use only primary sources and peer-reviewed sources (such as journal articles) for factual claims."));
  assert.ok(prompt.includes("Do not use Wikipedia or other encyclopedias as sources."));
  assert.ok(prompt.includes("Cite every factual claim using the citation style selected for the conversion"));
});
