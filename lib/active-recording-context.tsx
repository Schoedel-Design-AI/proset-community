import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Audio } from "@/lib/audio";
import { useRecordings, type Recording } from "@/lib/recordings-context";
import { useAuth } from "@/lib/auth-context";
import { useLanguage } from "@/lib/i18n";
import { useReducedMotion } from "@/lib/useReducedMotion";
import { featureFlags } from "@/lib/feature-flags";
import { normalizeMeteringDb } from "@/lib/audio-metering";
import { useAudioInputSettings } from "@/lib/audio-input-settings";
import { getUploadedAudioUri } from "@/lib/recording-api";
import { getApiUrl, getAuthHeaders } from "@/lib/query-client";
import { generateId, formatDuration } from "@/lib/utils";
import { recordingForegroundService, type RecordingNotificationCopy } from "@/lib/recording-foreground-service";
import { enqueueBackgroundUpload } from "@/lib/upload-worker";
// Whisper local transcription disconnected — cloud-only pipeline
import { recordCompleted } from "@/lib/engagement";
import { TIER_LIMITS } from "@shared/plan-limits";
import {
  ACTIVE_RECORDING_SNAPSHOT_KEY,
  decideInterruption,
  parseSnapshot,
  serializeSnapshot,
  type ActiveRecordingSnapshot,
} from "@/lib/active-recording-recovery";

export type ActiveRecordingState =
  | "idle"
  | "preparing"
  | "recording"
  | "paused"
  | "processing"
  | "discarded"
  | "completed";

export interface ActiveRecordingValue {
  state: ActiveRecordingState;
  duration: number;
  meteringLevel: number;
  startedAt: number | null;
  maxRecordingSeconds: number;
  webErrorMessage: string | null;
  /** Increments each time a recording is successfully finalized + saved.
   *  Value is the recording ID so the record screen can navigate to it. */
  completionVersion: string | null;
  /** The ID of the most recently completed recording, for navigation from the mini bar. */
  completedRecordingId: string | null;
  start: () => Promise<void>;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  /** Stop and finalize: persists the recording and triggers transcription. */
  stop: () => Promise<{ success: boolean }>;
  /** Discard the active recording without saving. Safe to call from any state. */
  discard: () => Promise<void>;
  clearWebError: () => void;
  /**
   * Called by the Record screen when it unmounts. Honors the
   * `persistentRecording` feature flag: when OFF, the active recording is
   * torn down (legacy behavior). When ON, this is a no-op so the recording
   * keeps running across navigation.
   */
  notifyScreenUnmounted: () => void;
}

const ActiveRecordingContext = createContext<ActiveRecordingValue | null>(null);

const DEFAULT_MAX_RECORDING_SECONDS = TIER_LIMITS.free.maxRecordingSeconds;

export function ActiveRecordingProvider({ children }: { children: ReactNode }) {
  const { addRecording, transcribeAudio, updateRecording, isAutoTranscribeEnabled, isCloudSyncEnabled } = useRecordings();
  const { user, isLoading: isAuthLoading } = useAuth();
  const { language, t } = useLanguage();
  const reduceMotion = useReducedMotion();

  const [state, setState] = useState<ActiveRecordingState>("idle");
  const [duration, setDuration] = useState(0);
  const [meteringLevel, setMeteringLevel] = useState(0);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [maxRecordingSeconds, setMaxRecordingSeconds] = useState(DEFAULT_MAX_RECORDING_SECONDS);
  const [webErrorMessage, setWebErrorMessage] = useState<string | null>(null);
  const [completionVersion, setCompletionVersion] = useState<string | null>(null);
  const [completedRecordingId, setCompletedRecordingId] = useState<string | null>(null);

  // Refs for things consumed inside async closures so methods can stay stable.
  const recordingRef = useRef<Audio.Recording | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const autoStopRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const meterRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const micReadyRef = useRef(false);
  const durationRef = useRef(0);
  const stateRef = useRef<ActiveRecordingState>("idle");
  const maxRecordingSecondsRef = useRef(maxRecordingSeconds);
  const reduceMotionRef = useRef(reduceMotion);
  const languageRef = useRef(language);
  const tRef = useRef(t);
  const isAutoTranscribeEnabledRef = useRef(isAutoTranscribeEnabled);
  const isCloudSyncEnabledRef = useRef(isCloudSyncEnabled);

  // Audio input device: the user's last selection from the nav drawer, persisted
  // to AsyncStorage. Read on mount and kept in a ref so start() always uses it.
  const audioSettings = useAudioInputSettings();
  const audioDeviceIdRef = useRef<string | null>(audioSettings.selectedDeviceId);
  useEffect(() => { audioDeviceIdRef.current = audioSettings.selectedDeviceId; }, [audioSettings.selectedDeviceId]);

  useEffect(() => { durationRef.current = duration; }, [duration]);
  useEffect(() => { stateRef.current = state; }, [state]);
  useEffect(() => { maxRecordingSecondsRef.current = maxRecordingSeconds; }, [maxRecordingSeconds]);
  useEffect(() => { reduceMotionRef.current = reduceMotion; }, [reduceMotion]);
  useEffect(() => { languageRef.current = language; }, [language]);
  useEffect(() => { tRef.current = t; }, [t]);
  useEffect(() => { isAutoTranscribeEnabledRef.current = isAutoTranscribeEnabled; }, [isAutoTranscribeEnabled]);
  useEffect(() => { isCloudSyncEnabledRef.current = isCloudSyncEnabled; }, [isCloudSyncEnabled]);

  // ---- Crash/kill recovery snapshot --------------------------------------
  //
  // expo-av's in-memory `Audio.Recording` cannot be reattached after the
  // process is killed, so we cannot truly resume an interrupted session.
  // What we can do is detect that the previous session was interrupted and
  // make sure we don't silently leak stale state. The snapshot is written on
  // start/resume and cleared on stop/discard. On mount, an orphan is
  // surfaced (today: warn + clear) before the user starts a new session.
  // See `lib/active-recording-recovery.ts` for the pure decision logic.
  const userIdRef = useRef<string | null>(user?.id ?? null);
  useEffect(() => {
    if (!isAuthLoading) {
      userIdRef.current = user?.id ?? null;
    }
  }, [isAuthLoading, user?.id]);
  const startedAtRef = useRef<number | null>(null);
  useEffect(() => { startedAtRef.current = startedAt; }, [startedAt]);

  const writeRecoverySnapshot = useCallback(
    async (phase: "recording" | "paused") => {
      // Use the session's original start time, not the snapshot write time,
      // so the snapshot age check stays reliable for long recordings (and
      // doesn't reset on every pause/resume).
      const startedAt = startedAtRef.current ?? Date.now();
      const snapshot: ActiveRecordingSnapshot = {
        v: 1,
        startedAt,
        phase,
        userId: userIdRef.current,
      };
      try {
        await AsyncStorage.setItem(
          ACTIVE_RECORDING_SNAPSHOT_KEY,
          serializeSnapshot(snapshot),
        );
      } catch {
        // best-effort: a missing snapshot only loses one-shot interruption
        // detection, never user audio.
      }
    },
    [],
  );

  const clearRecoverySnapshot = useCallback(async () => {
    try {
      await AsyncStorage.removeItem(ACTIVE_RECORDING_SNAPSHOT_KEY);
    } catch {
      // ignore
    }
  }, []);

  // On first mount, detect an interrupted previous session.
  useEffect(() => {
    if (isAuthLoading) return;
    let cancelled = false;
    const checkRecovery = async () => {
      try {
        const raw = await AsyncStorage.getItem(ACTIVE_RECORDING_SNAPSHOT_KEY);
        if (cancelled) return;
        const snapshot = parseSnapshot(raw);
        const decision = decideInterruption(
          snapshot,
          userIdRef.current,
          Date.now(),
        );
        if (decision.interrupted && snapshot) {
          // Surface so the user (or future UI) knows the previous recording
          // was lost. We can't recover the audio itself — expo-av's
          // in-memory recorder doesn't survive process death.
          console.warn(
            "[active-recording] previous session was interrupted at",
            new Date(snapshot.startedAt).toISOString(),
          );
        }
        if (decision.shouldClear) {
          await clearRecoverySnapshot();
        }
      } catch {
        // ignore — recovery is best-effort
      }
    };
    void checkRecovery();
    return () => {
      cancelled = true;
    };
  }, [clearRecoverySnapshot, isAuthLoading, user?.id]);
  // -----------------------------------------------------------------------

  // Pre-warm: request mic permissions + configure audio mode once so that
  // when the user taps record, only Recording.createAsync (~50ms) remains.
  useEffect(() => {
    const prewarm = async () => {
      try {
        const permission = await Audio.requestPermissionsAsync();
        if (!permission.granted) return;
        await Audio.setAudioModeAsync({
          allowsRecordingIOS: true,
          playsInSilentModeIOS: true,
        });
        micReadyRef.current = true;
      } catch {
        // permission errors are surfaced when start() is invoked
      }
    };
    void prewarm();
  }, []);

  // Fetch the user-tier recording cap.
  useEffect(() => {
    if (isAuthLoading) return;
    if (!user?.id) {
      setMaxRecordingSeconds(DEFAULT_MAX_RECORDING_SECONDS);
      return;
    }
    const fetchMaxRecording = async () => {
      try {
        const res = await fetch(new URL("/api/usage", getApiUrl()).toString(), {
          credentials: "include",
          headers: getAuthHeaders(),
        });
        if (res.ok) {
          const data = await res.json();
          if (data.maxRecordingSeconds) {
            setMaxRecordingSeconds(data.maxRecordingSeconds);
          }
        }
      } catch {
        // ignore — keep the default cap
      }
    };
    void fetchMaxRecording();
  }, [isAuthLoading, user?.id]);

  const startMetering = useCallback(() => {
    // Unified metering on both web and mobile: poll the Recording's getStatusAsync.
    // On web, this reads from the Recording's internal GainNode → AnalyserNode pipeline,
    // so sensitivity changes are reflected in the visualizer.
    meterRef.current = setInterval(async () => {
      if (!recordingRef.current) return;
      try {
        const status = await recordingRef.current.getStatusAsync();
        if (status.isRecording && status.metering !== undefined) {
          setMeteringLevel(normalizeMeteringDb(status.metering));
        }
      } catch {
        // ignore — transient status read failures
      }
    }, reduceMotionRef.current ? 200 : 80);
  }, []);

  const stopMetering = useCallback(() => {
    if (meterRef.current) {
      clearInterval(meterRef.current);
      meterRef.current = null;
    }
    setMeteringLevel(0);
  }, []);

  // Build the Android foreground-service notification copy for the current
  // state + elapsed time. Centralized so start/update/pause/resume all use
  // identical wording and tabular formatting.
  const buildNotificationCopy = useCallback(
    (forState: "recording" | "paused", seconds: number): RecordingNotificationCopy => {
      const translate = tRef.current;
      const time = formatDuration(seconds);
      return {
        title: translate("activeRecording.notification.title"),
        body:
          forState === "paused"
            ? translate("activeRecording.notification.bodyPaused", { time })
            : translate("activeRecording.notification.bodyRecording", { time }),
        channelName: translate("activeRecording.notification.channelName"),
      };
    },
    [],
  );

  const clearRecordingTimers = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (autoStopRef.current) {
      clearTimeout(autoStopRef.current);
      autoStopRef.current = null;
    }
  }, []);

  const discard = useCallback(async () => {
    clearRecordingTimers();
    stopMetering();
    void recordingForegroundService.stop();
    void clearRecoverySnapshot();
    const wasActive = stateRef.current === "recording" || stateRef.current === "paused" || stateRef.current === "preparing";
    if (wasActive) {
      setState("discarded");
    }
    const activeRecording = recordingRef.current;
    recordingRef.current = null;
    if (activeRecording) {
      try {
        const status = await activeRecording.getStatusAsync();
        if (status.isRecording || status.isDoneRecording === false) {
          await activeRecording.stopAndUnloadAsync();
        }
      } catch {
        // ignore — recorder may already be released
      }
    }
    try {
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false });
    } catch {
      // ignore
    }
    setDuration(0);
    setStartedAt(null);
    setState("idle");
  }, [clearRecordingTimers, clearRecoverySnapshot, stopMetering]);

  // forward-declare ref so timeout/autoStop can call latest stop closure
  const stopRef = useRef<() => Promise<{ success: boolean }>>(async () => ({ success: false }));

  const stop = useCallback(async (): Promise<{ success: boolean }> => {
    if (!recordingRef.current) return { success: false };

    setState("processing");
    stopMetering();
    clearRecordingTimers();
    void recordingForegroundService.stop();
    void clearRecoverySnapshot();

    try {
      await recordingRef.current.stopAndUnloadAsync();
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false });

      const uri = recordingRef.current.getURI();
      recordingRef.current = null;

      if (!uri) {
        setState("idle");
        setDuration(0);
        setStartedAt(null);
        return { success: false };
      }

      const finalDuration = durationRef.current;
      const recordingId = generateId();
      const now = new Date().toISOString();
      const lang = languageRef.current;
      const title = `${new Date().toLocaleString(lang === "es" ? "es-MX" : "en-US", {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })}`;

      let savedUri = uri;
      let capturedBlob: Blob | undefined;
      let uploadedBucketFileId: string | null = null;
      let nativeUpload: { uploadUrl: string; authToken: string } | null = null;

      if (Platform.OS === "web") {
        try {
          const blobRes = await globalThis.fetch(uri);
          capturedBlob = await blobRes.blob();
          const uploadForm = new FormData();
          uploadForm.append("audio", capturedBlob, "recording.webm");
          const baseUrl = getApiUrl();
          const uploadUrl = new URL("/api/upload-audio", baseUrl);
          const uploadRes = await globalThis.fetch(uploadUrl.toString(), {
            method: "POST",
            body: uploadForm,
            credentials: "include",
            headers: getAuthHeaders(),
          });
          if (uploadRes.ok) {
            const uploadData = await uploadRes.json();
            savedUri = getUploadedAudioUri(uploadData) || savedUri;
            uploadedBucketFileId = typeof uploadData?.bucketFile?.id === "string"
              ? uploadData.bucketFile.id
              : null;
          }
        } catch (uploadErr) {
          console.error("Audio upload failed, using blob URI:", uploadErr);
        }
      } else {
        // Validate the local file now, but enqueue only after the server recording exists.
        try {
          const { FileSystem } = require("react-native-file-access");
          const fileExists = await FileSystem.exists(uri.replace(/^file:\/\//, ""));
          if (fileExists) {
            const baseUrl = getApiUrl();
            const uploadUrl = new URL("/api/upload-audio", baseUrl).toString();
            const headers = getAuthHeaders();
            const authToken = headers["Authorization"]?.replace("Bearer ", "") || "";
            nativeUpload = { uploadUrl, authToken };
          }
        } catch (uploadErr) {
          console.error("Failed to schedule background upload:", uploadErr);
        }
      }

      // Cloud-only transcription: no local preview. Audio uploads and transcribes via Groq.
      const localTranscript = "";

      // Never discard a recording — save locally and retry upload later
      const needsUpload = !uploadedBucketFileId && (Platform.OS === "web" ? savedUri.startsWith("blob:") : true);
      setWebErrorMessage(null);

      const newRecording: Recording = {
        id: recordingId,
        title,
        duration: finalDuration,
        audioUri: savedUri,
        transcript: localTranscript,
        conversions: [],
        createdAt: now,
        isTranscribing: !localTranscript && !needsUpload,
        needsUpload,
        uploadStatus: needsUpload ? "pending" : "uploaded",
        uploadErrorCode: null,
        uploadRetryable: null,
        transcriptionStatus: localTranscript
          ? "succeeded"
          : needsUpload
            ? "idle"
            : "transcribing",
        transcriptionErrorCode: null,
        transcriptionError: null,
        transcriptionRetryable: null,
      };

      try {
        await addRecording(newRecording);

        if (nativeUpload) {
          enqueueBackgroundUpload(
            uri,
            nativeUpload.uploadUrl,
            nativeUpload.authToken,
            recordingId,
            isAutoTranscribeEnabledRef.current,
            lang,
          );
        }

        // Track streak for engagement rewards
        try { void recordCompleted(); } catch {}
      } catch (saveErr) {
        if (uploadedBucketFileId) {
          try {
            const deleteUrl = new URL(`/api/bucket/files/${encodeURIComponent(uploadedBucketFileId)}`, getApiUrl());
            await globalThis.fetch(deleteUrl.toString(), {
              method: "DELETE",
              credentials: "include",
              headers: getAuthHeaders(),
            });
          } catch (cleanupErr) {
            console.warn("Uploaded audio cleanup failed after recording save rejection:", cleanupErr);
          }
        }
        throw saveErr;
      }

      if (isAutoTranscribeEnabledRef.current) {
        if (Platform.OS === "web" || !needsUpload) {
          void transcribeAudio(recordingId, savedUri, lang, capturedBlob);
        }
      } else {
        void updateRecording(recordingId, { isTranscribing: false });
      }

      setDuration(0);
      setStartedAt(null);
      setCompletedRecordingId(recordingId);
      setState("completed");
      setCompletionVersion(recordingId);
      // Auto-dismiss completed state after 10 seconds
      setTimeout(() => {
        setState("idle");
        setCompletedRecordingId(null);
      }, 10000);
      return { success: true };
    } catch (err) {
      console.error("Failed to stop recording:", err);
      // Never strand the user on a zombie record screen: reset the full UI
      // state and surface WHY the save failed on the record screen's error
      // banner. Recording-limit hits are the common case (free tier = 3) —
      // the recording cannot be saved, and the user must delete or upgrade.
      setState("idle");
      setDuration(0);
      setStartedAt(null);
      const rawMessage = err instanceof Error ? err.message : String(err);
      setWebErrorMessage(
        /recording limit|limit reached|maximum number of recordings/i.test(rawMessage)
          ? tRef.current("home.recordingLimitToast")
          : tRef.current("record.saveFailed"),
      );
      return { success: false };
    }
  }, [addRecording, clearRecordingTimers, clearRecoverySnapshot, stopMetering, transcribeAudio, updateRecording]);

  useEffect(() => { stopRef.current = stop; }, [stop]);

  const start = useCallback(async () => {
    try {
      setWebErrorMessage(null);
      if (!micReadyRef.current) {
        setState("preparing");
        const permission = await Audio.requestPermissionsAsync();
        if (!permission.granted) {
          setState("idle");
          return;
        }
        micReadyRef.current = true;
      }

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
        staysActiveInBackground: true,
      });

      setState("recording");
      setDuration(0);
      setStartedAt(Date.now());

      const recordingOptions = {
        ...Audio.RecordingOptionsPresets.HIGH_QUALITY,
        isMeteringEnabled: true,
      };
      const { recording } = await Audio.Recording.createAsync(recordingOptions, audioDeviceIdRef.current);

      recordingRef.current = recording;
      startMetering();

      // Android-only foreground service. The shim is a no-op on web/iOS.
      void recordingForegroundService.start(buildNotificationCopy("recording", 0));
      void writeRecoverySnapshot("recording");

      timerRef.current = setInterval(() => {
        setDuration((prev) => {
          const next = prev + 1;
          // Keep the ongoing notification's elapsed time in sync. No-op on
          // platforms without the native module.
          void recordingForegroundService.update(
            buildNotificationCopy(
              stateRef.current === "paused" ? "paused" : "recording",
              next,
            ),
          );
          return next;
        });
      }, 1000);

      autoStopRef.current = setTimeout(() => {
        void stopRef.current();
      }, maxRecordingSecondsRef.current * 1000);
    } catch (err) {
      console.error("Failed to start recording:", err);
      void recordingForegroundService.stop();
      void clearRecoverySnapshot();
      setState("idle");
      setStartedAt(null);
    }
  }, [startMetering, buildNotificationCopy, clearRecoverySnapshot, writeRecoverySnapshot]);

  const pause = useCallback(async () => {
    if (!recordingRef.current || stateRef.current !== "recording") return;
    try {
      await recordingRef.current.pauseAsync();
      setState("paused");
      stopMetering();
      clearRecordingTimers();
      void recordingForegroundService.update(
        buildNotificationCopy("paused", durationRef.current),
      );
      void writeRecoverySnapshot("paused");
    } catch (err) {
      console.error("Failed to pause recording:", err);
    }
  }, [clearRecordingTimers, stopMetering, buildNotificationCopy, writeRecoverySnapshot]);

  const resume = useCallback(async () => {
    if (!recordingRef.current || stateRef.current !== "paused") return;
    try {
      await recordingRef.current.resumeAsync();
      setState("recording");
      startMetering();
      void recordingForegroundService.update(
        buildNotificationCopy("recording", durationRef.current),
      );
      void writeRecoverySnapshot("recording");
      timerRef.current = setInterval(() => {
        setDuration((prev) => {
          const next = prev + 1;
          void recordingForegroundService.update(
            buildNotificationCopy(
              stateRef.current === "paused" ? "paused" : "recording",
              next,
            ),
          );
          return next;
        });
      }, 1000);
      const remainingMs = Math.max(0, maxRecordingSecondsRef.current - durationRef.current) * 1000;
      autoStopRef.current = setTimeout(() => {
        void stopRef.current();
      }, remainingMs);
    } catch (err) {
      console.error("Failed to resume recording:", err);
    }
  }, [startMetering, buildNotificationCopy, writeRecoverySnapshot]);

  const clearWebError = useCallback(() => setWebErrorMessage(null), []);

  // Sign-out / user switch: discard any active recording so it cannot bleed
  // across accounts. We key on user?.id; null -> signed-out is included.
  const lastUserIdRef = useRef<string | null | undefined>(user?.id);
  useEffect(() => {
    if (isAuthLoading) return;
    const nextUserId = user?.id ?? null;
    if (lastUserIdRef.current === undefined) {
      lastUserIdRef.current = nextUserId;
      return;
    }
    if (lastUserIdRef.current !== nextUserId) {
      const wasActive = stateRef.current !== "idle";
      lastUserIdRef.current = nextUserId;
      if (wasActive) {
        void discard();
      }
    }
  }, [isAuthLoading, user?.id, discard]);

  // Provider-level teardown (e.g. full app unmount). Always release.
  useEffect(() => {
    return () => {
      clearRecordingTimers();
      stopMetering();
      void recordingForegroundService.stop();
      const activeRecording = recordingRef.current;
      recordingRef.current = null;
      if (activeRecording) {
        activeRecording.stopAndUnloadAsync().catch(() => {});
      }
    };
  }, [clearRecordingTimers, stopMetering]);

  const notifyScreenUnmounted = useCallback(() => {
    // Feature-flag gate. When `persistentRecording` is OFF we mirror the legacy
    // semantics of app/record.tsx — discard on screen unmount — so mobile
    // behavior stays byte-identical to today. When ON (web today), we keep
    // the session alive so the user can navigate freely and reattach later.
    if (featureFlags.persistentRecording) return;
    if (stateRef.current === "idle") return;
    void discard();
  }, [discard]);

  const value = useMemo<ActiveRecordingValue>(() => ({
    state,
    duration,
    meteringLevel,
    startedAt,
    maxRecordingSeconds,
    webErrorMessage,
    completionVersion,
    completedRecordingId,
    start,
    pause,
    resume,
    stop,
    discard,
    clearWebError,
    notifyScreenUnmounted,
  }), [
    state,
    duration,
    meteringLevel,
    startedAt,
    maxRecordingSeconds,
    webErrorMessage,
    completionVersion,
      completedRecordingId,
    start,
    pause,
    resume,
    stop,
    discard,
    clearWebError,
    notifyScreenUnmounted,
  ]);

  return (
    <ActiveRecordingContext.Provider value={value}>
      {children}
    </ActiveRecordingContext.Provider>
  );
}

export function useActiveRecording(): ActiveRecordingValue {
  const ctx = useContext(ActiveRecordingContext);
  if (!ctx) {
    throw new Error("useActiveRecording must be used within an ActiveRecordingProvider");
  }
  return ctx;
}
