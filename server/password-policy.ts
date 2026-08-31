import { createHash } from "node:crypto";

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
const HIBP_TIMEOUT_MS = 2500;
const HIBP_RANGE_URL = "https://api.pwnedpasswords.com/range/";
const HIBP_USER_AGENT = "Proset CE Password Security Check";
const LOCAL_PASSWORD_BLOCKLIST = new Set([
  "12345678",
  "123456789",
  "1234567890",
  "123456789012345",
  "abc123",
  "admin",
  "changeme",
  "dragon",
  "iloveyou",
  "letmein",
  "letmeinletmein",
  "monkey",
  "password",
  "password1",
  "password123",
  "passwordpassword",
  "passw0rd",
  "proset",
  "prosetai",
  "qwerty",
  "qwertyuiop",
  "qwertyuiopasdfg",
  "schoedel",
  "schoedeldesign",
  "welcome",
]);

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

export type PasswordValidationFailureCode = "PASSWORD_TOO_SHORT" | "PASSWORD_BLOCKLISTED";

export type PasswordValidationResponse =
  | { valid: true }
  | { valid: false; error: string; code: PasswordValidationFailureCode; minLength?: number };

// 2FA enforcement: OFF by default (the TOTP flow was locking users out on the
// hosted service, 2026-08-13). CE operators whose own TOTP enrollment works
// can opt in for admin accounts with REQUIRE_TWO_FACTOR=true.
const REQUIRE_TWO_FACTOR = parseBooleanEnv("REQUIRE_TWO_FACTOR", false);

export function getPasswordRequirements(role: UserRole): PasswordRequirements {
  const shared = getSharedPasswordRequirements(isAdminRole(role));
  if (isAdminRole(role)) {
    return {
      ...shared,
      requireMfa: REQUIRE_TWO_FACTOR,
      passwordExpiryDays: PASSWORD_EXPIRY_DAYS,
    };
  }
  return {
    ...shared,
    requireMfa: false,
    passwordExpiryDays: null,
  };
}

function normalizePasswordForComparison(password: string): string {
  return password.normalize("NFC").trim().toLowerCase();
}

function squashContextText(value: string): string {
  return value.normalize("NFC").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function addBlocklistTerm(set: Set<string>, value?: string | null): void {
  if (!value) return;
  const normalized = normalizePasswordForComparison(value);
  if (!normalized) return;
  set.add(normalized);
  const squashed = squashContextText(normalized);
  if (squashed) set.add(squashed);
}

function isLocallyBlocklistedPassword(password: string, email?: string): boolean {
  const normalized = normalizePasswordForComparison(password);
  const squashed = squashContextText(password);
  const set = new Set(LOCAL_PASSWORD_BLOCKLIST);

  if (email) {
    const cleanEmail = email.trim().toLowerCase();
    addBlocklistTerm(set, cleanEmail);
    addBlocklistTerm(set, cleanEmail.split("@")[0] || "");
  }

  return set.has(normalized) || (!!squashed && set.has(squashed));
}

async function isPwnedPassword(password: string): Promise<boolean | null> {
  const hash = createHash("sha1")
    .update(password.normalize("NFC"), "utf8")
    .digest("hex")
    .toUpperCase();
  const prefix = hash.slice(0, 5);
  const suffix = hash.slice(5);

  try {
    const response = await globalThis.fetch(`${HIBP_RANGE_URL}${prefix}`, {
      headers: {
        "Add-Padding": "true",
        "User-Agent": HIBP_USER_AGENT,
      },
      signal: AbortSignal.timeout(HIBP_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const text = await response.text();
    for (const line of text.split(/\r?\n/)) {
      const [candidateSuffix, countText] = line.trim().split(":");
      if (!candidateSuffix || candidateSuffix.toUpperCase() !== suffix) continue;
      return Number.parseInt(countText || "0", 10) > 0;
    }
    return false;
  } catch {
    return null;
  }
}

export function validatePassword(password: string, role: UserRole): PasswordValidationResponse {
  const result = sharedValidatePassword(password, isAdminRole(role));
  if (!result.valid) {
    return {
      valid: false,
      code: "PASSWORD_TOO_SHORT",
      minLength: result.minLength,
      error: `Your password needs at least ${result.minLength} characters.`,
    };
  }
  return { valid: true };
}

export async function validatePasswordPolicy(
  password: string,
  role: UserRole,
  options: { email?: string } = {},
): Promise<PasswordValidationResponse> {
  const basic = validatePassword(password, role);
  if (!basic.valid) return basic;

  if (isLocallyBlocklistedPassword(password, options.email)) {
    return {
      valid: false,
      code: "PASSWORD_BLOCKLISTED",
      error: "That password is too common or has appeared in known data breaches. Choose a different one.",
    };
  }

  const pwned = await isPwnedPassword(password);
  if (pwned) {
    return {
      valid: false,
      code: "PASSWORD_BLOCKLISTED",
      error: "That password is too common or has appeared in known data breaches. Choose a different one.",
    };
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
