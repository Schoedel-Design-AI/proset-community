import React, { useState, useMemo, useCallback, useEffect, useRef } from "react";
import {
  StyleSheet,
  Text,
  View,
  Pressable,
  ActivityIndicator,
  Platform,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Feather from "@react-native-vector-icons/feather/static";
import { useLocalSearchParams, useRouter } from "@/lib/navigation";
import Colors from "@/constants/colors";
import { useAuth } from "@/lib/auth-context";
import { useTextScale, sf, type TextScale } from "@/lib/typography";
import { getApiUrl, getAuthHeaders } from "@/lib/query-client";
import {
  applyFirebaseEmailActionCode,
  isFirebaseClientConfigured,
  reloadFirebaseSession,
} from "@/lib/firebase-auth-client";

export default function VerifyEmailScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ oobCode?: string }>();
  const { user, refreshUser, logout } = useAuth();
  const ts = useTextScale();
  const styles = useMemo(() => makeStyles(ts), [ts]);

  const [resendLoading, setResendLoading] = useState(false);
  const [resendSuccess, setResendSuccess] = useState(false);
  const [checkLoading, setCheckLoading] = useState(false);
  const [error, setError] = useState("");
  const [actionApplied, setActionApplied] = useState(false);
  const appliedActionRef = useRef<string | null>(null);

  useEffect(() => {
    if (!params.oobCode || !isFirebaseClientConfigured()) return;
    if (appliedActionRef.current === params.oobCode) return;
    appliedActionRef.current = params.oobCode;
    let cancelled = false;
    setCheckLoading(true);
    setError("");
    applyFirebaseEmailActionCode(params.oobCode)
      .then(async () => {
        if (cancelled) return;
        setActionApplied(true);
        await reloadFirebaseSession();
        await refreshUser();
      })
      .catch(() => {
        if (!cancelled) setError("This verification link is invalid or has expired. Request a new one.");
      })
      .finally(() => {
        if (!cancelled) setCheckLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [params.oobCode, refreshUser]);

  const handleResend = useCallback(async () => {
    setResendLoading(true);
    setError("");
    setResendSuccess(false);
    try {
      const baseUrl = getApiUrl();
      const url = new URL("/api/auth/send-verification-email", baseUrl).toString();
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        ...getAuthHeaders(),
      };
      const res = await globalThis.fetch(url, {
        method: "POST",
        headers,
        credentials: "include",
        body: JSON.stringify({ email: user?.email }),
      });
      if (res.ok) {
        setResendSuccess(true);
      } else {
        const data = await res.json().catch(() => ({}));
        if (res.status === 502) {
          setError(data.error || "We couldn't send the verification email right now. Please try again in a few minutes.");
        } else {
          setError(data.error || "Failed to resend verification email.");
        }
      }
    } catch {
      setError("Failed to resend verification email.");
    } finally {
      setResendLoading(false);
    }
  }, [user?.email]);

  const handleCheckVerification = useCallback(async () => {
    setCheckLoading(true);
    setError("");
    try {
      if (actionApplied && !user) {
        router.replace("/login");
        return;
      }
      const refreshedUser = await refreshUser();
      if (refreshedUser?.emailVerified) {
        router.replace("/");
      }
    } catch {
      setError("Failed to check verification status.");
    } finally {
      setCheckLoading(false);
    }
  }, [actionApplied, refreshUser, router, user]);

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
      <View style={styles.card}>
        <View style={styles.header}>
          <Feather name="mail" size={40} color={Colors.primary} />
          <Text style={styles.title}>Verify Your Email</Text>
          <Text style={styles.description}>
            {actionApplied ? (
              "Your email address has been verified. You can continue to Proset."
            ) : (
              <>
                We sent a verification link to{" "}
                <Text style={styles.emailHighlight}>{user?.email}</Text>.
                Please check your inbox and click the link to activate your account.
              </>
            )}
          </Text>
        </View>

        {error ? (
          <View style={styles.errorContainer} accessibilityRole="alert" accessibilityLiveRegion="assertive">
            <Feather name="alert-circle" size={16} color={Colors.error} />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        {resendSuccess ? (
          <View style={styles.successContainer} accessibilityRole="alert" accessibilityLiveRegion="polite">
            <Feather name="check-circle" size={16} color={Colors.success} />
            <Text style={styles.successText}>Verification email sent! Check your inbox.</Text>
          </View>
        ) : null}

        <View style={styles.tipContainer}>
          <Feather name="info" size={16} color={Colors.textSecondary} />
          <Text style={styles.tipText}>
            Check your spam or junk folder if you don&apos;t see the email.
          </Text>
        </View>

        <Pressable
          style={[styles.primaryButton, checkLoading && styles.buttonDisabled]}
          onPress={handleCheckVerification}
          disabled={checkLoading}
          testID="check-verification-button"
          accessibilityRole="button"
        >
          {checkLoading ? (
            <ActivityIndicator color={Colors.white} />
          ) : (
            <Text style={styles.primaryButtonText}>I&apos;ve Verified My Email</Text>
          )}
        </Pressable>

        <Pressable
          style={[styles.secondaryButton, resendLoading && styles.buttonDisabled]}
          onPress={handleResend}
          disabled={resendLoading}
          testID="resend-verification-button"
          accessibilityRole="button"
        >
          {resendLoading ? (
            <ActivityIndicator color={Colors.primary} size="small" />
          ) : (
            <Text style={styles.secondaryButtonText}>Resend Verification Email</Text>
          )}
        </Pressable>

        <Pressable
          onPress={logout}
          style={styles.logoutButton}
          accessibilityRole="button"
          testID="verify-email-logout"
        >
          <Text style={styles.logoutText}>Sign Out</Text>
        </Pressable>
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
    emailHighlight: {
      color: Colors.primary,
      fontFamily: "Inter_600SemiBold",
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
      marginBottom: 12,
    },
    primaryButtonText: {
      fontSize: sf(16, ts),
      fontFamily: "Inter_600SemiBold",
      color: Colors.white,
    },
    secondaryButton: {
      borderRadius: 12,
      paddingVertical: 14,
      paddingHorizontal: 24,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 1,
      borderColor: Colors.border,
      marginBottom: 8,
    },
    secondaryButtonText: {
      fontSize: sf(14, ts),
      fontFamily: "Inter_500Medium",
      color: Colors.primary,
    },
    buttonDisabled: {
      opacity: 0.6,
    },
    logoutButton: {
      marginTop: 8,
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
