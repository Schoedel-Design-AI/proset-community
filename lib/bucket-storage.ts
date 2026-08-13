import { getApiUrl, apiRequest, getAuthHeaders } from "@/lib/query-client";
import { resolveBucketUriWithBase } from "@/lib/bucket-uri";

export type BucketCategory = "audio" | "image" | "video" | "file";

export interface BucketFileRecord {
  id: string;
  userId: string;
  bucketKey: string;
  originalName: string;
  mimeType: string;
  fileSize: number;
  category: BucketCategory;
  createdAt: string;
}

export async function uploadToBucket(
  file: File | Blob,
  category?: BucketCategory,
  filename?: string,
): Promise<BucketFileRecord> {
  const formData = new FormData();
  const name = filename || (file instanceof File ? file.name : "upload");
  formData.append("file", file, name);
  if (category) formData.append("category", category);

  const baseUrl = getApiUrl();
  const url = new URL("/api/bucket/upload", baseUrl);
  const res = await globalThis.fetch(url.toString(), {
    method: "POST",
    body: formData,
    credentials: "include",
    headers: getAuthHeaders(),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status}: ${text}`);
  }
  return res.json();
}

export function getBucketFileUrl(fileId: string): string {
  const baseUrl = getApiUrl();
  return new URL(`/api/bucket/files/${fileId}`, baseUrl).toString();
}

export function resolveBucketUri(bucketUri: string): string {
  return resolveBucketUriWithBase(bucketUri, getApiUrl());
}

export async function deleteBucketFile(fileId: string): Promise<void> {
  await apiRequest("DELETE", `/api/bucket/files/${fileId}`);
}

export async function listBucketFiles(category?: BucketCategory): Promise<BucketFileRecord[]> {
  const baseUrl = getApiUrl();
  const url = new URL("/api/bucket/files", baseUrl);
  if (category) url.searchParams.set("category", category);
  const res = await globalThis.fetch(url.toString(), { credentials: "include", headers: getAuthHeaders() });
  if (!res.ok) throw new Error(`Failed to list bucket files: ${res.status}`);
  return res.json();
}
