import React, { useState, useCallback, useMemo, useEffect, useRef } from "react";
import {
  StyleSheet,
  Text,
  View,
  Pressable,
  Platform,
  ActivityIndicator,
  Animated,
  PanResponder,
  Image,
  Dimensions,
} from "react-native";
import { router, useLocalSearchParams } from "@/lib/navigation";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Feather from "@react-native-vector-icons/feather/static";
import * as Haptics from "@/lib/haptics";
import Colors from "@/constants/colors";
import { useLanguage } from "@/lib/i18n";
import AsyncStorage from "@react-native-async-storage/async-storage";
import AvatarView from "@/components/AvatarView";
import { useRecordings } from "@/lib/recordings-context";
import { useResponsiveLayout } from "@/lib/useResponsiveLayout";
import { useAuth } from "@/lib/auth-context";
import { useQuery } from "@tanstack/react-query";
import { useTextScale, sf, type TextScale } from "@/lib/typography";

import NavigationDrawer from "@/components/NavigationDrawer";
import FeedbackIconButton from "@/components/FeedbackIconButton";
import ProfileDropdown from "@/components/ProfileDropdown";
import { useFeedback } from "@/lib/feedback-context";
import {
  CORNER_TEXT_ACTION_SIZE,
  getFloatingActionBottomOffset,
} from "@/constants/record-layout";

import logoTransparent from "@/assets/images/icons-xai/105-transparent.png";

function SubscriptionBanner({ type, onDismiss }: { type: "success" | "cancelled"; onDismiss: () => void }) {
  const ts = useTextScale();
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const isSuccess = type === "success";

  useEffect(() => {
    Animated.timing(fadeAnim, { toValue: 1, duration: 300, useNativeDriver: true }).start();
    const timer = setTimeout(() => {
      Animated.timing(fadeAnim, { toValue: 0, duration: 300, useNativeDriver: true }).start(() => onDismiss());
    }, 6000);
    return () => clearTimeout(timer);
  }, [fadeAnim, onDismiss]);

  return (
    <Animated.View
      style={{
        opacity: fadeAnim,
        backgroundColor: isSuccess ? "#059669" : "#d97706",
        borderRadius: 12,
        marginHorizontal: 16,
        marginBottom: 12,
        padding: 16,
        flexDirection: "row",
        alignItems: "center",
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.15,
        shadowRadius: 6,
        elevation: 4,
      }}
      accessibilityRole="alert"
      accessibilityLiveRegion="assertive"
    >
      <Feather
        name={isSuccess ? "check-circle" : "alert-circle"}
        size={22}
        color="#fff"
        style={{ marginRight: 12 }}
      />
      <View style={{ flex: 1 }}>
        <Text style={{ color: "#fff", fontFamily: "Inter_600SemiBold", fontSize: sf(15, ts), marginBottom: 2 }}>
          {isSuccess ? "Subscription activated!" : "Checkout cancelled"}
        </Text>
        <Text style={{ color: "rgba(255,255,255,0.9)", fontFamily: "Inter_400Regular", fontSize: sf(13, ts) }}>
          {isSuccess
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

const SLIDE_TRACK_WIDTH = 280;
const SLIDE_THUMB_SIZE = 80;
const SLIDE_THRESHOLD = SLIDE_TRACK_WIDTH - SLIDE_THUMB_SIZE - 20;

function SlideToRecord({ onSlideComplete }: { onSlideComplete: () => void }) {
  const translateX = useRef(new Animated.Value(0)).current;
  const hasTriggered = useRef(false);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderMove: (_e, gestureState) => {
        const clamped = Math.max(0, Math.min(gestureState.dx, SLIDE_THRESHOLD));
        translateX.setValue(clamped);
      },
      onPanResponderRelease: (_e, gestureState) => {
        if (gestureState.dx >= SLIDE_THRESHOLD && !hasTriggered.current) {
          hasTriggered.current = true;
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
          onSlideComplete();
          // Reset after navigation
          setTimeout(() => {
            translateX.setValue(0);
            hasTriggered.current = false;
          }, 500);
        } else {
          Animated.spring(translateX, {
            toValue: 0,
            useNativeDriver: true,
            tension: 40,
            friction: 6,
          }).start();
        }
      },
    })
  ).current;

  return (
    <View style={slideStyles.wrapper}>
      <Image
        source={logoTransparent}
        style={slideStyles.logo}
        resizeMode="contain"
        testID="home-logo"
      />
      <View style={slideStyles.track} testID="home-slide-track">
        <Animated.View
          style={[slideStyles.chevronHints]}
          pointerEvents="none"
        >
          <Feather name="chevrons-right" size={20} color={Colors.textMuted} style={{ opacity: 0.4 }} />
        </Animated.View>
        <Animated.View
          style={[slideStyles.thumb, { transform: [{ translateX }] }]}
          {...panResponder.panHandlers}
        >
          <View style={slideStyles.thumbCircle}>
            <Feather name="mic" size={36} color={Colors.white} />
          </View>
        </Animated.View>
      </View>
    </View>
  );
}

const slideStyles = StyleSheet.create({
  wrapper: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  logo: {
    width: 144,
    height: 144,
    marginBottom: 116,
    // Restored logo (2026-08-14): layout box (120px + 140px margin) keeps the
    // slider exactly where it was with paddingTop:260; the -80 translateY
    // lifts the logo visually ~30px higher than the pre-removal -50, landing
    // its center ~70% up the screen (was ~67%).
    // Enlarged 20% (2026-08-15): 120→144, marginBottom 140→116 (box stays
    // 260px → slider unmoved), translateY -80→-92 (keeps visual center fixed
    // despite the 24px taller box).
    transform: [{ translateY: -92 }],
  },
  track: {
    width: SLIDE_TRACK_WIDTH,
    height: SLIDE_THUMB_SIZE + 16,
    borderRadius: (SLIDE_THUMB_SIZE + 16) / 2,
    backgroundColor: "rgba(19, 34, 64, 0.5)",
    borderWidth: 1,
    borderColor: Colors.border,
    justifyContent: "center",
    paddingHorizontal: 8,
  },
  chevronHints: {
    position: "absolute",
    right: 24,
    top: 0,
    bottom: 0,
    justifyContent: "center",
  },
  thumb: {
    width: SLIDE_THUMB_SIZE,
    height: SLIDE_THUMB_SIZE,
  },
  thumbCircle: {
    width: SLIDE_THUMB_SIZE,
    height: SLIDE_THUMB_SIZE,
    borderRadius: SLIDE_THUMB_SIZE / 2,
    backgroundColor: Colors.recording,
    justifyContent: "center",
    alignItems: "center",
    ...Platform.select({
      ios: { shadowColor: Colors.recording, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.35, shadowRadius: 14 },
      android: { elevation: 8 },
      web: { boxShadow: `0 4px 24px ${Colors.recordingGlow}` },
    }),
  },
});

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const { t } = useLanguage();
  const { recordings, isLoading, lastRecordingLimitEvent, isCloudSyncEnabled } = useRecordings();
  const { user, logout, isLoading: isAuthLoading } = useAuth();
  const layout = useResponsiveLayout();
  const ts = useTextScale();
const [displayName, setDisplayName] = useState(false);
   useEffect(() => {
     AsyncStorage.getItem("showNameInHeader").then((v: string | null) => { if (v === "true") setDisplayName(true); }).catch(() => {});
   }, []);
  const styles = useMemo(() => makeStyles(ts), [ts]);
  const webTopInset = Platform.OS === "web" ? 67 : 0;
  const isTablet = Dimensions.get("window").width >= 600;
  const containedFabInset = layout.isMobile ? 24 : layout.contentPadding;
  const containedFeedbackInset = layout.isMobile ? 40 : layout.contentPadding;
  const { openFeedback, feedbackVisible } = useFeedback();
  const [drawerVisible, setDrawerVisible] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [subscriptionBanner, setSubscriptionBanner] = useState<"success" | "cancelled" | null>(null);
  const [recordingLimitToast, setRecordingLimitToast] = useState(false);

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

  const handleTypeToConvert = useCallback(async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const newId = Date.now().toString() + Math.random().toString(36).substr(2, 9);
    router.push({ pathname: "/recording/[id]", params: { id: newId, mode: "text" } });
  }, []);

  const handleFallbackSignOut = useCallback(async () => {
    await logout().catch(() => {});
    router.replace("/login");
  }, [logout]);

  const handleFallbackSignIn = useCallback(() => {
    router.replace("/login");
  }, []);

  if (!user && isAuthLoading) {
    return (
      <View style={[styles.container, styles.centerContent, { paddingTop: insets.top + webTopInset }]}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  if (!user && Platform.OS !== "web") {
    return (
      <View style={[styles.container, styles.centerContent, { paddingTop: insets.top + webTopInset }]}>
        <View style={styles.authFallbackPanel}>
          <View style={styles.authFallbackIcon}>
            <Feather name="log-out" size={28} color={Colors.primary} />
          </View>
          <Text style={styles.authFallbackTitle}>Session recovery</Text>
          <Text style={styles.authFallbackText}>
            This screen should only be visible if the app reached a protected area without an active session.
          </Text>
          <Pressable
            style={({ pressed }) => [styles.authFallbackPrimary, pressed && { opacity: 0.85 }]}
            onPress={handleFallbackSignOut}
            accessibilityLabel={t("settings.signOut")}
            accessibilityRole="button"
          >
            <Text style={styles.authFallbackPrimaryText}>{t("settings.signOut")}</Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.authFallbackSecondary, pressed && { opacity: 0.85 }]}
            onPress={handleFallbackSignIn}
            accessibilityLabel={t("login.signIn")}
            accessibilityRole="button"
          >
            <Text style={styles.authFallbackSecondaryText}>{t("login.signIn")}</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top + webTopInset }]}>
      <View style={[styles.appShell, { maxWidth: layout.contentMaxWidth }]} pointerEvents="box-none">
      <View style={[styles.header, { width: "100%", paddingHorizontal: layout.contentPadding }]}>
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
            <Text style={[styles.headerTitle, { fontSize: Math.round(ts.heading * 16 / 9) }]} accessibilityRole="header">
              {displayName && user?.firstName ? user.firstName : "Proset"}
            </Text>
          </Pressable>
        </View>
        <View style={styles.headerRight}>
          {isTablet && (
          <Pressable
            style={({ pressed }) => [styles.headerBtn, pressed && { opacity: 0.7 }]}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              router.push("/recordings");
            }}
            accessibilityLabel={t("app.recordings")}
            accessibilityRole="button"
            testID="recordings-button"
          >
            <Feather name="list" size={20} color={Colors.textSecondary} />
          </Pressable>
          )}
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

      {/* Profile dropdown menu */}
      <ProfileDropdown visible={showProfileMenu} onClose={() => setShowProfileMenu(false)} />

      {activeNotification === "subscription" && subscriptionBanner && (
        <View style={{ maxWidth: layout.contentMaxWidth, alignSelf: "center" as const, width: "100%" }}>
          <SubscriptionBanner type={subscriptionBanner} onDismiss={() => setSubscriptionBanner(null)} />
        </View>
      )}

      {isLoading ? (
        <View style={styles.centerContent}>
          <ActivityIndicator size="large" color={Colors.primary} />
        </View>
      ) : (
        <SlideToRecord onSlideComplete={() => router.push("/record")} />

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
            <Pressable
              style={({ pressed }) => [styles.textEntryFab, pressed && { opacity: 0.8 }]}
              onPress={handleTypeToConvert}
              accessibilityLabel="Type to convert"
              accessibilityRole="button"
              testID="home-type-to-convert"
            >
              <Feather name="edit-2" size={24} color={Colors.white} />
            </Pressable>
          </View>
          )}

          <FeedbackIconButton
            hidden={drawerVisible}
            surface="solid"
            containerStyle={{ left: containedFeedbackInset }}
          />
      </View>

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
    alignItems: "center",
  },
  appShell: {
    flex: 1,
    width: "100%",
    alignSelf: "center",
    position: "relative",
  },
  header: {
    paddingBottom: 20,
    paddingTop: 16,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  headerRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 24,
  },
  langToggle: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.surface,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 8,
    paddingVertical: 5,
    gap: 3,
  },
  langToggleSegment: {
    fontFamily: "Inter_600SemiBold",
    color: Colors.textMuted,
    letterSpacing: 0.3,
  },
  langToggleActive: {
    color: Colors.primary,
  },
  langToggleDivider: {
    color: Colors.border,
    fontFamily: "Inter_400Regular",
  },
  hamburgerBtn: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: Colors.surface,
    justifyContent: "center",
    alignItems: "center",
  },
  headerTitle: {
    fontSize: sf(28, ts),
    fontFamily: "Inter_700Bold",
    color: Colors.text,
    letterSpacing: -0.5,
  },
  headerBtn: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: Colors.surface,
    justifyContent: "center",
    alignItems: "center",
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
  profileMenu: {
    position: "absolute",
    top: 120,
    right: 16,
    backgroundColor: "#0F1E33",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(0,180,216,0.15)",
    paddingVertical: 6,
    minWidth: 180,
    zIndex: 100,
    ...Platform.select({ web: { boxShadow: "0 4px 24px rgba(0,0,0,0.4)" } as any, default: { shadowColor: "#000", shadowOpacity: 0.3, shadowRadius: 12, elevation: 10 } as any }),
  },
  profileMenuItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  profileMenuItemText: {
    fontFamily: "Inter_500Medium",
    fontSize: sf(14, ts),
    color: Colors.textSecondary,
  },
  emptyWrapper: {
    flex: 1,
  },
  recordButtonContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 16,
  },
  recordCard: {
    backgroundColor: Colors.surface,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingVertical: 40,
    paddingHorizontal: 32,
    alignItems: "center",
    width: "100%",
    maxWidth: 420,
    ...Platform.select({
      ios: {
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.25,
        shadowRadius: 16,
      },
      android: {
        elevation: 6,
      },
      web: {
        boxShadow: "0 10px 30px rgba(0, 0, 0, 0.3), inset 0 1px 1px rgba(255, 255, 255, 0.05)",
      },
    }),
  },
  helperText: {
    color: Colors.text,
    marginTop: 20,
    fontFamily: "Inter_600SemiBold",
  },
  helperSubtext: {
    color: Colors.textMuted,
    marginTop: 8,
    textAlign: "center",
    opacity: 0.85,
    fontFamily: "Inter_400Regular",
  },
  centerContent: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 24,
  },
  authFallbackPanel: {
    width: "100%",
    maxWidth: 360,
    alignItems: "center",
    backgroundColor: Colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 24,
  },
  authFallbackIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0, 180, 216, 0.12)",
    marginBottom: 16,
  },
  authFallbackTitle: {
    fontFamily: "Inter_700Bold",
    fontSize: sf(20, ts),
    color: Colors.text,
    marginBottom: 8,
    textAlign: "center",
  },
  authFallbackText: {
    fontFamily: "Inter_400Regular",
    fontSize: sf(14, ts),
    lineHeight: sf(20, ts),
    color: Colors.textSecondary,
    textAlign: "center",
    marginBottom: 20,
  },
  authFallbackPrimary: {
    width: "100%",
    minHeight: 48,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.primary,
    marginBottom: 10,
  },
  authFallbackPrimaryText: {
    fontFamily: "Inter_700Bold",
    fontSize: sf(15, ts),
    color: Colors.white,
  },
  authFallbackSecondary: {
    width: "100%",
    minHeight: 48,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: Colors.border,
  },
  authFallbackSecondaryText: {
    fontFamily: "Inter_600SemiBold",
    fontSize: sf(15, ts),
    color: Colors.textSecondary,
  },
  emptyRecordButton: {
    marginBottom: 8,
    borderRadius: 80,
    overflow: "hidden",
    elevation: 8,
    ...Platform.select({
      ios: { shadowColor: Colors.recording, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.35, shadowRadius: 14 },
      android: {},
      web: { boxShadow: `0 4px 24px ${Colors.recordingGlow}` },
    }),
  },
  emptyRecordButtonPressed: {
    transform: [{ scale: 0.92 }],
    opacity: 0.9,
  },
  emptyRecordCircle: {
    width: 160,
    height: 160,
    borderRadius: 80,
    backgroundColor: Colors.recording,
    justifyContent: "center",
    alignItems: "center",
  },
  textEntryFab: {
    width: CORNER_TEXT_ACTION_SIZE,
    height: CORNER_TEXT_ACTION_SIZE,
    borderRadius: CORNER_TEXT_ACTION_SIZE / 2,
    backgroundColor: Colors.primary,
    justifyContent: "center",
    alignItems: "center",
  },
  emptyPrompt: {
    fontFamily: "Inter_400Regular",
    color: Colors.textSecondary,
    textAlign: "center",
  },
  recordingLimitToast: {
    position: "absolute",
    left: 16,
    right: 16,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.surface,
    borderWidth: 0,
    borderRadius: 12,
    padding: 12,
    gap: 10,
    maxWidth: 400,
    alignSelf: "center",
    ...Platform.select({
      ios: { shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 4 },
      android: { elevation: 3 },
      web: { boxShadow: "0 2px 12px rgba(0,0,0,0.15)" },
    }),
  },
  recordingLimitToastIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "rgba(245,158,11,0.12)",
    alignItems: "center",
    justifyContent: "center",
  },
  recordingLimitToastText: {
    flex: 1,
    fontFamily: "Inter_400Regular",
    color: Colors.text,
  },
});
