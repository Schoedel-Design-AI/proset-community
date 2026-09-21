/**
 * Row decision logic for the Google service list in Settings → Integrations.
 *
 * Kept as pure data logic with no React Native imports so the rule that matters
 * stays unit-testable: one tap on a service row always *resolves* that service —
 * either it points at an account that can already serve it, or the tap starts
 * the Google grant for it. A row must never be left assigned but unauthorized
 * with no way forward.
 */

export interface GoogleServiceRowAccount {
  id: string;
  services: readonly string[];
}

export type GoogleServiceRowAction =
  /** Point the service at this account, or clear it with `accountId: null`. */
  | { kind: "setDefault"; accountId: string | null }
  /** Ask Google for this service's permission, on `accountId` when one can host it. */
  | { kind: "requestScope"; accountId?: string };

export function resolveGoogleServiceRowAction(
  accounts: readonly GoogleServiceRowAccount[],
  defaults: Readonly<Record<string, string>>,
  serviceKey: string
): GoogleServiceRowAction {
  const covers = (account: GoogleServiceRowAccount) => account.services.includes(serviceKey);
  const defaultId = defaults[serviceKey];
  const current = defaultId ? accounts.find((account) => account.id === defaultId) : undefined;

  if (current && !covers(current)) {
    // Another connection already holds the permission: switch to it rather than
    // making the user authorize the wrong account.
    const covering = accounts.find((account) => account.id !== current.id && covers(account));
    if (covering) return { kind: "setDefault", accountId: covering.id };
    return { kind: "requestScope", accountId: current.id };
  }

  if (!current) {
    const covering = accounts.find(covers);
    if (covering) return { kind: "setDefault", accountId: covering.id };
    const host = accounts[0];
    // First tap asks for the permission itself; the server then makes the
    // granting account the default, so the row fills in when consent returns.
    return host ? { kind: "requestScope", accountId: host.id } : { kind: "requestScope" };
  }

  // Service is served: cycle the default across the connected accounts, then off.
  const order: (string | null)[] = [...accounts.map((account) => account.id), null];
  const currentIndex = order.indexOf(current.id);
  const next = order[(currentIndex + 1 + order.length) % order.length] ?? null;
  return { kind: "setDefault", accountId: next };
}
