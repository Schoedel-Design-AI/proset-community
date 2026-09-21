import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

/**
 * Subscription must be findable from the surfaces a user actually looks at.
 *
 * Reported 2026-09-20: "It was almost impossible to find a way to subscribe."
 * Two causes, both fixed here and both easy to reintroduce:
 *   1. the drawer's Subscription row rendered only when `!isPro`, so it was
 *      hidden from exactly the accounts already on a paid plan;
 *   2. the avatar dropdown had no subscription entry at all.
 * A comment mentioning the old gate must not satisfy the guard, so comments are
 * stripped before asserting.
 */

const stripComments = (source) =>
  source
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "") // JSX comments
    .replace(/\/\*[\s\S]*?\*\//g, "")     // block comments
    .replace(/^\s*\/\/.*$/gm, "");        // line comments

const read = async (path) => readFile(path, "utf8");

test("the drawer no longer hides the subscription row from paid accounts", async () => {
  const drawer = stripComments(await read("components/NavigationDrawer.tsx"));
  assert.doesNotMatch(
    drawer,
    /!isPro/,
    "the subscription row must not be gated on a free plan — that hides it from subscribers",
  );
  assert.match(drawer, /testID="drawer-subscribe"/, "the drawer must still expose the subscription row");
  assert.match(
    drawer,
    /label=\{isPro \? t\("subscription\.title"\) : t\("drawer\.subscribe"\)\}/,
    "the label must adapt: free accounts are invited to subscribe, paid accounts see their plan",
  );
});

test("the avatar menu routes to subscription at the top level", async () => {
  const dropdown = stripComments(await read("components/ProfileDropdown.tsx"));
  assert.match(dropdown, /testID="dropdown-subscription"/, "the avatar menu needs a subscription entry");
  assert.match(
    dropdown,
    /onPress=\{\(\) => navigate\("\/choose-plan"\)\}/,
    "the avatar menu entry must route to the plans page",
  );
  // Tri-state: an unknown tier must not tell a paying customer to subscribe.
  assert.match(
    dropdown,
    /isPaidPlan === false \? t\("drawer\.subscribe"\) : t\("subscription\.title"\)/,
    "only a known-free account should read 'Subscribe'",
  );
});

test("every surface that knows the tier tells the menu about it", async () => {
  const callSites = {
    "app/index.tsx": "isPaidPlan",
    "app/recordings.tsx": "isPaidPlan",
    "app/recording/[id].tsx": "userTier",
  };
  for (const [path, source] of Object.entries(callSites)) {
    const file = await read(path);
    const render = file.split("\n").find((line) => line.includes("<ProfileDropdown"));
    assert.ok(render, `${path} should render the profile dropdown`);
    assert.match(
      render,
      /isPaidPlan=/,
      `${path} knows the tier and must pass it, or the menu guesses the label`,
    );
  }
});

test("both languages define the subscription labels the new routes use", async () => {
  const i18n = await read("lib/i18n.tsx");
  for (const key of ["drawer.subscribe", "subscription.title"]) {
    const occurrences = i18n.split(`"${key}"`).length - 1;
    assert.ok(
      occurrences >= 2,
      `${key} must exist in both the English and Spanish dictionaries (found ${occurrences})`,
    );
  }
});

test("the post-purchase route home is not web-only", async () => {
  const page = stripComments(await read("app/choose-plan.tsx"));
  const gate = page.split("\n").find((line) => line.includes("checkoutConfirmedTier ||"));
  assert.ok(gate, "the forward action must render from a state check");
  assert.doesNotMatch(
    gate,
    /Platform\.OS/,
    "the way home after buying must work on web and Android alike",
  );
});

test("leaving the account/subscription area goes UP to settings, not back into checkout", async () => {
  const page = stripComments(await read("app/settings/account.tsx"));
  // This screen is where a completed Stripe purchase returns
  // (`?tab=subscription&tokens=success&session_id=...`), so browser history still
  // holds the checkout redirect chain. A history pop therefore re-entered
  // Stripe's finished checkout — back into a process the customer had already
  // paid for — instead of offering a way out of the subscription area. The back
  // affordance must route to the parent settings screen explicitly, from every
  // entry path.
  assert.doesNotMatch(page, /router\.back\(\)/, "the back arrow must not pop browser history");
  assert.doesNotMatch(page, /canGoBack\(\)/, "…not even behind a canGoBack guard");
  assert.match(
    page,
    /router\.replace\("\/settings" as any\)/,
    "the back arrow must route up to the settings hub",
  );
});

test("every settings back arrow goes UP a level, never back through history", async () => {
  // One rule for the whole settings area: a back arrow moves one level UP the
  // hierarchy to a fixed parent. It never pops history, because history can hold
  // a completed Stripe checkout, a drawer jump, or another customer's session on
  // a shared device — none of which is "the screen before this one".
  const parents = {
    "app/settings/index.tsx": null, // leaving settings goes to the app
    "app/settings/account.tsx": "/settings",
    "app/settings/ai-config.tsx": "/settings",
    "app/settings/developer.tsx": "/settings",
    "app/settings/integrations.tsx": "/settings",
    "app/settings/preferences.tsx": "/settings",
  };
  for (const [path, parent] of Object.entries(parents)) {
    const page = stripComments(await read(path));
    assert.doesNotMatch(page, /router\.back\(\)/, `${path} must not pop browser history`);
    assert.doesNotMatch(page, /canGoBack\(\)/, `${path} must not branch on history`);
    const expected = parent === null ? 'router.replace("/")' : `router.replace("${parent}" as any)`;
    assert.ok(
      page.includes(expected),
      `${path} must route up to ${parent ?? "the app"} (expected ${expected})`,
    );
  }
});

test("a paying account's subscription table demotes the Free tier to a footnote", async () => {
  const panel = stripComments(await read("app/settings/_subscription-panel.tsx"));
  // The Free tier has no action on this screen, so as a full card it only
  // enumerates what a paying customer does NOT have and puts a downgrade in
  // front of the account the panel exists to retain.
  assert.match(
    panel,
    /isPayingAccount \? \(\["base", "pro"\] as PublicTier\[\]\) : \(\["free", "base", "pro"\] as PublicTier\[\]\)/,
    "the table must lead with the buyable plans for a paying account",
  );
  assert.match(panel, /styles\.footnoteRow/, "the Free tier needs its demoted footnote row");
  assert.match(
    panel,
    /const isPayingAccount = planActive/,
    "the split must follow the account's billing source, not the environment",
  );
});
