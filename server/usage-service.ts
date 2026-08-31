import { storage } from "./storage";
import {
  TIER_ALLOWED_FILE_TYPES,
  TIER_LIMITS,
  TIER_TOKEN_ALLOWANCES,
  TRANSCRIPTION_TOKENS_PER_SECOND,
} from "@shared/plan-limits";
import type { User } from "@shared/schema";
import {
  SELF_SERVICE_MODULE_CATALOG,
  getSelfServiceModuleCatalogEntry,
  type SelfServiceModuleState,
} from "@shared/self-service-modules";

const MODULE_CONVERSION_TYPES: Record<string, string[]> = Object.fromEntries(
  Object.entries(SELF_SERVICE_MODULE_CATALOG).map(([moduleName, module]) => [
    moduleName,
    [...module.conversionTypes],
  ]),
);

const ALL_MODULE_TYPES = Object.values(MODULE_CONVERSION_TYPES).flat();

export type SubscriptionTier = "free" | "base" | "pro";
export type DisplayTier = SubscriptionTier;

export type ConversionTypeAccessResult = {
  allowed: boolean;
  tier: SubscriptionTier;
  requiredTier: SubscriptionTier | null;
  requiredModule?: string | null;
  moduleEligible?: boolean;
  moduleEnabled?: boolean;
};

const HARD_ABSOLUTE_LIMITS = {
  // CE: safety rails against runaway usage, not plan limits — no real
  // self-hosted usage profile reaches these.
  maxRecordingSeconds: 1800,
  maxFileUploadMB: 500,
  maxStorageMb: 102400,
};


export const TIER_CONVERSION_TYPES: Record<SubscriptionTier, string[]> = {
  free: ["summary", "bullet_points", "notes", "email", "todo_list", "outline", "quick_research", "text_message", "adhd_plan", "scaffolded_project_plan", "scaffolded_action_items", "freelancer_time_log", "general_request"],
  base: ["summary", "bullet_points", "notes", "email", "todo_list", "outline", "quick_research", "text_message", "adhd_plan", "scaffolded_project_plan", "scaffolded_action_items", "freelancer_time_log", "action_items", "questions", "prompt", "blog_post", "linkedin_post", "podcast_script", "project_plan", "calendar_event", "requirements", "bibliography", "spreadsheet", "video_script", "office_memo", "white_paper", "slide_deck", "general_request"],
  pro: ["summary", "bullet_points", "notes", "email", "todo_list", "outline", "quick_research", "text_message", "adhd_plan", "scaffolded_project_plan", "scaffolded_action_items", "freelancer_time_log", "action_items", "questions", "prompt", "blog_post", "linkedin_post", "podcast_script", "project_plan", "calendar_event", "requirements", "bibliography", "spreadsheet", "video_script", "office_memo", "white_paper", "slide_deck", "general_request"],
};

export const FREE_CONVERSION_TYPES = TIER_CONVERSION_TYPES.free;

function getMonthKey(): string {
  return new Date().toISOString().slice(0, 7);
}

export async function getUserTierFast(userId: string): Promise<SubscriptionTier> {
  // CE: self-hosted open core — every user gets the full (pro) experience.
  // No hosted plan tiers, no billing hooks, no RevenueCat/Stripe lookups.
  return "pro";
}

export async function getUserTier(userId: string): Promise<SubscriptionTier> {
  return "pro"; // CE: no hosted plan tiers (see getUserTierFast).
}

export function getTierLimits(tier: SubscriptionTier) {
  return TIER_LIMITS[tier];
}

export function transcriptionTokenCost(durationSeconds: number): number {
  const seconds = Number.isFinite(durationSeconds) ? Math.max(0, durationSeconds) : 0;
  return Math.round(seconds * TRANSCRIPTION_TOKENS_PER_SECOND);
}

/**
 * LLM usage object as reported by OpenAI-compatible providers. Groq/OpenAI use
 * prompt_tokens + completion_tokens; DeepSeek and some others use
 * input_tokens + output_tokens; a few only expose total_tokens.
 */
export interface LlmUsage {
  prompt_tokens?: number | null;
  completion_tokens?: number | null;
  input_tokens?: number | null;
  output_tokens?: number | null;
  total_tokens?: number | null;
}

/**
 * Compute the token cost of a conversion. Prefers the actual model usage when
 * the provider exposes it; otherwise FALLS BACK to a rough ~4 chars/token
 * estimate (flagged in code) so the balance still moves when a provider does
 * not report usage.
 */
export function computeConversionTokenCost(opts: {
  usage?: LlmUsage | null;
  inputText?: string;
  outputText?: string;
}): number {
  const usage = opts.usage;
  if (usage) {
    if (Number.isFinite(usage.prompt_tokens) && Number.isFinite(usage.completion_tokens)) {
      return Math.max(1, Math.round((usage.prompt_tokens as number) + (usage.completion_tokens as number)));
    }
    if (Number.isFinite(usage.input_tokens) && Number.isFinite(usage.output_tokens)) {
      return Math.max(1, Math.round((usage.input_tokens as number) + (usage.output_tokens as number)));
    }
    if (Number.isFinite(usage.total_tokens)) {
      return Math.max(1, Math.round(usage.total_tokens as number));
    }
  }
  // Fallback estimate — no usage object was available from the provider.
  const inputChars = opts.inputText?.length ?? 0;
  const outputChars = opts.outputText?.length ?? 0;
  return Math.max(1, Math.round((inputChars + outputChars) / 4));
}

export interface UserTokenBalance {
  balance: number;
  monthlyAllowance: number;
  tier: SubscriptionTier;
  displayTier: DisplayTier;
  credited: boolean;
}

/**
 * Read the running token balance, applying the lazy monthly allowance credit.
 * When the user's tokenAllowanceMonth differs from the current month, the tier
 * allowance is added first (netting any carried-over negative balance from a
 * conversion grace or a prior month) and the month stamp is persisted.
 */
export async function getUserTokenBalance(userId: string): Promise<UserTokenBalance> {
  const tier = await getUserTierFast(userId);
  const user = await storage.users.get(userId);
  const monthKey = getMonthKey();
  const allowanceMonth = user?.tokenAllowanceMonth ?? null;
  const credited = allowanceMonth !== monthKey;
  let balance = user?.tokenBalance ?? 0;
  if (credited) {
    balance += TIER_TOKEN_ALLOWANCES[tier];
    await storage.users.update(userId, {
      tokenBalance: Math.round(balance),
      tokenAllowanceMonth: monthKey,
    });
  }
  return {
    balance: Math.round(balance),
    monthlyAllowance: TIER_TOKEN_ALLOWANCES[tier],
    tier,
    displayTier: tier,
    credited,
  };
}

/**
 * Apply a signed delta to the user's token balance (lazy monthly credit first).
 * Returns the new running balance, which may be negative after a grace
 * conversion.
 */
async function mutateTokenBalance(userId: string, delta: number): Promise<number> {
  const tier = await getUserTierFast(userId);
  const user = await storage.users.get(userId);
  const monthKey = getMonthKey();
  const allowanceMonth = user?.tokenAllowanceMonth ?? null;
  let balance = user?.tokenBalance ?? 0;
  if (allowanceMonth !== monthKey) {
    balance += TIER_TOKEN_ALLOWANCES[tier];
  }
  balance += delta;
  await storage.users.update(userId, {
    tokenBalance: Math.round(balance),
    tokenAllowanceMonth: monthKey,
  });
  return Math.round(balance);
}

export interface TranscriptionLimitResult {
  allowed: boolean;
  cost: number;
  balance: number;
  monthlyAllowance: number;
  tier: SubscriptionTier;
  displayTier?: DisplayTier;
  proAccessEnabled?: boolean;
}

/**
 * HARD transcription gate. The cost is known up front (audio duration ×
 * TRANSCRIPTION_TOKENS_PER_SECOND), so transcription is blocked before it
 * starts when the running balance cannot cover the cost.
 */
export async function checkTranscriptionLimit(
  userId: string,
  durationSeconds: number,
): Promise<TranscriptionLimitResult> {
  const cost = transcriptionTokenCost(durationSeconds);
  const tb = await getUserTokenBalance(userId);
  return {
    allowed: tb.balance >= cost,
    cost,
    balance: tb.balance,
    monthlyAllowance: tb.monthlyAllowance,
    tier: tb.tier,
    displayTier: tb.displayTier,
    proAccessEnabled: tb.tier === "pro",
  };
}

/**
 * Deduct a completed transcription's token cost (duration × tokens/second).
 * The transcription must already be hard-gated by checkTranscriptionLimit
 * before it starts — this never blocks, it just moves the balance.
 */
export async function deductTranscriptionTokens(
  userId: string,
  durationSeconds: number,
): Promise<number> {
  return mutateTokenBalance(userId, -transcriptionTokenCost(durationSeconds));
}

export interface ConversionLimitResult {
  allowed: boolean;
  balance: number;
  monthlyAllowance: number;
  tier: SubscriptionTier;
  displayTier?: DisplayTier;
  proAccessEnabled?: boolean;
  friendsAdvancedConversion?: boolean;
  spendingCapReached?: boolean;
  unitCostCents?: number;
  costSoFarCents?: number;
}

/**
 * SOFT conversion gate. The cost is unknown up front, so a conversion is
 * allowed whenever the balance is > 0. After it completes, the actual token
 * cost is deducted (see deductConversionTokens) and the balance may go
 * negative — the single grace conversion. Once balance <= 0, further
 * conversions are blocked so debt never exceeds one conversion.
 */
export async function checkConversionLimit(
  userId: string,
  conversionType?: string,
): Promise<ConversionLimitResult> {
  const tb = await getUserTokenBalance(userId);
  return {
    allowed: tb.balance > 0,
    balance: tb.balance,
    monthlyAllowance: tb.monthlyAllowance,
    tier: tb.tier,
    displayTier: tb.displayTier,
    proAccessEnabled: tb.tier === "pro",
  };
}

/**
 * Deduct the actual token cost of a completed conversion. The balance may go
 * negative (the single grace conversion).
 */
export async function deductConversionTokens(
  userId: string,
  tokenCount: number,
): Promise<number> {
  const rounded = Math.max(0, Math.round(tokenCount));
  if (rounded <= 0) {
    return (await getUserTokenBalance(userId)).balance;
  }
  return mutateTokenBalance(userId, -rounded);
}

export async function getMaxRecordingSeconds(userId: string): Promise<number> {
  const tier = await getUserTier(userId);
  return Math.min(TIER_LIMITS[tier].maxRecordingSeconds, HARD_ABSOLUTE_LIMITS.maxRecordingSeconds);
}

export async function getStorageLimit(userId: string): Promise<number> {
  // CE: self-hosted — only the hard safety rail applies (100 GB default).
  return HARD_ABSOLUTE_LIMITS.maxStorageMb * 1024 * 1024;
}

export interface UserUsageSummary {
  tier: SubscriptionTier;
  displayTier: DisplayTier;
  tokenBalance: number;
  monthlyTokenAllowance: number;
  tokensUsedThisMonth: number;
  maxRecordingSeconds: number;
  storageMb: number;
  maxFileImportMB: number;
  allowedFileTypes: string[];
  proAccessEnabled: boolean;
  spendingCap: number | null;
}

export async function getUserUsageSummary(userId: string): Promise<UserUsageSummary> {
  const tier = await getUserTier(userId);
  const tokenBalance = await mutateTokenBalance(userId, 0);
  const monthlyTokenAllowance = TIER_TOKEN_ALLOWANCES[tier];

  // Approximate "used this month": allowance minus remaining balance.
  const tokensUsedThisMonth = Math.max(0, monthlyTokenAllowance - tokenBalance);

  return {
    tier,
    displayTier: tier,
    tokenBalance: tokenBalance === Number.MAX_SAFE_INTEGER ? 0 : tokenBalance,
    monthlyTokenAllowance,
    tokensUsedThisMonth,
    maxRecordingSeconds: HARD_ABSOLUTE_LIMITS.maxRecordingSeconds,
    storageMb: HARD_ABSOLUTE_LIMITS.maxStorageMb,
    maxFileImportMB: HARD_ABSOLUTE_LIMITS.maxFileUploadMB,
    allowedFileTypes: await getAllowedFileTypes(userId),
    proAccessEnabled: tier === "pro",
    spendingCap: null,
  };
}

export async function getMaxFileImportSize(userId: string): Promise<number> {
  // CE: self-hosted — only the hard safety rail applies (500 MB).
  return HARD_ABSOLUTE_LIMITS.maxFileUploadMB * 1024 * 1024;
}

export async function getUserModules(userId: string): Promise<string[]> {
  try {
    const rows = await storage.userModules.getByUser(userId);
    return rows.map(r => r.moduleName);
  } catch {
    return [];
  }
}

export async function getUserModuleConversionTypes(userId: string): Promise<string[]> {
  const modules = await getUserModules(userId);
  const tier = await getUserTier(userId);
  const types: string[] = [];
  for (const mod of modules) {
    const effectiveEnabled = isTierEligibleForModule(tier, mod);
    if (effectiveEnabled && MODULE_CONVERSION_TYPES[mod]) {
      types.push(...MODULE_CONVERSION_TYPES[mod]);
    }
  }
  return types;
}

function getRequiredModuleForConversionType(type: string): string | null {
  for (const [moduleName, conversionTypes] of Object.entries(MODULE_CONVERSION_TYPES)) {
    if (conversionTypes.includes(type)) {
      return moduleName;
    }
  }
  return null;
}

function isTierEligibleForModule(tier: SubscriptionTier, moduleName: string): boolean {
  const requiredTier = getSelfServiceModuleCatalogEntry(moduleName)?.requiredTier;
  if (!requiredTier) return false;
  const tierRank: Record<SubscriptionTier, number> = { free: 0, base: 1, pro: 2 };
  return tierRank[tier] >= tierRank[requiredTier];
}

export async function getSelfServiceModuleState(userId: string, moduleName: string): Promise<SelfServiceModuleState | null> {
  const catalogEntry = getSelfServiceModuleCatalogEntry(moduleName);
  if (!catalogEntry) return null;
  const requiredTier = catalogEntry.requiredTier;

  const tier = await getUserTier(userId);
  const modules = await getUserModules(userId);
  const enabled = modules.includes(moduleName);

  return {
    moduleName: moduleName as SelfServiceModuleState["moduleName"],
    accessModel: catalogEntry.accessModel,
    requiredTier,
    eligible: isTierEligibleForModule(tier, moduleName),
    enabled,
    effectiveEnabled: enabled && isTierEligibleForModule(tier, moduleName),
    userCanToggle: isTierEligibleForModule(tier, moduleName),
  };
}

export async function getSelfServiceModulesForUser(userId: string): Promise<SelfServiceModuleState[]> {
  const states = await Promise.all(
    Object.keys(SELF_SERVICE_MODULE_CATALOG).map((moduleName) => getSelfServiceModuleState(userId, moduleName)),
  );
  return states.filter((state): state is SelfServiceModuleState => !!state);
}

export async function isConversionTypeAllowed(userId: string, type: string): Promise<ConversionTypeAccessResult> {
  if (ALL_MODULE_TYPES.includes(type)) {
    const tier = await getUserTier(userId);
    const requiredModule = getRequiredModuleForConversionType(type);
    const moduleTypes = await getUserModuleConversionTypes(userId);
    if (moduleTypes.includes(type)) {
      return { allowed: true, tier, requiredTier: null, requiredModule, moduleEligible: true, moduleEnabled: true };
    }
    return {
      allowed: false,
      tier,
      requiredTier: getSelfServiceModuleCatalogEntry(requiredModule || "")?.requiredTier || "pro",
      requiredModule,
      moduleEligible: requiredModule ? isTierEligibleForModule(tier, requiredModule) : false,
      moduleEnabled: false,
    };
  }

  const tier = await getUserTier(userId);
  const allowedTypes = TIER_CONVERSION_TYPES[tier];
  if (allowedTypes.includes(type)) {
    return { allowed: true, tier, requiredTier: null, requiredModule: null, moduleEligible: true, moduleEnabled: true };
  }
  const tiers: SubscriptionTier[] = ["free", "base", "pro"];
  let requiredTier: SubscriptionTier = "base";
  for (const t of tiers) {
    if (TIER_CONVERSION_TYPES[t].includes(type)) {
      requiredTier = t;
      break;
    }
  }
  return { allowed: false, tier, requiredTier, requiredModule: null, moduleEligible: false, moduleEnabled: false };
}

export async function getAllowedFileTypes(userId: string): Promise<string[]> {
  const tier = await getUserTier(userId);
  return TIER_ALLOWED_FILE_TYPES[tier];
}

export function getRequiredTierForFileType(ext: string): SubscriptionTier | null {
  const tiers: SubscriptionTier[] = ["free", "base", "pro"];
  for (const t of tiers) {
    if (TIER_ALLOWED_FILE_TYPES[t].includes(ext)) {
      return t;
    }
  }
  return null;
}

export function getRequiredTierForConversionType(type: string): SubscriptionTier | null {
  const tiers: SubscriptionTier[] = ["free", "base", "pro"];
  for (const t of tiers) {
    if (TIER_CONVERSION_TYPES[t].includes(type)) {
      return t;
    }
  }
  return null;
}

export {
  TIER_LIMITS,
  HARD_ABSOLUTE_LIMITS,
  MODULE_CONVERSION_TYPES,
  ALL_MODULE_TYPES,
};
