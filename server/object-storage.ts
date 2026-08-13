import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import * as fs from "node:fs";
import * as path from "node:path";
import { promises as fsp } from "node:fs";
import { Readable } from "node:stream";
import { storage } from "./storage";

const MIME_TYPES: Record<string, string> = {
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".webm": "audio/webm",
  ".ogg": "audio/ogg",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".flac": "audio/flac",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".avi": "video/x-msvideo",
  ".mkv": "video/x-matroska",
  ".pdf": "application/pdf",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".csv": "text/csv",
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".json": "application/json",
  ".zip": "application/zip",
};

export type BucketCategory = "audio" | "image" | "video" | "file";
type ObjectStorageProvider = "local" | "s3";



function normalizeObjectStorageProvider(value: string | undefined): ObjectStorageProvider | null {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === "local") return "local";
  if (normalized === "s3" || normalized === "spaces" || normalized === "digitalocean") return "s3";
  throw new Error(`Unsupported OBJECT_STORAGE_PROVIDER: ${value}. Valid options: local, s3`);
}

function hasS3ObjectStorageConfig(): boolean {
  return Boolean(
    process.env.OBJECT_STORAGE_BUCKET?.trim() &&
    process.env.OBJECT_STORAGE_REGION?.trim() &&
    process.env.OBJECT_STORAGE_ENDPOINT?.trim() &&
    process.env.OBJECT_STORAGE_ACCESS_KEY_ID?.trim() &&
    process.env.OBJECT_STORAGE_SECRET_ACCESS_KEY?.trim(),
  );
}

function resolveObjectStorageProvider(): ObjectStorageProvider {
  const configured = normalizeObjectStorageProvider(process.env.OBJECT_STORAGE_PROVIDER);
  if (configured) return configured;
  if (hasS3ObjectStorageConfig()) return "s3";
  return "local";
}

function getRequiredObjectStorageEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required when OBJECT_STORAGE_PROVIDER uses an S3-compatible backend`);
  }
  return value;
}

function shouldUseForcePathStyle(): boolean {
  const value = process.env.OBJECT_STORAGE_FORCE_PATH_STYLE?.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}

const objectStorageProvider = resolveObjectStorageProvider();
const s3BucketName = objectStorageProvider === "s3"
  ? getRequiredObjectStorageEnv("OBJECT_STORAGE_BUCKET")
  : null;
const s3Client = objectStorageProvider === "s3"
  ? new S3Client({
    region: getRequiredObjectStorageEnv("OBJECT_STORAGE_REGION"),
    endpoint: getRequiredObjectStorageEnv("OBJECT_STORAGE_ENDPOINT"),
    forcePathStyle: shouldUseForcePathStyle(),
    credentials: {
      accessKeyId: getRequiredObjectStorageEnv("OBJECT_STORAGE_ACCESS_KEY_ID"),
      secretAccessKey: getRequiredObjectStorageEnv("OBJECT_STORAGE_SECRET_ACCESS_KEY"),
    },
  })
  : null;

function getLocalStorageRoot(): string {
  const configuredRoot = process.env.OBJECT_STORAGE_DIR || path.join(process.cwd(), ".local", "object-storage");
  return path.resolve(configuredRoot);
}

function normalizeBucketKey(bucketKey: string): string {
  return bucketKey.replace(/\\/g, "/").replace(/^\/+/, "");
}

function resolveLocalPath(bucketKey: string): string {
  const root = getLocalStorageRoot();
  const resolved = path.resolve(root, normalizeBucketKey(bucketKey));
  if (!resolved.toLowerCase().startsWith(root.toLowerCase())) {
    throw new Error(`Invalid bucket key: ${bucketKey}`);
  }
  return resolved;
}

async function ensureLocalDirectory(bucketKey: string): Promise<void> {
  await fsp.mkdir(path.dirname(resolveLocalPath(bucketKey)), { recursive: true });
}

async function collectLocalFiles(directory: string, root: string, acc: string[] = []): Promise<string[]> {
  try {
    const entries = await fsp.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await collectLocalFiles(fullPath, root, acc);
        continue;
      }
      acc.push(path.relative(root, fullPath).replace(/\\/g, "/"));
    }
    return acc;
  } catch (error: any) {
    if (error?.code === "ENOENT") {
      return acc;
    }
    throw error;
  }
}

function readableFromBytes(bytes: Buffer | Uint8Array): Readable {
  return Readable.from([Buffer.from(bytes)]);
}

function isNodeReadable(value: unknown): value is Readable {
  return Boolean(value) && typeof (value as Readable).pipe === "function" && typeof (value as Readable).on === "function";
}

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    if (Buffer.isBuffer(chunk)) {
      chunks.push(chunk);
      continue;
    }
    if (chunk instanceof Uint8Array) {
      chunks.push(Buffer.from(chunk));
      continue;
    }
    chunks.push(Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks);
}

async function webStreamToBuffer(stream: { getReader(): { read(): Promise<{ done: boolean; value?: Uint8Array }>; releaseLock?(): void } }): Promise<Buffer> {
  const reader = stream.getReader();
  const chunks: Buffer[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock?.();
  }
  return Buffer.concat(chunks);
}

function webStreamToReadable(stream: { getReader(): { read(): Promise<{ done: boolean; value?: Uint8Array }>; releaseLock?(): void } }): Readable {
  return Readable.from((async function* () {
    const reader = stream.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) yield Buffer.from(value);
      }
    } finally {
      reader.releaseLock?.();
    }
  })());
}

async function bodyToBuffer(body: unknown): Promise<Buffer> {
  if (!body) {
    throw new Error("Object storage response body is missing");
  }
  if (Buffer.isBuffer(body)) return body;
  if (body instanceof Uint8Array) return Buffer.from(body);
  if (isNodeReadable(body)) return streamToBuffer(body);
  if (typeof (body as { transformToByteArray?: () => Promise<Uint8Array> }).transformToByteArray === "function") {
    const bytes = await (body as { transformToByteArray(): Promise<Uint8Array> }).transformToByteArray();
    return Buffer.from(bytes);
  }
  if (typeof (body as { getReader?: () => unknown }).getReader === "function") {
    return webStreamToBuffer(body as { getReader(): { read(): Promise<{ done: boolean; value?: Uint8Array }>; releaseLock?(): void } });
  }
  if (typeof (body as { stream?: () => unknown }).stream === "function") {
    return bodyToBuffer((body as { stream(): unknown }).stream());
  }
  throw new Error("Unsupported object storage response body");
}

async function bodyToReadable(body: unknown): Promise<Readable> {
  if (!body) {
    throw new Error("Object storage response body is missing");
  }
  if (isNodeReadable(body)) return body;
  if (Buffer.isBuffer(body) || body instanceof Uint8Array) return readableFromBytes(body);
  if (typeof (body as { transformToByteArray?: () => Promise<Uint8Array> }).transformToByteArray === "function") {
    const bytes = await (body as { transformToByteArray(): Promise<Uint8Array> }).transformToByteArray();
    return readableFromBytes(bytes);
  }
  if (typeof (body as { getReader?: () => unknown }).getReader === "function") {
    return webStreamToReadable(body as { getReader(): { read(): Promise<{ done: boolean; value?: Uint8Array }>; releaseLock?(): void } });
  }
  if (typeof (body as { stream?: () => unknown }).stream === "function") {
    return bodyToReadable((body as { stream(): unknown }).stream());
  }
  throw new Error("Unsupported object storage response body");
}

export function detectMimeType(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  return MIME_TYPES[ext] || "application/octet-stream";
}

export function categoryFromMime(mime: string): BucketCategory {
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  return "file";
}

const CATEGORY_PATHS: Record<BucketCategory, string> = {
  audio: "audio",
  image: "images",
  video: "videos",
  file: "files",
};

function buildKey(userId: string, category: BucketCategory, filename: string): string {
  return `users/${userId}/${CATEGORY_PATHS[category]}/${filename}`;
}

function buildDevKey(filename: string): string {
  return `dev/${filename}`;
}

export async function uploadFile(
  bucketKey: string,
  data: Buffer | Uint8Array,
): Promise<void> {
  const normalizedKey = normalizeBucketKey(bucketKey);

  if (s3Client && s3BucketName) {
    await s3Client.send(new PutObjectCommand({
      Bucket: s3BucketName,
      Key: normalizedKey,
      Body: Buffer.from(data),
      ContentType: detectMimeType(normalizedKey),
    }));
    return;
  }

  await ensureLocalDirectory(normalizedKey);
  await fsp.writeFile(resolveLocalPath(normalizedKey), Buffer.from(data));
}

export async function downloadFile(bucketKey: string): Promise<Buffer> {
  const normalizedKey = normalizeBucketKey(bucketKey);

  if (s3Client && s3BucketName) {
    const response = await s3Client.send(new GetObjectCommand({
      Bucket: s3BucketName,
      Key: normalizedKey,
    }));
    return bodyToBuffer(response.Body);
  }

  return await fsp.readFile(resolveLocalPath(normalizedKey));
}

export async function downloadFileAsStream(bucketKey: string): Promise<Readable> {
  const normalizedKey = normalizeBucketKey(bucketKey);

  if (s3Client && s3BucketName) {
    const response = await s3Client.send(new GetObjectCommand({
      Bucket: s3BucketName,
      Key: normalizedKey,
    }));
    return bodyToReadable(response.Body);
  }

  return fs.createReadStream(resolveLocalPath(normalizedKey));
}

export async function deleteFile(bucketKey: string): Promise<void> {
  const normalizedKey = normalizeBucketKey(bucketKey);

  if (s3Client && s3BucketName) {
    await s3Client.send(new DeleteObjectCommand({
      Bucket: s3BucketName,
      Key: normalizedKey,
    }));
    return;
  }

  try {
    await fsp.unlink(resolveLocalPath(normalizedKey));
  } catch (error: any) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }
}

export async function listFiles(prefix: string): Promise<string[]> {
  const normalizedPrefix = normalizeBucketKey(prefix);

  if (s3Client && s3BucketName) {
    const results: string[] = [];
    let continuationToken: string | undefined;
    do {
      const response = await s3Client.send(new ListObjectsV2Command({
        Bucket: s3BucketName,
        Prefix: normalizedPrefix || undefined,
        ContinuationToken: continuationToken,
      }));
      results.push(...(response.Contents || []).map((item) => item.Key).filter((key): key is string => Boolean(key)));
      continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
    } while (continuationToken);
    return results;
  }

  const root = getLocalStorageRoot();
  const startDirectory = normalizedPrefix ? resolveLocalPath(normalizedPrefix) : root;
  const files = await collectLocalFiles(startDirectory, root);
  return normalizedPrefix ? files.filter((file) => file.startsWith(normalizedPrefix)) : files;
}

export function generateBucketKey(userId: string, category: BucketCategory, originalName: string): string {
  const timestamp = Date.now();
  const safeName = originalName.replace(/[^a-zA-Z0-9._-]/g, "_");
  return buildKey(userId, category, `${timestamp}_${safeName}`);
}

export function generateDevBucketKey(originalName: string): string {
  const timestamp = Date.now();
  const safeName = originalName.replace(/[^a-zA-Z0-9._-]/g, "_");
  return buildDevKey(`${timestamp}_${safeName}`);
}

export function getFileUrl(bucketKey: string): string {
  return `/api/bucket/resolve/${bucketKey}`;
}

export interface BucketFileInput {
  userId: string;
  bucketKey: string;
  originalName: string;
  mimeType: string;
  fileSize: number;
  category: BucketCategory;
}

export async function bucketFilesTableExists(): Promise<boolean> {
  return true;
}

export async function createBucketFileRecord(input: BucketFileInput) {
  const cleanInput = {
    ...input,
    id: `bf_${Math.random().toString(36).substring(2, 11)}`,
    createdAt: new Date().toISOString()
  };
  return storage.bucketFiles.create(cleanInput as any);
}

export async function getBucketFileById(fileId: string) {
  const record = await storage.bucketFiles.get(fileId);
  return record || null;
}

export async function getBucketFileByKey(bucketKey: string) {
  const record = await storage.bucketFiles.getByKey(bucketKey);
  return record || null;
}

export async function getUserBucketFiles(userId: string, category?: BucketCategory) {
  const files = await storage.bucketFiles.getByUser(userId);
  if (category) {
    return files.filter(f => f.category === category);
  }
  return files;
}

export async function deleteBucketFileRecord(fileId: string, userId: string) {
  const record = await storage.bucketFiles.get(fileId);
  if (!record || record.userId !== userId) return null;
  await deleteFile(record.bucketKey);
  await storage.bucketFiles.delete(fileId);
  return record;
}

export async function deleteAllUserBucketFiles(userId: string): Promise<number> {
  const files = await storage.bucketFiles.getByUser(userId);
  const failures: string[] = [];
  for (const f of files) {
    try {
      await deleteFile(f.bucketKey);
      await storage.bucketFiles.delete(f.id);
    } catch {
      // Keep metadata for failed objects so deletion can be retried and the
      // object does not become an undiscoverable orphan.
      failures.push(f.id);
    }
  }
  if (failures.length > 0) {
    throw Object.assign(
      new Error(`Could not delete ${failures.length} retained file${failures.length === 1 ? "" : "s"}. The deletion can be retried safely.`),
      { code: "bucket_cleanup_incomplete", failedCount: failures.length },
    );
  }
  return files.length;
}

export function isBucketUri(uri: string): boolean {
  return uri.startsWith("bucket://");
}

export function toBucketUri(bucketKey: string): string {
  return `bucket://${bucketKey}`;
}

export function fromBucketUri(uri: string): string {
  return uri.replace("bucket://", "");
}
