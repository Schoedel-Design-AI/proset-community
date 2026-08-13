import React, { useMemo } from "react";
import { StyleSheet, Text, View, ScrollView, Pressable, Platform } from "react-native";
import { router } from "@/lib/navigation";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Feather from "@react-native-vector-icons/feather/static";
import Colors from "@/constants/colors";
import { useResponsiveLayout } from "@/lib/useResponsiveLayout";
import { useAuth } from "@/lib/auth-context";
import { useLanguage } from "@/lib/i18n";
import { useTextScale, sf, type TextScale } from "@/lib/typography";


export default function SettingsIndex() {
  const insets = useSafeAreaInsets();
  const layout = useResponsiveLayout();
  const webTopInset = Platform.OS === "web" ? 67 : 0;
  const { user } = useAuth();
  const { t, language } = useLanguage();
  const ts = useTextScale();
  const styles = useMemo(() => makeIndexStyles(ts), [ts]);

  const categories: { key: string; icon: React.ComponentProps<typeof Feather>["name"]; title: string; description: string; route: string }[] = [
    ...(user
      ? [
          {
            key: "account",
            icon: "user" as React.ComponentProps<typeof Feather>["name"],
            title: t("settings.account"),
            description: language === "es" ? "Perfil y suscripción" : "Profile and subscription",
            route: "/settings/account",
          },
        ]
      : []),
    {
      key: "preferences",
      icon: "settings" as React.ComponentProps<typeof Feather>["name"],
      title: language === "es" ? "Preferencias" : "Preferences",
      description: language === "es" ? "Idioma, tamaño de texto, privacidad" : "Language, text size, privacy",
      route: "/settings/preferences",
    },
  ];

  return (
    <View style={[styles.container, { paddingTop: insets.top + webTopInset }]}>
      <View style={[styles.header, { maxWidth: layout.contentMaxWidth, alignSelf: "center", width: "100%", paddingHorizontal: layout.contentPadding }]}>
        <Pressable
          style={styles.backBtn}
          onPress={() => {
            if (router.canGoBack()) {
              router.back();
            } else {
              router.replace("/");
            }
          }}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel={t("a11y.goBack")}
        >
          <Feather name="arrow-left" size={24} color={Colors.text} />
        </Pressable>
        <Text style={styles.headerTitle} accessibilityRole="header">{t("settings.title")}</Text>

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
        {categories.map((cat) => (
          <Pressable
            key={cat.key}
            style={({ pressed }) => [styles.categoryCard, pressed && { opacity: 0.7, transform: [{ scale: 0.98 }] }]}
            onPress={() => router.push(cat.route as any)}
            accessibilityRole="button"
            accessibilityLabel={cat.title}
          >
            <View style={styles.categoryIcon}>
              <Feather name={cat.icon} size={22} color={Colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.categoryTitle}>{cat.title}</Text>
              <Text style={styles.categoryDesc}>{cat.description}</Text>
            </View>
            <Feather name="chevron-right" size={20} color={Colors.textMuted} />
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

const makeIndexStyles = (ts: TextScale) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: Colors.background,
    },
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingVertical: 16,
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
    categoryCard: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: Colors.surface,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: Colors.border,
      paddingVertical: 16,
      paddingHorizontal: 16,
      marginBottom: 10,
      gap: 14,
    },
    categoryIcon: {
      width: 44,
      height: 44,
      borderRadius: 12,
      backgroundColor: "rgba(0, 180, 216, 0.08)",
      justifyContent: "center",
      alignItems: "center",
    },
    categoryTitle: {
      fontSize: sf(16, ts),
      fontFamily: "Inter_600SemiBold",
      color: Colors.text,
      marginBottom: 3,
    },
    categoryDesc: {
      fontSize: sf(13, ts),
      fontFamily: "Inter_400Regular",
      color: Colors.textSecondary,
    },
  });
