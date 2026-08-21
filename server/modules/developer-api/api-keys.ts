import { randomBytes, createHash } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { storage } from "../../storage";
import type { User } from "@shared/schema";

/**
 * Developer API key management.
 *
 * Keys are generated with the `proset_` prefix followed by 64 hex characters
 * of CSPRNG randomness (256 bits). Only the SHA-256 hash is persisted — the
 * full secret is returned exactly once at creation time and can never be
 * recovered. Authentication compares the hash of the presented key against the
 * stored hash, the same pattern Proset already uses for its internal service
 * credentials.
 */

export const API_KEY_PREFIX = "proset_";
const KEY_RANDOM_BYTES = 32;

export function hashApiKey(fullKey: string): string {
  return createHash("sha256").update(fullKey).digest("hex");
}

export function generateApiKey(): { key: string; keyHash: string; keyPrefix: string } {
  const key = API_KEY_PREFIX + randomBytes(KEY_RANDOM_BYTES).toString("hex");
  return {
    key,
    keyHash: hashApiKey(key),
    // Enough of the secret to identify the key in a list without leaking it.
    keyPrefix: key.slice(0, 14),
  };
}

export function extractBearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length).trim();
  return token || null;
}

export type ApiKeyResolution =
  | { status: "ok"; user: User }
  | { status: "expired" }
  | { status: "invalid" };

/**
 * Resolve a bearer API key to its owning user. Distinguishes three outcomes so
 * callers can surface a precise "expired" vs "invalid" message.
 */
export async function resolveApiKey(bearerToken: string): Promise<ApiKeyResolution> {
  if (!bearerToken.startsWith(API_KEY_PREFIX)) return { status: "invalid" };
  // Fail fast on malformed keys before spending a hash + Firestore lookup.
  const keyBody = bearerToken.slice(API_KEY_PREFIX.length);
  if (!/^[0-9a-f]{64}$/.test(keyBody)) return { status: "invalid" };
  try {
    const keyRecord = await storage.developerApiKeys.getByHash(hashApiKey(bearerToken));
    if (!keyRecord || keyRecord.revokedAt) return { status: "invalid" };
    if (keyRecord.expiresAt) {
      const exp = new Date(keyRecord.expiresAt).getTime();
      if (!Number.isNaN(exp) && Date.now() > exp) return { status: "expired" };
    }
    const user = await storage.users.get(keyRecord.userId);
    if (!user) return { status: "invalid" };
    // Best-effort last-used tracking — never block auth on it.
    storage.developerApiKeys
      .update(keyRecord.id, { lastUsedAt: new Date().toISOString() })
      .catch(() => undefined);
    return { status: "ok", user };
  } catch (error) {
    console.error("[developer-api] API key lookup failed:", error);
    return { status: "invalid" };
  }
}

/**
 * Express middleware that authenticates via a Proset API key and populates
 * `req.user` / `req.userId`, the same contract `requireAuth` establishes for
 * Firebase-session requests. Downstream handlers can read `req.userId` directly.
 */
export async function apiKeyAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const token = extractBearerToken(req);
  if (!token) {
    res.status(401).json({
      error: "missing_api_key",
      message: "Provide your API key as a Bearer token in the Authorization header. Create a key in Proset under Settings → Developer.",
    });
    return;
  }
  const resolution = await resolveApiKey(token);
  if (resolution.status === "expired") {
    res.status(401).json({
      error: "expired_api_key",
      message: "This API key has expired. Create a new one under Settings → Developer.",
    });
    return;
  }
  if (resolution.status === "invalid") {
    res.status(401).json({
      error: "invalid_api_key",
      message: "The provided API key is invalid or has been revoked.",
    });
    return;
  }
  req.user = resolution.user as any;
  req.userId = resolution.user.id;
  next();
}
