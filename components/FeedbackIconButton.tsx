import React from "react";
import { Pressable, StyleSheet, Platform, View, type StyleProp, type ViewStyle } from "react-native";
import Feather from "@react-native-vector-icons/feather/static";
import * as Haptics from "@/lib/haptics";
import Colors from "@/constants/colors";
import { useFeedback } from "@/lib/feedback-context";
import { useLanguage } from "@/lib/i18n";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  FEEDBACK_ACTION_BOTTOM_OFFSET,
  FEEDBACK_ACTION_SIZE,
} from "@/constants/record-layout";
import FloatingActionHalo, {
  type FloatingActionSurface,
} from "@/components/FloatingActionHalo";

import { useAuth } from "@/lib/auth-context";

type Props = {
  hidden?: boolean;
  containerStyle?: StyleProp<ViewStyle>;
  surface: FloatingActionSurface;
};

export default function FeedbackIconButton({ hidden = false, containerStyle, surface }: Props) {
  const { openFeedback, feedbackVisible } = useFeedback();
  const { t } = useLanguage();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();

  if (!user || hidden || feedbackVisible) return null;

  return (
    <View
      style={[
        styles.container,
        { bottom: insets.bottom + FEEDBACK_ACTION_BOTTOM_OFFSET },
        containerStyle,
      ]}
    >
      <FloatingActionHalo buttonSize={FEEDBACK_ACTION_SIZE} surface={surface} />
      <Pressable
        style={({ pressed }) => [
          styles.btn,
          surface === "scrolling" && styles.btnFloating,
          pressed && styles.btnPressed,
        ]}
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          openFeedback();
        }}
        accessibilityLabel={t("feedback.title")}
        accessibilityRole="button"
        testID="feedback-icon-button"
      >
        <Feather name="message-square" size={20} color={Colors.white} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    left: 40,
    zIndex: 1,
  },
  btn: {
    width: FEEDBACK_ACTION_SIZE,
    height: FEEDBACK_ACTION_SIZE,
    borderRadius: FEEDBACK_ACTION_SIZE / 2,
    backgroundColor: Colors.primary,
    justifyContent: "center",
    alignItems: "center",
  },
  btnFloating: {
    ...Platform.select({
      ios: {
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 4,
      },
      android: { elevation: 6 },
      web: { boxShadow: "0 4px 12px rgba(0,0,0,0.3)" },
    }),
  },
  btnPressed: {
    opacity: 0.8,
    transform: [{ scale: 0.96 }],
  },
});
