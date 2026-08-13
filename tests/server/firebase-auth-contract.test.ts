import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { parseFirebaseAuthMode } from "../../server/firebase-admin";

test("Firebase auth mode defaults safely and rejects unknown values", () => {
  assert.equal(parseFirebaseAuthMode(undefined), "legacy");
  assert.equal(parseFirebaseAuthMode("legacy"), "legacy");
  assert.equal(parseFirebaseAuthMode("dual"), "dual");
  assert.equal(parseFirebaseAuthMode("firebase"), "firebase");
  assert.throws(() => parseFirebaseAuthMode("automatic"), /Invalid FIREBASE_AUTH_MODE/);
});

test("Firebase verification checks revocation and forbids UID rewriting", () => {
  const source = readFileSync("server/firebase-admin.ts", "utf8");
  assert.match(source, /verifyIdToken\(token, true\)/);
  assert.match(source, /Automatic UID rewriting is forbidden/);
  assert.doesNotMatch(source, /storage\.users\.delete\(userByEmail\.id\)/);
  assert.doesNotMatch(source, /storage\.users\.create\(/);
  assert.match(source, /Profiles must be created by the server-controlled registration/);
});

test("legacy signup no longer derives UIDs from email local parts", () => {
  const source = readFileSync("server/auth.ts", "utf8");
  assert.match(source, /const uid = randomUUID\(\)/);
  assert.doesNotMatch(source, /const uid = `mock-uid-\$\{cleanEmail\.split/);
});

test("deployment keeps production legacy and stages the dual-token window", () => {
  const source = readFileSync("scripts/deploy.sh", "utf8");
  assert.match(source, /local firebase_auth_mode="legacy"/);
  assert.match(source, /firebase_auth_mode="dual"/);
  assert.match(source, /PROSET_ALLOW_PRODUCTION_FIREBASE_AUTH_CUTOVER=true/);
  assert.match(source, /firebase_auth_mode="\$PRODUCTION_FIREBASE_AUTH_MODE"/);
  assert.match(source, /FIREBASE_AUTH_MODE=\$\{firebase_auth_mode\}/);
});

test("web and native clients cover the complete password and TOTP lifecycle", () => {
  for (const file of [
    "lib/firebase-auth-client.web.ts",
    "lib/firebase-auth-client.ts",
  ]) {
    const source = readFileSync(file, "utf8");
    assert.match(source, /reauthenticateWithCredential/);
    assert.match(source, /verifyBeforeUpdateEmail/);
    assert.match(source, /verifyPasswordResetCode/);
    assert.match(source, /confirmPasswordReset/);
    assert.match(source, /TotpMultiFactorGenerator\.generateSecret/);
    assert.match(source, /TotpMultiFactorGenerator\.assertionForEnrollment/);
    assert.match(source, /TotpMultiFactorGenerator\.assertionForSignIn/);
    assert.match(source, /getMultiFactorResolver/);
  }
});

test("Firebase signup is server-controlled and legacy credential endpoints close after cutover", () => {
  const source = readFileSync("server/auth.ts", "utf8");
  assert.match(source, /validateTurnstileForSignup\(req\)/);
  assert.match(source, /firebaseAdminAuth\.createUser/);
  assert.match(source, /firebaseAdminAuth\.generateVerifyAndChangeEmailLink/);
  assert.match(source, /firebaseSignInRequired: true/);
  assert.match(source, /This endpoint has been replaced by Firebase Authentication/);
  assert.match(source, /Use the Firebase password-reset link sent to your email/);
  assert.match(source, /Use the Firebase TOTP enrollment flow in the Proset client/);
});

test("sensitive Firebase account operations enforce recent auth and revoke sessions", () => {
  const routes = readFileSync("server/routes.ts", "utf8");
  assert.match(routes, /ageSeconds > 5 \* 60/);
  assert.match(routes, /adminAuth\.updateUser\(targetUser\.id, \{ password: newPassword \}\)/);
  assert.match(routes, /adminAuth\.revokeRefreshTokens\(targetUser\.id\)/);
  assert.match(routes, /multiFactor: \{ enrolledFactors: null \}/);
  assert.match(routes, /await deleteAuthUserIfPresent\(adminAuth, targetUserId\)/);
});

test("production email actions use the canonical public origin, never an untrusted Host header", () => {
  const source = readFileSync("server/auth.ts", "utf8");
  assert.match(source, /process\.env\.PUBLIC_APP_URL\?\.trim\(\)/);
  assert.match(source, /PUBLIC_APP_URL is required for production email action links/);
  assert.match(source, /return configured\.origin/);
});

test("Firebase client config is fail-closed in deployment and Android release builds", () => {
  const deploy = readFileSync("scripts/deploy.sh", "utf8");
  const stagingWorkflow = readFileSync(".github/workflows/deploy-staging.yml", "utf8");
  const android = readFileSync("scripts/build-android.sh", "utf8");
  const server = readFileSync("server/index.ts", "utf8");
  assert.match(deploy, /prepare-firebase-client-config\.mjs" staging/);
  assert.match(deploy, /unset AIFORMS_PUBLIC_FIREBASE_API_KEY/);
  assert.match(deploy, /A valid AIFORMS_PUBLIC_TURNSTILE_SITE_KEY is required/);
  assert.match(deploy, /--build-arg AIFORMS_PUBLIC_TURNSTILE_SITE_KEY=/);
  assert.match(deploy, /--update-env-vars "AIFORMS_PUBLIC_TURNSTILE_SITE_KEY=/);
  assert.match(stagingWorkflow, /AIFORMS_PUBLIC_TURNSTILE_SITE_KEY: \$\{\{ vars\.AIFORMS_PUBLIC_TURNSTILE_SITE_KEY \}\}/);
  assert.match(android, /prepare-firebase-client-config\.mjs" production/);
  assert.match(android, /production Firebase Android configuration is missing/);
  assert.match(server, /https:\/\/identitytoolkit\.googleapis\.com/);
  assert.match(server, /https:\/\/securetoken\.googleapis\.com/);
});

test("Turnstile stays registration-only and preserves its responsive placement contract", () => {
  const login = readFileSync("app/login.tsx", "utf8");
  const landing = readFileSync("server/templates/landing-page.html", "utf8");
  assert.match(login, /mode !== "register"\) return/);
  assert.match(
    login,
    /mode === "register" && Platform\.OS === "web" && TURNSTILE_SITE_KEY/,
  );
  assert.match(login, /clientWidth < 300 \? "compact" : "flexible"/);
  assert.match(login, /layout\.width < 372 && styles\.formSectionNarrow/);
  assert.match(
    login,
    /turnstileContainer: \{[\s\S]*width: "100%"[\s\S]*marginTop: 0[\s\S]*marginBottom: 8/,
  );
  assert.doesNotMatch(landing, /cf-turnstile|TURNSTILE_SITE_KEY/);
});

test("Firebase environments never bootstrap or rewrite imported credentials at startup", () => {
  const bootstrap = readFileSync("server/test-admin-bootstrap.ts", "utf8");
  const deploy = readFileSync("scripts/deploy.sh", "utf8");
  assert.match(bootstrap, /if \(firebaseAuthMode !== "legacy"\)/);
  assert.match(bootstrap, /Verified imported \$\{label\} identity without mutating credentials/);
  assert.match(deploy, /deploy_staging\(\)[\s\S]*"\$STAGING_REGISTRATION_OPEN"\s*\\\n\s*"false"/);
});

test("Firebase smoke testing can prove the deployed backend accepts an ID token", () => {
  const smoke = readFileSync("scripts/smoke-firebase-auth.mjs", "utf8");
  assert.match(smoke, /PROSET_FIREBASE_AUTH_SMOKE_BASE_URL/);
  assert.match(smoke, /Authorization: `Bearer \$\{exchange\.idToken\}`/);
  assert.match(smoke, /backendFirebaseIdTokenAccepted/);
  assert.match(smoke, /backendUidMatch/);
  assert.match(smoke, /serverRegistrationPolicyMatch/);
});
