export type MarkdownBlock =
  | { type: "code"; lang: string; code: string }
  | { type: "heading"; level: 1 | 2 | 3 | 4 | 5 | 6; text: string }
  | { type: "taskList"; items: Array<{ checked: boolean; indent: number; text: string }> }
  | { type: "bulletList"; items: Array<{ indent: number; text: string }> }
  | { type: "numberList"; items: Array<{ indent: number; numberStr: string; text: string }> }
  | { type: "blockquote"; lines: string[] }
  | { type: "hr" }
  | {
      type: "table";
      headers: string[];
      alignments: Array<"left" | "center" | "right">;
      rows: string[][];
    }
  | { type: "paragraph"; text: string }
  | { type: "empty" };

export type InlineTokenType =
  | "text"
  | "boldItalic"
  | "bold"
  | "italic"
  | "strike"
  | "code"
  | "link";

export interface InlineToken {
  type: InlineTokenType;
  content: string;
  url?: string;
  children?: InlineToken[];
}

/**
 * Parses markdown table lines into headers, column alignments, and row cells.
 */
export function parseTableCells(row: string): string[] {
  let r = row.trim();
  if (r.startsWith("|")) r = r.slice(1);
  if (r.endsWith("|")) r = r.slice(0, -1);
  return r.split("|").map((c) => c.trim());
}

export function parseTableAlignments(separatorLine: string): Array<"left" | "center" | "right"> {
  const parts = parseTableCells(separatorLine);
  return parts.map((cell) => {
    const trimmed = cell.trim();
    if (trimmed.startsWith(":") && trimmed.endsWith(":")) return "center";
    if (trimmed.endsWith(":")) return "right";
    return "left";
  });
}

export function parseTableBlock(
  headerLine: string,
  separatorLine: string,
  bodyLines: string[]
): {
  headers: string[];
  alignments: Array<"left" | "center" | "right">;
  rows: string[][];
} {
  const headers = parseTableCells(headerLine);
  const alignments = parseTableAlignments(separatorLine);
  const rows = bodyLines.map(parseTableCells);
  return { headers, alignments, rows };
}

interface RawInlineMatch {
  type: "boldItalic" | "bold" | "italic" | "strike" | "code" | "link";
  index: number;
  length: number;
  content: string;
  url?: string;
}

/**
 * Parses inline markdown tokens recursively up to depth 5.
 */
export function parseInlineTokens(text: string, depth = 0): InlineToken[] {
  if (!text) return [];
  if (depth > 5) return [{ type: "text", content: text }];

  const tokens: InlineToken[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    const candidates: RawInlineMatch[] = [];

    // 1. Bold Italic: ***text*** or ___text___
    const biMatch = remaining.match(/^([\s\S]*?)(\*\*\*([^\n]+?)\*\*\*|___([^\n]+?)___)/);
    if (biMatch) {
      candidates.push({
        type: "boldItalic",
        index: biMatch[1].length,
        length: biMatch[2].length,
        content: biMatch[3] || biMatch[4],
      });
    }

    // 2. Bold: **text** or __text__
    const bMatch = remaining.match(/^([\s\S]*?)(\*\*([^\n]+?)\*\*|__([^\n]+?)__)/);
    if (bMatch) {
      candidates.push({
        type: "bold",
        index: bMatch[1].length,
        length: bMatch[2].length,
        content: bMatch[3] || bMatch[4],
      });
    }

    // 3. Inline Code: `code`
    const cMatch = remaining.match(/^([\s\S]*?)(`([^`\n]+?)`)/);
    if (cMatch) {
      candidates.push({
        type: "code",
        index: cMatch[1].length,
        length: cMatch[2].length,
        content: cMatch[3],
      });
    }

    // 4. Strikethrough: ~~text~~
    const sMatch = remaining.match(/^([\s\S]*?)(~~([^~\n]+?)~~)/);
    if (sMatch) {
      candidates.push({
        type: "strike",
        index: sMatch[1].length,
        length: sMatch[2].length,
        content: sMatch[3],
      });
    }

    // 5. Italic: *text* or _text_
    const itMatch = remaining.match(/^([\s\S]*?)((?<!\*)\*([^*\n]+?)\*(?!\*)|(?<!_)_([^_\n]+?)_(?!_))/);
    if (itMatch) {
      candidates.push({
        type: "italic",
        index: itMatch[1].length,
        length: itMatch[2].length,
        content: itMatch[3] || itMatch[4],
      });
    }

    // 6. Link: [text](url)
    const lMatch = remaining.match(/^([\s\S]*?)(\[([^\]\n]+)\]\(([^)\n\s]+)\))/);
    if (lMatch) {
      candidates.push({
        type: "link",
        index: lMatch[1].length,
        length: lMatch[2].length,
        content: lMatch[3],
        url: lMatch[4],
      });
    }

    if (candidates.length === 0) {
      tokens.push({ type: "text", content: remaining });
      break;
    }

    candidates.sort((a, b) => a.index - b.index || b.length - a.length);
    const earliest = candidates[0];

    if (earliest.index > 0) {
      tokens.push({ type: "text", content: remaining.slice(0, earliest.index) });
    }

    if (earliest.type === "code") {
      tokens.push({ type: "code", content: earliest.content });
    } else if (earliest.type === "link") {
      tokens.push({
        type: "link",
        content: earliest.content,
        url: earliest.url,
        children: parseInlineTokens(earliest.content, depth + 1),
      });
    } else {
      tokens.push({
        type: earliest.type,
        content: earliest.content,
        children: parseInlineTokens(earliest.content, depth + 1),
      });
    }

    remaining = remaining.slice(earliest.index + earliest.length);
  }

  return tokens;
}

/**
 * Parses full markdown document into a list of structured blocks.
 */
export function parseMarkdownBlocks(content: string): MarkdownBlock[] {
  if (!content) return [];

  const blocks: MarkdownBlock[] = [];

  // If content has code blocks, split on code blocks first
  if (content.includes("```")) {
    const parts = content.split(/(```[^\n]*\n[\s\S]*?```)/g);
    for (const part of parts) {
      const codeMatch = part.match(/^```(\w*)\n?([\s\S]*?)```$/s);
      if (codeMatch) {
        const code = codeMatch[2].replace(/\n$/, "");
        blocks.push({
          type: "code",
          lang: codeMatch[1] || "",
          code,
        });
      } else if (part.trim()) {
        blocks.push(...parseTextBlock(part.trim()));
      }
    }
  } else {
    blocks.push(...parseTextBlock(content));
  }

  return blocks;
}

function parseTextBlock(text: string): MarkdownBlock[] {
  const lines = text.split("\n");
  const blocks: MarkdownBlock[] = [];
  let li = 0;

  while (li < lines.length) {
    const line = lines[li];
    const trimmed = line.trim();

    if (!trimmed) {
      blocks.push({ type: "empty" });
      li++;
      continue;
    }

    // Table detection: current line has '|', next line is a markdown table separator
    if (
      line.includes("|") &&
      li + 1 < lines.length &&
      /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(lines[li + 1])
    ) {
      const headerLine = line;
      const separatorLine = lines[li + 1];
      const bodyLines: string[] = [];
      let ti = li + 2;
      while (ti < lines.length && lines[ti].includes("|") && lines[ti].trim() !== "") {
        bodyLines.push(lines[ti]);
        ti++;
      }
      const tableData = parseTableBlock(headerLine, separatorLine, bodyLines);
      blocks.push({
        type: "table",
        headers: tableData.headers,
        alignments: tableData.alignments,
        rows: tableData.rows,
      });
      li = ti;
      continue;
    }

    // Heading: #{1,6} Title
    const headingMatch = line.match(/^(#{1,6})\s+(.*)/);
    if (headingMatch) {
      const level = headingMatch[1].length as 1 | 2 | 3 | 4 | 5 | 6;
      blocks.push({
        type: "heading",
        level,
        text: headingMatch[2].trim(),
      });
      li++;
      continue;
    }

    // Task list: - [ ] or - [x]
    const taskMatch = line.match(/^(\s*)[-*]\s+\[([ xX])\]\s+(.*)/);
    if (taskMatch) {
      const items: Array<{ checked: boolean; indent: number; text: string }> = [];
      let ti = li;
      while (ti < lines.length) {
        const curMatch = lines[ti].match(/^(\s*)[-*]\s+\[([ xX])\]\s+(.*)/);
        if (!curMatch) break;
        const checked = curMatch[2] !== " ";
        const indent = Math.min(Math.floor(curMatch[1].length / 2), 3);
        items.push({ checked, indent, text: curMatch[3] });
        ti++;
      }
      blocks.push({ type: "taskList", items });
      li = ti;
      continue;
    }

    // Bullet list: - or *
    const bulletMatch = line.match(/^(\s*)[*-]\s+(.*)/);
    if (bulletMatch) {
      const items: Array<{ indent: number; text: string }> = [];
      let bi = li;
      while (bi < lines.length) {
        const curMatch = lines[bi].match(/^(\s*)[*-]\s+(.*)/);
        if (!curMatch) break;
        // Check if it's actually a task list item
        if (/^(\s*)[-*]\s+\[[ xX]\]\s+/.test(lines[bi])) break;
        const indent = Math.min(Math.floor(curMatch[1].length / 2), 3);
        items.push({ indent, text: curMatch[2] });
        bi++;
      }
      if (items.length > 0) {
        blocks.push({ type: "bulletList", items });
        li = bi;
        continue;
      }
    }

    // Numbered list: 1. or 1)
    const numMatch = line.match(/^(\s*)(\d+[\.\)])\s+(.*)/);
    if (numMatch) {
      const items: Array<{ indent: number; numberStr: string; text: string }> = [];
      let ni = li;
      while (ni < lines.length) {
        const curMatch = lines[ni].match(/^(\s*)(\d+[\.\)])\s+(.*)/);
        if (!curMatch) break;
        const indent = Math.min(Math.floor(curMatch[1].length / 2), 3);
        items.push({ indent, numberStr: curMatch[2], text: curMatch[3] });
        ni++;
      }
      blocks.push({ type: "numberList", items });
      li = ni;
      continue;
    }

    // Blockquote: group consecutive > lines
    if (line.startsWith("> ") || line === ">") {
      const bqLines: string[] = [];
      let bqi = li;
      while (bqi < lines.length && (lines[bqi].startsWith("> ") || lines[bqi] === ">" || (bqLines.length > 0 && lines[bqi].trim() !== "" && !lines[bqi].startsWith("#") && !lines[bqi].startsWith("-") && !lines[bqi].startsWith("*")))) {
        if (lines[bqi].startsWith("> ")) {
          bqLines.push(lines[bqi].slice(2));
        } else if (lines[bqi] === ">") {
          bqLines.push("");
        } else {
          bqLines.push(lines[bqi]);
        }
        bqi++;
      }
      blocks.push({ type: "blockquote", lines: bqLines });
      li = bqi;
      continue;
    }

    // Horizontal rule: ---, ***, ___
    if (/^\s*(---|\*\*\*|___)\s*$/.test(line)) {
      blocks.push({ type: "hr" });
      li++;
      continue;
    }

    // Standard paragraph line
    blocks.push({ type: "paragraph", text: line });
    li++;
  }

  return blocks;
}
