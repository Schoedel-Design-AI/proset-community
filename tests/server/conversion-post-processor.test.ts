import assert from "node:assert/strict";
import test from "node:test";
import {
  getConversionStreamChunk,
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

test("notes post-processor removes leading model reasoning and keeps only the requested conversion", () => {
  const raw = ` \n<THINK>Review the prompt and decide how to format the answer.</THINK>

<think>
The user requested notes, so I should summarize the transcript.
</think>

# Project Notes

- **Decision:** Ship the revised workflow.`;

  assert.equal(
    sanitizeConversionOutput("notes", raw),
    "# Project Notes\n\n- **Decision:** Ship the revised workflow.",
  );
});

test("outline post-processor removes leading model reasoning", () => {
  const raw = `<think>Build a complete hierarchy before answering.</think>
Quarterly Planning

I. Priorities
   A. Reliability`;

  assert.equal(
    sanitizeConversionOutput("outline", raw),
    "Quarterly Planning\n\nI. Priorities\n   A. Reliability",
  );
});

test("notes and outline preserve embedded or malformed think tags", () => {
  const embedded = "# Notes\n\nThe literal example is <think>draft privately</think>.";
  const malformed = "<think>Unclosed source text\n\n# Notes";

  assert.equal(sanitizeConversionOutput("notes", embedded), embedded);
  assert.equal(sanitizeConversionOutput("outline", malformed), malformed);
});

test("reasoning cleanup does not change other conversion types", () => {
  const raw = "<think>Plan the response.</think>\n\nFinished email";
  assert.equal(sanitizeConversionOutput("email", raw), raw);
});

test("notes and outline buffer provider chunks until the sanitized result is ready", () => {
  assert.equal(getConversionStreamChunk("notes", "<think>private reasoning"), null);
  assert.equal(getConversionStreamChunk("outline", "private reasoning</think>"), null);
  assert.equal(getConversionStreamChunk("email", "Hello"), "Hello");
});
