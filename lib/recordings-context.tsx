import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef, ReactNode } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { AppState, Platform, type AppStateStatus } from "react-native";
import { useAuth } from "./auth-context";
import { getAudioUploadMetadata } from "./audio-upload-metadata";
import { getTranscriptionText, hasTranscriptionContent } from "./recording-api";
import { getApiUrl, getAuthHeaders } from "./query-client";
import {
  normalizeRecordingTransferFields,
  type RecordingTransferFields,
} from "@shared/recording-transfer";

export interface Conversion {
  id: string;
  type: string;
  label: string;
  content: string;
  createdAt: string;
  /** Slide Deck: server-side deck record id (deck_...) */
  deckId?: string;
  /** Slide Deck: authenticated bucket path for the generated .pptx */
  pptxUrl?: string;
  /** Slide Deck: download file name */
  fileName?: string;
}

export interface Recording extends RecordingTransferFields {
  id: string;
  title: string;
  duration: number;
  audioUri: string;
  transcript: string;
  conversions: Conversion[];
  createdAt: string;
}

interface RecordingsContextValue {
  recordings: Recording[];
  isLoading: boolean;
  isCloudSyncEnabled: boolean;
  isSyncing: boolean;
  storageLocation: "local" | "cloud";
  maxRecordings: number;
  maxItems: number;
  lastRecordingLimitEvent: number;
  addRecording: (recording: Recording) => Promise<void>;
  updateRecording: (id: string, updates: Partial<Recording>) => Promise<void>;
  /**
   * Local-only recording update. Folds server truth into the app's in-memory
   * + persisted state WITHOUT echoing it back to the server. Used by the
   * native reconcile poll — the server is the single writer for upload and
   * transcription state (the UploadWorker reports it), and echoing a stale
   * local read back races those writes and can regress them (e.g. audioUri
   * flipping from bucket:// back to file://, permanently stranding the
   * recording as "uploading").
   */
  applyLocalRecording: (id: string, updates: Partial<Recording>) => void;
  deleteRecording: (id: string) => Promise<void>;
  addConversion: (recordingId: string, conversion: Conversion) => Promise<void>;
  deleteConversion: (recordingId: string, conversionId: string) => Promise<void>;
  getRecording: (id: string) => Recording | undefined;
  fetchRecording: (id: string) => Promise<Recording | null>;
  setCloudSync: (enabled: boolean) => Promise<void>;
  syncToCloud: () => Promise<void>;
  isAutoTranscribeEnabled: boolean;
  setAutoTranscribe: (enabled: boolean) => Promise<void>;
  transcribeAudio: (recordingId: string, audioUri: string, language: string, audioBlob?: Blob) => Promise<void>;
}

const RecordingsContext = createContext<RecordingsContextValue | null>(null);

const STORAGE_KEY_PREFIX = "@voicenote_recordings";
const CLOUD_SYNC_KEY_PREFIX = "@voicenote_cloud_sync";
const AUTO_TRANSCRIBE_KEY_PREFIX = "@voicenote_auto_transcribe";

function getScopedStorageKey(userId?: string | null) {
  return `${STORAGE_KEY_PREFIX}:${userId || "guest"}`;
}

function getScopedCloudSyncKey(userId?: string | null) {
  return `${CLOUD_SYNC_KEY_PREFIX}:${userId || "guest"}`;
}

function getScopedAutoTranscribeKey(userId?: string | null) {
  return `${AUTO_TRANSCRIBE_KEY_PREFIX}:${userId || "guest"}`;
}

function apiFetch(path: string, options?: RequestInit) {
  const baseUrl = getApiUrl();
  const url = new URL(path, baseUrl).toString();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...getAuthHeaders(),
    ...(options?.headers as Record<string, string>),
  };
  return globalThis.fetch(url, {
    ...options,
    headers,
    credentials: "include",
  });
}

function toPersistedRecordingUpdates(updates: Partial<Recording>) {
  const persistedUpdates: Partial<Recording> = {};
  if (updates.title !== undefined) persistedUpdates.title = updates.title;
  if (updates.duration !== undefined) persistedUpdates.duration = updates.duration;
  if (updates.audioUri !== undefined) persistedUpdates.audioUri = updates.audioUri;
  if (updates.transcript !== undefined) persistedUpdates.transcript = updates.transcript;
  if (updates.conversions !== undefined) persistedUpdates.conversions = updates.conversions;
  if (updates.createdAt !== undefined) persistedUpdates.createdAt = updates.createdAt;
  if (updates.needsUpload !== undefined) persistedUpdates.needsUpload = updates.needsUpload;
  if (updates.uploadStatus !== undefined) persistedUpdates.uploadStatus = updates.uploadStatus;
  if (updates.uploadErrorCode !== undefined) persistedUpdates.uploadErrorCode = updates.uploadErrorCode;
  if (updates.uploadRetryable !== undefined) persistedUpdates.uploadRetryable = updates.uploadRetryable;
  if (updates.isTranscribing !== undefined) persistedUpdates.isTranscribing = updates.isTranscribing;
  if (updates.transcriptionStatus !== undefined) persistedUpdates.transcriptionStatus = updates.transcriptionStatus;
  if (updates.transcriptionErrorCode !== undefined) persistedUpdates.transcriptionErrorCode = updates.transcriptionErrorCode;
  if (updates.transcriptionError !== undefined) persistedUpdates.transcriptionError = updates.transcriptionError;
  if (updates.transcriptionRetryable !== undefined) persistedUpdates.transcriptionRetryable = updates.transcriptionRetryable;
  return persistedUpdates;
}

function normalizeRecording(rec: any): Recording {
  const audioUri = rec.audioUri || rec.audio_uri || "";
  return {
    id: rec.id,
    title: rec.title,
    duration: rec.duration || 0,
    audioUri,
    transcript: rec.transcript || "",
    conversions: Array.isArray(rec.conversions) ? rec.conversions : [],
    createdAt: rec.createdAt || rec.created_at || new Date().toISOString(),
    ...normalizeRecordingTransferFields(rec, audioUri),
  };
}

const UNAUTHENTICATED_MAX_RECORDINGS = 25;
const MAX_RECORDINGS_CACHE_KEY = "@voicenote_max_recordings";

export function RecordingsProvider({ children }: { children: ReactNode }) {
  const { user, isLoading: isAuthLoading } = useAuth();
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCloudSyncEnabled, setIsCloudSyncEnabled] = useState(false);
  const [isAutoTranscribeEnabled, setIsAutoTranscribeEnabled] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [maxRecordings, setMaxRecordings] = useState(UNAUTHENTICATED_MAX_RECORDINGS);
  const [, setMaxRecordingsLoaded] = useState(false);
  const [lastRecordingLimitEvent, setLastRecordingLimitEvent] = useState(0);

  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const scopedStorageKey = useMemo(() => getScopedStorageKey(user?.id), [user?.id]);
  const scopedCloudSyncKey = useMemo(() => getScopedCloudSyncKey(user?.id), [user?.id]);
  const scopedAutoTranscribeKey = useMemo(() => getScopedAutoTranscribeKey(user?.id), [user?.id]);
  const canUseCloud = !isAuthLoading && !!user;
  const isServerMode = canUseCloud && isCloudSyncEnabled;
  const storageLocation: "local" | "cloud" = isServerMode ? "cloud" : "local";

  const loadRecordings = useCallback(async () => {
    setIsLoading(true);
    try {
      // Always fetch from server first when logged in, regardless of cloud sync
      // This ensures recordings are available from any device
      if (canUseCloud) {
        try {
          const res = await apiFetch("/api/recordings");
          if (res.ok) {
            const data = await res.json();
            const recordingsList = Array.isArray(data) ? data : (data.recordings || []);
            if (isMountedRef.current) {
              setRecordings(recordingsList.map(normalizeRecording));
            }
            return;
          }
        } catch (e) {
          console.warn("Server unavailable, loading from local storage:", e);
        }
      }
      const stored = await AsyncStorage.getItem(scopedStorageKey);
      if (!isMountedRef.current) return;
      if (stored) {
        const parsed: Recording[] = JSON.parse(stored);
        const cleaned = parsed.map(r => {
          if (r.isTranscribing) {
            return {
              ...r,
              isTranscribing: false,
              transcriptionStatus: "failed" as const,
              transcriptionErrorCode: r.transcriptionErrorCode || "transcription_failed",
              transcriptionRetryable: r.transcriptionRetryable ?? true,
              transcript: r.transcript || "",
            };
          }
          return r;
        });
        if (cleaned.some((r, i) => r !== parsed[i])) {
          await AsyncStorage.setItem(scopedStorageKey, JSON.stringify(cleaned)).catch(() => {});
        }
        if (isMountedRef.current) {
          setRecordings(cleaned);
        }
      } else {
        if (isMountedRef.current) {
          setRecordings([]);
        }
      }
    } catch (e) {
      console.error("Failed to load recordings:", e);
    } finally {
      if (isMountedRef.current) {
        setIsLoading(false);
      }
    }
  }, [canUseCloud, scopedStorageKey]);

  useEffect(() => {
    if (isAuthLoading) {
      setMaxRecordingsLoaded(false);
      return;
    }
    if (user) {
      setMaxRecordingsLoaded(false);
      let resolved = false;
      const loadMaxRecordings = async () => {
        const cached = await AsyncStorage.getItem(MAX_RECORDINGS_CACHE_KEY).catch(() => null);
        if (cached && isMountedRef.current) {
          const parsed = parseInt(cached, 10);
          if (!isNaN(parsed) && parsed > 0) {
            setMaxRecordings(parsed);
            setMaxRecordingsLoaded(true);
            resolved = true;
          }
        }
        try {
          const baseUrl = getApiUrl();
          const res = await globalThis.fetch(new URL("/api/usage", baseUrl).toString(), {
            credentials: "include",
            headers: getAuthHeaders(),
          });
          if (res.ok && isMountedRef.current) {
            const data = await res.json();
            const nextMaxRecordings = data.maxRecordings || data.maxItems;
            if (nextMaxRecordings) {
              setMaxRecordings(nextMaxRecordings);
              setMaxRecordingsLoaded(true);
              resolved = true;
              AsyncStorage.setItem(MAX_RECORDINGS_CACHE_KEY, String(nextMaxRecordings)).catch(() => {});
            }
          }
        } catch {}
        if (!resolved && isMountedRef.current) {
          setMaxRecordingsLoaded(true);
        }
      };
      loadMaxRecordings();
    } else {
      if (isMountedRef.current) {
        setMaxRecordings(UNAUTHENTICATED_MAX_RECORDINGS);
        setMaxRecordingsLoaded(true);
      }
      AsyncStorage.removeItem(MAX_RECORDINGS_CACHE_KEY).catch(() => {});
    }
  }, [isAuthLoading, user, isCloudSyncEnabled]);

  useEffect(() => {
    if (isAuthLoading) return;
    AsyncStorage.getItem(scopedCloudSyncKey).then(val => {
      if (isMountedRef.current && val !== null) setIsCloudSyncEnabled(val === "true");
    }).catch(() => {});

    AsyncStorage.getItem(scopedAutoTranscribeKey).then(val => {
      if (isMountedRef.current && val !== null) setIsAutoTranscribeEnabled(val !== "false"); // Default true
    }).catch(() => {});

    if (canUseCloud) {
      apiFetch("/api/cloud-sync").then(res => {
        if (res.ok) return res.json();
        return null;
      }).then(data => {
        if (isMountedRef.current && data && typeof data.enabled === "boolean") {
          setIsCloudSyncEnabled(data.enabled);
          AsyncStorage.setItem(scopedCloudSyncKey, data.enabled ? "true" : "false").catch(() => {});
        }
      }).catch(() => {});
    }
  }, [canUseCloud, isAuthLoading, scopedAutoTranscribeKey, scopedCloudSyncKey]);

  useEffect(() => {
    if (isAuthLoading) {
      setIsLoading(true);
      return;
    }
    void loadRecordings();
  }, [isAuthLoading, loadRecordings]);

  const saveLocal = useCallback(async (recs: Recording[]) => {
    try {
      await AsyncStorage.setItem(scopedStorageKey, JSON.stringify(recs));
    } catch (e) {
      console.error("Failed to save recordings:", e);
    }
  }, [scopedStorageKey]);

  const syncToCloud = useCallback(async () => {
    if (!canUseCloud) return;
    setIsSyncing(true);
    try {
      const stored = await AsyncStorage.getItem(scopedStorageKey);
      const localRecs: Recording[] = stored ? JSON.parse(stored) : [];
      if (localRecs.length === 0) return;

      let serverRes: Response;
      try {
        serverRes = await apiFetch("/api/recordings");
      } catch {
        return;
      }
      if (!serverRes.ok) return;

      const serverData = await serverRes.json();
      const serverList = Array.isArray(serverData) ? serverData : (serverData.recordings || []);
      const serverIds = new Set(serverList.map((r: any) => r.id));

      for (const rec of localRecs) {
        if (!serverIds.has(rec.id)) {
          try {
            await apiFetch("/api/recordings", {
              method: "POST",
              body: JSON.stringify(rec),
            });
          } catch (e) {
            console.warn("Failed to sync recording:", rec.id, e);
          }
        }
      }

      const mergedRes = await apiFetch("/api/recordings");
      if (mergedRes.ok && isMountedRef.current) {
        const mergedData = await mergedRes.json();
        const mergedList = Array.isArray(mergedData) ? mergedData : (mergedData.recordings || []);
        setRecordings(mergedList.map(normalizeRecording));
      }
    } catch (e) {
      console.error("Sync to cloud failed:", e);
    } finally {
      if (isMountedRef.current) {
        setIsSyncing(false);
      }
    }
  }, [canUseCloud, scopedStorageKey]);

  const setCloudSync = useCallback(async (enabled: boolean) => {
    await AsyncStorage.setItem(scopedCloudSyncKey, enabled ? "true" : "false");
    setIsCloudSyncEnabled(enabled);
    if (canUseCloud) {
      try {
        await apiFetch("/api/cloud-sync", {
          method: "PUT",
          body: JSON.stringify({ enabled }),
        });
      } catch (e) {
        console.warn("Failed to persist cloud sync preference:", e);
      }
    }
    if (enabled && canUseCloud) {
      await syncToCloud();
    }
  }, [canUseCloud, scopedCloudSyncKey, syncToCloud]);

  const setAutoTranscribe = useCallback(async (enabled: boolean) => {
    await AsyncStorage.setItem(scopedAutoTranscribeKey, enabled ? "true" : "false");
    setIsAutoTranscribeEnabled(enabled);
  }, [scopedAutoTranscribeKey]);

  const addRecording = useCallback(async (recording: Recording) => {
    setRecordings((prev) => {
      const next = [recording, ...prev];
      saveLocal(next);
      return next;
    });

    // Always save to server when logged in, regardless of cloud sync
    // This ensures recordings are available from any device
    if (canUseCloud) {
      const res = await apiFetch("/api/recordings", {
        method: "POST",
        body: JSON.stringify(recording),
      }).catch((e) => {
        console.warn("Server save failed, data is safe locally:", e);
        return null;
      });
      if (res) {
        if (res.ok) {
          await res.json().catch(() => null);
        } else if (res.status === 409) {
          const data = await res.json().catch(() => ({}));
          setRecordings((prev) => {
            const filtered = prev.filter((r) => r.id !== recording.id);
            saveLocal(filtered);
            return filtered;
          });
          setLastRecordingLimitEvent(Date.now());
          throw new Error(data.message || "This recording could not be saved.");
        }
      }
    }
  }, [canUseCloud, saveLocal]);

  const updateRecording = useCallback(async (id: string, updates: Partial<Recording>) => {
    setRecordings((prev) => {
      const next = prev.map((r) => (r.id === id ? { ...r, ...updates } : r));
      saveLocal(next);
      return next;
    });

    if (canUseCloud) {
      try {
        const persistedUpdates = toPersistedRecordingUpdates(updates);
        if (Object.keys(persistedUpdates).length === 0) {
          return;
        }
        await apiFetch(`/api/recordings/${id}`, {
          method: "PUT",
          body: JSON.stringify(persistedUpdates),
        });
      } catch (e) {
        console.warn("Server update failed, data is safe locally:", e);
      }
    }
  }, [canUseCloud, saveLocal]);

  const applyLocalRecording = useCallback((id: string, updates: Partial<Recording>) => {
    setRecordings((prev) => {
      const next = prev.map((r) => (r.id === id ? { ...r, ...updates } : r));
      saveLocal(next);
      return next;
    });
  }, [saveLocal]);

  const deleteRecording = useCallback(async (id: string) => {
    setRecordings((prev) => {
      const next = prev.filter((r) => r.id !== id);
      saveLocal(next);
      return next;
    });

    AsyncStorage.removeItem(`@voicenote_draft_${id}`).catch(() => {});

    if (canUseCloud) {
      try {
        await apiFetch(`/api/recordings/${id}`, {
          method: "DELETE",
        });
      } catch (e) {
        console.warn("Server delete failed:", e);
      }
    }
  }, [canUseCloud, saveLocal]);

  const addConversion = useCallback(async (recordingId: string, conversion: Conversion) => {
    setRecordings((prev) => {
      const next = prev.map((r) =>
        r.id === recordingId ? { ...r, conversions: [...r.conversions, conversion] } : r
      );
      saveLocal(next);
      return next;
    });

    if (canUseCloud) {
      try {
        const rec = recordings.find((r) => r.id === recordingId);
        if (rec) {
          const updatedConversions = [...rec.conversions, conversion];
          await apiFetch(`/api/recordings/${recordingId}`, {
            method: "PUT",
            body: JSON.stringify({ conversions: updatedConversions }),
          });
        }
      } catch (e) {
        console.warn("Server conversion save failed:", e);
      }
    }
  }, [canUseCloud, recordings, saveLocal]);

  const deleteConversion = useCallback(async (recordingId: string, conversionId: string) => {
    setRecordings((prev) => {
      const next = prev.map((r) =>
        r.id === recordingId
          ? { ...r, conversions: r.conversions.filter((c) => c.id !== conversionId) }
          : r
      );
      saveLocal(next);
      return next;
    });

    if (canUseCloud) {
      try {
        const rec = recordings.find((r) => r.id === recordingId);
        if (rec) {
          const updatedConversions = rec.conversions.filter((c) => c.id !== conversionId);
          await apiFetch(`/api/recordings/${recordingId}`, {
            method: "PUT",
            body: JSON.stringify({ conversions: updatedConversions }),
          });
        }
      } catch (e) {
        console.warn("Server conversion delete failed:", e);
      }
    }
  }, [canUseCloud, recordings, saveLocal]);

  const getRecording = useCallback(
    (id: string) => recordings.find((r) => r.id === id),
    [recordings]
  );

  const fetchRecording = useCallback(async (id: string) => {
    if (!user) return null;

    try {
      const res = await apiFetch(`/api/recordings/${id}`);
      if (!res.ok) return null;

      const normalized = normalizeRecording(await res.json());
      setRecordings((prev) => {
        const existingIndex = prev.findIndex((recording) => recording.id === normalized.id);
        if (existingIndex >= 0) {
          const next = [...prev];
          next[existingIndex] = { ...next[existingIndex], ...normalized };
          if (normalized.transcript.trim()) {
            next[existingIndex].transcriptionError = null;
            next[existingIndex].transcriptionErrorCode = null;
            next[existingIndex].transcriptionRetryable = null;
            next[existingIndex].isTranscribing = false;
            next[existingIndex].transcriptionStatus = "succeeded";
          }
          saveLocal(next);
          return next;
        }

        const next = [normalized, ...prev].sort(
          (left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
        );
        saveLocal(next);
        return next;
      });
      return normalized;
    } catch (error) {
      console.warn("Failed to fetch recording:", id, error);
      return null;
    }
  }, [saveLocal, user]);

  const doTranscribe = useCallback((recordingId: string, audioUri: string, language: string, audioBlob?: Blob) => {
    const run = async () => {
      try {
        const baseUrl = getApiUrl();
        const url = new URL("/api/transcribe", baseUrl);

        if (Platform.OS === "web") {
          let blob: Blob;
          if (audioBlob) {
            blob = audioBlob;
          } else if (audioUri.startsWith("blob:")) {
            const response = await globalThis.fetch(audioUri);
            blob = await response.blob();
          } else if (audioUri.startsWith("bucket://")) {
            const bucketKey = audioUri.replace("bucket://", "");
            const resolveUrl = new URL(`/api/bucket/resolve/${bucketKey}`, baseUrl).toString();
            const response = await globalThis.fetch(resolveUrl, { credentials: "include" });
            blob = await response.blob();
          } else {
            const fullAudioUrl = new URL(audioUri, baseUrl).toString();
            const response = await globalThis.fetch(fullAudioUrl, { credentials: "include" });
            blob = await response.blob();
          }

          if (blob.size < 100) {
            console.warn("Audio blob is too small, likely empty:", blob.size);
            await updateRecording(recordingId, {
              transcriptionError: "The audio file is empty or incomplete.",
              transcriptionErrorCode: "transcription_failed",
              transcriptionRetryable: false,
              isTranscribing: false,
              transcriptionStatus: "failed",
            });
            return;
          }

          const blobType = blob.type || "audio/webm";

          // The server owns the latency-first provider hedge. Do not immediately
          // repeat the entire multi-provider request from the client.
          const MAX_ATTEMPTS = 1;
          const BASE_DELAY_MS = 3000;
          const FETCH_TIMEOUT_MS = 180 * 1000;
          let lastError: unknown = null;

          for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
            let timeoutId: ReturnType<typeof setTimeout> | null = null;
            try {
              const controller = new AbortController();
              timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

              const fd = new FormData();
              fd.append("audio", new File([blob], "recording.webm", { type: blobType }));
              if (language && language !== "en") {
                fd.append("language", language);
                if (language === "es") {
                  // Bias Whisper toward Latin American / Mexican Spanish
                  fd.append("prompt", "Español latinoamericano, acento mexicano.");
                }
              }

              const res = await globalThis.fetch(url.toString(), {
                method: "POST",
                body: fd,
                credentials: "include",
                headers: getAuthHeaders(),
                signal: controller.signal,
              });
              clearTimeout(timeoutId);

              // Success
              if (res.ok) {
                const data = await res.json();
                if (!hasTranscriptionContent(data)) {
                  await updateRecording(recordingId, {
                    transcript: "",
                    transcriptionError: "No speech was detected. Move closer to the microphone and retry, or re-record.",
                    transcriptionErrorCode: "transcription_no_speech",
                    transcriptionRetryable: true,
                    isTranscribing: false,
                    transcriptionStatus: "failed",
                  });
                  return;
                }
                await updateRecording(recordingId, {
                  transcript: getTranscriptionText(data),
                  transcriptionError: null,
                  transcriptionErrorCode: null,
                  transcriptionRetryable: null,
                  isTranscribing: false,
                  transcriptionStatus: "succeeded",
                });
                return;
              }

              // Non-retryable status codes
              if (res.status === 402) {
                await updateRecording(recordingId, {
                  transcriptionError: "Pro level access is required for another transcription.",
                  transcriptionErrorCode: "pro_access_required",
                  transcriptionRetryable: false,
                  isTranscribing: false,
                  transcriptionStatus: "failed",
                });
                return;
              }
              if (res.status === 429) {
                const errData = await res.json().catch(() => ({}));
                await updateRecording(recordingId, {
                  transcriptionError: errData.message || "The transcription limit has been reached.",
                  transcriptionErrorCode: errData.error === "spending_cap_reached"
                    ? "spending_cap_reached"
                    : "monthly_limit_reached",
                  transcriptionRetryable: false,
                  isTranscribing: false,
                  transcriptionStatus: "failed",
                });
                return;
              }
              if (res.status === 504) {
                // Gateway timeout — retryable
                lastError = new Error(`Transcription server timed out (504)`);
              } else if (res.status >= 500) {
                lastError = new Error(`Server error ${res.status}`);
              } else {
                // 4xx client error — not retryable
                const errBody = await res.text().catch(() => "");
                console.error("Transcription client error:", res.status, errBody);
                lastError = new Error(`Transcription failed: ${res.status}`);
                break; // don't retry 4xx
              }
            } catch (err: any) {
              if (timeoutId) clearTimeout(timeoutId);
              lastError = err;
              // Network errors (TypeError, AbortError) are always retryable
              if (err?.name === "AbortError") {
                console.warn(`Transcription fetch timed out (attempt ${attempt + 1}/${MAX_ATTEMPTS})`);
              }
            }

            if (attempt < MAX_ATTEMPTS - 1) {
              const delay = BASE_DELAY_MS * Math.pow(3, attempt);
              await new Promise(r => setTimeout(r, delay));
            }
          }

          // All retries exhausted — mark for auto-retry
          console.error("Transcription failed after", MAX_ATTEMPTS, "attempts:", lastError);
          await updateRecording(recordingId, {
            transcriptionError: "Transcription didn't complete. Retrying when connected.",
            transcriptionErrorCode: "transcription_failed",
            transcriptionRetryable: true,
            isTranscribing: false,
            transcriptionStatus: "failed",
          });
        } else {
          const nativeHeaders: Record<string, string> = {
            ...getAuthHeaders(),
          };

          // Same latency-first contract as web: one request with a deadline
          // above the server's 60-second provider budget so a mobile upload is
          // not misclassified as slow provider inference.
          const MAX_ATTEMPTS = 1;
          const BASE_DELAY_MS = 3000;
          const FETCH_TIMEOUT_MS = 180 * 1000;
          let lastError: unknown = null;

          for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
            let timeoutId: ReturnType<typeof setTimeout> | null = null;
            try {
              const controller = new AbortController();
              timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

              const isStoredRecording = audioUri.startsWith("bucket://");
              const requestUrl = isStoredRecording
                ? new URL(`/api/recordings/${encodeURIComponent(recordingId)}/transcribe`, baseUrl)
                : url;
              let body: FormData | string;
              if (isStoredRecording) {
                nativeHeaders["Content-Type"] = "application/json";
                body = JSON.stringify({ language: language || undefined });
              } else {
                const fd = new FormData();
                const upload = getAudioUploadMetadata(audioUri);
                fd.append("audio", { uri: audioUri, ...upload } as any);
                if (language && language !== "en") {
                  fd.append("language", language);
                  if (language === "es") {
                    fd.append("prompt", "Español latinoamericano, acento mexicano.");
                  }
                }
                body = fd;
              }
              const res = await globalThis.fetch(requestUrl.toString(), {
                method: "POST",
                body,
                headers: nativeHeaders,
                signal: controller.signal,
              });
              clearTimeout(timeoutId);

              if (res.ok) {
                const data = await res.json();
                if (!hasTranscriptionContent(data)) {
                  await updateRecording(recordingId, {
                    transcript: "",
                    transcriptionError: "No speech was detected. Move closer to the microphone and retry, or re-record.",
                    transcriptionErrorCode: "transcription_no_speech",
                    transcriptionRetryable: true,
                    isTranscribing: false,
                    transcriptionStatus: "failed",
                  });
                  return;
                }
                await updateRecording(recordingId, {
                  transcript: getTranscriptionText(data),
                  transcriptionError: null,
                  transcriptionErrorCode: null,
                  transcriptionRetryable: null,
                  isTranscribing: false,
                  transcriptionStatus: "succeeded",
                });
                return;
              }

              if (res.status === 402) {
                await updateRecording(recordingId, {
                  transcriptionError: "Pro level access is required for another transcription.",
                  transcriptionErrorCode: "pro_access_required",
                  transcriptionRetryable: false,
                  isTranscribing: false,
                  transcriptionStatus: "failed",
                });
                return;
              }
              if (res.status === 429) {
                const errData = await res.json().catch(() => ({}));
                await updateRecording(recordingId, {
                  transcriptionError: errData.message || "The transcription limit has been reached.",
                  transcriptionErrorCode: errData.error === "spending_cap_reached"
                    ? "spending_cap_reached"
                    : "monthly_limit_reached",
                  transcriptionRetryable: false,
                  isTranscribing: false,
                  transcriptionStatus: "failed",
                });
                return;
              }
              if (res.status >= 500) {
                lastError = new Error(`Server error ${res.status}`);
              } else {
                const errBody = await res.text().catch(() => "");
                console.error("Transcription client error:", res.status, errBody);
                lastError = new Error(`Transcription failed: ${res.status}`);
                break;
              }
            } catch (err: any) {
              if (timeoutId) clearTimeout(timeoutId as any);
              lastError = err;
              if (err?.name === "AbortError") {
                console.warn(`Transcription fetch timed out (attempt ${attempt + 1}/${MAX_ATTEMPTS})`);
              }
            }

            if (attempt < MAX_ATTEMPTS - 1) {
              const delay = BASE_DELAY_MS * Math.pow(3, attempt);
              await new Promise(r => setTimeout(r, delay));
            }
          }

          console.error("Transcription failed after", MAX_ATTEMPTS, "attempts:", lastError);
          await updateRecording(recordingId, {
            transcriptionError: "Transcription didn't complete. Retrying when connected.",
            transcriptionErrorCode: "transcription_failed",
            transcriptionRetryable: true,
            isTranscribing: false,
            transcriptionStatus: "failed",
          });
        }
      } catch (err) {
        console.error("Transcription error:", err);
        try {
          await updateRecording(recordingId, {
            transcriptionError: "Transcription didn't complete. Retrying when connected.",
            transcriptionErrorCode: "transcription_failed",
            transcriptionRetryable: true,
            isTranscribing: false,
            transcriptionStatus: "failed",
          });
        } catch {
          // ignore
        }
      }
    };
    return run();
  }, [updateRecording]);

  // Auto-retry failed transcriptions when app comes to foreground
  const retryingRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const retryFailed = () => {
      const failed = recordings.filter(
        (r) => r.transcriptionError && r.transcriptionRetryable !== false && r.audioUri && !retryingRef.current.has(r.id)
      );
      if (failed.length === 0) return;

      for (const rec of failed) {
        retryingRef.current.add(rec.id);
        // Clear error and set transcribing so the UI updates
        updateRecording(rec.id, {
          transcriptionError: null,
          transcriptionErrorCode: null,
          isTranscribing: true,
          transcriptionStatus: "transcribing",
        });
        void doTranscribe(rec.id, rec.audioUri, "").finally(() => {
          retryingRef.current.delete(rec.id);
        });
      }
    };

    retryFailed();

    const sub = AppState.addEventListener("change", (state: AppStateStatus) => {
      if (state === "active") retryFailed();
    });
    return () => sub.remove();
  }, [recordings, doTranscribe, updateRecording]);

  const value = useMemo(
    () => ({
      recordings,
      isLoading,
      isCloudSyncEnabled,
      isAutoTranscribeEnabled,
      isSyncing,
      storageLocation,
      maxRecordings,
      maxItems: maxRecordings,
      lastRecordingLimitEvent,
      addRecording,
      updateRecording,
      applyLocalRecording,
      deleteRecording,
      addConversion,
      deleteConversion,
      getRecording,
      fetchRecording,
      setCloudSync,
      setAutoTranscribe,
      syncToCloud,
      transcribeAudio: doTranscribe,
    }),
    [recordings, isLoading, isCloudSyncEnabled, isAutoTranscribeEnabled, isSyncing, storageLocation, maxRecordings, lastRecordingLimitEvent, addRecording, updateRecording, applyLocalRecording, deleteRecording, addConversion, deleteConversion, getRecording, fetchRecording, setCloudSync, setAutoTranscribe, syncToCloud, doTranscribe]
  );

  return <RecordingsContext.Provider value={value}>{children}</RecordingsContext.Provider>;
}

export function useRecordings() {
  const context = useContext(RecordingsContext);
  if (!context) {
    throw new Error("useRecordings must be used within a RecordingsProvider");
  }
  return context;
}
