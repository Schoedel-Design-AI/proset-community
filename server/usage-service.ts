import { storage } from "./storage";
import { stripeService } from "./stripe-service";
import {
  CLOUD_SYNC_RECORDING_BONUS,
  FREE_RECORDING_COUNT_MIN_SECONDS,
  TIER_ALLOWED_FILE_TYPES,
  TIER_LIMITS,
  countsTowardRecordingAllowance,
} from "@shared/plan-limits";
import type { Recording, UsageReservation } from "@shared/schema";
import {
  getTierFromRevenueCatEntitlements,
  normalizeRevenueCatEntitlements,
} from "@shared/revenuecat-catalog";
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
  maxTranscriptionsPerMonth: 500,
  maxConversionsPerMonth: 1000,
  maxRecordingSeconds: 1800,
  maxFileUploadMB: 50,
  maxStorageMb: 102400,
};

const EXTENDED_ACCESS_PRICING = {
  transcription: 15,
  conversion: 10,
};

export const TIER_CONVERSION_TYPES: Record<SubscriptionTier, string[]> = {
  free: ["summary", "bullet_points", "notes", "email", "todo_list", "outline", "quick_research", "text_message", "adhd_plan", "scaffolded_project_plan", "scaffolded_action_items", "freelancer_time_log", "general_request"],
  base: ["summary", "bullet_points", "notes", "email", "todo_list", "outline", "quick_research", "text_message", "adhd_plan", "scaffolded_project_plan", "scaffolded_action_items", "freelancer_time_log", "action_items", "questions", "prompt", "blog_post", "linkedin_post", "podcast_script", "project_plan", "calendar_event", "requirements", "bibliography", "spreadsheet", "video_script", "office_memo", "white_paper", "slide_deck", "general_request"],
  pro: ["summary", "bullet_points", "notes", "email", "todo_list", "outline", "quick_research", "text_message", "adhd_plan", "scaffolded_project_plan", "scaffolded_action_items", "freelancer_time_log", "action_items", "questions", "prompt", "blog_post", "linkedin_post", "podcast_script", "project_plan", "calendar_event", "requirements", "bibliography", "spreadsheet", "video_script", "office_memo", "white_paper", "slide_deck", "general_request"],
};

export const FREE_CONVERSION_TYPES = TIER_CONVERSION_TYPES.free;

const BETA_LIMITS = TIER_LIMITS.free;
const MAX_RECORDING_SECONDS = TIER_LIMITS.free.maxRecordingSeconds;

function getMonthKey(): string {
  return new Date().toISOString().slice(0, 7);
}

const TIER_CACHE_TTL_MS = 10 * 60 * 1000;

function isTierCacheStale(tierCachedAt: Date | null): boolean {
  if (!tierCachedAt) return true;
  return Date.now() - new Date(tierCachedAt).getTime() > TIER_CACHE_TTL_MS;
}

function normalizeTier(value?: string | null, proAccessEnabled = false): SubscriptionTier {
  if (proAccessEnabled) return "pro";
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "pro") return "pro";
  if (normalized === "free") return "free";
  if (normalized === "base" || normalized === "plus" || normalized === "cloud_plus") return "base";
  return normalized ? "base" : "free";
}

function highestTier(...tiers: SubscriptionTier[]): SubscriptionTier {
  if (tiers.includes("pro")) return "pro";
  if (tiers.includes("base")) return "base";
  return "free";
}

async function resolveTierFromStripe(userId: string): Promise<SubscriptionTier> {
  try {
    const status = await stripeService.getUserSubscriptionStatus(userId);
    if (status.active && status.tier !== "free") {
      return normalizeTier(status.tier, status.tier === "pro");
    }
  } catch (e) {
    console.warn("Failed to check subscription tier, defaulting to free:", e);
  }
  return "free";
}

export async function getUserTierFast(userId: string): Promise<SubscriptionTier> {
  let revenueCatTier: SubscriptionTier = "free";
  try {
    const user = await storage.users.get(userId);
    if (!user) return "free";
    revenueCatTier = getTierFromRevenueCatEntitlements(
      normalizeRevenueCatEntitlements(user.revenueCatEntitlements),
    );
    if (!user.stripeSubscriptionId && user.proAccessEnabled !== 1) {
      return revenueCatTier;
    }
    if (!isTierCacheStale(user.tierCachedAt ? new Date(user.tierCachedAt) : null)) {
      return highestTier(
        revenueCatTier,
        normalizeTier(user.cachedTier, user.proAccessEnabled === 1),
      );
    }
  } catch {}
  return highestTier(
    await resolveTierFromStripe(userId),
    revenueCatTier,
  );
}

export async function getUserTier(userId: string): Promise<SubscriptionTier> {
  let revenueCatTier: SubscriptionTier = "free";
  try {
    const user = await storage.users.get(userId);
    if (!user) return "free";
    revenueCatTier = getTierFromRevenueCatEntitlements(
      normalizeRevenueCatEntitlements(user.revenueCatEntitlements),
    );
    if (user.cachedTier && !isTierCacheStale(user.tierCachedAt ? new Date(user.tierCachedAt) : null)) {
      return highestTier(
        revenueCatTier,
        normalizeTier(user.cachedTier, user.proAccessEnabled === 1),
      );
    }
    if (!user.stripeSubscriptionId && user.proAccessEnabled !== 1) {
      return revenueCatTier;
    }
  } catch {}
  return highestTier(
    await resolveTierFromStripe(userId),
    revenueCatTier,
  );
}

export function getTierLimits(tier: SubscriptionTier) {
  return TIER_LIMITS[tier];
}

export async function getMaxRecordings(userId: string): Promise<number> {
  const tier = await getUserTier(userId);
  let maxRecordings = TIER_LIMITS[tier].maxRecordings;
  if (tier !== "free") {
    const userRecord = await storage.users.get(userId);
    const revenueCatEntitlements = normalizeRevenueCatEntitlements(
      userRecord?.revenueCatEntitlements,
    );
    if (
      tier === "pro"
      || userRecord?.cloudSyncEnabled === 1
      || revenueCatEntitlements.includes("cloud-sync")
    ) {
      maxRecordings += CLOUD_SYNC_RECORDING_BONUS;
    }
  }
  return maxRecordings;
}

export async function getMaxItems(userId: string): Promise<number> {
  return getMaxRecordings(userId);
}

export async function getRecordingAllowanceStatus(
  userId: string,
  recordings?: Recording[],
): Promise<{
  tier: SubscriptionTier;
  used: number;
  limit: number;
  exemptUnderSeconds: number | null;
}> {
  const [tier, limit, existingRecordings] = await Promise.all([
    getUserTier(userId),
    getMaxRecordings(userId),
    recordings ? Promise.resolve(recordings) : storage.getRecordingsByUser(userId),
  ]);
  return {
    tier,
    used: existingRecordings.filter((recording) =>
      countsTowardRecordingAllowance(tier, Number(recording.duration || 0)),
    ).length,
    limit,
    exemptUnderSeconds: tier === "free" ? FREE_RECORDING_COUNT_MIN_SECONDS : null,
  };
}

export async function getUsageCount(userId: string, actionType: string): Promise<number> {
  const dateKey = getMonthKey();
  const row = await storage.usageLimits.get(userId, actionType, dateKey);
  return row?.count ?? 0;
}

export async function incrementUsage(userId: string, actionType: string): Promise<void> {
  const dateKey = getMonthKey();
  await storage.usageLimits.increment(userId, actionType, dateKey, 1);
}

export function getUsageReservationCeiling(
  actionType: "transcription" | "conversion",
  limitCheck: { limit: number; isExtendedAccess?: boolean; displayTier?: DisplayTier },
): number {
  return limitCheck.isExtendedAccess
    ? (actionType === "transcription"
      ? HARD_ABSOLUTE_LIMITS.maxTranscriptionsPerMonth
      : HARD_ABSOLUTE_LIMITS.maxConversionsPerMonth)
    : limitCheck.limit;
}

export async function reserveUsageForRun(
  userId: string,
  actionType: "transcription" | "conversion",
  runId: string,
  maximumCommittedAndReserved: number,
  reservationKey = runId,
): Promise<UsageReservation | null> {
  const now = new Date();
  const dateKey = getMonthKey();
  await storage.usageReservations.releaseExpired(
    userId,
    actionType,
    dateKey,
    now,
  );
  const reservation: UsageReservation = {
    id: `usage_${actionType}_${reservationKey}`,
    userId,
    actionType,
    dateKey,
    status: "reserved",
    runId,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString(),
    committedAt: null,
    releasedAt: null,
  };
  return await storage.usageReservations.reserve(reservation, maximumCommittedAndReserved)
    ? reservation
    : null;
}

export async function settleUsageForRun(
  userId: string,
  reservationId: string | null | undefined,
  outcome: "committed" | "released",
): Promise<UsageReservation | undefined> {
  if (!reservationId) return undefined;
  return storage.usageReservations.settle(reservationId, userId, outcome);
}

export async function checkLimit(userId: string, actionType: "transcription" | "conversion", conversionType?: string): Promise<{
  allowed: boolean;
  current: number;
  limit: number;
  tier: SubscriptionTier;
  displayTier?: DisplayTier;
  isExtendedAccess?: boolean;
  isPremiumConversion?: boolean;
  proAccessEnabled?: boolean;
  extendedUnitCost?: number;
  extendedCostSoFar?: number;
  spendingCapReached?: boolean;
}> {
  const tier = await getUserTierFast(userId);
  const limits = TIER_LIMITS[tier];
  const limit = limits[actionType];
  const current = await getUsageCount(userId, actionType);

  const hardLimit = actionType === "transcription" ? HARD_ABSOLUTE_LIMITS.maxTranscriptionsPerMonth : HARD_ABSOLUTE_LIMITS.maxConversionsPerMonth;
  if (current >= hardLimit) {
    return { allowed: false, current, limit: hardLimit, tier, displayTier: tier };
  }

  const hasProBehavior = tier === "pro";

  if (tier !== "free" && current >= limit) {
    const unitCost = EXTENDED_ACCESS_PRICING[actionType];
    const [tCount, cCount] = await Promise.all([
      getUsageCount(userId, "transcription"),
      getUsageCount(userId, "conversion"),
    ]);
    const tExtended = Math.max(0, tCount - limits.transcription);
    const cExtended = Math.max(0, cCount - limits.conversion);
    const costSoFar = tExtended * EXTENDED_ACCESS_PRICING.transcription + cExtended * EXTENDED_ACCESS_PRICING.conversion;

    const user = await storage.users.get(userId);
    const cap = user?.spendingCap;
    if (cap != null && (costSoFar + unitCost) > cap) {
      return { allowed: false, current, limit, tier, spendingCapReached: true, extendedCostSoFar: costSoFar };
    }

    return { allowed: true, current, limit, tier, isExtendedAccess: true, proAccessEnabled: hasProBehavior, extendedUnitCost: unitCost, extendedCostSoFar: costSoFar };
  }

  return { allowed: current < limit, current, limit, tier, proAccessEnabled: hasProBehavior };
}

export async function reportExtendedAccessIfNeeded(userId: string, actionType: "transcription" | "conversion", conversionType?: string): Promise<void> {
  try {
    const tier = await getUserTierFast(userId);
    if (tier === "free") return;



    const current = await getUsageCount(userId, actionType);
    const limit = TIER_LIMITS[tier][actionType];

    if (current > limit) {
      await stripeService.reportUsage(userId, actionType, 1);
    }
  } catch (e) {
    console.warn("Failed to report extended access usage to Stripe:", e);
  }
}

export async function getMaxRecordingSeconds(userId: string): Promise<number> {
  const tier = await getUserTier(userId);
  return Math.min(TIER_LIMITS[tier].maxRecordingSeconds, HARD_ABSOLUTE_LIMITS.maxRecordingSeconds);
}

export async function getStorageLimit(userId: string): Promise<number> {
  const tier = await getUserTier(userId);
  const tierMb = TIER_LIMITS[tier].storageMb;
  const cappedMb = Math.min(tierMb, HARD_ABSOLUTE_LIMITS.maxStorageMb);
  return cappedMb * 1024 * 1024;
}

export async function getUserUsageSummary(userId: string): Promise<{
  tier: SubscriptionTier;
  displayTier: DisplayTier;
  transcriptions: { used: number; limit: number; extended: number };
  conversions: { used: number; limit: number; extended: number };
  recordings: { used: number; limit: number; exemptUnderSeconds: number | null };
  maxRecordingSeconds: number;
  storageMb: number;
  maxFileImportMB: number;
  allowedFileTypes: string[];
  maxRecordings: number;
  maxItems: number;
  proAccessEnabled: boolean;
  extendedAccessPricing: { transcription: number; conversion: number };
  extendedCostSoFar: number;
  spendingCap: number | null;
}> {
  const userRow = await storage.users.get(userId);
  const tier = await getUserTier(userId);
  const limits = TIER_LIMITS[tier];
  const [tCount, cCount] = await Promise.all([
    getUsageCount(userId, "transcription"),
    getUsageCount(userId, "conversion"),
  ]);

  const tExtended = tier === "free" ? 0 : Math.max(0, tCount - limits.transcription);
  const cExtended = tier === "free" ? 0 : Math.max(0, cCount - limits.conversion);
  const extendedCostSoFar = tExtended * EXTENDED_ACCESS_PRICING.transcription + cExtended * EXTENDED_ACCESS_PRICING.conversion;

  const maxRecordings = await getMaxRecordings(userId);
  const userRecordings = await storage.getRecordingsByUser(userId);
  const recordingUsage = {
    used: userRecordings.filter((recording) =>
      countsTowardRecordingAllowance(tier, Number(recording.duration || 0)),
    ).length,
    limit: maxRecordings,
    exemptUnderSeconds: tier === "free" ? FREE_RECORDING_COUNT_MIN_SECONDS : null,
  };

  const spendingCap = userRow?.spendingCap ?? null;
  const proAccessEnabled = tier === "pro";

  return {
    tier,
    displayTier: tier,
    transcriptions: { used: tCount, limit: limits.transcription, extended: tExtended },
    conversions: { used: cCount, limit: limits.conversion, extended: cExtended },
    recordings: recordingUsage,
    maxRecordingSeconds: limits.maxRecordingSeconds,
    storageMb: limits.storageMb,
    maxFileImportMB: limits.maxFileImportMB,
    allowedFileTypes: await getAllowedFileTypes(userId),
    maxRecordings,
    maxItems: maxRecordings,
    proAccessEnabled,
    extendedAccessPricing: EXTENDED_ACCESS_PRICING,
    extendedCostSoFar,
    spendingCap,
  };
}

export async function getMaxFileImportSize(userId: string): Promise<number> {
  const tier = await getUserTier(userId);
  const tierMb = TIER_LIMITS[tier].maxFileImportMB;
  const cappedMb = Math.min(tierMb, HARD_ABSOLUTE_LIMITS.maxFileUploadMB);
  return cappedMb * 1024 * 1024;
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
  BETA_LIMITS,
  MAX_RECORDING_SECONDS,
  TIER_LIMITS,
  HARD_ABSOLUTE_LIMITS,
  EXTENDED_ACCESS_PRICING,
  MODULE_CONVERSION_TYPES,
  ALL_MODULE_TYPES,
  CLOUD_SYNC_RECORDING_BONUS,
};
