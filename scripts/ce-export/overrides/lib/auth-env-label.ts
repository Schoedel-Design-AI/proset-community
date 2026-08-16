// Environment-aware authenticator factor display name. When a user has 2FA
// enrolled in BOTH the production and staging Firebase projects (common while
// testing), each enrollment must have a distinct display name — otherwise the
// authenticator app shows two identical "Proset Authenticator" entries and
// there is no way to tell which code belongs to which environment.
//
// The environment is inferred from the public domain baked into the build
// (AIFORMS_PUBLIC_DOMAIN). Falls back to plain "Proset" if the domain is unknown.
export function getAuthenticatorDisplayName(): string {
  const domain = typeof process !== "undefined" ? process.env.AIFORMS_PUBLIC_DOMAIN : undefined;
  if (domain && domain.includes("stage.")) return "Proset Staging";
  if (domain && domain.includes("proset.")) return "Proset";
  return "Proset";
}

export function getAuthenticatorQrLabel(): string {
  return getAuthenticatorDisplayName();
}
