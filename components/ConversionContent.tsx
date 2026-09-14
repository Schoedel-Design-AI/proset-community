import React, { useState, useMemo } from "react";
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  Pressable,
  Platform,
  Linking,
} from "react-native";
import Feather from "@react-native-vector-icons/feather/static";
import Colors from "@/constants/colors";
import { useTextScale, sf, type TextScale } from "@/lib/typography";
import * as Haptics from "@/lib/haptics";

export type InlineStyleOptions = {
  bold?: boolean;
  italic?: boolean;
  strike?: boolean;
  color?: string;
  fontFamily?: string;
};

type InlineType = "boldItalic" | "bold" | "code" | "strike" | "italic" | "link";

interface InlineMatch {
  type: InlineType;
  index: number;
  length: number;
  content: string;
  url?: string;
}

export function renderInlineFormatting(
  text: string,
  ts?: TextScale,
  inheritedStyle?: InlineStyleOptions,
  depth = 0
): React.ReactNode {
  if (!text) return null;
  if (depth > 5) return text; // Recursion limit guard

  const parts: React.ReactNode[] = [];
  let remaining = text;
  let key = 0;

  while (remaining.length > 0) {
    const candidates: InlineMatch[] = [];

    // 1. Bold Italic: ***text*** or ___text___
    const biMatch = remaining.match(/^([\s\S]*?)(\*\*\*([^*\n]+?)\*\*\*|___([^_\n]+?)___)/);
    if (biMatch) {
      const prefix = biMatch[1];
      const full = biMatch[2];
      const content = biMatch[3] || biMatch[4];
      candidates.push({ type: "boldItalic", index: prefix.length, length: full.length, content });
    }

    // 2. Bold: **text** or __text__
    const bMatch = remaining.match(/^([\s\S]*?)(\*\*([^*\n]+?)\*\*|__([^_\n]+?)__)/);
    if (bMatch) {
      const prefix = bMatch[1];
      const full = bMatch[2];
      const content = bMatch[3] || bMatch[4];
      candidates.push({ type: "bold", index: prefix.length, length: full.length, content });
    }

    // 3. Inline code: `code`
    const cMatch = remaining.match(/^([\s\S]*?)`([^`\n]+)`/);
    if (cMatch) {
      const prefix = cMatch[1];
      const content = cMatch[2];
      candidates.push({ type: "code", index: prefix.length, length: cMatch[0].length - prefix.length, content });
    }

    // 4. Strikethrough: ~~text~~
    const sMatch = remaining.match(/^([\s\S]*?)~~([^~\n]+?)~~/);
    if (sMatch) {
      const prefix = sMatch[1];
      const content = sMatch[2];
      candidates.push({ type: "strike", index: prefix.length, length: sMatch[0].length - prefix.length, content });
    }

    // 5. Italic: *text* (not surrounded by other *) or _text_ (surrounded by whitespace/boundaries)
    const itMatch = remaining.match(/^([\s\S]*?)((?<!\*)\*([^*\n]+?)\*(?!\*)|(?<=^|[\s.,;:!?([{\-\/])_([^_\n]+?)_(?=$|[\s.,;:!?)}\]\-\/]))/);
    if (itMatch) {
      const prefix = itMatch[1];
      const full = itMatch[2];
      const content = itMatch[3] || itMatch[4];
      candidates.push({ type: "italic", index: prefix.length, length: full.length, content });
    }

    // 6. Link: [text](url)
    const lMatch = remaining.match(/^([\s\S]*?)\[([^\]\n]+)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+)\)/);
    if (lMatch) {
      const prefix = lMatch[1];
      const content = lMatch[2];
      const url = lMatch[3];
      candidates.push({ type: "link", index: prefix.length, length: lMatch[0].length - prefix.length, content, url });
    }

    let earliest: InlineMatch | null = null;
    for (const cand of candidates) {
      if (!earliest || cand.index < earliest.index) {
        earliest = cand;
      }
    }

    if (!earliest) {
      if (inheritedStyle) {
        parts.push(
          <Text
            key={key++}
            style={[
              inheritedStyle.bold && { fontFamily: "Inter_700Bold", fontWeight: "700" as const },
              inheritedStyle.italic && { fontStyle: "italic" as const },
              inheritedStyle.strike && { textDecorationLine: "line-through" as const, color: Colors.textSecondary },
              inheritedStyle.color ? { color: inheritedStyle.color } : undefined,
            ]}
          >
            {remaining}
          </Text>
        );
      } else {
        parts.push(remaining);
      }
      break;
    }

    if (earliest.index > 0) {
      const prefixText = remaining.slice(0, earliest.index);
      if (inheritedStyle) {
        parts.push(
          <Text
            key={key++}
            style={[
              inheritedStyle.bold && { fontFamily: "Inter_700Bold", fontWeight: "700" as const },
              inheritedStyle.italic && { fontStyle: "italic" as const },
              inheritedStyle.strike && { textDecorationLine: "line-through" as const, color: Colors.textSecondary },
              inheritedStyle.color ? { color: inheritedStyle.color } : undefined,
            ]}
          >
            {prefixText}
          </Text>
        );
      } else {
        parts.push(prefixText);
      }
    }

    const hit = earliest;
    const nextStyle: InlineStyleOptions = { ...inheritedStyle };

    if (hit.type === "boldItalic") {
      nextStyle.bold = true;
      nextStyle.italic = true;
      parts.push(
        <Text key={key++} style={{ fontFamily: "Inter_700Bold", fontWeight: "700", fontStyle: "italic" }}>
          {renderInlineFormatting(hit.content, ts, nextStyle, depth + 1)}
        </Text>
      );
    } else if (hit.type === "bold") {
      nextStyle.bold = true;
      parts.push(
        <Text key={key++} style={{ fontFamily: "Inter_700Bold", fontWeight: "700" }}>
          {renderInlineFormatting(hit.content, ts, nextStyle, depth + 1)}
        </Text>
      );
    } else if (hit.type === "italic") {
      nextStyle.italic = true;
      parts.push(
        <Text key={key++} style={{ fontStyle: "italic" }}>
          {renderInlineFormatting(hit.content, ts, nextStyle, depth + 1)}
        </Text>
      );
    } else if (hit.type === "strike") {
      nextStyle.strike = true;
      parts.push(
        <Text key={key++} style={{ textDecorationLine: "line-through", color: Colors.textSecondary }}>
          {renderInlineFormatting(hit.content, ts, nextStyle, depth + 1)}
        </Text>
      );
    } else if (hit.type === "code") {
      parts.push(
        <Text
          key={key++}
          style={[
            {
              fontFamily: Platform.OS === "web" ? "monospace" : "Courier",
              backgroundColor: "rgba(255,255,255,0.08)",
              color: "#38BDF8",
              paddingHorizontal: 5,
              paddingVertical: 1,
              borderRadius: 4,
            },
            ts ? { fontSize: sf(13.5, ts) } : { fontSize: 13.5 },
          ]}
        >
          {hit.content}
        </Text>
      );
    } else if (hit.type === "link") {
      const linkUrl = hit.url || "";
      const isSafe = /^(https?:|mailto:)/i.test(linkUrl.trim());
      parts.push(
        <Text
          key={key++}
          style={{
            color: Colors.primary,
            textDecorationLine: "underline",
            fontFamily: inheritedStyle?.bold ? "Inter_700Bold" : "Inter_500Medium",
            fontStyle: inheritedStyle?.italic ? "italic" : "normal",
          }}
          onPress={isSafe ? () => Linking.openURL(linkUrl.trim()).catch(() => {}) : undefined}
          accessibilityRole="link"
        >
          {renderInlineFormatting(hit.content, ts, inheritedStyle, depth + 1)}
        </Text>
      );
    }

    remaining = remaining.slice(hit.index + hit.length);
  }

  return parts.length === 1 && typeof parts[0] === "string" ? parts[0] : <>{parts}</>;
}

export function ConversionContent({
  content,
  conversionType,
  codeView,
}: {
  content: string;
  conversionType?: string;
  codeView?: boolean;
}) {
  const ts = useTextScale();
  const codeBlockStyles = useMemo(() => makeCodeBlockStyles(ts), [ts]);
  const richTextStyles = useMemo(() => makeRichTextStyles(ts), [ts]);
  const tableStyles = useMemo(() => makeTableStyles(ts), [ts]);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  const handleCopyBlock = async (code: string, index: number) => {
    try {
      if (Platform.OS === "web" && typeof navigator !== "undefined" && navigator.clipboard) {
        await navigator.clipboard.writeText(code);
      } else {
        const Clipboard = await import("@/lib/clipboard");
        await Clipboard.setStringAsync(code);
      }
      setCopiedIndex(index);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setTimeout(() => setCopiedIndex(null), 2000);
    } catch {}
  };

  const renderCodeBlock = (code: string, lang: string, blockIndex: number) => (
    <View key={`code-${blockIndex}`} style={codeBlockStyles.container}>
      <View style={codeBlockStyles.header}>
        <Text style={codeBlockStyles.lang}>{lang || "code"}</Text>
        <Pressable
          onPress={() => handleCopyBlock(code, blockIndex)}
          hitSlop={8}
          style={codeBlockStyles.copyBtn}
          accessibilityLabel="Copy code"
          accessibilityRole="button"
        >
          <Feather
            name={copiedIndex === blockIndex ? "check" : "copy"}
            size={14}
            color={copiedIndex === blockIndex ? Colors.success : "#94A3B8"}
          />
          <Text
            style={[
              codeBlockStyles.copyText,
              copiedIndex === blockIndex && { color: Colors.success },
            ]}
          >
            {copiedIndex === blockIndex ? "Copied" : "Copy"}
          </Text>
        </Pressable>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={Platform.OS === "web"}>
        <Text style={codeBlockStyles.code} selectable>{code}</Text>
      </ScrollView>
    </View>
  );

  const renderTable = (headerLine: string, separatorLine: string, bodyLines: string[], tableKey: string) => {
    const parseCells = (row: string) => {
      let r = row.trim();
      if (r.startsWith("|")) r = r.slice(1);
      if (r.endsWith("|")) r = r.slice(0, -1);
      return r.split("|").map((c) => c.trim());
    };
    const alignments = (() => {
      let s = separatorLine.trim();
      if (s.startsWith("|")) s = s.slice(1);
      if (s.endsWith("|")) s = s.slice(0, -1);
      return s.split("|").map((c) => c.trim());
    })().map((c) => {
      if (c.startsWith(":") && c.endsWith(":")) return "center" as const;
      if (c.endsWith(":")) return "right" as const;
      return "left" as const;
    });
    const headers = parseCells(headerLine);
    const rows = bodyLines.map(parseCells);
    return (
      <View key={tableKey} style={tableStyles.container}>
        <ScrollView horizontal showsHorizontalScrollIndicator={Platform.OS === "web"}>
          <View>
            <View style={tableStyles.headerRow}>
              {headers.map((h, ci) => (
                <View key={ci} style={[tableStyles.cell, tableStyles.headerCell, ci === 0 && tableStyles.firstCell]}>
                  <Text style={[tableStyles.headerText, { textAlign: alignments[ci] || "left" }]}>
                    {renderInlineFormatting(h, ts, { bold: true })}
                  </Text>
                </View>
              ))}
            </View>
            {rows.map((row, ri) => (
              <View key={ri} style={[tableStyles.row, ri % 2 === 1 && tableStyles.altRow]}>
                {row.map((cell, ci) => (
                  <View key={ci} style={[tableStyles.cell, ci === 0 && tableStyles.firstCell]}>
                    <Text style={[tableStyles.cellText, { textAlign: alignments[ci] || "left" }]}>
                      {renderInlineFormatting(cell, ts)}
                    </Text>
                  </View>
                ))}
              </View>
            ))}
          </View>
        </ScrollView>
      </View>
    );
  };

  const renderTextBlock = (text: string, blockIndex: number) => {
    const lines = text.split("\n");
    const elements: React.ReactNode[] = [];
    let li = 0;

    while (li < lines.length) {
      const line = lines[li];
      if (!line.trim()) {
        elements.push(<View key={`space-${li}`} style={richTextStyles.paragraphSpacer} />);
        li++;
        continue;
      }

      // Markdown Table
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
        elements.push(renderTable(headerLine, separatorLine, bodyLines, `table-${blockIndex}-${li}`));
        li = ti;
        continue;
      }

      // Headings: H1 to H6
      const headingMatch = line.match(/^(#{1,6})\s+(.*)/);
      if (headingMatch) {
        const level = headingMatch[1].length;
        const hText = headingMatch[2];
        const headingStyleByLevel =
          level === 1
            ? richTextStyles.heading1
            : level === 2
            ? richTextStyles.heading2
            : level === 3
            ? richTextStyles.heading3
            : level === 4
            ? richTextStyles.heading4
            : level === 5
            ? richTextStyles.heading5
            : richTextStyles.heading6;

        elements.push(
          <Text key={`heading-${li}`} style={headingStyleByLevel} accessibilityRole="header">
            {renderInlineFormatting(hText, ts, { bold: true })}
          </Text>
        );
        li++;
        continue;
      }

      // Horizontal Rule
      if (/^(\s*[-*_]\s*){3,}$/.test(line)) {
        elements.push(<View key={`hr-${li}`} style={richTextStyles.hr} />);
        li++;
        continue;
      }

      // Blockquotes (group consecutive blockquote lines)
      if (line.startsWith(">") || line.startsWith("> ")) {
        const quoteLines: string[] = [];
        let qi = li;
        while (
          qi < lines.length &&
          (lines[qi].startsWith(">") ||
            (lines[qi].trim() !== "" &&
              quoteLines.length > 0 &&
              !lines[qi].startsWith("#") &&
              !lines[qi].match(/^(\s*)[-*+]\s+/) &&
              !lines[qi].match(/^(\s*)\d+[.)]\s+/)))
        ) {
          if (lines[qi].startsWith(">")) {
            quoteLines.push(lines[qi].replace(/^>\s?/, ""));
          } else if (lines[qi].trim() === "") {
            break;
          } else {
            quoteLines.push(lines[qi]);
          }
          qi++;
        }
        elements.push(
          <View key={`quote-${li}`} style={richTextStyles.blockquoteContainer}>
            <View style={richTextStyles.blockquoteBar} />
            <View style={richTextStyles.blockquoteContent}>
              {quoteLines.map((qLine, qIdx) => (
                <Text key={qIdx} style={richTextStyles.blockquoteText}>
                  {renderInlineFormatting(qLine, ts, { italic: true })}
                </Text>
              ))}
            </View>
          </View>
        );
        li = qi;
        continue;
      }

      // Task List items: - [ ] or - [x]
      const taskMatch = line.match(/^(\s*)[-*+]\s+\[([ xX])\]\s+(.*)/);
      if (taskMatch) {
        const checked = taskMatch[2] !== " ";
        const indent = Math.min(Math.floor(taskMatch[1].length / 2), 4);
        elements.push(
          <View key={`task-${li}`} style={[richTextStyles.listRow, { paddingLeft: 6 + indent * 16 }]}>
            <View style={richTextStyles.taskCheckboxWrap}>
              <Feather
                name={checked ? "check-square" : "square"}
                size={16}
                color={checked ? Colors.primary : Colors.textMuted}
              />
            </View>
            <Text
              style={[
                richTextStyles.bodyText,
                richTextStyles.listText,
                checked && richTextStyles.taskTextCompleted,
              ]}
            >
              {renderInlineFormatting(taskMatch[3], ts)}
            </Text>
          </View>
        );
        li++;
        continue;
      }

      // Bullet List items: - or * or +
      const bulletMatch = line.match(/^(\s*)[*+-]\s+(.*)/);
      if (bulletMatch) {
        const indent = Math.min(Math.floor(bulletMatch[1].length / 2), 4);
        const bulletChar = indent === 0 ? "•" : indent === 1 ? "◦" : "▪";
        elements.push(
          <View key={`bullet-${li}`} style={[richTextStyles.listRow, { paddingLeft: 6 + indent * 16 }]}>
            <Text style={richTextStyles.bulletDot}>{bulletChar}</Text>
            <Text style={[richTextStyles.bodyText, richTextStyles.listText]}>
              {renderInlineFormatting(bulletMatch[2], ts)}
            </Text>
          </View>
        );
        li++;
        continue;
      }

      // Numbered List items: 1. or 1)
      const numMatch = line.match(/^(\s*)(\d+)[.)]\s+(.*)/);
      if (numMatch) {
        const indent = Math.min(Math.floor(numMatch[1].length / 2), 4);
        const numStr = numMatch[2];
        const numContent = numMatch[3];
        elements.push(
          <View key={`num-${li}`} style={[richTextStyles.listRow, { paddingLeft: 6 + indent * 16 }]}>
            <Text style={richTextStyles.listNumber}>{numStr}.</Text>
            <Text style={[richTextStyles.bodyText, richTextStyles.listText]}>
              {renderInlineFormatting(numContent, ts)}
            </Text>
          </View>
        );
        li++;
        continue;
      }

      // Regular paragraph text
      elements.push(
        <Text key={`para-${li}`} style={richTextStyles.bodyText}>
          {renderInlineFormatting(line, ts)}
        </Text>
      );
      li++;
    }

    return <View key={`text-${blockIndex}`} style={richTextStyles.textBlock}>{elements}</View>;
  };

  const parseContentBlocks = (): React.ReactNode[] => {
    const nodes: React.ReactNode[] = [];
    let blockIdx = 0;

    if (content.includes("```")) {
      const parts = content.split(/(```[^\n]*\n[\s\S]*?```)/g);
      parts.forEach((part) => {
        const codeMatch = part.match(/^```(\w*)\n?([\s\S]*?)```$/s);
        if (codeMatch) {
          const code = codeMatch[2].replace(/\n$/, "");
          nodes.push(renderCodeBlock(code, codeMatch[1] || "", blockIdx));
          blockIdx++;
        } else if (part.trim()) {
          nodes.push(renderTextBlock(part, blockIdx));
          blockIdx++;
        }
      });
    } else {
      nodes.push(renderTextBlock(content, 0));
    }

    return nodes;
  };

  if (codeView) {
    return (
      <View style={richTextStyles.container}>
        {renderCodeBlock(content, "markdown", 0)}
      </View>
    );
  }

  return (
    <View style={richTextStyles.container}>
      {parseContentBlocks()}
    </View>
  );
}

export const makeCodeBlockStyles = (ts: TextScale) =>
  StyleSheet.create({
    container: {
      backgroundColor: "#181825",
      borderRadius: 12,
      marginVertical: 10,
      overflow: "hidden",
      borderWidth: 1,
      borderColor: "rgba(255, 255, 255, 0.08)",
    },
    header: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      paddingHorizontal: 14,
      paddingVertical: 8,
      backgroundColor: "rgba(255, 255, 255, 0.04)",
      borderBottomWidth: 1,
      borderBottomColor: "rgba(255, 255, 255, 0.06)",
    },
    lang: {
      fontFamily: Platform.OS === "web" ? "monospace" : "Courier",
      fontSize: sf(11, ts),
      color: "#94A3B8",
      textTransform: "uppercase",
      letterSpacing: 0.5,
    },
    copyBtn: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      paddingVertical: 4,
      paddingHorizontal: 8,
      borderRadius: 6,
      backgroundColor: "rgba(255, 255, 255, 0.06)",
    },
    copyText: {
      fontFamily: "Inter_500Medium",
      fontSize: sf(12, ts),
      color: "#94A3B8",
    },
    code: {
      fontFamily: Platform.OS === "web" ? "monospace" : "Courier",
      fontSize: sf(14, ts),
      color: "#E2E8F0",
      lineHeight: 24,
      padding: 14,
    },
    downloadHint: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      paddingTop: 12,
      paddingBottom: 4,
    },
    downloadHintText: {
      fontFamily: "Inter_400Regular",
      fontSize: sf(13, ts),
      color: Colors.textSecondary,
    },
  });

export const makeRichTextStyles = (ts: TextScale) =>
  StyleSheet.create({
    container: {
      width: "100%",
    },
    textBlock: {
      marginBottom: 8,
    },
    heading1: {
      fontFamily: "Inter_700Bold",
      fontWeight: "700",
      fontSize: sf(22, ts),
      lineHeight: 30,
      color: Colors.text,
      marginTop: 22,
      marginBottom: 10,
    },
    heading2: {
      fontFamily: "Inter_700Bold",
      fontWeight: "700",
      fontSize: sf(19, ts),
      lineHeight: 26,
      color: Colors.text,
      marginTop: 18,
      marginBottom: 8,
    },
    heading3: {
      fontFamily: "Inter_600SemiBold",
      fontWeight: "600",
      fontSize: sf(17, ts),
      lineHeight: 24,
      color: Colors.text,
      marginTop: 14,
      marginBottom: 6,
    },
    heading4: {
      fontFamily: "Inter_600SemiBold",
      fontWeight: "600",
      fontSize: sf(15.5, ts),
      lineHeight: 22,
      color: Colors.text,
      marginTop: 12,
      marginBottom: 4,
    },
    heading5: {
      fontFamily: "Inter_600SemiBold",
      fontWeight: "600",
      fontSize: sf(14.5, ts),
      lineHeight: 20,
      color: Colors.textSecondary,
      marginTop: 10,
      marginBottom: 4,
    },
    heading6: {
      fontFamily: "Inter_600SemiBold",
      fontWeight: "600",
      fontSize: sf(13.5, ts),
      lineHeight: 18,
      color: Colors.textMuted,
      marginTop: 8,
      marginBottom: 4,
    },
    bodyText: {
      fontFamily: "Inter_400Regular",
      fontSize: sf(15.5, ts),
      color: Colors.text,
      lineHeight: 28,
      marginBottom: 6,
    },
    paragraphSpacer: {
      height: 16,
    },
    listRow: {
      flexDirection: "row",
      alignItems: "flex-start",
      marginVertical: 3,
    },
    bulletDot: {
      fontFamily: "Inter_600SemiBold",
      fontSize: sf(15, ts),
      color: Colors.primary,
      marginRight: 8,
      lineHeight: 28,
      width: 14,
      textAlign: "center",
    },
    listNumber: {
      fontFamily: "Inter_600SemiBold",
      fontSize: sf(14.5, ts),
      color: Colors.primary,
      marginRight: 8,
      lineHeight: 26,
      minWidth: 20,
      textAlign: "right",
    },
    listText: {
      flex: 1,
      marginBottom: 0,
    },
    taskCheckboxWrap: {
      marginRight: 8,
      marginTop: 4,
    },
    taskTextCompleted: {
      textDecorationLine: "line-through",
      color: Colors.textMuted,
    },
    blockquoteContainer: {
      flexDirection: "row",
      backgroundColor: "rgba(0, 180, 216, 0.05)",
      borderRadius: 8,
      marginVertical: 8,
      overflow: "hidden",
      borderWidth: 1,
      borderColor: "rgba(0, 180, 216, 0.12)",
    },
    blockquoteBar: {
      width: 4,
      backgroundColor: Colors.primary,
    },
    blockquoteContent: {
      flex: 1,
      paddingHorizontal: 12,
      paddingVertical: 10,
      gap: 4,
    },
    blockquoteText: {
      fontFamily: "Inter_400Regular",
      fontSize: sf(14.5, ts),
      color: Colors.textSecondary,
      lineHeight: 28,
      fontStyle: "italic",
    },
    hr: {
      height: 1,
      backgroundColor: "rgba(255, 255, 255, 0.08)",
      marginVertical: 16,
    },
  });

export const makeTableStyles = (ts: TextScale) =>
  StyleSheet.create({
    container: {
      marginVertical: 12,
      borderRadius: 10,
      overflow: "hidden",
      borderWidth: 1,
      borderColor: "rgba(255, 255, 255, 0.08)",
      backgroundColor: "rgba(255, 255, 255, 0.02)",
    },
    headerRow: {
      flexDirection: "row",
      backgroundColor: "rgba(255, 255, 255, 0.08)",
    },
    row: {
      flexDirection: "row",
      borderTopWidth: 1,
      borderTopColor: "rgba(255, 255, 255, 0.06)",
    },
    altRow: {
      backgroundColor: "rgba(255, 255, 255, 0.03)",
    },
    cell: {
      minWidth: 110,
      paddingHorizontal: 12,
      paddingVertical: 10,
      borderLeftWidth: 1,
      borderLeftColor: "rgba(255, 255, 255, 0.06)",
    },
    firstCell: {
      borderLeftWidth: 0,
    },
    headerCell: {},
    headerText: {
      fontFamily: "Inter_600SemiBold",
      fontWeight: "600",
      fontSize: sf(13.5, ts),
      color: Colors.text,
      lineHeight: 20,
    },
    cellText: {
      fontFamily: "Inter_400Regular",
      fontSize: sf(14, ts),
      color: Colors.text,
      lineHeight: 22,
    },
  });

export default ConversionContent;
