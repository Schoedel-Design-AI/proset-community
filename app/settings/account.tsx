import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  Pressable,
  TextInput,
  Platform,
  Alert,
  ActivityIndicator,
  FlatList,
Switch,
  KeyboardAvoidingView,
  Linking,
  Modal,
} from "react-native";
import { router, useLocalSearchParams } from "@/lib/navigation";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Feather from "@react-native-vector-icons/feather/static";
import FontAwesome from "@react-native-vector-icons/fontawesome/static";
import * as Haptics from "@/lib/haptics";
const expoFetch = globalThis.fetch;
import { SvgXml } from "react-native-svg";
import { useQuery } from "@tanstack/react-query";
import Colors from "@/constants/colors";
import AvatarView from "@/components/AvatarView";

import { validatePassword } from "@/lib/password-validation";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getApiUrl, getAuthHeaders } from "@/lib/query-client";
import { useResponsiveLayout } from "@/lib/useResponsiveLayout";
import { useAuth } from "@/lib/auth-context";
import { getAvatarsForPack, getAvatarSvg, getPackKeyFromAvatarId, getPackPreviewSvg, clearAvatarCaches, AVATAR_PACKS, type AvatarEntry, type AvatarStyleKey } from "@/lib/avatars";
import { useLanguage, type Language } from "@/lib/i18n";
import { useTextScale, useTextSizePref, sf, type TextScale, type TextSizePreference } from "@/lib/typography";
import { JOB_TYPES } from "@shared/schema";




const ALL_COUNTRIES = [
  "Afghanistan","Albania","Algeria","Andorra","Angola","Antigua and Barbuda","Argentina","Armenia","Australia","Austria",
  "Azerbaijan","Bahamas","Bahrain","Bangladesh","Barbados","Belarus","Belgium","Belize","Benin","Bhutan",
  "Bolivia","Bosnia and Herzegovina","Botswana","Brazil","Brunei","Bulgaria","Burkina Faso","Burundi","Cabo Verde","Cambodia",
  "Cameroon","Canada","Central African Republic","Chad","Chile","China","Colombia","Comoros","Congo","Costa Rica",
  "Croatia","Cuba","Cyprus","Czech Republic","Denmark","Djibouti","Dominica","Dominican Republic","Ecuador","Egypt",
  "El Salvador","Equatorial Guinea","Eritrea","Estonia","Eswatini","Ethiopia","Fiji","Finland","France","Gabon",
  "Gambia","Georgia","Germany","Ghana","Greece","Grenada","Guatemala","Guinea","Guinea-Bissau","Guyana",
  "Haiti","Honduras","Hungary","Iceland","India","Indonesia","Iran","Iraq","Ireland","Israel",
  "Italy","Jamaica","Japan","Jordan","Kazakhstan","Kenya","Kiribati","Kuwait","Kyrgyzstan","Laos",
  "Latvia","Lebanon","Lesotho","Liberia","Libya","Liechtenstein","Lithuania","Luxembourg","Madagascar","Malawi",
  "Malaysia","Maldives","Mali","Malta","Marshall Islands","Mauritania","Mauritius","Mexico","Micronesia","Moldova",
  "Monaco","Mongolia","Montenegro","Morocco","Mozambique","Myanmar","Namibia","Nauru","Nepal","Netherlands",
  "New Zealand","Nicaragua","Niger","Nigeria","North Korea","North Macedonia","Norway","Oman","Pakistan","Palau",
  "Palestine","Panama","Papua New Guinea","Paraguay","Peru","Philippines","Poland","Portugal","Puerto Rico","Qatar",
  "Romania","Russia","Rwanda","Saint Kitts and Nevis","Saint Lucia","Saint Vincent and the Grenadines","Samoa","San Marino",
  "São Tomé and Príncipe","Saudi Arabia","Senegal","Serbia","Seychelles","Sierra Leone","Singapore","Slovakia","Slovenia",
  "Solomon Islands","Somalia","South Africa","South Korea","South Sudan","Spain","Sri Lanka","Sudan","Suriname","Sweden",
  "Switzerland","Syria","Taiwan","Tajikistan","Tanzania","Thailand","Timor-Leste","Togo","Tonga","Trinidad and Tobago",
  "Tunisia","Turkey","Turkmenistan","Tuvalu","Uganda","Ukraine","United Arab Emirates","United Kingdom","United States",
  "Uruguay","Uzbekistan","Vanuatu","Vatican City","Venezuela","Vietnam","Yemen","Zambia","Zimbabwe",
];

const PINNED_COUNTRIES = ["United States", "Mexico", "Canada"];
const COUNTRIES = [
  ...PINNED_COUNTRIES,
  ...ALL_COUNTRIES.filter((country) => !PINNED_COUNTRIES.includes(country)).sort((left, right) => left.localeCompare(right)),
];

type PublicTier = "free" | "base" | "pro";
type DisplayTier = PublicTier;

function normalizePlanTier(tier?: string | null): PublicTier {
  const normalizedTier = String(tier || "").toLowerCase();
  if (normalizedTier === "pro") return "pro";
  if (normalizedTier === "base" || normalizedTier === "plus" || normalizedTier === "cloud_plus") return "base";
  return "free";
}

function normalizeDisplayedTier(tier?: string | null, displayTier?: string | null): DisplayTier {
  const normalizedDisplay = String(displayTier || tier || "").toLowerCase();
  return normalizePlanTier(normalizedDisplay);
}

type TabKey = "account";

export default function AccountScreen() {
  const insets = useSafeAreaInsets();
  const layout = useResponsiveLayout();
  const webTopInset = Platform.OS === "web" ? 67 : 0;
  const { user } = useAuth();
  const params = useLocalSearchParams<{ tab?: string }>();
  const { t, language } = useLanguage();
  const ts = useTextScale();
  const [activeTab, setActiveTab] = useState<TabKey>("account");
  const segStyles = useMemo(() => makeSegmentStyles(ts), [ts]);
  const baseUrl = getApiUrl();

  const tabs: { key: TabKey; label: string }[] = [
    { key: "account", label: t("settings.account") },
  ];

  useEffect(() => {
    const requestedTab: TabKey | null = params.tab === "account" ? "account" : null;
    if (requestedTab && requestedTab !== activeTab) {
      setActiveTab(requestedTab);
    }
  }, [activeTab, params.tab]);

  return (
    <View style={{ flex: 1, backgroundColor: Colors.background, paddingTop: insets.top + webTopInset }}>
      <View style={[segStyles.header, { maxWidth: layout.contentMaxWidth, alignSelf: "center", width: "100%", paddingHorizontal: layout.contentPadding }]}>
        <Pressable
          style={segStyles.backBtn}
          onPress={() => {
            if (router.canGoBack()) router.back();
            else router.replace("/settings" as any);
          }}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel={t("a11y.goBack")}
        >
          <Feather name="arrow-left" size={24} color={Colors.text} />
        </Pressable>
        <Text style={segStyles.headerTitle} accessibilityRole="header">{t("settings.account")}</Text>

      </View>

      <View style={[segStyles.segmentWrap, { maxWidth: layout.contentMaxWidth, alignSelf: "center", width: "100%", paddingHorizontal: layout.contentPadding }]}>
        <View style={segStyles.segmentRow}>
          {tabs.map((tab) => (
            <Pressable
              key={tab.key}
              style={[segStyles.segmentBtn, activeTab === tab.key && segStyles.segmentBtnActive]}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setActiveTab(tab.key);
              }}
              accessibilityRole="tab"
              accessibilityState={{ selected: activeTab === tab.key }}
            >
              <Text style={[segStyles.segmentText, activeTab === tab.key && segStyles.segmentTextActive]}>{tab.label}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      {activeTab === "account" && user && (
        <AccountTab
          user={user}
          layout={layout}
          insets={insets}
        />
      )}
    </View>
  );
}

function AccountTab({
  user,
  layout,
  insets,
}: {
  user: any;
  layout: any;
  insets: any;
}) {
  const { t, language } = useLanguage();
  const { changeEmail, changeName, changeCountry, changeJobType, changeAvatar, changePassword, deleteAccount, logout } = useAuth();
  const ts = useTextScale();
  const acctStyles = useMemo(() => makeAcctStyles(ts), [ts]);
  const aStyles = useMemo(() => makeAStyles(ts), [ts]);
  const secStyles = useMemo(() => makeSecStyles(ts), [ts]);
  const [newEmail, setNewEmail] = useState("");
  const [password, setPassword] = useState("");
  const [editFirstName, setEditFirstName] = useState("");
  const [isEditingName, setIsEditingName] = useState(false);
  const [showNameInHeader, setShowNameInHeader] = useState(false);

  // Load showNameInHeader preference
  useEffect(() => {
    AsyncStorage.getItem("showNameInHeader").then((val) => {
      if (val === "true") setShowNameInHeader(true);
    }).catch(() => {});
  }, []);
  const handleToggleNameInHeader = async (value: boolean) => {
    setShowNameInHeader(value);
    await AsyncStorage.setItem("showNameInHeader", value ? "true" : "false");
  };
  const [loading, setLoading] = useState(false);
  const [nameLoading, setNameLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [nameError, setNameError] = useState("");
  const [nameSuccess, setNameSuccess] = useState("");
  const [editCountry, setEditCountry] = useState("");
  const [countryLoading, setCountryLoading] = useState(false);
  const [countryError, setCountryError] = useState("");
  const [countrySuccess, setCountrySuccess] = useState("");
  const [countryPickerVisible, setCountryPickerVisible] = useState(false);
  const [countrySearch, setCountrySearch] = useState("");
  const [jobTypePickerVisible, setJobTypePickerVisible] = useState(false);
  const [jobTypeLoading, setJobTypeLoading] = useState(false);
  const [jobTypeError, setJobTypeError] = useState("");
  const [jobTypeSuccess, setJobTypeSuccess] = useState("");
  const [avatarPickerVisible, setAvatarPickerVisible] = useState(false);
  const [avatarLoading, setAvatarLoading] = useState(false);
  const [avatarError, setAvatarError] = useState("");
  const [avatarPack, setAvatarPack] = useState<AvatarStyleKey>("adventurer");
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [pwLoading, setPwLoading] = useState(false);
  const [pwError, setPwError] = useState("");
  const [pwSuccess, setPwSuccess] = useState("");
  const [showCurrentPw, setShowCurrentPw] = useState(false);
  const [showNewPw, setShowNewPw] = useState(false);
  const [showConfirmPw, setShowConfirmPw] = useState(false);
  const [generatedPw, setGeneratedPw] = useState("");
  const [pwCopied, setPwCopied] = useState(false);
  const [exportLoading, setExportLoading] = useState(false);
  const [showEmailForm, setShowEmailForm] = useState(false);
  const [showPwForm, setShowPwForm] = useState(false);
  const [showDeleteAccount, setShowDeleteAccount] = useState(false);
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const baseUrl = getApiUrl();
  // CE: no billing — every user has Pro avatar access.
  const hasProAvatarAccess = true;
  const selectedAvatarPack = AVATAR_PACKS.find((pack) => pack.key === avatarPack);
  const selectedPackLocked = selectedAvatarPack?.proOnly === true && !hasProAvatarAccess;

  const handleExportData = async () => {
    setExportLoading(true);
    try {
      const resp = await expoFetch(new URL("/api/account/export", baseUrl).toString(), { credentials: "include", headers: getAuthHeaders() });
      if (!resp.ok) throw new Error();
      const blob = await resp.blob();
      if (Platform.OS === "web") {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `promptforms-export-${new Date().toISOString().slice(0, 10)}.json`;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        a.style.display = "none";
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        }, 200);
      }
      Alert.alert(t("settings.exportDataSuccess"));
    } catch {
      Alert.alert(t("common.error"), t("settings.exportError"));
    } finally {
      setExportLoading(false);
    }
  };

  const handleDeleteAccount = async () => {
    if (!deletePassword.trim()) {
      setDeleteError("Password required");
      return;
    }
    setDeleteLoading(true);
    setDeleteError("");
    try {
      await deleteAccount(deletePassword);
      Alert.alert(t("settings.deleteAccountSuccess"));
    } catch (error: unknown) {
      setDeleteError(error instanceof Error ? error.message : t("settings.deleteAccountError"));
    } finally {
      setDeleteLoading(false);
    }
  };

  const handleChangeEmail = async () => {
    setError("");
    setSuccess("");
    if (!newEmail.trim()) {
      setError("Please enter a new email address");
      return;
    }
    if (!password.trim()) {
      setError("Please enter your current password to confirm");
      return;
    }
    setLoading(true);
    try {
      await changeEmail(newEmail.trim(), password);
      setSuccess("Check your new inbox to verify the address change.");
      setNewEmail("");
      setPassword("");
    } catch (err: any) {
      setError(err.message || "Failed to change email");
    } finally {
      setLoading(false);
    }
  };

  const handleChangeName = async () => {
    setNameError("");
    setNameSuccess("");
    if (!editFirstName.trim()) {
      setNameError("Please enter your first name");
      return;
    }
    setNameLoading(true);
    try {
      await changeName(editFirstName.trim());
      setNameSuccess("Name updated successfully!");
      setIsEditingName(false);
    } catch (err: any) {
      setNameError(err.message || "Failed to change name");
    } finally {
      setNameLoading(false);
    }
  };

  const isAdmin = user?.role === "admin";

  const handleGeneratePassword = async () => {
    const pw = (await import("@/lib/password-generator")).generatePasswordForRole(isAdmin ? user?.role as "admin" : "user");
    setNewPw(pw);
    setConfirmPw(pw);
    setGeneratedPw(pw);
    setShowNewPw(true);
    setShowConfirmPw(true);
    setPwCopied(false);
  };

  const handleCopyGeneratedPw = async () => {
    if (!generatedPw) return;
    try {
      const Clip = await import("@/lib/clipboard");
      await Clip.setStringAsync(generatedPw);
      setPwCopied(true);
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setTimeout(() => setPwCopied(false), 2000);
    } catch {}
  };

  const handleChangePassword = async () => {
    setPwError("");
    setPwSuccess("");
    if (!currentPw.trim()) {
      setPwError("Please enter your current password");
      return;
    }
    if (!newPw.trim()) {
      setPwError("Please enter a new password");
      return;
    }
    const validation = validatePassword(newPw, isAdmin);
    if (!validation.valid) {
      if (validation.errorCode === "minLength") {
        setPwError(`Password must be at least ${validation.minLength} characters`);
      } else if (validation.errorCode === "missingUppercase") {
        setPwError("Password must contain at least one uppercase letter");
      } else if (validation.errorCode === "missingLowercase") {
        setPwError("Password must contain at least one lowercase letter");
      } else if (validation.errorCode === "missingNumber") {
        setPwError("Password must contain at least one number");
      } else if (validation.errorCode === "missingSpecialCharacter") {
        setPwError(t("login.missingSpecialCharacter"));
      }
      return;
    }
    if (newPw !== confirmPw) {
      setPwError("New passwords do not match");
      return;
    }
    setPwLoading(true);
    try {
      await changePassword(currentPw, newPw);
      setPwSuccess("Password updated successfully!");
      setCurrentPw("");
      setNewPw("");
      setConfirmPw("");
    } catch (err: any) {
      setPwError(err.message || "Failed to change password");
    } finally {
      setPwLoading(false);
    }
  };

  return (
    <ScrollView
      contentContainerStyle={{
        padding: layout.contentPadding,
        paddingBottom: insets.bottom + 40,
        maxWidth: layout.contentMaxWidth,
        alignSelf: "center" as const,
        width: "100%" as any,
      }}
    >
      <View style={aStyles.section}>
        <View style={aStyles.profileHeader}>
          <Pressable
            style={aStyles.avatar}
            onPress={() => {
              if (user.avatarId) setAvatarPack(getPackKeyFromAvatarId(user.avatarId));
              clearAvatarCaches(); // regenerate stale SVGs
              setAvatarError("");
              setAvatarPickerVisible(true);
            }}
            accessibilityRole="button"
            accessibilityLabel={t("avatars.change" as any)}
          >
            {user.avatarId ? (
              <AvatarView avatarId={user.avatarId} size={75} />
            ) : (
              <Text style={[aStyles.avatarText, { fontSize: ts.heading }]}>{(user.firstName || user.email || "?")[0].toUpperCase()}</Text>
            )}
            <View style={aStyles.avatarEditBadge}>
              <Feather name="edit-2" size={10} color="#fff" />
            </View>
          </Pressable>
          <View style={aStyles.profileHeaderInfo}>
            <Text style={[aStyles.profileName, { fontSize: ts.heading3 }]} numberOfLines={1}>{user.firstName || "—"}</Text>
            <Text style={[aStyles.profileEmail, { fontSize: ts.body2 }]} numberOfLines={1}>{user.email}</Text>
          </View>
        </View>

        <View style={aStyles.profileDivider} />

        <Pressable
          style={aStyles.profileFieldRow}
          onPress={() => { setEditFirstName(user.firstName || ""); setIsEditingName(true); setNameError(""); setNameSuccess(""); }}
          accessibilityRole="button"
          accessibilityLabel={t("settings.editName")}
        >
          <View style={aStyles.profileFieldIcon}>
            <Feather name="user" size={16} color={Colors.textSecondary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[aStyles.profileFieldLabel, { fontSize: ts.caption }]}>{t("settings.editName")}</Text>
            <Text style={[aStyles.profileFieldValue, { fontSize: ts.body }]}>{user.firstName || "—"}</Text>
          </View>
          <Feather name="chevron-right" size={16} color={Colors.textMuted} />
        </Pressable>

        <View style={aStyles.profileDividerInset} />

        {/* Show name in header toggle — Pro/Admin only */}
        <View style={aStyles.profileFieldRow}>
          <View style={aStyles.profileFieldIcon}>
            <Feather name="type" size={16} color={Colors.textSecondary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[aStyles.profileFieldLabel, { fontSize: ts.caption }]}>{t("settings.showNameInHeader")}</Text>
            <Text style={[aStyles.profileFieldValue, { fontSize: ts.body2, color: Colors.textMuted }]}>{t("settings.showNameInHeaderDesc")}</Text>
          </View>
          <Switch
            value={showNameInHeader}
            onValueChange={handleToggleNameInHeader}
            trackColor={{ false: Colors.cardBorder, true: Colors.primary }}
            thumbColor={Colors.white}
          />
        </View>

        <View style={aStyles.profileDividerInset} />

        <View style={aStyles.profileFieldRow}>
          <View style={aStyles.profileFieldIcon}>
            <Feather name="hash" size={16} color={Colors.textSecondary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[aStyles.profileFieldLabel, { fontSize: ts.caption }]}>ID</Text>
            <Text style={[aStyles.profileFieldValue, { fontSize: ts.body }]}>#{user.userNumber || "—"}</Text>
          </View>
        </View>

        <View style={aStyles.profileDividerInset} />

        <Pressable
          style={aStyles.profileFieldRow}
          onPress={() => { setJobTypePickerVisible(true); setJobTypeError(""); setJobTypeSuccess(""); }}
          accessibilityRole="button"
          accessibilityLabel={t("settings.editJobType" as any)}
        >
          <View style={aStyles.profileFieldIcon}>
            <Feather name="briefcase" size={16} color={Colors.textSecondary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[aStyles.profileFieldLabel, { fontSize: ts.caption }]}>{t("login.jobType")}</Text>
            <Text style={[aStyles.profileFieldValue, { fontSize: ts.body }]}>{user.jobType ? (t(`industry.${user.jobType}` as any) === `industry.${user.jobType}` ? user.jobType : t(`industry.${user.jobType}` as any)) : "—"}</Text>
          </View>
          <Feather name="chevron-right" size={16} color={Colors.textMuted} />
        </Pressable>

        {!!jobTypeError && <View style={[secStyles.errorBox, { marginHorizontal: 16, marginBottom: 8 }]} accessibilityRole="alert" accessibilityLiveRegion="assertive"><Text style={secStyles.errorText}>{jobTypeError}</Text></View>}
        {!!jobTypeSuccess && <View style={[secStyles.successBox, { marginHorizontal: 16, marginBottom: 8 }]} accessibilityLiveRegion="polite"><Text style={secStyles.successText}>{jobTypeSuccess}</Text></View>}

        <View style={aStyles.profileDividerInset} />

        <Pressable
          style={aStyles.profileFieldRow}
          onPress={() => { setEditCountry(user.country || ""); setCountrySearch(""); setCountryPickerVisible(true); setCountryError(""); setCountrySuccess(""); }}
          accessibilityRole="button"
          accessibilityLabel={t("settings.editCountry" as any)}
        >
          <View style={aStyles.profileFieldIcon}>
            <Feather name="globe" size={16} color={Colors.textSecondary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[aStyles.profileFieldLabel, { fontSize: ts.caption }]}>{t("settings.editCountry" as any)}</Text>
            <Text style={[aStyles.profileFieldValue, { fontSize: ts.body }]}>{user.country || "—"}</Text>
          </View>
          <Feather name="chevron-right" size={16} color={Colors.textMuted} />
        </Pressable>

        {!!countryError && <View style={[secStyles.errorBox, { marginHorizontal: 16, marginBottom: 8 }]} accessibilityRole="alert" accessibilityLiveRegion="assertive"><Text style={secStyles.errorText}>{countryError}</Text></View>}
        {!!countrySuccess && <View style={[secStyles.successBox, { marginHorizontal: 16, marginBottom: 8 }]} accessibilityLiveRegion="polite"><Text style={secStyles.successText}>{countrySuccess}</Text></View>}

        {isEditingName && (
          <View style={aStyles.inlineForm}>
            {!!nameError && <View style={secStyles.errorBox} accessibilityRole="alert" accessibilityLiveRegion="assertive"><Text style={secStyles.errorText}>{nameError}</Text></View>}
            {!!nameSuccess && <View style={secStyles.successBox} accessibilityLiveRegion="polite"><Text style={secStyles.successText}>{nameSuccess}</Text></View>}
            <TextInput
              style={[aStyles.compactInput, { fontSize: ts.body }]}
              value={editFirstName}
              onChangeText={setEditFirstName}
              placeholder={t("settings.editName")}
              placeholderTextColor={Colors.textMuted}
              autoFocus
            />
            <View style={{ flexDirection: "row", gap: 8 }}>
              <Pressable style={[aStyles.primaryBtn, { flex: 1 }, nameLoading && { opacity: 0.6 }]} onPress={handleChangeName} disabled={nameLoading} accessibilityRole="button" accessibilityLabel={t("common.save")} accessibilityState={{ disabled: nameLoading }}>
                {nameLoading ? <ActivityIndicator size="small" color="#fff" /> : <Text style={[aStyles.primaryBtnText, { fontSize: ts.body }]}>{t("common.save")}</Text>}
              </Pressable>
              <Pressable style={aStyles.ghostBtn} onPress={() => setIsEditingName(false)} accessibilityRole="button" accessibilityLabel={t("a11y.cancelAction")}>
                <Text style={[aStyles.ghostBtnText, { fontSize: ts.body }]}>{t("common.cancel")}</Text>
              </Pressable>
            </View>
          </View>
        )}
      </View>

      <Modal visible={countryPickerVisible} transparent animationType="slide" onRequestClose={() => setCountryPickerVisible(false)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
          <View style={aStyles.countryPickerOverlay}>
            <View style={aStyles.countryPickerModal}>
              <View style={aStyles.countryPickerHeader}>
                <Text style={[aStyles.countryPickerTitle, { fontSize: ts.subtitle2 }]}>{t("settings.editCountry" as any)}</Text>
                <Pressable onPress={() => setCountryPickerVisible(false)} style={aStyles.countryPickerClose} accessibilityLabel={t("common.cancel")} accessibilityRole="button">
                  <Feather name="x" size={22} color={Colors.textSecondary} />
                </Pressable>
              </View>
              <View style={aStyles.countrySearchWrap}>
                <Feather name="search" size={16} color={Colors.textMuted} style={{ marginRight: 8 }} />
                <TextInput
                  style={[aStyles.countrySearchInput, { fontSize: ts.body }]}
                  placeholder={t("settings.countryPlaceholder" as any)}
                  placeholderTextColor={Colors.textMuted}
                  value={countrySearch}
                  onChangeText={setCountrySearch}
                  autoFocus
                />
              </View>
              <FlatList
                data={COUNTRIES.filter(c => c.toLowerCase().includes(countrySearch.toLowerCase()))}
                keyExtractor={(item) => item}
                style={{ flex: 1 }}
                keyboardShouldPersistTaps="handled"
                ListEmptyComponent={
                  <View style={{ padding: 32, alignItems: "center" }}>
                    <Feather name="search" size={24} color={Colors.textMuted} style={{ marginBottom: 8 }} />
                    <Text style={{ fontSize: ts.body, fontFamily: "Inter_400Regular", color: Colors.textMuted, textAlign: "center" }}>
                      {t("common.noResults" as any)}
                    </Text>
                  </View>
                }
                renderItem={({ item }) => {
                  const isSelected = editCountry === item;
                  return (
                    <Pressable
                      style={[aStyles.countryRow, isSelected && aStyles.countryRowSelected]}
                      onPress={async () => {
                        setEditCountry(item);
                        setCountryPickerVisible(false);
                        setCountryError("");
                        setCountrySuccess("");
                        setCountryLoading(true);
                        try {
                          await changeCountry(item);
                          setCountrySuccess(t("settings.countryUpdated" as any));
                        } catch (err: any) {
                          setCountryError(err.message || "Failed to change country");
                        } finally {
                          setCountryLoading(false);
                        }
                      }}
                      accessibilityRole="button"
                      accessibilityState={{ selected: isSelected }}
                    >
                      <Text style={[aStyles.countryRowText, { fontSize: ts.body }, isSelected && aStyles.countryRowTextSelected]}>{item}</Text>
                      {isSelected && <Feather name="check" size={18} color={Colors.primary} />}
                    </Pressable>
                  );
                }}
              />
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={jobTypePickerVisible} transparent animationType="slide" onRequestClose={() => setJobTypePickerVisible(false)}>
        <View style={aStyles.countryPickerOverlay}>
          <View style={aStyles.countryPickerModal}>
            <View style={aStyles.countryPickerHeader}>
              <Text style={[aStyles.countryPickerTitle, { fontSize: ts.subtitle2 }]}>{t("settings.editJobType" as any)}</Text>
              <Pressable onPress={() => setJobTypePickerVisible(false)} style={aStyles.countryPickerClose} accessibilityLabel={t("common.cancel")} accessibilityRole="button">
                <Feather name="x" size={22} color={Colors.textSecondary} />
              </Pressable>
            </View>
            <FlatList
              data={JOB_TYPES}
              keyExtractor={(item) => item}
              style={{ flex: 1 }}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item }) => {
                const isSelected = user.jobType === item;
                const label = t(`industry.${item}` as any) === `industry.${item}` ? item : t(`industry.${item}` as any);
                return (
                  <Pressable
                    style={[aStyles.countryRow, isSelected && aStyles.countryRowSelected]}
                    onPress={async () => {
                      setJobTypePickerVisible(false);
                      setJobTypeError("");
                      setJobTypeSuccess("");
                      setJobTypeLoading(true);
                      try {
                        await changeJobType(item);
                        setJobTypeSuccess(t("settings.jobTypeUpdated" as any));
                      } catch (err: any) {
                        setJobTypeError(err.message || "Failed to change job type");
                      } finally {
                        setJobTypeLoading(false);
                      }
                    }}
                    accessibilityRole="button"
                    accessibilityState={{ selected: isSelected }}
                  >
                    <Text style={[aStyles.countryRowText, { fontSize: ts.body }, isSelected && aStyles.countryRowTextSelected]}>{label}</Text>
                    {isSelected && <Feather name="check" size={18} color={Colors.primary} />}
                  </Pressable>
                );
              }}
            />
          </View>
        </View>
      </Modal>

      <Modal visible={avatarPickerVisible} transparent animationType="slide" onRequestClose={() => setAvatarPickerVisible(false)}>
        <View style={aStyles.countryPickerOverlay}>
          <View style={[aStyles.countryPickerModal, { maxHeight: "85%" }]}>
            <View style={aStyles.countryPickerHeader}>
              <Text style={[aStyles.countryPickerTitle, { fontSize: ts.subtitle2 }]}>{t("avatars.choose" as any)}</Text>
              <Pressable onPress={() => setAvatarPickerVisible(false)} style={aStyles.countryPickerClose} accessibilityLabel="Close" accessibilityRole="button">
                <Feather name="x" size={22} color={Colors.textSecondary} />
              </Pressable>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={aStyles.avatarPackTabs} contentContainerStyle={{ paddingHorizontal: 12, gap: 6 }}>
              {AVATAR_PACKS.map((pack) => {
                const previewSvg = getPackPreviewSvg(pack.key);
                const locked = pack.proOnly === true && !hasProAvatarAccess;
                return (
                  <Pressable
                    key={pack.key}
                    style={[aStyles.avatarPackTab, avatarPack === pack.key && aStyles.avatarPackTabActive]}
                    onPress={() => {
                      setAvatarError("");
                      setAvatarPack(pack.key);
                    }}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: avatarPack === pack.key }}
                    accessibilityLabel={`${pack.label}${pack.proOnly ? ", Pro" : ""}`}
                  >
                    <View style={aStyles.avatarPackTabIcon}>
                      {previewSvg ? <SvgXml xml={previewSvg} width={20} height={20} /> : null}
                    </View>
                    <Text style={[aStyles.avatarPackTabText, { fontSize: ts.caption - 2 }, avatarPack === pack.key && aStyles.avatarPackTabTextActive]}>{pack.label}</Text>
                    {locked ? <Feather name="lock" size={10} color={Colors.textMuted} /> : null}
                  </Pressable>
                );
              })}
            </ScrollView>
            {selectedAvatarPack?.proOnly ? (
              <View style={aStyles.avatarProStrip}>
                <Feather name={selectedPackLocked ? "lock" : "zap"} size={14} color={Colors.primary} />
                <Text style={[aStyles.avatarProText, { fontSize: ts.caption }]}>{t("avatars.animatedPro" as any)}</Text>
                {selectedPackLocked ? (
                  <Pressable
                    style={aStyles.avatarProButton}
                    onPress={() => setAvatarPickerVisible(false)}
                    accessibilityRole="button"
                    accessibilityLabel={t("avatars.getPro" as any)}
                  >
                    <Text style={[aStyles.avatarProButtonText, { fontSize: ts.caption }]}>{t("avatars.getPro" as any)}</Text>
                  </Pressable>
                ) : null}
              </View>
            ) : null}
            {avatarError ? (
              <Text style={[aStyles.avatarError, { fontSize: ts.caption }]} accessibilityRole="alert">
                {avatarError}
              </Text>
            ) : null}
            {user.avatarId ? (
              <Pressable
                style={aStyles.avatarRemoveBtn}
                onPress={async () => {
                  setAvatarLoading(true);
                  setAvatarError("");
                  try {
                    await changeAvatar("");
                    setAvatarPickerVisible(false);
                  } catch {
                    setAvatarError(t("avatars.updateError" as any));
                  }
                  setAvatarLoading(false);
                }}
                accessibilityRole="button"
              >
                <Feather name="x-circle" size={14} color={Colors.textSecondary} />
                <Text style={[aStyles.avatarRemoveText, { fontSize: ts.caption }]}>{t("avatars.useInitial" as any)}</Text>
              </Pressable>
            ) : null}
            <FlatList
              data={getAvatarsForPack(avatarPack)}
              numColumns={5}
              key={avatarPack}
              keyExtractor={(item) => item.id}
              contentContainerStyle={{ padding: 12 }}
              columnWrapperStyle={{ justifyContent: "center", gap: 8, marginBottom: 8 }}
              renderItem={({ item }: { item: AvatarEntry }) => {
                const isSelected = user.avatarId === item.id;
                const svg = getAvatarSvg(item.id, { animate: false });
                const locked = selectedPackLocked;
                return (
                  <Pressable
                    style={[aStyles.avatarGridItem, isSelected && aStyles.avatarGridItemSelected, locked && aStyles.avatarGridItemLocked]}
                    onPress={async () => {
                      if (avatarLoading) return;
                      if (locked) {
                        setAvatarPickerVisible(false);
                        return;
                      }
                      setAvatarLoading(true);
                      setAvatarError("");
                      try {
                        await changeAvatar(item.id);
                        setAvatarPickerVisible(false);
                      } catch (error: any) {
                        setAvatarError(error?.message || t("avatars.updateError" as any));
                      }
                      setAvatarLoading(false);
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={`${item.label}${locked ? `, ${t("avatars.proRequired" as any)}` : ""}`}
                    accessibilityState={{ selected: isSelected }}
                  >
                    {svg ? <SvgXml xml={svg} width={48} height={48} /> : null}
                    {locked ? (
                      <View style={aStyles.avatarLockBadge}>
                        <Feather name="lock" size={12} color="#fff" />
                      </View>
                    ) : null}
                    {isSelected && (
                      <View style={aStyles.avatarCheckBadge}>
                        <Feather name="check" size={10} color="#fff" />
                      </View>
                    )}
                  </Pressable>
                );
              }}
            />
          </View>
        </View>
      </Modal>

      <View style={aStyles.section}>
        <Pressable style={aStyles.menuRow} onPress={() => { setShowEmailForm(!showEmailForm); setError(""); setSuccess(""); }} accessibilityRole="button">
          <Feather name="mail" size={18} color={Colors.textSecondary} />
          <View style={{ flex: 1 }}>
            <Text style={aStyles.menuLabel}>{t("settings.changeEmail")}</Text>
          </View>
          <Feather name={showEmailForm ? "chevron-up" : "chevron-down"} size={16} color={Colors.textMuted} />
        </Pressable>
        {showEmailForm && (
          <View style={aStyles.inlineForm}>
            {!!error && <View style={secStyles.errorBox} accessibilityRole="alert" accessibilityLiveRegion="assertive"><Text style={secStyles.errorText}>{error}</Text></View>}
            {!!success && <View style={secStyles.successBox} accessibilityLiveRegion="polite"><Text style={secStyles.successText}>{success}</Text></View>}
            <TextInput
              style={aStyles.compactInput}
              placeholder={t("settings.newEmail") || "New email address"}
              placeholderTextColor={Colors.textMuted}
              value={newEmail}
              onChangeText={setNewEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoComplete="email"
              accessibilityLabel={t("settings.newEmail") || "New email address"}
            />
            <TextInput
              style={aStyles.compactInput}
              placeholder={t("settings.currentPassword") || "Current password"}
              placeholderTextColor={Colors.textMuted}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoComplete="current-password"
              accessibilityLabel={t("settings.currentPassword") || "Current password"}
            />
            <Pressable style={[aStyles.primaryBtn, loading && { opacity: 0.6 }]} onPress={handleChangeEmail} disabled={loading} accessibilityRole="button" accessibilityLabel={t("settings.updateEmail")} accessibilityState={{ disabled: loading }}>
              {loading ? <ActivityIndicator size="small" color="#fff" /> : <Text style={aStyles.primaryBtnText}>{t("settings.updateEmail")}</Text>}
            </Pressable>
          </View>
        )}

        <View style={aStyles.menuDivider} />

        <Pressable style={aStyles.menuRow} onPress={() => { setShowPwForm(!showPwForm); setPwError(""); setPwSuccess(""); setGeneratedPw(""); setPwCopied(false); }} accessibilityRole="button">
          <Feather name="lock" size={18} color={Colors.textSecondary} />
          <View style={{ flex: 1 }}>
            <Text style={aStyles.menuLabel}>{t("settings.changePassword")}</Text>
          </View>
          <Feather name={showPwForm ? "chevron-up" : "chevron-down"} size={16} color={Colors.textMuted} />
        </Pressable>
        {showPwForm && (
          <View style={aStyles.inlineForm}>
            {!!pwError && <View style={secStyles.errorBox} accessibilityRole="alert" accessibilityLiveRegion="assertive"><Text style={secStyles.errorText}>{pwError}</Text></View>}
            {!!pwSuccess && <View style={secStyles.successBox} accessibilityLiveRegion="polite"><Text style={secStyles.successText}>{pwSuccess}</Text></View>}
            <View style={{ flexDirection: "row", alignItems: "center", backgroundColor: Colors.surfaceLight, borderRadius: 12, overflow: "hidden", marginBottom: 8 }}>
              <TextInput
                style={[aStyles.compactInput, { flex: 1, marginBottom: 0 }]}
                placeholder={t("settings.currentPassword") || "Current password"}
                placeholderTextColor={Colors.textMuted}
                value={currentPw}
                onChangeText={setCurrentPw}
                secureTextEntry={!showCurrentPw}
                autoComplete="current-password"
                accessibilityLabel={t("settings.currentPassword") || "Current password"}
              />
              <Pressable onPress={() => setShowCurrentPw(!showCurrentPw)} style={{ paddingVertical: 14, paddingLeft: 8, paddingRight: 12 }} accessibilityRole="button">
                <Feather name={showCurrentPw ? "eye-off" : "eye"} size={18} color={Colors.textMuted} />
              </Pressable>
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", backgroundColor: Colors.surfaceLight, borderRadius: 12, overflow: "hidden", marginBottom: 4 }}>
              <TextInput
                style={[aStyles.compactInput, { flex: 1, marginBottom: 0 }]}
                placeholder={t("settings.newPassword") || "New password"}
                placeholderTextColor={Colors.textMuted}
                value={newPw}
                onChangeText={setNewPw}
                secureTextEntry={!showNewPw}
                autoComplete="new-password"
                accessibilityLabel={t("settings.newPassword") || "New password"}
              />
              <Pressable onPress={() => setShowNewPw(!showNewPw)} style={{ paddingVertical: 14, paddingLeft: 8, paddingRight: 12 }} accessibilityRole="button">
                <Feather name={showNewPw ? "eye-off" : "eye"} size={18} color={Colors.textMuted} />
              </Pressable>
            </View>
            <Text style={{ fontSize: sf(12, ts), fontFamily: "Inter_400Regular", color: Colors.textMuted, marginBottom: 4, paddingHorizontal: 2 }}>{isAdmin ? t("login.adminPasswordRequirements") : t("login.passwordRequirements")}</Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 8 }}>
              <Pressable style={{ flexDirection: "row", alignItems: "center", gap: 4 }} onPress={handleGeneratePassword} accessibilityRole="button" accessibilityLabel={t("login.generatePassword")}>
                <Feather name="zap" size={14} color={Colors.primary} />
                <Text style={{ fontSize: sf(13, ts), fontFamily: "Inter_500Medium", color: Colors.primary }}>{t("login.generatePassword")}</Text>
              </Pressable>
              {!!generatedPw && (
                <Pressable style={{ flexDirection: "row", alignItems: "center", gap: 4 }} onPress={handleCopyGeneratedPw} accessibilityRole="button" accessibilityLabel={t("login.copyPassword")}>
                  <Feather name={pwCopied ? "check" : "copy"} size={14} color={pwCopied ? Colors.success : Colors.primary} />
                  <Text style={{ fontSize: sf(13, ts), fontFamily: "Inter_500Medium", color: pwCopied ? Colors.success : Colors.primary }}>{pwCopied ? t("login.passwordCopied") : t("login.copyPassword")}</Text>
                </Pressable>
              )}
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", backgroundColor: Colors.surfaceLight, borderRadius: 12, overflow: "hidden", marginBottom: 8 }}>
              <TextInput
                style={[aStyles.compactInput, { flex: 1, marginBottom: 0 }]}
                placeholder={t("settings.confirmPassword") || "Confirm new password"}
                placeholderTextColor={Colors.textMuted}
                value={confirmPw}
                onChangeText={setConfirmPw}
                secureTextEntry={!showConfirmPw}
                autoComplete="new-password"
                accessibilityLabel={t("settings.confirmPassword") || "Confirm new password"}
              />
              <Pressable onPress={() => setShowConfirmPw(!showConfirmPw)} style={{ paddingVertical: 14, paddingLeft: 8, paddingRight: 12 }} accessibilityRole="button">
                <Feather name={showConfirmPw ? "eye-off" : "eye"} size={18} color={Colors.textMuted} />
              </Pressable>
            </View>
            <Pressable style={[aStyles.primaryBtn, pwLoading && { opacity: 0.6 }]} onPress={handleChangePassword} disabled={pwLoading} accessibilityRole="button" accessibilityLabel={t("settings.updatePassword")} accessibilityState={{ disabled: pwLoading }}>
              {pwLoading ? <ActivityIndicator size="small" color="#fff" /> : <Text style={aStyles.primaryBtnText}>{t("settings.updatePassword")}</Text>}
            </Pressable>
          </View>
        )}
      </View>


      <View style={aStyles.section}>
        <Pressable
          style={aStyles.menuRow}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            Linking.openURL("https://proset.ai/documentation");
          }}
          accessibilityRole="button"
          accessibilityLabel={t("a11y.documentation")}
          testID="account-docs-link"
        >
          <Feather name="book-open" size={18} color={Colors.textSecondary} />
          <View style={{ flex: 1 }}>
            <Text style={aStyles.menuLabel}>{t("a11y.documentation")}</Text>
          </View>
          <Feather name="chevron-right" size={16} color={Colors.textMuted} />
        </Pressable>
      </View>

      <View style={aStyles.section}>
        <Text style={aStyles.sectionTitle}>{t("settings.yourData")}</Text>
        <Pressable
          style={aStyles.menuRow}
          onPress={handleExportData}
          disabled={exportLoading}
          accessibilityRole="button"
          accessibilityLabel={t("settings.exportData")}
          accessibilityHint={t("settings.exportDataHint")}
        >
          <Feather name="download" size={18} color={Colors.primary} />
          <View style={{ flex: 1 }}>
            <Text style={aStyles.menuLabel}>{t("settings.exportData")}</Text>
            <Text style={aStyles.menuHint}>{t("settings.exportDataHint")}</Text>
          </View>
          {exportLoading ? <ActivityIndicator size="small" color={Colors.primary} /> : <Feather name="chevron-right" size={16} color={Colors.textMuted} />}
        </Pressable>
        <View style={aStyles.menuDivider} />
        <Pressable
          style={aStyles.menuRow}
          onPress={() => { setShowDeleteAccount(!showDeleteAccount); setDeleteError(""); setDeletePassword(""); }}
          accessibilityRole="button"
          accessibilityLabel={t("settings.deleteAccount")}
        >
          <Feather name="trash-2" size={18} color={Colors.error} />
          <View style={{ flex: 1 }}>
            <Text style={[aStyles.menuLabel, { color: Colors.error }]}>{t("settings.deleteAccount")}</Text>
            <Text style={aStyles.menuHint}>{t("settings.deleteAccountHint")}</Text>
          </View>
          <Feather name={showDeleteAccount ? "chevron-up" : "chevron-down"} size={16} color={Colors.textMuted} />
        </Pressable>
        {showDeleteAccount && (
          <View style={aStyles.inlineForm}>
            <Text style={{ color: Colors.textSecondary, fontSize: sf(13, ts), lineHeight: 18, marginBottom: 8 }}>{t("settings.deleteAccountConfirm")}</Text>

            {!!deleteError && <View style={secStyles.errorBox} accessibilityRole="alert"><Text style={secStyles.errorText}>{deleteError}</Text></View>}
            <TextInput
              style={[aStyles.compactInput]}
              placeholder={t("login.password")}
              placeholderTextColor={Colors.textSecondary}
              value={deletePassword}
              onChangeText={setDeletePassword}
              secureTextEntry
              accessibilityLabel={t("settings.passwordToDeleteAccount")}
            />
            <Pressable
              style={[{ backgroundColor: Colors.error, borderRadius: 8, padding: 12, alignItems: "center" }, deleteLoading && { opacity: 0.6 }]}
              onPress={handleDeleteAccount}
              disabled={deleteLoading}
              accessibilityRole="button"
              accessibilityLabel={t("settings.deleteAccount")}
            >
              {deleteLoading ? <ActivityIndicator size="small" color="#fff" /> : <Text style={{ color: "#fff", fontFamily: "Inter_600SemiBold", fontSize: sf(14, ts) }}>{t("settings.deleteAccount")}</Text>}
            </Pressable>
          </View>
        )}
      </View>

      <Pressable
        style={({ pressed }) => [acctStyles.signOutBtn, pressed && { opacity: 0.8 }]}
        onPress={() => {
          if (Platform.OS === "web") {
            if (confirm(t("settings.signOutConfirm"))) {
              logout();
            }
          } else {
            Alert.alert(t("settings.signOut"), t("settings.signOutConfirm"), [
              { text: t("common.cancel"), style: "cancel" },
              { text: t("settings.signOut"), style: "destructive", onPress: () => logout() },
            ]);
          }
        }}
        accessibilityRole="button"
        accessibilityLabel={t("settings.signOut")}
        accessibilityHint={t("a11y.signsYouOut")}
      >
        <Feather name="log-out" size={18} color={Colors.error} />
        <Text style={acctStyles.signOutText}>{t("settings.signOut")}</Text>
      </Pressable>
    </ScrollView>
  );
}

const makeSegmentStyles = (ts: TextScale) => StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 14,
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
  segmentWrap: {
    paddingBottom: 8,
  },
  segmentRow: {
    flexDirection: "row",
    backgroundColor: Colors.surface,
    borderRadius: 12,
    borderWidth: 0,
    padding: 3,
  },
  segmentBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  segmentBtnActive: {
    backgroundColor: "rgba(0, 180, 216, 0.15)",
  },
  segmentText: {
    fontSize: sf(13, ts),
    fontFamily: "Inter_500Medium",
    color: Colors.textMuted,
  },
  segmentTextActive: {
    color: Colors.primary,
    fontFamily: "Inter_600SemiBold",
  },
});


const makeSubStyles = (ts: TextScale) => StyleSheet.create({
  usageCard: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    borderWidth: 0,
    padding: 18,
    marginBottom: 20,
  },
  usageHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 16,
  },
  usageTitle: {
    fontSize: sf(16, ts),
    fontFamily: "Inter_600SemiBold",
    color: Colors.text,
  },
  usageRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 6,
  },
  usageLabel: {
    fontSize: sf(14, ts),
    fontFamily: "Inter_400Regular",
    color: Colors.textSecondary,
  },
  usageValue: {
    fontSize: sf(14, ts),
    fontFamily: "Inter_600SemiBold",
    color: Colors.text,
  },
  progressBar: {
    height: 6,
    backgroundColor: "rgba(255,255,255,0.08)",
    borderRadius: 3,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    backgroundColor: Colors.primary,
    borderRadius: 3,
  },
  manageBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: Colors.surface,
    borderRadius: 12,
    borderWidth: 0,
    paddingVertical: 14,
    marginBottom: 16,
  },
  manageBtnText: {
    fontSize: sf(15, ts),
    fontFamily: "Inter_600SemiBold",
    color: Colors.primary,
  },
  plansContainer: {
    gap: 12,
  },
  planCard: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    borderWidth: 0,
    padding: 18,
  },
  planCardCurrent: {
    borderColor: Colors.primary,
    borderWidth: 2,
  },
  currentBadge: {
    alignSelf: "flex-start",
    backgroundColor: "rgba(0, 180, 216, 0.15)",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
    marginBottom: 8,
  },
  currentBadgeText: {
    fontSize: sf(12, ts),
    fontFamily: "Inter_600SemiBold",
    color: Colors.primary,
  },
  planName: {
    fontSize: sf(20, ts),
    fontFamily: "Inter_700Bold",
    color: Colors.text,
    marginBottom: 4,
  },
  priceRow: {
    flexDirection: "row",
    alignItems: "baseline",
    marginBottom: 16,
  },
  priceAmount: {
    fontSize: sf(28, ts),
    fontFamily: "Inter_700Bold",
    color: Colors.text,
  },
  priceInterval: {
    fontSize: sf(14, ts),
    fontFamily: "Inter_400Regular",
    color: Colors.textSecondary,
    marginLeft: 4,
  },
  featuresList: {
    gap: 10,
    marginBottom: 16,
  },
  featureRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  featureText: {
    fontSize: sf(14, ts),
    fontFamily: "Inter_400Regular",
    color: Colors.textSecondary,
    flex: 1,
  },
  upgradeBtn: {
    backgroundColor: Colors.primaryButton,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  upgradeBtnText: {
    fontSize: sf(15, ts),
    fontFamily: "Inter_600SemiBold",
    color: "#fff",
  },
});

const makeAcctStyles = (ts: TextScale) => StyleSheet.create({
  signOutBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.error,
    marginTop: 12,
    marginBottom: 8,
    minHeight: 44,
  },
  signOutText: {
    color: Colors.error,
    fontSize: sf(15, ts),
    fontWeight: "600",
  },
});

const makeAStyles = (ts: TextScale) => StyleSheet.create({
  section: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    borderWidth: 0,
    marginBottom: 16,
    overflow: "hidden",
  },
  profileHeader: {
    flexDirection: "row",
    alignItems: "center",
    padding: 20,
    gap: 16,
  },
  profileHeaderInfo: {
    flex: 1,
    justifyContent: "center",
  },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: "rgba(0, 180, 216, 0.15)",
    justifyContent: "center",
    alignItems: "center",
  },
  avatarText: {
    fontFamily: "Inter_700Bold",
    color: Colors.primary,
  },
  avatarEditBadge: {
    position: "absolute",
    bottom: 0,
    right: 0,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: Colors.primaryButton,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 2,
    borderColor: Colors.surface,
  },
  avatarGridItem: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "rgba(0, 180, 216, 0.08)",
    justifyContent: "center",
    alignItems: "center",
    overflow: "hidden",
    borderWidth: 2,
    borderColor: "transparent",
  },
  avatarGridItemSelected: {
    borderColor: Colors.primary,
    backgroundColor: "rgba(0, 180, 216, 0.18)",
  },
  avatarGridItemLocked: {
    opacity: 0.62,
  },
  avatarCheckBadge: {
    position: "absolute",
    bottom: 0,
    right: 0,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: Colors.primaryButton,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 2,
    borderColor: Colors.surface,
  },
  avatarLockBadge: {
    position: "absolute",
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: "rgba(4, 18, 31, 0.82)",
    justifyContent: "center",
    alignItems: "center",
  },
  avatarPackTabs: {
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    paddingVertical: 8,
  },
  avatarPackTab: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  avatarPackTabActive: {
    backgroundColor: "rgba(0, 180, 216, 0.15)",
  },
  avatarPackTabIcon: {
    width: 22,
    height: 22,
    borderRadius: 11,
    overflow: "hidden",
    justifyContent: "center",
    alignItems: "center",
  },
  avatarPackTabText: {
    fontFamily: "Inter_500Medium",
    color: Colors.textMuted,
  },
  avatarPackTabTextActive: {
    color: Colors.primary,
  },
  avatarProStrip: {
    minHeight: 40,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    paddingHorizontal: 14,
    paddingVertical: 6,
    backgroundColor: "rgba(0, 180, 216, 0.08)",
  },
  avatarProText: {
    flex: 1,
    fontFamily: "Inter_600SemiBold",
    color: Colors.primary,
  },
  avatarProButton: {
    minHeight: 30,
    justifyContent: "center",
    paddingHorizontal: 12,
    borderRadius: 15,
    backgroundColor: Colors.primaryButton,
  },
  avatarProButtonText: {
    fontFamily: "Inter_600SemiBold",
    color: "#fff",
  },
  avatarError: {
    color: Colors.error,
    textAlign: "center",
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  avatarRemoveBtn: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.06)",
    marginBottom: 8,
  },
  avatarRemoveText: {
    fontFamily: "Inter_400Regular",
    color: Colors.textSecondary,
  },
  profileName: {
    fontFamily: "Inter_700Bold",
    color: Colors.text,
    marginBottom: 2,
  },
  profileEmail: {
    fontFamily: "Inter_400Regular",
    color: Colors.textSecondary,
  },
  profileDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: Colors.border,
    marginHorizontal: 0,
  },
  profileDividerInset: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: Colors.border,
    marginLeft: 52,
    marginRight: 16,
  },
  profileFieldRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    paddingHorizontal: 20,
    gap: 12,
    minHeight: 56,
  },
  profileFieldIcon: {
    width: 20,
    alignItems: "center",
  },
  profileFieldLabel: {
    fontFamily: "Inter_400Regular",
    color: Colors.textMuted,
    marginBottom: 1,
    textTransform: "uppercase",
    letterSpacing: 0.3,
  },
  profileFieldValue: {
    fontFamily: "Inter_500Medium",
    color: Colors.text,
  },
  countryPickerOverlay: {
    flex: 1,
    backgroundColor: Colors.overlay,
    justifyContent: "flex-end",
  },
  countryPickerModal: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: "70%",
    minHeight: "50%",
    borderWidth: 0,
    overflow: "hidden",
  },
  countryPickerHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 12,
  },
  countryPickerTitle: {
    fontFamily: "Inter_700Bold",
    color: Colors.text,
  },
  countryPickerClose: {
    width: 44,
    height: 44,
    justifyContent: "center",
    alignItems: "center",
  },
  countrySearchWrap: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.surfaceLight,
    borderRadius: 10,
    paddingHorizontal: 14,
    marginHorizontal: 20,
    marginBottom: 12,
    borderWidth: 0,
  },
  countrySearchInput: {
    flex: 1,
    fontFamily: "Inter_400Regular",
    color: Colors.text,
    paddingVertical: 12,
    outlineStyle: "none" as any,
  },
  countryRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border,
    minHeight: 48,
  },
  countryRowSelected: {
    backgroundColor: "rgba(0, 180, 216, 0.08)",
  },
  countryRowText: {
    fontFamily: "Inter_400Regular",
    color: Colors.text,
  },
  countryRowTextSelected: {
    fontFamily: "Inter_600SemiBold",
    color: Colors.primary,
  },
  menuRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    paddingHorizontal: 16,
    gap: 12,
    minHeight: 48,
  },
  menuLabel: {
    fontSize: sf(15, ts),
    fontFamily: "Inter_500Medium",
    color: Colors.text,
  },
  menuHint: {
    fontSize: sf(12, ts),
    fontFamily: "Inter_400Regular",
    color: Colors.textMuted,
    marginTop: 2,
  },
  sectionTitle: {
    fontSize: sf(13, ts),
    fontFamily: "Inter_600SemiBold",
    color: Colors.textSecondary,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 4,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  menuDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: Colors.border,
    marginHorizontal: 16,
  },
  inlineForm: {
    paddingHorizontal: 16,
    paddingBottom: 14,
    gap: 8,
  },
  compactInput: {
    backgroundColor: Colors.surfaceLight,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: sf(14, ts),
    fontFamily: "Inter_400Regular",
    color: Colors.text,
    minHeight: 42,
    outlineStyle: "none" as any,
    outlineWidth: 0 as any,
  },
  primaryBtn: {
    backgroundColor: Colors.primaryButton,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 42,
  },
  primaryBtnText: {
    color: "#fff",
    fontSize: sf(14, ts),
    fontFamily: "Inter_600SemiBold",
  },
  ghostBtn: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 10,
    borderWidth: 0,
    backgroundColor: Colors.surfaceLight,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 42,
  },
  ghostBtnText: {
    fontSize: sf(14, ts),
    fontFamily: "Inter_500Medium",
    color: Colors.textSecondary,
  },
});

const makeSecStyles = (ts: TextScale) => StyleSheet.create({
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    borderWidth: 0,
    marginBottom: 16,
    overflow: "hidden",
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    padding: 18,
    gap: 14,
  },
  cardTitle: {
    fontSize: sf(17, ts),
    fontFamily: "Inter_600SemiBold",
    color: Colors.text,
  },
  cardSubtitle: {
    fontSize: sf(13, ts),
    fontFamily: "Inter_400Regular",
    color: Colors.textSecondary,
    marginTop: 2,
  },
  input: {
    backgroundColor: Colors.surfaceLight,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
    fontSize: sf(15, ts),
    fontFamily: "Inter_400Regular",
    color: Colors.text,
    outlineStyle: "none" as any,
    outlineWidth: 0 as any,
  },
  enableButton: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.primaryButton,
    paddingVertical: 14,
    borderRadius: 12,
    marginTop: 4,
    minHeight: 44,
  },
  enableButtonText: {
    fontSize: sf(15, ts),
    fontFamily: "Inter_600SemiBold",
    color: Colors.white,
  },
  cardBodyPadded: {
    paddingHorizontal: 18,
    paddingBottom: 18,
    gap: 12,
  },
  flexOne: {
    flex: 1,
  },
  errorBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "rgba(248, 113, 113, 0.1)",
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
  },
  errorText: {
    flex: 1,
    fontSize: sf(14, ts),
    fontFamily: "Inter_400Regular",
    color: Colors.error,
  },
  successBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "rgba(34, 197, 94, 0.1)",
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
  },
  successText: {
    flex: 1,
    fontSize: sf(14, ts),
    fontFamily: "Inter_400Regular",
    color: "#22c55e",
  },
});

const makeMainStyles = (ts: TextScale) => StyleSheet.create({
  list: {},
});
