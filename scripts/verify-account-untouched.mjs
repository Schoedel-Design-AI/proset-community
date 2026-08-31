#!/usr/bin/env node
/**
 * Prove a specific account and everything it owns were untouched by the
 * fixture cleanup: compares a pre-deletion read_time snapshot against now.
 * Read-only.
 *
 *   node scripts/verify-account-untouched.mjs production --email=schoedelb@gmail.com \
 *     --before=2026-08-29T03:43:19.561Z
 */
import { readFileSync } from "node:fs";
import process from "node:process";
import { applicationDefault, deleteApp, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, Timestamp } from "firebase-admin/firestore";

const config = JSON.parse(readFileSync(new URL("../config/firebase-auth-environments.json", import.meta.url), "utf8"));
const args = process.argv.slice(2);
const environment = args.find((a) => !a.startsWith("--"));
const email = (args.find((a) => a.startsWith("--email=")) || "").slice("--email=".length).toLowerCase();
const before = (args.find((a) => a.startsWith("--before=")) || "").slice("--before=".length);

if (!environment || !config.environments[environment] || !email || !before) {
  console.error("Usage: node scripts/verify-account-untouched.mjs <env> --email=<addr> --before=<ISO>");
  process.exit(2);
}
if (process.env.FIRESTORE_EMULATOR_HOST) {
  console.error("FIRESTORE_EMULATOR_HOST is set. Re-run with `env -u FIRESTORE_EMULATOR_HOST`.");
  process.exit(2);
}

const OWNER_FIELDS = ["userId", "user_id", "uid", "ownerId"];
const projectId = config.environments[environment].projectId;
const app = initializeApp({ credential: applicationDefault(), projectId }, `verify-untouched-${process.pid}`);
const db = getFirestore(app);
const auth = getAuth(app);

async function ownedCounts(uid, readTime) {
  const run = async (tx) => {
    const collections = ["users", "recordings", "recordingContexts", "thoughtThreads", "thoughtThreadItems",
      "usage_events", "userModules", "developerApiKeys", "accounts", "sessions", "userFiles", "userFolders",
      "userLearnings", "usageLimits", "usageReservations", "bucketFiles"];
    const counts = {};
    for (const name of collections) {
      const snap = await tx.get(db.collection(name));
      const n = snap.docs.filter((d) => {
        const data = d.data();
        return d.id === uid || OWNER_FIELDS.some((f) => data[f] === uid);
      }).length;
      if (n > 0) counts[name] = n;
    }
    return counts;
  };
  return readTime
    ? db.runTransaction(run, { readOnly: true, readTime })
    : db.runTransaction(run, { readOnly: true });
}

try {
  const authUser = await auth.getUserByEmail(email).catch(() => null);
  const snap = await db.collection("users").where("email", "==", email).get();
  const uid = authUser?.uid || (snap.empty ? null : snap.docs[0].id);
  if (!uid) {
    console.log(JSON.stringify({ result: "ACCOUNT MISSING", email }, null, 2));
    process.exit(1);
  }

  const doc = snap.empty ? null : snap.docs[0].data();
  const beforeCounts = await ownedCounts(uid, Timestamp.fromDate(new Date(before)));
  const nowCounts = await ownedCounts(uid, null);

  const collections = new Set([...Object.keys(beforeCounts), ...Object.keys(nowCounts)]);
  const diffs = [...collections]
    .map((c) => ({ collection: c, before: beforeCounts[c] || 0, now: nowCounts[c] || 0 }))
    .filter((row) => row.before !== row.now);

  console.log(JSON.stringify({
    result: diffs.length === 0 ? "UNTOUCHED" : "CHANGED",
    email,
    uid,
    firebaseAuth: authUser
      ? { exists: true, disabled: authUser.disabled, emailVerified: authUser.emailVerified, lastSignIn: authUser.metadata.lastSignInTime }
      : { exists: false },
    firestoreProfile: doc
      ? { exists: true, role: doc.role, cachedTier: doc.cachedTier, userNumber: doc.userNumber, twoFactorEnabled: doc.twoFactorEnabled }
      : { exists: false },
    ownedDocumentsBefore: beforeCounts,
    ownedDocumentsNow: nowCounts,
    differences: diffs,
  }, null, 2));
  process.exitCode = diffs.length === 0 && authUser && doc ? 0 : 1;
} finally {
  await deleteApp(app).catch(() => {});
}
