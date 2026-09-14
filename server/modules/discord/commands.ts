import {
  ApplicationCommandType,
  ApplicationIntegrationType,
  InteractionContextType,
  SlashCommandBuilder,
} from "discord.js";
import { DISCORD_CORE_CONVERSIONS } from "./config";
import { discordConversionLabel } from "./i18n";

const conversionChoices = [
  { name: "Save only — no transcription", name_localizations: { "es-ES": "Solo guardar — sin transcripción", "es-419": "Solo guardar — sin transcripción" }, value: "none" },
  ...DISCORD_CORE_CONVERSIONS.map((value) => ({
    name: discordConversionLabel(value, "en"),
    name_localizations: {
      "es-ES": discordConversionLabel(value, "es"),
      "es-419": discordConversionLabel(value, "es"),
    },
    value,
  })),
];

export function discordCommandManifest() {
  const command = new SlashCommandBuilder()
    .setName("proset")
    .setDescription("Capture and shape voice ideas with Proset")
    .setDescriptionLocalizations({ "es-ES": "Captura y organiza ideas de voz con Proset", "es-419": "Captura y organiza ideas de voz con Proset" })
    .setIntegrationTypes(ApplicationIntegrationType.GuildInstall, ApplicationIntegrationType.UserInstall)
    .setContexts(InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel)
    .addSubcommand((subcommand) => subcommand
      .setName("record")
      .setDescription("Save your next Discord voice message")
      .setDescriptionLocalizations({ "es-ES": "Guarda tu próximo mensaje de voz de Discord", "es-419": "Guarda tu próximo mensaje de voz de Discord" })
      .addStringOption((option) => option
        .setName("convert")
        .setDescription("Optional core conversion after transcription")
        .setDescriptionLocalizations({ "es-ES": "Conversión básica opcional después de transcribir", "es-419": "Conversión básica opcional después de transcribir" })
        .addChoices(...conversionChoices))
      .addStringOption((option) => option
        .setName("language")
        .setDescription("Transcription and output language")
        .setDescriptionLocalizations({ "es-ES": "Idioma de transcripción y resultado", "es-419": "Idioma de transcripción y resultado" })
        .addChoices(
          { name: "Automatic", name_localizations: { "es-ES": "Automático", "es-419": "Automático" }, value: "auto" },
          { name: "English", name_localizations: { "es-ES": "Inglés", "es-419": "Inglés" }, value: "en" },
          { name: "Spanish (Mexico/Latin America)", name_localizations: { "es-ES": "Español (México/Latinoamérica)", "es-419": "Español (México/Latinoamérica)" }, value: "es" },
        )))
    .addSubcommand((subcommand) => subcommand
      .setName("link")
      .setDescription("Link your existing Proset account")
      .setDescriptionLocalizations({ "es-ES": "Vincula tu cuenta de Proset", "es-419": "Vincula tu cuenta de Proset" }))
    .addSubcommand((subcommand) => subcommand
      .setName("unlink")
      .setDescription("Unlink your Discord account from Proset")
      .setDescriptionLocalizations({ "es-ES": "Desvincula Discord de Proset", "es-419": "Desvincula Discord de Proset" }))
    .addSubcommand((subcommand) => subcommand
      .setName("server")
      .setDescription("Configure Proset in this server (Manage Server required)")
      .setDescriptionLocalizations({ "es-ES": "Configura Proset en este servidor", "es-419": "Configura Proset en este servidor" })
      .addBooleanOption((option) => option
        .setName("publishing")
        .setDescription("Allow explicit publication of converted results")
        .setDescriptionLocalizations({ "es-ES": "Permitir publicar resultados con confirmación", "es-419": "Permitir publicar resultados con confirmación" }))
      .addBooleanOption((option) => option
        .setName("inbox")
        .setDescription("Automatically save linked users’ voice messages in this channel")
        .setDescriptionLocalizations({ "es-ES": "Guardar mensajes de voz de usuarios vinculados en este canal", "es-419": "Guardar mensajes de voz de usuarios vinculados en este canal" })));

  const saveVoiceMessage = {
    name: "Save to Proset",
    name_localizations: {
      "es-ES": "Guardar en Proset",
      "es-419": "Guardar en Proset",
    },
    type: ApplicationCommandType.Message,
    integration_types: [ApplicationIntegrationType.GuildInstall, ApplicationIntegrationType.UserInstall],
    contexts: [InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel],
  };

  return [command.toJSON(), saveVoiceMessage];
}
