import React, { useEffect, useState } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import Feather from "@react-native-vector-icons/feather/static";
import Colors from "@/constants/colors";
import { useLanguage } from "@/lib/i18n";
import { getStreak, getNextMilestone, getReachedMilestone, STREAK_MILESTONES, type StreakState } from "@/lib/engagement";

export default function StreakBanner() {
  const { t, language } = useLanguage();
  const [streak, setStreak] = useState<StreakState>({ currentStreak: 0, lastRecordDate: null });
  const isEs = language === "es";

  useEffect(() => {
    getStreak().then(setStreak);
  }, []);

  if (streak.currentStreak < 2) return null;

  const next = getNextMilestone(streak.currentStreak);
  const reached = getReachedMilestone(streak.currentStreak);
  const daysLeft = next ? next.days - streak.currentStreak : 0;

  return (
    <View style={styles.banner}>
      <Feather name="zap" size={14} color={Colors.primary} />
      <Text style={styles.text}>
        {isEs
          ? `${streak.currentStreak} días seguidos`
          : `${streak.currentStreak}-day streak`}
        {reached && (
          <Text style={styles.reward}>
            {" "}{isEs ? `— ${reached.reward}` : `— ${reached.reward}`}
          </Text>
        )}
        {next && daysLeft > 0 && (
          <Text style={styles.hint}>
            {" "}{isEs
              ? `${daysLeft} más para ${next.reward}`
              : `${daysLeft} more for ${next.reward}`}
          </Text>
        )}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: "rgba(0, 180, 216, 0.08)",
    marginBottom: 4,
    marginHorizontal: 16,
    alignSelf: "center",
  },
  text: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    color: Colors.text,
    flexShrink: 1,
  },
  reward: {
    color: Colors.primary,
    fontFamily: "Inter_600SemiBold",
  },
  hint: {
    color: Colors.textMuted,
  },
});
