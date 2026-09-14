/**
 * Conversion Post-Processor & Sanitizer
 * Protects structured output formats (JSON, CSV, GitHub Issue titles, plain-text narration)
 * from LLM syntax errors, conversational preamble pollution, and markdown leakage.
 *
 * Also owns the deterministic stripping of model reasoning (`<think>…</think>`)
 * so no conversion type ever surfaces the agent's private chain-of-thought
 * (issues #216 / #222).
 */

/** Types that produce structured non-Markdown output (JSON, CSV) or must be
 * plain text for downstream consumers — these never get markdown heading
 * normalization (their format is fixed by their own post-processors). */
const STRUCTURED_OUTPUT_TYPES = new Set([
  "calendar_event", // JSON array
  "spreadsheet",    // CSV
  "github_issue",   // structured title/body format
  "video_script",   // plain spoken text for TTS/ElevenLabs
  "text_message",   // SMS – no markdown
]);

/**
 * Strip all `<think>…</think>` reasoning blocks (case-insensitive and
 * attribute-tolerant) from a conversion. Models can emit reasoning after
 * artifact content, so preserving embedded tags risks exposing it.
 *
 * An unclosed block (including a truncated opening tag) discards everything
 * from its opening tag onward, so interrupted streams cannot leak reasoning.
 */
export function stripThinking(text: string): string {
  const result = text.replace(/<think(?:\s[^>]*)?>[\s\S]*?<\/think\s*>/gi, "");
  const unclosedOpen = result.search(/<think(?:\s[^>]*)?>|<think(?:\s[^>]*)?$/i);
  return (unclosedOpen === -1 ? result : result.slice(0, unclosedOpen)).trim();
}

/**
 * Normalize section headings in markdown output (issue #215).
 *
 * Reasoning models sometimes render sub-headings as standalone bold lines
 * (`**Sub Title**`) instead of `## Sub Title`, leaving copy-pasted markdown
 * that is "not fully markdown". Convert those bold-only lines to `##` headings,
 * skipping code fences and lines that are already headings. Conservative:
 * only a line that is *entirely* bold (no trailing punctuation, no nested
 * emphasis) is treated as a heading.
 */
export function normalizeMarkdownHeadings(markdown: string): string {
  const lines = markdown.split("\n");
  let inFence = false;
  let fenceChar = "";
  let fenceLength = 0;
  let documentTitleSeen = false;
  const out = lines.map((line) => {
    const trimmed = line.trim();
    const fence = trimmed.match(/^(`{3,}|~{3,})/);
    if (fence && (!inFence || fence[1][0] === fenceChar)) {
      if (!inFence) {
        inFence = true;
        fenceChar = fence[1][0];
        fenceLength = fence[1].length;
      } else if (fence[1].length >= fenceLength) {
        inFence = false;
        fenceChar = "";
        fenceLength = 0;
      }
      return line;
    }
    if (inFence) return line;
    // Keep the document title at H1, but make later top-level sections H2.
    const heading = trimmed.match(/^(#{1,6})(\s+)(.*)$/);
    if (heading) {
      if (heading[1].length === 1) {
        if (!documentTitleSeen) {
          documentTitleSeen = true;
          return line;
        }
        return line.replace(/^(\s*)#(\s+)/, "$1##$2");
      }
      return line;
    }
    // Standalone bold line with no nested bold.
    const bold = trimmed.match(/^\*\*([^*]+?)\*\*\s*$/);
    if (bold && bold[1].trim().length > 0 && bold[1].trim().length <= 60) {
      return line.replace(/^\s*/, "").replace(/^\*\*([^*]+?)\*\*\s*$/, "## $1");
    }
    return line;
  });
  return out.join("\n");
}

export function sanitizeConversionOutput(type: string, rawOutput: string, outputFormat?: string): string {
  if (!rawOutput || !rawOutput.trim()) return rawOutput;

  // Failsafe (issues #216 / #222): strip model reasoning for EVERY type,
  // not just notes/outline. Structured post-processors below then work on the
  // reasoning-free text.
  const trimmed = stripThinking(rawOutput);

  let result: string;

  switch (type) {
    case "notes":
    case "outline": {
      // Reasoning is already stripped above; nothing further to do.
      result = trimmed;
      break;
    }

    case "calendar_event": {
      // Extract JSON array from code block if present
      const jsonBlockMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
      const jsonText = jsonBlockMatch ? jsonBlockMatch[1].trim() : trimmed;

      try {
        const parsed = JSON.parse(jsonText);
        if (Array.isArray(parsed)) {
          result = JSON.stringify(parsed, null, 2);
          break;
        }
      } catch {
        // Attempt basic JSON repairs (remove trailing commas before ] or })
        try {
          const repaired = jsonText
            .replace(/,\s*([\]}])/g, "$1")
            .replace(/([{\s,])(\w+)\s*:/g, '$1"$2":');
          const parsed = JSON.parse(repaired);
          if (Array.isArray(parsed)) {
            result = JSON.stringify(parsed, null, 2);
            break;
          }
        } catch {
          // If JSON repair fails, preserve the original output
        }
      }

      result = trimmed;
      break;
    }

    case "spreadsheet": {
      // Strip conversational intro/outro text around CSV output
      const lines = trimmed.split("\n");

      // Strip leading lines that look like conversational preambles
      while (
        lines.length > 0 &&
        (lines[0].startsWith("Here is") ||
          lines[0].startsWith("Sure") ||
          lines[0].startsWith("Certainly") ||
          lines[0].startsWith("Below is") ||
          lines[0].startsWith("```csv") ||
          lines[0].startsWith("```"))
      ) {
        lines.shift();
      }

      // Strip trailing lines that look like closing remarks or code fences
      while (
        lines.length > 0 &&
        (lines[lines.length - 1].startsWith("```") ||
          lines[lines.length - 1].startsWith("Hope this") ||
          lines[lines.length - 1].startsWith("Let me know"))
      ) {
        lines.pop();
      }

      result = lines.join("\n").trim();
      break;
    }

    case "github_issue": {
      const lines = trimmed.split("\n");
      const firstLine = lines[0]?.trim() || "";

      if (firstLine && !firstLine.startsWith("# TITLE:")) {
        if (firstLine.startsWith("# ")) {
          lines[0] = firstLine.replace(/^#\s*/, "# TITLE: ");
        } else if (/^title:\s*/i.test(firstLine)) {
          lines[0] = firstLine.replace(/^title:\s*/i, "# TITLE: ");
        }
      }
      result = lines.join("\n").trim();
      break;
    }

    case "video_script":
    case "text_message": {
      // Remove markdown bold/italics syntax and headers that interfere with ElevenLabs narration or SMS
      result = trimmed
        .replace(/^#{1,6}\s+/gm, "") // Strip headers
        .replace(/\*\*([^*]+)\*\*/g, "$1") // Strip bold
        .replace(/__([^_]+)__/g, "$1") // Strip underline
        .replace(/`([^`]+)`/g, "$1") // Strip code
        .trim();
      break;
    }

    default:
      result = trimmed;
      break;
  }

  // Markdown heading normalization (issue #215): only for markdown-format output
  // on non-structured types. Plain-text / structured output is untouched.
  if (outputFormat === "markdown" && !STRUCTURED_OUTPUT_TYPES.has(type)) {
    result = normalizeMarkdownHeadings(result);
  }

  return result;
}

/**
 * Buffer a stream of LLM chunks and suppress any `<think>…</think>` reasoning
 * so it never reaches the client's live view. Chunks are held only while a
 * think block (or a partial `<think` tag) may be in flight; everything outside
 * reasoning is emitted immediately. `flush()` returns any held, cleaned
 * remainder at end-of-stream (never a partial reasoning block).
 */
export function createThinkingStreamFilter(): {
  push: (chunk: string) => string | null;
  flush: () => string;
} {
  let buf = "";
  const THINK_OPEN = "<think";
  const findPartialOpen = (value: string): number => {
    const lower = value.toLowerCase();
    for (let i = lower.length - 1; i >= 0; i--) {
      if (lower[i] !== "<") continue;
      const candidate = lower.slice(i);
      if (THINK_OPEN.startsWith(candidate) || /^<think(?:\s[^>]*)?$/i.test(candidate)) {
        return i;
      }
    }
    return -1;
  };

  return {
    push(chunk: string): string | null {
      buf += chunk;
      let out = "";
      let rest = buf;
      while (true) {
        const openIdx = rest.search(/<think(?:\s[^>]*)?>/i);
        if (openIdx === -1) {
          // Hold a partial opening tag, including an incomplete attribute list.
          const partialIdx = findPartialOpen(rest);
          if (partialIdx === -1) {
            out += rest;
            rest = "";
          } else {
            out += rest.slice(0, partialIdx);
            rest = rest.slice(partialIdx);
          }
          break;
        }
        out += rest.slice(0, openIdx); // text before the block is clean
        const afterOpen = rest.slice(openIdx);
        const closeMatch = afterOpen.match(/<\/think\s*>/i);
        if (!closeMatch) {
          // Inside an open think block — hold everything from <think onward.
          rest = afterOpen;
          break;
        }
        rest = afterOpen.slice(closeMatch.index! + closeMatch[0].length);
      }
      buf = rest;
      return out.length > 0 ? out : null;
    },
    flush(): string {
      // Any held opening tag represents an interrupted reasoning block.
      const completeOpenIdx = buf.search(/<think(?:\s[^>]*)?>/i);
      const hasUnclosedOpen =
        completeOpenIdx >= 0 && !/<\/think\s*>/i.test(buf.slice(completeOpenIdx));
      const partialIdx = findPartialOpen(buf);
      const cutIdx = hasUnclosedOpen ? completeOpenIdx : partialIdx;
      const remainder = cutIdx === -1 ? buf : buf.slice(0, cutIdx);
      const cleaned = stripThinking(remainder);
      buf = "";
      return cleaned;
    },
  };
}

export function createMarkdownHeadingStreamFilter(): {
  push: (chunk: string) => string | null;
  flush: () => string;
} {
  let pending = "";
  let inFence = false;
  let fenceChar = "";
  let fenceLength = 0;
  let documentTitleSeen = false;
  const normalizeLine = (line: string): string => {
    const trimmed = line.trim();
    const fence = trimmed.match(/^(`{3,}|~{3,})/);
    if (fence && (!inFence || fence[1][0] === fenceChar)) {
      if (!inFence) {
        inFence = true;
        fenceChar = fence[1][0];
        fenceLength = fence[1].length;
      } else if (fence[1].length >= fenceLength) {
        inFence = false;
        fenceChar = "";
        fenceLength = 0;
      }
      return line;
    }
    if (inFence) return line;
    const heading = trimmed.match(/^(#{1,6})(\s+)(.*)$/);
    if (heading) {
      if (heading[1].length === 1) {
        if (!documentTitleSeen) {
          documentTitleSeen = true;
          return line;
        }
        return line.replace(/^(\s*)#(\s+)/, "$1##$2");
      }
      return line;
    }
    const bold = trimmed.match(/^\*\*([^*]+?)\*\*\s*$/);
    if (bold && bold[1].trim().length > 0 && bold[1].trim().length <= 60) {
      return line.replace(/^\s*/, "").replace(/^\*\*([^*]+?)\*\*\s*$/, "## $1");
    }
    return line;
  };
  const normalizeLines = (text: string): string =>
    text.split("\n").map(normalizeLine).join("\n");

  return {
    push(chunk: string): string | null {
      pending += chunk;
      const lines = pending.split("\n");
      pending = lines.pop() ?? "";
      const result = normalizeLines(lines.join("\n") + (lines.length ? "\n" : ""));
      return result || null;
    },
    flush(): string {
      const result = normalizeLines(pending);
      pending = "";
      return result;
    },
  };
}

export function getConversionStreamChunk(type: string, content: string): string | null {
  return type === "notes" || type === "outline" ? null : content;
}

/**
 * Filter style and skill instructions for plain-text / structured output targets
 * to prevent markdown instructions from bleeding into plain-text conversions.
 */
export function sanitizePromptContextForTarget(type: string, promptText: string): string {
  if (type !== "video_script" && type !== "text_message" && type !== "spreadsheet") {
    return promptText;
  }

  // Remove aggressive markdown formatting requests for plain-text targets
  return promptText
    .replace(/use\s+bold\s+headers/gi, "")
    .replace(/format\s+with\s+markdown/gi, "")
    .replace(/use\s+markdown\s+tables/gi, "");
}
