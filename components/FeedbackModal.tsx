import React, { useState, useEffect, useRef } from "react";
import {
  Modal,
  View,
  Text,
  Pressable,
  TextInput,
  StyleSheet,
  ActivityIndicator,
  Platform,
  ScrollView,
  Keyboard,
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Feather from "@react-native-vector-icons/feather/static";
import * as Haptics from "@/lib/haptics";
import Colors from "@/constants/colors";
import { useAuth } from "@/lib/auth-context";
import { getApiUrl, getAuthHeaders } from "@/lib/query-client";
import { useLanguage } from "@/lib/i18n";
import { useTextScale } from "@/lib/typography";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getDocumentAsync, DocumentPickerAsset } from "@/lib/expo-document-picker";

type CategoryDef = { labelKey: string; value: string };
const CATEGORY_DEFS: CategoryDef[] = [
  { labelKey: "feedback.notWorking", value: "Bug" },
  { labelKey: "feedback.howDoI", value: "How?" },
  { labelKey: "feedback.featureRequest", value: "Request" },
  { labelKey: "feedback.uiDesign", value: "Design" },
  { labelKey: "feedback.general", value: "General" },
  { labelKey: "feedback.performance", value: "Performance" },
  { labelKey: "feedback.other", value: "Bill" },
  { labelKey: "feedback.other", value: "Data" },
];

const cleanCategoryLabel = (label: string) => label.replace(/^Bug:\s*/i, "").replace(/^\uD83D\uDC1B\s*/, "");

type Props = {
  visible: boolean;
  onClose: () => void;
};

export default function FeedbackModal({ visible, onClose }: Props) {
  const { user } = useAuth();
  const { t } = useLanguage();
  const ts = useTextScale();
  const insets = useSafeAreaInsets();
  const { height: viewportHeight } = useWindowDimensions();
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [category, setCategory] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const [attachment, setAttachment] = useState<DocumentPickerAsset | null>(null);
  const draftLoaded = useRef(false);

  // Track keyboard height for precise layout
  useEffect(() => {
    const showSub = Keyboard.addListener(
      Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow",
      (e) => setKeyboardHeight(e.endCoordinates.height)
    );
    const hideSub = Keyboard.addListener(
      Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide",
      () => setKeyboardHeight(0)
    );
    return () => { showSub.remove(); hideSub.remove(); };
  }, []);

  useEffect(() => {
    if (visible) {
      setSent(false);
      setSending(false);
      setError("");
      draftLoaded.current = false;
      Promise.all([
        AsyncStorage.getItem("feedbackDraftCategory"),
        AsyncStorage.getItem("feedbackDraftMessage"),
      ]).then(([c, m]) => {
        if (c) setCategory(c);
        if (m) setMessage(m);
        draftLoaded.current = true;
      }).catch((err) => { console.warn("Failed to load feedback draft:", err); draftLoaded.current = true; });
    } else {
      // Clear attachment when modal hides so it doesn't persist forever if they don't submit
      setAttachment(null);
    }
  }, [visible]);

  useEffect(() => {
    if (visible && !sent && draftLoaded.current && message.length > 0) {
      AsyncStorage.setItem("feedbackDraftCategory", category);
      AsyncStorage.setItem("feedbackDraftMessage", message);
    }
  }, [category, message, visible, sent]);

  const handleClose = () => {
    onClose();
  };

  const handleSend = async () => {
    if (!category || !message.trim()) return;
    setSending(true);
    setError("");

    try {
      const formData = new FormData();
      formData.append("category", category);
      formData.append("message", message.trim());
      formData.append("userEmail", user?.email || "");

      if (attachment) {
        if (Platform.OS === "web") {
          const response = await fetch(attachment.uri);
          const blob = await response.blob();
          formData.append("image", blob, attachment.name);
        } else {
          formData.append("image", {
            uri: attachment.uri,
            type: attachment.mimeType || "image/jpeg",
            name: attachment.name,
          } as any);
        }
      }

      // NOTE: build via new URL() — getApiUrl() has a trailing slash on native
      // ("https://proset.ai/"), so naive concat yields "//api/feedback", which
      // Cloudflare answers with 405 + empty body (regression 2026-08-11: web
      // worked because loc.origin has no trailing slash, native always failed).
      const res = await fetch(new URL("/api/feedback", getApiUrl()).toString(), {
        method: "POST",
        body: formData,
        headers: getAuthHeaders(),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => res.statusText);
        throw new Error(text);
      }

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setSent(true);
      setCategory("");
      setMessage("");
      setAttachment(null);
      AsyncStorage.removeItem("feedbackDraftCategory");
      AsyncStorage.removeItem("feedbackDraftMessage");
    } catch (err: any) {
      const msg = err.message || t("common.somethingWentWrong");
      if (msg.includes("503") || msg.includes("not configured") || msg.includes("email")) {
        setError(t("feedback.emailNotConfigured"));
      } else {
        setError(msg);
      }
    } finally {
      setSending(false);
    }
  };

  const canSend = category && message.trim().length > 0 && !sending;

  // Layout: modal docks to keyboard top on mobile, stays centered on web.
  // Optimized for mobile viewport + on-screen keyboard: always reserve space for the
  // input (min 120) + footer so the user can type and submit without the modal
  // being pushed completely off-screen or the input being hidden.
  const isWeb = Platform.OS === "web";
  const isAndroid = Platform.OS === "android";
  const keyboardActive = keyboardHeight > 0;
  const topPad = isWeb ? 24 : insets.top + (isAndroid ? 24 : 16);
  const bottomPad = keyboardActive ? 8 : Math.max(insets.bottom, isAndroid ? 24 : 16);

  // Reserve chrome (header + banner + category + labels + attachment + footer) + input
  const inputReserve = keyboardActive ? 140 : 120;
  const availableHeight = viewportHeight - topPad - bottomPad - keyboardHeight;
  const targetMax = Math.max(
    keyboardActive ? (inputReserve + 100) : (isAndroid ? 420 : 300),
    Math.min(680, availableHeight - (keyboardActive ? 40 : 0))
  );
  const modalMaxHeight = Math.min(targetMax, 680);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleClose}>
      <View style={[styles.overlay, { paddingTop: topPad, paddingBottom: bottomPad + keyboardHeight }]}>
        {/* Backdrop tap closes the modal */}
        <Pressable style={StyleSheet.absoluteFill} onPress={handleClose} />
        <View style={[styles.keyboardSpacer, sent && styles.keyboardSpacerSent, { maxHeight: sent ? undefined : modalMaxHeight }]}>
          <View style={[styles.modal, sent && styles.modalSent, !sent && { maxHeight: modalMaxHeight }]}>
            {sent ? (
              <Pressable style={styles.sentContainer} onPress={handleClose} hitSlop={8} accessibilityRole="button" accessibilityLabel={t("common.done")} accessibilityLiveRegion="polite">
                <View style={styles.sentIcon}>
                  <Feather name="check-circle" size={48} color={Colors.success} />
                </View>
                <Text style={[styles.sentTitle, { fontSize: ts.heading2 }]}>{t("feedback.thanks")}</Text>
                <View style={styles.doneBtn}>
                  <Text style={[styles.doneBtnText, { fontSize: ts.body2 }]}>{t("common.done")}</Text>
                </View>
              </Pressable>
            ) : (
              <>
                <View style={styles.headerRow}>
                  <Text style={[styles.title, { fontSize: ts.heading2 }]} accessibilityRole="header">{t("feedback.title")}</Text>
                  <Pressable onPress={handleClose} style={styles.closeBtn} accessibilityLabel={t("a11y.closeFeedback")} accessibilityRole="button">
                    <Feather name="x" size={22} color={Colors.textSecondary} />
                  </Pressable>
                </View>

                <ScrollView
                  showsVerticalScrollIndicator={false}
                  bounces={false}
                  style={styles.scrollArea}
                  contentContainerStyle={styles.scrollContent}
                  keyboardShouldPersistTaps="handled"
                >
                  <View style={styles.categoryBox}>
                  {(() => {
                    const pairs: any[] = [];
                    for (let i = 0; i < CATEGORY_DEFS.length; i += 2) {
                      pairs.push(CATEGORY_DEFS.slice(i, i + 2));
                    }
                    return pairs.map((row: any[], ri: number) => (
                      <View key={ri} style={styles.categoryRow}>
                        {row.map((cat) => {
                          const selected = category === cat.value;
                          const label = cat.value;
                          return (
                            <Pressable
                              key={cat.value}
                              style={[
                                styles.categoryChip,
                                selected && styles.categoryChipSelected,
                              ]}
                              onPress={() => {
                                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                                setCategory(cat.value);
                              }}
                              accessibilityRole="button"
                              accessibilityState={{ selected }}
                              accessibilityLabel={label}
                            >
                              <Text
                                style={[
                                  styles.categoryChipText,
                                  { fontSize: ts.body2 },
                                  selected && styles.categoryChipTextSelected,
                                ]}
                                numberOfLines={1}
                              >
                                {label}
                              </Text>
                            </Pressable>
                          );
                        })}
                      </View>
                    ));
                  })()}
                  </View>

                  <TextInput
                    style={[styles.textInput, { fontSize: ts.body }]}
                    placeholder={t("feedback.detailsPlaceholder")}
                    placeholderTextColor={Colors.textMuted}
                    value={message}
                    onChangeText={setMessage}
                    multiline
                    maxLength={2000}
                    numberOfLines={4}
                    textAlignVertical="top"
                    accessibilityLabel={t("feedback.details")}
                  />

                  <View style={styles.attachmentContainer}>
                    {attachment ? (
                      <View style={styles.attachmentChip}>
                        <Feather name="image" size={14} color={Colors.primary} />
                        <Text style={[styles.attachmentName, { fontSize: ts.sm }]} numberOfLines={1}>
                          {attachment.name}
                        </Text>
                        <Pressable onPress={() => setAttachment(null)} style={styles.removeAttachmentBtn} accessibilityRole="button" hitSlop={10}>
                          <Feather name="x" size={14} color={Colors.textSecondary} />
                        </Pressable>
                      </View>
                    ) : (
                      <Pressable 
                        style={({ pressed }) => [styles.attachBtn, pressed && { opacity: 0.7 }]} 
                        onPress={async () => {
                          const result = await getDocumentAsync({ type: ["image/png", "image/jpeg"] });
                          if (!result.canceled && result.assets && result.assets.length > 0) {
                            setAttachment(result.assets[0]);
                          }
                        }}
                        accessibilityRole="button"
                      >
                        <View style={styles.attachBtnIcon}>
                          <Feather name="image" size={18} color={Colors.primary} />
                        </View>
                        <View style={styles.attachBtnCopy}>
                          <Text style={[styles.attachBtnTitle, { fontSize: ts.body2 }]}>
                            {t("feedback.attachImage", { defaultValue: "Attach (.png, .jpg)" })}
                          </Text>
                        </View>
                      </Pressable>
                    )}
                  </View>

                  {error ? <Text style={[styles.errorText, { fontSize: ts.body2 }]} accessibilityRole="alert" accessibilityLiveRegion="assertive">{error}</Text> : null}
                </ScrollView>



                <View style={styles.footerRow}>
                  <Pressable style={styles.cancelBtn} onPress={handleClose} disabled={sending} accessibilityRole="button">
                    <Text style={[styles.cancelBtnText, { fontSize: ts.body2 }]}>{t("common.cancel", { defaultValue: "Cancel" })}</Text>
                  </Pressable>
                  <Pressable
                    style={[styles.sendBtn, !canSend && styles.sendBtnDisabled]}
                    onPress={handleSend}
                    disabled={!canSend}
                    accessibilityRole="button"
                    accessibilityState={{ disabled: !canSend }}
                    accessibilityLabel={t("feedback.send")}
                  >
                    {sending ? (
                      <ActivityIndicator size="small" color={Colors.white} />
                    ) : (
                      <>
                        <Feather name="send" size={16} color={Colors.white} />
                        <Text style={[styles.sendBtnText, { fontSize: ts.body2 }]}>{t("feedback.send")}</Text>
                      </>
                    )}
                  </Pressable>
                </View>
              </>
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: Colors.overlay,
    justifyContent: "center",
    alignItems: "center",
  },
  keyboardSpacer: {
    flex: 1,
    width: "100%",
    maxWidth: 520,
    justifyContent: "flex-end",
  },
  keyboardSpacerSent: {
    justifyContent: "center",
    flex: 0,
  },
  modal: {
    backgroundColor: Colors.surface,
    borderRadius: 18,
    paddingTop: 20,
    paddingHorizontal: 22,
    flex: 1,
    flexShrink: 1,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  modalSent: {
    flex: 0,
    paddingBottom: 20,
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 20,
  },
  title: {
    fontFamily: "Inter_700Bold",
    color: Colors.text,
  },
  label: {
    fontFamily: "Inter_600SemiBold",
    color: Colors.textSecondary,
    marginBottom: 8,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  categoryList: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginBottom: 14,
  },
  closeBtn: {
    width: 44,
    height: 44,
    justifyContent: "center",
    alignItems: "center",
  },
  categoryBox: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 12,
    padding: 10,
    marginBottom: 16,
  },
  categoryRow: {
    flexDirection: "row",
    marginBottom: 8,
    gap: 8,
  },
  categoryChip: {
    flex: 1,
    paddingHorizontal: 8,
    paddingVertical: 7,
    borderRadius: 8,
    backgroundColor: Colors.surfaceLight,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  categoryChipSelected: {
    backgroundColor: "rgba(0, 180, 216, 0.15)",
    borderColor: Colors.primary,
  },
  categoryChipText: {
    fontFamily: "Inter_500Medium",
    color: Colors.textSecondary,
  },
  categoryChipTextSelected: {
    color: Colors.primary,
  },
  textInput: {
    backgroundColor: Colors.surfaceLight,
    borderRadius: 12,
    padding: 14,
    fontFamily: "Inter_400Regular",
    color: Colors.text,
    borderWidth: 1,
    borderColor: Colors.border,
    minHeight: 120,
    maxHeight: 300,
    marginBottom: 8,
    ...(Platform.OS === "web" ? { outlineStyle: "none", outlineWidth: 0, boxShadow: "none" } : {}),
  } as any,
  attachmentContainer: {
    marginBottom: 4,
  },
  attachBtn: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    paddingHorizontal: 14,
    backgroundColor: "rgba(0, 180, 216, 0.05)",
    borderWidth: 1,
    borderColor: "rgba(0, 180, 216, 0.35)",
    borderRadius: 14,
    borderStyle: "dashed",
    gap: 12,
  },
  attachBtnIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0, 180, 216, 0.12)",
  },
  attachBtnCopy: {
    flex: 1,
  },
  attachBtnTitle: {
    fontFamily: "Inter_600SemiBold",
    color: Colors.text,
  },
  attachBtnMeta: {
    marginTop: 2,
    fontFamily: "Inter_400Regular",
    color: Colors.textMuted,
  },
  attachmentChip: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    paddingHorizontal: 14,
    backgroundColor: "rgba(0, 180, 216, 0.08)",
    borderWidth: 1,
    borderColor: "rgba(0, 180, 216, 0.2)",
    borderRadius: 12,
    gap: 10,
  },
  attachmentName: {
    flex: 1,
    fontFamily: "Inter_500Medium",
    color: Colors.text,
  },
  removeAttachmentBtn: {
    padding: 4,
    backgroundColor: Colors.surface,
    borderRadius: 12,
  },
  errorText: {
    fontFamily: "Inter_500Medium",
    color: Colors.error,
    marginBottom: 12,
  },
  draftRestoredBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 8,
    backgroundColor: "rgba(0, 180, 216, 0.08)",
    borderWidth: 1,
    borderColor: "rgba(0, 180, 216, 0.2)",
    marginBottom: 14,
  },
  draftRestoredText: {
    flex: 1,
    fontFamily: "Inter_500Medium",
    color: Colors.primary,
  },
  scrollArea: {
    flex: 1,
    width: "100%",
    minHeight: 0,
  },
  scrollContent: {
    paddingBottom: 16,
  },
  footerRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    paddingTop: 14,
    paddingBottom: 22,
    gap: 12,
    borderTopWidth: 1,
    borderTopColor: "rgba(30, 51, 85, 0.35)",
  },
  cancelBtn: {
    paddingVertical: 14,
    paddingHorizontal: 20,
    justifyContent: "center",
    alignItems: "center",
    borderRadius: 12,
    backgroundColor: Colors.surfaceLight,
  },
  cancelBtnText: {
    fontFamily: "Inter_600SemiBold",
    color: Colors.textSecondary,
  },
  sendBtn: {
    backgroundColor: Colors.primary,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 20,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 8,
  },
  sendBtnDisabled: {
    opacity: 0.5,
  },
  sendBtnText: {
    fontFamily: "Inter_600SemiBold",
    color: Colors.white,
  },
  sentContainer: {
    alignItems: "center",
    paddingVertical: 20,
  },
  sentIcon: {
    marginBottom: 16,
  },
  sentTitle: {
    fontFamily: "Inter_700Bold",
    color: Colors.text,
    marginBottom: 8,
  },
  sentSubtitle: {
    fontFamily: "Inter_400Regular",
    color: Colors.textSecondary,
    marginBottom: 20,
  },
  doneBtn: {
    backgroundColor: Colors.primary,
    borderRadius: 12,
    paddingHorizontal: 32,
    paddingVertical: 12,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  doneBtnText: {
    fontFamily: "Inter_600SemiBold",
    color: Colors.white,
    includeFontPadding: false,
    textAlignVertical: "center",
  },
});
