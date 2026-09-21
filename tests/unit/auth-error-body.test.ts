import assert from "node:assert/strict";
import test from "node:test";

import { readAuthErrorBody } from "../../lib/auth-error-body";

/**
 * Regression cover for the Android sign-in failure of 2026-09-16.
 *
 * A rejected Firebase credential fell through to the closed legacy endpoint
 * `POST /api/auth/sign-in/email`, which answers:
 *
 *   { "error": "This endpoint has been replaced by Firebase Authentication.",
 *     "code": "FIREBASE_CLIENT_AUTH_REQUIRED" }
 *
 * The caller read `data.error.message` — undefined on that body — and reported
 * the generic "Login failed" instead of anything actionable. These tests pin the
 * real reason as recoverable.
 */

test("the closed legacy sign-in body yields its real reason, never a generic fallback", () => {
  const read = readAuthErrorBody({
    error: "This endpoint has been replaced by Firebase Authentication.",
    code: "FIREBASE_CLIENT_AUTH_REQUIRED",
  });

  assert.equal(read.message, "This endpoint has been replaced by Firebase Authentication.");
  assert.equal(read.code, "FIREBASE_CLIENT_AUTH_REQUIRED");
  // The exact defect: the old `data.error.message` read produced "" here, so the
  // caller had nothing left but "Login failed".
  assert.notEqual(read.message, "");
});

test("a bare-string error body is read instead of discarded", () => {
  const read = readAuthErrorBody("Email already registered");
  assert.equal(read.message, "Email already registered");
  assert.equal(read.code, "");
});

test("a nested {error:{message,code}} body is read with its own code", () => {
  const read = readAuthErrorBody({
    error: { message: "Invalid email or password", code: "INVALID_PASSWORD" },
  });
  assert.equal(read.message, "Invalid email or password");
  assert.equal(read.code, "INVALID_PASSWORD");
});

test("a nested {error:{error}} body falls back to the inner string", () => {
  const read = readAuthErrorBody({ error: { error: "Nope" }, code: "OUTER" });
  assert.equal(read.message, "Nope");
  assert.equal(read.code, "OUTER");
});

test("a top-level {message} body is read", () => {
  const read = readAuthErrorBody({ message: "Too many attempts", code: "RATE_LIMIT_EXCEEDED" });
  assert.equal(read.message, "Too many attempts");
  assert.equal(read.code, "RATE_LIMIT_EXCEEDED");
});

test("unreadable bodies report no message so the caller can choose its fallback", () => {
  for (const body of [null, undefined, 42, {}, { error: null }, { error: 7 }, []]) {
    const read = readAuthErrorBody(body);
    assert.equal(read.message, "", `expected no message for ${JSON.stringify(body)}`);
  }
});
