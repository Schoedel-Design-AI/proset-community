import AsyncStorage from "@react-native-async-storage/async-storage";

// NOTE: Streak/gamification system is intentionally disabled.
// All functions return zero/empty values. The StreakBanner component
// has been removed from the home screen. Do not re-enable without
// explicit product direction.
// See cleanup commit for context.

const STREAK_KEY = "engagement:streak";
const LAST_DATE_KEY = "engagement:lastRecordDate";
const LIFETIME_KEY = "engagement:lifetimeRecordings";

export type StreakState = {
  currentStreak: number;
  lastRecordDate: string | null; // YYYY-MM-DD
};

export type StreakMilestone = {
  days: number;
  label: string;
  reward: string;
};

export const STREAK_MILESTONES: StreakMilestone[] = [
  { days: 3, label: "3-day streak", reward: "+5 transcriptions" },
  { days: 7, label: "7-day streak", reward: "+10 transcriptions, +50MB storage" },
  { days: 30, label: "30-day streak", reward: "+25 transcriptions, +250MB storage, Early Adopter badge" },
];

export function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

export function yesterdayStr(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

export async function getStreak(): Promise<StreakState> {
  try {
    const raw = await AsyncStorage.getItem(STREAK_KEY);
    const lastDate = await AsyncStorage.getItem(LAST_DATE_KEY);
    const streak = raw ? parseInt(raw, 10) : 0;
    const today = todayStr();

    // Check if streak is still active
    if (!lastDate) return { currentStreak: 0, lastRecordDate: null };
    if (lastDate === today) return { currentStreak: streak, lastRecordDate: lastDate };
    if (lastDate === yesterdayStr()) return { currentStreak: streak, lastRecordDate: lastDate };

    // Streak broken — more than 1 day gap
    await AsyncStorage.removeMany([STREAK_KEY, LAST_DATE_KEY]);
    return { currentStreak: 0, lastRecordDate: null };
  } catch {
    return { currentStreak: 0, lastRecordDate: null };
  }
}

// Streaks disabled — always returns zero
export async function recordCompleted(): Promise<StreakState> {
  return { currentStreak: 0, lastRecordDate: null };
}

export async function getLifetimeRecordings(): Promise<number> {
  try {
    return parseInt((await AsyncStorage.getItem(LIFETIME_KEY)) || "0", 10);
  } catch {
    return 0;
  }
}

export function getNextMilestone(streak: number): StreakMilestone | null {
  return STREAK_MILESTONES.find((m) => m.days > streak) || null;
}

export function getReachedMilestone(streak: number): StreakMilestone | null {
  const reached = [...STREAK_MILESTONES].reverse().find((m) => streak >= m.days);
  return reached || null;
}
