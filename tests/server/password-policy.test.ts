import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  getPasswordRequirements,
  validatePassword,
  validatePasswordPolicy,
} from "../../server/password-policy";
import { getPasswordLengthForRole, generatePasswordForRole } from "../../lib/password-generator";

function sha1Hex(value: string): string {
  return createHash("sha1").update(value.normalize("NFC"), "utf8").digest("hex").toUpperCase();
}

test("password requirements are length-first and no longer impose composition rules", () => {
  const user = getPasswordRequirements("user");
  const admin = getPasswordRequirements("admin");

  assert.equal(user.minLength, 15);
  assert.equal(admin.minLength, 15);
  assert.equal(user.requireUppercase, false);
  assert.equal(user.requireLowercase, false);
  assert.equal(user.requireNumbers, false);
  assert.equal(user.requireSpecialCharacter, false);
  assert.equal(admin.requireUppercase, false);
  assert.equal(admin.requireLowercase, false);
  assert.equal(admin.requireNumbers, false);
  assert.equal(admin.requireSpecialCharacter, false);

  assert.deepEqual(validatePassword("alllowercasebutlongenough", "user"), { valid: true });
  assert.deepEqual(validatePassword("12345678901234", "user"), {
    valid: false,
    code: "PASSWORD_TOO_SHORT",
    minLength: 15,
    error: "Your password needs at least 15 characters.",
  });
});

test("generated passwords stay comfortably above the new minimum", () => {
  const userGenerated = generatePasswordForRole("user");
  const adminGenerated = generatePasswordForRole("admin");

  assert.equal(userGenerated.length, getPasswordLengthForRole("user"));
  assert.equal(adminGenerated.length, getPasswordLengthForRole("admin"));
  assert.ok(userGenerated.length >= 15);
  assert.ok(adminGenerated.length >= 15);
});

test("validatePasswordPolicy rejects local blocklist matches and exact email-local-part passwords", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new Error("network down");
  }) as typeof fetch;

  try {
    const common = await validatePasswordPolicy("passwordpassword", "user", { email: "person@example.com" });
    assert.deepEqual(common, {
      valid: false,
      code: "PASSWORD_BLOCKLISTED",
      error: "That password is too common or has appeared in known data breaches. Choose a different one.",
    });

    const emailBased = await validatePasswordPolicy("averyverylongperson", "user", {
      email: "averyverylongperson@example.com",
    });
    assert.deepEqual(emailBased, {
      valid: false,
      code: "PASSWORD_BLOCKLISTED",
      error: "That password is too common or has appeared in known data breaches. Choose a different one.",
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("validatePasswordPolicy rejects passwords found by the HIBP k-anonymity API", async () => {
  const originalFetch = globalThis.fetch;
  const password = "correct horse battery staple";
  const hash = sha1Hex(password);
  const prefix = hash.slice(0, 5);
  const suffix = hash.slice(5);

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    assert.match(url, new RegExp(`${prefix}$`));
    return new Response(`${suffix}:42\r\nFFFFF0000000000000000000000000000000:1\r\n`, {
      status: 200,
      headers: { "content-type": "text/plain" },
    });
  }) as typeof fetch;

  try {
    const result = await validatePasswordPolicy(password, "user", { email: "person@example.com" });
    assert.deepEqual(result, {
      valid: false,
      code: "PASSWORD_BLOCKLISTED",
      error: "That password is too common or has appeared in known data breaches. Choose a different one.",
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("validatePasswordPolicy fails open on HIBP outages while keeping local rules", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new Error("timeout");
  }) as typeof fetch;

  try {
    const result = await validatePasswordPolicy("uniquely long passphrase", "user", {
      email: "person@example.com",
    });
    assert.deepEqual(result, { valid: true });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
