import assert from "node:assert/strict";
import test from "node:test";
import {
  parseTableCells,
  parseTableAlignments,
  parseTableBlock,
  parseInlineTokens,
  parseMarkdownBlocks,
} from "../../shared/markdown-parser";

test("parseTableCells extracts cell contents cleanly", () => {
  const row = "| Col A | Col B | Col C |";
  assert.deepEqual(parseTableCells(row), ["Col A", "Col B", "Col C"]);

  const rowNoOuterPipes = "Col A | Col B | Col C";
  assert.deepEqual(parseTableCells(rowNoOuterPipes), ["Col A", "Col B", "Col C"]);
});

test("parseTableAlignments accurately determines column alignments", () => {
  const separator = "| :--- | :---: | ---: | --- |";
  assert.deepEqual(parseTableAlignments(separator), ["left", "center", "right", "left"]);
});

test("parseTableBlock parses full markdown table structure", () => {
  const header = "| Name | Role | Status |";
  const separator = "| :--- | :---: | ---: |";
  const body = [
    "| Alice | Lead | Active |",
    "| Bob | Dev | In Review |",
  ];

  const table = parseTableBlock(header, separator, body);
  assert.deepEqual(table.headers, ["Name", "Role", "Status"]);
  assert.deepEqual(table.alignments, ["left", "center", "right"]);
  assert.equal(table.rows.length, 2);
  assert.deepEqual(table.rows[0], ["Alice", "Lead", "Active"]);
  assert.deepEqual(table.rows[1], ["Bob", "Dev", "In Review"]);
});

test("parseInlineTokens extracts plain text", () => {
  const tokens = parseInlineTokens("Just plain text");
  assert.deepEqual(tokens, [{ type: "text", content: "Just plain text" }]);
});

test("parseInlineTokens extracts bold, italic, bold-italic, code, strike, and links", () => {
  const text = "Start **bold** then *italic* and ***bold italic*** plus `code` with ~~deleted~~ and [Site](https://proset.ai) end.";
  const tokens = parseInlineTokens(text);

  const types = tokens.map((t) => t.type);
  assert.ok(types.includes("text"));
  assert.ok(types.includes("bold"));
  assert.ok(types.includes("italic"));
  assert.ok(types.includes("boldItalic"));
  assert.ok(types.includes("code"));
  assert.ok(types.includes("strike"));
  assert.ok(types.includes("link"));

  const linkToken = tokens.find((t) => t.type === "link");
  assert.equal(linkToken?.content, "Site");
  assert.equal(linkToken?.url, "https://proset.ai");
});

test("parseInlineTokens handles nested formatting inside bold and italic", () => {
  const text = "**Bold with `code` and *italic* inside**";
  const tokens = parseInlineTokens(text);

  assert.equal(tokens.length, 1);
  assert.equal(tokens[0].type, "bold");
  assert.ok(tokens[0].children && tokens[0].children.length > 1);

  const childTypes = tokens[0].children.map((c) => c.type);
  assert.ok(childTypes.includes("code"));
  assert.ok(childTypes.includes("italic"));
});

test("parseMarkdownBlocks parses headings H1 through H6", () => {
  const md = `# Heading 1
## Heading 2
### Heading 3
#### Heading 4
##### Heading 5
###### Heading 6`;

  const blocks = parseMarkdownBlocks(md);
  assert.equal(blocks.length, 6);
  assert.deepEqual(blocks.map((b) => b.type), ["heading", "heading", "heading", "heading", "heading", "heading"]);

  if (blocks[0].type === "heading") assert.equal(blocks[0].level, 1);
  if (blocks[1].type === "heading") assert.equal(blocks[1].level, 2);
  if (blocks[2].type === "heading") assert.equal(blocks[2].level, 3);
  if (blocks[3].type === "heading") assert.equal(blocks[3].level, 4);
  if (blocks[4].type === "heading") assert.equal(blocks[4].level, 5);
  if (blocks[5].type === "heading") assert.equal(blocks[5].level, 6);
});

test("parseMarkdownBlocks groups task list items", () => {
  const md = `- [ ] Item 1
- [x] Item 2
  - [ ] Subitem 2.1`;

  const blocks = parseMarkdownBlocks(md);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].type, "taskList");
  if (blocks[0].type === "taskList") {
    assert.equal(blocks[0].items.length, 3);
    assert.equal(blocks[0].items[0].checked, false);
    assert.equal(blocks[0].items[0].indent, 0);
    assert.equal(blocks[0].items[1].checked, true);
    assert.equal(blocks[0].items[1].indent, 0);
    assert.equal(blocks[0].items[2].checked, false);
    assert.equal(blocks[0].items[2].indent, 1);
  }
});

test("parseMarkdownBlocks groups bullet list items", () => {
  const md = `* Bullet 1
* Bullet 2
  * Sub-bullet 2a`;

  const blocks = parseMarkdownBlocks(md);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].type, "bulletList");
  if (blocks[0].type === "bulletList") {
    assert.equal(blocks[0].items.length, 3);
    assert.equal(blocks[0].items[0].text, "Bullet 1");
    assert.equal(blocks[0].items[2].indent, 1);
  }
});

test("parseMarkdownBlocks groups numbered list items", () => {
  const md = `1. First
2. Second
3. Third`;

  const blocks = parseMarkdownBlocks(md);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].type, "numberList");
  if (blocks[0].type === "numberList") {
    assert.equal(blocks[0].items.length, 3);
    assert.equal(blocks[0].items[0].numberStr, "1.");
    assert.equal(blocks[0].items[0].text, "First");
  }
});

test("parseMarkdownBlocks groups multiline blockquotes", () => {
  const md = `> This is a quote
> continuing on the second line
> and third line`;

  const blocks = parseMarkdownBlocks(md);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].type, "blockquote");
  if (blocks[0].type === "blockquote") {
    assert.equal(blocks[0].lines.length, 3);
    assert.equal(blocks[0].lines[0], "This is a quote");
    assert.equal(blocks[0].lines[1], "continuing on the second line");
    assert.equal(blocks[0].lines[2], "and third line");
  }
});

test("parseMarkdownBlocks parses fenced code blocks with language", () => {
  const md = `Before code
\`\`\`typescript
interface User {
  id: string;
  name: string;
}
\`\`\`
After code`;

  const blocks = parseMarkdownBlocks(md);
  assert.equal(blocks.length, 3);
  assert.equal(blocks[0].type, "paragraph");
  assert.equal(blocks[1].type, "code");
  assert.equal(blocks[2].type, "paragraph");

  if (blocks[1].type === "code") {
    assert.equal(blocks[1].lang, "typescript");
    assert.ok(blocks[1].code.includes("interface User"));
  }
});

test("parseMarkdownBlocks parses markdown tables correctly", () => {
  const md = `Intro text

| Feature | Support | Notes |
| :--- | :---: | ---: |
| Headings | Yes | H1-H6 |
| Tables | Yes | Scrollable |

Outro text`;

  const blocks = parseMarkdownBlocks(md);
  const tableBlock = blocks.find((b) => b.type === "table");
  assert.ok(tableBlock);
  if (tableBlock && tableBlock.type === "table") {
    assert.deepEqual(tableBlock.headers, ["Feature", "Support", "Notes"]);
    assert.deepEqual(tableBlock.alignments, ["left", "center", "right"]);
    assert.equal(tableBlock.rows.length, 2);
    assert.deepEqual(tableBlock.rows[0], ["Headings", "Yes", "H1-H6"]);
  }
});

test("parseMarkdownBlocks parses horizontal rules", () => {
  const md = `Section 1\n\n---\n\nSection 2`;
  const blocks = parseMarkdownBlocks(md);
  const hrBlock = blocks.find((b) => b.type === "hr");
  assert.ok(hrBlock);
});

test("parseInlineTokens handles unclosed markers gracefully without throwing", () => {
  const unclosed = "Text with **unclosed bold and `unclosed code and [unclosed link";
  const tokens = parseInlineTokens(unclosed);
  assert.ok(tokens.length > 0);
  assert.equal(tokens[0].type, "text");
});

test("parseMarkdownBlocks handles complex mixed document with multiple artifacts", () => {
  const doc = `# Project Executive Summary

> Important: This summary contains confidential product planning.
> Target launch: Q4.

## Key Deliverables

- [x] Initial design specs
- [ ] User testing feedback
  - [ ] Mobile screen audit
  - [ ] Web accessibility review

### Comparison Matrix

| Option | Pros | Cons | Priority |
| :--- | :--- | :--- | :---: |
| Option A | Fast to ship | Limited scope | High |
| Option B | Comprehensive | Slower rollout | Medium |

### Implementation Snippet

\`\`\`json
{
  "status": "in_progress",
  "version": "1.0.71"
}
\`\`\`

---
1. Review matrix with team
2. Finalize launch checklist`;

  const blocks = parseMarkdownBlocks(doc);
  assert.ok(blocks.length >= 8);

  const headingTypes = blocks.filter((b) => b.type === "heading");
  assert.equal(headingTypes.length, 4);

  const bq = blocks.find((b) => b.type === "blockquote");
  assert.ok(bq);
  if (bq && bq.type === "blockquote") {
    assert.equal(bq.lines.length, 2);
  }

  const taskList = blocks.find((b) => b.type === "taskList");
  assert.ok(taskList);

  const table = blocks.find((b) => b.type === "table");
  assert.ok(table);

  const codeBlock = blocks.find((b) => b.type === "code");
  assert.ok(codeBlock);

  const hr = blocks.find((b) => b.type === "hr");
  assert.ok(hr);

  const numList = blocks.find((b) => b.type === "numberList");
  assert.ok(numList);
});

