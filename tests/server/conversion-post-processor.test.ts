import assert from "node:assert/strict";
import test from "node:test";
import {
  sanitizeConversionOutput,
  sanitizePromptContextForTarget,
} from "../../server/conversion-post-processor";

test("calendar_event post-processor extracts valid JSON from markdown code fence", () => {
  const raw = `Here is the extracted calendar event:

\`\`\`json
[
  {
    "title": "Strategy Sync",
    "startDate": "2026-08-01",
    "startTime": "10:00"
  }
]
\`\`\``;

  const sanitized = sanitizeConversionOutput("calendar_event", raw);
  const parsed = JSON.parse(sanitized);
  assert.ok(Array.isArray(parsed));
  assert.equal(parsed[0].title, "Strategy Sync");
});

test("spreadsheet post-processor strips conversational preambles from CSV", () => {
  const raw = `Here is your CSV file:
\`\`\`csv
Date,Task,Hours
2026-07-23,Design Audit,4.5
2026-07-24,Code Review,2.0
\`\`\`
Hope this helps!`;

  const sanitized = sanitizeConversionOutput("spreadsheet", raw);
  assert.equal(sanitized, "Date,Task,Hours\n2026-07-23,Design Audit,4.5\n2026-07-24,Code Review,2.0");
});

test("github_issue post-processor normalizes issue title on line 0", () => {
  const raw = `# Fix audio processing crash on Android
\n## Description\nAudio drops on Android 15.`;

  const sanitized = sanitizeConversionOutput("github_issue", raw);
  const lines = sanitized.split("\n");
  assert.equal(lines[0], "# TITLE: Fix audio processing crash on Android");
});

test("video_script post-processor strips markdown bold and headers for ElevenLabs TTS", () => {
  const raw = `# Section 1\nWelcome to **Proset**! Today we are discussing *idea capture*.`;

  const sanitized = sanitizeConversionOutput("video_script", raw);
  assert.doesNotMatch(sanitized, /#/);
  assert.doesNotMatch(sanitized, /\*\*/);
  assert.match(sanitized, /Welcome to Proset! Today we are discussing/);
});

test("sanitizePromptContextForTarget removes markdown rules for plain-text targets", () => {
  const prompt = "Use bold headers and format with markdown tables everywhere.";
  const clean = sanitizePromptContextForTarget("video_script", prompt);
  assert.doesNotMatch(clean, /use bold headers/i);
  assert.doesNotMatch(clean, /format with markdown/i);
});
