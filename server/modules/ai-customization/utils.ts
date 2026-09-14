import { storage } from "../../storage";
import {
  resolveConversionModelId,
  type UserConversionModelPreferences,
  type UserSelectableConversionModelId,
} from "../../conversion-model-routing";

/** Retired catalog ids stay selectable so a stored preference keeps working;
 *  normalization maps them onto their current replacement. */
export function isSelectableModelId(value: unknown): value is UserSelectableConversionModelId {
  return resolveConversionModelId(value) !== null;
}

export function normalizeModelPreferenceInput(value: unknown): UserSelectableConversionModelId | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return resolveConversionModelId(trimmed) ?? undefined;
}

export async function getUserConversionModelPreferences(userId: string): Promise<UserConversionModelPreferences> {
  const preference = await storage.userAiModelPreferences.get(userId);

  return {
    regularModelId: preference?.regularModelId
      ? resolveConversionModelId(preference.regularModelId)
      : null,
    advancedModelId: preference?.advancedModelId
      ? resolveConversionModelId(preference.advancedModelId)
      : null,
  };
}
