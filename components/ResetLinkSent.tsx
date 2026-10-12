import React, { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import Feather from "@react-native-vector-icons/feather/static";

import Colors from "@/constants/colors";
import { useLanguage } from "@/lib/i18n";
import { useTextScale, sf, type TextScale } from "@/lib/typography";
import { resendCooldownRemaining } from "@/lib/password-reset";
import { canOpenMailbox, mailAppLabel, openMailbox } from "@/lib/mailbox";

/**
 * The "we sent you a link" state, shared by the login sheet and the
 * reset-password screen.
 *
 * Deliberately NOT "…now go back to sign in": the user's next task is to open
 * their mailbox, so the primary action hands them to their mail app, the second
 * one resends (disabled for a minute so the server's rate limit is never what
 * tells the user to wait), and signing in stays a quiet escape hatch.
 *
 * The address is named because people have several mailboxes and "check your
 * inbox" does not tell them which one.
 */
export default function ResetLinkSent({
  email,
  lastSentAt,
  resending = false,
  onResend,
  onBackToSignIn,
  onChangeEmail,
  testID = "reset-link-sent",
}: {
  email: string;
  lastSentAt: number | null;
  resending?: boolean;
  onResend: () => void;
  onBackToSignIn: () => void;
  onChangeEmail?: () => void;
  testID?: string;
}) {
  const { t } = useLanguage();
  const ts = useTextScale();
  const styles = React.useMemo(() => makeStyles(ts), [ts]);

  const [cooldownSeconds, setCooldownSeconds] = useState(() =>
    resendCooldownRemaining(lastSentAt, Date.now()),
  );

  useEffect(() => {
    setCooldownSeconds(resendCooldownRemaining(lastSentAt, Date.now()));
    if (!lastSentAt) return;
    const id = setInterval(() => {
      const left = resendCooldownRemaining(lastSentAt, Date.now());
      setCooldownSeconds(left);
      if (left === 0) clearInterval(id);
    }, 1000);
    return () => clearInterval(id);
  }, [lastSentAt]);

  const resendDisabled = resending || cooldownSeconds > 0;
  const showMailbox = canOpenMailbox(email);
  const webmailProvider = showMailbox ? mailAppLabel(email) : null;

  return (
    <View testID={testID}>
      <View style={styles.header} accessibilityLiveRegion="polite">
        <Feather name="check-circle" size={40} color={Colors.success} />
        <Text
          style={styles.status}
          accessibilityRole="header"
          numberOfLines={2}
          testID={`${testID}-status`}
        >
          {t("login.resetLinkSentTo", { email })}
        </Text>
      </View>

      {showMailbox ? (
        <Pressable
          style={styles.primaryButton}
          onPress={() => {
            void openMailbox(email);
          }}
          accessibilityRole="button"
          testID={`${testID}-open-mail`}
        >
          <Feather name="mail" size={16} color={Colors.white} />
          <Text style={styles.primaryButtonText}>
            {webmailProvider
              ? t("login.openWebmail", { provider: webmailProvider })
              : t("login.openEmailApp")}
          </Text>
        </Pressable>
      ) : null}

      <Pressable
        style={[styles.secondaryButton, resendDisabled && styles.buttonDisabled]}
        onPress={onResend}
        disabled={resendDisabled}
        accessibilityRole="button"
        accessibilityState={{ disabled: resendDisabled }}
        testID={`${testID}-resend`}
      >
        {resending ? (
          <ActivityIndicator size="small" color={Colors.primary} />
        ) : (
          <>
            <Feather name="refresh-cw" size={16} color={Colors.primary} />
            <Text style={styles.secondaryButtonText}>
              {cooldownSeconds > 0
                ? t("login.resendLinkIn", { seconds: cooldownSeconds })
                : t("login.resendLink")}
            </Text>
          </>
        )}
      </Pressable>

      <View style={styles.linksRow}>
        {onChangeEmail ? (
          <Pressable
            onPress={onChangeEmail}
            accessibilityRole="button"
            testID={`${testID}-change-email`}
          >
            <Text style={styles.link}>{t("login.changeEmail")}</Text>
          </Pressable>
        ) : null}
        <Pressable
          onPress={onBackToSignIn}
          accessibilityRole="button"
          testID={`${testID}-back-to-signin`}
        >
          <Text style={styles.link}>{t("login.backToSignIn")}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const makeStyles = (ts: TextScale) =>
  StyleSheet.create({
    header: {
      alignItems: "center",
      marginBottom: 20,
    },
    status: {
      fontSize: sf(16, ts),
      fontFamily: "Inter_600SemiBold",
      color: Colors.text,
      textAlign: "center",
      marginTop: 12,
      lineHeight: 22,
    },
    primaryButton: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      backgroundColor: Colors.primaryButton,
      borderRadius: 12,
      paddingVertical: 16,
      paddingHorizontal: 24,
      minHeight: 48,
      alignSelf: "stretch",
    },
    primaryButtonText: {
      fontSize: sf(16, ts),
      fontFamily: "Inter_600SemiBold",
      color: Colors.white,
    },
    secondaryButton: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      backgroundColor: Colors.surface,
      borderWidth: 1,
      borderColor: Colors.border,
      borderRadius: 12,
      paddingVertical: 14,
      paddingHorizontal: 24,
      minHeight: 48,
      alignSelf: "stretch",
      marginTop: 12,
    },
    secondaryButtonText: {
      fontSize: sf(15, ts),
      fontFamily: "Inter_600SemiBold",
      color: Colors.primary,
    },
    buttonDisabled: {
      opacity: 0.5,
    },
    linksRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 24,
      marginTop: 20,
    },
    link: {
      fontSize: sf(14, ts),
      fontFamily: "Inter_500Medium",
      color: Colors.textSecondary,
      paddingVertical: 8,
    },
  });
