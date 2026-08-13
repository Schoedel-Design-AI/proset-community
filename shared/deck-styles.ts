// Deck style presets for the Slide Deck conversion type.
// These are PROFESSIONAL PRESENTATION looks (the deck-tool design language,
// NOT Proset's flat dark theme) — the user picks one before generation and
// the server assembles the .pptx with the chosen palette + fonts.
// Shared by the client (style picker UI) and the server (pptx assembler).

export interface DeckStyle {
  id: string;
  /** i18n key suffix: deck.style.<id> */
  labelKey: string;
  palette: {
    background: string;      // slide background
    backgroundAlt: string;   // alternate surface (title slide, section bg)
    text: string;            // primary text
    muted: string;           // secondary/muted text
    accent: string;          // primary accent (bars, highlights)
    accent2: string;         // secondary accent
    divider: string;         // thin rule color
  };
  fonts: {
    heading: string;         // font family for slide titles
    body: string;            // font family for body/bullets
  };
}

export const DECK_STYLES: DeckStyle[] = [
  {
    id: "executive-navy",
    labelKey: "executiveNavy",
    palette: {
      background: "#FFFFFF",
      backgroundAlt: "#1B2A4A",
      text: "#1F2A44",
      muted: "#5A6478",
      accent: "#2E5EAA",
      accent2: "#7FA8D9",
      divider: "#D8DEE9",
    },
    fonts: { heading: "Calibri", body: "Calibri" },
  },
  {
    id: "vibrant",
    labelKey: "vibrant",
    palette: {
      background: "#6D28D9",
      backgroundAlt: "#4C1D95",
      text: "#FFFFFF",
      muted: "#E9D5FF",
      accent: "#FBBF24",
      accent2: "#F472B6",
      divider: "#A78BFA",
    },
    fonts: { heading: "Arial", body: "Arial" },
  },
  {
    id: "minimal-light",
    labelKey: "minimalLight",
    palette: {
      background: "#FAFAFA",
      backgroundAlt: "#111111",
      text: "#111111",
      muted: "#8A8A8A",
      accent: "#111111",
      accent2: "#B4B4B4",
      divider: "#E5E5E5",
    },
    fonts: { heading: "Arial", body: "Arial" },
  },
  {
    id: "academic-serif",
    labelKey: "academicSerif",
    palette: {
      background: "#F7F2E7",
      backgroundAlt: "#26241F",
      text: "#26241F",
      muted: "#6E6A5E",
      accent: "#8C1D18",
      accent2: "#C9A227",
      divider: "#E0D9C7",
    },
    fonts: { heading: "Georgia", body: "Georgia" },
  },
  {
    id: "bold-impact",
    labelKey: "boldImpact",
    palette: {
      background: "#0E0E0E",
      backgroundAlt: "#FFD100",
      text: "#FFFFFF",
      muted: "#B8B8B8",
      accent: "#FFD100",
      accent2: "#FFFFFF",
      divider: "#3A3A3A",
    },
    fonts: { heading: "Arial Black", body: "Arial" },
  },
  {
    id: "forest-fresh",
    labelKey: "forestFresh",
    palette: {
      background: "#EEF5EF",
      backgroundAlt: "#17351F",
      text: "#17351F",
      muted: "#5C7A66",
      accent: "#2F855A",
      accent2: "#9AE6B4",
      divider: "#D3E4D7",
    },
    fonts: { heading: "Verdana", body: "Verdana" },
  },
];

export function getDeckStyle(id: string): DeckStyle | undefined {
  return DECK_STYLES.find((s) => s.id === id);
}

export interface DeckSlide {
  /** Slide kind: title | section | content | closing */
  kind: "title" | "section" | "content" | "closing";
  title: string;
  bullets?: string[];
  notes?: string;
}

export interface DeckDocument {
  title: string;
  subtitle?: string;
  slides: DeckSlide[];
}

/** Abuse/cost controls for deck generation (server-enforced). */
export const DECK_LIMITS = {
  basePerMonth: 2,
  proPerMonth: 5,
  globalPerDay: 10,
  minSlides: 5,
  maxSlides: 15,
  maxTranscriptChars: 8000,
} as const;
