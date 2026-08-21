import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  Pressable,
  ActivityIndicator,
  Platform,
  Linking,
} from "react-native";
import { router } from "@/lib/navigation";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Feather from "@react-native-vector-icons/feather/static";
import Colors from "@/constants/colors";
import { useResponsiveLayout } from "@/lib/useResponsiveLayout";
import { useAuth } from "@/lib/auth-context";
import { useLanguage } from "@/lib/i18n";
import { useTextScale, sf, type TextScale } from "@/lib/typography";
import { apiRequest, getApiUrl } from "@/lib/query-client";
import { setStringAsync } from "@/lib/clipboard";

type IconName = React.ComponentProps<typeof Feather>["name"];
type ExpiryChoice = "never" | 30 | 90 | 365;

interface DeveloperKey {
  id: string;
  name: string;
  keyPrefix: string;
  lastUsedAt?: string | null;
  createdAt: string;
  expiresAt?: string | null;
  expired?: boolean;
}

interface RevealedKey {
  id: string;
  name: string;
  key: string;
  keyPrefix: string;
  createdAt: string;
  expiresAt?: string | null;
}

const EXPIRY_DEFS: {
  value: ExpiryChoice;
  labelKey: "settings.developer.never" | "settings.developer.d30" | "settings.developer.d90" | "settings.developer.d365";
}[] = [
  { value: "never", labelKey: "settings.developer.never" },
  { value: 30, labelKey: "settings.developer.d30" },
  { value: 90, labelKey: "settings.developer.d90" },
  { value: 365, labelKey: "settings.developer.d365" },
];

function shortDate(iso: string, language: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(language === "es" ? "es-MX" : "en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function DeveloperSettings() {
  const insets = useSafeAreaInsets();
  const layout = useResponsiveLayout();
  const webTopInset = Platform.OS === "web" ? 67 : 0;
  const { user } = useAuth();
  const { t, language } = useLanguage();
  const ts = useTextScale();
  const styles = useMemo(() => makeStyles(ts), [ts]);

  const [keys, setKeys] = useState<DeveloperKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [expiryChoice, setExpiryChoice] = useState<ExpiryChoice>(90);
  const [revealed, setRevealed] = useState<RevealedKey | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [revokeConfirmId, setRevokeConfirmId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const restUrl = useMemo(() => new URL("/api/v1", getApiUrl()).toString(), []);
  const mcpUrl = useMemo(() => new URL("/mcp", getApiUrl()).toString(), []);

  const loadKeys = useCallback(async () => {
    try {
      const res = await apiRequest("GET", "/api/developer/keys");
      const data = await res.json();
      setKeys(Array.isArray(data.keys) ? data.keys : []);
      setError(null);
    } catch (e: any) {
      if (!String(e?.message || "").startsWith("401")) setError(t("settings.developer.failed"));
      setKeys([]);
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (user) loadKeys();
    else setLoading(false);
  }, [user, loadKeys]);

  useEffect(() => () => {
    if (copyTimer.current) clearTimeout(copyTimer.current);
  }, []);

  const flashCopied = useCallback((id: string) => {
    setCopied(id);
    if (copyTimer.current) clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopied(null), 1600);
  }, []);

  const copyText = useCallback(
    async (id: string, text: string) => {
      const ok = await setStringAsync(text);
      if (ok) flashCopied(id);
    },
    [flashCopied],
  );

  const createKey = useCallback(async () => {
    setCreating(true);
    setError(null);
    try {
      const res = await apiRequest("POST", "/api/developer/keys", {
        name: "API key",
        expiresInDays: expiryChoice === "never" ? "never" : expiryChoice,
      });
      const data = await res.json();
      if (data.key) {
        setRevealed({
          id: data.id,
          name: data.name,
          key: data.key,
          keyPrefix: data.keyPrefix,
          createdAt: data.createdAt,
          expiresAt: data.expiresAt ?? null,
        });
      }
      setShowCreate(false);
      setExpiryChoice(90);
      await loadKeys();
    } catch {
      setError(t("settings.developer.failed"));
    } finally {
      setCreating(false);
    }
  }, [loadKeys, t, expiryChoice]);

  const revokeKey = useCallback(
    async (id: string) => {
      try {
        await apiRequest("DELETE", `/api/developer/keys/${id}`);
        setRevokeConfirmId(null);
        await loadKeys();
      } catch {
        setError(t("settings.developer.failed"));
      }
    },
    [loadKeys, t],
  );

  return (
    <View style={[styles.container, { paddingTop: insets.top + webTopInset }]}>
      <View
        style={[
          styles.header,
          {
            maxWidth: layout.contentMaxWidth,
            alignSelf: "center",
            width: "100%",
            paddingHorizontal: layout.contentPadding,
          },
        ]}
      >
        <Pressable
          style={styles.backBtn}
          onPress={() => {
            if (router.canGoBack()) router.back();
            else router.replace("/");
          }}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel={t("a11y.goBack")}
        >
          <Feather name="arrow-left" size={24} color={Colors.text} />
        </Pressable>
        <Text style={styles.headerTitle} accessibilityRole="header">
          {t("settings.developer")}
        </Text>
        <View style={{ width: 44 }} />
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
        {error ? (
          <View style={styles.errorBanner}>
            <Feather name="alert-circle" size={16} color={Colors.error} />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        {/* One-time key reveal */}
        {revealed ? (
          <View style={styles.revealCard} testID="developer-key-reveal">
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 12 }}>
              <View style={styles.warnIcon}>
                <Feather name="eye" size={18} color={Colors.warning} />
              </View>
              <Text style={styles.revealTitle}>{t("settings.developer.shownOnce")}</Text>
            </View>
            <View style={styles.keyBox}>
              <Text style={styles.keyText} selectable>
                {revealed.key}
              </Text>
            </View>
            <Text style={styles.revealMeta}>
              {revealed.expiresAt
                ? `${t("settings.developer.expires")} ${shortDate(revealed.expiresAt, language)}`
                : t("settings.developer.never")}
            </Text>
            <View style={styles.revealActions}>
              <Pressable
                style={styles.copyBtn}
                onPress={() => copyText("reveal", revealed.key)}
                accessibilityRole="button"
                accessibilityLabel={t("settings.developer.copy")}
                testID="developer-key-copy"
              >
                <Feather
                  name={copied === "reveal" ? "check" : "copy"}
                  size={16}
                  color={copied === "reveal" ? Colors.success : Colors.text}
                />
                <Text style={[styles.copyBtnText, copied === "reveal" && { color: Colors.success }]}>
                  {copied === "reveal" ? t("settings.developer.copied") : t("settings.developer.copy")}
                </Text>
              </Pressable>
              <Pressable
                style={styles.doneBtn}
                onPress={() => setRevealed(null)}
                accessibilityRole="button"
                accessibilityLabel={t("settings.developer.done")}
              >
                <Text style={styles.doneBtnText}>{t("settings.developer.done")}</Text>
              </Pressable>
            </View>
          </View>
        ) : null}

        {/* API keys section */}
        <Text style={styles.sectionLabel}>{t("settings.developer.apiKeys")}</Text>

        {loading ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator color={Colors.primary} />
          </View>
        ) : keys.length === 0 ? (
          <View style={styles.emptyCard}>
            <Feather name="key" size={22} color={Colors.textMuted} />
            <Text style={styles.emptyText}>{t("settings.developer.apiKeysEmpty")}</Text>
          </View>
        ) : (
          keys.map((k) => (
            <View key={k.id} style={styles.keyRow}>
              <View style={styles.keyRowIcon}>
                <Feather name="key" size={18} color={Colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.keyRowName} numberOfLines={1}>
                  {k.name}
                </Text>
                <Text style={styles.keyRowPrefix} numberOfLines={1}>
                  {k.keyPrefix}
                </Text>
                <Text style={[styles.keyRowMeta, k.expired && styles.keyRowMetaExpired]}>
                  {k.expired
                    ? t("settings.developer.expired")
                    : k.expiresAt
                      ? `${t("settings.developer.expires")} ${shortDate(k.expiresAt, language)}`
                      : t("settings.developer.never")}
                </Text>
              </View>
              {revokeConfirmId === k.id ? (
                <View style={styles.revokeConfirm}>
                  <Pressable
                    onPress={() => revokeKey(k.id)}
                    style={styles.revokeYes}
                    accessibilityRole="button"
                    accessibilityLabel={t("settings.developer.revoke")}
                  >
                    <Text style={styles.revokeYesText}>{t("settings.developer.revoke")}</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => setRevokeConfirmId(null)}
                    style={styles.revokeCancel}
                    accessibilityRole="button"
                    accessibilityLabel={t("common.cancel")}
                  >
                    <Feather name="x" size={18} color={Colors.textSecondary} />
                  </Pressable>
                </View>
              ) : (
                <Pressable
                  onPress={() => setRevokeConfirmId(k.id)}
                  hitSlop={8}
                  style={styles.revokeBtn}
                  accessibilityRole="button"
                  accessibilityLabel={t("settings.developer.revoke")}
                  testID={`developer-revoke-${k.keyPrefix}`}
                >
                  <Feather name="trash-2" size={18} color={Colors.error} />
                </Pressable>
              )}
            </View>
          ))
        )}

        {showCreate ? (
          <View style={styles.createPanel} testID="developer-create-panel">
            <Text style={styles.createPanelLabel}>{t("settings.developer.expires")}</Text>
            <View style={styles.expiryRow}>
              {EXPIRY_DEFS.map((opt) => {
                const active = expiryChoice === opt.value;
                return (
                  <Pressable
                    key={opt.value}
                    onPress={() => setExpiryChoice(opt.value)}
                    style={[styles.expiryChip, active && styles.expiryChipActive]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                  >
                    <Text style={[styles.expiryChipText, active && styles.expiryChipTextActive]}>
                      {t(opt.labelKey)}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <View style={styles.createPanelActions}>
              <Pressable
                style={styles.cancelBtn}
                onPress={() => setShowCreate(false)}
                accessibilityRole="button"
                accessibilityLabel={t("common.cancel")}
              >
                <Text style={styles.cancelBtnText}>{t("common.cancel")}</Text>
              </Pressable>
              <Pressable
                style={styles.createConfirmBtn}
                onPress={createKey}
                disabled={creating}
                accessibilityRole="button"
                accessibilityLabel={t("settings.developer.create")}
                testID="developer-create-confirm"
              >
                {creating ? (
                  <ActivityIndicator color={Colors.white} />
                ) : (
                  <Feather name="plus" size={18} color={Colors.white} />
                )}
                <Text style={styles.createConfirmText}>{t("settings.developer.create")}</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <Pressable
            style={({ pressed }) => [styles.createBtn, pressed && { opacity: 0.7 }]}
            onPress={() => setShowCreate(true)}
            accessibilityRole="button"
            accessibilityLabel={t("settings.developer.createKey")}
            testID="developer-create-key"
          >
            <Feather name="plus" size={20} color={Colors.white} />
            <Text style={styles.createBtnText}>{t("settings.developer.createKey")}</Text>
          </Pressable>
        )}

        {/* Connect section */}
        <Text style={[styles.sectionLabel, { marginTop: 24 }]}>{t("settings.developer.connect")}</Text>

        <ConnectRow
          icon="server"
          label={t("settings.developer.restApi")}
          value={restUrl}
          copied={copied === "rest"}
          onCopy={() => copyText("rest", restUrl)}
          styles={styles}
        />
        <ConnectRow
          icon="zap"
          label={t("settings.developer.mcpServer")}
          value={mcpUrl}
          copied={copied === "mcp"}
          onCopy={() => copyText("mcp", mcpUrl)}
          styles={styles}
        />
        <Pressable
          style={({ pressed }) => [styles.connectRow, pressed && { opacity: 0.7 }]}
          onPress={() => {
            const docsUrl = new URL("/documentation/", getApiUrl()).toString();
            if (Platform.OS === "web") window.open(docsUrl, "_blank");
            else Linking.openURL(docsUrl);
          }}
          accessibilityRole="button"
        >
          <View style={styles.connectIcon}>
            <Feather name="book-open" size={18} color={Colors.primary} />
          </View>
          <Text style={styles.connectLabel}>{t("settings.developer.documentation")}</Text>
          <Feather name="external-link" size={18} color={Colors.textMuted} />
        </Pressable>
      </ScrollView>
    </View>
  );
}

function ConnectRow(props: {
  icon: IconName;
  label: string;
  value: string;
  copied: boolean;
  onCopy: () => void;
  styles: ReturnType<typeof makeStyles>;
}) {
  const { icon, label, value, copied, onCopy, styles } = props;
  return (
    <Pressable
      style={({ pressed }) => [styles.connectRow, pressed && { opacity: 0.7 }]}
      onPress={onCopy}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <View style={styles.connectIcon}>
        <Feather name={icon} size={18} color={Colors.primary} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.connectLabel}>{label}</Text>
        <Text style={styles.connectValue} numberOfLines={1}>
          {value}
        </Text>
      </View>
      <Feather name={copied ? "check" : "copy"} size={18} color={copied ? Colors.success : Colors.textMuted} />
    </Pressable>
  );
}

const makeStyles = (ts: TextScale) =>
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
    sectionLabel: {
      fontSize: sf(13, ts),
      fontFamily: "Inter_600SemiBold",
      color: Colors.textMuted,
      textTransform: "uppercase",
      letterSpacing: 1,
      marginBottom: 10,
      marginTop: 4,
    },
    errorBanner: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      backgroundColor: "rgba(248, 113, 113, 0.1)",
      borderRadius: 12,
      borderWidth: 1,
      borderColor: "rgba(248, 113, 113, 0.35)",
      paddingVertical: 12,
      paddingHorizontal: 14,
      marginBottom: 14,
    },
    errorText: {
      flex: 1,
      fontSize: sf(13, ts),
      fontFamily: "Inter_400Regular",
      color: Colors.error,
    },
    revealCard: {
      backgroundColor: Colors.surface,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: "rgba(251, 191, 36, 0.5)",
      padding: 16,
      marginBottom: 18,
    },
    warnIcon: {
      width: 34,
      height: 34,
      borderRadius: 10,
      backgroundColor: "rgba(251, 191, 36, 0.12)",
      justifyContent: "center",
      alignItems: "center",
    },
    revealTitle: {
      flex: 1,
      fontSize: sf(14, ts),
      fontFamily: "Inter_600SemiBold",
      color: Colors.warning,
      lineHeight: 20,
    },
    keyBox: {
      backgroundColor: Colors.background,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: Colors.border,
      padding: 14,
      marginBottom: 10,
    },
    keyText: {
      fontSize: sf(13, ts),
      fontFamily: "Inter_400Regular",
      color: Colors.text,
      letterSpacing: 0.5,
      lineHeight: 20,
    },
    revealMeta: {
      fontSize: sf(12, ts),
      fontFamily: "Inter_400Regular",
      color: Colors.textSecondary,
      marginBottom: 12,
    },
    revealActions: {
      flexDirection: "row",
      gap: 10,
    },
    copyBtn: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      backgroundColor: Colors.surfaceLight,
      borderRadius: 12,
      paddingVertical: 12,
    },
    copyBtnText: {
      fontSize: sf(14, ts),
      fontFamily: "Inter_600SemiBold",
      color: Colors.text,
    },
    doneBtn: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: Colors.primary,
      borderRadius: 12,
      paddingVertical: 12,
    },
    doneBtnText: {
      fontSize: sf(14, ts),
      fontFamily: "Inter_600SemiBold",
      color: Colors.white,
    },
    loadingRow: {
      alignItems: "center",
      paddingVertical: 24,
    },
    emptyCard: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      backgroundColor: Colors.surface,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: Colors.border,
      paddingVertical: 18,
      paddingHorizontal: 16,
    },
    emptyText: {
      fontSize: sf(14, ts),
      fontFamily: "Inter_400Regular",
      color: Colors.textSecondary,
    },
    keyRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      backgroundColor: Colors.surface,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: Colors.border,
      paddingVertical: 14,
      paddingHorizontal: 16,
      marginBottom: 10,
    },
    keyRowIcon: {
      width: 40,
      height: 40,
      borderRadius: 10,
      backgroundColor: "rgba(0, 180, 216, 0.08)",
      justifyContent: "center",
      alignItems: "center",
    },
    keyRowName: {
      fontSize: sf(15, ts),
      fontFamily: "Inter_600SemiBold",
      color: Colors.text,
    },
    keyRowPrefix: {
      fontSize: sf(12, ts),
      fontFamily: "Inter_400Regular",
      color: Colors.textSecondary,
      letterSpacing: 0.3,
      marginTop: 1,
    },
    keyRowMeta: {
      fontSize: sf(11, ts),
      fontFamily: "Inter_400Regular",
      color: Colors.textMuted,
      marginTop: 3,
    },
    keyRowMetaExpired: {
      color: Colors.error,
    },
    revokeBtn: {
      width: 38,
      height: 38,
      borderRadius: 10,
      backgroundColor: "rgba(248, 113, 113, 0.1)",
      justifyContent: "center",
      alignItems: "center",
    },
    revokeConfirm: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
    },
    revokeYes: {
      backgroundColor: Colors.error,
      borderRadius: 10,
      paddingVertical: 8,
      paddingHorizontal: 12,
    },
    revokeYesText: {
      fontSize: sf(13, ts),
      fontFamily: "Inter_600SemiBold",
      color: Colors.white,
    },
    revokeCancel: {
      width: 38,
      height: 38,
      borderRadius: 10,
      backgroundColor: Colors.surfaceLight,
      justifyContent: "center",
      alignItems: "center",
    },
    createBtn: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      backgroundColor: Colors.primary,
      borderRadius: 12,
      paddingVertical: 14,
      marginTop: 4,
    },
    createBtnText: {
      fontSize: sf(15, ts),
      fontFamily: "Inter_600SemiBold",
      color: Colors.white,
    },
    createPanel: {
      backgroundColor: Colors.surface,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: Colors.border,
      padding: 16,
      marginTop: 4,
    },
    createPanelLabel: {
      fontSize: sf(13, ts),
      fontFamily: "Inter_600SemiBold",
      color: Colors.textMuted,
      textTransform: "uppercase",
      letterSpacing: 1,
      marginBottom: 10,
    },
    expiryRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 8,
      marginBottom: 16,
    },
    expiryChip: {
      paddingVertical: 8,
      paddingHorizontal: 14,
      borderRadius: 10,
      backgroundColor: Colors.surfaceLight,
      borderWidth: 1,
      borderColor: Colors.border,
    },
    expiryChipActive: {
      backgroundColor: "rgba(0, 180, 216, 0.15)",
      borderColor: Colors.primary,
    },
    expiryChipText: {
      fontSize: sf(13, ts),
      fontFamily: "Inter_600SemiBold",
      color: Colors.textSecondary,
    },
    expiryChipTextActive: {
      color: Colors.primary,
    },
    createPanelActions: {
      flexDirection: "row",
      gap: 10,
    },
    cancelBtn: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: Colors.surfaceLight,
      borderRadius: 12,
      paddingVertical: 12,
    },
    cancelBtnText: {
      fontSize: sf(14, ts),
      fontFamily: "Inter_600SemiBold",
      color: Colors.textSecondary,
    },
    createConfirmBtn: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      backgroundColor: Colors.primary,
      borderRadius: 12,
      paddingVertical: 12,
    },
    createConfirmText: {
      fontSize: sf(14, ts),
      fontFamily: "Inter_600SemiBold",
      color: Colors.white,
    },
    connectRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      backgroundColor: Colors.surface,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: Colors.border,
      paddingVertical: 14,
      paddingHorizontal: 16,
      marginBottom: 10,
    },
    connectIcon: {
      width: 40,
      height: 40,
      borderRadius: 10,
      backgroundColor: "rgba(0, 180, 216, 0.08)",
      justifyContent: "center",
      alignItems: "center",
    },
    connectLabel: {
      fontSize: sf(15, ts),
      fontFamily: "Inter_600SemiBold",
      color: Colors.text,
    },
    connectValue: {
      fontSize: sf(12, ts),
      fontFamily: "Inter_400Regular",
      color: Colors.textSecondary,
      letterSpacing: 0.2,
      marginTop: 2,
    },
  });
