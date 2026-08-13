/**
 * Conversion Post-Processor & Sanitizer
 * Protects structured output formats (JSON, CSV, GitHub Issue titles, plain-text narration)
 * from LLM syntax errors, conversational preamble pollution, and markdown leakage.
 */

export function sanitizeConversionOutput(type: string, rawOutput: string): string {
  if (!rawOutput || !rawOutput.trim()) return rawOutput;

  const trimmed = rawOutput.trim();

  switch (type) {
    case "calendar_event": {
      // Extract JSON array from code block if present
      const jsonBlockMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
      const jsonText = jsonBlockMatch ? jsonBlockMatch[1].trim() : trimmed;

      try {
        const parsed = JSON.parse(jsonText);
        if (Array.isArray(parsed)) {
          return JSON.stringify(parsed, null, 2);
        }
      } catch {
        // Attempt basic JSON repairs (remove trailing commas before ] or })
        try {
          const repaired = jsonText
            .replace(/,\s*([\]}])/g, "$1")
            .replace(/([{\s,])(\w+)\s*:/g, '$1"$2":');
          const parsed = JSON.parse(repaired);
          if (Array.isArray(parsed)) {
            return JSON.stringify(parsed, null, 2);
          }
        } catch {
          // If JSON repair fails, preserve the original output
        }
      }
      return trimmed;
    }

    case "spreadsheet": {
      // Strip conversational intro/outro text around CSV output
      let lines = trimmed.split("\n");

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

      return lines.join("\n").trim();
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
      return lines.join("\n").trim();
    }

    case "video_script":
    case "text_message": {
      // Remove markdown bold/italics syntax and headers that interfere with ElevenLabs narration or SMS
      let clean = trimmed
        .replace(/^#{1,6}\s+/gm, "") // Strip headers
        .replace(/\*\*([^*]+)\*\*/g, "$1") // Strip bold
        .replace(/__([^_]+)__/g, "$1") // Strip underline
        .replace(/`([^`]+)`/g, "$1"); // Strip code

      return clean.trim();
    }

    default:
      return trimmed;
  }
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
