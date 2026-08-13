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
