import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  StyleSheet,
  Text,
  View,
  Pressable,
  Platform,
  Animated,
  Dimensions,
  Linking,
  Modal,
  ActivityIndicator,
} from "react-native";
import { router } from "@/lib/navigation";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "@/lib/haptics";
import Colors from "@/constants/colors";
import { useLanguage } from "@/lib/i18n";
import { useTextScale, sf } from "@/lib/typography";
import DrawerFeatherIcon, { type DrawerFeatherIconName } from "@/components/DrawerFeatherIcon";
import Feather from "@react-native-vector-icons/feather/static";
import { useAudioInputSettings } from "@/lib/audio-input-settings";

type Props = {
  visible: boolean;
  onClose: () => void;
  isAdmin: boolean;
  isLoggedIn: boolean;
  planLabel: string;
  isPro: boolean;
  onFeedback: () => void;
  onTypeToConvert: () => void;
};

export default function NavigationDrawer({
  visible,
  onClose,
  isAdmin,
  isLoggedIn,
  planLabel,
  isPro,
  onFeedback,
  onTypeToConvert,
}: Props) {
  const insets = useSafeAreaInsets();
  const { language, toggleLanguage, t } = useLanguage();
  const ts = useTextScale();
  const slideAnim = useRef(new Animated.Value(-Dimensions.get("window").width)).current;
  const overlayAnim = useRef(new Animated.Value(0)).current;
  const [mounted, setMounted] = useState(false);
  const [emailCopied, setEmailCopied] = useState(false);
  const webTopInset = Platform.OS === "web" ? 67 : 0;
  const year = new Date().getFullYear();

  const audioInput = useAudioInputSettings();
  const [showAudioModal, setShowAudioModal] = useState(false);

  const handleCopyEmail = useCallback(async () => {
    try {
      const Clipboard = await import("@/lib/clipboard");
      const parts = ["contact", "schoedel", "design"];
      await Clipboard.setStringAsync(`${parts[0]}@${parts[1]}.${parts[2]}`);
      setEmailCopied(true);
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setTimeout(() => setEmailCopied(false), 2000);
    } catch {}
  }, []);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      Animated.parallel([
        Animated.timing(slideAnim, {
          toValue: 0,
          duration: 250,
          useNativeDriver: true,
        }),
        Animated.timing(overlayAnim, {
          toValue: 1,
          duration: 250,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(slideAnim, {
          toValue: -Dimensions.get("window").width,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.timing(overlayAnim, {
          toValue: 0,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start(() => setMounted(false));
    }
  }, [visible, overlayAnim, slideAnim]);

  // Stay mounted while the Audio Input modal is open: the drawer subtree
  // unmounts 200ms after close starts (`setMounted(false)`), which used to
  // destroy the modal mid-open (it flashed and died — "goes to Home"). The
  // modal is a direct child of the root container, so keeping the component
  // alive while showAudioModal is true lets it open reliably after the drawer
  // closes, with no ghost modal on the next hamburger press.
  if (!mounted && !showAudioModal) return null;

  const handleNav = (action: () => void) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onClose();
    setTimeout(action, 100);
  };

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {showAudioModal ? (
        // Audio Input modal renders as a direct child of the drawer's root
        // container (NOT inside the animated drawer View) so it is NOT
        // unmounted when the drawer finishes its close animation. Previously
        // it lived inside the drawer subtree that `if (!mounted) return null`
        // destroyed 200ms after close started — the modal flashed and died
        // ("goes to Home"), and the native modal window could linger and
        // reappear when the drawer was reopened via the hamburger.
        <Modal visible transparent animationType="fade" onRequestClose={() => setShowAudioModal(false)}>
          <Pressable style={styles.audioOverlay} onPress={() => setShowAudioModal(false)}>
            <Pressable style={styles.audioModal} onPress={(e) => e.stopPropagation()}>
              <View style={styles.audioHeader}>
                <Text style={styles.audioTitle}>Audio Input</Text>
                <Pressable onPress={() => setShowAudioModal(false)} hitSlop={8}>
                  <Feather name="x" size={20} color={Colors.textSecondary} />
                </Pressable>
              </View>
              <Text style={styles.audioHint}>Select the microphone to use for recording.</Text>
              {Platform.OS === "android" ? (
                <>
                  <View style={[styles.audioDeviceOption, styles.audioDeviceOptionSelected]}>
                    <Feather name="check-circle" size={18} color={Colors.primary} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.audioDeviceLabel}>Android Default</Text>
                      <Text style={styles.audioDeviceHint}>Device switching requires a native audio pipeline update</Text>
                    </View>
                  </View>
                  <Text style={[styles.audioHint, { marginTop: 12, textAlign: "center" }]}>
                    Android uses the system default microphone. USB and Bluetooth device switching will be available in a future update.
                  </Text>
                </>
              ) : (
                <>
                  {/* System Default option */}
                  <Pressable
                    style={[
                      styles.audioDeviceOption,
                      audioInput.selectedDeviceId === null && styles.audioDeviceOptionSelected,
                    ]}
                    onPress={() => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      void audioInput.selectDevice("default").catch(() => {});
                    }}
                  >
                    <Feather
                      name={audioInput.selectedDeviceId === null ? "check-circle" : "circle"}
                      size={18}
                      color={audioInput.selectedDeviceId === null ? Colors.primary : Colors.textMuted}
                    />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.audioDeviceLabel}>System Default</Text>
                      <Text style={styles.audioDeviceHint}>Let the OS choose the best microphone</Text>
                    </View>
                  </Pressable>
                  {audioInput.loading ? (
                    <ActivityIndicator size="small" color={Colors.primary} style={{ marginVertical: 16 }} />
                  ) : audioInput.devices.length === 0 ? (
                    <Text style={styles.audioHint}>No audio input devices found</Text>
                  ) : (
                    audioInput.devices.map((device) => (
                      <Pressable
                        key={device.deviceId}
                        style={[
                          styles.audioDeviceOption,
                          audioInput.selectedDeviceId === device.deviceId && styles.audioDeviceOptionSelected,
                        ]}
                        onPress={() => {
                          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                          void audioInput.selectDevice(device.deviceId).catch(() => {});
                        }}
                      >
                        <Feather
                          name={audioInput.selectedDeviceId === device.deviceId ? "check-circle" : "circle"}
                          size={18}
                          color={audioInput.selectedDeviceId === device.deviceId ? Colors.primary : Colors.textMuted}
                        />
                        <View style={{ flex: 1 }}>
                          <Text style={styles.audioDeviceLabel}>{device.label}</Text>
                        </View>
                      </Pressable>
                    ))
                  )}
                  {Platform.OS === "web" && audioInput.devices.length > 0 && (
                    <Pressable style={styles.audioRefreshBtn} onPress={() => { void audioInput.refreshDevices().catch(() => {}); }}>
                      <Feather name="refresh-cw" size={14} color={Colors.primary} />
                      <Text style={styles.audioRefreshText}>Refresh devices</Text>
                    </Pressable>
                  )}
                </>
              )}
              <Pressable
                style={({ pressed }) => [styles.audioDoneBtn, pressed && { opacity: 0.8 }]}
                onPress={() => setShowAudioModal(false)}
              >
                <Text style={styles.audioDoneBtnText}>Done</Text>
              </Pressable>
            </Pressable>
          </Pressable>
        </Modal>
      ) : null}
      <Animated.View
        style={[styles.overlay, { opacity: overlayAnim }]}
        pointerEvents="auto"
      >
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          accessibilityLabel={t("drawer.close")}
          accessibilityRole="button"
          testID="drawer-overlay"
        />
      </Animated.View>
      <Animated.View
        style={[
          styles.drawer,
          {
            transform: [{ translateX: slideAnim }],
            paddingTop: insets.top + webTopInset + 16,
            paddingBottom: insets.bottom + (Platform.OS === "web" ? 34 : 16),
          },
        ]}
        accessibilityRole="menu"
        testID="navigation-drawer"
      >
        <View style={styles.drawerHeader}>
          <Text style={[styles.drawerTitle, { fontSize: sf(22, ts) }]}>
            Proset
          </Text>
          <View style={[styles.planBadge, isPro && styles.planBadgePro]}>
            <Text style={[styles.planBadgeText, { fontSize: ts.sm }, isPro && styles.planBadgeTextPro]}>
              {planLabel}
            </Text>
          </View>
          <View style={{ flex: 1 }} />
          <Pressable
            onPress={onClose}
            style={styles.closeBtn}
            accessibilityLabel={t("drawer.close")}
            accessibilityRole="button"
            testID="drawer-close-btn"
          >
            <DrawerFeatherIcon name="x" size={22} color={Colors.textSecondary} />
          </Pressable>
        </View>

        <View style={styles.drawerItems}>
          {isLoggedIn && (
            <>
              {!isPro && (
                <DrawerItem
                  icon="credit-card"
                  label={t("drawer.subscribe")}
                  onPress={() => handleNav(() => router.push("/choose-plan" as any))}
                  ts={ts}
                  testID="drawer-subscribe"
                />
              )}
              <DrawerItem
                icon="user"
                label={t("settings.account")}
                onPress={() => handleNav(() => router.push("/settings/account" as any))}
                ts={ts}
                testID="drawer-account"
              />
              <DrawerItem
                icon="sliders"
                label={t("settings.aiConfiguration")}
                onPress={() => handleNav(() => router.push("/settings/ai-config" as any))}
                ts={ts}
                testID="drawer-ai-config"
              />
              <DrawerItem
                icon="music"
                label={t("drawer.music")}
                locked
                ts={ts}
                testID="drawer-music"
              />
              <Pressable
                onPress={() => handleNav(() => setShowAudioModal(true))}
                style={({ pressed }) => [styles.drawerItem, pressed && styles.drawerItemPressed]}
                accessibilityRole="menuitem"
                testID="drawer-audio-input"
              >
                <Feather name="mic" size={20} color={Colors.textSecondary} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.drawerItemLabel, { fontSize: sf(15, ts) }]}>{t("drawer.audioInput")}</Text>
                  {audioInput.selectedDeviceId && (
                    <Text style={styles.audioDeviceSubtitle} numberOfLines={1}>
                      {audioInput.devices.find(d => d.deviceId === audioInput.selectedDeviceId)?.label || "System Default"}
                    </Text>
                  )}
                </View>
              </Pressable>
            </>
          )}

          <DrawerItem
            icon="book-open"
            label={t("drawer.documentation")}
            onPress={() =>
              handleNav(async () => {
                const { getApiUrl } = await import("@/lib/query-client");
                // new URL() normalizes the trailing slash from getApiUrl()
                // (native returns https://proset.ai/) — string concat produced
                // //documentation, which Cloudflare serves as the landing page.
                const docsUrl = new URL("/documentation/", getApiUrl()).toString();
                if (Platform.OS === "web") {
                  window.open(docsUrl, "_blank");
                } else {
                  Linking.openURL(docsUrl);
                }
              })
            }
            ts={ts}
            testID="drawer-documentation"
          />

          {isLoggedIn && (
            <>
              <DrawerItem
                icon="folder"
                label={t("drawer.files")}
                onPress={() => handleNav(() => router.push("/files"))}
                ts={ts}
                testID="drawer-files"
              />
              <DrawerItem
                icon="cloud"
                label={t("settings.integrationsSync")}
                onPress={() => handleNav(() => router.push("/settings/integrations" as any))}
                ts={ts}
                testID="drawer-integrations"
              />
              <DrawerItem
                icon="settings"
                label={t("settings.preferences")}
                onPress={() => handleNav(() => router.push("/settings/preferences" as any))}
                ts={ts}
                testID="drawer-preferences"
              />
              <DrawerItem
                icon="git-branch"
                label={t("drawer.thoughtThreads" as any)}
                onPress={() => handleNav(() => router.push("/thought-threads" as any))}
                ts={ts}
                testID="drawer-thought-threads"
              />
            </>
          )}

          {isAdmin && (
            <DrawerItem
              icon="bar-chart-2"
              label={t("drawer.admin")}
              onPress={() => handleNav(() => router.push("/admin"))}
              ts={ts}
              testID="drawer-admin"
              iconColor={Colors.warning}
            />
          )}





          <View style={styles.separator} />

          <Pressable
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              toggleLanguage();
            }}
            style={styles.drawerItem}
            accessibilityRole="button"
            accessibilityLabel={language === "en" ? "Switch to Spanish" : "Switch to English"}
            testID="drawer-language-toggle"
          >
            <DrawerFeatherIcon name="globe" size={20} color={Colors.textSecondary} />
            <Text style={[styles.drawerItemLabel, { fontSize: sf(15, ts) }]}>
              {language === "en" ? "Español" : "English"}
            </Text>
          </Pressable>
        </View>

        <View style={styles.drawerFooter}>
          <View style={styles.drawerFooterRow}>
            <Text style={[styles.drawerFooterText, { fontSize: sf(12, ts) }]}>{"\u00A9"} {year} </Text>
            <Pressable onPress={() => Linking.openURL("https://schoedel.design")} accessibilityRole="link" accessibilityLabel={t("a11y.schoedelDesignWebsite")}>
              <Text style={[styles.drawerFooterLink, { fontSize: sf(12, ts) }]}>Schoedel Design AI</Text>
            </Pressable>
          </View>
          <Pressable onPress={handleCopyEmail} style={styles.drawerFooterEmailRow} accessibilityRole="button" accessibilityLabel={t("a11y.copyEmail")} accessibilityHint={t("a11y.copyEmailHint")}>
            <DrawerFeatherIcon name="mail" size={12} color={Colors.textMuted} />
            <Text style={[styles.drawerFooterEmail, { fontSize: sf(11, ts) }]}>
              {"contact"}
              {"\u0040"}
              {"schoedel"}
              {"\u002E"}
              {"design"}
            </Text>
            <DrawerFeatherIcon name={emailCopied ? "check" : "copy"} size={12} color={emailCopied ? Colors.primary : Colors.textMuted} />
          </Pressable>
        </View>
      </Animated.View>
    </View>
  );
}

function DrawerItem({
  icon,
  label,
  onPress,
  ts,
  testID,
  iconColor,
  locked,
}: {
  icon: DrawerFeatherIconName;
  label: string;
  onPress?: () => void;
  ts: import("@/lib/typography").TextScale;
  testID?: string;
  iconColor?: string;
  locked?: boolean;
}) {
  const { t } = useLanguage();

  if (locked) {
    return (
      <View
        style={styles.drawerItem}
        accessibilityRole="menuitem"
        accessibilityState={{ disabled: true }}
        accessibilityLabel={`${label}, ${t("a11y.locked" as any)}`}
        testID={testID}
      >
        <DrawerFeatherIcon name={icon} size={20} color={Colors.textMuted} />
        <Text style={[styles.drawerItemLabel, styles.drawerItemLabelLocked, { fontSize: sf(15, ts) }]}>{label}</Text>
        <DrawerFeatherIcon name="lock" size={14} color={Colors.textMuted} style={styles.drawerItemLock} />
      </View>
    );
  }

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.drawerItem, pressed && styles.drawerItemPressed]}
      accessibilityRole="menuitem"
      testID={testID}
    >
      <DrawerFeatherIcon name={icon} size={20} color={iconColor || Colors.textSecondary} />
      <Text style={[styles.drawerItemLabel, { fontSize: sf(15, ts) }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: Colors.overlay,
    zIndex: 100,
  },
  drawer: {
    position: "absolute",
    top: 0,
    left: 0,
    bottom: 0,
    width: 300,
    backgroundColor: Colors.surface,
    zIndex: 101,
    borderRightWidth: 1,
    borderRightColor: Colors.border,
    ...Platform.select({
      ios: {
        shadowColor: "#000",
        shadowOffset: { width: 4, height: 0 },
        shadowOpacity: 0.25,
        shadowRadius: 16,
      },
      android: { elevation: 16 },
      web: { boxShadow: "4px 0 16px rgba(0,0,0,0.25)" },
    }),
  },
  drawerHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingBottom: 20,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    gap: 10,
  },
  drawerTitle: {
    fontFamily: "Inter_700Bold",
    color: Colors.text,
  },
  planBadge: {
    backgroundColor: Colors.border,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  planBadgePro: {
    backgroundColor: Colors.primary + "18",
  },
  planBadgeText: {
    fontFamily: "Inter_600SemiBold",
    color: Colors.textSecondary,
  },
  planBadgeTextPro: {
    color: Colors.primary,
  },
  closeBtn: {
    width: 40,
    height: 40,
    borderRadius: 10,
    justifyContent: "center",
    alignItems: "center",
  },
  drawerItems: {
    paddingTop: 20,
    paddingHorizontal: 12,
  },
  drawerItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingVertical: 15,
    paddingHorizontal: 12,
    borderRadius: 10,
  },
  drawerItemPressed: {
    backgroundColor: Colors.surfaceLight,
  },
  drawerItemLabel: {
    fontFamily: "Inter_500Medium",
    color: Colors.text,
  },
  drawerItemLabelLocked: {
    color: Colors.textMuted,
  },
  drawerItemLock: {
    marginLeft: "auto",
  },
  audioDeviceSubtitle: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    color: Colors.textMuted,
    marginTop: 1,
  },
  separator: {
    height: 1,
    backgroundColor: "rgba(30, 51, 85, 0.4)",
    marginVertical: 14,
    marginHorizontal: 4,
  },
  drawerFooter: {
    marginTop: "auto",
    alignItems: "center",
    paddingVertical: 16,
    paddingHorizontal: 20,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    gap: 6,
  },
  drawerFooterRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  drawerFooterText: {
    fontFamily: "Inter_400Regular",
    color: Colors.textMuted,
  },
  drawerFooterLink: {
    fontFamily: "Inter_500Medium",
    color: Colors.textMuted,
  },
  drawerFooterEmailRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  drawerFooterEmail: {
    fontFamily: "Inter_400Regular",
    color: Colors.textMuted,
  },
  audioOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  audioModal: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 24,
    width: "100%",
    maxWidth: 380,
    maxHeight: "80%",
  },
  audioHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  audioTitle: {
    fontSize: 18,
    fontFamily: "Inter_700Bold",
    color: Colors.text,
  },
  audioHint: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    color: Colors.textSecondary,
    marginBottom: 16,
  },
  audioDeviceOption: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 10,
    marginBottom: 4,
    backgroundColor: Colors.surfaceLight,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  audioDeviceOptionSelected: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primary + "10",
  },
  audioDeviceLabel: {
    fontSize: 14,
    fontFamily: "Inter_500Medium",
    color: Colors.text,
  },
  audioDeviceHint: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    color: Colors.textMuted,
    marginTop: 2,
  },
  audioRefreshBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 12,
  },
  audioRefreshText: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    color: Colors.primary,
  },
  audioDoneBtn: {
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: Colors.primaryButton,
    alignItems: "center",
    marginTop: 8,
  },
  audioDoneBtnText: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
    color: Colors.white,
  },
});
