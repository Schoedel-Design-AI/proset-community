// Contract: the drawer's Music entry is a locked, greyed-out row — not a link.
//
// Why this test exists: `/music` has no route in lib/navigation.web.tsx, so the
// previously ungated drawer item navigated web users into the not-found screen.
// It is now rendered locked (muted colors + lock icon, non-interactive). The
// lock glyph also has to exist in the curated DrawerFeatherIcon SVG shim — a
// name missing from that map renders nothing on web (same class of bug as the
// missing "package" icon, PR #160).
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const drawer = readFileSync(path.join(repoRoot, "components/NavigationDrawer.tsx"), "utf8");
const icons = readFileSync(path.join(repoRoot, "components/DrawerFeatherIcon.tsx"), "utf8");
const i18n = readFileSync(path.join(repoRoot, "lib/i18n.tsx"), "utf8");
const aiConfig = readFileSync(path.join(repoRoot, "app/settings/ai-config.tsx"), "utf8");
const featherWebShim = readFileSync(path.join(repoRoot, "lib/Feather.web.tsx"), "utf8");

test("the Music drawer item is marked locked", () => {
  const item = drawer.match(/<DrawerItem\s+icon="music"[\s\S]*?\/>/);
  assert.ok(item, "expected a DrawerItem with icon=\"music\"");
  assert.match(item[0], /\blocked\b/, "the Music drawer item must pass `locked`");
});

test("the Music drawer item no longer navigates", () => {
  const item = drawer.match(/<DrawerItem\s+icon="music"[\s\S]*?\/>/);
  assert.doesNotMatch(item[0], /onPress/, "a locked item must not carry an onPress handler");
  assert.doesNotMatch(
    drawer,
    /router\.push\(\s*"\/music"/,
    "the drawer must not push /music — that route does not exist on web",
  );
});

test("the locked branch renders a lock icon, muted label, and disabled a11y state", () => {
  const lockedBranch = drawer.match(/if \(locked\) \{[\s\S]*?\n  \}/);
  assert.ok(lockedBranch, "expected a `if (locked)` branch in DrawerItem");
  const branch = lockedBranch[0];
  assert.match(branch, /accessibilityState=\{\{ disabled: true \}\}/);
  assert.match(branch, /name="lock"/);
  assert.match(branch, /drawerItemLabelLocked/);
  assert.doesNotMatch(branch, /<Pressable/, "a locked row must not be pressable");
});

test("the muted-label and lock styles exist", () => {
  assert.match(drawer, /drawerItemLabelLocked:\s*\{[\s\S]*?color:\s*Colors\.textMuted/);
  assert.match(drawer, /drawerItemLock:\s*\{[\s\S]*?marginLeft:\s*"auto"/);
});

test("the lock glyph exists in the curated drawer icon shim", () => {
  assert.match(icons, /\|\s*"lock"/, "\"lock\" must be in DrawerFeatherIconName");
  assert.match(icons, /\n  lock:\s*\(p\)\s*=>/, "\"lock\" must have an entry in iconPaths");
  // Feather's lock artwork: a body rect plus the shackle path.
  assert.match(icons, /<Rect x="3" y="11" width="18" height="11"/);
  assert.match(icons, /d="M7 11V7a5 5 0 0 1 10 0v4"/);
});

test("the locked a11y string is defined in English and Spanish", () => {
  const keys = i18n.match(/"a11y\.locked":/g) || [];
  assert.equal(keys.length, 2, "a11y.locked must exist in both EN and ES catalogs");
  assert.match(i18n, /"a11y\.locked":\s*"Locked"/);
  assert.match(i18n, /"a11y\.locked":\s*"Bloqueado"/);
});

test("no Music Pack entry point anywhere still navigates to /music", () => {
  // Every door to the Music screen must be locked, not just the drawer: the
  // route does not exist on web, so any surviving push lands on not-found.
  for (const [label, source] of [["drawer", drawer], ["ai-config", aiConfig]]) {
    assert.doesNotMatch(
      source,
      /router\.(push|replace)\(\s*"\/music"/,
      `${label} must not navigate to /music while the pack is locked`,
    );
  }
});

test("both ai-config Music Pack controls render locked", () => {
  // Take a window around each locked a11y label instead of regexing JSX: the
  // two Music Pack controls are the row-header badge and the expanded-body row.
  const anchors = [...aiConfig.matchAll(/a11y\.locked/g)].map((match) => match.index);
  assert.equal(anchors.length, 2, "expected exactly two locked Music Pack controls in ai-config");
  for (const index of anchors) {
    const control = aiConfig.slice(Math.max(0, index - 400), index + 400);
    assert.match(control, /<View/, "a locked control must render as a View");
    assert.match(control, /accessibilityState=\{\{ disabled: true \}\}/);
    assert.match(control, /name="lock"/);
    assert.doesNotMatch(control, /onPress/, "a locked Music Pack control must not carry onPress");
  }
  assert.doesNotMatch(
    aiConfig,
    /name="arrow-up-right"/,
    "the Music Pack open affordance must be gone while the pack is locked",
  );
  assert.match(aiConfig, /saveBtnLocked:\s*\{[\s\S]*?backgroundColor:\s*Colors\.surfaceLight/);
  assert.match(aiConfig, /saveBtnTextLocked:\s*\{[\s\S]*?color:\s*Colors\.textMuted/);
});

test("the lock glyph also exists in the web Feather shim used by ai-config", () => {
  // ai-config renders <Feather name="lock" />; on web that resolves to
  // lib/Feather.web.tsx, a curated path map where a missing name renders nothing.
  assert.match(featherWebShim, /"lock":/);
});
