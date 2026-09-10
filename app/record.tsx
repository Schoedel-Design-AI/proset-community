import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  StyleSheet,
  Text,
  View,
  Pressable,
  Platform,
  ActivityIndicator,
  Alert,
} from "react-native";
import { router, useLocalSearchParams } from "@/lib/navigation";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Feather from "@react-native-vector-icons/feather/static";
import * as Haptics from "@/lib/haptics";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  withSequence,
  Easing,
  cancelAnimation,
} from "react-native-reanimated";
import Colors from "@/constants/colors";
import { useAuth } from "@/lib/auth-context";
import AvatarView from "@/components/AvatarView";
import { useLanguage } from "@/lib/i18n";
import { generateId, formatDuration } from "@/lib/utils";
import { useResponsiveLayout } from "@/lib/useResponsiveLayout";
import { useReducedMotion } from "@/lib/useReducedMotion";
import { useTextScale, sf, type TextScale } from "@/lib/typography";
import { useActiveRecording } from "@/lib/active-recording-context";
import { featureFlags } from "@/lib/feature-flags";
import { shouldPromptDiscardOnLeave } from "@/lib/record-navigation";
import FeedbackIconButton from "@/components/FeedbackIconButton";
import ProfileDropdown from "@/components/ProfileDropdown";
import NavigationDrawer from "@/components/NavigationDrawer";
import { useFeedback } from "@/lib/feedback-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  addRecordingToThoughtThread,
  enqueuePendingThoughtThreadAttachment,
} from "@/lib/thought-threads";
import {
  COMPOSE_ACTION_BOTTOM_OFFSET,
  COMPOSE_ACTION_SIZE,
  FLOATING_ACTION_ROW_TOP_OFFSET,
  RECORD_CARD_CONTENT_BOTTOM_PADDING,
  RECORD_CARD_CONTENT_TOP_PADDING,
  RECORD_CARD_EDGE_GAP,
  RECORDING_INDICATOR_BOTTOM_GAP,
} from "@/constants/record-layout";
import { scaleVisualizerLevel } from "@/lib/audio-metering";

const visualizerBarStyle = {
  flex: 1,
  maxWidth: 5,
  borderRadius: 2.5,
  backgroundColor: Colors.recording,
};

const NUM_BARS = 40;

function buildBarsFromLevel(normalized: number): number[] {
  const center = (NUM_BARS - 1) / 2;
  const responsiveLevel = scaleVisualizerLevel(normalized);
  const nextHeights: number[] = [];
  for (let i = 0; i < NUM_BARS; i++) {
    const distFromCenter = Math.abs(i - center) / center;
    const variation = (Math.random() * 0.3 + 0.85);
    const envelope = Math.pow(Math.cos(distFromCenter * Math.PI * 0.5), 1.8);
    nextHeights.push(Math.max(2, responsiveLevel * 80 * envelope * variation));
  }
  return nextHeights;
}

export default function RecordScreen() {
  const params = useLocalSearchParams<{ threadId?: string }>();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const layout = useResponsiveLayout();
  const reduceMotion = useReducedMotion();
  const { t, language } = useLanguage();
  const ts = useTextScale();
  const { feedbackVisible } = useFeedback();
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [drawerVisible, setDrawerVisible] = useState(false);
  const [showUpgradeHint, setShowUpgradeHint] = useState(false);
  const styles = useMemo(() => makeStyles(ts), [ts]);

  // The active-recording session is owned by the provider so it can survive
  // navigation (web today; mobile gated by the `persistentRecording` flag).
  const recording = useActiveRecording();
  const {
    state,
    duration,
    meteringLevel,
    maxRecordingSeconds,
    webErrorMessage,
    completionVersion,
    start: startRecording,
    pause: pauseRecording,
    resume: resumeRecording,
    stop: stopActiveRecording,
    discard: discardActiveRecording,
    clearWebError,
    notifyScreenUnmounted,
  } = recording;

  // Show upgrade hint when recording has ≤60s remaining and user is on free tier
  const remaining = state === "recording" ? maxRecordingSeconds - duration : maxRecordingSeconds;
  const isFreeTier = maxRecordingSeconds <= 300;
  const showLimitWarning = isFreeTier && state === "recording" && remaining <= 60 && remaining > 0;

  const formatSpokenDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    const parts: string[] = [];
    if (language === "es") {
      if (mins > 0) parts.push(`${mins} ${mins === 1 ? "minuto" : "minutos"}`);
      if (secs > 0 || mins === 0) parts.push(`${secs} ${secs === 1 ? "segundo" : "segundos"}`);
    } else {
      if (mins > 0) parts.push(`${mins} ${mins === 1 ? "minute" : "minutes"}`);
      if (secs > 0 || mins === 0) parts.push(`${secs} ${secs === 1 ? "second" : "seconds"}`);
    }
    return parts.join(" ");
  };
  const webTopInset = Platform.OS === "web" ? 67 : 0;
  const containedFeedbackInset = layout.isMobile ? 40 : 20;

  // Visualizer bars are driven by the provider's meteringLevel updates.
  const [barHeights, setBarHeights] = useState<number[]>(() => Array(NUM_BARS).fill(4));
  useEffect(() => {
    if (state === "recording") {
      setBarHeights(buildBarsFromLevel(meteringLevel));
    }
  }, [meteringLevel, state]);
  useEffect(() => {
    if (state !== "recording") {
      setBarHeights(Array(NUM_BARS).fill(2));
    }
  }, [state]);

  const pulseScale = useSharedValue(1);
  const breatheScale = useSharedValue(1);
  const ringScale1 = useSharedValue(1);
  const ringScale2 = useSharedValue(1);
  const ringOpacity1 = useSharedValue(0);
  const ringOpacity2 = useSharedValue(0);

  const pulseStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pulseScale.value }],
  }), [pulseScale]);

  const breatheStyle = useAnimatedStyle(() => ({
    transform: [{ scale: breatheScale.value }],
  }), [breatheScale]);

  const ring1Style = useAnimatedStyle(() => ({
    transform: [{ scale: ringScale1.value }],
    opacity: ringOpacity1.value,
  }), [ringScale1, ringOpacity1]);

  const ring2Style = useAnimatedStyle(() => ({
    transform: [{ scale: ringScale2.value }],
    opacity: ringOpacity2.value,
  }), [ringScale2, ringOpacity2]);
  const animatedPulseStyle = Platform.OS === "web" ? null : pulseStyle;
  const animatedBreatheStyle = Platform.OS === "web" ? null : breatheStyle;
  const animatedRing1Style = Platform.OS === "web" ? null : ring1Style;
  const animatedRing2Style = Platform.OS === "web" ? null : ring2Style;

  const startPulseAnimation = useCallback(() => {
    if (Platform.OS === "web" || reduceMotion) return;
    pulseScale.value = withRepeat(
      withSequence(
        withTiming(1.08, { duration: 800, easing: Easing.inOut(Easing.ease) }),
        withTiming(1, { duration: 800, easing: Easing.inOut(Easing.ease) })
      ),
      -1
    );
    ringScale1.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 0 }),
        withTiming(2.2, { duration: 1600, easing: Easing.out(Easing.ease) })
      ),
      -1
    );
    ringOpacity1.value = withRepeat(
      withSequence(
        withTiming(0.4, { duration: 0 }),
        withTiming(0, { duration: 1600, easing: Easing.out(Easing.ease) })
      ),
      -1
    );
    ringScale2.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 0 }),
        withTiming(2.2, { duration: 1600, easing: Easing.out(Easing.ease) })
      ),
      -1
    );
    ringOpacity2.value = withRepeat(
      withSequence(
        withTiming(0, { duration: 800 }),
        withTiming(0.3, { duration: 0 }),
        withTiming(0, { duration: 800, easing: Easing.out(Easing.ease) })
      ),
      -1
    );
  }, [reduceMotion, pulseScale, ringScale1, ringScale2, ringOpacity1, ringOpacity2]);

  const stopPulseAnimation = useCallback(() => {
    if (Platform.OS === "web") return;
    cancelAnimation(pulseScale);
    cancelAnimation(ringScale1);
    cancelAnimation(ringScale2);
    cancelAnimation(ringOpacity1);
    cancelAnimation(ringOpacity2);
    pulseScale.value = withTiming(1, { duration: 200 });
    ringOpacity1.value = withTiming(0, { duration: 200 });
    ringOpacity2.value = withTiming(0, { duration: 200 });
  }, [pulseScale, ringScale1, ringScale2, ringOpacity1, ringOpacity2]);

  // Idle breathing animation — subtle scale pulse when not recording
  const startIdleBreathing = useCallback(() => {
    if (Platform.OS === "web" || reduceMotion) return;
    breatheScale.value = withRepeat(
      withSequence(
        withTiming(1.04, { duration: 1250, easing: Easing.inOut(Easing.ease) }),
        withTiming(1, { duration: 1250, easing: Easing.inOut(Easing.ease) })
      ),
      -1
    );
  }, [reduceMotion, breatheScale]);

  const stopIdleBreathing = useCallback(() => {
    if (Platform.OS === "web") return;
    cancelAnimation(breatheScale);
    breatheScale.value = withTiming(1, { duration: 150 });
  }, [breatheScale]);

  // Reattach: when this screen mounts (or remounts) during an active session,
  // make sure the recording animations match the provider's current state.
  useEffect(() => {
    if (state === "recording") {
      startPulseAnimation();
      stopIdleBreathing();
    } else if (state === "paused" || state === "processing" || state === "preparing") {
      stopPulseAnimation();
      stopIdleBreathing();
    } else {
      stopPulseAnimation();
      startIdleBreathing();
    }
  }, [state, startPulseAnimation, stopPulseAnimation, startIdleBreathing, stopIdleBreathing]);

  // When a recording is successfully finalized, navigate directly to its detail
  // page so the user sees it saved and can convert or wait for transcription.
  const seenCompletionRef = useRef(completionVersion);
  useEffect(() => {
    if (completionVersion !== null && completionVersion !== seenCompletionRef.current) {
      seenCompletionRef.current = completionVersion;
      if (params.threadId && user) {
        const destination = {
          pathname: "/thought-thread/[id]" as any,
          params: { id: params.threadId },
        };
        addRecordingToThoughtThread(params.threadId, completionVersion)
          .then(() => router.replace(destination))
          .catch(async (error) => {
            await enqueuePendingThoughtThreadAttachment(
              params.threadId!,
              completionVersion,
              error instanceof Error ? error.message : undefined,
            );
            router.replace({
              ...destination,
              params: { id: params.threadId, attachmentError: "1" },
            });
          });
        return;
      }
      router.replace({
        pathname: "/recording/[id]",
        params: { id: completionVersion },
      });
    }
  }, [completionVersion, params.threadId, user]);

  // Honor the persistentRecording feature flag on unmount. With flag OFF the
  // provider will discard the active session (legacy behavior); with flag ON
  // the recording continues to run across navigation.
  useEffect(() => {
    return () => {
      notifyScreenUnmounted();
    };
  }, [notifyScreenUnmounted]);

  const confirmDiscardActiveRecording = useCallback((next: () => void, leaving: boolean = true) => {
    if (leaving && !shouldPromptDiscardOnLeave(state, featureFlags.persistentRecording)) {
      next();
      return;
    }

    if (state !== "recording" && state !== "paused") {
      next();
      return;
    }

    const doDiscard = async () => {
      await discardActiveRecording();
      next();
    };

    const promptMessage = leaving
      ? t("record.discardLeaveMessage")
      : t("record.discardConfirmMessage");

    if (Platform.OS === "web") {
      const confirmed = typeof window !== "undefined"
        ? window.confirm(promptMessage)
        : true;
      if (confirmed) {
        void doDiscard();
      }
      return;
    }

    Alert.alert(
      t("record.discardTitle"),
      promptMessage,
      [
        { text: leaving ? t("record.stay") : t("common.cancel"), style: "cancel" },
        { text: t("record.discard"), style: "destructive", onPress: () => { void doDiscard(); } },
      ]
    );
  }, [discardActiveRecording, state, t]);

  const handleTypeToConvert = useCallback(() => {
    clearWebError();
    confirmDiscardActiveRecording(() => {
      router.push({
        pathname: "/recording/[id]",
        params: { id: generateId(), mode: "text" },
      });
    });
  }, [clearWebError, confirmDiscardActiveRecording]);

  const handleStartRecording = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    void startRecording();
  }, [startRecording]);

  const handlePauseRecording = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    void pauseRecording();
  }, [pauseRecording]);

  const handleResumeRecording = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    void resumeRecording();
  }, [resumeRecording]);

  const handleStopRecording = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    void stopActiveRecording();
  }, [stopActiveRecording]);

  const handleRecordPress = () => {
    if (state === "recording") {
      handlePauseRecording();
    } else if (state === "paused") {
      handleResumeRecording();
    } else if (state === "idle") {
      handleStartRecording();
    }
    // "preparing" and "processing" states — button press is ignored
  };

  const recordButtonAccessibilityLabel =
    state === "idle"
      ? t("a11y.startRecording")
      : state === "recording"
        ? t("a11y.pauseRecording")
        : state === "paused"
          ? t("a11y.resumeRecording")
          : t("a11y.processingRecording");

  return (
    <View style={[styles.container, { paddingTop: insets.top + webTopInset }]}>
      <View style={[styles.appShell, { maxWidth: layout.contentMaxWidth }]} pointerEvents="box-none">
        <View style={styles.topBar} testID="record-page-header">
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Pressable
              onPress={() => setDrawerVisible(true)}
              style={styles.backButton}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel={t("drawer.openMenu")}
            >
              <Feather name="menu" size={22} color={Colors.textSecondary} />
            </Pressable>
            <Pressable
              onPress={() => confirmDiscardActiveRecording(() => router.back())}
              style={styles.backButton}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel={t("a11y.closeRecording")}
            >
              <Feather name="x" size={24} color={Colors.text} />
            </Pressable>
          </View>
          <View style={styles.topBarActions}>
            <Pressable
              style={({ pressed }) => [styles.headerAvatar, pressed && { opacity: 0.7 }, state === "processing" && { opacity: 0.5 }]}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setShowProfileMenu(!showProfileMenu);
              }}
              accessibilityLabel={t("a11y.settings")}
              accessibilityRole="button"
              accessibilityState={{ disabled: state === "processing" }}
              disabled={state === "processing"}
            >
              {user?.avatarId ? (
                <AvatarView avatarId={user.avatarId} size={72} />
              ) : (
                <Text style={styles.headerAvatarText}>{(user?.firstName || user?.email || "?")[0].toUpperCase()}</Text>
              )}
            </Pressable>
          </View>
        </View>

        <View
          style={[
            styles.content,
            {
              paddingBottom:
                insets.bottom +
                FLOATING_ACTION_ROW_TOP_OFFSET +
                RECORD_CARD_EDGE_GAP,
            },
          ]}
        >
          <View
            style={[styles.recordCard, !layout.isMobile && styles.recordCardDesktop]}
            testID="record-card"
          >
            <Text
              style={[
                styles.timeDisplay,
                { fontSize: ts.timer },
                state === "recording" && styles.timeDisplayRecording,
                showLimitWarning && styles.timeDisplayWarning,
              ]}
              accessibilityLabel={formatSpokenDuration(duration)}
              testID="recording-duration"
            >
              {formatDuration(duration)}
            </Text>

            <Text
              style={[
                styles.remainingTime,
                { fontSize: ts.body2 },
                state === "processing" && { opacity: 0 },
                state !== "recording" && state !== "processing" && { opacity: 0.65 },
                showLimitWarning && styles.remainingTimeWarning,
              ]}
              accessibilityLabel={formatDuration(remaining)}
            >
              {state === "recording"
                ? formatDuration(remaining)
                : formatDuration(maxRecordingSeconds)}
            </Text>

            {showLimitWarning && (
              <Pressable
                onPress={() => router.push("/choose-plan" as any)}
                style={styles.upgradeHint}
                accessibilityRole="button"
              >
                <Feather name="zap" size={12} color={Colors.primary} />
                <Text style={[styles.upgradeHintText, { fontSize: ts.sm }]}>
                  {language === "es" ? "Grabaciones más largas con Pro" : "Longer recordings with Pro"}
                </Text>
                <Feather name="chevron-right" size={12} color={Colors.primary} />
              </Pressable>
            )}

            {webErrorMessage ? (
              <View style={styles.webErrorBanner} testID="recording-error-message">
                <Feather name="alert-circle" size={16} color={Colors.recording} />
                <Text style={[styles.webErrorText, { fontSize: ts.body2 }]}>
                  {webErrorMessage}
                </Text>
              </View>
            ) : null}

            <View style={styles.recordingIndicator}>
              <Animated.View
                style={[
                  styles.pulsingDot,
                  state === "recording" ? animatedPulseStyle : null,
                  state !== "recording" && styles.pulsingDotIdle,
                ]}
              />
            </View>

            {state === "preparing" && (
              <View style={styles.preparingContainer}>
                <ActivityIndicator size="small" color={Colors.textMuted} />
                <Text style={[styles.preparingText, { fontSize: ts.body2 }]}>
                  {t("record.preparing") || "Preparing…"}
                </Text>
              </View>
            )}

            <View
              style={styles.visualizerContainer}
              accessibilityLabel={t("a11y.audioVisualizer")}
              accessibilityRole="image"
            >
              {state === "recording" ? (
                barHeights.map((height, index) => (
                  <View key={index} style={[visualizerBarStyle, { height }]} />
                ))
              ) : (
                <View style={styles.visualizerPlaceholder} />
              )}
            </View>

            <View style={styles.controlsWrapper}>
              <View style={styles.buttonContainer}>
                <Animated.View style={[styles.ring, animatedRing1Style]} />
                <Animated.View style={[styles.ring, animatedRing2Style]} />

                <Animated.View style={state === "recording" ? animatedPulseStyle : animatedBreatheStyle}>
                  <Pressable
                    onPress={handleRecordPress}
                    disabled={state === "processing" || state === "preparing" || state === "discarded"}
                    style={({ pressed }) => [
                      styles.recordButton,
                      state === "idle" && styles.recordButtonIdle,
                      state === "recording" && styles.recordButtonActive,
                      state === "paused" && styles.recordButtonPaused,
                      pressed && styles.recordButtonPressed,
                      (state === "processing" || state === "preparing" || state === "discarded") && styles.recordButtonDisabled,
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel={recordButtonAccessibilityLabel}
                    accessibilityHint={state === "idle" ? t("a11y.doubleTapToStart") : state === "recording" ? t("a11y.doubleTapToPause") : state === "paused" ? t("a11y.doubleTapToResume") : undefined}
                    accessibilityState={{ disabled: state === "processing" || state === "preparing" || state === "discarded" }}
                    testID="record-control-button"
                  >
                    {state === "processing" || state === "preparing" || state === "discarded" ? (
                      <ActivityIndicator size="large" color={Colors.white} />
                    ) : state === "recording" ? (
                      <Feather name="pause" size={36} color={Colors.white} />
                    ) : state === "paused" ? (
                      <Feather name="mic" size={36} color={Colors.white} />
                    ) : (
                      <Feather name="mic" size={36} color={Colors.white} />
                    )}
                  </Pressable>
                </Animated.View>
              </View>

              {(state === "recording" || state === "paused") && (
                <>
                  <View style={styles.discardButtonWrapper}>
                    <Pressable
                      onPress={() => confirmDiscardActiveRecording(() => {}, false)}
                      style={({ pressed }) => [
                        styles.discardButton,
                        pressed && styles.discardButtonPressed
                      ]}
                      accessibilityRole="button"
                      accessibilityLabel={t("record.discard")}
                      testID="discard-recording-button"
                    >
                      <Feather name="trash-2" size={24} color={Colors.white} />
                    </Pressable>
                    <Text style={styles.discardButtonLabel}>{t("record.discard")}</Text>
                  </View>

                  <View style={styles.doneButtonWrapper}>
                    <Pressable
                      onPress={handleStopRecording}
                      style={({ pressed }) => [
                        styles.doneButton,
                        pressed && styles.doneButtonPressed
                      ]}
                      accessibilityRole="button"
                      accessibilityLabel={t("common.done")}
                      testID="done-recording-button"
                    >
                      <Feather name="check" size={28} color={Colors.white} />
                    </Pressable>
                    <Text style={styles.doneButtonLabel}>{t("common.done")}</Text>
                  </View>
                </>
              )}
            </View>

            {state === "processing" && (
              <Text
                style={[styles.processingHint, { fontSize: ts.body2 }]}
                accessibilityLiveRegion="assertive"
              >
                {t("record.processing")}
              </Text>
            )}
          </View>
        </View>
        {!feedbackVisible && (
        <View
          pointerEvents="box-none"
          style={[
            styles.composeShortcutWrap,
            { bottom: insets.bottom + COMPOSE_ACTION_BOTTOM_OFFSET },
          ]}
        >
          <Pressable
            onPress={handleTypeToConvert}
            disabled={state === "processing" || state === "preparing"}
            style={({ pressed }) => [
              styles.composeShortcut,
              pressed && styles.composeShortcutPressed,
              (state === "processing" || state === "preparing") && styles.composeShortcutDisabled,
            ]}
            accessibilityRole="button"
            accessibilityLabel={language === "es" ? "Entrada de texto" : "Type instead of speak"}
            testID="compose-shortcut-button"
          >
            <Feather name="edit-3" size={20} color={Colors.white} />
          </Pressable>
        </View>
        )}
        <FeedbackIconButton
          hidden={drawerVisible}
          surface="solid"
          containerStyle={{ left: containedFeedbackInset }}
        />
        <ProfileDropdown visible={showProfileMenu} onClose={() => setShowProfileMenu(false)} />

        <NavigationDrawer
          visible={drawerVisible}
          onClose={() => setDrawerVisible(false)}
          isAdmin={false}
          isLoggedIn={!!user}
          planLabel=""
          isPro={false}
          onFeedback={() => {}}
          onTypeToConvert={() => setDrawerVisible(false)}
        />
      </View>
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
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  topBarActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 20,
  },
  topBarBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.surface,
    justifyContent: "center",
    alignItems: "center",
  },
  headerAvatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: "rgba(0, 180, 216, 0.15)",
    justifyContent: "center" as const,
    alignItems: "center" as const,
    overflow: "hidden" as const,
  },
  headerAvatarText: {
    fontFamily: "Inter_700Bold",
    fontSize: sf(26, ts),
    color: Colors.primary,
  },
  backButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Colors.surface,
    justifyContent: "center",
    alignItems: "center",
  },
  content: {
    flex: 1,
    minHeight: 0,
    justifyContent: "flex-start",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingTop: RECORD_CARD_EDGE_GAP,
  },
  recordCard: {
    flex: 1,
    minHeight: 0,
    backgroundColor: Colors.surface,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingTop: RECORD_CARD_CONTENT_TOP_PADDING,
    paddingBottom: RECORD_CARD_CONTENT_BOTTOM_PADDING,
    paddingHorizontal: 24,
    alignItems: "center",
    width: "100%",
    maxWidth: 440,
  },
  recordCardDesktop: {
    maxWidth: 520,
    paddingTop: RECORD_CARD_CONTENT_TOP_PADDING,
    paddingBottom: 16,
    paddingHorizontal: 32,
    borderRadius: 24,
    ...(Platform.OS === "web" ? {
      boxShadow: `0 8px 40px rgba(0, 180, 216, 0.08), 0 0 0 1px ${Colors.border}`,
    } as object : {}),
  },
  timeDisplay: {
    fontSize: sf(64, ts),
    fontFamily: "Inter_700Bold",
    fontVariant: ["tabular-nums"],
    color: Colors.text,
    letterSpacing: -1,
    marginBottom: 4,
  },
  timeDisplayRecording: {
    color: "#FFF",
    ...(Platform.OS === "web" ? {
      textShadow: `0 0 20px ${Colors.recordingGlow}, 0 0 40px rgba(255, 71, 87, 0.15)`,
    } as object : {}),
  },
  remainingTime: {
    fontSize: sf(13, ts),
    fontFamily: "Inter_400Regular",
    color: Colors.textMuted,
    marginBottom: 8,
  },
  remainingTimeWarning: {
    color: "#F59E0B",
  },
  timeDisplayWarning: {
    color: "#F59E0B",
  },
  upgradeHint: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: "rgba(0, 180, 216, 0.08)",
    marginBottom: 8,
  },
  upgradeHintText: {
    color: Colors.primary,
    fontFamily: "Inter_500Medium",
    flex: 1,
  },
  webErrorBanner: {
    width: "100%",
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    marginBottom: 16,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: "rgba(239, 68, 68, 0.12)",
    borderWidth: 1,
    borderColor: "rgba(239, 68, 68, 0.28)",
  },
  webErrorText: {
    flex: 1,
    fontFamily: "Inter_500Medium",
    color: Colors.text,
    lineHeight: sf(20, ts),
  },
  recordingIndicator: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: RECORDING_INDICATOR_BOTTOM_GAP,
    height: 20,
  },
  pulsingDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: Colors.recording,
  },
  pulsingDotIdle: {
    opacity: 0.22,
    transform: [{ scale: 1 }],
  },
  controlsWrapper: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    width: "100%",
    position: "relative",
    marginBottom: 8,
  },
  buttonContainer: {
    width: 160,
    height: 160,
    justifyContent: "center",
    alignItems: "center",
  },
  doneButtonWrapper: {
    position: "absolute",
    right: "5%",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  doneButton: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: Colors.success,
    alignItems: "center",
    justifyContent: "center",
    ...Platform.select({
      ios: { shadowColor: Colors.success, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 10 },
      android: { elevation: 6 },
      web: { boxShadow: `0 4px 12px rgba(74, 222, 128, 0.3)` },
    }),
  },
  doneButtonPressed: {
    transform: [{ scale: 0.92 }],
    opacity: 0.9,
  },
  doneButtonLabel: {
    fontSize: sf(14, ts),
    fontFamily: "Inter_600SemiBold",
    color: Colors.success,
  },
  discardButtonWrapper: {
    position: "absolute",
    left: "5%",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  discardButton: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: Colors.textMuted,
    alignItems: "center",
    justifyContent: "center",
    ...Platform.select({
      ios: { shadowColor: Colors.textMuted, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 10 },
      android: { elevation: 6 },
      web: { boxShadow: `0 4px 12px rgba(0, 0, 0, 0.15)` },
    }),
  },
  discardButtonPressed: {
    transform: [{ scale: 0.92 }],
    opacity: 0.9,
  },
  discardButtonLabel: {
    fontSize: sf(14, ts),
    fontFamily: "Inter_600SemiBold",
    color: Colors.textMuted,
  },
  ring: {
    position: "absolute",
    width: 100,
    height: 100,
    borderRadius: 50,
    borderWidth: 2,
    borderColor: Colors.recording,
  },
  recordButton: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: Colors.recordingButton,
    justifyContent: "center",
    alignItems: "center",
    elevation: 8,
    ...Platform.select({
      ios: { shadowColor: Colors.recording, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 16 },
      android: {},
      web: { boxShadow: `0 4px 16px rgba(239, 68, 68, 0.4)` },
    }),
  },
  recordButtonIdle: {
    ...Platform.select({
      ios: { shadowColor: Colors.recording, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.25, shadowRadius: 24 },
      android: {},
      web: { boxShadow: `0 0 24px ${Colors.recordingGlow}, 0 4px 16px rgba(239, 68, 68, 0.25)` },
    }),
  },
  recordButtonActive: {
    backgroundColor: Colors.recordingButton,
    ...Platform.select({
      ios: { shadowOpacity: 0.55, shadowRadius: 24 },
      android: {},
      web: { boxShadow: `0 0 32px rgba(255, 71, 87, 0.5), 0 4px 20px rgba(239, 68, 68, 0.4)` },
    }),
  },
  recordButtonPaused: {
    backgroundColor: Colors.recordingButton,
    ...Platform.select({
      ios: { shadowOpacity: 0.4, shadowRadius: 20 },
      android: {},
      web: { boxShadow: `0 0 28px rgba(239, 68, 68, 0.4), 0 4px 16px rgba(239, 68, 68, 0.3)` },
    }),
  },
  recordButtonPressed: {
    transform: [{ scale: 0.94 }],
  },
  recordButtonDisabled: {
    backgroundColor: Colors.surfaceHighlight,
  },
  stopIcon: {
    width: 28,
    height: 28,
    borderRadius: 6,
    backgroundColor: Colors.white,
  },
  processingHint: {
    fontSize: sf(13, ts),
    fontFamily: "Inter_400Regular",
    color: Colors.textMuted,
  },
  visualizerContainer: {
    flex: 1,
    minHeight: 40,
    maxHeight: 140,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
    marginBottom: 8,
    paddingHorizontal: 8,
    alignSelf: "stretch",
  },
  visualizerPlaceholder: {
    height: 1,
    alignSelf: "stretch",
    backgroundColor: Colors.border,
    opacity: 0.4,
    borderRadius: 1,
  },
  preparingContainer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginBottom: 8,
  },
  preparingText: {
    fontFamily: "Inter_400Regular",
    color: Colors.textMuted,
  },
  composeShortcut: {
    width: COMPOSE_ACTION_SIZE,
    height: COMPOSE_ACTION_SIZE,
    borderRadius: COMPOSE_ACTION_SIZE / 2,
    backgroundColor: Colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  composeShortcutWrap: {
    position: "absolute",
    right: 20,
    alignItems: "center",
  },
  composeShortcutLabel: {
    marginTop: 6,
    fontSize: ts.caption,
    color: Colors.textMuted,
    fontFamily: "Inter_500Medium",
  },
  composeShortcutPressed: {
    transform: [{ scale: 0.94 }],
  },
  composeShortcutDisabled: {
    opacity: 0.55,
  },
});
