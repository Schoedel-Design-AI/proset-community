import React from "react";
import { View, Pressable, Text, StyleSheet } from "react-native";
import { router } from "@/lib/navigation";
import Feather from "@react-native-vector-icons/feather/static";
import Colors from "@/constants/colors";
import { useAuth } from "@/lib/auth-context";
import { useLanguage } from "@/lib/i18n";
import { useSafeAreaInsets } from "react-native-safe-area-context";

type Props = {
  visible: boolean;
  onClose: () => void;
};

export default function ProfileDropdown({ visible, onClose }: Props) {
  const { logout } = useAuth();
  const { t } = useLanguage();
  const insets = useSafeAreaInsets();

  if (!visible) return null;

  const navigate = (route: string) => {
    onClose();
    router.push(route as any);
  };

  return (
    <View style={[styles.menu, { top: insets.top + 92 }]}>
      <Pressable
        style={styles.item}
        onPress={() => navigate("/settings")}
        accessibilityLabel={t("a11y.settings")}
        accessibilityRole="button"
      >
        <Feather name="settings" size={16} color={Colors.textSecondary} />
        <Text style={styles.itemText}>{t("a11y.settings")}</Text>
      </Pressable>
      <Pressable
        style={styles.item}
        onPress={() => navigate("/recordings")}
        accessibilityLabel={t("app.recordings")}
        accessibilityRole="button"
        testID="dropdown-recordings"
      >
        <Feather name="list" size={16} color={Colors.textSecondary} />
        <Text style={styles.itemText}>{t("app.recordings")}</Text>
      </Pressable>
      <Pressable
        style={styles.item}
        onPress={() => {
          onClose();
          logout();
        }}
        accessibilityLabel={t("settings.signOut")}
        accessibilityRole="button"
        testID="sign-out-button"
      >
        <Feather name="log-out" size={16} color={Colors.warning || "#F59E0B"} />
        <Text style={[styles.itemText, { color: Colors.warning || "#F59E0B" }]}>{t("settings.signOut")}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  menu: {
    position: "absolute",
    right: 14,
    backgroundColor: Colors.surface,
    borderRadius: 12,
    paddingVertical: 6,
    minWidth: 180,
    zIndex: 9999,
    borderWidth: 1,
    borderColor: Colors.border,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  item: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  itemText: {
    fontSize: 15,
    color: Colors.text,
    fontFamily: "Inter_500Medium",
  },
});
