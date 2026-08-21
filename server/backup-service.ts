import { type BackupProvider, type Recording, type BackupLog } from "@shared/schema";
import { promises as fsp } from "node:fs";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { storage } from "./storage";
import { downloadFile as downloadBucketFile, fromBucketUri } from "./object-storage";

type EncryptedProviderConfig = {
  _encrypted: true;
  version: 1;
  iv: string;
  tag: string;
  data: string;
};

export type PublicBackupProvider = Pick<BackupProvider, "id" | "provider" | "enabled" | "lastBackupAt" | "createdAt"> & {
  config: {
    authType: "oauth" | "manual";
  };
};


async function fetchWithRetry(url: string, options: any, providerName: string, retries = 2): Promise<Response> {
  for (let i = 0; i <= retries; i++) {
    const res = await fetch(url, options);
    if (res.ok) return res;
    if (res.status === 404 && options.method === "GET") return res; // Pass 404 through for existence checks

    // Handle rate limits
    if (res.status === 429) {
      if (i < retries) {
        const retryAfter = res.headers.get("Retry-After");
        const delayMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : 2000 * (i + 1);
        await new Promise(r => setTimeout(r, delayMs));
        continue;
      }
    }

    switch (res.status) {
      case 401:
        throw new Error(`${providerName} authentication failed (401). Please reconnect your account.`);
      case 403:
        throw new Error(`${providerName} permission denied or storage quota exceeded (403).`);
      case 429:
        throw new Error(`${providerName} rate limit exceeded (429). Backup will be retried later.`);
      default:
        throw new Error(`${providerName} request failed (${res.status}).`);
    }
  }
  throw new Error(`${providerName} failed after retries`);
}

export type ProviderType = "google_drive" | "onedrive" | "dropbox" | "webdav";

export interface BackupFile {
  fileName: string;
  content: Buffer | string;
  mimeType: string;
  fileType: "audio" | "transcript" | "conversion";
}

interface ProviderConfig {
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
  webdavUrl?: string;
  webdavUsername?: string;
  webdavPassword?: string;
  useOAuth?: boolean;
}

function handleApiError(provider: string, status: number, _errText?: string): Error {
  console.error(`[backup] ${provider} request failed with status ${status}`);
  if (status === 401) {
    return new Error(`${provider} authentication failed (401). Please reconnect your account.`);
  }
  if (status === 403) {
    return new Error(`${provider} permission denied or storage quota exceeded (403).`);
  }
  if (status === 429) {
    return new Error(`${provider} rate limit exceeded (429). Backup will be retried later.`);
  }
  return new Error(`${provider} API error: ${status}`);
}

function getProviderEncryptionKey(): Buffer | null {
  const secret = process.env.BACKUP_PROVIDER_CONFIG_KEY || process.env.BETTER_AUTH_SECRET || "";
  if (!secret) return null;
  return createHash("sha256").update(secret).digest();
}

function isEncryptedProviderConfig(value: unknown): value is EncryptedProviderConfig {
  return !!value && typeof value === "object"
    && (value as EncryptedProviderConfig)._encrypted === true
    && typeof (value as EncryptedProviderConfig).iv === "string"
    && typeof (value as EncryptedProviderConfig).tag === "string"
    && typeof (value as EncryptedProviderConfig).data === "string";
}

function encryptProviderConfig(config: ProviderConfig): ProviderConfig | EncryptedProviderConfig {
  const key = getProviderEncryptionKey();
  if (!key) return config;

  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(config), "utf8"),
    cipher.final(),
  ]);

  return {
    _encrypted: true,
    version: 1,
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    data: encrypted.toString("base64"),
  };
}

function decryptProviderConfig(config: unknown): ProviderConfig {
  if (!config || typeof config !== "object") return {};
  if (!isEncryptedProviderConfig(config)) return config as ProviderConfig;

  const key = getProviderEncryptionKey();
  if (!key) {
    console.error("[backup] Backup provider config is encrypted but no BACKUP_PROVIDER_CONFIG_KEY or BETTER_AUTH_SECRET is configured — credentials inaccessible.");
    return {};
  }

  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(config.iv, "base64"),
    );
    decipher.setAuthTag(Buffer.from(config.tag, "base64"));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(config.data, "base64")),
      decipher.final(),
    ]).toString("utf8");

    return JSON.parse(decrypted) as ProviderConfig;
  } catch (err: any) {
    // Decryption fails when the active BACKUP_PROVIDER_CONFIG_KEY / BETTER_AUTH_SECRET
    // differs from the key that was in use when the config was encrypted (e.g., after a
    // server update where the secret rotated). Log the error and return an empty config
    // so the provider row is still visible in the UI and the user can reconnect instead
    // of seeing a blank list or a 500 error.
    console.error("[backup] Failed to decrypt provider config — encryption key mismatch or data corruption. Provider will require reconnection:", err.message);
    return {};
  }
}

function materializeProvider(provider: BackupProvider): BackupProvider {
  return {
    ...provider,
    config: decryptProviderConfig(provider.config),
  };
}

export function toPublicBackupProvider(provider: BackupProvider): PublicBackupProvider {
  const config = decryptProviderConfig(provider.config);

  return {
    id: provider.id,
    provider: provider.provider,
    enabled: provider.enabled,
    lastBackupAt: provider.lastBackupAt,
    createdAt: provider.createdAt,
    config: {
      authType: config.useOAuth ? "oauth" : "manual",
    },
  };
}

function sanitizeFileName(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9\s\-_.]/g, "")
    .replace(/\s+/g, "-")
    .trim()
    .substring(0, 80);
}

function formatTimestamp(date: Date): string {
  const y = date.getFullYear();
  const mo = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const h = String(date.getHours()).padStart(2, "0");
  const mi = String(date.getMinutes()).padStart(2, "0");
  const s = String(date.getSeconds()).padStart(2, "0");
  return `${y}-${mo}-${d}_${h}${mi}${s}`;
}

function getYearMonth(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function getAudioMimeType(audioUri: string): string {
  const dataUriMatch = audioUri.match(/^data:([^;,]+)/);
  if (dataUriMatch?.[1]) return dataUriMatch[1];

  const pathname = audioUri.startsWith("file://")
    ? fileURLToPath(audioUri)
    : audioUri.split("?")[0];
  const ext = path.extname(pathname).toLowerCase();
  switch (ext) {
    case ".wav":
      return "audio/wav";
    case ".webm":
      return "audio/webm";
    case ".mp3":
      return "audio/mpeg";
    case ".ogg":
      return "audio/ogg";
    case ".aac":
      return "audio/aac";
    case ".flac":
      return "audio/flac";
    case ".m4a":
    case ".mp4":
      return "audio/mp4";
    default:
      return "audio/m4a";
  }
}

function getAudioExtension(audioUri: string): string {
  const mimeType = getAudioMimeType(audioUri);
  const fromMime: Record<string, string> = {
    "audio/wav": "wav",
    "audio/webm": "webm",
    "audio/mpeg": "mp3",
    "audio/ogg": "ogg",
    "audio/aac": "aac",
    "audio/flac": "flac",
    "audio/mp4": "m4a",
    "audio/m4a": "m4a",
  };
  return fromMime[mimeType] || "m4a";
}

function resolveUploadedAudioPath(audioUri: string): string | null {
  const uploadsRoot = path.resolve(process.cwd(), "audio-uploads");
  let relativePath = "";

  if (audioUri.startsWith("/api/audio-files/")) {
    relativePath = decodeURIComponent(audioUri.replace(/^\/api\/audio-files\/+/, ""));
  } else {
    try {
      const parsed = new URL(audioUri);
      if (parsed.pathname.startsWith("/api/audio-files/")) {
        relativePath = decodeURIComponent(parsed.pathname.replace(/^\/api\/audio-files\/+/, ""));
      }
    } catch {}
  }

  if (!relativePath) return null;
  const resolved = path.resolve(uploadsRoot, relativePath);
  if (!resolved.toLowerCase().startsWith(uploadsRoot.toLowerCase())) {
    throw new Error("Invalid uploaded audio path");
  }
  return resolved;
}

export async function resolveAudioBackupPayload(
  audioUri: string,
  options: {
    fetcher?: typeof fetch;
    bucketDownloader?: (bucketKey: string) => Promise<Buffer>;
    readFile?: (filePath: string) => Promise<Buffer>;
  } = {},
): Promise<{ buffer: Buffer; mimeType: string }> {
  const trimmedUri = audioUri.trim();
  if (!trimmedUri) throw new Error("Audio URI is empty");

  const mimeType = getAudioMimeType(trimmedUri);
  const readFile = options.readFile || fsp.readFile;

  if (trimmedUri.startsWith("data:")) {
    const match = trimmedUri.match(/^data:([^;,]+)?(;base64)?,(.*)$/);
    if (!match) throw new Error("Invalid data URI");
    const encoded = match[3] || "";
    const buffer = match[2]
      ? Buffer.from(encoded, "base64")
      : Buffer.from(decodeURIComponent(encoded), "utf-8");
    return { buffer, mimeType };
  }

  if (trimmedUri.startsWith("bucket://")) {
    const bucketKey = fromBucketUri(trimmedUri);
    const buffer = await (options.bucketDownloader || downloadBucketFile)(bucketKey);
    return { buffer, mimeType };
  }

  const uploadedPath = resolveUploadedAudioPath(trimmedUri);
  if (uploadedPath) {
    return { buffer: await readFile(uploadedPath), mimeType };
  }

  if (trimmedUri.startsWith("file://")) {
    return { buffer: await readFile(fileURLToPath(trimmedUri)), mimeType };
  }

  if (path.isAbsolute(trimmedUri)) {
    return { buffer: await readFile(trimmedUri), mimeType };
  }

  if (/^https?:\/\//i.test(trimmedUri)) {
    const res = await (options.fetcher || fetch)(trimmedUri);
    if (!res.ok) throw new Error(`Audio download failed: ${res.status}`);
    return { buffer: Buffer.from(await res.arrayBuffer()), mimeType: res.headers.get("content-type") || mimeType };
  }

  throw new Error(`Unsupported audio URI for backup: ${trimmedUri.slice(0, 80)}`);
}

export function buildBackupPaths(recording: Recording, fileType: string, conversionLabel?: string) {
  const createdAt = new Date(recording.createdAt);
  const timestamp = formatTimestamp(createdAt);
  const safeTitle = sanitizeFileName(recording.title || "Untitled");
  const yearMonth = getYearMonth(createdAt);
  const folderName = `${safeTitle}_${timestamp}`;

  const basePath = `Proset/${yearMonth}/${folderName}`;

  if (fileType === "audio") {
    const ext = recording.audioUri ? getAudioExtension(recording.audioUri) : "m4a";
    return {
      remotePath: `${basePath}/audio_${safeTitle}_${timestamp}.${ext}`,
      fileName: `audio_${safeTitle}_${timestamp}.${ext}`,
    };
  } else if (fileType === "transcript") {
    return {
      remotePath: `${basePath}/transcript_${safeTitle}_${timestamp}.txt`,
      fileName: `transcript_${safeTitle}_${timestamp}.txt`,
    };
  } else if (fileType === "conversion" && conversionLabel) {
    const safeLabel = sanitizeFileName(conversionLabel);
    return {
      remotePath: `${basePath}/conversions/${safeLabel}_${timestamp}.md`,
      fileName: `${safeLabel}_${timestamp}.md`,
    };
  }

  return {
    remotePath: `${basePath}/${safeTitle}_${timestamp}.txt`,
    fileName: `${safeTitle}_${timestamp}.txt`,
  };
}

async function ensureGoogleDriveFolder(accessToken: string, folderPath: string): Promise<string> {
  const parts = folderPath.split("/").filter(Boolean);
  let parentId = "root";

  for (const folderName of parts) {
    const searchUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(
      `name='${folderName}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`
    )}&fields=files(id,name)`;

    const searchRes = await fetchWithRetry(
      searchUrl,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      },
      "Google Drive"
    );
    if (!searchRes.ok) {
      const errText = await searchRes.text();
      throw handleApiError("Google Drive", searchRes.status, errText);
    }
    const searchData: any = await searchRes.json();

    if (searchData.files && searchData.files.length > 0) {
      parentId = searchData.files[0].id;
    } else {
      const createRes = await fetchWithRetry(
        "https://www.googleapis.com/drive/v3/files",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            name: folderName,
            mimeType: "application/vnd.google-apps.folder",
            parents: [parentId],
          }),
        },
        "Google Drive"
      );
      if (!createRes.ok) {
        const errText = await createRes.text();
        throw handleApiError("Google Drive", createRes.status, errText);
      }
      const createData: any = await createRes.json();
      parentId = createData.id;
    }
  }

  return parentId;
}

async function uploadToGoogleDrive(
  accessToken: string,
  remotePath: string,
  content: Buffer | string,
  mimeType: string
): Promise<boolean> {
  const pathParts = remotePath.split("/");
  const fileName = pathParts.pop()!;
  const folderPath = pathParts.join("/");

  const folderId = await ensureGoogleDriveFolder(accessToken, folderPath);

  const metadata = {
    name: fileName,
    parents: [folderId],
  };

  const boundary = "backup_boundary_" + Date.now();
  const contentBuffer = typeof content === "string" ? Buffer.from(content, "utf-8") : content;

  const metaPart = JSON.stringify(metadata);
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metaPart}\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`
    ),
    contentBuffer,
    Buffer.from(`\r\n--${boundary}--`),
  ]);

  const res = await fetchWithRetry(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      body: new Uint8Array(body),
    },
    "Google Drive"
  );

  if (!res.ok) {
    const errText = await res.text();
    throw handleApiError("Google Drive", res.status, errText);
  }

  return true;
}

async function ensureOneDriveFolder(accessToken: string, folderPath: string): Promise<void> {
  const parts = folderPath.split("/").filter(Boolean);
  let currentPath = "";

  for (const part of parts) {
    currentPath = currentPath ? `${currentPath}/${part}` : part;
    const checkUrl = `https://graph.microsoft.com/v1.0/me/drive/root:/${encodeURIComponent(currentPath)}`;

    const checkRes = await fetchWithRetry(
      checkUrl,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      },
      "OneDrive"
    );

    if (checkRes.status === 404) {
      const parentPath = currentPath.includes("/")
        ? currentPath.substring(0, currentPath.lastIndexOf("/"))
        : "";

      const createUrl = parentPath
        ? `https://graph.microsoft.com/v1.0/me/drive/root:/${encodeURIComponent(parentPath)}:/children`
        : `https://graph.microsoft.com/v1.0/me/drive/root/children`;

      const createRes = await fetchWithRetry(createUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: part,
          folder: {},
          "@microsoft.graph.conflictBehavior": "replace",
        }),
      }, 'OneDrive');

      if (!createRes.ok && createRes.status !== 409) {
        const errText = await createRes.text();
        throw handleApiError("OneDrive", createRes.status, errText);
      }
    }
  }
}

async function uploadToOneDrive(
  accessToken: string,
  remotePath: string,
  content: Buffer | string,
  mimeType: string
): Promise<boolean> {
  const pathParts = remotePath.split("/");
  pathParts.pop();
  const folderPath = pathParts.join("/");

  await ensureOneDriveFolder(accessToken, folderPath);

  const contentBuffer = typeof content === "string" ? Buffer.from(content, "utf-8") : content;

  const uploadUrl = `https://graph.microsoft.com/v1.0/me/drive/root:/${encodeURIComponent(remotePath)}:/content`;

  const res = await fetchWithRetry(uploadUrl, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": mimeType,
    },
    body: new Uint8Array(contentBuffer),
  }, 'Cloud Provider');

  if (!res.ok) {
    const errText = await res.text();
    throw handleApiError("OneDrive", res.status, errText);
  }

  return true;
}

async function uploadToDropbox(
  accessToken: string,
  remotePath: string,
  content: Buffer | string,
  _mimeType: string
): Promise<boolean> {
  const contentBuffer = typeof content === "string" ? Buffer.from(content, "utf-8") : content;
  const dropboxPath = "/" + remotePath;

  const res = await fetchWithRetry("https://content.dropboxapi.com/2/files/upload", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/octet-stream",
      "Dropbox-API-Arg": JSON.stringify({
        path: dropboxPath,
        mode: "overwrite",
        autorename: true,
        mute: false,
      }),
    },
    body: new Uint8Array(contentBuffer),
  }, 'Cloud Provider');

  if (!res.ok) {
    const errText = await res.text();
    throw handleApiError("Dropbox", res.status, errText);
  }

  return true;
}

async function uploadToWebDAV(
  config: ProviderConfig,
  remotePath: string,
  content: Buffer | string,
  _mimeType: string
): Promise<boolean> {
  const baseUrl = config.webdavUrl!.replace(/\/$/, "");
  const contentBuffer = typeof content === "string" ? Buffer.from(content, "utf-8") : content;
  const authHeader = "Basic " + Buffer.from(`${config.webdavUsername}:${config.webdavPassword}`).toString("base64");

  // Encode each path segment individually so filenames with reserved characters
  // are safe in WebDAV URLs, even if sanitizeFileName already removes most of them.
  const encodedParts = remotePath.split("/").map(encodeURIComponent);
  let currentPath = "";

  for (let i = 0; i < encodedParts.length - 1; i++) {
    currentPath += "/" + encodedParts[i];
    const mkcolUrl = `${baseUrl}${currentPath}`;

    try {
      const mkcolRes = await fetch(mkcolUrl, {
        method: "MKCOL",
        headers: { Authorization: authHeader },
      });
      // 405 Method Not Allowed means the collection already exists — that's fine.
      // 401/403 are real failures; log them so connection problems are visible.
      if (mkcolRes.status === 401 || mkcolRes.status === 403) {
        console.warn(`[backup] WebDAV MKCOL ${mkcolUrl} returned ${mkcolRes.status} — check credentials or permissions.`);
      }
    } catch (err: any) {
      // Non-fatal: if directory creation fails we'll surface the error on the PUT below.
      console.warn(`[backup] WebDAV MKCOL failed for ${mkcolUrl}:`, err.message);
    }
  }

  const fileUrl = `${baseUrl}/${encodedParts.join("/")}`;
  await fetchWithRetry(
    fileUrl,
    {
      method: "PUT",
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/octet-stream",
      },
      body: new Uint8Array(contentBuffer),
    },
    "WebDAV"
  );

  return true;
}

async function resolveBackupConfig(
  providerType: string,
  config: ProviderConfig,
  userId: string
): Promise<ProviderConfig> {
  if (config.useOAuth) {
    // If we have a refresh token and the access token is expired, refresh it
    if (config.refreshToken && config.expiresAt) {
      const expiresAt = typeof config.expiresAt === "number" ? config.expiresAt : 0;
      const isExpired = expiresAt < Date.now() - 60_000; // 1 minute buffer
      if (isExpired || !config.accessToken) {
        try {
          const { refreshAccessToken } = await import("./oauth-backup");
          const refreshed = await refreshAccessToken(providerType, config.refreshToken);
          // Update the stored provider config with the new token
          const providers = await getAllProviders(userId);
          const match = providers.find((p) => p.provider === providerType);
          if (match) {
            await updateProvider(match.id, userId, {
              config: { ...config, accessToken: refreshed.accessToken, expiresAt: refreshed.expiresAt },
            });
          }
          return { ...config, accessToken: refreshed.accessToken };
        } catch (err: any) {
          console.error(`[backup] Token refresh failed for ${providerType}:`, err.message);
          // Fall through to try the existing token anyway
        }
      }
    }

    // If we have a direct access token from OAuth, use it
    if (config.accessToken) {
      return config;
    }

    // Legacy path: try resolving from connector service
    try {
      const { resolveUserOAuthToken } = await import("./connector-service");
      const { token, configKey } = await resolveUserOAuthToken(userId, providerType);
      return { ...config, [configKey]: token };
    } catch (err: any) {
      throw new Error(`Connector error: ${err.message}`);
    }
  }
  return config;
}

async function canRunBackups(userId: string): Promise<boolean> {
  try {
    const { stripeService } = await import("./stripe-service");
    const subStatus = await stripeService.getUserSubscriptionStatus(userId);
    return !!subStatus.cloudSync.syncAllowed;
  } catch (err: any) {
    console.error("[backup] Failed to resolve backup entitlement:", err?.message || err);
    return false;
  }
}

async function uploadFile(
  provider: BackupProvider,
  remotePath: string,
  content: Buffer | string,
  mimeType: string,
  userId: string
): Promise<boolean> {
  const config = await resolveBackupConfig(provider.provider, provider.config as ProviderConfig, userId);

  switch (provider.provider) {
    case "google_drive":
      return uploadToGoogleDrive(config.accessToken!, remotePath, content, mimeType);
    case "onedrive":
      return uploadToOneDrive(config.accessToken!, remotePath, content, mimeType);
    case "dropbox":
      return uploadToDropbox(config.accessToken!, remotePath, content, mimeType);
    case "webdav":
      return uploadToWebDAV(config, remotePath, content, mimeType);
    default:
      throw new Error(`Unknown provider: ${provider.provider}`);
  }
}

async function logBackup(
  userId: string,
  providerId: string,
  recordingId: string,
  fileType: string,
  fileName: string,
  remotePath: string,
  status: "success" | "failed",
  errorMessage?: string
) {
  await storage.backupLogs.create({
    id: "",
    userId,
    providerId,
    recordingId,
    fileType,
    fileName,
    remotePath,
    status,
    errorMessage: errorMessage || null,
    createdAt: new Date().toISOString()
  });

  if (status === "success") {
    await storage.backupProviders.update(providerId, { lastBackupAt: new Date().toISOString() });
  }
}

export async function getEnabledProviders(userId: string): Promise<BackupProvider[]> {
  const providers = await storage.backupProviders.getByUser(userId);
  return providers.filter(p => p.enabled === 1).map(materializeProvider);
}

export async function getAllProviders(userId: string): Promise<BackupProvider[]> {
  const providers = await storage.backupProviders.getByUser(userId);
  providers.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return providers.map(materializeProvider);
}

export async function getBackupLogs(userId: string, limit = 50): Promise<any[]> {
  const logs = await storage.backupLogs.getByUser(userId);
  logs.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return logs.slice(0, limit);
}

export async function addProvider(
  userId: string,
  provider: ProviderType,
  config: ProviderConfig
): Promise<BackupProvider> {
  const bp = await storage.backupProviders.create({
    id: "",
    userId,
    provider,
    config: encryptProviderConfig(config) as any,
    enabled: 1,
    createdAt: new Date().toISOString(),
    lastBackupAt: null
  });
  return materializeProvider(bp);
}

export async function updateProvider(
  id: string,
  userId: string,
  updates: { enabled?: number; config?: ProviderConfig }
): Promise<BackupProvider | undefined> {
  const existing = await storage.backupProviders.get(id);
  if (!existing || existing.userId !== userId) return undefined;

  const setData: Partial<BackupProvider> = {};
  if (updates.enabled !== undefined) setData.enabled = updates.enabled;
  if (updates.config) setData.config = encryptProviderConfig(updates.config) as any;

  const updated = await storage.backupProviders.update(id, setData);
  return materializeProvider(updated);
}

export async function removeProvider(id: string, userId: string): Promise<boolean> {
  const existing = await storage.backupProviders.get(id);
  if (!existing || existing.userId !== userId) return false;

  await storage.backupProviders.delete(id);
  return true;
}

export async function testProviderConnection(provider: BackupProvider, userId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const config = await resolveBackupConfig(provider.provider, provider.config as ProviderConfig, userId);

    switch (provider.provider) {
      case "google_drive": {
        const res = await fetch("https://www.googleapis.com/drive/v3/about?fields=user", {
          headers: { Authorization: `Bearer ${config.accessToken}` },
        });
        if (!res.ok) throw new Error(`Google Drive auth failed: ${res.status}`);
        return { ok: true };
      }
      case "onedrive": {
        const res = await fetch("https://graph.microsoft.com/v1.0/me/drive", {
          headers: { Authorization: `Bearer ${config.accessToken}` },
        });
        if (!res.ok) throw new Error(`OneDrive auth failed: ${res.status}`);
        return { ok: true };
      }
      case "dropbox": {
        const res = await fetch("https://api.dropboxapi.com/2/users/get_current_account", {
          method: "POST",
          headers: { Authorization: `Bearer ${config.accessToken}` },
        });
        if (!res.ok) throw new Error(`Dropbox auth failed: ${res.status}`);
        return { ok: true };
      }
      case "webdav": {
        const baseUrl = config.webdavUrl!.replace(/\/$/, "");
        const res = await fetch(baseUrl, {
          method: "PROPFIND",
          headers: {
            Authorization: "Basic " + Buffer.from(`${config.webdavUsername}:${config.webdavPassword}`).toString("base64"),
            Depth: "0",
          },
        });
        if (!res.ok && res.status !== 207) throw new Error(`WebDAV auth failed: ${res.status}`);
        return { ok: true };
      }
      default:
        return { ok: false, error: "Unknown provider" };
    }
  } catch (err: any) {
    return { ok: false, error: err.message || "Connection failed" };
  }
}

export async function backupRecordingFiles(
  userId: string,
  recording: Recording,
  fileTypes: ("audio" | "transcript" | "conversion")[]
) {
  if (!(await canRunBackups(userId))) return;

  const providers = await getEnabledProviders(userId);
  if (providers.length === 0) return;

  for (const provider of providers) {
    for (const fileType of fileTypes) {
      try {
        if (fileType === "audio" && recording.audioUri) {
          const paths = buildBackupPaths(recording, "audio");
          const audioPayload = await resolveAudioBackupPayload(recording.audioUri);

          await uploadFile(provider, paths.remotePath, audioPayload.buffer, audioPayload.mimeType, userId);
          await logBackup(userId, provider.id, recording.id, "audio", paths.fileName, paths.remotePath, "success");
        }

        if (fileType === "transcript" && recording.transcript) {
          const paths = buildBackupPaths(recording, "transcript");
          await uploadFile(provider, paths.remotePath, recording.transcript, "text/plain", userId);
          await logBackup(userId, provider.id, recording.id, "transcript", paths.fileName, paths.remotePath, "success");
        }

        if (fileType === "conversion") {
          const conversions = (recording.conversions as any[]) || [];
          for (const conv of conversions) {
            if (conv.content) {
              const paths = buildBackupPaths(recording, "conversion", conv.label || conv.type);
              await uploadFile(provider, paths.remotePath, conv.content, "text/markdown", userId);
              await logBackup(userId, provider.id, recording.id, "conversion", paths.fileName, paths.remotePath, "success");
            }
          }
        }
      } catch (err: any) {
        console.error(`Backup failed for provider ${provider.provider}:`, err.message);
        if (err.message.includes("authentication failed (401)")) {
          await updateProvider(provider.id, userId, { enabled: 0 });
        }
        const paths = buildBackupPaths(recording, fileType);
        await logBackup(
          userId,
          provider.id,
          recording.id,
          fileType,
          paths.fileName,
          paths.remotePath,
          "failed",
          err.message
        );
      }
    }
  }
}

export async function backupSingleConversion(
  userId: string,
  recording: Recording,
  conversion: { type: string; label: string; content: string }
) {
  if (!(await canRunBackups(userId))) return;

  const providers = await getEnabledProviders(userId);
  if (providers.length === 0) return;

  for (const provider of providers) {
    try {
      const paths = buildBackupPaths(recording, "conversion", conversion.label || conversion.type);
      await uploadFile(provider, paths.remotePath, conversion.content, "text/markdown", userId);
      await logBackup(userId, provider.id, recording.id, "conversion", paths.fileName, paths.remotePath, "success");
    } catch (err: any) {
      console.error(`Backup conversion failed for provider ${provider.provider}:`, err.message);
      if (err.message.includes("authentication failed (401)")) {
        await updateProvider(provider.id, userId, { enabled: 0 });
      }
      const paths = buildBackupPaths(recording, "conversion", conversion.label || conversion.type);
      await logBackup(
        userId,
        provider.id,
        recording.id,
        "conversion",
        paths.fileName,
        paths.remotePath,
        "failed",
        err.message
      );
    }
  }
}
