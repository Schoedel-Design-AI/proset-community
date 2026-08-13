import React, { useState } from "react";
import {
  View, Text, Pressable, Modal, StyleSheet, Switch,
} from "react-native";
import Feather from "@react-native-vector-icons/feather/static";
import Colors from "@/constants/colors";
import { useLanguage } from "@/lib/i18n";

type Props = {
  visible: boolean;
  onClaim: (consent: boolean) => void;
  onClose: () => void;
};

export default function EarlyBirdModal({ visible, onClaim, onClose }: Props) {
  const { t, language } = useLanguage();
  const [consent, setConsent] = useState(false);
  const isEs = language === "es";

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <View style={styles.header}>
            <Feather name="gift" size={28} color={Colors.primary} />
            <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close">
              <Feather name="x" size={22} color={Colors.textSecondary} />
            </Pressable>
          </View>

          <Text style={styles.title}>
            {isEs ? "50% de descuento por ser miembro fundador" : "50% off as an early member"}
          </Text>
          <Text style={styles.subtitle}>
            {isEs
              ? "Tu código EARLYADOPTER se aplicará automáticamente."
              : "Your EARLYADOPTER code will be applied automatically."}
          </Text>

          <View style={styles.consentRow}>
            <Switch
              value={consent}
              onValueChange={setConsent}
              trackColor={{ false: Colors.border, true: Colors.primary }}
              thumbColor={consent ? "#FFF" : Colors.textMuted}
              accessibilityLabel={isEs ? "Permitir notificaciones" : "Allow notifications"}
            />
            <Text style={styles.consentText}>
              {isEs
                ? "Quiero recibir consejos, actualizaciones y ofertas por correo y SMS."
                : "Send me tips, updates, and offers via email & text."}
            </Text>
          </View>

          <Pressable
            style={[styles.btn, !consent && { opacity: 0.6 }]}
            onPress={() => onClaim(consent)}
            accessibilityRole="button"
            accessibilityLabel={isEs ? "Obtener 50% de descuento" : "Get 50% off"}
          >
            <Text style={styles.btnText}>
              {isEs ? "Obtener 50% de descuento" : "Get 50% off"}
            </Text>
          </Pressable>

          <Text style={styles.note}>
            {isEs
              ? "El código se aplica al finalizar. Sin spam."
              : "Code applied at checkout. No spam."}
          </Text>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.7)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 20,
    padding: 28,
    width: "100%",
    maxWidth: 400,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 20,
  },
  title: {
    fontSize: 22,
    fontFamily: "Inter_700Bold",
    color: Colors.text,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    color: Colors.textSecondary,
    marginBottom: 24,
    lineHeight: 20,
  },
  consentRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 24,
  },
  consentText: {
    flex: 1,
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    color: Colors.textSecondary,
    lineHeight: 18,
  },
  btn: {
    backgroundColor: Colors.primary,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
    marginBottom: 10,
  },
  btnText: {
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
    color: "#FFF",
  },
  note: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    color: Colors.textMuted,
    textAlign: "center",
  },
});
