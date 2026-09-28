import { useWindowDimensions } from "react-native";

export type Breakpoint = "mobile" | "tablet" | "desktop";

export interface ResponsiveLayout {
  width: number;
  height: number;
  breakpoint: Breakpoint;
  contentMaxWidth: number;
  contentPadding: number;
  columns: number;
  isMobile: boolean;
  isTablet: boolean;
  isDesktop: boolean;
}

export function useResponsiveLayout(): ResponsiveLayout {
  const { width, height } = useWindowDimensions();

  let breakpoint: Breakpoint;
  let contentMaxWidth: number;
  let contentPadding: number;
  let columns: number;

  if (width >= 1024) {
    breakpoint = "desktop";
    contentMaxWidth = 840;
    contentPadding = 32;
    columns = 2;
  } else if (width >= 600) {
    breakpoint = "tablet";
    contentMaxWidth = 640;
    contentPadding = 24;
    columns = 2;
  } else {
    breakpoint = "mobile";
    contentMaxWidth = width;
    contentPadding = 16;
    columns = 1;
  }

  return {
    width,
    height,
    breakpoint,
    contentMaxWidth,
    contentPadding,
    columns,
    isMobile: breakpoint === "mobile",
    isTablet: breakpoint === "tablet",
    isDesktop: breakpoint === "desktop",
  };
}

/**
 * Right inset, measured from the WINDOW edge, that lands an absolutely
 * positioned overlay under a header row built as
 * `maxWidth: contentMaxWidth; alignSelf: "center"; width: "100%";
 * paddingHorizontal: contentPadding`.
 *
 * `contentPadding` alone is the row's own horizontal padding, so it is the
 * correct inset only when the overlay's positioning parent IS the centred
 * column (an app shell with `maxWidth`, where the row's right edge is
 * `contentPadding` from the parent's right edge). When the positioning parent
 * instead spans the window — the app root container, with the row centred
 * inside it via `maxWidth` — the row's right edge sits further in by the
 * centring offset `(width - min(width, contentMaxWidth)) / 2`, and a bare
 * `contentPadding` inset visibly pushes the overlay out to the window edge
 * instead of under its anchor.
 *
 * On a phone `contentMaxWidth === width`, the centring term is exactly 0 and
 * this degenerates to `contentPadding`, which is why a mobile-only check never
 * catches the wide-screen bug. Exported so the arithmetic lives in one place
 * rather than being re-derived (and drifting) per screen.
 */
export function contentColumnRightInset(layout: ResponsiveLayout): number {
  const centringOffset = (layout.width - Math.min(layout.width, layout.contentMaxWidth)) / 2;
  return Math.max(centringOffset + layout.contentPadding, layout.contentPadding);
}
