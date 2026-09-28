import type { Request } from "express";
import { ipKeyGenerator, rateLimit } from "express-rate-limit";

/**
 * Burst rate limiting for transcription.
 *
 * Transcription is the most expensive thing a request can start: every call
 * uploads audio and buys provider time. A per-minute burst ceiling is the abuse
 * gate that does not depend on the account's role, so it holds even for an
 * account that is otherwise unmetered (a super-admin, or a comp).
 *
 * Two things this fixes relative to the app-level AI limiter it replaces for
 * these routes:
 *
 *   1. It keys on the AUTHENTICATED USER, not on a socket. A limiter mounted at
 *      the app level runs before `requireAuth`, so `req.userId` is still empty and
 *      the key collapses to the socket's peer address — which behind Cloud Run is
 *      the load balancer, i.e. one bucket shared by every user of the product.
 *      Keying per account means one abusive client cannot throttle everyone else.
 *   2. It covers EVERY in-app transcription charge path. On-device transcription
 *      reports its usage through a separate endpoint
 *      (/recordings/:id/transcribe-local-usage), so a limit on /transcribe alone
 *      leaves that door open.
 *
 * Scope: this limiter covers the app's two HTTP transcription routes. The
 * developer API (/api/developer/v1) already limits per user after apiKeyAuth with
 * its own 10/min limiter, and the Discord worker is queue-driven — each attachment
 * is claimed once and processed once — so neither is an HTTP burst surface.
 *
 * The store is in-memory and therefore per-instance: with several Cloud Run
 * instances the effective ceiling is a multiple of the configured limit. That is
 * the right trade for burst protection (no extra infrastructure to operate); it
 * is not a global quota, and it is not a substitute for the credit balance gate.
 *
 * Tune without a deploy: PROSET_TRANSCRIPTION_BURST_LIMIT (default 10 requests)
 * and PROSET_TRANSCRIPTION_BURST_WINDOW_MS (default 60000 ms).
 */
export const DEFAULT_TRANSCRIPTION_BURST_LIMIT = 10;
export const DEFAULT_TRANSCRIPTION_BURST_WINDOW_MS = 60_000;

export type TranscriptionBurstConfig = {
  limit: number;
  windowMs: number;
};

function readPositiveInt(raw: unknown, fallback: number): number {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.floor(value);
}

export function readTranscriptionBurstConfig(
  env: NodeJS.ProcessEnv = process.env,
): TranscriptionBurstConfig {
  return {
    limit: readPositiveInt(env.PROSET_TRANSCRIPTION_BURST_LIMIT, DEFAULT_TRANSCRIPTION_BURST_LIMIT),
    windowMs: readPositiveInt(env.PROSET_TRANSCRIPTION_BURST_WINDOW_MS, DEFAULT_TRANSCRIPTION_BURST_WINDOW_MS),
  };
}

/**
 * The client address, resolved through Express's trusted proxy chain.
 *
 * `req.ip` is the only trustworthy source here. `server/index.ts` sets
 * `app.set("trust proxy", 1)`, so Express walks in from the socket and stops at
 * the rightmost hop the trusted proxy appended. Cloud Run APPENDS the real
 * client address, which means a caller-supplied prefix can never move the value.
 *
 * Do NOT reintroduce x-forwarded-for parsing. Reading the FIRST entry looks
 * equivalent and is not: that entry is whatever the caller sent, so a rotating
 * header mints a fresh bucket per request and the limit is defeated entirely.
 * Measured against production on 2026-09-27 — five requests from one address
 * were then refused with 429, while the same address with a rotating
 * x-forwarded-for got 200 on every attempt.
 *
 * The transport address is only a last resort (it is the load balancer behind
 * Cloud Run, which would make one bucket shared by everyone).
 */
export function forwardedClientIp(req: Request): string {
  if (typeof req.ip === "string" && req.ip.trim()) return req.ip.trim();
  return req.socket?.remoteAddress || "unknown";
}

/**
 * One bucket per account, falling back to the client address when the request is
 * unauthenticated (a limiter ahead of authentication, or a rejection path).
 * The two namespaces never collide because they carry different prefixes.
 */
export function transcriptionBurstKey(req: Request): string {
  const userId = typeof req.userId === "string" ? req.userId.trim() : "";
  if (userId) return `user:${userId}`;
  return `ip:${ipKeyGenerator(forwardedClientIp(req))}`;
}

export function createTranscriptionBurstLimiter(env: NodeJS.ProcessEnv = process.env) {
  const { limit, windowMs } = readTranscriptionBurstConfig(env);
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    keyGenerator: transcriptionBurstKey,
    message: {
      error: "Too many transcriptions in a row. Give it a moment, then try again.",
      code: "TRANSCRIPTION_BURST_LIMIT",
    },
    // Same escape hatches the rest of the app's limiters use, so local work never
    // trips on it — but DEVELOPMENT-ONLY. req.hostname follows X-Forwarded-Host, so
    // an ungated localhost check lets any caller disable the limit by sending
    // "X-Forwarded-Host: localhost". server/auth.ts already gates it this way.
    skip: (req) =>
      (process.env.NODE_ENV !== "production"
        && (req.hostname === "localhost" || req.hostname === "127.0.0.1"))
      || process.env.DISABLE_RATE_LIMIT === "true",
  });
}
