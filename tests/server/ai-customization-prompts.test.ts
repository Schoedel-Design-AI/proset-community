import assert from "node:assert/strict";
import test from "node:test";

import {
  ACADEMIC_CITATION_PROMPTS,
  BIBLIOGRAPHY_PROMPTS,
  CONVERSION_KNOWLEDGEBASES,
  CONVERSION_PROMPTS,
  CONVERSION_SKILLS,
} from "../../server/modules/ai-customization/prompts";
import { TIER_CONVERSION_TYPES as SERVER_TIER_CONVERSION_TYPES } from "../../server/usage-service";
import { CONVERSION_TYPES, MODULE_CONVERSION_TYPES, TIER_CONVERSION_TYPES } from "../../lib/utils";
import { SELF_SERVICE_MODULE_CATALOG } from "../../shared/self-service-modules";

test("all visible conversion types have optimized prompt, skill, and knowledgebase defaults", () => {
  for (const { value } of CONVERSION_TYPES) {
    const prompt = CONVERSION_PROMPTS[value];
    const skill = CONVERSION_SKILLS[value];
    const resources = CONVERSION_KNOWLEDGEBASES[value];

    assert.equal(typeof prompt, "string", `${value} should define a default prompt`);
    assert.ok(prompt.trim().length > 0, `${value} prompt should not be empty`);

    assert.ok(skill, `${value} should define a default skill profile`);
    assert.ok(skill.voice.trim().length > 0, `${value} skill should define a voice`);
    assert.ok(skill.rules.length > 0, `${value} skill should define rules`);
    assert.ok(skill.outputExample.trim().length > 0, `${value} skill should include an output example`);
    assert.ok(skill.qualityCriteria.length > 0, `${value} skill should define quality criteria`);

    assert.ok(resources?.length > 0, `${value} should include default knowledgebase resources`);
    for (const resource of resources) {
      assert.ok(resource.title.trim().length > 0, `${value} resource should have a title`);
      assert.match(resource.url, /^https?:\/\//, `${value} resource should have an http(s) URL`);
      assert.ok(resource.description.trim().length > 0, `${value} resource should have a description`);
    }
  }
});

test("server and client tier conversion maps stay in sync", () => {
  for (const tier of ["free", "base", "pro"] as const) {
    assert.deepEqual(
      new Set(SERVER_TIER_CONVERSION_TYPES[tier]),
      new Set(TIER_CONVERSION_TYPES[tier]),
      `${tier} conversion access should match between server and client`,
    );
  }
});

test("module conversion type lists stay in sync with the self-service catalog", () => {
  for (const [moduleName, types] of Object.entries(MODULE_CONVERSION_TYPES)) {
    const module = SELF_SERVICE_MODULE_CATALOG[moduleName as keyof typeof SELF_SERVICE_MODULE_CATALOG];
    const catalogTypes = module && "conversionTypes" in module ? module.conversionTypes : undefined;
    assert.ok(catalogTypes, `module '${moduleName}' missing from self-service catalog`);
    assert.deepEqual(
      new Set(types),
      new Set(catalogTypes),
      `MODULE_CONVERSION_TYPES and SELF_SERVICE_MODULE_CATALOG disagree for '${moduleName}'`,
    );
  }
});

test("paid tiers retain every free conversion type", () => {
  for (const tier of ["base", "pro"] as const) {
    for (const type of TIER_CONVERSION_TYPES.free) {
      assert.ok(
        TIER_CONVERSION_TYPES[tier].includes(type),
        `${tier} should retain the free conversion type ${type}`,
      );
    }
  }
});

test("research conversions prohibit fabricated source metadata", () => {
  const guidance = [
    ...Object.values(ACADEMIC_CITATION_PROMPTS),
    ...Object.values(BIBLIOGRAPHY_PROMPTS),
    ...CONVERSION_SKILLS.bibliography.rules,
  ].join("\n");

  assert.doesNotMatch(guidance, /generate plausible|plausible references|illustrative references/i);
  assert.match(guidance, /Never invent/i);
  assert.match(guidance, /WEB RESEARCH context/i);
});

test("notes and outline prompts require only the requested conversion artifact", () => {
  for (const type of ["notes", "outline"] as const) {
    const prompt = CONVERSION_PROMPTS[type];

    assert.match(prompt, /only the finished/i);
    assert.match(prompt, /do not include.*prompt/i);
    assert.match(prompt, /reasoning|analysis|thinking/i);
  }
});

test("essay_explainer prompt includes neurodivergent-friendly supports", () => {
  const prompt = CONVERSION_PROMPTS.essay_explainer;

  assert.ok(prompt, "essay_explainer prompt should exist");
  assert.match(prompt, /Neurodivergent-Friendly Support/);
  assert.match(prompt, /Plain-Language Pass/);
  assert.match(prompt, /Chunked Reading Path/);
  assert.match(prompt, /Signal Words Guide/);
  assert.match(prompt, /3 Key Takeaways/);
  assert.match(prompt, /Quick Check/);
});

test("lesson_plan prompt requires evidence-based and neurodivergent-inclusive planning", () => {
  const prompt = CONVERSION_PROMPTS.lesson_plan;

  assert.ok(prompt.includes("evidence-based instructional strategies"));
  assert.ok(prompt.includes("neurodivergent learners"));
});

test("lesson_plan conversion defines customization skill guidance", () => {
  const lessonPlanSkill = CONVERSION_SKILLS.lesson_plan;

  assert.ok(lessonPlanSkill);
  assert.ok(lessonPlanSkill.rules.some((rule) => rule.includes("evidence-based")));
  assert.ok(lessonPlanSkill.rules.some((rule) => rule.includes("neurodivergent")));
});

test("lesson_plan conversion includes evidence and inclusion knowledgebase resources", () => {
  const resources = CONVERSION_KNOWLEDGEBASES.lesson_plan;

  assert.ok(Array.isArray(resources));
  assert.ok(resources.length >= 3);
  assert.ok(resources.some((resource) => resource.title.includes("Universal Design for Learning")));
});

test("course syllabus conversion includes default prompt, skill, and knowledgebase support", () => {
  const prompt = CONVERSION_PROMPTS.course_syllabus;
  const skill = CONVERSION_SKILLS.course_syllabus;
  const knowledgebase = CONVERSION_KNOWLEDGEBASES.course_syllabus;

  assert.equal(typeof prompt, "string");
  assert.match(prompt, /course syllabus/i);

  assert.ok(skill);
  assert.ok(skill.voice.length > 0);
  assert.ok(skill.rules.length > 0);
  assert.ok(skill.outputExample.length > 0);
  assert.ok(skill.qualityCriteria.length > 0);

  assert.ok(Array.isArray(knowledgebase));
  assert.ok(knowledgebase.length >= 3);
  for (const resource of knowledgebase) {
    assert.ok(resource.title.length > 0);
    assert.match(resource.url, /^https?:\/\//);
    assert.ok(resource.description.length > 0);
  }
});

const SCAFFOLDED_CONVERSION_TYPES = [
  "adhd_plan",
  "scaffolded_project_plan",
  "scaffolded_action_items",
] as const;

test("scaffolded conversions include complete default skill guidance", () => {
  for (const type of SCAFFOLDED_CONVERSION_TYPES) {
    const skill = CONVERSION_SKILLS[type];

    assert.ok(skill, `${type} should have a default skill`);
    assert.ok(skill.voice.length > 0, `${type} should define a voice`);
    assert.ok(skill.rules.length >= 5, `${type} should define detailed rules`);
    assert.ok(skill.outputExample.length > 0, `${type} should include an output example`);
    assert.ok(skill.qualityCriteria.length >= 4, `${type} should define quality criteria`);

    const combinedGuidance = [
      skill.voice,
      ...skill.rules,
      skill.outputExample,
      ...skill.qualityCriteria,
    ].join(" ");

    assert.match(combinedGuidance, /ADHD/i, `${type} should explicitly mention ADHD`);
    assert.match(combinedGuidance, /evidence-based/i, `${type} should require evidence-based methods`);
    assert.match(combinedGuidance, /scaffold/i, `${type} should emphasize scaffolding`);
  }
});

test("scaffolded conversions include evidence-oriented knowledgebase defaults", () => {
  for (const type of SCAFFOLDED_CONVERSION_TYPES) {
    const resources = CONVERSION_KNOWLEDGEBASES[type];

    assert.ok(resources?.length >= 3, `${type} should include default resources`);
    assert.ok(
      resources.some((resource) => /ADHD/i.test(`${resource.title} ${resource.description}`)),
      `${type} should include ADHD-specific resources`,
    );
    assert.ok(
      resources.some((resource) => /evidence|guideline|clinical|psychology/i.test(resource.description)),
      `${type} should include evidence-oriented resources`,
    );
  }
});

test("statistics conversion has a complete default skill definition", () => {
  const statisticsSkill = CONVERSION_SKILLS.statistics;

  assert.ok(statisticsSkill);
  assert.strictEqual(typeof statisticsSkill.voice, "string");
  assert.ok(statisticsSkill.voice.trim().length > 0);
  assert.strictEqual(typeof statisticsSkill.outputExample, "string");
  assert.ok(statisticsSkill.outputExample.trim().length > 0);
  assert.ok(Array.isArray(statisticsSkill.rules));
  assert.ok(Array.isArray(statisticsSkill.qualityCriteria));
  assert.ok(statisticsSkill.rules.length > 0);
  assert.ok(statisticsSkill.qualityCriteria.length > 0);
  assert.ok(statisticsSkill.rules.every((rule) => typeof rule === "string" && rule.trim().length > 0));
  assert.ok(
    statisticsSkill.qualityCriteria.every((criterion) => typeof criterion === "string" && criterion.trim().length > 0),
  );
});

test("statistics conversion has default knowledgebase resources with all fields", () => {
  const statisticsKnowledgebase = CONVERSION_KNOWLEDGEBASES.statistics;

  assert.ok(statisticsKnowledgebase);
  assert.ok(statisticsKnowledgebase.length > 0);
  assert.ok(
    statisticsKnowledgebase.every((resource) =>
      typeof resource.title === "string" &&
      resource.title.trim().length > 0 &&
      typeof resource.url === "string" &&
      resource.url.trim().length > 0 &&
      typeof resource.description === "string" &&
      resource.description.trim().length > 0,
    ),
  );
});

test("video_script conversion has complete prompt, skill, and knowledgebase", () => {
  const prompt = CONVERSION_PROMPTS.video_script;
  const skill = CONVERSION_SKILLS.video_script;
  const knowledgebase = CONVERSION_KNOWLEDGEBASES.video_script;

  // Prompt: must be a real video-narration prompt, with no foreign leftovers.
  assert.equal(typeof prompt, "string");
  assert.match(prompt, /video script|narration|text-to-speech/i);
  assert.doesNotMatch(prompt, /IUPAC|chemical|nomenclature/i);

  // Skill profile: voice + rules + output example + quality criteria.
  assert.ok(skill);
  assert.ok(skill.voice.trim().length > 0);
  assert.ok(skill.rules.length >= 4, "video_script skill should define detailed rules");
  assert.ok(skill.outputExample.trim().length > 0);
  assert.ok(skill.qualityCriteria.length >= 4, "video_script skill should define quality criteria");

  // Knowledgebase: at least 3 well-formed resources.
  assert.ok(Array.isArray(knowledgebase));
  assert.ok(knowledgebase.length >= 3);
  for (const resource of knowledgebase) {
    assert.ok(resource.title.length > 0);
    assert.match(resource.url, /^https?:\/\//);
    assert.ok(resource.description.length > 0);
  }
});

test("general_request conversion has complete prompt, skill, and knowledgebase", () => {
  const prompt = CONVERSION_PROMPTS.general_request;
  const skill = CONVERSION_SKILLS.general_request;
  const knowledgebase = CONVERSION_KNOWLEDGEBASES.general_request;

  // Prompt: must handle open-ended requests with direct fulfillment.
  assert.equal(typeof prompt, "string");
  assert.match(prompt, /ANY general request|any general request|open-ended/i);
  assert.match(prompt, /recipe/i, "general_request prompt should cover recipes");
  assert.match(prompt, /how-to|explanation/i, "general_request prompt should cover how-tos");
  assert.match(prompt, /comparison/i, "general_request prompt should cover comparisons");

  // Skill profile: voice + rules + output example + quality criteria.
  assert.ok(skill);
  assert.ok(skill.voice.trim().length > 0);
  assert.ok(skill.rules.length >= 5, "general_request skill should define detailed rules");
  assert.ok(skill.outputExample.trim().length > 0);
  assert.ok(skill.qualityCriteria.length >= 4, "general_request skill should define quality criteria");

  // Knowledgebase: at least 5 well-formed resources covering general topics.
  assert.ok(Array.isArray(knowledgebase));
  assert.ok(knowledgebase.length >= 5, "general_request should have a broad knowledgebase");
  for (const resource of knowledgebase) {
    assert.ok(resource.title.length > 0);
    assert.match(resource.url, /^https?:\/\//);
    assert.ok(resource.description.length > 0);
  }
});

test("office_memo conversion has complete prompt, skill, and knowledgebase support", () => {
  const prompt = CONVERSION_PROMPTS.office_memo;
  const skill = CONVERSION_SKILLS.office_memo;
  const knowledgebase = CONVERSION_KNOWLEDGEBASES.office_memo;

  // Prompt: standard memo format with a header block.
  assert.equal(typeof prompt, "string");
  assert.match(prompt, /memo/i);
  assert.match(prompt, /TO:/);
  assert.match(prompt, /SUBJECT:/);
  assert.match(prompt, /Action Items/i);

  // Skill profile: voice + rules + output example + quality criteria.
  assert.ok(skill);
  assert.ok(skill.voice.trim().length > 0);
  assert.ok(skill.rules.length >= 4, "office_memo skill should define detailed rules");
  assert.match(skill.outputExample, /TO:/, "office_memo output example should show a header block");
  assert.ok(skill.qualityCriteria.length >= 4, "office_memo skill should define quality criteria");

  // Knowledgebase: at least 3 well-formed resources with real URLs.
  assert.ok(Array.isArray(knowledgebase));
  assert.ok(knowledgebase.length >= 3, "office_memo should have a knowledgebase");
  for (const resource of knowledgebase) {
    assert.ok(resource.title.length > 0);
    assert.match(resource.url, /^https?:\/\//);
    assert.ok(resource.description.length > 0);
  }
});

test("white_paper conversion has complete prompt, skill, and knowledgebase support", () => {
  const prompt = CONVERSION_PROMPTS.white_paper;
  const skill = CONVERSION_SKILLS.white_paper;
  const knowledgebase = CONVERSION_KNOWLEDGEBASES.white_paper;

  // Prompt: persuasive report with executive summary and references.
  assert.equal(typeof prompt, "string");
  assert.match(prompt, /white paper/i);
  assert.match(prompt, /Executive Summary/i);
  assert.match(prompt, /References/i);

  // Skill profile: voice + rules + output example + quality criteria.
  assert.ok(skill);
  assert.ok(skill.voice.trim().length > 0);
  assert.ok(skill.rules.length >= 4, "white_paper skill should define detailed rules");
  assert.match(skill.outputExample, /Executive Summary/, "white_paper output example should show the executive summary");
  assert.ok(skill.qualityCriteria.length >= 4, "white_paper skill should define quality criteria");

  // Knowledgebase: at least 3 well-formed resources with real URLs.
  assert.ok(Array.isArray(knowledgebase));
  assert.ok(knowledgebase.length >= 3, "white_paper should have a knowledgebase");
  for (const resource of knowledgebase) {
    assert.ok(resource.title.length > 0);
    assert.match(resource.url, /^https?:\/\//);
    assert.ok(resource.description.length > 0);
  }
});

test("slide_deck conversion has complete prompt, skill, and knowledgebase support", () => {
  const prompt = CONVERSION_PROMPTS.slide_deck;
  const skill = CONVERSION_SKILLS.slide_deck;
  const knowledgebase = CONVERSION_KNOWLEDGEBASES.slide_deck;

  // Prompt: deck structure with slide-count discipline.
  assert.equal(typeof prompt, "string");
  assert.match(prompt, /slide/i);
  assert.match(prompt, /title slide/i);
  assert.match(prompt, /bullets/i);

  // Skill profile: voice + rules + output example + quality criteria.
  assert.ok(skill);
  assert.ok(skill.voice.trim().length > 0);
  assert.ok(skill.rules.length >= 4, "slide_deck skill should define detailed rules");
  assert.ok(skill.outputExample.trim().length > 0);
  assert.ok(skill.qualityCriteria.length >= 4, "slide_deck skill should define quality criteria");

  // Knowledgebase: at least 3 well-formed resources with real URLs.
  assert.ok(Array.isArray(knowledgebase));
  assert.ok(knowledgebase.length >= 3, "slide_deck should have a knowledgebase");
  for (const resource of knowledgebase) {
    assert.ok(resource.title.length > 0);
    assert.match(resource.url, /^https?:\/\//);
    assert.ok(resource.description.length > 0);
  }
});
