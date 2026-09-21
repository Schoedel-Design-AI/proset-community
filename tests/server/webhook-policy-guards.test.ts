import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

/**
 * Source-scan guards for the two policy checks the second-review pass added to
 * the webhook layer. Behavioural tests already cover the happy path
 * (tests/server/revenuecat-billing.test.ts and tests/server/stripe-billing.test.ts);
 * these guards fail if a refactor removes the check entirely, because the
 * behavioural tests would then start proving something else works and the
 * removed guarantee would ship unnoticed.
 *
 * Both checks address the same failure class: a provider event that grants
 * an entitlement or observes a refund without the server ever consulting its
 * own policy. That failure is silent — the money reaches Stripe/Play, the
 * webhook fires, the reconcile path runs, and the user gets what the
 * provider says they bought, regardless of whether we intended to sell it.
 */

test("the RevenueCat webhook consults getBillingPurchasePolicy before granting a module entitlement", async () => {
  const src = await readFile("server/revenuecat-webhooks.ts", "utf8");
  assert.match(
    src,
    /import\s*\{[^}]*getBillingPurchasePolicy[^}]*\}\s*from\s*["']\.\/billing-policy["']/,
    "getBillingPurchasePolicy must be imported so the check can run",
  );
  assert.match(
    src,
    /getModuleAddonEntitlementForProduct\s*\(\s*productId\s*\)/,
    "the RC webhook must resolve the product's module entitlement so the flag can gate it",
  );
  assert.match(
    src,
    /moduleEntitlement\s*===\s*["']music-pack["']\s*&&\s*!\s*getBillingPurchasePolicy\s*\(\s*\)\s*\.\s*musicPackEnabled/,
    "the RC webhook must refuse a music-pack grant when the policy flag is off",
  );
});

test("the Stripe webhook keeps an observe-only refund handler", async () => {
  const src = await readFile("server/stripe-webhooks.ts", "utf8");
  assert.match(
    src,
    /case\s+["']charge\.refunded["']/,
    "charge.refunded must be handled so a refund does not silently fall through the switch",
  );
  assert.match(
    src,
    /case\s+["']charge\.refund\.updated["']/,
    "charge.refund.updated must also be handled",
  );
  // The refund handler is deliberately observe-only. If the caller ever wires
  // it up to a reconciliation path, the semantic decision belongs INSIDE the
  // case with a corresponding behavioural test, not as a side-effect somewhere
  // else. Guard: no reconcile/redeem/create call sits INSIDE the refund case.
  const refundCase = src.match(/case\s+["']charge\.refunded["'][\s\S]*?return;/);
  assert.ok(refundCase, "refund case must return without falling through");
  assert.doesNotMatch(
    refundCase[0],
    /reconcile(Subscription|CheckoutSession|StorageAddonCheckout)|redeemTokenPack|createSubscriptionFromSetupIntent/,
    "the refund handler must remain observe-only until a documented decision changes it",
  );
});
