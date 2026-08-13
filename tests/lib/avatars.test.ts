import assert from "node:assert/strict";
import test from "node:test";
import {
  AVATAR_PACKS,
  clearAvatarCaches,
  getAvatarDataUri,
  getAvatarSvg,
  getPackPreviewSvg,
} from "../../lib/avatars";

function getIds(svg: string): string[] {
  return [...svg.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
}

function getUrlReferences(svg: string): string[] {
  return [...svg.matchAll(/url\(#([^)]+)\)/g)].map((match) => match[1]);
}

test("inline avatars use unique internal SVG IDs across every pack", () => {
  clearAvatarCaches();

  const renderedSvgs = AVATAR_PACKS.flatMap((pack) => {
    const avatar = getAvatarSvg(`${pack.key}:1`);
    assert.ok(avatar, `${pack.label} avatar should render`);

    return [getPackPreviewSvg(pack.key), avatar];
  });

  const allIds = renderedSvgs.flatMap((svg) => {
    const ids = getIds(svg);
    const references = getUrlReferences(svg);

    assert.ok(ids.length > 0, "each inline avatar should define an SVG ID");
    for (const reference of references) {
      assert.ok(ids.includes(reference), `SVG reference #${reference} should be local`);
    }

    return ids;
  });

  assert.equal(new Set(allIds).size, allIds.length, "SVG IDs must not collide");
  assert.ok(
    getAvatarSvg("notionists:1")?.includes("scale(1.8)"),
    "Notionists should retain its custom framing after ID randomization",
  );
});

test("only Pro packs contain DiceBear animation markup", () => {
  clearAvatarCaches();

  for (const pack of AVATAR_PACKS) {
    const svg = getAvatarSvg(`${pack.key}:1`);
    assert.ok(svg, `${pack.label} avatar should render`);
    assert.equal(svg.includes("@keyframes"), pack.animated === true, pack.label);
    assert.doesNotMatch(getPackPreviewSvg(pack.key), /@keyframes/, `${pack.label} tab preview`);
  }

  assert.match(getAvatarDataUri("sprouts:1") || "", /^data:image\/svg\+xml;utf8,/);
  assert.doesNotMatch(getAvatarSvg("sprouts:1", { animate: false }) || "", /@keyframes/);
});

test("avatar SVGs remain stable after they enter the cache", () => {
  clearAvatarCaches();
  const first = getAvatarSvg("pixelArt:1");

  assert.equal(getAvatarSvg("pixelArt:1"), first);
});
