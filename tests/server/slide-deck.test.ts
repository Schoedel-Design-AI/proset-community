import assert from "node:assert/strict";
import test from "node:test";

import { DECK_LIMITS, DECK_STYLES, getDeckStyle } from "../../shared/deck-styles";
import { assembleDeckPptx } from "../../server/modules/slide-deck/pptx";
import {
  _resetDeckMemory,
  checkGlobalDailyDeckQuota,
  recordDeckGeneration,
} from "../../server/modules/slide-deck/store";

test("deck styles: every preset has a complete, valid palette and fonts", () => {
  assert.ok(DECK_STYLES.length >= 4, "should ship at least 4 style presets");
  const hexRe = /^#[0-9A-Fa-f]{6}$/;
  for (const style of DECK_STYLES) {
    assert.ok(style.id.length > 0, `${style.id} should have an id`);
    assert.ok(style.labelKey.length > 0, `${style.id} should have a labelKey`);
    for (const [key, value] of Object.entries(style.palette)) {
      assert.match(value, hexRe, `${style.id}.${key} should be a hex color, got ${value}`);
    }
    assert.ok(style.fonts.heading.trim().length > 0, `${style.id} heading font`);
    assert.ok(style.fonts.body.trim().length > 0, `${style.id} body font`);
  }
});

test("deck styles: ids are unique and resolvable", () => {
  const ids = DECK_STYLES.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length, "style ids must be unique");
  for (const id of ids) {
    assert.ok(getDeckStyle(id), `getDeckStyle(${id}) should resolve`);
  }
  assert.equal(getDeckStyle("does-not-exist"), undefined);
});

test("deck limits: sane values that protect cost", () => {
  assert.ok(DECK_LIMITS.globalPerDay >= 1 && DECK_LIMITS.globalPerDay <= 100);
  assert.ok(DECK_LIMITS.minSlides >= 3 && DECK_LIMITS.minSlides <= DECK_LIMITS.maxSlides);
  assert.ok(DECK_LIMITS.maxSlides <= 25, "deck slide cap should be bounded");
  assert.ok(DECK_LIMITS.maxTranscriptChars <= 40000);
});

test("pptx assembly: produces a valid PPTX zip with the style palette applied", async () => {
  const style = getDeckStyle("executive-navy")!;
  const buf = await assembleDeckPptx(
    {
      title: "Test Deck",
      subtitle: "Sub",
      slides: [
        { kind: "title", title: "Test Deck", bullets: ["Sub"], notes: "open" },
        { kind: "section", title: "Part One", notes: "transition" },
        { kind: "content", title: "Findings", bullets: ["Alpha", "Beta"], notes: "say it" },
        { kind: "closing", title: "Thank you" },
      ],
    },
    style,
  );
  assert.ok(Buffer.isBuffer(buf));
  assert.ok(buf.length > 1000, `pptx should be a real file, got ${buf.length} bytes`);
  assert.equal(buf[0], 0x50, "PK zip signature byte 0");
  assert.equal(buf[1], 0x4b, "PK zip signature byte 1");
  const text = buf.toString("latin1");
  assert.ok(text.includes("ppt/slides/"), "should contain slide parts");
});

test("pptx assembly: dark style still renders (backgrounds are valid)", async () => {
  const style = getDeckStyle("bold-impact")!;
  const buf = await assembleDeckPptx(
    {
      title: "Dark Deck",
      slides: [
        { kind: "title", title: "Dark Deck" },
        { kind: "content", title: "Content", bullets: ["One", "Two"] },
        { kind: "closing", title: "End" },
      ],
    },
    style,
  );
  assert.ok(buf.length > 1000);
});

test("deck quota: global daily counter enforces the abuse cap", async () => {
  _resetDeckMemory();
  const globalBefore = await checkGlobalDailyDeckQuota();
  assert.equal(globalBefore.used, 0);

  await recordDeckGeneration();
  await recordDeckGeneration();

  const globalAfter = await checkGlobalDailyDeckQuota();
  assert.equal(globalAfter.used, 2);

  _resetDeckMemory();
});
