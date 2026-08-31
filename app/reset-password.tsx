import React, { useState, useMemo, useEffect } from "react";
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
} from "react-native";
import * as Haptics from "@/lib/haptics";
import * as Clipboard from "@/lib/clipboard";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, router } from "@/lib/navigation";
import Feather from "@react-native-vector-icons/feather/static";
import Colors from "@/constants/colors";

import { useLanguage } from "@/lib/i18n";
import { validatePassword } from "@/lib/password-validation";
import { useResponsiveLayout } from "@/lib/useResponsiveLayout";
import { useTextScale, sf, type TextScale } from "@/lib/typography";
import { generatePasswordForRole } from "@/lib/password-generator";
import { getApiUrl } from "@/lib/query-client";
import {
  confirmFirebasePasswordReset,
  isFirebaseClientConfigured,
  verifyFirebasePasswordResetCode,
} from "@/lib/firebase-auth-client";

export default function ResetPasswordScreen() {
  const insets = useSafeAreaInsets();
  const { t } = useLanguage();
  const layout = useResponsiveLayout();
  const ts = useTextScale();
  const styles = useMemo(() => makeStyles(ts), [ts]);
  const params = useLocalSearchParams<{ token?: string; oobCode?: string; error?: string }>();

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [generatedPw, setGeneratedPw] = useState("");
  const [pwCopied, setPwCopied] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [tokenValid, setTokenValid] = useState<boolean | null>(null);
  const [noToken, setNoToken] = useState(false);
  const [actionEmail, setActionEmail] = useState("");

  const handleGeneratePassword = async () => {
    const pw = generatePasswordForRole(undefined);
    setNewPassword(pw);
    setConfirmPassword(pw);
    setGeneratedPw(pw);
    setShowPassword(true);
    setShowConfirmPassword(true);
    setPwCopied(false);
  };

  const handleCopyPassword = async () => {
    if (!generatedPw) return;
    try {
      await Clipboard.setStringAsync(generatedPw);
      setPwCopied(true);
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setTimeout(() => setPwCopied(false), 2000);
    } catch {}
  };

  useEffect(() => {
    if (params.error === "INVALID_TOKEN") {
      setTokenValid(false);
      return;
    }
    const actionCode = params.oobCode || params.token;
    if (!actionCode) {
      // No token in the URL at all — the user landed here directly. Don't
      // mislead them with "Link Expired"; show a request-a-new-link prompt.
      setNoToken(true);
      setTokenValid(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        if (isFirebaseClientConfigured() && params.oobCode) {
          const email = await verifyFirebasePasswordResetCode(params.oobCode);
          if (!cancelled) {
            setActionEmail(email.trim().toLowerCase());
            setTokenValid(true);
          }
        } else {
          const url = new URL("/api/auth/check-reset-token", getApiUrl());
          url.searchParams.set("token", actionCode);
          const res = await fetch(url.toString());
          const data = await res.json();
          if (!cancelled) setTokenValid(data.valid === true);
        }
      } catch {
        if (!cancelled) setTokenValid(false);
      }
    })();
    return () => { cancelled = true; };
  }, [params.token, params.oobCode, params.error]);

  const token = params.oobCode || params.token;

  const handleResetPassword = async () => {
    setError("");

    if (!newPassword.trim()) {
      setError(t("login.fillAllFields"));
      return;
    }

    const validation = validatePassword(newPassword);
    if (!validation.valid) {
      setError(t("login.passwordTooShort", { count: validation.minLength ?? 15 }));
      return;
    }

    if (newPassword !== confirmPassword) {
      setError(t("login.passwordsMismatch"));
      return;
    }

    if (!token) {
      setError(t("login.resetTokenExpired"));
      return;
    }

    setIsLoading(true);
    try {
      const baseUrl = getApiUrl();
      const validateRes = await fetch(new URL("/api/auth/validate-password", baseUrl).toString(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(actionEmail ? { email: actionEmail, password: newPassword } : { password: newPassword }),
      });
      const validateData = await validateRes.json().catch(() => ({}));
      if (!validateRes.ok) {
        setError(validateData.code === "PASSWORD_BLOCKLISTED"
          ? t("login.passwordBlocked" as any)
          : (validateData.error || t("common.somethingWentWrong")));
        return;
      }

      if (isFirebaseClientConfigured() && params.oobCode) {
        await confirmFirebasePasswordReset(params.oobCode, newPassword);
      } else {
        const res = await fetch(new URL("/api/auth/reset-password", baseUrl).toString(), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token, newPassword }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(data.code === "PASSWORD_BLOCKLISTED"
            ? t("login.passwordBlocked" as any)
            : (data.error || t("common.somethingWentWrong")));
          return;
        }
      }
      setSuccess(true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t("common.somethingWentWrong"));
    } finally {
      setIsLoading(false);
    }
  };

  const handleGoToLogin = () => {
    router.replace("/login");
  };

  const hasInvalidToken = tokenValid === false;
  const isValidating = tokenValid === null && !!token;

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          {
            paddingTop: Platform.OS === "web" ? 24 + 20 : insets.top + 20,
            paddingBottom: Platform.OS === "web" ? 34 + 20 : insets.bottom + 20,
            paddingHorizontal: layout.contentPadding,
          },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={[styles.innerContainer, { maxWidth: 440, width: "100%" }]}>
          <View style={styles.logoSection}>
            <View style={styles.iconContainer}>
              <Feather name="lock" size={40} color={Colors.primary} />
            </View>
            <Text style={[styles.appName, { fontSize: ts.display }]} accessibilityRole="header">
              {t("login.resetPassword")}
            </Text>
          </View>

          <View style={styles.formSection}>
            {isValidating ? (
              <View style={styles.successContainer}>
                <ActivityIndicator size="large" color={Colors.primary} />
              </View>
            ) : success ? (
              <>
                <View style={styles.successContainer}>
                  <Feather name="check-circle" size={48} color={Colors.success} />
                  <Text style={[styles.formTitle, { fontSize: ts.heading2, marginTop: 16 }]}>
                    {t("login.resetPassword")}
                  </Text>
                  <Text style={styles.successText}>
                    {t("login.passwordResetSuccess")}
                  </Text>
                </View>

                <Pressable
                  style={styles.submitButton}
                  onPress={handleGoToLogin}
                  testID="go-to-login-button"
                  accessibilityRole="button"
                >
                  <Text style={styles.submitButtonText}>{t("login.backToSignIn")}</Text>
                </Pressable>
              </>
            ) : hasInvalidToken ? (
              <>
                <View style={styles.successContainer}>
                  <Feather name={noToken ? "mail" : "alert-circle"} size={48} color={noToken ? Colors.primary : Colors.error} />
                  <Text style={[styles.formTitle, { fontSize: ts.heading2, marginTop: 16 }]}>
                    {noToken ? t("login.resetPassword") : t("login.resetTokenExpired")}
                  </Text>
                  <Text style={styles.successText}>
                    {noToken
                      ? "Sign in and tap \u201CForgot password?\u201D to receive a fresh reset link by email."
                      : t("login.resetTokenExpiredDesc")}
                  </Text>
                </View>

                <Pressable
                  style={styles.submitButton}
                  onPress={handleGoToLogin}
                  testID="go-to-login-expired"
                  accessibilityRole="button"
                >
                  <Text style={styles.submitButtonText}>{noToken ? "Go to sign in" : t("login.backToSignIn")}</Text>
                </Pressable>
              </>
            ) : (
              <>
                <Text style={[styles.formTitle, { fontSize: ts.heading2 }]}>
                  {t("login.newPasswordLabel")}
                </Text>

                {error ? (
                  <View style={styles.errorContainer} accessibilityRole="alert" accessibilityLiveRegion="assertive">
                    <Feather name="alert-circle" size={16} color={Colors.error} />
                    <Text style={styles.errorText}>{error}</Text>
                  </View>
                ) : null}

                <View style={styles.inputGroup}>
                  <Text style={styles.label}>{t("login.newPasswordLabel")}</Text>
                  <View style={styles.inputContainer}>
                    <Feather name="lock" size={18} color={Colors.textMuted} style={styles.inputIcon} />
                    <TextInput
                      style={styles.input}
                      value={newPassword}
                      onChangeText={setNewPassword}
                      placeholder={t("login.newPasswordPlaceholder")}
                      placeholderTextColor={Colors.textMuted}
                      secureTextEntry={!showPassword}
                      autoCapitalize="none"
                      autoCorrect={false}
                      autoComplete="new-password"
                      textContentType="newPassword"
                      editable={!isLoading}
                      testID="new-password-input"
                      accessibilityLabel={t("login.newPasswordLabel")}
                    />
                    <Pressable
                      onPress={() => setShowPassword(!showPassword)}
                      style={styles.eyeButton}
                      accessibilityRole="button"
                    >
                      <Feather name={showPassword ? "eye-off" : "eye"} size={18} color={Colors.textMuted} />
                    </Pressable>
                  </View>
                  <Text style={styles.passwordHint}>{t("login.passwordRequirements")}</Text>
                  <View style={styles.generateRow}>
                    <Pressable style={styles.generateBtn} onPress={handleGeneratePassword} accessibilityRole="button" accessibilityLabel={t("login.generatePassword")}>
                      <Feather name="zap" size={14} color={Colors.primary} />
                      <Text style={styles.generateBtnText}>{t("login.generatePassword")}</Text>
                    </Pressable>
                    {!!generatedPw && (
                      <Pressable style={styles.copyBtn} onPress={handleCopyPassword} accessibilityRole="button" accessibilityLabel={t("login.copyPassword")}>
                        <Feather name={pwCopied ? "check" : "copy"} size={14} color={pwCopied ? Colors.success : Colors.primary} />
                        <Text style={[styles.generateBtnText, pwCopied && { color: Colors.success }]}>{pwCopied ? t("login.passwordCopied") : t("login.copyPassword")}</Text>
                      </Pressable>
                    )}
                  </View>
                </View>

                <View style={styles.inputGroup}>
                  <Text style={styles.label}>{t("login.confirmPassword")}</Text>
                  <View style={styles.inputContainer}>
                    <Feather name="lock" size={18} color={Colors.textMuted} style={styles.inputIcon} />
                    <TextInput
                      style={styles.input}
                      value={confirmPassword}
                      onChangeText={setConfirmPassword}
                      placeholder={t("login.confirmPasswordPlaceholder")}
                      placeholderTextColor={Colors.textMuted}
                      secureTextEntry={!showConfirmPassword}
                      autoCapitalize="none"
                      autoCorrect={false}
                      autoComplete="new-password"
                      textContentType="newPassword"
                      editable={!isLoading}
                      testID="confirm-new-password-input"
                      accessibilityLabel={t("login.confirmPassword")}
                    />
                    <Pressable
                      onPress={() => setShowConfirmPassword(!showConfirmPassword)}
                      style={styles.eyeButton}
                      accessibilityRole="button"
                    >
                      <Feather name={showConfirmPassword ? "eye-off" : "eye"} size={18} color={Colors.textMuted} />
                    </Pressable>
                  </View>
                </View>

                <Pressable
                  style={[styles.submitButton, isLoading && styles.submitButtonDisabled]}
                  onPress={handleResetPassword}
                  disabled={isLoading}
                  testID="reset-password-submit"
                  accessibilityRole="button"
                  accessibilityState={{ disabled: isLoading }}
                >
                  {isLoading ? (
                    <ActivityIndicator color={Colors.white} />
                  ) : (
                    <Text style={styles.submitButtonText}>{t("login.resetPassword")}</Text>
                  )}
                </Pressable>

                <Pressable
                  onPress={handleGoToLogin}
                  style={styles.toggleButton}
                  accessibilityRole="button"
                >
                  <Text style={styles.toggleText}>
                    <Text style={styles.toggleLink}>{t("login.backToSignIn")}</Text>
                  </Text>
                </Pressable>
              </>
            )}
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const makeStyles = (ts: TextScale) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  innerContainer: {
    alignSelf: "center",
  },
  logoSection: {
    alignItems: "center",
    marginBottom: 48,
  },
  iconContainer: {
    width: 80,
    height: 80,
    borderRadius: 24,
    backgroundColor: Colors.surface,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  appName: {
    fontSize: sf(32, ts),
    fontFamily: "Inter_700Bold",
    color: Colors.text,
    marginBottom: 8,
  },
  formSection: {
    backgroundColor: Colors.surface,
    borderRadius: 20,
    paddingVertical: 24,
    paddingHorizontal: 20,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  formTitle: {
    fontSize: sf(22, ts),
    fontFamily: "Inter_600SemiBold",
    color: Colors.text,
    marginBottom: 24,
    textAlign: "center",
  },
  successContainer: {
    alignItems: "center",
    paddingVertical: 16,
  },
  successText: {
    fontSize: sf(15, ts),
    fontFamily: "Inter_400Regular",
    color: Colors.textSecondary,
    textAlign: "center",
    lineHeight: 22,
    marginTop: 8,
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
    ...(Platform.OS === "web" ? ({ outlineStyle: "none", outlineWidth: 0 } as any) : {}),
  },
  eyeButton: {
    paddingVertical: 14,
    paddingLeft: 8,
    paddingRight: 12,
    flexShrink: 0,
  },
  passwordHint: {
    fontSize: sf(12, ts),
    fontFamily: "Inter_400Regular",
    color: Colors.textMuted,
    marginTop: 6,
    paddingHorizontal: 2,
  },
  generateRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 12,
    marginTop: 8,
  },
  generateBtn: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 4,
  },
  copyBtn: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 4,
  },
  generateBtnText: {
    fontSize: sf(13, ts),
    fontFamily: "Inter_500Medium",
    color: Colors.primary,
  },
  submitButton: {
    backgroundColor: Colors.primaryButton,
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 24,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 8,
    alignSelf: "stretch",
  },
  submitButtonDisabled: {
    opacity: 0.6,
  },
  submitButtonText: {
    fontSize: sf(16, ts),
    fontFamily: "Inter_600SemiBold",
    color: Colors.white,
  },
  toggleButton: {
    marginTop: 20,
    alignItems: "center",
    minHeight: 44,
    justifyContent: "center",
  },
  toggleText: {
    fontSize: sf(14, ts),
    fontFamily: "Inter_400Regular",
    color: Colors.textSecondary,
  },
  toggleLink: {
    color: Colors.primary,
    fontFamily: "Inter_600SemiBold",
  },
});
