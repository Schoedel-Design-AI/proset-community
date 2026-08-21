import { getApps, initializeApp, cert } from "firebase-admin/app";
import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { z } from "zod";
import {
  User, InsertUser,
  Recording, InsertRecording,
  Session, Account, Verification,
  BackupProvider, BackupLog, TaskProvider, CalendarProvider, ConnectorProvider, TrustedDevice,
  UsageEvent, StylePreference, UserFolder, UserFile, UsageLimit, UsageReservation, UserSkill,
  UserKnowledgebase, UserLearning, UserAiModelPreference, BucketFile, KbPrompt, KbPromptSkill,
  Passkey, UserModule, Coupon, DeveloperApiKey, ThoughtThread, ThoughtThreadItem, ThoughtThreadContext,
  ThoughtThreadConversionRun, ThoughtThreadRunChunk, RecordingContextSource
} from "@shared/schema";
import { IStorage } from "./storage";
import type {
  RevenueCatWebhookApplyResult,
  RevenueCatWebhookEventRecord,
} from "./storage";

let serviceAccount: any = null;
const credPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH || process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (credPath && fs.existsSync(credPath)) {
  try {
    serviceAccount = JSON.parse(fs.readFileSync(credPath, "utf8"));
  } catch (err) {
    console.error("Failed to parse Firebase service account JSON from path:", credPath, err);
  }
}

const hasFirebaseCreds = !!(
  serviceAccount ||
  (process.env.FIREBASE_PROJECT_ID &&
   process.env.FIREBASE_CLIENT_EMAIL &&
   process.env.FIREBASE_PRIVATE_KEY)
);

const isGcpEnvironment = !!(
  process.env.K_SERVICE ||
  process.env.GOOGLE_APPLICATION_CREDENTIALS ||
  process.env.NODE_ENV === "production"
);

// Global in-memory DB fallback
const localDb = new Map<string, Map<string, any>>();
const MOCK_DB_PATH = process.env.MOCK_DB_PATH || path.join(process.cwd(), "audio-uploads", "mock-db.json");

function loadMockDb() {
  try {
    if (fs.existsSync(MOCK_DB_PATH)) {
      const data = JSON.parse(fs.readFileSync(MOCK_DB_PATH, "utf8"));
      for (const [colName, docs] of Object.entries(data)) {
        const colMap = new Map();
        for (const [id, doc] of Object.entries(docs as any)) {
          colMap.set(id, doc);
        }
        localDb.set(colName, colMap);
      }
      console.log("Mock database loaded successfully from", MOCK_DB_PATH);
    }
  } catch (err) {
    console.error("Failed to load mock DB:", err);
  }
}

let writeQueuePromise: Promise<void> = Promise.resolve();
const localMutationQueues = new Map<string, Promise<void>>();

async function withLocalMutationLock<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const previous = localMutationQueues.get(key) || Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.then(() => gate);
  localMutationQueues.set(key, tail);
  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (localMutationQueues.get(key) === tail) localMutationQueues.delete(key);
  }
}

function saveMockDb(): Promise<void> {
  writeQueuePromise = writeQueuePromise.then(async () => {
    try {
      const dir = path.dirname(MOCK_DB_PATH);
      if (!fs.existsSync(dir)) {
        await fs.promises.mkdir(dir, { recursive: true });
      }
      const data: any = {};
      for (const [colName, colMap] of localDb.entries()) {
        data[colName] = {};
        for (const [id, doc] of colMap.entries()) {
          data[colName][id] = doc;
        }
      }
      const tmpPath = `${MOCK_DB_PATH}.tmp`;
      await fs.promises.writeFile(tmpPath, JSON.stringify(data, null, 2), "utf8");
      await fs.promises.rename(tmpPath, MOCK_DB_PATH);
    } catch (err) {
      console.error("Failed to save mock DB asynchronously:", err);
    }
  });
  return writeQueuePromise;
}

// Initialize mock db
loadMockDb();

const LEGACY_ENCRYPTION_KEY_SEED = "default-dev-db-encryption-key-seed-32";
const encryptionKeySeed = process.env.DB_ENCRYPTION_KEY
  || process.env.BETTER_AUTH_SECRET
  || LEGACY_ENCRYPTION_KEY_SEED;
const ENCRYPTION_KEY = crypto.createHash("sha256").update(encryptionKeySeed).digest();
const LEGACY_ENCRYPTION_KEY = crypto.createHash("sha256").update(LEGACY_ENCRYPTION_KEY_SEED).digest();
const ENCRYPTION_ALGORITHM = "aes-256-gcm";

function encryptConfig(config: any): any {
  if (!config) return config;
  try {
    const text = JSON.stringify(config);
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, ENCRYPTION_KEY, iv);
    let encrypted = cipher.update(text, "utf8", "hex");
    encrypted += cipher.final("hex");
    const authTag = cipher.getAuthTag().toString("hex");
    return {
      __encrypted: true,
      iv: iv.toString("hex"),
      content: encrypted,
      tag: authTag
    };
  } catch (err) {
    console.error("Encryption failed:", err);
    return config;
  }
}

function decryptConfig(config: any): any {
  if (!config || typeof config !== "object" || !config.__encrypted) {
    return config;
  }
  const keys = encryptionKeySeed === LEGACY_ENCRYPTION_KEY_SEED
    ? [ENCRYPTION_KEY]
    : [ENCRYPTION_KEY, LEGACY_ENCRYPTION_KEY];
  for (const key of keys) {
    try {
      const { iv, content, tag } = config;
      const decipher = crypto.createDecipheriv(
        ENCRYPTION_ALGORITHM,
        key,
        Buffer.from(iv, "hex")
      );
      decipher.setAuthTag(Buffer.from(tag, "hex"));
      let decrypted = decipher.update(content, "hex", "utf8");
      decrypted += decipher.final("utf8");
      return JSON.parse(decrypted);
    } catch {
      // Try the legacy key next. It preserves records written before the
      // production-safe server-secret fallback was introduced.
    }
  }
  console.error("Decryption failed, returning raw encrypted config.");
  return config;
}

// Zod schemas for database write validation
const UserValidator = z.object({
  id: z.string(),
  email: z.string().email(),
  name: z.string(),
  userNumber: z.number().int(),
  role: z.string(),
  cachedTier: z.string(),
}).passthrough();

const RecordingValidator = z.object({
  id: z.string(),
  userId: z.string(),
  title: z.string(),
  duration: z.number(),
  audioUri: z.string(),
}).passthrough();

let dbClient: any = null;
if (hasFirebaseCreds || isGcpEnvironment) {
  if (!getApps().length) {
    if (hasFirebaseCreds) {
      const cred = serviceAccount
        ? cert(serviceAccount)
        : cert({
            projectId: process.env.FIREBASE_PROJECT_ID,
            clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
            privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
          });
      initializeApp({
        credential: cred,
      });
    } else {
      // In GCP (Cloud Run), initializeApp() uses Application Default Credentials
      initializeApp();
    }
  }
  const firestoreInstance = getFirestore();
  firestoreInstance.settings({ ignoreUndefinedProperties: true });
  dbClient = firestoreInstance;
  console.log("Firestore client initialized successfully with ignoreUndefinedProperties enabled.");
} else {
  console.warn("WARNING: Firebase credentials are not set. Using local in-memory document store.");
}

async function runBulkWriter(
  enqueue: (writer: any) => Array<Promise<unknown>>,
): Promise<void> {
  if (!dbClient) throw new Error("BulkWriter requires Firestore.");
  const writer = dbClient.bulkWriter();
  writer.onWriteError((error: any) => error.failedAttempts < 5);
  const pending = enqueue(writer);
  await writer.close();
  const results = await Promise.allSettled(pending);
  const failures = results.filter((result) => result.status === "rejected");
  if (failures.length > 0) {
    throw new Error(`Firestore bulk operation failed for ${failures.length} document${failures.length === 1 ? "" : "s"}.`);
  }
}

async function bulkDeleteDocumentRefs(refs: any[]): Promise<void> {
  if (refs.length === 0) return;
  await runBulkWriter((writer) => refs.map((ref) => writer.delete(ref)));
}

// Helper to normalize Firestore Timestamp fields to Date objects
function normalizeDoc(data: any): any {
  if (!data || typeof data !== "object") return data;
  
  const dateKeys = [
    "createdAt", "updatedAt", "expiresAt", "lastUsedAt", "lastBackupAt", 
    "assignedAt", "cloudSyncGracePeriodEnd", 
    "friendsOfBarryExpiresAt", "friendsOfBarryRenewedAt", "passwordLastChanged", 
    "tierCachedAt", "completedAt", "startedAt", "leaseExpiresAt",
    "committedAt", "releasedAt", "transcriptUpdatedAt", "lastConvertedAt"
  ];
  
  for (const key of dateKeys) {
    if (data[key] !== undefined && data[key] !== null) {
      const val = data[key];
      if (val instanceof Timestamp) {
        data[key] = val.toDate();
      } else if (typeof val === "object" && typeof val.seconds === "number" && typeof val.nanoseconds === "number") {
        data[key] = new Timestamp(val.seconds, val.nanoseconds).toDate();
      } else if (typeof val === "string") {
        data[key] = new Date(val);
      }
    }
  }
  return data;
}

// Pass-through since ignoreUndefinedProperties is enabled on the client
function sanitizeForFirestore(data: any): any {
  return data;
}

function getTimestampMillis(value: unknown): number | null {
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (value instanceof Date) return value.getTime();
  if (
    value
    && typeof value === "object"
    && "toMillis" in value
    && typeof (value as { toMillis?: unknown }).toMillis === "function"
  ) {
    return (value as { toMillis(): number }).toMillis();
  }
  return null;
}

export function isRevenueCatEventStale(
  currentLastEventAt: unknown,
  incomingEventTimestampMs: number | null,
): boolean {
  if (incomingEventTimestampMs === null) return false;
  const currentTimestampMs = getTimestampMillis(currentLastEventAt);
  return currentTimestampMs !== null && incomingEventTimestampMs < currentTimestampMs;
}

interface TypedCollection<T> {
  get(id: string): Promise<T | undefined>;
  set(id: string, data: any): Promise<T>;
  delete(id: string): Promise<boolean>;
  list(): Promise<T[]>;
  query(filterFn: (doc: T) => boolean): Promise<T[]>;
  [key: string]: any;
}

class LocalCollection<T = any> implements TypedCollection<T> {
  constructor(private name: string) {}

  private getMap(): Map<string, any> {
    if (!localDb.has(this.name)) {
      localDb.set(this.name, new Map());
    }
    return localDb.get(this.name)!;
  }

  async get(id: string): Promise<T | undefined> {
    const doc = this.getMap().get(id);
    return doc ? normalizeDoc(structuredClone(doc)) : undefined;
  }

  async set(id: string, data: any): Promise<T> {
    const map = this.getMap();
    const existing = map.get(id) || {};
    const updated = normalizeDoc({
      ...existing,
      ...data,
      id,
      createdAt: existing.createdAt || data.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    map.set(id, updated);
    await saveMockDb();
    return updated as T;
  }

  async delete(id: string): Promise<boolean> {
    const map = this.getMap();
    const deleted = map.delete(id);
    if (deleted) {
      await saveMockDb();
    }
    return deleted;
  }

  async list(): Promise<T[]> {
    return normalizeDoc(structuredClone(Array.from(this.getMap().values())));
  }

  async query(filterFn: (doc: T) => boolean): Promise<T[]> {
    return (await this.list()).filter(filterFn);
  }
}

export class FirestoreStorage implements IStorage {
  private getCol<T = any>(name: string): TypedCollection<T> {
    if (dbClient) {
      return dbClient.collection(name) as any;
    }
    return new LocalCollection<T>(name);
  }

  // Legacy backwards compatibility implementations
  async getUser(id: string): Promise<User | undefined> { return this.users.get(id); }
  async getUserByEmail(email: string): Promise<User | undefined> { return this.users.getByEmail(email); }
  async createUser(user: InsertUser): Promise<User> { return this.users.create(user); }
  async getRecordingsByUser(userId: string): Promise<Recording[]> { return this.recordings.getByUser(userId); }
  async getRecordingsByUserPaginated(userId: string, options: { page?: number; limit?: number; search?: string }): Promise<{ recordings: Recording[]; total: number }> {
    return this.recordings.getByUserPaginated(userId, options);
  }
  async getRecording(id: string, userId: string): Promise<Recording | undefined> { return this.recordings.get(id, userId); }
  async createRecording(recording: InsertRecording): Promise<Recording> { return this.recordings.create(recording); }
  async updateRecording(id: string, userId: string, updates: Partial<InsertRecording>): Promise<Recording | undefined> {
    return this.recordings.update(id, userId, updates);
  }
  async deleteRecording(id: string, userId: string): Promise<boolean> { return this.recordings.delete(id, userId); }

  // User Repository
  users = {
    get: async (id: string): Promise<User | undefined> => {
      const col = this.getCol("users");
      if (dbClient) {
        const doc = await col.doc(id).get();
        if (!doc.exists) return undefined;
        return normalizeDoc({ ...doc.data(), id: doc.id });
      } else {
        return col.get(id);
      }
    },
    getByEmail: async (email: string): Promise<User | undefined> => {
      const col = this.getCol("users");
      const cleanEmail = email.toLowerCase().trim();
      if (dbClient) {
        const snap = await col.where("email", "==", cleanEmail).limit(1).get();
        if (snap.empty) return undefined;
        const doc = snap.docs[0];
        return normalizeDoc({ ...doc.data(), id: doc.id });
      } else {
        const results = await col.query(u => String(u.email || "").toLowerCase() === cleanEmail);
        return results[0];
      }
    },
    getByStripeCustomerId: async (customerId: string): Promise<User | undefined> => {
      const col = this.getCol("users");
      if (dbClient) {
        const snap = await col.where("stripeCustomerId", "==", customerId).limit(1).get();
        if (snap.empty) return undefined;
        const doc = snap.docs[0];
        return normalizeDoc({ ...doc.data(), id: doc.id });
      } else {
        const results = await col.query(u => u.stripeCustomerId === customerId);
        return results[0];
      }
    },
    create: async (user: InsertUser): Promise<User> => {
      const col = this.getCol("users");
      const id = user.id || `usr_${Math.random().toString(36).substring(2, 11)}`;
      const cleanUser = {
        ...user,
        id,
        email: user.email.toLowerCase().trim(),
        userNumber: user.userNumber || Math.floor(Math.random() * 1000000),
        cloudSyncEnabled: user.cloudSyncEnabled ?? 0,
        forcePasswordChange: user.forcePasswordChange ?? 0,
        twoFactorEnabled: user.twoFactorEnabled ?? 0,
        proAccessEnabled: user.proAccessEnabled ?? 0,
        hasSeenPlanSelection: user.hasSeenPlanSelection ?? 0,
        role: user.role || "user",
        cachedTier: user.cachedTier || "free",
        createdAt: user.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      UserValidator.parse(cleanUser);
      if (dbClient) {
        await col.doc(id).set(sanitizeForFirestore(cleanUser));
        return cleanUser as User;
      } else {
        return col.set(id, cleanUser);
      }
    },
    update: async (id: string, updates: Partial<User>): Promise<User> => {
      const col = this.getCol("users");
      const cleanUpdates = { ...updates, updatedAt: new Date().toISOString() };
      UserValidator.partial().parse(cleanUpdates);
      if (dbClient) {
        await col.doc(id).update(sanitizeForFirestore(cleanUpdates));
        const updatedDoc = await col.doc(id).get();
        return normalizeDoc({ ...updatedDoc.data(), id: updatedDoc.id }) as User;
      } else {
        return col.set(id, cleanUpdates);
      }
    },
    delete: async (id: string): Promise<boolean> => {
      const col = this.getCol("users");
      if (dbClient) {
        await col.doc(id).delete();
        return true;
      } else {
        return col.delete(id);
      }
    },
    list: async (): Promise<User[]> => {
      const col = this.getCol("users");
      if (dbClient) {
        const snap = await (col as any).get();
        return snap.docs.map((doc: any) => normalizeDoc({ ...doc.data(), id: doc.id }));
      } else {
        return col.list();
      }
    },
    count: async (): Promise<number> => {
      const col = this.getCol("users");
      if (dbClient) {
        const snap = await col.count().get();
        return snap.data().count;
      } else {
        return (await col.list()).length;
      }
    }
  };

  revenueCatEvents = {
    apply: async (
      event: RevenueCatWebhookEventRecord,
      updates: Partial<User>,
    ): Promise<RevenueCatWebhookApplyResult> => {
      const eventDocumentId = crypto.createHash("sha256").update(event.id).digest("hex");
      const eventCol = this.getCol<any>("revenuecat_webhook_events");
      const userCol = this.getCol<User>("users");
      const now = new Date().toISOString();
      const eventRecord = {
        ...event,
        receivedAt: now,
      };

      if (dbClient) {
        return dbClient.runTransaction(async (transaction: any) => {
          const eventRef = eventCol.doc(eventDocumentId);
          const userRef = userCol.doc(event.userId);
          const [existingEvent, userDocument] = await Promise.all([
            transaction.get(eventRef),
            transaction.get(userRef),
          ]);

          if (existingEvent.exists) return "duplicate";
          if (!userDocument.exists) {
            transaction.create(eventRef, sanitizeForFirestore({
              ...eventRecord,
              outcome: "user_not_found",
            }));
            return "user_not_found";
          }
          if (
            isRevenueCatEventStale(
              userDocument.data()?.revenueCatLastEventAt,
              event.eventTimestampMs,
            )
          ) {
            transaction.create(eventRef, sanitizeForFirestore({
              ...eventRecord,
              outcome: "stale",
            }));
            return "stale";
          }

          transaction.update(userRef, sanitizeForFirestore({
            ...updates,
            updatedAt: now,
          }));
          transaction.create(eventRef, sanitizeForFirestore({
            ...eventRecord,
            outcome: "applied",
          }));
          return "applied";
        });
      }

      return withLocalMutationLock(`revenuecat:${eventDocumentId}`, async () => {
        const existingEvent = await eventCol.get(eventDocumentId);
        if (existingEvent) return "duplicate";
        const user = await userCol.get(event.userId);
        if (!user) {
          await eventCol.set(eventDocumentId, {
            ...eventRecord,
            outcome: "user_not_found",
          });
          return "user_not_found";
        }
        if (isRevenueCatEventStale(user.revenueCatLastEventAt, event.eventTimestampMs)) {
          await eventCol.set(eventDocumentId, {
            ...eventRecord,
            outcome: "stale",
          });
          return "stale";
        }
        await userCol.set(event.userId, {
          ...updates,
          updatedAt: now,
        });
        await eventCol.set(eventDocumentId, {
          ...eventRecord,
          outcome: "applied",
        });
        return "applied";
      });
    },
  };

  // Recording Repository
  recordings = {
    get: async (id: string, userId: string): Promise<Recording | undefined> => {
      const col = this.getCol("recordings");
      if (dbClient) {
        const doc = await col.doc(id).get();
        if (!doc.exists) return undefined;
        const data = doc.data();
        if (data.userId !== userId) return undefined;
        return normalizeDoc({ ...data, id: doc.id });
      } else {
        const rec = await col.get(id);
        return rec && rec.userId === userId ? rec : undefined;
      }
    },
    getByUser: async (userId: string): Promise<Recording[]> => {
      const col = this.getCol("recordings");
      if (dbClient) {
        const snap = await col.where("userId", "==", userId).orderBy("createdAt", "desc").get();
        return snap.docs.map((doc: any) => normalizeDoc({ ...doc.data(), id: doc.id }));
      } else {
        const list = await col.query(r => r.userId === userId);
        return list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      }
    },
    getByUserPaginated: async (userId: string, options: { page?: number; limit?: number; search?: string }): Promise<{ recordings: Recording[]; total: number }> => {
      const page = options.page || 1;
      const limit = Math.min(options.limit || 50, 100);
      const search = options.search ? options.search.toLowerCase().trim() : "";
      const col = this.getCol("recordings");

      if (dbClient) {
        if (search) {
          const snap = await col.where("userId", "==", userId).orderBy("createdAt", "desc").get();
          const allRecordings = snap.docs.map((doc: any) => normalizeDoc({ ...doc.data(), id: doc.id }) as Recording);
          const filtered = allRecordings.filter((r: Recording) =>
            String(r.title || "").toLowerCase().includes(search) ||
            String(r.transcript || "").toLowerCase().includes(search)
          );
          const total = filtered.length;
          const start = (page - 1) * limit;
          const paginated = filtered.slice(start, start + limit);
          return { recordings: paginated, total };
        } else {
          const countSnap = await col.where("userId", "==", userId).count().get();
          const total = countSnap.data().count;
          const offset = (page - 1) * limit;
          const snap = await col.where("userId", "==", userId)
            .orderBy("createdAt", "desc")
            .offset(offset)
            .limit(limit)
            .get();
          const recordings = snap.docs.map((doc: any) => normalizeDoc({ ...doc.data(), id: doc.id }));
          return { recordings, total };
        }
      } else {
        const allRecordings = await this.recordings.getByUser(userId);
        const filtered = search
          ? allRecordings.filter(r =>
              String(r.title || "").toLowerCase().includes(search) ||
              String(r.transcript || "").toLowerCase().includes(search)
            )
          : allRecordings;
        const total = filtered.length;
        const start = (page - 1) * limit;
        const paginated = filtered.slice(start, start + limit);
        return { recordings: paginated, total };
      }
    },
    create: async (recording: InsertRecording): Promise<Recording> => {
      const col = this.getCol("recordings");
      const id = recording.id || `rec_${Math.random().toString(36).substring(2, 11)}`;
      const cleanRecording = {
        ...recording,
        id,
        duration: recording.duration || 0,
        audioUri: recording.audioUri || "",
        transcript: recording.transcript || "",
        conversions: recording.conversions || {},
        createdAt: recording.createdAt || new Date().toISOString()
      };
      RecordingValidator.parse(cleanRecording);
      if (dbClient) {
        await col.doc(id).set(sanitizeForFirestore(cleanRecording));
        return cleanRecording as Recording;
      } else {
        return col.set(id, cleanRecording);
      }
    },
    update: async (id: string, userId: string, updates: Partial<Recording>): Promise<Recording | undefined> => {
      const existing = await this.recordings.get(id, userId);
      if (!existing) return undefined;

      const col = this.getCol("recordings");
      const { id: _, userId: __, ...safeUpdates } = updates;
      RecordingValidator.partial().parse(safeUpdates);
      if (dbClient) {
        await col.doc(id).update(sanitizeForFirestore(safeUpdates));
        const updatedDoc = await col.doc(id).get();
        return normalizeDoc({ ...updatedDoc.data(), id: updatedDoc.id }) as Recording;
      } else {
        return col.set(id, safeUpdates);
      }
    },
    delete: async (id: string, userId: string): Promise<boolean> => {
      const existing = await this.recordings.get(id, userId);
      if (!existing) return false;

      const col = this.getCol("recordings");
      if (dbClient) {
        await col.doc(id).delete();
        return true;
      } else {
        return col.delete(id);
      }
    },
    countAll: async (): Promise<number> => {
      const col = this.getCol("recordings");
      if (dbClient) {
        const snap = await col.count().get();
        return snap.data().count;
      } else {
        return (await col.list()).length;
      }
    }
  };

  // Thought Thread repositories. Thread-owned records are deliberately
  // normalized so membership/context edits cannot mutate source recordings.
  thoughtThreads = {
    get: async (id: string, userId: string): Promise<ThoughtThread | undefined> => {
      const col = this.getCol<ThoughtThread>("thoughtThreads");
      const value = dbClient
        ? await (async () => {
            const doc = await col.doc(id).get();
            return doc.exists ? normalizeDoc({ ...doc.data(), id: doc.id }) : undefined;
          })()
        : await col.get(id);
      return value && value.userId === userId ? value : undefined;
    },
    getByUser: async (userId: string): Promise<ThoughtThread[]> => {
      const col = this.getCol<ThoughtThread>("thoughtThreads");
      const values = dbClient
        ? (await col.where("userId", "==", userId).get()).docs.map((doc: any) =>
            normalizeDoc({ ...doc.data(), id: doc.id }) as ThoughtThread)
        : await col.query((value) => value.userId === userId);
      return (values as ThoughtThread[]).sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    },
    create: async (thread: ThoughtThread): Promise<ThoughtThread> => {
      const col = this.getCol<ThoughtThread>("thoughtThreads");
      if (dbClient) {
        await col.doc(thread.id).set(sanitizeForFirestore(thread));
        return thread;
      }
      return col.set(thread.id, thread);
    },
    update: async (id: string, userId: string, updates: Partial<ThoughtThread>): Promise<ThoughtThread | undefined> => {
      const existing = await this.thoughtThreads.get(id, userId);
      if (!existing) return undefined;
      const col = this.getCol<ThoughtThread>("thoughtThreads");
      const { id: _id, userId: _userId, createdAt: _createdAt, ...allowed } = updates;
      const cleanUpdates = { ...allowed, updatedAt: new Date().toISOString() };
      const requestedVersion = typeof cleanUpdates.version === "number" ? cleanUpdates.version : undefined;
      if (dbClient) {
        if (requestedVersion !== undefined) {
          const ref = col.doc(id);
          return dbClient.runTransaction(async (transaction: any) => {
            const doc = await transaction.get(ref);
            if (!doc.exists) return undefined;
            const current = normalizeDoc({ ...doc.data(), id: doc.id }) as ThoughtThread;
            if (current.userId !== userId || current.version + 1 !== requestedVersion) {
              return undefined;
            }
            transaction.update(ref, sanitizeForFirestore(cleanUpdates));
            return normalizeDoc({ ...current, ...cleanUpdates, id }) as ThoughtThread;
          });
        }
        await col.doc(id).update(sanitizeForFirestore(cleanUpdates));
        const doc = await col.doc(id).get();
        return normalizeDoc({ ...doc.data(), id: doc.id }) as ThoughtThread;
      }
      if (requestedVersion !== undefined && existing.version + 1 !== requestedVersion) {
        return undefined;
      }
      return col.set(id, cleanUpdates);
    },
    incrementRunCount: async (id: string, userId: string): Promise<ThoughtThread | undefined> => {
      const col = this.getCol<ThoughtThread>("thoughtThreads");
      if (dbClient) {
        const ref = col.doc(id);
        return dbClient.runTransaction(async (transaction: any) => {
          const doc = await transaction.get(ref);
          if (!doc.exists) return undefined;
          const current = normalizeDoc({ ...doc.data(), id: doc.id }) as ThoughtThread;
          if (current.userId !== userId) return undefined;
          const updated = {
            ...current,
            runCount: (current.runCount || 0) + 1,
            updatedAt: new Date().toISOString(),
          };
          transaction.update(ref, {
            runCount: updated.runCount,
            updatedAt: updated.updatedAt,
          });
          return updated;
        });
      }
      const existing = await col.get(id);
      if (!existing || existing.userId !== userId) return undefined;
      return col.set(id, { runCount: (existing.runCount || 0) + 1 });
    },
    commitMutation: async (
      id: string,
      userId: string,
      expectedVersion: number,
      mutation: {
        threadUpdates?: Partial<ThoughtThread>;
        createItems?: ThoughtThreadItem[];
        updateItems?: Array<{ id: string; updates: Partial<ThoughtThreadItem> }>;
        deleteItemIds?: string[];
        createContexts?: ThoughtThreadContext[];
        updateContexts?: Array<{ id: string; updates: Partial<ThoughtThreadContext> }>;
        deleteContextIds?: string[];
      },
    ): Promise<ThoughtThread | undefined> => {
      const threadCol = this.getCol<ThoughtThread>("thoughtThreads");
      const itemCol = this.getCol<ThoughtThreadItem>("thoughtThreadItems");
      const contextCol = this.getCol<ThoughtThreadContext>("thoughtThreadContexts");
      const now = new Date().toISOString();
      const applyThreadUpdates = (current: ThoughtThread) => ({
        ...mutation.threadUpdates,
        version: current.version + 1,
        updatedAt: now,
      });

      if (dbClient) {
        const threadRef = threadCol.doc(id);
        return dbClient.runTransaction(async (transaction: any) => {
          const threadDoc = await transaction.get(threadRef);
          if (!threadDoc.exists) return undefined;
          const current = normalizeDoc({ ...threadDoc.data(), id: threadDoc.id }) as ThoughtThread;
          if (current.userId !== userId || current.version !== expectedVersion) return undefined;

          const itemRefs = [
            ...(mutation.updateItems || []).map((value) => itemCol.doc(value.id)),
            ...(mutation.deleteItemIds || []).map((value) => itemCol.doc(value)),
          ];
          const contextRefs = [
            ...(mutation.updateContexts || []).map((value) => contextCol.doc(value.id)),
            ...(mutation.deleteContextIds || []).map((value) => contextCol.doc(value)),
          ];
          const [itemDocs, contextDocs] = await Promise.all([
            Promise.all(itemRefs.map((ref: any) => transaction.get(ref))),
            Promise.all(contextRefs.map((ref: any) => transaction.get(ref))),
          ]);
          if (itemDocs.some((doc: any) =>
            !doc.exists || doc.data().userId !== userId || doc.data().threadId !== id)) return undefined;
          if (contextDocs.some((doc: any) =>
            !doc.exists || doc.data().userId !== userId || doc.data().threadId !== id)) return undefined;

          const threadUpdates = applyThreadUpdates(current);
          transaction.update(threadRef, sanitizeForFirestore(threadUpdates));
          for (const item of mutation.createItems || []) {
            transaction.create(itemCol.doc(item.id), sanitizeForFirestore(item));
          }
          for (const value of mutation.updateItems || []) {
            transaction.update(itemCol.doc(value.id), sanitizeForFirestore({
              ...value.updates,
              updatedAt: now,
            }));
          }
          for (const itemId of mutation.deleteItemIds || []) {
            transaction.delete(itemCol.doc(itemId));
          }
          for (const context of mutation.createContexts || []) {
            transaction.create(contextCol.doc(context.id), sanitizeForFirestore(context));
          }
          for (const value of mutation.updateContexts || []) {
            transaction.update(contextCol.doc(value.id), sanitizeForFirestore({
              ...value.updates,
              updatedAt: now,
            }));
          }
          for (const contextId of mutation.deleteContextIds || []) {
            transaction.delete(contextCol.doc(contextId));
          }
          return normalizeDoc({ ...current, ...threadUpdates, id }) as ThoughtThread;
        });
      }

      return withLocalMutationLock(`thread:${id}`, async () => {
        const current = await threadCol.get(id);
        if (!current || current.userId !== userId || current.version !== expectedVersion) return undefined;
        for (const value of mutation.updateItems || []) {
          const item = await itemCol.get(value.id);
          if (!item || item.userId !== userId || item.threadId !== id) return undefined;
        }
        for (const itemId of mutation.deleteItemIds || []) {
          const item = await itemCol.get(itemId);
          if (!item || item.userId !== userId || item.threadId !== id) return undefined;
        }
        for (const value of mutation.updateContexts || []) {
          const context = await contextCol.get(value.id);
          if (!context || context.userId !== userId || context.threadId !== id) return undefined;
        }
        for (const contextId of mutation.deleteContextIds || []) {
          const context = await contextCol.get(contextId);
          if (!context || context.userId !== userId || context.threadId !== id) return undefined;
        }
        const threadUpdates = applyThreadUpdates(current);
        await threadCol.set(id, threadUpdates);
        for (const item of mutation.createItems || []) await itemCol.set(item.id, item);
        for (const value of mutation.updateItems || []) {
          await itemCol.set(value.id, { ...value.updates, updatedAt: now });
        }
        for (const itemId of mutation.deleteItemIds || []) await itemCol.delete(itemId);
        for (const context of mutation.createContexts || []) await contextCol.set(context.id, context);
        for (const value of mutation.updateContexts || []) {
          await contextCol.set(value.id, { ...value.updates, updatedAt: now });
        }
        for (const contextId of mutation.deleteContextIds || []) await contextCol.delete(contextId);
        return normalizeDoc({ ...current, ...threadUpdates, id }) as ThoughtThread;
      });
    },
    createWithItems: async (thread: ThoughtThread, items: ThoughtThreadItem[]): Promise<ThoughtThread> => {
      const threadCol = this.getCol<ThoughtThread>("thoughtThreads");
      const itemCol = this.getCol<ThoughtThreadItem>("thoughtThreadItems");
      if (dbClient) {
        const batch = dbClient.batch();
        batch.create(threadCol.doc(thread.id), sanitizeForFirestore(thread));
        for (const item of items) batch.create(itemCol.doc(item.id), sanitizeForFirestore(item));
        await batch.commit();
        return thread;
      }
      await threadCol.set(thread.id, thread);
      for (const item of items) await itemCol.set(item.id, item);
      return thread;
    },
    createRunWithChunks: async (
      id: string,
      userId: string,
      expectedVersion: number,
      run: ThoughtThreadConversionRun,
      chunks: ThoughtThreadRunChunk[],
    ): Promise<ThoughtThread | undefined> => {
      const threadCol = this.getCol<ThoughtThread>("thoughtThreads");
      const runCol = this.getCol<ThoughtThreadConversionRun>("thoughtThreadRuns");
      const chunkCol = this.getCol<ThoughtThreadRunChunk>("thoughtThreadRunChunks");
      const now = new Date().toISOString();
      if (dbClient) {
        const threadRef = threadCol.doc(id);
        return dbClient.runTransaction(async (transaction: any) => {
          const doc = await transaction.get(threadRef);
          if (!doc.exists) return undefined;
          const current = normalizeDoc({ ...doc.data(), id: doc.id }) as ThoughtThread;
          if (current.userId !== userId || current.version !== expectedVersion) return undefined;
          transaction.create(runCol.doc(run.id), sanitizeForFirestore(run));
          for (const chunk of chunks) {
            transaction.create(chunkCol.doc(chunk.id), sanitizeForFirestore(chunk));
          }
          const updated = {
            ...current,
            runCount: (current.runCount || 0) + 1,
            version: current.version + 1,
            updatedAt: now,
          };
          transaction.update(threadRef, {
            runCount: updated.runCount,
            version: updated.version,
            updatedAt: updated.updatedAt,
          });
          return updated;
        });
      }
      return withLocalMutationLock(`thread:${id}`, async () => {
        const current = await threadCol.get(id);
        if (!current || current.userId !== userId || current.version !== expectedVersion) return undefined;
        await runCol.set(run.id, run);
        for (const chunk of chunks) await chunkCol.set(chunk.id, chunk);
        const updated = await threadCol.set(id, {
          runCount: (current.runCount || 0) + 1,
          version: current.version + 1,
          updatedAt: now,
        });
        return updated;
      });
    },
    delete: async (id: string, userId: string): Promise<boolean> => {
      if (!await this.thoughtThreads.get(id, userId)) return false;
      const col = this.getCol<ThoughtThread>("thoughtThreads");
      if (dbClient) {
        await col.doc(id).delete();
        return true;
      }
      return col.delete(id);
    },
  };

  thoughtThreadItems = {
    getByThread: async (threadId: string, userId: string): Promise<ThoughtThreadItem[]> => {
      const col = this.getCol<ThoughtThreadItem>("thoughtThreadItems");
      const values = dbClient
        ? (await col.where("threadId", "==", threadId).get()).docs.map((doc: any) =>
            normalizeDoc({ ...doc.data(), id: doc.id }) as ThoughtThreadItem)
        : await col.query((value) => value.threadId === threadId);
      return (values as ThoughtThreadItem[]).filter((value) => value.userId === userId).sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
    },
    getByUser: async (userId: string): Promise<ThoughtThreadItem[]> => {
      const col = this.getCol<ThoughtThreadItem>("thoughtThreadItems");
      const values = dbClient
        ? (await col.where("userId", "==", userId).get()).docs.map((doc: any) =>
            normalizeDoc({ ...doc.data(), id: doc.id }) as ThoughtThreadItem)
        : await col.query((value) => value.userId === userId);
      return values as ThoughtThreadItem[];
    },
    getByRecording: async (recordingId: string, userId: string): Promise<ThoughtThreadItem[]> => {
      const col = this.getCol<ThoughtThreadItem>("thoughtThreadItems");
      const values = dbClient
        ? (await col.where("recordingId", "==", recordingId).get()).docs.map((doc: any) =>
            normalizeDoc({ ...doc.data(), id: doc.id }) as ThoughtThreadItem)
        : await col.query((value) => value.recordingId === recordingId);
      return (values as ThoughtThreadItem[]).filter((value) => value.userId === userId);
    },
    create: async (item: ThoughtThreadItem): Promise<ThoughtThreadItem> => {
      const col = this.getCol<ThoughtThreadItem>("thoughtThreadItems");
      if (dbClient) {
        await col.doc(item.id).set(sanitizeForFirestore(item));
        return item;
      }
      return col.set(item.id, item);
    },
    update: async (id: string, userId: string, updates: Partial<ThoughtThreadItem>): Promise<ThoughtThreadItem | undefined> => {
      const col = this.getCol<ThoughtThreadItem>("thoughtThreadItems");
      const existing = dbClient
        ? await (async () => {
            const doc = await col.doc(id).get();
            return doc.exists ? normalizeDoc({ ...doc.data(), id: doc.id }) as ThoughtThreadItem : undefined;
          })()
        : await col.get(id);
      if (!existing || existing.userId !== userId) return undefined;
      const { id: _id, userId: _userId, threadId: _threadId, recordingId: _recordingId, createdAt: _createdAt, ...allowed } = updates;
      const cleanUpdates = { ...allowed, updatedAt: new Date().toISOString() };
      if (dbClient) {
        await col.doc(id).update(sanitizeForFirestore(cleanUpdates));
        const doc = await col.doc(id).get();
        return normalizeDoc({ ...doc.data(), id: doc.id }) as ThoughtThreadItem;
      }
      return col.set(id, cleanUpdates);
    },
    delete: async (id: string, userId: string): Promise<boolean> => {
      const col = this.getCol<ThoughtThreadItem>("thoughtThreadItems");
      const existing = dbClient
        ? await (async () => {
            const doc = await col.doc(id).get();
            return doc.exists ? normalizeDoc({ ...doc.data(), id: doc.id }) as ThoughtThreadItem : undefined;
          })()
        : await col.get(id);
      if (!existing || existing.userId !== userId) return false;
      if (dbClient) await col.doc(id).delete();
      else await col.delete(id);
      return true;
    },
    deleteByThread: async (threadId: string, userId: string): Promise<number> => {
      const values = await this.thoughtThreadItems.getByThread(threadId, userId);
      for (const value of values) await this.thoughtThreadItems.delete(value.id, userId);
      return values.length;
    },
  };

  thoughtThreadContexts = {
    getByThread: async (threadId: string, userId: string): Promise<ThoughtThreadContext[]> => {
      const col = this.getCol<ThoughtThreadContext>("thoughtThreadContexts");
      const values = dbClient
        ? (await col.where("threadId", "==", threadId).get()).docs.map((doc: any) =>
            normalizeDoc({ ...doc.data(), id: doc.id }) as ThoughtThreadContext)
        : await col.query((value) => value.threadId === threadId);
      return (values as ThoughtThreadContext[]).filter((value) => value.userId === userId).sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
    },
    getByUser: async (userId: string): Promise<ThoughtThreadContext[]> => {
      const col = this.getCol<ThoughtThreadContext>("thoughtThreadContexts");
      const values = dbClient
        ? (await col.where("userId", "==", userId).get()).docs.map((doc: any) =>
            normalizeDoc({ ...doc.data(), id: doc.id }) as ThoughtThreadContext)
        : await col.query((value) => value.userId === userId);
      return values as ThoughtThreadContext[];
    },
    create: async (context: ThoughtThreadContext): Promise<ThoughtThreadContext> => {
      const col = this.getCol<ThoughtThreadContext>("thoughtThreadContexts");
      if (dbClient) {
        await col.doc(context.id).set(sanitizeForFirestore(context));
        return context;
      }
      return col.set(context.id, context);
    },
    update: async (id: string, userId: string, updates: Partial<ThoughtThreadContext>): Promise<ThoughtThreadContext | undefined> => {
      const col = this.getCol<ThoughtThreadContext>("thoughtThreadContexts");
      const existing = dbClient
        ? await (async () => {
            const doc = await col.doc(id).get();
            return doc.exists ? normalizeDoc({ ...doc.data(), id: doc.id }) as ThoughtThreadContext : undefined;
          })()
        : await col.get(id);
      if (!existing || existing.userId !== userId) return undefined;
      const { id: _id, userId: _userId, threadId: _threadId, kind: _kind, createdAt: _createdAt, ...allowed } = updates;
      const cleanUpdates = { ...allowed, updatedAt: new Date().toISOString() };
      if (dbClient) {
        await col.doc(id).update(sanitizeForFirestore(cleanUpdates));
        const doc = await col.doc(id).get();
        return normalizeDoc({ ...doc.data(), id: doc.id }) as ThoughtThreadContext;
      }
      return col.set(id, cleanUpdates);
    },
    delete: async (id: string, userId: string): Promise<boolean> => {
      const col = this.getCol<ThoughtThreadContext>("thoughtThreadContexts");
      const existing = dbClient
        ? await (async () => {
            const doc = await col.doc(id).get();
            return doc.exists ? normalizeDoc({ ...doc.data(), id: doc.id }) as ThoughtThreadContext : undefined;
          })()
        : await col.get(id);
      if (!existing || existing.userId !== userId) return false;
      if (dbClient) await col.doc(id).delete();
      else await col.delete(id);
      return true;
    },
    deleteByThread: async (threadId: string, userId: string): Promise<number> => {
      const values = await this.thoughtThreadContexts.getByThread(threadId, userId);
      for (const value of values) await this.thoughtThreadContexts.delete(value.id, userId);
      return values.length;
    },
  };

  thoughtThreadRuns = {
    get: async (id: string, threadId: string, userId: string): Promise<ThoughtThreadConversionRun | undefined> => {
      const col = this.getCol<ThoughtThreadConversionRun>("thoughtThreadRuns");
      const value = dbClient
        ? await (async () => {
            const doc = await col.doc(id).get();
            return doc.exists ? normalizeDoc({ ...doc.data(), id: doc.id }) as ThoughtThreadConversionRun : undefined;
          })()
        : await col.get(id);
      return value && value.userId === userId && value.threadId === threadId ? value : undefined;
    },
    getByThread: async (threadId: string, userId: string): Promise<ThoughtThreadConversionRun[]> => {
      const col = this.getCol<ThoughtThreadConversionRun>("thoughtThreadRuns");
      const values = dbClient
        ? (await col.where("threadId", "==", threadId).get()).docs.map((doc: any) =>
            normalizeDoc({ ...doc.data(), id: doc.id }) as ThoughtThreadConversionRun)
        : await col.query((value) => value.threadId === threadId);
      return (values as ThoughtThreadConversionRun[]).filter((value) => value.userId === userId).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    },
    getByUser: async (userId: string): Promise<ThoughtThreadConversionRun[]> => {
      const col = this.getCol<ThoughtThreadConversionRun>("thoughtThreadRuns");
      const values = dbClient
        ? (await col.where("userId", "==", userId).get()).docs.map((doc: any) =>
            normalizeDoc({ ...doc.data(), id: doc.id }) as ThoughtThreadConversionRun)
        : await col.query((value) => value.userId === userId);
      return values as ThoughtThreadConversionRun[];
    },
    create: async (run: ThoughtThreadConversionRun): Promise<ThoughtThreadConversionRun> => {
      const col = this.getCol<ThoughtThreadConversionRun>("thoughtThreadRuns");
      if (dbClient) {
        await col.doc(run.id).set(sanitizeForFirestore(run));
        return run;
      }
      return col.set(run.id, run);
    },
    update: async (id: string, userId: string, updates: Partial<ThoughtThreadConversionRun>): Promise<ThoughtThreadConversionRun | undefined> => {
      const col = this.getCol<ThoughtThreadConversionRun>("thoughtThreadRuns");
      const existing = dbClient
        ? await (async () => {
            const doc = await col.doc(id).get();
            return doc.exists ? normalizeDoc({ ...doc.data(), id: doc.id }) as ThoughtThreadConversionRun : undefined;
          })()
        : await col.get(id);
      if (!existing || existing.userId !== userId) return undefined;
      const { id: _id, userId: _userId, threadId: _threadId, createdAt: _createdAt, sourceSnapshot: _snapshot, sourceHash: _hash, ...allowed } = updates;
      if (dbClient) {
        await col.doc(id).update(sanitizeForFirestore(allowed));
        const doc = await col.doc(id).get();
        return normalizeDoc({ ...doc.data(), id: doc.id }) as ThoughtThreadConversionRun;
      }
      return col.set(id, allowed);
    },
    transition: async (
      id: string,
      threadId: string,
      userId: string,
      expectedStatuses: ThoughtThreadConversionRun["status"][],
      updates: Partial<ThoughtThreadConversionRun>,
    ): Promise<ThoughtThreadConversionRun | undefined> => {
      const col = this.getCol<ThoughtThreadConversionRun>("thoughtThreadRuns");
      const applyUpdates = (current: ThoughtThreadConversionRun) => {
        const {
          id: _id,
          userId: _userId,
          threadId: _threadId,
          createdAt: _createdAt,
          sourceSnapshot: _snapshot,
          sourceHash: _hash,
          ...allowed
        } = updates;
        return { ...current, ...allowed };
      };
      if (dbClient) {
        const ref = col.doc(id);
        return dbClient.runTransaction(async (transaction: any) => {
          const doc = await transaction.get(ref);
          if (!doc.exists) return undefined;
          const current = normalizeDoc({ ...doc.data(), id: doc.id }) as ThoughtThreadConversionRun;
          if (
            current.userId !== userId
            || current.threadId !== threadId
            || !expectedStatuses.includes(current.status)
          ) return undefined;
          const updated = applyUpdates(current);
          transaction.update(ref, sanitizeForFirestore(updated));
          return updated;
        });
      }
      return withLocalMutationLock(`run:${id}`, async () => {
        const current = await col.get(id);
        if (
          !current
          || current.userId !== userId
          || current.threadId !== threadId
          || !expectedStatuses.includes(current.status)
        ) return undefined;
        return col.set(id, applyUpdates(current));
      });
    },
    claimLease: async (
      id: string,
      threadId: string,
      userId: string,
      expectedStatuses: ThoughtThreadConversionRun["status"][],
      leaseToken: string,
      leaseExpiresAt: string,
    ): Promise<ThoughtThreadConversionRun | undefined> => {
      const col = this.getCol<ThoughtThreadConversionRun>("thoughtThreadRuns");
      const canClaim = (current: ThoughtThreadConversionRun) => {
        if (
          current.userId !== userId
          || current.threadId !== threadId
          || !expectedStatuses.includes(current.status)
        ) return false;
        const existingExpiry = current.leaseExpiresAt
          ? new Date(current.leaseExpiresAt).getTime()
          : 0;
        return !current.leaseToken || !Number.isFinite(existingExpiry) || existingExpiry <= Date.now();
      };
      const applyLease = (current: ThoughtThreadConversionRun) => ({
        ...current,
        leaseToken,
        leaseExpiresAt,
        updatedAt: new Date().toISOString(),
        attemptCount: (current.attemptCount || 0) + 1,
      });
      if (dbClient) {
        const ref = col.doc(id);
        return dbClient.runTransaction(async (transaction: any) => {
          const doc = await transaction.get(ref);
          if (!doc.exists) return undefined;
          const current = normalizeDoc({ ...doc.data(), id: doc.id }) as ThoughtThreadConversionRun;
          if (!canClaim(current)) return undefined;
          const updated = applyLease(current);
          transaction.update(ref, sanitizeForFirestore(updated));
          return updated;
        }, { maxAttempts: 5 });
      }
      return withLocalMutationLock(`run:${id}`, async () => {
        const current = await col.get(id);
        if (!current || !canClaim(current)) return undefined;
        return col.set(id, applyLease(current));
      });
    },
    deleteByThread: async (threadId: string, userId: string): Promise<number> => {
      const values = await this.thoughtThreadRuns.getByThread(threadId, userId);
      const col = this.getCol<ThoughtThreadConversionRun>("thoughtThreadRuns");
      for (const value of values) {
        if (dbClient) await col.doc(value.id).delete();
        else await col.delete(value.id);
      }
      return values.length;
    },
  };

  thoughtThreadRunChunks = {
    getByRun: async (
      runId: string,
      threadId: string,
      userId: string,
      kind?: ThoughtThreadRunChunk["kind"],
    ): Promise<ThoughtThreadRunChunk[]> => {
      const col = this.getCol<ThoughtThreadRunChunk>("thoughtThreadRunChunks");
      const values = dbClient
        ? (await col.where("runId", "==", runId).get()).docs.map((doc: any) =>
            normalizeDoc({ ...doc.data(), id: doc.id }) as ThoughtThreadRunChunk)
        : await col.query((value) => value.runId === runId);
      return (values as ThoughtThreadRunChunk[])
        .filter((value) =>
          value.userId === userId
          && value.threadId === threadId
          && (!kind || value.kind === kind))
        .sort((a, b) => a.index - b.index || a.id.localeCompare(b.id));
    },
    createMany: async (chunks: ThoughtThreadRunChunk[]): Promise<void> => {
      if (chunks.length === 0) return;
      const col = this.getCol<ThoughtThreadRunChunk>("thoughtThreadRunChunks");
      if (dbClient) {
        await runBulkWriter((writer) =>
          chunks.map((chunk) => writer.create(col.doc(chunk.id), sanitizeForFirestore(chunk))));
        return;
      }
      for (const chunk of chunks) await col.set(chunk.id, chunk);
    },
    replaceKind: async (
      runId: string,
      threadId: string,
      userId: string,
      kind: ThoughtThreadRunChunk["kind"],
      chunks: ThoughtThreadRunChunk[],
    ): Promise<void> => {
      const existing = await this.thoughtThreadRunChunks.getByRun(runId, threadId, userId, kind);
      const col = this.getCol<ThoughtThreadRunChunk>("thoughtThreadRunChunks");
      if (dbClient) {
        await runBulkWriter((writer) => [
          ...existing.map((chunk) => writer.delete(col.doc(chunk.id))),
          ...chunks.map((chunk) => writer.create(col.doc(chunk.id), sanitizeForFirestore(chunk))),
        ]);
        return;
      }
      for (const chunk of existing) await col.delete(chunk.id);
      for (const chunk of chunks) await col.set(chunk.id, chunk);
    },
    deleteByRun: async (runId: string, threadId: string, userId: string): Promise<number> => {
      const values = await this.thoughtThreadRunChunks.getByRun(runId, threadId, userId);
      const col = this.getCol<ThoughtThreadRunChunk>("thoughtThreadRunChunks");
      if (dbClient && values.length > 0) {
        await bulkDeleteDocumentRefs(values.map((value) => col.doc(value.id)));
      } else {
        for (const value of values) await col.delete(value.id);
      }
      return values.length;
    },
    deleteByThread: async (threadId: string, userId: string): Promise<number> => {
      const col = this.getCol<ThoughtThreadRunChunk>("thoughtThreadRunChunks");
      const values = dbClient
        ? (await col.where("threadId", "==", threadId).get()).docs.map((doc: any) =>
            normalizeDoc({ ...doc.data(), id: doc.id }) as ThoughtThreadRunChunk)
        : await col.query((value) => value.threadId === threadId);
      const owned = (values as ThoughtThreadRunChunk[]).filter((value) => value.userId === userId);
      if (dbClient && owned.length > 0) {
        await bulkDeleteDocumentRefs(owned.map((value) => col.doc(value.id)));
      } else {
        for (const value of owned) await col.delete(value.id);
      }
      return owned.length;
    },
  };

  recordingContexts = {
    getByRecording: async (
      recordingId: string,
      userId: string,
    ): Promise<RecordingContextSource[]> => {
      const col = this.getCol<RecordingContextSource>("recordingContexts");
      const values = dbClient
        ? (await col.where("recordingId", "==", recordingId).get()).docs.map((doc: any) =>
            normalizeDoc({ ...doc.data(), id: doc.id }) as RecordingContextSource)
        : await col.query((value) => value.recordingId === recordingId);
      return (values as RecordingContextSource[])
        .filter((value) => value.userId === userId)
        .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    },
    get: async (
      id: string,
      recordingId: string,
      userId: string,
    ): Promise<RecordingContextSource | undefined> => {
      const col = this.getCol<RecordingContextSource>("recordingContexts");
      const value = dbClient
        ? await (async () => {
            const doc = await col.doc(id).get();
            return doc.exists
              ? normalizeDoc({ ...doc.data(), id: doc.id }) as RecordingContextSource
              : undefined;
          })()
        : await col.get(id);
      return value?.userId === userId && value.recordingId === recordingId
        ? value
        : undefined;
    },
    upsert: async (context: RecordingContextSource): Promise<RecordingContextSource> => {
      const col = this.getCol<RecordingContextSource>("recordingContexts");
      if (dbClient) {
        await col.doc(context.id).set(sanitizeForFirestore(context), { merge: true });
        const doc = await col.doc(context.id).get();
        return normalizeDoc({ ...doc.data(), id: doc.id }) as RecordingContextSource;
      }
      return col.set(context.id, context);
    },
    update: async (
      id: string,
      recordingId: string,
      userId: string,
      updates: Partial<RecordingContextSource>,
    ): Promise<RecordingContextSource | undefined> => {
      const existing = await this.recordingContexts.get(id, recordingId, userId);
      if (!existing) return undefined;
      const col = this.getCol<RecordingContextSource>("recordingContexts");
      const {
        id: _id,
        userId: _userId,
        recordingId: _recordingId,
        kind: _kind,
        createdAt: _createdAt,
        ...allowed
      } = updates;
      const cleanUpdates = { ...allowed, updatedAt: new Date().toISOString() };
      if (dbClient) {
        await col.doc(id).update(sanitizeForFirestore(cleanUpdates));
        const doc = await col.doc(id).get();
        return normalizeDoc({ ...doc.data(), id: doc.id }) as RecordingContextSource;
      }
      return col.set(id, cleanUpdates);
    },
    delete: async (
      id: string,
      recordingId: string,
      userId: string,
    ): Promise<boolean> => {
      if (!await this.recordingContexts.get(id, recordingId, userId)) return false;
      const col = this.getCol<RecordingContextSource>("recordingContexts");
      if (dbClient) await col.doc(id).delete();
      else await col.delete(id);
      return true;
    },
  };

  // Sessions Repository
  sessions = {
    get: async (id: string): Promise<Session | undefined> => {
      const col = this.getCol("sessions");
      if (dbClient) {
        const doc = await col.doc(id).get();
        if (!doc.exists) return undefined;
        return normalizeDoc({ ...doc.data(), id: doc.id });
      } else {
        return col.get(id);
      }
    },
    getByToken: async (token: string): Promise<Session | undefined> => {
      const col = this.getCol("sessions");
      if (dbClient) {
        const snap = await col.where("token", "==", token).limit(1).get();
        if (snap.empty) return undefined;
        const doc = snap.docs[0];
        return normalizeDoc({ ...doc.data(), id: doc.id });
      } else {
        const results = await col.query(s => s.token === token);
        return results[0];
      }
    },
    create: async (session: Session): Promise<Session> => {
      const col = this.getCol("sessions");
      const id = session.id;
      if (dbClient) {
        await col.doc(id).set(sanitizeForFirestore(session));
        return session;
      } else {
        return col.set(id, session);
      }
    },
    delete: async (id: string): Promise<boolean> => {
      const col = this.getCol("sessions");
      if (dbClient) {
        await col.doc(id).delete();
        return true;
      } else {
        return col.delete(id);
      }
    },
    deleteByToken: async (token: string): Promise<boolean> => {
      const col = this.getCol("sessions");
      if (dbClient) {
        const snap = await col.where("token", "==", token).get();
        if (snap.empty) return false;
        const batch = dbClient.batch();
        snap.docs.forEach((doc: any) => batch.delete(doc.ref));
        await batch.commit();
        return true;
      } else {
        const list = await col.query(s => s.token === token);
        for (const s of list) {
          await col.delete(s.id);
        }
        return list.length > 0;
      }
    },
    deleteExpired: async (now: Date): Promise<number> => {
      const col = this.getCol("sessions");
      if (dbClient) {
        const snap = await col.where("expiresAt", "<", now).get();
        if (snap.empty) return 0;
        const batch = dbClient.batch();
        snap.docs.forEach((doc: any) => batch.delete(doc.ref));
        await batch.commit();
        return snap.size;
      } else {
        const list = await col.query(s => new Date(s.expiresAt).getTime() < now.getTime());
        for (const s of list) {
          await col.delete(s.id);
        }
        return list.length;
      }
    },
    deleteByUser: async (userId: string): Promise<boolean> => {
      const col = this.getCol("sessions");
      if (dbClient) {
        const snap = await col.where("userId", "==", userId).get();
        if (snap.empty) return false;
        const batch = dbClient.batch();
        snap.docs.forEach((doc: any) => batch.delete(doc.ref));
        await batch.commit();
        return true;
      } else {
        const list = await col.query(s => s.userId === userId);
        for (const s of list) {
          await col.delete(s.id);
        }
        return list.length > 0;
      }
    },
    list: async (): Promise<Session[]> => {
      const col = this.getCol("sessions");
      if (dbClient) {
        const snap = await (col as any).get();
        return snap.docs.map((doc: any) => normalizeDoc({ ...doc.data(), id: doc.id }));
      } else {
        return col.list();
      }
    }
  };

  // Accounts Repository
  accounts = {
    get: async (id: string): Promise<Account | undefined> => {
      const col = this.getCol("accounts");
      if (dbClient) {
        const doc = await col.doc(id).get();
        if (!doc.exists) return undefined;
        return normalizeDoc({ ...doc.data(), id: doc.id });
      } else {
        return col.get(id);
      }
    },
    getByUserAndProvider: async (userId: string, providerId: string): Promise<Account | undefined> => {
      const col = this.getCol("accounts");
      if (dbClient) {
        const snap = await col.where("userId", "==", userId).where("providerId", "==", providerId).limit(1).get();
        if (snap.empty) return undefined;
        const doc = snap.docs[0];
        return normalizeDoc({ ...doc.data(), id: doc.id });
      } else {
        const results = await col.query(a => a.userId === userId && a.providerId === providerId);
        return results[0];
      }
    },
    getByProviderIdAndAccountId: async (providerId: string, accountId: string): Promise<Account | undefined> => {
      const col = this.getCol("accounts");
      if (dbClient) {
        const snap = await col.where("providerId", "==", providerId).where("accountId", "==", accountId).limit(1).get();
        if (snap.empty) return undefined;
        const doc = snap.docs[0];
        return normalizeDoc({ ...doc.data(), id: doc.id });
      } else {
        const results = await col.query(a => a.providerId === providerId && a.accountId === accountId);
        return results[0];
      }
    },
    create: async (account: Account): Promise<Account> => {
      const col = this.getCol("accounts");
      const id = account.id || `acc_${Math.random().toString(36).substring(2, 11)}`;
      const cleanAccount = { ...account, id };
      if (dbClient) {
        await col.doc(id).set(sanitizeForFirestore(cleanAccount));
        return cleanAccount;
      } else {
        return col.set(id, cleanAccount);
      }
    },
    update: async (id: string, updates: Partial<Account>): Promise<Account> => {
      const col = this.getCol("accounts");
      const cleanUpdates = { ...updates, updatedAt: new Date().toISOString() };
      if (dbClient) {
        await col.doc(id).update(sanitizeForFirestore(cleanUpdates));
        const doc = await col.doc(id).get();
        return normalizeDoc({ ...doc.data(), id: doc.id }) as Account;
      } else {
        return col.set(id, cleanUpdates);
      }
    },
    delete: async (id: string): Promise<boolean> => {
      const col = this.getCol("accounts");
      if (dbClient) {
        await col.doc(id).delete();
        return true;
      } else {
        return col.delete(id);
      }
    }
  };

  // Verifications Repository
  verifications = {
    get: async (id: string): Promise<Verification | undefined> => {
      const col = this.getCol("verifications");
      if (dbClient) {
        const doc = await col.doc(id).get();
        if (!doc.exists) return undefined;
        return normalizeDoc({ ...doc.data(), id: doc.id });
      } else {
        return col.get(id);
      }
    },
    getByIdentifierAndValue: async (identifier: string, value: string): Promise<Verification | undefined> => {
      const col = this.getCol("verifications");
      if (dbClient) {
        const snap = await col.where("identifier", "==", identifier).where("value", "==", value).limit(1).get();
        if (snap.empty) return undefined;
        const doc = snap.docs[0];
        return normalizeDoc({ ...doc.data(), id: doc.id });
      } else {
        const results = await col.query(v => v.identifier === identifier && v.value === value);
        return results[0];
      }
    },
    getByIdentifier: async (identifier: string): Promise<Verification | undefined> => {
      const col = this.getCol("verifications");
      if (dbClient) {
        const snap = await col.where("identifier", "==", identifier).limit(1).get();
        if (snap.empty) return undefined;
        const doc = snap.docs[0];
        return normalizeDoc({ ...doc.data(), id: doc.id });
      } else {
        const results = await col.query(v => v.identifier === identifier);
        return results[0];
      }
    },
    create: async (verification: Verification): Promise<Verification> => {
      const col = this.getCol("verifications");
      const id = verification.id || `ver_${Math.random().toString(36).substring(2, 11)}`;
      const cleanVerification = { ...verification, id };
      if (dbClient) {
        await col.doc(id).set(sanitizeForFirestore(cleanVerification));
        return cleanVerification;
      } else {
        return col.set(id, cleanVerification);
      }
    },
    delete: async (id: string): Promise<boolean> => {
      const col = this.getCol("verifications");
      if (dbClient) {
        await col.doc(id).delete();
        return true;
      } else {
        return col.delete(id);
      }
    }
  };

  // Backup Providers Repository
  backupProviders = {
    get: async (id: string): Promise<BackupProvider | undefined> => {
      const col = this.getCol("backupProviders");
      if (dbClient) {
        const doc = await col.doc(id).get();
        if (!doc.exists) return undefined;
        const res = normalizeDoc({ ...doc.data(), id: doc.id });
        if (res) res.config = decryptConfig(res.config);
        return res;
      } else {
        const res = await col.get(id);
        if (res) res.config = decryptConfig(res.config);
        return res;
      }
    },
    getByUser: async (userId: string): Promise<BackupProvider[]> => {
      const col = this.getCol("backupProviders");
      if (dbClient) {
        const snap = await col.where("userId", "==", userId).get();
        return snap.docs.map((doc: any) => {
          const res = normalizeDoc({ ...doc.data(), id: doc.id });
          res.config = decryptConfig(res.config);
          return res;
        });
      } else {
        const list = await col.query(bp => bp.userId === userId);
        return list.map(res => {
          res.config = decryptConfig(res.config);
          return res;
        });
      }
    },
    create: async (provider: BackupProvider): Promise<BackupProvider> => {
      const col = this.getCol("backupProviders");
      const id = provider.id || `bp_${Math.random().toString(36).substring(2, 11)}`;
      const encryptedConfig = encryptConfig(provider.config);
      const cleanProvider = { ...provider, id, enabled: provider.enabled ?? 1, config: encryptedConfig };
      if (dbClient) {
        await col.doc(id).set(sanitizeForFirestore(cleanProvider));
        return { ...cleanProvider, config: decryptConfig(encryptedConfig) };
      } else {
        await col.set(id, cleanProvider);
        return { ...cleanProvider, config: decryptConfig(encryptedConfig) };
      }
    },
    update: async (id: string, updates: Partial<BackupProvider>): Promise<BackupProvider> => {
      const col = this.getCol("backupProviders");
      const encryptedUpdates = { ...updates };
      if (updates.config !== undefined) {
        encryptedUpdates.config = encryptConfig(updates.config);
      }
      if (dbClient) {
        await col.doc(id).update(sanitizeForFirestore(encryptedUpdates));
        const doc = await col.doc(id).get();
        const res = normalizeDoc({ ...doc.data(), id: doc.id }) as BackupProvider;
        res.config = decryptConfig(res.config);
        return res;
      } else {
        const res = await col.set(id, encryptedUpdates);
        res.config = decryptConfig(res.config);
        return res;
      }
    },
    delete: async (id: string): Promise<boolean> => {
      const col = this.getCol("backupProviders");
      if (dbClient) {
        await col.doc(id).delete();
        return true;
      } else {
        return col.delete(id);
      }
    }
  };

  // Backup Logs Repository
  backupLogs = {
    getByUser: async (userId: string): Promise<BackupLog[]> => {
      const col = this.getCol("backupLogs");
      if (dbClient) {
        const snap = await col.where("userId", "==", userId).orderBy("createdAt", "desc").get();
        return snap.docs.map((doc: any) => normalizeDoc({ ...doc.data(), id: doc.id }));
      } else {
        const list = await col.query(bl => bl.userId === userId);
        return list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      }
    },
    create: async (log: BackupLog): Promise<BackupLog> => {
      const col = this.getCol("backupLogs");
      const id = log.id || `bl_${Math.random().toString(36).substring(2, 11)}`;
      const cleanLog = { ...log, id, createdAt: log.createdAt || new Date().toISOString() };
      if (dbClient) {
        await col.doc(id).set(sanitizeForFirestore(cleanLog));
        return cleanLog;
      } else {
        return col.set(id, cleanLog);
      }
    }
  };

  // Task Providers Repository
  taskProviders = {
    get: async (id: string): Promise<TaskProvider | undefined> => {
      const col = this.getCol("taskProviders");
      if (dbClient) {
        const doc = await col.doc(id).get();
        if (!doc.exists) return undefined;
        const res = normalizeDoc({ ...doc.data(), id: doc.id });
        if (res) res.config = decryptConfig(res.config);
        return res;
      } else {
        const res = await col.get(id);
        if (res) res.config = decryptConfig(res.config);
        return res;
      }
    },
    getByUser: async (userId: string): Promise<TaskProvider[]> => {
      const col = this.getCol("taskProviders");
      if (dbClient) {
        const snap = await col.where("userId", "==", userId).get();
        return snap.docs.map((doc: any) => {
          const res = normalizeDoc({ ...doc.data(), id: doc.id });
          res.config = decryptConfig(res.config);
          return res;
        });
      } else {
        const list = await col.query(tp => tp.userId === userId);
        return list.map(res => {
          res.config = decryptConfig(res.config);
          return res;
        });
      }
    },
    create: async (provider: TaskProvider): Promise<TaskProvider> => {
      const col = this.getCol("taskProviders");
      const id = provider.id || `tp_${Math.random().toString(36).substring(2, 11)}`;
      const encryptedConfig = encryptConfig(provider.config);
      const cleanProvider = { ...provider, id, enabled: provider.enabled ?? 1, config: encryptedConfig };
      if (dbClient) {
        await col.doc(id).set(sanitizeForFirestore(cleanProvider));
        return { ...cleanProvider, config: decryptConfig(encryptedConfig) };
      } else {
        await col.set(id, cleanProvider);
        return { ...cleanProvider, config: decryptConfig(encryptedConfig) };
      }
    },
    update: async (id: string, updates: Partial<TaskProvider>): Promise<TaskProvider> => {
      const col = this.getCol("taskProviders");
      const encryptedUpdates = { ...updates };
      if (updates.config !== undefined) {
        encryptedUpdates.config = encryptConfig(updates.config);
      }
      if (dbClient) {
        await col.doc(id).update(sanitizeForFirestore(encryptedUpdates));
        const doc = await col.doc(id).get();
        const res = normalizeDoc({ ...doc.data(), id: doc.id }) as TaskProvider;
        res.config = decryptConfig(res.config);
        return res;
      } else {
        const res = await col.set(id, encryptedUpdates);
        res.config = decryptConfig(res.config);
        return res;
      }
    },
    delete: async (id: string): Promise<boolean> => {
      const col = this.getCol("taskProviders");
      if (dbClient) {
        await col.doc(id).delete();
        return true;
      } else {
        return col.delete(id);
      }
    }
  };

  // Calendar Providers Repository
  calendarProviders = {
    get: async (id: string): Promise<CalendarProvider | undefined> => {
      const col = this.getCol("calendarProviders");
      if (dbClient) {
        const doc = await col.doc(id).get();
        if (!doc.exists) return undefined;
        const res = normalizeDoc({ ...doc.data(), id: doc.id });
        if (res) res.config = decryptConfig(res.config);
        return res;
      } else {
        const res = await col.get(id);
        if (res) res.config = decryptConfig(res.config);
        return res;
      }
    },
    getByUser: async (userId: string): Promise<CalendarProvider[]> => {
      const col = this.getCol("calendarProviders");
      if (dbClient) {
        const snap = await col.where("userId", "==", userId).get();
        return snap.docs.map((doc: any) => {
          const res = normalizeDoc({ ...doc.data(), id: doc.id });
          res.config = decryptConfig(res.config);
          return res;
        });
      } else {
        const list = await col.query(cp => cp.userId === userId);
        return list.map(res => {
          res.config = decryptConfig(res.config);
          return res;
        });
      }
    },
    create: async (provider: CalendarProvider): Promise<CalendarProvider> => {
      const col = this.getCol("calendarProviders");
      const id = provider.id || `cp_${Math.random().toString(36).substring(2, 11)}`;
      const encryptedConfig = encryptConfig(provider.config);
      const cleanProvider = { ...provider, id, enabled: provider.enabled ?? 1, config: encryptedConfig };
      if (dbClient) {
        await col.doc(id).set(sanitizeForFirestore(cleanProvider));
        return { ...cleanProvider, config: decryptConfig(encryptedConfig) };
      } else {
        await col.set(id, cleanProvider);
        return { ...cleanProvider, config: decryptConfig(encryptedConfig) };
      }
    },
    update: async (id: string, updates: Partial<CalendarProvider>): Promise<CalendarProvider> => {
      const col = this.getCol("calendarProviders");
      const encryptedUpdates = { ...updates };
      if (updates.config !== undefined) {
        encryptedUpdates.config = encryptConfig(updates.config);
      }
      if (dbClient) {
        await col.doc(id).update(sanitizeForFirestore(encryptedUpdates));
        const doc = await col.doc(id).get();
        const res = normalizeDoc({ ...doc.data(), id: doc.id }) as CalendarProvider;
        res.config = decryptConfig(res.config);
        return res;
      } else {
        const res = await col.set(id, encryptedUpdates);
        res.config = decryptConfig(res.config);
        return res;
      }
    },
    delete: async (id: string): Promise<boolean> => {
      const col = this.getCol("calendarProviders");
      if (dbClient) {
        await col.doc(id).delete();
        return true;
      } else {
        return col.delete(id);
      }
    }
  };

  // Connector Providers Repository
  connectorProviders = {
    get: async (id: string): Promise<ConnectorProvider | undefined> => {
      const col = this.getCol("connectorProviders");
      if (dbClient) {
        const doc = await col.doc(id).get();
        if (!doc.exists) return undefined;
        const res = normalizeDoc({ ...doc.data(), id: doc.id });
        if (res) res.config = decryptConfig(res.config);
        return res;
      } else {
        const res = await col.get(id);
        if (res) res.config = decryptConfig(res.config);
        return res;
      }
    },
    getByUser: async (userId: string): Promise<ConnectorProvider[]> => {
      const col = this.getCol("connectorProviders");
      if (dbClient) {
        const snap = await col.where("userId", "==", userId).get();
        return snap.docs.map((doc: any) => {
          const res = normalizeDoc({ ...doc.data(), id: doc.id });
          res.config = decryptConfig(res.config);
          return res;
        });
      } else {
        const list = await col.query(cp => cp.userId === userId);
        return list.map(res => {
          res.config = decryptConfig(res.config);
          return res;
        });
      }
    },
    create: async (provider: ConnectorProvider): Promise<ConnectorProvider> => {
      const col = this.getCol("connectorProviders");
      const id = provider.id || `con_${Math.random().toString(36).substring(2, 11)}`;
      const encryptedConfig = encryptConfig(provider.config);
      const cleanProvider = { ...provider, id, enabled: provider.enabled ?? 1, config: encryptedConfig };
      if (dbClient) {
        await col.doc(id).set(sanitizeForFirestore(cleanProvider));
        return { ...cleanProvider, config: decryptConfig(encryptedConfig) };
      } else {
        await col.set(id, cleanProvider);
        return { ...cleanProvider, config: decryptConfig(encryptedConfig) };
      }
    },
    update: async (id: string, updates: Partial<ConnectorProvider>): Promise<ConnectorProvider> => {
      const col = this.getCol("connectorProviders");
      const encryptedUpdates = { ...updates };
      if (updates.config !== undefined) {
        encryptedUpdates.config = encryptConfig(updates.config);
      }
      if (dbClient) {
        await col.doc(id).update(sanitizeForFirestore(encryptedUpdates));
        const doc = await col.doc(id).get();
        const res = normalizeDoc({ ...doc.data(), id: doc.id }) as ConnectorProvider;
        res.config = decryptConfig(res.config);
        return res;
      } else {
        const res = await col.set(id, encryptedUpdates);
        res.config = decryptConfig(res.config);
        return res;
      }
    },
    delete: async (id: string): Promise<boolean> => {
      const col = this.getCol("connectorProviders");
      if (dbClient) {
        await col.doc(id).delete();
        return true;
      } else {
        return col.delete(id);
      }
    }
  };

  // Trusted Devices Repository
  trustedDevices = {
    getByUser: async (userId: string): Promise<TrustedDevice[]> => {
      const col = this.getCol("trustedDevices");
      if (dbClient) {
        const snap = await col.where("userId", "==", userId).get();
        return snap.docs.map((doc: any) => normalizeDoc({ ...doc.data(), id: doc.id }));
      } else {
        return col.query(td => td.userId === userId);
      }
    },
    create: async (device: TrustedDevice): Promise<TrustedDevice> => {
      const col = this.getCol("trustedDevices");
      const id = device.id || `td_${Math.random().toString(36).substring(2, 11)}`;
      const cleanDevice = { ...device, id, lastUsedAt: device.lastUsedAt || new Date().toISOString() };
      if (dbClient) {
        await col.doc(id).set(sanitizeForFirestore(cleanDevice));
        return cleanDevice;
      } else {
        return col.set(id, cleanDevice);
      }
    },
    delete: async (id: string): Promise<boolean> => {
      const col = this.getCol("trustedDevices");
      if (dbClient) {
        await col.doc(id).delete();
        return true;
      } else {
        return col.delete(id);
      }
    }
  };

  // Usage Events Repository
  usageEvents = {
    getByUser: async (userId: string): Promise<UsageEvent[]> => {
      const col = this.getCol("usageEvents");
      if (dbClient) {
        const snap = await col.where("userId", "==", userId).orderBy("createdAt", "desc").get();
        return snap.docs.map((doc: any) => normalizeDoc({ ...doc.data(), id: doc.id }));
      } else {
        const list = await col.query(ue => ue.userId === userId);
        return list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      }
    },
    create: async (event: Omit<UsageEvent, "id"> & { id?: number | string }): Promise<UsageEvent> => {
      const col = this.getCol("usageEvents");
      const id = event.id || `ue_${Math.random().toString(36).substring(2, 11)}`;
      const cleanEvent = { ...event, id, createdAt: event.createdAt || new Date().toISOString() };
      if (dbClient) {
        await col.doc(String(id)).set(sanitizeForFirestore(cleanEvent));
        return cleanEvent as UsageEvent;
      } else {
        return col.set(String(id), cleanEvent);
      }
    },
    getAdvancedConversionCount: async (userId: string, termStart: Date | string, advancedTypes: string[]): Promise<number> => {
      const col = this.getCol("usageEvents");
      const filterStart = new Date(termStart).getTime();
      if (dbClient) {
        // Query conversion_completed events since termStart, then filter conversionType in memory
        const snap = await col
          .where("userId", "==", userId)
          .where("eventType", "==", "conversion_completed")
          .get();
        
        let count = 0;
        snap.docs.forEach((doc: any) => {
          const data = doc.data();
          const createdAt = data.createdAt ? new Date(normalizeDoc(data.createdAt)).getTime() : 0;
          if (createdAt >= filterStart) {
            const conversionType = data.metadata?.conversionType;
            if (conversionType && advancedTypes.includes(conversionType)) {
              count++;
            }
          }
        });
        return count;
      } else {
        const list = await col.query(
          ue => ue.userId === userId &&
          ue.eventType === "conversion_completed" &&
          new Date(ue.createdAt).getTime() >= filterStart &&
          ue.metadata &&
          advancedTypes.includes(ue.metadata.conversionType)
        );
        return list.length;
      }
    }
  };

  // Style Preferences Repository
  stylePreferences = {
    getByUser: async (userId: string): Promise<StylePreference[]> => {
      const col = this.getCol("stylePreferences");
      if (dbClient) {
        const snap = await col.where("userId", "==", userId).get();
        return snap.docs.map((doc: any) => normalizeDoc({ ...doc.data(), id: doc.id }));
      } else {
        return col.query(sp => sp.userId === userId);
      }
    },
    create: async (preference: StylePreference): Promise<StylePreference> => {
      const col = this.getCol("stylePreferences");
      const id = preference.id || `sp_${Math.random().toString(36).substring(2, 11)}`;
      const cleanPref = { ...preference, id, createdAt: preference.createdAt || new Date().toISOString() };
      if (dbClient) {
        await col.doc(id).set(sanitizeForFirestore(cleanPref));
        return cleanPref;
      } else {
        return col.set(id, cleanPref);
      }
    },
    delete: async (id: string): Promise<boolean> => {
      const col = this.getCol("stylePreferences");
      if (dbClient) {
        await col.doc(id).delete();
        return true;
      } else {
        return col.delete(id);
      }
    }
  };

  // User Folders Repository
  userFolders = {
    get: async (id: string): Promise<UserFolder | undefined> => {
      const col = this.getCol("userFolders");
      if (dbClient) {
        const doc = await col.doc(id).get();
        if (!doc.exists) return undefined;
        return normalizeDoc({ ...doc.data(), id: doc.id });
      } else {
        return col.get(id);
      }
    },
    getByUser: async (userId: string): Promise<UserFolder[]> => {
      const col = this.getCol("userFolders");
      if (dbClient) {
        const snap = await col.where("userId", "==", userId).get();
        return snap.docs.map((doc: any) => normalizeDoc({ ...doc.data(), id: doc.id }));
      } else {
        return col.query(f => f.userId === userId);
      }
    },
    create: async (folder: UserFolder): Promise<UserFolder> => {
      const col = this.getCol("userFolders");
      const id = folder.id || `fld_${Math.random().toString(36).substring(2, 11)}`;
      const cleanFolder = {
        ...folder,
        id,
        isSystem: folder.isSystem ?? 0,
        createdAt: folder.createdAt || new Date().toISOString(),
        updatedAt: folder.updatedAt || new Date().toISOString()
      };
      if (dbClient) {
        await col.doc(id).set(sanitizeForFirestore(cleanFolder));
        return cleanFolder;
      } else {
        return col.set(id, cleanFolder);
      }
    },
    update: async (id: string, updates: Partial<UserFolder>): Promise<UserFolder> => {
      const col = this.getCol("userFolders");
      const cleanUpdates = { ...updates, updatedAt: new Date().toISOString() };
      if (dbClient) {
        await col.doc(id).update(sanitizeForFirestore(cleanUpdates));
        const doc = await col.doc(id).get();
        return normalizeDoc({ ...doc.data(), id: doc.id }) as UserFolder;
      } else {
        return col.set(id, cleanUpdates);
      }
    },
    delete: async (id: string): Promise<boolean> => {
      const col = this.getCol("userFolders");
      if (dbClient) {
        await col.doc(id).delete();
        return true;
      } else {
        return col.delete(id);
      }
    }
  };

  // Developer API Keys Repository
  developerApiKeys = {
    get: async (id: string): Promise<DeveloperApiKey | undefined> => {
      const col = this.getCol("developerApiKeys");
      if (dbClient) {
        const doc = await col.doc(id).get();
        if (!doc.exists) return undefined;
        return normalizeDoc({ ...doc.data(), id: doc.id });
      } else {
        return col.get(id);
      }
    },
    getByHash: async (keyHash: string): Promise<DeveloperApiKey | undefined> => {
      const col = this.getCol("developerApiKeys");
      if (dbClient) {
        const snap = await col.where("keyHash", "==", keyHash).limit(1).get();
        if (snap.empty) return undefined;
        const doc = snap.docs[0];
        return normalizeDoc({ ...doc.data(), id: doc.id });
      } else {
        const results = await col.query((k: any) => k.keyHash === keyHash);
        return results[0];
      }
    },
    getByUser: async (userId: string): Promise<DeveloperApiKey[]> => {
      const col = this.getCol("developerApiKeys");
      if (dbClient) {
        const snap = await col.where("userId", "==", userId).get();
        return snap.docs.map((doc: any) => normalizeDoc({ ...doc.data(), id: doc.id }));
      } else {
        return col.query((k: any) => k.userId === userId);
      }
    },
    create: async (key: DeveloperApiKey): Promise<DeveloperApiKey> => {
      const col = this.getCol("developerApiKeys");
      const cleanKey = {
        ...key,
        createdAt: key.createdAt || new Date().toISOString(),
        updatedAt: key.updatedAt || new Date().toISOString(),
      };
      if (dbClient) {
        await col.doc(key.id).set(sanitizeForFirestore(cleanKey));
        return cleanKey;
      } else {
        return col.set(key.id, cleanKey);
      }
    },
    update: async (id: string, updates: Partial<DeveloperApiKey>): Promise<DeveloperApiKey | undefined> => {
      const col = this.getCol("developerApiKeys");
      const cleanUpdates = { ...updates, updatedAt: new Date().toISOString() };
      if (dbClient) {
        await col.doc(id).update(sanitizeForFirestore(cleanUpdates));
        const doc = await col.doc(id).get();
        if (!doc.exists) return undefined;
        return normalizeDoc({ ...doc.data(), id: doc.id }) as DeveloperApiKey;
      } else {
        return col.set(id, cleanUpdates);
      }
    },
    delete: async (id: string): Promise<boolean> => {
      const col = this.getCol("developerApiKeys");
      if (dbClient) {
        await col.doc(id).delete();
        return true;
      } else {
        return col.delete(id);
      }
    },
  };

  // User Files Repository
  userFiles = {
    get: async (id: string): Promise<UserFile | undefined> => {
      const col = this.getCol("userFiles");
      if (dbClient) {
        const doc = await col.doc(id).get();
        if (!doc.exists) return undefined;
        return normalizeDoc({ ...doc.data(), id: doc.id });
      } else {
        return col.get(id);
      }
    },
    getByUser: async (userId: string): Promise<UserFile[]> => {
      const col = this.getCol("userFiles");
      if (dbClient) {
        const snap = await col.where("userId", "==", userId).get();
        return snap.docs.map((doc: any) => normalizeDoc({ ...doc.data(), id: doc.id }));
      } else {
        return col.query(f => f.userId === userId);
      }
    },
    getByFolder: async (folderId: string): Promise<UserFile[]> => {
      const col = this.getCol("userFiles");
      if (dbClient) {
        const snap = await col.where("folderId", "==", folderId).get();
        return snap.docs.map((doc: any) => normalizeDoc({ ...doc.data(), id: doc.id }));
      } else {
        return col.query(f => f.folderId === folderId);
      }
    },
    create: async (file: UserFile): Promise<UserFile> => {
      const col = this.getCol("userFiles");
      const id = file.id || `fil_${Math.random().toString(36).substring(2, 11)}`;
      const cleanFile = {
        ...file,
        id,
        fileSize: file.fileSize || 0,
        createdAt: file.createdAt || new Date().toISOString(),
        updatedAt: file.updatedAt || new Date().toISOString()
      };
      if (dbClient) {
        await col.doc(id).set(sanitizeForFirestore(cleanFile));
        return cleanFile;
      } else {
        return col.set(id, cleanFile);
      }
    },
    update: async (id: string, updates: Partial<UserFile>): Promise<UserFile> => {
      const col = this.getCol("userFiles");
      const cleanUpdates = { ...updates, updatedAt: new Date().toISOString() };
      if (dbClient) {
        await col.doc(id).update(sanitizeForFirestore(cleanUpdates));
        const doc = await col.doc(id).get();
        return normalizeDoc({ ...doc.data(), id: doc.id }) as UserFile;
      } else {
        return col.set(id, cleanUpdates);
      }
    },
    delete: async (id: string): Promise<boolean> => {
      const col = this.getCol("userFiles");
      if (dbClient) {
        await col.doc(id).delete();
        return true;
      } else {
        return col.delete(id);
      }
    }
  };

  // Usage Limits Repository
  usageLimits = {
    get: async (userId: string, actionType: string, dateKey: string): Promise<UsageLimit | undefined> => {
      const col = this.getCol("usageLimits");
      if (dbClient) {
        const snap = await col.where("userId", "==", userId).where("actionType", "==", actionType).where("dateKey", "==", dateKey).limit(1).get();
        if (snap.empty) return undefined;
        const doc = snap.docs[0];
        return normalizeDoc({ ...doc.data(), id: doc.id });
      } else {
        const results = await col.query(ul => ul.userId === userId && ul.actionType === actionType && ul.dateKey === dateKey);
        return results[0];
      }
    },
    create: async (limit: Omit<UsageLimit, "id"> & { id?: number | string }): Promise<UsageLimit> => {
      const col = this.getCol("usageLimits");
      const id = limit.id || `ul_${Math.random().toString(36).substring(2, 11)}`;
      const cleanLimit = { ...limit, id };
      if (dbClient) {
        await col.doc(String(id)).set(sanitizeForFirestore(cleanLimit));
        return cleanLimit as UsageLimit;
      } else {
        return col.set(String(id), cleanLimit);
      }
    },
    update: async (id: number | string, updates: Partial<UsageLimit>): Promise<UsageLimit> => {
      const col = this.getCol("usageLimits");
      if (dbClient) {
        await col.doc(String(id)).update(sanitizeForFirestore(updates));
        const doc = await col.doc(String(id)).get();
        return normalizeDoc({ ...doc.data(), id: doc.id }) as UsageLimit;
      } else {
        return col.set(String(id), updates);
      }
    },
    increment: async (userId: string, actionType: string, dateKey: string, amount = 1): Promise<void> => {
      const existing = await this.usageLimits.get(userId, actionType, dateKey);
      if (existing) {
        if (dbClient) {
          const col = this.getCol("usageLimits");
          await col.doc(String(existing.id)).update({
            count: FieldValue.increment(amount)
          });
        } else {
          await this.usageLimits.update(existing.id, { count: existing.count + amount });
        }
      } else {
        await this.usageLimits.create({ userId, actionType, dateKey, count: amount });
      }
    }
  };

  usageReservations = {
    get: async (id: string, userId: string): Promise<UsageReservation | undefined> => {
      const col = this.getCol<UsageReservation>("usageReservations");
      const value = dbClient
        ? await (async () => {
            const doc = await col.doc(id).get();
            return doc.exists
              ? normalizeDoc({ ...doc.data(), id: doc.id }) as UsageReservation
              : undefined;
          })()
        : await col.get(id);
      return value?.userId === userId ? value : undefined;
    },
    reserve: async (
      reservation: UsageReservation,
      maximumCommittedAndReserved: number,
    ): Promise<boolean> => {
      const reservationCol = this.getCol<UsageReservation>("usageReservations");
      const limitCol = this.getCol<UsageLimit>("usageLimits");
      const deterministicLimitId = `ul_${crypto.createHash("sha256")
        .update(`${reservation.userId}:${reservation.actionType}:${reservation.dateKey}`)
        .digest("hex")
        .slice(0, 32)}`;

      if (dbClient) {
        const reservationRef = reservationCol.doc(reservation.id);
        const limitQuery = limitCol
          .where("userId", "==", reservation.userId)
          .where("actionType", "==", reservation.actionType)
          .where("dateKey", "==", reservation.dateKey)
          .limit(1);
        return dbClient.runTransaction(async (transaction: any) => {
          const [reservationDoc, limitSnapshot] = await Promise.all([
            transaction.get(reservationRef),
            transaction.get(limitQuery),
          ]);
          if (reservationDoc.exists) {
            const existing = reservationDoc.data() as UsageReservation;
            return existing.userId === reservation.userId
              && (existing.status === "reserved" || existing.status === "committed");
          }
          const limitDoc = limitSnapshot.empty ? null : limitSnapshot.docs[0];
          const current = limitDoc?.data() as UsageLimit | undefined;
          const committed = current?.count || 0;
          const reserved = current?.reservedCount || 0;
          if (committed + reserved >= maximumCommittedAndReserved) return false;

          transaction.create(reservationRef, sanitizeForFirestore(reservation));
          const nextLimit: UsageLimit = {
            id: limitDoc?.id || deterministicLimitId,
            userId: reservation.userId,
            actionType: reservation.actionType,
            dateKey: reservation.dateKey,
            count: committed,
            reservedCount: reserved + 1,
          };
          transaction.set(
            limitDoc?.ref || limitCol.doc(deterministicLimitId),
            sanitizeForFirestore(nextLimit),
            { merge: true },
          );
          return true;
        }, { maxAttempts: 5 });
      }

      return withLocalMutationLock(
        `usage:${reservation.userId}:${reservation.actionType}:${reservation.dateKey}`,
        async () => {
          const existingReservation = await reservationCol.get(reservation.id);
          if (existingReservation) {
            return existingReservation.userId === reservation.userId
              && (existingReservation.status === "reserved" || existingReservation.status === "committed");
          }
          const existingLimits = await limitCol.query((limit) =>
            limit.userId === reservation.userId
            && limit.actionType === reservation.actionType
            && limit.dateKey === reservation.dateKey);
          const current = existingLimits[0] as UsageLimit | undefined;
          const committed = current?.count || 0;
          const reserved = current?.reservedCount || 0;
          if (committed + reserved >= maximumCommittedAndReserved) return false;
          await reservationCol.set(reservation.id, reservation);
          await limitCol.set(String(current?.id || deterministicLimitId), {
            id: current?.id || deterministicLimitId,
            userId: reservation.userId,
            actionType: reservation.actionType,
            dateKey: reservation.dateKey,
            count: committed,
            reservedCount: reserved + 1,
          });
          return true;
        },
      );
    },
    settle: async (
      id: string,
      userId: string,
      outcome: "committed" | "released",
    ): Promise<UsageReservation | undefined> => {
      const reservationCol = this.getCol<UsageReservation>("usageReservations");
      const limitCol = this.getCol<UsageLimit>("usageLimits");
      const settleCurrent = (
        current: UsageReservation,
        now: string,
      ): UsageReservation => ({
        ...current,
        status: outcome,
        updatedAt: now,
        ...(outcome === "committed"
          ? { committedAt: now, releasedAt: null }
          : { releasedAt: now }),
      });

      if (dbClient) {
        const reservationRef = reservationCol.doc(id);
        return dbClient.runTransaction(async (transaction: any) => {
          const reservationDoc = await transaction.get(reservationRef);
          if (!reservationDoc.exists) return undefined;
          const current = normalizeDoc({
            ...reservationDoc.data(),
            id: reservationDoc.id,
          }) as UsageReservation;
          if (current.userId !== userId) return undefined;
          if (current.status !== "reserved") return current;
          const limitQuery = limitCol
            .where("userId", "==", current.userId)
            .where("actionType", "==", current.actionType)
            .where("dateKey", "==", current.dateKey)
            .limit(1);
          const limitSnapshot = await transaction.get(limitQuery);
          if (limitSnapshot.empty) throw new Error("Usage reservation counter is missing.");
          const limitDoc = limitSnapshot.docs[0];
          const limit = limitDoc.data() as UsageLimit;
          const now = new Date().toISOString();
          const settled = settleCurrent(current, now);
          transaction.update(reservationRef, sanitizeForFirestore(settled));
          transaction.update(limitDoc.ref, {
            reservedCount: Math.max(0, (limit.reservedCount || 0) - 1),
            ...(outcome === "committed"
              ? { count: (limit.count || 0) + 1 }
              : {}),
          });
          return settled;
        }, { maxAttempts: 5 });
      }

      return withLocalMutationLock(`usage-reservation:${id}`, async () => {
        const current = await reservationCol.get(id);
        if (!current || current.userId !== userId) return undefined;
        if (current.status !== "reserved") return current;
        const limits = await limitCol.query((limit) =>
          limit.userId === current.userId
          && limit.actionType === current.actionType
          && limit.dateKey === current.dateKey);
        const limit = limits[0] as UsageLimit | undefined;
        if (!limit) throw new Error("Usage reservation counter is missing.");
        const now = new Date().toISOString();
        const settled = settleCurrent(current, now);
        await reservationCol.set(id, settled);
        await limitCol.set(String(limit.id), {
          reservedCount: Math.max(0, (limit.reservedCount || 0) - 1),
          ...(outcome === "committed" ? { count: (limit.count || 0) + 1 } : {}),
        });
        return settled;
      });
    },
    releaseExpired: async (
      userId: string,
      actionType: string,
      dateKey: string,
      now: Date,
    ): Promise<number> => {
      const reservationCol = this.getCol<UsageReservation>("usageReservations");
      const values = dbClient
        ? (await reservationCol.where("userId", "==", userId).get()).docs.map((doc: any) =>
            normalizeDoc({ ...doc.data(), id: doc.id }) as UsageReservation)
        : await reservationCol.query((reservation) => reservation.userId === userId);
      const expired = (values as UsageReservation[]).filter((reservation) =>
        reservation.actionType === actionType
        && reservation.dateKey === dateKey
        && reservation.status === "reserved"
        && new Date(reservation.expiresAt).getTime() <= now.getTime());
      let released = 0;
      for (const reservation of expired) {
        const settled = await this.usageReservations.settle(
          reservation.id,
          userId,
          "released",
        );
        if (settled?.status === "released") released += 1;
      }
      return released;
    },
  };

  // User Skills Repository
  userSkills = {
    get: async (userId: string, conversionType: string): Promise<UserSkill | undefined> => {
      const col = this.getCol("userSkills");
      if (dbClient) {
        const snap = await col.where("userId", "==", userId).where("conversionType", "==", conversionType).limit(1).get();
        if (snap.empty) return undefined;
        const doc = snap.docs[0];
        return normalizeDoc({ ...doc.data(), id: doc.id });
      } else {
        const results = await col.query(us => us.userId === userId && us.conversionType === conversionType);
        return results[0];
      }
    },
    getByUser: async (userId: string): Promise<UserSkill[]> => {
      const col = this.getCol("userSkills");
      if (dbClient) {
        const snap = await col.where("userId", "==", userId).get();
        return snap.docs.map((doc: any) => normalizeDoc({ ...doc.data(), id: doc.id }));
      } else {
        return col.query(us => us.userId === userId);
      }
    },
    create: async (skill: UserSkill): Promise<UserSkill> => {
      const col = this.getCol("userSkills");
      const id = skill.id || `sk_${Math.random().toString(36).substring(2, 11)}`;
      const cleanSkill = {
        ...skill,
        id,
        createdAt: skill.createdAt || new Date().toISOString(),
        updatedAt: skill.updatedAt || new Date().toISOString()
      };
      if (dbClient) {
        await col.doc(id).set(sanitizeForFirestore(cleanSkill));
        return cleanSkill;
      } else {
        return col.set(id, cleanSkill);
      }
    },
    update: async (userId: string, conversionType: string, skillContent: string): Promise<UserSkill> => {
      const existing = await this.userSkills.get(userId, conversionType);
      if (existing) {
        const col = this.getCol("userSkills");
        const cleanUpdates = { skillContent, updatedAt: new Date().toISOString() };
        if (dbClient) {
          await col.doc(existing.id).update(sanitizeForFirestore(cleanUpdates));
          return { ...existing, ...cleanUpdates } as UserSkill;
        } else {
          return col.set(existing.id, cleanUpdates);
        }
      } else {
        return this.userSkills.create({
          id: "",
          userId,
          conversionType,
          skillContent,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        });
      }
    },
    delete: async (userId: string, conversionType: string): Promise<boolean> => {
      const existing = await this.userSkills.get(userId, conversionType);
      if (!existing) return false;
      const col = this.getCol("userSkills");
      if (dbClient) {
        await col.doc(existing.id).delete();
        return true;
      } else {
        return col.delete(existing.id);
      }
    }
  };

  // User Knowledgebases Repository
  userKnowledgebases = {
    get: async (userId: string, conversionType: string): Promise<UserKnowledgebase | undefined> => {
      const col = this.getCol<UserKnowledgebase>("userKnowledgebases");
      if (dbClient) {
        const snap = await col.where("userId", "==", userId).where("conversionType", "==", conversionType).limit(1).get();
        if (snap.empty) return undefined;
        const doc = snap.docs[0];
        return normalizeDoc({ ...doc.data(), id: doc.id });
      } else {
        const results = await col.query(uk => uk.userId === userId && uk.conversionType === conversionType);
        return results[0];
      }
    },
    getByUser: async (userId: string): Promise<UserKnowledgebase[]> => {
      const col = this.getCol<UserKnowledgebase>("userKnowledgebases");
      if (dbClient) {
        const snap = await (col as any).where("userId", "==", userId).get();
        return snap.docs.map((doc: any) => normalizeDoc({ ...doc.data(), id: doc.id }));
      } else {
        return col.query(uk => uk.userId === userId);
      }
    },
    create: async (kb: UserKnowledgebase): Promise<UserKnowledgebase> => {
      const col = this.getCol<UserKnowledgebase>("userKnowledgebases");
      const id = kb.id || `kb_${Math.random().toString(36).substring(2, 11)}`;
      const cleanKb = {
        ...kb,
        id,
        createdAt: kb.createdAt || new Date().toISOString(),
        updatedAt: kb.updatedAt || new Date().toISOString()
      };
      if (dbClient) {
        await col.doc(id).set(sanitizeForFirestore(cleanKb));
        return cleanKb;
      } else {
        return col.set(id, cleanKb);
      }
    },
    update: async (userId: string, conversionType: string, resources: string): Promise<UserKnowledgebase> => {
      const existing = await this.userKnowledgebases.get(userId, conversionType);
      if (existing) {
        const col = this.getCol<UserKnowledgebase>("userKnowledgebases");
        const cleanUpdates = { resources, updatedAt: new Date().toISOString() };
        if (dbClient) {
          await col.doc(existing.id).update(sanitizeForFirestore(cleanUpdates));
          return { ...existing, ...cleanUpdates } as UserKnowledgebase;
        } else {
          return col.set(existing.id, cleanUpdates);
        }
      } else {
        return this.userKnowledgebases.create({
          id: "",
          userId,
          conversionType,
          resources,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        });
      }
    },
    delete: async (userId: string, conversionType: string): Promise<boolean> => {
      const existing = await this.userKnowledgebases.get(userId, conversionType);
      if (existing) {
        const col = this.getCol<UserKnowledgebase>("userKnowledgebases");
        if (dbClient) {
          await col.doc(existing.id).delete();
          return true;
        } else {
          return col.delete(existing.id);
        }
      }
      return false;
    }
  };

  // User Learnings Repository
  userLearnings = {
    getByUser: async (userId: string): Promise<UserLearning[]> => {
      const col = this.getCol("userLearnings");
      if (dbClient) {
        const snap = await col.where("userId", "==", userId).orderBy("confidence", "desc").get();
        return snap.docs.map((doc: any) => normalizeDoc({ ...doc.data(), id: doc.id }));
      } else {
        const list = await col.query(ul => ul.userId === userId);
        return list.sort((a, b) => b.confidence - a.confidence);
      }
    },
    getByCategory: async (userId: string, category: string): Promise<UserLearning[]> => {
      const col = this.getCol("userLearnings");
      if (dbClient) {
        const snap = await col.where("userId", "==", userId).where("category", "==", category).get();
        return snap.docs.map((doc: any) => normalizeDoc({ ...doc.data(), id: doc.id }));
      } else {
        return col.query(ul => ul.userId === userId && ul.category === category);
      }
    },
    create: async (learning: UserLearning): Promise<UserLearning> => {
      const col = this.getCol("userLearnings");
      const id = learning.id || `ln_${Math.random().toString(36).substring(2, 11)}`;
      const cleanLearning = {
        ...learning,
        id,
        createdAt: learning.createdAt || new Date().toISOString(),
        updatedAt: learning.updatedAt || new Date().toISOString()
      };
      if (dbClient) {
        await col.doc(id).set(sanitizeForFirestore(cleanLearning));
        return cleanLearning;
      } else {
        return col.set(id, cleanLearning);
      }
    },
    update: async (id: string, updates: Partial<UserLearning>): Promise<UserLearning> => {
      const col = this.getCol("userLearnings");
      const cleanUpdates = { ...updates, updatedAt: new Date().toISOString() };
      if (dbClient) {
        await col.doc(id).update(sanitizeForFirestore(cleanUpdates));
        const doc = await col.doc(id).get();
        return normalizeDoc({ ...doc.data(), id: doc.id }) as UserLearning;
      } else {
        return col.set(id, cleanUpdates);
      }
    },
    delete: async (id: string): Promise<boolean> => {
      const col = this.getCol("userLearnings");
      if (dbClient) {
        await col.doc(id).delete();
        return true;
      } else {
        return col.delete(id);
      }
    }
  };

  // User AI Model Preferences Repository
  userAiModelPreferences = {
    get: async (userId: string): Promise<UserAiModelPreference | undefined> => {
      const col = this.getCol("userAiModelPreferences");
      if (dbClient) {
        const doc = await col.doc(userId).get();
        if (!doc.exists) return undefined;
        return normalizeDoc({ ...doc.data(), id: doc.id });
      } else {
        return col.get(userId);
      }
    },
    set: async (userId: string, regularModelId: string | null, advancedModelId: string | null): Promise<UserAiModelPreference> => {
      const col = this.getCol("userAiModelPreferences");
      const cleanPref = {
        id: userId,
        userId,
        regularModelId,
        advancedModelId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      if (dbClient) {
        await col.doc(userId).set(sanitizeForFirestore(cleanPref));
        return cleanPref;
      } else {
        return col.set(userId, cleanPref);
      }
    }
  };

  // Bucket Files Repository
  bucketFiles = {
    get: async (id: string): Promise<BucketFile | undefined> => {
      const col = this.getCol("bucketFiles");
      if (dbClient) {
        const doc = await col.doc(id).get();
        if (!doc.exists) return undefined;
        return normalizeDoc({ ...doc.data(), id: doc.id });
      } else {
        return col.get(id);
      }
    },
    getByUser: async (userId: string): Promise<BucketFile[]> => {
      const col = this.getCol("bucketFiles");
      if (dbClient) {
        const snap = await col.where("userId", "==", userId).orderBy("createdAt", "desc").get();
        return snap.docs.map((doc: any) => normalizeDoc({ ...doc.data(), id: doc.id }));
      } else {
        const list = await col.query(bf => bf.userId === userId);
        return list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      }
    },
    getByKey: async (bucketKey: string): Promise<BucketFile | undefined> => {
      const col = this.getCol("bucketFiles");
      if (dbClient) {
        const snap = await col.where("bucketKey", "==", bucketKey).limit(1).get();
        if (snap.empty) return undefined;
        const doc = snap.docs[0];
        return normalizeDoc({ ...doc.data(), id: doc.id });
      } else {
        const results = await col.query(bf => bf.bucketKey === bucketKey);
        return results[0];
      }
    },
    create: async (file: BucketFile): Promise<BucketFile> => {
      const col = this.getCol("bucketFiles");
      const id = file.id || `bf_${Math.random().toString(36).substring(2, 11)}`;
      const cleanFile = { ...file, id, createdAt: file.createdAt || new Date().toISOString() };
      if (dbClient) {
        await col.doc(id).set(sanitizeForFirestore(cleanFile));
        return cleanFile;
      } else {
        return col.set(id, cleanFile);
      }
    },
    delete: async (id: string): Promise<boolean> => {
      const col = this.getCol("bucketFiles");
      if (dbClient) {
        await col.doc(id).delete();
        return true;
      } else {
        return col.delete(id);
      }
    },
    list: async (): Promise<BucketFile[]> => {
      const col = this.getCol("bucketFiles");
      if (dbClient) {
        const snap = await col.orderBy("createdAt", "desc").get();
        return snap.docs.map((doc: any) => normalizeDoc({ ...doc.data(), id: doc.id }));
      } else {
        const list = await col.list();
        return list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      }
    }
  };

  // KB Prompts Repository
  kbPrompts = {
    list: async (): Promise<KbPrompt[]> => {
      const col = this.getCol("kbPrompts");
      if (dbClient) {
        const snap = await col.orderBy("createdAt", "desc").get();
        return snap.docs.map((doc: any) => normalizeDoc({ ...doc.data(), id: doc.id }));
      } else {
        const list = await col.list();
        return list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      }
    },
    get: async (id: string): Promise<KbPrompt | undefined> => {
      const col = this.getCol("kbPrompts");
      if (dbClient) {
        const doc = await col.doc(id).get();
        if (!doc.exists) return undefined;
        return normalizeDoc({ ...doc.data(), id: doc.id });
      } else {
        return col.get(id);
      }
    },
    create: async (prompt: KbPrompt): Promise<KbPrompt> => {
      const col = this.getCol("kbPrompts");
      const id = prompt.id || `pr_${Math.random().toString(36).substring(2, 11)}`;
      const cleanPrompt = {
        ...prompt,
        id,
        createdAt: prompt.createdAt || new Date().toISOString(),
        updatedAt: prompt.updatedAt || new Date().toISOString()
      };
      if (dbClient) {
        await col.doc(id).set(sanitizeForFirestore(cleanPrompt));
        return cleanPrompt;
      } else {
        return col.set(id, cleanPrompt);
      }
    },
    update: async (id: string, updates: Partial<KbPrompt>): Promise<KbPrompt> => {
      const col = this.getCol("kbPrompts");
      const cleanUpdates = { ...updates, updatedAt: new Date().toISOString() };
      if (dbClient) {
        await col.doc(id).update(sanitizeForFirestore(cleanUpdates));
        const doc = await col.doc(id).get();
        return normalizeDoc({ ...doc.data(), id: doc.id }) as KbPrompt;
      } else {
        return col.set(id, cleanUpdates);
      }
    },
    delete: async (id: string): Promise<boolean> => {
      const col = this.getCol("kbPrompts");
      if (dbClient) {
        await col.doc(id).delete();
        return true;
      } else {
        return col.delete(id);
      }
    }
  };

  // KB Prompt Skills Repository
  kbPromptSkills = {
    getByPrompt: async (promptId: string): Promise<KbPromptSkill[]> => {
      const col = this.getCol("kbPromptSkills");
      if (dbClient) {
        const snap = await col.where("promptId", "==", promptId).get();
        return snap.docs.map((doc: any) => normalizeDoc({ ...doc.data(), id: doc.id }));
      } else {
        return col.query(kps => kps.promptId === promptId);
      }
    },
    create: async (skill: KbPromptSkill): Promise<KbPromptSkill> => {
      const col = this.getCol("kbPromptSkills");
      const id = skill.id || `kps_${Math.random().toString(36).substring(2, 11)}`;
      const cleanSkill = { ...skill, id, createdAt: skill.createdAt || new Date().toISOString() };
      if (dbClient) {
        await col.doc(id).set(sanitizeForFirestore(cleanSkill));
        return cleanSkill;
      } else {
        return col.set(id, cleanSkill);
      }
    },
    update: async (id: string, updates: Partial<KbPromptSkill>): Promise<KbPromptSkill> => {
      const col = this.getCol("kbPromptSkills");
      if (dbClient) {
        await col.doc(id).update(sanitizeForFirestore(updates));
        const doc = await col.doc(id).get();
        return normalizeDoc({ ...doc.data(), id: doc.id }) as KbPromptSkill;
      } else {
        return col.set(id, updates);
      }
    },
    delete: async (id: string): Promise<boolean> => {
      const col = this.getCol("kbPromptSkills");
      if (dbClient) {
        await col.doc(id).delete();
        return true;
      } else {
        return col.delete(id);
      }
    }
  };

  // Passkeys Repository
  passkeys = {
    getByUser: async (userId: string): Promise<Passkey[]> => {
      const col = this.getCol("passkeys");
      if (dbClient) {
        const snap = await col.where("userId", "==", userId).get();
        return snap.docs.map((doc: any) => normalizeDoc({ ...doc.data(), id: doc.id }));
      } else {
        return col.query(pk => pk.userId === userId);
      }
    },
    getByCredentialID: async (credentialID: string): Promise<Passkey | undefined> => {
      const col = this.getCol("passkeys");
      if (dbClient) {
        const snap = await col.where("credentialID", "==", credentialID).limit(1).get();
        if (snap.empty) return undefined;
        const doc = snap.docs[0];
        return normalizeDoc({ ...doc.data(), id: doc.id });
      } else {
        const results = await col.query(pk => pk.credentialID === credentialID);
        return results[0];
      }
    },
    create: async (passkey: Passkey): Promise<Passkey> => {
      const col = this.getCol("passkeys");
      const id = passkey.id || `pk_${Math.random().toString(36).substring(2, 11)}`;
      const cleanPasskey = {
        ...passkey,
        id,
        counter: passkey.counter || 0,
        backedUp: passkey.backedUp ?? false,
        createdAt: passkey.createdAt || new Date().toISOString()
      };
      if (dbClient) {
        await col.doc(id).set(sanitizeForFirestore(cleanPasskey));
        return cleanPasskey;
      } else {
        return col.set(id, cleanPasskey);
      }
    },
    updateCounter: async (id: string, counter: number): Promise<Passkey> => {
      const col = this.getCol("passkeys");
      if (dbClient) {
        await col.doc(id).update({ counter });
        const doc = await col.doc(id).get();
        return normalizeDoc({ ...doc.data(), id: doc.id }) as Passkey;
      } else {
        return col.set(id, { counter });
      }
    },
    delete: async (id: string): Promise<boolean> => {
      const col = this.getCol("passkeys");
      if (dbClient) {
        await col.doc(id).delete();
        return true;
      } else {
        return col.delete(id);
      }
    },
    list: async (): Promise<Passkey[]> => {
      const col = this.getCol("passkeys");
      if (dbClient) {
        const snap = await (col as any).get();
        return snap.docs.map((doc: any) => normalizeDoc({ ...doc.data(), id: doc.id }));
      } else {
        return col.list();
      }
    }
  };

  // User Modules Repository
  userModules = {
    getByUser: async (userId: string): Promise<UserModule[]> => {
      const col = this.getCol("userModules");
      if (dbClient) {
        const snap = await col.where("userId", "==", userId).get();
        return snap.docs.map((doc: any) => normalizeDoc({ ...doc.data(), id: doc.id }));
      } else {
        return col.query(um => um.userId === userId);
      }
    },
    assign: async (userId: string, moduleName: string, stripeSubscriptionId?: string | null, assignedBy?: string | null): Promise<UserModule> => {
      const col = this.getCol("userModules");
      const id = `um_${userId}_${moduleName}`;
      const cleanMod = {
        id,
        userId,
        moduleName,
        stripeSubscriptionId: stripeSubscriptionId || null,
        assignedBy: assignedBy || null,
        assignedAt: new Date().toISOString()
      };
      if (dbClient) {
        await col.doc(id).set(sanitizeForFirestore(cleanMod));
        return cleanMod;
      } else {
        return col.set(id, cleanMod);
      }
    },
    remove: async (userId: string, moduleName: string): Promise<boolean> => {
      const id = `um_${userId}_${moduleName}`;
      const col = this.getCol("userModules");
      if (dbClient) {
        await col.doc(id).delete();
        return true;
      } else {
        return col.delete(id);
      }
    }
  };

  // Coupons Repository
  coupons = {
    getByCode: async (code: string): Promise<Coupon | undefined> => {
      const col = this.getCol("coupons");
      const cleanCode = code.toUpperCase().trim();
      if (dbClient) {
        const snap = await col.where("code", "==", cleanCode).limit(1).get();
        if (snap.empty) return undefined;
        const doc = snap.docs[0];
        return normalizeDoc({ ...doc.data(), id: doc.id }) as Coupon;
      } else {
        const results = await col.query(c => c.code === cleanCode);
        return results[0] as Coupon;
      }
    },
    incrementUses: async (id: string): Promise<Coupon> => {
      const col = this.getCol("coupons");
      if (dbClient) {
        const ref = col.doc(id);
        const doc = await ref.get();
        if (!doc.exists) throw new Error("Coupon not found");
        await ref.update({ uses: FieldValue.increment(1) });
        const updated = await ref.get();
        return normalizeDoc({ ...updated.data(), id: updated.id }) as Coupon;
      } else {
        const existing = await col.get(id);
        if (!existing) throw new Error("Coupon not found");
        return col.set(id, { ...existing, uses: (existing.uses || 0) + 1 });
      }
    },
    create: async (coupon: Omit<Coupon, "id" | "createdAt" | "updatedAt"> & { id?: string }): Promise<Coupon> => {
      const col = this.getCol("coupons");
      const id = coupon.id || `cpn_${Math.random().toString(36).substring(2, 11)}`;
      const cleanCoupon = {
        ...coupon,
        id,
        code: coupon.code.toUpperCase().trim(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      if (dbClient) {
        await col.doc(id).set(sanitizeForFirestore(cleanCoupon));
        return cleanCoupon as Coupon;
      } else {
        return col.set(id, cleanCoupon);
      }
    }
  };

  async clearUserData(userId: string): Promise<void> {
    const user = await this.users.get(userId);
    if (!user) return;

    // Helper to query and delete documents from a collection by a field match
    const deleteByQuery = async (colName: string, field: string, value: any) => {
      const col = this.getCol(colName);
      if (dbClient) {
        try {
          const snap = await col.where(field, "==", value).get();
          if (!snap.empty) {
            await bulkDeleteDocumentRefs(snap.docs.map((doc: any) => doc.ref));
          }
        } catch (err: any) {
          // If index is missing, fall back to client-side filtering
          if (err.code === 9 || String(err.message).includes("index")) {
            const allDocs = await (col as any).get();
            const matched = allDocs.docs.filter((doc: any) => doc.data()?.[field] === value);
            await bulkDeleteDocumentRefs(matched.map((doc: any) => doc.ref));
          } else {
            throw err;
          }
        }
      } else {
        const list = await col.query(doc => doc[field] === value);
        for (const doc of list) {
          await col.delete(doc.id);
        }
      }
    };

    // 1. Delete associated data collections
    await deleteByQuery("userFiles", "userId", userId);
    await deleteByQuery("userFolders", "userId", userId);
    await deleteByQuery("thoughtThreadRunChunks", "userId", userId);
    await deleteByQuery("thoughtThreadRuns", "userId", userId);
    await deleteByQuery("thoughtThreadContexts", "userId", userId);
    await deleteByQuery("thoughtThreadItems", "userId", userId);
    await deleteByQuery("thoughtThreads", "userId", userId);
    await deleteByQuery("recordingContexts", "userId", userId);
    await deleteByQuery("recordings", "userId", userId);
    await deleteByQuery("usageLimits", "userId", userId);
    await deleteByQuery("usageReservations", "userId", userId);
    await deleteByQuery("usageEvents", "userId", userId);
    await deleteByQuery("backupLogs", "userId", userId);
    await deleteByQuery("backupProviders", "userId", userId);
    await deleteByQuery("taskProviders", "userId", userId);
    await deleteByQuery("calendarProviders", "userId", userId);
    await deleteByQuery("stylePreferences", "userId", userId);
    await deleteByQuery("userSkills", "userId", userId);
    await deleteByQuery("userKnowledgebases", "userId", userId);
    await deleteByQuery("userLearnings", "userId", userId);
    await deleteByQuery("connectorProviders", "userId", userId);
    await deleteByQuery("trustedDevices", "userId", userId);
    await deleteByQuery("passkeys", "userId", userId);
    await deleteByQuery("accounts", "userId", userId);
    await deleteByQuery("bucketFiles", "userId", userId);
    await deleteByQuery("developerApiKeys", "userId", userId);

    // 2. Dissociate assigned userModules (set assignedBy = null)
    const umCol = this.getCol("userModules");
    if (dbClient) {
      const snap = await umCol.where("assignedBy", "==", userId).get();
      if (!snap.empty) {
        await runBulkWriter((writer) =>
          snap.docs.map((doc: any) => writer.update(doc.ref, { assignedBy: null })));
      }
    } else {
      const list = await umCol.query(um => um.assignedBy === userId);
      for (const um of list) {
        await umCol.set(um.id, { ...um, assignedBy: null });
      }
    }
    // Also delete userModules belonging to the user
    await deleteByQuery("userModules", "userId", userId);

    // 3. Delete verifications by email
    if (user.email) {
      await deleteByQuery("verifications", "identifier", user.email);
    }

    // 4. Delete sessions and their verifications
    const sessionCol = this.getCol("sessions");
    let userSessions: any[] = [];
    if (dbClient) {
      const snap = await sessionCol.where("userId", "==", userId).get();
      userSessions = snap.docs.map((doc: any) => ({ id: doc.id }));
    } else {
      userSessions = await sessionCol.query(s => s.userId === userId);
    }

    for (const s of userSessions) {
      await deleteByQuery("verifications", "identifier", `session:${s.id}`);
    }
    await deleteByQuery("sessions", "userId", userId);

    // 5. Delete the user document itself
    await this.users.delete(userId);
  }

  async checkHealth(): Promise<{ status: string; type: string; error?: string }> {
    if (dbClient) {
      try {
        await dbClient.collection("healthcheck").limit(1).get();
        return { status: "ok", type: "firestore" };
      } catch (err: any) {
        return { status: "error", type: "firestore", error: err.message || String(err) };
      }
    } else {
      try {
        const dir = path.dirname(MOCK_DB_PATH);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        return { status: "ok", type: "mock-db" };
      } catch (err: any) {
        return { status: "error", type: "mock-db", error: err.message || String(err) };
      }
    }
  }
}
