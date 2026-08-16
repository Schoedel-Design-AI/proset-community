// CE stub — Stripe billing is hosted-only in Proset.

export function getExpectedStripeMode(): string {
  return "disabled";
}

export function isStripeBillingEnabled(): boolean {
  return false;
}

export function getUncachableStripeClient(): never {
  throw new Error("Stripe billing is not available in Proset CE");
}
