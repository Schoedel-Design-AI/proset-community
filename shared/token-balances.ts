export type TokenBalanceFields = {
  tokenBalance?: number | null;
  tokenAllowanceMonth?: string | null;
  monthlyTokenBalance?: number | null;
  purchasedTokenBalance?: number | null;
};

export type TokenBuckets = {
  monthly: number;
  purchased: number;
  total: number;
  allowanceMonth: string;
  credited: boolean;
  migrated: boolean;
};

function wholeNonNegative(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.round(value))
    : 0;
}

function hasSplitBalance(fields: TokenBalanceFields): boolean {
  return typeof fields.monthlyTokenBalance === "number"
    || typeof fields.purchasedTokenBalance === "number";
}

/**
 * Resolve the two credit pools and lazily reset the monthly pool. Existing
 * single-balance accounts migrate conservatively: their positive balance is
 * treated as purchased (non-expiring) credit and is not granted a second
 * allowance until the next UTC month.
 */
export function resolveTokenBuckets(
  fields: TokenBalanceFields,
  monthKey: string,
  monthlyAllowance: number,
): TokenBuckets {
  const migrated = !hasSplitBalance(fields);
  let monthly = migrated ? 0 : wholeNonNegative(fields.monthlyTokenBalance);
  let purchased = migrated
    ? wholeNonNegative(fields.tokenBalance)
    : wholeNonNegative(fields.purchasedTokenBalance);
  const storedAllowanceMonth = fields.tokenAllowanceMonth || null;
  let allowanceMonth = storedAllowanceMonth || monthKey;
  let credited = false;

  if (!migrated && storedAllowanceMonth !== monthKey) {
    monthly = wholeNonNegative(monthlyAllowance);
    allowanceMonth = monthKey;
    credited = true;
  }

  return {
    monthly,
    purchased,
    total: monthly + purchased,
    allowanceMonth,
    credited,
    migrated,
  };
}

export function applyTokenDebit(buckets: TokenBuckets, tokenCost: number): TokenBuckets {
  let remaining = wholeNonNegative(tokenCost);
  const monthlyUsed = Math.min(buckets.monthly, remaining);
  const monthly = buckets.monthly - monthlyUsed;
  remaining -= monthlyUsed;
  const purchasedUsed = Math.min(buckets.purchased, remaining);
  const purchased = buckets.purchased - purchasedUsed;

  return {
    ...buckets,
    monthly,
    purchased,
    total: monthly + purchased,
    credited: buckets.credited,
  };
}

export function applyPurchasedTokenCredit(
  fields: TokenBalanceFields,
  amount: number,
  monthKey: string,
): Pick<TokenBuckets, "monthly" | "purchased" | "total" | "allowanceMonth"> {
  const migrated = !hasSplitBalance(fields);
  const monthly = migrated ? 0 : wholeNonNegative(fields.monthlyTokenBalance);
  const purchased = (migrated
    ? wholeNonNegative(fields.tokenBalance)
    : wholeNonNegative(fields.purchasedTokenBalance)) + wholeNonNegative(amount);
  return {
    monthly,
    purchased,
    total: monthly + purchased,
    allowanceMonth: fields.tokenAllowanceMonth || monthKey,
  };
}

export function tokenBucketUpdates(buckets: Pick<TokenBuckets, "monthly" | "purchased" | "total" | "allowanceMonth">) {
  return {
    monthlyTokenBalance: buckets.monthly,
    purchasedTokenBalance: buckets.purchased,
    tokenBalance: buckets.total,
    tokenAllowanceMonth: buckets.allowanceMonth,
  };
}
