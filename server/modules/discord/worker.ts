import { createHash } from "node:crypto";
import type { DiscordJob, Recording } from "@shared/schema";
import { paragraphizeTranscript } from "@shared/transcript-format";
import { storage } from "../../storage";
import { estimateAudioDurationSeconds } from "../../audio-silence";
import {
  createBucketFileRecord,
  downloadFile,
  fromBucketUri,
  generateBucketKey,
  toBucketUri,
  uploadFile,
} from "../../object-storage";
import { getTotalUserStorageUsed } from "../recordings/utils";
import {
  checkTranscriptionLimit,
  deductTranscriptionTokens,
  getStorageLimit,
} from "../../usage-service";
import { transcribeAudioLatencyFirst } from "../../transcription-routing";
import { runCoreConversion } from "../developer-api/conversion";
import {
  DISCORD_MAX_AUDIO_BYTES,
  discordPublicBaseUrl,
  isDiscordConversionType,
  requireDiscordBotToken,
} from "./config";
import { decryptDiscordSecret } from "./crypto";
import { discordConversionLabel, discordText } from "./i18n";

const ALLOWED_ATTACHMENT_HOSTS = new Set(["cdn.discordapp.com", "media.discordapp.net"]);

function stableId(prefix: string, ...parts: string[]): string {
  return `${prefix}_${createHash("sha256").update(parts.join(":"), "utf8").digest("hex").slice(0, 32)}`;
}

function recordingUrl(recordingId: string): string {
  return `${discordPublicBaseUrl()}/recording/${encodeURIComponent(recordingId)}`;
}

function truncateDiscord(text: string, max = 1500): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trimEnd()}…`;
}

async function downloadDiscordAttachment(job: DiscordJob): Promise<{ buffer: Buffer; contentType: string; fileName: string }> {
  if (!job.attachmentUrl) throw Object.assign(new Error("Missing Discord attachment URL"), { code: "missing_attachment" });
  const url = new URL(job.attachmentUrl);
  if (url.protocol !== "https:" || !ALLOWED_ATTACHMENT_HOSTS.has(url.hostname)) {
    throw Object.assign(new Error("Untrusted Discord attachment URL"), { code: "untrusted_attachment_url" });
  }
  if ((job.attachmentSize || 0) > DISCORD_MAX_AUDIO_BYTES) {
    throw Object.assign(new Error("Discord attachment is too large"), { code: "attachment_too_large" });
  }
  const response = await fetch(url, {
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
    headers: { "User-Agent": "Proset-Discord/1.0" },
  });
  if (!response.ok) throw Object.assign(new Error(`Discord CDN returned ${response.status}`), { code: "attachment_download_failed" });
  const declaredLength = Number(response.headers.get("content-length") || job.attachmentSize || 0);
  if (declaredLength > DISCORD_MAX_AUDIO_BYTES) {
    throw Object.assign(new Error("Discord attachment is too large"), { code: "attachment_too_large" });
  }
  const contentType = (response.headers.get("content-type") || job.attachmentContentType || "").split(";")[0].trim().toLowerCase();
  if (!contentType.startsWith("audio/")) {
    throw Object.assign(new Error("Discord attachment is not audio"), { code: "invalid_attachment_type" });
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length || buffer.length > DISCORD_MAX_AUDIO_BYTES) {
    throw Object.assign(new Error("Discord attachment size is invalid"), { code: "attachment_too_large" });
  }
  const extension = contentType.includes("ogg") ? ".ogg"
    : contentType.includes("mpeg") ? ".mp3"
      : contentType.includes("wav") ? ".wav"
        : contentType.includes("mp4") || contentType.includes("m4a") ? ".m4a"
          : ".ogg";
  const suppliedName = (job.attachmentName || "discord-voice-message").replace(/[^a-zA-Z0-9._-]/g, "_");
  const fileName = suppliedName.includes(".") ? suppliedName : `${suppliedName}${extension}`;
  return { buffer, contentType, fileName };
}

async function editOriginalInteraction(job: DiscordJob, payload: Record<string, unknown>): Promise<boolean> {
  if (!job.captureSessionId) return false;
  const session = await storage.discordCaptureSessions.get(job.captureSessionId);
  if (!session?.interactionToken) return false;
  try {
    const token = decryptDiscordSecret(session.interactionToken);
    const response = await fetch(
      `https://discord.com/api/v10/webhooks/${encodeURIComponent(session.applicationId)}/${encodeURIComponent(token)}/messages/@original`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, allowed_mentions: { parse: [] } }),
        signal: AbortSignal.timeout(15_000),
      },
    );
    return response.ok;
  } catch (error) {
    console.warn("[discord] Failed to edit original interaction:", error);
    return false;
  }
}

async function sendDiscordDm(discordUserId: string, payload: Record<string, unknown>): Promise<void> {
  const headers = {
    Authorization: `Bot ${requireDiscordBotToken()}`,
    "Content-Type": "application/json",
  };
  const channelResponse = await fetch("https://discord.com/api/v10/users/@me/channels", {
    method: "POST",
    headers,
    body: JSON.stringify({ recipient_id: discordUserId }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!channelResponse.ok) throw new Error(`Discord DM channel failed (${channelResponse.status})`);
  const channel = await channelResponse.json() as { id: string };
  const messageResponse = await fetch(`https://discord.com/api/v10/channels/${channel.id}/messages`, {
    method: "POST",
    headers,
    body: JSON.stringify({ ...payload, allowed_mentions: { parse: [] } }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!messageResponse.ok) throw new Error(`Discord DM failed (${messageResponse.status})`);
}

function resultPayload(job: DiscordJob, recording: Recording) {
  const t = discordText(job.locale);
  const conversion = Array.isArray(recording.conversions)
    ? recording.conversions.find((item: any) => item?.id === job.conversionId)
    : undefined;
  const conversionType = isDiscordConversionType(job.conversionType) ? job.conversionType : null;
  const components: any[] = [{
    type: 1,
    components: [
      {
        type: 2,
        style: 5,
        label: t.openRecording,
        url: recordingUrl(recording.id),
      },
      ...(conversion && job.guildId ? [{
        type: 2,
        style: 1,
        label: t.publish,
        custom_id: `proset:publish:${job.id}`,
      }] : []),
    ],
  }];
  const content = conversion && conversionType
    ? `${t.converted}\n\n**${discordConversionLabel(conversionType, job.locale)}**\n${truncateDiscord(conversion.content)}`
    : t.saved;
  return { content, components };
}

async function notifyResult(job: DiscordJob, recording: Recording): Promise<void> {
  const payload = resultPayload(job, recording);
  if (await editOriginalInteraction(job, payload)) return;
  await sendDiscordDm(job.discordUserId, payload);
}

async function notifyFailure(job: DiscordJob, errorCode: string): Promise<void> {
  const t = discordText(job.locale);
  const content = errorCode === "attachment_too_large" ? t.tooLarge : t.failed;
  if (await editOriginalInteraction(job, { content, components: [] })) return;
  await sendDiscordDm(job.discordUserId, { content, components: [] }).catch((error) => {
    console.warn("[discord] Could not deliver failure DM:", error);
  });
}

export async function processDiscordJob(jobId: string): Promise<void> {
  const claimed = await storage.discordJobs.claim(jobId, new Date());
  if (!claimed || claimed.status === "succeeded") return;
  let recording: Recording | undefined;
  try {
    if (claimed.action !== "capture") throw Object.assign(new Error("Unsupported Discord job"), { code: "unsupported_action" });
    const recordingId = claimed.recordingId || stableId("discord_recording", claimed.userId, claimed.sourceMessageId || claimed.id);
    recording = await storage.recordings.get(recordingId, claimed.userId);
    const attachment = recording?.audioUri?.startsWith("bucket://")
      ? {
          buffer: await downloadFile(fromBucketUri(recording.audioUri)),
          contentType: claimed.attachmentContentType || "audio/ogg",
          fileName: claimed.attachmentName || "discord-voice-message.ogg",
        }
      : await downloadDiscordAttachment(claimed);
    if (!recording) {
      const [usedBytes, storageLimit] = await Promise.all([
        getTotalUserStorageUsed(claimed.userId),
        getStorageLimit(claimed.userId),
      ]);
      if (storageLimit === 0 || usedBytes + attachment.buffer.length > storageLimit) {
        throw Object.assign(new Error("Storage limit exceeded"), { code: "storage_limit" });
      }
      const duration = claimed.attachmentDurationSeconds
        || await estimateAudioDurationSeconds(attachment.buffer).catch(() => 0);
      const bucketKey = generateBucketKey(claimed.userId, "audio", attachment.fileName);
      await uploadFile(bucketKey, attachment.buffer);
      await createBucketFileRecord({
        userId: claimed.userId,
        bucketKey,
        originalName: attachment.fileName,
        mimeType: attachment.contentType,
        fileSize: attachment.buffer.length,
        category: "audio",
      });
      const now = new Date().toISOString();
      recording = await storage.recordings.create({
        id: recordingId,
        userId: claimed.userId,
        title: claimed.locale === "es" ? "Idea de voz de Discord" : "Discord voice idea",
        duration,
        audioUri: toBucketUri(bucketKey),
        transcript: "",
        transcriptRevision: 1,
        transcriptHash: createHash("sha256").update("").digest("hex"),
        transcriptUpdatedAt: null,
        conversions: [],
        createdAt: now,
        needsUpload: false,
        uploadStatus: "uploaded",
        uploadErrorCode: null,
        uploadRetryable: null,
        isTranscribing: false,
        transcriptionStatus: claimed.conversionType ? "queued" : "idle",
        transcriptionErrorCode: null,
        transcriptionError: null,
        transcriptionRetryable: null,
      });
      await storage.discordJobs.update(claimed.id, {
        recordingId,
        attachmentUrl: null,
      });
    }

    let conversionId: string | null = null;
    if (claimed.conversionType) {
      if (!isDiscordConversionType(claimed.conversionType)) {
        throw Object.assign(new Error("Conversion is not available in Discord"), { code: "discord_conversion_not_allowed" });
      }
      if (!recording.transcript?.trim()) {
        const duration = Number(recording.duration) || 0;
        const allowed = await checkTranscriptionLimit(claimed.userId, duration);
        if (!allowed.allowed) throw Object.assign(new Error("Insufficient AI credits"), { code: "insufficient_tokens" });
        await storage.recordings.update(recording.id, claimed.userId, {
          isTranscribing: true,
          transcriptionStatus: "transcribing",
        });
        const transcription = await transcribeAudioLatencyFirst({
          fileBuffer: attachment.buffer,
          fileName: attachment.fileName,
          language: claimed.locale === "es" ? "es" : undefined,
          prompt: claimed.locale === "es" ? "Español latinoamericano, acento mexicano." : undefined,
        });
        const transcript = paragraphizeTranscript(transcription.text);
        if (transcript.replace(/[\s\p{P}\p{S}]+/gu, "").length < 3) {
          throw Object.assign(new Error("No speech detected"), { code: "transcription_no_speech" });
        }
        recording = (await storage.recordings.update(recording.id, claimed.userId, {
          transcript,
          transcriptRevision: (recording.transcriptRevision || 1) + 1,
          transcriptHash: createHash("sha256").update(transcript).digest("hex"),
          transcriptUpdatedAt: new Date().toISOString(),
          isTranscribing: false,
          transcriptionStatus: "succeeded",
          transcriptionErrorCode: null,
          transcriptionError: null,
          transcriptionRetryable: null,
        })) || recording;
        await deductTranscriptionTokens(claimed.userId, duration);
      }

      conversionId = stableId("discord_conversion", recording.id, claimed.conversionType);
      const conversions = Array.isArray(recording.conversions) ? [...recording.conversions] : [];
      if (!conversions.some((item: any) => item?.id === conversionId)) {
        const result = await runCoreConversion(claimed.userId, {
          transcript: recording.transcript,
          type: claimed.conversionType,
          outputFormat: "markdown",
          language: claimed.locale,
        });
        conversions.unshift({
          id: conversionId,
          type: claimed.conversionType,
          label: discordConversionLabel(claimed.conversionType, claimed.locale),
          content: result.content,
          createdAt: new Date().toISOString(),
          source: "discord",
        });
        recording = (await storage.recordings.update(recording.id, claimed.userId, { conversions })) || recording;
      }
    }

    await storage.discordJobs.update(claimed.id, {
      status: "succeeded",
      recordingId: recording.id,
      conversionId,
      completedAt: new Date().toISOString(),
      errorCode: null,
    });
    const completed = (await storage.discordJobs.get(claimed.id)) || { ...claimed, recordingId: recording.id, conversionId };
    if (claimed.captureSessionId) {
      await storage.discordCaptureSessions.update(claimed.captureSessionId, {
        status: "completed",
        completedAt: new Date().toISOString(),
      }).catch((error) => console.warn("[discord] Could not finalize capture session:", error));
    }
    await notifyResult(completed as DiscordJob, recording).catch((error) => {
      // Delivery is separate from the paid processing transaction. A Discord
      // outage must not turn a completed recording/conversion into a retryable
      // AI job that could consume credits twice.
      console.warn(`[discord] Job ${jobId} succeeded but result delivery failed:`, error);
    });
    if (claimed.captureSessionId) {
      await storage.discordCaptureSessions.update(claimed.captureSessionId, {
        interactionToken: null,
      }).catch((error) => console.warn("[discord] Could not clear interaction token:", error));
    }
  } catch (error: any) {
    const errorCode = typeof error?.code === "string" ? error.code : "processing_failed";
    console.error(`[discord] Job ${jobId} failed (${errorCode}):`, error);
    if (recording) {
      await storage.recordings.update(recording.id, claimed.userId, {
        isTranscribing: false,
        transcriptionStatus: claimed.conversionType ? "failed" : recording.transcriptionStatus,
        transcriptionErrorCode: claimed.conversionType ? errorCode : recording.transcriptionErrorCode,
        transcriptionError: claimed.conversionType ? "Discord transcription or conversion failed. Your recording is safe." : recording.transcriptionError,
        transcriptionRetryable: claimed.conversionType ? true : recording.transcriptionRetryable,
      }).catch(() => undefined);
    }
    await storage.discordJobs.update(claimed.id, {
      status: "failed",
      recordingId: recording?.id || claimed.recordingId || null,
      attachmentUrl: recording ? null : claimed.attachmentUrl,
      errorCode,
      completedAt: new Date().toISOString(),
    });
    await notifyFailure(claimed, errorCode);
    if (claimed.captureSessionId) {
      await storage.discordCaptureSessions.update(claimed.captureSessionId, {
        status: "failed",
        completedAt: new Date().toISOString(),
        interactionToken: null,
      }).catch((cleanupError) => console.warn("[discord] Could not finalize failed capture session:", cleanupError));
    }
  }
}
