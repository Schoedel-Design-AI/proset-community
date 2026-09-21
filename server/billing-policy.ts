export type BillingPurchasePolicy = {
  planPurchasesEnabled: boolean;
  addonPurchasesEnabled: boolean;
  musicPackEnabled: boolean;
};

/**
 * Purchase flags are ENABLED BY DEFAULT and only an explicit `false` disables
 * them.
 *
 * Why: `scripts/deploy.sh` rewrites these variables on EVERY deploy, taking the
 * value from the environment. A fail-closed default therefore means a forgotten
 * or dropped export silently pauses sales at the next deploy - and a paused
 * purchase returns HTTP 503 rather than breaking anything visible, so nothing
 * alerts. Missing configuration must mean "sell", and stopping sales must be a
 * deliberate act.
 */
function enabledUnlessExplicitlyFalse(value: string | undefined): boolean {
  return String(value || "true").trim().toLowerCase() !== "false";
}

/**
 * Reserved for PARKED PRODUCTS, never for plumbing. Music Pack is not part of
 * the current billing release, so a missing variable must park it rather than
 * put it on sale. Do not move a product still being sold onto this helper.
 */
function enabledOnlyWhenExplicitlyTrue(value: string | undefined): boolean {
  return String(value || "").trim().toLowerCase() === "true";
}

export function getBillingPurchasePolicy(): BillingPurchasePolicy {
  return {
    planPurchasesEnabled: enabledUnlessExplicitlyFalse(process.env.PROSET_PLAN_PURCHASES_ENABLED),
    addonPurchasesEnabled: enabledUnlessExplicitlyFalse(process.env.PROSET_ADDON_PURCHASES_ENABLED),
    musicPackEnabled: enabledOnlyWhenExplicitlyTrue(process.env.MUSIC_PACK_ENABLED),
  };
}

/**
 * Whether a subscription event is the moment to record a cancellation reason.
 *
 * Record at the DECISION POINT. When a customer cancels in the portal, Stripe
 * stores their submitted reason on the subscription immediately
 * (`cancellation_details.feedback`), so waiting for
 * `customer.subscription.deleted` would delay the signal by up to a whole paid
 * period — long after the feedback could still change a decision.
 *
 * Exactly once per churn decision, because `customer.subscription.updated` fires
 * on EVERY change while a cancellation is still scheduled. Only the transition
 * INTO `cancel_at_period_end: true` is a decision, and Stripe reports that flip
 * in `previous_attributes`.
 *
 * The ending is then recorded only when NO portal reason was submitted. That is
 * the honest discriminator: a portal cancellation always carries the reason the
 * customer chose (the portal requires one), so its ending is a consequence of a
 * decision already recorded, whereas a missing reason means the ending came from
 * somewhere else — a failed payment, a dispute, or our own account-deletion flow
 * — none of which produce an earlier event. Keying on Stripe's
 * `cancellation_details.reason` instead would have swallowed account deletions,
 * because Stripe labels those `cancellation_requested` too.
 */
export function shouldRecordCancellation(input: {
  eventType: string;
  cancelAtPeriodEnd: boolean | null | undefined;
  previousAttributes: Record<string, unknown>;
  cancellationFeedback: string | null | undefined;
}): boolean {
  const scheduled = input.previousAttributes?.cancel_at_period_end === false
    && input.cancelAtPeriodEnd === true;
  if (scheduled) return true;
  if (input.eventType !== "customer.subscription.deleted") return false;
  return !input.cancellationFeedback;
}
