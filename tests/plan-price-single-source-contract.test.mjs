import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

/**
 * Legacy plan prices keep resurfacing. They survive in copies that are not the
 * source of truth, and one of those copies feeds the PUBLIC Community Edition
 * repo, which AI crawlers read — so a retired price in a snapshot becomes an
 * answer a model repeats back.
 *
 * This test derives the real prices from shared/plan-limits.ts and fails if any
 * price-bearing surface disagrees, or if any of them still quotes a retired
 * price. Because the expectation is derived, changing the price in the canonical
 * file updates this guard automatically; only surfaces that lag will fail.
 *
 * Retired prices checked here are plan/membership only. $9.99 and $4.99 remain
 * VALID as one-time AI Credit pack prices, which is why the retired patterns
 * require a "/mo" or "/month" suffix.
 */

const read = (path) => readFile(path, "utf8");

// Every file that states a plan price to a human, a crawler, or a developer.
const PRICE_SURFACES = [
  "server/templates/llms-full.txt",
  "scripts/ce-export/extra/server/templates/llms-full.txt",
  "lib/i18n.tsx",
  "docs-site/docs/reference/plans-and-limits.md",
  "docs-site/i18n/es/docusaurus-plugin-content-docs/current/reference/plans-and-limits.md",
  "docs/android-billing.md",
  "docs/cheat-sheet.md",
  "server/templates/landing-page.html",
  "scripts/ce-export/overrides/server/templates/landing-page.html",
];

// Retired plan prices, each anchored to a subscription cadence so one-time
// credit-pack prices are not caught by mistake. `$9.99/mo` is nevertheless a
// REAL price for the Music Pack add-on, so matches on those lines are excluded
// via `allowIfLineMatches` — the concern is the plan price board, not the add-on.
const RETIRED_PLAN_PRICES = [
  { pattern: /\$5\s*\/\s*(mo|month)\b/, label: "$5/mo" },
  { pattern: /\$10\s*\/\s*(mo|month)\b/, label: "$10/mo" },
  { pattern: /\$49\.95/, label: "$49.95/yr" },
  { pattern: /\$99\.95/, label: "$99.95/yr" },
  {
    pattern: /\$9\.99\s*\/\s*(mo|month)\b/,
    label: "$9.99/mo plan",
    allowIfLineMatches: /music/i,
  },
  { pattern: /\$19\.99\s*\/\s*(mo|month)\b/, label: "$19.99/mo plan" },
  { pattern: /\$4\.99\s*\/\s*(mo|month)\b/, label: "$4.99/mo (retired Cloud Sync)" },
];

const fmt = (cents) => `$${(cents / 100).toFixed(2)}`;

async function canonicalPrices() {
  const limits = await read("shared/plan-limits.ts");
  const grab = (tier) => {
    const m = limits.match(
      new RegExp(`${tier}:\\s*\\{[^}]*monthlyPrice:\\s*(\\d+)[^}]*yearlyPrice:\\s*(\\d+)`),
    );
    assert.ok(m, `shared/plan-limits.ts must declare ${tier} pricing`);
    return { monthly: Number(m[1]), yearly: Number(m[2]) };
  };
  return { base: grab("base"), pro: grab("pro") };
}

test("shared/plan-limits.ts is the single source of plan prices", async () => {
  const { base, pro } = await canonicalPrices();
  // Guards against a silently empty parse making every other assertion vacuous.
  assert.ok(base.monthly > 0 && base.yearly > 0, "base prices must parse");
  assert.ok(pro.monthly > 0 && pro.yearly > 0, "pro prices must parse");
});

test("every price surface quotes the canonical plan prices", async () => {
  const { base, pro } = await canonicalPrices();
  const needed = [fmt(base.monthly), fmt(pro.monthly)];
  for (const path of PRICE_SURFACES) {
    const source = await read(path);
    for (const price of needed) {
      assert.ok(
        source.includes(price),
        `${path} does not quote ${price}; it has drifted from shared/plan-limits.ts`,
      );
    }
  }
});

test("no price surface still quotes a retired plan price", async () => {
  for (const path of PRICE_SURFACES) {
    const source = await read(path);
    source.split("\n").forEach((line, i) => {
      for (const { pattern, label, allowIfLineMatches } of RETIRED_PLAN_PRICES) {
        if (allowIfLineMatches && allowIfLineMatches.test(line)) continue;
        assert.doesNotMatch(
          line,
          pattern,
          `${path}:${i + 1} still quotes the retired ${label}: ${line.trim().slice(0, 110)}`,
        );
      }
    });
  }
});

test("the Community Edition overlay does not drift from the live llms file", async () => {
  // This is the specific leak: the CE overlay is a snapshot pushed to the public
  // repo, so if it lags the live file the retired price reaches AI crawlers and
  // comes back in model answers.
  const live = await read("server/templates/llms-full.txt");
  const ce = await read("scripts/ce-export/extra/server/templates/llms-full.txt");
  const pricingLine = (source) =>
    source.split("\n").find((line) => /^(Current|Web launch) pricing:/.test(line.trim()));
  const liveLine = pricingLine(live);
  const ceLine = pricingLine(ce);
  assert.ok(liveLine, "the live llms-full.txt must state pricing");
  assert.ok(ceLine, "the CE llms-full.txt must state pricing");
  assert.equal(
    ceLine.trim(),
    liveLine.trim(),
    "the CE overlay pricing line must match the live one verbatim",
  );
});

test("the retired Cloud Sync add-on is not advertised at a price", async () => {
  // Cloud Sync was absorbed into the plans; /api/stripe/cloud-sync-checkout
  // returns 404, so any price beside those CTAs is fiction.
  // A price, not a JS template literal: require a dollar sign followed by a digit.
  const pricePattern = /\$\d/;
  const integrations = await read("app/settings/integrations.tsx");
  const cloudSyncLabels = integrations
    .split("\n")
    .filter((line) => /Cloud Sync/.test(line) && pricePattern.test(line));
  assert.deepEqual(
    cloudSyncLabels.map((l) => l.trim()),
    [],
    "Cloud Sync CTAs must not carry a price; the standalone add-on was retired",
  );
});
