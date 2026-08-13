// CE stub — RevenueCat entitlements are hosted-only.
// In the community edition every user is treated as Pro: you own the server,
// there is no billing, and no feature is paywalled.

export function normalizeRevenueCatEntitlements(_raw?: unknown): string[] {
  return ["pro", "cloud-sync"];
}

export function getTierFromRevenueCatEntitlements(
  _entitlements: string[],
): "free" | "base" | "pro" {
  return "pro";
}
