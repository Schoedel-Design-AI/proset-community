import { GoogleAuth } from "google-auth-library";

/**
 * Read (do NOT consume) a Firebase email action code, so the server can act on
 * a link that was minted for a user's mailbox.
 *
 * Why the REST call and not the Admin SDK: `firebase-admin` exposes no way to
 * resolve an oobCode. Identity Toolkit's `accounts:resetPassword` endpoint does
 * exactly that — it answers with the code's `email` and `requestType`, and it
 * REJECTS expired, malformed, or already-used codes. Verified against the
 * production project: a service-account OAuth token is accepted here (no public
 * web API key needed, so nothing new has to be plumbed into the runtime env).
 *
 * What it cannot do: apply/consume the code. `accounts:update {oobCode}` with an
 * OAuth token answers MISSING_LOCAL_ID (that endpoint is admin-shaped). The
 * client applies the code with the Firebase SDK right after this read, which is
 * what consumes it; this module only decides whether the link is still good.
 */

const IDENTITY_TOOLKIT_BASE = "https://identitytoolkit.googleapis.com/v1";

const googleAuth = new GoogleAuth({
  // Narrow scope: we only ever call Identity Toolkit. `cloud-platform` also
  // works but grants far more than this call needs.
  scopes: ["https://www.googleapis.com/auth/identitytoolkit"],
});

export type ActionCodeRead =
  | { ok: true; email: string; requestType: string }
  | { ok: false; code: "INVALID_OR_EXPIRED" | "UNAVAILABLE" };

/** Request types that mean "this mailbox is proving ownership of the address". */
export const VERIFY_EMAIL_REQUEST_TYPE = "VERIFY_EMAIL";

export async function readEmailActionCode(oobCode: string): Promise<ActionCodeRead> {
  if (!oobCode || oobCode.length > 512) return { ok: false, code: "INVALID_OR_EXPIRED" };

  try {
    const client = await googleAuth.getClient();
    const response = await client.request<{ email?: string; requestType?: string }>({
      url: `${IDENTITY_TOOLKIT_BASE}/accounts:resetPassword`,
      method: "POST",
      data: { oobCode },
      headers: { "Content-Type": "application/json" },
    });
    const email = typeof response.data?.email === "string" ? response.data.email.trim().toLowerCase() : "";
    const requestType = typeof response.data?.requestType === "string" ? response.data.requestType : "";
    if (!email || !requestType) return { ok: false, code: "INVALID_OR_EXPIRED" };
    return { ok: true, email, requestType };
  } catch (error: unknown) {
    const status = typeof error === "object" && error !== null && "response" in error
      ? (error as { response?: { status?: number } }).response?.status
      : undefined;
    // Never log the code itself: it is a bearer credential for this account.
    console.warn("Email action code read failed:", status ?? (error instanceof Error ? error.name : "unknown"));
    if (status === 400 || status === 404) return { ok: false, code: "INVALID_OR_EXPIRED" };
    return { ok: false, code: "UNAVAILABLE" };
  }
}
