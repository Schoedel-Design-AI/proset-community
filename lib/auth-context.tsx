import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from "react";
import { Platform, AppState, type AppStateStatus } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  getApiUrl,
  getAuthHeaders,
  onSessionExpired,
} from "./query-client";
import * as SecureStore from "@/lib/secure-store";
import { getCurrentLanguage } from "@/lib/i18n";
import {
  cancelFirebaseMfaChallenge,
  completeFirebaseTotpSignIn,
  getFirebaseIdToken,
  isFirebaseClientConfigured,
  reauthenticateFirebasePassword,
  reloadFirebaseSession,
  signInFirebaseWithPassword,
  signOutFirebase,
  subscribeToFirebaseTokens,
  updateFirebasePassword,
} from "@/lib/firebase-auth-client";

export type AuthUser = {
  id: string;
  userNumber: number;
  firstName: string;
  jobType: string;
  country?: string;
  avatarId?: string;
  email: string;
  emailVerified?: boolean;
  forcePasswordChange?: boolean;
  role?: "user" | "admin";
  twoFactorEnabled?: boolean;
  mfaRequired?: boolean;
  passwordExpiryDays?: number | null;
  daysUntilPasswordExpiry?: number | null;
  sessionExpiresAt?: string | null;
  hasSeenPlanSelection?: boolean;
};

export type RegisterResult =
  | AuthUser
  | { status: "verification_required" | "verification_email_failed"; email: string; message?: string };

export type AuthContextType = {
  user: AuthUser | null;
  isLoading: boolean;
  skipAuthRedirect: boolean;
  setSkipAuthRedirect: (skip: boolean) => void;
  sessionExpiredMessage: string | null;
  clearSessionExpiredMessage: () => void;
  login: (email: string, password: string) => Promise<any>;
  requestMagicLink: (email: string) => Promise<void>;
  completeMagicLink: (token: string) => Promise<any>;
  register: (firstName: string, email: string, password: string, turnstileToken?: string) => Promise<RegisterResult>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<any>;
  changeEmail: (newEmail: string, password: string) => Promise<void>;
  changeName: (firstName: string) => Promise<void>;
  changeCountry: (country: string) => Promise<void>;
  changeJobType: (jobType: string) => Promise<void>;
  changeAvatar: (avatarId: string) => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  signInSocial: (provider: "google" | "github") => Promise<void>;
  signInPasskey: () => Promise<any>;
  mfaChallengePending: boolean;
  completeMfaSignIn: (code: string) => Promise<any>;
  cancelMfaSignIn: () => void;
  deleteAccount: (password: string) => Promise<void>;
};

const AuthContext = createContext<AuthContextType | null>(null);

export class AuthError extends Error {
  code: string;
  constructor(message: string, code: string = "") {
    super(message);
    this.code = code;
    this.name = "AuthError";
  }
}

const AUTH_ERROR_MAP: Record<string, { en: string; es: string }> = {
  INVALID_PASSWORD: {
    en: "That email and password don't match our records. Give it another try?",
    es: "Ese correo y contraseña no coinciden con nuestros registros. ¿Quieres intentarlo de nuevo?",
  },
  USER_NOT_FOUND: {
    en: "That email and password don't match our records. Give it another try?",
    es: "Ese correo y contraseña no coinciden con nuestros registros. ¿Quieres intentarlo de nuevo?",
  },
  INVALID_EMAIL_OR_PASSWORD: {
    en: "That email and password don't match our records. Give it another try?",
    es: "Ese correo y contraseña no coinciden con nuestros registros. ¿Quieres intentarlo de nuevo?",
  },
  EMAIL_NOT_VERIFIED: {
    en: "We just need to confirm your email first — we sent a verification link to your inbox. Give it a quick click and you'll be all set!",
    es: "Solo necesitamos confirmar tu correo primero — te enviamos un enlace de verificación a tu bandeja. ¡Un clic rápido y listo!",
  },
  FORCE_PASSWORD_CHANGE: {
    en: "For your account's safety, we need you to update your password. It'll only take a moment!",
    es: "Por la seguridad de tu cuenta, necesitamos que actualices tu contraseña. ¡Solo toma un momento!",
  },
  MFA_REQUIRED: {
    en: "Your account has extra security enabled — we just need you to set up two-factor authentication. Takes about a minute!",
    es: "Tu cuenta tiene seguridad adicional activada — solo necesitas configurar la autenticación de dos factores. ¡Toma como un minuto!",
  },
  RATE_LIMIT_EXCEEDED: {
    en: "We've hit our safety limit for attempts. Give it a few minutes, then try again — your account is safe.",
    es: "Alcanzamos nuestro límite de seguridad de intentos. Espera unos minutos e inténtalo de nuevo — tu cuenta está segura.",
  },
  INVALID_VERIFICATION_CODE: {
    en: "Unable to authenticate that code, try again.",
    es: "No pudimos autenticar ese código, inténtalo de nuevo.",
  },
  MFA_ALREADY_ENROLLED: {
    en: "Two-factor authentication is already set up on your account.",
    es: "La autenticación de dos factores ya está configurada en tu cuenta.",
  },
  MFA_UNSUPPORTED_FACTOR: {
    en: "Your account has a security factor we can't use right now. Contact support for help.",
    es: "Tu cuenta tiene un factor de seguridad que no podemos usar ahora. Contacta con soporte para obtener ayuda.",
  },
  TOO_MANY_REQUESTS: {
    en: "We've hit our safety limit for attempts. Give it a few minutes, then try again — your account is safe.",
    es: "Alcanzamos nuestro límite de seguridad de intentos. Espera unos minutos e inténtalo de nuevo — tu cuenta está segura.",
  },
  USER_ALREADY_EXISTS: {
    en: "Looks like you already have an account with us! Switch to the Sign In tab and you'll be right in.",
    es: "¡Parece que ya tienes una cuenta con nosotros! Cambia a la pestaña Entrar y estarás dentro.",
  },
  EMAIL_SEND_FAILED: {
    en: "Your account is all set! We're having a little trouble sending the verification email right now. Try signing in and tapping 'Resend' — it usually clears up fast.",
    es: "¡Tu cuenta está lista! Estamos teniendo problemas para enviar el correo de verificación. Intenta entrar y toca 'Reenviar' — normalmente se resuelve rápido.",
  },
  INVALID_TOKEN: {
    en: "That reset link has expired (they're good for 15 minutes for safety). No worries — request a fresh one and we'll get you sorted.",
    es: "Ese enlace de recuperación expiró (son válidos por 15 minutos por seguridad). No te preocupes — pide uno nuevo y te ayudamos.",
  },
  EXPIRED_TOKEN: {
    en: "That reset link has expired (they're good for 15 minutes for safety). No worries — request a fresh one and we'll get you sorted.",
    es: "Ese enlace de recuperación expiró (son válidos por 15 minutos por seguridad). No te preocupes — pide uno nuevo y te ayudamos.",
  },
  ATTEMPTS_EXCEEDED: {
    en: "That reset link has already been used. Request a fresh one and you'll be right back in.",
    es: "Ese enlace de recuperación ya fue usado. Pide uno nuevo y estarás de vuelta en un momento.",
  },
  NETWORK_ERROR: {
    en: "We're having trouble reaching our servers. Check your connection and try again?",
    es: "Tenemos problemas para conectarnos a nuestros servidores. ¿Revisas tu conexión e intentas de nuevo?",
  },
  UNKNOWN: {
    en: "Something unexpected happened. Give it another try — it usually sorts itself out.",
    es: "Algo inesperado ocurrió. Inténtalo de nuevo — normalmente se resuelve solo.",
  },
};

const FIREBASE_ERROR_CODE_MAP: Record<string, string> = {
  "auth/invalid-credential": "INVALID_PASSWORD",
  "auth/invalid-login-credentials": "INVALID_PASSWORD",
  "auth/user-not-found": "USER_NOT_FOUND",
  "auth/wrong-password": "INVALID_PASSWORD",
  "auth/invalid-email": "INVALID_EMAIL_OR_PASSWORD",
  "auth/user-disabled": "USER_DISABLED",
  "auth/too-many-requests": "TOO_MANY_REQUESTS",
  "auth/email-already-in-use": "USER_ALREADY_EXISTS",
  "auth/requires-recent-login": "REQUIRES_RECENT_LOGIN",
  "auth/invalid-verification-code": "INVALID_VERIFICATION_CODE",
  "auth/invalid-verification-id": "INVALID_VERIFICATION_CODE",
  "auth/multi-factor-auth-required": "MFA_REQUIRED",
  "auth/second-factor-already-in-use": "MFA_ALREADY_ENROLLED",
  "auth/unsupported-first-factor": "MFA_UNSUPPORTED_FACTOR",
  "auth/missing-password": "INVALID_PASSWORD",
};

function getAuthErrorMessage(code: string, language: string): string | undefined {
  return AUTH_ERROR_MAP[code]?.[language as 'en' | 'es'] ?? AUTH_ERROR_MAP[code]?.en;
}

function mapAuthError(message: string, code: string, language: string = "en"): { message: string; code: string } {
  const firebaseMappedCode = FIREBASE_ERROR_CODE_MAP[code];
  if (firebaseMappedCode) {
    if (firebaseMappedCode === "USER_DISABLED") {
      return {
        message: language === "es"
          ? "Esta cuenta está deshabilitada. Contacta con soporte para obtener ayuda."
          : "This account is disabled. Contact support for help.",
        code: firebaseMappedCode,
      };
    }
    if (firebaseMappedCode === "REQUIRES_RECENT_LOGIN") {
      return {
        message: language === "es"
          ? "Por seguridad, vuelve a iniciar sesión antes de hacer este cambio."
          : "For security, sign in again before making this change.",
        code: firebaseMappedCode,
      };
    }
    return {
      message: getAuthErrorMessage(firebaseMappedCode, language) || message,
      code: firebaseMappedCode,
    };
  }
  if (code && AUTH_ERROR_MAP[code]) {
    return { message: getAuthErrorMessage(code, language) || AUTH_ERROR_MAP[code].en, code };
  }

  const lowerMsg = message.toLowerCase();
  if (lowerMsg.includes("invalid email or password") || lowerMsg.includes("invalid credentials")) {
    return { message: getAuthErrorMessage("INVALID_PASSWORD", language)!, code: "INVALID_PASSWORD" };
  }
  if (lowerMsg.includes("email") && (lowerMsg.includes("not verified") || lowerMsg.includes("verification"))) {
    return { message: getAuthErrorMessage("EMAIL_NOT_VERIFIED", language)!, code: "EMAIL_NOT_VERIFIED" };
  }
  if (lowerMsg.includes("too many") || lowerMsg.includes("rate limit")) {
    return { message: getAuthErrorMessage("RATE_LIMIT_EXCEEDED", language)!, code: "RATE_LIMIT_EXCEEDED" };
  }
  if (lowerMsg.includes("invalid-verification-code") || lowerMsg.includes("invalid verification code") || lowerMsg.includes("invalid code")) {
    return { message: getAuthErrorMessage("INVALID_VERIFICATION_CODE", language)!, code: "INVALID_VERIFICATION_CODE" };
  }
  if (lowerMsg.includes("already exists") || lowerMsg.includes("duplicate")) {
    return { message: getAuthErrorMessage("USER_ALREADY_EXISTS", language)!, code: "USER_ALREADY_EXISTS" };
  }
  if (lowerMsg.includes("password change required") || lowerMsg.includes("force password")) {
    return { message: getAuthErrorMessage("FORCE_PASSWORD_CHANGE", language)!, code: "FORCE_PASSWORD_CHANGE" };
  }
  if (lowerMsg.includes("two-factor") || lowerMsg.includes("mfa")) {
    return { message: getAuthErrorMessage("MFA_REQUIRED", language)!, code: "MFA_REQUIRED" };
  }
  if (lowerMsg.includes("couldn't send") || lowerMsg.includes("verification email") && lowerMsg.includes("fail")) {
    return { message: getAuthErrorMessage("EMAIL_SEND_FAILED", language)!, code: "EMAIL_SEND_FAILED" };
  }
  if (lowerMsg.includes("failed to fetch") || lowerMsg.includes("networkerror") || lowerMsg.includes("network")) {
    return { message: getAuthErrorMessage("NETWORK_ERROR", language)!, code: "NETWORK_ERROR" };
  }

  return { message: message || getAuthErrorMessage("UNKNOWN", language)!, code: code || "UNKNOWN" };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [skipAuthRedirect, setSkipAuthRedirect] = useState(false);
  const [mfaChallengeId, setMfaChallengeId] = useState<string | null>(null);
  const userRef = useRef<AuthUser | null>(null);

  useEffect(() => {
    userRef.current = user;
  }, [user]);

  const apiFetch = useCallback(async (path: string, options?: RequestInit) => {
    const baseUrl = getApiUrl();
    const url = new URL(path, baseUrl).toString();
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...getAuthHeaders(),
      ...(options?.headers as Record<string, string>),
    };
    const res = await globalThis.fetch(url, {
      ...options,
      headers,
      credentials: "include",
    });

    if (res.status === 401 && path !== "/api/auth/me" && userRef.current) {
      setSessionExpiredMsg("Your session has expired, please sign in again.");
      await clearSession();
    }
    return res;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  const [sessionExpiredMsg, setSessionExpiredMsg] = useState<string | null>(null);

  const clearSession = useCallback(async () => {
    setUser(null);
    await SecureStore.setSessionToken(null);
    if (isFirebaseClientConfigured()) {
      try {
        await signOutFirebase();
      } catch {}
    }
  }, []);

  const clearSessionExpiredMessage = useCallback(() => {
    setSessionExpiredMsg(null);
  }, []);

  useEffect(() => {
    const unsubscribe = onSessionExpired(() => {
      if (userRef.current) {
        setSessionExpiredMsg("Your session has expired, please sign in again.");
        clearSession();
      }
    });
    return unsubscribe;
  }, [clearSession]);

  useEffect(() => {
    const restoreAndCheck = async () => {
      if (isFirebaseClientConfigured()) return;
      const stored = await SecureStore.getSessionToken();
      if (!stored) {
        setIsLoading(false);
        return;
      }
      await checkAuth();
    };
    restoreAndCheck();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!isFirebaseClientConfigured()) return;
    let active = true;
    const unsubscribe = subscribeToFirebaseTokens(async (session) => {
      if (!active) return;
      if (!session) {
        await SecureStore.setSessionToken(null);
        setUser(null);
        setIsLoading(false);
        return;
      }
      await SecureStore.setSessionToken(session.idToken);
      await checkAuth();
    });
    return () => {
      active = false;
      unsubscribe();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const handleAppStateChange = (nextState: AppStateStatus) => {
      if (appStateRef.current.match(/inactive|background/) && nextState === "active" && user) {
        if (user.sessionExpiresAt) {
          const expiresMs = new Date(user.sessionExpiresAt).getTime();
          if (Date.now() >= expiresMs) {
            setSessionExpiredMsg("Your session has expired, please sign in again.");
            clearSession();
            appStateRef.current = nextState;
            return;
          }
        }
        refreshUser();
      }
      appStateRef.current = nextState;
    };
    const sub = AppState.addEventListener("change", handleAppStateChange);
    return () => sub.remove();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  useEffect(() => {
    if (!user?.sessionExpiresAt) return;
    const expiresMs = new Date(user.sessionExpiresAt).getTime();
    const msUntilExpiry = expiresMs - Date.now();
    if (msUntilExpiry <= 0) {
      setSessionExpiredMsg("Your session has expired, please sign in again.");
      clearSession();
      return;
    }
    const refreshBuffer = 60_000;
    const msUntilRefresh = msUntilExpiry - refreshBuffer;
    if (msUntilRefresh > 0) {
      const timer = setTimeout(() => {
        refreshUser();
      }, msUntilRefresh);
      return () => clearTimeout(timer);
    } else {
      refreshUser();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.sessionExpiresAt]);

  const updateNativeTokenFromResponse = async (res: Response) => {
    try {
      const setCookie = res.headers.get("set-cookie");
      if (setCookie) {
        const match = setCookie.match(/(?:__Secure-)?better-auth\.session_token=([^;]+)/);
        if (match) {
          await SecureStore.setSessionToken(match[1]);
        }
      }
    } catch (e) {
      console.error("Failed to parse session token from headers:", e);
    }
  };

  const checkAuth = async () => {
    try {
      const res = await apiFetch("/api/auth/me");
      if (res.ok) {
        const data = await res.json();
        setUser(data);
      } else if (res.status === 401) {
        await clearSession();
      }
    } catch {
      await clearSession();
    } finally {
      setIsLoading(false);
    }
  };

  const refreshUser = async () => {
    try {
      if (isFirebaseClientConfigured()) {
        const session = await reloadFirebaseSession();
        if (session) await SecureStore.setSessionToken(session.idToken);
      }
      const res = await apiFetch("/api/auth/me");
      if (res.ok) {
        const data = await res.json();
        setUser(data);
        return data;
      } else if (res.status === 401) {
        setSessionExpiredMsg("Your session has expired, please sign in again.");
        await clearSession();
      }
    } catch (err) {
      console.warn("Session refresh failed:", err instanceof Error ? err.message : String(err));
      await clearSession();
    }
    return null;
  };

  const login = async (email: string, password: string) => {
    const cleanEmail = email.trim().toLowerCase();

    if (isFirebaseClientConfigured()) {
      try {
        const result = await signInFirebaseWithPassword(cleanEmail, password);
        if (result.status === "mfa_required") {
          setMfaChallengeId(result.challengeId);
          throw new AuthError(
            getCurrentLanguage() === "es"
              ? "Abre tu app de autenticación e ingresa el código de 6 dígitos."
              : "Open your authenticator app and enter the 6-digit code.",
            "MFA_CHALLENGE_REQUIRED",
          );
        }
        await SecureStore.setSessionToken(result.session.idToken);
        const meData = await loadAndValidateCurrentUser();
        return meData;
      } catch (error: unknown) {
        if (error instanceof AuthError) throw error;
        const code = typeof error === "object" && error !== null && "code" in error
          ? String((error as { code?: unknown }).code)
          : "";
        // Legacy-mode auth: the user exists in the app DB but not in Firebase
        // Auth (dual-auth cutover pending). Fall through to the legacy
        // /api/auth/sign-in/email path below instead of failing login with
        // auth/invalid-credential.
        if (code === "auth/invalid-credential" || code === "auth/user-not-found" || code === "auth/wrong-password") {
          // fall through to legacy sign-in
        } else {
          const message = error instanceof Error ? error.message : "Login failed";
          const mapped = mapAuthError(message, code, getCurrentLanguage());
          throw new AuthError(mapped.message, mapped.code);
        }
      }
    }

    let res;
    try {
      res = await apiFetch("/api/auth/sign-in/email", {
        method: "POST",
        body: JSON.stringify({ email: cleanEmail, password }),
      });
    } catch (transportErr: any) {
      const mapped = mapAuthError(transportErr.message || "Network error", "");
      throw new AuthError(mapped.message, mapped.code);
    }

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const errorObj = data.error || data;
      const mapped = mapAuthError(errorObj.message || errorObj.error || "Login failed", errorObj.code || "");
      throw new AuthError(mapped.message, mapped.code);
    }

    await updateNativeTokenFromResponse(res);
    const token = data.token || data.session?.token;
    if (token) {
      await SecureStore.setSessionToken(token);
    }

    return loadAndValidateCurrentUser();
  };

  const loadAndValidateCurrentUser = async () => {
    const meRes = await apiFetch("/api/auth/me");
    let meData = null;
    if (meRes.ok) {
      meData = await meRes.json();
      setUser(meData);
      if (meData.forcePasswordChange) {
        throw new AuthError(getAuthErrorMessage("FORCE_PASSWORD_CHANGE", getCurrentLanguage())!, "FORCE_PASSWORD_CHANGE");
      }
      if (!meData.emailVerified) {
        throw new AuthError(getAuthErrorMessage("EMAIL_NOT_VERIFIED", getCurrentLanguage())!, "EMAIL_NOT_VERIFIED");
      }
      // 2FA enrollment gate removed (2026-08-13): mfaRequired is always false
      // server-side while TOTP is disabled, so no MFA_REQUIRED throw here.
    } else if (meRes.status === 401) {
      setSessionExpiredMsg("Your session has expired, please sign in again.");
      await clearSession();
    } else if (meRes.status === 403) {
      const errData = await meRes.json().catch(() => ({}));
      if (errData.code) {
        const mapped = mapAuthError(errData.error || errData.message || "", errData.code);
        throw new AuthError(mapped.message, mapped.code);
      }
    }
    return meData;
  };

  const completeMfaSignIn = async (code: string) => {
    if (!mfaChallengeId) throw new AuthError("Start sign-in again.", "MFA_CHALLENGE_EXPIRED");
    try {
      const session = await completeFirebaseTotpSignIn(mfaChallengeId, code.trim());
      setMfaChallengeId(null);
      await SecureStore.setSessionToken(session.idToken);
      return loadAndValidateCurrentUser();
    } catch (error: unknown) {
      const errorCode = typeof error === "object" && error !== null && "code" in error
        ? String((error as { code?: unknown }).code)
        : "";
      const mapped = mapAuthError(
        error instanceof Error ? error.message : "Invalid verification code.",
        errorCode,
        getCurrentLanguage(),
      );
      throw new AuthError(mapped.message, mapped.code);
    }
  };

  const cancelMfaSignIn = () => {
    if (mfaChallengeId) cancelFirebaseMfaChallenge(mfaChallengeId);
    setMfaChallengeId(null);
  };

  const register = async (firstName: string, email: string, password: string, turnstileToken?: string) => {
    const cleanEmail = email.trim().toLowerCase();
    const clientPlatform = Platform.OS === "web" ? "web" : "native";

    let res;
    try {
      res = await apiFetch("/api/auth/sign-up/email", {
        method: "POST",
        body: JSON.stringify({
          email: cleanEmail,
          password,
          name: firstName.trim(),
          clientPlatform,
          ...(turnstileToken ? { turnstileToken } : {}),
        }),
      });
    } catch (transportErr: any) {
      const mapped = mapAuthError(transportErr.message || "Network error", "");
      throw new AuthError(mapped.message, mapped.code);
    }

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const errorObj = data.error || data;
      const mapped = mapAuthError(errorObj.message || errorObj.error || "Registration failed", errorObj.code || "");
      throw new AuthError(mapped.message, mapped.code);
    }

    if (isFirebaseClientConfigured()) {
      try {
        const firebaseResult = await signInFirebaseWithPassword(cleanEmail, password);
        if (firebaseResult.status !== "signed_in") {
          throw new AuthError("Complete MFA sign-in before continuing.", "MFA_CHALLENGE_REQUIRED");
        }
        await SecureStore.setSessionToken(firebaseResult.session.idToken);
        try {
          const verifyRes = await apiFetch("/api/auth/send-verification-email", {
            method: "POST",
            body: JSON.stringify({}),
          });
          if (!verifyRes.ok) {
            const verifyData = await verifyRes.json().catch(() => ({}));
            return {
              status: "verification_email_failed",
              email: cleanEmail,
              message: verifyData.error || "We couldn't send the verification email right now.",
            };
          }
        } catch {
          return {
            status: "verification_email_failed",
            email: cleanEmail,
            message: "We couldn't send the verification email right now.",
          };
        }
        setUser(null);
        return { status: "verification_required", email: cleanEmail };
      } catch (error: unknown) {
        const code = typeof error === "object" && error !== null && "code" in error
          ? String((error as { code?: unknown }).code)
          : "";
        // Legacy-mode sign-up: the server created the account in its own DB
        // (bcrypt) and returned a legacy session token in the response, but the
        // user does not exist in Firebase Auth yet (dual-auth cutover pending).
        // Fall through to the legacy session path below instead of failing
        // registration with auth/invalid-credential.
        if (code !== "auth/invalid-credential" && code !== "auth/user-not-found" && code !== "auth/wrong-password") {
          throw error instanceof AuthError
            ? error
            : new AuthError(error instanceof Error ? error.message : "Registration failed", code || "REGISTRATION_FAILED");
        }
      }
    }

    await updateNativeTokenFromResponse(res);
    const token = data.token || data.session?.token;
    if (token) {
      await SecureStore.setSessionToken(token);
    }

    try {
      const meRes = await apiFetch("/api/auth/me");
      if (meRes.ok) {
        const meData = await meRes.json();
        setUser(meData);
        if (!meData.emailVerified) {
          // Account created but email not verified yet. Sign out so the login
          // screen stays mounted and can show the verification prompt
          // (mirrors the Firebase path, which returns with user null).
          setUser(null);
          return { status: "verification_required", email: cleanEmail };
        }
        return meData;
      }
      if (meRes.status === 401) {
        const resendRes = await apiFetch("/api/auth/resend-verification", {
          method: "POST",
          body: JSON.stringify({ email: cleanEmail }),
        });
        if (!resendRes.ok) {
          const data = await resendRes.json().catch(() => ({}));
          return {
            status: "verification_email_failed",
            email: cleanEmail,
            message: data.error || "We couldn't send the verification email right now. Please try again in a few minutes.",
          };
        }
        return { status: "verification_required", email: cleanEmail };
      }
    } catch (err) {
      console.warn("Auth check after registration failed:", err instanceof Error ? err.message : String(err));
    }

    return { status: "verification_required", email: cleanEmail };
  };

  const requestMagicLink = async (email: string) => {
    throw new Error("Magic links are not supported in this client.");
  };

  const completeMagicLink = async (token: string) => {
    throw new Error("Magic links are not supported in this client.");
  };

  const signInSocial = async (provider: "google" | "github") => {
    throw new Error("Social sign-in is not supported in this client.");
  };

  const signInPasskey = async () => {
    throw new Error("Passkeys are not supported in this client.");
  };

  const changeEmail = async (newEmail: string, password: string) => {
    const cleanEmail = newEmail.trim().toLowerCase();
    if (isFirebaseClientConfigured()) {
      await reauthenticateFirebasePassword(password);
      const token = await getFirebaseIdToken(true);
      if (token) await SecureStore.setSessionToken(token);
      const response = await apiFetch("/api/auth/request-email-change", {
        method: "POST",
        body: JSON.stringify({ newEmail: cleanEmail }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || "Failed to send the email-change verification link.");
      }
      return;
    }
    const res = await apiFetch("/api/auth/change-email", {
      method: "POST",
      body: JSON.stringify({ newEmail: cleanEmail, password }),
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || "Failed to change email");
    }

    setUser((prev) => prev ? { ...prev, email: data.email, emailVerified: data.emailVerified ?? false } : null);
  };

  const changeName = async (firstName: string) => {
    const res = await apiFetch("/api/auth/change-name", {
      method: "POST",
      body: JSON.stringify({ firstName }),
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || "Failed to change name");
    }

    setUser((prev) => prev ? { ...prev, firstName: data.firstName } : null);
  };

  const changeCountry = async (country: string) => {
    const res = await apiFetch("/api/auth/change-country", {
      method: "POST",
      body: JSON.stringify({ country }),
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || "Failed to change country");
    }

    setUser((prev) => prev ? { ...prev, country: data.country } : null);
  };

  const changeJobType = async (jobType: string) => {
    const res = await apiFetch("/api/auth/change-job-type", {
      method: "POST",
      body: JSON.stringify({ jobType }),
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || "Failed to change job type");
    }

    setUser((prev) => prev ? { ...prev, jobType: data.jobType } : null);
  };

  const changeAvatar = async (avatarId: string) => {
    const res = await apiFetch("/api/auth/change-avatar", {
      method: "POST",
      body: JSON.stringify({ avatarId }),
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || "Failed to change avatar");
    }

    setUser((prev) => prev ? { ...prev, avatarId: data.avatarId } : null);
  };

  const changePassword = async (currentPassword: string, newPassword: string) => {
    if (isFirebaseClientConfigured()) {
      await reauthenticateFirebasePassword(currentPassword);
      await updateFirebasePassword(newPassword);
      const token = await getFirebaseIdToken(true);
      if (token) await SecureStore.setSessionToken(token);
    }
    const res = await apiFetch("/api/auth/change-password", {
      method: "POST",
      body: JSON.stringify(
        isFirebaseClientConfigured() ? {} : { currentPassword, newPassword },
      ),
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || "Failed to change password");
    }
  };

  const logout = async () => {
    try {
      await apiFetch("/api/auth/sign-out", {
        method: "POST",
        body: JSON.stringify({}),
      });
    } catch {}
    if (isFirebaseClientConfigured()) {
      try {
        await signOutFirebase();
      } catch {}
    }
    setMfaChallengeId(null);
    await SecureStore.setSessionToken(null);
    try {
      const allKeys = await AsyncStorage.getAllKeys();
      const draftKeys = allKeys.filter(k => k.startsWith("@voicenote_draft_"));
      if (draftKeys.length > 0) await AsyncStorage.removeMany(draftKeys);
    } catch {}
    setUser(null);
  };

  const deleteAccount = async (password: string) => {
    if (isFirebaseClientConfigured()) {
      await reauthenticateFirebasePassword(password);
      const token = await getFirebaseIdToken(true);
      if (token) await SecureStore.setSessionToken(token);
    }
    const response = await apiFetch("/api/account", {
      method: "DELETE",
      body: JSON.stringify(
        isFirebaseClientConfigured() ? {} : { password },
      ),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || "We couldn't delete your account right now.");
    }
    await logout();
  };

  return (
    <AuthContext.Provider value={{ user, isLoading, skipAuthRedirect, setSkipAuthRedirect, sessionExpiredMessage: sessionExpiredMsg, clearSessionExpiredMessage, login, requestMagicLink, completeMagicLink, register, logout, refreshUser, changeEmail, changeName, changeCountry, changeJobType, changeAvatar, changePassword, signInSocial, signInPasskey, mfaChallengePending: Boolean(mfaChallengeId), completeMfaSignIn, cancelMfaSignIn, deleteAccount }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
