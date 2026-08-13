import assert from "node:assert/strict";
import test from "node:test";
import {
  hasProAvatarEntitlement,
  isProAnimatedAvatarId,
  isValidAvatarId,
  parseAvatarId,
  PRO_ANIMATED_AVATAR_PACK_KEYS,
} from "../../shared/avatar-catalog";

test("avatar IDs are constrained to known packs and seed bounds", () => {
  assert.deepEqual(parseAvatarId("sprouts:1"), { packKey: "sprouts", index: 0 });
  assert.deepEqual(parseAvatarId("avatar-50"), { packKey: "bigSmile", index: 49 });
  assert.equal(isValidAvatarId(""), true);
  assert.equal(isValidAvatarId("unknown:1"), false);
  assert.equal(isValidAvatarId("sprouts:0"), false);
  assert.equal(isValidAvatarId("sprouts:51"), false);
});

test("all five animated packs require an active Pro entitlement", () => {
  for (const packKey of PRO_ANIMATED_AVATAR_PACK_KEYS) {
    assert.equal(isProAnimatedAvatarId(`${packKey}:1`), true, packKey);
  }

  assert.equal(isProAnimatedAvatarId("pixelArt:1"), false);
  assert.equal(hasProAvatarEntitlement({ tier: "pro", active: true }), true);
  assert.equal(hasProAvatarEntitlement({ tier: "pro", active: false }), false);
  assert.equal(hasProAvatarEntitlement({ tier: "base", active: true }), false);
  assert.equal(hasProAvatarEntitlement({ tier: "free", active: true }), false);
});
