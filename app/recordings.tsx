import React, { useState, useCallback, useMemo, useEffect } from "react";
import {
  StyleSheet,
  Text,
  View,
  FlatList,
  Pressable,
  Platform,
  Alert,
  ActivityIndicator,
  TextInput,
  Animated,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { LinearGradient } from "@/lib/linear-gradient";
import { router, useLocalSearchParams } from "@/lib/navigation";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Feather from "@react-native-vector-icons/feather/static";
import * as Haptics from "@/lib/haptics";
import { Circle, Defs, RadialGradient, Stop, Svg } from "react-native-svg";
import Colors from "@/constants/colors";
import { useLanguage } from "@/lib/i18n";
import AvatarView from "@/components/AvatarView";
import { getFloatingRecordOverlaySpec } from "@/lib/recordings-overlay";
import { getRecordingsCountKey } from "@/lib/recordings-count-label";
import { useRecordings } from "@/lib/recordings-context";
import { formatDuration, formatDate } from "@/lib/utils";
import { useResponsiveLayout } from "@/lib/useResponsiveLayout";
import { useReducedMotion } from "@/lib/useReducedMotion";
import { useAuth } from "@/lib/auth-context";
import { useQuery } from "@tanstack/react-query";
import { useTextScale, sf, type TextScale } from "@/lib/typography";

import NavigationDrawer from "@/components/NavigationDrawer";
import FeedbackIconButton from "@/components/FeedbackIconButton";
import FloatingActionHalo from "@/components/FloatingActionHalo";
import ProfileDropdown from "@/components/ProfileDropdown";
import { useFeedback } from "@/lib/feedback-context";
import type { Recording } from "@/lib/recordings-context";
import { createThoughtThread } from "@/lib/thought-threads";
import {
  CORNER_TEXT_ACTION_SIZE,
  getFloatingActionBottomOffset,
} from "@/constants/record-layout";

function SkeletonCard({ index, reduceMotion }: { index: number; reduceMotion?: boolean }) {
  const opacity = reduceMotion ? 0.3 : undefined;
  return (
    <View
      style={{
        backgroundColor: Colors.surface,
        borderRadius: 12,
        padding: 16,
        opacity: reduceMotion ? 0.3 : 1,
      }}
    >
      <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 12 }}>
        <View style={{ height: 14, width: `${60 + (index * 7) % 30}%`, backgroundColor: Colors.surfaceHighlight, borderRadius: 4 }} />
        <View style={{ height: 12, width: 60, backgroundColor: Colors.surfaceHighlight, borderRadius: 4 }} />
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <View style={{ height: 12, width: 50, backgroundColor: Colors.surfaceHighlight, borderRadius: 4 }} />
        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.surfaceHighlight }} />
      </View>
    </View>
  );
}

function RecordingCard({ item, onDelete, cardWidth, reduceMotion, selectMode, isSelected, onToggleSelect, onEnterSelect }: { item: Recording; onDelete: (id: string) => void; cardWidth?: number; reduceMotion?: boolean; selectMode?: boolean; isSelected?: boolean; onToggleSelect?: (id: string) => void; onEnterSelect?: (id: string) => void }) {
  const { t, language } = useLanguage();
  const ts = useTextScale();
  const styles = useMemo(() => makeStyles(ts), [ts]);
  const conversionCount = item.conversions.length;
  const cardAccessibilityLabel = `${item.title}, ${formatDuration(item.duration)}, ${formatDate(item.createdAt, language)}`;

  const isDefaultTitle = item.title.startsWith("Recording ");
  const hasTranscript = item.transcript && item.transcript.trim().length > 0 && !item.transcript.startsWith("[");
  const isFailed = !!item.transcriptionError || item.transcriptionStatus === "failed" || !!item.transcriptionErrorCode;
  const isTranscribing = !!item.isTranscribing;
  const needsUpload = !!item.needsUpload;
  const isWaiting = !hasTranscript && !isTranscribing && !isFailed && !needsUpload;
  const statusColor = needsUpload ? "#8B5CF6" : isTranscribing ? Colors.primary : isFailed ? Colors.error : isWaiting ? "#f59e0b" : "#059669";
  const statusLabel = needsUpload ? "Waiting to upload" : isTranscribing ? t("detail.transcribing") : isFailed ? "Failed" : isWaiting ? "Pending" : "Ready";

  const displayTitle = isDefaultTitle
    ? (hasTranscript ? item.transcript.trim().replace(/\n/g, " ") : item.title.replace("Recording ", ""))
    : item.title;

  const [deleteConfirm, setDeleteConfirm] = useState(false);

  useEffect(() => {
    if (deleteConfirm) {
      const timer = setTimeout(() => setDeleteConfirm(false), 3000);
      return () => clearTimeout(timer);
    }
  }, [deleteConfirm]);

  return (
    <Pressable
      style={({ pressed }) => [
        styles.card,
        pressed && (reduceMotion ? styles.cardPressedReduced : styles.cardPressed),
        selectMode && isSelected && styles.cardSelected,
        cardWidth ? { width: cardWidth } : undefined,
      ]}
      accessibilityLabel={cardAccessibilityLabel}
      accessibilityHint={selectMode ? undefined : t("a11y.cardHint")}
      accessibilityRole="button"
      accessibilityState={selectMode ? { selected: !!isSelected } : undefined}
      testID="recording-card"
      onPress={() => {
        if (selectMode) {
          Haptics.selectionAsync();
          onToggleSelect?.(item.id);
          return;
        }
        if (deleteConfirm) {
          setDeleteConfirm(false);
          return;
        }
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        router.push({ pathname: "/recording/[id]", params: { id: item.id } });
      }}
      onLongPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        if (selectMode) {
          onToggleSelect?.(item.id);
        } else {
          onEnterSelect?.(item.id);
        }
      }}
    >
      <View style={styles.cardInner}>
        <View style={styles.cardHeaderRow}>
          {selectMode && (
            <View style={[styles.selectCheckbox, isSelected && styles.selectCheckboxOn]}>
              {isSelected && <Feather name="check" size={14} color="#fff" />}
            </View>
          )}
          <Text style={[styles.cardTitle, { fontSize: ts.subtitle }]} numberOfLines={1}>
            {displayTitle}
          </Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            {!deleteConfirm && (
              <Text style={[styles.cardDate, { fontSize: ts.caption }]}>
                {formatDate(item.createdAt, language)}
              </Text>
            )}
            {deleteConfirm && !selectMode && (
              <Pressable
                onPress={(event) => {
                  event.stopPropagation?.();
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  onDelete(item.id);
                  setDeleteConfirm(false);
                }}
                accessibilityLabel={t("a11y.confirmDelete")}
                accessibilityRole="button"
                testID="confirm-delete-recording"
                hitSlop={8}
              >
                <Feather name="trash-2" size={16} color={Colors.error} />
              </Pressable>
            )}
            {!deleteConfirm && !selectMode && (
              <Pressable
                onPress={(event) => {
                  event.stopPropagation?.();
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  setDeleteConfirm(true);
                }}
                accessibilityLabel={t("a11y.deleteRecording")}
                accessibilityRole="button"
                testID="delete-recording-button"
                hitSlop={8}
              >
                <Feather name="trash-2" size={16} color={Colors.textMuted} />
              </Pressable>
            )}
          </View>
        </View>
        <View style={styles.cardContentRow}>
          <View style={styles.cardMetaRow}>
            <Feather name="clock" size={14} color={Colors.textMuted} />
            <Text style={[styles.cardDuration, { fontSize: ts.caption }]}>
              {formatDuration(item.duration)}
            </Text>
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: statusColor, marginLeft: 10 }} accessibilityLabel={statusLabel} />
            {conversionCount > 0 && (
              <>
                <Feather name="zap" size={14} color={Colors.textMuted} style={{ marginLeft: 12 }} />
                <Text style={[styles.cardConversions, { fontSize: ts.caption }]}>
                  {conversionCount}
                </Text>
              </>
            )}
          </View>
          {hasTranscript && (
            <Text style={[styles.cardTranscript, { fontSize: ts.caption }]} numberOfLines={2}>
              {item.transcript.trim()}
            </Text>
          )}
        </View>
      </View>
    </Pressable>
  );
}

export default function RecordingsScreen() {
  const insets = useSafeAreaInsets();
  const { t } = useLanguage();
  const { recordings, isLoading, deleteRecording, lastRecordingLimitEvent, isCloudSyncEnabled } = useRecordings();
  const { user } = useAuth();
  const layout = useResponsiveLayout();
  const reduceMotion = useReducedMotion();
  const ts = useTextScale();
  const styles = useMemo(() => makeStyles(ts), [ts]);
  const webTopInset = Platform.OS === "web" ? 67 : 0;
  const containedFeedbackInset = layout.isMobile
    ? 40
    : Math.max((layout.width - Math.min(layout.width, layout.contentMaxWidth)) / 2 + layout.contentPadding, layout.contentPadding);
  const containedFabInset = layout.isMobile ? 24 : Math.max((layout.width - Math.min(layout.width, layout.contentMaxWidth)) / 2 + layout.contentPadding, layout.contentPadding);
  const { openFeedback, feedbackVisible } = useFeedback();
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [drawerVisible, setDrawerVisible] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [subscriptionBanner, setSubscriptionBanner] = useState<"success" | "cancelled" | null>(null);
  const [recordingLimitToast, setRecordingLimitToast] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [displayName, setDisplayName] = useState(false);
  useEffect(() => {
    AsyncStorage.getItem("showNameInHeader").then((v: string | null) => { if (v === "true") setDisplayName(true); }).catch(() => {});
  }, []);

  const enterSelectMode = useCallback((id: string) => {
    setSelectMode(true);
    setSelectedIds(new Set([id]));
  }, []);

  const toggleSelected = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const exitSelectMode = useCallback(() => {
    setSelectMode(false);
    setSelectedIds(new Set());
  }, []);

  useEffect(() => {
    // If we exit select mode (e.g. all items deselected via toggle), keep it active so
    // the user can re-select; only fully exit when they press Cancel.
    if (selectMode && selectedIds.size === 0) {
      // no-op; let user re-select or press Cancel
    }
  }, [selectMode, selectedIds]);

  const { data: subData } = useQuery<{ tier?: string; displayTier?: string }>({
    queryKey: ["/api/stripe/subscription"],
    enabled: !!user,
  });
  const normalizedDisplayTier = String(subData?.displayTier || subData?.tier || "free").toLowerCase();
  const isPaidPlan = normalizedDisplayTier !== "free";
  const planLabel = !user
    ? "Free"
    : normalizedDisplayTier === "pro"
      ? (isCloudSyncEnabled ? "Pro + Cloud Sync" : "Pro")
      : normalizedDisplayTier === "base"
        ? (isCloudSyncEnabled ? "Base + Cloud Sync" : "Base")
        : "Free";

  const params = useLocalSearchParams<{ subscription?: string }>();

  const activeNotification = useMemo(() => {
    if (subscriptionBanner) return "subscription" as const;
    if (recordingLimitToast) return "recordingLimit" as const;
    return null;
  }, [subscriptionBanner, recordingLimitToast]);

  useEffect(() => {
    if (lastRecordingLimitEvent > 0) {
      setSubscriptionBanner(null);
      setRecordingLimitToast(true);
      const timer = setTimeout(() => setRecordingLimitToast(false), 5000);
      return () => clearTimeout(timer);
    }
  }, [lastRecordingLimitEvent]);

  useEffect(() => {
    if (params.subscription === "success" || params.subscription === "cancelled") {
      setRecordingLimitToast(false);
      setSubscriptionBanner(params.subscription as "success" | "cancelled");
      if (params.subscription === "success") {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
      if (Platform.OS === "web" && typeof window !== "undefined") {
        const url = new URL(window.location.href);
        url.searchParams.delete("subscription");
        window.history.replaceState({}, "", url.pathname + url.search);
      }
    }
  }, [params.subscription]);

  useEffect(() => {
    if (!user) { setIsAdmin(false); return; }
    const checkAdmin = async () => {
      try {
        const baseUrl = (await import("@/lib/query-client")).getApiUrl();
        const { getAuthHeaders } = await import("@/lib/query-client");
        const res = await globalThis.fetch(new URL("/api/auth/is-admin", baseUrl).toString(), { credentials: "include", headers: getAuthHeaders() });
        if (res.ok) {
          const data = await res.json();
          setIsAdmin(data.isAdmin === true);
        }
      } catch {}
    };
    checkAdmin();
  }, [user]);

  const filteredRecordings = useMemo(() => {
    if (!searchQuery.trim()) return recordings;
    const query = searchQuery.toLowerCase().trim();
    return recordings.filter(
      (r) =>
        r.title.toLowerCase().includes(query) ||
        (r.transcript && r.transcript.toLowerCase().includes(query))
    );
  }, [recordings, searchQuery]);

  const handleDelete = (id: string) => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    deleteRecording(id);
  };

  const handleCombineSelected = useCallback(async () => {
    if (selectedIds.size === 0) return;
    const ids = Array.from(selectedIds);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    if (!user) {
      router.push({ pathname: "/combine" as any, params: { ids: ids.join(",") } });
      exitSelectMode();
      return;
    }
    if (!isCloudSyncEnabled) {
      const message = t("thread.requiresCloudSyncHelp" as any);
      if (Platform.OS === "web") alert(message);
      else Alert.alert(t("thread.requiresCloudSync" as any), message);
      return;
    }
    try {
      const detail = await createThoughtThread(ids);
      exitSelectMode();
      router.push({
        pathname: "/thought-thread/[id]" as any,
        params: { id: detail.thread.id },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not create a Thought Thread.";
      if (Platform.OS === "web") alert(message);
      else Alert.alert("Thought Thread", message);
    }
  }, [selectedIds, exitSelectMode, user, isCloudSyncEnabled, t]);

  const handleDeleteSelected = useCallback(() => {
    if (selectedIds.size === 0) return;
    const ids = Array.from(selectedIds);
    const doDelete = () => {
      ids.forEach((id) => deleteRecording(id));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      exitSelectMode();
    };
    const message = t("combine.deleteSelectedConfirm", { count: ids.length });
    if (Platform.OS === "web") {
      if (confirm(message)) doDelete();
    } else {
      Alert.alert(t("home.deleteTitle"), message, [
        { text: t("common.cancel"), style: "cancel" },
        { text: t("common.delete"), style: "destructive", onPress: doDelete },
      ]);
    }
  }, [selectedIds, deleteRecording, exitSelectMode, t]);

  const handleTypeToConvert = useCallback(async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const newId = Date.now().toString() + Math.random().toString(36).substr(2, 9);
    router.push({ pathname: "/recording/[id]", params: { id: newId, mode: "text" } });
  }, []);

  const numColumns = layout.columns;
  const gap = 12;
  const listPadding = layout.contentPadding;
  const availableWidth = Math.min(layout.width, layout.contentMaxWidth) - listPadding * 2;
  const cardWidth = numColumns > 1 ? (availableWidth - gap * (numColumns - 1)) / numColumns : undefined;
  const floatingRecordOverlay = useMemo(() => getFloatingRecordOverlaySpec(), []);

  return (
    <View style={[styles.container, { paddingTop: insets.top + webTopInset }]}>
      <View style={[styles.header, { maxWidth: layout.contentMaxWidth, alignSelf: "center", width: "100%", paddingHorizontal: layout.contentPadding }]}>
        <View style={styles.headerLeft}>
          <Pressable
            style={({ pressed }) => [styles.hamburgerBtn, pressed && { opacity: 0.7 }]}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              setDrawerVisible(true);
            }}
            accessibilityLabel={t("drawer.openMenu")}
            accessibilityRole="button"
            testID="hamburger-menu"
          >
            <Feather name="menu" size={22} color={Colors.textSecondary} />
          </Pressable>
          <Pressable
            style={({ pressed }) => [{ opacity: pressed ? 0.6 : 1 }]}
            onPress={() => router.replace("/")}
            accessibilityLabel="Go to home"
            accessibilityRole="button"
          >
            <Text style={[styles.headerTitle, { fontSize: Math.round(ts.heading * 5 / 3) }]} accessibilityRole="header">
              {displayName && user?.firstName ? user.firstName : "Proset"}
            </Text>
          </Pressable>
        </View>
        <View style={styles.headerRight}>
          <Pressable
            style={({ pressed }) => [styles.headerAvatar, pressed && { opacity: 0.7 }]}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              setShowProfileMenu(!showProfileMenu);
            }}
            accessibilityLabel={t("a11y.settings")}
            accessibilityRole="button"
            testID="avatar-button"
          >
            {user?.avatarId ? (
              <AvatarView avatarId={user.avatarId} size={72} />
            ) : (
              <Text style={styles.headerAvatarText}>{(user?.firstName || user?.email || "?")[0].toUpperCase()}</Text>
            )}
          </Pressable>
        </View>
      </View>

      {activeNotification === "subscription" && subscriptionBanner && (
        <View style={{ maxWidth: layout.contentMaxWidth, alignSelf: "center" }}>
          <SubscriptionBanner type={subscriptionBanner} onDismiss={() => setSubscriptionBanner(null)} />
        </View>
      )}

      {recordings.length > 0 && !isLoading && (
        <View style={[styles.searchContainer, { maxWidth: layout.contentMaxWidth, alignSelf: "center" as const, width: "100%", paddingHorizontal: layout.contentPadding }]}>
          <View style={styles.searchBar}>
            <Feather name="search" size={18} color={Colors.textMuted} style={styles.searchIcon} />
            <TextInput
              style={[styles.searchInput, { fontSize: ts.body }]}
              placeholder=""
              placeholderTextColor={Colors.textMuted}
              value={searchQuery}
              onChangeText={setSearchQuery}
              accessibilityLabel={t("a11y.searchRecordings")}
              accessibilityRole="search"
              testID="recordings-search-input"
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="search"
            />
            {searchQuery.length > 0 && (
              <Pressable
                onPress={() => setSearchQuery("")}
                accessibilityLabel={t("a11y.clearSearch")}
                accessibilityRole="button"
                testID="clear-recordings-search"
                hitSlop={8}
              >
                <Feather name="x" size={18} color={Colors.textSecondary} />
              </Pressable>
            )}
          </View>
        </View>
      )}

      {isLoading ? (
        <View style={{ paddingTop: 12, gap: 10 }}>
          {Array.from({ length: 5 }).map((_, i) => (
            <SkeletonCard key={i} index={i} reduceMotion={reduceMotion} />
          ))}
        </View>
      ) : recordings.length === 0 ? (
        <View style={styles.emptyWrapper}>
          <View style={styles.centerContent}>
            <Text style={[styles.emptyPrompt, { fontSize: ts.body }]}>
              {t("recordings.empty")}
            </Text>
          </View>
        </View>
      ) : (
        <FlatList
          data={filteredRecordings}
          keyExtractor={(item) => item.id}
          key={numColumns}
          numColumns={numColumns}
          columnWrapperStyle={numColumns > 1 ? { gap, justifyContent: "center" } : undefined}
          contentContainerStyle={{
            paddingHorizontal: listPadding,
            paddingBottom: insets.bottom + (Platform.OS === "web" ? 34 : 24) + 120,
            gap,
            maxWidth: layout.contentMaxWidth,
            alignSelf: "center",
            width: "100%",
          }}
          renderItem={({ item }) => (
            <RecordingCard
              item={item}
              onDelete={handleDelete}
              cardWidth={cardWidth}
              reduceMotion={reduceMotion}
              selectMode={selectMode}
              isSelected={selectedIds.has(item.id)}
              onToggleSelect={toggleSelected}
              onEnterSelect={enterSelectMode}
            />
          )}
          ListHeaderComponent={
            recordings.length > 0 ? (
              <View style={styles.listHeader}>
                <Text style={[styles.listHeaderText, { fontSize: ts.body }]}>
                  {t(getRecordingsCountKey(recordings.length), { count: recordings.length })}
                </Text>
              </View>
            ) : null
          }
        />
      )}

      {/* Fade overlay and floating record button */}
      {!selectMode && (
        <View style={styles.floatingRecordWrapper} pointerEvents="box-none">
          <LinearGradient
            colors={["transparent", Colors.background]}
            style={StyleSheet.absoluteFill}
            pointerEvents="none"
          />
          <View style={styles.floatingRecordInner} pointerEvents="box-none">
            <View
              style={[
                styles.floatingRecordButtonShell,
                {
                  width: floatingRecordOverlay.shellSize,
                  height: floatingRecordOverlay.shellSize,
                },
              ]}
              pointerEvents="box-none"
            >
              <View
                style={[
                  styles.floatingRecordOverlayLayer,
                  {
                    width: floatingRecordOverlay.maskSize,
                    height: floatingRecordOverlay.maskSize,
                  },
                ]}
                pointerEvents="none"
              >
                <Svg width="100%" height="100%" viewBox="0 0 100 100">
                  <Defs>
                    <RadialGradient id="floatingRecordMaskGradient" cx="50%" cy="50%" rx="50%" ry="50%">
                      <Stop offset="0%" stopColor={Colors.background} stopOpacity={floatingRecordOverlay.maskInnerOpacity} />
                      <Stop offset="72%" stopColor={Colors.background} stopOpacity={floatingRecordOverlay.maskMidOpacity} />
                      <Stop offset="100%" stopColor={Colors.background} stopOpacity={floatingRecordOverlay.maskOuterOpacity} />
                    </RadialGradient>
                  </Defs>
                  <Circle cx="50" cy="50" r="50" fill="url(#floatingRecordMaskGradient)" />
                </Svg>
              </View>
              <View
                style={[
                  styles.floatingRecordOverlayLayer,
                  {
                    width: floatingRecordOverlay.spotlightSize,
                    height: floatingRecordOverlay.spotlightSize,
                  },
                ]}
                pointerEvents="none"
              >
                <Svg width="100%" height="100%" viewBox="0 0 100 100">
                  <Defs>
                    <RadialGradient id="floatingRecordSpotlightGradient" cx="50%" cy="50%" rx="50%" ry="50%">
                      <Stop offset="0%" stopColor={Colors.background} stopOpacity={floatingRecordOverlay.spotlightInnerOpacity} />
                      <Stop offset="100%" stopColor={Colors.background} stopOpacity={floatingRecordOverlay.spotlightOuterOpacity} />
                    </RadialGradient>
                  </Defs>
                  <Circle cx="50" cy="50" r="50" fill="url(#floatingRecordSpotlightGradient)" />
                </Svg>
              </View>
            </View>
            <Pressable
              style={({ pressed }) => [
                styles.floatingRecordButton,
                pressed && styles.floatingRecordButtonPressed
              ]}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                router.push("/record");
              }}
              accessibilityLabel={t("a11y.recordNew")}
              accessibilityRole="button"
              testID="floating-record-button"
            >
              {({ pressed }) => (
                <Feather
                  name="mic"
                  size={32}
                  color={pressed ? "rgba(255, 255, 255, 0.8)" : "#fff"}
                />
              )}
            </Pressable>
          </View>
        </View>
      )}

      {selectMode && (
        <View style={[styles.selectionToolbar, { paddingBottom: insets.bottom + (Platform.OS === "web" ? 24 : 16) }]} accessibilityRole="toolbar">
          <View style={styles.selectionToolbarInner}>
            <Pressable
              style={({ pressed }) => [styles.selectionBtnGhost, pressed && { opacity: 0.7 }]}
              onPress={exitSelectMode}
              accessibilityLabel={t("combine.cancel")}
              accessibilityRole="button"
              testID="selection-cancel-button"
            >
              <Feather name="x" size={18} color={Colors.textSecondary} />
              <Text style={[styles.selectionBtnGhostText, { fontSize: ts.body2 }]}>{t("combine.cancel")}</Text>
            </Pressable>
            <Text style={[styles.selectionCountText, { fontSize: ts.body2 }]}>
              {t("combine.selectedCount", { count: selectedIds.size })}
            </Text>
            <View style={styles.selectionToolbarActions}>
              <Pressable
                style={({ pressed }) => [styles.selectionBtnDanger, pressed && { opacity: 0.7 }, selectedIds.size === 0 && { opacity: 0.4 }]}
                onPress={handleDeleteSelected}
                disabled={selectedIds.size === 0}
                accessibilityLabel={t("combine.deleteSelected")}
                accessibilityRole="button"
                testID="bulk-delete-button"
              >
                <Feather name="trash-2" size={16} color={Colors.error} />
              </Pressable>
              <Pressable
                style={({ pressed }) => [styles.selectionBtnPrimary, pressed && { opacity: 0.85 }, selectedIds.size === 0 && { opacity: 0.4 }]}
                onPress={handleCombineSelected}
                disabled={selectedIds.size === 0}
                accessibilityLabel={t(user ? "combine.continueButton" : "combine.guestContinueButton" as any)}
                accessibilityRole="button"
                testID="combine-selected-button"
              >
                <Feather name="git-merge" size={16} color="#fff" />
                <Text style={[styles.selectionBtnPrimaryText, { fontSize: ts.body2 }]}>
                  {t(user ? "combine.continueButton" : "combine.guestContinueButton" as any)}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      )}

      {activeNotification === "recordingLimit" && (
        <View style={[styles.recordingLimitToast, { bottom: insets.bottom + (Platform.OS === "web" ? 34 : 24) + 80 }]} accessibilityRole="alert" accessibilityLiveRegion="assertive">
          <View style={styles.recordingLimitToastIcon}>
            <Feather name="alert-circle" size={20} color="#f59e0b" />
          </View>
          <Text style={[styles.recordingLimitToastText, { fontSize: ts.body2 }]} numberOfLines={2}>{t("home.recordingLimitToast")}</Text>
          <Pressable onPress={() => setRecordingLimitToast(false)} hitSlop={8} accessibilityLabel="Dismiss" accessibilityRole="button">
            <Feather name="x" size={16} color={Colors.textMuted} />
          </Pressable>
        </View>
      )}

      {!drawerVisible && !feedbackVisible && (
        <View
          pointerEvents="box-none"
          style={{
            position: "absolute",
            bottom:
              insets.bottom +
              getFloatingActionBottomOffset(CORNER_TEXT_ACTION_SIZE),
            right: containedFabInset,
            zIndex: 1,
          }}
        >
          <FloatingActionHalo
            buttonSize={CORNER_TEXT_ACTION_SIZE}
            surface="scrolling"
          />
          <Pressable
            onPress={handleTypeToConvert}
            accessibilityLabel="Type to convert"
            accessibilityRole="button"
            style={({ pressed }) => [styles.textEntryFab, pressed && { opacity: 0.8 }]}
            testID="recordings-type-to-convert"
          >
            <Feather name="edit-2" size={24} color={Colors.white} />
          </Pressable>
        </View>
      )}

      <FeedbackIconButton
        hidden={drawerVisible}
        surface="scrolling"
        containerStyle={{ left: containedFeedbackInset }}
      />
      <ProfileDropdown visible={showProfileMenu} onClose={() => setShowProfileMenu(false)} />

      <NavigationDrawer
        visible={drawerVisible}
        onClose={() => setDrawerVisible(false)}
        isAdmin={isAdmin}
        isLoggedIn={!!user}
        planLabel={planLabel}
        isPro={isPaidPlan}
        onFeedback={openFeedback}
        onTypeToConvert={handleTypeToConvert}
      />
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
    paddingVertical: 16,
  },
  headerLeft: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  headerRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 20,
    flexShrink: 0,
    marginLeft: 12,
  },
  headerTitle: {
    fontSize: sf(28, ts),
    fontFamily: "Inter_700Bold",
    color: Colors.text,
    letterSpacing: -0.5,
  },
  typeToConvertBtn: {
    width: 56,
    height: 56,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.primary + "55",
    backgroundColor: Colors.primary + "12",
  },
  headerAvatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: "rgba(0, 180, 216, 0.15)",
    justifyContent: "center",
    alignItems: "center",
    overflow: "hidden",
  },
  headerAvatarText: {
    fontFamily: "Inter_700Bold",
    fontSize: sf(26, ts),
    color: Colors.primary,
  },
  searchContainer: {
    paddingVertical: 16,
  },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 8,
  },
  searchIcon: {
    marginRight: 4,
  },
  searchInput: {
    flex: 1,
    fontFamily: "Inter_400Regular",
    color: Colors.text,
  },
  centerContent: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 24,
  },
  emptyWrapper: {
    flex: 1,
  },
  emptyPrompt: {
    fontFamily: "Inter_500Medium",
    color: Colors.textSecondary,
    textAlign: "center",
    marginTop: 16,
  },
  listHeader: {
    paddingVertical: 16,
    paddingHorizontal: 4,
  },
  listHeaderText: {
    fontFamily: "Inter_600SemiBold",
    color: Colors.text,
  },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 16,
    elevation: 2,
    ...Platform.select({
      ios: { shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.1, shadowRadius: 4 },
      android: {},
      web: { boxShadow: "0 1px 4px rgba(0, 0, 0, 0.1)" },
    }),
  },
  cardPressed: {
    transform: [{ scale: 0.98 }],
    elevation: 1,
    ...Platform.select({
      ios: { shadowOpacity: 0.05 },
      android: {},
      web: { boxShadow: "0 1px 2px rgba(0, 0, 0, 0.05)" },
    }),
  },
  cardPressedReduced: {
    opacity: 0.8,
  },
  cardInner: {
    gap: 12,
  },
  cardHeaderRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
  },
  cardTitle: {
    fontFamily: "Inter_600SemiBold",
    color: Colors.text,
    flex: 1,
    marginRight: 8,
  },
  cardDate: {
    fontFamily: "Inter_400Regular",
    color: Colors.textMuted,
  },
  cardContentRow: {
    gap: 8,
  },
  cardMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  cardDuration: {
    fontFamily: "Inter_500Medium",
    color: Colors.textSecondary,
  },
  cardConversions: {
    fontFamily: "Inter_500Medium",
    color: Colors.primary,
  },
  cardTranscript: {
    fontFamily: "Inter_400Regular",
    color: Colors.textSecondary,
    lineHeight: 16,
  },
  hamburgerBtn: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: Colors.surface,
    justifyContent: "center",
    alignItems: "center",
  },
  recordingLimitToast: {
    position: "absolute",
    bottom: 0,
    left: 16,
    right: 16,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 12,
    elevation: 8,
    ...Platform.select({
      ios: { shadowColor: "#000", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 12 },
      android: {},
      web: { boxShadow: "0 4px 12px rgba(0, 0, 0, 0.2)" },
    }),
  },
  recordingLimitToastIcon: {
    marginRight: 8,
  },
  recordingLimitToastText: {
    flex: 1,
    fontFamily: "Inter_400Regular",
    color: Colors.text,
  },
  subscriptionBanner: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 12,
    marginHorizontal: 16,
    marginBottom: 12,
    padding: 16,
  },
  floatingRecordWrapper: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    height: "35%", // covers about bottom third of screen to fade out items below it
    justifyContent: "flex-end",
  },
  floatingRecordInner: {
    alignItems: "center",
    justifyContent: "center",
    paddingBottom: "15%", // Pushes button to roughly 1/3 up from the bottom (when considering whole screen)
  },
  floatingRecordButtonShell: {
    position: "absolute",
    alignItems: "center",
    justifyContent: "center",
    overflow: "visible",
  },
  floatingRecordOverlayLayer: {
    position: "absolute",
    alignItems: "center",
    justifyContent: "center",
  },
  floatingRecordButton: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: Colors.recording || "#eb5146",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1,
    elevation: 8,
    ...Platform.select({
      ios: { shadowColor: "#000", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8 },
      web: { boxShadow: "0 4px 16px rgba(0, 0, 0, 0.3)" },
    }),
  },
  floatingRecordButtonPressed: {
    transform: [{ scale: 0.95 }],
  },
  cardSelected: {
    borderColor: Colors.primary,
    backgroundColor: "rgba(0, 180, 216, 0.08)",
  },
  selectCheckbox: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 8,
  },
  selectCheckboxOn: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  selectionToolbar: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: Colors.surface,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    paddingTop: 12,
    paddingHorizontal: 16,
    ...Platform.select({
      ios: { shadowColor: "#000", shadowOffset: { width: 0, height: -2 }, shadowOpacity: 0.1, shadowRadius: 6 },
      web: { boxShadow: "0 -2px 12px rgba(0, 0, 0, 0.08)" },
    }),
  },
  selectionToolbarInner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    maxWidth: 720,
    width: "100%",
    alignSelf: "center",
  },
  selectionToolbarActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  selectionBtnGhost: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 8,
  },
  selectionBtnGhostText: {
    fontFamily: "Inter_500Medium",
    color: Colors.textSecondary,
  },
  selectionCountText: {
    fontFamily: "Inter_600SemiBold",
    color: Colors.text,
    flex: 1,
    textAlign: "center",
  },
  selectionBtnDanger: {
    width: 40,
    height: 40,
    borderRadius: 8,
    backgroundColor: "rgba(235, 81, 70, 0.1)",
    alignItems: "center",
    justifyContent: "center",
  },
  selectionBtnPrimary: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: Colors.primary,
  },
  selectionBtnPrimaryText: {
    fontFamily: "Inter_600SemiBold",
    color: "#fff",
  },
  textEntryFab: {
    width: CORNER_TEXT_ACTION_SIZE,
    height: CORNER_TEXT_ACTION_SIZE,
    borderRadius: CORNER_TEXT_ACTION_SIZE / 2,
    backgroundColor: Colors.primary,
    justifyContent: "center",
    alignItems: "center",
    elevation: 5,
    ...Platform.select({
      ios: { shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.25, shadowRadius: 4 },
      web: { boxShadow: "0 2px 10px rgba(0,0,0,0.2)" },
    }),
  },
});

function SubscriptionBanner({ type, onDismiss }: { type: "success" | "cancelled"; onDismiss: () => void }) {
  const ts = useTextScale();
  const styles = useMemo(() => makeStyles(ts), [ts]);

  return (
    <Animated.View style={[styles.subscriptionBanner, { backgroundColor: type === "success" ? "#10b981" : "#f59e0b" }]}>
      <View style={{ flex: 1 }}>
        <Text style={{ color: "#fff", fontFamily: "Inter_600SemiBold", fontSize: sf(15, ts), marginBottom: 2 }}>
          {type === "success" ? "Subscription activated!" : "Checkout cancelled"}
        </Text>
        <Text style={{ color: "rgba(255,255,255,0.9)", fontFamily: "Inter_400Regular", fontSize: sf(13, ts) }}>
          {type === "success"
            ? "Your subscription is active. Base, Pro, and Cloud Sync changes are now available on your account."
            : "No worries — you can update your plan anytime from Settings."}
        </Text>
      </View>
      <Pressable onPress={onDismiss} hitSlop={12} accessibilityLabel="Dismiss" accessibilityRole="button">
        <Feather name="x" size={18} color="rgba(255,255,255,0.8)" />
      </Pressable>
    </Animated.View>
  );
}
