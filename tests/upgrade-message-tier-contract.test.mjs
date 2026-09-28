import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

/**
 * A top-tier account must never be told to upgrade.
 *
 * Pro is the highest tier, so "Upgrade for more credits" is unactionable for a Pro
 * or comped (friends_of_barry) account — the user is shown a wall with no door,
 * which is exactly the dead end reported from production on 2026-09-22. The rule
 * this test enforces:
 *
 *   1. Credit-exhausted and storage-full copy is chosen from the account's tier,
 *      never hardcoded to the upgrade variant.
 *   2. The upgrade call-to-action is tier-aware.
 *   3. A top-tier account is only told to BUY something when the add-on cards are
 *      actually offered to it. Those cards are gated on `displayTier === "pro"`,
 *      and a comp reports displayTier "friends-of-barry" — so the "buy a pack"
 *      sentence must be a separate string that a comp never receives, otherwise the
 *      fix would replace one dead end with another.
 */

const read = (path) => readFile(path, "utf8");

const RECORDING_SCREEN = "app/recording/[id].tsx";
const RECORDINGS_LIST = "app/recordings.tsx";
const SUBSCRIPTION_PANEL = "app/settings/_subscription-panel.tsx";
const I18N = "lib/i18n.tsx";

test("the add-on cards are still gated on a paying Pro account", async () => {
  const panel = await read(SUBSCRIPTION_PANEL);
  // If this gate changes (e.g. comps become able to buy packs), the tier-aware copy
  // below must be revisited, so the assumption is asserted rather than assumed.
  assert.match(
    panel,
    /currentTier === "pro" && displayTier === "pro"/,
    "the AI Credit Pack / storage add-on cards are expected to be gated on currentTier and displayTier both being pro",
  );
});

test("the recording screen picks credit and storage copy from the tier", async () => {
  const screen = await read(RECORDING_SCREEN);

  assert.match(screen, /const isTopTier = userTier === "pro"/, "the screen must derive whether the account is already top tier");
  assert.match(
    screen,
    /const canBuyAddons = isTopTier && displayTier === "pro"/,
    "purchasability must mirror the Settings add-on gate (displayTier === \"pro\")",
  );

  // No call site may hardcode the upgrade variant any more.
  const hardcodedCredits = screen.match(/setUpgradeMessage\(t\("upgrade\.insufficientTokens"/g) || [];
  assert.equal(hardcodedCredits.length, 0, "credit-exhausted copy must come from creditsExhaustedMessage(), not a hardcoded upgrade string");

  const hardcodedUpgradeCta = screen.match(/accessibilityLabel=\{t\("upgrade\.upgradeNow"/g) || [];
  assert.equal(hardcodedUpgradeCta.length, 0, "the upgrade CTA label must be tier-aware");

  for (const helper of ["creditsExhaustedMessage", "storageFullMessage"]) {
    assert.match(screen, new RegExp(`const ${helper} = \\(\\) => \\{`), `${helper}() must exist`);
  }
  assert.match(screen, /t\(\(canBuyAddons \? "upgrade\.creditsExhaustedProBuy" : "upgrade\.creditsExhaustedPro"\) as any\)/);
  assert.match(screen, /t\(\(canBuyAddons \? "upgrade\.storageFullPro" : "upgrade\.storageFullTop"\) as any\)/);
});

test("the media-import path is tier-aware too", async () => {
  const list = await read(RECORDINGS_LIST);
  assert.match(
    list,
    /insufficient_tokens: topTier\s*\?\s*\(canBuyAddons \? "upgrade\.creditsExhaustedProBuy" : "upgrade\.creditsExhaustedPro"\)\s*:\s*"mediaImport\.error\.insufficient_tokens"/,
    "the import error must not offer an upgrade to a top-tier account",
  );
});

test("the top-tier copy exists in both languages and promises nothing unbuyable", async () => {
  const i18n = await read(I18N);
  const keys = [
    "upgrade.creditsExhaustedPro",
    "upgrade.creditsExhaustedProBuy",
    "upgrade.storageFullPro",
    "upgrade.storageFullTop",
    "upgrade.managePlan",
  ];
  for (const key of keys) {
    const occurrences = i18n.split(`"${key}"`).length - 1;
    assert.equal(occurrences, 2, `${key} must exist exactly once per language, found ${occurrences}`);
  }

  // The variant a comped account receives must not mention buying a credit pack,
  // and no top-tier variant may mention upgrading a plan.
  const plain = i18n.match(/"upgrade\.creditsExhaustedPro": "([^"]+)"/)[1];
  assert.doesNotMatch(plain, /credit pack/i, "the comped-account variant must not offer a credit pack it cannot buy");
  for (const key of keys) {
    const line = i18n.match(new RegExp(`"${key.replace(".", "\\.")}": "([^"]+)"`))[1];
    assert.doesNotMatch(line, /\bupgrade\b/i, `${key} must not tell a top-tier account to upgrade`);
  }
});
