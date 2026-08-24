import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Feather from "@react-native-vector-icons/feather/static";
import Colors from "@/constants/colors";
import { router } from "@/lib/navigation";
import { useResponsiveLayout } from "@/lib/useResponsiveLayout";
import { useTextScale } from "@/lib/typography";
import { useLanguage } from "@/lib/i18n";
import { useRecordings } from "@/lib/recordings-context";
import {
  createThoughtThread,
  thoughtThreadRequest,
  type ThoughtThreadListItem,
} from "@/lib/thought-threads";

export default function ThoughtThreadsScreen() {
  const insets = useSafeAreaInsets();
  const layout = useResponsiveLayout();
  const ts = useTextScale();
  const { t, language } = useLanguage();
  const { isCloudSyncEnabled } = useRecordings();
  const [threads, setThreads] = useState<ThoughtThreadListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const data = await thoughtThreadRequest<{ threads: ThoughtThreadListItem[] }>("/api/thought-threads");
      setThreads(data.threads);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load Thought Threads.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const grouped = useMemo(() => ({
    active: threads.filter((thread) => thread.status !== "archived"),
    archived: threads.filter((thread) => thread.status === "archived"),
  }), [threads]);

  const createEmpty = async () => {
    setCreating(true);
    setError("");
    try {
      const detail = await createThoughtThread([]);
      router.push({
        pathname: "/thought-thread/[id]" as any,
        params: { id: detail.thread.id },
      });
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Could not create a Thought Thread.");
    } finally {
      setCreating(false);
    }
  };

  const openThread = (id: string) => {
    router.push({ pathname: "/thought-thread/[id]" as any, params: { id } });
  };

  const section = (title: string, values: ThoughtThreadListItem[]) => values.length > 0 ? (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, { fontSize: ts.heading3 }]}>{title}</Text>
      {values.map((thread) => (
        <Pressable
          key={thread.id}
          onPress={() => openThread(thread.id)}
          style={({ pressed }) => [styles.card, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel={`${thread.title}, ${t("thread.cardMeta" as any, {
            recordings: thread.recordingCount,
            contexts: thread.contextCount,
            runs: thread.runCount,
          })}`}
        >
          <View style={styles.cardIcon}>
            <Feather name="git-branch" size={20} color={Colors.primary} />
          </View>
          <View style={styles.cardBody}>
            <Text style={[styles.cardTitle, { fontSize: ts.body }]} numberOfLines={1}>{thread.title}</Text>
            <View style={styles.cardMetaRow}>
              <View style={styles.cardMetaItem} accessibilityLabel={t("thread.metaRecordings" as any, { count: thread.recordingCount })}>
                <Feather name="mic" size={12} color={Colors.textMuted} />
                <Text style={[styles.cardMeta, { fontSize: ts.caption }]}>{thread.recordingCount}</Text>
              </View>
              <View style={styles.cardMetaItem} accessibilityLabel={t("thread.metaContexts" as any, { count: thread.contextCount })}>
                <Feather name="message-square" size={12} color={Colors.textMuted} />
                <Text style={[styles.cardMeta, { fontSize: ts.caption }]}>{thread.contextCount}</Text>
              </View>
              <View style={styles.cardMetaItem} accessibilityLabel={t("thread.metaRuns" as any, { count: thread.runCount })}>
                <Feather name="zap" size={12} color={Colors.textMuted} />
                <Text style={[styles.cardMeta, { fontSize: ts.caption }]}>{thread.runCount}</Text>
              </View>
              <View style={styles.cardMetaItem}>
                <Feather name="clock" size={12} color={Colors.textMuted} />
                <Text style={[styles.cardMeta, { fontSize: ts.caption }]}>{new Date(thread.updatedAt).toLocaleDateString(language)}</Text>
              </View>
            </View>
          </View>
          <Feather name="chevron-right" size={20} color={Colors.textMuted} />
        </Pressable>
      ))}
    </View>
  ) : null;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={[styles.header, { paddingHorizontal: layout.contentPadding }]}>
        <Pressable
          onPress={() => router.canGoBack() ? router.back() : router.replace("/recordings")}
          style={styles.iconButton}
          accessibilityRole="button"
          accessibilityLabel={t("common.back")}
        >
          <Feather name="arrow-left" size={22} color={Colors.text} />
        </Pressable>
        <Text style={[styles.title, { fontSize: ts.heading2 }]}>{t("thread.title" as any)}</Text>
        {isCloudSyncEnabled ? (
          <Pressable
            onPress={createEmpty}
            disabled={creating}
            style={styles.iconButton}
            accessibilityRole="button"
            accessibilityLabel={t("thread.create" as any)}
          >
            {creating
              ? <ActivityIndicator size="small" color={Colors.primary} />
              : <Feather name="plus" size={24} color={Colors.primary} />}
          </Pressable>
        ) : (
          <View style={styles.iconButton} />
        )}
      </View>
      {!isCloudSyncEnabled ? (
        <View style={[styles.content, { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: layout.contentPadding }]}>
          <Feather name="cloud-off" size={40} color={Colors.textMuted} />
          <Text style={[styles.emptyTitle, { fontSize: ts.heading3, marginTop: 16 }]}>{t("thread.requiresCloudSync" as any)}</Text>
          <Text style={[styles.emptyText, { fontSize: ts.body2 }]}>{t("thread.requiresCloudSyncHelp" as any)}</Text>
          <Pressable
            onPress={() => router.push("/settings/integrations" as any)}
            style={styles.primaryButton}
          >
            <Feather name="settings" size={18} color="#fff" />
            <Text style={[styles.primaryText, { fontSize: ts.body2 }]}>{t("thread.goToSettings" as any)}</Text>
          </Pressable>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={[
            styles.content,
            {
              paddingHorizontal: layout.contentPadding,
              paddingBottom: insets.bottom + 40,
              maxWidth: layout.contentMaxWidth,
              alignSelf: "center",
              width: "100%",
            },
          ]}
        >
          {error ? (
            <Pressable onPress={load} style={styles.errorCard}>
              <Feather name="alert-circle" size={18} color={Colors.error} />
              <Text style={[styles.errorText, { fontSize: ts.body2 }]}>{error} {t("thread.tapRetry")}</Text>
            </Pressable>
          ) : null}
          {loading ? (
            <ActivityIndicator size="large" color={Colors.primary} style={{ marginTop: 60 }} />
          ) : threads.length === 0 ? (
            <View style={styles.empty}>
              <Feather name="git-branch" size={40} color={Colors.textMuted} />
              <Text style={[styles.emptyTitle, { fontSize: ts.heading3 }]}>{t("thread.none" as any)}</Text>
              <Text style={[styles.emptyText, { fontSize: ts.body2 }]}>
                {t("thread.emptyHelp" as any)}
              </Text>
              <Pressable onPress={createEmpty} style={styles.primaryButton}>
                <Feather name="plus" size={18} color="#fff" />
                <Text style={[styles.primaryText, { fontSize: ts.body2 }]}>{t("thread.start" as any)}</Text>
              </Pressable>
            </View>
          ) : (
            <>
              {section(t("thread.active" as any), grouped.active)}
              {section(t("thread.archived" as any), grouped.archived)}
            </>
          )}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
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
  title: { color: Colors.text, fontFamily: "Inter_700Bold" },
  content: { paddingTop: 20, gap: 20 },
  section: { gap: 10 },
  sectionTitle: { color: Colors.text, fontFamily: "Inter_700Bold", marginBottom: 2 },
  card: {
    minHeight: 88,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
    padding: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  pressed: { opacity: 0.75 },
  cardIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(0, 180, 216, 0.12)",
    alignItems: "center",
    justifyContent: "center",
  },
  cardBody: { flex: 1, gap: 4 },
  cardTitle: { color: Colors.text, fontFamily: "Inter_600SemiBold" },
  cardMeta: { color: Colors.textMuted },
  cardMetaRow: { flexDirection: "row", alignItems: "center", gap: 12, flexWrap: "wrap" },
  cardMetaItem: { flexDirection: "row", alignItems: "center", gap: 4 },
  errorCard: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.error,
    backgroundColor: "rgba(239, 68, 68, 0.08)",
    padding: 12,
    flexDirection: "row",
    gap: 8,
  },
  errorText: { color: Colors.error, flex: 1 },
  empty: { alignItems: "center", paddingVertical: 70, gap: 12 },
  emptyTitle: { color: Colors.text, fontFamily: "Inter_700Bold" },
  emptyText: { color: Colors.textSecondary, textAlign: "center", maxWidth: 480, lineHeight: 22 },
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
  primaryText: { color: "#fff", fontFamily: "Inter_700Bold" },
});
