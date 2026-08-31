import React, { useState, useMemo } from "react";
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  Pressable,
  Platform,
  Switch,
} from "react-native";
import { router } from "@/lib/navigation";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Feather from "@react-native-vector-icons/feather/static";
import * as Haptics from "@/lib/haptics";
import Colors from "@/constants/colors";
import { useResponsiveLayout } from "@/lib/useResponsiveLayout";
import { useLanguage, type Language } from "@/lib/i18n";
import { useTextScale, useTextSizePref, sf, type TextScale, type TextSizePreference } from "@/lib/typography";
import { useRecordings } from "@/lib/recordings-context";
import { useClarifyMode, type ClarifyMode } from "@/lib/clarify-mode";


function AutoTranscribeSetting() {
  const { t, language } = useLanguage();
  const { isAutoTranscribeEnabled, setAutoTranscribe } = useRecordings();
  const ts = useTextScale();
  const aStyles = useMemo(() => makeAStyles(ts), [ts]);

  return (
    <View style={aStyles.section}>
      <View style={aStyles.menuRow}>
        <Feather name="mic" size={18} color={Colors.textSecondary} />
        <View style={{ flex: 1 }}>
          <Text style={aStyles.menuLabel}>
            {language === "es" ? "Auto-transcribir por defecto" : "Auto-transcribe by default"}
          </Text>
          <Text style={aStyles.menuSubLabel}>
            {language === "es"
              ? "Las grabaciones se transcribirán automáticamente. Desactívalo para elegir cuándo transcribir."
              : "Recordings will be transcribed automatically. Disable to choose when to transcribe."}
          </Text>
        </View>
        <Switch
          value={isAutoTranscribeEnabled}
          onValueChange={(val) => {
            setAutoTranscribe(val);
          }}
          trackColor={{ false: Colors.border, true: Colors.primary }}
          thumbColor="#fff"
        />
      </View>
    </View>
  );
}

function TextSizeSetting() {
  const { t } = useLanguage();
  const { pref, setPref } = useTextSizePref();
  const ts = useTextScale();
  const aStyles = useMemo(() => makeAStyles(ts), [ts]);
  const options: { key: TextSizePreference; label: string }[] = [
    { key: "small", label: t("settings.textSizeSmall" as any) },
    { key: "medium", label: t("settings.textSizeMedium" as any) },
    { key: "large", label: t("settings.textSizeLarge" as any) },
  ];
  return (
    <View style={aStyles.section}>
      <View style={aStyles.menuRow}>
        <Feather name="type" size={18} color={Colors.textSecondary} />
        <Text style={[aStyles.menuLabel, { flex: 1 }]}>{t("settings.textSize" as any)}</Text>
        <View style={aStyles.langToggle}>
          {options.map((o) => (
            <Pressable
              key={o.key}
              style={[aStyles.langPill, pref === o.key && aStyles.langPillActive]}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setPref(o.key);
              }}
              accessibilityRole="button"
              accessibilityState={{ selected: pref === o.key }}
              accessibilityLabel={o.label}
            >
              <Text style={[aStyles.langPillText, pref === o.key && aStyles.langPillTextActive]}>{o.label}</Text>
            </Pressable>
          ))}
        </View>
      </View>
      <Text style={{ color: Colors.textMuted, fontSize: ts.body, lineHeight: ts.body * 1.5, paddingHorizontal: 16, paddingBottom: 12 }}>
        {t("settings.textSizePreview" as any)}
      </Text>
    </View>
  );
}

function ClarifyModeSetting() {
  const { t } = useLanguage();
  const { clarifyMode, setClarifyMode } = useClarifyMode();
  const ts = useTextScale();
  const aStyles = useMemo(() => makeAStyles(ts), [ts]);
  const options: { key: ClarifyMode; label: string }[] = [
    { key: "always", label: t("settings.clarifyModeAlways" as any) },
    { key: "when_needed", label: t("settings.clarifyModeWhenNeeded" as any) },
    { key: "never", label: t("settings.clarifyModeNever" as any) },
  ];
  return (
    <View style={aStyles.section}>
      <View style={aStyles.menuRow}>
        <Feather name="help-circle" size={18} color={Colors.textSecondary} />
        <Text style={[aStyles.menuLabel, { flex: 1 }]}>{t("settings.clarifyMode" as any)}</Text>
      </View>
      <View style={{ flexDirection: "row", gap: 8, paddingHorizontal: 16, paddingBottom: 14 }}>
        {options.map((o) => (
          <Pressable
            key={o.key}
            style={[aStyles.clarifySeg, clarifyMode === o.key && aStyles.clarifySegActive]}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              setClarifyMode(o.key);
            }}
            accessibilityRole="button"
            accessibilityState={{ selected: clarifyMode === o.key }}
            accessibilityLabel={o.label}
          >
            <Text
              style={[aStyles.langPillText, clarifyMode === o.key && aStyles.langPillTextActive]}
              numberOfLines={1}
              adjustsFontSizeToFit
            >
              {o.label}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

export default function PreferencesScreen() {
  const insets = useSafeAreaInsets();
  const layout = useResponsiveLayout();
  const webTopInset = Platform.OS === "web" ? 67 : 0;
  const { t, language, setLanguage } = useLanguage();
  const ts = useTextScale();
  const aStyles = useMemo(() => makeAStyles(ts), [ts]);
  const styles = useMemo(() => makeStyles(ts), [ts]);
  const [privacyExpanded, setPrivacyExpanded] = useState(false);

  return (
    <View style={{ flex: 1, backgroundColor: Colors.background, paddingTop: insets.top + webTopInset }}>
      <View style={[styles.header, { maxWidth: layout.contentMaxWidth, alignSelf: "center", width: "100%", paddingHorizontal: layout.contentPadding }]}>
        <Pressable
          style={styles.backBtn}
          onPress={() => {
            if (router.canGoBack()) {
              router.back();
            } else {
              router.replace("/settings" as any);
            }
          }}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel={t("a11y.goBack")}
        >
          <Feather name="arrow-left" size={24} color={Colors.text} />
        </Pressable>
        <Text style={styles.headerTitle} accessibilityRole="header">
          {language === "es" ? "Preferencias" : "Preferences"}
        </Text>

      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingHorizontal: layout.contentPadding,
          paddingTop: 8,
          paddingBottom: insets.bottom + (Platform.OS === "web" ? 34 : 24),
          maxWidth: layout.contentMaxWidth,
          alignSelf: "center",
          width: "100%",
        }}
        showsVerticalScrollIndicator={false}
      >
        <View style={aStyles.section}>
          <View style={aStyles.menuRow}>
            <Feather name="globe" size={18} color={Colors.textSecondary} />
            <Text style={[aStyles.menuLabel, { flex: 1 }]}>{t("lang.language")}</Text>
            <View style={aStyles.langToggle}>
              <Pressable style={[aStyles.langPill, language === "en" && aStyles.langPillActive]} onPress={() => setLanguage("en" as Language)} accessibilityRole="button" accessibilityState={{ selected: language === "en" }}>
                <Text style={[aStyles.langPillText, language === "en" && aStyles.langPillTextActive]}>EN</Text>
              </Pressable>
              <Pressable style={[aStyles.langPill, language === "es" && aStyles.langPillActive]} onPress={() => setLanguage("es" as Language)} accessibilityRole="button" accessibilityState={{ selected: language === "es" }}>
                <Text style={[aStyles.langPillText, language === "es" && aStyles.langPillTextActive]}>ES</Text>
              </Pressable>
            </View>
          </View>
        </View>

        <AutoTranscribeSetting />

        <TextSizeSetting />

        <ClarifyModeSetting />

        <Pressable
          style={styles.privacyCard}
          onPress={() => setPrivacyExpanded(!privacyExpanded)}
          accessibilityRole="button"
          accessibilityLabel={t("privacy.title")}
          accessibilityState={{ expanded: privacyExpanded }}
        >
          <View style={styles.privacyHeader}>
            <Feather name="shield" size={16} color={Colors.primary} />
            <Text style={styles.privacyTitle}>{t("privacy.title")}</Text>
            <Feather name={privacyExpanded ? "chevron-up" : "chevron-down"} size={18} color={Colors.textMuted} />
          </View>
          {privacyExpanded && (
            <View style={styles.privacyBody}>
              <View style={styles.privacyItem}>
                <Feather name="shield" size={14} color={Colors.textMuted} />
                <Text style={styles.privacyText}>{t("privacy.localBody")}</Text>
              </View>
              <View style={styles.privacyItem}>
                <Feather name="lock" size={14} color={Colors.textMuted} />
                <Text style={styles.privacyText}>{t("privacy.voiceBody")}</Text>
              </View>
              <View style={styles.privacyItem}>
                <Feather name="user" size={14} color={Colors.textMuted} />
                <Text style={styles.privacyText}>{t("privacy.anonymousId")}</Text>
              </View>
              <View style={styles.privacyItem}>
                <Feather name="download" size={14} color={Colors.textMuted} />
                <Text style={styles.privacyText}>{t("privacy.ownershipBody")}</Text>
              </View>
            </View>
          )}
        </Pressable>
      </ScrollView>
    </View>
  );
}

const makeAStyles = (ts: TextScale) => StyleSheet.create({
  section: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    borderWidth: 0,
    marginBottom: 16,
    overflow: "hidden",
  },
  menuRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    paddingHorizontal: 16,
    gap: 12,
    minHeight: 48,
  },
  menuLabel: {
    fontSize: sf(15, ts),
    fontFamily: "Inter_500Medium",
    color: Colors.text,
  },
  menuSubLabel: {
    marginTop: 4,
    fontSize: sf(12, ts),
    fontFamily: "Inter_400Regular",
    color: Colors.textMuted,
    lineHeight: sf(17, ts),
  },
  langToggle: {
    flexDirection: "row",
    backgroundColor: Colors.surfaceLight,
    borderRadius: 8,
    borderWidth: 0,
    overflow: "hidden",
  },
  langPill: {
    paddingVertical: 6,
    paddingHorizontal: 14,
    minWidth: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  langPillActive: {
    backgroundColor: "rgba(0, 180, 216, 0.2)",
  },
  langPillText: {
    fontSize: sf(13, ts),
    fontFamily: "Inter_500Medium",
    color: Colors.textMuted,
  },
  langPillTextActive: {
    color: Colors.primary,
    fontFamily: "Inter_600SemiBold",
  },
  clarifySeg: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 6,
    borderRadius: 8,
    backgroundColor: Colors.surfaceLight,
    alignItems: "center",
    justifyContent: "center",
  },
  clarifySegActive: {
    backgroundColor: "rgba(0, 180, 216, 0.2)",
  },
});

const makeStyles = (ts: TextScale) => StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 14,
  },
  backBtn: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: Colors.surface,
    justifyContent: "center",
    alignItems: "center",
  },
  headerTitle: {
    fontSize: sf(18, ts),
    fontFamily: "Inter_700Bold",
    color: Colors.text,
  },
  privacyCard: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 16,
    borderWidth: 0,
    marginBottom: 24,
  },
  privacyHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  privacyTitle: {
    flex: 1,
    fontSize: sf(14, ts),
    fontFamily: "Inter_600SemiBold",
    color: Colors.text,
  },
  privacyBody: {
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  privacyItem: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    marginBottom: 10,
  },
  privacyText: {
    flex: 1,
    fontSize: sf(13, ts),
    fontFamily: "Inter_400Regular",
    color: Colors.textSecondary,
    lineHeight: 18,
  },
});
