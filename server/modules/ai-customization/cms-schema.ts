import { z } from "zod";

export const CmsPackSchema = z.object({
  pack_key: z.string().min(1),
  display_name: z.string().min(1),
  required_tier: z.enum(["free", "base", "pro"]).default("free"),
  is_active: z.boolean().default(true),
  accent_color: z.string().default("#3B82F6"),
  feather_icon: z.string().default("package"),
  description: z.string().nullable().optional(),
});

export const CmsConversionTypeSchema = z.object({
  type_key: z.string().min(1),
  pack_key: z.string().min(1),
  category: z.string().min(1),
  label_en: z.string().min(1),
  label_es: z.string().min(1),
  description_en: z.string().nullable().optional(),
  description_es: z.string().nullable().optional(),
  feather_icon: z.string().default("file-text"),
  complexity: z.enum(["simple", "intermediate", "advanced"]).default("simple"),
  required_tier: z.enum(["free", "base", "pro"]).default("free"),
  dialogue_mode: z.enum(["none", "optional", "mandatory_sequential"]).default("none"),
  display_order: z.number().int().default(0),
  is_active: z.boolean().default(true),
});

export const CmsPromptSchema = z.object({
  type_key: z.string().min(1),
  system_prompt: z.string().min(1),
  structural_template: z.string().nullable().optional(),
  methodology_notes: z.string().nullable().optional(),
  verbatim_tradition_rule: z.boolean().default(false),
  ecumenical_posture: z.boolean().default(false),
  preferred_model_tier: z.enum(["fast", "standard", "reasoning"]).default("standard"),
  temperature: z.number().min(0).max(2).default(0.7),
  version: z.string().default("1.0.0"),
  changelog_note: z.string().nullable().optional(),
  is_active: z.boolean().default(true),
});

export const CmsSkillSchema = z.object({
  type_key: z.string().min(1),
  voice: z.string().default(""),
  rules: z.array(z.string()).default([]),
  output_example: z.string().nullable().optional(),
  quality_criteria: z.array(z.string()).default([]),
});

export const CmsConversionExampleSchema = z.object({
  type_key: z.string().min(1),
  scenario_title: z.string().min(1),
  sub_mode: z.string().nullable().optional(),
  sample_transcript: z.string().default(""),
  golden_output: z.string().min(1),
  notes: z.string().nullable().optional(),
  display_order: z.number().int().default(0),
  is_active: z.boolean().default(true),
});

export const CmsKnowledgebaseSchema = z.object({
  type_key: z.string().min(1),
  title: z.string().min(1),
  url: z.string().url().or(z.string().min(1)),
  description: z.string().nullable().optional(),
  category: z.string().nullable().optional(),
  display_order: z.number().int().default(0),
});

export const DialogueOptionSchema = z.object({
  option_key: z.string().min(1),
  label_en: z.string().min(1),
  label_es: z.string().min(1),
  subtitle_en: z.string().default(""),
  subtitle_es: z.string().default(""),
  prompt_injection: z.string().default(""),
});

export const CmsDialogueStepSchema = z.object({
  type_key: z.string().min(1),
  step_number: z.number().int().min(1),
  question_en: z.string().min(1),
  question_es: z.string().min(1),
  context_hint_en: z.string().nullable().optional(),
  context_hint_es: z.string().nullable().optional(),
  options_json: z.array(DialogueOptionSchema).default([]),
});

export const CmsTaxonomyMappingSchema = z.object({
  taxonomy_tag: z.string().min(1),
  label: z.string().min(1),
  description: z.string().nullable().optional(),
  author_tradition: z.string().nullable().optional(),
  canonical_sources: z.array(z.string()).default([]),
});

export const CmsAiProviderSchema = z.object({
  provider_key: z.string().min(1),
  name: z.string().min(1),
  default_base_url: z.string().nullable().optional(),
  env_var_name: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  display_order: z.number().int().default(1),
});

export const CmsAiModelSchema = z.object({
  model_key: z.string().min(1),
  provider_key: z.string().min(1),
  display_name: z.string().min(1),
  model_family: z.string().nullable().optional(),
  context_window: z.number().int().nullable().optional(),
  recommended_for: z.string().nullable().optional(),
  is_active: z.boolean().default(true),
  display_order: z.number().int().default(1),
});

export const CmsAiFunctionSchema = z.object({
  function_key: z.string().min(1),
  display_name: z.string().min(1),
  category: z.string().min(1),
  description: z.string().nullable().optional(),
  provider: z.string().min(1),
  model: z.string().min(1),
  api_key: z.string().nullable().optional(),
  base_url: z.string().nullable().optional(),
  temperature: z.number().nullable().optional(),
  max_tokens: z.number().int().nullable().optional(),
  timeout_ms: z.number().int().nullable().optional(),
  is_active: z.boolean().default(true),
  notes: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
});

export const CmsGlobalMemorySchema = z.object({
  id: z.number().int(),
  category: z.string().nullable().optional(),
  insight: z.string().min(1),
  is_active: z.boolean().default(true),
  display_order: z.number().int().default(0),
});

export const CmsBundleSchema = z.object({
  version: z.string().default("1.0.0"),
  exported_at: z.string(),
  packs: z.array(CmsPackSchema),
  conversion_types: z.array(CmsConversionTypeSchema),
  prompts: z.array(CmsPromptSchema),
  skills: z.array(CmsSkillSchema),
  examples: z.array(CmsConversionExampleSchema),
  knowledgebases: z.array(CmsKnowledgebaseSchema),
  dialogue_steps: z.array(CmsDialogueStepSchema),
  taxonomies: z.array(CmsTaxonomyMappingSchema).default([]),
  ai_providers: z.array(CmsAiProviderSchema).default([]),
  ai_models: z.array(CmsAiModelSchema).default([]),
  ai_functions: z.array(CmsAiFunctionSchema).default([]),
  global_memory: z.array(CmsGlobalMemorySchema).default([]),
});

export type CmsPack = z.infer<typeof CmsPackSchema>;
export type CmsConversionType = z.infer<typeof CmsConversionTypeSchema>;
export type CmsPrompt = z.infer<typeof CmsPromptSchema>;
export type CmsSkill = z.infer<typeof CmsSkillSchema>;
export type CmsConversionExample = z.infer<typeof CmsConversionExampleSchema>;
export type CmsKnowledgebase = z.infer<typeof CmsKnowledgebaseSchema>;
export type CmsDialogueStep = z.infer<typeof CmsDialogueStepSchema>;
export type DialogueOption = z.infer<typeof DialogueOptionSchema>;
export type CmsAiProvider = z.infer<typeof CmsAiProviderSchema>;
export type CmsAiModel = z.infer<typeof CmsAiModelSchema>;
export type CmsAiFunction = z.infer<typeof CmsAiFunctionSchema>;
export type CmsGlobalMemory = z.infer<typeof CmsGlobalMemorySchema>;
export type CmsBundle = z.infer<typeof CmsBundleSchema>;
