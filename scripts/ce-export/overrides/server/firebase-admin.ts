import { getApps, initializeApp, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { Request, Response, NextFunction } from "express";
import { storage } from "./storage";
import * as fs from "fs";

let serviceAccount: any = null;
const credPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH || process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (credPath && fs.existsSync(credPath)) {
  try {
    serviceAccount = JSON.parse(fs.readFileSync(credPath, "utf8"));
  } catch (err) {
    console.error("Failed to parse Firebase service account JSON from path:", credPath, err);
  }
}

export const hasFirebaseCreds = !!(
  serviceAccount ||
  (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY)
);

const isGcpEnvironment = !!(
  process.env.K_SERVICE ||
  process.env.GOOGLE_APPLICATION_CREDENTIALS ||
  process.env.NODE_ENV === "production"
);

export const useFirebase = (hasFirebaseCreds || isGcpEnvironment) && 
  (process.env.NODE_ENV === "production" || process.env.USE_FIREBASE_IN_DEV === "true");

export type FirebaseAuthMode = "legacy" | "dual" | "firebase";

export function parseFirebaseAuthMode(value: string | undefined): FirebaseAuthMode {
  const normalized = String(value || "legacy").trim().toLowerCase();
  if (normalized === "legacy" || normalized === "dual" || normalized === "firebase") {
    return normalized;
  }
  throw new Error(`Invalid FIREBASE_AUTH_MODE: ${normalized}`);
}

export const firebaseAuthMode = parseFirebaseAuthMode(process.env.FIREBASE_AUTH_MODE);

if (useFirebase) {
  if (!getApps().length) {
    if (hasFirebaseCreds) {
      const cred = serviceAccount
        ? cert(serviceAccount)
        : cert({
            projectId: process.env.FIREBASE_PROJECT_ID,
            clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
            privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
          });
      initializeApp({
        credential: cred,
      });
    } else {
      initializeApp();
    }
    console.log("Firebase Admin SDK initialized successfully.");
  }
} else {
  console.warn("WARNING: Firebase credentials are not set. Running in DEVELOPMENT mode with dummy token authentication.");
}

// Export auth matching Firebase Admin SDK's Auth interface.
// In production, Firebase MUST be configured — crash if it isn't.
// The mock fallback is for local development ONLY.
export const auth = useFirebase
  ? getAuth()
  : (() => {
      if (process.env.NODE_ENV === "production") {
        throw new Error(
          "FATAL: Firebase Admin SDK is not configured in production. " +
          "Set FIREBASE_SERVICE_ACCOUNT_PATH or FIREBASE_PROJECT_ID/FIREBASE_CLIENT_EMAIL/FIREBASE_PRIVATE_KEY. " +
          "Mock auth must never be used in production — it creates mock-uid-* user IDs that orphan data."
        );
      }
      return {
        createUser: async (properties: { email: string; emailVerified?: boolean; displayName?: string }) => {
          return {
            uid: `mock-uid-${properties.email.split("@")[0]}`,
            email: properties.email,
            displayName: properties.displayName,
          };
        },
        generatePasswordResetLink: async (email: string, actionCodeSettings?: any) => {
          return `http://localhost:5000/mock-reset-password?email=${encodeURIComponent(email)}`;
        },
        createCustomToken: async (uid: string) => {
          return `mock-custom-token-for-${uid}`;
        },
        deleteUser: async (uid: string) => {
          return;
        },
      } as unknown as ReturnType<typeof getAuth>;
    })();

type VerifiedIdentity = {
  uid: string;
  email: string;
  name?: string;
  emailVerified: boolean;
  authTime: number | null;
  secondFactorId: string | null;
  source: "firebase" | "legacy" | "development";
};

async function verifyLegacySessionToken(token: string): Promise<VerifiedIdentity | null> {
  try {
    const session = await storage.sessions.getByToken(token);
    if (session) {
      const expiresAt = new Date(session.expiresAt);
      if (expiresAt > new Date()) {
        const user = await storage.users.get(session.userId);
        if (user) {
          return {
            uid: user.id,
            email: user.email,
            name: user.name,
            emailVerified: user.emailVerified === 1,
            authTime: null,
            secondFactorId: null,
            source: "legacy",
          };
        }
      } else {
        storage.sessions.delete(session.id).catch(() => {});
      }
    }
  } catch (err) {
    console.error("Failed to check database session token:", err);
  }
  return null;
}

async function verifyAuthoritativeFirebaseToken(token: string): Promise<VerifiedIdentity> {
  const decoded = await auth.verifyIdToken(token, true);
  return {
    uid: decoded.uid,
    email: decoded.email || "",
    name: decoded.name,
    emailVerified: decoded.email_verified === true,
    authTime: typeof decoded.auth_time === "number" ? decoded.auth_time : null,
    secondFactorId: decoded.firebase?.sign_in_second_factor || null,
    source: "firebase",
  };
}

export async function verifyFirebaseIdToken(token: string): Promise<VerifiedIdentity> {
  if (useFirebase && firebaseAuthMode !== "legacy") {
    try {
      return await verifyAuthoritativeFirebaseToken(token);
    } catch (error) {
      if (firebaseAuthMode === "firebase") throw error;
    }
  }

  if (firebaseAuthMode !== "firebase") {
    const legacyIdentity = await verifyLegacySessionToken(token);
    if (legacyIdentity) return legacyIdentity;
  }

  if (!useFirebase) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "FATAL: Firebase token verification attempted in production without Firebase configured. " +
        "Mock auth must never be used in production."
      );
    }
    if (token.startsWith("mock-custom-token-for-")) {
      const uid = token.replace("mock-custom-token-for-", "");
      const user = await storage.users.get(uid);
      return {
        uid,
        email: user?.email || `${uid.replace("mock-uid-", "")}@proset.ai`,
        name: user?.name || uid.replace("mock-uid-", ""),
        emailVerified: user?.emailVerified === 1,
        authTime: null,
        secondFactorId: null,
        source: "development",
      };
    }
    if (token.includes("@")) {
      return {
        uid: `mock-uid-${token.split("@")[0]}`,
        email: token,
        name: token.split("@")[0],
        emailVerified: true,
        authTime: null,
        secondFactorId: null,
        source: "development",
      };
    }
    return {
      uid: "mock-uid-default",
      email: "development-user@proset.ai",
      name: "Dev User",
      emailVerified: true,
      authTime: null,
      secondFactorId: null,
      source: "development",
    };
  }

  return verifyAuthoritativeFirebaseToken(token);
}

export interface AuthenticatedRequest extends Request {
  user?: any;
  authSource?: VerifiedIdentity["source"];
  authTime?: number | null;
  authSecondFactor?: string | null;
}

export async function getFirebaseTotpEnrollmentStatus(uid: string): Promise<boolean> {
  if (!useFirebase || firebaseAuthMode === "legacy") return false;
  const userRecord = await auth.getUser(uid);
  return Boolean(
    userRecord.multiFactor?.enrolledFactors.some((factor) => factor.factorId === "totp"),
  );
}

export async function firebaseAuthMiddleware(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    req.user = null;
    return next();
  }

  const token = authHeader.split(" ")[1];
  try {
    const decodedUser = await verifyFirebaseIdToken(token);
    req.authSource = decodedUser.source;
    req.authTime = decodedUser.authTime;
    req.authSecondFactor = decodedUser.secondFactorId;
    const email = decodedUser.email.toLowerCase();
    if (!email) {
      throw new Error("Authenticated identity is missing an email address.");
    }

    let user = await storage.users.get(decodedUser.uid);

    if (!user) {
      const userByEmail = await storage.users.getByEmail(email);
      if (userByEmail) {
        throw new Error(
          "Firebase UID does not match the existing Firestore profile UID. Automatic UID rewriting is forbidden.",
        );
      }
    }

    if (user) {
      if (decodedUser.source === "firebase" && user.email.toLowerCase() !== email) {
        const conflictingUser = await storage.users.getByEmail(email);
        if (conflictingUser && conflictingUser.id !== user.id) {
          throw new Error("Firebase email conflicts with another Firestore profile.");
        }
        user = await storage.users.update(user.id, {
          email,
          emailVerified: decodedUser.emailVerified ? 1 : 0,
        });
      }
      if (
        decodedUser.source === "firebase"
        && user.emailVerified !== (decodedUser.emailVerified ? 1 : 0)
      ) {
        user = await storage.users.update(user.id, {
          emailVerified: decodedUser.emailVerified ? 1 : 0,
        });
      }

      req.user = user;
    } else {
      throw new Error(
        "Authenticated identity does not have a matching Proset profile. "
        + "Profiles must be created by the server-controlled registration or administrator workflow.",
      );
    }
  } catch (error) {
    console.error("Firebase auth verification failed:", error);
    req.user = null;
  }
  next();
}
