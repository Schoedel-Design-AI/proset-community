export function getRecordingsCountKey(count: number): "recordings.count" | "recordings.countPlural" {
  return count === 1 ? "recordings.count" : "recordings.countPlural";
}
