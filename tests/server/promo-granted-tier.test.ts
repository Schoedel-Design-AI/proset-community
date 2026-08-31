import assert from "node:assert/strict";
import test from "node:test";
import type { User } from "../../shared/schema";
import { storage } from "../../server/storage";
import { getUserTier, getUserTierFast } from "../../server/usage-service";

/**
 * Regression coverage for promo grants (`grantedTier` / `grantedTierExpiresAt`).
 *
 * Before the fix, a promo user with no Stripe subscription tripped the
 * `!stripeSubscriptionId && proAccessEnabled !== 1` early return in both tier
 * resolvers and came back "free". `getUserSubscriptionStatus()` reported "pro"
 * at the same time, so the billing screen showed Pro while every usage/limit
 * gate metered the user as free.
 */

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: "promo-user",
    name: "Promo Tester",
    email: "promo@example.test",
    emailVerified: 1,
    userNumber: 4242,
    firstName: "Promo",
    jobType: "testing",
    cloudSyncEnabled: 0,
    forcePasswordChange: 0,
    role: "user",
    twoFactorEnabled: 0,
    cachedTier: "free",
    proAccessEnabled: 0,
    hasSeenPlanSelection: 0,
    tokenBalance: 0,
    storageAddonGb: 0,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    ...overrides,
  } as User;
}

function inMonths(months: number): string {
  const date = new Date();
  date.setMonth(date.getMonth() + months);
  return date.toISOString();
}

async function withUser(user: User, run: () => Promise<void>): Promise<void> {
  const originalGet = storage.users.get;
  try {
    storage.users.get = async () => user;
    await run();
  } finally {
    storage.users.get = originalGet;
  }
}

test("an active promo grant resolves to Pro without any Stripe subscription", async () => {
  // The exact state POST /api/billing/stripe/redeem-coupon leaves behind:
  // grantedTier set, cachedTier still "free", no tierCachedAt, no Stripe sub.
  await withUser(
    makeUser({ grantedTier: "pro", grantedTierExpiresAt: inMonths(3) }),
    async () => {
      assert.equal(await getUserTierFast("promo-user"), "pro");
      assert.equal(await getUserTier("promo-user"), "pro");
    },
  );
});

test("an open-ended promo grant (no expiry) resolves to Pro", async () => {
  await withUser(makeUser({ grantedTier: "pro", grantedTierExpiresAt: null }), async () => {
    assert.equal(await getUserTierFast("promo-user"), "pro");
    assert.equal(await getUserTier("promo-user"), "pro");
  });
});

test("a promo grant survives a stale tier cache", async () => {
  // Tier cache older than TIER_CACHE_TTL_MS (10 minutes) previously fell through
  // to Stripe, which reports free with no subscription.
  await withUser(
    makeUser({
      grantedTier: "pro",
      grantedTierExpiresAt: inMonths(1),
      cachedTier: "free",
      tierCachedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    }),
    async () => {
      assert.equal(await getUserTierFast("promo-user"), "pro");
      assert.equal(await getUserTier("promo-user"), "pro");
    },
  );
});

test("an expired promo grant does not confer Pro", async () => {
  await withUser(
    makeUser({ grantedTier: "pro", grantedTierExpiresAt: inMonths(-1) }),
    async () => {
      assert.equal(await getUserTierFast("promo-user"), "free");
      assert.equal(await getUserTier("promo-user"), "free");
    },
  );
});

test("a Base promo grant never lowers a higher paid entitlement", async () => {
  await withUser(
    makeUser({
      grantedTier: "base",
      grantedTierExpiresAt: inMonths(6),
      revenueCatEntitlements: ["pro"],
    }),
    async () => {
      assert.equal(await getUserTierFast("promo-user"), "pro");
      assert.equal(await getUserTier("promo-user"), "pro");
    },
  );
});

test("a Base promo grant still confers Base on its own", async () => {
  await withUser(
    makeUser({ grantedTier: "base", grantedTierExpiresAt: inMonths(6) }),
    async () => {
      assert.equal(await getUserTierFast("promo-user"), "base");
      assert.equal(await getUserTier("promo-user"), "base");
    },
  );
});

test("users without a promo grant are unaffected", async () => {
  await withUser(makeUser(), async () => {
    assert.equal(await getUserTierFast("promo-user"), "free");
    assert.equal(await getUserTier("promo-user"), "free");
  });

  await withUser(makeUser({ grantedTier: null, grantedTierExpiresAt: null }), async () => {
    assert.equal(await getUserTierFast("promo-user"), "free");
    assert.equal(await getUserTier("promo-user"), "free");
  });
});
