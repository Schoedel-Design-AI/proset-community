import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

/**
 * Purchase surfaces must FAIL OPEN.
 *
 * Barry's rule: if something is going to break, it should break inside the
 * process of people giving us money rather than in the process of people not
 * giving us money. Concretely, every gate between a willing customer and a
 * checkout must default to "sell", and stopping sales must be a deliberate
 * explicit `false` that is visible in the deploy log.
 *
 * The failure this guards against is silent: a hidden Buy button or a 503 with
 * no operator-visible error looks like "no demand", not "we are switched off".
 */

const read = (path) => readFile(path, "utf8");

test("the client shows add-on purchases when the billing status cannot be read", async () => {
  const panel = await read("app/settings/_subscription-panel.tsx");
  assert.match(
    panel,
    /const \[addonPurchasesEnabled, setAddonPurchasesEnabled\] = useState\(true\)/,
    "the add-on panel must render before/without a successful status fetch",
  );
  assert.doesNotMatch(
    panel,
    /setAddonPurchasesEnabled\(billingStatus\?\.addonPurchasesEnabled === true\)/,
    "reading the flag must not treat a missing field as 'paused'",
  );
  assert.match(
    panel,
    /setAddonPurchasesEnabled\(billingStatus\?\.addonPurchasesEnabled !== false\)/,
    "only an explicit false may hide add-on checkout",
  );
});

test("the client shows plan purchases when the billing status cannot be read", async () => {
  for (const path of ["app/choose-plan.tsx", "app/settings/_subscription-panel.tsx"]) {
    const source = await read(path);
    assert.match(
      source,
      /const \[planPurchasesEnabled, setPlanPurchasesEnabled\] = useState\(true\)/,
      `${path} must default plan purchases to on`,
    );
    assert.match(
      source,
      /setPlanPurchasesEnabled\(billingStatus\?\.planPurchasesEnabled !== false\)/,
      `${path} must only hide plan checkout on an explicit false`,
    );
  }
});

test("no purchase surface gates on an explicit-true check", async () => {
  // Which purchase flags each surface is responsible for. Absence of an
  // unrelated flag is not a failure; absence of an expected one is.
  const expectations = {
    "app/choose-plan.tsx": ["planPurchasesEnabled"],
    "app/settings/_subscription-panel.tsx": ["planPurchasesEnabled", "addonPurchasesEnabled"],
    "server/billing-policy.ts": ["planPurchasesEnabled", "addonPurchasesEnabled"],
  };
  for (const [path, flags] of Object.entries(expectations)) {
    const lines = (await read(path)).split("\n");
    for (const flag of flags) {
      const owning = lines.filter((line) => line.includes(flag));
      assert.ok(owning.length > 0, `${path} should mention ${flag}`);
      for (const line of owning) {
        // `enabledOnlyWhenExplicitlyTrue` is reserved for parked PRODUCTS (Music
        // Pack). Routing a plumbing flag through it re-creates the silent
        // revenue stop this whole contract exists to prevent.
        assert.doesNotMatch(
          line,
          /enabledOnlyWhenExplicitlyTrue/,
          `${path} must not route ${flag} through the parked-product helper: ${line.trim()}`,
        );
      }
    }
  }
});
