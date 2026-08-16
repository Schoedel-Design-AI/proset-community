// CE stub — the hosted Stripe catalog is not part of the community edition.
// Prices render as-is (no early-adopter discount logic).

export const EARLY_ADOPTER_COUPON_ID = "";

export function getEarlyAdopterPrice<T>(price: T, ..._rest: unknown[]): T {
  return price;
}
