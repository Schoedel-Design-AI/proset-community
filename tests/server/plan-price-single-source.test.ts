import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { PLAN_PRICES } from "../../shared/plan-limits";

/**
 * The plan price has exactly one home: PLAN_PRICES. Checkout, the deprecated
 * compatibility route, and the API's own reporting all have to read it from
 * there, because a route that restates a number keeps quoting it after the
 * catalogue moves - which is invisible until a customer compares what they were
 * shown with what Stripe actually charges.
 */

test("no billing route restates a plan price as a literal", async () => {
  const router = await readFile("server/modules/billing/router.ts", "utf8");
  assert.doesNotMatch(router, /monthlyUnitAmount:\s*\d/, "monthly price must come from PLAN_PRICES");
  assert.doesNotMatch(router, /yearlyUnitAmount:\s*\d/, "yearly price must come from PLAN_PRICES");
});

test("the compatibility price route derives both amounts from PLAN_PRICES", async () => {
  const router = await readFile("server/modules/billing/router.ts", "utf8");
  assert.match(router, /monthlyUnitAmount:\s*PLAN_PRICES\.pro\.monthlyPrice/);
  assert.match(router, /yearlyUnitAmount:\s*PLAN_PRICES\.pro\.yearlyPrice/);
});

test("PLAN_PRICES still carries the published amounts", () => {
  assert.deepEqual(
    { baseMonthly: PLAN_PRICES.base.monthlyPrice, baseYearly: PLAN_PRICES.base.yearlyPrice },
    { baseMonthly: 349, baseYearly: 3490 },
  );
  assert.deepEqual(
    { proMonthly: PLAN_PRICES.pro.monthlyPrice, proYearly: PLAN_PRICES.pro.yearlyPrice },
    { proMonthly: 599, proYearly: 5990 },
  );
});
