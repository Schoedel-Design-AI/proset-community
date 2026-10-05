import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * Recently used conversion types, newest first.
 *
 * Shared by every screen that offers a conversion picker so "recent" means the same
 * thing everywhere. The recording screen writes this key when a conversion is
 * prepared (its own inline implementation), and the Thought Thread picker records and
 * reads it through here; both cap the list at five entries.
 */
export const RECENT_CONVERSION_TYPES_STORAGE_KEY = "@barry_recent_conversion_types";
export const RECENT_CONVERSION_TYPES_LIMIT = 5;

export async function readRecentConversionTypes(): Promise<string[]> {
  try {
    const stored = await AsyncStorage.getItem(RECENT_CONVERSION_TYPES_STORAGE_KEY);
    const parsed = stored ? JSON.parse(stored) : [];
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string") : [];
  } catch {
    return [];
  }
}

export async function recordRecentConversionType(typeValue: string): Promise<string[]> {
  const updated = [typeValue, ...(await readRecentConversionTypes()).filter((value) => value !== typeValue)]
    .slice(0, RECENT_CONVERSION_TYPES_LIMIT);
  try {
    await AsyncStorage.setItem(RECENT_CONVERSION_TYPES_STORAGE_KEY, JSON.stringify(updated));
  } catch {}
  return updated;
}
