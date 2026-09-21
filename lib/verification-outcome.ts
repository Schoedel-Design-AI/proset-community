/**
 * Where a mailbox verification (activation) click should land the user.
 *
 * The activation link is routinely opened in a context that has no Proset
 * session at all: registration deliberately signs the new account out, and a
 * link opened in an installed app window (or another browser/device) carries
 * its own storage. Probing `/api/auth/me` in that state answers 401, and the
 * auth shell used to report that 401 as "Your session has expired, please sign
 * in again" — a false alarm on a click that had just SUCCEEDED. Decide from the
 * Firebase session instead of from a 401.
 */
export type VerificationOutcome =
  // Action code applied, a session exists and is verified → go into the app.
  | "home"
  // Action code applied, no session → sign in, carrying the success notice.
  | "sign-in"
  // Nothing decided: still unverified with a session, or no code applied yet.
  | "stay";

export function resolveVerificationOutcome(input: {
  actionApplied: boolean;
  hasSession: boolean;
  emailVerified: boolean;
}): VerificationOutcome {
  if (!input.actionApplied) return "stay";
  if (!input.hasSession) return "sign-in";
  return input.emailVerified ? "home" : "stay";
}
