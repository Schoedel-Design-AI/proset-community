import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Linking, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import Colors from "@/constants/colors";
import { useLanguage } from "@/lib/i18n";
import { useLocalSearchParams, router } from "@/lib/navigation";
import { apiRequest } from "@/lib/query-client";

type LinkResult = "success" | "invalid_state" | "identity_mismatch" | "discord_in_use" | "user_has_other" | "oauth_failed";

export default function DiscordLinkScreen() {
  const { language } = useLanguage();
  const params = useLocalSearchParams<{ state?: string; result?: LinkResult; lang?: string }>();
  const spanish = params.lang === "es" || language === "es";
  const [error, setError] = useState<string | null>(null);
  const [linked, setLinked] = useState<boolean | null>(null);
  const [unlinking, setUnlinking] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    if (params.result || !params.state || started.current) return;
    started.current = true;
    apiRequest("POST", "/api/discord/oauth/start", { state: params.state })
      .then((response) => response.json())
      .then(({ authorizeUrl }) => {
        if (typeof authorizeUrl !== "string") throw new Error("Missing authorization URL");
        if (Platform.OS === "web" && typeof window !== "undefined") window.location.assign(authorizeUrl);
        else return Linking.openURL(authorizeUrl);
      })
      .catch(() => setError(spanish
        ? "Este enlace venció o ya se usó. Vuelve a Discord y ejecuta /proset link."
        : "This link expired or was already used. Return to Discord and run /proset link."));
  }, [params.result, params.state, spanish]);

  useEffect(() => {
    if (params.state || params.result) return;
    apiRequest("GET", "/api/discord/link/status")
      .then((response) => response.json())
      .then((data) => setLinked(Boolean(data.linked)))
      .catch(() => setError(spanish ? "No se pudo cargar el estado de Discord." : "Couldn’t load Discord status."));
  }, [params.result, params.state, spanish]);

  const unlink = async () => {
    setUnlinking(true);
    setError(null);
    try {
      await apiRequest("DELETE", "/api/discord/link");
      setLinked(false);
    } catch {
      setError(spanish ? "No se pudo desvincular Discord." : "Couldn’t unlink Discord.");
    } finally {
      setUnlinking(false);
    }
  };

  const resultText: Record<LinkResult, { title: string; detail: string }> = spanish ? {
    success: { title: "Discord está vinculado", detail: "Ya puedes volver a Discord y ejecutar /proset record." },
    invalid_state: { title: "El enlace venció", detail: "Vuelve a Discord y ejecuta /proset link para crear uno nuevo." },
    identity_mismatch: { title: "La cuenta no coincide", detail: "Inicia sesión en Discord con la misma cuenta que ejecutó el comando." },
    discord_in_use: { title: "Discord ya está vinculado", detail: "Esta cuenta de Discord está vinculada con otra cuenta de Proset." },
    user_has_other: { title: "Proset ya está vinculado", detail: "Desvincula primero la cuenta de Discord anterior." },
    oauth_failed: { title: "No se pudo vincular", detail: "Vuelve a Discord e inténtalo de nuevo." },
  } : {
    success: { title: "Discord is linked", detail: "You can return to Discord and run /proset record." },
    invalid_state: { title: "The link expired", detail: "Return to Discord and run /proset link to create a new one." },
    identity_mismatch: { title: "The account did not match", detail: "Sign in to Discord with the same account that ran the command." },
    discord_in_use: { title: "Discord is already linked", detail: "This Discord account is linked to another Proset account." },
    user_has_other: { title: "Proset is already linked", detail: "Unlink the previous Discord account first." },
    oauth_failed: { title: "Linking failed", detail: "Return to Discord and try again." },
  };
  const result = params.result ? resultText[params.result] : null;

  return (
    <View style={styles.page}>
      <View style={styles.card}>
        <Text style={styles.brand}>Proset AI + Discord</Text>
        {!params.state && !params.result && linked !== null ? (
          <>
            <Text style={styles.title}>{linked
              ? (spanish ? "Discord está vinculado" : "Discord is linked")
              : (spanish ? "Discord no está vinculado" : "Discord is not linked")}</Text>
            <Text style={styles.detail}>{linked
              ? (spanish ? "Puedes capturar mensajes de voz desde Discord." : "You can capture voice messages from Discord.")
              : (spanish ? "Ejecuta /proset link en Discord para vincular esta cuenta de forma segura." : "Run /proset link in Discord to securely link this account.")}</Text>
            {linked ? (
              <Pressable style={[styles.button, styles.secondaryButton]} onPress={unlink} disabled={unlinking}>
                {unlinking ? <ActivityIndicator color={Colors.text} /> : <Text style={[styles.buttonText, styles.secondaryButtonText]}>{spanish ? "Desvincular Discord" : "Unlink Discord"}</Text>}
              </Pressable>
            ) : null}
          </>
        ) : !result && !error ? (
          <>
            <ActivityIndicator color={Colors.primary} size="large" />
            <Text style={styles.title}>{spanish ? "Conectando tu cuenta…" : "Connecting your account…"}</Text>
            <Text style={styles.detail}>{spanish ? "Te enviaremos a Discord para confirmar tu identidad." : "We’ll send you to Discord to confirm your identity."}</Text>
          </>
        ) : (
          <>
            <Text style={styles.title}>{result?.title || (spanish ? "No se pudo vincular" : "Couldn’t link Discord")}</Text>
            <Text style={styles.detail}>{result?.detail || error}</Text>
            <Pressable style={styles.button} onPress={() => router.replace("/")}>
              <Text style={styles.buttonText}>{spanish ? "Abrir Proset" : "Open Proset"}</Text>
            </Pressable>
          </>
        )}
        <Text style={styles.privacy}>{spanish
          ? "Proset solo guarda mensajes de voz que tú eliges. Un resultado nunca se publica sin una confirmación adicional."
          : "Proset saves only voice messages you choose. A result is never posted publicly without a separate confirmation."}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, minHeight: 520, backgroundColor: Colors.background, alignItems: "center", justifyContent: "center", padding: 24 },
  card: { width: "100%", maxWidth: 520, backgroundColor: Colors.surface, borderRadius: 20, borderWidth: 1, borderColor: Colors.border, padding: 32, alignItems: "center", gap: 16 },
  brand: { color: Colors.primary, fontSize: 16, fontWeight: "700" },
  title: { color: Colors.text, fontSize: 26, lineHeight: 34, fontWeight: "700", textAlign: "center" },
  detail: { color: Colors.textSecondary, fontSize: 16, lineHeight: 24, textAlign: "center" },
  button: { marginTop: 8, backgroundColor: Colors.primary, borderRadius: 10, paddingHorizontal: 22, paddingVertical: 13 },
  buttonText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  secondaryButton: { backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border },
  secondaryButtonText: { color: Colors.text },
  privacy: { marginTop: 8, color: Colors.textSecondary, fontSize: 13, lineHeight: 19, textAlign: "center" },
});
