export type SelfServiceModuleTier = "free" | "base" | "pro";
export type SelfServiceModuleAccessModel = "tier" | "monthly_addon";

// CE override: main's catalog minus the Music Pack. Music Pack is a hosted
// revenue add-on (proprietary Cloudflare music generation + Stripe/RC
// billing) deliberately excluded from the open-core — see
// 2026-08-26 decision (Barry). The module FRAMEWORK and tier-based packs
// (Academic Pack) stay; `monthly_addon` packs are excluded from CE exports.
export const SELF_SERVICE_MODULE_CATALOG = {
  academic: {
    displayName: "Academic Pack",
    accessModel: "tier",
    requiredTier: "pro",
    conversionTypes: [
      "academic_research",
      "statistics",
      "argumentative_essay",
      "nonfiction_draft",
      "course_syllabus",
      "lesson_plan",
      "essay_explainer",
      "bibliography",
      "questions",
    ],
  },
} as const;

export type SelfServiceModuleName = keyof typeof SELF_SERVICE_MODULE_CATALOG;

export type SelfServiceModuleState = {
  moduleName: SelfServiceModuleName;
  accessModel: SelfServiceModuleAccessModel;
  requiredTier: SelfServiceModuleTier;
  eligible: boolean;
  enabled: boolean;
  effectiveEnabled: boolean;
  userCanToggle: boolean;
  displayName?: string;
  conversionTypes?: string[];
  configurationTypes?: string[];
  features?: string[];
  monthlyAmount?: number;
  includedGenerations?: number;
  adminIncluded?: boolean;
};

export function isSelfServiceModuleName(value: string): value is SelfServiceModuleName {
  return Object.prototype.hasOwnProperty.call(SELF_SERVICE_MODULE_CATALOG, value);
}

export function getSelfServiceModuleCatalogEntry(moduleName: string) {
  return isSelfServiceModuleName(moduleName)
    ? SELF_SERVICE_MODULE_CATALOG[moduleName]
    : null;
}
