export type MiniBarRecordingState =
  | "idle"
  | "preparing"
  | "recording"
  | "paused"
  | "processing"
  | "discarded"
  | "completed";

export function shouldShowMiniBar(
  state: MiniBarRecordingState,
  segment: string | undefined,
  flag: boolean,
  currentRecordingId?: string,
  completedRecordingId?: string | null,
): boolean {
  if (!flag) return false;
  if (state !== "recording" && state !== "paused" && state !== "processing" && state !== "completed") return false;
  if (segment === "record") return false;

  // The completion bar is a route back to the newly saved recording. Once the
  // automatic Record -> Recording Detail redirect has already landed on that
  // exact recording, the action is redundant and visually misleading.
  if (
    state === "completed" &&
    segment === "recording" &&
    completedRecordingId &&
    currentRecordingId === completedRecordingId
  ) {
    return false;
  }

  return true;
}
