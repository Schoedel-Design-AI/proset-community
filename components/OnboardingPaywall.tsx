import React from "react";
import {
  View, Text, Pressable, Modal, StyleSheet, Dimensions,
} from "react-native";
import Feather from "@react-native-vector-icons/feather/static";
import Colors from "@/constants/colors";
import { useLanguage } from "@/lib/i18n";
import { useTextScale, sf } from "@/lib/typography";
import { router } from "@/lib/navigation";

interface Props {
  visible: boolean;
  onClose: () => void;
}

const { width: SCREEN_WIDTH } = Dimensions.get("window");

export default function OnboardingPaywall({ visible, onClose }: Props) {
  const ts = useTextScale();
  const { t } = useLanguage();

  const handleUpgrade = () => {
    onClose();
    router.push("/choose-plan");
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      accessibilityViewIsModal
    >
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close">
        <Pressable
          style={styles.card}
          onPress={(e) => e.stopPropagation()}
          accessibilityRole="alert"
        >
          {/* Close button */}
          <Pressable
            onPress={onClose}
            style={styles.closeBtn}
            hitSlop={12}
            accessibilityLabel="Close"
            accessibilityRole="button"
          >
            <Feather name="x" size={20} color={Colors.textSecondary} />
          </Pressable>

          {/* Recording icon */}
          <View style={styles.iconCircle}>
            <Feather name="mic" size={28} color={Colors.primary} />
          </View>

          {/* Headline */}
          <Text style={[styles.headline, { fontSize: sf(22, ts) }]}>
            {t("onboardingPaywall.headline")}
          </Text>

          {/* 50% off badge */}
          <View style={styles.discountBadge}>
            <Text style={[styles.discountText, { fontSize: sf(14, ts) }]}>
              🎉 {t("onboardingPaywall.discount")}
            </Text>
          </View>

          {/* CTA */}
          <Pressable
            style={styles.cta}
            onPress={handleUpgrade}
            accessibilityRole="button"
            accessibilityLabel={t("onboardingPaywall.cta")}
          >
            <Text style={[styles.ctaText, { fontSize: sf(16, ts) }]}>
              {t("onboardingPaywall.cta")}
            </Text>
          </Pressable>

          {/* Dismiss */}
          <Pressable
            onPress={onClose}
            style={styles.dismissBtn}
            accessibilityRole="button"
            testID="paywall-dismiss"
          >
            <Text style={[styles.dismissText, { fontSize: sf(13, ts) }]}>
              {t("onboardingPaywall.dismiss")}
            </Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  card: {
    backgroundColor: "#1A2942",
    borderRadius: 20,
    padding: 28,
    width: Math.min(SCREEN_WIDTH - 48, 380),
    alignItems: "center",
    position: "relative",
    borderWidth: 1,
    borderColor: "rgba(0, 180, 216, 0.15)",
  },
  closeBtn: {
    position: "absolute",
    top: 14,
    right: 14,
    padding: 4,
  },
  iconCircle: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: "rgba(0, 180, 216, 0.12)",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 16,
  },
  headline: {
    fontFamily: "Inter_700Bold",
    color: Colors.text,
    textAlign: "center",
    marginBottom: 8,
  },
  subtitle: {
    fontFamily: "Inter_400Regular",
    color: Colors.textSecondary,
    textAlign: "center",
    lineHeight: 20,
    marginBottom: 20,
  },
  featureList: {
    width: "100%",
    marginBottom: 18,
  },
  featureRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 7,
    gap: 10,
  },
  featureLabel: {
    fontFamily: "Inter_400Regular",
    color: Colors.textSecondary,
  },
  discountBadge: {
    backgroundColor: "rgba(0, 180, 216, 0.12)",
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 20,
    marginBottom: 16,
    width: "100%",
    alignItems: "center",
  },
  discountText: {
    fontFamily: "Inter_600SemiBold",
    color: Colors.primary,
    textAlign: "center",
  },
  cta: {
    backgroundColor: Colors.primaryButton,
    borderRadius: 12,
    paddingVertical: 14,
    width: "100%",
    alignItems: "center",
    marginBottom: 12,
  },
  ctaText: {
    fontFamily: "Inter_600SemiBold",
    color: "#FFFFFF",
  },
  dismissBtn: {
    paddingVertical: 8,
  },
  dismissText: {
    fontFamily: "Inter_400Regular",
    color: Colors.textMuted,
  },
});
