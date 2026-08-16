import { test } from "node:test";
import assert from "node:assert";
import { Avatar, Style } from "@dicebear/core";
import sproutsDefinition from "@dicebear/styles/sprouts.json" with { type: "json" };
import crittersDefinition from "@dicebear/styles/critters.json" with { type: "json" };
import moodsDefinition from "@dicebear/styles/moods.json" with { type: "json" };
import voxelArtDefinition from "@dicebear/styles/voxel-art.json" with { type: "json" };
import voxelBotDefinition from "@dicebear/styles/voxel-bot.json" with { type: "json" };
import { splitAnimatedAvatarSvg } from "../../lib/avatar-animation-core";

const packs: Record<string, Style<any>> = {
  sprouts: new Style(sproutsDefinition),
  critters: new Style(crittersDefinition),
  moods: new Style(moodsDefinition),
  voxelArt: new Style(voxelArtDefinition),
  voxelBot: new Style(voxelBotDefinition),
};

const EXPECTED_CLASSES: Record<string, string[]> = {
  sprouts: ["dbsp-g", "dbsp-e"],
  critters: ["dbcr-t", "dbcr-eb", "dbcr-eb", "dbcr-eb", "dbcr-c"],
  moods: ["dbmo-eyes"],
  voxelArt: ["va-blink-medium", "va-upper"],
  voxelBot: ["vb-blink-medium", "vb-upper", "vb-head"],
};

for (const [name, style] of Object.entries(packs)) {
  test(`splitAnimatedAvatarSvg extracts all animated elements (${name})`, () => {
    const svg = new Avatar(style, {
      seed: "avocado",
      size: 128,
      scale: 1,
      idRandomization: true,
      animationVariant: "medium",
    }).toString();

    const result = splitAnimatedAvatarSvg(svg);
    assert.ok(result, `${name}: expected a split (animated pack)`);
    assert.deepStrictEqual(
      result!.layers.map((l) => l.className),
      EXPECTED_CLASSES[name],
      `${name}: expected exactly the animated classes in order`,
    );

    // Base must not contain any classed element anymore
    for (const l of result!.layers) {
      assert.ok(
        !result!.baseXml.includes(`class="${l.className}"`),
        `${name}: base still contains class ${l.className}`,
      );
    }

    // Each layer must be a well-formed standalone SVG with defs (use refs resolve)
    for (const l of result!.layers) {
      assert.ok(l.xml.startsWith("<svg"), `${name} .${l.className}: not an svg`);
      assert.ok(l.xml.endsWith("</svg>"), `${name} .${l.className}: not closed`);
      assert.ok(l.xml.includes("<defs>"), `${name} .${l.className}: missing defs`);
    }

    // Rotation-pivot layers (rotate prop) must carry an origin
    for (const l of result!.layers) {
      if (l.spec.prop === "rotate") {
        assert.ok(
          l.originX !== undefined && l.originY !== undefined,
          `${name} .${l.className}: rotate layer missing origin`,
        );
        assert.ok(
          l.originX! >= 0 && l.originX! <= 128 && l.originY! >= 0 && l.originY! <= 128,
          `${name} .${l.className}: origin ${l.originX},${l.originY} outside viewBox`,
        );
      }
    }
  });
}
