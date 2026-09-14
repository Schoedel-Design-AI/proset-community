import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const avatarViewSource = fs.readFileSync(
  new URL("../components/AvatarView.tsx", import.meta.url),
  "utf8",
);

const avatarAnimationSource = fs.readFileSync(
  new URL("../lib/avatar-animation.ts", import.meta.url),
  "utf8",
);

test("AvatarView binds animation to reduced-motion and native-driver safeguards", () => {
  assert.match(avatarViewSource, /const reduceMotion = useReducedMotion\(\)/);
  assert.match(avatarViewSource, /const allowAnimation = animated && !reduceMotion/);
  assert.match(avatarViewSource, /getAvatarSvg\(avatarId, \{ animate: allowAnimation \}\)/);
  assert.match(avatarViewSource, /const staticSvg = getAvatarSvg\(avatarId, \{ animate: false \}\)/);
  assert.match(avatarViewSource, /const baseXml = allowAnimation && layersReady && split \? split\.baseXml : staticSvg/);
  assert.match(avatarViewSource, /progressSplit === split/);
  assert.match(avatarViewSource, /if \(Platform\.OS !== "web" && split && allowAnimation && layersReady\)/);
  assert.match(avatarViewSource, /startAvatarLayerLoop\(layer\.spec\)/);
  assert.match(avatarViewSource, /const \[progressMap, setProgressMap\] = useState/);
  assert.match(avatarViewSource, /setProgressMap\(progressMap\)/);
  assert.match(avatarViewSource, /progressMap\.get\(layer\.className\)/);
  assert.match(avatarViewSource, /stop\(\)/);
  assert.match(avatarAnimationSource, /useNativeDriver:\s*true/);
});
