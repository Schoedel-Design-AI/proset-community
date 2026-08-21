/**
 * OAuth-based backup provider management.
 *
 * Implements standalone OAuth flows for Google Drive, OneDrive, and Dropbox so
 * that non-technical users can click "Connect" and authorize backup access
 * without pasting tokens or understanding OAuth mechanics.
 */

import crypto from "crypto";
import { addProvider, getAllProviders, updateProvider } from "./backup-service";
import type { ProviderType } from "./backup-service";

// ─── Provider OAuth configuration ───────────────────────────────────────────

interface OAuthProviderConfig {
  clientId: string;
  clientSecret: string;
  authorizationUrl: string;
  tokenUrl: string;
  scopes: string[];
  /** Maps the token response to the config object stored in backupProviders */
  mapTokenResponse: (data: any) => Record<string, any>;
}

interface OAuthStatePayload {
  userId: string;
  provider: string;
  createdAt: number;
  returnTo?: string;
  nonce: string;
}

const BACKUP_OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

function getBaseUrl(): string {
  if (process.env.PUBLIC_APP_URL) return process.env.PUBLIC_APP_URL.replace(/\/+$/, "");
  if (process.env.AIFORMS_PUBLIC_DOMAIN) {
    const domain = process.env.AIFORMS_PUBLIC_DOMAIN;
    if (domain.startsWith("http")) return domain.replace(/\/+$/, "");
    return domain.includes("localhost") ? `http://${domain}` : `https://${domain}`;
  }
  return "https://proset.ai";
}

function getRedirectUri(provider: string): string {
  return `${getBaseUrl()}/api/backup/oauth/${provider}/callback`;
}

function getProviderConfig(provider: string): OAuthProviderConfig | null {
  switch (provider) {
    case "google_drive":
      if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) return null;
      return {
        clientId: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth",
        tokenUrl: "https://oauth2.googleapis.com/token",
        scopes: ["https://www.googleapis.com/auth/drive.file"],
        mapTokenResponse: (data) => ({
          accessToken: data.access_token,
          refreshToken: data.refresh_token,
          expiresAt: Date.now() + (data.expires_in || 3600) * 1000,
          useOAuth: true,
        }),
      };

    case "onedrive":
      if (!process.env.MICROSOFT_CLIENT_ID || !process.env.MICROSOFT_CLIENT_SECRET) return null;
      return {
        clientId: process.env.MICROSOFT_CLIENT_ID,
        clientSecret: process.env.MICROSOFT_CLIENT_SECRET,
        authorizationUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
        tokenUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
        scopes: ["Files.ReadWrite", "offline_access"],
        mapTokenResponse: (data) => ({
          accessToken: data.access_token,
          refreshToken: data.refresh_token,
          expiresAt: Date.now() + (data.expires_in || 3600) * 1000,
          useOAuth: true,
        }),
      };

    case "dropbox":
      if (!process.env.DROPBOX_APP_KEY || !process.env.DROPBOX_APP_SECRET) return null;
      return {
        clientId: process.env.DROPBOX_APP_KEY,
        clientSecret: process.env.DROPBOX_APP_SECRET,
        authorizationUrl: "https://www.dropbox.com/oauth2/authorize",
        tokenUrl: "https://api.dropboxapi.com/oauth2/token",
        scopes: [],
        mapTokenResponse: (data) => ({
          accessToken: data.access_token,
          refreshToken: data.refresh_token,
          expiresAt: data.expires_in ? Date.now() + data.expires_in * 1000 : null,
          useOAuth: true,
        }),
      };

    default:
      return null;
  }
}

// ─── State management (CSRF protection) ─────────────────────────────────────

function sanitizeReturnTo(returnTo?: string): string | undefined {
  if (!returnTo) return undefined;
  if (returnTo === "/settings/integrations") return returnTo;
  // The mobile deep-link helper produces "proset:///settings/integrations"
  // (three slashes: scheme + empty authority + absolute path with leading slash).
  // Accept both two- and three-slash variants so the mobile deep-link round-trip works.
  if (/^proset:\/\/\/?settings\/integrations(?:\?.*)?$/i.test(returnTo)) return returnTo;
  return undefined;
}

function getBackupOAuthStateSecret(): Buffer {
  const secret = process.env.BACKUP_OAUTH_STATE_SECRET || process.env.BETTER_AUTH_SECRET || "";
  if (!secret.trim()) {
    throw new Error("BACKUP_OAUTH_STATE_SECRET or BETTER_AUTH_SECRET must be configured for backup OAuth.");
  }
  return crypto.createHash("sha256").update(secret).digest();
}

function encodeStateSegment(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function decodeStateSegment(value: string): string {
  return Buffer.from(value, "base64url").toString("utf8");
}

function signBackupOAuthState(payload: OAuthStatePayload): string {
  const encodedPayload = encodeStateSegment(JSON.stringify(payload));
  const signature = crypto
    .createHmac("sha256", getBackupOAuthStateSecret())
    .update(encodedPayload)
    .digest("base64url");
  return `${encodedPayload}.${signature}`;
}

function verifyBackupOAuthState(state: string): OAuthStatePayload | null {
  const [encodedPayload, providedSignature] = state.split(".");
  if (!encodedPayload || !providedSignature) return null;

  const expectedSignature = crypto
    .createHmac("sha256", getBackupOAuthStateSecret())
    .update(encodedPayload)
    .digest();

  const actualSignature = Buffer.from(providedSignature, "base64url");
  if (actualSignature.length !== expectedSignature.length) return null;
  if (!crypto.timingSafeEqual(actualSignature, expectedSignature)) return null;

  try {
    const payload = JSON.parse(decodeStateSegment(encodedPayload)) as Partial<OAuthStatePayload>;
    if (!payload || typeof payload !== "object") return null;
    if (typeof payload.userId !== "string" || !payload.userId) return null;
    if (typeof payload.provider !== "string" || !payload.provider) return null;
    if (typeof payload.createdAt !== "number" || !Number.isFinite(payload.createdAt)) return null;
    if (Date.now() - payload.createdAt > BACKUP_OAUTH_STATE_TTL_MS) return null;
    if (typeof payload.nonce !== "string" || !payload.nonce) return null;

    return {
      userId: payload.userId,
      provider: payload.provider,
      createdAt: payload.createdAt,
      nonce: payload.nonce,
      returnTo: sanitizeReturnTo(payload.returnTo),
    };
  } catch {
    return null;
  }
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Returns the list of backup providers that have OAuth credentials configured
 * in the server environment. Used by the UI to decide which "Connect" buttons
 * to show.
 */
export function getAvailableBackupOAuthProviders(): string[] {
  const available: string[] = [];
  if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
    available.push("google_drive");
  }
  if (process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET) {
    available.push("onedrive");
  }
  if (process.env.DROPBOX_APP_KEY && process.env.DROPBOX_APP_SECRET) {
    available.push("dropbox");
  }
  return available;
}

/**
 * Generates the OAuth authorization URL and embeds a signed CSRF state token.
 * Returns the URL the client should redirect to.
 */
export function generateAuthorizationUrl(userId: string, provider: string, returnTo?: string): string | null {
  const config = getProviderConfig(provider);
  if (!config) return null;

  const state = signBackupOAuthState({
    userId,
    provider,
    createdAt: Date.now(),
    returnTo: sanitizeReturnTo(returnTo),
    nonce: crypto.randomBytes(16).toString("hex"),
  });

  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: getRedirectUri(provider),
    response_type: "code",
    state,
    access_type: "offline",
    prompt: "consent",
  });

  if (config.scopes.length > 0) {
    params.set("scope", config.scopes.join(" "));
  }

  // Dropbox uses token_access_type instead of access_type
  if (provider === "dropbox") {
    params.delete("access_type");
    params.delete("prompt");
    params.set("token_access_type", "offline");
  }

  return `${config.authorizationUrl}?${params.toString()}`;
}

export function getPendingBackupOAuthReturnTo(state?: string): string | undefined {
  if (!state) return undefined;
  return verifyBackupOAuthState(state)?.returnTo;
}

/**
 * Handles the OAuth callback — exchanges the authorization code for tokens,
 * creates or updates the backup provider, and returns a success/error status.
 */
export async function handleOAuthCallback(
  code: string,
  state: string
): Promise<{ ok: boolean; error?: string; provider?: string; returnTo?: string }> {
  const pending = verifyBackupOAuthState(state);
  if (!pending) {
    return { ok: false, error: "Invalid or expired authorization. Please try connecting again." };
  }

  const { userId, provider, returnTo } = pending;
  const config = getProviderConfig(provider);

  if (!config) {
    return { ok: false, error: "This backup provider is not configured on this server." };
  }

  // Exchange authorization code for tokens
  try {
    const body = new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: getRedirectUri(provider),
    });

    const tokenRes = await fetch(config.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });

    if (!tokenRes.ok) {
      console.error(`[backup-oauth] Token exchange failed for ${provider} with status ${tokenRes.status}`);
      return { ok: false, error: "Authorization failed. Please try connecting again." };
    }

    const tokenData = await tokenRes.json();
    const providerConfig = config.mapTokenResponse(tokenData);

    // Check if user already has this provider — update it instead of creating duplicate
    const existing = await getAllProviders(userId);
    const existingProvider = existing.find((p) => p.provider === provider);

    if (existingProvider) {
      await updateProvider(existingProvider.id, userId, {
        config: providerConfig,
        enabled: 1,
      });
    } else {
      await addProvider(userId, provider as ProviderType, providerConfig);
    }

    return { ok: true, provider, returnTo };
  } catch (err: any) {
    console.error(`[backup-oauth] Callback error for ${provider}:`, err);
    return { ok: false, error: "Something went wrong during authorization. Please try again.", returnTo };
  }
}

/**
 * Refreshes an expired OAuth access token using the stored refresh token.
 * Returns the new access token, or throws if refresh fails.
 */
export async function refreshAccessToken(
  provider: string,
  refreshToken: string
): Promise<{ accessToken: string; expiresAt: number }> {
  const config = getProviderConfig(provider);
  if (!config) throw new Error(`No OAuth config for provider: ${provider}`);

  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });

  const res = await fetch(config.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!res.ok) {
    await res.text();
    throw new Error(`Token refresh failed for ${provider}: ${res.status}. Account must be re-reconnected.`); // Safely omitting errText to avoid token leaks
  }

  const data = await res.json();
  return {
    accessToken: data.access_token,
    expiresAt: Date.now() + (data.expires_in || 3600) * 1000,
  };
}
