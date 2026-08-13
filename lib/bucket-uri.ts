export function getBucketResolvePath(bucketKey: string): string {
  return `/api/bucket/resolve/${encodeURIComponent(bucketKey)}`;
}

export function resolveBucketUriWithBase(bucketUri: string, baseUrl: string): string {
  if (!bucketUri.startsWith("bucket://")) return bucketUri;
  const bucketKey = bucketUri.replace("bucket://", "");
  return new URL(getBucketResolvePath(bucketKey), baseUrl).toString();
}