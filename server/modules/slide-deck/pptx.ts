// PPTX assembly for Slide Deck conversions (pptxgenjs v4).
// Renders a DeckDocument with a chosen DeckStyle preset into a real .pptx
// buffer. Layout is 16:9 (13.33 x 7.5 in). Style-driven, NOT Proset's theme.
import PptxGenJS from "pptxgenjs";
import type { DeckDocument, DeckStyle } from "@shared/deck-styles";

const SLIDE_W = 13.33;
const SLIDE_H = 7.5;
const MARGIN = 0.7;

const hex = (color: string): string => color.replace(/^#/, "");

interface SlideSpec {
  kind: "title" | "section" | "content" | "closing";
  title: string;
  bullets?: string[];
  notes?: string;
  footer?: string;
  pageNumber?: number;
}

export async function assembleDeckPptx(deck: DeckDocument, style: DeckStyle): Promise<Buffer> {
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: "PROSET_DECK", width: SLIDE_W, height: SLIDE_H });
  pptx.layout = "PROSET_DECK";

  const p = style.palette;
  const total = deck.slides.length;

  deck.slides.forEach((slide, index) => {
    const spec: SlideSpec = {
      kind: slide.kind,
      title: slide.title,
      bullets: slide.bullets,
      notes: slide.notes,
      footer: deck.title,
      pageNumber: index + 1,
    };
    renderSlide(pptx, spec, style, index === 0, total);
  });

  const out = await pptx.write({ outputType: "nodebuffer" });
  return Buffer.from(out as Uint8Array);
}

function renderSlide(
  pptx: PptxGenJS,
  slide: SlideSpec,
  style: DeckStyle,
  isFirst: boolean,
  totalSlides: number,
): void {
  const p = style.palette;
  const s = pptx.addSlide();
  const isDark = isDarkBackground(p.background);

  switch (slide.kind) {
    case "title":
      renderTitleSlide(s, slide, style);
      break;
    case "section":
      renderSectionSlide(s, slide, style);
      break;
    case "closing":
      renderClosingSlide(s, slide, style);
      break;
    default:
      renderContentSlide(s, slide, style);
  }

  if (slide.notes) {
    s.addNotes(slide.notes);
  }
  // Muted page footer on light content slides only (dark/first slides skip it).
  if (slide.kind === "content" && !isDark && !isFirst) {
    s.addText(slide.footer || "", {
      x: MARGIN, y: SLIDE_H - 0.45, w: 6, h: 0.3,
      fontFace: style.fonts.body, fontSize: 10, color: hex(p.muted), align: "left",
    });
    s.addText(String(slide.pageNumber ?? ""), {
      x: SLIDE_W - MARGIN - 1, y: SLIDE_H - 0.45, w: 1, h: 0.3,
      fontFace: style.fonts.body, fontSize: 10, color: hex(p.muted), align: "right",
    });
  }
}

function renderTitleSlide(s: any, slide: SlideSpec, style: DeckStyle): void {
  const p = style.palette;
  s.background = { color: hex(p.backgroundAlt) };
  // Accent vertical bar on the left
  s.addShape("rect", {
    x: 0, y: 0, w: 0.18, h: SLIDE_H,
    fill: { color: hex(p.accent) }, line: { type: "none" },
  });
  s.addText(slide.title, {
    x: 1.1, y: 2.2, w: SLIDE_W - 2.2, h: 1.6,
    fontFace: style.fonts.heading, fontSize: 40, bold: true, color: hex(p.text),
    align: "left", valign: "top", breakLine: true,
  });
  if (slide.bullets?.length) {
    s.addText(slide.bullets.slice(0, 2).join("  ·  "), {
      x: 1.1, y: 3.9, w: SLIDE_W - 2.2, h: 0.6,
      fontFace: style.fonts.body, fontSize: 16, color: hex(p.muted), align: "left",
    });
  }
  s.addShape("rect", {
    x: 1.1, y: 4.7, w: 1.6, h: 0.07,
    fill: { color: hex(p.accent) }, line: { type: "none" },
  });
}

function renderSectionSlide(s: any, slide: SlideSpec, style: DeckStyle): void {
  const p = style.palette;
  s.background = { color: hex(p.backgroundAlt) };
  s.addShape("rect", {
    x: 0, y: 0, w: SLIDE_W, h: 0.12,
    fill: { color: hex(p.accent) }, line: { type: "none" },
  });
  s.addText(slide.title, {
    x: 1.2, y: 2.7, w: SLIDE_W - 2.4, h: 1.8,
    fontFace: style.fonts.heading, fontSize: 36, bold: true, color: hex(p.text),
    align: "left", valign: "top", breakLine: true,
  });
}

function renderClosingSlide(s: any, slide: SlideSpec, style: DeckStyle): void {
  const p = style.palette;
  s.background = { color: hex(p.backgroundAlt) };
  s.addText(slide.title || "Thank you", {
    x: 1.2, y: 2.9, w: SLIDE_W - 2.4, h: 1.4,
    fontFace: style.fonts.heading, fontSize: 38, bold: true, color: hex(p.text),
    align: "center", valign: "middle",
  });
  s.addShape("rect", {
    x: SLIDE_W / 2 - 0.8, y: 4.4, w: 1.6, h: 0.07,
    fill: { color: hex(p.accent) }, line: { type: "none" },
  });
}

function renderContentSlide(s: any, slide: SlideSpec, style: DeckStyle): void {
  const p = style.palette;
  s.background = { color: hex(p.background) };
  // Slide title + accent underline
  s.addText(slide.title, {
    x: MARGIN, y: 0.55, w: SLIDE_W - MARGIN * 2, h: 0.9,
    fontFace: style.fonts.heading, fontSize: 30, bold: true, color: hex(p.text),
    align: "left", valign: "middle", breakLine: true,
  });
  s.addShape("rect", {
    x: MARGIN, y: 1.5, w: 1.5, h: 0.06,
    fill: { color: hex(p.accent) }, line: { type: "none" },
  });

  const bullets = (slide.bullets || []).slice(0, 6);
  if (bullets.length > 0) {
    s.addText(bullets.map((b) => ({ text: b, options: { breakLine: true } })), {
      x: MARGIN, y: 1.95, w: SLIDE_W - MARGIN * 2, h: 4.7,
      fontFace: style.fonts.body, fontSize: 18, color: hex(p.text),
      align: "left", valign: "top",
      bullet: { code: "2022", indent: 14 },
      bulletColor: hex(p.accent),
      paraSpaceAfter: 10,
      lineSpacingMultiple: 1.15,
    });
  }
}

/** Rough luminance check — dark backgrounds skip the footer and use light text on alt slides. */
function isDarkBackground(hexColor: string): boolean {
  const c = hexColor.replace(/^#/, "");
  const r = parseInt(c.slice(0, 2), 16);
  const g = parseInt(c.slice(2, 4), 16);
  const b = parseInt(c.slice(4, 6), 16);
  return 0.299 * r + 0.587 * g + 0.114 * b < 140;
}
