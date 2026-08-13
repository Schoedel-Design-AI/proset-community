import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const avatarViewSource = fs.readFileSync(
  new URL("../components/AvatarView.tsx", import.meta.url),
  "utf8",
);

test("AvatarView binds animation to reduced-motion and native-driver safeguards", () => {
  assert.match(avatarViewSource, /const reduceMotion = useReducedMotion\(\)/);
  assert.match(avatarViewSource, /const allowAnimation = animated && !reduceMotion/);
  assert.match(avatarViewSource, /getAvatarSvg\(avatarId, \{ animate: allowAnimation \}\)/);
  assert.match(avatarViewSource, /useNativeDriver: true/);
});
