import { SELF_SERVICE_MODULE_CATALOG } from "@shared/self-service-modules";
import { CONVERSION_TYPES, TIER_CONVERSION_TYPES, type SubscriptionTier } from "@/lib/utils";

/**
 * Which conversion types may be OFFERED to an account.
 *
 * The rule that matters here is the shipped gate. `/api/modules/self` returns one
 * state per shipped module only — unshipped packs are absent for every role,
 * including admins and Friends-of-Barry — so a module missing from that payload is
 * a module the server will refuse (`conversion_type_locked`). Offering a chip for
 * one of those types is a dead end: the user taps it and gets an error, which is
 * how the unshipped Saint Pack appeared on the Thought Thread page (Barry,
 * 2026-09-30) after the server-side gate landed.
 *
 * Order matters: the shipped check comes first, so it applies to every role, and
 * only then are the super-admin and tier/module rules consulted.
 *
 * The second rule is about NOT knowing. An unanswered `/api/modules/self` is not a
 * refusal: with no module data the state list is empty, so treating "not listed" as
 * "not shipped" locked every pack type — a Pro subscriber's own Academic Pack showed
 * as locked whenever the fetch had not landed or failed (Barry, 2026-09-30). Unknown
 * therefore means: keep the packs the account's TIER already rules out out, and let
 * everything else through. The server still refuses what it should.
 */
type ModuleStateLike = { moduleName: string; effectiveEnabled?: boolean };

/**
 * Packs that exist in the catalog but are NOT shipped: the client mirror of
 * `UNSHIPPED_MODULES` in `server/usage-service.ts`, pinned to it by
 * `tests/lib/conversion-availability.test.ts`.
 *
 * The server is what decides this — it refuses the enable request and drops the pack
 * from `/api/modules/self`. This copy answers the one question the server cannot: what
 * to do before that endpoint replies, or after it fails. Without it, "no module data"
 * would make every pack look unshipped and lock the whole menu.
 */
export const UNSHIPPED_PACK_MODULES: ReadonlySet<string> = new Set(["saint"]);

const TIER_RANK: Record<SubscriptionTier, number> = { free: 0, base: 1, pro: 2 };

export type ConversionAccess = {
  tier: SubscriptionTier;
  isSuperAdmin?: boolean;
  moduleStates?: ModuleStateLike[] | null;
  /**
   * Whether `/api/modules/self` has actually answered.
   *
   * Defaults to `moduleStates != null`, which suits react-query callers whose `data` is
   * undefined until the query resolves. A caller that initialises its state to `[]` must
   * pass this explicitly, because there "has not answered yet" and "answered with no
   * modules" look identical.
   */
  moduleStatesLoaded?: boolean;
};

export function moduleStatesKnown(access: ConversionAccess): boolean {
  return access.moduleStatesLoaded ?? (access.moduleStates != null);
}

export function shippedModuleNames(moduleStates?: ModuleStateLike[] | null): Set<string> {
  return new Set((moduleStates || []).map((state) => state.moduleName));
}

export function enabledModuleNames(moduleStates?: ModuleStateLike[] | null): Set<string> {
  return new Set(
    (moduleStates || [])
      .filter((state) => state.effectiveEnabled)
      .map((state) => state.moduleName),
  );
}

/**
 * The pack modules a picker may LIST: the server's shipped set once it has answered,
 * and otherwise every catalog pack except the known-unready ones — a menu must not go
 * empty just because a fetch has not landed.
 */
export function listablePackModules(access: ConversionAccess): Set<string> {
  if (moduleStatesKnown(access)) return shippedModuleNames(access.moduleStates);
  return new Set(
    CONVERSION_TYPES.filter((type) => type.module && !UNSHIPPED_PACK_MODULES.has(type.module)).map(
      (type) => type.module as string,
    ),
  );
}

function requiredTierFor(moduleName: string): SubscriptionTier | undefined {
  return (SELF_SERVICE_MODULE_CATALOG as Record<string, { requiredTier?: SubscriptionTier }>)[
    moduleName
  ]?.requiredTier;
}

function isOffered(
  type: { value: string; module?: string },
  access: ConversionAccess,
  known: boolean,
  shipped: Set<string>,
  enabled: Set<string>,
): boolean {
  // 1. Never offer a pack that is not shipped — even with no server data to ask.
  if (type.module && UNSHIPPED_PACK_MODULES.has(type.module)) return false;
  // 2. With the server's answer in hand, its list is the shipment signal.
  if (known && type.module && !shipped.has(type.module)) return false;
  if (access.isSuperAdmin) return true;
  if (TIER_CONVERSION_TYPES[access.tier]?.includes(type.value)) return true;
  if (!type.module) return false;
  // Pack type: the module state decides whenever we have it.
  if (known) return enabled.has(type.module);
  // Unknown state: deny only what the tier already rules out, and let the server
  // refuse the rest rather than showing an eligible subscriber a locked pack.
  const required = requiredTierFor(type.module);
  if (!required) return true;
  return TIER_RANK[access.tier] >= TIER_RANK[required];
}

export function isConversionTypeOffered(type: string, access: ConversionAccess): boolean {
  const entry = CONVERSION_TYPES.find((candidate) => candidate.value === type);
  if (!entry) return false;
  return isOffered(
    entry,
    access,
    moduleStatesKnown(access),
    shippedModuleNames(access.moduleStates),
    enabledModuleNames(access.moduleStates),
  );
}

export function filterOfferedConversionTypes<T extends { value: string; module?: string }>(
  types: readonly T[],
  access: ConversionAccess,
): T[] {
  const known = moduleStatesKnown(access);
  const shipped = shippedModuleNames(access.moduleStates);
  const enabled = enabledModuleNames(access.moduleStates);
  return types.filter((type) => isOffered(type, access, known, shipped, enabled));
}
