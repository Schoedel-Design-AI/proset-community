import type { Recording, TranscriptSource } from "@shared/schema";
import type { UserUsageSummary } from "../../usage-service";

/**
 * On-device transcription billing.
 *
 * When the cloud transcription chain fails twice the client falls back to
 * on-device Whisper, which bypasses the server entirely. The client then calls
 * POST /api/recordings/:id/transcribe-local-usage so the recording is billed at
 * exactly the same rate as a cloud transcription.
 *
 * The charging logic lives here as a pure orchestrator with injected
 * dependencies so it can be unit-tested without spinning up Express, Firebase,
 * or the usage service. The route wires in the real
 * usage-service functions; this module never imports them at runtime, so the
 * rate is whatever checkTranscriptionLimit/deductTranscriptionTokens use —
 * there is no second pricing table to drift.
 */

export type LocalTranscriptionChargeRecording = Pick<
  Recording,
  "id" | "transcriptSource"
>;

export type LocalTranscriptionChargeDeps = {
  checkTranscriptionLimit: (
    userId: string,
    durationSeconds: number,
  ) => Promise<{ allowed: boolean; cost: number }>;
  deductTranscriptionTokens: (
    userId: string,
    durationSeconds: number,
  ) => Promise<number>;
  updateRecording: (
    id: string,
    userId: string,
    updates: { transcriptSource: TranscriptSource },
  ) => Promise<unknown>;
  getUserUsageSummary: (userId: string) => Promise<UserUsageSummary>;
};

export type LocalTranscriptionChargeResult =
  | { kind: "invalid_duration" }
  | { kind: "already_charged" }
  | { kind: "limit_exceeded"; cost: number }
  | {
      kind: "charged";
      tokenCost: number;
      durationSeconds: number;
      usage: UserUsageSummary;
    };

/**
 * Normalise a client-supplied on-device duration. Returns a whole number of
 * seconds greater than zero, or null when the value is not a finite positive
 * number (null/number/NaN/Infinity/strings/objects are all rejected).
 */
export function normalizeLocalTranscriptionDuration(raw: unknown): number | null {
  const value = typeof raw === "number"
    ? raw
    : typeof raw === "string" && raw.trim() !== ""
      ? Number(raw)
      : Number.NaN;
  if (!Number.isFinite(value) || value <= 0) return null;
  const rounded = Math.round(value);
  return rounded > 0 ? rounded : null;
}

/**
 * A recording is only billed once, no matter how many times the client retries
 * the on-device usage report. Any recorded transcriptSource means a transcript
 * path already moved the user's balance for this recording (the cloud route
 * sets "cloud", this endpoint sets "device"), so the idempotency marker is the
 * provenance field itself rather than a second bookkeeping field.
 */
export function isLocalTranscriptionAlreadyCharged(
  recording: Pick<Recording, "transcriptSource">,
): boolean {
  return recording.transcriptSource === "cloud" || recording.transcriptSource === "device";
}

/**
 * Charge an on-device transcription exactly what the cloud stored-audio path
 * charges: hard-gate with checkTranscriptionLimit, then
 * deductTranscriptionTokens, both with the same normalised duration.
 */
export async function chargeLocalTranscription(params: {
  userId: string;
  recording: LocalTranscriptionChargeRecording;
  rawDurationSeconds: unknown;
  deps: LocalTranscriptionChargeDeps;
}): Promise<LocalTranscriptionChargeResult> {
  const durationSeconds = normalizeLocalTranscriptionDuration(params.rawDurationSeconds);
  if (durationSeconds === null) return { kind: "invalid_duration" };
  if (isLocalTranscriptionAlreadyCharged(params.recording)) {
    return { kind: "already_charged" };
  }

  const limitCheck = await params.deps.checkTranscriptionLimit(params.userId, durationSeconds);
  if (!limitCheck.allowed) return { kind: "limit_exceeded", cost: limitCheck.cost };

  // Persist the provenance marker before moving the balance. If the response
  // is lost the client may retry, and the marker makes that retry a no-op;
  // marking after deduction could double-charge on a marker-write failure.
  await params.deps.updateRecording(params.recording.id, params.userId, {
    transcriptSource: "device",
  });
  await params.deps.deductTranscriptionTokens(params.userId, durationSeconds);
  const usage = await params.deps.getUserUsageSummary(params.userId);

  return {
    kind: "charged",
    // Reuse the gate's own cost (duration × TRANSCRIPTION_TOKENS_PER_SECOND) so
    // the on-device rate can never drift from the cloud rate.
    tokenCost: limitCheck.cost,
    durationSeconds,
    usage,
  };
}
