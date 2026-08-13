import { storage } from "./storage";
import {
  getPasswordRequirements as getSharedPasswordRequirements,
  validatePassword as sharedValidatePassword,
} from "../shared/password-validation";

function parseEmailList(envVar: string, defaults: string[]): string[] {
  const val = process.env[envVar];
  if (val) return val.split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
  return defaults;
}

function parseBooleanEnv(envVar: string, defaultValue: boolean): boolean {
  const value = process.env[envVar];
  if (value == null || value.trim() === "") return defaultValue;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

const ADMIN_EMAILS = parseEmailList("ADMIN_EMAILS", []);

export const REGISTRATION_OPEN = parseBooleanEnv("REGISTRATION_OPEN", true);
const REGISTRATION_ALLOWLIST = [
  ...ADMIN_EMAILS,
];

export type UserRole = "user" | "admin";

const PASSWORD_EXPIRY_DAYS = 90;

export function isRegistrationAllowed(email: string): boolean {
  if (REGISTRATION_OPEN) return true;
  return REGISTRATION_ALLOWLIST.includes(email.toLowerCase());
}

export function getUserRole(email: string, storedRole?: string | null): UserRole {
  const normalizedEmail = email.toLowerCase();
  const normalizedStoredRole = String(storedRole || "").trim().toLowerCase();

  if (ADMIN_EMAILS.includes(normalizedEmail) || normalizedStoredRole === "admin") return "admin";
  return "user";
}

export function getEffectiveUserRole(
  email: string,
  storedRole?: string | null,
  _friendsOfBarryExpiresAt?: Date | string | null,
): UserRole {
  return getUserRole(email, storedRole);
}

export function isAdminRole(role: UserRole): boolean {
  return role === "admin";
}

export interface PasswordRequirements {
  minLength: number;
  requireUppercase: boolean;
  requireLowercase: boolean;
  requireNumbers: boolean;
  requireSpecialCharacter: boolean;
  requireMfa: boolean;
  passwordExpiryDays: number | null;
}

export function getPasswordRequirements(role: UserRole): PasswordRequirements {
  const shared = getSharedPasswordRequirements(isAdminRole(role));
  if (isAdminRole(role)) {
    return {
      ...shared,
      // 2FA DISABLED (2026-08-13): TOTP codes were being rejected and locking
      // users out. requireMfa is forced false for every role so nobody is
      // prompted to enroll until the TOTP flow is re-verified.
      requireMfa: false,
      passwordExpiryDays: PASSWORD_EXPIRY_DAYS,
    };
  }
  return {
    ...shared,
    requireMfa: false,
    passwordExpiryDays: null,
  };
}

export function validatePassword(password: string, role: UserRole): { valid: boolean; error?: string } {
  const result = sharedValidatePassword(password, isAdminRole(role));
  if (!result.valid) {
    switch (result.errorCode) {
      case "minLength":
        return { valid: false, error: `Your password needs at least ${result.minLength} characters to keep things secure.` };
      case "missingUppercase":
        return { valid: false, error: "Add at least one uppercase letter — it helps keep your account safe." };
      case "missingLowercase":
        return { valid: false, error: "Your password needs a lowercase letter in the mix." };
      case "missingNumber":
        return { valid: false, error: "Throw in at least one number for good measure." };
      case "missingSpecialCharacter":
        return { valid: false, error: "One more thing — a special character like ! or @ makes your password extra strong." };
    }
  }
  return { valid: true };
}

export function isPasswordExpired(passwordLastChanged: Date | null, role: UserRole): boolean {
  const reqs = getPasswordRequirements(role);
  if (!reqs.passwordExpiryDays) return false;
  if (!passwordLastChanged) return true;

  const now = new Date();
  const expiry = new Date(passwordLastChanged);
  expiry.setDate(expiry.getDate() + reqs.passwordExpiryDays);
  return now > expiry;
}

export function daysUntilPasswordExpiry(passwordLastChanged: Date | null, role: UserRole): number | null {
  const reqs = getPasswordRequirements(role);
  if (!reqs.passwordExpiryDays) return null;
  if (!passwordLastChanged) return 0;

  const now = new Date();
  const expiry = new Date(passwordLastChanged);
  expiry.setDate(expiry.getDate() + reqs.passwordExpiryDays);
  const diff = expiry.getTime() - now.getTime();
  return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
}

export async function syncUserRole(userId: string): Promise<UserRole> {
  try {
    const user = await storage.users.get(userId);
    if (!user) return "user";

    const correctRole = getUserRole(user.email, user.role);
    if (user.role !== correctRole) {
      await storage.users.update(userId, { role: correctRole });
    }
    return correctRole;
  } catch {
    return "user";
  }
}
