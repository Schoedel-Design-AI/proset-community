export const STATIC_AVATAR_PACK_KEYS = [
  "adventurer",
  "bottts",
  "funEmoji",
  "lorelei",
  "micah",
  "miniavs",
  "notionists",
  "pixelArt",
  "bigSmile",
] as const;

export const PRO_ANIMATED_AVATAR_PACK_KEYS = [
  "sprouts",
  "critters",
  "moods",
  "voxelArt",
  "voxelBot",
] as const;

export type StaticAvatarStyleKey = (typeof STATIC_AVATAR_PACK_KEYS)[number];
export type ProAnimatedAvatarStyleKey = (typeof PRO_ANIMATED_AVATAR_PACK_KEYS)[number];
export type AvatarStyleKey = StaticAvatarStyleKey | ProAnimatedAvatarStyleKey;

export const AVATARS_PER_PACK = 50;

const avatarPackKeys = new Set<string>([
  ...STATIC_AVATAR_PACK_KEYS,
  ...PRO_ANIMATED_AVATAR_PACK_KEYS,
]);
const proAnimatedPackKeys = new Set<string>(PRO_ANIMATED_AVATAR_PACK_KEYS);

export type ParsedAvatarId = {
  packKey: AvatarStyleKey;
  index: number;
};

export function parseAvatarId(avatarId: string): ParsedAvatarId | null {
  const normalized = avatarId.trim();
  const currentMatch = normalized.match(/^([A-Za-z]+):(\d+)$/);

  if (currentMatch) {
    const packKey = currentMatch[1];
    const index = Number.parseInt(currentMatch[2], 10) - 1;
    if (avatarPackKeys.has(packKey) && index >= 0 && index < AVATARS_PER_PACK) {
      return { packKey: packKey as AvatarStyleKey, index };
    }
    return null;
  }

  const legacyMatch = normalized.match(/^avatar-(\d+)$/);
  if (!legacyMatch) return null;

  const index = Number.parseInt(legacyMatch[1], 10) - 1;
  return index >= 0 && index < AVATARS_PER_PACK
    ? { packKey: "bigSmile", index }
    : null;
}

export function isValidAvatarId(avatarId: string): boolean {
  return avatarId.trim() === "" || parseAvatarId(avatarId) !== null;
}

export function isProAnimatedAvatarId(avatarId: string): boolean {
  const parsed = parseAvatarId(avatarId);
  return parsed ? proAnimatedPackKeys.has(parsed.packKey) : false;
}

export function hasProAvatarEntitlement(status: {
  tier?: string | null;
  active?: boolean | null;
}): boolean {
  return status.active === true && String(status.tier || "").toLowerCase() === "pro";
}
