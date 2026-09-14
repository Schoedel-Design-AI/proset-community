import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { getBillingPurchasePolicy } from "../../server/billing-policy";

test("purchase containment is fail-closed for add-ons", () => {
  const oldPlans = process.env.PROSET_PLAN_PURCHASES_ENABLED;
  const oldAddons = process.env.PROSET_ADDON_PURCHASES_ENABLED;
  const oldMusic = process.env.MUSIC_PACK_ENABLED;
  try {
    delete process.env.PROSET_PLAN_PURCHASES_ENABLED;
    delete process.env.PROSET_ADDON_PURCHASES_ENABLED;
    delete process.env.MUSIC_PACK_ENABLED;
    assert.deepEqual(getBillingPurchasePolicy(), {
      planPurchasesEnabled: true,
      addonPurchasesEnabled: false,
      musicPackEnabled: false,
    });
    process.env.PROSET_PLAN_PURCHASES_ENABLED = "false";
    process.env.PROSET_ADDON_PURCHASES_ENABLED = "true";
    process.env.MUSIC_PACK_ENABLED = "true";
    assert.deepEqual(getBillingPurchasePolicy(), {
      planPurchasesEnabled: false,
      addonPurchasesEnabled: true,
      musicPackEnabled: true,
    });
  } finally {
    if (oldPlans === undefined) delete process.env.PROSET_PLAN_PURCHASES_ENABLED;
    else process.env.PROSET_PLAN_PURCHASES_ENABLED = oldPlans;
    if (oldAddons === undefined) delete process.env.PROSET_ADDON_PURCHASES_ENABLED;
    else process.env.PROSET_ADDON_PURCHASES_ENABLED = oldAddons;
    if (oldMusic === undefined) delete process.env.MUSIC_PACK_ENABLED;
    else process.env.MUSIC_PACK_ENABLED = oldMusic;
  }
});

test("provider configuration includes every fulfillment event", () => {
  const stripe = readFileSync("scripts/configure-stripe-billing.mjs", "utf8");
  const revenueCat = readFileSync("scripts/configure-revenuecat-android.mjs", "utf8");
  for (const event of ["payment_intent.succeeded", "setup_intent.succeeded"]) {
    assert.match(stripe, new RegExp(`"${event.replace(".", "\\.")}"`));
  }
  assert.match(revenueCat, /"non_renewing_purchase"/);
  assert.match(revenueCat, /includeMusic \? \(catalog\.moduleAddOns/);
});

test("Play audit covers consumables and replaceable storage", () => {
  const play = readFileSync("scripts/configure-google-play-billing.py", "utf8");
  assert.match(play, /\.onetimeproducts\(\)/);
  assert.match(play, /catalog\.get\("oneTimeProducts"/);
  assert.match(play, /catalog\.get\("storageAddOns"/);
  assert.match(play, /has no ACTIVE purchase option/);
  assert.match(play, /args\.include_music/);
});

test("Stripe audit covers plans, packs, and storage while Music stays gated", () => {
  const stripe = readFileSync("scripts/configure-stripe-billing.mjs", "utf8");
  for (const lookupKey of [
    "proset_base_month",
    "proset_pro_month",
    "proset_tokens_25k",
    "proset_tokens_100k",
    "proset_tokens_500k",
    "proset_storage_5gb",
    "proset_storage_25gb",
    "proset_storage_100gb",
  ]) assert.match(stripe, new RegExp(lookupKey));
  assert.match(stripe, /includeMusic \|\| spec\.item !== "music_pack"/);
  assert.match(stripe, /product\.metadata\?\.pack === spec\.item/);
});

test("current customer material describes prepaid credits and canonical prices", () => {
  const files = [
    "server/templates/llms-full.txt",
    "docs-site/docs/reference/developer-api.md",
    "docs-site/i18n/es/docusaurus-plugin-content-docs/current/reference/developer-api.md",
    "docs/marketing/play-store-listing.md",
    "docs/marketing/play-store-listing.es.md",
  ].map((path) => readFileSync(path, "utf8"));
  const combined = files.join("\n");
  assert.doesNotMatch(combined, /Pay-as-you-go overage|pago por consumo|Base: 35 transcriptions|Base: 35 transcripciones/);
  assert.match(combined, /Base \$3\.49\/month/);
  assert.match(combined, /never charges automatic usage overages/);
  assert.match(combined, /insufficient_tokens/);
});

test("hosted Stripe checkout reconciles the returned session before reporting success", () => {
  const settings = readFileSync("app/settings/_subscription-panel.tsx", "utf8");
  const choosePlan = readFileSync("app/choose-plan.tsx", "utf8");
  for (const source of [settings, choosePlan]) {
    assert.match(source, /\/api\/stripe\/reconcile-checkout/);
  }
  // Add-on purchases return with tokens/storage flags, not `subscription` — all
  // of them must trigger reconciliation or the purchase silently skips it.
  assert.match(settings, /\["subscription", "tokens", "storage"\]/);
});

test("Stripe plan checkout uses Stripe-hosted Checkout, not an embedded form", () => {
  const service = readFileSync("server/stripe-service.ts", "utf8");
  const router = readFileSync("server/modules/billing/router.ts", "utf8");
  assert.match(service, /createCheckoutSession/);
  assert.match(router, /createCheckoutSession/);
  assert.match(service, /reconcileSubscriptionForUser/);
  // The embedded Payment Element flow is retired (issue #248): the client no
  // longer creates confirmable intents, so these must not come back.
  assert.doesNotMatch(router, /mode === "embedded"/);
  assert.doesNotMatch(service, /payment_behavior:\s*"default_incomplete"/);
});

test("storage add-on replacement updates in place instead of opening a second subscription", () => {
  const router = readFileSync("server/modules/billing/router.ts", "utf8");
  const service = readFileSync("server/stripe-service.ts", "utf8");
  // A Checkout Session always creates a *new* subscription, so routing an
  // existing storage customer through Checkout bills them twice.
  assert.match(service, /async replaceStorageAddon\(/);
  assert.match(service, /proration_behavior: "always_invoice"/);
  // Assert presence first: a missing branch would make indexOf return -1, which
  // is less than any real index and would let the ordering check pass vacuously.
  const replaceAt = router.indexOf("replaceStorageAddon");
  const checkoutAt = router.indexOf("createStorageAddonCheckoutSession");
  assert.ok(replaceAt > -1, "The storage route must branch to replaceStorageAddon");
  assert.ok(checkoutAt > -1, "The storage route must still create a Checkout Session");
  assert.ok(replaceAt < checkoutAt, "The replacement branch must run before the Checkout Session is created");
});

test("token-pack sessions reconcile through the payment-mode branch", () => {
  const service = readFileSync("server/stripe-service.ts", "utf8");
  const reconcile = service.slice(service.indexOf("async reconcileCheckoutSession"));
  // Token packs are one-time `payment` sessions. If the subscription-only mode
  // guard runs first, every pack reconcile 400s and a lagging webhook leaves the
  // buyer on a stale balance with no browser-side fallback.
  const paymentAt = reconcile.indexOf('session.mode === "payment"');
  const guardAt = reconcile.indexOf('session.mode !== "subscription"');
  assert.ok(paymentAt > -1, "The payment-mode branch must exist");
  assert.ok(guardAt > -1, "The subscription-only guard must still exist");
  assert.ok(paymentAt < guardAt, "The payment-mode branch must precede the subscription-only guard");
  assert.match(reconcile, /redeemTokenPackCheckout\(session\)/);
});
