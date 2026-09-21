import React, { useState, useMemo, useCallback, useEffect, useRef } from "react";
import {
  StyleSheet,
  Text,
  View,
  Pressable,
  ActivityIndicator,
  Platform,
  TextInput,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Feather from "@react-native-vector-icons/feather/static";
import { useLocalSearchParams, useRouter } from "@/lib/navigation";
import Colors from "@/constants/colors";
import { useAuth } from "@/lib/auth-context";
import { useLanguage } from "@/lib/i18n";
import { useTextScale, sf, type TextScale } from "@/lib/typography";
import { getApiUrl } from "@/lib/query-client";
import {
  applyFirebaseEmailActionCode,
  isFirebaseClientConfigured,
  reloadFirebaseSession,
} from "@/lib/firebase-auth-client";
import { resolveVerificationOutcome } from "@/lib/verification-outcome";
import { validateEmailAddress } from "@shared/email-validation";

// How long "Verification Successful" stays on screen before the app hands off.
// Long enough to read the confirmation, short enough not to feel like a wait.
const SUCCESS_HANDOFF_MS = 1400;

// How often a signed-in but still-unverified identity re-checks its status. The
// link in the inbox is often opened somewhere else (phone, another browser), so
// the screen should get out of the way by itself.
const STATUS_POLL_MS = 5000;

type VerifyState =
  // An oobCode is being applied.
  | "working"
  // Applied and confirmed — the app is handing off.
  | "success"
  // Nothing was applied, or the link was dead: offer the resend path.
  | "action-needed";

export default function VerifyEmailScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ oobCode?: string }>();
  const { user, refreshUser, logout, completeVerificationSignIn } = useAuth();
  const { t } = useLanguage();
  const ts = useTextScale();
  const styles = useMemo(() => makeStyles(ts), [ts]);

  const [state, setState] = useState<VerifyState>(params.oobCode ? "working" : "action-needed");
  const [error, setError] = useState("");
  const [email, setEmail] = useState(user?.email ?? "");
  const [resendLoading, setResendLoading] = useState(false);
  const [resendSent, setResendSent] = useState(false);
  const [successBody, setSuccessBody] = useState("verifyEmail.successBody");
  const appliedActionRef = useRef<string | null>(null);
  const handoffRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const mountedRef = useRef(true);
  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    [],
  );

  useEffect(() => {
    const code = params.oobCode;
    if (!code || !isFirebaseClientConfigured()) return;
    // Start ONCE per code. This effect re-runs whenever the auth context hands
    // down a fresh callback identity (it re-renders on the Firebase token
    // callback), and a re-run must neither restart nor cancel the exchange that
    // is already in flight — a per-run `cancelled` flag would abandon it and
    // leave the screen stuck on "Verifying your email…".
    if (appliedActionRef.current === code) return;
    appliedActionRef.current = code;
    setState("working");
    setError("");

    const handOff = (destination: string, bodyKey: string) => {
      setSuccessBody(bodyKey);
      setState("success");
      handoffRef.current = setTimeout(() => {
        if (mountedRef.current) router.replace(destination);
      }, SUCCESS_HANDOFF_MS);
    };

    (async () => {
      // 1. Happy path — a valid, unexpired link signs the person in outright.
      //    Registration signs new accounts out, and this link is often opened in
      //    a window with its own storage (an installed app window, another
      //    browser or device), so without an exchange the next thing they see is
      //    a bare sign-in form: that is the step people were lost on.
      const signedInUser = await completeVerificationSignIn(code);
      if (signedInUser) {
        // Consume the code so the link cannot be replayed — the server only
        // READS it. Best effort: the session is already established.
        await applyFirebaseEmailActionCode(code).catch(() => {});
        handOff("/", "verifyEmail.successBodySignedIn");
        return;
      }

      // 2. No session to mint (expired/used link, unknown account, older
      //    client): verify the address locally and decide from the Firebase
      //    session, never from a /api/auth/me probe — its 401 with no session is
      //    not an expiry.
      try {
        await applyFirebaseEmailActionCode(code);
      } catch {
        // A dead link (already used, expired, malformed) lands here: the person
        // stays on this page and the resend control is the way forward.
        setError(t("verifyEmail.invalidLink"));
        setState("action-needed");
        return;
      }
      const session = await reloadFirebaseSession();
      const outcome = resolveVerificationOutcome({
        actionApplied: true,
        hasSession: Boolean(session),
        emailVerified: Boolean(session?.identity.emailVerified),
      });
      if (outcome === "stay") {
        // Code applied, but this session still reads unverified: stay on the
        // actionable screen rather than claiming a success we cannot confirm.
        setState("action-needed");
        return;
      }
      if (outcome === "home") void refreshUser();
      handOff(
        outcome === "sign-in" ? "/login?verified=true" : "/",
        outcome === "sign-in" ? "verifyEmail.successBody" : "verifyEmail.successBodyApp",
      );
    })();
  }, [params.oobCode, refreshUser, router, t, completeVerificationSignIn]);

  // The sign-in bootstrap may deliver the session's email after mount.
  useEffect(() => {
    if (user?.email && !email) setEmail(user.email);
  }, [user?.email, email]);

  // A signed-in identity can finish verification elsewhere (the inbox link in
  // another tab/browser/device). Poll quietly, then hand off.
  useEffect(() => {
    if (state !== "action-needed" || !user || user.emailVerified) return;
    let cancelled = false;
    const timer = setInterval(async () => {
      const refreshed = await refreshUser();
      if (!cancelled && refreshed?.emailVerified) router.replace("/");
    }, STATUS_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [state, user, refreshUser, router]);

  const handleResend = useCallback(async () => {
    const cleanEmail = email.trim().toLowerCase();
    const validation = validateEmailAddress(cleanEmail);
    if (!validation.valid) {
      setResendSent(false);
      setError(validation.error || t("verifyEmail.emailRequired"));
      return;
    }

    setResendLoading(true);
    setError("");
    setResendSent(false);
    try {
      // Public, rate-limited endpoint: it works with or without a session, so
      // one code path covers the mailbox link and the signed-in resend.
      const url = new URL("/api/auth/resend-verification", getApiUrl()).toString();
      const res = await globalThis.fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email: cleanEmail }),
      });
      if (res.ok) {
        setResendSent(true);
      } else {
        const data = await res.json().catch(() => ({}));
        if (res.status === 429) {
          setError(data.error || t("verifyEmail.resendRateLimited"));
        } else if (res.status >= 500) {
          setError(data.error || t("verifyEmail.sendFailed"));
        } else {
          setError(data.error || t("verifyEmail.resendFailed"));
        }
      }
    } catch {
      setError(t("verifyEmail.resendFailed"));
    } finally {
      setResendLoading(false);
    }
  }, [email, t]);

  const success = state === "success";
  const working = state === "working";

  return (
    <View
      style={[
        styles.container,
        {
          paddingTop: Platform.OS === "web" ? 67 + 40 : insets.top + 40,
          paddingBottom: Platform.OS === "web" ? 34 + 20 : insets.bottom + 20,
        },
      ]}
    >
      <View style={styles.card} testID={success ? "verify-email-success" : "verify-email-card"}>
        <View style={styles.header}>
          <Feather
            name={success ? "check-circle" : "mail"}
            size={40}
            color={success ? Colors.success : Colors.primary}
          />
          <Text style={styles.title} accessibilityRole="header">
            {success ? t("verifyEmail.successTitle") : t("verifyEmail.title")}
          </Text>
          <Text style={styles.description}>
            {success
              ? t(successBody as "verifyEmail.successBody")
              : working
                ? t("verifyEmail.working")
                : user?.email
                  ? t("verifyEmail.sentTo", { email: user.email })
                  : t("verifyEmail.sentGeneric")}
          </Text>
          {working ? <ActivityIndicator color={Colors.primary} style={styles.workingIndicator} /> : null}
        </View>

        {!success && error ? (
          <View style={styles.errorContainer} accessibilityRole="alert" accessibilityLiveRegion="assertive">
            <Feather name="alert-circle" size={16} color={Colors.error} />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        {!success && resendSent ? (
          <View style={styles.successContainer} accessibilityRole="alert" accessibilityLiveRegion="polite">
            <Feather name="check-circle" size={16} color={Colors.success} />
            <Text style={styles.successText}>{t("verifyEmail.resent")}</Text>
          </View>
        ) : null}

        {!success ? (
          <>
            <View style={styles.tipContainer}>
              <Feather name="info" size={16} color={Colors.textSecondary} />
              <Text style={styles.tipText}>{t("verifyEmail.spamTip")}</Text>
            </View>

            {!user ? (
              <View style={styles.inputContainer}>
                <Feather name="mail" size={18} color={Colors.textMuted} style={styles.inputIcon} />
                <TextInput
                  style={styles.input}
                  value={email}
                  onChangeText={(value) => {
                    setEmail(value);
                    if (error) setError("");
                    if (resendSent) setResendSent(false);
                  }}
                  placeholder={t("verifyEmail.emailLabel")}
                  placeholderTextColor={Colors.textMuted}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoComplete="email"
                  autoCorrect={false}
                  testID="verify-email-email-input"
                  accessibilityLabel={t("verifyEmail.emailLabel")}
                />
              </View>
            ) : null}

            <Pressable
              style={[styles.primaryButton, (resendLoading || working) && styles.buttonDisabled]}
              onPress={handleResend}
              disabled={resendLoading || working}
              testID="resend-verification-button"
              accessibilityRole="button"
            >
              {resendLoading ? (
                <ActivityIndicator color={Colors.white} />
              ) : (
                <Text style={styles.primaryButtonText}>{t("verifyEmail.resend")}</Text>
              )}
            </Pressable>
          </>
        ) : null}

        {/* Only a signed-in identity has anything to sign out of — the mailbox
            link is opened without a session, and a "Sign Out" there is nonsense. */}
        {!success && user ? (
          <Pressable
            onPress={() => void logout()}
            style={styles.logoutButton}
            accessibilityRole="button"
            testID="verify-email-logout"
          >
            <Text style={styles.logoutText}>{t("verifyEmail.signOut")}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const makeStyles = (ts: TextScale) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: Colors.background,
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
    workingIndicator: {
      marginTop: 4,
    },
    inputContainer: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: Colors.surfaceLight,
      borderRadius: 12,
      overflow: "hidden",
      marginBottom: 12,
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
      backgroundColor: "rgba(34, 197, 94, 0.1)",
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
    tipContainer: {
      flexDirection: "row",
      alignItems: "flex-start",
      backgroundColor: Colors.surfaceLight,
      borderRadius: 12,
      padding: 12,
      marginBottom: 20,
      gap: 8,
    },
    tipText: {
      fontSize: sf(13, ts),
      fontFamily: "Inter_400Regular",
      color: Colors.textSecondary,
      flex: 1,
      lineHeight: 18,
    },
    primaryButton: {
      backgroundColor: Colors.primaryButton,
      borderRadius: 12,
      paddingVertical: 16,
      paddingHorizontal: 24,
      alignItems: "center",
      justifyContent: "center",
    },
    primaryButtonText: {
      fontSize: sf(16, ts),
      fontFamily: "Inter_600SemiBold",
      color: Colors.white,
    },
    buttonDisabled: {
      opacity: 0.6,
    },
    logoutButton: {
      marginTop: 16,
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
