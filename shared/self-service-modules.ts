export type SelfServiceModuleTier = "free" | "base" | "pro";

export const SELF_SERVICE_MODULE_CATALOG = {
  academic: {
    displayName: "Academic Pack",
    requiredTier: "pro",
    conversionTypes: [
      "academic_research",
      "statistics",
      "argumentative_essay",
      "nonfiction_draft",
      "course_syllabus",
      "lesson_plan",
      "essay_explainer",
    ],
  },
} as const;

export type SelfServiceModuleName = keyof typeof SELF_SERVICE_MODULE_CATALOG;

export type SelfServiceModuleState = {
  moduleName: SelfServiceModuleName;
  requiredTier: SelfServiceModuleTier;
  eligible: boolean;
  enabled: boolean;
  effectiveEnabled: boolean;
  userCanToggle: boolean;
  displayName?: string;
  conversionTypes?: string[];
};

export function isSelfServiceModuleName(value: string): value is SelfServiceModuleName {
  return Object.prototype.hasOwnProperty.call(SELF_SERVICE_MODULE_CATALOG, value);
}

export function getSelfServiceModuleCatalogEntry(moduleName: string) {
  return isSelfServiceModuleName(moduleName)
    ? SELF_SERVICE_MODULE_CATALOG[moduleName]
    : null;
}
