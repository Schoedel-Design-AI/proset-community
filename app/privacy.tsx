import React from "react";
import { View, Text, ScrollView, StyleSheet, Pressable } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Feather from "@react-native-vector-icons/feather/static";
import { router } from "@/lib/navigation";
import Colors from "@/constants/colors";
import { useResponsiveLayout } from "@/lib/useResponsiveLayout";
import { useLanguage } from "@/lib/i18n";

export default function PrivacyScreen() {
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
        <Text style={styles.headerTitle}>{t("privacy.title")}</Text>
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
        <Text style={styles.lastUpdated}>{t("privacy.lastUpdated")}</Text>

        <Text style={styles.paragraph}>
          {t("privacy.intro")}
        </Text>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t("privacy.whatWeCollectTitle")}</Text>
          <Text style={styles.paragraph}>
            {t("privacy.whatWeCollectBody")}
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t("privacy.encryptionTitle")}</Text>
          <Text style={styles.paragraph}>
            {t("privacy.encryptionBody")}
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t("privacy.voiceTitle")}</Text>
          <Text style={styles.paragraph}>
            {t("privacy.voiceBody")}
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t("privacy.localTitle")}</Text>
          <Text style={styles.paragraph}>
            {t("privacy.localBody")}
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t("privacy.analyticsTitle")}</Text>
          <Text style={styles.paragraph}>
            {t("privacy.analyticsBody")}
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t("privacy.ownershipTitle")}</Text>
          <Text style={styles.paragraph}>
            {t("privacy.ownershipBody")}
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t("privacy.thirdPartyTitle")}</Text>
          <Text style={styles.paragraph}>
            {t("privacy.thirdPartyBody")}
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t("privacy.retentionTitle")}</Text>
          <Text style={styles.paragraph}>
            {t("privacy.retentionBody")}
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t("privacy.rightsTitle")}</Text>
          <Text style={styles.paragraph}>
            {t("privacy.rightsBody")}
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t("privacy.permissionsTitle")}</Text>
          <Text style={styles.paragraph}>
            {t("privacy.permissionsBody")}
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t("privacy.contactTitle")}</Text>
          <Text style={styles.paragraph}>
            {t("privacy.contactBody")}
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
});
