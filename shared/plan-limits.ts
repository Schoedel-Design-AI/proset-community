export type SubscriptionTier = "free" | "base" | "pro";

export type TierLimit = {
  maxRecordingSeconds: number;
  /**
   * Duration ceiling for an audio/video file uploaded for transcription.
   * Deliberately separate from maxRecordingSeconds: a live take is bounded by
   * what a device can hold in one pass, while an imported file is a background
   * job whose length costs nothing extra to run. They answer different
   * questions — "how long can I talk?" versus "how large a file can I hand
   * over?" — so the two ladders move independently.
   */
  maxMediaImportSeconds: number;
  storageMb: number;
  maxFileImportMB: number;
  /**
   * Byte ceiling for an audio/video file uploaded for transcription. The file
   * is transient — its audio is extracted and the original is discarded — so
   * this is an abuse guard, not a storage budget. The authoritative limit is
   * maxMediaImportSeconds, measured from the file by ffmpeg after upload.
   */
  maxMediaUploadMB: number;
};

export const PLAN_PRICES: Record<SubscriptionTier, { monthlyPrice: number; yearlyPrice: number; name: string }> = {
  free: { name: "Free", monthlyPrice: 0, yearlyPrice: 0 },
  base: { name: "Base", monthlyPrice: 349, yearlyPrice: 3490 },
  pro: { name: "Pro", monthlyPrice: 599, yearlyPrice: 5990 },
};

/**
 * Monthly token allowance per tier. Tokens measure the AI processing a
 * recording or conversion uses: transcriptions are charged 2 tokens per second
 * of audio, conversions are charged their actual model input+output tokens.
 */
export const TIER_TOKEN_ALLOWANCES: Record<SubscriptionTier, number> = {
  free: 10000,
  base: 50000,
  pro: 200000,
};

/**
 * Each second of audio costs two tokens to transcribe.
 *
 * Rate history:
 * - Original design (vault "Proset Monetization and Pricing Plan"): 200 tokens
 *   per minute ≈ 3.33 tokens/sec. Chosen to keep worst-case per-user cost close
 *   to break-even even when the hedged provider (Mistral/OpenAI, ~$0.18–$0.36/hr
 *   of audio) serves instead of Groq ($0.04/hr).
 * - Original code (pre-launch): 1 token/sec. Diverged from the design without a
 *   deliberate reconciliation; caught during the 2026-09-17 launch review.
 * - Current: 2 tokens/sec — halfway between the two. Cuts worst-case exposure
 *   in half while still promising a Pro subscriber ~27.8 hours of transcription
 *   per month, which comfortably covers a full work week of meetings. Any change
 *   to this constant is a business decision (allowance vs margin vs promise);
 *   do not tune it as a code cleanup.
 */
export const TRANSCRIPTION_TOKENS_PER_SECOND = 2;

/**
 * Per-tier media ceilings.
 *
 * Two ladders, on purpose. maxRecordingSeconds bounds a LIVE take — 3 / 15 / 30
 * minutes — which runs on the device, under a foreground service, and ends with
 * an upload, so its length is limited by what one pass can hold.
 * maxMediaImportSeconds bounds an imported file — 3 / 20 / 60 minutes — which is
 * a background job, so its only real constraints are duration measured from the
 * file by ffmpeg and the provider's per-request cap.
 *
 * Neither ladder is bounded by Cloud Run's 32 MiB request ceiling: uploads
 * travel to object storage over a presigned URL, and anything past one segment
 * (600 s) goes through the silence-split pipeline in media-ingest.ts.
 */
export const TIER_LIMITS: Record<SubscriptionTier, TierLimit> = {
  free: {
    maxRecordingSeconds: 180,
    maxMediaImportSeconds: 0,
    storageMb: 0,
    maxFileImportMB: 0,
    maxMediaUploadMB: 0,
  },
  base: {
    maxRecordingSeconds: 900,
    maxMediaImportSeconds: 1200,
    storageMb: 2048,
    maxFileImportMB: 25,
    maxMediaUploadMB: 512,
  },
  pro: {
    maxRecordingSeconds: 1800,
    maxMediaImportSeconds: 3600,
    storageMb: 5120,
    maxFileImportMB: 50,
    maxMediaUploadMB: 1024,
  },
};

export const TIER_ALLOWED_FILE_TYPES: Record<SubscriptionTier, string[]> = {
  free: [],
  base: [".txt", ".md", ".docx", ".csv", ".xlsx", ".xls", ".pdf", ".png", ".jpg", ".jpeg", ".webp"],
  pro: [".txt", ".md", ".docx", ".csv", ".xlsx", ".xls", ".pdf", ".png", ".jpg", ".jpeg", ".webp"],
};

/**
 * Audio/video containers accepted for transcription. Kept to formats ffmpeg
 * demuxes reliably and the ASR providers accept after normalisation.
 */
export const MEDIA_IMPORT_EXTENSIONS = [
  ".mp3", ".m4a", ".aac", ".wav", ".flac", ".ogg", ".oga", ".opus", ".wma", ".amr", ".aiff",
  ".mp4", ".m4v", ".mov", ".webm", ".mkv", ".avi", ".wmv", ".flv", ".3gp", ".mpeg", ".mpg", ".ts",
];

export function isMediaImportFileName(fileName: string): boolean {
  const lower = fileName.trim().toLowerCase();
  const dot = lower.lastIndexOf(".");
  if (dot < 0) return false;
  return MEDIA_IMPORT_EXTENSIONS.includes(lower.slice(dot));
}

export function formatStorageAllowance(storageMb: number): string {
  if (storageMb <= 0) return "None";
  if (storageMb >= 1024) {
    const gb = storageMb / 1024;
    return `${Number.isInteger(gb) ? gb.toFixed(0) : gb.toFixed(1)} GB`;
  }
  return `${storageMb} MB`;
}

export function formatTokenAllowance(tokens: number): string {
  return Math.max(0, Math.round(tokens)).toLocaleString("en-US");
}

export function formatDurationAllowance(seconds: number): string {
  const mins = Math.round(seconds / 60);
  return `${mins}-minute`;
}

export type AnnualSavings = {
  monthsFree: number;
  percentOff: number;
};

/**
 * Compute the savings a yearly plan offers over paying monthly for 12 months.
 * Returns null when the prices don't imply a real discount.
 */
export function getAnnualSavings(
  monthlyPrice: number,
  yearlyPrice: number,
): AnnualSavings | null {
  if (monthlyPrice <= 0 || yearlyPrice <= 0) return null;
  const monthlyTotal = monthlyPrice * 12;
  if (yearlyPrice >= monthlyTotal) return null;
  const monthsFree = Math.round(((monthlyTotal - yearlyPrice) / monthlyPrice) * 10) / 10;
  const percentOff = Math.round((1 - yearlyPrice / monthlyTotal) * 100);
  if (monthsFree <= 0 || percentOff <= 0) return null;
  return { monthsFree, percentOff };
}

export function getPlanFeatures(tier: SubscriptionTier, language: string = "en"): string[] {
  const es = language === "es";
  const tokens = formatTokenAllowance(TIER_TOKEN_ALLOWANCES[tier]);
  // "AI Credits" is the customer-facing name of the currency (ES: "Créditos de
  // IA"). `tokens` is the internal column name and must not reach a plan card —
  // the same currency is called AI Credits in the subscription panel, the Play
  // catalog and the Store listing, and one surface leaking the internal word
  // reads as a different feature.
  if (tier === "free") {
    return es
      ? [
          `${tokens} Créditos de IA para probarlo`,
          "Grabaciones de 3 min",
          "Sin sincronización en la nube",
        ]
      : [
          `${tokens} AI Credits to try it out`,
          "3-min recordings",
          "No cloud sync",
        ];
  }
  if (tier === "base") {
    return es
      ? [
          `${tokens} Créditos de IA/mes`,
          "Grabaciones de 15 min",
          "Importación de audio y video (20 min)",
          "2 GB de almacenamiento en la nube",
          "Importación de archivos (25 MB)",
          "Todos los tipos de conversión",
          "Sincronización en la nube incluida",
        ]
      : [
          `${tokens} AI Credits/mo`,
          "15-min recordings",
          "Audio & video import (20 min)",
          "2 GB cloud storage",
          "File import (25 MB)",
          "All conversion types",
          "Cloud Sync included",
        ];
  }
  return es
    ? [
        `${tokens} Créditos de IA/mes`,
        "Grabaciones de 30 min",
        "Importación de audio y video (60 min)",
        "5 GB de almacenamiento en la nube",
        "Importación de archivos (50 MB)",
        "Todos los tipos de conversión",
        "Sincronización en la nube incluida",
        "Soporte prioritario",
      ]
    : [
        `${tokens} AI Credits/mo`,
        "30-min recordings",
        "Audio & video import (60 min)",
        "5 GB cloud storage",
        "File import (50 MB)",
        "All conversion types",
        "Cloud Sync included",
        "Priority support",
      ];
}
