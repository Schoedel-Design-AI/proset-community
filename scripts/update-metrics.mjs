#!/usr/bin/env node
// Update public/metrics.json with public business numbers for the open-metrics
// page (proset.ai/metrics.html). Hosted-only tool — excluded from the CE
// export by the scripts/ directory scrub.
//
// Run: node --env-file-if-exists=.env scripts/update-metrics.mjs
//
// Sources (best-effort — a missing credential skips its source):
//   - Stripe:     STRIPE_SECRET_KEY              -> paying subscribers + MRR (USD, monthly equiv.)
//   - Firestore:  FIREBASE_SERVICE_ACCOUNT_PATH  -> registered users (server-side count)
//
// Never prints or stores secret values.

import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "public/metrics.json");

const stripeKey = process.env.STRIPE_SECRET_KEY;
const credPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;

const sources = { stripe: false, firestore: false };
let users = null;
let payingSubscribers = null;
let mrrUsd = null;

// ---- Stripe: active subscriptions -> count + MRR (USD, monthly equivalent) ----
if (stripeKey) {
  try {
    let subs = [];
    let cursor = null;
    let pages = 0;
    do {
      const url = new URL("https://api.stripe.com/v1/subscriptions");
      url.searchParams.set("status", "active");
      url.searchParams.set("limit", "100");
      if (cursor) url.searchParams.set("starting_after", cursor);
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${stripeKey}` },
      });
      if (!res.ok) throw new Error(`Stripe HTTP ${res.status}`);
      const page = await res.json();
      subs = subs.concat(page.data);
      cursor = page.has_more ? page.data[page.data.length - 1].id : null;
      pages++;
      if (pages > 20) throw new Error("Stripe pagination cap (2000 subs) exceeded");
    } while (cursor);
    payingSubscribers = subs.length;
    mrrUsd = Math.round(
      (subs.reduce((sum, s) => {
        const price = s.items?.data?.[0]?.price;
        if (!price || price.currency !== "usd" || !price.unit_amount) return sum;
        const interval = price.recurring?.interval ?? "month";
        const count = price.recurring?.interval_count ?? 1;
        const monthly =
          interval === "year" ? (price.unit_amount / 12)
          : interval === "week" ? (price.unit_amount * 52) / 12
          : interval === "day" ? (price.unit_amount * 365) / 12
          : price.unit_amount;
        return sum + monthly / count;
      }, 0) / 100),
    );
    sources.stripe = true;
  } catch (err) {
    console.warn("Stripe source failed:", err.message);
  }
}

// ---- Firestore: users count (server-side aggregation query) ----
if (credPath || process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  try {
    // This script reports the PRODUCTION public number — never the local
    // emulator. .env may set FIRESTORE_EMULATOR_HOST for dev workflows.
    delete process.env.FIRESTORE_EMULATOR_HOST;
    delete process.env.FIRESTORE_EMULATOR_PROJECT_ID;
    const { initializeApp, cert, getApps } = await import("firebase-admin/app");
    const { getFirestore } = await import("firebase-admin/firestore");
    if (!getApps().length) {
      if (credPath) {
        initializeApp({
          credential: cert(JSON.parse(readFileSync(credPath, "utf8"))),
        });
      } else {
        // Application Default Credentials (GOOGLE_APPLICATION_CREDENTIALS
        // or gcloud's default ADC file).
        initializeApp();
      }
    }
    const countSnap = await getFirestore().collection("users").count().get();
    users = countSnap.data().count;
    sources.firestore = true;
  } catch (err) {
    console.warn("Firestore source failed:", err.message);
  }
}

if (!sources.stripe && !sources.firestore) {
  console.error(
    "No data sources available (need STRIPE_SECRET_KEY and/or FIREBASE_SERVICE_ACCOUNT_PATH).",
  );
  process.exit(1);
}

const metrics = {
  updated: new Date().toISOString().slice(0, 10),
  users,
  payingSubscribers,
  mrrUsd,
  sources,
};
writeFileSync(OUT, JSON.stringify(metrics, null, 2) + "\n");
console.log("Wrote", OUT, JSON.stringify(metrics));
