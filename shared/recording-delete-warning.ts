/**
 * The pre-delete Thought Thread warning, as pure data.
 *
 * Kept out of lib/thought-threads.ts on purpose: that module imports
 * react-native (Alert, Platform) and AsyncStorage, so nothing in it can be
 * loaded by the node test runner. The decision of WHICH sentence to show, and
 * with what values, is the part worth testing; turning it into a string is a
 * one-line translation in the caller.
 *
 * Shape note: a usage map is keyed by recording id because the caller asks about
 * a set of recordings at once (single delete sends one, bulk delete sends many),
 * and the server answers per recording.
 */
export type RecordingThreadUsage = Record<string, Array<{ id: string; title: string }>>;

/** How many of the recordings being deleted are used in a thread. */
export function recordingsAffectedByDelete(usage: RecordingThreadUsage): number {
  return Object.keys(usage).length;
}

/**
 * The threads a delete would damage, de-duplicated by thread id: one recording
 * can sit in several threads, and several selected recordings can sit in the
 * same thread, but the user should read each thread's name once.
 */
export function threadsAffectedByDelete(
  usage: RecordingThreadUsage,
): Array<{ id: string; title: string }> {
  const byId = new Map<string, { id: string; title: string }>();
  for (const threads of Object.values(usage)) {
    for (const thread of threads) if (!byId.has(thread.id)) byId.set(thread.id, thread);
  }
  return Array.from(byId.values());
}

/** How many threads the title list stopped naming. */
export const NAMED_THREAD_LIMIT = 3;

/**
 * The sentence to show, or null when the delete affects nothing.
 *
 * Titles are joined, not truncated: a warning the user cannot act on is worse
 * than a long one. The limit only stops a pathological case (dozens of threads)
 * from filling the dialog, and the "+N" says what it hid rather than silently
 * dropping names.
 */
export function deleteThreadWarningCopy(
  usage: RecordingThreadUsage,
  kind: "single" | "bulk" = "single",
):
  | { key: "record.deleteUsedInThreadOne"; params: { titles: string } }
  | { key: "record.deleteUsedInThreads"; params: { count: number; titles: string } }
  | { key: "record.deleteUsedInThreadsBulk"; params: { count: number; titles: string } }
  | null {
  const threads = threadsAffectedByDelete(usage);
  if (threads.length === 0) return null;
  const named = threads.slice(0, NAMED_THREAD_LIMIT).map((thread) => thread.title).join(", ");
  const titles = threads.length > NAMED_THREAD_LIMIT
    ? `${named} +${threads.length - NAMED_THREAD_LIMIT}`
    : named;
  if (kind === "bulk") {
    return {
      key: "record.deleteUsedInThreadsBulk",
      params: { count: recordingsAffectedByDelete(usage), titles },
    };
  }
  return threads.length === 1
    ? { key: "record.deleteUsedInThreadOne", params: { titles } }
    : { key: "record.deleteUsedInThreads", params: { count: threads.length, titles } };
}
