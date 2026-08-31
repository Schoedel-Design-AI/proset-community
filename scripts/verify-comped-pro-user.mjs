#!/usr/bin/env node

/**
 * Prove a provisioned account's real entitlements against the LIVE API.
 *
 * This is the honest counterpart to scripts/provision-comped-pro-user.mjs:
 * writing Firestore fields proves nothing, because Proset derives tier at
 * request time (server/usage-service.ts). This script signs in as the user
 * through Firebase Identity Platform exactly as the app does, then reads the
 * authenticated endpoints and asserts the tier the server actually serves.
 *
 * USAGE
 *   node scripts/verify-comped-pro-user.mjs <staging|production> \
 *     --credential-file=/abs/path.txt [--base-url=https://proset.ai] \
 *     [--expect-tier=pro] [--expect-display-tier=friends-of-barry]
 *
 * Run with the emulator unset and the service account explicit (the Firebase
 * Management API call needs it to fetch the public web SDK apiKey):
 *   SA_PATH=$(grep -E "^FIREBASE_SERVICE_ACCOUNT_PATH=" .env | cut -d= -f2-)
 *   env -u FIRESTORE_EMULATOR_HOST GOOGLE_APPLICATION_CREDENTIALS="$SA_PATH" \
 *     node scripts/verify-comped-pro-user.mjs production --credential-file=...
 *
 * Reads the password from the 0600 credential file; never prints it.
 * Exits 0 only when every assertion passes.
 */

import { readFileSync } from "node:fs";
import process from "node:process";
import { applicationDefault, deleteApp, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { GoogleAuth } from "google-auth-library";

const CONFIG_PATH = new URL("../config/firebase-auth-environments.json", import.meta.url);
const config = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));

const DEFAULT_BASE_URLS = {
  production: "https://proset.ai",
  staging: "https://barry-ai-backend-staging-684959186248.us-central1.run.app",
};

/** Expected Pro allowances, from shared/plan-limits.ts. */
const PRO_EXPECTATIONS = {
  monthlyTokenAllowance: 200000,
  maxRecordingSeconds: 900,
  storageMb: 5120,
  maxFileImportMB: 50,
};

function parseArgs(argv) {
  const positional = [];
  const flags = new Map();
  for (const arg of argv) {
    if (arg.startsWith("--")) {
      const [key, ...rest] = arg.slice(2).split("=");
      flags.set(key, rest.length ? rest.join("=") : "true");
    } else {
      positional.push(arg);
    }
  }
  return { positional, flags };
}

const { positional, flags } = parseArgs(process.argv.slice(2));
const environment = positional[0];
const credentialFile = flags.get("credential-file");
const expectTier = flags.get("expect-tier") || "pro";
const expectDisplayTier = flags.get("expect-display-tier") || "friends-of-barry";

function fail(message, code = 2) {
  console.error(message);
  process.exit(code);
}

if (!environment || !config.environments[environment]) {
  fail("Usage: node scripts/verify-comped-pro-user.mjs <staging|production> --credential-file=<path>");
}
if (!credentialFile) fail("Provide --credential-file=<path> written by provision-comped-pro-user.mjs.");
if (process.env.FIRESTORE_EMULATOR_HOST) {
  fail("FIRESTORE_EMULATOR_HOST is set. Re-run with `env -u FIRESTORE_EMULATOR_HOST`.");
}

const baseUrl = String(flags.get("base-url") || DEFAULT_BASE_URLS[environment] || "").replace(/\/+$/, "");
if (!baseUrl) fail("Provide --base-url=<https://host> for this environment.");

/** Parse KEY=VALUE / KEY="VALUE" lines; values may contain '='. */
function readCredentials(path) {
  const out = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx < 1) continue;
    const key = trimmed.slice(0, idx);
    let value = trimmed.slice(idx + 1);
    if (value.startsWith('"') && value.endsWith('"') && value.length > 1) value = value.slice(1, -1);
    out[key] = value;
  }
  return out;
}

const creds = readCredentials(credentialFile);
const email = creds.PROSET_ACCOUNT_EMAIL;
const password = creds.PROSET_ACCOUNT_PASSWORD;
if (!email || !password) fail(`${credentialFile} must define PROSET_ACCOUNT_EMAIL and PROSET_ACCOUNT_PASSWORD.`);

const projectId = config.environments[environment].projectId;
const webAppId = config.environments[environment].apps?.web?.appId;
if (!webAppId) fail(`The ${environment} web app ID is missing from the environment contract.`);

const app = initializeApp({ credential: applicationDefault(), projectId }, `proset-verify-${process.pid}`);
const checks = [];

function record(name, pass, detail) {
  checks.push({ name, pass, detail });
}

try {
  const auth = getAuth(app);

  // The web SDK apiKey is a public client identifier, fetched the same way
  // scripts/smoke-firebase-auth.mjs does so no key has to be stored locally.
  const googleAuth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] });
  const googleClient = await googleAuth.getClient();
  const sdkConfig = await googleClient.request({
    url: `https://firebase.googleapis.com/v1beta1/projects/${projectId}/webApps/${webAppId}/config`,
    headers: { "X-Goog-User-Project": projectId },
  });
  const apiKey = sdkConfig.data.apiKey;
  if (!apiKey) throw new Error(`${environment} Firebase client API key is unavailable.`);

  const signInResponse = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    },
  );
  record("firebase password sign-in", signInResponse.ok, `HTTP ${signInResponse.status}`);
  if (!signInResponse.ok) throw new Error(`Sign-in failed with HTTP ${signInResponse.status}.`);
  const signIn = await signInResponse.json();

  // checkRevoked=true: the same verification the backend performs.
  const decoded = await auth.verifyIdToken(signIn.idToken, true);
  record("id token verifies (revocation-aware)", Boolean(decoded.uid), `uid=${decoded.uid}`);

  const authed = (path) =>
    fetch(`${baseUrl}${path}`, { headers: { Authorization: `Bearer ${signIn.idToken}` } });

  const meResponse = await authed("/api/auth/me");
  const me = await meResponse.json().catch(() => ({}));
  record("live API accepts the token (/api/auth/me)", meResponse.ok, `HTTP ${meResponse.status}`);
  record(
    "server resolves the same uid",
    (me?.user?.id || me?.id) === decoded.uid,
    `server=${me?.user?.id || me?.id || "none"}`,
  );

  const usageResponse = await authed("/api/usage");
  const usage = await usageResponse.json().catch(() => ({}));
  record("/api/usage reachable", usageResponse.ok, `HTTP ${usageResponse.status}`);
  record(`tier == ${expectTier}`, usage?.tier === expectTier, `tier=${usage?.tier}`);
  record(
    `displayTier == ${expectDisplayTier}`,
    usage?.displayTier === expectDisplayTier,
    `displayTier=${usage?.displayTier}`,
  );

  if (expectTier === "pro") {
    for (const [field, expected] of Object.entries(PRO_EXPECTATIONS)) {
      record(`${field} == ${expected}`, usage?.[field] === expected, `${field}=${usage?.[field]}`);
    }
    record("proAccessEnabled flag reported", usage?.proAccessEnabled === true, `proAccessEnabled=${usage?.proAccessEnabled}`);
  }

  const cloudSyncResponse = await authed("/api/cloud-sync");
  const cloudSync = await cloudSyncResponse.json().catch(() => ({}));
  record("/api/cloud-sync reachable", cloudSyncResponse.ok, `HTTP ${cloudSyncResponse.status}`);
  record("cloud sync entitled", cloudSync?.entitled === true, `entitled=${cloudSync?.entitled}`);

  const failed = checks.filter((check) => !check.pass);
  console.log(
    JSON.stringify(
      {
        environment,
        baseUrl,
        email,
        uid: decoded.uid,
        result: failed.length === 0 ? "PASS" : "FAIL",
        checks,
        comp: usage?.friendsOfBarry ?? null,
      },
      null,
      2,
    ),
  );
  process.exitCode = failed.length === 0 ? 0 : 1;
} catch (error) {
  console.error(`Verification error: ${error.message}`);
  console.error(JSON.stringify({ checks }, null, 2));
  process.exitCode = 1;
} finally {
  await deleteApp(app).catch(() => {});
}
