#!/usr/bin/env node

/**
 * Recover the fixture documents deleted by cleanup-fixture-users.mjs, read-only.
 *
 * Firestore keeps a rolling version-retention window (1 hour when PITR is
 * disabled), so deleted documents remain readable at a past read_time. This
 * script finds a read_time from BEFORE the deletion, dumps every affected
 * document to a 0600 JSON file, and prints a masked inventory for review.
 *
 * It NEVER writes to Firestore. Restoring is a separate, explicit decision.
 *
 * USAGE
 *   SA_PATH=$(grep -E "^FIREBASE_SERVICE_ACCOUNT_PATH=" .env | cut -d= -f2-)
 *   env -u FIRESTORE_EMULATOR_HOST GOOGLE_APPLICATION_CREDENTIALS="$SA_PATH" \
 *     node scripts/recover-deleted-fixture-docs.mjs production [--out=/abs/path.json]
 */

import { writeFileSync, mkdirSync, chmodSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { readFileSync } from "node:fs";
import process from "node:process";
import { applicationDefault, deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";

const CONFIG_PATH = new URL("../config/firebase-auth-environments.json", import.meta.url);
const config = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));

const AFFECTED_COLLECTIONS = [
  "users",
  "developerApiKeys",
  "recordingContexts",
  "recordings",
  "thoughtThreadItems",
  "thoughtThreads",
  "usage_events",
  "userModules",
];
const OWNER_FIELDS = ["userId", "user_id", "uid", "ownerId"];
const TEST_DOMAIN = "@example.test";
/** Field names whose values must never be printed in the inventory. */
const SENSITIVE_FIELDS = /key|secret|token|hash|password/i;

const args = process.argv.slice(2);
const environment = args.find((a) => !a.startsWith("--"));
const outFlag = args.find((a) => a.startsWith("--out="));
if (!environment || !config.environments[environment]) {
  console.error("Usage: node scripts/recover-deleted-fixture-docs.mjs <staging|production> [--out=path]");
  process.exit(2);
}
if (process.env.FIRESTORE_EMULATOR_HOST) {
  console.error("FIRESTORE_EMULATOR_HOST is set. Re-run with `env -u FIRESTORE_EMULATOR_HOST`.");
  process.exit(2);
}

const projectId = config.environments[environment].projectId;
const app = initializeApp({ credential: applicationDefault(), projectId }, `proset-recover-${process.pid}`);
const db = getFirestore(app);

/** Count fixture users visible at a given read_time. */
async function countFixtureUsersAt(readTime) {
  return db.runTransaction(
    async (tx) => {
      const snap = await tx.get(db.collection("users"));
      return snap.docs.filter((d) => String(d.data().email || "").toLowerCase().endsWith(TEST_DOMAIN)).length;
    },
    { readOnly: true, readTime },
  );
}

function maskValue(key, value) {
  if (typeof value === "string" && SENSITIVE_FIELDS.test(key) && value.length > 6) {
    return `${value.slice(0, 3)}…<masked:${value.length}chars>`;
  }
  return value;
}

function maskEmail(email) {
  return String(email || "").replace(/^(.)[^@]*@/, "$1***@");
}

try {
  // Walk backwards from now to find a snapshot that still contains the fixtures.
  let chosen = null;
  let fixtureCount = 0;
  for (let minutesBack = 2; minutesBack <= 58; minutesBack += 2) {
    const candidate = Timestamp.fromDate(new Date(Date.now() - minutesBack * 60_000));
    let count;
    try {
      count = await countFixtureUsersAt(candidate);
    } catch (error) {
      // Outside the retention window (or readTime unsupported) — stop probing.
      if (/read_time|retention|FAILED_PRECONDITION|INVALID_ARGUMENT/i.test(error.message)) continue;
      throw error;
    }
    if (count > 0) {
      chosen = candidate;
      fixtureCount = count;
      break;
    }
  }

  if (!chosen) {
    console.error(
      JSON.stringify(
        {
          result: "UNRECOVERABLE",
          reason:
            "No snapshot within the version-retention window still contains the fixture users. " +
            "PITR is disabled on this database, so the 1-hour window has closed.",
        },
        null,
        2,
      ),
    );
    process.exitCode = 1;
  } else {
    const readTimeIso = chosen.toDate().toISOString();
    const dump = await db.runTransaction(
      async (tx) => {
        const usersSnap = await tx.get(db.collection("users"));
        const fixtures = usersSnap.docs.filter((d) =>
          String(d.data().email || "").toLowerCase().endsWith(TEST_DOMAIN),
        );
        const uids = new Set(fixtures.map((d) => d.id));
        const emails = new Set(fixtures.map((d) => String(d.data().email || "").toLowerCase()));

        const out = {};
        for (const name of AFFECTED_COLLECTIONS) {
          const snap = await tx.get(db.collection(name));
          const matched = snap.docs.filter((doc) => {
            const data = doc.data();
            return (
              uids.has(doc.id) ||
              OWNER_FIELDS.some((f) => typeof data[f] === "string" && uids.has(data[f])) ||
              (typeof data.email === "string" && emails.has(data.email.toLowerCase()))
            );
          });
          if (matched.length > 0) {
            out[name] = matched.map((doc) => ({ id: doc.id, data: doc.data() }));
          }
        }
        return out;
      },
      { readOnly: true, readTime: chosen },
    );

    const outPath = resolve(
      outFlag ? outFlag.slice("--out=".length) : `${process.env.HOME}/.local/share/proset/deleted-fixture-docs.json`,
    );
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, JSON.stringify({ projectId, readTimeIso, collections: dump }, null, 2), { mode: 0o600 });
    chmodSync(outPath, 0o600);

    const inventory = Object.entries(dump).map(([collection, docs]) => ({
      collection,
      count: docs.length,
      items: docs.map((doc) => {
        const owner = OWNER_FIELDS.map((f) => doc.data[f]).find((v) => typeof v === "string");
        const fields = {};
        for (const [k, v] of Object.entries(doc.data)) {
          if (["email", "name", "title", "label", "role", "cachedTier", "type", "eventType"].includes(k)) {
            fields[k] = k === "email" ? maskEmail(v) : maskValue(k, v);
          }
        }
        return { id: doc.id.length > 28 ? `${doc.id.slice(0, 28)}…` : doc.id, owner: owner || "(doc id is owner)", fields };
      }),
    }));

    console.log(
      JSON.stringify(
        {
          result: "RECOVERED",
          projectId,
          readTimeIso,
          fixtureUsersAtReadTime: fixtureCount,
          totalDocumentsCaptured: Object.values(dump).reduce((s, d) => s + d.length, 0),
          savedTo: outPath,
          fileMode: "0600",
          inventory,
        },
        null,
        2,
      ),
    );
  }
} finally {
  await deleteApp(app).catch(() => {});
}
