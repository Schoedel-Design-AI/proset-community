import type { Request } from "express";
import {
  CLIENT_SURFACE_HEADER,
  formatSurface,
  formatSurfaces,
  isCrossSurface,
  mergeSurfaces,
  normalizeSurfaces,
  parseSurfaceHeader,
  surfaceFromUserAgent,
  type ClientSurface,
  type SurfaceSnapshot,
} from "@shared/client-surface";
import { storage } from "./storage";

/**
 * Server-side reader for the client surface (Android app / iOS app / Web).
 *
 * Two questions are answered separately on purpose:
 *
 *   - `readReportedSurface()` — where did THIS request come from?
 *   - `getAccountSurfaces()`  — which surfaces has this ACCOUNT ever used?
 *
 * The second exists because Proset users routinely use the Android app *and*
 * the web app, and both are built from the same code. A report filed from
 * Android is therefore rarely "Android-only"; triage needs to know when the
 * fix has to be verified on both.
 */

/**
 * Header first (precise: app version, build, OS, device), body field second
 * (survives a proxy that drops unknown headers), User-Agent last (covers app
 * builds released before the header existed).
 */
export function readReportedSurface(req: Request, bodyValue?: unknown): SurfaceSnapshot | null {
  return (
    parseSurfaceHeader(req.get(CLIENT_SURFACE_HEADER)) ??
    parseSurfaceHeader(bodyValue) ??
    (() => {
      const fallback = surfaceFromUserAgent(req.get("user-agent"));
      return fallback ? { surface: fallback } : null;
    })()
  );
}

export function getAccountSurfaces(
  user: { surfacesSeen?: unknown } | null | undefined,
  reported?: ClientSurface | null,
): ClientSurface[] {
  return mergeSurfaces(user?.surfacesSeen, reported ?? null);
}

/**
 * Records the surface on the user document the first time each surface is
 * seen, and never writes again for that surface.
 *
 * Called from `requireAuth`, so it runs on every authenticated request — hence
 * the strict "only write when the set actually grows" guard: at most three
 * writes per account for the lifetime of the account. Failures are swallowed
 * because this is telemetry for triage, never a reason to fail a user's
 * request.
 */
export async function recordUserSurface(
  user: { id: string; surfacesSeen?: unknown } | null | undefined,
  req: Request,
): Promise<void> {
  try {
    if (!user?.id) return;
    const reported = readReportedSurface(req);
    if (!reported) return;
    const known = normalizeSurfaces(user.surfacesSeen);
    const merged = mergeSurfaces(known, reported.surface);
    if (merged.length === known.length) return;
    await storage.users.update(user.id, { surfacesSeen: merged } as any);
  } catch (error: any) {
    console.warn("Surface tracking skipped (non-blocking):", error?.message || error);
  }
}

export type FeedbackSurfaceFields = {
  /** "Android app 1.0.61 (build 96) · Android 14 · Pixel 7" */
  reportedFrom: string;
  /** "android" | "ios" | "web" — used for the issue label. */
  reportedSurface?: ClientSurface;
  /** "Android + Web" — every surface this account has been seen on. */
  accountSurfaces: string;
  /** True when the account uses more than one surface, so both need checking. */
  crossSurface: boolean;
};

export function buildFeedbackSurfaceFields(
  reported: SurfaceSnapshot | null,
  user: { surfacesSeen?: unknown } | null | undefined,
): FeedbackSurfaceFields {
  const surfaces = getAccountSurfaces(user, reported?.surface);
  return {
    reportedFrom: formatSurface(reported),
    reportedSurface: reported?.surface,
    accountSurfaces: formatSurfaces(surfaces),
    crossSurface: isCrossSurface(surfaces),
  };
}
