import React, { useState, useMemo, useEffect, useCallback } from "react";
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  Pressable,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Image,
  Linking,
  AppState,
  type AppStateStatus,
} from "react-native";
import * as Haptics from "@/lib/haptics";
import * as Clipboard from "@/lib/clipboard";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "@/lib/navigation";
import Feather from "@react-native-vector-icons/feather/static";
import QRCode from "qrcode";
import Colors from "@/constants/colors";
import { useAuth } from "@/lib/auth-context";
import { useLanguage } from "@/lib/i18n";
import { useTextScale, sf, type TextScale } from "@/lib/typography";
import {
  beginFirebaseTotpEnrollment,
  completeFirebaseTotpEnrollment,
} from "@/lib/firebase-auth-client";

export default function MfaSetupScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { logout } = useAuth();
  const { t, language } = useLanguage();
  const ts = useTextScale();
  const styles = useMemo(() => makeStyles(ts), [ts]);
  const isMobile = useMemo(() => {
    if (Platform.OS !== "web") return true;
    if (typeof navigator !== "undefined" && navigator.userAgent) {
      return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    }
    return false;
  }, []);

  const [step, setStep] = useState<"loading" | "setup" | "error" | "backup">("loading");
  const [secret, setSecret] = useState("");
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [totpUri, setTotpUri] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [secretCopied, setSecretCopied] = useState(false);

  const initSetup = useCallback(async () => {
    setStep("loading");
    setError("");
    setSecret("");
    setQrDataUrl("");
    setTotpUri("");
    setCode("");
    try {
      const enrollment = await beginFirebaseTotpEnrollment();
      setSecret(enrollment.secretKey);
      setTotpUri(enrollment.qrCodeUrl);
      const dataUrl = await QRCode.toDataURL(enrollment.qrCodeUrl, {
        width: 200,
        margin: 2,
        color: { dark: "#000000", light: "#FFFFFF" },
      });
      setQrDataUrl(dataUrl);
      setStep("setup");
    } catch {
      setError(t("login.mfaSetupConnectFailed"));
      setStep("error");
    }
  }, [t]);

  useEffect(() => {
    initSetup();
  }, [initSetup]);

  const handleCopySecret = async () => {
    if (!secret) return;
    try {
      await Clipboard.setStringAsync(secret);
      setSecretCopied(true);
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setTimeout(() => setSecretCopied(false), 2000);
    } catch {}
  };

  const handleVerify = useCallback(async (codeOverride?: string) => {
    const trimmed = (codeOverride ?? code).trim();
    if (!trimmed || trimmed.length !== 6 || !/^\d{6}$/.test(trimmed)) {
      setError(t("login.mfaEnterCode"));
      return;
    }
    setIsLoading(true);
    setError("");
    try {
      await completeFirebaseTotpEnrollment(trimmed);
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setStep("backup");
    } catch {
      setError(t("login.mfaVerifyFailed"));
    } finally {
      setIsLoading(false);
    }
  }, [code, t]);

  // When the user returns from the authenticator app, auto-fill a 6-digit code from clipboard.
  useEffect(() => {
    if (Platform.OS === "web" || step !== "setup") return;

    const appStateRef = { current: AppState.currentState };
    const sub = AppState.addEventListener("change", (nextState: AppStateStatus) => {
      if (appStateRef.current.match(/inactive|background/) && nextState === "active") {
        void Clipboard.getStringAsync().then((text) => {
          const digits = text.replace(/\D/g, "").slice(0, 6);
          if (digits.length === 6 && !isLoading) {
            setCode(digits);
            handleVerify(digits);
          }
        });
      }
      appStateRef.current = nextState;
    });
    return () => sub.remove();
  }, [step, isLoading, handleVerify]);

  const handleDone = async () => {
    await logout();
    router.replace("/login");
  };

  if (step === "loading") {
    return (
      <View
        style={[
          styles.loadingContainer,
          {
            paddingTop: Platform.OS === "web" ? 67 + 40 : insets.top + 40,
            paddingBottom: Platform.OS === "web" ? 34 + 20 : insets.bottom + 20,
          },
        ]}
      >
        <ActivityIndicator size="large" color={Colors.primary} />
        <Text style={styles.loadingText}>{t("login.mfaSettingUp")}</Text>
      </View>
    );
  }

  if (step === "error") {
    return (
      <View
        style={[
          styles.loadingContainer,
          {
            paddingTop: Platform.OS === "web" ? 67 + 40 : insets.top + 40,
            paddingBottom: Platform.OS === "web" ? 34 + 20 : insets.bottom + 20,
          },
        ]}
      >
        <View style={styles.card}>
          <View style={styles.header}>
            <Feather name="alert-triangle" size={40} color={Colors.error} />
            <Text style={styles.title}>{t("login.mfaSetupTitle")}</Text>
          </View>
          <View style={styles.errorContainer} accessibilityRole="alert" accessibilityLiveRegion="assertive">
            <Feather name="alert-circle" size={16} color={Colors.error} />
            <Text style={styles.errorText}>{error}</Text>
          </View>
          <Pressable
            style={styles.submitButton}
            onPress={initSetup}
            accessibilityRole="button"
            testID="mfa-retry-button"
          >
            <Text style={styles.submitButtonText}>{t("login.mfaRetrySetup")}</Text>
          </Pressable>
          <Pressable
            onPress={logout}
            style={styles.logoutButton}
            accessibilityRole="button"
            testID="mfa-setup-logout-error"
          >
            <Text style={styles.logoutText}>{t("login.mfaSignOut")}</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  if (step === "backup") {
    return (
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <ScrollView
          contentContainerStyle={[
            styles.scrollContent,
            {
              paddingTop: Platform.OS === "web" ? 67 + 40 : insets.top + 40,
              paddingBottom: Platform.OS === "web" ? 34 + 20 : insets.bottom + 20,
            },
          ]}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.card}>
            <View style={styles.header}>
              <Feather name="check-circle" size={40} color={Colors.success} />
              <Text style={styles.title}>{t("login.mfaEnabled")}</Text>
              <Text style={styles.description}>
                {language === "es"
                  ? "La autenticación se configuró correctamente. Vuelve a iniciar sesión para comprobarla. Si pierdes el acceso, contacta al soporte de Proset para recuperar tu cuenta después de verificar tu identidad."
                  : "Authenticator security is set up. Sign in again to verify it. If you lose access, contact Proset support to recover your account after verifying your identity."}
              </Text>
            </View>

            <Pressable
              style={styles.submitButton}
              onPress={handleDone}
              accessibilityRole="button"
              testID="mfa-finish-button"
            >
              <Text style={styles.submitButtonText}>
                {language === "es" ? "Volver a iniciar sesión" : "Sign in again"}
              </Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          {
            paddingTop: Platform.OS === "web" ? 67 + 40 : insets.top + 40,
            paddingBottom: Platform.OS === "web" ? 34 + 20 : insets.bottom + 20,
          },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.card}>
          <View style={styles.header}>
            <Feather name="shield" size={40} color={Colors.primary} />
            <Text style={styles.title}>{t("login.mfaSetupTitle")}</Text>
            <Text style={styles.description}>
              {isMobile ? t("login.mfaSetupDescMobile") : t("login.mfaSetupDesc")}
            </Text>
          </View>

          {error ? (
            <View style={styles.errorContainer} accessibilityRole="alert" accessibilityLiveRegion="assertive">
              <Feather name="alert-circle" size={16} color={Colors.error} />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          {isMobile && totpUri ? (
            <Pressable
              style={styles.openInAppButton}
              onPress={async () => {
                if (!totpUri.startsWith("otpauth://")) {
                  setError(t("login.mfaOpenInAppError"));
                  return;
                }
                try {
                  await Linking.openURL(totpUri);
                } catch {
                  setError(t("login.mfaOpenInAppError"));
                }
              }}
              accessibilityRole="button"
              testID="mfa-open-in-app-button"
            >
              <Feather name="smartphone" size={18} color={Colors.white} />
              <Text style={styles.openInAppButtonText}>{t("login.mfaOpenInApp")}</Text>
            </Pressable>
          ) : null}

          {!isMobile && qrDataUrl ? (
            <View style={styles.qrContainer}>
              <View style={styles.qrWrapper}>
                <Image
                  source={{ uri: qrDataUrl }}
                  style={styles.qrImage}
                  resizeMode="contain"
                  accessibilityLabel="QR code for authenticator app"
                  testID="mfa-qr-code"
                />
              </View>
            </View>
          ) : null}

          {secret ? (
            <View style={styles.secretContainer}>
              <Text style={styles.secretLabel}>{t("login.mfaManualKey")}</Text>
              <View style={styles.secretRow}>
                <Text style={styles.secretValue} selectable testID="mfa-secret-key">
                  {secret}
                </Text>
                <Pressable
                  onPress={handleCopySecret}
                  style={styles.copyButton}
                  accessibilityRole="button"
                  accessibilityLabel="Copy secret key"
                  testID="copy-secret-button"
                >
                  <Feather
                    name={secretCopied ? "check" : "copy"}
                    size={16}
                    color={secretCopied ? Colors.success : Colors.primary}
                  />
                </Pressable>
              </View>
            </View>
          ) : null}

          <View style={styles.inputGroup}>
            <Text style={styles.label}>{t("login.mfaVerificationCode")}</Text>
            <View style={styles.inputContainer}>
              <Feather name="key" size={18} color={Colors.textMuted} style={styles.inputIcon} />
              <TextInput
                style={styles.input}
                value={code}
                onChangeText={(text) => {
                  const cleaned = text.replace(/[^0-9]/g, "").slice(0, 6);
                  setCode(cleaned);
                  if (cleaned.length === 6 && !isLoading) {
                    handleVerify(cleaned);
                  }
                }}
                placeholder={t("login.mfaCodePlaceholder")}
                placeholderTextColor={Colors.textMuted}
                keyboardType="number-pad"
                maxLength={6}
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="one-time-code"
                textContentType="oneTimeCode"
                editable={!isLoading}
                testID="mfa-code-input"
              />
            </View>
          </View>

          <Pressable
            style={[styles.submitButton, isLoading && styles.submitButtonDisabled]}
            onPress={() => handleVerify()}
            disabled={isLoading}
            accessibilityRole="button"
            testID="mfa-verify-button"
          >
            {isLoading ? (
              <ActivityIndicator color={Colors.white} />
            ) : (
              <Text style={styles.submitButtonText}>{t("login.mfaVerify")}</Text>
            )}
          </Pressable>

          <Pressable
            onPress={logout}
            style={styles.logoutButton}
            accessibilityRole="button"
            testID="mfa-setup-logout"
          >
            <Text style={styles.logoutText}>{t("login.mfaSignOut")}</Text>
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const makeStyles = (ts: TextScale) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: Colors.background,
    },
    loadingContainer: {
      flex: 1,
      backgroundColor: Colors.background,
      justifyContent: "center",
      alignItems: "center",
      paddingHorizontal: 20,
    },
    loadingText: {
      fontSize: sf(14, ts),
      fontFamily: "Inter_400Regular",
      color: Colors.textSecondary,
      marginTop: 16,
    },
    scrollContent: {
      flexGrow: 1,
      justifyContent: "center",
      alignItems: "center",
      paddingHorizontal: 20,
    },
    card: {
      backgroundColor: Colors.surface,
      borderRadius: 20,
      paddingVertical: 28,
      paddingHorizontal: 24,
      borderWidth: 1,
      borderColor: Colors.border,
      maxWidth: 440,
      width: "100%",
    },
    header: {
      alignItems: "center",
      marginBottom: 24,
      gap: 8,
    },
    title: {
      fontSize: sf(22, ts),
      fontFamily: "Inter_600SemiBold",
      color: Colors.text,
      textAlign: "center",
    },
    description: {
      fontSize: sf(14, ts),
      fontFamily: "Inter_400Regular",
      color: Colors.textSecondary,
      textAlign: "center",
      lineHeight: 20,
    },
    errorContainer: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: "rgba(248, 113, 113, 0.1)",
      borderRadius: 12,
      padding: 12,
      marginBottom: 16,
      gap: 8,
    },
    errorText: {
      fontSize: sf(14, ts),
      fontFamily: "Inter_400Regular",
      color: Colors.error,
      flex: 1,
    },
    qrContainer: {
      alignItems: "center",
      marginBottom: 20,
    },
    qrWrapper: {
      backgroundColor: "#FFFFFF",
      borderRadius: 12,
      padding: 12,
    },
    qrImage: {
      width: 200,
      height: 200,
    },
    secretContainer: {
      marginBottom: 20,
    },
    secretLabel: {
      fontSize: sf(13, ts),
      fontFamily: "Inter_500Medium",
      color: Colors.textSecondary,
      marginBottom: 8,
    },
    secretRow: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: Colors.surfaceLight,
      borderRadius: 12,
      padding: 12,
      gap: 8,
    },
    secretValue: {
      flex: 1,
      fontSize: sf(13, ts),
      fontFamily: "Inter_400Regular",
      color: Colors.text,
      letterSpacing: 1,
    },
    copyButton: {
      padding: 4,
      flexShrink: 0,
    },
    inputGroup: {
      marginBottom: 16,
    },
    label: {
      fontSize: sf(14, ts),
      fontFamily: "Inter_500Medium",
      color: Colors.textSecondary,
      marginBottom: 8,
    },
    inputContainer: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: Colors.surfaceLight,
      borderRadius: 12,
      overflow: "hidden",
    },
    inputIcon: {
      marginLeft: 14,
      flexShrink: 0,
    },
    input: {
      flex: 1,
      minWidth: 0,
      fontSize: sf(16, ts),
      fontFamily: "Inter_400Regular",
      color: Colors.text,
      paddingVertical: 14,
      paddingHorizontal: 12,
      ...(Platform.OS === "web" ? { outlineStyle: "none" as any, outlineWidth: 0 } : {}),
    },
    submitButton: {
      backgroundColor: Colors.primaryButton,
      borderRadius: 12,
      paddingVertical: 16,
      paddingHorizontal: 24,
      alignItems: "center",
      justifyContent: "center",
      marginBottom: 12,
    },
    submitButtonDisabled: {
      opacity: 0.6,
    },
    submitButtonText: {
      fontSize: sf(16, ts),
      fontFamily: "Inter_600SemiBold",
      color: Colors.white,
    },
    openInAppButton: {
      flexDirection: "row",
      backgroundColor: Colors.primaryButton,
      borderRadius: 12,
      paddingVertical: 16,
      paddingHorizontal: 24,
      alignItems: "center",
      justifyContent: "center",
      marginBottom: 16,
      gap: 8,
    },
    openInAppButtonText: {
      fontSize: sf(16, ts),
      fontFamily: "Inter_600SemiBold",
      color: Colors.white,
    },
    logoutButton: {
      marginTop: 4,
      alignItems: "center",
      minHeight: 44,
      justifyContent: "center",
    },
    logoutText: {
      fontSize: sf(14, ts),
      fontFamily: "Inter_500Medium",
      color: Colors.textMuted,
    },
  });
