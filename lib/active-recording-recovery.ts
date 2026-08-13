/**
 * Persisted crash/kill recovery for the active recording session.
 *
 * `expo-av`'s in-memory `Audio.Recording` cannot be reattached after the
 * process is killed, so "recovery" here means: detect that a previous session
 * was interrupted (e.g. user force-quit the app while recording), surface a
 * one-shot signal so the rest of the app can decide what to do (today: log
 * and clear; future: show a banner), and ensure we don't leak the marker
 * across sign-out or normal stop/discard.
 *
 * The pure parsing/decision functions live here so they can be unit-tested
 * without touching AsyncStorage.
 */

export interface ActiveRecordingSnapshot {
  /** Epoch ms when the session was first started or resumed. */
  startedAt: number;
  /** Lifecycle phase at the time the snapshot was written. */
  phase: "recording" | "paused";
  /** Owning user id, so we never restore a snapshot across accounts. */
  userId: string | null;
  /** Snapshot schema version — bump on shape changes. */
  v: 1;
}

export const ACTIVE_RECORDING_SNAPSHOT_KEY = "active-recording:snapshot:v1";

/**
 * Maximum age of a snapshot we will still treat as a recent interruption.
 * Anything older is silently cleared — it almost certainly belongs to a
 * previous install/session the user no longer cares about.
 */
export const SNAPSHOT_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24h

export function serializeSnapshot(snapshot: ActiveRecordingSnapshot): string {
  return JSON.stringify(snapshot);
}

/**
 * Parse a snapshot string. Returns `null` for malformed input, unknown
 * versions, or shape mismatches — the caller should treat `null` as
 * "nothing to recover" and may safely discard the stored value.
 */
export function parseSnapshot(raw: string | null | undefined): ActiveRecordingSnapshot | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const obj = parsed as Record<string, unknown>;
  if (obj.v !== 1) return null;
  if (typeof obj.startedAt !== "number" || !Number.isFinite(obj.startedAt)) return null;
  if (obj.phase !== "recording" && obj.phase !== "paused") return null;
  const userId = obj.userId;
  if (userId !== null && typeof userId !== "string") return null;
  return {
    v: 1,
    startedAt: obj.startedAt,
    phase: obj.phase,
    userId,
  };
}

export interface InterruptionDecision {
  /** Whether the snapshot represents a recent, recoverable interruption. */
  interrupted: boolean;
  /** Whether the caller should delete the snapshot from storage. */
  shouldClear: boolean;
}

/**
 * Decide what to do with a snapshot found on mount.
 *
 *  - missing/malformed       → not interrupted, nothing to clear
 *  - belongs to another user → not interrupted, clear (avoid bleed across accounts)
 *  - older than the max age  → not interrupted, clear (stale)
 *  - otherwise               → interrupted, clear (one-shot)
 */
export function decideInterruption(
  snapshot: ActiveRecordingSnapshot | null,
  currentUserId: string | null,
  nowMs: number,
  maxAgeMs: number = SNAPSHOT_MAX_AGE_MS,
): InterruptionDecision {
  if (!snapshot) return { interrupted: false, shouldClear: false };
  if (snapshot.userId !== currentUserId) {
    return { interrupted: false, shouldClear: true };
  }
  const age = nowMs - snapshot.startedAt;
  if (!Number.isFinite(age) || age < 0 || age > maxAgeMs) {
    return { interrupted: false, shouldClear: true };
  }
  return { interrupted: true, shouldClear: true };
}
