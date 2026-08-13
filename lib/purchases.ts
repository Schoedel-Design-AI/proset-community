// CE stub — in-app purchases (RevenueCat/IAP) are hosted-only in Proset.
// All calls are inert; the UI degrades to a read-only plan display.

import type { PurchasesPackage } from "react-native-purchases";

export async function setupPurchases(_userId?: string): Promise<void> {}

export async function getOfferings(): Promise<{ current: null }> {
  return { current: null };
}

export function findRevenueCatPackage(
  ..._args: unknown[]
): PurchasesPackage | undefined {
  return undefined;
}

export async function purchasePackage(
  ..._args: unknown[]
): Promise<{ error: string }> {
  return { error: "Purchases are not available in Proset CE" };
}

export async function purchaseResultHasExpectedAccess(
  ..._args: unknown[]
): Promise<boolean> {
  return false;
}

export async function syncRevenueCatPurchase(..._args: unknown[]): Promise<void> {}

export async function getSubscriptionManagementUrl(..._args: unknown[]): Promise<string> {
  return "#";
}
