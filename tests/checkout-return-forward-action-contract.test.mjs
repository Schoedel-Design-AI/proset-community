import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

/**
 * The web checkout return path must not dead-end.
 *
 * Observed 2026-09-20: a customer completed the hosted checkout, returned to
 * /choose-plan?subscription=success&session_id=..., and was stranded. The plan
 * they had just bought rendered as "Current Plan", the other paid plans were
 * locked behind an active subscription, and nothing carried them back into the
 * app — even though the entitlement had been granted server-side. Money in,
 * no way forward: the wrong direction to fail for a page whose whole job is
 * to take payment.
 */

const read = (path) => readFile(path, "utf8");

test("the plan page offers a forward action after a completed checkout", async () => {
  const page = await read("app/choose-plan.tsx");

  // The reconcile must record success, not just refresh the session.
  assert.match(
    page,
    /setCheckoutConfirmedTier\(confirmedTier\)/,
    "a successful reconcile must record the confirmed plan",
  );

  // ...and the render must expose a way out, with a testID so harnesses can drive it.
  assert.match(page, /testID="continue-to-app"/, "the page needs a reachable forward action");
  assert.match(
    page,
    /onPress=\{\(\) => router\.replace\("\/"\)\}/,
    "the forward action must actually route into the app",
  );
});

test("the forward action also covers a customer who returns later", async () => {
  const page = await read("app/choose-plan.tsx");
  // Gating only on the fresh-return flag still strands anyone who refreshes,
  // navigates back, or lands here from an email while their plan is active.
  const gate = page
    .split("\n")
    .find((line) => line.includes("checkoutConfirmedTier ||"));
  assert.ok(gate, "the forward action must render from a state check");
  assert.match(
    gate,
    /hasActivePaidSubscription/,
    "an already-subscribed customer must also get a way forward",
  );
});

test("the hosted checkout still returns to the reconciling route with a session id", async () => {
  const router = await read("server/modules/billing/router.ts");
  assert.match(
    router,
    /\$\{baseUrl\}\/choose-plan\?subscription=success&session_id=\{CHECKOUT_SESSION_ID\}/,
    "Stripe must return to the route that performs reconciliation",
  );
  const page = await read("app/choose-plan.tsx");
  assert.match(
    page,
    /params\.get\("subscription"\) === "success" && sessionId/,
    "the return handler must require both the flag and the session id",
  );
});
