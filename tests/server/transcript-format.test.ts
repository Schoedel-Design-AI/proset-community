import { test } from "node:test";
import assert from "node:assert/strict";
import { paragraphizeTranscript, splitSentences } from "../../shared/transcript-format";

test("paragraphizeTranscript groups a long blob into paragraphs", () => {
  const sentences = Array.from({ length: 12 }, (_, i) => `Sentence number ${i + 1} goes here.`).join(" ");
  const out = paragraphizeTranscript(sentences);
  assert.ok(out.includes("\n\n"), "should contain paragraph breaks");
  // No words lost or reordered.
  assert.equal(out.replace(/\n\n/g, " "), sentences.replace(/\s+/g, " "));
});

test("paragraphizeTranscript is idempotent on already-formatted text", () => {
  const formatted = "First paragraph sentence one. Sentence two.\n\nSecond paragraph sentence one. Sentence two.";
  assert.equal(paragraphizeTranscript(formatted), formatted);
});

test("splitSentences does not split on abbreviations", () => {
  const text = "Dr. Smith went home. Then U.S. officials arrived at 3 a.m.";
  const sentences = splitSentences(text);
  assert.equal(sentences.length, 2);
  assert.ok(sentences[0].startsWith("Dr. Smith"));
  assert.ok(sentences[1].startsWith("Then U.S. officials"));
});

test("paragraphizeTranscript keeps Spanish question marks attached", () => {
  const text = "¿Cómo estás? Muy bien, gracias. Hasta luego.";
  const sentences = splitSentences(text);
  assert.equal(sentences.length, 3);
  assert.equal(sentences[0], "¿Cómo estás?");
});

test("paragraphizeTranscript handles empty/whitespace input", () => {
  assert.equal(paragraphizeTranscript(""), "");
  assert.equal(paragraphizeTranscript("   \n\n  "), "");
});

test("paragraphizeTranscript leaves single-sentence text unchanged", () => {
  const one = "Just one short sentence here.";
  assert.equal(paragraphizeTranscript(one), one);
});
