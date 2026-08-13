import React, { useState, useEffect, useCallback } from "react";
import {
  StyleSheet,
  Text,
  View,
  Pressable,
  Platform,
  Animated,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Feather from "@react-native-vector-icons/feather/static";
import Colors from "@/constants/colors";
import { useLanguage } from "@/lib/i18n";
import { useTextScale } from "@/lib/typography";

const DISMISS_KEY = "@noted_install_prompt_dismissed";
const DISMISS_DURATION_DAYS = 7;

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export default function InstallPrompt() {
  const { t } = useLanguage();
  const ts = useTextScale();
  const [visible, setVisible] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const slideAnim = useState(new Animated.Value(200))[0];

  const showBanner = useCallback(() => {
    setVisible(true);
    Animated.spring(slideAnim, {
      toValue: 0,
      useNativeDriver: true,
      tension: 65,
      friction: 11,
    }).start();
  }, [slideAnim]);

  const handleBeforeInstall = useCallback((e: Event) => {
    e.preventDefault();
    setDeferredPrompt(e as BeforeInstallPromptEvent);
    showBanner();
  }, [showBanner]);

  const checkAndShow = useCallback(async () => {
    try {
      const dismissed = await AsyncStorage.getItem(DISMISS_KEY);
      if (dismissed) {
        const dismissedAt = parseInt(dismissed);
        if (Date.now() - dismissedAt < DISMISS_DURATION_DAYS * 24 * 60 * 60 * 1000) {
          return;
        }
      }
    } catch {}

    if (typeof window === "undefined") return;

    const isStandalone =
      (window.navigator as any).standalone === true ||
      window.matchMedia("(display-mode: standalone)").matches;

    if (isStandalone) return;

    const ua = navigator.userAgent || "";
    const isiOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

    if (isiOS) {
      const isSafari = /Safari/.test(ua) && !/CriOS|FxiOS|OPiOS/.test(ua);
      if (isSafari) {
        setIsIOS(true);
        showBanner();
      }
      return;
    }

    window.addEventListener("beforeinstallprompt", handleBeforeInstall as EventListener);
    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstall as EventListener);
    };
  }, [handleBeforeInstall, showBanner]);

  useEffect(() => {
    if (Platform.OS !== "web") return;
    let cleanup: void | (() => void);
    let cancelled = false;
    checkAndShow().then((nextCleanup) => {
      if (cancelled) {
        nextCleanup?.();
      } else {
        cleanup = nextCleanup;
      }
    });
    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [checkAndShow]);

  const hideBanner = useCallback(async () => {
    Animated.timing(slideAnim, {
      toValue: 200,
      duration: 250,
      useNativeDriver: true,
    }).start(() => setVisible(false));
    try {
      await AsyncStorage.setItem(DISMISS_KEY, Date.now().toString());
    } catch {}
  }, [slideAnim]);

  const handleInstall = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === "accepted") {
        hideBanner();
      }
      setDeferredPrompt(null);
    } else if (isIOS) {
      hideBanner();
    }
  };

  if (!visible || Platform.OS !== "web") return null;

  return (
    <Animated.View
      style={[
        styles.container,
        { transform: [{ translateY: slideAnim }] },
      ]}
    >
      <View style={styles.inner} accessibilityLabel={t("a11y.installApp")} accessibilityRole="alert">
        <View style={styles.iconWrap}>
          <Feather name="download" size={22} color={Colors.primary} />
        </View>
        <View style={styles.textWrap}>
          <Text style={[styles.title, { fontSize: ts.body2 }]}>{t("install.title")}</Text>
          <Text style={[styles.subtitle, { fontSize: ts.caption }]}>
            {isIOS ? t("install.iosHint") : t("install.androidHint")}
          </Text>
        </View>
        {!isIOS && (
          <Pressable style={styles.installBtn} onPress={handleInstall} accessibilityLabel={t("a11y.installApp")} accessibilityRole="button">
            <Text style={[styles.installBtnText, { fontSize: ts.body }]}>{t("install.button")}</Text>
          </Pressable>
        )}
        <Pressable style={styles.closeBtn} onPress={hideBanner} accessibilityLabel={t("a11y.dismissInstall")} accessibilityRole="button">
          <Feather name="x" size={18} color={Colors.textMuted} />
        </Pressable>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    zIndex: 999,
    paddingHorizontal: 12,
    paddingBottom: 12,
  },
  inner: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 14,
    gap: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    ...Platform.select({
      ios: { shadowColor: "#000", shadowOffset: { width: 0, height: -4 }, shadowOpacity: 0.15, shadowRadius: 12 },
      android: { elevation: 8 },
      web: { boxShadow: "0 -4px 12px rgba(0, 0, 0, 0.15)" },
    }),
  },
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: "rgba(0, 180, 216, 0.12)",
    justifyContent: "center",
    alignItems: "center",
  },
  textWrap: {
    flex: 1,
  },
  title: {
    fontFamily: "Inter_600SemiBold",
    color: Colors.text,
  },
  subtitle: {
    fontFamily: "Inter_400Regular",
    color: Colors.textSecondary,
    marginTop: 2,
    lineHeight: 17,
  },
  installBtn: {
    backgroundColor: Colors.primary,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
  },
  installBtnText: {
    fontFamily: "Inter_600SemiBold",
    color: Colors.white,
  },
  closeBtn: {
    width: 44,
    height: 44,
    justifyContent: "center",
    alignItems: "center",
  },
});
