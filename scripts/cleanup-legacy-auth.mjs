#!/usr/bin/env node

// Legacy auth cleanup — removes material no longer used after the Firebase
// cutover:
//   1. legacy session rows (all — they are rejected in firebase mode),
//   2. legacy bcrypt credential accounts (Firebase Auth now owns the hashes),
//   3. legacy TOTP secrets / backup codes and stale twoFactorEnabled flags
//      (twoFactorEnabled is re-derived from Firebase enrollment by /api/auth/me).
//
// Usage: node scripts/cleanup-legacy-auth.mjs <staging|production> [--apply]
//
// Dry-run by default (reports counts only). Production apply is double-gated:
//   PROSET_ALLOW_PRODUCTION_LEGACY_CLEANUP=true
//   PROSET_LEGACY_CLEANUP_FIREBASE_MODE_CONFIRMED=true  (deployed FIREBASE_AUTH_MODE verified as firebase)
// Apply refuses if any Firestore user is missing from Firebase Auth — deleting
// credential rows would lock them out. Idempotent: rerunning deletes nothing.

import { readFileSync } from "node:fs";
import { applicationDefault, deleteApp, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

const CONFIG_PATH = new URL("../config/firebase-auth-environments.json", import.meta.url);
const config = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
const args = new Set(process.argv.slice(2));
const environment = process.argv.slice(2).find((arg) => !arg.startsWith("--"));
const apply = args.has("--apply");

if (!environment || !config.environments[environment]) {
  console.error("Usage: node scripts/cleanup-legacy-auth.mjs <staging|production> [--apply]");
  process.exit(2);
}

if (
  environment === "production"
  && apply
  && process.env.PROSET_ALLOW_PRODUCTION_LEGACY_CLEANUP !== "true"
) {
  console.error(
    "Production legacy cleanup is locked. Set PROSET_ALLOW_PRODUCTION_LEGACY_CLEANUP=true only during an approved cleanup window.",
  );
  process.exit(2);
}

if (
  environment === "production"
  && apply
  && process.env.PROSET_LEGACY_CLEANUP_FIREBASE_MODE_CONFIRMED !== "true"
) {
  console.error(
    "Production legacy cleanup requires PROSET_LEGACY_CLEANUP_FIREBASE_MODE_CONFIRMED=true "
    + "after verifying the deployed FIREBASE_AUTH_MODE is 'firebase'.",
  );
  process.exit(2);
}

const expected = config.environments[environment];
const projectId = expected.projectId;

async function listAllFirebaseUsers(auth) {
  const users = [];
  let pageToken;
  do {
    const page = await auth.listUsers(1000, pageToken);
    users.push(...page.users);
    pageToken = page.pageToken;
  } while (pageToken);
  return users;
}

const app = initializeApp(
  { credential: applicationDefault(), projectId },
  `proset-legacy-cleanup-${environment}-${process.pid}`,
);

try {
  const db = getFirestore(app);
  const auth = getAuth(app);

  const [usersSnap, sessionsSnap, accountsSnap, firebaseUsers] = await Promise.all([
    db.collection("users").get(),
    db.collection("sessions").get(),
    db.collection("accounts").get(),
    listAllFirebaseUsers(auth),
  ]);

  const users = usersSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  const sessions = sessionsSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  const credentialAccounts = accountsSnap.docs
    .map((doc) => ({ id: doc.id, ...doc.data() }))
    .filter((account) => account.providerId === "credential");

  const firebaseUids = new Set(firebaseUsers.map((user) => user.uid));

  // Lockout guard: every Firestore user must have a Firebase identity before
  // their legacy credential row may be removed.
  const missingFromFirebase = users.filter((user) => !firebaseUids.has(user.id));
  if (missingFromFirebase.length > 0) {
    throw new Error(
      `REFUSED: ${missingFromFirebase.length} user(s) missing from Firebase Auth — cleanup would lock them out: `
      + missingFromFirebase.map((u) => u.email).join(", "),
    );
  }

  // Key presence, not truthiness: legacy fields may be null placeholders.
  const totpMaterialUsers = users.filter((u) => "twoFactorSecret" in u || "twoFactorBackupCodes" in u);
  const twoFactorFlagUsers = users.filter((u) => u.twoFactorEnabled === 1);
  const firebaseMfaUids = new Set(
    firebaseUsers
      .filter((u) => u.multiFactor?.enrolledFactors?.length > 0)
      .map((u) => u.uid),
  );

  const summary = {
    environment,
    projectId,
    mode: apply ? "apply" : "dry-run",
    firebaseUsers: firebaseUsers.length,
    counts: {
      legacySessions: sessions.length,
      legacyCredentialAccounts: credentialAccounts.length,
      legacyTotpMaterialUsers: totpMaterialUsers.map((u) => u.email),
      twoFactorFlagUsers: twoFactorFlagUsers.map((u) => u.email),
      firebaseMfaUsers: firebaseMfaUids.size,
    },
  };
  console.log(JSON.stringify(summary, null, 2));

  if (!apply) {
    console.log("Dry run passed. No legacy material was deleted or modified.");
    process.exit(0);
  }

  // --- Apply phase (batched) ---
  let deletedSessions = 0;
  for (let offset = 0; offset < sessions.length; offset += 400) {
    const batch = db.batch();
    sessions.slice(offset, offset + 400).forEach((s) => batch.delete(db.collection("sessions").doc(s.id)));
    await batch.commit();
    deletedSessions += Math.min(400, sessions.length - offset);
  }

  let deletedAccounts = 0;
  for (let offset = 0; offset < credentialAccounts.length; offset += 400) {
    const batch = db.batch();
    credentialAccounts.slice(offset, offset + 400).forEach((a) => batch.delete(db.collection("accounts").doc(a.id)));
    await batch.commit();
    deletedAccounts += Math.min(400, credentialAccounts.length - offset);
  }

  let updatedUsers = 0;
  for (const user of users) {
    const updates = {};
    if (user.twoFactorSecret !== undefined) updates.twoFactorSecret = FieldValue.delete();
    if (user.twoFactorBackupCodes !== undefined) updates.twoFactorBackupCodes = FieldValue.delete();
    if (user.twoFactorEnabled === 1) updates.twoFactorEnabled = firebaseMfaUids.has(user.id) ? 1 : 0;
    if (Object.keys(updates).length === 0) continue;
    await db.collection("users").doc(user.id).update(updates);
    updatedUsers++;
  }

  console.log(JSON.stringify({
    environment,
    projectId,
    applied: {
      deletedLegacySessions: deletedSessions,
      deletedCredentialAccounts: deletedAccounts,
      updatedUsers: updatedUsers,
    },
  }, null, 2));

  if (deletedSessions !== sessions.length || deletedAccounts !== credentialAccounts.length) {
    throw new Error("Cleanup did not complete as expected; verify with a fresh dry run.");
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await deleteApp(app);
}
