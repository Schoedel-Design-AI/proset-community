const UPPERCASE = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const LOWERCASE = "abcdefghijklmnopqrstuvwxyz";
const DIGITS = "0123456789";
const SPECIALS = "!@#$%^&*()_+-=[]{}|;:,.<>?";
const ALL_CHARS = UPPERCASE + LOWERCASE + DIGITS + SPECIALS;

type UserRole = "user" | "admin" | undefined;

const ADMIN_PASSWORD_LENGTH = 32;
const USER_PASSWORD_LENGTH = 20;

export function getPasswordLengthForRole(role: UserRole): number {
  if (role === "admin") return ADMIN_PASSWORD_LENGTH;
  return USER_PASSWORD_LENGTH;
}

function secureRandomIndex(max: number): number {
  const arr = new Uint32Array(1);
  if (typeof globalThis.crypto !== "undefined" && globalThis.crypto.getRandomValues) {
    globalThis.crypto.getRandomValues(arr);
    return arr[0] % max;
  }
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(arr);
    return arr[0] % max;
  }
  throw new Error("No cryptographically secure RNG available");
}

function randomChar(chars: string): string {
  return chars[secureRandomIndex(chars.length)];
}

export function generatePassword(length: number = ADMIN_PASSWORD_LENGTH): string {
  const out: string[] = [];
  for (let i = 0; i < length; i++) {
    out.push(randomChar(ALL_CHARS));
  }
  return out.join("");
}

export function generatePasswordForRole(role: UserRole): string {
  return generatePassword(getPasswordLengthForRole(role));
}
