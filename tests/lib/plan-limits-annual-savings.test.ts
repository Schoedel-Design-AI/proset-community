import assert from "node:assert/strict";
import test from "node:test";

import { getAnnualSavings, PLAN_PRICES } from "../../shared/plan-limits";

/**
 * The annual-savings numbers are rendered next to the yearly price on the plan
 * screen, so a wrong value contradicts the price above it. `monthsFree` was
 * once computed from the MONTHLY price, which returns a constant 11 for every
 * plan while `percentOff` still read 17 - i.e. "11 months free" printed one
 * line under "17% off". These assertions exist so that regression cannot ride
 * along inside an unrelated branch again.
 */

test("each paid tier advertises the same real annual saving", () => {
  for (const tier of ["base", "pro"] as const) {
    const { monthlyPrice, yearlyPrice } = PLAN_PRICES[tier];
    const savings = getAnnualSavings(monthlyPrice, yearlyPrice);
    assert.deepEqual(
      savings,
      { monthsFree: 2, percentOff: 17 },
      `${tier} should be 2 months free / 17% off`,
    );
  }
});

test("months free follows the yearly price instead of being a constant", () => {
  // 5 months free: 12 months billed at 1000, yearly price = 7 months' worth.
  assert.deepEqual(getAnnualSavings(1000, 7000), { monthsFree: 5, percentOff: 42 });
  // 3 months free: yearly price = 9 months' worth.
  assert.deepEqual(getAnnualSavings(1000, 9000), { monthsFree: 3, percentOff: 25 });
});

test("no discount yields null rather than a fabricated saving", () => {
  assert.equal(getAnnualSavings(1000, 12000), null); // 12x monthly
  assert.equal(getAnnualSavings(1000, 13000), null); // dearer than monthly
  assert.equal(getAnnualSavings(0, 0), null); // free tier
});
