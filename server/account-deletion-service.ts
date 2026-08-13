interface AuthUserDeletionClient {
  deleteUser(userId: string): Promise<void>;
}

function getAuthErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  const candidate = error as { code?: unknown; errorInfo?: { code?: unknown } };
  if (typeof candidate.code === "string") return candidate.code;
  return typeof candidate.errorInfo?.code === "string" ? candidate.errorInfo.code : undefined;
}

export async function deleteAuthUserIfPresent(
  auth: AuthUserDeletionClient,
  userId: string,
): Promise<void> {
  try {
    await auth.deleteUser(userId);
  } catch (error) {
    if (getAuthErrorCode(error) === "auth/user-not-found") return;
    throw error;
  }
}
