import { Platform } from "react-native";
import { QueryClient, QueryFunction } from "@tanstack/react-query";
import { getCachedSessionToken } from "@/lib/secure-store";

function isLocalHost(hostOrOrigin: string): boolean {
  const normalized = hostOrOrigin.replace(/^https?:\/\//i, "");
  return normalized.startsWith("localhost") || normalized.startsWith("127.0.0.1");
}

function normalizeConfiguredOrigin(hostOrOrigin: string): string {
  const trimmed = hostOrOrigin.trim().replace(/\/+$/, "");
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  const protocol = isLocalHost(trimmed) ? "http" : "https";
  return `${protocol}://${trimmed}`;
}

export function getNativeOriginHeaders(): Record<string, string> {
  if (Platform.OS === "web") return {};
  try {
    const origin = new URL(getApiUrl()).origin;
    return {
      origin,
      referer: `${origin}/`,
    };
  } catch {
    return {};
  }
}

export function getAuthHeaders(): Record<string, string> {
  const headers = getNativeOriginHeaders();
  try {
    const token = getCachedSessionToken();
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }
  } catch {}
  return headers;
}

export function authFetch(url: string, options?: RequestInit): Promise<Response> {
  return globalThis.fetch(url, {
    ...options,
    credentials: "include",
    headers: { ...options?.headers, ...getAuthHeaders() },
  });
}

export function getApiUrl(): string {
  if (Platform.OS === "web" && typeof window !== "undefined" && window.location) {
    const loc = window.location;
    const isDev = loc.port === "8081" || loc.port === "8082" || loc.hostname === "localhost";
    if (!isDev) {
      return loc.origin;
    }
  }

  // Native (Android/iOS) builds target the production API.
  // LOCAL DEV: change to "http://10.0.2.2:5000/" for Android emulator testing.
  // REVERT to "https://proset.ai/" before committing.
  return "https://proset.ai/";
}

type SessionExpiredListener = () => void;
const sessionExpiredListeners = new Set<SessionExpiredListener>();

export function onSessionExpired(listener: SessionExpiredListener): () => void {
  sessionExpiredListeners.add(listener);
  return () => sessionExpiredListeners.delete(listener);
}

function notifySessionExpired() {
  sessionExpiredListeners.forEach((fn) => {
    try { fn(); } catch {}
  });
}

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    if (res.status === 401) {
      notifySessionExpired();
    }
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

export async function apiRequest(
  method: string,
  route: string,
  data?: unknown | undefined,
): Promise<Response> {
  const baseUrl = getApiUrl();
  const url = new URL(route, baseUrl);

  const res = await fetch(url.toString(), {
    method,
    headers: {
      ...(data ? { "Content-Type": "application/json" } : {}),
      ...getAuthHeaders(),
    },
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
  });

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const baseUrl = getApiUrl();
    const url = new URL(queryKey.join("/") as string, baseUrl);

    const res = await fetch(url.toString(), {
      credentials: "include",
      headers: getAuthHeaders(),
    });

    if (res.status === 401) {
      notifySessionExpired();
      if (unauthorizedBehavior === "returnNull") {
        return null;
      }
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
