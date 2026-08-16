// CE stub — Stripe billing is hosted-only in Proset.
// All methods are inert; callers degrade to free/pro-by-default behavior.

type CloudSyncStatus = {
  syncAllowed: boolean;
  entitled: boolean;
  inGracePeriod: boolean;
  grandfathered: boolean;
  subscriptionId: string | null;
  gracePeriodEnd: string | null;
};

type SubscriptionStatus = {
  active: boolean;
  tier: "free" | "base" | "pro";
  displayTier: string;
  cloudSync: CloudSyncStatus;
};

export const stripeService = {
  async getUserSubscriptionStatus(_userId: string): Promise<SubscriptionStatus> {
    return {
      active: false,
      tier: "free",
      displayTier: "free",
      cloudSync: {
        syncAllowed: false,
        entitled: false,
        inGracePeriod: false,
        grandfathered: false,
        subscriptionId: null,
        gracePeriodEnd: null,
      },
    };
  },
  async backfillLegacyBillingState(): Promise<void> {},
  async cancelCustomerSubscriptionsForAccountDeletion(
    ..._args: unknown[]
  ): Promise<void> {},
  async reportUsage(..._args: unknown[]): Promise<void> {},
  async getSubscription(..._args: unknown[]): Promise<null> {
    return null;
  },
};
