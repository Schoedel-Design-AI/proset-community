export type SubscriptionTier = "free" | "base" | "pro";

export type TierLimit = {
  maxRecordingSeconds: number;
  storageMb: number;
  maxFileImportMB: number;
};

export const PLAN_PRICES: Record<SubscriptionTier, { monthlyPrice: number; yearlyPrice: number; name: string }> = {
  free: { name: "Free", monthlyPrice: 0, yearlyPrice: 0 },
  base: { name: "Base", monthlyPrice: 349, yearlyPrice: 3490 },
  pro: { name: "Pro", monthlyPrice: 599, yearlyPrice: 5990 },
};

/**
 * Monthly token allowance per tier. Tokens measure the AI processing a
 * recording or conversion uses: transcriptions are charged 1 token per second
 * of audio, conversions are charged their actual model input+output tokens.
 */
export const TIER_TOKEN_ALLOWANCES: Record<SubscriptionTier, number> = {
  free: 10000,
  base: 50000,
  pro: 200000,
};

/** Each second of audio costs one token to transcribe. */
export const TRANSCRIPTION_TOKENS_PER_SECOND = 1;

export const TIER_LIMITS: Record<SubscriptionTier, TierLimit> = {
  free: {
    maxRecordingSeconds: 180,
    storageMb: 0,
    maxFileImportMB: 0,
  },
  base: {
    maxRecordingSeconds: 480,
    storageMb: 2048,
    maxFileImportMB: 25,
  },
  pro: {
    maxRecordingSeconds: 900,
    storageMb: 5120,
    maxFileImportMB: 50,
  },
};

export const TIER_ALLOWED_FILE_TYPES: Record<SubscriptionTier, string[]> = {
  free: [],
  base: [".txt", ".md", ".docx", ".csv", ".xlsx", ".xls", ".pdf", ".png", ".jpg", ".jpeg", ".webp"],
  pro: [".txt", ".md", ".docx", ".csv", ".xlsx", ".xls", ".pdf", ".png", ".jpg", ".jpeg", ".webp"],
};

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
  if (tier === "free") {
    return es
      ? [
          `${tokens} tokens para probarlo`,
          "Grabaciones de 3 min",
          "Sin sincronización en la nube",
        ]
      : [
          `${tokens} tokens to try it out`,
          "3-min recordings",
          "No cloud sync",
        ];
  }
  if (tier === "base") {
    return es
      ? [
          `${tokens} tokens/mes`,
          "Grabaciones de 8 min",
          "2 GB de almacenamiento en la nube",
          "Importación de archivos (25 MB)",
          "Todos los tipos de conversión",
          "Sincronización en la nube incluida",
        ]
      : [
          `${tokens} tokens/mo`,
          "8-min recordings",
          "2 GB cloud storage",
          "File import (25 MB)",
          "All conversion types",
          "Cloud Sync included",
        ];
  }
  return es
    ? [
        `${tokens} tokens/mes`,
        "Grabaciones de 15 min",
        "5 GB de almacenamiento en la nube",
        "Importación de archivos (50 MB)",
        "Todos los tipos de conversión",
        "Sincronización en la nube incluida",
        "Soporte prioritario",
      ]
    : [
        `${tokens} tokens/mo`,
        "15-min recordings",
        "5 GB cloud storage",
        "File import (50 MB)",
        "All conversion types",
        "Cloud Sync included",
        "Priority support",
      ];
}
