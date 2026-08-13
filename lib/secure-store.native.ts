import * as Keychain from "react-native-keychain";

let tokenCache: string | null = null;
const SERVICE_NAME = "bun.proset.ai.session";

export async function setSessionToken(token: string | null): Promise<void> {
  tokenCache = token;
  try {
    if (token) {
      await Keychain.setGenericPassword("session", token, {
        service: SERVICE_NAME,
        accessible: Keychain.ACCESSIBLE.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
        securityLevel: Keychain.SECURITY_LEVEL.SECURE_SOFTWARE,
      });
    } else {
      await Keychain.resetGenericPassword({ service: SERVICE_NAME });
    }
  } catch (e) {
    console.error("Failed to write token to native keychain:", e);
  }
}

export async function getSessionToken(): Promise<string | null> {
  if (tokenCache) return tokenCache;
  try {
    const credentials = await Keychain.getGenericPassword({ service: SERVICE_NAME });
    if (credentials) {
      tokenCache = credentials.password;
      return tokenCache;
    }
  } catch (e) {
    console.error("Failed to read token from native keychain:", e);
  }
  return null;
}

export function getCachedSessionToken(): string | null {
  return tokenCache;
}

