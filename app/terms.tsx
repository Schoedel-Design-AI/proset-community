import React from "react";
import { View, Text, ScrollView, StyleSheet, Pressable } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Feather from "@react-native-vector-icons/feather/static";
import { router } from "@/lib/navigation";
import Colors from "@/constants/colors";
import { useResponsiveLayout } from "@/lib/useResponsiveLayout";
import { useLanguage } from "@/lib/i18n";

export default function TermsScreen() {
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
        <Text style={styles.headerTitle}>{t("terms.title")}</Text>
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
        <Text style={styles.lastUpdated}>{t("terms.lastUpdated")}</Text>

        <Text style={styles.paragraph}>
          {t("terms.intro")}
        </Text>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t("terms.serviceTitle")}</Text>
          <Text style={styles.paragraph}>{t("terms.serviceBody")}</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t("terms.accountsTitle")}</Text>
          <Text style={styles.paragraph}>{t("terms.accountsBody")}</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t("terms.subscriptionsTitle")}</Text>
          <Text style={styles.paragraph}>{t("terms.subscriptionsBody")}</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t("terms.acceptableUseTitle")}</Text>
          <Text style={styles.paragraph}>{t("terms.acceptableUseBody")}</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t("terms.userContentTitle")}</Text>
          <Text style={styles.paragraph}>{t("terms.userContentBody")}</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t("terms.intellectualPropertyTitle")}</Text>
          <Text style={styles.paragraph}>{t("terms.intellectualPropertyBody")}</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t("terms.aiGeneratedTitle")}</Text>
          <Text style={styles.paragraph}>{t("terms.aiGeneratedBody")}</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t("terms.thirdPartyTitle")}</Text>
          <Text style={styles.paragraph}>{t("terms.thirdPartyBody")}</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t("terms.disclaimersTitle")}</Text>
          <Text style={styles.paragraph}>{t("terms.disclaimersBody")}</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t("terms.terminationTitle")}</Text>
          <Text style={styles.paragraph}>{t("terms.terminationBody")}</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t("terms.changesTitle")}</Text>
          <Text style={styles.paragraph}>{t("terms.changesBody")}</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t("terms.governingLawTitle")}</Text>
          <Text style={styles.paragraph}>{t("terms.governingLawBody")}</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t("terms.contactTitle")}</Text>
          <Text style={styles.paragraph}>{t("terms.contactBody")}</Text>
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
});
