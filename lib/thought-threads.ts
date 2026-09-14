import type {
  Recording,
  ThoughtThread,
  ThoughtThreadContext,
  ThoughtThreadConversionRun,
  ThoughtThreadItem,
} from "@shared/schema";
import type { TranslationKey } from "@/lib/i18n";
import { authFetch, getApiUrl } from "@/lib/query-client";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Alert, Platform } from "react-native";

const PENDING_ATTACHMENTS_KEY = "@thought_thread_pending_attachments_v2";

export interface PendingThoughtThreadAttachment {
  id: string;
  threadId: string;
  recordingId: string;
  createdAt: string;
  attempts: number;
  lastError?: string | null;
}

async function readPendingAttachments(): Promise<PendingThoughtThreadAttachment[]> {
  try {
    const raw = await AsyncStorage.getItem(PENDING_ATTACHMENTS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writePendingAttachments(
  entries: PendingThoughtThreadAttachment[],
): Promise<void> {
  await AsyncStorage.setItem(PENDING_ATTACHMENTS_KEY, JSON.stringify(entries));
}

export async function enqueuePendingThoughtThreadAttachment(
  threadId: string,
  recordingId: string,
  lastError?: string,
): Promise<void> {
  const entries = await readPendingAttachments();
  const existing = entries.find(
    (entry) => entry.threadId === threadId && entry.recordingId === recordingId,
  );
  if (existing) {
    existing.attempts += 1;
    existing.lastError = lastError || existing.lastError || null;
  } else {
    entries.push({
      id: `${threadId}:${recordingId}:${Date.now()}`,
      threadId,
      recordingId,
      createdAt: new Date().toISOString(),
      attempts: 1,
      lastError: lastError || null,
    });
  }
  await writePendingAttachments(entries);
}

export async function getPendingThoughtThreadAttachments(
  threadId: string,
): Promise<PendingThoughtThreadAttachment[]> {
  return (await readPendingAttachments())
    .filter((entry) => entry.threadId === threadId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function removePendingThoughtThreadAttachment(id: string): Promise<void> {
  await writePendingAttachments(
    (await readPendingAttachments()).filter((entry) => entry.id !== id),
  );
}

export interface HydratedThoughtThreadItem extends ThoughtThreadItem {
  recording: Recording | null;
}

export interface ThoughtThreadDetail {
  thread: ThoughtThread;
  items: HydratedThoughtThreadItem[];
  contexts: ThoughtThreadContext[];
  runs: Array<Omit<ThoughtThreadConversionRun, "sourceSnapshot" | "preparedSource" | "output">>;
  sourceSummary: {
    includedRecordingCount: number;
    contextCount: number;
    estimatedTokens: number;
    missingRecordingCount: number;
  };
}

export interface ThoughtThreadListItem extends ThoughtThread {
  recordingCount: number;
  contextCount: number;
  runCount: number;
}

export class ThoughtThreadRequestError extends Error {
  readonly status: number;
  readonly data: Record<string, unknown>;

  constructor(status: number, data: Record<string, unknown>) {
    super(
      typeof data.message === "string"
        ? data.message
        : typeof data.error === "string"
          ? data.error
          : `Thought Thread request failed (${status})`,
    );
    this.name = "ThoughtThreadRequestError";
    this.status = status;
    this.data = data;
  }
}

/** True when a ThoughtThreadRequestError is the server's cloud_sync_required gate. */
export function isCloudSyncRequiredError(error: unknown): error is ThoughtThreadRequestError {
  return error instanceof ThoughtThreadRequestError && error.data.error === "cloud_sync_required";
}

type TranslateFn = (key: TranslationKey, params?: Record<string, string | number>) => string;

const CLOUD_SYNC_SETTINGS_ROUTE = "/settings/integrations";

type RouterPush = (route: string) => void;

/**
 * Shown whenever a thought-thread action (the recording detail screen's
 * cloud icon, the recordings list combine action, etc.) is blocked by Cloud
 * Sync being disabled -- either because the client already knew that, or
 * because the server rejected the request with cloud_sync_required after a
 * stale client-side flag let the request through. Unlike a plain alert, this
 * gives the user an actual way to resolve it instead of dead-ending.
 *
 * `push` (the caller's `router.push`) is injected rather than importing
 * `router` from lib/navigation here, to avoid a circular import between this
 * module and the app/thought-threads screens that both use it and are wired
 * into lib/navigation.
 */
export function promptCloudSyncRequired(t: TranslateFn, push: RouterPush): void {
  const title = t("thread.requiresCloudSync");
  const message = t("thread.requiresCloudSyncHelp");
  const goToSettings = () => push(CLOUD_SYNC_SETTINGS_ROUTE);
  if (Platform.OS === "web") {
    if (confirm(`${title}: ${message}`)) goToSettings();
  } else {
    Alert.alert(title, message, [
      { text: t("common.cancel"), style: "cancel" },
      { text: t("thread.goToSettings"), onPress: goToSettings },
    ]);
  }
}

async function parseResponse<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    throw new ThoughtThreadRequestError(response.status, data);
  }
  return data as T;
}

export async function thoughtThreadRequest<T>(
  path: string,
  options?: RequestInit,
): Promise<T> {
  const url = new URL(path, getApiUrl()).toString();
  const response = await authFetch(url, {
    ...options,
    headers: {
      ...(options?.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      ...options?.headers,
    },
  });
  return parseResponse<T>(response);
}

export function createThoughtThread(recordingIds: string[], title?: string, operationId?: string) {
  return thoughtThreadRequest<ThoughtThreadDetail>("/api/thought-threads", {
    method: "POST",
    body: JSON.stringify({
      recordingIds,
      ...(title ? { title } : {}),
      ...(operationId ? { operationId } : {}),
    }),
  });
}

export type ContinueThoughtResult =
  | (ThoughtThreadDetail & { created: boolean; requiresChoice?: false })
  | {
      created: false;
      requiresChoice: true;
      threads: Array<{
        id: string;
        title: string;
        updatedAt: Date | string;
        recordingCount: number;
      }>;
    };

export function continueThoughtFromRecording(recordingId: string, threadId?: string) {
  return thoughtThreadRequest<ContinueThoughtResult>(
    `/api/thought-threads/from-recording/${encodeURIComponent(recordingId)}`,
    {
      method: "POST",
      body: JSON.stringify({
        ...(threadId ? { threadId } : {}),
        operationId: `continue:${recordingId}`,
      }),
    },
  );
}

export function addRecordingToThoughtThread(
  threadId: string,
  recordingId: string,
  expectedVersion?: number,
) {
  return thoughtThreadRequest<ThoughtThreadDetail>(
    `/api/thought-threads/${encodeURIComponent(threadId)}/recordings`,
    {
      method: "POST",
      body: JSON.stringify({
        recordingIds: [recordingId],
        operationId: `attach:${threadId}:${recordingId}`,
        ...(expectedVersion ? { expectedVersion } : {}),
      }),
    },
  );
}
