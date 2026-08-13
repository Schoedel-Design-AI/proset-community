// Transcript formatting shared by server (storage) and app (display).
//
// ASR output (Whisper et al.) is a single unbroken string — a "wall of text".
// paragraphizeTranscript() groups sentences into readable paragraphs of
// roughly 2–4 sentences each, joined by blank lines, so long transcripts can
// actually be read.
//
// Invariants:
//  - NEVER loses, reorders, or rewrites words (only inserts "\n\n" between
//    groups). Used on stored source-of-truth data.
//  - Idempotent: text that already contains paragraph breaks is normalized
//    and returned untouched — never re-grouped.
//  - Abbreviation-safe: periods inside "Dr. Smith", "U.S.", "a.m." do not
//    start a new sentence.

const ABBREVIATION_TOKENS = new Set([
  "mr", "mrs", "ms", "mx", "dr", "prof", "st", "sr", "jr", "vs", "etc",
  "approx", "dept", "est", "min", "max", "fig", "no", "jan", "feb", "mar",
  "apr", "jun", "jul", "aug", "sep", "oct", "nov", "dec",
]);

// Target paragraph size (chars). Longer text gets grouped into ~this size.
const TARGET_PARAGRAPH_CHARS = 220;

function isSentenceEnd(current: string, char: string, rest: string, i: number): boolean {
  // Word immediately before the punctuation — used to skip abbreviations.
  const before = current.trim().split(/\s+/).pop() || "";
  const abbrev =
    /^([A-Za-z]\.)+$/.test(before) || // initials: "J.", "U.S.", "a.m."
    ABBREVIATION_TOKENS.has(before.replace(/\.$/, "").toLowerCase());
  if (abbrev) return false;

  const next = rest[i + 1];
  if (next === undefined) return true; // end of string
  if (next === "\n") return true;
  // Sentence end only when followed by whitespace + an uppercase letter
  // (or a quote/¿¡ — Spanish questions/exclamations open with them).
  if (/\s/.test(next)) {
    const after = rest[i + 2] ?? "";
    return /[A-ZÁÉÍÓÚÜÑ"“'¿¡(]/.test(after);
  }
  return false;
}

export function splitSentences(text: string): string[] {
  const sentences: string[] = [];
  let current = "";
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    current += char;
    if (char === "." || char === "!" || char === "?" || char === "…") {
      // Absorb closing quotes/brackets into the sentence.
      while (i + 1 < text.length && /["”')\]]/.test(text[i + 1])) {
        current += text[i + 1];
        i++;
      }
      if (isSentenceEnd(current, char, text, i)) {
        const trimmed = current.trim();
        if (trimmed) sentences.push(trimmed);
        current = "";
      }
    }
  }
  const tail = current.trim();
  if (tail) sentences.push(tail);
  return sentences;
}

export function paragraphizeTranscript(text: string): string {
  const normalized = text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!normalized) return normalized;
  // Already structured — preserve the stored grouping.
  if (normalized.includes("\n\n")) return normalized;

  const sentences = splitSentences(normalized);
  if (sentences.length <= 1) return normalized;

  const paragraphs: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    const candidate = current ? `${current} ${sentence}` : sentence;
    if (current && candidate.length > TARGET_PARAGRAPH_CHARS) {
      paragraphs.push(current);
      current = sentence;
    } else {
      current = candidate;
    }
  }
  if (current) paragraphs.push(current);
  return paragraphs.join("\n\n");
}
