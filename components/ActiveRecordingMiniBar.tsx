import React, { useEffect, useMemo, useRef } from "react";
import {
  Animated,
  ActivityIndicator,
  PanResponder,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { router, useSegments } from "@/lib/navigation";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Feather from "@react-native-vector-icons/feather/static";
import Colors from "@/constants/colors";
import { featureFlags } from "@/lib/feature-flags";
import {
  useActiveRecording,
  type ActiveRecordingValue,
} from "@/lib/active-recording-context";
import { useLanguage } from "@/lib/i18n";
import { useReducedMotion } from "@/lib/useReducedMotion";
import { useResponsiveLayout } from "@/lib/useResponsiveLayout";
import { useTextScale, sf } from "@/lib/typography";
import { formatDuration } from "@/lib/utils";
import { shouldShowMiniBar } from "@/lib/active-recording-mini-bar";

const MAX_BAR_WIDTH = 520;
const HORIZONTAL_MARGIN = 16;

export default function ActiveRecordingMiniBar() {
  const { state, duration, meteringLevel, pause, resume, stop, completedRecordingId } =
    useActiveRecording();
  const segments = useSegments();
  const insets = useSafeAreaInsets();
  const layout = useResponsiveLayout();
  const reduceMotion = useReducedMotion();
  const ts = useTextScale();
  const { t } = useLanguage();

  const firstSegment = segments[0] as string | undefined;
  const currentRecordingId =
    firstSegment === "recording" ? (segments[1] as string | undefined) : undefined;
  const visible = shouldShowMiniBar(
    state,
    firstSegment,
    featureFlags.persistentRecording,
    currentRecordingId,
    completedRecordingId,
  );

  const pulse = useRef(new Animated.Value(0.6)).current;
  useEffect(() => {
    if (!visible || reduceMotion || state !== "recording") {
      pulse.setValue(reduceMotion ? 1 : 0.6);
      return;
    }
    const target = 0.6 + Math.min(1, Math.max(0, meteringLevel)) * 0.4;
    Animated.timing(pulse, {
      toValue: target,
      duration: 120,
      useNativeDriver: Platform.OS !== "web",
    }).start();
  }, [meteringLevel, pulse, reduceMotion, state, visible]);

  const formatted = useMemo(() => formatDuration(duration), [duration]);

  // Draggable position state (always declared for hook order)
  const pan = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderMove: Animated.event(
        [null, { dx: pan.x, dy: pan.y }],
        { useNativeDriver: false }
      ),
      onPanResponderRelease: () => {
        pan.extractOffset();
      },
    })
  ).current;

  // Completed state fade-in animation
  const completedFade = useRef(new Animated.Value(0)).current;
  const isCompleted = state === "completed";
  useEffect(() => {
    if (isCompleted) {
      completedFade.setValue(0);
      Animated.timing(completedFade, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }).start();
    }
  }, [isCompleted, completedFade]);

  if (!visible) return null;

  const isPaused = state === "paused";
  const isProcessing = state === "processing";
  const bottomOffset = Math.max(insets.bottom + 34 + 15, 49);  // 15px above feedback icon + record FAB
  const maxWidth = Math.min(MAX_BAR_WIDTH, layout.width - HORIZONTAL_MARGIN * 2);

  const ariaLabel = t("activeRecording.ariaLabel", { time: formatted });

  // Processing state: saving indicator
  if (isProcessing) {
    return (
      <View
        pointerEvents="box-none"
        style={[styles.wrapper, { bottom: bottomOffset }]}
      >
        <View style={[styles.pill, styles.pillProcessing, { maxWidth, width: maxWidth }]}>
          <ActivityIndicator size="small" color={Colors.primary} />
          <Text style={styles.completedText} numberOfLines={1}>
            {t("activeRecording.saving")}
          </Text>
        </View>
      </View>
    );
  }

  // Completed state: green confirmation bar
  if (isCompleted) {
    return (
      <Animated.View
        pointerEvents="box-none"
        style={[
          styles.wrapper,
          { bottom: bottomOffset, opacity: completedFade },
        ]}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("activeRecording.saved") + ". " + t("activeRecording.tapToView")}
          onPress={() => {
            if (completedRecordingId) {
              router.push({ pathname: `/recording/${completedRecordingId}`, params: { tab: "recording" } } as any);
            }
          }}
          style={[styles.pill, styles.pillCompleted, { maxWidth, width: maxWidth }]}
        >
          <Feather name="check-circle" size={18} color="#22C55E" />
          <Text style={styles.completedText} numberOfLines={1}>
            {t("activeRecording.saved")}
          </Text>
          <View style={styles.spacer} />
          <Text style={styles.viewText} numberOfLines={1}>
            {t("activeRecording.tapToView")}
          </Text>
        </Pressable>
      </Animated.View>
    );
  }

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[
        styles.wrapper,
        { bottom: bottomOffset },
        { transform: [{ translateX: pan.x }, { translateY: pan.y }] },
      ]}
      {...panResponder.panHandlers}
    >
      <Pressable
        accessibilityRole="toolbar"
        accessibilityLabel={ariaLabel}
        onPress={() => router.push("/record")}
        style={[styles.pill, { maxWidth, width: maxWidth }]}
      >
        <Animated.View
          style={[
            styles.dot,
            {
              opacity: pulse,
              transform: [
                {
                  scale: pulse.interpolate({
                    inputRange: [0.6, 1],
                    outputRange: [0.85, 1.15],
                  }),
                },
              ],
            },
          ]}
        />
        <Text
          accessible={false}
          style={[styles.time, { fontSize: sf(15, ts) }]}
          numberOfLines={1}
        >
          {formatted}
        </Text>

        <View style={styles.spacer} />

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            isPaused ? t("activeRecording.resume") : t("activeRecording.pause")
          }
          onPress={(event) => {
            event.stopPropagation();
            if (isPaused) {
              void resume();
            } else {
              void pause();
            }
          }}
          style={({ pressed }) => [
            styles.iconButton,
            pressed && styles.iconButtonPressed,
          ]}
          hitSlop={8}
        >
          <Feather
            name={isPaused ? "play" : "pause"}
            size={18}
            color={Colors.white}
          />
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("activeRecording.stop")}
          onPress={(event) => {
            event.stopPropagation();
            void stop();
          }}
          style={({ pressed }) => [
            styles.iconButton,
            styles.stopButton,
            pressed && styles.iconButtonPressed,
          ]}
          hitSlop={8}
        >
          <Feather name="square" size={14} color={Colors.white} />
        </Pressable>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    position: "absolute",
    left: 0,
    right: 0,
    alignItems: "center",
    zIndex: 50,
  },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(19, 34, 64, 0.96)",
    borderColor: Colors.recording,
    borderWidth: 1,
    borderRadius: 999,
    paddingVertical: 18,
    paddingHorizontal: 14,
    marginHorizontal: HORIZONTAL_MARGIN,
    shadowColor: Colors.black,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 16,
    elevation: 8,
    gap: 10,
  },
  pillCompleted: {
    borderColor: "#22C55E",
    backgroundColor: "rgba(17, 34, 51, 0.97)",
  },
  pillProcessing: {
    borderColor: Colors.primary,
    backgroundColor: "rgba(17, 34, 51, 0.97)",
  },
  completedText: {
    color: Colors.text,
    fontFamily: "Inter_600SemiBold",
    fontSize: 14,
    marginLeft: 8,
  },
  viewText: {
    color: Colors.primary,
    fontFamily: "Inter_500Medium",
    fontSize: 13,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: Colors.recording,
  },
  time: {
    color: Colors.text,
    fontFamily: "Inter_600SemiBold",
    fontVariant: ["tabular-nums"],
    letterSpacing: 0.4,
  },
  spacer: {
    flex: 1,
  },
  iconButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255, 255, 255, 0.08)",
  },
  iconButtonPressed: {
    opacity: 0.7,
  },
  stopButton: {
    backgroundColor: Colors.recordingButton,
  },
});
