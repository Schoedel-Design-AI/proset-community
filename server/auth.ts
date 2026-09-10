import type { Request, Response, NextFunction, IRouter } from "express";
import { randomBytes, randomUUID } from "node:crypto";
import rateLimit from "express-rate-limit";
import { storage } from "./storage";
import { trackEvent } from "./analytics-service";
import { recordUserSurface } from "./client-surface";
import { getUserRole, getEffectiveUserRole, validatePasswordPolicy, isPasswordExpired, isAdminRole, syncUserRole, getPasswordRequirements, daysUntilPasswordExpiry, REGISTRATION_OPEN, isRegistrationAllowed } from "./password-policy";
import { JOB_TYPES } from "@shared/schema";
import {
  hasProAvatarEntitlement,
  isProAnimatedAvatarId,
  isValidAvatarId,
} from "@shared/avatar-catalog";
import { stripeService } from "./stripe-service";
import {
  auth as firebaseAdminAuth,
  firebaseAuthMode,
  getFirebaseTotpEnrollmentStatus,
  useFirebase,
} from "./firebase-admin";

declare global {
  namespace Express {
    interface Request {
      userId?: string;
      user?: {
        id: string;
        email: string;
        name: string;
        image?: string | null;
        stripeCustomerId?: string | null;
        stripeSubscriptionId?: string | null;
        cloudSyncSubscriptionId?: string | null;
        proAccessEnabled?: number | null;
        cloudSyncEnabled?: number | null;
        cloudSyncGracePeriodEnd?: Date | null;
        role?: string | null;
        friendsOfBarryExpiresAt?: Date | null;
        userNumber?: number | null;
        firstName?: string | null;
        jobType?: string | null;
        country?: string | null;
        avatarId?: string | null;
        emailVerified?: number | null;
        forcePasswordChange?: number | null;
        hasSeenPlanSelection?: number | null;
        passwordLastChanged?: Date | null;
        [key: string]: unknown;
      };
      authSource?: "firebase" | "legacy" | "development";
      authTime?: number | null;
      authSecondFactor?: string | null;
    }
  }
}

export async function getSessionFromRequest(req: Request) {
  if (!req.user) return null;
  return {
    user: req.user,
    session: { expiresAt: null },
  };
}

const AUTH_EXEMPT_PATHS = [
  "/api/auth/change-password",
  "/api/auth/send-verification-email",
  "/api/auth/me",
  "/api/auth/password-requirements",
];

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Please sign in to continue." });
    }
    req.userId = req.user.id;

    if (!AUTH_EXEMPT_PATHS.includes(req.path)) {
      const dbUser = await storage.users.get(req.user.id);

      if (dbUser?.forcePasswordChange === 1) {
        return res.status(403).json({ error: "Password change required.", code: "FORCE_PASSWORD_CHANGE" });
      }

      if (dbUser && dbUser.emailVerified !== 1) {
        return res.status(403).json({ error: "Email verification required.", code: "EMAIL_NOT_VERIFIED" });
      }

      if (dbUser) {
        const role = getEffectiveUserRole(dbUser.email, dbUser.role, dbUser.friendsOfBarryExpiresAt);
        // Learn which surfaces this account uses (Android app / iOS app / Web).
        // Fire-and-forget: it writes at most once per surface per account and
        // must never delay or fail the request. Feedback triage reads it so an
        // Android report is not mistaken for an Android-only bug.
        void recordUserSurface(dbUser, req);
        req.user = {
          ...req.user,
          role,
          friendsOfBarryExpiresAt: dbUser.friendsOfBarryExpiresAt ? new Date(dbUser.friendsOfBarryExpiresAt) : null,
        } as any;
        if (isAdminRole(role) && isPasswordExpired(dbUser.passwordLastChanged ? new Date(dbUser.passwordLastChanged) : null, role)) {
          await storage.users.update(req.user!.id, { forcePasswordChange: 1 });
          return res.status(403).json({ error: "Your password has expired. Please change it to continue.", code: "FORCE_PASSWORD_CHANGE" });
        }

        // 2FA enforcement DISABLED (2026-08-13) pending TOTP verification.
        // Admin routes no longer require a second factor. Re-enable here once
        // the TOTP enrollment/verification flow is re-tested.
      }
    }

    next();
  } catch {
    return res.status(401).json({ error: "Please sign in to continue." });
  }
}

function getRequestBaseUrl(req: Request): string {
  const configuredBaseUrl = process.env.PUBLIC_APP_URL?.trim();
  if (configuredBaseUrl) {
    const configured = new URL(configuredBaseUrl);
    if (process.env.NODE_ENV === "production" && configured.protocol !== "https:") {
      throw new Error("PUBLIC_APP_URL must use HTTPS in production.");
    }
    return configured.origin;
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error("PUBLIC_APP_URL is required for production email action links.");
  }
  const protocol = req.secure || req.headers["x-forwarded-proto"] === "https" ? "https" : "http";
  return `${protocol}://${req.get("host")}`;
}

function rewriteFirebaseActionLink(
  generatedLink: string,
  destination: string,
  expectedMode: "verifyEmail" | "resetPassword" | "verifyAndChangeEmail",
): string {
  const source = new URL(generatedLink);
  const oobCode = source.searchParams.get("oobCode");
  const mode = source.searchParams.get("mode");
  if (!oobCode || (mode && mode !== expectedMode)) {
    throw new Error(`Firebase did not return a valid ${expectedMode} action link.`);
  }
  const target = new URL(destination);
  target.searchParams.set("mode", expectedMode);
  target.searchParams.set("oobCode", oobCode);
  return target.toString();
}

async function sendVerificationFlow(email: string, firstName: string, req: Request): Promise<boolean> {
  const { sendVerificationEmail } = await import("./email-service");
  const baseUrl = getRequestBaseUrl(req);

  if (firebaseAuthMode !== "legacy") {
    if (!useFirebase) {
      throw new Error("Firebase Authentication is unavailable in this environment.");
    }
    const generatedLink = await firebaseAdminAuth.generateEmailVerificationLink(email, {
      url: `${baseUrl}/login?verified=true`,
    });
    const verificationUrl = rewriteFirebaseActionLink(
      generatedLink,
      `${baseUrl}/verify-email`,
      "verifyEmail",
    );
    return sendVerificationEmail({ to: email, firstName, verificationUrl });
  }

  // 1. Create verification token
  const verificationToken = randomBytes(32).toString("hex");
  const expiresAt = new Date();
  expiresAt.setHours(expiresAt.getHours() + 24); // 24 hours expiry

  await storage.verifications.create({
    id: randomBytes(16).toString("hex"),
    identifier: email,
    value: verificationToken,
    expiresAt: expiresAt.toISOString(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  // 2. Construct URL
  const verificationUrl = `${baseUrl}/api/auth/verify?email=${encodeURIComponent(email)}&token=${verificationToken}`;

  // 3. Send the email
  return await sendVerificationEmail({
    to: email,
    firstName,
    verificationUrl,
  });
}

async function validateTurnstileForSignup(req: Request): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const clientPlatform = req.body?.clientPlatform === "web" ? "web" : "native";
  if (clientPlatform !== "web") return { ok: true };

  const secretKey = process.env.TURNSTILE_SECRET_KEY;
  if (!secretKey) {
    return process.env.NODE_ENV === "production"
      ? { ok: false, status: 503, error: "Web registration protection is not configured." }
      : { ok: true };
  }

  const token = typeof req.body?.turnstileToken === "string" ? req.body.turnstileToken : "";
  if (!token) return { ok: false, status: 400, error: "Complete the CAPTCHA verification." };

  const formData = new URLSearchParams();
  formData.append("secret", secretKey);
  formData.append("response", token);
  // req.ip respects the trusted proxy chain (app.set("trust proxy", 1)) —
  // a client-supplied X-Forwarded-For header cannot spoof it.
  const ip = req.ip || req.socket.remoteAddress || "";
  if (ip) formData.append("remoteip", ip);
  const response = await globalThis.fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: formData.toString(),
  });
  const result = await response.json() as { success?: boolean };
  return result.success
    ? { ok: true }
    : { ok: false, status: 400, error: "CAPTCHA verification failed. Please try again." };
}

export function setupAuthRoutes(app: IRouter) {
  const userKeyGenerator = (req: Request) => {
    if (req.userId) return `user:${req.userId}`;
    // req.ip cannot be forged via a spoofed X-Forwarded-For header (the old
    // first-entry-of-XFF key let clients rotate the header to reset limits).
    return req.ip || req.socket.remoteAddress || "unknown";
  };

  const accountChangeLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 5,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: { error: "We've paused account changes briefly for safety. Try again in about 15 minutes." },
    keyGenerator: userKeyGenerator,
    skip: (req) => (process.env.NODE_ENV !== "production" && (req.hostname === "localhost" || req.hostname === "127.0.0.1")) || process.env.DISABLE_RATE_LIMIT === "true",
  });

  const emailChangeLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 3,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: { error: "We've paused email changes briefly for safety. Try again in about 15 minutes." },
    keyGenerator: userKeyGenerator,
    skip: (req) => (process.env.NODE_ENV !== "production" && (req.hostname === "localhost" || req.hostname === "127.0.0.1")) || process.env.DISABLE_RATE_LIMIT === "true",
  });

  const verificationResendLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 2,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: { error: "Please wait a minute before requesting another verification email." },
    keyGenerator: userKeyGenerator,
    skip: (req) => (process.env.NODE_ENV !== "production" && (req.hostname === "localhost" || req.hostname === "127.0.0.1")) || process.env.DISABLE_RATE_LIMIT === "true",
  });

  const passwordValidationLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: { error: "We've paused password checks briefly for safety. Try again in about 15 minutes.", code: "RATE_LIMIT_EXCEEDED" },
    keyGenerator: userKeyGenerator,
    skip: (req) => (process.env.NODE_ENV !== "production" && (req.hostname === "localhost" || req.hostname === "127.0.0.1")) || process.env.DISABLE_RATE_LIMIT === "true",
  });

  app.get("/api/auth/providers", (_req: Request, res: Response) => {
    res.json({
      google: false,
      github: false,
      passkey: false,
      magicLink: false,
      registrationOpen: REGISTRATION_OPEN,
    });
  });

  app.get("/api/auth/is-admin", requireAuth, (req: Request, res: Response) => {
    const user = req.user;
    res.json({
      isAdmin: user
        ? isAdminRole(getEffectiveUserRole(user.email, String(user.role || ""), user.friendsOfBarryExpiresAt))
        : false,
    });
  });

  app.get("/api/auth/me", async (req: Request, res: Response) => {
    try {
      const user = req.user;
      if (!user) {
        return res.status(401).json({ error: "Please sign in to continue." });
      }

      const role = getEffectiveUserRole(user.email, user.role, user.friendsOfBarryExpiresAt);
      await syncUserRole(user.id);
      const reqs = getPasswordRequirements(role);
      let twoFactorEnabled = user.twoFactorEnabled === 1;
      if (req.authSource === "firebase") {
        twoFactorEnabled = await getFirebaseTotpEnrollmentStatus(user.id);
        if (twoFactorEnabled !== (user.twoFactorEnabled === 1)) {
          await storage.users.update(user.id, {
            twoFactorEnabled: twoFactorEnabled ? 1 : 0,
          });
        }
      }

      let hasSeenPlanSelection = user.hasSeenPlanSelection === 1;
      if (isAdminRole(role) && !hasSeenPlanSelection) {
        await storage.users.update(user.id, { hasSeenPlanSelection: 1 });
        hasSeenPlanSelection = true;
      }

      let visibleAvatarId = user.avatarId || "";
      if (isProAnimatedAvatarId(visibleAvatarId)) {
        try {
          const subscriptionStatus = await stripeService.getUserSubscriptionStatus(user.id);
          if (!hasProAvatarEntitlement(subscriptionStatus)) visibleAvatarId = "";
        } catch {
          // Cosmetic access fails closed without blocking account sign-in. The
          // saved choice remains in storage and returns if Pro becomes active.
          visibleAvatarId = "";
        }
      }

      res.json({
        id: user.id,
        userNumber: user.userNumber,
        firstName: user.firstName,
        jobType: user.jobType,
        country: user.country || "",
        avatarId: visibleAvatarId,
        email: user.email,
        emailVerified: user.emailVerified === 1,
        forcePasswordChange: user.forcePasswordChange === 1,
        role,
        twoFactorEnabled,
        mfaRequired: reqs.requireMfa,
        passwordExpiryDays: reqs.passwordExpiryDays,
        daysUntilPasswordExpiry: daysUntilPasswordExpiry(user.passwordLastChanged || null, role),
        sessionExpiresAt: null,
        hasSeenPlanSelection,
      });
    } catch {
      res.status(500).json({ error: "Something went wrong checking your session." });
    }
  });

  app.post("/api/auth/validate-password", passwordValidationLimiter, async (req: Request, res: Response) => {
    try {
      const password = typeof req.body?.password === "string" ? req.body.password : "";
      if (!password) {
        return res.status(400).json({ error: "Please enter a password." });
      }

      let email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
      let role = getUserRole(email || "");

      if (req.userId) {
        const user = await storage.users.get(req.userId);
        if (!user) return res.status(404).json({ error: "User not found." });
        email = user.email;
        role = getEffectiveUserRole(user.email, user.role, user.friendsOfBarryExpiresAt);
      }

      const validation = await validatePasswordPolicy(password, role, { email });
      if (!validation.valid) {
        return res.status(400).json({ error: validation.error, code: validation.code });
      }

      return res.json({ ok: true, requirements: getPasswordRequirements(role) });
    } catch {
      return res.status(500).json({ error: "We had trouble checking that password. Please try again." });
    }
  });

  app.post("/api/auth/change-password", requireAuth, accountChangeLimiter, async (req: Request, res: Response) => {
    try {
      if (req.authSource !== "firebase") {
        const currentPassword = typeof req.body.currentPassword === "string" ? req.body.currentPassword : "";
        const newPassword = typeof req.body.newPassword === "string" ? req.body.newPassword : "";
        if (!currentPassword || !newPassword) {
          return res.status(400).json({ error: "Enter your current and new password." });
        }
        const user = await storage.users.get(req.userId!);
        if (!user) return res.status(404).json({ error: "User not found." });
        const role = getEffectiveUserRole(user.email, user.role, user.friendsOfBarryExpiresAt);
        const validation = await validatePasswordPolicy(newPassword, role, { email: user.email });
        if (!validation.valid) return res.status(400).json({ error: validation.error, code: validation.code });
        const account = await storage.accounts.getByUserAndProvider(user.id, "credential");
        if (!account?.password) return res.status(409).json({ error: "This account has no legacy password." });
        const bcrypt = await import("bcryptjs");
        if (!(await bcrypt.compare(currentPassword, account.password))) {
          return res.status(403).json({ error: "The current password is incorrect." });
        }
        await storage.accounts.update(account.id, {
          password: await bcrypt.hash(newPassword, 12),
          updatedAt: new Date().toISOString(),
        });
      }
      await storage.users.update(req.userId!, {
        forcePasswordChange: 0,
        passwordLastChanged: new Date(),
      });

      res.json({ ok: true });
    } catch (error: any) {
      const msg = error?.message || "We had trouble updating your password.";
      res.status(400).json({ error: msg });
    }
  });

  app.get("/api/auth/password-requirements", requireAuth, async (req: Request, res: Response) => {
    try {
      const user = await storage.getUser(req.userId!);
      if (!user) {
        return res.status(404).json({ error: "User not found." });
      }
      const role = getEffectiveUserRole(user.email, user.role, user.friendsOfBarryExpiresAt);
      const reqs = getPasswordRequirements(role);
      res.json({ role, requirements: reqs });
    } catch {
      res.status(500).json({ error: "Failed to get password requirements." });
    }
  });

  app.post("/api/auth/change-email", requireAuth, emailChangeLimiter, async (req: Request, res: Response) => {
    try {
      if (req.authSource === "firebase") {
        return res.status(409).json({
          error: "Use Firebase's verified email-change flow from the Proset client.",
          code: "FIREBASE_EMAIL_CHANGE_REQUIRED",
        });
      }
      const newEmail = typeof req.body.newEmail === "string" ? req.body.newEmail.trim().toLowerCase() : "";
      if (!newEmail) {
        return res.status(400).json({ error: "Please enter your new email." });
      }

      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(newEmail)) {
        return res.status(400).json({ error: "That email address doesn't look quite right." });
      }

      const existing = await storage.getUserByEmail(newEmail);
      if (existing && existing.id !== req.userId) {
        return res.status(409).json({ error: "That email is already connected to another account." });
      }

      await storage.users.update(req.userId!, { email: newEmail, emailVerified: 0 });

      res.json({ ok: true, email: newEmail, emailVerified: false });
    } catch (error: unknown) {
      console.error("Change email error:", error);
      res.status(500).json({ error: "We had trouble updating your email. Please try again." });
    }
  });

  app.post("/api/auth/request-email-change", requireAuth, emailChangeLimiter, async (req: Request, res: Response) => {
    try {
      if (req.authSource !== "firebase") {
        return res.status(409).json({ error: "Firebase Authentication is not active for this session." });
      }
      const authTime = typeof req.authTime === "number" ? req.authTime : 0;
      if (!authTime || Math.floor(Date.now() / 1000) - authTime > 5 * 60) {
        return res.status(403).json({
          error: "Sign in again before changing your email.",
          code: "REQUIRES_RECENT_LOGIN",
        });
      }

      const newEmail = typeof req.body.newEmail === "string"
        ? req.body.newEmail.trim().toLowerCase()
        : "";
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) {
        return res.status(400).json({ error: "Enter a valid new email address." });
      }
      const existing = await storage.users.getByEmail(newEmail);
      if (existing && existing.id !== req.userId) {
        return res.status(409).json({ error: "That email is already connected to another account." });
      }

      const baseUrl = getRequestBaseUrl(req);
      const generatedLink = await firebaseAdminAuth.generateVerifyAndChangeEmailLink(
        req.user!.email,
        newEmail,
        { url: `${baseUrl}/login` },
      );
      const verificationUrl = rewriteFirebaseActionLink(
        generatedLink,
        `${baseUrl}/verify-email`,
        "verifyAndChangeEmail",
      );
      const { sendVerificationEmail } = await import("./email-service");
      await sendVerificationEmail({
        to: newEmail,
        firstName: req.user!.firstName || req.user!.name,
        verificationUrl,
      });
      res.json({ ok: true, verificationRequired: true });
    } catch (error: unknown) {
      console.error("Request Firebase email change error:", error);
      res.status(500).json({ error: "We couldn't send the email-change verification link." });
    }
  });

  app.post("/api/auth/change-name", requireAuth, async (req: Request, res: Response) => {
    try {
      const { firstName } = req.body;
      if (!firstName || !firstName.trim()) {
        return res.status(400).json({ error: "Please enter your first name." });
      }
      const trimmedName = firstName.trim().slice(0, 100);

      await storage.users.update(req.userId!, { firstName: trimmedName, name: trimmedName });

      res.json({ ok: true, firstName: trimmedName });
    } catch (error: unknown) {
      console.error("Change name error:", error);
      res.status(500).json({ error: "We had trouble updating your name. Please try again." });
    }
  });

  app.post("/api/auth/change-country", requireAuth, async (req: Request, res: Response) => {
    try {
      const { country } = req.body;
      if (typeof country !== "string") {
        return res.status(400).json({ error: "Please select a country." });
      }

      await storage.users.update(req.userId!, { country: country.trim() });

      res.json({ ok: true, country: country.trim() });
    } catch (error: unknown) {
      console.error("Change country error:", error);
      res.status(500).json({ error: "We had trouble updating your country. Please try again." });
    }
  });

  app.post("/api/auth/change-job-type", requireAuth, async (req: Request, res: Response) => {
    try {
      const { jobType } = req.body;
      if (typeof jobType !== "string" || !jobType.trim()) {
        return res.status(400).json({ error: "Please select a job type." });
      }
      if (!(JOB_TYPES as readonly string[]).includes(jobType.trim())) {
        return res.status(400).json({ error: "Please select a valid job type." });
      }

      await storage.users.update(req.userId!, { jobType: jobType.trim() });

      res.json({ ok: true, jobType: jobType.trim() });
    } catch (error: unknown) {
      console.error("Change job type error:", error);
      res.status(500).json({ error: "We had trouble updating your job type. Please try again." });
    }
  });

  app.post("/api/auth/verify-turnstile", async (req: Request, res: Response) => {
    try {
      req.body = { ...req.body, turnstileToken: req.body?.token, clientPlatform: "web" };
      const result = await validateTurnstileForSignup(req);
      if (!result.ok) return res.status(result.status).json({ error: result.error });
      res.json({ ok: true });
    } catch (error: any) {
      console.error("Turnstile verification error:", error);
      res.status(500).json({ error: "CAPTCHA verification failed." });
    }
  });

  app.post("/api/auth/resend-verification", async (req: Request, res: Response) => {
    try {
      const { email } = req.body;
      if (typeof email !== "string" || !email) {
        return res.status(400).json({ error: "Pop your email in and we'll resend that verification link." });
      }
      const cleanEmail = email.trim().toLowerCase();
      const user = await storage.users.getByEmail(cleanEmail);
      if (!user) {
        return res.status(200).json({ ok: true });
      }

      await sendVerificationFlow(cleanEmail, user.firstName || user.name, req);
      res.json({ ok: true });
    } catch (error: any) {
      console.error("Resend verification error:", error);
      res.status(500).json({ error: error.message || "Failed to resend verification email." });
    }
  });

  app.post("/api/auth/send-verification-email", requireAuth, async (req: Request, res: Response) => {
    try {
      const user = req.user;
      if (!user) {
        return res.status(401).json({ error: "Please sign in to continue." });
      }

      await sendVerificationFlow(user.email, user.firstName || user.name, req);
      res.json({ ok: true });
    } catch (error: any) {
      console.error("Send verification email error:", error);
      res.status(500).json({ error: error.message || "Failed to send verification email." });
    }
  });

  app.get("/api/auth/verify", async (req: Request, res: Response) => {
    try {
      const email = typeof req.query.email === "string" ? req.query.email.trim().toLowerCase() : "";
      const token = typeof req.query.token === "string" ? req.query.token : "";

      if (!email || !token) {
        return res.status(400).send("Email and verification token are required.");
      }

      const verification = await storage.verifications.getByIdentifierAndValue(email, token);
      if (!verification) {
        return res.status(400).send("Invalid or expired verification link. Please request a new one.");
      }

      if (new Date(verification.expiresAt) < new Date()) {
        await storage.verifications.delete(verification.id);
        return res.status(400).send("This verification link has expired. Please request a new one.");
      }

      const user = await storage.users.getByEmail(email);
      if (!user) {
        return res.status(404).send("User not found.");
      }

      // Mark email as verified
      await storage.users.update(user.id, { emailVerified: 1 });
      
      // Clean up verification
      await storage.verifications.delete(verification.id);

      // Send welcome email
      try {
        const { sendWelcomeEmail } = await import("./email-service");
        await sendWelcomeEmail({ to: email, firstName: user.firstName || user.name });
      } catch (err) {
        console.error("Failed to send welcome email after verification:", err);
      }

      const protocol = req.secure || req.headers["x-forwarded-proto"] === "https" ? "https" : "http";
      const host = req.get("host");
      const baseUrl = `${protocol}://${host}`;

      return res.redirect(302, `${baseUrl}/login?verified=true`);
    } catch (error: any) {
      console.error("Email verification error:", error);
      res.status(500).send("Verification failed.");
    }
  });

  app.post("/api/auth/sign-out", async (req: Request, res: Response) => {
    try {
      const authHeader = req.headers.authorization;
      if (authHeader && authHeader.startsWith("Bearer ")) {
        const token = authHeader.split(" ")[1];
        await storage.sessions.deleteByToken(token);
      }
      res.json({ ok: true });
    } catch (error: any) {
      console.error("Sign-out error:", error);
      res.status(500).json({ error: "Failed to sign out." });
    }
  });

  // ── Password Reset Flow ──

  app.post("/api/auth/forget-password", async (req: Request, res: Response) => {
    try {
      const { email } = req.body;
      if (typeof email !== "string" || !email) {
        return res.status(400).json({ error: "Pop your email in and we'll send you a reset link right away." });
      }
      const cleanEmail = email.trim().toLowerCase();

      // Don't reveal whether the email exists — always return ok
      const user = await storage.users.getByEmail(cleanEmail);
      if (!user) {
        return res.json({ ok: true });
      }

      const { sendPasswordResetEmail } = await import("./email-service");

      if (firebaseAuthMode !== "legacy") {
        if (!useFirebase) return res.json({ ok: true });
        const baseUrl = getRequestBaseUrl(req);
        const generatedLink = await firebaseAdminAuth.generatePasswordResetLink(cleanEmail, {
          url: `${baseUrl}/login`,
        });
        const resetUrl = rewriteFirebaseActionLink(
          generatedLink,
          `${baseUrl}/reset-password`,
          "resetPassword",
        );
        try {
          await sendPasswordResetEmail({
            to: cleanEmail,
            firstName: user.firstName || user.name || "",
            resetUrl,
            expiryMinutes: 60,
          });
        } catch (err) {
          console.error("Failed to send Firebase password reset email:", err);
        }
        return res.json({ ok: true });
      }

      // Generate reset token — store with identifier = token, value = email
      // so we can look up by token alone via getByIdentifier()
      const resetToken = randomBytes(32).toString("hex");
      const expiresAt = new Date();
      expiresAt.setMinutes(expiresAt.getMinutes() + 15); // 15-minute expiry

      // Clean up any existing reset tokens for this email
      try {
        const existing = await storage.verifications.getByIdentifierAndValue(
          `pwdreset:${cleanEmail}`,
          resetToken,
        );
        if (existing) {
          await storage.verifications.delete(existing.id);
        }
      } catch { /* ok if none */ }

      await storage.verifications.create({
        id: randomBytes(16).toString("hex"),
        identifier: resetToken,
        value: cleanEmail,
        expiresAt: expiresAt.toISOString(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      // Build reset URL
      const protocol = req.secure || req.headers["x-forwarded-proto"] === "https" ? "https" : "http";
      const host = req.get("host");
      const baseUrl = `${protocol}://${host}`;
      const resetUrl = `${baseUrl}/reset-password?token=${resetToken}`;

      const firstName = user.firstName || user.name || "";
      try {
        await sendPasswordResetEmail({
          to: cleanEmail,
          firstName,
          resetUrl,
          expiryMinutes: 15,
        });
      } catch (err) {
        console.error("Failed to send password reset email:", err);
      }

      res.json({ ok: true });
    } catch (error: any) {
      console.error("Forget password error:", error);
      // Always return ok to avoid revealing whether the email exists
      res.json({ ok: true });
    }
  });

  app.get("/api/auth/check-reset-token", async (req: Request, res: Response) => {
    try {
      if (firebaseAuthMode !== "legacy") return res.json({ valid: false });
      const token = typeof req.query.token === "string" ? req.query.token : "";
      if (!token) {
        return res.json({ valid: false });
      }

      const verification = await storage.verifications.getByIdentifier(token);
      if (!verification) {
        return res.json({ valid: false });
      }

      if (new Date(verification.expiresAt) < new Date()) {
        await storage.verifications.delete(verification.id);
        return res.json({ valid: false });
      }

      res.json({ valid: true });
    } catch (error: any) {
      console.error("Check reset token error:", error);
      res.json({ valid: false });
    }
  });

  app.post("/api/auth/reset-password", async (req: Request, res: Response) => {
    try {
      if (firebaseAuthMode !== "legacy") {
        return res.status(409).json({ error: "Use the Firebase password-reset link sent to your email." });
      }
      const { token, newPassword } = req.body;
      if (typeof token !== "string" || typeof newPassword !== "string" || !token || !newPassword) {
        return res.status(400).json({ error: "We need both the reset token and your new password to continue." });
      }

      // Look up the reset token
      const verification = await storage.verifications.getByIdentifier(token);
      if (!verification) {
        return res.status(400).json({ error: "This reset link isn't working anymore. No worries — request a fresh one and we'll get you sorted." });
      }

      if (new Date(verification.expiresAt) < new Date()) {
        await storage.verifications.delete(verification.id);
        return res.status(400).json({ error: "This reset link has expired — they're good for 15 minutes. Request a new one and you'll be back in no time." });
      }

      const cleanEmail = verification.value;
      const user = await storage.users.getByEmail(cleanEmail);
      if (!user) {
        return res.status(400).json({ error: "Hmm, we couldn't find an account for that email. Want to double-check it?" });
      }

      // Validate password strength
      const role = getUserRole(cleanEmail, user.role);
      const validation = await validatePasswordPolicy(newPassword, role, { email: cleanEmail });
      if (!validation.valid) {
        return res.status(400).json({ error: validation.error, code: validation.code });
      }

      // Hash and update password
      const bcrypt = await import("bcryptjs");
      const hashedPassword = await bcrypt.hash(newPassword, 12);

      const account = await storage.accounts.getByUserAndProvider(user.id, "credential");
      if (account) {
        await storage.accounts.update(account.id, {
          password: hashedPassword,
          updatedAt: new Date().toISOString(),
        });
      } else {
        // Create credential account if it doesn't exist (e.g. user was created via Firebase)
        await storage.accounts.create({
          id: randomBytes(16).toString("hex"),
          userId: user.id,
          accountId: user.id,
          providerId: "credential",
          password: hashedPassword,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      }

      // Update password last changed timestamp
      await storage.users.update(user.id, {
        passwordLastChanged: new Date(),
        forcePasswordChange: 0,
      });

      // Clean up the used token
      await storage.verifications.delete(verification.id);

      // Revoke all existing sessions for security
      try {
        await storage.sessions.deleteByUser(user.id);
      } catch (err) {
        console.error("Failed to revoke sessions after password reset:", err);
      }

      res.json({ ok: true });
    } catch (error: any) {
      console.error("Reset password error:", error);
      res.status(500).json({ error: "We hit a snag resetting your password. Give it another try — it usually clears right up." });
    }
  });

  app.post("/api/auth/change-avatar", requireAuth, accountChangeLimiter, async (req: Request, res: Response) => {
    try {
      const { avatarId } = req.body;
      if (typeof avatarId !== "string") {
        return res.status(400).json({ error: "Please select an avatar." });
      }

      const normalizedAvatarId = avatarId.trim();
      if (!isValidAvatarId(normalizedAvatarId)) {
        return res.status(400).json({ error: "That avatar is not available." });
      }

      if (isProAnimatedAvatarId(normalizedAvatarId)) {
        const subscriptionStatus = await stripeService.getUserSubscriptionStatus(req.userId!);
        if (!hasProAvatarEntitlement(subscriptionStatus)) {
          return res.status(403).json({
            error: "Pro is required for animated avatars.",
            code: "PRO_REQUIRED",
          });
        }
      }

      await storage.users.update(req.userId!, { avatarId: normalizedAvatarId });

      res.json({ ok: true, avatarId: normalizedAvatarId });
    } catch (error: unknown) {
      console.error("Change avatar error:", error);
      res.status(500).json({ error: "We had trouble updating your avatar. Please try again." });
    }
  });

  app.post("/api/auth/sign-up/email", async (req: Request, res: Response) => {
    try {
      const { email, password, name } = req.body;
      if (typeof email !== "string" || typeof password !== "string" || !email || !password) {
        return res.status(400).json({ error: "We'll need both your email and a password to get you started." });
      }
      const cleanEmail = email.trim().toLowerCase();
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(cleanEmail)) {
        return res.status(400).json({ error: "That email doesn't look quite right — could you double-check it?" });
      }

      // Check if registration is currently open
      if (!isRegistrationAllowed(cleanEmail)) {
        return res.status(403).json({ error: "Registration is currently by invitation only. If you were invited, please use the email address your invitation was sent to." });
      }

      const turnstile = await validateTurnstileForSignup(req);
      if (!turnstile.ok) {
        return res.status(turnstile.status).json({ error: turnstile.error });
      }

      const role = getUserRole(cleanEmail);
      const validation = await validatePasswordPolicy(password, role, { email: cleanEmail });
      if (!validation.valid) {
        return res.status(400).json({ error: validation.error, code: validation.code });
      }

      // Check if user already exists
      const existingUser = await storage.users.getByEmail(cleanEmail);
      if (existingUser) {
        return res.status(400).json({ error: "Looks like you've already got an account here! Head over to the Sign In tab instead." });
      }

      if (firebaseAuthMode !== "legacy") {
        if (!useFirebase) {
          return res.status(503).json({ error: "Authentication is temporarily unavailable." });
        }
        const cleanName = typeof name === "string" ? name.trim() : cleanEmail.split("@")[0];
        let firebaseUser: Awaited<ReturnType<typeof firebaseAdminAuth.createUser>> | null = null;
        try {
          firebaseUser = await firebaseAdminAuth.createUser({
            email: cleanEmail,
            password,
            displayName: cleanName,
            emailVerified: false,
          });
          const userNumber = 100000 + Math.floor(Math.random() * 900000);
          await storage.users.create({
            id: firebaseUser.uid,
            email: cleanEmail,
            name: cleanName,
            firstName: cleanName.split(" ")[0] || cleanName,
            userNumber,
            role: "user",
            emailVerified: 0,
            passwordLastChanged: new Date(),
          });
        } catch (error) {
          if (firebaseUser) {
            await firebaseAdminAuth.deleteUser(firebaseUser.uid).catch(() => {});
          }
          throw error;
        }
        return res.json({
          firebaseSignInRequired: true,
          user: {
            id: firebaseUser.uid,
            email: cleanEmail,
            name: cleanName,
          },
          message: "Account created. Sign in is required to send the verification email.",
        });
      }

      const bcrypt = await import("bcryptjs");
      const hashedPassword = await bcrypt.hash(password, 12);
      
      const userNumber = 100000 + Math.floor(Math.random() * 900000);
      const cleanName = typeof name === "string" ? name.trim() : cleanEmail.split("@")[0];
      const uid = randomUUID();

      const newUser = await storage.users.create({
        id: uid,
        email: cleanEmail,
        name: cleanName,
        firstName: cleanName.split(" ")[0] || cleanName,
        userNumber,
        role: "user",
        emailVerified: 0, // Unverified initially
        passwordLastChanged: new Date(),
      });

      await storage.accounts.create({
        id: randomBytes(16).toString("hex"),
        userId: newUser.id,
        accountId: newUser.id,
        providerId: "credential",
        password: hashedPassword,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      // Generate database session token
      const sessionToken = randomBytes(32).toString("hex");
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 30); // 30 days session
      
      await storage.sessions.create({
        id: randomBytes(16).toString("hex"),
        token: sessionToken,
        userId: newUser.id,
        expiresAt: expiresAt.toISOString(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      // Send verification email asynchronously
      sendVerificationFlow(cleanEmail, newUser.firstName || newUser.name, req).catch((err) => {
        console.error("Failed to send verification email on sign-up:", err);
      });

      res.json({
        token: sessionToken,
        user: {
          id: newUser.id,
          email: newUser.email,
          name: newUser.name,
        },
        message: "Account created! Check your email for a verification link to get started.",
      });
    } catch (error: any) {
      console.error("Sign-up error:", error);
      res.status(500).json({ error: "We hit a snag creating your account. Give it another try — these things usually sort themselves out." });
    }
  });

  app.post("/api/auth/sign-in/email", async (req: Request, res: Response) => {
    try {
      if (firebaseAuthMode !== "legacy") {
        return res.status(410).json({
          error: "This endpoint has been replaced by Firebase Authentication.",
          code: "FIREBASE_CLIENT_AUTH_REQUIRED",
        });
      }
      const { email, password } = req.body;
      if (typeof email !== "string" || typeof password !== "string" || !email || !password) {
        return res.status(400).json({ error: "We'll need both your email and password to sign you in." });
      }
      const cleanEmail = email.trim().toLowerCase();

      // Find user
      const user = await storage.users.getByEmail(cleanEmail);
      if (!user) {
        return res.status(400).json({ error: "Those don't quite match what we have on file. Want to try again?" });
      }

      // Find account
      const account = await storage.accounts.getByUserAndProvider(user.id, "credential");

      if (!account || !account.password) {
        return res.status(400).json({ error: "Those don't quite match what we have on file. Want to try again?" });
      }

      const bcrypt = await import("bcryptjs");
      const isValid = await bcrypt.compare(password, account.password);
      if (!isValid) {
        return res.status(400).json({ error: "Those don't quite match what we have on file. Want to try again?" });
      }

      // Generate database session token
      const sessionToken = randomBytes(32).toString("hex");
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 30); // 30 days session
      
      await storage.sessions.create({
        id: randomBytes(16).toString("hex"),
        token: sessionToken,
        userId: user.id,
        expiresAt: expiresAt.toISOString(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      res.json({
        token: sessionToken,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
        }
      });
    } catch (error: any) {
      console.error("Sign-in error:", error);
      res.status(500).json({ error: "We couldn't sign you in just now. A quick retry usually does the trick." });
    }
  });
}
