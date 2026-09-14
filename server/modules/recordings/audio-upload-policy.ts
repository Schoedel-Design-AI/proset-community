/**
 * Pure decision logic for the `/api/upload-audio` cloud-storage gate.
 *
 * WHY THIS IS SEPARATE FROM THE ROUTE
 * The gate used to be one boolean in the route with one response:
 *
 *     if (storageLimit === 0 || totalUsed + req.file.size > storageLimit) → 413
 *     res.status(413).json({ error: "Storage limit exceeded", used, limit })
 *
 * That conflates two conditions with completely different meanings and different
 * remedies:
 *
 *   - `storageLimit === 0` — the account's plan does not include cloud storage at
 *     all. `TIER_LIMITS.free.storageMb` is 0, so a free-tier account (or a
 *     subscriber whose tier resolution transiently falls back to `free`, because
 *     `getUserTier` answers `free` when the user document or its entitlements
 *     cannot be read) is rejected on EVERY upload, whatever its size. Observed in
 *     production: 413s on 19 KB, 1.06 MB and 1.29 MB bodies while 9.4 MB uploads
 *     succeeded the same week — the tell that size was never the trigger.
 *   - `used + fileSize > storageLimit` — a genuine quota boundary on a plan that
 *     does include storage.
 *
 * Both produced the same status, the same message and no log line, so neither the
 * client nor the operator could tell them apart. The client maps any non-auth 4xx
 * to a non-retryable `upload_rejected`, which is why the user-visible symptom was
 * "uploads fail for no reason" (and why a quota-boundary failure was never
 * retried after the user freed space).
 *
 * Keeping the decision pure and dependency-free makes both branches unit-testable
 * without Express, Firestore or the usage service.
 */

/** Distinguishes "this plan has no cloud storage" from "this plan's storage is full". */
export type AudioUploadStorageRejectionCode =
  | "storage_not_included"
  | "storage_quota_exceeded";

export interface AudioUploadStorageInput {
  /** Cloud storage allowance in bytes. `0` means the plan includes none. */
  storageLimitBytes: number;
  /** Bytes already used across bucket files + text the account retains. */
  usedBytes: number;
  /** Size of the audio part being uploaded. */
  fileSizeBytes: number;
  /** Resolved plan tier, for diagnostics and the client-facing body. */
  tier?: string | null;
}

export interface AudioUploadStorageDecision {
  reject: boolean;
  code: AudioUploadStorageRejectionCode | null;
}

/**
 * Decide whether an audio upload must be refused for storage reasons.
 *
 * `used + fileSize === storageLimit` is allowed, matching the previous
 * `>` comparison exactly — this module changes the reporting, never the boundary.
 */
export function evaluateAudioUploadStorage(
  input: Pick<AudioUploadStorageInput, "storageLimitBytes" | "usedBytes" | "fileSizeBytes">,
): AudioUploadStorageDecision {
  const limit = input.storageLimitBytes;
  if (!Number.isFinite(limit) || limit <= 0) {
    return { reject: true, code: "storage_not_included" };
  }
  const used = Number.isFinite(input.usedBytes) ? Math.max(0, input.usedBytes) : 0;
  const fileSize = Number.isFinite(input.fileSizeBytes) ? Math.max(0, input.fileSizeBytes) : 0;
  if (used + fileSize > limit) {
    return { reject: true, code: "storage_quota_exceeded" };
  }
  return { reject: false, code: null };
}

/**
 * Body for the 413. `error` keeps its historical wording and status so existing
 * clients that only read the message keep working; `code`, `tier`, `used`,
 * `limit` and `fileSize` are the new machine-readable detail.
 */
export function describeAudioUploadStorageRejection(
  code: AudioUploadStorageRejectionCode,
  input: AudioUploadStorageInput,
): Record<string, unknown> {
  const limit = Number.isFinite(input.storageLimitBytes) ? input.storageLimitBytes : 0;
  const used = Number.isFinite(input.usedBytes) ? Math.max(0, input.usedBytes) : 0;
  const fileSize = Number.isFinite(input.fileSizeBytes) ? Math.max(0, input.fileSizeBytes) : 0;
  return {
    error: "Storage limit exceeded",
    code,
    tier: input.tier ?? null,
    used,
    limit,
    fileSize,
    message:
      code === "storage_not_included"
        ? "This plan does not include cloud storage for recordings."
        : "Cloud storage is full for this plan.",
  };
}

/**
 * Human-readable reason for the diagnostic log line, so an operator can tell the
 * two 413s apart from logs alone.
 */
export function describeAudioUploadStorageReason(code: AudioUploadStorageRejectionCode): string {
  return code === "storage_not_included"
    ? "storage_not_included (plan has no cloud storage; tier resolved without it)"
    : "storage_quota_exceeded (plan storage full)";
}
