import { z } from "zod";
import type { RecordingTransferFields } from "./recording-transfer";

export interface User {
  id: string;
  name: string;
  email: string;
  emailVerified: number;
  image?: string | null;
  userNumber: number;
  firstName: string;
  jobType: string;
  country?: string | null;
  avatarId?: string | null;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  cloudSyncSubscriptionId?: string | null;
  cloudSyncGracePeriodEnd?: Date | string | null;
  cloudSyncEnabled: number;
  forcePasswordChange: number;
  role: string;
  friendsOfBarryGrantedAt?: Date | string | null;
  friendsOfBarryExpiresAt?: Date | string | null;
  friendsOfBarryRenewedAt?: Date | string | null;
  passwordLastChanged?: Date | string | null;
  twoFactorEnabled: number;
  cachedTier: string;
  tierCachedAt?: Date | string | null;
  proAccessEnabled: number;
  proAccessSubscriptionId?: string | null;
  revenueCatEntitlements?: string[] | null;
  revenueCatProductId?: string | null;
  revenueCatTransactionId?: string | null;
  revenueCatExpirationAt?: Date | string | null;
  revenueCatLastEventId?: string | null;
  revenueCatLastEventAt?: Date | string | null;
  spendingCap?: number | null;
  hasSeenPlanSelection: number;
  grantedTier?: string | null;
  grantedTierExpiresAt?: Date | string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
}

export type InsertUser = Partial<User> & {
  email: string;
  name: string;
};

export interface Session {
  id: string;
  expiresAt: Date | string;
  token: string;
  createdAt: Date | string;
  updatedAt: Date | string;
  ipAddress?: string | null;
  userAgent?: string | null;
  userId: string;
}

export interface Account {
  id: string;
  accountId: string;
  providerId: string;
  userId: string;
  accessToken?: string | null;
  refreshToken?: string | null;
  idToken?: string | null;
  accessTokenExpiresAt?: Date | string | null;
  refreshTokenExpiresAt?: Date | string | null;
  scope?: string | null;
  password?: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
}

export interface Verification {
  id: string;
  identifier: string;
  value: string;
  expiresAt: Date | string;
  createdAt: Date | string;
  updatedAt: Date | string;
}

export interface Recording extends RecordingTransferFields {
  id: string;
  userId: string;
  title: string;
  duration: number;
  audioUri: string;
  transcript: string;
  transcriptRevision?: number;
  transcriptHash?: string | null;
  transcriptUpdatedAt?: Date | string | null;
  conversions: any;
  createdAt: Date | string;
}

export type InsertRecording = Partial<Recording> & {
  id: string;
  userId: string;
  title: string;
};

export type ThoughtThreadStatus = "open" | "ready" | "archived";
export type ThoughtThreadOrderingMode = "chronological" | "manual";

export interface ThoughtThread {
  id: string;
  userId: string;
  title: string;
  status: ThoughtThreadStatus;
  orderingMode: ThoughtThreadOrderingMode;
  version: number;
  sourceRevision: number;
  recordingCount: number;
  contextCount: number;
  runCount: number;
  createdAt: Date | string;
  updatedAt: Date | string;
  lastConvertedAt?: Date | string | null;
  lastConvertedRunId?: string | null;
  lastConvertedSourceRevision?: number | null;
  hasCurrentOutput?: boolean;
}

export interface ThoughtThreadItem {
  id: string;
  userId: string;
  threadId: string;
  recordingId: string;
  position: number;
  included: boolean;
  sourceCreatedAt: Date | string;
  attachedTranscriptRevision?: number | null;
  attachedTranscriptHash?: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
}

export type ThoughtThreadContextKind = "text" | "file";

export interface ThoughtThreadContext {
  id: string;
  userId: string;
  threadId: string;
  kind: ThoughtThreadContextKind;
  label: string;
  text: string;
  originalFilename?: string | null;
  sourceMimeType?: string | null;
  sourceFileSize?: number | null;
  sourceHash?: string | null;
  parserVersion?: string | null;
  truncated?: boolean;
  contentEdited?: boolean;
  revision?: number;
  derivedTextHash?: string | null;
  relationship?: "continues" | "clarifies" | "supersedes" | "conflicts" | "supports" | null;
  relatedSourceId?: string | null;
  sourceBucketFileId?: string | null;
  position: number;
  createdAt: Date | string;
  updatedAt: Date | string;
}

export type ThoughtThreadRunStatus = "preparing" | "prepared" | "converting" | "completed" | "failed" | "cancelled";
export type ThoughtThreadModelStrategy = "direct" | "hierarchical";
export type ThoughtThreadUsageStatus = "not_required" | "reserved" | "committed" | "released";

export interface ThoughtThreadModelRouteSnapshot {
  provider: string;
  model: string;
  reason: string;
  bucket: string;
  selectedModelId?: string | null;
  inputTokenLimit: number;
}

export interface ThoughtThreadSourceManifestRecording {
  itemId: string;
  recordingId: string;
  position: number;
  capturedAt: Date | string;
  transcriptRevision: number;
  transcriptHash: string;
}

export interface ThoughtThreadSourceManifestContext {
  contextId: string;
  kind: ThoughtThreadContextKind;
  position: number;
  label: string;
  revision: number;
  derivedTextHash: string;
  originalFilename?: string | null;
  sourceMimeType?: string | null;
  sourceFileSize?: number | null;
  sourceHash?: string | null;
  parserVersion?: string | null;
  contentEdited?: boolean;
  relationship?: ThoughtThreadContext["relationship"];
  relatedSourceId?: string | null;
}

export interface ThoughtThreadSourceManifest {
  version: 1;
  orderingMode: ThoughtThreadOrderingMode;
  assembledSourceHash: string;
  recordings: ThoughtThreadSourceManifestRecording[];
  contexts: ThoughtThreadSourceManifestContext[];
}

export interface ThoughtThreadConversionRun {
  id: string;
  userId: string;
  threadId: string;
  conversionType: string;
  status: ThoughtThreadRunStatus;
  sourceRecordingIds: string[];
  contextEntryIds: string[];
  sourceSnapshot?: string | null;
  preparedSource?: string | null;
  sourceHash: string;
  preparedHash?: string | null;
  sourceVersion: number;
  sourceByteLength: number;
  preparedByteLength?: number | null;
  estimatedTokens: number;
  modelStrategy: ThoughtThreadModelStrategy;
  modelRoutes?: ThoughtThreadModelRouteSnapshot[];
  directTokenLimit?: number | null;
  promptVersion?: string | null;
  customPromptHash?: string | null;
  modelPreferenceHash?: string | null;
  sourceManifest?: ThoughtThreadSourceManifest | null;
  citationStyle?: string | null;
  bibliographyType?: string | null;
  outputFormat?: "markdown" | "plaintext";
  language?: string | null;
  customPrompt?: string | null;
  clarificationQuestion?: string | null;
  clarificationAnswer?: string | null;
  usageReserved?: boolean;
  usageStatus?: ThoughtThreadUsageStatus;
  usageReservationId?: string | null;
  attemptCount?: number;
  progressCompleted?: number;
  progressTotal?: number | null;
  leaseExpiresAt?: Date | string | null;
  leaseToken?: string | null;
  startedAt?: Date | string | null;
  updatedAt?: Date | string;
  actualProvider?: string | null;
  actualModel?: string | null;
  output?: string | null;
  fileId?: string | null;
  error?: string | null;
  createdAt: Date | string;
  completedAt?: Date | string | null;
}

export type ThoughtThreadRunChunkKind = "source" | "prepared";

export interface ThoughtThreadRunChunk {
  id: string;
  userId: string;
  threadId: string;
  runId: string;
  kind: ThoughtThreadRunChunkKind;
  index: number;
  text: string;
  byteLength: number;
  hash: string;
  createdAt: Date | string;
}

export interface RecordingContextSource {
  id: string;
  userId: string;
  recordingId: string;
  kind: "text" | "file";
  label: string;
  text: string;
  revision: number;
  derivedTextHash: string;
  originalFilename?: string | null;
  sourceMimeType?: string | null;
  sourceFileSize?: number | null;
  sourceHash?: string | null;
  parserVersion?: string | null;
  contentEdited?: boolean;
  sourceBucketFileId?: string | null;
  originalUnavailable?: boolean;
  createdAt: Date | string;
  updatedAt: Date | string;
}

export interface BackupProvider {
  id: string;
  userId: string;
  provider: string;
  enabled: number;
  config: any;
  lastBackupAt?: Date | string | null;
  createdAt: Date | string;
}

export interface BackupLog {
  id: string;
  userId: string;
  providerId: string;
  recordingId?: string | null;
  fileType: string;
  fileName: string;
  remotePath: string;
  status: string;
  errorMessage?: string | null;
  createdAt: Date | string;
}

export interface TaskProvider {
  id: string;
  userId: string;
  provider: string;
  enabled: number;
  label: string;
  config: any;
  createdAt: Date | string;
}

export interface CalendarProvider {
  id: string;
  userId: string;
  provider: string;
  enabled: number;
  label: string;
  config: any;
  createdAt: Date | string;
}

export interface ConnectorProvider {
  id: string;
  userId: string;
  provider: string;
  enabled: number;
  label: string;
  config: any;
  createdAt: Date | string;
}

export interface TrustedDevice {
  id: string;
  userId: string;
  deviceToken: string;
  ipAddress: string;
  userAgent: string;
  label: string;
  lastUsedAt: Date | string;
  createdAt: Date | string;
}

export interface ReplitProject {
  id: string;
  userId: string;
  name: string;
  url: string;
  createdAt: Date | string;
}

export interface UsageEvent {
  id: number | string;
  eventType: string;
  userId?: string | null;
  metadata?: any;
  createdAt: Date | string;
}

export interface StylePreference {
  id: string;
  userId: string;
  conversionType: string;
  feedback: string;
  createdAt: Date | string;
}

export interface UserFolder {
  id: string;
  userId: string;
  name: string;
  parentId?: string | null;
  isSystem: number;
  createdAt: Date | string;
  updatedAt: Date | string;
}

export interface UserFile {
  id: string;
  userId: string;
  folderId?: string | null;
  name: string;
  conversionType?: string | null;
  content: string;
  fileSize: number;
  mimeType: string;
  sourceRecordingId?: string | null;
  sourceRecordingIds?: string[] | null;
  sourceThoughtThreadId?: string | null;
  sourceThoughtThreadRunId?: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
}

export interface UsageLimit {
  id: number | string;
  userId: string;
  actionType: string;
  dateKey: string;
  count: number;
  reservedCount?: number;
}

export interface UsageReservation {
  id: string;
  userId: string;
  actionType: string;
  dateKey: string;
  status: "reserved" | "committed" | "released";
  runId?: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
  expiresAt: Date | string;
  committedAt?: Date | string | null;
  releasedAt?: Date | string | null;
}

export interface SkillDefinition {
  voice: string;
  rules: string[];
  outputExample: string;
  qualityCriteria: string[];
}

export interface KnowledgebaseResource {
  title: string;
  url: string;
  description: string;
}

export function parseSkillContent(raw: string): SkillDefinition {
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && "voice" in parsed && "rules" in parsed) {
      return {
        voice: parsed.voice || "",
        rules: Array.isArray(parsed.rules) ? parsed.rules : [],
        outputExample: parsed.outputExample || "",
        qualityCriteria: Array.isArray(parsed.qualityCriteria) ? parsed.qualityCriteria : [],
      };
    }
  } catch {}
  return {
    voice: "",
    rules: raw ? [raw] : [],
    outputExample: "",
    qualityCriteria: [],
  };
}

export function serializeSkillContent(skill: SkillDefinition): string {
  return JSON.stringify(skill);
}

export interface UserSkill {
  id: string;
  userId: string;
  conversionType: string;
  skillContent: string;
  createdAt: Date | string;
  updatedAt: Date | string;
}

export interface UserKnowledgebase {
  id: string;
  userId: string;
  conversionType: string;
  resources: string;
  createdAt: Date | string;
  updatedAt: Date | string;
}

export interface UserLearning {
  id: string;
  userId: string;
  category: string;
  conversionType?: string | null;
  insight: string;
  confidence: number;
  source: string;
  createdAt: Date | string;
  updatedAt: Date | string;
}

export interface UserAiModelPreference {
  id: string;
  userId: string;
  regularModelId?: string | null;
  advancedModelId?: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
}

export interface BucketFile {
  id: string;
  userId: string;
  bucketKey: string;
  originalName: string;
  mimeType: string;
  fileSize: number;
  category: string;
  createdAt: Date | string;
}

export interface KbPrompt {
  id: string;
  title: string;
  category: string;
  problemDescription: string;
  investigationSteps: string;
  idealEndState: string;
  tags: string[];
  sourceTaskRef?: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
}

export interface KbPromptSkill {
  id: string;
  promptId: string;
  title: string;
  skillName: string;
  skillContent: string;
  createdAt: Date | string;
}

export interface Passkey {
  id: string;
  name?: string | null;
  publicKey: string;
  userId: string;
  credentialID: string;
  counter: number;
  deviceType: string;
  backedUp: boolean;
  transports?: string | null;
  createdAt?: Date | string | null;
  aaguid?: string | null;
}

export interface UserModule {
  id: number | string;
  userId: string;
  moduleName: string;
  stripeSubscriptionId?: string | null;
  assignedBy?: string | null;
  assignedAt: Date | string;
}

export const COUNTRIES = [
  "United States", "Mexico", "Canada",
  "Afghanistan", "Albania", "Algeria", "Andorra", "Angola", "Antigua and Barbuda", "Argentina", "Armenia",
  "Australia", "Austria", "Azerbaijan", "Bahamas", "Bahrain", "Bangladesh", "Barbados", "Belarus",
  "Belgium", "Belize", "Benin", "Bhutan", "Bolivia", "Bosnia and Herzegovina", "Botswana", "Brazil",
  "Brunei", "Bulgaria", "Burkina Faso", "Burundi", "Cabo Verde", "Cambodia", "Cameroon",
  "Central African Republic", "Chad", "Chile", "China", "Colombia", "Comoros", "Congo", "Costa Rica",
  "Croatia", "Cuba", "Cyprus", "Czech Republic", "Denmark", "Djibouti", "Dominica", "Dominican Republic",
  "Ecuador", "Egypt", "El Salvador", "Equatorial Guinea", "Eritrea", "Estonia", "Eswatini", "Ethiopia",
  "Fiji", "Finland", "France", "Gabon", "Gambia", "Georgia", "Germany", "Ghana", "Greece", "Grenada",
  "Guatemala", "Guinea", "Guinea-Bissau", "Guyana", "Haiti", "Honduras", "Hungary", "Iceland", "India",
  "Indonesia", "Iran", "Iraq", "Ireland", "Israel", "Italy", "Jamaica", "Japan", "Jordan", "Kazakhstan",
  "Kenya", "Kiribati", "Kosovo", "Kuwait", "Kyrgyzstan", "Laos", "Latvia", "Lebanon", "Lesotho",
  "Liberia", "Libya", "Liechtenstein", "Lithuania", "Luxembourg", "Madagascar", "Malawi", "Malaysia",
  "Maldives", "Mali", "Malta", "Marshall Islands", "Mauritania", "Mauritius", "Micronesia",
  "Moldova", "Monaco", "Mongolia", "Montenegro", "Morocco", "Mozambique", "Myanmar", "Namibia", "Nauru",
  "Nepal", "Netherlands", "New Zealand", "Nicaragua", "Niger", "Nigeria", "North Korea", "North Macedonia",
  "Norway", "Oman", "Pakistan", "Palau", "Palestine", "Panama", "Papua New Guinea", "Paraguay", "Peru",
  "Philippines", "Poland", "Portugal", "Qatar", "Romania", "Russia", "Rwanda", "Saint Kitts and Nevis",
  "Saint Lucia", "Saint Vincent and the Grenadines", "Samoa", "San Marino", "Sao Tome and Principe",
  "Saudi Arabia", "Senegal", "Serbia", "Seychelles", "Sierra Leone", "Singapore", "Slovakia", "Slovenia",
  "Solomon Islands", "Somalia", "South Africa", "South Korea", "South Sudan", "Spain", "Sri Lanka",
  "Sudan", "Suriname", "Sweden", "Switzerland", "Syria", "Taiwan", "Tajikistan", "Tanzania", "Thailand",
  "Timor-Leste", "Togo", "Tonga", "Trinidad and Tobago", "Tunisia", "Turkey", "Turkmenistan", "Tuvalu",
  "Uganda", "Ukraine", "United Arab Emirates", "United Kingdom", "Uruguay", "Uzbekistan",
  "Vanuatu", "Vatican City", "Venezuela", "Vietnam", "Yemen", "Zambia", "Zimbabwe",
] as const;

export const JOB_TYPES = [
  "Accommodation and Food Services",
  "Agriculture, Forestry, Fishing, and Hunting",
  "Arts, Entertainment, and Recreation",
  "Construction",
  "Educational Services",
  "Finance and Insurance",
  "Health Care and Social Assistance",
  "Information & Telecommunications",
  "Manufacturing",
  "Mining, Quarrying, and Oil & Gas Extraction",
  "Nonprofit",
  "Professional, Scientific, and Technical Services",
  "Public Administration (Government)",
  "Real Estate, Rental, and Leasing",
  "Religion, Ministry, Pastoral, Spiritual",
  "Retail & Wholesale Trade",
  "Technology and Research & Development",
  "Transportation and Warehousing",
  "Utilities",
  "Student",
  "Other",
] as const;

export interface Coupon {
  id: string;
  code: string;
  tier: string;
  durationMonths: number;
  maxUses: number;
  uses: number;
  expiresAt?: Date | string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
}
