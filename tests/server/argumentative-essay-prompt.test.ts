import assert from "node:assert/strict";
import test from "node:test";

import { CONVERSION_PROMPTS } from "../../server/modules/ai-customization/prompts";

test("argumentative essay prompt requires primary and peer-reviewed sources", () => {
  const prompt = CONVERSION_PROMPTS.argumentative_essay;

  assert.match(prompt, /primary sources and peer-reviewed journal articles only/i);
});

test("argumentative essay prompt requires citation-style-compliant fact citations", () => {
  const prompt = CONVERSION_PROMPTS.argumentative_essay;

  assert.match(
    prompt,
    /when a citation style is selected, follow that style exactly for all in-text citations and references/i,
  );
});
