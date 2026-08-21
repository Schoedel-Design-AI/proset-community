import React, { createContext, useCallback, useContext, useEffect, useMemo, useSyncExternalStore } from "react";
import { Platform } from "react-native";
import { useAuth, type AuthUser } from "./auth-context";
import Colors from "../constants/colors";

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
import SettingsDeveloperScreen from "../app/settings/developer";

import PrivacyScreen from "../app/privacy";
import RefundScreen from "../app/refund";
import DocumentationScreen from "../app/documentation";
import TermsScreen from "../app/terms";
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
type NativeScreenProps = {
  route?: {
    name?: string;
    params?: SearchParams;
  };
};
type NativeNavigationTarget = {
  method: "push" | "replace";
  screen: string;
  params: SearchParams;
};
const DEFAULT_ROUTER_SNAPSHOT: RouterSnapshot = {
  segments: [],
  params: {},
  pathname: "/",
};

// Global navigation helpers for static router object
let globalNavigateWeb: any = null;
let globalNavigateNative: any = null;
let pendingNativeNavigation: NativeNavigationTarget | null = null;
let nativeNavigationSnapshot: RouterSnapshot = DEFAULT_ROUTER_SNAPSHOT;
const nativeNavigationListeners = new Set<() => void>();

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
  const isWeb = Platform.OS === "web";

  // Use stable named functions — the release minifier can break inline
  // arrow functions like `() => () => {}` on Hermes.
  const subscribe = useMemo(() => {
    if (isWeb) return subscribeToBrowserLocation;
    function noopSubscribe() { return function noopUnsubscribe() {}; }
    return noopSubscribe;
  }, [isWeb]);

  const getSnapshot = useMemo(() => {
    if (isWeb) return getBrowserLocationSnapshot;
    function noopSnapshot() { return "/"; }
    return noopSnapshot;
  }, [isWeb]);

  const snapshot = useSyncExternalStore(
    subscribe,
    getSnapshot,
    () => "/",
  );
  return useMemo(() => parseBrowserLocationSnapshot(snapshot || "/"), [snapshot]);
}

function subscribeToNativeNavigation(onStoreChange: () => void): () => void {
  nativeNavigationListeners.add(onStoreChange);
  return () => {
    nativeNavigationListeners.delete(onStoreChange);
  };
}

function getNativeNavigationSnapshot(): RouterSnapshot {
  return nativeNavigationSnapshot;
}

function setNativeNavigationSnapshot(snapshot: RouterSnapshot) {
  nativeNavigationSnapshot = snapshot;
  nativeNavigationListeners.forEach((listener) => {
    try {
      listener();
    } catch {}
  });
}

function useNativeNavigationSnapshot(): RouterSnapshot {
  const isNative = Platform.OS !== "web";
  const subscribe = useMemo(() => {
    if (isNative) return subscribeToNativeNavigation;
    function noopSubscribe() { return function noopUnsubscribe() {}; }
    return noopSubscribe;
  }, [isNative]);
  const getSnapshot = useMemo(() => {
    if (isNative) return getNativeNavigationSnapshot;
    function noopSnapshot() { return DEFAULT_ROUTER_SNAPSHOT; }
    return noopSnapshot;
  }, [isNative]);

  return useSyncExternalStore(
    subscribe,
    getSnapshot,
    () => DEFAULT_ROUTER_SNAPSHOT,
  );
}

function useFallbackLocationSnapshot(): RouterSnapshot {
  const browserLocation = useBrowserLocationSnapshot();
  const nativeLocation = useNativeNavigationSnapshot();
  return Platform.OS === "web" ? browserLocation : nativeLocation;
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
  return {};
}

function snapshotForPathname(pathname: string, params: SearchParams = {}): RouterSnapshot {
  return {
    segments: pathname.split("/").filter(Boolean),
    params: { ...params, ...getPathParams(pathname) },
    pathname,
  };
}

function snapshotForNativeRoute(routeName: string = "index", params: SearchParams = {}): RouterSnapshot {
  return snapshotForPathname(nativePathnameForRoute(routeName, params), params);
}

function parseNativeResolvedHref(resolved: string): { screen: string; params: SearchParams } {
  const [pathPart, query = ""] = resolved.split("?");
  const cleanPath = pathPart.startsWith("/") ? pathPart.slice(1) : pathPart;
  const pathSegments = cleanPath.split("/").filter(Boolean).map((segment) => decodeURIComponent(segment));
  const params: SearchParams = {};
  const queryParams = new URLSearchParams(query);
  queryParams.forEach((value, key) => {
    params[key] = value;
  });

  if (pathSegments[0] === "recording" && pathSegments[1]) {
    params.id = pathSegments[1];
    return { screen: "recording/[id]", params };
  }

  return { screen: cleanPath || "index", params };
}

function isNativeNavigationReady(navigationRef: any): boolean {
  if (!navigationRef) return false;
  if (typeof navigationRef.isReady !== "function") return true;
  return navigationRef.isReady();
}

function applyNativeNavigation(navigationRef: any, target: NativeNavigationTarget) {
  if (target.method === "replace" && typeof navigationRef.reset === "function") {
    navigationRef.reset({
      index: 0,
      routes: [{ name: target.screen, params: target.params }],
    });
  } else {
    navigationRef.navigate(target.screen, target.params);
  }
  setNativeNavigationSnapshot(snapshotForNativeRoute(target.screen, target.params));
}

function dispatchNativeNavigation(target: NativeNavigationTarget) {
  if (isNativeNavigationReady(globalNavigateNative)) {
    applyNativeNavigation(globalNavigateNative, target);
    return;
  }
  pendingNativeNavigation = target;
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
    if (Platform.OS === "web") {
      if (globalNavigateWeb) {
        globalNavigateWeb(resolved);
        setTimeout(notifyBrowserNavigation, 0);
      } else {
        window.location.assign(resolved);
      }
    } else {
      const { screen, params } = parseNativeResolvedHref(resolved);
      dispatchNativeNavigation({ method: "push", screen, params });
    }
  },
  replace: (href: string | { pathname: string; params?: Record<string, any> }) => {
    const resolved = resolveHref(href);
    if (Platform.OS === "web") {
      if (globalNavigateWeb) {
        globalNavigateWeb(resolved, { replace: true });
        setTimeout(notifyBrowserNavigation, 0);
      } else {
        window.location.replace(resolved);
      }
    } else {
      const { screen, params } = parseNativeResolvedHref(resolved);
      dispatchNativeNavigation({ method: "replace", screen, params });
    }
  },
  back: () => {
    if (Platform.OS === "web") {
      window.history.back();
    } else {
      if (globalNavigateNative) {
        globalNavigateNative.goBack();
      }
    }
  },
  canGoBack: (): boolean => {
    if (Platform.OS === "web") {
      return window.history.length > 1;
    } else {
      if (globalNavigateNative && typeof globalNavigateNative.canGoBack === "function") {
        return globalNavigateNative.canGoBack();
      }
      return true;
    }
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

  if (Platform.OS === "web") {
    return (
      <a href={href} onClick={handlePress} style={{ textDecoration: "none", color: "inherit", ...style }}>
        {children}
      </a>
    );
  }

  const { Pressable } = require("react-native");
  return (
    <Pressable onPress={handlePress} style={style}>
      {children}
    </Pressable>
  );
};

// Web Router wrapper using React Router
const WebRouterWrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { BrowserRouter } = require("react-router");

  return (
    <BrowserRouter>
      <WebRouteHandler>{children}</WebRouteHandler>
    </BrowserRouter>
  );
};

const WebRouteHandler: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { useNavigate, useLocation, useParams } = require("react-router");
  const navigate = useNavigate();
  const location = useLocation();
  const params = useParams();

  useEffect(() => {
    globalNavigateWeb = navigate;
  }, [navigate]);

  const segments = location.pathname.split("/").filter(Boolean);
  const localParams = { ...params, ...getPathParams(location.pathname) };
  
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

// Native Stack wrapper using react-navigation
const NativeRouterWrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { NavigationContainer, DefaultTheme, createNavigationContainerRef } = require("@react-navigation/native");
  const navigationRef = useMemo(() => createNavigationContainerRef(), [createNavigationContainerRef]);

  const navTheme = useMemo(() => ({
    ...DefaultTheme,
    dark: true,
    colors: {
      ...DefaultTheme.colors,
      primary: Colors.primary,
      background: Colors.background,
      card: Colors.background,
      text: Colors.text,
      border: Colors.border,
      notification: Colors.accent,
    },
  }), [DefaultTheme]);

  const linking = useMemo(() => ({
    prefixes: ["aiforms://", "barryai://", "app.proset.ai://"],
    config: {
      screens: {
        index: "",
        login: "login",
        record: "record",
        recordings: "recordings",
        combine: "combine",
        "thought-threads": "thought-threads",
        "thought-thread/[id]": "thought-thread/:id",
        "recording/[id]": "recording/:id",
        files: "files",
        settings: "settings",
        "settings/account": "settings/account",
        "settings/preferences": "settings/preferences",
        "settings/developer": "settings/developer",
        privacy: "privacy",
        refund: "refund",
        documentation: "documentation",
        terms: "terms",
        "reset-password": "reset-password",
        "force-change-password": "force-change-password",
        "verify-email": "verify-email",
        "mfa-setup": "mfa-setup",
        "choose-plan": "choose-plan",
        "+not-found": "*",
      },
    },
  }), []);

  const syncNavigationSnapshot = useCallback(() => {
    const route = navigationRef.getCurrentRoute?.();
    const routeParams = (route?.params && typeof route.params === "object" ? route.params : {}) as SearchParams;
    setNativeNavigationSnapshot(snapshotForNativeRoute(route?.name || "index", routeParams));
  }, [navigationRef]);

  const applyPendingNavigation = useCallback(() => {
    if (!pendingNativeNavigation || !isNativeNavigationReady(navigationRef)) return;
    const next = pendingNativeNavigation;
    pendingNativeNavigation = null;
    applyNativeNavigation(navigationRef, next);
  }, [navigationRef]);

  useEffect(() => {
    globalNavigateNative = navigationRef;
    if (isNativeNavigationReady(navigationRef)) {
      syncNavigationSnapshot();
      applyPendingNavigation();
    }
    return () => {
      if (globalNavigateNative === navigationRef) {
        globalNavigateNative = null;
      }
    };
  }, [applyPendingNavigation, navigationRef, syncNavigationSnapshot]);

  const handleReady = useCallback(() => {
    syncNavigationSnapshot();
    applyPendingNavigation();
  }, [applyPendingNavigation, syncNavigationSnapshot]);

  return (
    <NavigationContainer ref={navigationRef} theme={navTheme} linking={linking} onReady={handleReady} onStateChange={syncNavigationSnapshot}>
      {children}
    </NavigationContainer>
  );
};

function nativePathnameForRoute(routeName: string, params: SearchParams): string {
  if (!routeName || routeName === "index") return "/";
  return `/${routeName.replace(/\[([^\]]+)\]/g, (_, key) => encodeURIComponent(params[key] || ""))}`;
}

function createNativeScreen(Component: React.ComponentType<any>) {
  return function NativeScreen({ route }: NativeScreenProps) {
    const params = route?.params || {};
    const pathname = nativePathnameForRoute(route?.name || "index", params);
    const segments = pathname.split("/").filter(Boolean);

    return (
      <RouterContext.Provider value={{ segments, params: { ...params, ...getPathParams(pathname) }, pathname, hasRouter: true }}>
        <Component />
      </RouterContext.Provider>
    );
  };
}

const NativeIndexScreen = createNativeScreen(IndexScreen);
const NativeLoginScreen = createNativeScreen(LoginScreen);
const NativeRecordScreen = createNativeScreen(RecordScreen);
const NativeRecordingsScreen = createNativeScreen(RecordingsScreen);
const NativeCombineScreen = createNativeScreen(CombineScreen);
const NativeThoughtThreadsScreen = createNativeScreen(ThoughtThreadsScreen);
const NativeThoughtThreadDetailScreen = createNativeScreen(ThoughtThreadDetailScreen);
const NativeRecordingDetailScreen = createNativeScreen(RecordingDetailScreen);
const NativeFilesScreen = createNativeScreen(FilesScreen);
const NativeSettingsIndexScreen = createNativeScreen(SettingsIndexScreen);
const NativeSettingsAccountScreen = createNativeScreen(SettingsAccountScreen);

const NativeSettingsPreferencesScreen = createNativeScreen(SettingsPreferencesScreen);
const NativeSettingsDeveloperScreen = createNativeScreen(SettingsDeveloperScreen);

const NativePrivacyScreen = createNativeScreen(PrivacyScreen);
const NativeRefundScreen = createNativeScreen(RefundScreen);
const NativeDocumentationScreen = createNativeScreen(DocumentationScreen);
const NativeTermsScreen = createNativeScreen(TermsScreen);
const NativeResetPasswordScreen = createNativeScreen(ResetPasswordScreen);

const NativeVerifyEmailScreen = createNativeScreen(VerifyEmailScreen);
const NativeMfaSetupScreen = createNativeScreen(MfaSetupScreen);
const NativeChoosePlanScreen = createNativeScreen(ChoosePlanScreen);
const NativeNotFoundScreen = createNativeScreen(NotFoundScreen);

function getInitialNativeRouteName(user: AuthUser | null): string {
  if (!user) return "login";
  if (user.forcePasswordChange) return "force-change-password";
  if (!user.emailVerified) return "verify-email";
  if (
    user.emailVerified &&
    !user.hasSeenPlanSelection &&
    user.role !== "admin"
  ) {
    return "choose-plan";
  }
  return "index";
}

// Screen definitions for Native Navigation Stack
const NativeStackContent: React.FC = () => {
  const { createNativeStackNavigator } = require("@react-navigation/native-stack");
  const StackNav = createNativeStackNavigator();
  const { user } = useAuth();

  return (
    <StackNav.Navigator 
      initialRouteName={getInitialNativeRouteName(user)} 
      screenOptions={{ 
        headerShown: false,
        contentStyle: { backgroundColor: Colors.background },
      }}
    >
      <StackNav.Screen name="index" component={NativeIndexScreen} />
      <StackNav.Screen name="login" component={NativeLoginScreen} />
      <StackNav.Screen name="record" component={NativeRecordScreen} />
      <StackNav.Screen name="recordings" component={NativeRecordingsScreen} />
      <StackNav.Screen name="combine" component={NativeCombineScreen} />
      <StackNav.Screen name="thought-threads" component={NativeThoughtThreadsScreen} />
      <StackNav.Screen name="thought-thread/[id]" component={NativeThoughtThreadDetailScreen} />
      <StackNav.Screen name="recording/[id]" component={NativeRecordingDetailScreen} />
      <StackNav.Screen name="files" component={NativeFilesScreen} />
      <StackNav.Screen name="settings" component={NativeSettingsIndexScreen} />
      <StackNav.Screen name="settings/account" component={NativeSettingsAccountScreen} />
      <StackNav.Screen name="settings/preferences" component={NativeSettingsPreferencesScreen} />
      <StackNav.Screen name="settings/developer" component={NativeSettingsDeveloperScreen} />

      <StackNav.Screen name="privacy" component={NativePrivacyScreen} />
      <StackNav.Screen name="refund" component={NativeRefundScreen} />
      <StackNav.Screen name="documentation" component={NativeDocumentationScreen} />
      <StackNav.Screen name="terms" component={NativeTermsScreen} />
      <StackNav.Screen name="reset-password" component={NativeResetPasswordScreen} />

      <StackNav.Screen name="verify-email" component={NativeVerifyEmailScreen} />
      <StackNav.Screen name="mfa-setup" component={NativeMfaSetupScreen} />
      <StackNav.Screen name="choose-plan" component={NativeChoosePlanScreen} />
      <StackNav.Screen name="+not-found" component={NativeNotFoundScreen} />
    </StackNav.Navigator>
  );
};

// Stack Component
export const Stack: any = ({ children, screenOptions }: any) => {
  if (Platform.OS === "web") {
    const { Routes, Route } = require("react-router");
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
          <Route path="/terms" element={<TermsScreen />} />
          <Route path="/reset-password" element={<ResetPasswordScreen />} />

          <Route path="/verify-email" element={<VerifyEmailScreen />} />
          <Route path="/mfa-setup" element={<MfaSetupScreen />} />
          <Route path="/choose-plan" element={<ChoosePlanScreen />} />
          <Route path="*" element={<NotFoundScreen />} />
        </Routes>
      </WebRouterWrapper>
    );
  }

  return (
    <NativeRouterWrapper>
      <NativeStackContent />
    </NativeRouterWrapper>
  );
};

Stack.Screen = ({ name, options }: any) => {
  // Screen options are handled by the static Navigator
  return null;
};
