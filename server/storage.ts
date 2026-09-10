import {
  User, InsertUser,
  Recording, InsertRecording,
  Session, Account, Verification,
  BackupProvider, BackupLog, TaskProvider, CalendarProvider, ConnectorProvider, TrustedDevice,
  UsageEvent, StylePreference, UserFolder, UserFile, UsageLimit, UserSkill,
  UserKnowledgebase, UserLearning, UserAiModelPreference, BucketFile, KbPrompt, KbPromptSkill,
  Passkey, UserModule, Coupon, DeveloperApiKey
  , ThoughtThread, ThoughtThreadItem, ThoughtThreadContext, ThoughtThreadConversionRun, ThoughtThreadRunChunk,
  UsageReservation, RecordingContextSource
} from "@shared/schema";

export type RevenueCatWebhookEventRecord = {
  id: string;
  userId: string;
  type: string;
  environment: string | null;
  eventTimestampMs: number | null;
  productId: string | null;
  transactionId: string | null;
};

export type RevenueCatWebhookApplyResult =
  | "applied"
  | "duplicate"
  | "stale"
  | "user_not_found";

export interface IStorage {
  // Backwards compatibility legacy top-level methods
  getUser(id: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  getRecordingsByUser(userId: string): Promise<Recording[]>;
  getRecordingsByUserPaginated(userId: string, options: { page?: number; limit?: number; search?: string }): Promise<{ recordings: Recording[]; total: number }>;
  getRecording(id: string, userId: string): Promise<Recording | undefined>;
  createRecording(recording: InsertRecording): Promise<Recording>;
  updateRecording(id: string, userId: string, updates: Partial<InsertRecording>): Promise<Recording | undefined>;
  deleteRecording(id: string, userId: string): Promise<boolean>;

  // Native Domain Repositories
  users: {
    get(id: string): Promise<User | undefined>;
    getByEmail(email: string): Promise<User | undefined>;
    getByStripeCustomerId(customerId: string): Promise<User | undefined>;
    create(user: InsertUser): Promise<User>;
    update(id: string, updates: Partial<User>): Promise<User>;
    delete(id: string): Promise<boolean>;
    list(): Promise<User[]>;
    count(): Promise<number>;
  };

  revenueCatEvents: {
    apply(
      event: RevenueCatWebhookEventRecord,
      updates: Partial<User>,
    ): Promise<RevenueCatWebhookApplyResult>;
  };

  billingRedemptions: {
    apply(
      redemption: {
        id: string;
        userId: string;
        kind: "token_pack" | "storage_addon";
        productId: string | null;
      },
      updates: Partial<User>,
    ): Promise<"applied" | "duplicate" | "user_not_found">;
  };
  
  recordings: {
    get(id: string, userId: string): Promise<Recording | undefined>;
    getByUser(userId: string): Promise<Recording[]>;
    getByUserPaginated(userId: string, options: { page?: number; limit?: number; search?: string }): Promise<{ recordings: Recording[]; total: number }>;
    create(recording: InsertRecording): Promise<Recording>;
    update(id: string, userId: string, updates: Partial<Recording>): Promise<Recording | undefined>;
    delete(id: string, userId: string): Promise<boolean>;
    countAll(): Promise<number>;
  };

  thoughtThreads: {
    get(id: string, userId: string): Promise<ThoughtThread | undefined>;
    getByUser(userId: string): Promise<ThoughtThread[]>;
    create(thread: ThoughtThread): Promise<ThoughtThread>;
    update(id: string, userId: string, updates: Partial<ThoughtThread>): Promise<ThoughtThread | undefined>;
    incrementRunCount(id: string, userId: string): Promise<ThoughtThread | undefined>;
    commitMutation(
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
    ): Promise<ThoughtThread | undefined>;
    createWithItems(thread: ThoughtThread, items: ThoughtThreadItem[]): Promise<ThoughtThread>;
    createRunWithChunks(
      id: string,
      userId: string,
      expectedVersion: number,
      run: ThoughtThreadConversionRun,
      chunks: ThoughtThreadRunChunk[],
    ): Promise<ThoughtThread | undefined>;
    delete(id: string, userId: string): Promise<boolean>;
  };

  thoughtThreadItems: {
    getByThread(threadId: string, userId: string): Promise<ThoughtThreadItem[]>;
    getByUser(userId: string): Promise<ThoughtThreadItem[]>;
    getByRecording(recordingId: string, userId: string): Promise<ThoughtThreadItem[]>;
    create(item: ThoughtThreadItem): Promise<ThoughtThreadItem>;
    update(id: string, userId: string, updates: Partial<ThoughtThreadItem>): Promise<ThoughtThreadItem | undefined>;
    delete(id: string, userId: string): Promise<boolean>;
    deleteByThread(threadId: string, userId: string): Promise<number>;
  };

  thoughtThreadContexts: {
    getByThread(threadId: string, userId: string): Promise<ThoughtThreadContext[]>;
    getByUser(userId: string): Promise<ThoughtThreadContext[]>;
    create(context: ThoughtThreadContext): Promise<ThoughtThreadContext>;
    update(id: string, userId: string, updates: Partial<ThoughtThreadContext>): Promise<ThoughtThreadContext | undefined>;
    delete(id: string, userId: string): Promise<boolean>;
    deleteByThread(threadId: string, userId: string): Promise<number>;
  };

  thoughtThreadRuns: {
    get(id: string, threadId: string, userId: string): Promise<ThoughtThreadConversionRun | undefined>;
    getByThread(threadId: string, userId: string): Promise<ThoughtThreadConversionRun[]>;
    getByUser(userId: string): Promise<ThoughtThreadConversionRun[]>;
    create(run: ThoughtThreadConversionRun): Promise<ThoughtThreadConversionRun>;
    update(id: string, userId: string, updates: Partial<ThoughtThreadConversionRun>): Promise<ThoughtThreadConversionRun | undefined>;
    transition(
      id: string,
      threadId: string,
      userId: string,
      expectedStatuses: ThoughtThreadConversionRun["status"][],
      updates: Partial<ThoughtThreadConversionRun>,
    ): Promise<ThoughtThreadConversionRun | undefined>;
    claimLease(
      id: string,
      threadId: string,
      userId: string,
      expectedStatuses: ThoughtThreadConversionRun["status"][],
      leaseToken: string,
      leaseExpiresAt: string,
    ): Promise<ThoughtThreadConversionRun | undefined>;
    deleteByThread(threadId: string, userId: string): Promise<number>;
  };

  thoughtThreadRunChunks: {
    getByRun(runId: string, threadId: string, userId: string, kind?: ThoughtThreadRunChunk["kind"]): Promise<ThoughtThreadRunChunk[]>;
    createMany(chunks: ThoughtThreadRunChunk[]): Promise<void>;
    replaceKind(runId: string, threadId: string, userId: string, kind: ThoughtThreadRunChunk["kind"], chunks: ThoughtThreadRunChunk[]): Promise<void>;
    deleteByRun(runId: string, threadId: string, userId: string): Promise<number>;
    deleteByThread(threadId: string, userId: string): Promise<number>;
  };

  recordingContexts: {
    getByRecording(recordingId: string, userId: string): Promise<RecordingContextSource[]>;
    get(id: string, recordingId: string, userId: string): Promise<RecordingContextSource | undefined>;
    upsert(context: RecordingContextSource): Promise<RecordingContextSource>;
    update(id: string, recordingId: string, userId: string, updates: Partial<RecordingContextSource>): Promise<RecordingContextSource | undefined>;
    delete(id: string, recordingId: string, userId: string): Promise<boolean>;
  };
  
  sessions: {
    get(id: string): Promise<Session | undefined>;
    getByToken(token: string): Promise<Session | undefined>;
    create(session: Session): Promise<Session>;
    delete(id: string): Promise<boolean>;
    deleteByToken(token: string): Promise<boolean>;
    deleteExpired(now: Date): Promise<number>;
    deleteByUser(userId: string): Promise<boolean>;
    list(): Promise<Session[]>;
  };
  
  accounts: {
    get(id: string): Promise<Account | undefined>;
    getByUserAndProvider(userId: string, providerId: string): Promise<Account | undefined>;
    getByProviderIdAndAccountId(providerId: string, accountId: string): Promise<Account | undefined>;
    create(account: Account): Promise<Account>;
    update(id: string, updates: Partial<Account>): Promise<Account>;
    delete(id: string): Promise<boolean>;
  };
  
  verifications: {
    get(id: string): Promise<Verification | undefined>;
    getByIdentifierAndValue(identifier: string, value: string): Promise<Verification | undefined>;
    getByIdentifier(identifier: string): Promise<Verification | undefined>;
    create(verification: Verification): Promise<Verification>;
    delete(id: string): Promise<boolean>;
  };
  
  backupProviders: {
    get(id: string): Promise<BackupProvider | undefined>;
    getByUser(userId: string): Promise<BackupProvider[]>;
    create(provider: BackupProvider): Promise<BackupProvider>;
    update(id: string, updates: Partial<BackupProvider>): Promise<BackupProvider>;
    delete(id: string): Promise<boolean>;
  };
  
  backupLogs: {
    getByUser(userId: string): Promise<BackupLog[]>;
    create(log: BackupLog): Promise<BackupLog>;
  };
  
  taskProviders: {
    get(id: string): Promise<TaskProvider | undefined>;
    getByUser(userId: string): Promise<TaskProvider[]>;
    create(provider: TaskProvider): Promise<TaskProvider>;
    update(id: string, updates: Partial<TaskProvider>): Promise<TaskProvider>;
    delete(id: string): Promise<boolean>;
  };
  
  calendarProviders: {
    get(id: string): Promise<CalendarProvider | undefined>;
    getByUser(userId: string): Promise<CalendarProvider[]>;
    create(provider: CalendarProvider): Promise<CalendarProvider>;
    update(id: string, updates: Partial<CalendarProvider>): Promise<CalendarProvider>;
    delete(id: string): Promise<boolean>;
  };
  
  connectorProviders: {
    get(id: string): Promise<ConnectorProvider | undefined>;
    getByUser(userId: string): Promise<ConnectorProvider[]>;
    create(provider: ConnectorProvider): Promise<ConnectorProvider>;
    update(id: string, updates: Partial<ConnectorProvider>): Promise<ConnectorProvider>;
    delete(id: string): Promise<boolean>;
  };
  
  trustedDevices: {
    getByUser(userId: string): Promise<TrustedDevice[]>;
    create(device: TrustedDevice): Promise<TrustedDevice>;
    delete(id: string): Promise<boolean>;
  };
  
  usageEvents: {
    getByUser(userId: string): Promise<UsageEvent[]>;
    create(event: Omit<UsageEvent, "id"> & { id?: number | string }): Promise<UsageEvent>;
    getAdvancedConversionCount(userId: string, termStart: Date | string, advancedTypes: string[]): Promise<number>;
  };
  
  stylePreferences: {
    getByUser(userId: string): Promise<StylePreference[]>;
    create(preference: StylePreference): Promise<StylePreference>;
    delete(id: string): Promise<boolean>;
  };
  
  userFolders: {
    get(id: string): Promise<UserFolder | undefined>;
    getByUser(userId: string): Promise<UserFolder[]>;
    create(folder: UserFolder): Promise<UserFolder>;
    update(id: string, updates: Partial<UserFolder>): Promise<UserFolder>;
    delete(id: string): Promise<boolean>;
  };
  
  userFiles: {
    get(id: string): Promise<UserFile | undefined>;
    getByUser(userId: string): Promise<UserFile[]>;
    getByFolder(folderId: string): Promise<UserFile[]>;
    create(file: UserFile): Promise<UserFile>;
    update(id: string, updates: Partial<UserFile>): Promise<UserFile>;
    delete(id: string): Promise<boolean>;
  };
  
  usageLimits: {
    get(userId: string, actionType: string, dateKey: string): Promise<UsageLimit | undefined>;
    create(limit: Omit<UsageLimit, "id"> & { id?: number | string }): Promise<UsageLimit>;
    update(id: number | string, updates: Partial<UsageLimit>): Promise<UsageLimit>;
    increment(userId: string, actionType: string, dateKey: string, amount?: number): Promise<void>;
  };

  usageReservations: {
    get(id: string, userId: string): Promise<UsageReservation | undefined>;
    reserve(reservation: UsageReservation, maximumCommittedAndReserved: number): Promise<boolean>;
    settle(id: string, userId: string, outcome: "committed" | "released"): Promise<UsageReservation | undefined>;
    releaseExpired(userId: string, actionType: string, dateKey: string, now: Date): Promise<number>;
  };
  
  userSkills: {
    get(userId: string, conversionType: string): Promise<UserSkill | undefined>;
    getByUser(userId: string): Promise<UserSkill[]>;
    create(skill: UserSkill): Promise<UserSkill>;
    update(userId: string, conversionType: string, skillContent: string): Promise<UserSkill>;
    delete(userId: string, conversionType: string): Promise<boolean>;
  };
  
  userKnowledgebases: {
    get(userId: string, conversionType: string): Promise<UserKnowledgebase | undefined>;
    getByUser(userId: string): Promise<UserKnowledgebase[]>;
    create(kb: UserKnowledgebase): Promise<UserKnowledgebase>;
    update(userId: string, conversionType: string, resources: string): Promise<UserKnowledgebase>;
    delete(userId: string, conversionType: string): Promise<boolean>;
  };
  
  userLearnings: {
    getByUser(userId: string): Promise<UserLearning[]>;
    getByCategory(userId: string, category: string): Promise<UserLearning[]>;
    create(learning: UserLearning): Promise<UserLearning>;
    update(id: string, updates: Partial<UserLearning>): Promise<UserLearning>;
    delete(id: string): Promise<boolean>;
  };
  
  userAiModelPreferences: {
    get(userId: string): Promise<UserAiModelPreference | undefined>;
    set(userId: string, regularModelId: string | null, advancedModelId: string | null): Promise<UserAiModelPreference>;
  };
  
  bucketFiles: {
    get(id: string): Promise<BucketFile | undefined>;
    getByUser(userId: string): Promise<BucketFile[]>;
    getByKey(bucketKey: string): Promise<BucketFile | undefined>;
    create(file: BucketFile): Promise<BucketFile>;
    delete(id: string): Promise<boolean>;
    list(): Promise<BucketFile[]>;
  };
  
  kbPrompts: {
    list(): Promise<KbPrompt[]>;
    get(id: string): Promise<KbPrompt | undefined>;
    create(prompt: KbPrompt): Promise<KbPrompt>;
    update(id: string, updates: Partial<KbPrompt>): Promise<KbPrompt>;
    delete(id: string): Promise<boolean>;
  };
  
  kbPromptSkills: {
    getByPrompt(promptId: string): Promise<KbPromptSkill[]>;
    create(skill: KbPromptSkill): Promise<KbPromptSkill>;
    update(id: string, updates: Partial<KbPromptSkill>): Promise<KbPromptSkill>;
    delete(id: string): Promise<boolean>;
  };
  
  passkeys: {
    getByUser(userId: string): Promise<Passkey[]>;
    getByCredentialID(credentialID: string): Promise<Passkey | undefined>;
    create(passkey: Passkey): Promise<Passkey>;
    updateCounter(id: string, counter: number): Promise<Passkey>;
    delete(id: string): Promise<boolean>;
    list(): Promise<Passkey[]>;
  };
  
  userModules: {
    getByUser(userId: string): Promise<UserModule[]>;
    assign(userId: string, moduleName: string, stripeSubscriptionId?: string | null, assignedBy?: string | null): Promise<UserModule>;
    remove(userId: string, moduleName: string): Promise<boolean>;
  };
  
  coupons: {
    getByCode(code: string): Promise<Coupon | undefined>;
    incrementUses(id: string): Promise<Coupon>;
    create(coupon: Omit<Coupon, "id" | "createdAt" | "updatedAt"> & { id?: string }): Promise<Coupon>;
  };

  developerApiKeys: {
    get(id: string): Promise<DeveloperApiKey | undefined>;
    getByHash(keyHash: string): Promise<DeveloperApiKey | undefined>;
    getByUser(userId: string): Promise<DeveloperApiKey[]>;
    create(key: DeveloperApiKey): Promise<DeveloperApiKey>;
    update(id: string, updates: Partial<DeveloperApiKey>): Promise<DeveloperApiKey | undefined>;
    delete(id: string): Promise<boolean>;
  };

  clearUserData(userId: string): Promise<void>;
  checkHealth(): Promise<{ status: string; type: string; error?: string }>;
}

// Temporary exports for SQL compat during the refactoring phases
import { db, pool } from "./firestore-db";
export { db, pool };

import { FirestoreStorage } from "./firestore-storage";
export const storage: IStorage = new FirestoreStorage();
