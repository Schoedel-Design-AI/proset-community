let tokenCache: string | null = null;

export async function setSessionToken(token: string | null): Promise<void> {
  tokenCache = token;
  try {
    if (token) {
      window.localStorage.setItem("proset_session_token", token);
    } else {
      window.localStorage.removeItem("proset_session_token");
    }
  } catch (e) {
    console.error("Failed to write to localStorage:", e);
  }
}

export async function getSessionToken(): Promise<string | null> {
  if (tokenCache) return tokenCache;
  try {
    tokenCache = window.localStorage.getItem("proset_session_token");
  } catch (e) {
    console.error("Failed to read from localStorage:", e);
    tokenCache = null;
  }
  return tokenCache;
}

export function getCachedSessionToken(): string | null {
  if (tokenCache === null && typeof window !== "undefined") {
    try {
      tokenCache = window.localStorage.getItem("proset_session_token");
    } catch {}
  }
  return tokenCache;
}

