export type BillingPurchasePolicy = {
  planPurchasesEnabled: boolean;
  addonPurchasesEnabled: boolean;
  musicPackEnabled: boolean;
};

function enabledUnlessExplicitlyFalse(value: string | undefined): boolean {
  return String(value || "true").trim().toLowerCase() !== "false";
}

function enabledOnlyWhenExplicitlyTrue(value: string | undefined): boolean {
  return String(value || "").trim().toLowerCase() === "true";
}

export function getBillingPurchasePolicy(): BillingPurchasePolicy {
  return {
    planPurchasesEnabled: enabledUnlessExplicitlyFalse(process.env.PROSET_PLAN_PURCHASES_ENABLED),
    // Add-ons remain fail-closed until both provider lifecycle canaries pass.
    addonPurchasesEnabled: enabledOnlyWhenExplicitlyTrue(process.env.PROSET_ADDON_PURCHASES_ENABLED),
    musicPackEnabled: enabledOnlyWhenExplicitlyTrue(process.env.MUSIC_PACK_ENABLED),
  };
}
