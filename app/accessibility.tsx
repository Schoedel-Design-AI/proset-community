import React from "react";
import { View, Text, ScrollView, StyleSheet, Pressable } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Feather from "@react-native-vector-icons/feather/static";
import { router } from "@/lib/navigation";
import Colors from "@/constants/colors";
import { useResponsiveLayout } from "@/lib/useResponsiveLayout";
import { useLanguage } from "@/lib/i18n";

export default function AccessibilityScreen() {
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
        <Text style={styles.headerTitle}>{t("a11y.pageTitle")}</Text>
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
        <Text style={styles.lastUpdated}>{t("a11y.lastUpdated")}</Text>

        <Text style={styles.paragraph}>{t("a11y.commitment")}</Text>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t("a11y.standardsTitle")}</Text>
          <Text style={styles.paragraph}>{t("a11y.standardsBody")}</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t("a11y.featuresTitle")}</Text>
          
          <View style={styles.featureItem}>
            <Feather name="type" size={16} color={Colors.primary} />
            <View style={styles.featureText}>
              <Text style={styles.featureLabel}>{t("a11y.screenReaderLabel")}</Text>
              <Text style={styles.featureDesc}>{t("a11y.screenReaderDesc")}</Text>
            </View>
          </View>

          <View style={styles.featureItem}>
            <Feather name="navigation" size={16} color={Colors.primary} />
            <View style={styles.featureText}>
              <Text style={styles.featureLabel}>{t("a11y.keyboardLabel")}</Text>
              <Text style={styles.featureDesc}>{t("a11y.keyboardDesc")}</Text>
            </View>
          </View>

          <View style={styles.featureItem}>
            <Feather name="sun" size={16} color={Colors.primary} />
            <View style={styles.featureText}>
              <Text style={styles.featureLabel}>{t("a11y.contrastLabel")}</Text>
              <Text style={styles.featureDesc}>{t("a11y.contrastDesc")}</Text>
            </View>
          </View>

          <View style={styles.featureItem}>
            <Feather name="maximize" size={16} color={Colors.primary} />
            <View style={styles.featureText}>
              <Text style={styles.featureLabel}>{t("a11y.textSizeLabel")}</Text>
              <Text style={styles.featureDesc}>{t("a11y.textSizeDesc")}</Text>
            </View>
          </View>

          <View style={styles.featureItem}>
            <Feather name="mic" size={16} color={Colors.primary} />
            <View style={styles.featureText}>
              <Text style={styles.featureLabel}>{t("a11y.voiceLabel")}</Text>
              <Text style={styles.featureDesc}>{t("a11y.voiceDesc")}</Text>
            </View>
          </View>

          <View style={styles.featureItem}>
            <Feather name="globe" size={16} color={Colors.primary} />
            <View style={styles.featureText}>
              <Text style={styles.featureLabel}>{t("a11y.languageLabel")}</Text>
              <Text style={styles.featureDesc}>{t("a11y.languageDesc")}</Text>
            </View>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t("a11y.spanishChoiceTitle")}</Text>
          <Text style={styles.paragraph}>{t("a11y.spanishChoiceBody")}</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t("a11y.limitationsTitle")}</Text>
          <Text style={styles.paragraph}>{t("a11y.limitationsBody")}</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t("a11y.feedbackTitle")}</Text>
          <Text style={styles.paragraph}>{t("a11y.feedbackBody")}</Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  backBtn: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: Colors.surface,
    justifyContent: "center", alignItems: "center",
  },
  headerTitle: { fontSize: 18, fontFamily: "Inter_600SemiBold", color: Colors.text },
  lastUpdated: { fontSize: 14, color: Colors.textMuted, fontFamily: "Inter_500Medium", marginBottom: 24 },
  section: { marginTop: 32 },
  sectionTitle: { fontSize: 18, fontFamily: "Inter_600SemiBold", color: Colors.text, marginBottom: 12 },
  paragraph: { fontSize: 16, lineHeight: 24, color: Colors.textSecondary, fontFamily: "Inter_400Regular" },
  featureItem: {
    flexDirection: "row", alignItems: "flex-start", marginBottom: 16,
    paddingLeft: 4, gap: 12,
  },
  featureText: { flex: 1 },
  featureLabel: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: Colors.text, marginBottom: 4 },
  featureDesc: { fontSize: 14, lineHeight: 20, color: Colors.textSecondary, fontFamily: "Inter_400Regular" },
});
