import { getApps } from "@react-native-firebase/app";
import {
  EmailAuthProvider,
  TotpMultiFactorGenerator,
  applyActionCode,
  checkActionCode,
  confirmPasswordReset,
  getAuth,
  getIdToken,
  getMultiFactorResolver,
  multiFactor,
  onIdTokenChanged,
  reauthenticateWithCredential,
  reload,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithCustomToken,
  signInWithEmailAndPassword,
  signOut,
  updatePassword,
  verifyBeforeUpdateEmail,
  verifyPasswordResetCode,
  type MultiFactorResolver,
  type TotpSecret,
} from "@react-native-firebase/auth";

import type {
  FirebaseClientSession,
  FirebasePasswordSignInResult,
  FirebaseTotpEnrollment,
  FirebaseTokenListener,
} from "./firebase-auth-client.types";
import { getAuthenticatorDisplayName, getAuthenticatorQrLabel } from "./auth-env-label";

const pendingMfaResolvers = new Map<string, MultiFactorResolver>();
let pendingTotpSecret: TotpSecret | null = null;

function requireNativeAuth() {
  if (getApps().length === 0) {
    throw new Error(
      "Firebase is not configured for this Android build. The environment-specific google-services.json is required.",
    );
  }
  return getAuth();
}

async function toSession(user: ReturnType<typeof getAuth>["currentUser"]): Promise<FirebaseClientSession | null> {
  if (!user) return null;
  const idToken = await getIdToken(user);
  return {
    identity: {
      uid: user.uid,
      email: user.email || "",
      emailVerified: user.emailVerified,
      displayName: user.displayName,
    },
    idToken,
  };
}

export function isFirebaseClientConfigured(): boolean {
  return getApps().length > 0;
}

export async function signInFirebaseWithPassword(
  email: string,
  password: string,
): Promise<FirebasePasswordSignInResult> {
  const auth = requireNativeAuth();
  try {
    const credential = await signInWithEmailAndPassword(auth, email, password);
    return { status: "signed_in", session: (await toSession(credential.user))! };
  } catch (error: unknown) {
    const code = typeof error === "object" && error !== null && "code" in error
      ? String((error as { code?: unknown }).code)
      : "";
    if (code !== "auth/multi-factor-auth-required") throw error;

    const resolver = getMultiFactorResolver(auth, error as Parameters<typeof getMultiFactorResolver>[1]);
    const challengeId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    pendingMfaResolvers.set(challengeId, resolver);
    return {
      status: "mfa_required",
      challengeId,
      hints: resolver.hints.map((hint) => ({
        uid: hint.uid,
        displayName: hint.displayName || null,
        factorId: hint.factorId,
      })),
    };
  }
}

export async function signInFirebaseWithCustomToken(
  customToken: string,
): Promise<FirebaseClientSession> {
  const credential = await signInWithCustomToken(requireNativeAuth(), customToken);
  return (await toSession(credential.user))!;
}

export async function getFirebaseIdToken(forceRefresh = false): Promise<string | null> {
  const user = requireNativeAuth().currentUser;
  return user ? getIdToken(user, forceRefresh) : null;
}

export async function sendCurrentUserVerificationEmail(): Promise<void> {
  const user = requireNativeAuth().currentUser;
  if (!user) throw new Error("No Firebase user is signed in.");
  await sendEmailVerification(user);
}

export async function sendFirebasePasswordReset(email: string): Promise<void> {
  await sendPasswordResetEmail(requireNativeAuth(), email);
}

export async function verifyFirebasePasswordResetCode(oobCode: string): Promise<string> {
  return verifyPasswordResetCode(requireNativeAuth(), oobCode);
}

export async function confirmFirebasePasswordReset(
  oobCode: string,
  newPassword: string,
): Promise<void> {
  await confirmPasswordReset(requireNativeAuth(), oobCode, newPassword);
}

export async function applyFirebaseEmailActionCode(oobCode: string): Promise<void> {
  const auth = requireNativeAuth();
  await checkActionCode(auth, oobCode);
  await applyActionCode(auth, oobCode);
  if (auth.currentUser) {
    await reload(auth.currentUser);
    await getIdToken(auth.currentUser, true);
  }
}

export async function reauthenticateFirebasePassword(password: string): Promise<void> {
  const auth = requireNativeAuth();
  const user = auth.currentUser;
  if (!user?.email) throw new Error("No password-based Firebase user is signed in.");
  await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, password));
}

export async function updateFirebasePassword(newPassword: string): Promise<void> {
  const user = requireNativeAuth().currentUser;
  if (!user) throw new Error("No Firebase user is signed in.");
  await updatePassword(user, newPassword);
  await getIdToken(user, true);
}

export async function requestFirebaseEmailChange(newEmail: string): Promise<void> {
  const user = requireNativeAuth().currentUser;
  if (!user) throw new Error("No Firebase user is signed in.");
  await verifyBeforeUpdateEmail(user, newEmail);
}

export async function reloadFirebaseSession(): Promise<FirebaseClientSession | null> {
  const user = requireNativeAuth().currentUser;
  if (!user) return null;
  await reload(user);
  return toSession(user);
}

export async function completeFirebaseTotpSignIn(
  challengeId: string,
  verificationCode: string,
): Promise<FirebaseClientSession> {
  const resolver = pendingMfaResolvers.get(challengeId);
  if (!resolver) throw new Error("The MFA challenge has expired. Please sign in again.");
  const hint = resolver.hints.find((candidate) => candidate.factorId === TotpMultiFactorGenerator.FACTOR_ID);
  if (!hint) throw new Error("This account does not have a supported TOTP factor.");
  const assertion = TotpMultiFactorGenerator.assertionForSignIn(hint.uid, verificationCode);
  const credential = await resolver.resolveSignIn(assertion);
  pendingMfaResolvers.delete(challengeId);
  return (await toSession(credential.user))!;
}

export function cancelFirebaseMfaChallenge(challengeId: string): void {
  pendingMfaResolvers.delete(challengeId);
}

export async function beginFirebaseTotpEnrollment(): Promise<FirebaseTotpEnrollment> {
  const auth = requireNativeAuth();
  const user = auth.currentUser;
  if (!user?.email) throw new Error("Sign in and verify your email before enrolling MFA.");
  await reload(user);
  if (!user.emailVerified) throw new Error("Verify your email before enrolling MFA.");
  const session = await multiFactor(user).getSession();
  pendingTotpSecret = await TotpMultiFactorGenerator.generateSecret(session, auth);
  return {
    secretKey: pendingTotpSecret.secretKey,
    qrCodeUrl: pendingTotpSecret.generateQrCodeUrl(user.email, getAuthenticatorQrLabel()),
  };
}

export async function completeFirebaseTotpEnrollment(
  verificationCode: string,
): Promise<void> {
  const user = requireNativeAuth().currentUser;
  if (!user || !pendingTotpSecret) throw new Error("Start MFA enrollment again.");
  const assertion = TotpMultiFactorGenerator.assertionForEnrollment(
    pendingTotpSecret,
    verificationCode,
  );
  await multiFactor(user).enroll(assertion, getAuthenticatorDisplayName());
  pendingTotpSecret = null;
  await getIdToken(user, true);
}

export async function signOutFirebase(): Promise<void> {
  pendingMfaResolvers.clear();
  pendingTotpSecret = null;
  await signOut(requireNativeAuth());
}

export function subscribeToFirebaseTokens(listener: FirebaseTokenListener): () => void {
  if (!isFirebaseClientConfigured()) {
    void listener(null);
    return () => {};
  }
  return onIdTokenChanged(requireNativeAuth(), (user) => {
    if (user) {
      void toSession(user).then(listener).catch(() => listener(null));
      return;
    }
    // user is null. This can be a GENUINE sign-out OR the cold-start race:
    // on Android, onIdTokenChanged can fire with null BEFORE the native
    // Firebase auth finishes restoring the persisted session after an app
    // kill — the listener in auth-context would then wipe the saved token
    // and log the user out (bug: "closing the app logs me out"). Poll
    // currentUser over a settle window; only report null if the user is
    // truly gone (real sign-out / expired session) after the window.
    const auth = requireNativeAuth();
    const startedAt = Date.now();
    const MAX_SETTLE_MS = 2000;
    const POLL_MS = 250;
    const poll = () => {
      const restored = auth.currentUser;
      if (restored) {
        void toSession(restored).then(listener).catch(() => listener(null));
        return;
      }
      if (Date.now() - startedAt >= MAX_SETTLE_MS) {
        void listener(null);
        return;
      }
      setTimeout(poll, POLL_MS);
    };
    setTimeout(poll, POLL_MS);
  });
}
