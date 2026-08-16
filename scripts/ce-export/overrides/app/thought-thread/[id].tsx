import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Feather from "@react-native-vector-icons/feather/static";
import { useQuery } from "@tanstack/react-query";
import Colors from "@/constants/colors";
import { router, useLocalSearchParams } from "@/lib/navigation";
import { useRecordings } from "@/lib/recordings-context";
import { authFetch, getApiUrl } from "@/lib/query-client";
import { createUtf8Decoder } from "@/lib/utf8";
import { useResponsiveLayout } from "@/lib/useResponsiveLayout";
import { useTextScale } from "@/lib/typography";
import { useLanguage } from "@/lib/i18n";
import {
  CONVERSION_TYPES,
  CITATION_STYLES,
  TIER_CONVERSION_TYPES,
  formatDuration,
  normalizeSubscriptionTier,
  type SubscriptionTier,
} from "@/lib/utils";
import {
  addRecordingToThoughtThread,
  getPendingThoughtThreadAttachments,
  removePendingThoughtThreadAttachment,
  thoughtThreadRequest,
  ThoughtThreadRequestError,
  type ThoughtThreadDetail,
} from "@/lib/thought-threads";
import type { SelfServiceModuleState } from "@shared/self-service-modules";

type PreparedRun = {
  run: ThoughtThreadDetail["runs"][number];
  directTokenLimit: number;
  threadVersion: number;
  reused: boolean;
  requiresRetry?: boolean;
};

type ConversionPlan = {
  estimatedTokens: number;
  directTokenLimit: number;
  absoluteTokenLimit: number;
  strategy: "direct" | "hierarchical" | "blocked";
  model: string;
  sourceRecordingCount: number;
  contextCount: number;
};

type ContextRelationship = "continues" | "clarifies" | "supersedes" | "conflicts" | "supports";
const CONTEXT_RELATIONSHIPS: ContextRelationship[] = [
  "continues",
  "clarifies",
  "supersedes",
  "conflicts",
  "supports",
];

const CUSTOM_PROMPTS_KEY = "@voicenote_custom_prompts";

const FILE_TYPES = [
  "text/plain",
  "text/markdown",
  "text/csv",
  "image/png",
  "image/jpeg",
  "image/webp",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
];

function messageFor(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export default function ThoughtThreadDetailScreen() {
  const { id, attachmentError } = useLocalSearchParams<{ id: string; attachmentError?: string }>();
  const insets = useSafeAreaInsets();
  const layout = useResponsiveLayout();
  const ts = useTextScale();
  const { t, language } = useLanguage();
  const { recordings, getRecording, isCloudSyncEnabled } = useRecordings();
  const [detail, setDetail] = useState<ThoughtThreadDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [titleDraft, setTitleDraft] = useState("");
  const [newContext, setNewContext] = useState("");
  const [contextDrafts, setContextDrafts] = useState<Record<string, string>>({});
  const [relationshipDrafts, setRelationshipDrafts] = useState<Record<string, {
    relationship: ContextRelationship | null;
    relatedSourceId: string | null;
  }>>({});
  const [showAddExisting, setShowAddExisting] = useState(false);
  const [recordingSearch, setRecordingSearch] = useState("");
  const [selectedType, setSelectedType] = useState("summary");
  const [conversionStage, setConversionStage] = useState("");
  const [conversionPlan, setConversionPlan] = useState<ConversionPlan | null>(null);
  const [lastFile, setLastFile] = useState<{ id: string; name: string } | null>(null);
  const [citationStyle, setCitationStyle] = useState("apa7");
  const [bibliographyType, setBibliographyType] = useState<"standard" | "annotated">("standard");
  const [outputFormat, setOutputFormat] = useState<"markdown" | "plaintext">("markdown");
  const [clarifyEnabled, setClarifyEnabled] = useState(true);
  const [pendingPrepared, setPendingPrepared] = useState<PreparedRun | null>(null);
  const [clarifyQuestion, setClarifyQuestion] = useState("");
  const [clarifyOptions, setClarifyOptions] = useState<string[]>([]);
  const [clarifyAnswer, setClarifyAnswer] = useState("");
  const titleDirtyRef = useRef(false);
  const dirtyContextIdsRef = useRef(new Set<string>());
  const detailThreadId = detail?.thread.id;
  const detailThreadVersion = detail?.thread.version;
  const { data: subscription } = useQuery<{ tier?: string }>({
    queryKey: ["/api/stripe/subscription"],
  });
  const { data: moduleData } = useQuery<{ modules?: SelfServiceModuleState[] }>({
    queryKey: ["/api/modules/self"],
  });
  const enabledModules = useMemo(
    () => new Set((moduleData?.modules || [])
      .filter((module) => module.effectiveEnabled)
      .map((module) => module.moduleName)),
    [moduleData?.modules],
  );
  const tier: SubscriptionTier = normalizeSubscriptionTier(subscription?.tier);
  const availableTypes = useMemo(
    () => CONVERSION_TYPES.filter((type) =>
      TIER_CONVERSION_TYPES[tier]?.includes(type.value)
      || (!!type.module && enabledModules.has(type.module))),
    [enabledModules, tier],
  );

  useEffect(() => {
    if (availableTypes.length > 0 && !availableTypes.some((type) => type.value === selectedType)) {
      setSelectedType(availableTypes[0].value);
    }
  }, [availableTypes, selectedType]);

  const applyDetail = useCallback((next: ThoughtThreadDetail) => {
    setDetail(next);
    setTitleDraft((current) => titleDirtyRef.current ? current : next.thread.title);
    setContextDrafts((current) => Object.fromEntries(next.contexts.map((context) => [
      context.id,
      dirtyContextIdsRef.current.has(context.id)
        ? current[context.id] ?? context.text
        : context.text,
    ])));
    setRelationshipDrafts(Object.fromEntries(next.contexts.map((context) => [
      context.id,
      {
        relationship: context.relationship || null,
        relatedSourceId: context.relatedSourceId || null,
      },
    ])));
  }, []);

  const load = useCallback(async () => {
    if (!id) {
      setLoading(false);
      setError("Could not find this Thought Thread.");
      return;
    }
    setError("");
    try {
      applyDetail(await thoughtThreadRequest<ThoughtThreadDetail>(
        `/api/thought-threads/${encodeURIComponent(id)}`,
      ));
    } catch (loadError) {
      setError(messageFor(loadError, "Could not load this Thought Thread."));
    } finally {
      setLoading(false);
    }
  }, [applyDetail, id]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!detailThreadId) return;
    let cancelled = false;
    thoughtThreadRequest<ConversionPlan>(
      `/api/thought-threads/${encodeURIComponent(detailThreadId)}/conversion-plan`,
      { method: "POST", body: JSON.stringify({ conversionType: selectedType }) },
    ).then((plan) => {
      if (!cancelled) setConversionPlan(plan);
    }).catch(() => {
      if (!cancelled) setConversionPlan(null);
    });
    return () => {
      cancelled = true;
    };
  }, [detailThreadId, detailThreadVersion, selectedType]);

  // Recover a recording that was saved successfully but could not be attached
  // during recorder navigation.
  useEffect(() => {
    const threadVersion = detail?.thread.version;
    if (!id || threadVersion === undefined) return;
    getPendingThoughtThreadAttachments(id).then(async (pending) => {
      let nextVersion = threadVersion;
      for (const entry of pending) {
        if (detail?.items.some((item) => item.recordingId === entry.recordingId)) {
          await removePendingThoughtThreadAttachment(entry.id);
          continue;
        }
        try {
          const next = await addRecordingToThoughtThread(id, entry.recordingId, nextVersion);
          nextVersion = next.thread.version;
          await removePendingThoughtThreadAttachment(entry.id);
          applyDetail(next);
          setError("");
        } catch (attachFailure) {
          setError(`Your recording was saved, but still needs to be attached. ${messageFor(attachFailure, "")}`.trim());
          break;
        }
      }
    });
  }, [applyDetail, attachmentError, detail?.items, detail?.thread.version, id]);

  const orderedItems = useMemo(() => {
    if (!detail) return [];
    const current = detail.items.map((item) => ({
      ...item,
      recording: getRecording(item.recordingId) || item.recording,
    }));
    return detail.thread.orderingMode === "manual"
      ? current.sort((a, b) => a.position - b.position || a.id.localeCompare(b.id))
      : current.sort((a, b) =>
          new Date(a.recording?.createdAt || a.sourceCreatedAt).getTime()
          - new Date(b.recording?.createdAt || b.sourceCreatedAt).getTime()
          || a.recordingId.localeCompare(b.recordingId));
  }, [detail, getRecording]);

  const availableRecordings = useMemo(() => {
    const memberIds = new Set(detail?.items.map((item) => item.recordingId) || []);
    const query = recordingSearch.trim().toLowerCase();
    return recordings
      .filter((recording) => !memberIds.has(recording.id))
      .filter((recording) => !query
        || recording.title.toLowerCase().includes(query)
        || recording.transcript.toLowerCase().includes(query))
      .slice(0, 30);
  }, [detail?.items, recordingSearch, recordings]);

  const updateThread = async (updates: Record<string, unknown>) => {
    if (!detail) return false;
    setBusy("thread");
    setError("");
    try {
      applyDetail(await thoughtThreadRequest<ThoughtThreadDetail>(
        `/api/thought-threads/${encodeURIComponent(detail.thread.id)}`,
        {
          method: "PATCH",
          body: JSON.stringify({ ...updates, expectedVersion: detail.thread.version }),
        },
      ));
      return true;
    } catch (updateError) {
      setError(messageFor(updateError, "Could not update this Thought Thread."));
      return false;
    } finally {
      setBusy("");
    }
  };

  const saveTitle = async () => {
    if (!detail) return;
    const title = titleDraft.trim();
    if (title && title !== detail.thread.title) {
      titleDirtyRef.current = false;
      if (!await updateThread({ title })) titleDirtyRef.current = true;
    }
  };

  const updateItem = async (itemId: string, included: boolean) => {
    if (!detail) return;
    setBusy(itemId);
    try {
      applyDetail(await thoughtThreadRequest<ThoughtThreadDetail>(
        `/api/thought-threads/${encodeURIComponent(detail.thread.id)}/items/${encodeURIComponent(itemId)}`,
        { method: "PATCH", body: JSON.stringify({ included }) },
      ));
    } catch (itemError) {
      setError(messageFor(itemError, "Could not update that source."));
    } finally {
      setBusy("");
    }
  };

  const removeItem = async (itemId: string) => {
    if (!detail) return;
    setBusy(itemId);
    try {
      applyDetail(await thoughtThreadRequest<ThoughtThreadDetail>(
        `/api/thought-threads/${encodeURIComponent(detail.thread.id)}/items/${encodeURIComponent(itemId)}`,
        { method: "DELETE" },
      ));
    } catch (itemError) {
      setError(messageFor(itemError, "Could not remove that source."));
    } finally {
      setBusy("");
    }
  };

  const moveItem = async (index: number, direction: -1 | 1) => {
    if (!detail) return;
    const target = index + direction;
    if (target < 0 || target >= orderedItems.length) return;
    const reordered = [...orderedItems];
    [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
    setBusy("reorder");
    try {
      applyDetail(await thoughtThreadRequest<ThoughtThreadDetail>(
        `/api/thought-threads/${encodeURIComponent(detail.thread.id)}/reorder`,
        {
          method: "POST",
          body: JSON.stringify({
            itemIds: reordered.map((item) => item.id),
            expectedVersion: detail.thread.version,
          }),
        },
      ));
    } catch (reorderError) {
      setError(messageFor(reorderError, "Could not reorder this Thought Thread."));
    } finally {
      setBusy("");
    }
  };

  const resetChronology = async () => {
    if (!detail) return;
    setBusy("reorder");
    try {
      applyDetail(await thoughtThreadRequest<ThoughtThreadDetail>(
        `/api/thought-threads/${encodeURIComponent(detail.thread.id)}/reset-chronology`,
        { method: "POST", body: JSON.stringify({}) },
      ));
    } catch (resetError) {
      setError(messageFor(resetError, "Could not restore chronological order."));
    } finally {
      setBusy("");
    }
  };

  const addExisting = async (recordingId: string) => {
    if (!detail) return;
    setBusy(recordingId);
    try {
      applyDetail(await addRecordingToThoughtThread(
        detail.thread.id,
        recordingId,
        detail.thread.version,
      ));
    } catch (addError) {
      setError(messageFor(addError, "Could not add that recording."));
    } finally {
      setBusy("");
    }
  };

  const addTextContext = async () => {
    if (!detail || !newContext.trim()) return;
    setBusy("context");
    try {
      applyDetail(await thoughtThreadRequest<ThoughtThreadDetail>(
        `/api/thought-threads/${encodeURIComponent(detail.thread.id)}/contexts`,
        {
          method: "POST",
          body: JSON.stringify({
            kind: "text",
            label: t("thread.addedContext"),
            text: newContext.trim(),
          }),
        },
      ));
      setNewContext("");
    } catch (contextError) {
      setError(messageFor(contextError, "Could not add that context."));
    } finally {
      setBusy("");
    }
  };

  const saveContext = async (contextId: string) => {
    if (!detail) return;
    const text = contextDrafts[contextId]?.trim();
    if (!text) return;
    setBusy(contextId);
    try {
      const next = await thoughtThreadRequest<ThoughtThreadDetail>(
        `/api/thought-threads/${encodeURIComponent(detail.thread.id)}/contexts/${encodeURIComponent(contextId)}`,
        { method: "PATCH", body: JSON.stringify({ text }) },
      );
      dirtyContextIdsRef.current.delete(contextId);
      applyDetail(next);
    } catch (contextError) {
      dirtyContextIdsRef.current.add(contextId);
      setError(messageFor(contextError, "Could not save that context."));
    } finally {
      setBusy("");
    }
  };

  const saveContextRelationship = async (contextId: string, clear = false) => {
    if (!detail) return;
    const draft = relationshipDrafts[contextId];
    if (!clear && (!draft?.relationship || !draft.relatedSourceId)) return;
    setBusy(`relationship:${contextId}`);
    try {
      applyDetail(await thoughtThreadRequest<ThoughtThreadDetail>(
        `/api/thought-threads/${encodeURIComponent(detail.thread.id)}/contexts/${encodeURIComponent(contextId)}`,
        {
          method: "PATCH",
          body: JSON.stringify(clear
            ? { relationship: null, relatedSourceId: null }
            : draft),
        },
      ));
    } catch (contextError) {
      setError(messageFor(contextError, t("thread.relationshipSaveFailed")));
    } finally {
      setBusy("");
    }
  };

  const removeContext = (contextId: string, label: string) => {
    if (!detail) return;
    const perform = async () => {
      setBusy(contextId);
      try {
        applyDetail(await thoughtThreadRequest<ThoughtThreadDetail>(
          `/api/thought-threads/${encodeURIComponent(detail.thread.id)}/contexts/${encodeURIComponent(contextId)}`,
          { method: "DELETE" },
        ));
      } catch (contextError) {
        setError(messageFor(contextError, "Could not remove that context."));
      } finally {
        setBusy("");
      }
    };
    if (Platform.OS === "web") {
      if (confirm(t("thread.removeContextQuestion", { name: label }))) void perform();
      return;
    }
    Alert.alert(
      t("thread.removeContextTitle"),
      t("thread.removeContextQuestion", { name: label }),
      [
        { text: t("common.cancel"), style: "cancel" },
        { text: t("common.delete"), style: "destructive", onPress: () => void perform() },
      ],
    );
  };

  const importFile = async () => {
    if (!detail) return;
    setBusy("file");
    try {
      const picker = await import("@/lib/document-picker");
      const result = await picker.getDocumentAsync({
        type: FILE_TYPES,
        copyToCacheDirectory: true,
      });
      const asset = result.assets?.[0];
      if (result.canceled || !asset) return;

      const formData = new FormData();
      if (Platform.OS === "web") {
        const response = await globalThis.fetch(asset.uri);
        const blob = await response.blob();
        formData.append("file", blob, asset.name);
        if (asset.uri.startsWith("blob:")) URL.revokeObjectURL(asset.uri);
      } else {
        formData.append("file", {
          uri: asset.uri,
          name: asset.name,
          type: asset.mimeType || "application/octet-stream",
        } as any);
      }
      const fileResponse = await authFetch(new URL(
        `/api/thought-threads/${encodeURIComponent(detail.thread.id)}/contexts/file`,
        getApiUrl(),
      ).toString(), {
        method: "POST",
        body: formData,
      });
      const next = await fileResponse.json().catch(() => ({}));
      if (!fileResponse.ok) {
        if (next.error === "file_type_locked") {
          throw new Error(t("thread.fileTypeLocked", {
            type: String(next.ext || "").toUpperCase(),
            tier: String(next.requiredTier || "Base"),
          }));
        }
        if (next.error === "file_too_large") {
          throw new Error(t("thread.fileTooLarge"));
        }
        throw new Error(next.error || "Could not retain and read that file.");
      }
      applyDetail(next as ThoughtThreadDetail);
    } catch (fileError) {
      setError(messageFor(fileError, "Could not add that file."));
    } finally {
      setBusy("");
    }
  };

  const streamConversion = async (
    run: PreparedRun["run"],
  ): Promise<{ output: string; file: { id: string; name: string } }> => {
    const response = await authFetch(new URL("/api/convert", getApiUrl()).toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sourceThoughtThreadId: detail?.thread.id,
        sourceThoughtThreadRunId: run.id,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      }),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || `Conversion failed (${response.status})`);
    }
    let reader = (response as any).body?.getReader?.();
    if (!reader) {
      // RN native sometimes delivers responses without a readable body —
      // the SSE payload is still fully present, so read it as text and feed
      // it through the same event loop below.
      const payload = await response.text().catch(() => "");
      if (!payload.trim()) throw new Error("The conversion stream was unavailable.");
      let consumed = false;
      const encoder = new TextEncoder();
      reader = {
        read: async () => {
          if (consumed) return { done: true, value: undefined };
          consumed = true;
          return { done: false, value: encoder.encode(payload) };
        },
        cancel: async () => {},
      } as any;
    }
    const decoder = createUtf8Decoder();
    let buffer = "";
    let output = "";
    let savedFile: { id: string; name: string } | null = null;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        let event: any;
        try {
          event = JSON.parse(line.slice(6));
        } catch {
          continue;
        }
        if (event.error) throw new Error(event.error);
        if (event.content) output += event.content;
        if (event.done && event.fullContent) output = event.fullContent;
        if (event.done && event.file?.id && event.file?.name) savedFile = event.file;
      }
    }
    if (!output.trim()) throw new Error("The conversion returned no content.");
    if (!savedFile) throw new Error("The conversion completed but its saved file was unavailable.");
    return { output, file: savedFile };
  };

  const waitForPreparedRun = async (prepared: PreparedRun): Promise<PreparedRun> => {
    const deadline = Date.now() + 30 * 60 * 1000;
    let current = prepared.run;
    while (current.status === "preparing") {
      if (Date.now() >= deadline) {
        throw new Error(t("thread.preparationStillRunning"));
      }
      const completed = current.progressCompleted || 0;
      const total = current.progressTotal || 0;
      setConversionStage(
        total > 0
          ? t("thread.preparationProgress", { completed, total })
          : t("thread.stageHierarchical"),
      );
      await new Promise((resolve) => setTimeout(resolve, 2000));
      const response = await thoughtThreadRequest<{ run: PreparedRun["run"] }>(
        `/api/thought-threads/${encodeURIComponent(detail!.thread.id)}/runs/${encodeURIComponent(current.id)}`,
      );
      current = response.run;
    }
    if (current.status !== "prepared") {
      throw new Error(
        current.error
        || (current.status === "cancelled"
          ? t("thread.runCancelled")
          : t("thread.preparationFailed")),
      );
    }
    return { ...prepared, run: current };
  };

  const finishPreparedConversion = async (prepared: PreparedRun) => {
    setConversionStage(
      prepared.run.modelStrategy === "hierarchical"
        ? t("thread.stageHierarchical")
        : t("thread.stageDirect"),
    );
    const result = await streamConversion(prepared.run);
    setLastFile(result.file);
    setPendingPrepared(null);
    setClarifyQuestion("");
    setClarifyOptions([]);
    setClarifyAnswer("");
    setConversionStage("");
    await load();
  };

  const convert = async (confirmExtendedAccess = false) => {
    if (!detail || busy) return;
    let prepared: PreparedRun | null = null;
    let retryWithExtendedAccess = false;
    setBusy("convert");
    setError("");
    setLastFile(null);
    try {
      let customPrompt: string | undefined;
      try {
        const stored = await AsyncStorage.getItem(CUSTOM_PROMPTS_KEY);
        if (stored) customPrompt = JSON.parse(stored)?.[selectedType] || undefined;
      } catch {}
      setConversionStage(t("thread.stageFreeze"));
      prepared = await thoughtThreadRequest<PreparedRun>(
        `/api/thought-threads/${encodeURIComponent(detail.thread.id)}/prepare-conversion`,
        {
          method: "POST",
          body: JSON.stringify({
            conversionType: selectedType,
            outputFormat,
            ...(language !== "en" ? { language } : {}),
            ...(customPrompt ? { customPrompt } : {}),
            ...(["academic_research", "bibliography"].includes(selectedType)
              ? { citationStyle }
              : {}),
            ...(selectedType === "bibliography" ? { bibliographyType } : {}),
            ...(confirmExtendedAccess ? { confirmExtendedAccess: true } : {}),
          }),
        },
      );
      setDetail((current) => current ? {
        ...current,
        thread: {
          ...current.thread,
          version: prepared!.threadVersion,
          runCount: prepared!.reused
            ? current.thread.runCount
            : (current.thread.runCount || 0) + 1,
        },
      } : current);
      if (prepared.requiresRetry || prepared.run.status === "failed") {
        const retryResponse = await thoughtThreadRequest<{ run: PreparedRun["run"] }>(
          `/api/thought-threads/${encodeURIComponent(detail.thread.id)}/runs/${encodeURIComponent(prepared.run.id)}/retry`,
          {
            method: "POST",
            body: JSON.stringify(confirmExtendedAccess ? { confirmExtendedAccess: true } : {}),
          },
        );
        prepared = { ...prepared, run: retryResponse.run, requiresRetry: false };
      }
      if (prepared.run.status === "preparing") {
        setPendingPrepared(prepared);
        prepared = await waitForPreparedRun(prepared);
        setPendingPrepared(prepared);
      }
      if (clarifyEnabled) {
        setConversionStage(t("thread.stageClarify"));
        const clarification = await thoughtThreadRequest<{
          hasQuestions?: boolean;
          question?: string;
          options?: string[];
        }>("/api/convert/clarify", {
          method: "POST",
          body: JSON.stringify({
            sourceThoughtThreadId: detail.thread.id,
            sourceThoughtThreadRunId: prepared.run.id,
          }),
        });
        if (clarification.hasQuestions && clarification.question) {
          setPendingPrepared(prepared);
          setClarifyQuestion(clarification.question);
          setClarifyOptions(clarification.options || []);
          setClarifyAnswer("");
          setConversionStage("");
          return;
        }
      }
      await finishPreparedConversion(prepared);
    } catch (conversionError) {
      if (conversionError instanceof ThoughtThreadRequestError && conversionError.status === 402) {
        setConversionStage("");
        if (Platform.OS === "web") {
          retryWithExtendedAccess = confirm(
            `${t("thread.overageTitle")}\n\n${t("thread.overageHelp")}`,
          );
        } else {
          Alert.alert(
            t("thread.overageTitle"),
            t("thread.overageHelp"),
            [
              { text: t("common.cancel"), style: "cancel" },
              {
                text: t("thread.overageContinue"),
                onPress: () => void convert(true),
              },
            ],
          );
        }
      } else {
        const failure = messageFor(conversionError, "Could not convert this Thought Thread.");
        setError(failure);
        setConversionStage("");
      }
    } finally {
      setBusy("");
    }
    if (retryWithExtendedAccess) void convert(true);
  };

  const resumeExistingRun = async (run: PreparedRun["run"]) => {
    if (!detail || busy) return;
    setBusy("convert");
    setError("");
    try {
      let prepared: PreparedRun = {
        run,
        directTokenLimit: run.directTokenLimit || conversionPlan?.directTokenLimit || 0,
        threadVersion: detail.thread.version,
        reused: true,
      };
      if (run.status === "preparing") prepared = await waitForPreparedRun(prepared);
      if (prepared.run.status !== "prepared") {
        throw new Error(t("thread.runNotReady"));
      }
      setPendingPrepared(prepared);
      await finishPreparedConversion(prepared);
    } catch (resumeError) {
      setError(messageFor(resumeError, t("thread.resumeFailed")));
      setConversionStage("");
    } finally {
      setBusy("");
    }
  };

  const retryExistingRun = async (run: PreparedRun["run"]) => {
    if (!detail || busy) return;
    setBusy("convert");
    setError("");
    try {
      const response = await thoughtThreadRequest<{ run: PreparedRun["run"] }>(
        `/api/thought-threads/${encodeURIComponent(detail.thread.id)}/runs/${encodeURIComponent(run.id)}/retry`,
        { method: "POST", body: JSON.stringify({}) },
      );
      setBusy("");
      await resumeExistingRun(response.run);
    } catch (retryError) {
      setError(messageFor(retryError, t("thread.retryRunFailed")));
    } finally {
      setBusy("");
    }
  };

  const cancelExistingRun = async (run: PreparedRun["run"]) => {
    if (!detail || busy) return;
    setBusy(run.id);
    setError("");
    try {
      await thoughtThreadRequest(
        `/api/thought-threads/${encodeURIComponent(detail.thread.id)}/runs/${encodeURIComponent(run.id)}/cancel`,
        { method: "POST", body: JSON.stringify({}) },
      );
      if (pendingPrepared?.run.id === run.id) setPendingPrepared(null);
      await load();
    } catch (cancelError) {
      setError(messageFor(cancelError, t("thread.cancelRunFailed")));
    } finally {
      setBusy("");
    }
  };

  const continueAfterClarification = async (skip = false) => {
    if (!detail || !pendingPrepared || busy) return;
    const answer = clarifyAnswer.trim();
    if (!skip && !answer) return;
    setBusy("convert");
    setError("");
    try {
      if (!skip) {
        await thoughtThreadRequest(
          `/api/thought-threads/${encodeURIComponent(detail.thread.id)}/runs/${encodeURIComponent(pendingPrepared.run.id)}/clarification`,
          {
            method: "PATCH",
            body: JSON.stringify({ question: clarifyQuestion, answer }),
          },
        );
      }
      await finishPreparedConversion(pendingPrepared);
    } catch (conversionError) {
      setError(messageFor(conversionError, "Could not continue this Thought Thread conversion."));
      setConversionStage("");
    } finally {
      setBusy("");
    }
  };

  const deleteThread = () => {
    if (!detail) return;
    const perform = async () => {
      setBusy("delete");
      try {
        await thoughtThreadRequest(
          `/api/thought-threads/${encodeURIComponent(detail.thread.id)}`,
          { method: "DELETE" },
        );
        router.replace("/thought-threads" as any);
      } catch (deleteError) {
        setError(messageFor(deleteError, "Could not delete this Thought Thread."));
        setBusy("");
      }
    };
    if (Platform.OS === "web") {
      if (confirm(`${t("thread.deleteQuestion")}\n\n${t("thread.deleteHelp")}`)) void perform();
    } else {
      Alert.alert(
        t("thread.deleteQuestion"),
        t("thread.deleteHelp"),
        [
          { text: t("common.cancel"), style: "cancel" },
          { text: t("common.delete"), style: "destructive", onPress: () => void perform() },
        ],
      );
    }
  };

  if (loading) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator size="large" color={Colors.primary} />
        <Text style={[styles.muted, { fontSize: ts.body2 }]}>{t("thread.loading")}</Text>
      </View>
    );
  }

  if (!detail) {
    return (
      <View style={[styles.container, styles.center]}>
        <Feather name="alert-circle" size={32} color={Colors.error} />
        <Text style={[styles.errorText, { fontSize: ts.body }]}>{error || t("thread.notFound")}</Text>
        <Pressable onPress={load} style={styles.secondaryButton}><Text style={styles.secondaryText}>{t("thread.retry")}</Text></Pressable>
      </View>
    );
  }

  const summary = detail.sourceSummary;
  const estimatedStrategy = conversionPlan?.strategy === "hierarchical"
    ? t("thread.strategyHierarchical", { model: conversionPlan.model })
    : conversionPlan?.strategy === "blocked"
      ? t("thread.strategyBlocked", { count: conversionPlan.absoluteTokenLimit.toLocaleString() })
      : conversionPlan?.strategy === "direct"
        ? t("thread.strategyDirect", { model: conversionPlan.model })
        : t("thread.strategyChecking");

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={[styles.header, { paddingHorizontal: layout.contentPadding }]}>
        <Pressable
          onPress={() => router.canGoBack() ? router.back() : router.replace("/thought-threads" as any)}
          style={styles.iconButton}
          accessibilityRole="button"
          accessibilityLabel={t("common.back")}
        >
          <Feather name="arrow-left" size={22} color={Colors.text} />
        </Pressable>
        <View style={styles.headerTitle}>
          <Feather name="git-branch" size={18} color={Colors.primary} />

        </View>
        {!isCloudSyncEnabled ? (
          <View style={styles.iconButton} />
        ) : (
          <Pressable
            onPress={deleteThread}
            style={styles.iconButton}
            accessibilityRole="button"
            accessibilityLabel={t("thread.delete")}
          >
            <Feather name="trash-2" size={19} color={Colors.error} />
          </Pressable>
        )}
      </View>

      {!isCloudSyncEnabled ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 32, gap: 16 }}>
          <Feather name="cloud-off" size={40} color={Colors.textMuted} />
          <Text style={[{ color: Colors.text, fontFamily: "Inter_700Bold", textAlign: "center" }, { fontSize: ts.heading3 }]}>{t("thread.requiresCloudSync" as any)}</Text>
          <Text style={[{ color: Colors.textSecondary, textAlign: "center", lineHeight: 22 }, { fontSize: ts.body2 }]}>{t("thread.requiresCloudSyncHelp" as any)}</Text>
          <Pressable
            onPress={() => router.push("/settings/integrations" as any)}
            style={[styles.primaryButton]}
          >
            <Feather name="settings" size={18} color="#fff" />
            <Text style={[{ color: "#fff", fontFamily: "Inter_700Bold" }, { fontSize: ts.body2 }]}>{t("thread.goToSettings" as any)}</Text>
          </Pressable>
        </View>
      ) : (
      <ScrollView
        contentContainerStyle={[
          styles.content,
          {
            paddingHorizontal: layout.contentPadding,
            paddingBottom: insets.bottom + 120,
            maxWidth: layout.contentMaxWidth,
            alignSelf: "center",
            width: "100%",
          },
        ]}
      >
          <TextInput
            value={titleDraft}
            onChangeText={(text) => {
              titleDirtyRef.current = true;
              setTitleDraft(text);
            }}
          onBlur={() => void saveTitle()}
          maxLength={160}
          style={[styles.titleInput, { fontSize: ts.heading2 }]}
          accessibilityLabel={t("thread.titleLabel")}
        />
        <View style={styles.statusRow}>
          {(["open", "ready", "archived"] as const).map((status) => (
            <Pressable
              key={status}
              onPress={() => void updateThread({ status })}
              style={[styles.statusChip, detail.thread.status === status && styles.statusChipActive]}
              accessibilityRole="button"
              accessibilityState={{ selected: detail.thread.status === status }}
            >
              <Text style={[styles.statusText, detail.thread.status === status && styles.statusTextActive]}>
                {t(`thread.${status}`)}
              </Text>
            </Pressable>
          ))}
        </View>

        {error ? (
          <View style={styles.errorCard} accessibilityLiveRegion="assertive">
            <Feather name="alert-circle" size={18} color={Colors.error} />
            <Text style={[styles.errorText, { fontSize: ts.body2 }]}>{error}</Text>
            <Pressable onPress={load}><Text style={styles.errorRetry}>{t("thread.reload")}</Text></Pressable>
          </View>
        ) : null}

        <View style={styles.summaryCard}>
          <View style={styles.summaryTop}>
            <Text style={[styles.sectionTitle, { fontSize: ts.heading3 }]}>{t("thread.conversionSource")}</Text>

          </View>


          {summary.missingRecordingCount > 0 ? (
            <Text style={[styles.errorText, { fontSize: ts.caption }]}>
              {summary.missingRecordingCount === 1
                ? t("thread.sourceMissingOne")
                : t("thread.sourceMissing", { count: summary.missingRecordingCount })}
            </Text>
          ) : null}
        </View>

        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, { fontSize: ts.heading3 }]}>{t("thread.timeline")}</Text>
          <View style={styles.inlineActions}>
            {detail.thread.orderingMode === "manual" ? (
              <Pressable onPress={resetChronology} style={styles.smallButton}>
                <Feather name="clock" size={14} color={Colors.primary} />
                <Text style={styles.smallButtonText}>{t("thread.resetChronology")}</Text>
              </Pressable>
            ) : null}
            <Pressable onPress={() => setShowAddExisting((value) => !value)} style={styles.smallButton}>
              <Feather name="plus" size={14} color={Colors.primary} />
              <Text style={styles.smallButtonText}>{t("thread.addExisting")}</Text>
            </Pressable>
          </View>
        </View>

        {showAddExisting ? (
          <View style={styles.addExisting}>
            <TextInput
              value={recordingSearch}
              onChangeText={setRecordingSearch}
              placeholder={t("thread.searchRecordings")}
              placeholderTextColor={Colors.textMuted}
              style={[styles.searchInput, { fontSize: ts.body2 }]}
              accessibilityLabel={t("thread.searchRecordings")}
            />
            {availableRecordings.length === 0 ? (
              <Text style={[styles.muted, { fontSize: ts.body2 }]}>{t("thread.noAdditionalRecordings")}</Text>
            ) : availableRecordings.map((recording) => (
              <Pressable
                key={recording.id}
                onPress={() => addExisting(recording.id)}
                disabled={busy === recording.id}
                style={styles.pickerRow}
              >
                <Feather name="mic" size={16} color={Colors.primary} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.itemTitle, { fontSize: ts.body2 }]} numberOfLines={1}>{recording.title}</Text>
                  <Text style={[styles.muted, { fontSize: ts.caption }]}>
                    {new Date(recording.createdAt).toLocaleDateString()} · {recording.transcript.trim() ? t("thread.transcribed") : t("thread.transcriptPending")}
                  </Text>
                </View>
                {busy === recording.id ? <ActivityIndicator size="small" color={Colors.primary} /> : <Feather name="plus-circle" size={18} color={Colors.primary} />}
              </Pressable>
            ))}
          </View>
        ) : null}

        {orderedItems.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={[styles.itemTitle, { fontSize: ts.body }]}>{t("thread.noVoiceNotes")}</Text>

          </View>
        ) : orderedItems.map((item, index) => {
          const recording = item.recording;
          const pending = !recording?.transcript?.trim();
          return (
            <View key={item.id} style={[styles.itemCard, !item.included && styles.excluded]}>
              <View style={styles.timelineNumber}>
                <Text style={styles.timelineNumberText}>{index + 1}</Text>
              </View>
              <View style={styles.itemBody}>
                <Pressable
                  onPress={() => recording && router.push({ pathname: "/recording/[id]" as any, params: { id: recording.id } })}
                  disabled={!recording}
                >
                  <Text style={[styles.itemTitle, { fontSize: ts.body }]} numberOfLines={1}>
                    {recording?.title || t("thread.recordingUnavailable")}
                  </Text>
                  <Text style={[styles.muted, { fontSize: ts.caption }]}>
                    {new Date(recording?.createdAt || item.sourceCreatedAt).toLocaleString()}
                    {recording ? ` · ${formatDuration(recording.duration)}` : ""}
                    {pending ? ` · ${t("thread.transcriptPending")}` : ""}
                  </Text>
                  {recording?.transcript ? (
                    <Text style={[styles.preview, { fontSize: ts.caption }]} numberOfLines={3}>{recording.transcript}</Text>
                  ) : null}
                </Pressable>
                <View style={styles.itemActions}>
                  <Pressable
                    onPress={() => moveItem(index, -1)}
                    disabled={index === 0 || busy === "reorder"}
                    style={[styles.actionIcon, index === 0 && styles.disabled]}
                    accessibilityLabel={t("thread.moveEarlier")}
                  ><Feather name="arrow-up" size={16} color={Colors.textSecondary} /></Pressable>
                  <Pressable
                    onPress={() => moveItem(index, 1)}
                    disabled={index === orderedItems.length - 1 || busy === "reorder"}
                    style={[styles.actionIcon, index === orderedItems.length - 1 && styles.disabled]}
                    accessibilityLabel={t("thread.moveLater")}
                  ><Feather name="arrow-down" size={16} color={Colors.textSecondary} /></Pressable>
                  <Pressable
                    onPress={() => updateItem(item.id, !item.included)}
                    style={styles.actionIcon}
                    accessibilityLabel={item.included ? t("thread.excludeNote") : t("thread.includeNote")}
                  ><Feather name={item.included ? "eye" : "eye-off"} size={16} color={Colors.textSecondary} /></Pressable>
                  <Pressable
                    onPress={() => removeItem(item.id)}
                    style={styles.actionIcon}
                    accessibilityLabel={t("thread.removeNote")}
                  ><Feather name="x" size={17} color={Colors.error} /></Pressable>
                </View>
              </View>
            </View>
          );
        })}

        <Pressable
          onPress={() => router.push({ pathname: "/record" as any, params: { threadId: detail.thread.id } })}
          style={styles.recordButton}
          accessibilityRole="button"
          accessibilityLabel={t("thread.recordAnotherLabel")}
        >
          <Feather name="mic" size={19} color="#fff" />
          <Text style={[styles.primaryText, { fontSize: ts.body2 }]}>{t("thread.recordAnother")}</Text>
        </Pressable>

        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, { fontSize: ts.heading3 }]}>{t("thread.addedContext")}</Text>
          <Pressable onPress={importFile} disabled={busy === "file"} style={styles.smallButton}>
            {busy === "file" ? <ActivityIndicator size="small" color={Colors.primary} /> : <Feather name="paperclip" size={14} color={Colors.primary} />}
            <Text style={styles.smallButtonText}>{t("thread.addFile")}</Text>
          </Pressable>
        </View>

        <View style={styles.contextComposer}>
          <TextInput
            value={newContext}
            onChangeText={setNewContext}
            placeholder={t("thread.contextPlaceholder")}
            placeholderTextColor={Colors.textMuted}
            multiline
            textAlignVertical="top"
            style={[styles.contextInput, { fontSize: ts.body2 }]}
            accessibilityLabel={t("thread.newContextLabel")}
          />
          <Pressable
            onPress={addTextContext}
            disabled={!newContext.trim() || busy === "context"}
            style={[styles.addContextButton, (!newContext.trim() || busy === "context") && styles.disabled]}
          >
            {busy === "context" ? <ActivityIndicator size="small" color="#fff" /> : <Feather name="plus" size={16} color="#fff" />}
            <Text style={styles.primaryText}>{t("thread.addContext")}</Text>
          </Pressable>
        </View>

        {detail.contexts.map((context) => {
          const relationshipDraft = relationshipDrafts[context.id] || {
            relationship: context.relationship || null,
            relatedSourceId: context.relatedSourceId || null,
          };
          const relationshipChanged =
            relationshipDraft.relationship !== (context.relationship || null)
            || relationshipDraft.relatedSourceId !== (context.relatedSourceId || null);
          return (
          <View key={context.id} style={styles.contextCard}>
            <View style={styles.contextHeader}>
              <Feather name={context.kind === "file" ? "file-text" : "type"} size={16} color={Colors.primary} />
              <Text style={[styles.itemTitle, { fontSize: ts.body2, flex: 1 }]} numberOfLines={1}>{context.label}</Text>
              {context.sourceBucketFileId ? (
                <Pressable
                  onPress={() => {
                    void Linking.openURL(new URL(
                      `/api/bucket/files/${encodeURIComponent(context.sourceBucketFileId!)}`,
                      getApiUrl(),
                    ).toString());
                  }}
                  style={styles.actionIcon}
                  accessibilityRole="button"
                  accessibilityLabel={t("thread.openOriginal", { name: context.label })}
                  accessibilityHint={t("thread.openOriginalHint")}
                >
                  <Feather name="external-link" size={16} color={Colors.primary} />
                </Pressable>
              ) : null}
              <Pressable
                onPress={() => removeContext(context.id, context.label)}
                style={styles.actionIcon}
                accessibilityRole="button"
                accessibilityLabel={t("thread.removeContext", { name: context.label })}
                accessibilityHint={t("thread.removeContextHint")}
              >
                <Feather name="trash-2" size={16} color={Colors.error} />
              </Pressable>
            </View>

            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.relationshipRow}
            >
              {CONTEXT_RELATIONSHIPS.map((relationship) => (
                <Pressable
                  key={relationship}
                  onPress={() => setRelationshipDrafts((current) => ({
                    ...current,
                    [context.id]: {
                      relationship,
                      relatedSourceId: current[context.id]?.relatedSourceId || null,
                    },
                  }))}
                  style={[
                    styles.relationshipChip,
                    relationshipDraft.relationship === relationship && styles.relationshipChipActive,
                  ]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: relationshipDraft.relationship === relationship }}
                  accessibilityLabel={t(`thread.relationship.${relationship}` as any)}
                >
                  <Text style={[
                    styles.relationshipChipText,
                    relationshipDraft.relationship === relationship && styles.relationshipChipTextActive,
                  ]}>
                    {t(`thread.relationship.${relationship}` as any)}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
            {relationshipDraft.relationship ? (
              <>

                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.relationshipRow}
                >
                  {orderedItems.map((item, index) => (
                    <Pressable
                      key={item.id}
                      onPress={() => setRelationshipDrafts((current) => ({
                        ...current,
                        [context.id]: {
                          relationship: current[context.id]?.relationship || relationshipDraft.relationship,
                          relatedSourceId: item.id,
                        },
                      }))}
                      style={[
                        styles.relationshipChip,
                        relationshipDraft.relatedSourceId === item.id && styles.relationshipChipActive,
                      ]}
                      accessibilityRole="button"
                      accessibilityState={{ selected: relationshipDraft.relatedSourceId === item.id }}
                    >
                      <Text style={[
                        styles.relationshipChipText,
                        relationshipDraft.relatedSourceId === item.id && styles.relationshipChipTextActive,
                      ]}>
                        {index + 1}. {item.recording?.title || t("thread.recordingUnavailable")}
                      </Text>
                    </Pressable>
                  ))}
                  {detail.contexts
                    .filter((candidate) => candidate.id !== context.id)
                    .map((candidate) => (
                      <Pressable
                        key={candidate.id}
                        onPress={() => setRelationshipDrafts((current) => ({
                          ...current,
                          [context.id]: {
                            relationship: current[context.id]?.relationship || relationshipDraft.relationship,
                            relatedSourceId: candidate.id,
                          },
                        }))}
                        style={[
                          styles.relationshipChip,
                          relationshipDraft.relatedSourceId === candidate.id && styles.relationshipChipActive,
                        ]}
                        accessibilityRole="button"
                        accessibilityState={{ selected: relationshipDraft.relatedSourceId === candidate.id }}
                      >
                        <Text style={[
                          styles.relationshipChipText,
                          relationshipDraft.relatedSourceId === candidate.id && styles.relationshipChipTextActive,
                        ]}>
                          {candidate.label}
                        </Text>
                      </Pressable>
                    ))}
                </ScrollView>
              </>
            ) : null}
            {relationshipChanged ? (
              <View style={styles.relationshipActions}>
                {(context.relationship || context.relatedSourceId) ? (
                  <Pressable
                    onPress={() => { void saveContextRelationship(context.id, true); }}
                    style={styles.smallButton}
                    accessibilityRole="button"
                  >
                    <Text style={styles.smallButtonText}>{t("thread.relationshipClear")}</Text>
                  </Pressable>
                ) : null}
                <Pressable
                  onPress={() => { void saveContextRelationship(context.id); }}
                  disabled={!relationshipDraft.relationship || !relationshipDraft.relatedSourceId}
                  style={[
                    styles.smallButton,
                    (!relationshipDraft.relationship || !relationshipDraft.relatedSourceId) && styles.disabled,
                  ]}
                  accessibilityRole="button"
                >
                  {busy === `relationship:${context.id}`
                    ? <ActivityIndicator size="small" color={Colors.primary} />
                    : <Feather name="link" size={14} color={Colors.primary} />}
                  <Text style={styles.smallButtonText}>{t("thread.relationshipSave")}</Text>
                </Pressable>
              </View>
            ) : null}
            <TextInput
              value={contextDrafts[context.id] ?? context.text}
              onChangeText={(text) => {
                dirtyContextIdsRef.current.add(context.id);
                setContextDrafts((values) => ({ ...values, [context.id]: text }));
              }}
              multiline
              textAlignVertical="top"
              style={[styles.savedContextInput, { fontSize: ts.body2 }]}
              accessibilityLabel={t("thread.editContext", { name: context.label })}
            />
            {(contextDrafts[context.id] ?? context.text).trim() !== context.text.trim() ? (
              <Pressable onPress={() => saveContext(context.id)} style={styles.saveContextButton}>
                {busy === context.id ? <ActivityIndicator size="small" color={Colors.primary} /> : <Feather name="save" size={15} color={Colors.primary} />}
                <Text style={styles.smallButtonText}>{t("thread.saveChanges")}</Text>
              </Pressable>
            ) : null}
          </View>
          );
        })}

        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, { fontSize: ts.heading3 }]}>{t("thread.convert")}</Text>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.typeRow}>
          {availableTypes.map((type) => (
            <Pressable
              key={type.value}
              onPress={() => setSelectedType(type.value)}
              style={[styles.typeChip, selectedType === type.value && styles.typeChipActive]}
              accessibilityState={{ selected: selectedType === type.value }}
            >
              <Feather name={type.icon as any} size={14} color={selectedType === type.value ? "#fff" : Colors.textSecondary} />
              <Text style={[styles.typeText, selectedType === type.value && styles.typeTextActive]}>{type.label}</Text>
            </Pressable>
          ))}
        </ScrollView>
        {["academic_research", "bibliography"].includes(selectedType) ? (
          <View style={styles.optionCard}>
            <Text style={[styles.itemTitle, { fontSize: ts.body2 }]}>{t("thread.citationStyle")}</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.typeRow}>
              {CITATION_STYLES.map((style) => (
                <Pressable
                  key={style.value}
                  onPress={() => setCitationStyle(style.value)}
                  style={[styles.optionChip, citationStyle === style.value && styles.optionChipActive]}
                  accessibilityState={{ selected: citationStyle === style.value }}
                >
                  <Text style={[styles.optionChipText, citationStyle === style.value && styles.optionChipTextActive]}>
                    {style.label}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
            {selectedType === "bibliography" ? (
              <View style={styles.optionRow}>
                {(["standard", "annotated"] as const).map((value) => (
                  <Pressable
                    key={value}
                    onPress={() => setBibliographyType(value)}
                    style={[styles.optionChip, bibliographyType === value && styles.optionChipActive]}
                    accessibilityState={{ selected: bibliographyType === value }}
                  >
                    <Text style={[styles.optionChipText, bibliographyType === value && styles.optionChipTextActive]}>
                      {value === "annotated" ? t("thread.annotated") : t("thread.standard")}
                    </Text>
                  </Pressable>
                ))}
              </View>
            ) : null}
          </View>
        ) : null}
        <View style={styles.optionCard}>
          <View style={styles.toggleRow}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.itemTitle, { fontSize: ts.body2 }]}>{t("thread.askBefore")}</Text>
            </View>
            <Switch value={clarifyEnabled} onValueChange={setClarifyEnabled} />
          </View>
          <View style={styles.optionRow}>
            {(["markdown", "plaintext"] as const).map((value) => (
              <Pressable
                key={value}
                onPress={() => setOutputFormat(value)}
                style={[styles.optionChip, outputFormat === value && styles.optionChipActive]}
                accessibilityState={{ selected: outputFormat === value }}
              >
                <Text style={[styles.optionChipText, outputFormat === value && styles.optionChipTextActive]}>
                  {value === "markdown" ? t("thread.markdown") : t("thread.plainText")}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
        {pendingPrepared && clarifyQuestion.trim() ? (
          <View style={styles.clarificationCard}>
            <Text style={[styles.itemTitle, { fontSize: ts.body }]}>{t("thread.clarificationTitle")}</Text>
            <Text style={[styles.preview, { fontSize: ts.body2 }]}>{clarifyQuestion}</Text>
            {clarifyOptions.length > 0 ? (
              <View style={styles.optionRow}>
                {clarifyOptions.map((option) => (
                  <Pressable
                    key={option}
                    onPress={() => setClarifyAnswer(option)}
                    style={[styles.optionChip, clarifyAnswer === option && styles.optionChipActive]}
                  >
                    <Text style={[styles.optionChipText, clarifyAnswer === option && styles.optionChipTextActive]}>{option}</Text>
                  </Pressable>
                ))}
              </View>
            ) : null}
            <TextInput
              value={clarifyAnswer}
              onChangeText={setClarifyAnswer}
              placeholder={t("thread.clarificationPlaceholder")}
              placeholderTextColor={Colors.textMuted}
              multiline
              style={[styles.savedContextInput, { fontSize: ts.body2 }]}
              accessibilityLabel={t("thread.clarificationAnswer")}
            />
            <View style={styles.clarificationActions}>
              <Pressable onPress={() => void continueAfterClarification(true)} style={styles.smallButton}>
                <Text style={styles.smallButtonText}>{t("thread.skip")}</Text>
              </Pressable>
              <Pressable
                onPress={() => void continueAfterClarification(false)}
                disabled={!clarifyAnswer.trim() || busy === "convert"}
                style={[styles.convertButton, (!clarifyAnswer.trim() || busy === "convert") && styles.disabled, { flex: 1 }]}
              >
                <Text style={styles.primaryText}>{t("thread.useAnswer")}</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <Pressable
            onPress={() => void convert()}
            disabled={busy === "convert" || conversionPlan?.strategy === "blocked" || summary.includedRecordingCount + summary.contextCount === 0}
            style={[styles.convertButton, (busy === "convert" || conversionPlan?.strategy === "blocked" || summary.includedRecordingCount + summary.contextCount === 0) && styles.disabled]}
            accessibilityRole="button"
            accessibilityLabel={t("thread.convertAction")}
          >
            {busy === "convert" ? <ActivityIndicator size="small" color="#fff" /> : <Feather name="zap" size={18} color="#fff" />}
            <Text style={[styles.primaryText, { fontSize: ts.body }]}>
              {busy === "convert" ? t("thread.converting") : t("thread.convertAction")}
            </Text>
          </Pressable>
        )}
        {conversionStage ? (
          <Text style={[styles.strategyText, { fontSize: ts.body2 }]} accessibilityLiveRegion="polite">{conversionStage}</Text>
        ) : null}
        {lastFile ? (
          <Pressable
            onPress={() => router.push({ pathname: "/files" as any, params: { fileId: lastFile.id } })}
            style={styles.successCard}
          >
            <Feather name="check-circle" size={20} color={Colors.success || "#10b981"} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.itemTitle, { fontSize: ts.body2 }]}>{t("thread.conversionSaved")}</Text>
              <Text style={[styles.muted, { fontSize: ts.caption }]} numberOfLines={1}>{lastFile.name}</Text>
            </View>
            <Feather name="chevron-right" size={18} color={Colors.textMuted} />
          </Pressable>
        ) : null}

        {detail.runs.length > 0 ? (
          <View style={styles.history}>
            <Text style={[styles.sectionTitle, { fontSize: ts.heading3 }]}>{t("thread.runHistory")}</Text>
            {detail.runs.map((run) => (
              <View key={run.id} style={styles.runRow}>
                <Feather
                  name={run.status === "completed" ? "check-circle" : run.status === "failed" ? "x-circle" : "clock"}
                  size={17}
                  color={run.status === "completed" ? (Colors.success || "#10b981") : run.status === "failed" ? Colors.error : Colors.warning}
                />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.itemTitle, { fontSize: ts.body2 }]}>
                    {t(`conversion.${run.conversionType}` as any)}
                  </Text>
                  <Text style={[styles.muted, { fontSize: ts.caption }]}>
                    {new Date(run.createdAt).toLocaleString()} · {t(`thread.runStatus.${run.status}`)}
                    {" · "}{t(`thread.strategyLabel.${run.modelStrategy}`)}
                    {" · "}{t("thread.historyMeta", { count: run.sourceRecordingIds.length })}
                  </Text>
                </View>
                {run.fileId ? (
                  <Pressable
                    onPress={() => router.push({ pathname: "/files" as any, params: { fileId: run.fileId! } })}
                    style={styles.actionIcon}
                    accessibilityRole="button"
                    accessibilityLabel={t("thread.openSaved")}
                  >
                    <Feather name="file-text" size={18} color={Colors.primary} />
                  </Pressable>
                ) : null}
                {run.status === "prepared" || run.status === "preparing" ? (
                  <Pressable
                    onPress={() => void resumeExistingRun(run)}
                    style={styles.actionIcon}
                    accessibilityRole="button"
                    accessibilityLabel={t("thread.resumeRun")}
                  >
                    <Feather name="play" size={18} color={Colors.primary} />
                  </Pressable>
                ) : null}
                {run.status === "failed" || run.status === "cancelled" ? (
                  <Pressable
                    onPress={() => void retryExistingRun(run)}
                    style={styles.actionIcon}
                    accessibilityRole="button"
                    accessibilityLabel={t("thread.retryRun")}
                  >
                    <Feather name="rotate-cw" size={18} color={Colors.primary} />
                  </Pressable>
                ) : null}
                {["preparing", "prepared", "converting"].includes(run.status) ? (
                  <Pressable
                    onPress={() => void cancelExistingRun(run)}
                    style={styles.actionIcon}
                    accessibilityRole="button"
                    accessibilityLabel={t("thread.cancelRun")}
                  >
                    <Feather name="x" size={18} color={Colors.error} />
                  </Pressable>
                ) : null}
              </View>
            ))}
          </View>
        ) : null}
      </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  center: { alignItems: "center", justifyContent: "center", gap: 14, padding: 24 },
  primaryButton: {
    minHeight: 48,
    paddingHorizontal: 18,
    borderRadius: 12,
    backgroundColor: Colors.primary,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 8,
  },
  header: {
    minHeight: 60,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  iconButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  headerTitle: { flexDirection: "row", alignItems: "center", gap: 8, flex: 1, justifyContent: "center" },
  headerLabel: { color: Colors.text, fontFamily: "Inter_700Bold" },
  content: { paddingTop: 20, gap: 14 },
  titleInput: {
    color: Colors.text,
    fontFamily: "Inter_700Bold",
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  statusRow: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  statusChip: { minHeight: 44, paddingHorizontal: 14, borderRadius: 22, borderWidth: 1, borderColor: Colors.border, alignItems: "center", justifyContent: "center" },
  statusChipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  statusText: { color: Colors.textSecondary, fontFamily: "Inter_600SemiBold", fontSize: 12 },
  statusTextActive: { color: "#fff" },
  summaryCard: { padding: 16, borderRadius: 14, backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border, gap: 7 },
  summaryTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12 },
  sectionTitle: { color: Colors.text, fontFamily: "Inter_700Bold" },
  tokenText: { color: Colors.primary, fontFamily: "Inter_600SemiBold" },
  muted: { color: Colors.textMuted, lineHeight: 20 },
  strategyText: { color: Colors.textSecondary, lineHeight: 20 },
  errorCard: { padding: 13, borderRadius: 12, borderWidth: 1, borderColor: Colors.error, backgroundColor: "rgba(239, 68, 68, 0.08)", flexDirection: "row", alignItems: "center", gap: 9 },
  errorText: { color: Colors.error, flex: 1 },
  errorRetry: { color: Colors.error, fontFamily: "Inter_700Bold" },
  sectionHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", gap: 12, marginTop: 12, flexWrap: "wrap" },
  inlineActions: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  smallButton: { minHeight: 44, paddingHorizontal: 10, borderRadius: 9, backgroundColor: "rgba(0, 180, 216, 0.1)", flexDirection: "row", alignItems: "center", gap: 6 },
  smallButtonText: { color: Colors.primary, fontFamily: "Inter_600SemiBold", fontSize: 12 },
  addExisting: { padding: 12, borderRadius: 12, backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border, gap: 8 },
  searchInput: { minHeight: 44, borderWidth: 1, borderColor: Colors.border, borderRadius: 10, color: Colors.text, paddingHorizontal: 12 },
  pickerRow: { minHeight: 56, flexDirection: "row", alignItems: "center", gap: 10, borderTopWidth: 1, borderTopColor: Colors.border, paddingTop: 8 },
  itemCard: { flexDirection: "row", gap: 12, padding: 14, borderRadius: 14, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.surface },
  excluded: { opacity: 0.55 },
  timelineNumber: { width: 28, height: 28, borderRadius: 14, backgroundColor: "rgba(0, 180, 216, 0.13)", alignItems: "center", justifyContent: "center" },
  timelineNumberText: { color: Colors.primary, fontFamily: "Inter_700Bold", fontSize: 12 },
  itemBody: { flex: 1, gap: 8 },
  itemTitle: { color: Colors.text, fontFamily: "Inter_600SemiBold" },
  preview: { color: Colors.textSecondary, lineHeight: 19, marginTop: 8 },
  itemActions: { flexDirection: "row", gap: 6, justifyContent: "flex-end" },
  actionIcon: { width: 44, height: 44, borderRadius: 9, backgroundColor: Colors.surfaceHighlight, alignItems: "center", justifyContent: "center" },
  disabled: { opacity: 0.4 },
  emptyCard: { padding: 24, borderRadius: 14, borderWidth: 1, borderStyle: "dashed", borderColor: Colors.border, alignItems: "center", gap: 6 },
  recordButton: { minHeight: 50, borderRadius: 12, backgroundColor: Colors.primary, flexDirection: "row", gap: 8, alignItems: "center", justifyContent: "center" },
  primaryText: { color: "#fff", fontFamily: "Inter_700Bold" },
  contextComposer: { padding: 12, borderRadius: 14, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.surface, gap: 10 },
  contextInput: { minHeight: 110, color: Colors.text, lineHeight: 21 },
  addContextButton: { alignSelf: "flex-end", minHeight: 44, paddingHorizontal: 14, borderRadius: 9, backgroundColor: Colors.primary, flexDirection: "row", alignItems: "center", gap: 7 },
  contextCard: { padding: 13, borderRadius: 14, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.surface, gap: 10 },
  contextHeader: { flexDirection: "row", alignItems: "center", gap: 9 },
  relationshipRow: { gap: 7, paddingVertical: 2 },
  relationshipChip: { minHeight: 44, maxWidth: 220, paddingHorizontal: 11, borderRadius: 22, borderWidth: 1, borderColor: Colors.border, alignItems: "center", justifyContent: "center" },
  relationshipChipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  relationshipChipText: { color: Colors.textSecondary, fontFamily: "Inter_600SemiBold", fontSize: 12 },
  relationshipChipTextActive: { color: "#fff" },
  relationshipActions: { minHeight: 44, flexDirection: "row", justifyContent: "flex-end", gap: 8 },
  savedContextInput: { minHeight: 88, color: Colors.textSecondary, lineHeight: 20, backgroundColor: Colors.background, borderRadius: 9, padding: 10 },
  saveContextButton: { alignSelf: "flex-end", minHeight: 44, paddingHorizontal: 10, borderRadius: 9, backgroundColor: "rgba(0, 180, 216, 0.1)", flexDirection: "row", alignItems: "center", gap: 6 },
  typeRow: { gap: 8, paddingVertical: 2 },
  typeChip: { minHeight: 44, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.surface, flexDirection: "row", alignItems: "center", gap: 6 },
  typeChipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  typeText: { color: Colors.textSecondary, fontFamily: "Inter_600SemiBold", fontSize: 12 },
  typeTextActive: { color: "#fff" },
  optionCard: { borderRadius: 14, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.surface, padding: 12, gap: 10 },
  optionRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, alignItems: "center" },
  optionChip: { minHeight: 44, borderRadius: 22, borderWidth: 1, borderColor: Colors.border, paddingHorizontal: 12, alignItems: "center", justifyContent: "center" },
  optionChipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  optionChipText: { color: Colors.textSecondary, fontFamily: "Inter_600SemiBold", fontSize: 12 },
  optionChipTextActive: { color: "#fff" },
  toggleRow: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: 12 },
  clarificationCard: { borderRadius: 14, borderWidth: 1, borderColor: Colors.primary, backgroundColor: "rgba(0, 180, 216, 0.08)", padding: 14, gap: 12 },
  clarificationActions: { flexDirection: "row", alignItems: "center", gap: 10 },
  convertButton: { minHeight: 54, borderRadius: 13, backgroundColor: Colors.primary, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 9 },
  successCard: { padding: 13, borderRadius: 12, borderWidth: 1, borderColor: Colors.success || "#10b981", backgroundColor: "rgba(16, 185, 129, 0.08)", flexDirection: "row", alignItems: "center", gap: 10 },
  history: { gap: 9, marginTop: 12 },
  runRow: { minHeight: 58, padding: 12, borderRadius: 12, backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border, flexDirection: "row", alignItems: "center", gap: 10 },
  secondaryButton: { minHeight: 42, paddingHorizontal: 16, borderRadius: 10, borderWidth: 1, borderColor: Colors.primary, alignItems: "center", justifyContent: "center" },
  secondaryText: { color: Colors.primary, fontFamily: "Inter_700Bold" },
});
