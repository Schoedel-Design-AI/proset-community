import React, { useState, useCallback, useMemo, useEffect, useRef } from "react";
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
  Modal,
  Linking,
  Image,
  AccessibilityInfo,
  AppState,
  type AppStateStatus,
} from "react-native";
import * as Haptics from "@/lib/haptics";
import * as Clipboard from "@/lib/clipboard";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "@/lib/navigation";
import Feather from "@react-native-vector-icons/feather/static";
import Colors from "@/constants/colors";
import { useAuth, AuthError } from "@/lib/auth-context";
import { getApiUrl } from "@/lib/query-client";
import { useLanguage } from "@/lib/i18n";
import { useResponsiveLayout } from "@/lib/useResponsiveLayout";
import { useTextScale, sf, type TextScale } from "@/lib/typography";
import { generatePasswordForRole } from "@/lib/password-generator";
import { validatePassword } from "@/lib/password-validation";
import { validateEmailAddress } from "@shared/email-validation";
import aiformsLogo from "@/assets/images/icons-xai/105-navy-bg.png";
import { resolvePostLoginRoute } from "@/lib/auth-redirect";
import { trackPlausibleEventOnce } from "@/lib/plausible";

import { useFeedback } from "@/lib/feedback-context";

const TURNSTILE_SITE_KEY = process.env.AIFORMS_PUBLIC_TURNSTILE_SITE_KEY || "";

interface TurnstileInstance {
  render: (container: HTMLElement, options: Record<string, unknown>) => string;
  remove: (widgetId: string) => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileInstance;
  }
}


export default function LoginScreen() {
  const insets = useSafeAreaInsets();
  const {
    login,
    requestMagicLink,
    completeMagicLink,
    register,
    logout,
    setSkipAuthRedirect,
    sessionExpiredMessage,
    clearSessionExpiredMessage,
    mfaChallengePending,
    completeMfaSignIn,
    cancelMfaSignIn,
  } = useAuth();
  const { t, language, toggleLanguage } = useLanguage();
  const layout = useResponsiveLayout();
  const ts = useTextScale();
  const styles = useMemo(() => makeStyles(ts), [ts]);
  const params = useLocalSearchParams<{ tab?: string; magic_token?: string; verified?: string; from?: string; returnTo?: string }>();
  const fromLanding = params.from === "landing";
  const [mode, setMode] = useState<"login" | "register">(params.tab === "signup" ? "register" : "login");
  const [firstName, setFirstName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [mfaCode, setMfaCode] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [generatedPw, setGeneratedPw] = useState("");
  const [pwCopied, setPwCopied] = useState(false);
  const [privacyExpanded, setPrivacyExpanded] = useState(false);
  const [, setWebAuthnSupported] = useState(false);
  const [magicLinkLoading, setMagicLinkLoading] = useState(false);
  const [magicLinkSent, setMagicLinkSent] = useState(false);
  const [successMessage, setSuccessMessage] = useState("");
  const [warningMessage, setWarningMessage] = useState("");
  const processedMagicTokenRef = useRef<string | null>(null);

  const [providers, setProviders] = useState<{ google: boolean; github: boolean; passkey: boolean; magicLink: boolean; registrationOpen: boolean }>({ google: false, github: false, passkey: true, magicLink: false, registrationOpen: true });
  const [showVerificationPrompt, setShowVerificationPrompt] = useState(false);
  const [verificationResending, setVerificationResending] = useState(false);
  const [verificationResent, setVerificationResent] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState("");
  const turnstileRef = useRef<HTMLDivElement | null>(null);
  const turnstileWidgetId = useRef<string | null>(null);
  const [debugMode, setDebugMode] = useState(false);
  const debugTapCount = useRef(0);
  const debugTapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [debugInfo, setDebugInfo] = useState<Record<string, unknown> | null>(null);
  const lastAuthAttempt = useRef<{ action: string; status: number; body: string; error?: string; timestamp: string } | null>(null);

  useEffect(() => {
    setSkipAuthRedirect(fromLanding);
    return () => setSkipAuthRedirect(false);
  }, [fromLanding, setSkipAuthRedirect]);

  useEffect(() => {
    if (mode !== "register") return;
    const source = fromLanding ? "landing" : "direct";
    trackPlausibleEventOnce(`signup-start:${source}`, "signup_start", {
      props: { source },
    });
  }, [fromLanding, mode]);

  useEffect(() => {
    const checkWebAuthn = async () => {
      if (Platform.OS === "web" && typeof window !== "undefined" && window.isSecureContext && !!window.PublicKeyCredential) {
        const hostname = window.location.hostname;
        const isCompatibleHost = hostname === "proset.ai" || hostname.endsWith(".proset.ai") || hostname === "proset.ai" || hostname.endsWith(".proset.ai");
        if (!isCompatibleHost) {
          setWebAuthnSupported(false);
          return;
        }
        try {
          const available = await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
          setWebAuthnSupported(available);
        } catch {
          setWebAuthnSupported(false);
        }
      }
    };
    checkWebAuthn();
    const fetchProviders = async () => {
      try {
        const baseUrl = getApiUrl();
        const res = await globalThis.fetch(new URL("/api/auth/providers", baseUrl).toString());
        if (res.ok) {
          const data = await res.json();
          setProviders(prev => ({
            google: typeof data.google === "boolean" ? data.google : prev.google,
            github: typeof data.github === "boolean" ? data.github : prev.github,
            passkey: typeof data.passkey === "boolean" ? data.passkey : prev.passkey,
            magicLink: typeof data.magicLink === "boolean" ? data.magicLink : prev.magicLink,
            registrationOpen: typeof data.registrationOpen === "boolean" ? data.registrationOpen : prev.registrationOpen,
          }));
          if (data && data.registrationOpen === false) {
            setMode("login");
          }
        }
      } catch {}
    };
    fetchProviders();
  }, []);

  const magicToken = typeof params.magic_token === "string" ? params.magic_token : "";
  useEffect(() => {
    if (!providers.magicLink || !magicToken) return;
    if (processedMagicTokenRef.current === magicToken) return;
    processedMagicTokenRef.current = magicToken;

    setError("");
    setMagicLinkSent(false);
    setMagicLinkLoading(true);

    completeMagicLink(magicToken)
      .then(async () => {
        if (Platform.OS === "web" && typeof window !== "undefined") {
          const currentUrl = new URL(window.location.href);
          currentUrl.searchParams.delete("magic_token");
          const nextPath = `${currentUrl.pathname}${currentUrl.search}${currentUrl.hash}`;
          window.history.replaceState({}, "", nextPath || "/login");
        } else {
          await router.replace("/login");
        }
      })
      .catch((err: unknown) => {
        const msg = err instanceof AuthError ? err.message : "Unable to complete sign-in link. Please request a new one.";
        setError(msg);
      })
      .finally(() => {
        setMagicLinkLoading(false);
      });
  }, [completeMagicLink, magicToken, providers.magicLink]);

  useEffect(() => {
    if (magicLinkSent) {
      AccessibilityInfo.announceForAccessibility("Sign-in link sent. Check your email.");
    }
  }, [magicLinkSent]);

  useEffect(() => {
    if (params.verified === "true") {
      trackPlausibleEventOnce("signup-verified", "signup_verified", {
        props: { method: "email" },
      });
      setSuccessMessage("Your email has been verified successfully! You can now sign in.");
      if (Platform.OS === "web" && typeof window !== "undefined") {
        const currentUrl = new URL(window.location.href);
        currentUrl.searchParams.delete("verified");
        const nextPath = `${currentUrl.pathname}${currentUrl.search}${currentUrl.hash}`;
        window.history.replaceState({}, "", nextPath || "/login");
      }
    }
  }, [params.verified]);

  useEffect(() => {
    if (Platform.OS !== "web" || !TURNSTILE_SITE_KEY || mode !== "register") return;

    const renderTurnstile = () => {
      if (!window.turnstile || !turnstileRef.current) return false;
      if (turnstileWidgetId.current) {
        window.turnstile.remove(turnstileWidgetId.current);
      }
      const size =
        turnstileRef.current.clientWidth < 300 ? "compact" : "flexible";
      turnstileWidgetId.current = window.turnstile.render(
        turnstileRef.current,
        {
          sitekey: TURNSTILE_SITE_KEY,
          callback: (token: string) => setTurnstileToken(token),
          "expired-callback": () => setTurnstileToken(""),
          "error-callback": () => setTurnstileToken(""),
          theme: "dark",
          size,
        },
      );
      return true;
    };

    const handleScriptReady = () => {
      renderTurnstile();
    };
    let script = document.querySelector<HTMLScriptElement>(
      'script[src*="challenges.cloudflare.com/turnstile/v0/api.js"]',
    );
    if (!renderTurnstile()) {
      if (!script) {
        script = document.createElement("script");
        script.src =
          "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
        script.async = true;
        document.head.appendChild(script);
      }
      script.addEventListener("load", handleScriptReady);
    }

    return () => {
      script?.removeEventListener("load", handleScriptReady);
      if (turnstileWidgetId.current && window.turnstile) {
        window.turnstile.remove(turnstileWidgetId.current);
        turnstileWidgetId.current = null;
      }
    };
  }, [mode, layout.width]);

  // When the user returns from the authenticator app to this screen, auto-fill a
  // 6-digit code from the clipboard so they don't have to paste it manually.
  useEffect(() => {
    if (Platform.OS === "web" || !mfaChallengePending) return;

    const appStateRef = { current: AppState.currentState };
    const sub = AppState.addEventListener("change", (nextState: AppStateStatus) => {
      if (appStateRef.current.match(/inactive|background/) && nextState === "active") {
        void Clipboard.getStringAsync().then((text) => {
          const digits = text.replace(/\D/g, "").slice(0, 6);
          if (digits.length === 6 && !isLoading) {
            setMfaCode(digits);
            setError("");
            setIsLoading(true);
            void completeMfaSignIn(digits)
              .then(() => {
                setMfaCode("");
                router.replace(resolvePostLoginRoute(params.returnTo));
              })
              .catch((err: unknown) => {
                setError(err instanceof Error ? err.message : "Invalid verification code.");
              })
              .finally(() => setIsLoading(false));
          }
        });
      }
      appStateRef.current = nextState;
    });
    return () => sub.remove();
  }, [mfaChallengePending, isLoading, completeMfaSignIn, params.returnTo]);


  const [resetMode, setResetMode] = useState<"off" | "email" | "sent">("off");
  const [resetEmail, setResetEmail] = useState("");
  const [resetLoading, setResetLoading] = useState(false);
  const [resetError, setResetError] = useState("");

  const handleForgotPassword = () => {
    setResetMode("email");
    setResetEmail(email.trim());
    setResetError("");
  };

  const handleSendResetLink = async () => {
    const cleanEmail = resetEmail.trim().toLowerCase();
    if (!cleanEmail) {
      setResetError(t("login.fillAllFields"));
      return;
    }
    setResetLoading(true);
    setResetError("");
    try {
      const baseUrl = getApiUrl();
      const response = await globalThis.fetch(new URL("/api/auth/forget-password", baseUrl).toString(), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: cleanEmail,
        }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || "Unable to send a reset link right now.");
      }
    } catch (err) {
      console.error("Password reset request failed:", err);
      setResetError(err instanceof Error ? err.message : "Unable to send a reset link right now.");
      setResetLoading(false);
      return;
    }
    setResetMode("sent");
    setResetLoading(false);
  };

  const handleBackToLogin = () => {
    setResetMode("off");
    setResetError("");
  };

  const clearError = useCallback(() => {
    if (error) setError("");
    if (successMessage) setSuccessMessage("");
    if (warningMessage) setWarningMessage("");
    if (showVerificationPrompt) setShowVerificationPrompt(false);
    if (verificationResent) setVerificationResent(false);
  }, [error, successMessage, warningMessage, showVerificationPrompt, verificationResent]);

  const handleResendVerification = async () => {
    setVerificationResending(true);
    setVerificationResent(false);
    try {
      const baseUrl = getApiUrl();
      const res = await globalThis.fetch(new URL("/api/auth/resend-verification", baseUrl).toString(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      });
      if (res.ok) {
        setVerificationResent(true);
      } else {
        const data = await res.json().catch(() => ({}));
        if (res.status === 429) {
          setError(data.error || "Please wait a minute before requesting another email.");
        } else if (res.status === 502) {
          setError(data.error || "We couldn't send the verification email right now. Please try again in a few minutes.");
        } else {
          setError(data.error || "Failed to send verification email.");
        }
      }
    } catch {
      setError("Unable to reach the server. Please check your connection and try again.");
    }
    setVerificationResending(false);
  };

  const handleSendMagicLink = async () => {
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail) {
      setError(t("login.fillAllFields"));
      return;
    }

    setError("");
    setMagicLinkSent(false);
    setMagicLinkLoading(true);
    try {
      await requestMagicLink(cleanEmail);
      setMagicLinkSent(true);
    } catch (err: unknown) {
      const authErr = err instanceof AuthError ? err : null;
      const msg = authErr?.message || "Unable to send sign-in link right now. Please try again.";
      setError(msg);
    } finally {
      setMagicLinkLoading(false);
    }
  };

  const handleSubmit = async () => {
    setError("");
    setSuccessMessage("");
    setWarningMessage("");
    setShowVerificationPrompt(false);
    setVerificationResent(false);
    clearSessionExpiredMessage();

    if (mfaChallengePending) {
      const cleanCode = mfaCode.trim();
      if (!/^\d{6}$/.test(cleanCode)) {
        setError(language === "es"
          ? "Abre tu app de autenticación e ingresa el código de 6 dígitos."
          : "Open your authenticator app and enter the 6-digit code.");
        return;
      }
      setIsLoading(true);
      try {
        await completeMfaSignIn(cleanCode);
        setMfaCode("");
        router.replace(resolvePostLoginRoute(params.returnTo));
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Invalid verification code.");
      } finally {
        setIsLoading(false);
      }
      return;
    }

    const cleanEmail = email.trim().toLowerCase();

    if (!cleanEmail || !password.trim()) {
      setError(t("login.fillAllFields"));
      return;
    }

    const emailValidation = validateEmailAddress(cleanEmail);
    if (!emailValidation.valid) {
      setError(emailValidation.error || "Please enter a valid email address.");
      return;
    }

    if (mode === "register" && !firstName.trim()) {
      setError(t("login.enterFirstName"));
      return;
    }

    if (mode === "register" && password !== confirmPassword) {
      setError(t("login.passwordsMismatch"));
      return;
    }

    if (mode === "register") {
      const validation = validatePassword(password);
      if (!validation.valid) {
        if (validation.errorCode === "minLength") {
          setError(t("login.passwordTooShort"));
        } else if (validation.errorCode === "missingUppercase") {
          setError("Password must contain at least one uppercase letter.");
        } else if (validation.errorCode === "missingLowercase") {
          setError("Password must contain at least one lowercase letter.");
        } else if (validation.errorCode === "missingNumber") {
          setError("Password must contain at least one number.");
        } else if (validation.errorCode === "missingSpecialCharacter") {
          setError(t("login.missingSpecialCharacter"));
        }
        return;
      }
    }

    if (mode === "register" && Platform.OS === "web" && TURNSTILE_SITE_KEY && !turnstileToken) {
      setError("Please complete the CAPTCHA verification.");
      return;
    }

    setIsLoading(true);
    try {
      if (mode === "login") {
        await login(cleanEmail, password);
        router.replace(resolvePostLoginRoute(params.returnTo));
      } else {
        const result = await register(firstName.trim(), cleanEmail, password, turnstileToken || undefined);
        // Sign out after registration so users must explicitly log in next, instead of being auto-routed into plan selection.
        await logout();
        if (result && "status" in result) {
          if (result.status === "verification_required") {
            setSuccessMessage("Your account was created successfully. To finish verification, go to your email and click the verification link.");
          } else if (result.status === "verification_email_failed") {
            setWarningMessage("Your account was created successfully. We couldn't send the verification email yet. Use Resend Verification Email in a few minutes, or contact support if it still does not arrive.");
          }
          setShowVerificationPrompt(true);
        } else {
          setSuccessMessage("Your account was created successfully. Please sign in to continue.");
          setShowVerificationPrompt(false);
        }
        setMode("login");
        setFirstName("");
        setPassword("");
        setConfirmPassword("");
        setGeneratedPw("");
        setPwCopied(false);
        setTurnstileToken("");
      }
      lastAuthAttempt.current = { action: mode, status: 200, body: "success", timestamp: new Date().toISOString() };
    } catch (err: unknown) {
      const authErr = err instanceof AuthError ? err : null;
      const errObj = err as Record<string, unknown>;
      const code = authErr?.code || "";
      const msg = (authErr?.message || (errObj?.message as string) || t("common.somethingWentWrong")) as string;

      lastAuthAttempt.current = {
        action: mode,
        status: (errObj?.status as number) || (errObj?.statusCode as number) || 0,
        body: msg.slice(0, 200),
        error: code || (errObj?.code as string) || undefined,
        timestamp: new Date().toISOString(),
      };

      if (code === "EMAIL_NOT_VERIFIED" || code === "EMAIL_SEND_FAILED") {
        setError(msg);
        setShowVerificationPrompt(true);
      } else if (code === "FORCE_PASSWORD_CHANGE") {
        setError(msg);
        router.replace("/force-change-password");
      } else if (code === "MFA_CHALLENGE_REQUIRED") {
        // MFA input field and label already communicate what to do — no amber warning needed
      } else if (code === "MFA_REQUIRED") {
        setError(msg);
        router.replace("/mfa-setup");
      } else {
        setError(msg);
      }
    } finally {
      setIsLoading(false);
    }
  };



  const handleGeneratePassword = async () => {
    const pw = generatePasswordForRole("user");
    setPassword(pw);
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

  const handleDebugTap = useCallback(() => {
    debugTapCount.current += 1;
    if (debugTapTimer.current) clearTimeout(debugTapTimer.current);
    debugTapTimer.current = setTimeout(() => { debugTapCount.current = 0; }, 2000);
    if (debugTapCount.current >= 5) {
      debugTapCount.current = 0;
      setDebugMode(prev => {
        const next = !prev;
        if (next) {
          const baseUrl = getApiUrl();
          const hasCookie = Platform.OS === "web" && typeof document !== "undefined"
            ? document.cookie.includes("better-auth") ? "yes" : "no"
            : "n/a (native)";
          const cookieCount = Platform.OS === "web" && typeof document !== "undefined"
            ? document.cookie.split(";").filter(c => c.trim()).length
            : 0;
          const info: Record<string, unknown> = {
            apiUrl: baseUrl,
            platform: Platform.OS,
            hostname: Platform.OS === "web" && typeof window !== "undefined" ? window.location.hostname : "native",
            protocol: Platform.OS === "web" && typeof window !== "undefined" ? window.location.protocol : "expo",
            secureContext: Platform.OS === "web" && typeof window !== "undefined" ? window.isSecureContext : "n/a",
            authCookie: hasCookie,
            totalCookies: cookieCount,
            timestamp: new Date().toISOString(),
          };
          if (lastAuthAttempt.current) {
            info["last.action"] = lastAuthAttempt.current.action;
            info["last.status"] = lastAuthAttempt.current.status;
            info["last.errorCode"] = lastAuthAttempt.current.error || "none";
            info["last.response"] = lastAuthAttempt.current.body;
            info["last.time"] = lastAuthAttempt.current.timestamp;
          } else {
            info["last.attempt"] = "no auth attempt yet";
          }
          setDebugInfo(info);
        }
        return next;
      });
    }
  }, []);

  const toggleMode = () => {
    if (!providers.registrationOpen) return;
    setMode(mode === "login" ? "register" : "login");
    setError("");
    setConfirmPassword("");
    setTurnstileToken("");
    setGeneratedPw("");
    setPwCopied(false);
  };

  return (
    <>
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          mode === "register" && { justifyContent: "flex-start" as const },
          {
            paddingTop: Platform.OS === "web" ? 24 + 20 : insets.top + 20,
            paddingBottom: Platform.OS === "web" ? 34 + 20 : insets.bottom + 20,
            paddingHorizontal: layout.contentPadding,
          },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={[styles.absoluteTopRight, { top: Platform.OS === "web" ? 24 : insets.top + 16, right: layout.contentPadding }]}>

        </View>
        <View style={[styles.innerContainer, { maxWidth: 440, width: "100%" }]}>
          <View style={styles.logoSection}>
            <View style={styles.iconContainer}>
              <Image source={aiformsLogo} style={{ width: 60, height: 60, borderRadius: 16 }} accessibilityLabel="Proset Logo" />
            </View>
            <Text style={[styles.appName, { fontSize: Math.round(ts.display * 4 / 3) }]} accessibilityRole="header">
              Proset
            </Text>
            <Text style={[styles.tagline, { fontSize: ts.bodyLarge }]}>
              {t("app.tagline")}
            </Text>
          </View>

          <View
            style={[
              styles.formSection,
              layout.width < 372 && styles.formSectionNarrow,
            ]}
          >
            {providers.registrationOpen ? (
              <View style={styles.tabContainer}>
                <Pressable
                  style={[styles.tabButton, mode === "login" && styles.activeTabButton]}
                  onPress={() => {
                    if (mode !== "login") toggleMode();
                  }}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: mode === "login" }}
                  accessibilityLabel={t("login.signIn")}
                  testID="signin-tab"
                >
                  <Text style={[styles.tabText, mode === "login" && styles.activeTabText]}>
                    {t("login.signIn")}
                  </Text>
                </Pressable>
                <Pressable
                  style={[styles.tabButton, mode === "register" && styles.activeTabButton]}
                  onPress={() => {
                    if (mode !== "register") toggleMode();
                  }}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: mode === "register" }}
                  accessibilityLabel={t("login.signUp")}
                  testID="signup-tab"
                >
                  <Text style={[styles.tabText, mode === "register" && styles.activeTabText]}>
                    {t("login.signUp")}
                  </Text>
                </Pressable>
              </View>
            ) : (
              <Text style={[styles.formTitle, { fontSize: ts.heading2 }]} accessibilityRole="header">
                {t("login.welcome")}
              </Text>
            )}

            {sessionExpiredMessage ? (
              <View style={[styles.errorContainer, { backgroundColor: "rgba(255,165,0,0.12)", borderColor: "rgba(255,165,0,0.3)" }]} accessibilityRole="alert" accessibilityLiveRegion="assertive">
                <Feather name="info" size={16} color="#FFA500" />
                <Text style={[styles.errorText, { color: "#FFA500" }]}>{sessionExpiredMessage}</Text>
              </View>
            ) : null}

            {error ? (
              <View style={styles.errorContainer} accessibilityRole="alert" accessibilityLiveRegion="assertive">
                <Feather name="alert-circle" size={16} color={Colors.error} />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            ) : null}

            {successMessage ? (
              <View style={styles.successContainer} accessibilityLiveRegion="polite">
                <Feather name="check-circle" size={16} color={Colors.success} />
                <Text style={styles.successText}>{successMessage}</Text>
              </View>
            ) : null}

            {warningMessage ? (
              <View style={styles.warningContainer} accessibilityLiveRegion="polite">
                <Feather name="info" size={16} color="#FFA500" />
                <Text style={styles.warningText}>{warningMessage}</Text>
              </View>
            ) : null}

            {showVerificationPrompt ? (
              <View style={styles.verificationPrompt}>
                <Pressable
                  style={[styles.resendButton, verificationResending && { opacity: 0.6 }]}
                  onPress={handleResendVerification}
                  disabled={verificationResending || verificationResent}
                  accessibilityRole="button"
                  accessibilityLabel="Resend verification email"
                  testID="resend-verification-login"
                >
                  {verificationResending ? (
                    <ActivityIndicator color={Colors.primary} size="small" />
                  ) : (
                    <>
                      <Feather name="send" size={14} color={Colors.primary} />
                      <Text style={styles.resendButtonText}>
                        {verificationResent ? "Verification email sent!" : "Resend Verification Email"}
                      </Text>
                      {verificationResent && <Feather name="check" size={14} color={Colors.success} />}
                    </>
                  )}
                </Pressable>
              </View>
            ) : null}

            {mfaChallengePending ? (
              <View style={styles.verificationPrompt}>
                <View style={styles.mfaConfirmedRow}>
                  <Feather name="check-circle" size={16} color={Colors.success} />
                  <Text style={[styles.label, { color: Colors.text, flex: 1 }]}>
                    {t("login.mfaCredentialsConfirmed", { email })}
                  </Text>
                </View>
                <Text style={[styles.label, { color: Colors.text }]}>{t("login.mfaEnterVerificationCode")}</Text>
                <View style={styles.inputContainer}>
                  <Feather name="shield" size={18} color={Colors.textMuted} style={styles.inputIcon} />
                  <TextInput
                    style={styles.input}
                    value={mfaCode}
                    onChangeText={(value) => {
                      const cleaned = value.replace(/\D/g, "").slice(0, 6);
                      setMfaCode(cleaned);
                      setError("");
                      if (cleaned.length === 6 && !isLoading) {
                        setIsLoading(true);
                        void completeMfaSignIn(cleaned)
                          .then(() => {
                            setMfaCode("");
                            router.replace(resolvePostLoginRoute(params.returnTo));
                          })
                          .catch((err: unknown) => {
                            console.error("MFA sign-in failed:", err);
                            setError(err instanceof Error ? err.message : "Invalid verification code.");
                          })
                          .finally(() => setIsLoading(false));
                      }
                    }}
                    placeholder="123456"
                    placeholderTextColor={Colors.textMuted}
                    keyboardType="number-pad"
                    autoComplete="one-time-code"
                    textContentType="oneTimeCode"
                    maxLength={6}
                    autoFocus
                    editable={!isLoading}
                    testID="mfa-code-input"
                    accessibilityLabel={t("login.mfaEnterVerificationCode")}
                  />
                </View>
                <View style={styles.mfaActionRow}>
                  {Platform.OS !== "web" ? (
                    <Pressable
                      style={styles.mfaOpenAppButton}
                      onPress={async () => {
                        try {
                          await Linking.openURL("otpauth://");
                        } catch {
                          // Silently ignore — device may not have an authenticator app
                        }
                      }}
                      accessibilityRole="button"
                      accessibilityLabel={t("login.mfaOpenAuthApp")}
                      testID="mfa-open-auth-app-button"
                    >
                      <Feather name="smartphone" size={15} color={Colors.primary} />
                      <Text style={styles.mfaOpenAppButtonText}>{t("login.mfaOpenAuthApp")}</Text>
                    </Pressable>
                  ) : null}
                  <Pressable
                    style={styles.mfaPasteButton}
                    onPress={async () => {
                      // Reading the clipboard requires a user gesture on web
                      // (navigator.clipboard.readText is gesture-gated), so
                      // this button works on BOTH web and native: tap = gesture
                      // -> read succeeds -> code is filled and submitted.
                      if (isLoading || mfaCode.length === 6) return;
                      try {
                        const text = await Clipboard.getStringAsync();
                        const digits = text.replace(/\D/g, "").slice(0, 6);
                        if (digits.length === 6) {
                          setMfaCode(digits);
                          setError("");
                          setIsLoading(true);
                          void completeMfaSignIn(digits)
                            .then(() => {
                              setMfaCode("");
                              router.replace(resolvePostLoginRoute(params.returnTo));
                            })
                            .catch((err: unknown) => {
                              console.error("MFA sign-in failed:", err);
                              setError(err instanceof Error ? err.message : "Invalid verification code.");
                            })
                            .finally(() => setIsLoading(false));
                        } else {
                          setError(language === "es"
                            ? "El portapapeles no contiene un código de 6 dígitos."
                            : "The clipboard doesn't contain a 6-digit code.");
                        }
                      } catch {
                        setError(language === "es"
                          ? "No se pudo leer el portapapeles. Intenta escribir el código manualmente."
                          : "Couldn't read the clipboard. Try typing the code manually.");
                      }
                    }}
                    accessibilityRole="button"
                    testID="mfa-paste-code-button"
                  >
                    <Feather name="clipboard" size={15} color={Colors.primary} />
                    <Text style={styles.mfaOpenAppButtonText}>{t("login.mfaPasteCode")}</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => {
                      cancelMfaSignIn();
                      setMfaCode("");
                      setError("");
                    }}
                    accessibilityRole="button"
                    testID="cancel-mfa-signin"
                  >
                    <Text style={styles.resendButtonText}>
                      {language === "es" ? "Cancelar y volver a empezar" : "Cancel and start over"}
                    </Text>
                  </Pressable>
                </View>
              </View>
            ) : null}

            {/* Temporarily disabled social and passkey authentication
            {mode === "login" && (
              <>
                {providers.google && (
                  <Pressable
                    style={[styles.socialButton, socialLoading === "google" && { opacity: 0.6 }]}
                    onPress={() => handleSocialLogin("google")}
                    disabled={!!socialLoading || isLoading}
                    accessibilityRole="button"
                    accessibilityLabel="Continue with Google"
                    testID="google-login-button"
                  >
                    {socialLoading === "google" ? (
                      <ActivityIndicator color={Colors.primary} size="small" />
                    ) : (
                      <>
                        <Text style={styles.socialIcon}>G</Text>
                        <Text style={styles.socialButtonText}>Continue with Google</Text>
                      </>
                    )}
                  </Pressable>
                )}

                {providers.github && (
                  <Pressable
                    style={[styles.socialButton, socialLoading === "github" && { opacity: 0.6 }]}
                    onPress={() => handleSocialLogin("github")}
                    disabled={!!socialLoading || isLoading}
                    accessibilityRole="button"
                    accessibilityLabel="Continue with GitHub"
                    testID="github-login-button"
                  >
                    {socialLoading === "github" ? (
                      <ActivityIndicator color={Colors.primary} size="small" />
                    ) : (
                      <>
                        <Feather name="github" size={18} color={Colors.text} />
                        <Text style={styles.socialButtonText}>Continue with GitHub</Text>
                      </>
                    )}
                  </Pressable>
                )}

                {webAuthnSupported && (
                  <Pressable
                    style={[styles.socialButton, passkeyLoading && { opacity: 0.6 }]}
                    onPress={handlePasskeyLogin}
                    disabled={passkeyLoading || !!socialLoading || isLoading}
                    accessibilityRole="button"
                    accessibilityLabel={language === "es" ? "Iniciar sesión con llave de acceso" : "Sign in with Passkey"}
                    testID="passkey-login-button"
                  >
                    {passkeyLoading ? (
                      <ActivityIndicator color={Colors.primary} size="small" />
                    ) : (
                      <>
                        <Feather name="shield" size={18} color={Colors.text} />
                        <Text style={styles.socialButtonText}>
                          {language === "es" ? "Llave de acceso" : "Sign in with Passkey"}
                        </Text>
                      </>
                    )}
                  </Pressable>
                )}

                <View style={styles.dividerRow}>
                  <View style={styles.dividerLine} />
                  <Text style={styles.dividerText}>{language === "es" ? "o con correo" : "or with email"}</Text>
                  <View style={styles.dividerLine} />
                </View>
              </>
            )}
            */}

            {mode === "register" && (
              <View style={styles.inputGroup}>
                <Text style={styles.label}>{t("login.firstName")}</Text>
                <View style={styles.inputContainer}>
                  <Feather name="user" size={18} color={Colors.textMuted} style={styles.inputIcon} />
                  <TextInput
                    style={styles.input}
                    value={firstName}
                    onChangeText={(text) => { setFirstName(text); clearError(); }}
                    placeholder={t("login.firstNamePlaceholder")}
                    placeholderTextColor={Colors.textMuted}
                    autoCapitalize="words"
                    autoCorrect={false}
                    editable={!isLoading}
                    testID="firstname-input"
                    accessibilityLabel={t("login.firstName")}
                  />
                </View>
              </View>
            )}

            {!mfaChallengePending && (
              <>
            <View style={styles.inputGroup}>
              <Text style={styles.label}>{t("login.email")}</Text>
              <View style={styles.inputContainer}>
                <Feather name="mail" size={18} color={Colors.textMuted} style={styles.inputIcon} />
                <TextInput
                  style={styles.input}
                  value={email}
                  onChangeText={(text) => { setEmail(text); clearError(); }}
                  placeholder={t("login.emailPlaceholder")}
                  placeholderTextColor={Colors.textMuted}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="email"
                  textContentType="emailAddress"
                  spellCheck={false}
                  editable={!isLoading && !mfaChallengePending}
                  testID="email-input"
                  accessibilityLabel={t("login.email")}
                />
              </View>
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>{t("login.password")}</Text>
              <View style={styles.inputContainer}>
                <Feather name="lock" size={18} color={Colors.textMuted} style={styles.inputIcon} />
                <TextInput
                  style={styles.input}
                  value={password}
                  onChangeText={(text) => { setPassword(text); clearError(); }}
                  placeholder={t("login.passwordPlaceholder")}
                  placeholderTextColor={Colors.textMuted}
                  secureTextEntry={!showPassword}
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete={mode === "login" ? "current-password" : "new-password"}
                  textContentType={mode === "login" ? "password" : "newPassword"}
                  spellCheck={false}
                  editable={!isLoading && !mfaChallengePending}
                  testID="password-input"
                  accessibilityLabel={t("login.password")}
                />
                <Pressable
                  onPress={() => setShowPassword(!showPassword)}
                  style={styles.eyeButton}
                  accessibilityRole="button"
                  accessibilityLabel={showPassword ? t("a11y.hidePassword") : t("a11y.showPassword")}
                >
                  <Feather name={showPassword ? "eye-off" : "eye"} size={18} color={Colors.textMuted} />
                </Pressable>
              </View>
              {mode === "register" && (
                <Text style={styles.passwordHint}>{t("login.passwordRequirements" as any)}</Text>
              )}
              {mode === "register" && (
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
              )}
            </View>

            {mode === "register" && (
              <View style={styles.inputGroup}>
                <Text style={styles.label}>{t("login.confirmPassword")}</Text>
                <View style={styles.inputContainer}>
                  <Feather name="lock" size={18} color={Colors.textMuted} style={styles.inputIcon} />
                  <TextInput
                    style={styles.input}
                    value={confirmPassword}
                    onChangeText={(text) => { setConfirmPassword(text); clearError(); }}
                    placeholder={t("login.confirmPasswordPlaceholder")}
                    placeholderTextColor={Colors.textMuted}
                    secureTextEntry={!showConfirmPassword}
                    autoCapitalize="none"
                    autoCorrect={false}
                    autoComplete="new-password"
                    textContentType="newPassword"
                    spellCheck={false}
                    editable={!isLoading}
                    testID="confirm-password-input"
                    accessibilityLabel={t("login.confirmPassword")}
                  />
                  <Pressable
                    onPress={() => setShowConfirmPassword(!showConfirmPassword)}
                    style={styles.eyeButton}
                    accessibilityRole="button"
                    accessibilityLabel={showConfirmPassword ? t("a11y.hidePassword") : t("a11y.showPassword")}
                  >
                    <Feather name={showConfirmPassword ? "eye-off" : "eye"} size={18} color={Colors.textMuted} />
                  </Pressable>
                </View>
              </View>
            )}

            {mode === "register" && Platform.OS === "web" && TURNSTILE_SITE_KEY ? (
              <View style={styles.turnstileContainer} testID="turnstile-widget">
                <div
                  ref={turnstileRef}
                  style={{
                    display: "flex",
                    justifyContent: "center",
                    width: "100%",
                  }}
                />
              </View>
            ) : null}

            <Pressable
              style={[styles.submitButton, isLoading && styles.submitButtonDisabled]}
              onPress={handleSubmit}
              disabled={isLoading}
              testID="submit-button"
              accessibilityRole="button"
              accessibilityLabel={mode === "login" ? t("login.signIn") : t("login.signUp")}
              accessibilityState={{ disabled: isLoading }}
            >
              {isLoading ? (
                <ActivityIndicator color={Colors.white} />
              ) : (
                <Text style={styles.submitButtonText}>
                  {mode === "login" ? t("login.signIn") : t("login.signUp")}
                </Text>
              )}
            </Pressable>

            {mode === "login" && (
              <>
              {providers.magicLink ? (
                <Pressable
                  style={[styles.resendButton, (magicLinkLoading || isLoading) && { opacity: 0.6 }]}
                  onPress={handleSendMagicLink}
                  disabled={magicLinkLoading || isLoading}
                  testID="send-magic-link-button"
                  accessibilityRole="button"
                  accessibilityLabel={magicLinkSent ? "Sign-in link sent. Check your email." : "Email me a sign-in link"}
                >
                  {magicLinkLoading ? (
                    <ActivityIndicator color={Colors.primary} size="small" />
                  ) : (
                    <>
                      <Feather name="mail" size={14} color={Colors.primary} />
                      <Text style={styles.resendButtonText}>
                        {magicLinkSent ? "Sign-in link sent" : "Email me a sign-in link"}
                      </Text>
                      {magicLinkSent ? <Feather name="check" size={14} color={Colors.success} /> : null}
                    </>
                  )}
                </Pressable>
              ) : null}
              <Pressable
                onPress={handleForgotPassword}
                style={styles.forgotPasswordButton}
                testID="forgot-password-button"
                accessibilityRole="button"
                accessibilityLabel={t("login.forgotPassword")}
              >
                <Text style={styles.forgotPasswordText}>{t("login.forgotPassword")}</Text>
              </Pressable>
              </>
            )}
            </>
            )}

            <Pressable
              onPress={toggleLanguage}
              style={styles.langSwitchButton}
              accessibilityRole="button"
              accessibilityLabel={language === "en" ? t("a11y.switchToSpanish") : t("a11y.switchToEnglish")}
            >
              <Feather name="globe" size={15} color={Colors.primary} />
              <Text style={styles.langSwitchText}>
                {language === "en" ? t("login.switchToSpanishText") : t("login.switchToEnglishText")}
              </Text>
            </Pressable>

            <View style={{ position: "relative" }}>
              <Pressable
                onPress={() => setPrivacyExpanded(!privacyExpanded)}
                style={styles.privacySummary}
                accessibilityRole="button"
                accessibilityLabel={t("privacy.title")}
                accessibilityState={{ expanded: privacyExpanded }}
                testID="login-privacy-toggle"
              >
                <Feather name="shield" size={16} color={Colors.primary} />
                <Text style={styles.privacySummaryTitle}>{t("privacy.title")}</Text>
                <Feather name={privacyExpanded ? "chevron-up" : "chevron-down"} size={16} color={Colors.textMuted} />
              </Pressable>
              {privacyExpanded && (
                <View style={styles.privacyTooltip}>
                  <View style={styles.privacyItem}>
                    <Feather name="cpu" size={13} color={Colors.textSecondary} />
                    <Text style={styles.privacyItemText}>{t("privacy.voiceBody")}</Text>
                  </View>
                  <View style={styles.privacyItem}>
                    <Feather name="user" size={13} color={Colors.textSecondary} />
                    <Text style={styles.privacyItemText}>{t("privacy.anonymousId")}</Text>
                  </View>
                  <View style={styles.privacyItem}>
                    <Feather name="database" size={13} color={Colors.textSecondary} />
                    <Text style={styles.privacyItemText}>{t("privacy.ownershipBody")}</Text>
                  </View>
                  <View style={styles.privacyItem}>
                    <Feather name="smartphone" size={13} color={Colors.textSecondary} />
                    <Text style={styles.privacyItemText}>{t("privacy.localBody")}</Text>
                  </View>
                  <Pressable
                    onPress={() => Linking.openURL("https://proset.ai/privacy")}
                    style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: "rgba(0, 180, 216, 0.15)" }}
                    accessibilityRole="link"
                    accessibilityLabel={t("privacy.title")}
                  >
                    <Feather name="external-link" size={13} color={Colors.primary} />
                    <Text style={[styles.privacyItemText, { color: Colors.primary, fontFamily: "Inter_600SemiBold" }]}>
                      {language === "es" ? "Ver pol\u00edtica de privacidad completa" : "View full privacy policy"}
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => Linking.openURL("https://proset.ai/terms")}
                    style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingTop: 8 }}
                    accessibilityRole="link"
                    accessibilityLabel={t("terms.title")}
                  >
                    <Feather name="external-link" size={13} color={Colors.primary} />
                    <Text style={[styles.privacyItemText, { color: Colors.primary, fontFamily: "Inter_600SemiBold" }]}>
                      {language === "es" ? "Términos del servicio" : "Terms of Service"}
                    </Text>
                  </Pressable>
                </View>
              )}
            </View>

            {privacyExpanded ? null : (
              <Pressable
                onPress={() => Linking.openURL("https://proset.ai/documentation")}
                style={styles.langSwitchButton}
                accessibilityRole="link"
                accessibilityLabel={t("a11y.documentation")}
                testID="login-docs-link"
              >
                <Feather name="book-open" size={15} color={Colors.primary} />
                <Text style={styles.langSwitchText}>
                  {t("a11y.documentation")}
                </Text>
              </Pressable>
            )}

            {debugMode && debugInfo && (
              <View style={debugStyles.debugPanel}>
                <View style={debugStyles.debugHeader}>
                  <Feather name="terminal" size={14} color="#00ff88" />
                  <Text style={debugStyles.debugTitle}>Auth Debug</Text>
                  <Pressable onPress={() => setDebugMode(false)} accessibilityRole="button" accessibilityLabel="Close debug panel">
                    <Feather name="x" size={16} color={Colors.textMuted} />
                  </Pressable>
                </View>
                {Object.entries(debugInfo).map(([key, value]) => (
                  <View key={key} style={debugStyles.debugRow}>
                    <Text style={debugStyles.debugKey}>{key}</Text>
                    <Text style={debugStyles.debugValue} numberOfLines={1}>{String(value)}</Text>
                  </View>
                ))}
              </View>
            )}

            <Pressable onPress={handleDebugTap} style={{ alignSelf: "center", paddingVertical: 4, opacity: 0 }} accessibilityLabel="App version">
              <Text style={styles.versionText}>{" "}</Text>
            </Pressable>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>

      <Modal
        visible={resetMode !== "off"}
        transparent
        animationType="fade"
        onRequestClose={handleBackToLogin}
      >
        <KeyboardAvoidingView
          style={styles.resetOverlay}
          behavior={Platform.OS === "ios" ? "padding" : "height"}
        >
          <Pressable style={styles.resetOverlay} onPress={handleBackToLogin}>
            <Pressable
              style={[styles.resetSheet, !layout.isMobile && styles.resetSheetCentered]}
              onPress={(e) => e.stopPropagation?.()}
            >
              {resetMode === "email" && (
                <>
                  <View style={styles.resetHeader}>
                    <Feather name="lock" size={32} color={Colors.primary} />
                    <Text style={[styles.resetTitle, { fontSize: ts.heading2 }]}>{t("login.forgotPasswordTitle")}</Text>
                  </View>

                  {resetError ? (
                    <View style={styles.errorContainer} accessibilityRole="alert">
                      <Feather name="alert-circle" size={16} color={Colors.error} />
                      <Text style={styles.errorText}>{resetError}</Text>
                    </View>
                  ) : null}

                  <View style={styles.inputGroup}>
                    <Text style={styles.label}>{t("login.email")}</Text>
                    <View style={styles.inputContainer}>
                      <Feather name="mail" size={18} color={Colors.textMuted} style={styles.inputIcon} />
                      <TextInput
                        style={styles.input}
                        value={resetEmail}
                        onChangeText={setResetEmail}
                        placeholder={t("login.emailPlaceholder")}
                        placeholderTextColor={Colors.textMuted}
                        keyboardType="email-address"
                        autoCapitalize="none"
                        autoCorrect={false}
                        autoComplete="email"
                        textContentType="emailAddress"
                        editable={!resetLoading}
                        testID="reset-email-input"
                        accessibilityLabel={t("login.email")}
                      />
                    </View>
                  </View>

                  <Pressable
                    style={[styles.submitButton, resetLoading && styles.submitButtonDisabled]}
                    onPress={handleSendResetLink}
                    disabled={resetLoading}
                    testID="send-reset-link-button"
                    accessibilityRole="button"
                  >
                    {resetLoading ? (
                      <ActivityIndicator color={Colors.white} />
                    ) : (
                      <Text style={styles.submitButtonText}>{t("login.sendResetCode")}</Text>
                    )}
                  </Pressable>

                  <Pressable onPress={handleBackToLogin} style={styles.toggleButton} accessibilityRole="button">
                    <Text style={styles.forgotPasswordText}>{t("login.backToSignIn")}</Text>
                  </Pressable>
                </>
              )}

              {resetMode === "sent" && (
                <>
                  <View style={styles.resetHeader}>
                    <Feather name="check-circle" size={40} color={Colors.success} />
                    <Text style={[styles.resetTitle, { fontSize: ts.heading2 }]}>{t("login.resetLinkSent")}</Text>
                  </View>

                  <Pressable
                    style={styles.submitButton}
                    onPress={handleBackToLogin}
                    testID="back-to-login-button"
                    accessibilityRole="button"
                  >
                    <Text style={styles.submitButtonText}>{t("login.backToSignIn")}</Text>
                  </Pressable>
                </>
              )}
            </Pressable>
          </Pressable>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
}

const makeStyles = (ts: TextScale) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  absoluteTopRight: {
    position: "absolute",
    zIndex: 10,
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
  tagline: {
    fontSize: sf(15, ts),
    fontFamily: "Inter_400Regular",
    color: Colors.textSecondary,
    textAlign: "center",
    maxWidth: 280,
    lineHeight: 22,
  },
  marketingHero: {
    alignItems: "center",
    marginBottom: 24,
    gap: 10,
  },
  marketingBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(0,180,216,0.1)",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    gap: 6,
    marginBottom: 4,
  },
  marketingBadgeText: {
    color: Colors.primary,
    fontFamily: "Inter_600SemiBold",
    fontSize: sf(13, ts),
  },
  marketingTitle: {
    color: Colors.text,
    fontFamily: "Inter_700Bold",
    fontSize: sf(22, ts),
    textAlign: "center",
    lineHeight: sf(28, ts),
  },
  marketingSubtitle: {
    color: Colors.textSecondary,
    fontFamily: "Inter_400Regular",
    fontSize: sf(14, ts),
    textAlign: "center",
    lineHeight: sf(20, ts),
    paddingHorizontal: 12,
  },
  formSection: {
    backgroundColor: Colors.surface,
    borderRadius: 20,
    paddingVertical: 24,
    paddingHorizontal: 20,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  formSectionNarrow: {
    paddingHorizontal: 12,
  },
  formTitle: {
    fontSize: sf(22, ts),
    fontFamily: "Inter_600SemiBold",
    color: Colors.text,
    marginBottom: 24,
    textAlign: "center",
  },
  verificationPrompt: {
    marginBottom: 16,
  },
  mfaActionRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 8,
    flexWrap: "wrap",
    gap: 8,
  },
  mfaConfirmedRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 8,
  },
  mfaPasteButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surfaceLight,
  },
  mfaOpenAppButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surfaceLight,
  },
  mfaOpenAppButtonText: {
    fontSize: sf(13, ts),
    fontFamily: "Inter_500Medium",
    color: Colors.primary,
  },
  resendButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surfaceLight,
    minHeight: 44,
  },
  resendButtonText: {
    fontSize: sf(14, ts),
    fontFamily: "Inter_500Medium",
    color: Colors.primary,
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
  successContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(74, 222, 128, 0.12)",
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
    gap: 8,
  },
  successText: {
    fontSize: sf(14, ts),
    fontFamily: "Inter_400Regular",
    color: Colors.success,
    flex: 1,
  },
  warningContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255,165,0,0.12)",
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
    gap: 8,
  },
  warningText: {
    fontSize: sf(14, ts),
    fontFamily: "Inter_400Regular",
    color: "#FFA500",
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
    backgroundColor: "transparent",
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
  socialButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    borderRadius: 12,
    paddingVertical: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surfaceLight,
  },
  socialIcon: {
    fontSize: sf(18, ts),
    fontFamily: "Inter_700Bold",
    color: Colors.text,
  },
  socialButtonText: {
    fontSize: sf(15, ts),
    fontFamily: "Inter_600SemiBold",
    color: Colors.text,
  },
  dividerRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 10,
    marginBottom: 16,
    gap: 12,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: Colors.border,
  },
  dividerText: {
    fontSize: sf(13, ts),
    fontFamily: "Inter_400Regular",
    color: Colors.textMuted,
  },
  tabContainer: {
    flexDirection: "row",
    backgroundColor: Colors.surfaceLight,
    borderRadius: 12,
    padding: 4,
    marginBottom: 24,
  },
  tabButton: {
    flex: 1,
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 8,
  },
  activeTabButton: {
    backgroundColor: Colors.surface,
    ...Platform.select({
      ios: {
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.1,
        shadowRadius: 2,
      },
      android: {
        elevation: 2,
      },
      web: {
        boxShadow: "0px 1px 2px rgba(0, 0, 0, 0.1)",
      },
    }),
  },
  tabText: {
    fontSize: sf(15, ts),
    fontFamily: "Inter_500Medium",
    color: Colors.textMuted,
  },
  activeTabText: {
    color: Colors.text,
    fontFamily: "Inter_600SemiBold",
  },
  privacySummary: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 20,
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: "rgba(0, 180, 216, 0.08)",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(0, 180, 216, 0.15)",
  },
  privacySummaryTitle: {
    flex: 1,
    fontSize: sf(14, ts),
    fontFamily: "Inter_600SemiBold",
    color: Colors.text,
  },
  privacyTooltip: {
    position: "absolute",
    top: "100%",
    left: 0,
    right: 0,
    zIndex: 100,
    backgroundColor: Colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    marginTop: 4,
    padding: 14,
    gap: 12,
    maxWidth: 360,
    ...Platform.select({
      ios: {
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.15,
        shadowRadius: 12,
      },
      android: {
        elevation: 8,
      },
      web: {
        boxShadow: "0 4px 24px rgba(0, 0, 0, 0.25)",
      },
    }),
  },
  privacyItem: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  privacyItemText: {
    flex: 1,
    fontSize: sf(13, ts),
    fontFamily: "Inter_400Regular",
    color: Colors.textSecondary,
    lineHeight: 19,
  },
  langSwitchButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginTop: 16,
    paddingVertical: 10,
    minHeight: 44,
  },
  langSwitchText: {
    color: Colors.primary,
    fontFamily: "Inter_500Medium",
    fontSize: sf(14, ts),
  },
  versionText: {
    fontSize: sf(12, ts),
    fontFamily: "Inter_400Regular",
    color: Colors.textMuted,
    textAlign: "center",
    paddingVertical: 16,
  },
  turnstileContainer: {
    width: "100%",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 0,
    marginBottom: 8,
  },
  forgotPasswordButton: {
    marginTop: 12,
    alignItems: "center",
    minHeight: 44,
    justifyContent: "center",
  },
  toggleButton: {
    marginTop: 12,
    alignItems: "center",
    minHeight: 44,
    justifyContent: "center",
  },
  forgotPasswordText: {
    fontSize: sf(14, ts),
    fontFamily: "Inter_500Medium",
    color: Colors.primary,
  },
  resetOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.6)",
    justifyContent: "center",
    alignItems: "center",
  },
  resetSheet: {
    backgroundColor: Colors.surface,
    borderRadius: 20,
    paddingHorizontal: 24,
    paddingVertical: 28,
    width: "90%",
    maxWidth: 400,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  resetSheetCentered: {
    width: 400,
  },
  resetHeader: {
    alignItems: "center",
    marginBottom: 24,
    gap: 8,
  },
  resetTitle: {
    fontFamily: "Inter_600SemiBold",
    color: Colors.text,
    textAlign: "center",
  },
  resetDesc: {
    fontSize: sf(14, ts),
    fontFamily: "Inter_400Regular",
    color: Colors.textSecondary,
    textAlign: "center",
    lineHeight: 20,
  },
});

const debugStyles = StyleSheet.create({
  debugPanel: {
    backgroundColor: "rgba(0, 20, 10, 0.9)",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "rgba(0, 255, 136, 0.3)",
    padding: 12,
    marginTop: 12,
    marginBottom: 4,
  },
  debugHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 8,
    justifyContent: "space-between",
  },
  debugTitle: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 12,
    color: "#00ff88",
    flex: 1,
  },
  debugRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 3,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(255,255,255,0.08)",
  },
  debugKey: {
    fontFamily: "Inter_500Medium",
    fontSize: 11,
    color: "rgba(255,255,255,0.5)",
    flex: 1,
  },
  debugValue: {
    fontFamily: "Inter_400Regular",
    fontSize: 11,
    color: "rgba(255,255,255,0.85)",
    flex: 2,
    textAlign: "right",
  },
});
