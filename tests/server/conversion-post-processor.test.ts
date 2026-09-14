import assert from "node:assert/strict";
import test from "node:test";
import {
  createThinkingStreamFilter,
  createMarkdownHeadingStreamFilter,
  getConversionStreamChunk,
  normalizeMarkdownHeadings,
  sanitizeConversionOutput,
  sanitizePromptContextForTarget,
  stripThinking,
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
  const raw = ` \n<THINK>Review the prompt and decide how to format the answer.</THINK>\n
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

test("reasoning is stripped for EVERY conversion type (issue #222)", () => {
  // The #216 regression: a "general request" leaked <think> into the output.
  const raw = `<think>
Analyze the request before answering.
</think>

Here is the finished answer.`;
  assert.equal(sanitizeConversionOutput("general_request", raw), "Here is the finished answer.");
  assert.equal(sanitizeConversionOutput("email", raw), "Here is the finished answer.");
  assert.equal(sanitizeConversionOutput("summary", raw), "Here is the finished answer.");
  assert.equal(sanitizeConversionOutput("blog_post", raw), "Here is the finished answer.");
});

test("multiple leading think blocks are all stripped", () => {
  const raw = `<think>first pass</think>\n<think>second pass</think>\n# Title\nBody`;
  assert.equal(sanitizeConversionOutput("general_request", raw), "# Title\nBody");
});

test("an unclosed leading think block is stripped entirely (failsafe)", () => {
  // The stream was cut off mid-reasoning: never leak what was emitted.
  assert.equal(sanitizeConversionOutput("general_request", "<think>Unclosed reasoning\n\n# Notes"), "");
  assert.equal(sanitizeConversionOutput("notes", "<think>unclosed"), "");
  assert.equal(sanitizeConversionOutput("notes", '<think mode="analysis"'), "");
});

test("reasoning is stripped wherever it appears in a conversion", () => {
  const raw = "# Notes\n\n<think mode=\"analysis\">private reasoning</think>\n\n- Keep this.";
  const result = sanitizeConversionOutput("notes", raw);
  assert.doesNotMatch(result, /<think|private reasoning/i);
  assert.match(result, /# Notes/);
  assert.match(result, /- Keep this\./);
});

test("stripThinking removes multiple blocks and drops an unclosed trailing block", () => {
  assert.equal(stripThinking("   \n<think>a</think>  \nAnswer"), "Answer");
  assert.equal(stripThinking("Before<think>a</think>After<think>b</think>"), "BeforeAfter");
  assert.equal(stripThinking("Answer\n<think>unclosed reasoning"), "Answer");
  assert.equal(stripThinking("Answer\n<think mode=\"analysis\""), "Answer");
  assert.equal(stripThinking("Answer"), "Answer");
  assert.equal(stripThinking(""), "");
});

test("markdown output normalizes bold-only sub-headings to ## (issue #215)", () => {
  const raw = `# Cleaning Plan

**Bathroom**

Clean the toilet.

**Bedroom**

- Vacuum
- Change sheets

**Laundry**`;
  const out = sanitizeConversionOutput("general_request", raw, "markdown");
  assert.match(out, /## Bathroom/);
  assert.match(out, /## Bedroom/);
  assert.match(out, /## Laundry/);
  // Existing real headings are untouched.
  assert.match(out, /# Cleaning Plan/);
});

test("markdown normalization leaves code fences and inline bold alone", () => {
  const raw = `# Title

**Real Heading**

\`\`\`js
const **not** = "heading";
\`\`\`

Use **bold inline** here.`;
  const out = sanitizeConversionOutput("summary", raw, "markdown");
  assert.match(out, /## Real Heading/);
  assert.match(out, /const \*\*not\*\*/); // untouched inside fence
  assert.match(out, /Use \*\*bold inline\*\* here/); // inline bold untouched
});

test("markdown normalization leaves tilde code fences alone", () => {
  const raw = "~~~md\n**not a heading**\n~~~";
  assert.equal(normalizeMarkdownHeadings(raw), raw);
});

test("markdown normalization promotes later H1 subtitles to H2", () => {
  const raw = "# Title\n\n# First subtitle\n\nBody\n\n# Second subtitle";
  assert.equal(
    normalizeMarkdownHeadings(raw),
    "# Title\n\n## First subtitle\n\nBody\n\n## Second subtitle",
  );
});

test("markdown normalization converts bold subtitles ending in punctuation", () => {
  assert.equal(normalizeMarkdownHeadings("# Title\n\n**Key points:**"), "# Title\n\n## Key points:");
});

test("plain-text and structured output skip markdown normalization", () => {
  const raw = `**Looks like a heading**

Plain body.`;
  // Plain text output: bold line untouched.
  assert.equal(sanitizeConversionOutput("general_request", raw, "txt"), raw);
  // No outputFormat: no normalization (back-compat).
  assert.equal(sanitizeConversionOutput("general_request", raw), raw);
  // Structured type: never normalized even with markdown format.
  assert.equal(sanitizeConversionOutput("calendar_event", raw, "markdown"), raw);
});

test("normalizeMarkdownHeadings is a no-op on already-correct markdown", () => {
  const md = "# Title\n\n## Section\n\n### Sub\n\nbody";
  assert.equal(normalizeMarkdownHeadings(md), md);
});

test("notes and outline buffer provider chunks until the sanitized result is ready", () => {
  assert.equal(getConversionStreamChunk("notes", "<think>private reasoning"), null);
  assert.equal(getConversionStreamChunk("outline", "private reasoning</think>"), null);
  assert.equal(getConversionStreamChunk("email", "Hello"), "Hello");
});

test("stream filter suppresses reasoning across chunk boundaries", () => {
  const f = createThinkingStreamFilter();
  // Reasoning split mid-tag, then the answer.
  assert.equal(f.push("Hel"), "Hel");
  assert.equal(f.push("<thi"), null); // held as a possible partial tag
  assert.equal(f.push("nk>private reasoning</think> Ans"), " Ans"); // block swallowed
  assert.equal(f.push("wer"), "wer"); // " Ans" + "wer" -> clean content
  assert.equal(f.flush(), "");
});

test("stream filter emits clean content immediately and flushes the tail", () => {
  const f = createThinkingStreamFilter();
  assert.equal(f.push("Plain answer"), "Plain answer");
  assert.equal(f.flush(), "");

  const g = createThinkingStreamFilter();
  assert.equal(g.push("<think>reasoning</think>"), null);
  assert.equal(g.push("Real content"), "Real content");
  assert.equal(g.flush(), "");
});

test("stream filter flush drops an unclosed trailing think block", () => {
  const f = createThinkingStreamFilter();
  assert.equal(f.push("Done."), "Done.");
  assert.equal(f.push("<think>cut off"), null);
  assert.equal(f.flush(), "");
});

test("stream filter handles case and attribute boundaries", () => {
  const f = createThinkingStreamFilter();
  assert.equal(f.push("<THI"), null);
  assert.equal(f.push('NK mode="analysis"'), null);
  assert.equal(f.push(">private</THINK>Answer"), "Answer");
});

test("stream markdown filter normalizes only complete lines", () => {
  const f = createMarkdownHeadingStreamFilter();
  assert.equal(f.push("**Section"), null);
  assert.equal(f.push(" One**\nBody"), "## Section One\n");
  assert.equal(f.flush(), "Body");
});

test("stream markdown filter promotes later H1 subtitles", () => {
  const f = createMarkdownHeadingStreamFilter();
  assert.equal(f.push("# Title\n# Subtitle\n"), "# Title\n## Subtitle\n");
  assert.equal(f.flush(), "");
});
