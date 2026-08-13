import React from "react";
import { View, Text, ScrollView, StyleSheet, Pressable, Linking, Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Feather from "@react-native-vector-icons/feather/static";
import { router } from "@/lib/navigation";
import Colors from "@/constants/colors";
import { useResponsiveLayout } from "@/lib/useResponsiveLayout";
import { useLanguage } from "@/lib/i18n";

export default function RefundScreen() {
  const insets = useSafeAreaInsets();
  const layout = useResponsiveLayout();
  const { t } = useLanguage();

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={[styles.header, { maxWidth: layout.contentMaxWidth, alignSelf: "center", width: "100%", paddingHorizontal: layout.contentPadding }]}>
        <Pressable
          style={styles.backBtn}
          onPress={() => {
            if (router.canGoBack()) router.back();
            else router.replace("/");
          }}
          hitSlop={12}
        >
          <Feather name="arrow-left" size={24} color={Colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>{t("refund.title")}</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        contentContainerStyle={{
          padding: layout.contentPadding,
          paddingBottom: insets.bottom + 40,
          maxWidth: layout.contentMaxWidth,
          alignSelf: "center",
          width: "100%",
        }}
      >
        <Text style={styles.lastUpdated}>{t("refund.lastUpdated")}</Text>

        <Text style={styles.paragraph}>
          {t("refund.intro")}
        </Text>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t("refund.googleTitle")}</Text>
          <Text style={styles.paragraph}>
            {t("refund.googleBody")}
          </Text>
          <Pressable
            style={styles.linkButton}
            onPress={() => Linking.openURL("https://play.google.com/store/account/orderhistory")}
            accessibilityRole="link"
          >
            <Feather name="external-link" size={14} color={Colors.primary} />
            <Text style={styles.linkButtonText}>{t("refund.googleLink")}</Text>
          </Pressable>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t("refund.appleTitle")}</Text>
          <Text style={styles.paragraph}>
            {t("refund.appleBody")}
          </Text>
          <Pressable
            style={styles.linkButton}
            onPress={() => Linking.openURL("https://reportaproblem.apple.com")}
            accessibilityRole="link"
          >
            <Feather name="external-link" size={14} color={Colors.primary} />
            <Text style={styles.linkButtonText}>{t("refund.appleLink")}</Text>
          </Pressable>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t("refund.noCreditCardTitle")}</Text>
          <Text style={styles.paragraph}>
            {t("refund.noCreditCardBody")}
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t("refund.trialTitle")}</Text>
          <Text style={styles.paragraph}>
            {t("refund.trialBody")}
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t("refund.contactTitle")}</Text>
          <Text style={styles.paragraph}>
            {t("refund.contactBody")}
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.surface,
    justifyContent: "center",
    alignItems: "center",
  },
  headerTitle: {
    fontSize: 18,
    fontFamily: "Inter_600SemiBold",
    color: Colors.text,
  },
  lastUpdated: {
    fontSize: 14,
    color: Colors.textMuted,
    fontFamily: "Inter_500Medium",
    marginBottom: 24,
  },
  section: {
    marginTop: 32,
  },
  sectionTitle: {
    fontSize: 18,
    fontFamily: "Inter_600SemiBold",
    color: Colors.text,
    marginBottom: 12,
  },
  paragraph: {
    fontSize: 16,
    lineHeight: 24,
    color: Colors.textSecondary,
    fontFamily: "Inter_400Regular",
  },
  linkButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 16,
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: "rgba(0, 180, 216, 0.08)",
    borderRadius: 12,
    alignSelf: "flex-start",
  },
  linkButtonText: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
    color: Colors.primary,
  },
});
