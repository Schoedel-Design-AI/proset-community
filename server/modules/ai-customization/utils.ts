import { storage } from "../../storage";
import {
  type UserConversionModelPreferences,
  type UserSelectableConversionModelId,
} from "../../conversion-model-routing";

export function isSelectableModelId(value: unknown): value is UserSelectableConversionModelId {
  return value === "qwen_35_14b"
    || value === "deepseek_v4_flash"
    || value === "deepseek_v4_flash_fireworks"
    || value === "deepseek_v4_pro"
    || value === "groq_qwen_36_27b"
    || value === "groq_gpt_oss_120b";
}

export function normalizeModelPreferenceInput(value: unknown): UserSelectableConversionModelId | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return isSelectableModelId(trimmed) ? trimmed : undefined;
}

export async function getUserConversionModelPreferences(userId: string): Promise<UserConversionModelPreferences> {
  const preference = await storage.userAiModelPreferences.get(userId);

  return {
    regularModelId: preference?.regularModelId && isSelectableModelId(preference.regularModelId)
      ? preference.regularModelId
      : null,
    advancedModelId: preference?.advancedModelId && isSelectableModelId(preference.advancedModelId)
      ? preference.advancedModelId
      : null,
  };
}
