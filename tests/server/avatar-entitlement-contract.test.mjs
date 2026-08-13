import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const authSource = fs.readFileSync(new URL("../../server/auth.ts", import.meta.url), "utf8");

test("the avatar mutation validates IDs and enforces Pro animated packs", () => {
  assert.match(authSource, /isValidAvatarId\(normalizedAvatarId\)/);
  assert.match(authSource, /isProAnimatedAvatarId\(normalizedAvatarId\)/);
  assert.match(authSource, /stripeService\.getUserSubscriptionStatus\(req\.userId!\)/);
  assert.match(authSource, /hasProAvatarEntitlement\(subscriptionStatus\)/);
  assert.match(authSource, /status\(403\)[\s\S]*code: "PRO_REQUIRED"/);
});

test("inactive Pro avatars are hidden without deleting the saved choice", () => {
  assert.match(authSource, /let visibleAvatarId = user\.avatarId \|\| ""/);
  assert.match(authSource, /isProAnimatedAvatarId\(visibleAvatarId\)/);
  assert.match(authSource, /if \(!hasProAvatarEntitlement\(subscriptionStatus\)\) visibleAvatarId = ""/);
  assert.match(authSource, /avatarId: visibleAvatarId/);
  assert.doesNotMatch(authSource, /storage\.users\.update\(user\.id, \{ avatarId: "" \}\)/);
});
