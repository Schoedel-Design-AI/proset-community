import type { DiscordConversionType } from "./config";
import type { DiscordLocale } from "@shared/schema";

const labels: Record<DiscordConversionType, Record<DiscordLocale, string>> = {
  summary: { en: "Summary", es: "Resumen" },
  bullet_points: { en: "Bullet points", es: "Puntos clave" },
  notes: { en: "Notes", es: "Notas" },
  email: { en: "Email", es: "Correo electrónico" },
  todo_list: { en: "To-do list", es: "Lista de tareas" },
  outline: { en: "Outline", es: "Esquema" },
  text_message: { en: "Text message", es: "Mensaje de texto" },
};

export function discordConversionLabel(type: DiscordConversionType, locale: DiscordLocale): string {
  return labels[type][locale];
}

export function discordText(locale: DiscordLocale) {
  if (locale === "es") {
    return {
      recordDescription: "Guarda tu próximo mensaje de voz en Proset",
      languageDescription: "Idioma de la transcripción y del resultado",
      conversionDescription: "Conversión opcional después de transcribir",
      noConversion: "Solo guardar (sin transcribir)",
      armed: "Listo. Envía tu próximo mensaje de voz en este canal durante los próximos 5 minutos. Lo guardaré primero; la transcripción es opcional.",
      linked: "Tu cuenta de Discord ya está vinculada con Proset.",
      linkRequired: "Vincula tu cuenta de Proset para guardar este mensaje de voz.",
      openLink: "Vincular Proset",
      received: "Grabación recibida. La estoy guardando de forma privada en Proset…",
      saved: "Tu grabación se guardó en Proset.",
      converted: "Tu grabación se guardó, transcribió y convirtió en Proset.",
      publish: "Publicar en este hilo",
      openRecording: "Abrir en Proset",
      publishConfirm: "Publicar este resultado en el canal o hilo actual? Será visible para las personas que tengan acceso aquí.",
      confirmPublish: "Sí, publicar",
      cancel: "Cancelar",
      cancelled: "No se publicó nada.",
      published: "Resultado publicado.",
      publishDisabled: "La publicación pública de Proset no está habilitada en este servidor o canal.",
      expired: "La sesión de grabación venció. Ejecuta /proset record y vuelve a intentarlo.",
      voiceOnly: "Elige uno de tus propios mensajes de voz nativos de Discord o ejecuta /proset record primero.",
      failed: "No pude procesar la grabación. La grabación original no se publicó.",
      tooLarge: "Ese mensaje de voz supera el límite de 25 MB de Discord para Proset.",
      unlinked: "Tu cuenta de Discord ya no está vinculada con Proset.",
    } as const;
  }
  return {
    recordDescription: "Save your next voice message to Proset",
    languageDescription: "Language for transcription and output",
    conversionDescription: "Optional conversion after transcription",
    noConversion: "Save only (do not transcribe)",
    armed: "Ready. Send your next voice message in this channel within 5 minutes. I’ll save it first; transcription is optional.",
    linked: "Your Discord account is already linked to Proset.",
    linkRequired: "Link your Proset account to save this voice message.",
    openLink: "Link Proset",
    received: "Recording received. I’m saving it privately in Proset…",
    saved: "Your recording was saved in Proset.",
    converted: "Your recording was saved, transcribed, and converted in Proset.",
    publish: "Publish in this thread",
    openRecording: "Open in Proset",
    publishConfirm: "Publish this result in the current channel or thread? Everyone with access here will be able to see it.",
    confirmPublish: "Yes, publish",
    cancel: "Cancel",
    cancelled: "Nothing was published.",
    published: "Result published.",
    publishDisabled: "Public Proset posting is not enabled for this server or channel.",
    expired: "That recording session expired. Run /proset record and try again.",
    voiceOnly: "Choose one of your own native Discord voice messages, or run /proset record first.",
    failed: "I couldn’t process that recording. The original recording was not published.",
    tooLarge: "That voice message exceeds Proset’s 25 MB Discord limit.",
    unlinked: "Your Discord account is no longer linked to Proset.",
  } as const;
}
