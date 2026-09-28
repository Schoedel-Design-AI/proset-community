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

/**
 * The `<ProfileDropdown ... />` element on its own. Non-greedy up to the
 * self-closing `/>` (never an unbounded `[\s\S]*`), so an assertion about the
 * menu cannot be satisfied — or broken — by something else in the screen.
 */
const profileDropdownElement = (source) => {
  const match = source.match(/<ProfileDropdown\b[\s\S]*?\/>/);
  assert.ok(match, "expected the screen to render a <ProfileDropdown ... /> element");
  return match[0];
};

/**
 * Every screen that renders the avatar menu, mapped to the right inset its own
 * positioning parent needs:
 *   - `app/index.tsx` and `app/record.tsx` render the menu inside
 *     `styles.appShell`, which is itself the centred column (`maxWidth`), so the
 *     header row's own `contentPadding` is already measured from that parent's
 *     edge;
 *   - `app/recordings.tsx` and `app/recording/[id].tsx` render it straight into
 *     the window-spanning root container while the header row inside is centred
 *     with `maxWidth`, so the centring offset must be added — a bare
 *     `contentPadding` would put the menu at the window edge on a wide viewport.
 *     A phone cannot see that difference (the centring offset is 0 there).
 *
 * The `scripts/ce-export/overrides/` entries are verbatim overlays of the same
 * three screens: the open-core export copies them over the CE tree, so a
 * main-side change to the menu's REQUIRED props breaks the export's `tsc` gate
 * unless the override is mirrored. Same parent shapes, same expectations.
 */
const AVATAR_MENU_HOSTS = {
  "app/index.tsx": "rightOffset={layout.contentPadding}",
  "app/record.tsx": "rightOffset={layout.contentPadding}",
  "app/recordings.tsx": "rightOffset={contentColumnRightInset(layout)}",
  "app/recording/[id].tsx": "rightOffset={contentColumnRightInset(layout)}",
  "scripts/ce-export/overrides/app/index.tsx": "rightOffset={layout.contentPadding}",
  "scripts/ce-export/overrides/app/recordings.tsx": "rightOffset={contentColumnRightInset(layout)}",
  "scripts/ce-export/overrides/app/recording/[id].tsx": "rightOffset={contentColumnRightInset(layout)}",
};

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
  for (const path of Object.keys(callSites)) {
    const element = profileDropdownElement(stripComments(await read(path)));
    assert.match(
      element,
      /isPaidPlan=/,
      `${path} knows the tier and must pass it on the menu element, or the menu guesses the label`,
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

/**
 * Avatar menu anchoring (bug #262).
 *
 * The menu placed itself from a hardcoded screen-top constant
 * (`insets.top + 92`) with its own `right: 14`. Copying those magic numbers into
 * the four hosts did not fix the report — the menu still opened well below the
 * avatar and rode the screen's right edge, and each screen drifted to its own
 * constant. The rule now is: derive both offsets from the MEASURED geometry of
 * the header row that holds the avatar, and keep the one gap constant in the
 * component. An absolute child's `top` is measured from its positioning
 * parent's edge, and `onLayout` reports the row in that same space — so the
 * row's measured bottom is directly usable, with no safe-area term on top.
 */

test("the menu component takes its geometry from the host, not a screen constant", async () => {
  const dropdown = stripComments(await read("components/ProfileDropdown.tsx"));
  assert.match(
    dropdown,
    /export const AVATAR_MENU_ANCHOR_GAP = 8;/,
    "the anchoring gap must be exported once so all four hosts share it",
  );
  assert.match(dropdown, /topOffset: number;/, "the menu must receive its top offset from the host");
  assert.match(dropdown, /rightOffset: number;/, "the menu must receive its right inset from the host");
  assert.doesNotMatch(
    dropdown,
    /(topOffset|rightOffset)\s*=\s*\d/,
    "both offsets are required props with no default: a fallback lets a host compile with an unpositioned menu",
  );
  assert.doesNotMatch(
    dropdown,
    /useSafeAreaInsets|insets\.top/,
    "the component must not know the screen top — the measured row bottom already accounts for it",
  );
  assert.doesNotMatch(dropdown, /right:\s*\d/, "the menu must not carry its own hardcoded right inset");
});

test("every host anchors the menu to its own measured header row", async () => {
  for (const [path, rightInset] of Object.entries(AVATAR_MENU_HOSTS)) {
    const file = stripComments(await read(path));
    assert.match(
      file,
      /onLayout=\{\(e\) => setHeaderBottom\(e\.nativeEvent\.layout\.y \+ e\.nativeEvent\.layout\.height\)\}/,
      `${path} must measure the header row that holds the avatar`,
    );
    const element = profileDropdownElement(file);
    assert.ok(
      element.includes("topOffset={headerBottom + AVATAR_MENU_ANCHOR_GAP}"),
      `${path} must anchor the menu at the measured row bottom plus the one shared gap`,
    );
    assert.ok(
      element.includes(rightInset),
      `${path} must use the right inset its positioning parent shape requires (${rightInset})`,
    );
    assert.doesNotMatch(element, /rightOffset=\{\d/, `${path} must not hardcode a right inset`);
  }
});

test("no host anchors the avatar menu from a screen-top constant", async () => {
  // The regression to keep out is `insets.top + webTopInset + <number>` used as
  // the menu's offset. `app/recording/[id].tsx` (and its CE override) still uses
  // that shape as the `paddingTop` of a full-screen modal — a different element,
  // not this menu — so the guard is keyed on the expression, not on the file.
  for (const path of Object.keys(AVATAR_MENU_HOSTS)) {
    const file = stripComments(await read(path));
    for (const line of file.split("\n")) {
      if (!/insets\.top \+ webTopInset \+ \s*\d/.test(line)) continue;
      assert.doesNotMatch(
        line,
        /topOffset|rightOffset|ProfileDropdown|styles\.menu|\btop:/,
        `${path} must not anchor the avatar menu from a screen-top constant`,
      );
    }
    assert.doesNotMatch(
      profileDropdownElement(file),
      /insets\.top/,
      `${path} must not put a safe-area term on the menu element`,
    );
  }
});

test("the right-inset helper the window-spanning hosts use degenerates to contentPadding on a phone", async () => {
  // The wide-screen failure is invisible on a phone, so the arithmetic itself is
  // executed here rather than eyeballed. The helper is pure (no React import of
  // its own), so its shipped body can be run directly.
  const lib = await read("lib/useResponsiveLayout.ts");
  const match = lib.match(
    /export function contentColumnRightInset\(layout: ResponsiveLayout\): number \{([\s\S]*?)\n\}/,
  );
  assert.ok(match, "lib/useResponsiveLayout.ts must export contentColumnRightInset(layout)");
  const contentColumnRightInset = new Function("layout", match[1]);
  // Mobile: contentMaxWidth === width, so the centring offset is 0.
  assert.equal(
    contentColumnRightInset({ width: 402, contentMaxWidth: 402, contentPadding: 16 }),
    16,
    "on a phone the helper is exactly contentPadding",
  );
  // Desktop (1440 wide, 840 content column, 32 padding): centred at 300px in.
  assert.equal(
    contentColumnRightInset({ width: 1440, contentMaxWidth: 840, contentPadding: 32 }),
    332,
    "on a wide window the helper adds the centring offset",
  );
});
