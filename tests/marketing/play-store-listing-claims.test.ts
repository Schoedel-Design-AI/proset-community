import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { SELF_SERVICE_MODULE_CATALOG } from "../../shared/self-service-modules";
import { TIER_CONVERSION_TYPES } from "../../server/usage-service";
import { PLAN_PRICES } from "../../shared/plan-limits";

/**
 * Play Store listing copy is re-uploaded by hand and reached by no deploy, so
 * nothing else in CI catches a numeric claim that no longer matches the
 * product. Historically the listing advertised "50+ conversion types" while
 * the catalogue has 37 — an overclaim that survived for months.
 *
 * This test pins two properties of the copy that can be checked against the
 * product itself: the conversion-type count and the tier prices. Anything else
 * in the listing (feature bullets, screenshots) is out of scope; add
 * assertions here when a claim can be tied to a value in `shared/`.
 *
 * If a listing legitimately reprices a plan, update PLAN_PRICES first — the
 * checkout catalogues read from that constant.
 */

const LISTING_FILES = [
  "docs/marketing/play-store-listing.md",
  "docs/marketing/play-store-listing.es.md",
];

function countConversionTypes(): number {
  const set = new Set<string>();
  for (const entry of Object.values(SELF_SERVICE_MODULE_CATALOG)) {
    if ("conversionTypes" in entry && Array.isArray(entry.conversionTypes)) {
      for (const type of entry.conversionTypes) set.add(type);
    }
  }
  for (const type of TIER_CONVERSION_TYPES.pro) set.add(type);
  return set.size;
}

test("no listing overclaims the conversion-type count", () => {
  const actual = countConversionTypes();
  for (const path of LISTING_FILES) {
    const body = readFileSync(path, "utf8");
    // Match any two-digit count immediately followed by conversion-type prose.
    const claim = /(\d+)(?:\+)?\s+(?:conversion types|tipos de conversi[oó]n)/gi;
    for (const match of body.matchAll(claim)) {
      const stated = Number(match[1]);
      assert.equal(
        stated,
        actual,
        `${path} claims "${match[0]}" but the product catalogue exposes ${actual}. ` +
          "Update the listing or, if the value moved, update the catalogue.",
      );
    }
  }
});

test("no listing advertises a stale plan price", () => {
  const expected = {
    base: (PLAN_PRICES.base.monthlyPrice / 100).toFixed(2),
    pro: (PLAN_PRICES.pro.monthlyPrice / 100).toFixed(2),
  };
  // The listings mention prices as "$3.49" / "$5.99". A stale amount would show
  // as a $-prefixed decimal that does not appear in PLAN_PRICES. This scan is
  // conservative: it flags any $-prefixed decimal that looks like a plan price
  // (single-digit dollars) that isn't the current base or pro price. Amounts
  // for add-ons, storage packs, and credit packs live elsewhere and are
  // intentionally not scanned here.
  const allowed = new Set<string>([expected.base, expected.pro]);
  for (const path of LISTING_FILES) {
    const body = readFileSync(path, "utf8");
    // Match "$N.NN" or "$N.NN/mo" style occurrences with a single-digit dollar
    // amount — that is the space plan prices actually live in.
    const candidates = body.match(/\$\d\.\d{2}\b/g) || [];
    for (const raw of candidates) {
      const amount = raw.slice(1); // drop the "$"
      assert.ok(
        allowed.has(amount) || amount === "0.99" || amount === "1.99" || amount === "2.99",
        `${path} contains "${raw}" which is not a current plan price (${expected.base} / ${expected.pro}). ` +
          "Either update the listing to match PLAN_PRICES or, if the plan repriced, update PLAN_PRICES first.",
      );
    }
  }
});
