// Contract: the Google integrations tab is locked unless an existing account
// needs access to its management and revocation controls.
//
// Why this test exists: the Google integration surface is not ready to ship, but
// it stays visible rather than being removed so the tab remains discoverable and
// the work is not thrown away. It renders locked (muted colors + lock icon,
// non-interactive) for users without a connection, while existing connections
// remain manageable. A deep link must not be able to activate it. The lock glyph
// also has to exist in the curated lib/Feather.web.tsx path map — a name missing
// from that map renders nothing on web (same class of bug as the missing
// "package" icon, PR #160).
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const integrations = readFileSync(path.join(repoRoot, "app/settings/integrations.tsx"), "utf8");
const i18n = readFileSync(path.join(repoRoot, "lib/i18n.tsx"), "utf8");
const featherWebShim = readFileSync(path.join(repoRoot, "lib/Feather.web.tsx"), "utf8");

test("the Google tab is present and locks only without existing accounts", () => {
  assert.match(
    integrations,
    /const hasExistingGoogleAccounts = googleAccounts\.length > 0;/,
    "the lock decision must be derived from the loaded Google accounts",
  );
  const entry = integrations.match(/\{ key: "google"[\s\S]*?\}/);
  assert.ok(entry, "expected a Google entry in the tabs array");
  assert.match(
    entry[0],
    /locked:\s*!hasExistingGoogleAccounts/,
    "the Google tab must unlock when an existing account needs management",
  );
  assert.doesNotMatch(entry[0], /locked:\s*true/, "the Google tab must not be unconditionally locked");
});

test("Google status loads for any signed-in user before tab activation", () => {
  assert.doesNotMatch(
    integrations,
    /activeTab === "google" && user/,
    "the status loader must not wait for the Google tab to become active",
  );
  assert.match(
    integrations,
    /useEffect\(\(\) => \{\s*if \(user\) \{\s*loadGoogleStatus\(\);\s*\}\s*\/\/ eslint-disable-next-line react-hooks\/exhaustive-deps\s*\}, \[user\]\);/,
    "the status loader must run under a signed-in user guard",
  );
});

test("the locked branch renders a lock icon, muted label, and disabled a11y state", () => {
  const branch = integrations.match(/if \(tab\.locked\) \{[\s\S]*?\n            \}/);
  assert.ok(branch, "expected an `if (tab.locked)` branch in the tab bar");
  assert.match(branch[0], /<View/, "a locked tab must render as a View");
  assert.match(branch[0], /accessibilityState=\{\{ disabled: true \}\}/);
  assert.match(branch[0], /name="lock"/);
  assert.match(branch[0], /a11y\.locked/);
  assert.doesNotMatch(branch[0], /onPress/, "a locked tab must not carry an onPress handler");
  assert.doesNotMatch(branch[0], /<Pressable/, "a locked tab must not be pressable");
});

test("the muted locked-tab styles exist", () => {
  assert.match(integrations, /tabLocked:\s*\{[\s\S]*?opacity:\s*0\.5/);
  assert.match(integrations, /tabTextLocked:\s*\{[\s\S]*?color:\s*Colors\.textMuted/);
});

test("a deep link cannot activate the locked Google tab", () => {
  assert.doesNotMatch(
    integrations,
    /params\.tab === "google"/,
    "the deep-link whitelist must not include the locked Google tab",
  );
});

test("the locked a11y string is defined in English and Spanish", () => {
  const keys = i18n.match(/"a11y\.locked":/g) || [];
  assert.equal(keys.length, 2, "a11y.locked must exist in both EN and ES catalogs");
  assert.match(i18n, /"a11y\.locked":\s*"Locked"/);
  assert.match(i18n, /"a11y\.locked":\s*"Bloqueado"/);
});

test("the Google tab body is retained for existing-account management", () => {
  assert.match(
    integrations,
    /activeTab === "google" &&/,
    "the Google tab body must stay in place for existing-account management",
  );
});

test("the lock glyph exists in the web Feather shim", () => {
  assert.match(featherWebShim, /"lock":/);
});
