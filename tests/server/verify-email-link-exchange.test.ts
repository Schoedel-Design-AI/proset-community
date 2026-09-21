import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { decideVerificationExchange } from "../../server/verify-email-link-policy";

/**
 * `POST /api/auth/verify-email-link` turns an activation link into a session, so
 * "which link may do that" is the whole security story. The rule is a pure
 * function; these tests pin the rule, and the source checks below pin the two
 * things a reviewer cannot see from the rule alone: the endpoint must stay
 * unauthenticated (the link IS the credential) and must never log the code.
 */

const EXPECTED = "VERIFY_EMAIL";

test("an activation link for an existing account may mint a session", () => {
  assert.deepEqual(
    decideVerificationExchange({
      requestType: EXPECTED,
      hasAccount: true,
      hasFirebaseIdentity: true,
      expectedRequestType: EXPECTED,
    }),
    { allow: true },
  );
});

test("password-reset and email-change codes are refused", () => {
  for (const requestType of ["PASSWORD_RESET", "VERIFY_AND_CHANGE_EMAIL", "EMAIL_SIGNIN", ""]) {
    assert.deepEqual(
      decideVerificationExchange({
        requestType,
        hasAccount: true,
        hasFirebaseIdentity: true,
        expectedRequestType: EXPECTED,
      }),
      { allow: false, code: "WRONG_ACTION_CODE" },
    );
  }
});

test("a link with no local account or no Firebase identity is refused", () => {
  assert.deepEqual(
    decideVerificationExchange({
      requestType: EXPECTED,
      hasAccount: false,
      hasFirebaseIdentity: true,
      expectedRequestType: EXPECTED,
    }),
    { allow: false, code: "NO_ACCOUNT" },
  );
  assert.deepEqual(
    decideVerificationExchange({
      requestType: EXPECTED,
      hasAccount: true,
      hasFirebaseIdentity: false,
      expectedRequestType: EXPECTED,
    }),
    { allow: false, code: "NO_ACCOUNT" },
  );
});

test("the endpoint is unauthenticated and never logs the code", () => {
  const source = readFileSync("server/auth.ts", "utf8");
  const route = source.match(/app\.post\("\/api\/auth\/verify-email-link"[\s\S]*?\n  \}\);/);
  assert.ok(route, "verify-email-link route not found");

  // The link IS the credential: requiring a session here would defeat the point.
  assert.doesNotMatch(route[0], /requireAuth/);
  // Never echo or log the code — it is a bearer credential for the account.
  for (const line of route[0].split("\n")) {
    if (/console\.(log|error|warn|info)/.test(line)) {
      assert.doesNotMatch(line, /oobCode/, `code leaked into a log line: ${line.trim()}`);
    }
  }
  // It must answer with a Firebase custom token (that is what signs the person
  // in) and mark the address verified in both stores.
  assert.match(route[0], /createCustomToken/);
  assert.match(route[0], /updateUser\(user\.id, \{ emailVerified: true \}\)/);
  assert.match(route[0], /storage\.users\.update\(user\.id, \{ emailVerified: 1 \}\)/);
});

test("the code reader uses the service account, not a bundled web API key", () => {
  const source = readFileSync("server/firebase-action-code.ts", "utf8");
  assert.match(source, /identitytoolkit\.googleapis\.com/);
  assert.match(source, /GoogleAuth/);
  // A public web API key in the runtime env was the alternative; we deliberately
  // avoid it (it is not plumbed into Cloud Run and drifts).
  assert.doesNotMatch(source, /AIFORMS_PUBLIC_FIREBASE_API_KEY/);
});
