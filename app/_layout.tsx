import { QueryClientProvider } from "@tanstack/react-query";
import { Stack, useGlobalSearchParams, usePathname, useRouter, useSegments } from "@/lib/navigation";
import { SplashScreen } from "@/lib/splash-screen";
import React, { useEffect, useState } from "react";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { queryClient } from "@/lib/query-client";
import { RecordingsProvider } from "@/lib/recordings-context";
import { ActiveRecordingProvider } from "@/lib/active-recording-context";
import { AuthProvider, useAuth } from "@/lib/auth-context";
import { setupPurchases } from "@/lib/purchases";
import { LanguageProvider } from "@/lib/i18n";
import { FeedbackProvider, useFeedback } from "@/lib/feedback-context";
import FeedbackModal from "@/components/FeedbackModal";
import {
  useFonts,
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
} from "@/lib/font";
import { ActivityIndicator, View, Text, StyleSheet, StatusBar, Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { SafeAreaProvider } from "react-native-safe-area-context";

import Colors from "@/constants/colors";
import Feather from "@react-native-vector-icons/feather/static";
import BugReporter from "@/components/BugReporter";
import ActiveRecordingMiniBar from "@/components/ActiveRecordingMiniBar";
import {
  TextScaleContext,
  TextSizePrefContext,
  TEXT_SIZE_STORAGE_KEY,
  getTextScale,
  type TextSizePreference,
} from "@/lib/typography";
import { buildReturnToFromSearch, resolvePostLoginRoute } from "@/lib/auth-redirect";

SplashScreen.preventAutoHideAsync();

const PROTECTED_SEGMENTS = new Set<string | undefined>([
  undefined,  // index route: protected on all platforms
  "record",
  "recording",
  "recordings",
  "files",
  "admin",
  "choose-plan",
  "settings",
  "mfa-setup",
  "force-change-password",
  "verify-email",
]);

function AuthGuard({ children }: { children: React.ReactNode }) {
  const { user, isLoading, skipAuthRedirect } = useAuth();
  const segments = useSegments();
  const pathname = usePathname() || "/";
  const searchParams = useGlobalSearchParams() || {};
  const loginReturnTo = Array.isArray(searchParams.returnTo) ? searchParams.returnTo[0] : searchParams.returnTo;
  const emailActionCode = Array.isArray(searchParams.oobCode) ? searchParams.oobCode[0] : searchParams.oobCode;
  const currentSearch = Platform.OS === "web" && typeof window !== "undefined" ? window.location.search : "";
  const router = useRouter();

  useEffect(() => {
    if (isLoading) return;

    const segment = segments[0];
    const onLoginPage = segment === "login";
    const onDocsPage = segment === "documentation";
    const onResetPasswordPage = segment === "reset-password";
    const onPrivacyPage = segment === "privacy";
    const onForceChangePage = segment === "force-change-password";
    const onVerifyEmailPage = segment === "verify-email";
    const hasEmailActionCode = typeof emailActionCode === "string" && emailActionCode.length > 0;
    const onMfaSetupPage = segment === "mfa-setup";
    const onChoosePlanPage = segment === "choose-plan";
    const onRecordPage = segment === "record";
    const isProtectedRoute = PROTECTED_SEGMENTS.has(segment);
    const returnTo = buildReturnToFromSearch(pathname, currentSearch);
    if (!user && isProtectedRoute && !onLoginPage && !onDocsPage && !onResetPasswordPage && !onPrivacyPage && !(onVerifyEmailPage && hasEmailActionCode)) {
      router.replace({ pathname: "/login", params: { returnTo } });
    } else if (user && user.forcePasswordChange && !onForceChangePage) {
      router.replace("/force-change-password");
    } else if (user && !user.emailVerified && !onVerifyEmailPage && !onForceChangePage) {
      router.replace("/verify-email");
    } else if (user && user.emailVerified && !user.hasSeenPlanSelection && user.role !== "admin" && !onChoosePlanPage && !onRecordPage && !onForceChangePage && !onVerifyEmailPage && !onMfaSetupPage && !onLoginPage && !onDocsPage) {
      router.replace("/choose-plan");
    } else if (user && onLoginPage && !skipAuthRedirect) {
      router.replace(resolvePostLoginRoute(loginReturnTo));
    }

  }, [user, isLoading, segments, skipAuthRedirect, router, pathname, currentSearch, loginReturnTo, emailActionCode]);

  useEffect(() => {
    if (isLoading) return;
    setupPurchases(user?.id).catch((error) => {
      console.error("Failed to synchronize the RevenueCat customer:", error);
    });
  }, [isLoading, user?.id]);

  if (isLoading) {
    return (
      <View style={authLoadingStyles.container}>
        <View style={authLoadingStyles.logoWrap}>
          <View style={authLoadingStyles.logoCircle}>
            <Feather name="mic" size={32} color={Colors.primary} />
          </View>
        </View>
        <Text style={authLoadingStyles.brandName}>Proset</Text>
        <Text style={authLoadingStyles.brandTagline}>Voice to everything</Text>
        <ActivityIndicator size="small" color={Colors.primary} style={authLoadingStyles.spinner} />
      </View>
    );
  }

  // Prevent flash of protected content while redirect is queued.
  // Duplicates the useEffect redirect logic synchronously so the DOM
  // never paints the protected page before the router.replace fires.
  const segment = segments[0];
  const isProtectedNow = PROTECTED_SEGMENTS.has(segment);
  const onLoginNow = segment === "login";
  const onDocsNow = segment === "documentation";
  const onResetNow = segment === "reset-password";
  const onPrivacyNow = segment === "privacy";
  const needsRedirect = !user && isProtectedNow && !onLoginNow && !onDocsNow && !onResetNow && !onPrivacyNow;
  if (needsRedirect && Platform.OS === "web") return null;

  return <>{children}</>;
}

function RootLayoutNav() {
  return (
    <AuthGuard>
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: Colors.background },
          animation: "slide_from_right",
        }}
      >
        <Stack.Screen name="index" />
        <Stack.Screen name="login" />
        <Stack.Screen name="record" options={{ animation: "slide_from_bottom" }} />
        <Stack.Screen name="recordings" />
        <Stack.Screen name="combine" />
        <Stack.Screen name="recording/[id]" />
        <Stack.Screen name="files" />
        <Stack.Screen name="settings" />
        <Stack.Screen name="admin" />
        <Stack.Screen name="documentation" />
        <Stack.Screen name="reset-password" />
        <Stack.Screen name="force-change-password" />
        <Stack.Screen name="verify-email" />
        <Stack.Screen name="mfa-setup" />
      </Stack>
    </AuthGuard>
  );
}

function GlobalFeedbackModal() {
  const { feedbackVisible, closeFeedback } = useFeedback();
  return <FeedbackModal visible={feedbackVisible} onClose={closeFeedback} />;
}

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  const [textSizePref, setTextSizePref] = useState<TextSizePreference>("medium");
  const [prefLoaded, setPrefLoaded] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(TEXT_SIZE_STORAGE_KEY).then((v) => {
      if (v === "small" || v === "medium" || v === "large") setTextSizePref(v);
      setPrefLoaded(true);
    }).catch(() => setPrefLoaded(true));
  }, []);

  const handleSetPref = (p: TextSizePreference) => {
    setTextSizePref(p);
    AsyncStorage.setItem(TEXT_SIZE_STORAGE_KEY, p).catch(() => {});
  };

  useEffect(() => {
    if (fontsLoaded && prefLoaded) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, prefLoaded]);

  if (!fontsLoaded || !prefLoaded) return null;

  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <FeedbackProvider>
          <TextSizePrefContext.Provider value={{ pref: textSizePref, setPref: handleSetPref }}>
            <TextScaleContext.Provider value={getTextScale(textSizePref)}>
              <QueryClientProvider client={queryClient}>
                <AuthProvider>
                  <LanguageProvider>
                    <RecordingsProvider>
                      <ActiveRecordingProvider>
                        {Platform.OS === "web" ? (
                          <>
                            <StatusBar barStyle="light-content" />
                            <RootLayoutNav />
                            <ActiveRecordingMiniBar />
                            <BugReporter />
                            <GlobalFeedbackModal />
                          </>
                        ) : (
                          <KeyboardProvider>
                            <StatusBar barStyle="light-content" />
                            <RootLayoutNav />
                            <BugReporter />
                            <GlobalFeedbackModal />
                          </KeyboardProvider>
                        )}
                      </ActiveRecordingProvider>
                    </RecordingsProvider>
                  </LanguageProvider>
                </AuthProvider>
              </QueryClientProvider>
            </TextScaleContext.Provider>
          </TextSizePrefContext.Provider>
        </FeedbackProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}

const authLoadingStyles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: Colors.background,
  },
  logoWrap: {
    marginBottom: 16,
  },
  logoCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: "rgba(0, 180, 216, 0.12)",
    justifyContent: "center",
    alignItems: "center",
  },
  brandName: {
    fontSize: 28,
    fontFamily: "Inter_700Bold",
    color: Colors.text,
    letterSpacing: -0.5,
  },
  brandTagline: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    color: Colors.textMuted,
    marginTop: 4,
  },
  spinner: {
    marginTop: 32,
  },
});
