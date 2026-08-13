import { Avatar, Style } from "@dicebear/core";
import adventurerDefinition from "@dicebear/styles/adventurer.json";
import bigSmileDefinition from "@dicebear/styles/big-smile.json";
import botttsDefinition from "@dicebear/styles/bottts.json";
import crittersDefinition from "@dicebear/styles/critters.json";
import funEmojiDefinition from "@dicebear/styles/fun-emoji.json";
import loreleiDefinition from "@dicebear/styles/lorelei.json";
import micahDefinition from "@dicebear/styles/micah.json";
import miniavsDefinition from "@dicebear/styles/miniavs.json";
import moodsDefinition from "@dicebear/styles/moods.json";
import notionistsDefinition from "@dicebear/styles/notionists.json";
import pixelArtDefinition from "@dicebear/styles/pixel-art.json";
import sproutsDefinition from "@dicebear/styles/sprouts.json";
import voxelArtDefinition from "@dicebear/styles/voxel-art.json";
import voxelBotDefinition from "@dicebear/styles/voxel-bot.json";
import {
  parseAvatarId,
  type AvatarStyleKey,
} from "@shared/avatar-catalog";

export type { AvatarStyleKey } from "@shared/avatar-catalog";

export type AvatarPack = {
  key: AvatarStyleKey;
  label: string;
  style: Style<any>;
  proOnly?: boolean;
  animated?: boolean;
};

const styles = {
  adventurer: new Style(adventurerDefinition),
  bigSmile: new Style(bigSmileDefinition),
  bottts: new Style(botttsDefinition),
  critters: new Style(crittersDefinition),
  funEmoji: new Style(funEmojiDefinition),
  lorelei: new Style(loreleiDefinition),
  micah: new Style(micahDefinition),
  miniavs: new Style(miniavsDefinition),
  moods: new Style(moodsDefinition),
  notionists: new Style(notionistsDefinition),
  pixelArt: new Style(pixelArtDefinition),
  sprouts: new Style(sproutsDefinition),
  voxelArt: new Style(voxelArtDefinition),
  voxelBot: new Style(voxelBotDefinition),
};

export const AVATAR_PACKS: AvatarPack[] = [
  { key: "adventurer", label: "Adventurer", style: styles.adventurer },
  { key: "bottts", label: "Robots", style: styles.bottts },
  { key: "funEmoji", label: "Emoji", style: styles.funEmoji },
  { key: "lorelei", label: "Lorelei", style: styles.lorelei },
  { key: "micah", label: "Micah", style: styles.micah },
  { key: "miniavs", label: "Miniavs", style: styles.miniavs },
  { key: "notionists", label: "Notionists", style: styles.notionists },
  { key: "pixelArt", label: "Pixel Art", style: styles.pixelArt },
  { key: "bigSmile", label: "Smileys", style: styles.bigSmile },
  { key: "sprouts", label: "Sprouts", style: styles.sprouts, proOnly: true, animated: true },
  { key: "critters", label: "Critters", style: styles.critters, proOnly: true, animated: true },
  { key: "moods", label: "Moods", style: styles.moods, proOnly: true, animated: true },
  { key: "voxelArt", label: "Voxel Art", style: styles.voxelArt, proOnly: true, animated: true },
  { key: "voxelBot", label: "Voxel Bot", style: styles.voxelBot, proOnly: true, animated: true },
];

// Per-pack scale adjustments — some styles render tiny at default scale
// because their viewBox is enormous relative to the drawn content.
const PACK_SCALES: Partial<Record<AvatarStyleKey, number>> = {
  // DiceBear 10 accepts a multiplier. Notionists' figure occupies only part
  // of its 1744x1744 canvas, so 1.8 matches the other packs' visual density.
  notionists: 1.8,
};

const packPreviewCache = new Map<AvatarStyleKey, string>();

export function clearAvatarCaches() {
  packPreviewCache.clear();
  packAvatarCache.clear();
  svgCache.clear();
}

export function getPackPreviewSvg(packKey: AvatarStyleKey): string {
  if (packPreviewCache.has(packKey)) return packPreviewCache.get(packKey)!;
  const pack = AVATAR_PACKS.find((p) => p.key === packKey);
  if (!pack) return "";
  const scale = PACK_SCALES[packKey] ?? 1;
  const svg = new Avatar(pack.style, {
    seed: "marcus-1",
    size: 128,
    scale,
    // SvgXml inlines every avatar into one document. DiceBear's default IDs
    // collide across those SVGs, causing the first avatar's mask to hide the
    // other packs.
    idRandomization: true,
  }).toString();
  packPreviewCache.set(packKey, svg);
  return svg;
}

const SEEDS = [
  "marcus-1", "david-2", "james-3", "carlos-4", "ahmed-5",
  "sergei-6", "leo-7", "rafael-8", "omar-9", "kenji-10",
  "devon-11", "nikolai-12", "pedro-13", "jamal-14", "henry-15",
  "yusuf-16", "dimitri-17", "antonio-18", "trevor-19", "ravi-20",
  "sophia-21", "amara-22", "mei-23", "isabella-24", "fatima-25",
  "elena-26", "priya-27", "camille-28", "yuki-29", "zara-30",
  "luna-31", "nadia-32", "rosa-33", "aisha-34", "clara-35",
  "daphne-36", "layla-37", "mira-38", "suki-39", "valentina-40",
  "alex-41", "jordan-42", "sage-43", "river-44", "quinn-45",
  "robin-46", "casey-47", "avery-48", "skyler-49", "phoenix-50",
];

const SEED_LABELS = [
  "Marcus", "David", "James", "Carlos", "Ahmed",
  "Sergei", "Leo", "Rafael", "Omar", "Kenji",
  "Devon", "Nikolai", "Pedro", "Jamal", "Henry",
  "Yusuf", "Dimitri", "Antonio", "Trevor", "Ravi",
  "Sophia", "Amara", "Mei", "Isabella", "Fatima",
  "Elena", "Priya", "Camille", "Yuki", "Zara",
  "Luna", "Nadia", "Rosa", "Aisha", "Clara",
  "Daphne", "Layla", "Mira", "Suki", "Valentina",
  "Alex", "Jordan", "Sage", "River", "Quinn",
  "Robin", "Casey", "Avery", "Skyler", "Phoenix",
];

export type AvatarEntry = {
  id: string;
  seed: string;
  label: string;
  packKey: AvatarStyleKey;
};

function buildPackAvatars(packKey: AvatarStyleKey): AvatarEntry[] {
  return SEEDS.map((seed, i) => ({
    id: `${packKey}:${i + 1}`,
    seed,
    label: SEED_LABELS[i],
    packKey,
  }));
}

const packAvatarCache = new Map<AvatarStyleKey, AvatarEntry[]>();

export function getAvatarsForPack(packKey: AvatarStyleKey): AvatarEntry[] {
  if (packAvatarCache.has(packKey)) return packAvatarCache.get(packKey)!;
  const entries = buildPackAvatars(packKey);
  packAvatarCache.set(packKey, entries);
  return entries;
}

function getPackForKey(key: AvatarStyleKey): AvatarPack | undefined {
  const pack = AVATAR_PACKS.find((p) => p.key === key);
  return pack;
}

const svgCache = new Map<string, string>();

type AvatarRenderOptions = {
  animate?: boolean;
};

export function getAvatarSvg(avatarId: string, options: AvatarRenderOptions = {}): string | null {
  const cacheKey = `${avatarId}:${options.animate === false ? "static" : "animated"}`;
  if (svgCache.has(cacheKey)) return svgCache.get(cacheKey)!;
  const parsed = parseAvatarId(avatarId);
  if (!parsed || parsed.index < 0 || parsed.index >= SEEDS.length) return null;
  const pack = getPackForKey(parsed.packKey);
  if (!pack) return null;
  const scale = PACK_SCALES[parsed.packKey] ?? 1;
  const svg = new Avatar(pack.style, {
    seed: SEEDS[parsed.index],
    size: 128,
    scale,
    idRandomization: true,
    ...(pack.animated && options.animate !== false ? { animationVariant: "medium" } : {}),
  }).toString();
  svgCache.set(cacheKey, svg);
  return svg;
}

export function getAvatarDataUri(avatarId: string, options: AvatarRenderOptions = {}): string | null {
  const svg = getAvatarSvg(avatarId, options);
  return svg ? `data:image/svg+xml;utf8,${encodeURIComponent(svg)}` : null;
}

export function getAvatarById(avatarId: string): AvatarEntry | undefined {
  const parsed = parseAvatarId(avatarId);
  if (!parsed || parsed.index < 0 || parsed.index >= SEEDS.length) return undefined;
  return {
    id: avatarId,
    seed: SEEDS[parsed.index],
    label: SEED_LABELS[parsed.index],
    packKey: parsed.packKey,
  };
}

export function getAllAvatars(): AvatarEntry[] {
  return getAvatarsForPack("bigSmile");
}

export function getPackKeyFromAvatarId(avatarId: string): AvatarStyleKey {
  const parsed = parseAvatarId(avatarId);
  return parsed?.packKey || "bigSmile";
}
