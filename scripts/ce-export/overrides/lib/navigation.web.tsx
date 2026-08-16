import React, { createContext, useContext, useEffect, useMemo, useSyncExternalStore } from "react";
import {
  BrowserRouter,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from "react-router";

// Local routing adapter for Proset. Keep app code importing this module
// instead of Expo Router so the project stays on plain React Native.
// Let's import all page screens statically to construct the route map
import IndexScreen from "../app/index";
import LoginScreen from "../app/login";
import RecordScreen from "../app/record";
import RecordingsScreen from "../app/recordings";
import CombineScreen from "../app/combine";
import ThoughtThreadsScreen from "../app/thought-threads";
import ThoughtThreadDetailScreen from "../app/thought-thread/[id]";
import RecordingDetailScreen from "../app/recording/[id]";
import FilesScreen from "../app/files";
import SettingsIndexScreen from "../app/settings/index";
import SettingsAccountScreen from "../app/settings/account";
import SettingsPreferencesScreen from "../app/settings/preferences";

import PrivacyScreen from "../app/privacy";
import RefundScreen from "../app/refund";
import DocumentationScreen from "../app/documentation";
import ResetPasswordScreen from "../app/reset-password";

import VerifyEmailScreen from "../app/verify-email";
import MfaSetupScreen from "../app/mfa-setup";
import ChoosePlanScreen from "../app/choose-plan";
import NotFoundScreen from "../app/+not-found";

// Define a type for route params
type SearchParams = Record<string, string>;
type RouterSnapshot = {
  segments: string[];
  params: SearchParams;
  pathname: string;
};

// Global navigation helpers for static router object
let globalNavigateWeb: any = null;

// Context to share current segments and parameters
const RouterContext = createContext<{
  segments: string[];
  params: SearchParams;
  pathname: string;
  hasRouter: boolean;
}>({
  segments: [],
  params: {},
  pathname: "/",
  hasRouter: false,
});

export function useSegments() {
  const context = useContext(RouterContext);
  const fallbackLocation = useFallbackLocationSnapshot();
  return context.hasRouter ? context.segments : fallbackLocation.segments;
}

export function useLocalSearchParams<T extends Record<string, any> = SearchParams>(): T {
  const context = useContext(RouterContext);
  const fallbackLocation = useFallbackLocationSnapshot();
  return (context.hasRouter ? context.params : fallbackLocation.params) as unknown as T;
}

export function useGlobalSearchParams<T extends Record<string, any> = SearchParams>(): T {
  return useLocalSearchParams<T>();
}

export function usePathname(): string {
  const context = useContext(RouterContext);
  const fallbackLocation = useFallbackLocationSnapshot();
  return context.hasRouter ? context.pathname : fallbackLocation.pathname;
}

function parseBrowserLocationSnapshot(snapshot: string): RouterSnapshot {
  const [pathnamePart = "/", searchPart = ""] = snapshot.split("?");
  const pathname = pathnamePart || "/";
  const params: SearchParams = {};
  const queryParams = new URLSearchParams(searchPart);
  queryParams.forEach((value, key) => {
    params[key] = value;
  });

  return {
    segments: pathname.split("/").filter(Boolean),
    params,
    pathname,
  };
}

function getBrowserLocationSnapshot(): string {
  if (typeof window === "undefined" || !window.location) {
    return "/";
  }

  return `${window.location.pathname || "/"}${window.location.search || ""}`;
}

function subscribeToBrowserLocation(onStoreChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};

  window.addEventListener("popstate", onStoreChange);
  window.addEventListener("aiforms:navigation", onStoreChange);

  return () => {
    window.removeEventListener("popstate", onStoreChange);
    window.removeEventListener("aiforms:navigation", onStoreChange);
  };
}

function useBrowserLocationSnapshot(): RouterSnapshot {
  const snapshot = useSyncExternalStore(
    subscribeToBrowserLocation,
    getBrowserLocationSnapshot,
    () => "/",
  );
  return useMemo(() => parseBrowserLocationSnapshot(snapshot || "/"), [snapshot]);
}

function useFallbackLocationSnapshot(): RouterSnapshot {
  return useBrowserLocationSnapshot();
}

function notifyBrowserNavigation() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("aiforms:navigation"));
  }
}

function getPathParams(pathname: string): SearchParams {
  const segments = pathname.split("/").filter(Boolean);
  if (segments[0] === "recording" && segments[1]) {
    return { id: decodeURIComponent(segments[1]) };
  }
  if (segments[0] === "thought-thread" && segments[1]) {
    return { id: decodeURIComponent(segments[1]) };
  }
  if (segments[0] === "files" && segments[1]) {
    return { fileId: decodeURIComponent(segments[1]) };
  }
  return {};
}

function resolveHref(href: string | { pathname: string; params?: Record<string, any> }): string {
  if (typeof href === "string") return href;
  let path = href.pathname;
  if (href.params) {
    Object.entries(href.params).forEach(([key, val]) => {
      path = path.replace(`[${key}]`, String(val)).replace(`:${key}`, String(val));
    });
    const queryParams = new URLSearchParams();
    Object.entries(href.params).forEach(([key, val]) => {
      if (!href.pathname.includes(`[${key}]`) && !href.pathname.includes(`:${key}`)) {
        queryParams.append(key, String(val));
      }
    });
    const queryStr = queryParams.toString();
    if (queryStr) {
      path = `${path}?${queryStr}`;
    }
  }
  return path;
}

export const router = {
  push: (href: string | { pathname: string; params?: Record<string, any> }) => {
    const resolved = resolveHref(href);
    if (globalNavigateWeb) {
      globalNavigateWeb(resolved);
      setTimeout(notifyBrowserNavigation, 0);
    } else {
      window.location.assign(resolved);
    }
  },
  replace: (href: string | { pathname: string; params?: Record<string, any> }) => {
    const resolved = resolveHref(href);
    if (globalNavigateWeb) {
      globalNavigateWeb(resolved, { replace: true });
      setTimeout(notifyBrowserNavigation, 0);
    } else {
      window.location.replace(resolved);
    }
  },
  back: () => {
    window.history.back();
  },
  canGoBack: (): boolean => {
    return window.history.length > 1;
  },
};

export function useRouter() {
  return router;
}

// Link component shim
export const Link: React.FC<{ href: string; asChild?: boolean; children: React.ReactNode; style?: any }> = ({
  href,
  asChild,
  children,
  style,
}) => {
  const handlePress = (e: any) => {
    if (e.preventDefault) e.preventDefault();
    router.push(href);
  };

  return (
    <a href={href} onClick={handlePress} style={{ textDecoration: "none", color: "inherit", ...style }}>
      {children}
    </a>
  );
};

// Web Router wrapper using React Router. This file is the Vite/web
// adapter, so use ESM imports instead of runtime require() calls.
const WebRouterWrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  return (
    <BrowserRouter>
      <WebRouteHandler>{children}</WebRouteHandler>
    </BrowserRouter>
  );
};

const WebRouteHandler: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const params = useParams();

  useEffect(() => {
    globalNavigateWeb = navigate;
  }, [navigate]);

  const segments = location.pathname.split("/").filter(Boolean);
  const localParams: SearchParams = { ...getPathParams(location.pathname) };
  Object.entries(params).forEach(([key, value]) => {
    if (typeof value === "string") {
      localParams[key] = value;
    }
  });
  
  // Parse query parameters
  const queryParams = new URLSearchParams(location.search);
  queryParams.forEach((value, key) => {
    localParams[key] = value;
  });

  return (
    <RouterContext.Provider value={{ segments, params: localParams, pathname: location.pathname, hasRouter: true }}>
      {children}
    </RouterContext.Provider>
  );
};

// Stack Component
export const Stack: any = ({ children, screenOptions }: any) => {
  return (
    <WebRouterWrapper>
      <Routes>
        <Route path="/" element={<IndexScreen />} />
        <Route path="/login" element={<LoginScreen />} />
        <Route path="/record" element={<RecordScreen />} />
        <Route path="/recordings" element={<RecordingsScreen />} />
        <Route path="/combine" element={<CombineScreen />} />
        <Route path="/thought-threads" element={<ThoughtThreadsScreen />} />
        <Route path="/thought-thread/:id" element={<ThoughtThreadDetailScreen />} />
        <Route path="/recording/:id" element={<RecordingDetailScreen />} />
        <Route path="/files" element={<FilesScreen />} />
        <Route path="/settings" element={<SettingsIndexScreen />} />
        <Route path="/settings/account" element={<SettingsAccountScreen />} />
        <Route path="/settings/preferences" element={<SettingsPreferencesScreen />} />

        <Route path="/privacy" element={<PrivacyScreen />} />
        <Route path="/refund" element={<RefundScreen />} />
        <Route path="/documentation" element={<DocumentationScreen />} />
        <Route path="/reset-password" element={<ResetPasswordScreen />} />

        <Route path="/verify-email" element={<VerifyEmailScreen />} />
        <Route path="/mfa-setup" element={<MfaSetupScreen />} />
        <Route path="/choose-plan" element={<ChoosePlanScreen />} />
        <Route path="*" element={<NotFoundScreen />} />
      </Routes>
    </WebRouterWrapper>
  );
};

Stack.Screen = ({ name, options }: any) => {
  // Screen options are handled by the static Navigator
  return null;
};
