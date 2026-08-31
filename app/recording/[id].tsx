import React, { useState, useRef, useEffect, useMemo } from "react";
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  Pressable,
Image,
  Platform,
  Alert,
  ActivityIndicator,
  Modal,
  Share,
  TextInput,
  Switch,
  Linking,
  PanResponder,
  useWindowDimensions,
  Keyboard,
} from "react-native";
import { router, useLocalSearchParams } from "@/lib/navigation";
import type { NativeSyntheticEvent, TextLayoutEventData } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Feather from "@react-native-vector-icons/feather/static";
import FontAwesome from "@react-native-vector-icons/fontawesome/static";
import { Audio } from "@/lib/audio";
import { getAudioUploadMetadata } from "@/lib/audio-upload-metadata";
import logoTransparent from "@/assets/images/icons-xai/105-transparent.png";
import * as FileSystem from "@/lib/file-system";
import * as Sharing from "@/lib/sharing";
import {
  arrayBufferToBase64,
  triggerWebDownload,
} from "@/lib/downloads";
import { useFileDownload } from "@/lib/use-file-download";
import { isLocalFileUri } from "@/lib/download-plan";
import * as Haptics from "@/lib/haptics";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Colors from "@/constants/colors";
import { resolveBucketUriWithBase } from "@/lib/bucket-uri";
import { useRecordings, type Conversion } from "@/lib/recordings-context";
import NavigationDrawer from "@/components/NavigationDrawer";
import FeedbackIconButton from "@/components/FeedbackIconButton";
import FloatingActionHalo from "@/components/FloatingActionHalo";
import ProfileDropdown from "@/components/ProfileDropdown";
import { useFeedback } from "@/lib/feedback-context";
import { formatDuration, generateId, CONVERSION_TYPES, CONVERSION_COMPLEXITY_GROUPS, CONVERSION_COMPLEXITY_MAP, PACK_GROUPS, EXPORT_FORMATS, CITATION_STYLES, TIER_DISPLAY_NAMES, getRequiredTierForConversionType, isConversionTypeAvailable, RESEARCH_FORMS_TYPES, researchFormWebDefault, type SubscriptionTier } from "@/lib/utils";
import { useCyclingStatus } from "@/lib/useCyclingStatus";
import { getApiUrl, getAuthHeaders } from "@/lib/query-client";
import { useAuth } from "@/lib/auth-context";
import AvatarView from "@/components/AvatarView";
import { getTranscriptionText, getUploadedAudioUri, hasTranscriptionContent } from "@/lib/recording-api";
import {
  enqueueBackgroundUpload,
  getBackgroundUploadStatus,
} from "@/lib/upload-worker";
// Cloud-only transcription — local whisper preview disconnected
import { useResponsiveLayout } from "@/lib/useResponsiveLayout";
import { useLanguage } from "@/lib/i18n";
import { useTextScale, sf, type TextScale } from "@/lib/typography";
import ProcessingAnimation from "@/components/ProcessingAnimation";
import {
  buildConversionSource,
  isConversionSourceTooShort,
  MIN_TEXT_ENTRY_CHARS,
  type ConversionSourceAttachment,
} from "@shared/conversion-source";
import {
  keyboardRevealOffset,
  keyboardScrollPadding,
  keyboardTopEdge,
} from "@/lib/keyboard-reveal";
import type { SelfServiceModuleState } from "@shared/self-service-modules";
import { continueThoughtFromRecording } from "@/lib/thought-threads";
import {
  getFloatingActionBottomOffset,
  RECORDING_DETAIL_ACTION_SIZE,
} from "@/constants/record-layout";
import {
  getRecordingTransferMessageKey,
  reconcileRecordingTransfer,
} from "@shared/recording-transfer";
import { paragraphizeTranscript } from "@shared/transcript-format";
import { DECK_STYLES } from "@shared/deck-styles";
import { createUtf8Decoder } from "@/lib/utf8";

function authFetch(url: string, options?: RequestInit): Promise<Response> {
  const headers = { ...options?.headers, ...getAuthHeaders() };
  const body = options?.body ?? undefined;
  return globalThis.fetch(url, {
    ...options,
    body,
    credentials: "include",
    headers,
  });
}

function authExpoFetch(url: string, options?: RequestInit): Promise<Response> {
  const headers = { ...options?.headers, ...getAuthHeaders() };
  const expoOptions: Record<string, unknown> = {
    credentials: "include",
    headers,
  };
  if (options?.method) expoOptions.method = options.method;
  if (options?.body != null) expoOptions.body = options.body;
  if (options?.cache) expoOptions.cache = options.cache;
  if (options?.integrity) expoOptions.integrity = options.integrity;
  if (options?.keepalive != null) expoOptions.keepalive = options.keepalive;
  if (options?.mode) expoOptions.mode = options.mode;
  if (options?.priority) expoOptions.priority = options.priority;
  if (options?.redirect) expoOptions.redirect = options.redirect;
  if (options?.referrer) expoOptions.referrer = options.referrer;
  if (options?.referrerPolicy) expoOptions.referrerPolicy = options.referrerPolicy;
  if (options?.signal) expoOptions.signal = options.signal;
  return globalThis.fetch(url, expoOptions as any);
}

const CUSTOM_PROMPTS_KEY = "@voicenote_custom_prompts";
const DRAFT_KEY_PREFIX = "@voicenote_draft_";
const MAX_SOURCE_ATTACHMENT_TEXT = 700_000;

function ConversionContent({ content, conversionType, codeView }: { content: string; conversionType?: string; codeView?: boolean }) {
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
          <Feather name={copiedIndex === blockIndex ? "check" : "copy"} size={14} color={copiedIndex === blockIndex ? "#4ade80" : "#94a3b8"} />
          <Text style={[codeBlockStyles.copyText, copiedIndex === blockIndex && { color: "#4ade80" }]}>
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
                  <Text style={[tableStyles.headerText, { textAlign: alignments[ci] || "left" }]}>{renderInlineFormatting(h, ts)}</Text>
                </View>
              ))}
            </View>
            {rows.map((row, ri) => (
              <View key={ri} style={[tableStyles.row, ri % 2 === 1 && tableStyles.altRow]}>
                {row.map((cell, ci) => (
                  <View key={ci} style={[tableStyles.cell, ci === 0 && tableStyles.firstCell]}>
                    <Text style={[tableStyles.cellText, { textAlign: alignments[ci] || "left" }]}>{renderInlineFormatting(cell, ts)}</Text>
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
      if (!line.trim()) { elements.push(<View key={li} style={{ height: 12 }} />); li++; continue; }

      if (line.includes("|") && li + 1 < lines.length && /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(lines[li + 1])) {
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

      const headingMatch = line.match(/^(#{1,3})\s+(.*)/);
      if (headingMatch) {
        const level = headingMatch[1].length;
        const hText = headingMatch[2].replace(/\*\*(.*?)\*\*/g, "$1");
        elements.push(
          <Text key={li} style={[
            richTextStyles.heading,
            level === 1 && { fontSize: sf(20, ts) },
            level === 2 && { fontSize: sf(18, ts) },
            level === 3 && { fontSize: sf(16, ts) },
          ]}>{hText}</Text>
        );
        li++; continue;
      }

      const taskMatch = line.match(/^(\s*)[-*]\s+\[([ xX])\]\s+(.*)/);
      if (taskMatch) {
        const checked = taskMatch[2] !== " ";
        const indent = Math.min(Math.floor(taskMatch[1].length / 2), 3);
        elements.push(
          <View key={li} style={[richTextStyles.bulletRow, { paddingLeft: 8 + indent * 16 }]}>
            <Text style={[richTextStyles.bulletDot, checked && { color: Colors.primary }]}>{checked ? "☑" : "☐"}</Text>
            <Text style={[richTextStyles.bodyText, checked && { textDecorationLine: "line-through", color: Colors.textSecondary }]}>{renderInlineFormatting(taskMatch[3], ts)}</Text>
          </View>
        );
        li++; continue;
      }

      const bulletMatch = line.match(/^(\s*)[*-]\s+(.*)/);
      if (bulletMatch) {
        const indent = Math.min(Math.floor(bulletMatch[1].length / 2), 3);
        elements.push(
          <View key={li} style={[richTextStyles.bulletRow, { paddingLeft: 8 + indent * 16 }]}>
            <Text style={richTextStyles.bulletDot}>•</Text>
            <Text style={richTextStyles.bodyText}>{renderInlineFormatting(bulletMatch[2], ts)}</Text>
          </View>
        );
        li++; continue;
      }

      const numMatch = line.match(/^(\s*)\d+\.\s+(.*)/);
      if (numMatch) {
        elements.push(
          <Text key={li} style={[richTextStyles.bodyText, { paddingLeft: 8 }]}>{renderInlineFormatting(line, ts)}</Text>
        );
        li++; continue;
      }
      if (line.startsWith("> ")) {
        elements.push(
          <View key={li} style={richTextStyles.blockquote}>
            <Text style={richTextStyles.blockquoteText}>{renderInlineFormatting(line.slice(2), ts)}</Text>
          </View>
        );
        li++; continue;
      }
      if (line.trim() === "---") {
        elements.push(<View key={li} style={richTextStyles.hr} />);
        li++; continue;
      }
      elements.push(<Text key={li} style={richTextStyles.bodyText}>{renderInlineFormatting(line, ts)}</Text>);
      li++;
    }

    return <View key={`text-${blockIndex}`}>{elements}</View>;
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
      <View>
        {renderCodeBlock(content, "markdown", 0)}
      </View>
    );
  }

  return (
    <View>
      {parseContentBlocks()}
    </View>
  );
}

function renderInlineFormatting(text: string, ts?: TextScale): React.ReactNode {
  const parts: React.ReactNode[] = [];
  let remaining = text;
  let key = 0;
  while (remaining.length > 0) {
    const boldMatch = remaining.match(/\*\*(.*?)\*\*/);
    const codeMatch = remaining.match(/`([^`]+)`/);
    const strikeMatch = remaining.match(/~~(.*?)~~/);
    const italicMatch = remaining.match(/(?<!\*)\*([^*]+?)\*(?!\*)/);
    const linkMatch = remaining.match(/\[([^\]]+)\]\(([^)]+)\)/);
    type InlineType = "bold" | "code" | "strike" | "italic" | "link";
    let earliest: { type: InlineType; index: number; match: RegExpMatchArray } | null = null;
    const consider = (type: InlineType, m: RegExpMatchArray | null) => {
      if (m && m.index !== undefined && (!earliest || m.index < earliest.index)) earliest = { type, index: m.index, match: m };
    };
    consider("bold", boldMatch);
    consider("code", codeMatch);
    consider("strike", strikeMatch);
    consider("italic", italicMatch);
    consider("link", linkMatch);
    if (!earliest) {
      parts.push(remaining);
      break;
    }
    const hit: { type: InlineType; index: number; match: RegExpMatchArray } = earliest;
    if (hit.index > 0) parts.push(remaining.slice(0, hit.index));
    if (hit.type === "bold") {
      parts.push(<Text key={key++} style={{ fontFamily: "Inter_700Bold" }}>{hit.match[1]}</Text>);
    } else if (hit.type === "code") {
      parts.push(
        <Text key={key++} style={{ fontFamily: Platform.OS === "web" ? "monospace" : "Courier", backgroundColor: "rgba(255,255,255,0.06)", paddingHorizontal: 4, borderRadius: 3, ...(ts ? { fontSize: sf(13, ts) } : {}) }}>
          {hit.match[1]}
        </Text>
      );
    } else if (hit.type === "strike") {
      parts.push(<Text key={key++} style={{ textDecorationLine: "line-through", color: Colors.textSecondary }}>{hit.match[1]}</Text>);
    } else if (hit.type === "italic") {
      parts.push(<Text key={key++} style={{ fontStyle: "italic" }}>{hit.match[1]}</Text>);
    } else if (hit.type === "link") {
      const linkUrl = hit.match[2];
      const isSafe = /^(https?:|mailto:)/i.test(linkUrl.trim());
      parts.push(
        <Text
          key={key++}
          style={{ color: Colors.primary, textDecorationLine: "underline" }}
          onPress={isSafe ? () => Linking.openURL(linkUrl.trim()) : undefined}
          accessibilityRole="link"
        >{hit.match[1]}</Text>
      );
    }
    remaining = remaining.slice(hit.index + hit.match[0].length);
  }
  return parts.length === 1 && typeof parts[0] === "string" ? parts[0] : <>{parts}</>;
}

const makeCodeBlockStyles = (ts: TextScale) => StyleSheet.create({
  container: { backgroundColor: "#1e1e2e", borderRadius: 12, marginVertical: 8, overflow: "hidden", borderWidth: 0 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 14, paddingVertical: 8, backgroundColor: "rgba(255,255,255,0.04)", borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.06)" },
  lang: { fontFamily: Platform.OS === "web" ? "monospace" : "Courier", fontSize: sf(11, ts), color: "#94a3b8", textTransform: "uppercase", letterSpacing: 0.5 },
  copyBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingVertical: 4, paddingHorizontal: 8, borderRadius: 6, backgroundColor: "rgba(255,255,255,0.06)" },
  copyText: { fontFamily: "Inter_500Medium", fontSize: sf(12, ts), color: "#94a3b8" },
  code: { fontFamily: Platform.OS === "web" ? "monospace" : "Courier", fontSize: sf(13, ts), color: "#e2e8f0", lineHeight: 22, padding: 14 },
  downloadHint: { flexDirection: "row", alignItems: "center", gap: 6, paddingTop: 12, paddingBottom: 4 },
  downloadHintText: { fontFamily: "Inter_400Regular", fontSize: sf(13, ts), color: Colors.textSecondary },
});

const makeRichTextStyles = (ts: TextScale) => StyleSheet.create({
  heading: { fontFamily: "Inter_700Bold", color: Colors.text, marginTop: 16, marginBottom: 6 },
  bodyText: { fontFamily: "Inter_400Regular", fontSize: sf(15, ts), color: Colors.text, lineHeight: 26 },
  bulletRow: { flexDirection: "row", alignItems: "flex-start", marginVertical: 2 },
  bulletDot: { fontFamily: "Inter_400Regular", fontSize: sf(15, ts), color: Colors.textSecondary, marginRight: 8, lineHeight: 26 },
  blockquote: { borderLeftWidth: 3, borderLeftColor: Colors.primary, paddingLeft: 12, marginVertical: 6 },
  blockquoteText: { fontFamily: "Inter_400Regular", fontSize: sf(15, ts), color: Colors.textSecondary, lineHeight: 26, fontStyle: "italic" },
  hr: { height: 1, backgroundColor: "rgba(255,255,255,0.1)", marginVertical: 16 },
});

const makeTableStyles = (ts: TextScale) => StyleSheet.create({
  container: { marginVertical: 12, borderRadius: 10, overflow: "hidden", borderWidth: 0 },
  headerRow: { flexDirection: "row", backgroundColor: "rgba(255,255,255,0.08)" },
  row: { flexDirection: "row", borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.06)" },
  altRow: { backgroundColor: "rgba(255,255,255,0.03)" },
  cell: { minWidth: 100, paddingHorizontal: 12, paddingVertical: 10, borderLeftWidth: 1, borderLeftColor: "rgba(255,255,255,0.06)" },
  firstCell: { borderLeftWidth: 0 },
  headerCell: {},
  headerText: { fontFamily: "Inter_600SemiBold", fontSize: sf(13, ts), color: Colors.text, lineHeight: 20 },
  cellText: { fontFamily: "Inter_400Regular", fontSize: sf(14, ts), color: Colors.text, lineHeight: 22 },
});

function resolveBucketUri(audioUri: string): string {
  if (audioUri.startsWith("bucket://")) {
    return resolveBucketUriWithBase(audioUri, getApiUrl());
  }
  if (Platform.OS === "web" && audioUri.startsWith("/api/")) {
    return `${window.location.origin}${audioUri}`;
  }
  return audioUri;
}

/** Renders a Slide Deck server response as readable markdown for the artifact view. */
function deckToMarkdown(data: {
  title: string;
  subtitle?: string;
  slides: { kind: string; title: string; bullets?: string[]; notes?: string }[];
}): string {
  const lines: string[] = [`# ${data.title}`];
  if (data.subtitle) lines.push("", data.subtitle);
  for (const slide of data.slides) {
    lines.push("", `## ${slide.title}`);
    if (slide.bullets && slide.bullets.length > 0) {
      for (const b of slide.bullets) lines.push(`- ${b}`);
    }
    if (slide.notes) lines.push("", `> ${slide.notes}`);
  }
  return lines.join("\n");
}

async function triggerWebShare(blob: Blob, fileName: string, mimeType: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.share && navigator.canShare) {
      let file = new File([blob], fileName, { type: mimeType });
      let shareData = { files: [file] };
      
      let canShare = navigator.canShare(shareData);
      if (!canShare) {
        file = new File([blob], fileName, { type: "" });
        shareData = { files: [file] };
        canShare = navigator.canShare(shareData);
      }
      
      if (canShare) {
        await navigator.share(shareData);
        return true;
      }
    }
  } catch (err: any) {
    if (err?.name === "AbortError") return true;
    if (err?.name === "NotAllowedError") throw err;
  }
  return false;
}



function markdownToHtml(md: string): string {
  let html = md
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  const lines = html.split("\n");
  const result: string[] = [];
  let inCodeBlock = false;
  let inList = false;
  let listType = "";

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];

    if (line.trim().startsWith("```")) {
      if (inCodeBlock) {
        result.push("</code></pre>");
        inCodeBlock = false;
      } else {
        if (inList) { result.push(listType === "ul" ? "</ul>" : "</ol>"); inList = false; }
        result.push('<pre style="background:#1a2d50;color:#e0e0e0;padding:14px;border-radius:8px;font-size:13px;overflow-x:auto;"><code>');
        inCodeBlock = true;
      }
      continue;
    }

    if (inCodeBlock) {
      result.push(line);
      continue;
    }

    const applyInline = (t: string) => t
      .replace(/\*\*\*(.*?)\*\*\*/g, "<b><i>$1</i></b>")
      .replace(/\*\*(.*?)\*\*/g, "<b>$1</b>")
      .replace(/~~(.*?)~~/g, "<s>$1</s>")
      .replace(/\*(.*?)\*/g, "<i>$1</i>")
      .replace(/`(.*?)`/g, '<code style="background:#1a2d50;padding:2px 6px;border-radius:4px;font-size:13px;">$1</code>')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, url) => {
        const safeUrl = /^(https?:|mailto:)/i.test(url.trim()) ? url.trim().replace(/"/g, "&quot;") : "#";
        return `<a href="${safeUrl}" style="color:#6366f1;">${label}</a>`;
      });

    const trimmed = line.trim();

    if (trimmed.includes("|") && i + 1 < lines.length && /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(lines[i + 1])) {
      if (inList) { result.push(listType === "ul" ? "</ul>" : "</ol>"); inList = false; }
      const parseCells = (row: string) => {
        let r = row.trim();
        if (r.startsWith("|")) r = r.slice(1);
        if (r.endsWith("|")) r = r.slice(0, -1);
        return r.split("|").map(c => c.trim());
      };
      const headers = parseCells(trimmed);
      const aligns = (() => {
        let s = lines[i + 1].trim();
        if (s.startsWith("|")) s = s.slice(1);
        if (s.endsWith("|")) s = s.slice(0, -1);
        return s.split("|").map(c => c.trim());
      })().map(c => {
        if (c.startsWith(":") && c.endsWith(":")) return "center";
        if (c.endsWith(":")) return "right";
        return "left";
      });
      let tableHtml = '<table style="border-collapse:collapse;width:100%;margin:12px 0;"><thead><tr>';
      headers.forEach((h, ci) => { tableHtml += `<th style="border:1px solid #333;padding:8px 12px;text-align:${aligns[ci] || "left"};background:#1a2d50;font-size:13px;">${applyInline(h)}</th>`; });
      tableHtml += "</tr></thead><tbody>";
      i++;
      while (i + 1 < lines.length && lines[i + 1].includes("|") && lines[i + 1].trim() !== "") {
        i++;
        const cells = parseCells(lines[i]);
        tableHtml += "<tr>";
        cells.forEach((cell, ci) => { tableHtml += `<td style="border:1px solid #333;padding:8px 12px;text-align:${aligns[ci] || "left"};font-size:14px;">${applyInline(cell)}</td>`; });
        tableHtml += "</tr>";
      }
      tableHtml += "</tbody></table>";
      result.push(tableHtml);
    } else if (trimmed.startsWith("### ")) {
      if (inList) { result.push(listType === "ul" ? "</ul>" : "</ol>"); inList = false; }
      result.push(`<h3 style="margin:18px 0 8px;font-size:16px;">${applyInline(trimmed.slice(4))}</h3>`);
    } else if (trimmed.startsWith("## ")) {
      if (inList) { result.push(listType === "ul" ? "</ul>" : "</ol>"); inList = false; }
      result.push(`<h2 style="margin:22px 0 10px;font-size:19px;">${applyInline(trimmed.slice(3))}</h2>`);
    } else if (trimmed.startsWith("# ")) {
      if (inList) { result.push(listType === "ul" ? "</ul>" : "</ol>"); inList = false; }
      result.push(`<h1 style="margin:24px 0 12px;font-size:22px;">${applyInline(trimmed.slice(2))}</h1>`);
    } else if (trimmed.startsWith("- [ ] ") || trimmed.startsWith("- [x] ")) {
      const checked = trimmed.startsWith("- [x] ");
      if (!inList || listType !== "ul") {
        if (inList) result.push(listType === "ul" ? "</ul>" : "</ol>");
        result.push("<ul style='list-style:none;padding-left:8px;'>");
        inList = true; listType = "ul";
      }
      result.push(`<li style="margin:4px 0;">${checked ? "☑" : "☐"} ${applyInline(trimmed.slice(6))}</li>`);
    } else if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
      if (!inList || listType !== "ul") {
        if (inList) result.push(listType === "ul" ? "</ul>" : "</ol>");
        result.push("<ul style='padding-left:24px;'>");
        inList = true; listType = "ul";
      }
      result.push(`<li style="margin:4px 0;">${applyInline(trimmed.slice(2))}</li>`);
    } else if (/^\d+\.\s/.test(trimmed)) {
      if (!inList || listType !== "ol") {
        if (inList) result.push(listType === "ul" ? "</ul>" : "</ol>");
        result.push("<ol style='padding-left:24px;'>");
        inList = true; listType = "ol";
      }
      const text = trimmed.replace(/^\d+\.\s/, "");
      result.push(`<li style="margin:4px 0;">${applyInline(text)}</li>`);
    } else if (trimmed === "") {
      if (inList) { result.push(listType === "ul" ? "</ul>" : "</ol>"); inList = false; }
      result.push("<br>");
    } else {
      if (inList) { result.push(listType === "ul" ? "</ul>" : "</ol>"); inList = false; }
      result.push(`<p style="margin:6px 0;line-height:1.6;">${applyInline(trimmed)}</p>`);
    }
  }

  if (inList) result.push(listType === "ul" ? "</ul>" : "</ol>");
  if (inCodeBlock) result.push("</code></pre>");

  return result.join("\n");
}

function ConversionIcon({ name, size, color }: { name: string; size: number; color: string }) {
  if (name === "linkedin") {
    return <FontAwesome name="linkedin-square" size={size} color={color} />;
  }
  return <Feather name={name as any} size={size} color={color} />;
}

/**
 * Scroll a field clear of the on-screen keyboard (#198).
 *
 * Module scope on purpose: it takes everything it needs as arguments, so the
 * effect that calls it depends only on the keyboard and window sizes instead of
 * an unstable callback identity.
 */
function revealFieldAboveKeyboard({
  scroll,
  field,
  windowHeight,
  keyboardHeight,
  currentOffset,
}: {
  scroll: ScrollView | null;
  field: View | null;
  windowHeight: number;
  keyboardHeight: number;
  currentOffset: number;
}) {
  if (!scroll || !field || keyboardHeight <= 0) return;
  field.measureInWindow((_x, y, _width, height) => {
    const nextOffset = keyboardRevealOffset({
      fieldBottom: y + height,
      keyboardTop: keyboardTopEdge(windowHeight, keyboardHeight),
      currentOffset,
    });
    if (nextOffset != null) scroll.scrollTo({ y: nextOffset, animated: true });
  });
}

export default function RecordingDetailScreen() {
  const { id, mode, tab } = useLocalSearchParams<{ id: string; mode?: string; tab?: string }>();
  const insets = useSafeAreaInsets();
  const { getRecording, fetchRecording, updateRecording, applyLocalRecording, addConversion, deleteConversion, deleteRecording, addRecording, isAutoTranscribeEnabled, isCloudSyncEnabled } =
    useRecordings();
  const existingRecording = getRecording(id);
  const isDraftTextEntry = mode === "text" && !existingRecording;
  const [draftPersisted, setDraftPersisted] = useState(false);
  const [isRemoteRecordingLoading, setIsRemoteRecordingLoading] = useState(false);
  const draftRecording = useMemo<import("@/lib/recordings-context").Recording | undefined>(() => {
    if (isDraftTextEntry && !draftPersisted) {
      return {
        id: id || "",
        title: "Text Entry",
        duration: 0,
        audioUri: "",
        transcript: "",
        conversions: [],
        createdAt: new Date().toISOString(),
      };
    }
    return undefined;
  }, [isDraftTextEntry, draftPersisted, id]);
  const recording = existingRecording || draftRecording;
  const layout = useResponsiveLayout();
  const { t, language } = useLanguage();
  const ts = useTextScale();
  const styles = useMemo(() => makeStyles(ts), [ts]);
  const webTopInset = Platform.OS === "web" ? 67 : 0;

  const exportFormatKeys: Record<string, string> = {
    txt: "export.plainText",
    md: "export.markdown",
    pdf: "export.pdf",
    docx: "export.word",
    csv: "export.csv",
    xlsx: "export.xlsx",
  };

  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackPosition, setPlaybackPosition] = useState(0);
  const soundRef = useRef<Audio.Sound | null>(null);
  const [showConvertMenu, setShowConvertMenu] = useState(false);
  // Convert sheet: draggable height — pull up on the top handle to elongate.
  const { height: windowHeight } = useWindowDimensions();
  const [convertSheetHeight, setConvertSheetHeight] = useState<number | null>(null);
  const convertSheetMeasuredRef = useRef(0);
  const convertSheetDragStartRef = useRef(0);
  const convertSheetPan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        convertSheetDragStartRef.current = convertSheetHeight ?? convertSheetMeasuredRef.current;
      },
      onPanResponderMove: (_evt, gesture) => {
        const natural = convertSheetMeasuredRef.current || windowHeight * 0.5;
        const minHeight = Math.min(windowHeight * 0.4, natural);
        const maxHeight = windowHeight * 0.94;
        setConvertSheetHeight(
          Math.max(minHeight, Math.min(maxHeight, convertSheetDragStartRef.current - gesture.dy))
        );
      },
    })
  ).current;
  useEffect(() => {
    if (showConvertMenu) setConvertSheetHeight(null);
  }, [showConvertMenu]);

  // Slide Deck: "choose a look" style picker + in-flight download tracking.
  const [showDeckStylePicker, setShowDeckStylePicker] = useState(false);
  const [deckStyle, setDeckStyle] = useState<string | null>(null);
  const [deckDownloadingId, setDeckDownloadingId] = useState<string | null>(null);
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [convertingType, setConvertingType] = useState<string | null>(null);
  const [conversionStage, setConversionStage] = useState<string>("");
  // Waiting-phase verb selection: "thinking" during prepare/analyze,
  // "making" during structuring/receiving/streaming. Drives the cycling
  // status verb shown while a conversion runs (visual only — the a11y
  // label stays the stable conversionStage text).
  const [conversionPhase, setConversionPhase] = useState<"thinking" | "making">("thinking");
  const [conversionError, setConversionError] = useState<{
    type: string;
    message: string;
    citationStyle?: string;
    bibliographyType?: string;
    includeWebSources?: boolean;
  } | null>(null);
  const [streamingContent, setStreamingContent] = useState("");
  const [selectedConversion, setSelectedConversion] = useState<Conversion | null>(null);

  // Cycling waiting-state verb ("Pondering…", "Crafting…") — visual only.
  // The stable, accessible status text remains conversionStage. Only cycles
  // while a conversion is actually running (no idle re-renders).
  const cyclingVerb = useCyclingStatus(conversionPhase, language, 2200, !!convertingType);

  const [exportTarget, setExportTarget] = useState<{ conversion: Conversion; action: "share" | "save" } | null>(null);
  const [customText, setCustomText] = useState("");
  // Keyboard reveal for the custom-text field (#198). Android 15+ enforces
  // edge-to-edge, so `adjustResize` no longer shrinks the window and the IME
  // draws straight over this field.
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const detailScrollRef = useRef<ScrollView | null>(null);
  const customTextCardRef = useRef<View | null>(null);
  const detailScrollOffsetRef = useRef(0);
  const customTextFocusedRef = useRef(false);
  const [sourceAttachments, setSourceAttachments] = useState<ConversionSourceAttachment[]>([]);
  const [editingSourceAttachment, setEditingSourceAttachment] = useState<ConversionSourceAttachment | null>(null);
  const [importingFile, setImportingFile] = useState(false);
  const [contextSaveState, setContextSaveState] = useState<"idle" | "loading" | "saving" | "saved" | "offline" | "error">("idle");
  const [cloudContextEnabled, setCloudContextEnabled] = useState(false);
  const [continuingThought, setContinuingThought] = useState(false);
  const [thoughtThreadChoices, setThoughtThreadChoices] = useState<Array<{
    id: string;
    title: string;
    updatedAt: Date | string;
    recordingCount: number;
  }>>([]);
  const [retryingTranscription, setRetryingTranscription] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null); // null = indeterminate, 0-100 = percent
  const [isUploading, setIsUploading] = useState(false);
  const [previewText, setPreviewText] = useState<string | null>(null); // instant preview before Firestore write
  // Transcript collapse: default shows 2 lines, "Read more" expands in place.
  const [transcriptExpanded, setTranscriptExpanded] = useState(false);
  const [transcriptLineCount, setTranscriptLineCount] = useState<number | null>(null);
  const [markdownPrompt, setMarkdownPrompt] = useState<{ text: string; filename: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [showCitationPicker, setShowCitationPicker] = useState(false);
  const [citationPickerTarget, setCitationPickerTarget] = useState<"academic_research" | "bibliography">("academic_research");
  const [showBibliographyTypePicker, setShowBibliographyTypePicker] = useState(false);
  const [selectedBibCitationStyle, setSelectedBibCitationStyle] = useState<string | null>(null);
  const [showTaskExport, setShowTaskExport] = useState(false);
  const [taskProviders, setTaskProviders] = useState<{ id: string; provider: string; label: string; enabled: number }[]>([]);
  const [taskExporting, setTaskExporting] = useState<string | null>(null);
  const [showCalendarExport, setShowCalendarExport] = useState(false);
  const [calendarEvents, setCalendarEvents] = useState<{ event: any; googleUrl: string; outlookUrl: string }[]>([]);
  const [calendarParsing, setCalendarParsing] = useState(false);
  const [downloadingIcs, setDownloadingIcs] = useState(false);
  const [calendarProviders, setCalendarProviders] = useState<{ id: number; provider: string; label: string; enabled: boolean }[]>([]);
  const [calendarExportingId, setCalendarExportingId] = useState<number | null>(null);
  const [calendarExportSuccess, setCalendarExportSuccess] = useState<Set<number>>(new Set());

  const [downloadToast, setDownloadToast] = useState<{ fileName: string; messageKey: string } | null>(null);
  const downloadToastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // One download interaction for the whole screen: busy state, duplicate-tap
  // protection, outcome-accurate toast, and a failure dialog that offers
  // "Choose location…" / "Share file" instead of silently redirecting the file.
  const { save: saveFile, busyId: savingFileId } = useFileDownload(
    (fileName, messageKey) => showDownloadToast(fileName, messageKey),
  );
  const [useMarkdown, setUseMarkdown] = useState(false);
  // research_forms web-channel toggle. null = use server default per type.
  const [includeWebSources, setIncludeWebSources] = useState<boolean | null>(null);
  const [codeViewActive, setCodeViewActive] = useState(false);
  const [detailTab, setDetailTab] = useState<"recording" | "conversions">("recording");

  useEffect(() => {
    if (tab === "conversions") setDetailTab("conversions");
    else if (tab === "recording") setDetailTab("recording");
  }, [tab]);
  const [convertSearchQuery] = useState("");
  // Last research_forms type the user tapped in the convert menu — drives the
  // web-source toggle default (academic_research/bibliography default OFF).
  const [activeResearchFormType, setActiveResearchFormType] = useState<string | null>(null);
  const [expandedCardId, setExpandedCardId] = useState<string | null>(null);
  const [sourceReferenceExpanded, setSourceReferenceExpanded] = useState(false);
  const [drawerVisible, setDrawerVisible] = useState(false);

  const [recentConversionTypes, setRecentConversionTypes] = useState<string[]>([]);
  const [pendingWebShare, setPendingWebShare] = useState<{ blob: Blob; fileName: string; mimeType: string } | null>(null);

  const RECENT_TYPES_KEY = "@barry_recent_conversion_types";

  React.useEffect(() => {
    AsyncStorage.getItem("@voicenote_use_markdown").then(val => {
      if (val === "true") setUseMarkdown(true);
    });
    AsyncStorage.getItem(RECENT_TYPES_KEY).then(val => {
      if (val) {
        try { setRecentConversionTypes(JSON.parse(val)); } catch {}
      }
    });
  }, []);

  React.useEffect(() => {
    if (!id || isDraftTextEntry || existingRecording) {
      return;
    }

    let cancelled = false;
    setIsRemoteRecordingLoading(true);

    fetchRecording(id)
      .catch(() => null)
      .finally(() => {
        if (!cancelled) {
          setIsRemoteRecordingLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [existingRecording, fetchRecording, id, isDraftTextEntry]);

  const trackRecentConversionType = (typeValue: string) => {
    setRecentConversionTypes(prev => {
      const updated = [typeValue, ...prev.filter(t => t !== typeValue)].slice(0, 5);
      AsyncStorage.setItem(RECENT_TYPES_KEY, JSON.stringify(updated)).catch(() => {});
      return updated;
    });
  };
  const closeSelectedConversion = () => {
    setSelectedConversion(null);
    setCodeViewActive(false);
  };
  const [clarifyLoading, setClarifyLoading] = useState(false);
  // the a11y label stays the stable "Checking for ambiguities…". Only cycles
  // while the clarify request is running.
  const clarifyCyclingVerb = useCyclingStatus("clarifying", language, 1800, clarifyLoading);
  const [clarifyQuestion, setClarifyQuestion] = useState<string>("");
  const [clarifyOptions, setClarifyOptions] = useState<string[]>([]);
  const [clarifyAnswerText, setClarifyAnswerText] = useState<string>("");
  const [pendingConversion, setPendingConversion] = useState<{ type: string; citationStyle?: string; bibliographyType?: string; includeWebSources?: boolean } | null>(null);

  const [isAdmin, setIsAdmin] = useState(false);
  const [userTier, setUserTier] = useState<SubscriptionTier>("free");
  const [tierLoaded, setTierLoaded] = useState(false);
  const [userModulesList, setUserModulesList] = useState<string[]>([]);
  const [moduleStates, setModuleStates] = useState<SelfServiceModuleState[]>([]);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [upgradeMessage, setUpgradeMessage] = useState("");
  const [usageSummary, setUsageSummary] = useState<{ transcriptions: { used: number; limit: number }; conversions: { used: number; limit: number } } | null>(null);
  const [showProAccessModal, setShowProAccessModal] = useState(false);
  const [proAccessInfo, setProAccessInfo] = useState<{ actionType: string; unitCost: number; costSoFar: number; pricing: { transcription: number; conversion: number }; onConfirm: () => void } | null>(null);

  const { user } = useAuth();

  // Keyboard height drives both the scroll padding and the field reveal (#198).
  useEffect(() => {
    const showSub = Keyboard.addListener(
      Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow",
      (event) => setKeyboardHeight(event.endCoordinates.height),
    );
    const hideSub = Keyboard.addListener(
      Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide",
      () => setKeyboardHeight(0),
    );
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  // The keyboard opens after focus, so the reveal runs again once its height is
  // known (and on rotation, where the window height changes).
  useEffect(() => {
    if (!customTextFocusedRef.current || keyboardHeight <= 0) return;
    const timer = setTimeout(() => {
      revealFieldAboveKeyboard({
        scroll: detailScrollRef.current,
        field: customTextCardRef.current,
        windowHeight,
        keyboardHeight,
        currentOffset: detailScrollOffsetRef.current,
      });
    }, 50);
    return () => clearTimeout(timer);
  }, [keyboardHeight, windowHeight]);

  const isDurableContextRecording = Boolean(
    user &&
    cloudContextEnabled &&
    existingRecording &&
    mode !== "text" &&
    (
      Boolean(existingRecording.audioUri) ||
      existingRecording.duration > 0 ||
      (existingRecording.title !== "Text Entry" && existingRecording.title !== "Entrada de texto")
    ),
  );
  useEffect(() => {
    if (!user) {
      setCloudContextEnabled(false);
      return;
    }
    let cancelled = false;
    authExpoFetch(new URL("/api/cloud-sync", getApiUrl()).toString())
      .then(async (response) => response.ok ? response.json() : null)
      .then((data) => {
        if (!cancelled) setCloudContextEnabled(data?.enabled === true);
      })
      .catch(() => {
        if (!cancelled) setCloudContextEnabled(false);
      });
    return () => {
      cancelled = true;
    };
  }, [user]);
  const { openFeedback, feedbackVisible } = useFeedback();
  const containedFeedbackInset = layout.isMobile
    ? 40
    : Math.max((layout.width - Math.min(layout.width, layout.contentMaxWidth)) / 2 + layout.contentPadding, layout.contentPadding);
  const containedFabInset = layout.isMobile ? 24 : Math.max((layout.width - Math.min(layout.width, layout.contentMaxWidth)) / 2 + layout.contentPadding, layout.contentPadding);

  const draftSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const contextSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const textEntrySaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draftLoaded = useRef(false);
  const durableContextLoaded = useRef(false);

  useEffect(() => {
    if (!id) return;
    draftLoaded.current = false;
    durableContextLoaded.current = false;
    setCustomText("");
    setSourceAttachments([]);
    setContextSaveState("loading");

    const loadContext = async () => {
      const rawDraft = await AsyncStorage.getItem(DRAFT_KEY_PREFIX + id).catch(() => null);
      let localDraft: { customText?: string; sourceAttachments?: ConversionSourceAttachment[] } = {};
      if (rawDraft) {
        try {
          const parsed = JSON.parse(rawDraft);
          localDraft = {
            customText: typeof parsed.customText === "string" ? parsed.customText : "",
            sourceAttachments: Array.isArray(parsed.sourceAttachments)
              ? parsed.sourceAttachments.filter(
                  (attachment: unknown): attachment is ConversionSourceAttachment =>
                    !!attachment &&
                    typeof attachment === "object" &&
                    typeof (attachment as ConversionSourceAttachment).id === "string" &&
                    typeof (attachment as ConversionSourceAttachment).name === "string" &&
                    typeof (attachment as ConversionSourceAttachment).text === "string",
                )
              : [],
          };
        } catch {}
      }

      const canPersistContext = isDurableContextRecording;
      if (!canPersistContext) {
        setCustomText(localDraft.customText || "");
        setSourceAttachments(localDraft.sourceAttachments || []);
        draftLoaded.current = true;
        durableContextLoaded.current = true;
        setContextSaveState("idle");
        return;
      }

      try {
        const baseUrl = getApiUrl();
        const getUrl = new URL(`/api/recordings/${encodeURIComponent(id)}/contexts`, baseUrl);
        const response = await authExpoFetch(getUrl.toString());
        if (!response.ok) throw new Error(`Context load failed (${response.status})`);
        let data = await response.json();
        let contexts = Array.isArray(data.contexts) ? data.contexts : [];

        if (localDraft.customText?.trim() && !contexts.some((context: any) => context.kind === "text")) {
          const textResponse = await authExpoFetch(
            new URL(`/api/recordings/${encodeURIComponent(id)}/contexts/text`, baseUrl).toString(),
            {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ text: localDraft.customText }),
            },
          );
          if (!textResponse.ok) throw new Error("Could not migrate local text context.");
        }

        for (const attachment of localDraft.sourceAttachments || []) {
          if (attachment.persisted || contexts.some((context: any) => context.id === attachment.id)) continue;
          const migrationResponse = await authExpoFetch(
            new URL(`/api/recordings/${encodeURIComponent(id)}/contexts/legacy-file`, baseUrl).toString(),
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                migrationId: attachment.id,
                label: attachment.name,
                text: attachment.text,
              }),
            },
          );
          if (!migrationResponse.ok) throw new Error(`Could not migrate ${attachment.name}.`);
        }

        if (localDraft.customText?.trim() || (localDraft.sourceAttachments?.length || 0) > 0) {
          const refreshed = await authExpoFetch(getUrl.toString());
          if (!refreshed.ok) throw new Error("Could not reload migrated context.");
          data = await refreshed.json();
          contexts = Array.isArray(data.contexts) ? data.contexts : [];
        }

        const textContext = contexts.find((context: any) => context.kind === "text");
        setCustomText(typeof textContext?.text === "string" ? textContext.text : "");
        setSourceAttachments(
          contexts
            .filter((context: any) => context.kind === "file" && typeof context.text === "string")
            .map((context: any): ConversionSourceAttachment => ({
              id: context.id,
              name: context.label || context.originalFilename || t("detail.untitledFile" as any),
              text: context.text,
              persisted: true,
              revision: context.revision,
              originalFilename: context.originalFilename,
              sourceMimeType: context.sourceMimeType,
              sourceFileSize: context.sourceFileSize,
              sourceHash: context.sourceHash,
              parserVersion: context.parserVersion,
              sourceBucketFileId: context.sourceBucketFileId,
              contentEdited: context.contentEdited,
              originalUnavailable: context.originalUnavailable,
            })),
        );
        await AsyncStorage.removeItem(DRAFT_KEY_PREFIX + id).catch(() => undefined);
        setContextSaveState("saved");
      } catch {
        setCustomText(localDraft.customText || "");
        setSourceAttachments(localDraft.sourceAttachments || []);
        setContextSaveState("offline");
      } finally {
        draftLoaded.current = true;
        durableContextLoaded.current = true;
      }
    };

    void loadContext();
  }, [id, isDurableContextRecording, isDraftTextEntry, mode, t]);

  useEffect(() => {
    if (!draftLoaded.current || !id) return;
    if (draftSaveTimer.current) clearTimeout(draftSaveTimer.current);
    draftSaveTimer.current = setTimeout(() => {
      if (customText.trim() || sourceAttachments.length > 0) {
        AsyncStorage.setItem(DRAFT_KEY_PREFIX + id, JSON.stringify({ customText, sourceAttachments })).catch(() => {});
      } else {
        AsyncStorage.removeItem(DRAFT_KEY_PREFIX + id).catch(() => {});
      }
    }, 500);
    return () => {
      if (draftSaveTimer.current) {
        clearTimeout(draftSaveTimer.current);
        if (customText.trim() || sourceAttachments.length > 0) {
          AsyncStorage.setItem(DRAFT_KEY_PREFIX + id, JSON.stringify({ customText, sourceAttachments })).catch(() => {});
        }
      }
    };
  }, [customText, sourceAttachments, id]);

  useEffect(() => {
    if (!id || !isDurableContextRecording || !durableContextLoaded.current) return;
    if (contextSaveTimer.current) clearTimeout(contextSaveTimer.current);
    setContextSaveState("saving");
    contextSaveTimer.current = setTimeout(async () => {
      try {
        const response = await authExpoFetch(
          new URL(`/api/recordings/${encodeURIComponent(id)}/contexts/text`, getApiUrl()).toString(),
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text: customText }),
          },
        );
        if (!response.ok) throw new Error(`Context save failed (${response.status})`);
        setContextSaveState("saved");
        await AsyncStorage.removeItem(DRAFT_KEY_PREFIX + id).catch(() => undefined);
      } catch {
        setContextSaveState("offline");
      }
    }, 700);
    return () => {
      if (contextSaveTimer.current) clearTimeout(contextSaveTimer.current);
    };
  }, [customText, id, isDurableContextRecording]);

  const draftPersistedRef = useRef(false);
  useEffect(() => {
    draftPersistedRef.current = draftPersisted;
  }, [draftPersisted]);

  useEffect(() => {
    if (mode !== "text") return;
    return () => {
      if (!draftPersistedRef.current && id) {
        AsyncStorage.removeItem(DRAFT_KEY_PREFIX + id).catch(() => {});
      }
    };
  }, [id, mode]);

  const isTypeLocked = (typeValue: string) => {
    if (!tierLoaded) return false;
    const typeInfo = CONVERSION_TYPES.find(t => t.value === typeValue);
    if (typeInfo?.module && userModulesList.includes(typeInfo.module)) return false;
    return !isConversionTypeAvailable(typeValue, userTier);
  };

  const getModuleState = (moduleName?: string) => {
    if (!moduleName) return null;
    return moduleStates.find((module) => module.moduleName === moduleName) || null;
  };

  const getModuleDisplayName = (moduleName?: string) => {
    if (!moduleName) return "";
    const moduleState = getModuleState(moduleName);
    return moduleState?.displayName || t(`module.${moduleName}` as any) || moduleName;
  };

  const getLockedTierLabel = (typeValue: string): string => {
    const typeInfo = CONVERSION_TYPES.find(t => t.value === typeValue);
    if (typeInfo?.module) return getModuleDisplayName(typeInfo.module);
    const required = getRequiredTierForConversionType(typeValue);
    if (required) return TIER_DISPLAY_NAMES[required];
    return "Base";
  };

  const handleLockedConversionPress = (typeValue: string) => {
    const typeInfo = CONVERSION_TYPES.find(t => t.value === typeValue);
    if (typeInfo?.module) {
      const moduleState = getModuleState(typeInfo.module);
      const moduleLabel = getModuleDisplayName(typeInfo.module);
      if (moduleState?.eligible || moduleState?.userCanToggle) {
        setUpgradeMessage(
          language === "es"
            ? `Activa ${moduleLabel} en Configuración de IA para usar esta conversión.`
            : `Enable ${moduleLabel} in AI Configuration to use this conversion.`,
        );
      } else {
        const requiredTier = moduleState?.requiredTier ? TIER_DISPLAY_NAMES[moduleState.requiredTier] : "Base";
        setUpgradeMessage(
          language === "es"
            ? `${moduleLabel} requiere el plan ${requiredTier}.`
            : `${moduleLabel} requires the ${requiredTier} plan.`,
        );
      }
    } else {
      const tierLabel = getLockedTierLabel(typeValue);
      setUpgradeMessage(t("upgrade.requiresTier" as any, { tier: tierLabel }) || `This conversion type requires the ${tierLabel} plan`);
    }
    setShowUpgradeModal(true);
    setShowConvertMenu(false);
  };

  React.useEffect(() => {
    if (user) {
      const baseUrl = getApiUrl();
      authExpoFetch(new URL("/api/auth/is-admin", baseUrl).toString(), { credentials: "include" })
        .then(res => res.json())
        .then(data => setIsAdmin(data.isAdmin === true))
        .catch(() => setIsAdmin(false));
      authExpoFetch(new URL("/api/usage/summary", baseUrl).toString(), { credentials: "include" })
        .then(res => res.json())
        .then(data => {
          setUserTier((data.tier || "free") as SubscriptionTier);
          if (data.transcriptions && data.conversions) {
            setUsageSummary({ transcriptions: data.transcriptions, conversions: data.conversions });
          }
          setTierLoaded(true);
        })
        .catch(() => { setUserTier("free"); setTierLoaded(true); });
      authExpoFetch(new URL("/api/modules/self", baseUrl).toString(), { credentials: "include" })
        .then(res => res.json())
        .then(data => {
          const modules = Array.isArray(data.modules) ? data.modules : [];
          setModuleStates(modules);
          setUserModulesList(
            modules
              .filter((module: any) => module?.effectiveEnabled)
              .map((module: any) => module.moduleName),
          );
        })
        .catch(() => {
          setModuleStates([]);
          setUserModulesList([]);
        });
    }
  }, [user]);

  const MIN_CUSTOM_TEXT = MIN_TEXT_ENTRY_CHARS;
  const MAX_CUSTOM_TEXT = 10000;
  const isTextEntry = mode === "text" || (
    !!recording &&
    !recording.audioUri &&
    recording.duration === 0 &&
    (
      customText.trim().length > 0 ||
      recording.transcript.trim().length > 0 ||
      recording.title === "Text Entry" ||
      recording.title === t("home.textEntry" as any)
    )
  );
  const effectiveTranscript = isTextEntry
    ? (customText.trim() || recording?.transcript || "")
    : (recording?.transcript || "");
  const sourceText = useMemo(
    () => buildConversionSource({
      transcript: isTextEntry ? "" : recording?.transcript,
      customText: isTextEntry ? effectiveTranscript : customText,
      attachments: sourceAttachments,
    }),
    [customText, effectiveTranscript, isTextEntry, recording?.transcript, sourceAttachments],
  );
  const sourceContentLength =
    (isTextEntry ? effectiveTranscript : recording?.transcript || "").trim().length +
    (isTextEntry ? 0 : customText.trim().length) +
    sourceAttachments.reduce((total, attachment) => total + attachment.text.trim().length, 0);
  // A short voice note is a legitimate source: only a typed text entry keeps a
  // character floor (#195). Padding a real transcript with filler context to
  // unlock Convert degraded the very output the floor was protecting.
  const sourceTextTooShort = isConversionSourceTooShort({ isTextEntry, sourceContentLength });

  useEffect(() => {
    if (!isTextEntry || customText.trim() || !recording?.transcript) return;
    setCustomText(recording.transcript);
  }, [customText, isTextEntry, recording?.transcript]);

  useEffect(() => {
    if (!recording || !isTextEntry || isDraftTextEntry || !draftLoaded.current) return;
    if (customText === recording.transcript) return;
    if (textEntrySaveTimer.current) clearTimeout(textEntrySaveTimer.current);
    textEntrySaveTimer.current = setTimeout(() => {
      updateRecording(recording.id, { transcript: customText }).catch((err) => {
        console.error("Failed to save text entry source:", err);
      });
    }, 500);
    return () => {
      if (textEntrySaveTimer.current) {
        clearTimeout(textEntrySaveTimer.current);
      }
    };
  }, [customText, isDraftTextEntry, isTextEntry, recording, recording?.id, recording?.transcript, updateRecording]);

  // One-shot immediate retry for failed transcriptions on mount.
  // If it fails, the manual retry button takes over — no auto-retry loop.
  const autoRetriedRef = useRef(false);
  useEffect(() => {
    if (!recording?.transcriptionError || recording.transcriptionRetryable === false || !recording?.audioUri) return;
    if (autoRetriedRef.current) return;
    autoRetriedRef.current = true;
    retryTranscription().catch(() => {}); // fire-and-forget; on failure the catch in retryTranscription sets the error state
  // eslint-disable-next-line react-hooks/exhaustive-deps  
  }, [recording?.id, recording?.transcriptionError]);

  // Auto-upload recordings that need it, then trigger transcription
  useEffect(() => {
    if (!recording?.needsUpload || !recording?.audioUri) return;
    if (recording.uploadStatus === "failed") return;
    let cancelled = false;

    const doUpload = async () => {
      setIsUploading(true);
      setUploadProgress(null); // indeterminate start

      if (Platform.OS !== "web") {
        setUploadProgress(0);
        const uploadUrl = new URL("/api/upload-audio", getApiUrl()).toString();
        const authToken = getAuthHeaders()["Authorization"]?.replace("Bearer ", "") || "";
        enqueueBackgroundUpload(
          recording.audioUri,
          uploadUrl,
          authToken,
          recording.id,
          isAutoTranscribeEnabled,
          language,
        );
        return;
      }

      // Web: upload with progress tracking via XMLHttpRequest
      try {
        const formData = new FormData();
        const baseUrl = getApiUrl();
        const response = await authFetch(recording.audioUri, { credentials: "include" });
        const blob = await response.blob();
        formData.append("audio", blob, "recording.webm");

        const uploadUrl = new URL("/api/upload-audio", baseUrl).toString();
        const headers = getAuthHeaders();

        const xhrResult = await new Promise<{ ok: boolean; status: number; data: any }>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open("POST", uploadUrl);
          xhr.setRequestHeader("Authorization", headers["Authorization"] || "");
          xhr.withCredentials = true;

          xhr.upload.onprogress = (event) => {
            if (event.lengthComputable && !cancelled) {
              setUploadProgress(Math.round((event.loaded / event.total) * 100));
            }
          };

          xhr.onload = () => {
            if (cancelled) return;
            try {
              const data = JSON.parse(xhr.responseText);
              resolve({
                ok: xhr.status >= 200 && xhr.status < 300,
                status: xhr.status,
                data,
              });
            } catch {
              resolve({ ok: false, status: xhr.status, data: null });
            }
          };

          xhr.onerror = () => reject(new Error("Upload failed"));
          xhr.ontimeout = () => reject(new Error("Upload timed out"));
          xhr.timeout = 15 * 60 * 1000; // 15 minutes
          xhr.send(formData);
        });

        if (xhrResult.ok && !cancelled) {
          setUploadProgress(100);
          const newUri = getUploadedAudioUri(xhrResult.data) || recording.audioUri;
          await updateRecording(recording.id, {
            audioUri: newUri,
            needsUpload: false,
            uploadStatus: "uploaded",
            uploadErrorCode: null,
            uploadRetryable: null,
            isTranscribing: true,
            transcriptionStatus: "queued",
            transcriptionErrorCode: null,
            transcriptionError: null,
            transcriptionRetryable: null,
          });
          void retryTranscription();
        } else if (!cancelled) {
          const errorCode = xhrResult.status === 401 || xhrResult.status === 403
            ? "upload_auth_failed"
            : "upload_rejected";
          await updateRecording(recording.id, {
            needsUpload: true,
            uploadStatus: "failed",
            uploadErrorCode: errorCode,
            uploadRetryable: errorCode === "upload_auth_failed",
            isTranscribing: false,
          });
        }
      } catch (err) {
        console.error("Upload retry failed:", err);
        setUploadProgress(null);
        if (!cancelled) {
          await updateRecording(recording.id, {
            needsUpload: true,
            uploadStatus: "failed",
            uploadErrorCode: "upload_failed",
            uploadRetryable: true,
            isTranscribing: false,
          });
        }
      } finally {
        if (!cancelled) setIsUploading(false);
      }
    };

    doUpload();
    return () => {
      cancelled = true;
      setIsUploading(false);
      setUploadProgress(null);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    isAutoTranscribeEnabled,
    language,
    recording?.audioUri,
    recording?.id,
    recording?.needsUpload,
    recording?.uploadStatus,
  ]);

  // Reconcile WorkManager's server-side upload result while this screen is open.
  useEffect(() => {
    if (Platform.OS === "web") return;
    if (!recording?.audioUri) return;
    const shouldReconcile =
      recording.needsUpload === true
      || (
        isAutoTranscribeEnabled
        && (
          recording.isTranscribing === true
          || recording.transcriptionStatus === "queued"
          || recording.transcriptionStatus === "transcribing"
        )
      );
    if (!shouldReconcile) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let pollCount = 0;
    const maxPollCount = 240;

    const reconcile = async () => {
      const [remote, localWork] = await Promise.all([
        fetchRecording(recording.id),
        getBackgroundUploadStatus(recording.id),
      ]);
      if (cancelled) return;
      const result = reconcileRecordingTransfer(
        remote,
        localWork,
        isAutoTranscribeEnabled,
      );
      if (Object.keys(result.updates).length > 0) {
        // Local-only: the server is the single writer for upload/transcription
        // state (UploadWorker reports it). Echoing this read back PUTs a
        // possibly-stale snapshot that can race the worker's writes and regress
        // the doc (audioUri bucket:// → file://, permanently stuck "uploading").
        applyLocalRecording(recording.id, result.updates);
      }
      if (result.terminal) {
        setIsUploading(false);
        setUploadProgress(result.updates.uploadStatus === "uploaded" ? 100 : null);
        return;
      }
      pollCount += 1;
      if (pollCount >= maxPollCount) {
        const uploadCompleted = result.updates.uploadStatus === "uploaded"
          || remote?.audioUri?.startsWith("bucket://");
        applyLocalRecording(recording.id, {
          needsUpload: !uploadCompleted,
          uploadStatus: uploadCompleted ? "uploaded" : "failed",
          uploadErrorCode: uploadCompleted ? null : "upload_retry_exhausted",
          uploadRetryable: uploadCompleted ? null : true,
          isTranscribing: false,
          transcriptionStatus: uploadCompleted ? "failed" : remote?.transcriptionStatus,
          transcriptionErrorCode: uploadCompleted ? "transcription_failed" : remote?.transcriptionErrorCode,
          transcriptionRetryable: uploadCompleted ? true : remote?.transcriptionRetryable,
        });
        setIsUploading(false);
        setUploadProgress(null);
        return;
      }
      timer = setTimeout(reconcile, 3000);
    };

    timer = setTimeout(reconcile, 1500);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [
    fetchRecording,
    isAutoTranscribeEnabled,
    recording?.audioUri,
    recording?.id,
    recording?.isTranscribing,
    recording?.needsUpload,
    recording?.transcriptionStatus,
    applyLocalRecording,
  ]);

  // Clear preview when recording changes
  useEffect(() => {
    setPreviewText(null);
  }, [recording?.id]);

  // Transcript collapse: re-measure whenever the transcript text changes and
  // default to the contracted 2-line state (user preference: never show the
  // whole transcript on screen entry).
  // paragraphizeTranscript is idempotent — server-stored transcripts are
  // already formatted, and pre-formatting recordings get structured here at
  // display time.
  const transcriptToShow = paragraphizeTranscript(previewText || recording?.transcript || "");
  useEffect(() => {
    setTranscriptExpanded(false);
    setTranscriptLineCount(null);
  }, [transcriptToShow]);

  // Live reveal: transcription providers (Groq whisper) are batch-only — no
  // partials exist to stream. When the final transcript lands, type it out
  // progressively (~1.3s, word-count adaptive) so the result materializes
  // instead of popping in as a wall of text. Plays only when the text CHANGES
  // during this screen's life (a new transcription completing); opening a
  // recording that already has a transcript shows it instantly.
  const revealedTranscriptRef = useRef<string | null>(null);
  const [liveTranscript, setLiveTranscript] = useState<string | null>(null);
  useEffect(() => {
    if (!transcriptToShow) {
      setLiveTranscript(null);
      return;
    }
    if (revealedTranscriptRef.current === null) {
      // First render: seed with whatever is already there (no replay on open).
      revealedTranscriptRef.current = transcriptToShow;
      return;
    }
    if (transcriptToShow === revealedTranscriptRef.current) return;
    revealedTranscriptRef.current = transcriptToShow;
    const words = transcriptToShow.split(" ");
    // Fixed ~1.3s total regardless of length; paragraphs (kept inside tokens
    // by split(" ")) still appear at their natural position.
    const REVEAL_TICKS = 24;
    const wordsPerTick = Math.max(1, Math.ceil(words.length / REVEAL_TICKS));
    let i = 0;
    setLiveTranscript(words.slice(0, Math.min(wordsPerTick, words.length)).join(" "));
    const timer = setInterval(() => {
      i += wordsPerTick;
      if (i >= words.length) {
        clearInterval(timer);
        setLiveTranscript(null); // done → render the full text
      } else {
        setLiveTranscript(words.slice(0, i).join(" "));
      }
    }, 55);
    return () => clearInterval(timer);
  }, [transcriptToShow]);

  // Line count comes from a HIDDEN full-text measurer (no numberOfLines), so
  // onTextLayout reports every line. The visible Text uses numberOfLines + the
  // native tail ellipsis for the collapse — putting the "…" exactly at the
  // cut point. A truncated Text would report only the rendered lines, so the
  // visible Text itself can never be the measurer (state oscillation).
  const handleTranscriptLayout = (event: NativeSyntheticEvent<TextLayoutEventData>) => {
    const lines = event.nativeEvent.lines;
    if (!lines || lines.length === 0) return;
    setTranscriptLineCount((prev) => (prev === lines.length ? prev : lines.length));
  };

  if (!recording) {
    if (isRemoteRecordingLoading) {
      return (
        <View style={[styles.container, { paddingTop: insets.top + webTopInset }]}>
          <View style={styles.centerContent}>
            <ActivityIndicator size="large" color={Colors.primary} />
          </View>
        </View>
      );
    }

    return (
      <View style={[styles.container, { paddingTop: insets.top + webTopInset }]}>
        <View style={styles.centerContent}>
          <Feather name="alert-circle" size={48} color={Colors.primary} />
          <Text style={[styles.emptyText, { color: Colors.textSecondary, marginTop: 12 }]}>{t("detail.notFound")}</Text>
          <Pressable
            onPress={() => router.replace("/")}
            style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 20, paddingVertical: 12, paddingHorizontal: 24, backgroundColor: Colors.surface, borderRadius: 12, borderWidth: 0 }}
            accessibilityRole="button"
            accessibilityLabel={t("detail.goHome")}
          >
            <Feather name="arrow-left" size={16} color={Colors.primary} />
            <Text style={{ fontSize: ts.bodyLarge, fontFamily: "Inter_500Medium", color: Colors.primary }}>{t("detail.goHome")}</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  const transferErrorKey = getRecordingTransferMessageKey(
    recording.uploadErrorCode || recording.transcriptionErrorCode,
  );
  const transferErrorMessage = transferErrorKey
    ? t(transferErrorKey as any)
    : recording.transcriptionError
      || (recording.transcript?.startsWith("[Transcription failed")
        ? recording.transcript.replace(/[\[\]]/g, "")
        : t("detail.transcriptUnavailable"));
  const retryUpload = async () => {
    await updateRecording(recording.id, {
      needsUpload: true,
      uploadStatus: "pending",
      uploadErrorCode: null,
      uploadRetryable: null,
      isTranscribing: false,
    });
  };

  const retryTranscription = async (confirmExtendedAccess?: boolean) => {
    if (!recording.audioUri || retryingTranscription) return;
    setRetryingTranscription(true);
    try {
      await updateRecording(recording.id, {
        isTranscribing: true,
        transcriptionStatus: "transcribing",
        transcriptionErrorCode: null,
        transcriptionError: null,
        transcriptionRetryable: null,
        transcript: "",
      });
      const formData = new FormData();
      const baseUrl = getApiUrl();
      const url = new URL("/api/transcribe", baseUrl);
      if (language && language !== "en") {
        formData.append("language", language);
      }
      if (confirmExtendedAccess) {
        formData.append("confirmExtendedAccess", "true");
      }
      let res: Response;
      if (Platform.OS === "web") {
        const audioSrc = resolveBucketUri(recording.audioUri);
        const response = await authFetch(audioSrc, { credentials: "include" });
        const blob = await response.blob();
        formData.append("audio", blob, "recording.webm");
        res = await authFetch(url.toString(), { method: "POST", body: formData, credentials: "include" });
      } else if (recording.audioUri.startsWith("bucket://")) {
        const storedTranscriptionUrl = new URL(`/api/recordings/${encodeURIComponent(recording.id)}/transcribe`, baseUrl);
        res = await authFetch(storedTranscriptionUrl.toString(), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ language, confirmExtendedAccess: !!confirmExtendedAccess }),
          credentials: "include",
        });
      } else {
        const upload = getAudioUploadMetadata(recording.audioUri);
        formData.append("audio", { uri: recording.audioUri, ...upload } as any);
        const TRANSCRIBE_TIMEOUT_MS = 15 * 60 * 1000; // 15 min total for upload + processing
        const fetchPromise = authFetch(url.toString(), { method: "POST", body: formData, credentials: "include" });
        const timeoutPromise = new Promise<Response>((_, reject) =>
          setTimeout(() => reject(new Error("Transcription timed out after 15 minutes. Your recording is safe — try again.")), TRANSCRIBE_TIMEOUT_MS)
        );
        res = await Promise.race([fetchPromise, timeoutPromise]);
      }
      if (res.status === 402) {
        const errData = await res.json().catch(() => ({}));
        await updateRecording(recording.id, {
          isTranscribing: false,
          transcriptionStatus: "failed",
          transcriptionErrorCode: "pro_access_required",
          transcriptionRetryable: false,
        });
        setRetryingTranscription(false);
        setProAccessInfo({
          actionType: "transcription",
          unitCost: errData.unitCost || 0,
          costSoFar: errData.extendedCostSoFar || 0,
          pricing: errData.pricing || { transcription: 0.15, conversion: 0.10 },
          onConfirm: async () => {
            setShowProAccessModal(false);
            setProAccessInfo(null);
            if (Platform.OS !== "web") {
              router.push("/settings/account?tab=subscription");
              return;
            }
            try {
              const checkoutUrl = new URL("/api/stripe/pro-access/checkout", getApiUrl());
              const checkoutRes = await authFetch(checkoutUrl.toString(), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}), credentials: "include" });
              if (checkoutRes.ok) {
                const { url } = await checkoutRes.json();
                if (url) Linking.openURL(url);
              }
            } catch (e) { console.error("Pro checkout failed:", e); }
          },
        });
        setShowProAccessModal(true);
        return;
      }
      if (res.status === 429) {
        const errData = await res.json().catch(() => ({}));
        await updateRecording(recording.id, {
          isTranscribing: false,
          transcriptionStatus: "failed",
          transcriptionErrorCode: errData.error === "spending_cap_reached"
            ? "spending_cap_reached"
            : "monthly_limit_reached",
          transcriptionRetryable: false,
        });
        if (errData.error === "spending_cap_reached") {
          setUpgradeMessage("You've reached your monthly spending cap. You can adjust it in Settings.");
        } else {
          setUpgradeMessage(t("upgrade.transcriptionLimit" as any, { limit: errData.limit || "" }));
        }
        setShowUpgradeModal(true);
        setRetryingTranscription(false);
        return;
      }
      if (!res.ok) throw new Error(`Transcription failed: ${res.status}`);
      const data = await res.json();
      // Server returned no usable transcript (silence or provider garbage).
      // Mirror the server's persisted error state instead of fabricating a
      // "No speech detected" transcript, so the screen shows the mapped
      // message. BOTH outcomes stay retryable: the silence detector is a
      // heuristic and must never lock a user out of a recording (#196).
      if (!hasTranscriptionContent(data)) {
        const noSpeech = data?.errorCode === "transcription_no_speech";
        await updateRecording(recording.id, {
          isTranscribing: false,
          transcriptionStatus: "failed",
          transcriptionErrorCode: noSpeech ? "transcription_no_speech" : "transcription_failed",
          transcriptionRetryable: true,
        });
        setRetryingTranscription(false);
        return;
      }
      const transcriptText = getTranscriptionText(data);
      // Show preview instantly before Firestore write latency
      setPreviewText(transcriptText);
      await updateRecording(recording.id, {
        transcript: transcriptText,
        isTranscribing: false,
        transcriptionStatus: "succeeded",
        transcriptionErrorCode: null,
        transcriptionError: null,
        transcriptionRetryable: null,
      });
    } catch (err) {
      console.error("Retry transcription failed:", err);
      const message = err instanceof Error ? err.message : "Transcription failed";
      let userMessage: string;
      if (message.includes("timed out") || message.includes("Timeout")) {
        userMessage = "Transcription took too long. Your recording is safe — try again when you're on a better connection.";
      } else if (message.includes("Network") || message.includes("fetch") || message.includes("AbortError")) {
        userMessage = "Couldn't reach the server. Check your connection and try again. Your recording is saved.";
      } else if (message.includes("quota") || message.includes("limit") || message.includes("429")) {
        userMessage = "Transcription quota reached this month. Your recording is saved — it'll reset next month.";
      } else {
        userMessage = "Transcription didn't complete. Your recording is safe — tap retry when ready.";
      }
      await updateRecording(recording.id, {
        isTranscribing: false,
        transcriptionStatus: "failed",
        transcriptionErrorCode: "transcription_failed",
        transcriptionError: userMessage,
        transcriptionRetryable: true,
      });
    } finally {
      setRetryingTranscription(false);
    }
  };

  const playAudio = async () => {
    try {
      // If we already have a loaded sound, toggle play/pause
      if (soundRef.current) {
        const status = await soundRef.current.getStatusAsync();
        if (status.isLoaded) {
          if (isPlaying) {
            await soundRef.current.pauseAsync();
            setIsPlaying(false);
          } else {
            await soundRef.current.playAsync();
            // Only set playing if playAsync succeeded (web may reject silently)
            const newStatus = await soundRef.current.getStatusAsync();
            setIsPlaying(newStatus.isPlaying || false);
          }
          return;
        }
        // Stale sound — unload and recreate below
        try { await soundRef.current.unloadAsync(); } catch {}
        soundRef.current = null;
      }

      await Audio.setAudioModeAsync({ allowsRecordingIOS: false, playsInSilentModeIOS: true });
      const audioPlaybackUri = resolveBucketUri(recording.audioUri);
      if (!audioPlaybackUri) {
        console.error("No audio URI to play");
        const msg = t("detail.audioUnavailable" as any) || "Audio is no longer available for this recording.";
        if (Platform.OS === "web") {
          alert(msg);
        } else {
          Alert.alert(t("common.error"), msg);
        }
        return;
      }

      const { sound } = await Audio.Sound.createAsync(
        { uri: audioPlaybackUri },
        { shouldPlay: true },
        (status) => {
          if (status.isLoaded) {
            setPlaybackPosition(status.positionMillis / 1000);
            if (status.didJustFinish) {
              setIsPlaying(false);
              setPlaybackPosition(0);
            }
          }
        }
      );
      soundRef.current = sound;
      // Wait briefly so the audio element can start, then check actual state
      await new Promise(r => setTimeout(r, 100));
      const playStatus = await sound.getStatusAsync();
      setIsPlaying(playStatus.isPlaying || false);
      if (playStatus.isPlaying) {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }
    } catch (err) {
      console.error("Playback error:", err);
      setIsPlaying(false);
    }
  };

  const persistDraftIfNeeded = async () => {
    if (isDraftTextEntry && !draftPersisted && id) {
      const textEntryTranscript = customText.trim();
      const newRecording: import("@/lib/recordings-context").Recording = {
        id,
        title: t("home.textEntry" as any) || "Text Entry",
        duration: 0,
        audioUri: "",
        transcript: textEntryTranscript,
        conversions: [],
        createdAt: new Date().toISOString(),
      };
      await addRecording(newRecording);
      setDraftPersisted(true);
    }
  };

  const runConversion = async (type: string, citationStyle?: string, clarifications?: { question: string; answer: string }[], bibliographyType?: string, confirmExtendedAccess?: boolean, confirmAcademicResearch?: boolean, webSourcesOverride?: boolean) => {
    const convSourceText = sourceText;
    if (!convSourceText) return;
    if (sourceTextTooShort) return;

    const typeInfo = CONVERSION_TYPES.find((t) => t.value === type);
    if (!typeInfo) return;

    setDetailTab("conversions");
    setConvertingType(type);
    setConversionError(null);
    setStreamingContent("");
    setConversionStage(t("detail.preparingTranscript"));
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    let stageTimer1: any;
    let stageTimer2: any;
    let stageTimer3: any;

    try {
      stageTimer1 = setTimeout(() => {
        setConversionStage(t("detail.analyzingTranscript"));
        setConversionPhase("thinking");
      }, 2000);
      stageTimer2 = setTimeout(() => {
        setConversionStage(t("detail.structuringArtifact", { type: typeInfo.label }));
        setConversionPhase("making");
      }, 4500);
      stageTimer3 = setTimeout(() => {
        setConversionStage(t("detail.receivingResponse"));
        setConversionPhase("making");
      }, 8000);

      await persistDraftIfNeeded();

      let customPrompt: string | undefined;
      try {
        const stored = await AsyncStorage.getItem(CUSTOM_PROMPTS_KEY);
        if (stored) {
          const prompts = JSON.parse(stored);
          if (prompts[type]) customPrompt = prompts[type];
        }
      } catch {}

      const baseUrl = getApiUrl();
      const url = new URL("/api/convert", baseUrl);

      const userTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const bodyData: any = { transcript: convSourceText, type, customPrompt, outputFormat: useMarkdown ? "markdown" : "plaintext", timezone: userTimezone };
      if (language && language !== "en") bodyData.language = language;
      if (citationStyle) bodyData.citationStyle = citationStyle;
      if (bibliographyType) bodyData.bibliographyType = bibliographyType;
      const effectiveWebSources = webSourcesOverride ?? includeWebSources ?? undefined;
      if (typeof effectiveWebSources === "boolean") bodyData.includeWebSources = effectiveWebSources;
      if (clarifications && clarifications.length > 0) bodyData.clarifications = clarifications;
      if (confirmExtendedAccess) bodyData.confirmExtendedAccess = true;
      if (confirmAcademicResearch) bodyData.confirmAcademicResearch = true;

      const res = await authExpoFetch(url.toString(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(bodyData),
      });

      if (res.status === 402) {
        const errData = await res.json().catch(() => ({}));
        setConvertingType(null);

        setProAccessInfo({
          actionType: errData.actionType || "conversion",
          unitCost: errData.unitCost || 0,
          costSoFar: errData.extendedCostSoFar || 0,
          pricing: errData.pricing || { transcription: 0.15, conversion: 0.10 },
          onConfirm: async () => {
            setShowProAccessModal(false);
            setProAccessInfo(null);
            if (Platform.OS !== "web") {
              router.push("/settings/account?tab=subscription");
              return;
            }
            try {
              const checkoutUrl = new URL("/api/stripe/pro-access/checkout", getApiUrl());
              const checkoutRes = await authFetch(checkoutUrl.toString(), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}), credentials: "include" });
              if (checkoutRes.ok) {
                const { url } = await checkoutRes.json();
                if (url) Linking.openURL(url);
              }
            } catch (e) { console.error("Pro checkout failed:", e); }
          },
        });
        setShowProAccessModal(true);
        return;
      }
      if (res.status === 429) {
        const errData = await res.json().catch(() => ({}));
        if (errData.error === "spending_cap_reached") {
          setUpgradeMessage("You've reached your monthly spending cap. You can adjust it in Settings.");
          setShowUpgradeModal(true);
          return;
        }
        const limitType = errData.limitType || "conversion";
        const limitVal = errData.limit || "";
        setUpgradeMessage(
          limitType === "transcription"
            ? t("upgrade.transcriptionLimit" as any, { limit: limitVal })
            : t("upgrade.conversionLimit" as any, { limit: limitVal })
        );
        setShowUpgradeModal(true);
        return;
      }
      if (res.status === 403) {
        const errData = await res.json().catch(() => ({}));
        if (errData.error === "conversion_type_locked") {
          if (errData.requiredModule && errData.moduleEligible) {
            const moduleLabel = getModuleDisplayName(errData.requiredModule);
            setUpgradeMessage(
              language === "es"
                ? `Activa ${moduleLabel} en Configuración de IA para usar esta conversión.`
                : `Enable ${moduleLabel} in AI Configuration to use this conversion.`,
            );
            setShowUpgradeModal(true);
            return;
          }
          const requiredTier = errData.requiredTier as SubscriptionTier | undefined;
          const tierLabel = requiredTier ? TIER_DISPLAY_NAMES[requiredTier] || requiredTier : "";
          setUpgradeMessage(tierLabel
            ? (t("upgrade.requiresTier" as any, { tier: tierLabel }) || `Requires ${tierLabel}`)
            : t("upgrade.conversionTypeLocked" as any));
          setShowUpgradeModal(true);
          return;
        }
        throw new Error(errData.error || "Access denied");
      }
      if (res.status === 413) {
        setUpgradeMessage(t("upgrade.storageLimit" as any));
        setShowUpgradeModal(true);
        return;
      }
      if (!res.ok) {
        const errData = await res.json().catch(() => ({} as any));
        throw new Error(errData?.error || "Conversion failed");
      }

      let reader = res.body?.getReader();
      if (!reader) {
        // RN native sometimes delivers responses without a readable body
        // (streaming support varies by platform/version). The SSE payload is
        // still fully present — read it as text and feed it through the same
        // event loop below, so conversions work even without streaming.
        const payload = await res.text().catch(() => "");
        if (!payload.trim()) throw new Error("No reader");
        let consumed = false;
        const encoder = new TextEncoder();
        reader = {
          read: async () => {
            if (consumed) return { done: true, value: undefined };
            consumed = true;
            return { done: false, value: encoder.encode(payload) };
          },
          cancel: async () => {},
        } as any;
      }

      const decoder = createUtf8Decoder();
      let buffer = "";
      let fullContent = "";

      let completedSuccessfully = false;
      let streamFinished = false;
      readLoop: while (true) {
        const { done, value } = await reader!.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const event = JSON.parse(line.slice(6));
            if (event.error) {
              throw new Error(event.error);
            }
            if (event.content) {
              fullContent += event.content;
              setStreamingContent(fullContent);
              setConversionStage(t("detail.generatingContent"));
              setConversionPhase("making");
            }
            if (event.done) {
              completedSuccessfully = true;
              let convLabel = typeInfo.label;
              if ((type === "academic_research" || type === "bibliography") && citationStyle) {
                const styleInfo = CITATION_STYLES.find((s) => s.value === citationStyle);
                if (styleInfo) {
                  const bibTypeLabel = type === "bibliography" && bibliographyType === "annotated" ? " - Annotated" : "";
                  convLabel = `${typeInfo.label} (${styleInfo.label}${bibTypeLabel})`;
                }
              }
              const finalContent = event.fullContent || fullContent;
              const conversion: Conversion = {
                id: generateId(),
                type,
                label: convLabel,
                content: finalContent,
                createdAt: new Date().toISOString(),
              };
              await addConversion(recording.id, conversion);
              // The result is ready the instant this event arrives — reveal it
              // now. Previously convertingType only cleared in the `finally`
              // block below, which runs after the network stream itself fully
              // closes (a variable-length tail with no user-visible content)
              // and after the best-effort file-save POST below completed.
              // That gap made the "generating" card linger indeterminately
              // after work was actually done, then vanish and hand off to the
              // result modal at a moment with no relationship to real
              // progress — reading as a stall or failure. Clearing the
              // in-progress state and presenting the result together, in the
              // same tick, makes the handoff deterministic and immediate.
              clearTimeout(stageTimer1);
              clearTimeout(stageTimer2);
              clearTimeout(stageTimer3);
              setConvertingType(null);
              setStreamingContent("");
              setConversionStage("");
              setConversionPhase("thinking");
              setSelectedConversion(conversion);
              if (user && recording) {
                // Fire-and-forget: saving a copy to Files is a convenience,
                // not part of showing the user their finished conversion.
                // Awaiting it here previously blocked the UI transition on
                // an unrelated network round-trip.
                const fileName = `${recording.title} - ${convLabel}`;
                authFetch(new URL("/api/files", baseUrl).toString(), {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  credentials: "include",
                  body: JSON.stringify({
                    name: fileName,
                    content: finalContent,
                    conversionType: convLabel,
                    sourceRecordingId: recording.id,
                  }),
                }).catch(() => {});
              }
              streamFinished = true;
              break readLoop;
            }
          } catch (e: any) {
            if (e.message && e.message !== "Unexpected end of JSON input" && !/JSON/i.test(e.message)) {
              throw e;
            }
          }
        }
      }
      if (streamFinished) {
        // The remainder of the stream (if any) carries no further content;
        // release the connection instead of continuing to read it.
        reader!.cancel().catch(() => {});
      }

      if (!completedSuccessfully && !fullContent) {
        throw new Error("Conversion stream disconnected before completion.");
      }
    } catch (err) {
      console.error("Conversion error:", err);
      const message = err instanceof Error ? err.message : String(err);
      if (/recording limit/i.test(message)) {
        setUpgradeMessage(message || t("upgrade.recordingLimit" as any));
        setShowUpgradeModal(true);
      } else {
        setConversionError({
          type,
          message: message || "Conversion failed. Please try again.",
          citationStyle,
          bibliographyType,
          includeWebSources: includeWebSources ?? undefined,
        });
      }
    } finally {
      clearTimeout(stageTimer1);
      clearTimeout(stageTimer2);
      clearTimeout(stageTimer3);
      setConvertingType(null);
      setStreamingContent("");
      setConversionStage("");
      setConversionPhase("thinking");
    }
  };

  const stripMarkdown = (md: string): string => {
    return md
      .replace(/```[\s\S]*?```/g, (match) => match.replace(/```\w*\n?/g, "").trim())
      .replace(/`([^`]+)`/g, "$1")
      .replace(/^#{1,6}\s+/gm, "")
      .replace(/\*\*(.+?)\*\*/g, "$1")
      .replace(/\*(.+?)\*/g, "$1")
      .replace(/__(.+?)__/g, "$1")
      .replace(/_(.+?)_/g, "$1")
      .replace(/~~(.+?)~~/g, "$1")
      .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/^>\s+/gm, "")
      .replace(/^[-*+]\s+/gm, "- ")
      .replace(/^\d+\.\s+/gm, "")
      .replace(/^---+$/gm, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  };

  const addSourceAttachment = (name: string, text: string) => {
    setSourceAttachments((current) => [
      ...current,
      {
        id: generateId(),
        name: name.trim() || t("detail.untitledFile" as any),
        text: text.trim(),
      },
    ]);
  };

  const handleFileImport = async (file: File | { uri: string; name: string; mimeType: string }) => {
    setImportingFile(true);
    try {
      const formData = new FormData();
      const isWebFile = typeof File !== "undefined" && file instanceof File;
      if (isWebFile) {
        formData.append("file", file);
      } else if (Platform.OS !== "web") {
        const nativeFile = file as { uri: string; name: string; mimeType: string };
        formData.append("file", { uri: nativeFile.uri, name: nativeFile.name, type: nativeFile.mimeType || "application/octet-stream" } as any);
      } else {
        const nativeFile = file as { uri: string; name: string; mimeType: string };
        const response = await fetch(nativeFile.uri);
        const blob = await response.blob();
        formData.append("file", blob, nativeFile.name);
      }

      const apiUrl = getApiUrl();
      const durableUpload = isDurableContextRecording;
      const url = new URL(
        durableUpload
          ? `/api/recordings/${encodeURIComponent(id)}/contexts/file`
          : "/api/parse-document",
        apiUrl,
      );
      const res = await authFetch(url.toString(), {
        method: "POST",
        body: formData,
        credentials: "include",
      });

      if (res.status === 413) {
        const err = await res.json().catch(() => ({}));
        if (err.truncated === false && err.error) {
          throw new Error(err.error);
        }
        const limitBytes = Number(err.limitBytes || 0);
        const limitStr = limitBytes > 0
          ? `${(limitBytes / (1024 * 1024)).toFixed(limitBytes >= 1024 * 1024 ? 0 : 1)} MB`
          : err.limit
            ? `${err.limit} MB`
            : "";
        const fileSize = isWebFile ? file.size : 0;
        const fileSizeStr = fileSize > 0 ? `${(fileSize / (1024 * 1024)).toFixed(1)} MB` : file.name;
        setUpgradeMessage(t("upgrade.fileTooLarge" as any, { size: fileSizeStr, limit: limitStr }));
        setShowUpgradeModal(true);
        setImportingFile(false);
        return;
      }
      if (res.status === 403) {
        const errData = await res.json().catch(() => ({}));
        if (errData.error === "file_type_locked") {
          const tierName = errData.requiredTier ? (TIER_DISPLAY_NAMES as any)[errData.requiredTier] || errData.requiredTier : "Base";
          setUpgradeMessage(t("upgrade.fileTypeRequires" as any, { type: errData.ext || "", tier: tierName }));
          setShowUpgradeModal(true);
          setImportingFile(false);
          return;
        }
        setImportingFile(false);
        throw new Error(errData.error || "Access denied");
      }
      if (!res.ok) {
        const errData = await res.json().catch(() => ({ error: "Failed to parse file" }));
        throw new Error(errData.error || "Failed to parse file");
      }

      const data = await res.json();

      if (durableUpload && data.context) {
        const context = data.context;
        setSourceAttachments((current) => [
          ...current,
          {
            id: context.id,
            name: context.label || context.originalFilename || file.name,
            text: context.text,
            persisted: true,
            revision: context.revision,
            originalFilename: context.originalFilename,
            sourceMimeType: context.sourceMimeType,
            sourceFileSize: context.sourceFileSize,
            sourceHash: context.sourceHash,
            parserVersion: context.parserVersion,
            sourceBucketFileId: context.sourceBucketFileId,
            contentEdited: context.contentEdited,
            originalUnavailable: context.originalUnavailable,
          },
        ]);
        setContextSaveState("saved");
      } else if (data.isMarkdown) {
        setMarkdownPrompt({ text: data.text, filename: data.filename || file.name });
      } else {
        addSourceAttachment(data.filename || file.name, data.text);
      }
    } catch (error: any) {
      const msg = error.message || t("detail.fileImportError");
      if (Platform.OS === "web") {
        alert(msg);
      } else {
        Alert.alert(t("detail.fileImportErrorTitle"), msg);
      }
    } finally {
      setImportingFile(false);
    }
  };

  const removeSourceAttachment = async (attachment: ConversionSourceAttachment) => {
    const remove = async () => {
      if (attachment.persisted && isDurableContextRecording) {
        try {
          const response = await authExpoFetch(
            new URL(
              `/api/recordings/${encodeURIComponent(id)}/contexts/${encodeURIComponent(attachment.id)}`,
              getApiUrl(),
            ).toString(),
            { method: "DELETE" },
          );
          if (!response.ok && response.status !== 404) {
            throw new Error(`Context delete failed (${response.status})`);
          }
        } catch (error: any) {
          const message = error?.message || t("detail.removeFileContextFailed" as any);
          if (Platform.OS === "web") alert(message);
          else Alert.alert(t("detail.removeFileContextFailedTitle" as any), message);
          return;
        }
      }
      setSourceAttachments((current) => current.filter((item) => item.id !== attachment.id));
      setEditingSourceAttachment((current) => current?.id === attachment.id ? null : current);
    };

    const message = t("detail.removeFileContextMessage" as any, { name: attachment.name });
    if (Platform.OS === "web") {
      if (globalThis.confirm?.(message)) await remove();
      return;
    }
    Alert.alert(
      t("detail.removeFileContextTitle" as any),
      message,
      [
        { text: t("common.cancel"), style: "cancel" },
        { text: t("detail.removeFileContextAction" as any), style: "destructive", onPress: () => { void remove(); } },
      ],
    );
  };

  const saveSourceAttachment = async () => {
    if (!editingSourceAttachment?.text.trim()) return;
    const normalized = {
      ...editingSourceAttachment,
      text: editingSourceAttachment.text.trim(),
    };
    if (normalized.persisted && isDurableContextRecording) {
      try {
        const response = await authExpoFetch(
          new URL(
            `/api/recordings/${encodeURIComponent(id)}/contexts/${encodeURIComponent(normalized.id)}`,
            getApiUrl(),
          ).toString(),
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text: normalized.text }),
          },
        );
        if (!response.ok) throw new Error(`Context update failed (${response.status})`);
        const data = await response.json();
        normalized.revision = data.context?.revision || normalized.revision;
        normalized.contentEdited = data.context?.contentEdited === true;
      } catch (error: any) {
        const message = error?.message || t("detail.updateFileContextFailed" as any);
        if (Platform.OS === "web") alert(message);
        else Alert.alert(t("detail.updateFileContextFailedTitle" as any), message);
        return;
      }
    }
    setSourceAttachments((current) => current.map((attachment) =>
      attachment.id === normalized.id ? normalized : attachment));
    setEditingSourceAttachment(null);
  };

  const openSourceOriginal = async (attachment: ConversionSourceAttachment) => {
    if (!attachment.sourceBucketFileId) return;
    const url = new URL(
      `/api/bucket/files/${encodeURIComponent(attachment.sourceBucketFileId)}`,
      getApiUrl(),
    ).toString();
    try {
      await Linking.openURL(url);
    } catch {
      const message = "The retained original could not be opened.";
      if (Platform.OS === "web") alert(message);
      else Alert.alert("Could not open original", message);
    }
  };

  const handleConvert = async (type: string, citationStyle?: string, bibliographyType?: string) => {
    if (type === "academic_research" && !citationStyle) {
      setShowConvertMenu(false);
      setCitationPickerTarget("academic_research");
      setShowCitationPicker(true);
      return;
    }

    if (type === "bibliography" && !citationStyle) {
      setShowConvertMenu(false);
      setCitationPickerTarget("bibliography");
      setShowCitationPicker(true);
      return;
    }

    if (type === "bibliography" && citationStyle && !bibliographyType) {
      setShowCitationPicker(false);
      setSelectedBibCitationStyle(citationStyle);
      setShowBibliographyTypePicker(true);
      return;
    }

    if (type === "slide_deck") {
      setShowConvertMenu(false);
      setShowDeckStylePicker(true);
      return;
    }

    setShowConvertMenu(false);
    setShowCitationPicker(false);
    setShowBibliographyTypePicker(false);
    if (RESEARCH_FORMS_TYPES.has(type)) setActiveResearchFormType(type);
    trackRecentConversionType(type);
    const sourceForConversion = sourceText;
    if (!sourceForConversion) return;

    // Adaptive clarifying questions: the server judges ambiguity (fast Groq
    // model) and only returns questions when a wrong assumption would
    // materially change the output. Clear content flows straight through to
    // the conversion — no modal, no toggle, no interruption.
    setClarifyLoading(true);
    setPendingConversion({ type, citationStyle, bibliographyType, includeWebSources: includeWebSources ?? undefined });
    try {
      let customPrompt: string | undefined;
      try {
        const stored = await AsyncStorage.getItem(CUSTOM_PROMPTS_KEY);
        if (stored) {
          const prompts = JSON.parse(stored);
          if (prompts[type]) customPrompt = prompts[type];
        }
      } catch {}

      const baseUrl = getApiUrl();
      const url = new URL("/api/convert/clarify", baseUrl);
      const bodyData: any = { transcript: sourceForConversion, type, customPrompt };
      if (language && language !== "en") bodyData.language = language;
      if (citationStyle) bodyData.citationStyle = citationStyle;
      if (bibliographyType) bodyData.bibliographyType = bibliographyType;

      const res = await authExpoFetch(url.toString(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(bodyData),
      });

      if (res.ok) {
        const data = await res.json();
        if (data.hasQuestions && data.question) {
          setClarifyQuestion(data.question);
          setClarifyOptions(data.options || []);
          setClarifyAnswerText("");
          setClarifyLoading(false);
          return;
        }
      }
    } catch (err) {
      console.error("Clarify check error:", err);
    }
    setClarifyLoading(false);
    setPendingConversion(null);
    await runConversion(type, citationStyle, undefined, bibliographyType);
  };

  const handleSubmitClarifications = async (selectedOption?: string) => {
    if (!pendingConversion) return;
    const finalAnswer = selectedOption || clarifyAnswerText.trim() || "No answer provided";
    const clarifications = [{
      question: clarifyQuestion,
      answer: finalAnswer,
    }];
    const { type, citationStyle, bibliographyType, includeWebSources: pendingWeb } = pendingConversion;
    setPendingConversion(null);
    setClarifyLoading(true);
    setTimeout(async () => {
      setClarifyQuestion("");
      setClarifyOptions([]);
      setClarifyAnswerText("");
      setClarifyLoading(false);
      await runConversion(type, citationStyle, clarifications, bibliographyType, undefined, undefined, pendingWeb);
    }, 100);
  };

  const handleSkipClarifications = async () => {
    if (!pendingConversion) return;
    const { type, citationStyle, bibliographyType, includeWebSources: pendingWeb } = pendingConversion;
    setPendingConversion(null);
    setClarifyLoading(true);
    setTimeout(async () => {
      setClarifyQuestion("");
      setClarifyOptions([]);
      setClarifyAnswerText("");
      setClarifyLoading(false);
      await runConversion(type, citationStyle, undefined, bibliographyType, undefined, undefined, pendingWeb);
    }, 100);
  };

  // Slide Deck generation: the user picked a look; the server generates the
  // deck outline AND assembles the styled .pptx, then we save the artifact.
  const runDeckGeneration = async (styleId: string) => {
    setShowDeckStylePicker(false);
    const sourceForConversion = sourceText;
    if (!sourceForConversion) return;
    setConvertingType("slide_deck");
    setStreamingContent("");
    setConversionStage("");
    setConversionError(null);
    try {
      const baseUrl = getApiUrl();
      const bodyData: any = { transcript: sourceForConversion, style: styleId };
      if (language && language !== "en") bodyData.language = language;
      if (recording?.id) bodyData.recordingId = recording.id;

      const res = await authExpoFetch(new URL("/api/slide-deck", baseUrl).toString(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(bodyData),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const errMsg =
          typeof data?.error === "string" && data.error
            ? data.error
            : t("common.somethingWentWrong");
        throw new Error(errMsg);
      }
      const data = await res.json();
      const styleInfo = DECK_STYLES.find((s) => s.id === data.style);
      const conversion: Conversion = {
        id: generateId(),
        type: "slide_deck",
        label: `${t("conversion.slide_deck")}${styleInfo ? ` · ${t(`deck.style.${styleInfo.labelKey}` as any)}` : ""}`,
        content: deckToMarkdown(data),
        createdAt: new Date().toISOString(),
        deckId: data.deckId,
        pptxUrl: data.pptxUrl,
        fileName: data.fileName,
      };
      await addConversion(recording.id, conversion);
      setSelectedConversion(conversion);
      if (user && recording) {
        const fileName = `${recording.title} - ${conversion.label}`;
        authFetch(new URL("/api/files", baseUrl).toString(), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            name: fileName,
            content: conversion.content,
            conversionType: conversion.label,
            sourceRecordingId: recording.id,
          }),
        }).catch(() => {});
      }
    } catch (err: any) {
      console.error("Deck generation error:", err);
      setConversionError({
        type: "slide_deck",
        message: err?.message || t("common.somethingWentWrong"),
      });
    } finally {
      setConvertingType(null);
      setConversionStage("");
      setConversionPhase("thinking");
    }
  };

  // Downloads the generated .pptx with the session token via the deck export
  // endpoint (self-contained stream; no bucket record lookup needed).
  // Web: blob download. Native: Downloads collection (Android) or share sheet.
  const handleDownloadDeck = async (conversion: Conversion) => {
    if (!conversion.deckId) return;
    setDeckDownloadingId(conversion.id);
    try {
      const url = new URL(`/api/slide-deck/${conversion.deckId}/export`, getApiUrl()).toString();
      const res = await authExpoFetch(url.toString(), { method: "GET" });
      if (!res.ok) throw new Error("Failed to download deck");
      const fileName = conversion.fileName || "presentation.pptx";
      const pptxMime = "application/vnd.openxmlformats-officedocument.presentationml.presentation";

      if (Platform.OS === "web") {
        const blob = await res.blob();
        triggerWebDownload(blob, fileName);
        showDownloadToast(fileName);
        return;
      }

      const base64 = arrayBufferToBase64(await res.arrayBuffer());
      await saveFile({
        fileName,
        mimeType: pptxMime,
        base64,
        dialogTitle: t("deck.downloadPptx"),
      }, `deck-${conversion.id}`);
    } catch (err: any) {
      console.error("Deck download error:", err);
      notifyDownloadFailed();
    } finally {
      setDeckDownloadingId(null);
    }
  };

  const handleShareConversion = (conversion: Conversion) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setExportTarget({ conversion, action: "share" });
  };

  const handleSaveConversion = (conversion: Conversion) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setExportTarget({ conversion, action: "save" });
  };

  const handleOpenTaskExport = async () => {
    if (!user) {
      Alert.alert(t("detail.signInRequired"), t("detail.taskExportSignIn"));
      return;
    }
    try {
      const baseUrl = getApiUrl();
      const res = await authExpoFetch(new URL("/api/tasks/providers", baseUrl).toString(), { credentials: "include" });
      const data = await res.json();
      setTaskProviders(data.filter((p: any) => p.enabled));
      setShowTaskExport(true);
    } catch (err) {
      Alert.alert(t("common.error"), t("detail.failedTaskIntegrations"));
    }
  };

  const handleExportToTaskProvider = async (providerId: string) => {
    if (!selectedConversion) return;
    setTaskExporting(providerId);
    try {
      const baseUrl = getApiUrl();
      const res = await authExpoFetch(new URL("/api/tasks/export", baseUrl).toString(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ providerId, content: selectedConversion.content }),
      });
      if (res.status === 403) {
        const errData = await res.json().catch(() => ({}));
        if (errData.error === "integration_locked") {
          const tierName = errData.requiredTier ? (TIER_DISPLAY_NAMES as any)[errData.requiredTier] || errData.requiredTier : "Base";
          setUpgradeMessage(t("upgrade.integrationRequires" as any, { tier: tierName }));
          setShowUpgradeModal(true);
          setShowTaskExport(false);
          return;
        }
        Alert.alert(t("detail.exportFailedTitle"), errData.error || t("detail.failedExportTasks"));
        return;
      }
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        Alert.alert(t("detail.exportFailedTitle"), errData.error || t("detail.failedExportTasks"));
        return;
      }
      const data = await res.json();
      if (data.success) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        Alert.alert(t("detail.tasksExported"), t("detail.tasksExportedMsg", { exported: data.count, total: data.totalParsed }));
        setShowTaskExport(false);
      } else {
        Alert.alert(t("detail.exportFailedTitle"), data.error || t("detail.failedExportTasks"));
      }
    } catch (err) {
      Alert.alert(t("common.error"), t("detail.failedExportTasks"));
    } finally {
      setTaskExporting(null);
    }
  };

  const handleOpenCalendarExport = async () => {
    if (!selectedConversion) return;
    setCalendarParsing(true);
    setShowCalendarExport(true);
    setCalendarExportSuccess(new Set());
    try {
      const baseUrl = getApiUrl();
      const [eventsRes, providersRes] = await Promise.all([
        authExpoFetch(new URL("/api/calendar/parse-events", baseUrl).toString(), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ content: selectedConversion.content }),
        }),
        authExpoFetch(new URL("/api/calendar/providers", baseUrl).toString(), {
          credentials: "include",
        }).catch(() => null),
      ]);
      const data = await eventsRes.json();
      setCalendarEvents(data.events || []);
      if (providersRes?.ok) {
        const providers = await providersRes.json();
        setCalendarProviders(Array.isArray(providers) ? providers.filter((p: any) => p.enabled) : []);
      }
    } catch (err) {
      Alert.alert(t("common.error"), t("detail.failedParseCalendar"));
      setShowCalendarExport(false);
    } finally {
      setCalendarParsing(false);
    }
  };

  const handleExportToCalendarProvider = async (providerId: number) => {
    if (!selectedConversion) return;
    setCalendarExportingId(providerId);
    try {
      const baseUrl = getApiUrl();
      const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
      const res = await authExpoFetch(new URL("/api/calendar/export", baseUrl).toString(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          providerId,
          content: selectedConversion.content,
          confirmed: true,
          timeZone,
        }),
      });
      const data = await res.json();
      if (res.ok && data.success !== false) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setCalendarExportSuccess(prev => new Set(prev).add(providerId));
        if (data.urls && data.urls.length > 0) {
          for (const url of data.urls) {
            handleOpenCalendarUrl(url);
          }
        }
      } else {
        Alert.alert(t("common.error"), data.error || t("detail.failedCalendar"));
      }
    } catch (err) {
      Alert.alert(t("common.error"), t("detail.failedCalendar"));
    } finally {
      setCalendarExportingId(null);
    }
  };

  const handleDownloadIcs = async () => {
    if (!selectedConversion) return;
    setDownloadingIcs(true);
    try {
      const baseUrl = getApiUrl();
      const res = await authExpoFetch(new URL("/api/generate-ics", baseUrl).toString(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ content: selectedConversion.content }),
      });
      const icsText = await res.text();
      await saveFile({
        fileName: "event.ics",
        mimeType: "text/calendar",
        text: icsText,
        dialogTitle: t("detail.addToCalendar"),
      }, "ics");
    } catch (err) {
      Alert.alert(t("common.error"), t("detail.failedCalendar"));
    } finally {
      setDownloadingIcs(false);
    }
  };

  const handleOpenCalendarUrl = async (url: string) => {
    if (Platform.OS === "web") {
      window.open(url, "_blank");
    } else {
      await Linking.openURL(url);
    }
  };

  const handleSaveToFiles = async (conversion: Conversion) => {
    if (!user || !recording) return;
    try {
      const fileName = `${recording.title} - ${conversion.label}`;
      const baseUrl = getApiUrl();
      const res = await authFetch(new URL("/api/files", baseUrl).toString(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          name: fileName,
          content: conversion.content,
          conversionType: conversion.label,
          sourceRecordingId: recording.id,
        }),
      });
      if (res.ok) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        if (Platform.OS === "web") {
          alert(t("files.savedToFiles"));
        } else {
          Alert.alert(t("files.savedToFiles"), fileName);
        }
      } else {
        const data = await res.json();
        Alert.alert(t("common.error"), data.error || t("common.somethingWentWrong"));
      }
    } catch (err) {
      Alert.alert(t("common.error"), t("common.somethingWentWrong"));
    }
  };



  const showDownloadToast = (fileName: string, messageKey = "detail.fileSaved") => {
    if (downloadToastTimer.current) clearTimeout(downloadToastTimer.current);
    setDownloadToast({ fileName, messageKey });
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    downloadToastTimer.current = setTimeout(() => {
      setDownloadToast(null);
    }, 5000);
  };

  /**
   * A failed download must never be silent (issue #190): the user tapped an
   * icon and is owed an outcome either way.
   */
  const notifyDownloadFailed = () => {
    if (Platform.OS === "web") {
      alert(t("detail.exportFailed"));
    } else {
      Alert.alert(t("detail.exportFailedTitle"), t("detail.exportFailed"));
    }
  };

  const handleExportWithFormat = async (format: string) => {
    if (!exportTarget) return;
    const { conversion, action } = exportTarget;
    setExportTarget(null);

    try {
      const baseName = conversion.label.replace(/\s+/g, "_");
      const formatInfo = EXPORT_FORMATS.find((f) => f.value === format);
      if (!formatInfo) return;
      const fullName = `${baseName}.${formatInfo.ext}`;

      // pdf/docx/xlsx are rendered server-side; txt/md/csv are built locally.
      const generatorPath =
        format === "pdf" ? "/api/generate-pdf" :
        format === "docx" ? "/api/generate-docx" :
        format === "xlsx" ? "/api/generate-xlsx" :
        null;

      let blob: Blob | undefined;
      let base64: string | undefined;
      let text: string | undefined;

      if (generatorPath) {
        const res = await authExpoFetch(new URL(generatorPath, getApiUrl()).toString(), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: conversion.content, title: baseName }),
        });
        if (!res.ok) throw new Error(`Failed to generate ${formatInfo.ext}`);
        if (Platform.OS === "web") {
          blob = await res.blob();
        } else {
          base64 = arrayBufferToBase64(await res.arrayBuffer());
        }
      } else {
        text = conversion.content;
        if (Platform.OS === "web") {
          blob = new Blob([text], { type: formatInfo.mimeType });
        }
      }

      const dialogTitle = `${action === "share" ? t("common.share") : t("common.save")} ${conversion.label}`;

      // Web share uses the Web Share API and falls back to a download.
      if (action === "share" && Platform.OS === "web" && blob) {
        try {
          const shared = await triggerWebShare(blob, fullName, formatInfo.mimeType);
          if (shared) return;
        } catch (err: any) {
          if (err?.name === "NotAllowedError") {
            setPendingWebShare({ blob, fileName: fullName, mimeType: formatInfo.mimeType });
            return;
          }
        }
      }

      await saveFile({
        fileName: fullName,
        mimeType: formatInfo.mimeType,
        text,
        base64,
        blob,
        intent: action === "share" ? "share" : "auto",
        dialogTitle,
      }, `export-${conversion.id}`);
    } catch (err) {
      console.error("Export error:", err);
      if (Platform.OS === "web") {
        alert(t("detail.exportFailed"));
      } else {
        Alert.alert(t("common.error"), t("detail.exportFailed"));
      }
    }
  };

  const handleShareTranscript = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      if (Platform.OS === "web") {
        const blob = new Blob([effectiveTranscript], { type: "text/plain" });
        const safeName = recording.title.replace(/[^a-zA-Z0-9]/g, "_");
        const fileName = `${safeName}_transcript.txt`;
        try {
          const shared = await triggerWebShare(blob, fileName, "text/plain");
          if (shared) return;
        } catch (err: any) {
          if (err?.name === "NotAllowedError") {
            setPendingWebShare({ blob, fileName, mimeType: "text/plain" });
            return;
          }
        }
        triggerWebDownload(blob, fileName);
        showDownloadToast(fileName);
        return;
      }

      const fileName = `transcript_${Date.now()}.txt`;
      const filePath = `${FileSystem.cacheDirectory}${fileName}`;
      await FileSystem.writeAsStringAsync(filePath, effectiveTranscript);

      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(filePath, {
          mimeType: "text/plain",
          dialogTitle: t("detail.shareTranscript"),
        });
      }
    } catch (err) {
      console.error("Share transcript error:", err);
    }
  };

  const handleDownloadTranscript = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const safeName = recording.title.replace(/[^a-zA-Z0-9]/g, "_");
    const fileName = `${safeName}_transcript.txt`;
    try {
      await saveFile({
        fileName,
        mimeType: "text/plain",
        text: effectiveTranscript,
        dialogTitle: t("detail.saveTranscript"),
      }, "transcript");
    } catch (err) {
      console.error("Download transcript error:", err);
      notifyDownloadFailed();
    }
  };

  const handleCopyTranscript = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      if (Platform.OS === "web") {
        if (navigator.clipboard) {
          await navigator.clipboard.writeText(effectiveTranscript);
          alert(t("detail.transcriptCopied"));
        }
      } else {
        await Share.share({ message: effectiveTranscript });
      }
    } catch (err) {
      console.error("Copy transcript error:", err);
    }
  };

  const handleShareRecording = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      if (!recording.audioUri) {
        if (Platform.OS === "web") {
          alert(t("detail.audioNotAvailable") || "Audio file is not available for this recording.");
        } else {
          Alert.alert(t("common.error"), t("detail.audioNotAvailable") || "Audio file is not available for this recording.");
        }
        return;
      }
      if (Platform.OS === "web") {
        const safeName = recording.title.replace(/[^a-zA-Z0-9]/g, "_");
        const isBlob = recording.audioUri.startsWith("blob:") || recording.audioUri.startsWith("data:");
        const fetchUri = resolveBucketUri(recording.audioUri);
        const res = await fetch(fetchUri, { credentials: "include" });
        const blob = await res.blob();
        const ext = isBlob ? "webm" : "m4a";
        const mimeType = isBlob ? "audio/webm" : "audio/mp4";
        const audioFile = `${safeName}.${ext}`;
        try {
          const shared = await triggerWebShare(blob, audioFile, mimeType);
          if (shared) return;
        } catch (err: any) {
          if (err?.name === "NotAllowedError") {
            setPendingWebShare({ blob, fileName: audioFile, mimeType });
            return;
          }
        }
        triggerWebDownload(blob, audioFile);
        showDownloadToast(audioFile);
        return;
      }

      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(recording.audioUri, {
          mimeType: "audio/*",
          dialogTitle: t("detail.shareRecording"),
        });
      }
    } catch (err) {
      console.error("Share recording error:", err);
      if (Platform.OS === "web") {
        alert(t("detail.audioNotAvailable") || "Could not share audio file.");
      }
    }
  };

  const handleDownloadRecording = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      if (!recording.audioUri) {
        if (Platform.OS === "web") {
          alert(t("detail.audioNotAvailable") || "Audio file is not available for this recording.");
        } else {
          Alert.alert(t("common.error"), t("detail.audioNotAvailable") || "Audio file is not available for this recording.");
        }
        return;
      }
      const safeName = recording.title.replace(/[^a-zA-Z0-9]/g, "_");
      const isBlob = recording.audioUri.startsWith("blob:") || recording.audioUri.startsWith("data:");
      const ext = isBlob ? "webm" : "m4a";
      const mimeType = isBlob ? "audio/webm" : "audio/mp4";
      const audioFile = `${safeName}.${ext}`;

      if (Platform.OS === "web") {
        const res = await fetch(resolveBucketUri(recording.audioUri), { credentials: "include" });
        const blob = await res.blob();
        await saveFile({ fileName: audioFile, mimeType, blob }, "recording");
        return;
      }

      // Local recordings are copied straight out; uploaded ones stream from the
      // bucket to disk so long recordings never sit in JS memory.
      const local = isLocalFileUri(recording.audioUri);
      await saveFile({
        fileName: audioFile,
        mimeType,
        fileUri: local ? recording.audioUri : undefined,
        remoteUrl: local ? undefined : resolveBucketUri(recording.audioUri),
        headers: getAuthHeaders(),
        dialogTitle: t("detail.saveRecording"),
      }, "recording");
    } catch (err) {
      console.error("Download recording error:", err);
      if (Platform.OS === "web") {
        alert(t("detail.audioNotAvailable") || "Could not download audio file.");
      } else {
        notifyDownloadFailed();
      }
    }
  };

  const handleDeleteRecording = () => {
    const doDelete = () => {
      if (soundRef.current) {
        soundRef.current.unloadAsync();
      }
      deleteRecording(recording.id);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.replace("/");
    };

    if (Platform.OS === "web") {
      if (confirm(t("detail.deleteRecording"))) doDelete();
    } else {
      Alert.alert(t("detail.deleteRecording"), t("detail.deleteRecordingMsg"), [
        { text: t("common.cancel"), style: "cancel" },
        { text: t("common.delete"), style: "destructive", onPress: doDelete },
      ]);
    }
  };

  const handleBackPress = () => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace("/");
  };

  const handleContinueThought = async () => {
    if (!recording || continuingThought) return;
    if (!isCloudSyncEnabled) {
      const title = t("thread.requiresCloudSync" as any);
      const message = t("thread.requiresCloudSyncHelp" as any);
      if (Platform.OS === "web") alert(`${title}: ${message}`);
      else Alert.alert(title, message);
      return;
    }
    setContinuingThought(true);
    try {
      const result = await continueThoughtFromRecording(recording.id);
      if (result.requiresChoice) {
        setThoughtThreadChoices(result.threads);
      } else {
        router.push({
          pathname: "/thought-thread/[id]" as any,
          params: { id: result.thread.id },
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not continue this thought.";
      if (Platform.OS === "web") alert(message);
      else Alert.alert("Thought Thread", message);
    } finally {
      setContinuingThought(false);
    }
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top + webTopInset }]}>
      <View style={[styles.topBar, { maxWidth: layout.contentMaxWidth, alignSelf: "center", width: "100%", paddingHorizontal: layout.contentPadding }]}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <Pressable
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              setDrawerVisible(true);
            }}
            style={styles.iconBtn}
            hitSlop={12}
            accessibilityLabel={t("drawer.openMenu")}
            accessibilityRole="button"
            testID="hamburger-menu"
          >
            <Feather name="menu" size={22} color={Colors.textSecondary} />
          </Pressable>
          <Pressable onPress={handleBackPress} style={styles.iconBtn} hitSlop={12} accessibilityLabel={t("a11y.goBack")} accessibilityRole="button">
            <Feather name="arrow-left" size={22} color={Colors.text} />
          </Pressable>
        </View>
        <View style={styles.topBarActions}>
          <Pressable onPress={handleDeleteRecording} style={styles.iconBtn} hitSlop={12} accessibilityLabel={t("a11y.deleteRecording")} accessibilityRole="button" accessibilityHint={t("a11y.permanentlyRemovesRecording")}>
            <Feather name="trash-2" size={20} color={Colors.error} />
          </Pressable>
          {!isTextEntry && (
          <Pressable
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push("/recordings"); }}
            style={styles.iconBtn}
            hitSlop={8}
            accessibilityLabel={t("app.recordings")}
            accessibilityRole="button"
            testID="recordings-button"
          >
            <Feather name="list" size={20} color={Colors.textSecondary} />
          </Pressable>
          )}
          <Pressable
              style={({ pressed }) => [styles.headerAvatar, pressed && { opacity: 0.7 }]}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setShowProfileMenu((prev) => !prev);
              }}
              accessibilityLabel={t("a11y.settings")}
              accessibilityRole="button"
            >
              {user?.avatarId ? (
                <AvatarView avatarId={user.avatarId} size={72} />
              ) : (
                <Text style={styles.headerAvatarText}>{(user?.firstName || user?.email || "?")[0].toUpperCase()}</Text>
              )}
            </Pressable>
        </View>
      </View>

      <ProfileDropdown visible={showProfileMenu} onClose={() => setShowProfileMenu(false)} />

      <ScrollView
        style={styles.scrollView}
        ref={detailScrollRef}
        onScroll={(event) => { detailScrollOffsetRef.current = event.nativeEvent.contentOffset.y; }}
        scrollEventThrottle={16}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[styles.scrollContent, { paddingBottom: keyboardScrollPadding(insets.bottom + (Platform.OS === "web" ? 34 : 24), keyboardHeight), maxWidth: layout.contentMaxWidth, alignSelf: "center", width: "100%", paddingHorizontal: layout.contentPadding }]}
        showsVerticalScrollIndicator={false}
      >
        <Text style={[styles.title, { fontSize: ts.heading2 }]} accessibilityRole="header">{recording.title}</Text>

        <View style={styles.tabBar} testID="detail-tab-bar">
          <Pressable
            style={[styles.tabItem, detailTab === "recording" && styles.tabItemActive]}
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setDetailTab("recording"); }}
            accessibilityRole="tab"
            accessibilityState={{ selected: detailTab === "recording" }}
            testID="tab-recording"
          >
            <Feather name={isTextEntry ? "edit-3" : "mic"} size={15} color={detailTab === "recording" ? Colors.primary : Colors.textMuted} />
            <Text style={[styles.tabLabel, detailTab === "recording" && styles.tabLabelActive]}>
              {isTextEntry ? t("detail.text") : t("detail.transcript")}
            </Text>
          </Pressable>
          <Pressable
            style={[styles.tabItem, detailTab === "conversions" && styles.tabItemActive]}
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setDetailTab("conversions"); }}
            accessibilityRole="tab"
            accessibilityState={{ selected: detailTab === "conversions" }}
            testID="tab-conversions"
          >
            <Feather name="layers" size={15} color={detailTab === "conversions" ? Colors.primary : Colors.textMuted} />
            <Text style={[styles.tabLabel, detailTab === "conversions" && styles.tabLabelActive]}>
              {t("detail.conversions")} {recording.conversions.length > 0 ? `(${recording.conversions.length})` : ""}
            </Text>
          </Pressable>
        </View>

        {detailTab === "recording" && !isTextEntry && (
          <>
            <View style={styles.playerCard}>
              <Pressable onPress={playAudio} style={styles.playBtn} accessibilityLabel={isPlaying ? t("a11y.pauseRecording") : t("a11y.playRecording")} accessibilityRole="button" accessibilityHint={t("a11y.playOrPauseAudio")}>
                <Feather name={isPlaying ? "pause" : "play"} size={24} color={Colors.white} />
              </Pressable>
              <View style={styles.playerInfo}>
                <View style={styles.waveformPlaceholder}>
                  {Array.from({ length: 30 }).map((_, i) => (
                    <View
                      key={i}
                      style={[
                        styles.waveBar,
                        {
                          height: 8 + Math.sin(i * 0.7) * 12 + Math.random() * 6,
                          backgroundColor:
                            playbackPosition > 0 && i / 30 < playbackPosition / recording.duration
                              ? Colors.primary
                              : Colors.surfaceHighlight,
                        },
                      ]}
                    />
                  ))}
                </View>
                <View style={styles.playerBottom}>
                  <Text style={[styles.playerDuration, { fontSize: ts.caption }]}>
                    {formatDuration(isPlaying ? playbackPosition : 0)} / {formatDuration(recording.duration)}
                  </Text>
                  <View style={styles.playerActions}>
                    <Pressable onPress={handleShareRecording} hitSlop={8} style={styles.playerActionBtn} accessibilityLabel={t("common.share")} accessibilityRole="button">
                      <Feather name="share" size={16} color={Colors.textSecondary} />
                    </Pressable>
                    <Pressable onPress={handleDownloadRecording} disabled={savingFileId === "recording"} hitSlop={8} style={styles.playerActionBtn} accessibilityLabel={savingFileId === "recording" ? t("detail.preparingDownload") : t("a11y.downloadRecording")} accessibilityRole="button" accessibilityState={{ busy: savingFileId === "recording" }}>
                      {savingFileId === "recording" ? (
                        <ActivityIndicator size="small" color={Colors.textSecondary} />
                      ) : (
                        <Feather name="download" size={16} color={Colors.textSecondary} />
                      )}
                    </Pressable>
                  </View>
                </View>
              </View>
            </View>

            <View style={[styles.detailActionRow, { maxWidth: layout.contentMaxWidth, alignSelf: "center", width: "100%", paddingHorizontal: layout.contentPadding }]}>
              {user ? (
                <Pressable
                  onPress={handleContinueThought}
                  disabled={continuingThought}
                  style={({ pressed }) => [styles.detailActionBtn, (pressed || continuingThought) && { opacity: 0.7 }]}
                  accessibilityRole="button"
                  accessibilityLabel={t("thread.continueThought")}
                  testID="continue-thought-button"
                >
                  {continuingThought
                    ? <ActivityIndicator size="small" color="#fff" />
                    : <Feather name="cloud" size={28} color="#fff" />}
                </Pressable>
              ) : null}
              <Pressable
                onPress={() => setShowConvertMenu(true)}
                style={({ pressed }) => [styles.detailActionBtn, !!convertingType && { opacity: 0.4 }, pressed && { opacity: 0.7 }]}
                disabled={Boolean(convertingType)}
                accessibilityRole="button"
                accessibilityLabel={t("detail.convertTranscript")}
                testID="convert-action-button"
              >
                <Feather name="plus" size={28} color="#fff" />
              </Pressable>
            </View>
            <View style={styles.sectionHeader}>
              <Text style={[styles.sectionTitle, { fontSize: ts.heading3 }]} accessibilityRole="header">{t("detail.transcript")}</Text>
              {recording.transcript ? (
                <View style={styles.transcriptActions}>
                  <Pressable onPress={handleCopyTranscript} hitSlop={8} style={styles.transcriptActionBtn} accessibilityLabel={t("a11y.copyTranscript")} accessibilityRole="button">
                    <Feather name="copy" size={16} color={Colors.textSecondary} />
                  </Pressable>
                  <Pressable onPress={handleShareTranscript} hitSlop={8} style={styles.transcriptActionBtn} accessibilityLabel={t("a11y.shareTranscript")} accessibilityRole="button">
                    <Feather name="share" size={16} color={Colors.textSecondary} />
                  </Pressable>
                  <Pressable onPress={handleDownloadTranscript} disabled={savingFileId === "transcript"} hitSlop={8} style={styles.transcriptActionBtn} accessibilityLabel={savingFileId === "transcript" ? t("detail.preparingDownload") : t("a11y.downloadTranscript")} accessibilityRole="button" accessibilityState={{ busy: savingFileId === "transcript" }}>
                    {savingFileId === "transcript" ? (
                      <ActivityIndicator size="small" color={Colors.textSecondary} />
                    ) : (
                      <Feather name="download" size={16} color={Colors.textSecondary} />
                    )}
                  </Pressable>
                  <Pressable onPress={() => retryTranscription()} disabled={retryingTranscription} hitSlop={8} style={styles.transcriptActionBtn} accessibilityLabel={t("detail.retryTranscription")} accessibilityRole="button">
                    <Feather name="refresh-cw" size={16} color={Colors.primary} />
                  </Pressable>
                </View>
              ) : null}
            </View>

            {isUploading ? (
              <View style={styles.transcribingCard} accessibilityLiveRegion="polite">
                <ProcessingAnimation
                  kind="transcription"
                  size={64}
                  accessibilityLabel={Platform.OS === "web" && uploadProgress !== null
                    ? t("detail.uploadingProgress" as any, { progress: uploadProgress })
                    : t("detail.uploading" as any)}
                  testID="upload-processing-animation"
                />
                <View style={{ flex: 1, marginLeft: 10 }}>
                  <Text style={styles.transcribingLabel}>
                    {Platform.OS === "web" && uploadProgress !== null
                      ? t("detail.uploadingProgress" as any, { progress: uploadProgress })
                      : t("detail.uploading" as any)}
                  </Text>
                  {Platform.OS === "web" && uploadProgress !== null && (
                    <View style={{ height: 3, backgroundColor: "rgba(139, 92, 246, 0.2)", borderRadius: 2, marginTop: 4, overflow: "hidden" }}>
                      <View style={{ height: "100%", width: `${uploadProgress}%`, backgroundColor: "#8B5CF6", borderRadius: 2 }} />
                    </View>
                  )}
                </View>
              </View>
            ) : recording.isTranscribing && !previewText ? (
              <View style={styles.transcribingCard} accessibilityLiveRegion="polite">
                <ProcessingAnimation
                  kind="transcription"
                  size={72}
                  accessibilityLabel={t("detail.transcribing")}
                  testID="transcription-processing-animation"
                />
                <Text style={styles.transcribingLabel}>{t("detail.transcribing")}</Text>
              </View>
            ) : previewText || (recording.transcript && !recording.transcript.startsWith("[Transcription failed")) ? (
              <View style={styles.transcriptCard}>
                {recording.isTranscribing && previewText && (
                  <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 8, flexWrap: "wrap" }}>
                    <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: Colors.primary, marginRight: 6 }} />
                    <Text style={[styles.transcribingLabel, { color: Colors.primary, fontSize: 11 }]}>
                      {t("detail.previewFinalizing" as any)}
                    </Text>
                  </View>
                )}
                <View>
                  <Text
                    style={styles.transcriptText}
                    numberOfLines={transcriptExpanded ? undefined : 2}
                    ellipsizeMode="tail"
                    testID="recording-transcript"
                  >
                    {liveTranscript ?? transcriptToShow}
                  </Text>
                  {/* Hidden measurer: full text, no truncation, so onTextLayout
                      reports the TRUE line count. Same width as the visible
                      text (both inside this padding-free wrapper). */}
                  <Text
                    style={[styles.transcriptText, styles.transcriptMeasurer]}
                    onTextLayout={handleTranscriptLayout}
                    accessibilityElementsHidden
                    importantForAccessibility="no-hide-descendants"
                    aria-hidden
                  >
                    {transcriptToShow}
                  </Text>
                </View>
                {transcriptLineCount !== null && transcriptLineCount > 2 && (
                  <Pressable
                    onPress={() => setTranscriptExpanded((value) => !value)}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel={
                      transcriptExpanded ? t("detail.transcriptShowLess") : t("detail.transcriptReadMore")
                    }
                    style={styles.readMoreButton}
                    testID="transcript-read-more"
                  >
                    <Text style={styles.readMoreText}>
                      {transcriptExpanded ? t("detail.transcriptShowLess") : t("detail.transcriptReadMore")}
                    </Text>
                  </Pressable>
                )}
              </View>
            ) : (
              <View style={styles.transcriptCard}>
                <Text style={styles.noTranscriptText} accessibilityRole="alert">
                  {transferErrorMessage}
                </Text>
                {recording.audioUri
                  && !(recording.uploadStatus === "failed" && recording.uploadRetryable === false)
                  && !(recording.transcriptionStatus === "failed" && recording.transcriptionRetryable === false) ? (
                  <View style={{ alignItems: "center" }}>
                    <Pressable
                      onPress={() => {
                        if (recording.uploadStatus === "failed") {
                          void retryUpload();
                        } else {
                          void retryTranscription();
                        }
                      }}
                      disabled={retryingTranscription}
                      style={{ marginTop: 12, width: 44, height: 44, borderRadius: 22, backgroundColor: "rgba(0, 180, 216, 0.12)", alignItems: "center", justifyContent: "center" }}
                      accessibilityRole="button"
                      accessibilityLabel={recording.uploadStatus === "failed"
                        ? t("detail.retryUpload" as any)
                        : t("detail.retryTranscription" as any)}
                    >
                      {retryingTranscription ? (
                        <ActivityIndicator size="small" color={Colors.primary} />
                      ) : (
                        <Feather name="refresh-cw" size={18} color={Colors.primary} />
                      )}
                    </Pressable>
                    {recording.transcriptionError
                      || recording.transcriptionErrorCode
                      || recording.uploadErrorCode ? (
                      <Pressable
                        onPress={() => openFeedback?.()}
                        style={{ marginTop: 8, paddingVertical: 6, paddingHorizontal: 12 }}
                        accessibilityRole="button"
                        accessibilityLabel={t("detail.reportIssue" as any)}
                      >
                        <Text style={{ color: Colors.textMuted, fontSize: 12, textDecorationLine: "underline" }}>
                          {t("detail.reportIssue" as any)}
                        </Text>
                      </Pressable>
                    ) : null}
                  </View>
                ) : !recording.audioUri ? (
                  <View style={{ alignItems: "center", marginTop: 12 }}>
                    <Feather name="alert-triangle" size={18} color={Colors.textMuted} />
                    <Text style={[styles.noTranscriptText, { marginTop: 8, textAlign: "center" }]}>
                      {t("detail.audioUnavailable" as any) || "Audio is no longer available for this recording."}
                    </Text>
                  </View>
                ) : null}
              </View>
            )}
          </>
        )}

        {detailTab === "recording" && !recording.isTranscribing ? (
          <>
            {isTextEntry ? (
              <View style={styles.sectionHeader}>
                {effectiveTranscript ? (
                  <View style={styles.transcriptActions}>
                    <Pressable onPress={handleCopyTranscript} hitSlop={8} style={styles.transcriptActionBtn} accessibilityLabel={t("a11y.copyTranscript")} accessibilityRole="button">
                      <Feather name="copy" size={16} color={Colors.textSecondary} />
                    </Pressable>
                    <Pressable onPress={handleShareTranscript} hitSlop={8} style={styles.transcriptActionBtn} accessibilityLabel={t("a11y.shareTranscript")} accessibilityRole="button">
                      <Feather name="share" size={16} color={Colors.textSecondary} />
                    </Pressable>
                    <Pressable onPress={handleDownloadTranscript} disabled={savingFileId === "transcript"} hitSlop={8} style={styles.transcriptActionBtn} accessibilityLabel={savingFileId === "transcript" ? t("detail.preparingDownload") : t("a11y.downloadTranscript")} accessibilityRole="button" accessibilityState={{ busy: savingFileId === "transcript" }}>
                      {savingFileId === "transcript" ? (
                        <ActivityIndicator size="small" color={Colors.textSecondary} />
                      ) : (
                        <Feather name="download" size={16} color={Colors.textSecondary} />
                      )}
                    </Pressable>
                  </View>
                ) : null}
              </View>
            ) : (
              <View style={styles.sectionHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.sectionTitle, { fontSize: ts.heading3 }]} accessibilityRole="header">{t("detail.additionalContext" as any)}</Text>
                </View>
              </View>
            )}

            {/* Logo for text mode — same size and placement as on recordings transcript page */}
            {isTextEntry && (
              <View style={{ alignItems: "center", paddingTop: 12, paddingBottom: 20 }}>
                <Pressable
                  onPress={() => setShowConvertMenu(true)}
                  disabled={Boolean(convertingType)}
                  accessibilityLabel={t("detail.convertTranscript")}
                  accessibilityRole="button"
                  hitSlop={8}
                  style={({ pressed }) => [{
                    width: 72,
                    height: 72,
                    borderRadius: 16,
                    backgroundColor: Colors.surface,
                    alignItems: "center",
                    justifyContent: "center",
                    opacity: convertingType ? 0.4 : pressed ? 0.7 : 1,
                  }]}
                >
                  <Image
                    source={logoTransparent}
                    style={{ width: 56, height: 56 }}
                    resizeMode="contain"
                  />
                </Pressable>
              </View>
            )}

            <View style={styles.customTextCard} ref={customTextCardRef}>
              <TextInput
                style={[styles.customTextInput]}
                placeholder={isTextEntry
                  ? t("detail.customTextPlaceholder")
                  : ""}
                placeholderTextColor={Colors.textMuted}
                multiline
                value={customText}
                onFocus={() => {
                  customTextFocusedRef.current = true;
                  revealFieldAboveKeyboard({
                    scroll: detailScrollRef.current,
                    field: customTextCardRef.current,
                    windowHeight,
                    keyboardHeight,
                    currentOffset: detailScrollOffsetRef.current,
                  });
                }}
                onBlur={() => { customTextFocusedRef.current = false; }}
                onChangeText={(text) => {
                  if (text.length > MAX_CUSTOM_TEXT) {
                    setCustomText(text.slice(0, MAX_CUSTOM_TEXT));
                  } else {
                    setCustomText(text);
                  }
                }}
                textAlignVertical="top"
                accessibilityLabel={t("detail.customText")}
                maxLength={MAX_CUSTOM_TEXT}
              />
              <View style={styles.customTextCountRow}>
                {isTextEntry && customText.trim().length < MIN_CUSTOM_TEXT && sourceAttachments.length === 0 ? (
                  <Text style={[styles.customTextCount, { color: customText.trim().length > 0 ? Colors.warning || "#F59E0B" : Colors.textMuted }]}>
                    {customText.trim().length.toLocaleString()} / {MIN_CUSTOM_TEXT.toLocaleString()}
                  </Text>
                ) : (
                  <Text style={[styles.customTextCount, customText.length >= MAX_CUSTOM_TEXT ? { color: Colors.error || "#EF4444" } : customText.length >= MAX_CUSTOM_TEXT * 0.9 ? { color: Colors.warning || "#F59E0B" } : {}]}>
                    {customText.length.toLocaleString()} / {MAX_CUSTOM_TEXT.toLocaleString()}
                  </Text>
                )}
                {!isTextEntry && contextSaveState !== "idle" ? (
                  <Text
                    style={[
                      styles.customTextCount,
                      contextSaveState === "error" || contextSaveState === "offline"
                        ? { color: Colors.warning || "#F59E0B" }
                        : {},
                    ]}
                    accessibilityLiveRegion="polite"
                  >
                    {contextSaveState === "loading"
                      ? t("detail.contextLoading" as any)
                      : contextSaveState === "saving"
                        ? t("detail.contextSaving" as any)
                        : contextSaveState === "offline"
                          ? t("detail.contextSavedOffline" as any)
                          : contextSaveState === "error"
                            ? t("detail.contextSaveFailed" as any)
                            : t("detail.contextSaved" as any)}
                  </Text>
                ) : null}
              </View>
              {sourceTextTooShort && customText.trim().length > 0 && (
                <Text style={styles.customTextMinHint}>
                  {t("detail.charsNeeded" as any, { count: MIN_CUSTOM_TEXT - sourceContentLength })}
                </Text>
              )}
              {customText.length >= MAX_CUSTOM_TEXT && (
                <Text style={styles.customTextMaxWarning}>
                  {t("detail.charLimitReached" as any)}
                </Text>
              )}
            </View>

            {sourceAttachments.length > 0 && (
              <View style={styles.sourceAttachmentList}>
                {sourceAttachments.map((attachment) => (
                  <View key={attachment.id} style={styles.sourceAttachmentChip}>
                    <Feather name="paperclip" size={14} color={Colors.primary} />
                    <Pressable
                      style={styles.sourceAttachmentEditTarget}
                      onPress={() => setEditingSourceAttachment({ ...attachment })}
                      accessibilityRole="button"
                      accessibilityLabel={`${t("detail.editFileContext")}: ${attachment.name}`}
                    >
                      <Text style={styles.sourceAttachmentName} numberOfLines={1}>
                        {attachment.name}
                      </Text>
                      <Feather name="edit-3" size={14} color={Colors.primary} />
                    </Pressable>
                    {attachment.sourceBucketFileId ? (
                      <Pressable
                        onPress={() => { void openSourceOriginal(attachment); }}
                        style={styles.sourceAttachmentAction}
                        accessibilityLabel={t("detail.openRetainedOriginal" as any, { name: attachment.name })}
                        accessibilityHint={t("detail.openRetainedOriginalHint" as any)}
                        accessibilityRole="button"
                      >
                        <Feather name="external-link" size={16} color={Colors.primary} />
                      </Pressable>
                    ) : null}
                    <Pressable
                      onPress={() => { void removeSourceAttachment(attachment); }}
                      style={styles.sourceAttachmentAction}
                      accessibilityLabel={t("detail.removeFile" as any, { name: attachment.name })}
                      accessibilityHint={t("detail.removeFileContextHint" as any)}
                      accessibilityRole="button"
                    >
                      <Feather name="x" size={15} color={Colors.textMuted} />
                    </Pressable>
                  </View>
                ))}
              </View>
            )}

            <Pressable
              style={[styles.uploadIconButton, { paddingVertical: 14, paddingHorizontal: 18 }]}
              onPress={() => {
                if (Platform.OS === "web") {
                  fileInputRef.current?.click();
                } else {
                  import("@/lib/document-picker").then((DocumentPicker) => {
                    DocumentPicker.getDocumentAsync({
                      type: [
                        "text/plain",
                        "text/markdown",
                        "text/csv",
                        "image/png",
                        "image/jpeg",
                        "image/webp",
                        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                        "application/pdf",
                        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                      ],
                      copyToCacheDirectory: true,
                    }).then((result) => {
                      if (!result.canceled && result.assets?.[0]) {
                        const asset = result.assets[0];
                        handleFileImport({ uri: asset.uri, name: asset.name, mimeType: asset.mimeType || "" });
                      }
                    });
                  });
                }
              }}
              accessibilityLabel={t("detail.importFile")}
              disabled={importingFile}
            >
              {importingFile ? (
                <ActivityIndicator size="small" color={Colors.primary} />
              ) : (
                <>
                  <Feather name="paperclip" size={18} color={Colors.primary} />
                  <Text style={styles.uploadContextLabel}>{t("detail.addFiles" as any)}</Text>
                </>
              )}
            </Pressable>

            {Platform.OS === "web" && (
              <input
                ref={fileInputRef as any}
                type="file"
                accept=".txt,.md,.docx,.pdf,.csv,.xlsx,.png,.jpg,.jpeg,.webp"
                style={{ display: "none" }}
                onChange={(e: any) => {
                  const file = e.target?.files?.[0];
                  if (file) {
                    handleFileImport(file);
                    e.target.value = "";
                  }
                }}
              />
            )}
          </>
        ) : null}

        {detailTab === "conversions" && !recording.isTranscribing ? (
          <>
            <View style={styles.sectionHeader}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flex: 1 }}>
                <Text style={[styles.sectionTitle, { fontSize: ts.heading3 }]} accessibilityRole="header">{isTextEntry ? t("detail.convertCustom") : t("detail.aiConversions")}</Text>
                {usageSummary && userTier !== "free" && usageSummary.conversions.used >= usageSummary.conversions.limit * 0.8 && usageSummary.conversions.used < usageSummary.conversions.limit && (
                  <View style={{ backgroundColor: "rgba(245, 158, 11, 0.15)", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 }}>
                    <Text style={{ fontSize: ts.caption, fontFamily: "Inter_600SemiBold", color: "#f59e0b" }}>{usageSummary.conversions.used}/{usageSummary.conversions.limit}</Text>
                  </View>
                )}
                {usageSummary && userTier !== "free" && usageSummary.conversions.used >= usageSummary.conversions.limit && (
                  <View style={{ backgroundColor: "rgba(239, 68, 68, 0.15)", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 }}>
                    <Text style={{ fontSize: ts.caption, fontFamily: "Inter_600SemiBold", color: "#ef4444" }}>Overage</Text>
                  </View>
                )}
              </View>
              <Pressable
                onPress={() => {
                  if (!sourceText) {
                    const msg = isTextEntry ? t("detail.enterTextFirst") : t("detail.noTranscriptAvailable");
                    const title = isTextEntry ? t("detail.noText") : t("detail.noTranscript");
                    if (Platform.OS === "web") {
                      alert(msg);
                    } else {
                      Alert.alert(title, isTextEntry ? msg : t("detail.noTranscriptMsg"));
                    }
                    return;
                  }
                  if (sourceTextTooShort) {
                    const msg = t("detail.minCharsRequired" as any, { min: MIN_CUSTOM_TEXT, current: sourceContentLength });
                    if (Platform.OS === "web") {
                      alert(msg);
                    } else {
                      Alert.alert(t("detail.noText"), msg);
                    }
                    return;
                  }
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  setShowConvertMenu(true);
                }}
                style={[styles.addConvertBtn, !!convertingType && { opacity: 0.4 }]}
                disabled={!!convertingType}
                accessibilityLabel={t("detail.convertTranscript")}
                accessibilityRole="button"
                accessibilityState={{ disabled: !!convertingType }}
              >
                <Feather name="plus" size={22} color={Colors.white} />
              </Pressable>
            </View>

            {isTextEntry && sourceText ? (
              <View style={styles.sourceReferenceCard}>
                <View style={styles.sourceReferenceHeader}>
                  <View style={styles.sourceReferenceTitleWrap}>
                    <Feather name="file-text" size={15} color={Colors.primary} />
                    <Text style={styles.sourceReferenceTitle}>{t("detail.sourceTextReference" as any)}</Text>
                  </View>
                  <View style={styles.sourceReferenceActions}>
                    <Pressable
                      onPress={() => {
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        setDetailTab("recording");
                      }}
                      hitSlop={8}
                      style={styles.sourceReferenceActionBtn}
                      accessibilityLabel={t("detail.editSourceText" as any)}
                      accessibilityRole="button"
                    >
                      <Feather name="edit-3" size={14} color={Colors.primary} />
                    </Pressable>
                    <Pressable
                      onPress={() => {
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        setSourceReferenceExpanded(!sourceReferenceExpanded);
                      }}
                      hitSlop={8}
                      style={styles.sourceReferenceActionBtn}
                      accessibilityLabel={sourceReferenceExpanded ? t("detail.showLess" as any) : t("detail.showMore" as any)}
                      accessibilityRole="button"
                    >
                      <Feather name={sourceReferenceExpanded ? "chevron-up" : "chevron-down"} size={15} color={Colors.primary} />
                    </Pressable>
                  </View>
                </View>
                <Text style={styles.sourceReferenceText} numberOfLines={sourceReferenceExpanded ? undefined : 4}>
                  {sourceText}
                </Text>
              </View>
            ) : null}

            {convertingType && (
              <View style={styles.convertingCard}>
                <View style={styles.convertingHeader}>
                  <ProcessingAnimation
                    kind="conversion"
                    size={76}
                    accessibilityLabel={t("detail.generating", { type: t(`conversion.${convertingType}` as any) })}
                    testID="conversion-processing-animation"
                  />
                  <View style={{ flex: 1, marginLeft: 12 }}>
                    <Text style={styles.convertingLabel}>
                      {t("detail.generating", { type: t(`conversion.${convertingType}` as any) })}
                    </Text>
                    {conversionStage ? (
                      <>
                        <Text style={styles.conversionStageLabel} accessibilityLiveRegion="polite">
                          {conversionStage}
                        </Text>
                        <Text
                          style={styles.conversionStageVerb}
                          aria-hidden={true}
                          importantForAccessibility="no-hide-descendants"
                        >
                          {cyclingVerb}…
                        </Text>
                      </>
                    ) : null}
                  </View>
                </View>
                {streamingContent ? (
                  <Text style={styles.streamingText} accessibilityLiveRegion="polite">{streamingContent}</Text>
                ) : null}
              </View>
            )}

            {conversionError && !convertingType && (
              <View style={styles.conversionErrorCard} accessibilityLiveRegion="assertive" testID="conversion-error-card">
                <View style={styles.conversionErrorHeader}>
                  <View style={styles.conversionErrorIconWrap}>
                    <Feather name="alert-circle" size={20} color="#EF4444" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.conversionErrorTitle}>
                      {t("detail.conversionFailedTitle" as any) || "Conversion Failed"}
                    </Text>
                    <Text style={styles.conversionErrorMessage}>
                      {conversionError.message}
                    </Text>
                  </View>
                </View>
                <View style={styles.conversionErrorActions}>
                  <Pressable
                    style={styles.conversionRetryBtn}
                    onPress={() => {
                      const { type, citationStyle, bibliographyType, includeWebSources } = conversionError;
                      setConversionError(null);
                      if (type === "slide_deck") {
                        setShowDeckStylePicker(true);
                        return;
                      }
                      runConversion(type, citationStyle, undefined, bibliographyType, undefined, undefined, includeWebSources);
                    }}
                    accessibilityRole="button"
                    testID="conversion-retry-button"
                  >
                    <Feather name="refresh-cw" size={14} color="#FFFFFF" style={{ marginRight: 6 }} />
                    <Text style={styles.conversionRetryBtnText}>
                      {t("common.retry" as any) || "Try Again"}
                    </Text>
                  </Pressable>
                  <Pressable
                    style={styles.conversionDismissBtn}
                    onPress={() => setConversionError(null)}
                    accessibilityRole="button"
                  >
                    <Text style={styles.conversionDismissBtnText}>
                      {t("common.dismiss" as any) || "Dismiss"}
                    </Text>
                  </Pressable>
                </View>
              </View>
            )}

            {recording.conversions.length === 0 && !convertingType ? (
              <View style={styles.emptyConversions}>
                <View style={styles.emptyConversionsIconWrap}>
                  <Feather name="layers" size={24} color={Colors.textMuted} />
                </View>
                <Text style={styles.emptyConversionsHint}>{t("detail.noConversionsYet" as any)}</Text>
              </View>
            ) : (
              recording.conversions.map((conversion) => {
                const displayLabel = conversion.label || CONVERSION_TYPES.find((t) => t.value === conversion.type)?.label || conversion.type;
                const isExpanded = expandedCardId === conversion.id;
                return (
                <Pressable
                  key={conversion.id}
                  style={styles.conversionCard}
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    setSelectedConversion({ ...conversion, label: displayLabel });
                  }}
                  onLongPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                    setExpandedCardId(isExpanded ? null : conversion.id);
                  }}
                  accessibilityLabel={`View ${displayLabel} conversion`}
                  accessibilityRole="button"
                  testID={`conversion-card-${conversion.id}`}
                >
                  <View style={styles.conversionHeader}>
                    <View style={styles.conversionIconWrap}>
                      <ConversionIcon
                        name={CONVERSION_TYPES.find((t) => t.value === conversion.type)?.icon || "file"}
                        size={16}
                        color={Colors.primary}
                      />
                    </View>
                    <Text style={styles.conversionLabel}>{displayLabel}</Text>
                    <Pressable
                      onPress={(e) => {
                        e.stopPropagation?.();
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        setExpandedCardId(isExpanded ? null : conversion.id);
                      }}
                      hitSlop={8}
                      accessibilityLabel={isExpanded ? "Hide actions" : "Show actions"}
                      accessibilityRole="button"
                    >
                      <Feather name={isExpanded ? "x" : "more-horizontal"} size={16} color={Colors.textMuted} />
                    </Pressable>
                    <Feather name="chevron-right" size={16} color={Colors.textMuted} />
                  </View>
                  <Text style={styles.conversionPreview} numberOfLines={3}>
                    {conversion.content}
                  </Text>
                  {isExpanded && (
                    <View style={styles.conversionExpandedActions}>
                      <Pressable
                        onPress={(e) => { e.stopPropagation?.(); handleShareConversion(conversion); }}
                        style={styles.conversionExpandedBtn}
                        accessibilityLabel={`Share ${displayLabel}`}
                        accessibilityRole="button"
                      >
                        <Feather name="share" size={16} color={Colors.primary} />
                      </Pressable>
                      <Pressable
                        onPress={(e) => { e.stopPropagation?.(); handleSaveConversion(conversion); }}
                        disabled={savingFileId === `export-${conversion.id}`}
                        style={styles.conversionExpandedBtn}
                        accessibilityLabel={savingFileId === `export-${conversion.id}` ? t("detail.preparingDownload") : `Save ${displayLabel}`}
                        accessibilityRole="button"
                        accessibilityState={{ busy: savingFileId === `export-${conversion.id}` }}
                      >
                        {savingFileId === `export-${conversion.id}` ? (
                          <ActivityIndicator size="small" color={Colors.primary} />
                        ) : (
                          <Feather name="download" size={16} color={Colors.primary} />
                        )}
                      </Pressable>
                      <Pressable
                        onPress={(e) => {
                          e.stopPropagation?.();
                          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                          if (Platform.OS === "web") {
                            if (confirm(t("detail.deleteConversion"))) {
                              deleteConversion(recording.id, conversion.id);
                            }
                          } else {
                            Alert.alert(t("common.delete"), t("detail.removeConversion"), [
                              { text: t("common.cancel"), style: "cancel" },
                              { text: t("common.delete"), style: "destructive", onPress: () => deleteConversion(recording.id, conversion.id) },
                            ]);
                          }
                        }}
                        style={styles.conversionExpandedBtn}
                        accessibilityLabel={`Delete ${displayLabel}`}
                        accessibilityRole="button"
                      >
                        <Feather name="trash-2" size={16} color={Colors.error} />
                      </Pressable>
                    </View>
                  )}
                </Pressable>
              );})
            )}
          </>
        ) : null}
      </ScrollView>

      <Modal
        visible={thoughtThreadChoices.length > 0}
        transparent
        animationType="fade"
        onRequestClose={() => setThoughtThreadChoices([])}
        accessibilityViewIsModal={true}
      >
        <Pressable
          style={[styles.modalOverlay, !layout.isMobile && styles.modalOverlayCentered]}
          onPress={() => setThoughtThreadChoices([])}
          accessibilityLabel={t("common.close")}
          accessibilityRole="button"
        >
          <Pressable
            style={[styles.menuSheet, styles.thoughtThreadChoiceSheet, !layout.isMobile && styles.menuSheetCentered]}
            onPress={(event) => event.stopPropagation?.()}
          >
            {layout.isMobile ? <View style={styles.menuHandle} /> : null}
            <Text style={styles.menuTitle} accessibilityRole="header">{t("thread.choose")}</Text>
            <Text style={styles.menuSubtitle}>{t("thread.chooseHelp")}</Text>
            <ScrollView
              style={styles.thoughtThreadChoiceScroll}
              contentContainerStyle={styles.thoughtThreadChoiceContent}
            >
              {thoughtThreadChoices.map((thread) => (
                <Pressable
                  key={thread.id}
                  style={({ pressed }) => [styles.thoughtThreadChoiceRow, pressed && styles.menuItemPressed]}
                  onPress={() => {
                    setThoughtThreadChoices([]);
                    router.push({
                      pathname: "/thought-thread/[id]" as any,
                      params: { id: thread.id },
                    });
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`${thread.title}, ${t("thread.choiceMeta", {
                    count: thread.recordingCount,
                    date: new Date(thread.updatedAt).toLocaleDateString(language),
                  })}`}
                >
                  <View style={styles.menuIcon}>
                    <Feather name="git-branch" size={18} color={Colors.primary} />
                  </View>
                  <View style={styles.menuTextColumn}>
                    <Text style={styles.menuLabel} numberOfLines={2}>{thread.title}</Text>
                    <Text style={styles.thoughtThreadChoiceMeta}>
                      {t("thread.choiceMeta", {
                        count: thread.recordingCount,
                        date: new Date(thread.updatedAt).toLocaleDateString(language),
                      })}
                    </Text>
                  </View>
                  <Feather name="chevron-right" size={18} color={Colors.textMuted} />
                </Pressable>
              ))}
            </ScrollView>
            <Pressable
              style={styles.thoughtThreadChoiceCancel}
              onPress={() => setThoughtThreadChoices([])}
              accessibilityRole="button"
            >
              <Text style={styles.thoughtThreadChoiceCancelText}>{t("common.cancel")}</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal
        visible={!!editingSourceAttachment}
        transparent
        animationType="fade"
        onRequestClose={() => setEditingSourceAttachment(null)}
        accessibilityViewIsModal={true}
      >
        <Pressable
          style={[styles.modalOverlay, !layout.isMobile && styles.modalOverlayCentered]}
          onPress={() => setEditingSourceAttachment(null)}
          accessibilityLabel={t("common.close")}
          accessibilityRole="button"
        >
          <Pressable
            style={[styles.menuSheet, styles.fileContextEditorSheet, !layout.isMobile && styles.menuSheetCentered]}
            onPress={(event) => event.stopPropagation?.()}
          >
            {layout.isMobile ? <View style={styles.menuHandle} /> : null}
            <Text style={styles.menuTitle} accessibilityRole="header">{t("detail.editFileContext")}</Text>
            <Text style={styles.fileContextEditorName} numberOfLines={2}>{editingSourceAttachment?.name}</Text>
            <Text style={styles.menuSubtitle}>{t("detail.fileContextHelp")}</Text>
            <TextInput
              value={editingSourceAttachment?.text || ""}
              onChangeText={(text) => setEditingSourceAttachment((current) => current ? { ...current, text } : null)}
              multiline
              textAlignVertical="top"
              style={styles.fileContextEditorInput}
              accessibilityLabel={t("detail.fileContextLabel")}
              maxLength={MAX_SOURCE_ATTACHMENT_TEXT}
            />
            <Text style={styles.fileContextEditorCount}>
              {(editingSourceAttachment?.text.length || 0).toLocaleString()} / {MAX_SOURCE_ATTACHMENT_TEXT.toLocaleString()}
            </Text>
            <View style={styles.fileContextEditorActions}>
              <Pressable
                style={[styles.mdPromptBtn, styles.mdPromptBtnOutline]}
                onPress={() => setEditingSourceAttachment(null)}
              >
                <Text style={styles.mdPromptBtnTextOutline}>{t("common.cancel")}</Text>
              </Pressable>
              <Pressable
                style={[
                  styles.mdPromptBtn,
                  styles.mdPromptBtnFilled,
                  !editingSourceAttachment?.text.trim() && { opacity: 0.45 },
                ]}
                disabled={!editingSourceAttachment?.text.trim()}
                onPress={() => { void saveSourceAttachment(); }}
                accessibilityRole="button"
                accessibilityLabel={t("detail.saveFileContext")}
              >
                <Text style={styles.mdPromptBtnTextFilled}>{t("detail.saveFileContext")}</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal
        visible={!!markdownPrompt}
        transparent
        animationType="fade"
        onRequestClose={() => setMarkdownPrompt(null)}
        accessibilityViewIsModal={true}
      >
        <Pressable style={[styles.modalOverlay, !layout.isMobile && styles.modalOverlayCentered]} onPress={() => setMarkdownPrompt(null)} accessibilityLabel={t("common.close")} accessibilityRole="button">
          <Pressable style={[styles.mdPromptSheet, !layout.isMobile && styles.mdPromptSheetCentered]} onPress={(e) => e.stopPropagation?.()}>
            <Text style={styles.mdPromptTitle} accessibilityRole="header">{t("detail.markdownDetected")}</Text>
            <Text style={styles.mdPromptSubtitle}>{t("detail.markdownQuestion")}</Text>
            <View style={styles.mdPromptButtons}>
              <Pressable
                style={[styles.mdPromptBtn, styles.mdPromptBtnOutline]}
                onPress={() => {
                  if (markdownPrompt) {
                    addSourceAttachment(markdownPrompt.filename, stripMarkdown(markdownPrompt.text));
                  }
                  setMarkdownPrompt(null);
                }}
              >
                <Text style={styles.mdPromptBtnTextOutline}>{t("detail.plainText")}</Text>
              </Pressable>
              <Pressable
                style={[styles.mdPromptBtn, styles.mdPromptBtnFilled]}
                onPress={() => {
                  if (markdownPrompt) {
                    addSourceAttachment(markdownPrompt.filename, markdownPrompt.text);
                  }
                  setMarkdownPrompt(null);
                }}
              >
                <Text style={styles.mdPromptBtnTextFilled}>{t("detail.keepMarkdown")}</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal
        visible={showDeckStylePicker}
        transparent
        animationType="fade"
        onRequestClose={() => setShowDeckStylePicker(false)}
        accessibilityViewIsModal={true}
      >
        <Pressable style={[styles.modalOverlay, !layout.isMobile && styles.modalOverlayCentered]} onPress={() => setShowDeckStylePicker(false)} accessibilityLabel={t("common.close")} accessibilityRole="button">
          <Pressable style={[styles.menuSheet, styles.deckPickerSheet, !layout.isMobile && styles.menuSheetCentered]} onPress={(e) => e.stopPropagation()}>
            <View style={styles.convertMenuHeader}>
              <View style={styles.convertMenuHeaderText}>
                <Text style={[styles.menuTitle, styles.convertMenuTitle]} accessibilityRole="header">
                  {t("deck.chooseLook")}
                </Text>
              </View>
              <Pressable onPress={() => setShowDeckStylePicker(false)} style={styles.convertMenuCloseBtn} accessibilityLabel={t("common.close")} accessibilityRole="button">
                <Feather name="x" size={22} color={Colors.textSecondary} />
              </Pressable>
            </View>
            <ScrollView
              style={[styles.convertMenuScroll, !layout.isMobile && styles.convertMenuScrollDesktop]}
              contentContainerStyle={styles.deckPickerGrid}
              showsVerticalScrollIndicator={false}
            >
              {DECK_STYLES.map((s) => {
                const selected = deckStyle === s.id;
                return (
                  <Pressable
                    key={s.id}
                    testID={`deck-style-${s.id}`}
                    style={[styles.deckStyleCard, selected && styles.deckStyleCardSelected]}
                    onPress={() => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      setDeckStyle(s.id);
                    }}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    accessibilityLabel={t(`deck.style.${s.labelKey}` as any)}
                  >
                    <View style={[styles.deckStylePreview, { backgroundColor: s.palette.background }]}>
                      <View style={[styles.deckStylePreviewBar, { backgroundColor: s.palette.accent }]} />
                      <View style={[styles.deckStylePreviewTitle, { backgroundColor: s.palette.text }]} />
                      <View style={[styles.deckStylePreviewBullet, { backgroundColor: s.palette.text, opacity: 0.45 }]} />
                      <View style={[styles.deckStylePreviewBullet, { backgroundColor: s.palette.text, opacity: 0.45 }]} />
                      <View style={[styles.deckStylePreviewBullet, { backgroundColor: s.palette.text, opacity: 0.45 }]} />
                    </View>
                    <Text style={styles.deckStyleName} numberOfLines={1}>
                      {t(`deck.style.${s.labelKey}` as any)}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
            <View style={styles.deckPickerFooter}>
              <Pressable style={styles.deckPickerCancelBtn} onPress={() => setShowDeckStylePicker(false)} accessibilityRole="button">
                <Text style={styles.deckPickerCancelBtnText}>{t("common.cancel", { defaultValue: "Cancel" })}</Text>
              </Pressable>
              <Pressable
                style={[styles.deckPickerGenerateBtn, !deckStyle && styles.deckPickerGenerateBtnDisabled]}
                disabled={!deckStyle}
                onPress={() => deckStyle && runDeckGeneration(deckStyle)}
                accessibilityRole="button"
                accessibilityState={{ disabled: !deckStyle }}
                testID="deck-style-generate"
              >
                <Feather name="monitor" size={16} color={Colors.white} />
                <Text style={styles.deckPickerGenerateBtnText}>{t("deck.generate")}</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal
        visible={showConvertMenu}
        transparent
        animationType="fade"
        onRequestClose={() => setShowConvertMenu(false)}
        accessibilityViewIsModal={true}
      >
        <Pressable style={[styles.modalOverlay, !layout.isMobile && styles.modalOverlayCentered]} onPress={() => setShowConvertMenu(false)} accessibilityLabel={t("common.close")} accessibilityRole="button">
          <Pressable
            style={[styles.menuSheet, styles.convertMenuSheet, !layout.isMobile && styles.menuSheetCentered, !layout.isMobile && styles.convertMenuSheetCentered, convertSheetHeight != null && { height: convertSheetHeight, maxHeight: convertSheetHeight }]}
            onPress={(e) => e.stopPropagation?.()}
            onLayout={(e) => { convertSheetMeasuredRef.current = e.nativeEvent.layout.height; }}
          >
            {layout.isMobile && (
              <View style={styles.menuHandleTouchZone} {...convertSheetPan.panHandlers}>
                <View style={styles.menuHandle} />
              </View>
            )}
            <View style={styles.convertMenuHeader}>
              <View style={styles.convertMenuHeaderText}>
                <Text style={[styles.menuTitle, styles.convertMenuTitle]} accessibilityRole="header">
                  {t("detail.conversionTypes")}
                </Text>
              </View>
              <Pressable
                onPress={() => setShowConvertMenu(false)}
                hitSlop={8}
                style={styles.convertMenuCloseBtn}
                accessibilityLabel={t("common.close")}
                accessibilityRole="button"
              >
                <Feather name="x" size={18} color={Colors.text} />
              </Pressable>
            </View>
            <View style={styles.clarifyToggleRow}>
              <View style={styles.clarifyToggleInfo}>
                <Feather name="code" size={16} color={useMarkdown ? Colors.primary : Colors.textSecondary} />
                <Text style={[styles.clarifyToggleLabel, !useMarkdown && { color: Colors.textSecondary }]}>{t("detail.codeBlockOutput")}</Text>
              </View>
              <Switch
                value={useMarkdown}
                onValueChange={(val) => {
                  setUseMarkdown(val);
                  AsyncStorage.setItem("@voicenote_use_markdown", val ? "true" : "false");
                }}
                trackColor={{ false: Colors.border, true: Colors.primary }}
                thumbColor="#fff"
                accessibilityLabel={t("detail.codeBlockOutput")}
              />
            </View>
            {activeResearchFormType && RESEARCH_FORMS_TYPES.has(activeResearchFormType) && (
              <View style={styles.clarifyToggleRow}>
                <View style={styles.clarifyToggleInfo}>
                  <Feather name="globe" size={16} color={includeWebSources === false ? Colors.textSecondary : Colors.primary} />
                  <Text style={[styles.clarifyToggleLabel, includeWebSources === false && { color: Colors.textSecondary }]}>
                    {t("detail.includeWebSources")}
                  </Text>
                  <Text style={styles.clarifyToggleHint}>{t("detail.includeWebSourcesHint")}</Text>
                </View>
                <Switch
                  value={includeWebSources ?? researchFormWebDefault(activeResearchFormType)}
                  onValueChange={(val) => setIncludeWebSources(val)}
                  trackColor={{ false: Colors.border, true: Colors.primary }}
                  thumbColor="#fff"
                  accessibilityLabel={t("detail.includeWebSources")}
                />
              </View>
            )}
            <ScrollView
              showsVerticalScrollIndicator={false}
              style={[styles.convertMenuScroll, !layout.isMobile && styles.convertMenuScrollDesktop]}
              contentContainerStyle={styles.convertMenuScrollContent}
            >
              {recentConversionTypes.length > 0 && !convertSearchQuery.trim() && (() => {
                const recentTypes = recentConversionTypes
                  .map(val => CONVERSION_TYPES.find(ct => ct.value === val))
                  .filter((ct): ct is NonNullable<typeof ct> => !!ct);
                if (recentTypes.length === 0) return null;
                return (
                  <View style={styles.complexitySection}>
                    <View style={styles.sectionHeaderRow} accessibilityRole="header">
                      <View style={[styles.sectionAccentDot, { backgroundColor: Colors.textMuted }]} />
                      <Feather name="clock" size={13} color={Colors.textMuted} />
                      <Text style={[styles.sectionHeaderLabel, { color: Colors.textMuted }]}>{t("detail.recentTypes")}</Text>
                    </View>
                    {recentTypes.map((type) => {
                      const alreadyConverted = recording.conversions.some((c) => c.type === type.value);
                      const locked = isTypeLocked(type.value);
                      return (
                        <Pressable
                          key={type.value}
                          style={({ pressed }) => [styles.menuItem, pressed && styles.menuItemPressed, alreadyConverted && styles.menuItemDone, locked && { opacity: 0.5 }]}
                          onPress={() => {
                            if (locked) {
                              handleLockedConversionPress(type.value);
                            } else {
                              handleConvert(type.value);
                            }
                          }}
                          accessibilityRole="button"
                        >
                          <View style={[styles.menuIcon, alreadyConverted && styles.menuIconDone]}>
                            {locked ? <Feather name="lock" size={18} color={Colors.textMuted} /> : alreadyConverted ? <Feather name="check" size={20} color={Colors.success} /> : <ConversionIcon name={type.icon} size={20} color={Colors.primary} />}
                          </View>
                          <View style={styles.menuTextColumn}>
                            <Text style={[styles.menuLabel, alreadyConverted && styles.menuLabelDone, locked && { color: Colors.textMuted }]}>{t(`conversion.${type.value}` as any)}</Text>
                            {alreadyConverted && !locked && <Text style={styles.menuDoneLabel}>{t("detail.runAgain" as any)}</Text>}
                          </View>
                        </Pressable>
                      );
                    })}
                  </View>
                );
              })()}

              {CONVERSION_COMPLEXITY_GROUPS.map((group, groupIndex) => {
                const groupAccentColors: Record<string, string> = {
                  simple: "#00B4D8",
                  intermediate: "#A78BFA",
                  advanced: "#F59E0B",
                };
                const accent = groupAccentColors[group.key] || Colors.primary;
                  const groupTypes = CONVERSION_TYPES
                  .filter(ct => !ct.module)
                  .filter(ct => CONVERSION_COMPLEXITY_MAP[ct.value] === group.key)
                  .filter(ct => ct.value !== "github_issue")
                  .filter(ct => !convertSearchQuery.trim() || t(`conversion.${ct.value}` as any).toLowerCase().includes(convertSearchQuery.trim().toLowerCase()))
                  .sort((a, b) => t(`conversion.${a.value}` as any).localeCompare(t(`conversion.${b.value}` as any)));
                if (groupTypes.length === 0) return null;
                const doneCount = groupTypes.filter(ct => !isTypeLocked(ct.value) && recording.conversions.some(c => c.type === ct.value)).length;
                return (
                  <View key={group.key} style={styles.complexitySection}>
                    <View style={styles.sectionHeaderRow} accessibilityRole="header">
                      <View style={[styles.sectionAccentDot, { backgroundColor: accent }]} />
                      <Feather name={group.icon as any} size={13} color={accent} />
                      <Text style={[styles.sectionHeaderLabel, { color: accent }]}>{t(group.labelKey as any)}</Text>
                      {doneCount > 0 && (
                        <View style={styles.sectionDonePill}>
                          <Feather name="check" size={9} color={Colors.success} />
                          <Text style={styles.sectionDonePillText}>{doneCount}/{groupTypes.length}</Text>
                        </View>
                      )}
                    </View>
                    {groupTypes.map((type) => {
                      const alreadyConverted = recording.conversions.some((c) => c.type === type.value);
                      const locked = isTypeLocked(type.value);
                      return (
                        <Pressable
                          key={type.value}
                          style={({ pressed }) => [styles.menuItem, pressed && styles.menuItemPressed, alreadyConverted && styles.menuItemDone, locked && { opacity: 0.5 }]}
                          onPress={() => {
                            if (locked) {
                              handleLockedConversionPress(type.value);
                            } else {
                              handleConvert(type.value);
                            }
                          }}
                          accessibilityLabel={`${t(`conversion.${type.value}` as any)}${locked ? `, requires ${getLockedTierLabel(type.value)}` : ""}${alreadyConverted ? `, ${t("detail.runAgain" as any)}` : ""}`}
                          accessibilityRole="button"
                        >
                          <View style={[styles.menuIcon, alreadyConverted && styles.menuIconDone]} accessibilityElementsHidden={true} importantForAccessibility="no-hide-descendants">
                            {locked ? <Feather name="lock" size={18} color={Colors.textMuted} /> : alreadyConverted ? <Feather name="check" size={20} color={Colors.success} /> : <ConversionIcon name={type.icon} size={20} color={Colors.primary} />}
                          </View>
                          <View style={styles.menuTextColumn}>
                            <Text style={[styles.menuLabel, alreadyConverted && styles.menuLabelDone, locked && { color: Colors.textMuted }]}>{t(`conversion.${type.value}` as any)}</Text>
                            {locked && (
                              <View style={styles.menuMetaRow} accessibilityElementsHidden={true} importantForAccessibility="no-hide-descendants">
                                <Text style={styles.menuMetaLabel}>{getLockedTierLabel(type.value)}</Text>
                                <Feather name="lock" size={12} color={Colors.textMuted} />
                              </View>
                            )}
                            {alreadyConverted && !locked && <Text style={styles.menuDoneLabel}>{t("detail.runAgain" as any)}</Text>}
                          </View>
                        </Pressable>
                      );
                    })}
                  </View>
                );
              })}

              {PACK_GROUPS.map((pack) => {
                const packTypes = CONVERSION_TYPES
                  .filter(ct => ct.module === pack.moduleName)
                  .filter(ct => !convertSearchQuery.trim() || t(`conversion.${ct.value}` as any).toLowerCase().includes(convertSearchQuery.trim().toLowerCase()))
                  .sort((a, b) => t(`conversion.${a.value}` as any).localeCompare(t(`conversion.${b.value}` as any)));
                if (packTypes.length === 0) return null;
                const doneCount = packTypes.filter(ct => !isTypeLocked(ct.value) && recording.conversions.some(c => c.type === ct.value)).length;
                return (
                  <View key={pack.moduleName} style={styles.complexitySection}>
                    <View style={styles.sectionHeaderRow} accessibilityRole="header">
                      <View style={[styles.sectionAccentDot, { backgroundColor: pack.accent }]} />
                      <Feather name={pack.icon as any} size={13} color={pack.accent} />
                      <Text style={[styles.sectionHeaderLabel, { color: pack.accent }]}>{t(pack.labelKey as any)}</Text>
                      {doneCount > 0 && (
                        <View style={styles.sectionDonePill}>
                          <Feather name="check" size={9} color={Colors.success} />
                          <Text style={styles.sectionDonePillText}>{doneCount}/{packTypes.length}</Text>
                        </View>
                      )}
                    </View>
                    {packTypes.map((type) => {
                      const alreadyConverted = recording.conversions.some((c) => c.type === type.value);
                      const locked = isTypeLocked(type.value);
                      return (
                        <Pressable
                          key={type.value}
                          style={({ pressed }) => [styles.menuItem, pressed && styles.menuItemPressed, alreadyConverted && styles.menuItemDone, locked && { opacity: 0.5 }]}
                          onPress={() => {
                            if (locked) {
                              handleLockedConversionPress(type.value);
                            } else {
                              handleConvert(type.value);
                            }
                          }}
                          accessibilityLabel={`${t(`conversion.${type.value}` as any)}${locked ? `, requires ${getLockedTierLabel(type.value)}` : ""}${alreadyConverted ? `, ${t("detail.runAgain" as any)}` : ""}`}
                          accessibilityRole="button"
                        >
                          <View style={[styles.menuIcon, alreadyConverted && styles.menuIconDone]} accessibilityElementsHidden={true} importantForAccessibility="no-hide-descendants">
                            {locked ? <Feather name="lock" size={18} color={Colors.textMuted} /> : alreadyConverted ? <Feather name="check" size={20} color={Colors.success} /> : <ConversionIcon name={type.icon} size={20} color={Colors.primary} />}
                          </View>
                          <View style={styles.menuTextColumn}>
                            <Text style={[styles.menuLabel, alreadyConverted && styles.menuLabelDone, locked && { color: Colors.textMuted }]}>{t(`conversion.${type.value}` as any)}</Text>
                            {locked && (
                              <View style={styles.menuMetaRow} accessibilityElementsHidden={true} importantForAccessibility="no-hide-descendants">
                                <Text style={styles.menuMetaLabel}>{getLockedTierLabel(type.value)}</Text>
                                <Feather name="lock" size={12} color={Colors.textMuted} />
                              </View>
                            )}
                            {alreadyConverted && !locked && <Text style={styles.menuDoneLabel}>{t("detail.runAgain" as any)}</Text>}
                          </View>
                        </Pressable>
                      );
                    })}
                  </View>
                );
              })}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal
        visible={showCitationPicker}
        transparent
        animationType="fade"
        onRequestClose={() => setShowCitationPicker(false)}
        accessibilityViewIsModal={true}
      >
        <Pressable style={[styles.modalOverlay, !layout.isMobile && styles.modalOverlayCentered]} onPress={() => setShowCitationPicker(false)} accessibilityLabel={t("common.close")} accessibilityRole="button">
          <Pressable style={[styles.menuSheet, !layout.isMobile && styles.menuSheetCentered]} onPress={(e) => e.stopPropagation?.()}>
            {layout.isMobile && <View style={styles.menuHandle} />}
            <View style={styles.citationHeader}>
              <Pressable onPress={() => { setShowCitationPicker(false); setShowConvertMenu(true); }} hitSlop={8} style={styles.citationBackBtn} accessibilityLabel={t("a11y.goBack")} accessibilityRole="button">
                <Feather name="arrow-left" size={18} color={Colors.text} />
              </Pressable>
              <View style={styles.citationHeaderText}>
                <Text style={styles.menuTitle} accessibilityRole="header">{citationPickerTarget === "bibliography" ? t("detail.bibliography") : t("detail.academicResearch")}</Text>
              </View>
            </View>
            <ScrollView showsVerticalScrollIndicator={false} style={styles.citationList}>
              {CITATION_STYLES.map((style) => (
                <Pressable
                  key={style.value}
                  style={({ pressed }) => [styles.citationItem, pressed && styles.menuItemPressed]}
                  onPress={() => handleConvert(citationPickerTarget, style.value)}
                  accessibilityLabel={`${style.label} citation style`}
                  accessibilityRole="button"
                >
                  <View style={styles.citationItemLeft}>
                    <Text style={styles.citationItemLabel}>{style.label}</Text>
                    <Text style={styles.citationItemDesc}>{style.description}</Text>
                  </View>
                  <Feather name="chevron-right" size={18} color={Colors.textMuted} />
                </Pressable>
              ))}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal
        visible={showBibliographyTypePicker}
        transparent
        animationType="fade"
        onRequestClose={() => setShowBibliographyTypePicker(false)}
        accessibilityViewIsModal={true}
      >
        <Pressable style={[styles.modalOverlay, !layout.isMobile && styles.modalOverlayCentered]} onPress={() => setShowBibliographyTypePicker(false)} accessibilityLabel={t("common.close")} accessibilityRole="button">
          <Pressable style={[styles.menuSheet, !layout.isMobile && styles.menuSheetCentered]} onPress={(e) => e.stopPropagation?.()}>
            {layout.isMobile && <View style={styles.menuHandle} />}
            <View style={styles.citationHeader}>
              <Pressable onPress={() => { setShowBibliographyTypePicker(false); setCitationPickerTarget("bibliography"); setShowCitationPicker(true); }} hitSlop={8} style={styles.citationBackBtn} accessibilityLabel={t("a11y.goBack")} accessibilityRole="button">
                <Feather name="arrow-left" size={18} color={Colors.text} />
              </Pressable>
              <View style={styles.citationHeaderText}>
                <Text style={styles.menuTitle} accessibilityRole="header">{t("detail.selectBibliographyType")}</Text>
              </View>
            </View>
            <View style={styles.citationList}>
              <Pressable
                style={({ pressed }) => [styles.citationItem, pressed && styles.menuItemPressed]}
                onPress={() => handleConvert("bibliography", selectedBibCitationStyle || "apa7", "regular")}
                accessibilityLabel={t("detail.regularBibliography")}
                accessibilityRole="button"
              >
                <View style={styles.citationItemLeft}>
                  <Text style={styles.citationItemLabel}>{t("detail.regularBibliography")}</Text>
                  <Text style={styles.citationItemDesc}>{t("detail.regularBibliographyDesc")}</Text>
                </View>
                <Feather name="chevron-right" size={18} color={Colors.textMuted} />
              </Pressable>
              <Pressable
                style={({ pressed }) => [styles.citationItem, pressed && styles.menuItemPressed]}
                onPress={() => handleConvert("bibliography", selectedBibCitationStyle || "apa7", "annotated")}
                accessibilityLabel={t("detail.annotatedBibliography")}
                accessibilityRole="button"
              >
                <View style={styles.citationItemLeft}>
                  <Text style={styles.citationItemLabel}>{t("detail.annotatedBibliography")}</Text>
                  <Text style={styles.citationItemDesc}>{t("detail.annotatedBibliographyDesc")}</Text>
                </View>
                <Feather name="chevron-right" size={18} color={Colors.textMuted} />
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal
        visible={clarifyLoading || clarifyQuestion !== ""}
        transparent
        animationType="fade"
        accessibilityViewIsModal={true}
        onRequestClose={() => {
          if (!clarifyLoading) {
            setClarifyQuestion("");
            setClarifyOptions([]);
            setClarifyAnswerText("");
            setPendingConversion(null);
          }
        }}
      >
        <Pressable
          style={[styles.modalOverlay, !layout.isMobile && styles.modalOverlayCentered]}
          onPress={() => {
            if (!clarifyLoading) {
              setClarifyQuestion("");
              setClarifyOptions([]);
              setClarifyAnswerText("");
              setPendingConversion(null);
            }
          }}
        >
          <Pressable style={[styles.menuSheet, !layout.isMobile && styles.menuSheetCentered]} onPress={(e) => e.stopPropagation?.()}>
            {layout.isMobile && <View style={styles.menuHandle} />}
            {clarifyLoading ? (
              <View style={styles.clarifyLoadingContainer}>
                <ProcessingAnimation
                  kind="conversion"
                  size={76}
                  accessibilityLabel={t("detail.checkingAmbiguities")}
                  testID="clarification-processing-animation"
                />
                <Text style={styles.clarifyLoadingText} accessibilityLiveRegion="polite">
                  {t("detail.checkingAmbiguities")}
                </Text>
                <Text
                  style={styles.clarifyLoadingVerb}
                  aria-hidden={true}
                  importantForAccessibility="no-hide-descendants"
                >
                  {clarifyCyclingVerb}…
                </Text>
              </View>
            ) : (
              <>
                <View style={styles.clarifyHeader}>
                  <Feather name="help-circle" size={22} color={Colors.primary} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.menuTitle}>{t("detail.clarifyTitle")}</Text>
                  </View>
                </View>
                <ScrollView style={styles.clarifyScrollView} showsVerticalScrollIndicator={false}>
                  <View style={styles.clarifyQuestionCard}>
                    <Text style={styles.clarifyQuestionText}>
                      {clarifyQuestion}
                    </Text>
                    {clarifyOptions && clarifyOptions.length > 0 && (
                      <View style={{ marginTop: 12, marginBottom: 12 }}>
                        {clarifyOptions.map((option, index) => (
                          <Pressable
                            key={index}
                            style={[styles.mdPromptBtn, styles.mdPromptBtnOutline, { marginBottom: 8, paddingVertical: 10, justifyContent: "flex-start", paddingHorizontal: 16 }]}
                            onPress={() => handleSubmitClarifications(option)}
                          >
                            <Text style={[styles.mdPromptBtnTextOutline, { textAlign: "left" }]}>{option}</Text>
                          </Pressable>
                        ))}
                      </View>
                    )}
                    <TextInput
                      style={[styles.clarifyAnswerInput]}
                      placeholder={t("detail.typeAnswer")}
                      placeholderTextColor={Colors.textMuted}
                      value={clarifyAnswerText}
                      onChangeText={setClarifyAnswerText}
                      multiline
                      testID="clarify-answer-input"
                      accessibilityLabel="Custom answer"
                    />
                  </View>
                </ScrollView>
                <View style={styles.clarifyActions}>
                  <Pressable
                    style={styles.clarifySkipBtn}
                    onPress={handleSkipClarifications}
                    accessibilityLabel={t("common.skip")}
                    accessibilityRole="button"
                  >
                    <Text style={styles.clarifySkipText}>{t("common.skip")}</Text>
                  </Pressable>
                  <Pressable
                    style={styles.clarifySubmitBtn}
                    onPress={() => handleSubmitClarifications()}
                    accessibilityLabel={t("detail.submitConvert")}
                    accessibilityRole="button"
                  >
                    <Feather name="check" size={16} color="#fff" />
                    <Text style={styles.clarifySubmitText}>{t("detail.submitConvert")}</Text>
                  </Pressable>
                </View>
              </>
            )}
          </Pressable>
        </Pressable>
      </Modal>

      <Modal
        visible={!!selectedConversion}
        transparent
        animationType="slide"
        onRequestClose={closeSelectedConversion}
        accessibilityViewIsModal={true}
      >
        <View style={styles.fullModalOverlay}>
          <View style={[styles.fullModal, { paddingTop: insets.top + webTopInset + 12, paddingBottom: insets.bottom + (Platform.OS === "web" ? 34 : 0) }]}>
            <View style={[styles.fullModalHeader, { maxWidth: layout.contentMaxWidth, alignSelf: "center", width: "100%" }]}>
              <View style={styles.fullModalTitleRow}>
                <Pressable
                  onPress={closeSelectedConversion}
                  style={styles.fullModalBackBtn}
                  hitSlop={8}
                  accessibilityLabel={t("a11y.goBack")}
                  accessibilityRole="button"
                >
                  <Feather name="arrow-left" size={20} color={Colors.text} />
                </Pressable>
                <View style={styles.conversionIconWrap}>
                  <ConversionIcon
                    name={CONVERSION_TYPES.find((t) => t.value === selectedConversion?.type)?.icon || "file"}
                    size={18}
                    color={Colors.primary}
                  />
                </View>
                <Text style={styles.fullModalTitle} accessibilityRole="header">{selectedConversion?.label}</Text>
              </View>
              <Pressable
                onPress={closeSelectedConversion}
                style={styles.iconBtn}
                hitSlop={8}
                accessibilityLabel={t("common.close")}
                accessibilityRole="button"
              >
                <Feather name="x" size={22} color={Colors.text} />
              </Pressable>
            </View>
            <View style={[styles.fullModalActionsRow, { maxWidth: layout.contentMaxWidth, alignSelf: "center", width: "100%" }]}>
              <Pressable
                onPress={() => selectedConversion && handleShareConversion(selectedConversion)}
                style={styles.iconBtn}
                hitSlop={8}
                accessibilityLabel={t("common.share")}
                accessibilityRole="button"
              >
                <Feather name="share" size={20} color={Colors.primary} />
              </Pressable>
              <Pressable
                onPress={() => selectedConversion && handleSaveConversion(selectedConversion)}
                style={styles.iconBtn}
                hitSlop={8}
                accessibilityLabel={t("common.save")}
                accessibilityRole="button"
              >
                <Feather name="download" size={20} color={Colors.primary} />
              </Pressable>
              {selectedConversion?.deckId && (
                <Pressable
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    handleDownloadDeck(selectedConversion);
                  }}
                  style={styles.sendToBtn}
                  hitSlop={8}
                  disabled={deckDownloadingId === selectedConversion.id}
                  accessibilityLabel={t("deck.downloadPptx")}
                  accessibilityRole="button"
                  testID="deck-download-button"
                >
                  <Feather
                    name={deckDownloadingId === selectedConversion.id ? "loader" : "monitor"}
                    size={16}
                    color={Colors.primary}
                  />
                  <Text style={styles.sendToBtnText}>
                    {deckDownloadingId === selectedConversion.id ? "…" : t("deck.downloadPptx")}
                  </Text>
                </Pressable>
              )}
              {user && selectedConversion?.type === "calendar_event" && (
                <Pressable
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    handleOpenCalendarExport();
                  }}
                  style={styles.sendToBtn}
                  hitSlop={8}
                  accessibilityLabel={t("detail.addToCalendar")}
                  accessibilityRole="button"
                  testID="add-to-calendar-button"
                >
                  <Feather name="calendar" size={16} color={Colors.primary} />
                  <Text style={styles.sendToBtnText}>{t("detail.addToCalendar")}</Text>
                </Pressable>
              )}
              <Pressable
                onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setCodeViewActive(!codeViewActive); }}
                style={styles.iconBtn}
                hitSlop={8}
                accessibilityLabel={t("detail.codeBlockToggle")}
                accessibilityRole="button"
              >
                <Feather name={codeViewActive ? "eye" : "code"} size={19} color={codeViewActive ? Colors.warning || "#F59E0B" : Colors.primary} />
              </Pressable>
            </View>
            <Pressable
              style={[styles.finalArtifactNote, { maxWidth: layout.contentMaxWidth, alignSelf: "center", width: "100%" }]}
              accessibilityLabel={t("detail.finalArtifactNote")}
              accessibilityRole="button"
            >
              <Feather name="check-circle" size={14} color={Colors.success} />
              <Text style={styles.finalArtifactText}>{t("detail.styleFeedbackHint")}</Text>
            </Pressable>
            <ScrollView
              style={styles.fullModalScroll}
              contentContainerStyle={[styles.fullModalContent, { maxWidth: layout.contentMaxWidth, alignSelf: "center", width: "100%" }]}
              showsVerticalScrollIndicator={false}
            >
              <ConversionContent content={selectedConversion?.content || ""} conversionType={selectedConversion?.type} codeView={codeViewActive} />
            </ScrollView>
          </View>
        </View>
      </Modal>

      <Modal
        visible={!!exportTarget}
        transparent
        animationType="fade"
        onRequestClose={() => setExportTarget(null)}
        accessibilityViewIsModal={true}
      >
        <Pressable style={styles.formatModalOverlay} onPress={() => setExportTarget(null)} accessibilityLabel={t("common.close")} accessibilityRole="button">
          <Pressable style={styles.formatModalContent} onPress={(e) => e.stopPropagation?.()}>
            <View style={styles.formatModalHeader}>
              <Text style={styles.formatModalTitle} accessibilityRole="header">
                {exportTarget?.action === "share" ? t("detail.shareAs") : t("detail.saveAs")}
              </Text>
              <Pressable onPress={() => setExportTarget(null)} hitSlop={8} accessibilityLabel={t("common.close")} accessibilityRole="button" style={{ minWidth: 44, minHeight: 44, justifyContent: "center", alignItems: "center" }}>
                <Feather name="x" size={20} color={Colors.text} />
              </Pressable>
            </View>
            {EXPORT_FORMATS.filter((format) => {
              const convType = exportTarget?.conversion?.type;
              if (format.value === "csv" || format.value === "xlsx") {
                return convType === "spreadsheet";
              }

              if (format.value === "md") return useMarkdown;
              return true;
            }).map((format) => (
              <Pressable
                key={format.value}
                style={({ pressed }) => [styles.formatOption, pressed && styles.formatOptionPressed]}
                onPress={() => handleExportWithFormat(format.value)}
                accessibilityLabel={`Export as ${format.label}`}
                accessibilityRole="button"
              >
                <Feather
                  name={
                    format.value === "txt" ? "file-text" :
                    format.value === "md" ? "hash" :
                    format.value === "pdf" ? "file" :
                    format.value === "docx" ? "file-plus" :
                    format.value === "csv" || format.value === "xlsx" ? "grid" :
                    "file"
                  }
                  size={20}
                  color={Colors.primary}
                />
                <Text style={styles.formatLabel}>{t(exportFormatKeys[format.value] as any)}</Text>
              </Pressable>
            ))}
          </Pressable>
        </Pressable>
      </Modal>

      <Modal visible={!!pendingWebShare} transparent animationType="fade" onRequestClose={() => setPendingWebShare(null)}>
        <View style={styles.formatModalOverlay}>
          <View style={[styles.formatModalContent, { alignItems: "center", padding: 24, maxWidth: 320 }]}>
            <Feather name="check-circle" size={48} color={Colors.primary} style={{ marginBottom: 16 }} />
            <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 18, color: Colors.text, marginBottom: 8, textAlign: "center" }}>
              Ready to Share
            </Text>
            <Text style={{ fontFamily: "Inter_400Regular", fontSize: 14, color: Colors.textSecondary, textAlign: "center", marginBottom: 24 }}>
              {pendingWebShare?.fileName} has been generated and is ready to share.
            </Text>
            <View style={{ flexDirection: "row", gap: 12, width: "100%" }}>
              <Pressable style={[{ flex: 1, backgroundColor: "rgba(255,255,255,0.1)", paddingVertical: 12, borderRadius: 8, alignItems: "center" }]} onPress={() => setPendingWebShare(null)}>
                <Text style={[{ color: Colors.text, fontFamily: "Inter_500Medium", fontSize: 15 }]}>{t("common.cancel")}</Text>
              </Pressable>
              <Pressable style={[{ flex: 1, backgroundColor: Colors.primary, paddingVertical: 12, borderRadius: 8, alignItems: "center" }]} onPress={async () => {
                if (!pendingWebShare) return;
                const { blob, fileName, mimeType } = pendingWebShare;
                setPendingWebShare(null);
                const shared = await triggerWebShare(blob, fileName, mimeType).catch(() => false);
                if (!shared) {
                  triggerWebDownload(blob, fileName);
                  showDownloadToast(fileName);
                }
              }}>
                <Text style={[{ color: Colors.background, fontFamily: "Inter_500Medium", fontSize: 15 }]}>{t("common.share")}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={showCalendarExport}
        transparent
        animationType="fade"
        onRequestClose={() => setShowCalendarExport(false)}
        accessibilityViewIsModal={true}
      >
        <Pressable style={styles.formatModalOverlay} onPress={() => setShowCalendarExport(false)} accessibilityLabel={t("common.close")} accessibilityRole="button">
          <Pressable style={[styles.formatModalContent, { maxHeight: "70%" }]} onPress={(e) => e.stopPropagation?.()}>
            <View style={styles.formatModalHeader}>
              <Text style={styles.formatModalTitle} accessibilityRole="header">{t("detail.addToCalendar")}</Text>
              <Pressable onPress={() => setShowCalendarExport(false)} hitSlop={8} accessibilityLabel={t("common.close")} accessibilityRole="button" style={{ minWidth: 44, minHeight: 44, justifyContent: "center", alignItems: "center" }}>
                <Feather name="x" size={20} color={Colors.text} />
              </Pressable>
            </View>
            {calendarParsing ? (
              <View style={{ padding: 32, alignItems: "center", gap: 12 }}>
                <ActivityIndicator size="large" color={Colors.primary} />
                <Text style={{ color: Colors.textSecondary, fontSize: ts.body, fontFamily: "Inter_500Medium" }}>
                  {t("detail.parsingEvents")}
                </Text>
              </View>
            ) : calendarEvents.length === 0 ? (
              <View style={{ padding: 24, alignItems: "center", gap: 8 }}>
                <Feather name="calendar" size={32} color={Colors.textMuted} />
                <Text style={{ color: Colors.textSecondary, fontSize: ts.body, fontFamily: "Inter_500Medium", textAlign: "center" }}>
                  {t("detail.noCalendarEvents")}
                </Text>
              </View>
            ) : (
              <ScrollView style={{ maxHeight: 400 }} showsVerticalScrollIndicator={false}>
                <Text style={{ color: Colors.textSecondary, fontSize: ts.body2, fontFamily: "Inter_400Regular", paddingHorizontal: 16, marginBottom: 8 }}>
                  {calendarEvents.length === 1 ? t("detail.eventsFound", { count: calendarEvents.length }) : t("detail.eventsFoundPlural", { count: calendarEvents.length })}
                </Text>
                {calendarEvents.map((item, idx) => (
                  <View key={idx} style={{ borderBottomWidth: idx < calendarEvents.length - 1 ? 1 : 0, borderBottomColor: Colors.border, paddingVertical: 12, paddingHorizontal: 16 }}>
                    <Text style={{ color: Colors.text, fontSize: ts.bodyLarge, fontFamily: "Inter_600SemiBold", marginBottom: 4 }} numberOfLines={2}>
                      {item.event.title}
                    </Text>
                    {item.event.startDate && (
                      <Text style={{ color: Colors.textSecondary, fontSize: ts.body2, fontFamily: "Inter_400Regular", marginBottom: 8 }}>
                        {item.event.startDate}{item.event.startTime ? ` at ${item.event.startTime}` : ""}{item.event.endDate && item.event.endDate !== item.event.startDate ? ` - ${item.event.endDate}` : ""}{item.event.endTime ? ` to ${item.event.endTime}` : ""}
                      </Text>
                    )}
                    {item.event.location && (
                      <Text style={{ color: Colors.textMuted, fontSize: ts.caption, fontFamily: "Inter_400Regular", marginBottom: 8 }}>
                        <Feather name="map-pin" size={ts.sm} color={Colors.textMuted} /> {item.event.location}
                      </Text>
                    )}
                    <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
                      <Pressable
                        onPress={() => handleOpenCalendarUrl(item.googleUrl)}
                        style={({ pressed }) => [{ flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: pressed ? Colors.cardBorder : Colors.card, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, borderWidth: 0, minHeight: 44 }]}
                        accessibilityLabel={`Add ${item.event.title} to Google Calendar`}
                        accessibilityRole="link"
                      >
                        <Feather name="external-link" size={14} color={Colors.primary} />
                        <Text style={{ color: Colors.primary, fontSize: ts.body2, fontFamily: "Inter_500Medium" }}>{t("detail.googleCalendar")}</Text>
                      </Pressable>
                      <Pressable
                        onPress={() => handleOpenCalendarUrl(item.outlookUrl)}
                        style={({ pressed }) => [{ flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: pressed ? Colors.cardBorder : Colors.card, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, borderWidth: 0, minHeight: 44 }]}
                        accessibilityLabel={`Add ${item.event.title} to Outlook`}
                        accessibilityRole="link"
                      >
                        <Feather name="external-link" size={14} color={Colors.primary} />
                        <Text style={{ color: Colors.primary, fontSize: ts.body2, fontFamily: "Inter_500Medium" }}>{t("detail.outlook")}</Text>
                      </Pressable>
                    </View>
                  </View>
                ))}
                <Pressable
                  onPress={handleDownloadIcs}
                  disabled={downloadingIcs}
                  style={({ pressed }) => [styles.formatOption, pressed && styles.formatOptionPressed, { marginTop: 8 }]}
                  accessibilityLabel={t("detail.downloadIcs")}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: downloadingIcs }}
                >
                  {downloadingIcs ? (
                    <ActivityIndicator size="small" color={Colors.primary} />
                  ) : (
                    <Feather name="download" size={20} color={Colors.primary} />
                  )}
                  <Text style={styles.formatLabel}>{t("detail.downloadIcs")}</Text>
                </Pressable>
              </ScrollView>
            )}
          </Pressable>
        </Pressable>
      </Modal>

      <Modal
        visible={showTaskExport}
        transparent
        animationType="fade"
        onRequestClose={() => setShowTaskExport(false)}
        accessibilityViewIsModal={true}
      >
        <Pressable style={styles.formatModalOverlay} onPress={() => setShowTaskExport(false)} accessibilityLabel={t("common.close")} accessibilityRole="button">
          <Pressable style={styles.formatModalContent} onPress={(e) => e.stopPropagation?.()}>
            <View style={styles.formatModalHeader}>
              <Text style={styles.formatModalTitle} accessibilityRole="header">{t("detail.exportTasks")}</Text>
              <Pressable onPress={() => setShowTaskExport(false)} hitSlop={8} accessibilityLabel={t("common.close")} accessibilityRole="button" style={{ minWidth: 44, minHeight: 44, justifyContent: "center", alignItems: "center" }}>
                <Feather name="x" size={20} color={Colors.text} />
              </Pressable>
            </View>
            {taskProviders.length === 0 ? (
              <View style={{ padding: 24, alignItems: "center", gap: 8 }}>
                <Feather name="inbox" size={32} color={Colors.textMuted} />
                <Text style={{ color: Colors.textSecondary, fontSize: sf(14, ts), fontFamily: "Inter_500Medium", textAlign: "center" }}>
                  {t("detail.noTaskIntegrations")}
                </Text>
              </View>
            ) : (
              taskProviders.map((tp) => (
                <Pressable
                  key={tp.id}
                  style={({ pressed }) => [styles.formatOption, pressed && styles.formatOptionPressed]}
                  onPress={() => handleExportToTaskProvider(tp.id)}
                  disabled={!!taskExporting}
                  accessibilityLabel={`Export to ${tp.label}`}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: !!taskExporting }}
                >
                  {taskExporting === tp.id ? (
                    <ActivityIndicator size="small" color={Colors.primary} />
                  ) : (
                    <Feather
                      name={
                        tp.provider === "todoist" ? "list" :
                        tp.provider === "google_tasks" ? "check-circle" :
                        tp.provider === "microsoft_todo" ? "check-square" :
                        tp.provider === "asana" ? "layout" :
                        tp.provider === "jira" ? "trello" :
                        tp.provider === "linear" ? "target" :
                        tp.provider === "monday" ? "columns" :
                        tp.provider === "github_issues" ? "github" :
                        "code"
                      }
                      size={20}
                      color={Colors.primary}
                    />
                  )}
                  <Text style={styles.formatLabel}>{tp.label}</Text>
                </Pressable>
              ))
            )}
          </Pressable>
        </Pressable>
      </Modal>





      {downloadToast && (
        <View
          style={styles.downloadToast}
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
        >
          <View style={styles.downloadToastIcon}>
            <Feather name="check-circle" size={20} color="#4ade80" />
          </View>
          <View style={styles.downloadToastText}>
            <Text style={styles.downloadToastTitle}>{t(downloadToast.messageKey as any)}</Text>
            <Text style={styles.downloadToastFile} numberOfLines={1}>{downloadToast.fileName}</Text>
          </View>
          <Pressable
            onPress={() => {
              if (downloadToastTimer.current) clearTimeout(downloadToastTimer.current);
              setDownloadToast(null);
            }}
            hitSlop={8}
            accessibilityLabel={t("common.dismiss")}
            accessibilityRole="button"
          >
            <Feather name="x" size={18} color={Colors.textMuted} />
          </Pressable>
        </View>
      )}


      <Modal
        visible={showUpgradeModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowUpgradeModal(false)}
        accessibilityViewIsModal={true}
      >
        <Pressable style={styles.formatModalOverlay} onPress={() => setShowUpgradeModal(false)} accessibilityLabel={t("common.close" as any)} accessibilityRole="button">
          <Pressable style={[styles.formatModalContent, { maxWidth: 400, paddingVertical: 28, paddingHorizontal: 24 }]} onPress={(e) => e.stopPropagation()} accessibilityRole="alert" accessible={true}>
            <View style={{ alignItems: "center", marginBottom: 16 }}>
              <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: "rgba(0, 180, 216, 0.12)", justifyContent: "center", alignItems: "center", marginBottom: 12 }} accessibilityElementsHidden={true} importantForAccessibility="no-hide-descendants">
                <Feather name="lock" size={24} color={Colors.primary} />
              </View>
              <Text style={{ fontSize: ts.heading2, fontFamily: "Inter_700Bold", color: Colors.text, textAlign: "center", marginBottom: 6 }} accessibilityRole="header">
                {t("upgrade.limitReached" as any)}
              </Text>
              <Text style={{ fontSize: ts.body, fontFamily: "Inter_400Regular", color: Colors.textSecondary, textAlign: "center", lineHeight: ts.body * 1.4 }}>
                {upgradeMessage}
              </Text>
            </View>
            <Pressable
              style={{ backgroundColor: Colors.primaryButton, borderRadius: 12, paddingVertical: 14, alignItems: "center", marginBottom: 10 }}
              onPress={() => {
                setShowUpgradeModal(false);
                router.push("/settings");
              }}
              accessibilityRole="button"
              accessibilityLabel={t("upgrade.upgradeNow" as any)}
            >
              <Text style={{ fontSize: ts.bodyLarge, fontFamily: "Inter_600SemiBold", color: "#fff" }}>
                {t("upgrade.upgradeNow" as any)}
              </Text>
            </Pressable>
            <Pressable
              style={{ paddingVertical: 12, alignItems: "center" }}
              onPress={() => setShowUpgradeModal(false)}
              accessibilityRole="button"
              accessibilityLabel={t("upgrade.maybeLater" as any)}
            >
              <Text style={{ fontSize: ts.body, fontFamily: "Inter_400Regular", color: Colors.textSecondary }}>
                {t("upgrade.maybeLater" as any)}
              </Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
      <Modal
        visible={showProAccessModal}
        transparent
        animationType="fade"
        onRequestClose={() => { setShowProAccessModal(false); setProAccessInfo(null); }}
        accessibilityViewIsModal={true}
      >
        <Pressable style={styles.formatModalOverlay} onPress={() => { setShowProAccessModal(false); setProAccessInfo(null); }} accessibilityLabel={t("common.close" as any)} accessibilityRole="button">
          <Pressable style={[styles.formatModalContent, { maxWidth: 400, paddingVertical: 28, paddingHorizontal: 24 }]} onPress={(e) => e.stopPropagation()} accessibilityRole="alert" accessible={true}>
            <View style={{ alignItems: "center", marginBottom: 16 }}>
              <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: "rgba(99, 102, 241, 0.12)", justifyContent: "center", alignItems: "center", marginBottom: 12 }} accessibilityElementsHidden={true} importantForAccessibility="no-hide-descendants">
                <Feather name="zap" size={24} color="#6366f1" />
              </View>
              <Text style={{ fontSize: ts.heading2, fontFamily: "Inter_700Bold", color: Colors.text, textAlign: "center", marginBottom: 6 }} accessibilityRole="header">
                Upgrade to Pro
              </Text>
              <Text style={{ fontSize: ts.body, fontFamily: "Inter_400Regular", color: Colors.textSecondary, textAlign: "center", lineHeight: ts.body * 1.4, marginBottom: 14 }}>
                Move from Base to Pro for heavier usage and fewer premium confirmation prompts.
              </Text>
              <View style={{ backgroundColor: "rgba(99, 102, 241, 0.06)", borderRadius: 12, padding: 14, width: "100%" as any, marginBottom: 4 }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                  <Text style={{ fontSize: ts.body, fontFamily: "Inter_600SemiBold", color: Colors.text }}>Pro plan</Text>
                  <Text style={{ fontSize: ts.body, fontFamily: "Inter_700Bold", color: "#6366f1" }}>$9.99/mo</Text>
                </View>
                <View style={{ height: 1, backgroundColor: Colors.border, marginBottom: 10 }} />
                <Text style={{ fontSize: ts.caption, fontFamily: "Inter_500Medium", color: Colors.textSecondary, marginBottom: 6 }}>Usage billed beyond included amounts:</Text>
                <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 4 }}>
                  <Text style={{ fontSize: ts.caption, fontFamily: "Inter_400Regular", color: Colors.textSecondary }}>Per transcription</Text>
                  <Text style={{ fontSize: ts.caption, fontFamily: "Inter_600SemiBold", color: Colors.text }}>${proAccessInfo?.pricing?.transcription?.toFixed(2) || "0.15"}</Text>
                </View>
                <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                  <Text style={{ fontSize: ts.caption, fontFamily: "Inter_400Regular", color: Colors.textSecondary }}>Per conversion</Text>
                  <Text style={{ fontSize: ts.caption, fontFamily: "Inter_600SemiBold", color: Colors.text }}>${proAccessInfo?.pricing?.conversion?.toFixed(2) || "0.10"}</Text>
                </View>
              </View>
              <Text style={{ fontSize: ts.caption, fontFamily: "Inter_400Regular", color: Colors.textSecondary, textAlign: "center", marginTop: 8 }}>
                You can set a spending cap and cancel anytime.
              </Text>
            </View>
            <Pressable
              style={{ backgroundColor: "#6366f1", borderRadius: 12, paddingVertical: 14, alignItems: "center", marginBottom: 10 }}
              onPress={() => proAccessInfo?.onConfirm()}
              accessibilityRole="button"
              accessibilityLabel="Upgrade to Pro"
            >
              <Text style={{ fontSize: ts.bodyLarge, fontFamily: "Inter_600SemiBold", color: "#fff" }}>
                Upgrade — $9.99/mo
              </Text>
            </Pressable>
            <Pressable
              style={{ paddingVertical: 12, alignItems: "center" }}
              onPress={() => { setShowProAccessModal(false); setProAccessInfo(null); }}
              accessibilityRole="button"
              accessibilityLabel="Not now"
            >
              <Text style={{ fontSize: ts.body, fontFamily: "Inter_400Regular", color: Colors.textSecondary }}>
                Not Now
              </Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      <NavigationDrawer
        visible={drawerVisible}
        onClose={() => setDrawerVisible(false)}
        isAdmin={isAdmin}
        isLoggedIn={!!user}
        planLabel={TIER_DISPLAY_NAMES[userTier] || (userTier === "free" ? "Free" : userTier)}
        isPro={userTier !== "free"}
        onFeedback={openFeedback}
        onTypeToConvert={() => {
          setDrawerVisible(false);
          setDetailTab("recording");
        }}
      />

      {/* Feedback icon — bottom-left, same as recording page */}
      <FeedbackIconButton
        hidden={drawerVisible}
        surface="scrolling"
        containerStyle={{ left: containedFeedbackInset }}
      />

      {/* Recorder FAB — bottom-right, same position as pencil FAB on record page */}
      {!feedbackVisible && (
      <View
        pointerEvents="box-none"
        style={[
          styles.composeShortcutWrap,
          {
            bottom:
              insets.bottom +
              getFloatingActionBottomOffset(RECORDING_DETAIL_ACTION_SIZE),
          },
        ]}
      >
        <FloatingActionHalo
          buttonSize={RECORDING_DETAIL_ACTION_SIZE}
          surface="scrolling"
        />
        <Pressable
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            router.push("/record");
          }}
          disabled={!!convertingType}
          style={({ pressed }) => [
            styles.composeShortcut,
            pressed && styles.composeShortcutPressed,
            !!convertingType && styles.composeShortcutDisabled,
          ]}
          accessibilityRole="button"
          accessibilityLabel={language === "es" ? "Grabar audio" : "Record audio"}
        >
          <Feather name="mic" size={20} color={Colors.white} />
        </Pressable>
      </View>
      )}

    </View>
  );
}

const makeStyles = (ts: TextScale) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  downloadToast: {
    position: "absolute",
    bottom: 40,
    left: 16,
    right: 16,
    backgroundColor: Colors.surface,
    borderRadius: 12,
    borderWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 14,
    gap: 10,
    elevation: 4,
    zIndex: 999,
    maxWidth: 400,
    alignSelf: "center",
  },
  downloadToastIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "rgba(74, 222, 128, 0.12)",
    alignItems: "center",
    justifyContent: "center",
  },
  downloadToastText: {
    flex: 1,
    minWidth: 0,
  },
  downloadToastTitle: {
    fontSize: sf(14, ts),
    fontFamily: "Inter_600SemiBold",
    color: Colors.text,
  },
  downloadToastFile: {
    fontSize: sf(12, ts),
    fontFamily: "Inter_400Regular",
    color: Colors.textMuted,
    marginTop: 1,
  },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 14,
  },
  topBarActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 20,
  },
  headerAvatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: "rgba(0, 180, 216, 0.15)",
    justifyContent: "center" as const,
    alignItems: "center" as const,
    overflow: "hidden" as const,
  },
  headerAvatarText: {
    fontFamily: "Inter_700Bold",
    fontSize: sf(26, ts),
    color: Colors.primary,
  },
  iconBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Colors.surface,
    justifyContent: "center",
    alignItems: "center",
  },
  centerContent: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    gap: 16,
  },
  emptyText: {
    fontSize: sf(16, ts),
    fontFamily: "Inter_500Medium",
    color: Colors.textSecondary,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingTop: 12,
  },
  title: {
    fontSize: sf(24, ts),
    fontFamily: "Inter_700Bold",
    color: Colors.text,
    letterSpacing: -0.5,
    marginBottom: 6,
  },
  dateLine: {
    fontSize: sf(13, ts),
    fontFamily: "Inter_400Regular",
    color: Colors.textMuted,
    marginBottom: 24,
  },
  playerCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 16,
    marginBottom: 28,
    borderWidth: 0,
  },
  playBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: Colors.primaryButton,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 14,
  },
  playerInfo: {
    flex: 1,
  },
  waveformPlaceholder: {
    flexDirection: "row",
    alignItems: "center",
    height: 30,
    gap: 2,
  },
  waveBar: {
    width: 3,
    borderRadius: 1.5,
  },
  playerBottom: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 6,
  },
  playerDuration: {
    fontSize: sf(12, ts),
    fontFamily: "Inter_500Medium",
    color: Colors.textMuted,
  },
  playerActions: {
    flexDirection: "row",
    gap: 4,
  },
  playerActionBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Colors.surfaceHighlight,
    justifyContent: "center",
    alignItems: "center",
  },
  transcriptActions: {
    flexDirection: "row",
    gap: 4,
  },
  transcriptActionBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Colors.surface,
    justifyContent: "center",
    alignItems: "center",
  },
  detailActionRow: {
    flexDirection: "row",
    gap: 12,
    paddingTop: 7,
    paddingBottom: 25,
  },
  detailActionBtn: {
    flex: 1,
    minHeight: 64,
    borderRadius: 16,
    backgroundColor: Colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 14,
  },
  sectionTitle: {
    fontSize: sf(18, ts),
    fontFamily: "Inter_600SemiBold",
    color: Colors.text,
  },
  transcribingCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 20,
    gap: 12,
    borderWidth: 0,
    marginBottom: 28,
  },
  transcribingLabel: {
    fontSize: sf(14, ts),
    fontFamily: "Inter_500Medium",
    color: Colors.primary,
  },
  transcriptCard: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 16,
    borderWidth: 0,
    marginBottom: 28,
  },
  transcriptText: {
    fontSize: sf(16, ts),
    fontFamily: "Inter_400Regular",
    color: Colors.text,
    lineHeight: 27,
    letterSpacing: 0.2,
    includeFontPadding: false,
  },
  readMoreButton: {
    alignSelf: "flex-start",
    marginTop: 10,
    paddingVertical: 4,
  },
  readMoreText: {
    fontSize: sf(13, ts),
    fontFamily: "Inter_600SemiBold",
    color: Colors.primary,
  },
  transcriptMeasurer: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    opacity: 0,
  },
  noTranscriptText: {
    fontSize: sf(14, ts),
    fontFamily: "Inter_400Regular",
    color: Colors.textMuted,
    fontStyle: "italic",
  },
  addConvertBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: Colors.primary,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 0,
  },
  convertingCard: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 16,
    borderWidth: 0,
    marginBottom: 14,
  },
  convertingHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 12,
  },
  convertingLabel: {
    fontSize: sf(14, ts),
    fontFamily: "Inter_500Medium",
    color: Colors.primary,
  },
  conversionStageLabel: {
    fontSize: sf(12, ts),
    fontFamily: "Inter_400Regular",
    color: Colors.textMuted,
    marginTop: 2,
  },
  conversionStageVerb: {
    fontSize: sf(12, ts),
    fontFamily: "Inter_400Regular",
    fontStyle: "italic",
    color: Colors.textMuted,
    opacity: 0.75,
    marginTop: 2,
  },
  conversionErrorCard: {
    backgroundColor: "#FEF2F2",
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: "#FCA5A5",
    marginBottom: 14,
  },
  conversionErrorHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  conversionErrorIconWrap: {
    marginTop: 2,
  },
  conversionErrorTitle: {
    fontSize: sf(14, ts),
    fontFamily: "Inter_600SemiBold",
    color: "#991B1B",
    marginBottom: 4,
  },
  conversionErrorMessage: {
    fontSize: sf(13, ts),
    fontFamily: "Inter_400Regular",
    color: "#7F1D1D",
    lineHeight: 18,
  },
  conversionErrorActions: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 10,
    marginTop: 14,
  },
  conversionRetryBtn: {
    backgroundColor: "#DC2626",
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
  },
  conversionRetryBtnText: {
    fontSize: sf(13, ts),
    fontFamily: "Inter_600SemiBold",
    color: "#FFFFFF",
  },
  conversionDismissBtn: {
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  conversionDismissBtnText: {
    fontSize: sf(13, ts),
    fontFamily: "Inter_500Medium",
    color: "#7F1D1D",
  },
  streamingText: {
    fontSize: sf(14, ts),
    fontFamily: "Inter_400Regular",
    color: Colors.text,
    lineHeight: 22,
  },
  finalArtifactNote: {
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  finalArtifactText: {
    flex: 1,
    fontSize: sf(12, ts),
    fontFamily: "Inter_500Medium",
    color: Colors.textSecondary,
    lineHeight: 17,
  },
  tabBar: {
    flexDirection: "row",
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 4,
    marginTop: 12,
    marginBottom: 24,
    borderWidth: 0,
  },
  tabItem: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 10,
    borderRadius: 10,
  },
  tabItemActive: {
    backgroundColor: "rgba(0, 180, 216, 0.12)",
  },
  tabLabel: {
    fontSize: sf(14, ts),
    fontFamily: "Inter_500Medium",
    color: Colors.textMuted,
  },
  tabLabelActive: {
    color: Colors.primary,
    fontFamily: "Inter_600SemiBold",
  },
  convertSearchWrap: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.background,
    borderRadius: 10,
    paddingHorizontal: 12,
    marginBottom: 12,
    gap: 8,
  },
  convertSearchInput: {
    flex: 1,
    height: 38,
    color: Colors.text,
    fontSize: sf(14, ts),
    fontFamily: "Inter_400Regular",
  },
  conversionExpandedActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 8,
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  conversionExpandedBtn: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: "rgba(0, 180, 216, 0.08)",
    justifyContent: "center",
    alignItems: "center",
  },
  sendToBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: "rgba(0, 180, 216, 0.1)",
    marginLeft: 4,
  },
  sendToBtnText: {
    fontSize: sf(13, ts),
    fontFamily: "Inter_600SemiBold",
    color: Colors.primary,
  },
  emptyConversions: {
    alignItems: "center",
    paddingVertical: 40,
    gap: 12,
  },
  emptyConversionsIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: "rgba(255, 255, 255, 0.04)",
    borderWidth: 0,
    justifyContent: "center",
    alignItems: "center",
  },
  emptyConversionsHint: {
    fontSize: sf(13, ts),
    fontFamily: "Inter_400Regular",
    color: Colors.textMuted,
  },
  conversionCard: {
    paddingVertical: 14,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(30, 51, 85, 0.4)",
    marginBottom: 2,
  },
  conversionHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 6,
  },
  conversionIconWrap: {
    width: 28,
    height: 28,
    borderRadius: 7,
    backgroundColor: "rgba(0, 180, 216, 0.08)",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 10,
  },
  conversionLabel: {
    fontSize: sf(15, ts),
    fontFamily: "Inter_600SemiBold",
    color: Colors.text,
    flex: 1,
  },
  conversionActions: {
    flexDirection: "row",
    gap: 4,
  },
  conversionActionBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: "center",
    alignItems: "center",
  },
  conversionPreview: {
    fontSize: sf(13, ts),
    fontFamily: "Inter_400Regular",
    color: Colors.textSecondary,
    lineHeight: 20,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: Colors.overlay,
    justifyContent: "flex-end",
  },
  modalOverlayCentered: {
    justifyContent: "center",
    alignItems: "center",
    padding: 32,
  },
  convertMenuHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    marginBottom: 12,
  },
  convertMenuHeaderText: {
    flex: 1,
    minWidth: 0,
  },
  menuSheet: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingBottom: 40,
    maxHeight: "80%",
  },
  convertMenuSheet: {
    paddingTop: 12,
    paddingBottom: 24,
    maxHeight: "86%",
  },
  menuSheetCentered: {
    borderRadius: 20,
    maxWidth: 480,
    width: "100%",
    maxHeight: "85%",
    borderWidth: 0,
  },
  thoughtThreadChoiceSheet: {
    paddingTop: 18,
    paddingBottom: 24,
    maxHeight: "80%",
  },
  thoughtThreadChoiceScroll: {
    maxHeight: 440,
  },
  thoughtThreadChoiceContent: {
    gap: 6,
    paddingBottom: 8,
  },
  thoughtThreadChoiceRow: {
    minHeight: 64,
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  thoughtThreadChoiceMeta: {
    color: Colors.textMuted,
    fontFamily: "Inter_400Regular",
    fontSize: sf(12, ts),
  },
  thoughtThreadChoiceCancel: {
    minHeight: 48,
    marginTop: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  thoughtThreadChoiceCancelText: {
    color: Colors.textSecondary,
    fontFamily: "Inter_600SemiBold",
    fontSize: sf(14, ts),
  },
  convertMenuSheetCentered: {
    width: "92%",
    maxWidth: 760,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
    paddingHorizontal: 24,
  },
  menuHandleTouchZone: {
    alignSelf: "stretch",
    alignItems: "center",
    paddingVertical: 10,
    marginTop: -10,
  },
  menuHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.surfaceHighlight,
    alignSelf: "center",
    marginTop: 12,
    marginBottom: 20,
  },
  menuTitle: {
    fontSize: sf(20, ts),
    fontFamily: "Inter_700Bold",
    color: Colors.text,
    marginBottom: 4,
  },
  convertMenuTitle: {
    marginBottom: 6,
  },
  convertMenuSubtitle: {
    fontSize: sf(13, ts),
    fontFamily: "Inter_400Regular",
    color: Colors.textSecondary,
    lineHeight: 20,
  },
  convertMenuCloseBtn: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: Colors.surfaceHighlight,
    justifyContent: "center",
    alignItems: "center",
  },
  deckPickerSheet: {
    maxHeight: "88%",
  },
  deckPickerGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
    paddingBottom: 16,
    paddingHorizontal: 2,
  },
  deckStyleCard: {
    width: "48%",
    flexGrow: 1,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surfaceLight,
    padding: 10,
    marginBottom: 12,
  },
  deckStyleCardSelected: {
    borderColor: Colors.primary,
    borderWidth: 2,
    backgroundColor: "rgba(0, 180, 216, 0.08)",
  },
  deckStylePreview: {
    height: 86,
    borderRadius: 10,
    overflow: "hidden",
    padding: 12,
    justifyContent: "flex-end",
    gap: 5,
  },
  deckStylePreviewBar: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 5,
  },
  deckStylePreviewTitle: {
    height: 9,
    width: "70%",
    borderRadius: 2,
    marginBottom: 2,
  },
  deckStylePreviewBullet: {
    height: 6,
    width: "90%",
    borderRadius: 2,
  },
  deckStyleName: {
    marginTop: 8,
    fontSize: sf(13, ts),
    fontFamily: "Inter_600SemiBold",
    color: Colors.text,
  },
  deckPickerFooter: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 12,
    paddingTop: 14,
    paddingBottom: 22,
    borderTopWidth: 1,
    borderTopColor: "rgba(30, 51, 85, 0.35)",
  },
  deckPickerCancelBtn: {
    paddingVertical: 14,
    paddingHorizontal: 20,
    justifyContent: "center",
    alignItems: "center",
    borderRadius: 12,
    backgroundColor: Colors.surfaceLight,
  },
  deckPickerCancelBtnText: {
    fontFamily: "Inter_600SemiBold",
    color: Colors.textSecondary,
    fontSize: sf(14, ts),
  },
  deckPickerGenerateBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: Colors.primary,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 20,
  },
  deckPickerGenerateBtnDisabled: {
    opacity: 0.5,
  },
  deckPickerGenerateBtnText: {
    fontFamily: "Inter_600SemiBold",
    color: Colors.white,
    fontSize: sf(14, ts),
  },
  menuSubtitle: {
    fontSize: sf(14, ts),
    fontFamily: "Inter_400Regular",
    color: Colors.textSecondary,
    marginBottom: 20,
  },
  convertMenuScroll: {
    maxHeight: 460,
  },
  convertMenuScrollDesktop: {
    maxHeight: 600,
  },
  convertMenuScrollContent: {
    paddingBottom: 8,
  },
  menuItem: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingVertical: 14,
    paddingHorizontal: 4,
    borderRadius: 12,
    minHeight: 44,
  },
  menuItemPressed: {
    backgroundColor: Colors.surfaceHighlight,
  },
  menuItemDone: {
    opacity: 0.6,
  },
  menuIcon: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: "rgba(0, 180, 216, 0.12)",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 14,
  },
  menuIconDone: {
    backgroundColor: "rgba(74, 222, 128, 0.12)",
  },
  menuLabel: {
    fontSize: sf(16, ts),
    fontFamily: "Inter_500Medium",
    color: Colors.text,
    flex: 1,
    flexShrink: 1,
    lineHeight: 22,
  },
  menuTextColumn: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  menuLabelDone: {
    color: Colors.textSecondary,
  },
  menuDoneLabel: {
    fontSize: sf(12, ts),
    fontFamily: "Inter_500Medium",
    color: Colors.success,
  },
  menuMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  menuMetaLabel: {
    fontSize: sf(11, ts),
    fontFamily: "Inter_500Medium",
    color: Colors.textMuted,
  },
  categoryHeader: {
    fontSize: sf(11, ts),
    fontFamily: "Inter_700Bold",
    color: Colors.textMuted,
    textTransform: "uppercase",
    letterSpacing: 1,
    marginTop: 14,
    marginBottom: 6,
    paddingHorizontal: 4,
  },
  complexitySection: {
    marginBottom: 2,
  },
  sectionHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 6,
    paddingTop: 14,
    paddingBottom: 6,
  },
  sectionAccentDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
  },
  sectionHeaderLabel: {
    fontSize: sf(11, ts),
    fontFamily: "Inter_700Bold",
    textTransform: "uppercase",
    letterSpacing: 1,
    flex: 1,
  },
  sectionDonePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    backgroundColor: "rgba(74, 222, 128, 0.1)",
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  sectionDonePillText: {
    fontSize: sf(10, ts),
    fontFamily: "Inter_500Medium",
    color: Colors.success,
  },
  citationHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    marginTop: 16,
    marginBottom: 8,
  },
  citationBackBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Colors.surfaceHighlight,
    justifyContent: "center",
    alignItems: "center",
    marginTop: 2,
  },
  citationHeaderText: {
    flex: 1,
  },
  citationList: {
    maxHeight: 400,
  },
  citationItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderRadius: 12,
    marginBottom: 2,
    minHeight: 44,
  },
  citationItemLeft: {
    flex: 1,
    marginRight: 8,
  },
  citationItemLabel: {
    fontSize: sf(15, ts),
    fontFamily: "Inter_600SemiBold",
    color: Colors.text,
    marginBottom: 2,
  },
  citationItemDesc: {
    fontSize: sf(12, ts),
    fontFamily: "Inter_400Regular",
    color: Colors.textMuted,
  },
  fullModalOverlay: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  fullModal: {
    flex: 1,
  },
  fullModalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  fullModalTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
    minWidth: 0,
    gap: 10,
  },
  fullModalBackBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.surfaceHighlight,
    justifyContent: "center",
    alignItems: "center",
    flexShrink: 0,
  },
  fullModalTitle: {
    fontSize: sf(18, ts),
    fontFamily: "Inter_600SemiBold",
    color: Colors.text,
    flex: 1,
    flexShrink: 1,
  },
  fullModalActionsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 4,
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  fullModalScroll: {
    flex: 1,
  },
  fullModalContent: {
    padding: 20,
  },
  fullModalText: {
    fontSize: sf(15, ts),
    fontFamily: "Inter_400Regular",
    color: Colors.text,
    lineHeight: 26,
  },
  formatModalOverlay: {
    flex: 1,
    backgroundColor: Colors.overlay,
    justifyContent: "center",
    alignItems: "center",
    padding: 32,
  },
  formatModalContent: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    width: "100%",
    maxWidth: 340,
    borderWidth: 0,
    overflow: "hidden",
  },
  formatModalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  formatModalTitle: {
    fontSize: sf(17, ts),
    fontFamily: "Inter_700Bold",
    color: Colors.text,
  },
  formatOption: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    minHeight: 44,
  },
  formatOptionPressed: {
    backgroundColor: Colors.surfaceHighlight,
  },
  formatLabel: {
    fontSize: sf(15, ts),
    fontFamily: "Inter_500Medium",
    color: Colors.text,
  },
  aiPickerHint: {
    fontSize: sf(13, ts),
    fontFamily: "Inter_400Regular",
    color: Colors.textSecondary,
    paddingHorizontal: 20,
    paddingBottom: 8,
    lineHeight: 19,
  },
  aiRecopyBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginHorizontal: 20,
    marginTop: 12,
    marginBottom: 16,
    paddingVertical: 10,
    minHeight: 44,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.primary,
  },
  aiRecopyText: {
    fontSize: sf(13, ts),
    fontFamily: "Inter_500Medium",
    color: Colors.primary,
  },
  toggleBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    minHeight: 44,
  },
  toggleTrack: {
    width: 40,
    height: 22,
    borderRadius: 11,
    backgroundColor: Colors.surfaceHighlight,
    justifyContent: "center",
    paddingHorizontal: 2,
  },
  toggleTrackActive: {
    backgroundColor: Colors.primaryButton,
  },
  toggleThumb: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: Colors.textMuted,
  },
  toggleThumbActive: {
    alignSelf: "flex-end",
    backgroundColor: Colors.white,
  },
  toggleLabel: {
    fontSize: sf(12, ts),
    fontFamily: "Inter_500Medium",
    color: Colors.textMuted,
  },
  toggleLabelActive: {
    color: Colors.primary,
  },
  customTextCard: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    borderWidth: 0,
    marginBottom: 12,
  },
  contextHelpText: {
    marginTop: 3,
    fontSize: sf(12, ts),
    lineHeight: 17,
    fontFamily: "Inter_400Regular",
    color: Colors.textMuted,
  },
  customTextInput: {
    color: Colors.text,
    fontFamily: "Inter_400Regular",
    fontSize: sf(14, ts),
    lineHeight: 22,
    padding: 14,
    minHeight: 120,
    maxHeight: 240,
    outlineStyle: "none" as any,
    outlineWidth: 0 as any,
  },
  customTextCountRow: {
    flexDirection: "row" as const,
    justifyContent: "flex-end" as const,
    paddingHorizontal: 14,
    paddingBottom: 6,
    gap: 8,
  },
  customTextCount: {
    fontSize: sf(11, ts),
    fontFamily: "Inter_400Regular",
    color: Colors.textMuted,
    textAlign: "right" as const,
  },
  customTextMinHint: {
    fontSize: sf(11, ts),
    fontFamily: "Inter_400Regular",
    color: Colors.warning || "#F59E0B",
    paddingHorizontal: 14,
    paddingBottom: 10,
  },
  customTextMaxWarning: {
    fontSize: sf(11, ts),
    fontFamily: "Inter_400Regular",
    color: Colors.error || "#EF4444",
    paddingHorizontal: 14,
    paddingBottom: 10,
  },
  sourceReferenceCard: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 14,
    marginBottom: 14,
  },
  sourceReferenceHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 8,
  },
  sourceReferenceTitleWrap: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  sourceReferenceTitle: {
    flex: 1,
    minWidth: 0,
    fontSize: sf(13, ts),
    fontFamily: "Inter_600SemiBold",
    color: Colors.text,
  },
  sourceReferenceActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  sourceReferenceActionBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0, 180, 216, 0.12)",
  },
  sourceReferenceText: {
    fontSize: sf(13, ts),
    lineHeight: 20,
    fontFamily: "Inter_400Regular",
    color: Colors.textSecondary,
  },
  sourceAttachmentList: {
    gap: 8,
    marginBottom: 8,
  },
  sourceAttachmentChip: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: Colors.surface,
  },
  sourceAttachmentName: {
    flex: 1,
    minWidth: 0,
    fontSize: sf(13, ts),
    fontFamily: "Inter_500Medium",
    color: Colors.textSecondary,
  },
  sourceAttachmentEditTarget: {
    flex: 1,
    minWidth: 0,
    minHeight: 32,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  sourceAttachmentAction: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 22,
  },
  uploadIconButton: {
    alignSelf: "center",
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginTop: 4,
    marginBottom: 8,
    borderRadius: 22,
    backgroundColor: Colors.surface,
  },
  uploadContextLabel: {
    fontSize: sf(13, ts),
    fontFamily: "Inter_600SemiBold",
    color: Colors.primary,
  },
  mdPromptSheet: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 24,
    paddingBottom: 32,
    position: "absolute" as const,
    bottom: 0,
    left: 0,
    right: 0,
  },
  fileContextEditorSheet: {
    paddingTop: 18,
    paddingBottom: 24,
    maxHeight: "90%",
  },
  fileContextEditorName: {
    color: Colors.primary,
    fontFamily: "Inter_600SemiBold",
    fontSize: sf(13, ts),
    marginBottom: 6,
  },
  fileContextEditorInput: {
    minHeight: 220,
    maxHeight: 440,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.background,
    color: Colors.text,
    fontFamily: "Inter_400Regular",
    fontSize: sf(13, ts),
    lineHeight: 20,
    padding: 12,
    outlineStyle: "none" as any,
    outlineWidth: 0 as any,
  },
  fileContextEditorActions: {
    flexDirection: "row",
    gap: 12,
    marginTop: 14,
  },
  fileContextEditorCount: {
    color: Colors.textMuted,
    fontFamily: "Inter_400Regular",
    fontSize: sf(11, ts),
    textAlign: "right",
    marginTop: 6,
  },
  mdPromptSheetCentered: {
    position: "relative" as const,
    bottom: "auto" as any,
    left: "auto" as any,
    right: "auto" as any,
    borderRadius: 16,
    maxWidth: 400,
    width: "90%" as any,
  },
  mdPromptTitle: {
    fontSize: sf(17, ts),
    fontFamily: "Inter_600SemiBold",
    color: Colors.text,
    marginBottom: 8,
  },
  mdPromptSubtitle: {
    fontSize: sf(14, ts),
    fontFamily: "Inter_400Regular",
    color: Colors.textSecondary,
    marginBottom: 20,
  },
  mdPromptButtons: {
    flexDirection: "row" as const,
    gap: 12,
  },
  mdPromptBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: "center" as const,
  },
  mdPromptBtnOutline: {
    backgroundColor: Colors.surfaceLight,
  },
  mdPromptBtnFilled: {
    backgroundColor: Colors.primaryButton,
  },
  mdPromptBtnTextOutline: {
    fontSize: sf(14, ts),
    fontFamily: "Inter_500Medium",
    color: Colors.text,
  },
  mdPromptBtnTextFilled: {
    fontSize: sf(14, ts),
    fontFamily: "Inter_500Medium",
    color: "#FFFFFF",
  },
  clarifyToggleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 10,
    paddingHorizontal: 4,
    marginBottom: 4,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  clarifyToggleInfo: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  clarifyToggleLabel: {
    fontSize: sf(14, ts),
    fontFamily: "Inter_500Medium",
    color: Colors.textSecondary,
  },
  clarifyToggleHint: {
    fontSize: sf(11, ts),
    fontFamily: "Inter_400Regular",
    color: Colors.textMuted,
    marginLeft: -4,
    flexShrink: 1,
  },
  clarifyLoadingContainer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    paddingVertical: 40,
  },
  clarifyLoadingText: {
    fontSize: sf(15, ts),
    fontFamily: "Inter_500Medium",
    color: Colors.textSecondary,
  },
  clarifyLoadingVerb: {
    fontSize: sf(13, ts),
    fontFamily: "Inter_400Regular",
    fontStyle: "italic",
    color: Colors.textMuted,
    opacity: 0.75,
    marginTop: 4,
  },
  clarifyHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    marginTop: 16,
    marginBottom: 12,
  },
  clarifyScrollView: {
    maxHeight: 400,
  },
  clarifyQuestionCard: {
    backgroundColor: Colors.surfaceHighlight,
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
  },
  clarifyQuestionText: {
    fontSize: sf(14, ts),
    fontFamily: "Inter_500Medium",
    color: Colors.text,
    marginBottom: 10,
    lineHeight: 20,
  },
  clarifyAnswerInput: {
    backgroundColor: Colors.background,
    borderRadius: 8,
    color: Colors.text,
    fontFamily: "Inter_400Regular",
    fontSize: sf(14, ts),
    padding: 12,
    minHeight: 44,
    maxHeight: 100,
    outlineStyle: "none" as any,
    outlineWidth: 0 as any,
  },
  clarifyActions: {
    flexDirection: "row",
    gap: 12,
    marginTop: 8,
    paddingBottom: 8,
  },
  clarifySkipBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: Colors.surfaceHighlight,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 44,
  },
  clarifySkipText: {
    fontSize: sf(15, ts),
    fontFamily: "Inter_600SemiBold",
    color: Colors.textSecondary,
  },
  clarifySubmitBtn: {
    flex: 2,
    flexDirection: "row",
    gap: 8,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: Colors.primaryButton,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 44,
  },
  clarifySubmitText: {
    fontSize: sf(15, ts),
    fontFamily: "Inter_600SemiBold",
    color: "#fff",
  },
  composeShortcut: {
    width: RECORDING_DETAIL_ACTION_SIZE,
    height: RECORDING_DETAIL_ACTION_SIZE,
    borderRadius: RECORDING_DETAIL_ACTION_SIZE / 2,
    backgroundColor: Colors.primary,
    alignItems: "center",
    justifyContent: "center",
    ...Platform.select({
      ios: {
        shadowColor: Colors.primary,
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.25,
        shadowRadius: 14,
      },
      android: {
        elevation: 8,
      },
      web: {
        boxShadow: "0 10px 28px rgba(0, 180, 216, 0.28)",
      },
    }),
  },
  composeShortcutWrap: {
    position: "absolute",
    right: 20,
    alignItems: "center",
  },
  composeShortcutPressed: {
    transform: [{ scale: 0.94 }],
  },
  composeShortcutDisabled: {
    opacity: 0.55,
  },
});
