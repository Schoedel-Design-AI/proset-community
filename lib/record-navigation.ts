import type { ActiveRecordingState } from "@/lib/active-recording-context";

export function shouldPromptDiscardOnLeave(
  state: ActiveRecordingState,
  persistentRecording: boolean,
): boolean {
  const hasActiveRecording = state === "recording" || state === "paused";
  if (!hasActiveRecording) return false;
  return !persistentRecording;
}
