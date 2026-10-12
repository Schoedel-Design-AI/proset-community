/**
 * Password-reset plumbing shared by the login sheet and the reset-password
 * screen (a link that expired is recovered from that screen, not by sending the
 * user back to sign in).
 *
 * Kept free of react-native imports so the logic stays unit-testable in Node —
 * the platform glue lives in `lib/mailbox.ts`.
 *
 * The server answers `{ ok: true }` whether or not the address is registered
 * (enumeration safety), so the UI must never present the result as "sent to an
 * existing account" — it confirms the request, not the account.
 */

/** How long the resend affordance stays disabled after a successful request. */
export const RESEND_COOLDOWN_MS = 60_000;

export type PasswordResetFailureReason =
  | "invalid_email"
  | "rate_limited"
  | "unavailable";

export type PasswordResetRequestResult =
  | { ok: true }
  | { ok: false; reason: PasswordResetFailureReason; retryAfterSeconds?: number };

/**
 * Seconds left before a resend is allowed, 0 when it is allowed now.
 * Pure so it can be unit-tested without a clock.
 */
export function resendCooldownRemaining(
  lastSentAt: number | null | undefined,
  now: number,
  cooldownMs: number = RESEND_COOLDOWN_MS,
): number {
  if (!lastSentAt) return 0;
  const elapsed = now - lastSentAt;
  if (elapsed >= cooldownMs) return 0;
  return Math.ceil((cooldownMs - elapsed) / 1000);
}

/**
 * A mailbox URL for the consumer providers we can name, so a desktop user is
 * handed to their actual inbox instead of a `mailto:` that too often resolves to
 * nothing (no registered handler) or to an empty compose window.
 *
 * Custom/company domains return null: we cannot know which host serves them, and
 * guessing is worse than leaving the user to open their own mailbox.
 */
const WEBMAIL_BY_DOMAIN: Record<string, { url: string; label: string }> = {
  "gmail.com": { url: "https://mail.google.com/", label: "Gmail" },
  "googlemail.com": { url: "https://mail.google.com/", label: "Gmail" },
  "outlook.com": { url: "https://outlook.live.com/mail/", label: "Outlook" },
  "hotmail.com": { url: "https://outlook.live.com/mail/", label: "Outlook" },
  "live.com": { url: "https://outlook.live.com/mail/", label: "Outlook" },
  "msn.com": { url: "https://outlook.live.com/mail/", label: "Outlook" },
  "yahoo.com": { url: "https://mail.yahoo.com/", label: "Yahoo Mail" },
  "ymail.com": { url: "https://mail.yahoo.com/", label: "Yahoo Mail" },
  "icloud.com": { url: "https://www.icloud.com/mail", label: "iCloud Mail" },
  "me.com": { url: "https://www.icloud.com/mail", label: "iCloud Mail" },
  "mac.com": { url: "https://www.icloud.com/mail", label: "iCloud Mail" },
  "proton.me": { url: "https://mail.proton.me/", label: "Proton Mail" },
  "protonmail.com": { url: "https://mail.proton.me/", label: "Proton Mail" },
  "aol.com": { url: "https://mail.aol.com/", label: "AOL Mail" },
  "gmx.com": { url: "https://www.gmx.com/", label: "GMX" },
  "zoho.com": { url: "https://mail.zoho.com/", label: "Zoho Mail" },
};

export function webmailFor(email: string): { url: string; label: string } | null {
  const domain = email.trim().toLowerCase().split("@")[1] ?? "";
  return WEBMAIL_BY_DOMAIN[domain] ?? null;
}

export async function requestPasswordResetLink(
  rawEmail: string,
  apiBaseUrl: string,
): Promise<PasswordResetRequestResult> {
  const email = rawEmail.trim().toLowerCase();
  if (!email) return { ok: false, reason: "invalid_email" };

  try {
    const response = await fetch(
      new URL("/api/auth/forget-password", apiBaseUrl).toString(),
      {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      },
    );

    if (response.ok) return { ok: true };

    if (response.status === 429) {
      const retryAfter = Number(response.headers.get("Retry-After") ?? "");
      return {
        ok: false,
        reason: "rate_limited",
        retryAfterSeconds: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined,
      };
    }

    return { ok: false, reason: "unavailable" };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}
