import assert from "node:assert/strict";
import test from "node:test";

import {
  applyPurchasedTokenCredit,
  applyTokenDebit,
  resolveTokenBuckets,
} from "../../shared/token-balances";

test("legacy balances migrate as purchased credits without a duplicate monthly grant", () => {
  const migrated = resolveTokenBuckets({
    tokenBalance: 12_345,
    tokenAllowanceMonth: "2026-09",
  }, "2026-09", 50_000);

  assert.equal(migrated.monthly, 0);
  assert.equal(migrated.purchased, 12_345);
  assert.equal(migrated.total, 12_345);
  assert.equal(migrated.credited, false);
  assert.equal(migrated.migrated, true);
});

test("monthly credits reset instead of rolling over and are consumed first", () => {
  const reset = resolveTokenBuckets({
    monthlyTokenBalance: 4_000,
    purchasedTokenBalance: 25_000,
    tokenAllowanceMonth: "2026-08",
  }, "2026-09", 10_000);

  assert.equal(reset.monthly, 10_000);
  assert.equal(reset.purchased, 25_000);
  assert.equal(reset.total, 35_000);
  assert.equal(reset.credited, true);

  const spent = applyTokenDebit(reset, 12_000);
  assert.equal(spent.monthly, 0);
  assert.equal(spent.purchased, 23_000);
  assert.equal(spent.total, 23_000);
});

test("debits clamp at zero and purchased credits remain separate", () => {
  const resolved = resolveTokenBuckets({
    monthlyTokenBalance: 100,
    purchasedTokenBalance: 50,
    tokenAllowanceMonth: "2026-09",
  }, "2026-09", 10_000);
  assert.deepEqual(
    applyTokenDebit(resolved, 1_000),
    { ...resolved, monthly: 0, purchased: 0, total: 0 },
  );

  const credited = applyPurchasedTokenCredit({
    monthlyTokenBalance: 75,
    purchasedTokenBalance: 25,
    tokenAllowanceMonth: "2026-09",
  }, 500, "2026-09");
  assert.deepEqual(credited, {
    monthly: 75,
    purchased: 525,
    total: 600,
    allowanceMonth: "2026-09",
  });
});
