import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sources = [
  readFileSync(new URL("../app/recording/[id].tsx", import.meta.url), "utf8"),
  readFileSync(
    new URL("../scripts/ce-export/overrides/app/recording/[id].tsx", import.meta.url),
    "utf8",
  ),
];
const conversionSource = readFileSync(
  new URL("../components/ConversionContent.tsx", import.meta.url),
  "utf8",
);

test("recording transcript uses comfortable card and line spacing", () => {
  for (const source of sources) {
    assert.match(source, /transcribingCard:\s*\{[^}]*backgroundColor:\s*"transparent"/);
    assert.match(source, /transcriptCard:\s*\{[\s\S]*?backgroundColor:\s*"transparent"/);
    assert.match(source, /electiveCard:\s*\{[\s\S]*?backgroundColor:\s*"transparent"/);
    assert.doesNotMatch(source, /electiveTitle/);
    assert.doesNotMatch(source, /electiveIconBadge/);
    assert.match(source, /transcriptText:\s*\{[\s\S]*?lineHeight:\s*29/);
    assert.doesNotMatch(source, /transcriptText:\s*\{[\s\S]*?includeFontPadding:\s*false/);
    assert.match(source, /readMoreButton:\s*\{[\s\S]*?marginTop:\s*12/);
  }
});

test("conversion artifacts preserve breathing room between text blocks", () => {
  assert.match(conversionSource, /if \(!line\.trim\(\)\) \{[\s\S]*?paragraphSpacer/);
  assert.match(conversionSource, /paragraphSpacer:\s*\{[\s\S]*?height:\s*16/);
  assert.match(conversionSource, /bodyText:\s*\{[\s\S]*?lineHeight:\s*28/);
  assert.match(conversionSource, /bulletDot:\s*\{[\s\S]*?lineHeight:\s*28/);
  assert.match(conversionSource, /blockquoteText:\s*\{[\s\S]*?lineHeight:\s*28/);
  for (const source of sources) {
    assert.match(source, /fullModalContent:\s*\{\s*padding:\s*24/);
  }
});

test("scaffolded conversion responses use a shared visual hierarchy", () => {
  assert.match(
    conversionSource,
    /isScaffoldedConversion[\s\S]*?scaffolded_project_plan[\s\S]*?scaffolded_action_items/,
  );
  assert.match(conversionSource, /scaffoldSectionHeading:\s*\{/);
  assert.match(conversionSource, /scaffoldTaskRow:\s*\{/);
  assert.match(conversionSource, /size=\{isScaffoldedConversion \? 18 : 16\}/);
});
