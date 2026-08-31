#!/usr/bin/env node

/**
 * Delete test-fixture user documents (and everything they own) from Firestore.
 *
 * WHY THIS EXISTS
 * ---------------
 * A test suite that ran without FIRESTORE_EMULATOR_HOST wrote fixture users
 * (`@example.test`, synthetic UIDs like `dev-user-<uuid>`, `stripe-pro-<uuid>`,
 * `owner`) into the PRODUCTION project. They inflate user counts and they trip
 * `audit-firebase-auth-migration.mjs`'s hard lockout signal
 * (`firestoreUidsMissingFromFirebase`), so the daily auth drift watchdog alarms
 * every run and a real lockout would hide in the noise.
 *
 * SAFETY MODEL
 * ------------
 * A document is only ever a candidate when BOTH hold:
 *   1. its email ends with an allowed test domain (default `@example.test`), and
 *   2. its UID does NOT exist in Firebase Authentication.
 * Any candidate failing either test aborts the whole run — a Firestore user that
 * IS in Firebase Auth is a real account, and a non-test domain means the
 * heuristic is wrong. Dry run is the default; production needs an env gate.
 *
 * USAGE
 *   node scripts/cleanup-fixture-users.mjs <staging|production> [--apply]
 *     [--allow-domain=@example.test] [--json]
 *
 *   SA_PATH=$(grep -E "^FIREBASE_SERVICE_ACCOUNT_PATH=" .env | cut -d= -f2-)
 *   env -u FIRESTORE_EMULATOR_HOST GOOGLE_APPLICATION_CREDENTIALS="$SA_PATH" \
 *     PROSET_ALLOW_PRODUCTION_FIXTURE_CLEANUP=true \
 *     node scripts/cleanup-fixture-users.mjs production --apply
 */

import { readFileSync } from "node:fs";
import process from "node:process";
import { applicationDefault, deleteApp, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

const CONFIG_PATH = new URL("../config/firebase-auth-environments.json", import.meta.url);
const config = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));

/** Fields that carry an owning user id across Proset collections. */
const OWNER_FIELDS = ["userId", "user_id", "uid", "ownerId"];
/** Fields that carry an owning user email (e.g. verifications). */
const OWNER_EMAIL_FIELDS = ["identifier", "email", "userEmail"];

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
const apply = flags.get("apply") === "true";
const allowedDomain = String(flags.get("allow-domain") || "@example.test").toLowerCase();

function fail(message, code = 2) {
  console.error(message);
  process.exit(code);
}

if (!environment || !config.environments[environment]) {
  fail("Usage: node scripts/cleanup-fixture-users.mjs <staging|production> [--apply]");
}
if (process.env.FIRESTORE_EMULATOR_HOST) {
  fail("FIRESTORE_EMULATOR_HOST is set. Re-run with `env -u FIRESTORE_EMULATOR_HOST`.");
}
if (apply && environment === "production" && process.env.PROSET_ALLOW_PRODUCTION_FIXTURE_CLEANUP !== "true") {
  fail("Production cleanup is locked. Set PROSET_ALLOW_PRODUCTION_FIXTURE_CLEANUP=true only for an approved window.");
}

const projectId = config.environments[environment].projectId;
const app = initializeApp({ credential: applicationDefault(), projectId }, `proset-fixture-cleanup-${process.pid}`);
const auth = getAuth(app);
const db = getFirestore(app);

async function listAllFirebaseUids() {
  const uids = new Set();
  let pageToken;
  do {
    const page = await auth.listUsers(1000, pageToken);
    page.users.forEach((user) => uids.add(user.uid));
    pageToken = page.pageToken;
  } while (pageToken);
  return uids;
}

try {
  const firebaseUids = await listAllFirebaseUids();
  const usersSnap = await db.collection("users").get();

  const candidates = [];
  for (const doc of usersSnap.docs) {
    const email = String(doc.data().email || "").toLowerCase();
    if (!email.endsWith(allowedDomain)) continue;
    candidates.push({ uid: doc.id, email });
  }

  if (candidates.length === 0) {
    console.log(JSON.stringify({ environment, projectId, candidates: 0, message: "Nothing to clean." }, null, 2));
    process.exit(0);
  }

  // Abort rather than delete anything that could be a real, signable account.
  const signable = candidates.filter((candidate) => firebaseUids.has(candidate.uid));
  if (signable.length > 0) {
    fail(
      `Refusing to run: ${signable.length} ${allowedDomain} user(s) exist in Firebase Auth and could be real accounts: ` +
        signable.map((candidate) => candidate.uid).join(", "),
      1,
    );
  }

  const candidateUids = new Set(candidates.map((candidate) => candidate.uid));
  const candidateEmails = new Set(candidates.map((candidate) => candidate.email));

  // Sweep every collection for documents owned by a fixture user, matching on
  // owner id fields, owner email fields, or a doc id equal to the fixture uid.
  const collections = await db.listCollections();
  const plan = [];
  for (const collection of collections) {
    const snap = await collection.get();
    const doomed = [];
    for (const doc of snap.docs) {
      const data = doc.data();
      const ownedById =
        candidateUids.has(doc.id) ||
        OWNER_FIELDS.some((field) => typeof data[field] === "string" && candidateUids.has(data[field]));
      const ownedByEmail = OWNER_EMAIL_FIELDS.some(
        (field) => typeof data[field] === "string" && candidateEmails.has(data[field].toLowerCase()),
      );
      if (ownedById || ownedByEmail) doomed.push(doc.ref);
    }
    if (doomed.length > 0) plan.push({ collection: collection.id, count: doomed.length, refs: doomed });
  }

  const totalDocs = plan.reduce((sum, entry) => sum + entry.count, 0);
  const summary = {
    environment,
    projectId,
    mode: apply ? "applied" : "dry-run",
    allowedDomain,
    fixtureUsers: candidates.length,
    documentsMatched: totalDocs,
    byCollection: plan.map(({ collection, count }) => ({ collection, count })),
    sampleUids: candidates.slice(0, 5).map((candidate) => candidate.uid),
  };

  if (!apply) {
    console.log(JSON.stringify({ ...summary, note: "Re-run with --apply to delete." }, null, 2));
    process.exit(0);
  }

  let deleted = 0;
  for (const entry of plan) {
    // Batched writes cap at 500 operations.
    for (let i = 0; i < entry.refs.length; i += 400) {
      const batch = db.batch();
      entry.refs.slice(i, i + 400).forEach((ref) => batch.delete(ref));
      await batch.commit();
      deleted += Math.min(400, entry.refs.length - i);
    }
  }

  // Prove the fixtures are gone rather than trusting the batch result.
  const verifySnap = await db.collection("users").get();
  const remaining = verifySnap.docs.filter((doc) =>
    String(doc.data().email || "").toLowerCase().endsWith(allowedDomain),
  ).length;

  console.log(
    JSON.stringify(
      { ...summary, documentsDeleted: deleted, remainingFixtureUsers: remaining, usersCollectionSize: verifySnap.size },
      null,
      2,
    ),
  );
  process.exitCode = remaining === 0 ? 0 : 1;
} finally {
  await deleteApp(app).catch(() => {});
}
