import { createHash } from "node:crypto";
import {
  Client,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  GatewayIntentBits,
  Interaction,
  Message,
  type MessageContextMenuCommandInteraction,
  MessageFlags,
  Partials,
  PermissionFlagsBits,
} from "discord.js";
import type { DiscordCaptureSession, DiscordJob, DiscordLocale } from "@shared/schema";
import { storage } from "../../storage";
import {
  DISCORD_CAPTURE_TTL_MS,
  DISCORD_MAX_AUDIO_BYTES,
  discordLocale,
  isDiscordConversionType,
  isDiscordGatewayEnabled,
  requireDiscordApplicationId,
  requireDiscordBotToken,
} from "./config";
import { encryptDiscordSecret } from "./crypto";
import { discordText } from "./i18n";
import { createDiscordCommandLink } from "./linking";
import { enqueueDiscordJob } from "./task-queue";
import { processDiscordJob } from "./worker";
import { canPublishDiscordResult, shouldCaptureDiscordVoice, splitDiscordContent } from "./policy";

let discordClient: Client | null = null;

function stableId(prefix: string, ...parts: string[]): string {
  return `${prefix}_${createHash("sha256").update(parts.join(":"), "utf8").digest("hex").slice(0, 32)}`;
}

function captureSessionId(discordUserId: string, channelId: string): string {
  return stableId("discord_capture", discordUserId, channelId);
}

function linkButton(url: string, label: string) {
  return [{ type: 1, components: [{ type: 2, style: 5, label, url }] }];
}

function isNativeVoiceMessage(message: Message): boolean {
  return message.flags.has(MessageFlags.IsVoiceMessage)
    && message.attachments.size === 1
    && (message.attachments.first()?.contentType || "").startsWith("audio/");
}

async function linkedUserId(discordUserId: string): Promise<string | null> {
  const account = await storage.accounts.getByProviderIdAndAccountId("discord", discordUserId);
  return account?.userId || null;
}

async function queueMessageCapture(input: {
  message: Message;
  userId: string;
  discordUserId: string;
  locale: DiscordLocale;
  conversionType?: string | null;
  session?: DiscordCaptureSession | null;
}): Promise<DiscordJob> {
  const attachment = input.message.attachments.first();
  if (!attachment) throw new Error("Voice message attachment is missing");
  const now = new Date();
  const jobId = stableId("discord_job", input.userId, input.message.id);
  const recordingId = stableId("discord_recording", input.userId, input.message.id);
  const job: DiscordJob = {
    id: jobId,
    action: "capture",
    status: "queued",
    userId: input.userId,
    discordUserId: input.discordUserId,
    applicationId: requireDiscordApplicationId(),
    guildId: input.message.guildId,
    channelId: input.message.channelId,
    sourceMessageId: input.message.id,
    captureSessionId: input.session?.id || null,
    interactionId: input.session?.interactionId || null,
    attachmentUrl: attachment.url,
    attachmentName: attachment.name || "discord-voice-message.ogg",
    attachmentContentType: attachment.contentType || "audio/ogg",
    attachmentSize: attachment.size,
    attachmentDurationSeconds: attachment.duration,
    recordingId,
    thoughtThreadId: input.session?.thoughtThreadId || null,
    conversionId: null,
    conversionType: isDiscordConversionType(input.conversionType) ? input.conversionType : null,
    locale: input.locale,
    attemptCount: 0,
    errorCode: null,
    publicMessageId: null,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString(),
  };
  const created = await storage.discordJobs.createIfAbsent(job);
  let queuedJob = created.job;
  if (!created.created && created.job.status === "failed") {
    queuedJob = (await storage.discordJobs.update(job.id, {
      status: "queued",
      errorCode: null,
      completedAt: null,
    })) || created.job;
  }
  if (created.created || created.job.status === "failed") {
    const queued = await enqueueDiscordJob(job.id, queuedJob.attemptCount || 0);
    if (!queued) void processDiscordJob(job.id);
  }
  return queuedJob;
}

async function ensureLinked(interaction: Interaction, locale: DiscordLocale): Promise<string | null> {
  if (!interaction.isRepliable()) return null;
  const userId = await linkedUserId(interaction.user.id);
  if (userId) return userId;
  const t = discordText(locale);
  const url = await createDiscordCommandLink(interaction.user.id, locale);
  await interaction.reply({
    content: t.linkRequired,
    components: linkButton(url, t.openLink),
    flags: MessageFlags.Ephemeral,
  });
  return null;
}

async function handleRecordCommand(interaction: ChatInputCommandInteraction) {
  const locale = discordLocale(interaction.locale);
  const userId = await ensureLinked(interaction, locale);
  if (!userId) return;
  const requestedConversion = interaction.options.getString("convert");
  const conversionType = isDiscordConversionType(requestedConversion) ? requestedConversion : null;
  const language = interaction.options.getString("language");
  const outputLocale = language === "es" ? "es" : language === "en" ? "en" : locale;
  const now = new Date();
  const id = captureSessionId(interaction.user.id, interaction.channelId);
  await storage.discordCaptureSessions.arm({
    id,
    discordUserId: interaction.user.id,
    userId,
    applicationId: interaction.applicationId,
    guildId: interaction.guildId,
    channelId: interaction.channelId,
    interactionId: interaction.id,
    interactionToken: encryptDiscordSecret(interaction.token),
    locale: outputLocale,
    conversionType,
    thoughtThreadId: null,
    status: "armed",
    voiceMessageId: null,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + DISCORD_CAPTURE_TTL_MS).toISOString(),
    claimedAt: null,
    completedAt: null,
  });
  await interaction.reply({ content: discordText(outputLocale).armed, flags: MessageFlags.Ephemeral });
}

async function handleLinkCommand(interaction: ChatInputCommandInteraction) {
  const locale = discordLocale(interaction.locale);
  const existing = await linkedUserId(interaction.user.id);
  const t = discordText(locale);
  if (existing) {
    await interaction.reply({ content: t.linked, flags: MessageFlags.Ephemeral });
    return;
  }
  const url = await createDiscordCommandLink(interaction.user.id, locale);
  await interaction.reply({ content: t.linkRequired, components: linkButton(url, t.openLink), flags: MessageFlags.Ephemeral });
}

async function handleUnlinkCommand(interaction: ChatInputCommandInteraction) {
  const locale = discordLocale(interaction.locale);
  const account = await storage.accounts.getByProviderIdAndAccountId("discord", interaction.user.id);
  if (account) await storage.accounts.unlinkDiscord(account.userId);
  await interaction.reply({ content: discordText(locale).unlinked, flags: MessageFlags.Ephemeral });
}

async function handleMessageCommand(interaction: MessageContextMenuCommandInteraction) {
  const locale = discordLocale(interaction.locale);
  const userId = await ensureLinked(interaction, locale);
  if (!userId) return;
  const message = interaction.targetMessage;
  if (!isNativeVoiceMessage(message) || message.author.id !== interaction.user.id) {
    await interaction.reply({ content: discordText(locale).voiceOnly, flags: MessageFlags.Ephemeral });
    return;
  }
  const now = new Date();
  const session: DiscordCaptureSession = {
    id: stableId("discord_capture", interaction.user.id, interaction.id),
    discordUserId: interaction.user.id,
    userId,
    applicationId: interaction.applicationId,
    guildId: interaction.guildId,
    channelId: interaction.channelId,
    interactionId: interaction.id,
    interactionToken: encryptDiscordSecret(interaction.token),
    locale,
    conversionType: null,
    thoughtThreadId: null,
    status: "claimed",
    voiceMessageId: message.id,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + DISCORD_CAPTURE_TTL_MS).toISOString(),
    claimedAt: now.toISOString(),
    completedAt: null,
  };
  await storage.discordCaptureSessions.arm(session);
  await interaction.reply({ content: discordText(locale).received, flags: MessageFlags.Ephemeral });
  await queueMessageCapture({ message, userId, discordUserId: interaction.user.id, locale, session });
}

async function handleVoiceMessage(message: Message): Promise<void> {
  if (message.author.bot || !isNativeVoiceMessage(message)) return;
  const attachment = message.attachments.first();
  if (!attachment || attachment.size > DISCORD_MAX_AUDIO_BYTES) return;
  const userId = await linkedUserId(message.author.id);
  if (!userId) return;

  const locale = discordLocale(message.guild?.preferredLocale);
  let session: DiscordCaptureSession | undefined;
  if (message.guildId) {
    session = await storage.discordCaptureSessions.claim(
      captureSessionId(message.author.id, message.channelId),
      message.author.id,
      message.channelId,
      message.id,
      new Date(),
    );
    if (!session) {
      const settings = await storage.discordGuildSettings.get(message.guildId);
      if (!shouldCaptureDiscordVoice({
        isDirectMessage: false,
        hasArmedSession: false,
        isConfiguredInbox: Boolean(settings?.inboxChannelIds.includes(message.channelId)),
      })) return;
    }
  }
  await queueMessageCapture({
    message,
    userId,
    discordUserId: message.author.id,
    locale: session?.locale || locale,
    conversionType: session?.conversionType,
    session,
  });
}

async function handlePublishButton(interaction: ButtonInteraction, jobId: string) {
  const locale = discordLocale(interaction.locale);
  const t = discordText(locale);
  const job = await storage.discordJobs.get(jobId);
  if (!job || job.discordUserId !== interaction.user.id || !job.guildId) {
    await interaction.reply({ content: t.expired, flags: MessageFlags.Ephemeral });
    return;
  }
  const settings = await storage.discordGuildSettings.get(job.guildId);
  const publishingAllowed = canPublishDiscordResult(settings, job.channelId);
  if (!publishingAllowed) {
    await interaction.reply({ content: t.publishDisabled, flags: MessageFlags.Ephemeral });
    return;
  }
  await interaction.reply({
    content: t.publishConfirm,
    components: [{
      type: 1,
      components: [
        { type: 2, style: 4, label: t.confirmPublish, custom_id: `proset:confirm:${job.id}` },
        { type: 2, style: 2, label: t.cancel, custom_id: `proset:cancel:${job.id}` },
      ],
    }],
    flags: MessageFlags.Ephemeral,
  });
}

async function handleConfirmPublish(interaction: ButtonInteraction, jobId: string) {
  const locale = discordLocale(interaction.locale);
  const t = discordText(locale);
  const job = await storage.discordJobs.get(jobId);
  if (!job || job.discordUserId !== interaction.user.id || !job.recordingId || !job.conversionId || job.status !== "succeeded") {
    await interaction.update({ content: t.expired, components: [] });
    return;
  }
  if (job.publicMessageId && !job.publicMessageId.startsWith("publishing:")) {
    await interaction.update({ content: t.published, components: [] });
    return;
  }
  const settings = job.guildId ? await storage.discordGuildSettings.get(job.guildId) : undefined;
  if (!canPublishDiscordResult(settings, job.channelId)) {
    await interaction.update({ content: t.publishDisabled, components: [] });
    return;
  }
  const recording = await storage.recordings.get(job.recordingId, job.userId);
  const conversion = Array.isArray(recording?.conversions)
    ? recording!.conversions.find((item: any) => item?.id === job.conversionId)
    : null;
  if (!conversion?.content) {
    await interaction.update({ content: t.expired, components: [] });
    return;
  }
  if (!await storage.discordJobs.claimPublication(job.id, interaction.user.id, new Date())) {
    await interaction.update({ content: t.published, components: [] });
    return;
  }
  const channel = await interaction.client.channels.fetch(job.channelId);
  if (!channel?.isTextBased() || !("send" in channel)) {
    await storage.discordJobs.update(job.id, { publicMessageId: null });
    await interaction.update({ content: t.publishDisabled, components: [] });
    return;
  }
  const chunks = splitDiscordContent(String(conversion.content));
  let firstMessageId: string | null = null;
  try {
    for (const chunk of chunks) {
      const sent = await channel.send({ content: chunk, allowedMentions: { parse: [] } });
      firstMessageId ||= sent.id;
    }
    await storage.discordJobs.update(job.id, { publicMessageId: firstMessageId });
    await interaction.update({ content: t.published, components: [] });
  } catch (error) {
    await storage.discordJobs.update(job.id, { publicMessageId: null });
    throw error;
  }
}

async function handleServerCommand(interaction: ChatInputCommandInteraction) {
  const locale = discordLocale(interaction.locale);
  if (!interaction.inGuild() || !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    await interaction.reply({ content: locale === "es" ? "Necesitas el permiso Administrar servidor." : "You need the Manage Server permission.", flags: MessageFlags.Ephemeral });
    return;
  }
  const publishingEnabled = interaction.options.getBoolean("publishing");
  const inboxEnabled = interaction.options.getBoolean("inbox");
  const existing = await storage.discordGuildSettings.get(interaction.guildId);
  const inbox = new Set(existing?.inboxChannelIds || []);
  if (inboxEnabled === true) inbox.add(interaction.channelId);
  if (inboxEnabled === false) inbox.delete(interaction.channelId);
  const now = new Date().toISOString();
  const saved = await storage.discordGuildSettings.upsert({
    id: `discord_guild_${interaction.guildId}`,
    guildId: interaction.guildId,
    publishingEnabled: publishingEnabled ?? existing?.publishingEnabled ?? true,
    inboxChannelIds: [...inbox],
    publishChannelIds: existing?.publishChannelIds || [],
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    updatedByDiscordUserId: interaction.user.id,
  });
  const content = locale === "es"
    ? `Configuración guardada. Publicación: ${saved.publishingEnabled ? "activada" : "desactivada"}. Bandeja en este canal: ${saved.inboxChannelIds.includes(interaction.channelId) ? "activada" : "desactivada"}.`
    : `Settings saved. Publishing: ${saved.publishingEnabled ? "enabled" : "disabled"}. Inbox in this channel: ${saved.inboxChannelIds.includes(interaction.channelId) ? "enabled" : "disabled"}.`;
  await interaction.reply({ content, flags: MessageFlags.Ephemeral });
}

async function handleInteraction(interaction: Interaction): Promise<void> {
  try {
    if (interaction.isChatInputCommand() && interaction.commandName === "proset") {
      const subcommand = interaction.options.getSubcommand();
      if (subcommand === "record") return void await handleRecordCommand(interaction);
      if (subcommand === "link") return void await handleLinkCommand(interaction);
      if (subcommand === "unlink") return void await handleUnlinkCommand(interaction);
      if (subcommand === "server") return void await handleServerCommand(interaction);
    }
    if (interaction.isMessageContextMenuCommand() && interaction.commandName === "Save to Proset") {
      return void await handleMessageCommand(interaction);
    }
    if (interaction.isButton()) {
      const [namespace, action, jobId] = interaction.customId.split(":");
      if (namespace !== "proset" || !jobId) return;
      if (action === "publish") return void await handlePublishButton(interaction, jobId);
      if (action === "confirm") return void await handleConfirmPublish(interaction, jobId);
      if (action === "cancel") return void await interaction.update({ content: discordText(discordLocale(interaction.locale)).cancelled, components: [] });
    }
  } catch (error) {
    console.error("[discord] Interaction failed:", error);
    if (interaction.isRepliable()) {
      const payload = { content: discordText(discordLocale(interaction.locale)).failed, components: [] };
      if (interaction.replied || interaction.deferred) await interaction.editReply(payload).catch(() => undefined);
      else await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral }).catch(() => undefined);
    }
  }
}

export async function startDiscordGateway(): Promise<Client | null> {
  if (!isDiscordGatewayEnabled()) return null;
  if (discordClient) return discordClient;
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.DirectMessages,
      GatewayIntentBits.MessageContent,
    ],
    partials: [Partials.Channel],
  });
  client.on("interactionCreate", (interaction) => void handleInteraction(interaction));
  client.on("messageCreate", (message) => void handleVoiceMessage(message).catch((error) => {
    console.error("[discord] Voice-message event failed:", error);
  }));
  client.once("ready", (readyClient) => {
    console.log(`[discord] Gateway ready as ${readyClient.user.tag}`);
  });
  client.on("error", (error) => console.error("[discord] Gateway error:", error));
  await client.login(requireDiscordBotToken());
  discordClient = client;
  return client;
}

export async function stopDiscordGateway(): Promise<void> {
  if (!discordClient) return;
  discordClient.destroy();
  discordClient = null;
}

export function getDiscordGatewayStatus(): {
  enabled: boolean;
  ready: boolean;
  userTag?: string;
} {
  return {
    enabled: isDiscordGatewayEnabled(),
    ready: Boolean(discordClient?.isReady()),
    ...(discordClient?.user?.tag ? { userTag: discordClient.user.tag } : {}),
  };
}
