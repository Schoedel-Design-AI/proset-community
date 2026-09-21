/**
 * Security rule for turning an activation link into a session
 * (`POST /api/auth/verify-email-link`).
 *
 * Kept as a pure function so the rule is unit-tested rather than reviewed: the
 * endpoint mints a Firebase session for whoever presents the link, so "which
 * link is allowed to do that" is the whole security story.
 */

export type VerificationExchangeDecision =
  | { allow: true }
  | { allow: false; code: "WRONG_ACTION_CODE" | "NO_ACCOUNT" };

export function decideVerificationExchange(input: {
  /** requestType as reported by Identity Toolkit for the presented code. */
  requestType: string;
  /** The app has a user row for the code's email address. */
  hasAccount: boolean;
  /** The same identity exists in Firebase Auth (session can be minted). */
  hasFirebaseIdentity: boolean;
  /** The code's request type that proves mailbox ownership of the address. */
  expectedRequestType: string;
}): VerificationExchangeDecision {
  // Only "verify this email address" codes may sign anyone in. Password-reset
  // and verify-and-change-email codes must keep flowing through their own paths.
  if (input.requestType !== input.expectedRequestType) {
    return { allow: false, code: "WRONG_ACTION_CODE" };
  }
  // A link for an address with no account here cannot produce a session. This
  // includes the email-change case, where the address is not a user yet.
  if (!input.hasAccount || !input.hasFirebaseIdentity) {
    return { allow: false, code: "NO_ACCOUNT" };
  }
  // An already-verified account is still allowed: the link is unexpired (that
  // is what the read just proved), the person is the mailbox holder, and the
  // client applies the code immediately after, which consumes it so it cannot
  // be replayed.
  return { allow: true };
}
