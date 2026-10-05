// Contract: the packs that are not ready for users have no AI Configuration card.
//
// Why this test exists: AI Configuration → Packs is the ONLY place a user can opt
// into a self-service pack, because the enable switch lives on the pack card.
// `music` is a parked product (PROSET_MUSIC_PACK_ENABLED) and `saint` is not
// ready to ship (Barry, 2026-09-29), so both cards were removed — the Music Pack
// from the nav drawer too, earlier the same day.
//
// What stays in the tree on purpose: the pack catalog entries, the six Saint Pack
// conversion types, server gating, the /music screen and route, the billing
// price, and the deploy flag. Deleting a pack is a product decision, so this file
// asserts the MENU removal only.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const read = (rel) => readFileSync(path.join(repoRoot, rel), "utf8");

const drawer = read("components/NavigationDrawer.tsx");
const aiConfig = read("app/settings/ai-config.tsx");
const i18n = read("lib/i18n.tsx");
const catalog = read("shared/self-service-modules.ts");

test("AI Configuration hides the parked Music Pack and the unshipped Saint Pack", () => {
  const list = aiConfig.match(/const PACKS_HIDDEN_FROM_AI_CONFIG = \[([^\]]*)\]/);
  assert.ok(list, "expected the hidden-pack list to be a named constant in ai-config.tsx");
  const hidden = [...list[1].matchAll(/"([a-z]+)"/g)].map((m) => m[1]);
  assert.deepEqual(hidden, ["music", "saint"], "both unshipped packs must be hidden");
  assert.match(
    aiConfig,
    /data\.modules\.filter\(\s*\(m: SelfServiceModuleState\) =>\s*!\(PACKS_HIDDEN_FROM_AI_CONFIG as readonly string\[\]\)\.includes\(m\?\.moduleName \?\? ""\)/,
    "the pack list must filter the hidden packs out at the source, so no card ever renders",
  );
});

test("no pack-specific card branches survive for the hidden packs", () => {
  for (const symbol of [
    "isMusicPack",
    "isSaintPack",
    "getMusicPackProfile",
    "getSaintPackProfile",
    "Open Music Pack",
    "Abrir Music Pack",
    "Open Saint Pack",
    "saveBtnLocked",
    "saveBtnTextLocked",
  ]) {
    assert.ok(!aiConfig.includes(symbol), `${symbol} must stay removed from the Packs tab`);
  }
});

test("the drawer has no Music entry", () => {
  assert.doesNotMatch(drawer, /icon="music"/, "no Music item may return to the drawer");
  assert.doesNotMatch(drawer, /drawer-music/, "the Music testID must stay removed");
  assert.doesNotMatch(drawer, /"\/music"/, "the drawer must not navigate to /music");
  assert.doesNotMatch(drawer, /drawer\.music/, "the drawer must not reference the Music label");
});

test("the Music drawer label is gone from both catalogs", () => {
  const keys = i18n.match(/"drawer\.music":/g) || [];
  assert.equal(keys.length, 0, "drawer.music must be gone from EN and ES");
});

test("hiding the cards leaves the server-side pack catalog intact", () => {
  // Guards the boundary: this is a menu removal, not a teardown. If a future
  // change deletes the packs, delete this assertion with it and say so.
  assert.match(catalog, /saint: \{[\s\S]*?displayName: "Saint Pack"/);
  assert.match(catalog, /music: \{[\s\S]*?displayName: "Music Pack"/);
});

test("a failed pack fetch is never shown as an empty pack list", () => {
  // An empty list from /api/modules/self has two meanings: the account has no packs
  // (a real answer) and the request never came back (nothing is known). The tab must
  // only claim the first one, or a signed-in user with a flaky connection is told
  // their packs do not exist.
  assert.match(
    aiConfig,
    /const \[packsError, setPacksError\] = useState\(""\);/,
    "the tab must track that the load failed",
  );
  assert.match(aiConfig, /setPacksError\(""\);\s*\n\s*try \{/, "a retry must clear the previous error");
  assert.match(
    aiConfig,
    /setPacksError\(\s*\n?\s*language === "es"/,
    "the failure must surface a message, not silence",
  );
  // A non-array payload is a failure too, not an empty catalog.
  assert.match(aiConfig, /if \(!Array\.isArray\(data\.modules\)\) throw new Error\(/, "guard the payload");
  assert.match(aiConfig, /if \(!res\.ok\) throw new Error\(`\/api\/modules\/self responded \$\{res\.status\}`\)/, "guard the status");
  // The empty state renders only when the load actually succeeded.
  assert.match(
    aiConfig,
    /\{packStates\.length === 0 && !packsError \? \(/,
    "the empty state must be unreachable while the error stands",
  );
  assert.match(aiConfig, /onPress=\{\(\) => loadPacks\(\)\}/, "the error card must offer a retry");
});
