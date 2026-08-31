#!/usr/bin/env node

/**
 * Provision a comped Pro ("Friends of Barry") account directly through the
 * Firebase Admin SDK.
 *
 * WHY THIS EXISTS
 * ---------------
 * `scripts/friend.sh` calls `POST /api/auth/sign-in/email` to mint an admin
 * bearer token, but that endpoint returns HTTP 410 in every non-legacy
 * FIREBASE_AUTH_MODE (see server/auth.ts). Production runs in `firebase` mode,
 * so the shell helper can no longer provision anyone. This script performs the
 * same write the sanctioned admin route does
 * (`POST /api/admin/friends-of-barry/invite`, server/routes.ts) without needing
 * an HTTP session, and it sets a known password instead of emailing a reset
 * link — required when the target address has no reachable mailbox.
 *
 * WHY "friends_of_barry" AND NOT cachedTier: "pro"
 * -----------------------------------------------
 * Tier is derived, never stored. `getUserTier()` / `getUserTierFast()`
 * (server/usage-service.ts) resolve: role -> RevenueCat entitlements -> Stripe
 * subscription -> cached tier. Writing `cachedTier: "pro"` reverts to free once
 * the 10-minute tier cache goes stale, because the Stripe fallback reports
 * `free` with no active subscription. The `friends_of_barry` role short-circuits
 * to "pro" in BOTH the fast and slow resolvers, so it is the only comped-Pro
 * path that holds in every code path today.
 *
 * USAGE
 *   node scripts/provision-comped-pro-user.mjs <staging|production> \
 *     --email=user@example.com [--name="Full Name"] [--term-months=12] \
 *     [--credential-out=/abs/path.txt] [--apply]
 *
 * Dry run is the default. Production writes additionally require:
 *   PROSET_ALLOW_PRODUCTION_USER_PROVISION=true
 *
 * ALWAYS run with the emulator unset and the service account explicit:
 *   SA_PATH=$(grep -E "^FIREBASE_SERVICE_ACCOUNT_PATH=" .env | cut -d= -f2-)
 *   env -u FIRESTORE_EMULATOR_HOST GOOGLE_APPLICATION_CREDENTIALS="$SA_PATH" \
 *     node scripts/provision-comped-pro-user.mjs production --email=...
 *
 * The generated password is NEVER printed; it is written to a 0600 file whose
 * path is reported so it can be filed in the vault Secrets.md by hand.
 */

import { randomInt } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { applicationDefault, deleteApp, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

const CONFIG_PATH = new URL("../config/firebase-auth-environments.json", import.meta.url);
const config = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));

/** Mirrors FRIENDS_OF_BARRY_TERM_MONTHS in server/password-policy.ts. */
const DEFAULT_TERM_MONTHS = 12;
/** Comfortably above USER_PASSWORD_MIN_LENGTH in shared/password-validation.ts. */
const PASSWORD_LENGTH = 24;

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
const email = String(flags.get("email") || "").trim().toLowerCase();
const displayName = String(flags.get("name") || "").trim();
const apply = flags.get("apply") === "true";
const termMonths = Number(flags.get("term-months") || DEFAULT_TERM_MONTHS);

function fail(message, code = 2) {
  console.error(message);
  process.exit(code);
}

if (!environment || !config.environments[environment]) {
  fail("Usage: node scripts/provision-comped-pro-user.mjs <staging|production> --email=<address> [--name=<name>] [--apply]");
}
if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  fail("Provide a valid --email=<address>.");
}
if (!Number.isInteger(termMonths) || termMonths < 1 || termMonths > 60) {
  fail("--term-months must be an integer between 1 and 60.");
}

// Pitfall guard: .env sets FIRESTORE_EMULATOR_HOST, which silently hijacks
// firebase-admin and would "provision" a user into the emulator.
if (process.env.FIRESTORE_EMULATOR_HOST) {
  fail(
    "FIRESTORE_EMULATOR_HOST is set. Re-run with `env -u FIRESTORE_EMULATOR_HOST` so this writes to the real project.",
  );
}
if (!process.env.GOOGLE_APPLICATION_CREDENTIALS && !process.env.FIREBASE_SERVICE_ACCOUNT_PATH) {
  fail("Set GOOGLE_APPLICATION_CREDENTIALS to the service account JSON for this environment.");
}
if (apply && environment === "production" && process.env.PROSET_ALLOW_PRODUCTION_USER_PROVISION !== "true") {
  fail("Production provisioning is locked. Set PROSET_ALLOW_PRODUCTION_USER_PROVISION=true only for an approved window.");
}

const projectId = config.environments[environment].projectId;

const UPPERCASE = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const LOWERCASE = "abcdefghijkmnopqrstuvwxyz";
const DIGITS = "23456789";
const SPECIALS = "!@#$%^&*()-_=+[]{}";

/** Cryptographically random password with one character from each class. */
function generatePassword(length = PASSWORD_LENGTH) {
  const pools = [UPPERCASE, LOWERCASE, DIGITS, SPECIALS];
  const all = pools.join("");
  const chars = pools.map((pool) => pool[randomInt(pool.length)]);
  while (chars.length < length) chars.push(all[randomInt(all.length)]);
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

const app = initializeApp({ credential: applicationDefault(), projectId }, `proset-provision-${process.pid}`);
const auth = getAuth(app);
const db = getFirestore(app);
db.settings({ ignoreUndefinedProperties: true });

async function assertAbsent() {
  let firebaseExisting = null;
  try {
    firebaseExisting = await auth.getUserByEmail(email);
  } catch (error) {
    if (error.code !== "auth/user-not-found") throw error;
  }
  const firestoreExisting = await db.collection("users").where("email", "==", email).limit(1).get();
  return { firebaseExisting, firestoreExisting: firestoreExisting.empty ? null : firestoreExisting.docs[0] };
}

/** users.create() in server/firestore-storage.ts assigns a random 6-digit number. */
async function allocateUserNumber() {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const candidate = randomInt(1_000_000);
    const clash = await db.collection("users").where("userNumber", "==", candidate).limit(1).get();
    if (clash.empty) return candidate;
  }
  throw new Error("Could not allocate a unique userNumber.");
}

function buildUserDocument({ uid, userNumber, grantedAt, expiresAt }) {
  const nowIso = grantedAt.toISOString();
  const firstName = displayName ? displayName.split(" ")[0] : "";
  return {
    // Shape mirrors POST /api/admin/friends-of-barry/invite in server/routes.ts,
    // merged with the defaults storage.users.create() applies.
    id: uid,
    email,
    name: displayName || "",
    firstName,
    userNumber,
    role: "friends_of_barry",
    cachedTier: "base",
    tierCachedAt: nowIso,
    cloudSyncEnabled: 1,
    emailVerified: 1,
    hasSeenPlanSelection: 1,
    forcePasswordChange: 0,
    twoFactorEnabled: 0,
    proAccessEnabled: 0,
    tokenBalance: 0,
    tokenAllowanceMonth: null,
    storageAddonGb: 0,
    friendsOfBarryGrantedAt: nowIso,
    friendsOfBarryExpiresAt: expiresAt.toISOString(),
    friendsOfBarryRenewedAt: null,
    createdAt: nowIso,
    updatedAt: nowIso,
  };
}

function writeCredentialFile(path, { uid, password, expiresAt }) {
  const target = resolve(path);
  mkdirSync(dirname(target), { recursive: true });
  const body = [
    `# Proset comped Pro account (${environment})`,
    `# Generated ${new Date().toISOString()} by scripts/provision-comped-pro-user.mjs`,
    `# File this in the vault Secrets.md, then delete this file.`,
    `PROSET_ACCOUNT_EMAIL=${email}`,
    `PROSET_ACCOUNT_PASSWORD="${password}"`,
    `PROSET_ACCOUNT_UID=${uid}`,
    `PROSET_ACCOUNT_ROLE=friends_of_barry`,
    `PROSET_ACCOUNT_COMP_EXPIRES_AT=${expiresAt.toISOString()}`,
    "",
  ].join("\n");
  writeFileSync(target, body, { mode: 0o600 });
  chmodSync(target, 0o600);
  return target;
}

try {
  const { firebaseExisting, firestoreExisting } = await assertAbsent();
  if (firebaseExisting || firestoreExisting) {
    fail(
      `Refusing to provision: ${email} already exists (` +
        `firebaseAuth=${firebaseExisting ? firebaseExisting.uid : "absent"}, ` +
        `firestore=${firestoreExisting ? firestoreExisting.id : "absent"}). ` +
        "Elevate the existing account with PATCH /api/admin/users/:id instead.",
      1,
    );
  }

  const grantedAt = new Date();
  const expiresAt = new Date(grantedAt);
  expiresAt.setMonth(expiresAt.getMonth() + termMonths);

  if (!apply) {
    console.log(
      JSON.stringify(
        {
          mode: "dry-run",
          environment,
          projectId,
          email,
          name: displayName || "",
          role: "friends_of_barry",
          effectiveTier: "pro (derived from role)",
          termMonths,
          grantedAt: grantedAt.toISOString(),
          expiresAt: expiresAt.toISOString(),
          wouldCreate: ["firebase-auth user (emailVerified=true)", "firestore users/<uid> document"],
        },
        null,
        2,
      ),
    );
    process.exit(0);
  }

  const password = generatePassword();
  const userRecord = await auth.createUser({
    email,
    password,
    displayName: displayName || undefined,
    emailVerified: true,
  });

  let userNumber;
  try {
    userNumber = await allocateUserNumber();
    const doc = buildUserDocument({ uid: userRecord.uid, userNumber, grantedAt, expiresAt });
    await db.collection("users").doc(userRecord.uid).set(doc);
  } catch (error) {
    // Never leave an orphaned Firebase identity with no Firestore profile:
    // that user would be able to sign in with no record and no entitlements.
    await auth.deleteUser(userRecord.uid).catch(() => {});
    throw error;
  }

  const credentialPath = writeCredentialFile(
    flags.get("credential-out") || `${process.env.HOME}/.local/share/proset/provisioned-${email.replace(/[^a-z0-9]+/gi, "-")}.txt`,
    { uid: userRecord.uid, password, expiresAt },
  );

  console.log(
    JSON.stringify(
      {
        mode: "applied",
        environment,
        projectId,
        uid: userRecord.uid,
        email,
        userNumber,
        role: "friends_of_barry",
        effectiveTier: "pro",
        emailVerified: true,
        termMonths,
        grantedAt: grantedAt.toISOString(),
        expiresAt: expiresAt.toISOString(),
        credentialFile: credentialPath,
        credentialFileMode: "0600",
      },
      null,
      2,
    ),
  );
} finally {
  await deleteApp(app).catch(() => {});
}
