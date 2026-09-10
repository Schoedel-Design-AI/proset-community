// Thin persistence for Slide Deck conversions: quota counters + deck records.
// Uses Firestore in production; falls back to in-memory maps in dev/tests
// (mirrors firestore-storage's dev mode so unit tests run without Firebase).
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { useFirebase } from "../../firebase-admin";
import { DECK_LIMITS, type DeckSlide } from "@shared/deck-styles";

export interface DeckRecord {
  id: string;
  userId: string;
  recordingId?: string;
  style: string;
  title: string;
  slides: DeckSlide[];
  /** Durable copy of the generated .pptx (base64) — object storage is
   *  local/ephemeral on Cloud Run, so the deck file lives with its record. */
  pptxBase64: string;
  createdAt: string;
}

const dayKey = (d: Date = new Date()) =>
  `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;

const memory = {
  decks: new Map<string, DeckRecord>(),
  dailyCounts: new Map<string, number>(),
};

function firestore() {
  return getFirestore();
}

/** Returns { allowed, used, limit } for the global daily deck quota. */
export async function checkGlobalDailyDeckQuota(): Promise<{ allowed: boolean; used: number; limit: number }> {
  const key = dayKey();
  if (!useFirebase) {
    const used = memory.dailyCounts.get(key) ?? 0;
    return { allowed: used < DECK_LIMITS.globalPerDay, used, limit: DECK_LIMITS.globalPerDay };
  }
  const doc = firestore().collection("slideDeckDaily").doc(key);
  const snap = await doc.get();
  const used = Number(snap.exists ? snap.data()?.count ?? 0 : 0);
  return { allowed: used < DECK_LIMITS.globalPerDay, used, limit: DECK_LIMITS.globalPerDay };
}

/** Atomically increments the global daily counter. Call after a deck is successfully generated. */
export async function recordDeckGeneration(): Promise<void> {
  const dayKeyValue = dayKey();
  if (!useFirebase) {
    memory.dailyCounts.set(dayKeyValue, (memory.dailyCounts.get(dayKeyValue) ?? 0) + 1);
    return;
  }
  const db = firestore();
  const dayRef = db.collection("slideDeckDaily").doc(dayKeyValue);
  await db.runTransaction(async (tx) => {
    tx.set(dayRef, { count: FieldValue.increment(1) }, { merge: true });
  });
}

export async function saveDeck(record: DeckRecord): Promise<void> {
  if (!useFirebase) {
    memory.decks.set(record.id, record);
    return;
  }
  await firestore().collection("slideDecks").doc(record.id).set(record);
}

export async function getDeck(id: string): Promise<DeckRecord | null> {
  if (!useFirebase) {
    return memory.decks.get(id) ?? null;
  }
  const doc = await firestore().collection("slideDecks").doc(id).get();
  if (!doc.exists) return null;
  return doc.data() as DeckRecord;
}

// Test helper
export function _resetDeckMemory() {
  memory.decks.clear();
  memory.dailyCounts.clear();
}
