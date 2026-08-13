import React, { useState, useMemo, useCallback, useEffect, useRef } from "react";
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  Pressable,
  TextInput,
  Platform,
  ActivityIndicator,
} from "react-native";
import { router, useLocalSearchParams } from "@/lib/navigation";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Feather from "@react-native-vector-icons/feather/static";
import * as Haptics from "@/lib/haptics";
const expoFetch = globalThis.fetch;

import Colors from "@/constants/colors";
import { useLanguage } from "@/lib/i18n";
import { useRecordings } from "@/lib/recordings-context";
import { useAuth } from "@/lib/auth-context";
import { createUtf8Decoder } from "@/lib/utf8";
import { useResponsiveLayout } from "@/lib/useResponsiveLayout";
import { useTextScale, sf, type TextScale } from "@/lib/typography";
import {
  CONVERSION_TYPES,
  TIER_CONVERSION_TYPES,
  normalizeSubscriptionTier,
  formatDate,
  formatDuration,
  type SubscriptionTier,
} from "@/lib/utils";
import {
  estimateTokens,
  COMBINE_SOFT_LIMIT_TOKENS,
  COMBINE_HARD_LIMIT_TOKENS,
} from "@/lib/tokens";
import { getApiUrl, getAuthHeaders, authFetch } from "@/lib/query-client";
import { useQuery } from "@tanstack/react-query";
import { createThoughtThread } from "@/lib/thought-threads";

type Block =
  | { id: string; kind: "recording"; recordingId: string; included: boolean }
  | { id: string; kind: "text"; text: string; included: boolean };

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function authStreamingFetch(url: string, options?: RequestInit) {
  const headers = { ...options?.headers, ...getAuthHeaders() };
  const expoOptions: Record<string, unknown> = {
    credentials: "include",
    headers,
  };
  if (options?.method) expoOptions.method = options.method;
  if (options?.body != null) expoOptions.body = options.body;
  return expoFetch(url, expoOptions as any);
}

export default function CombineScreen() {
  const insets = useSafeAreaInsets();
  const { t, language } = useLanguage();
  const params = useLocalSearchParams<{ ids?: string }>();
  const { recordings, getRecording, isCloudSyncEnabled } = useRecordings();
  const { user } = useAuth();
  const layout = useResponsiveLayout();
  const ts = useTextScale();
  const styles = useMemo(() => makeStyles(ts), [ts]);
  const webTopInset = Platform.OS === "web" ? 67 : 0;

  const { data: subData } = useQuery<{ tier?: string }>({
    queryKey: ["/api/stripe/subscription"],
    enabled: !!user,
  });
  const tier: SubscriptionTier = normalizeSubscriptionTier(subData?.tier);
  const availableTypes = useMemo(
    () => CONVERSION_TYPES.filter((c) => TIER_CONVERSION_TYPES[tier]?.includes(c.value)),
    [tier]
  );

  const initialIds = useMemo(() => {
    const raw = params.ids || "";
    return raw.split(",").map((s) => s.trim()).filter(Boolean);
  }, [params.ids]);

  const [blocks, setBlocks] = useState<Block[]>(() =>
    initialIds.map((id) => ({ id: genId(), kind: "recording" as const, recordingId: id, included: true }))
  );
  const [newText, setNewText] = useState("");
  const [showAddText, setShowAddText] = useState(false);
  const [selectedType, setSelectedType] = useState<string>(availableTypes[0]?.value || "summary");
  const [isConverting, setIsConverting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successFile, setSuccessFile] = useState<{ id: string; name: string } | null>(null);
  const [creatingThread, setCreatingThread] = useState(false);
  const migrationStarted = useRef(false);

  // Preserve old /combine links while upgrading authenticated sessions to the
  // durable Thought Thread editor. Guest sessions retain the local composer.
  useEffect(() => {
    if (!user || initialIds.length === 0 || migrationStarted.current) return;
    if (!isCloudSyncEnabled) return;
    migrationStarted.current = true;
    setCreatingThread(true);
    createThoughtThread(initialIds)
      .then((detail) => {
        router.replace({
          pathname: "/thought-thread/[id]" as any,
          params: { id: detail.thread.id },
        });
      })
      .catch((error) => {
        migrationStarted.current = false;
        setErrorMsg(error instanceof Error ? error.message : "Could not create a Thought Thread.");
      })
      .finally(() => setCreatingThread(false));
  }, [initialIds, user]);

  // If the user's tier loads later, ensure selectedType remains valid.
  useEffect(() => {
    if (availableTypes.length > 0 && !availableTypes.find((c) => c.value === selectedType)) {
      setSelectedType(availableTypes[0].value);
    }
  }, [availableTypes, selectedType]);

  const blockTexts = useMemo(() => {
    return blocks.map((b) => {
      if (b.kind === "text") return { text: b.text, included: b.included };
      const rec = getRecording(b.recordingId);
      return { text: rec?.transcript || "", included: b.included };
    });
  }, [blocks, getRecording]);

  const totalTokens = useMemo(() => {
    let total = 0;
    for (const b of blockTexts) {
      if (!b.included) continue;
      total += estimateTokens(b.text);
    }
    return total;
  }, [blockTexts]);

  const includedCount = useMemo(() => blocks.filter((b) => b.included).length, [blocks]);
  const overSoft = totalTokens > COMBINE_SOFT_LIMIT_TOKENS;
  const overHard = totalTokens > COMBINE_HARD_LIMIT_TOKENS;

  const moveBlock = useCallback((index: number, direction: -1 | 1) => {
    setBlocks((prev) => {
      const next = [...prev];
      const target = index + direction;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
    Haptics.selectionAsync();
  }, []);

  const toggleInclude = useCallback((id: string) => {
    setBlocks((prev) => prev.map((b) => (b.id === id ? { ...b, included: !b.included } : b)));
  }, []);

  const removeBlock = useCallback((id: string) => {
    setBlocks((prev) => prev.filter((b) => b.id !== id));
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, []);

  const addTextBlock = useCallback(() => {
    const trimmed = newText.trim();
    if (!trimmed) return;
    setBlocks((prev) => [...prev, { id: genId(), kind: "text", text: trimmed, included: true }]);
    setNewText("");
    setShowAddText(false);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [newText]);

  const buildCombinedTranscript = useCallback(() => {
    const parts: string[] = [];
    let index = 0;
    for (const b of blocks) {
      if (!b.included) continue;
      index += 1;
      if (b.kind === "recording") {
        const rec = getRecording(b.recordingId);
        if (!rec || !rec.transcript) continue;
        const title = rec.title || `Recording ${index}`;
        const dateStr = formatDate(rec.createdAt, language);
        parts.push(`[Note ${index} — ${dateStr} — "${title}"]\n${rec.transcript.trim()}`);
      } else {
        parts.push(`[Note ${index} — typed insert]\n${b.text.trim()}`);
      }
    }
    return parts.join("\n\n");
  }, [blocks, getRecording, language]);

  const recordingSourceIds = useMemo(() => {
    return blocks
      .filter((b): b is Extract<Block, { kind: "recording" }> => b.kind === "recording" && b.included)
      .map((b) => b.recordingId);
  }, [blocks]);

  const runConvert = useCallback(async () => {
    if (overHard || includedCount === 0) return;
    setErrorMsg(null);
    setIsConverting(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    try {
      const combined = buildCombinedTranscript();
      const typeInfo = availableTypes.find((c) => c.value === selectedType);
      const baseUrl = getApiUrl();
      const url = new URL("/api/convert", baseUrl);
      const userTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const bodyData: Record<string, any> = {
        transcript: combined,
        type: selectedType,
        outputFormat: "markdown",
        timezone: userTimezone,
      };
      if (language && language !== "en") bodyData.language = language;

      const res = await authStreamingFetch(url.toString(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(bodyData),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({} as any));
        throw new Error(errData?.error || `Conversion failed (${res.status})`);
      }

      let reader = (res as any).body?.getReader?.();
      if (!reader) {
        // RN native sometimes delivers responses without a readable body —
        // the SSE payload is still fully present, so read it as text and feed
        // it through the same event loop below.
        const payload = await res.text().catch(() => "");
        if (!payload.trim()) throw new Error("No reader available");
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
      let fullContent = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const event = JSON.parse(line.slice(6));
            if (event.content) fullContent += event.content;
            if (event.done && event.fullContent) fullContent = event.fullContent;
          } catch {
            // ignore malformed chunks
          }
        }
      }

      if (!fullContent.trim()) throw new Error("Empty response from conversion");

      const convLabel = typeInfo?.label || selectedType;
      const today = formatDate(new Date().toISOString(), language);
      const fileName = `Combined — ${convLabel} — ${today}`.slice(0, 200);

      const saveRes = await authFetch(new URL("/api/files", baseUrl).toString(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          name: fileName,
          content: fullContent,
          conversionType: convLabel,
          sourceRecordingIds: recordingSourceIds,
        }),
      });

      if (!saveRes.ok) throw new Error("Could not save the combined file");
      const saved = await saveRes.json();
      setSuccessFile({ id: saved.id, name: saved.name });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err: any) {
      console.error("Combine conversion failed:", err);
      setErrorMsg(err?.message || t("combine.errorBody"));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setIsConverting(false);
    }
  }, [overHard, includedCount, buildCombinedTranscript, availableTypes, selectedType, language, recordingSourceIds, t]);

  const handleBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace("/recordings");
  }, []);

  // Filter out blocks whose recording was deleted while user was on this screen.
  useEffect(() => {
    setBlocks((prev) => prev.filter((b) => {
      if (b.kind === "text") return true;
      return !!getRecording(b.recordingId);
    }));
  }, [recordings, getRecording]);

  if (creatingThread) {
    return (
      <View style={[styles.container, styles.successWrap, { paddingTop: insets.top + webTopInset }]}>
        <ActivityIndicator size="large" color={Colors.primary} />
        <Text style={[styles.successBody, { fontSize: ts.body }]}>Creating your Thought Thread…</Text>
      </View>
    );
  }

  if (successFile) {
    return (
      <View style={[styles.container, { paddingTop: insets.top + webTopInset }]}>
        <View style={[styles.header, { maxWidth: layout.contentMaxWidth, alignSelf: "center", width: "100%", paddingHorizontal: layout.contentPadding }]}>
          <Pressable onPress={handleBack} hitSlop={12} accessibilityLabel={t("common.back")} accessibilityRole="button">
            <Feather name="arrow-left" size={22} color={Colors.text} />
          </Pressable>
          <Text style={[styles.headerTitle, { fontSize: sf(20, ts) }]}>{t("combine.successTitle")}</Text>
          <View style={{ width: 22 }} />
        </View>
        <View style={styles.successWrap}>
          <View style={styles.successIcon}>
            <Feather name="check-circle" size={48} color={Colors.success || "#10b981"} />
          </View>
          <Text style={[styles.successTitle, { fontSize: ts.heading }]}>{t("combine.successTitle")}</Text>
          <Text style={[styles.successBody, { fontSize: ts.body }]}>{t("combine.successBody")}</Text>
          <Pressable
            style={({ pressed }) => [styles.primaryBtn, pressed && { opacity: 0.85 }]}
            onPress={() => router.replace("/files")}
            accessibilityRole="button"
            accessibilityLabel={t("combine.viewInFiles")}
          >
            <Feather name="folder" size={16} color="#fff" />
            <Text style={[styles.primaryBtnText, { fontSize: ts.body }]}>{t("combine.viewInFiles")}</Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.ghostBtn, pressed && { opacity: 0.7 }]}
            onPress={handleBack}
            accessibilityRole="button"
          >
            <Text style={[styles.ghostBtnText, { fontSize: ts.body }]}>{t("common.done")}</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top + webTopInset }]}>
      <View style={[styles.header, { maxWidth: layout.contentMaxWidth, alignSelf: "center", width: "100%", paddingHorizontal: layout.contentPadding }]}>
        <Pressable onPress={handleBack} hitSlop={12} accessibilityLabel={t("common.back")} accessibilityRole="button">
          <Feather name="arrow-left" size={22} color={Colors.text} />
        </Pressable>
        <Text style={[styles.headerTitle, { fontSize: sf(20, ts) }]} numberOfLines={1}>
          {t("combine.title")}
        </Text>
        <View style={{ width: 22 }} />
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[
          styles.scrollContent,
          {
            paddingHorizontal: layout.contentPadding,
            paddingBottom: insets.bottom + 200,
            maxWidth: layout.contentMaxWidth,
            alignSelf: "center",
            width: "100%",
          },
        ]}
      >
        <View style={[styles.tokenCard, overHard ? styles.tokenCardError : overSoft ? styles.tokenCardWarn : null]}>
          <View style={styles.tokenRow}>
            <Feather
              name={overHard ? "alert-octagon" : overSoft ? "alert-triangle" : "activity"}
              size={16}
              color={overHard ? Colors.error : overSoft ? "#f59e0b" : Colors.textSecondary}
            />
            <Text style={[styles.tokenText, { fontSize: ts.body2 }]}>
              {t("combine.tokens", { count: totalTokens.toLocaleString() })} · {includedCount}/{blocks.length}
            </Text>
          </View>
          {overHard && (
            <Text style={[styles.tokenWarnText, { fontSize: ts.caption, color: Colors.error }]}>
              {t("combine.tokenExceeded")}
            </Text>
          )}
          {!overHard && overSoft && (
            <Text style={[styles.tokenWarnText, { fontSize: ts.caption }]}>
              {t("combine.tokenWarning")}
            </Text>
          )}
        </View>

        {blocks.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={[styles.emptyText, { fontSize: ts.body }]}>{t("combine.empty")}</Text>
          </View>
        ) : (
          blocks.map((b, idx) => {
            const isFirst = idx === 0;
            const isLast = idx === blocks.length - 1;
            const rec = b.kind === "recording" ? getRecording(b.recordingId) : null;
            const tokens = b.kind === "text" ? estimateTokens(b.text) : estimateTokens(rec?.transcript || "");
            const title = b.kind === "text"
              ? t("combine.textBlockLabel")
              : (rec?.title || `Recording`);
            const preview = b.kind === "text"
              ? b.text
              : (rec?.transcript || "").trim();
            return (
              <View key={b.id} style={[styles.blockCard, !b.included && styles.blockCardExcluded]}>
                <View style={styles.blockHeader}>
                  <View style={styles.blockTitleRow}>
                    <Feather
                      name={b.kind === "text" ? "type" : "mic"}
                      size={14}
                      color={Colors.primary}
                    />
                    <Text style={[styles.blockTitle, { fontSize: ts.body2 }]} numberOfLines={1}>
                      {title}
                    </Text>
                  </View>
                  <Text style={[styles.blockMeta, { fontSize: ts.caption }]}>
                    {t("combine.tokens", { count: tokens.toLocaleString() })}
                    {b.kind === "recording" && rec ? ` · ${formatDuration(rec.duration)}` : ""}
                  </Text>
                </View>
                {preview ? (
                  <Text style={[styles.blockPreview, { fontSize: ts.caption, opacity: b.included ? 1 : 0.5 }]} numberOfLines={3}>
                    {preview}
                  </Text>
                ) : null}
                <View style={styles.blockActions}>
                  <Pressable
                    style={({ pressed }) => [styles.iconBtn, pressed && { opacity: 0.6 }, isFirst && { opacity: 0.3 }]}
                    onPress={() => moveBlock(idx, -1)}
                    disabled={isFirst}
                    accessibilityLabel={t("combine.moveUp")}
                    accessibilityRole="button"
                  >
                    <Feather name="arrow-up" size={16} color={Colors.textSecondary} />
                  </Pressable>
                  <Pressable
                    style={({ pressed }) => [styles.iconBtn, pressed && { opacity: 0.6 }, isLast && { opacity: 0.3 }]}
                    onPress={() => moveBlock(idx, 1)}
                    disabled={isLast}
                    accessibilityLabel={t("combine.moveDown")}
                    accessibilityRole="button"
                  >
                    <Feather name="arrow-down" size={16} color={Colors.textSecondary} />
                  </Pressable>
                  <Pressable
                    style={({ pressed }) => [styles.iconBtn, pressed && { opacity: 0.6 }]}
                    onPress={() => toggleInclude(b.id)}
                    accessibilityLabel={b.included ? t("combine.exclude") : t("combine.include")}
                    accessibilityRole="button"
                  >
                    <Feather name={b.included ? "eye" : "eye-off"} size={16} color={Colors.textSecondary} />
                  </Pressable>
                  <Pressable
                    style={({ pressed }) => [styles.iconBtn, pressed && { opacity: 0.6 }]}
                    onPress={() => removeBlock(b.id)}
                    accessibilityLabel={t("combine.removeBlock")}
                    accessibilityRole="button"
                  >
                    <Feather name="x" size={16} color={Colors.error} />
                  </Pressable>
                </View>
              </View>
            );
          })
        )}

        {showAddText ? (
          <View style={styles.addTextCard}>
            <TextInput
              style={[styles.addTextInput, { fontSize: ts.body }]}
              value={newText}
              onChangeText={setNewText}
              placeholder={t("combine.textBlockPlaceholder")}
              placeholderTextColor={Colors.textMuted}
              multiline
              autoFocus
              accessibilityLabel={t("combine.addTextBlock")}
            />
            <View style={styles.addTextActions}>
              <Pressable
                style={({ pressed }) => [styles.ghostBtn, pressed && { opacity: 0.7 }]}
                onPress={() => { setShowAddText(false); setNewText(""); }}
                accessibilityRole="button"
              >
                <Text style={[styles.ghostBtnText, { fontSize: ts.body2 }]}>{t("common.cancel")}</Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [styles.primaryBtn, pressed && { opacity: 0.85 }, !newText.trim() && { opacity: 0.4 }]}
                onPress={addTextBlock}
                disabled={!newText.trim()}
                accessibilityRole="button"
              >
                <Text style={[styles.primaryBtnText, { fontSize: ts.body2 }]}>{t("combine.textBlockDone")}</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <Pressable
            style={({ pressed }) => [styles.addTextTrigger, pressed && { opacity: 0.7 }]}
            onPress={() => setShowAddText(true)}
            accessibilityRole="button"
            accessibilityLabel={t("combine.addTextBlock")}
          >
            <Feather name="plus" size={16} color={Colors.primary} />
            <Text style={[styles.addTextTriggerText, { fontSize: ts.body2 }]}>{t("combine.addTextBlock")}</Text>
          </Pressable>
        )}

        <View style={styles.typeSection}>
          <Text style={[styles.sectionLabel, { fontSize: ts.body2 }]}>
            {t("combine.conversionTypeLabel")}
          </Text>
          <View style={styles.typeGrid}>
            {availableTypes.map((c) => {
              const active = selectedType === c.value;
              return (
                <Pressable
                  key={c.value}
                  style={({ pressed }) => [
                    styles.typeChip,
                    active && styles.typeChipActive,
                    pressed && { opacity: 0.8 },
                  ]}
                  onPress={() => {
                    Haptics.selectionAsync();
                    setSelectedType(c.value);
                  }}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={c.label}
                >
                  <Feather name={c.icon as any} size={14} color={active ? "#fff" : Colors.textSecondary} />
                  <Text style={[styles.typeChipText, { fontSize: ts.caption }, active && styles.typeChipTextActive]}>
                    {c.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        {errorMsg && (
          <View style={styles.errorCard}>
            <Feather name="alert-circle" size={16} color={Colors.error} />
            <Text style={[styles.errorText, { fontSize: ts.body2 }]}>{errorMsg}</Text>
          </View>
        )}
      </ScrollView>

      <View style={[styles.bottomBar, { paddingBottom: insets.bottom + (Platform.OS === "web" ? 24 : 16) }]}>
        <View style={[styles.bottomBarInner, { maxWidth: layout.contentMaxWidth }]}>
          <Pressable
            style={({ pressed }) => [
              styles.convertBtn,
              pressed && { opacity: 0.9 },
              (overHard || includedCount === 0 || isConverting) && { opacity: 0.4 },
            ]}
            onPress={runConvert}
            disabled={overHard || includedCount === 0 || isConverting}
            accessibilityRole="button"
            accessibilityLabel={t("combine.convertButton")}
          >
            {isConverting ? (
              <>
                <ActivityIndicator size="small" color="#fff" />
                <Text style={[styles.convertBtnText, { fontSize: ts.body }]}>{t("combine.converting")}</Text>
              </>
            ) : (
              <>
                <Feather name="git-merge" size={18} color="#fff" />
                <Text style={[styles.convertBtnText, { fontSize: ts.body }]}>{t("combine.convertButton")}</Text>
              </>
            )}
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const makeStyles = (ts: TextScale) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  headerTitle: {
    fontFamily: "Inter_600SemiBold",
    color: Colors.text,
    flex: 1,
    textAlign: "center",
    marginHorizontal: 12,
  },
  scrollContent: {
    paddingTop: 16,
    gap: 12,
  },
  tokenCard: {
    backgroundColor: Colors.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 12,
    gap: 6,
  },
  tokenCardWarn: {
    borderColor: "#f59e0b",
    backgroundColor: "rgba(245, 158, 11, 0.06)",
  },
  tokenCardError: {
    borderColor: Colors.error,
    backgroundColor: "rgba(235, 81, 70, 0.06)",
  },
  tokenRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  tokenText: {
    fontFamily: "Inter_500Medium",
    color: Colors.textSecondary,
  },
  tokenWarnText: {
    fontFamily: "Inter_400Regular",
    color: "#b45309",
  },
  emptyCard: {
    backgroundColor: Colors.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 20,
    alignItems: "center",
  },
  emptyText: {
    fontFamily: "Inter_400Regular",
    color: Colors.textSecondary,
    textAlign: "center",
  },
  blockCard: {
    backgroundColor: Colors.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 12,
    gap: 8,
  },
  blockCardExcluded: {
    opacity: 0.6,
    borderStyle: "dashed",
  },
  blockHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  blockTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flex: 1,
  },
  blockTitle: {
    fontFamily: "Inter_600SemiBold",
    color: Colors.text,
    flex: 1,
  },
  blockMeta: {
    fontFamily: "Inter_400Regular",
    color: Colors.textMuted,
  },
  blockPreview: {
    fontFamily: "Inter_400Regular",
    color: Colors.textSecondary,
    lineHeight: 18,
  },
  blockActions: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 4,
  },
  iconBtn: {
    width: 32,
    height: 32,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  addTextCard: {
    backgroundColor: Colors.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.primary,
    padding: 12,
    gap: 10,
  },
  addTextInput: {
    fontFamily: "Inter_400Regular",
    color: Colors.text,
    minHeight: 80,
    textAlignVertical: "top",
  },
  addTextActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 8,
  },
  addTextTrigger: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.primary,
    borderStyle: "dashed",
    backgroundColor: "rgba(0, 180, 216, 0.05)",
  },
  addTextTriggerText: {
    fontFamily: "Inter_500Medium",
    color: Colors.primary,
  },
  typeSection: {
    marginTop: 8,
    gap: 8,
  },
  sectionLabel: {
    fontFamily: "Inter_600SemiBold",
    color: Colors.text,
  },
  typeGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  typeChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  typeChipActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  typeChipText: {
    fontFamily: "Inter_500Medium",
    color: Colors.textSecondary,
  },
  typeChipTextActive: {
    color: "#fff",
  },
  errorCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "rgba(235, 81, 70, 0.08)",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.error,
    padding: 12,
  },
  errorText: {
    fontFamily: "Inter_500Medium",
    color: Colors.error,
    flex: 1,
  },
  bottomBar: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: Colors.surface,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    paddingTop: 12,
    paddingHorizontal: 16,
  },
  bottomBarInner: {
    width: "100%",
    alignSelf: "center",
  },
  convertBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: Colors.primary,
    paddingVertical: 14,
    borderRadius: 12,
  },
  convertBtnText: {
    fontFamily: "Inter_600SemiBold",
    color: "#fff",
  },
  primaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: Colors.primary,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 10,
  },
  primaryBtnText: {
    fontFamily: "Inter_600SemiBold",
    color: "#fff",
  },
  ghostBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 10,
  },
  ghostBtnText: {
    fontFamily: "Inter_500Medium",
    color: Colors.textSecondary,
  },
  successWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
    gap: 16,
  },
  successIcon: {
    marginBottom: 8,
  },
  successTitle: {
    fontFamily: "Inter_700Bold",
    color: Colors.text,
    textAlign: "center",
  },
  successBody: {
    fontFamily: "Inter_400Regular",
    color: Colors.textSecondary,
    textAlign: "center",
    maxWidth: 360,
  },
});
