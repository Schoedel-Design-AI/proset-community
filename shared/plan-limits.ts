export type SubscriptionTier = "free" | "base" | "pro";

export type TierLimit = {
  transcription: number;
  conversion: number;
  maxRecordingSeconds: number;
  storageMb: number;
  maxFileImportMB: number;
  maxRecordings: number;
};

export const PLAN_PRICES: Record<SubscriptionTier, { monthlyPrice: number; yearlyPrice: number; name: string }> = {
  free: { name: "Free", monthlyPrice: 0, yearlyPrice: 0 },
  base: { name: "Base", monthlyPrice: 999, yearlyPrice: 9990 },
  pro: { name: "Pro", monthlyPrice: 1999, yearlyPrice: 19990 },
};

export const TIER_LIMITS: Record<SubscriptionTier, TierLimit> = {
  free: {
    transcription: 3,
    conversion: 5,
    maxRecordingSeconds: 180,
    storageMb: 100,
    maxFileImportMB: 0,
    maxRecordings: 3,
  },
  base: {
    transcription: 35,
    conversion: 50,
    maxRecordingSeconds: 900,
    storageMb: 10240,
    maxFileImportMB: 25,
    maxRecordings: 35,
  },
  pro: {
    transcription: 70,
    conversion: 150,
    maxRecordingSeconds: 1800,
    storageMb: 25600,
    maxFileImportMB: 50,
    maxRecordings: 70,
  },
};

export const CLOUD_SYNC_RECORDING_BONUS = 500;
export const FREE_RECORDING_COUNT_MIN_SECONDS = 60;

export function countsTowardRecordingAllowance(
  tier: SubscriptionTier,
  durationSeconds: number,
): boolean {
  if (tier !== "free") return true;
  const normalizedDuration = Number.isFinite(durationSeconds)
    ? Math.max(0, durationSeconds)
    : 0;
  return normalizedDuration >= FREE_RECORDING_COUNT_MIN_SECONDS;
}

export const TIER_ALLOWED_FILE_TYPES: Record<SubscriptionTier, string[]> = {
  free: [],
  base: [".txt", ".md", ".docx", ".csv", ".xlsx", ".xls", ".pdf", ".png", ".jpg", ".jpeg", ".webp"],
  pro: [".txt", ".md", ".docx", ".csv", ".xlsx", ".xls", ".pdf", ".png", ".jpg", ".jpeg", ".webp"],
};

export function formatStorageAllowance(storageMb: number): string {
  if (storageMb >= 1024) {
    const gb = storageMb / 1024;
    return `${Number.isInteger(gb) ? gb.toFixed(0) : gb.toFixed(1)} GB`;
  }
  return `${storageMb} MB`;
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
  if (tier === "free") {
    return es
      ? [
          "Pruébalo — 3 transcripciones",
          "5 conversiones",
          "Grabaciones de 3 min",
          "3 grabaciones guardadas de 1 minuto o más",
          "Las grabaciones de menos de 1 minuto no cuentan para el límite de grabaciones guardadas",
          "Sin sincronización en la nube",
        ]
      : [
          "Try it out — 3 transcriptions",
          "5 conversions",
          "3-min recordings",
          "3 saved recordings of 1 minute or longer",
          "Recordings under 1 minute do not count toward the saved-recording allowance",
          "No cloud sync",
        ];
  }
  if (tier === "base") {
    return es
      ? [
          "35 transcripciones/mes incluidas",
          "50 conversiones/mes",
          "Grabaciones de 15 min",
          "10 GB de almacenamiento",
          "35 grabaciones guardadas",
          "Importación de archivos (25 MB)",
          "Todos los tipos de conversión",
          "Sincronización en la nube disponible como complemento",
        ]
      : [
          "35 transcriptions/mo included",
          "50 conversions/mo",
          "15-min recordings",
          "10 GB storage",
          "35 saved recordings",
          "File import (25 MB)",
          "All conversion types",
          "Cloud Sync add-on available",
        ];
  }
  return es
    ? [
        "70 transcripciones/mes incluidas",
        "150 conversiones/mes",
        "Grabaciones de 30 min",
        "25 GB de almacenamiento",
        "70 grabaciones guardadas",
        "Importación de archivos (50 MB)",
        "Todos los tipos de conversión",
        "Sincronización en la nube incluida",
        "Soporte prioritario",
      ]
    : [
        "70 transcriptions/mo included",
        "150 conversions/mo",
        "30-min recordings",
        "25 GB storage",
        "70 saved recordings",
        "File import (50 MB)",
        "All conversion types",
        "Cloud Sync included",
        "Priority support",
      ];
}
