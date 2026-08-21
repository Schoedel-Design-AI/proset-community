import React from "react";
import Svg, { Circle, Line, Path, Polyline, Rect, type SvgProps } from "react-native-svg";

export type DrawerFeatherIconName =
  | "bar-chart-2"
  | "book-open"
  | "check"
  | "cloud"
  | "code"
  | "copy"
  | "credit-card"
  | "edit-3"
  | "folder"
  | "git-branch"
  | "globe"
  | "mail"
  | "message-circle"
  | "settings"
  | "sliders"
  | "user"
  | "x";

type Props = SvgProps & {
  name: DrawerFeatherIconName;
  size?: number;
  color?: string;
};

const iconPaths: Record<DrawerFeatherIconName, (strokeProps: any) => React.ReactNode> = {
  "bar-chart-2": (p) => (
    <>
      <Line x1="18" y1="20" x2="18" y2="10" {...p} />
      <Line x1="12" y1="20" x2="12" y2="4" {...p} />
      <Line x1="6" y1="20" x2="6" y2="14" {...p} />
    </>
  ),
  "credit-card": (p) => (
    <>
      <Rect x="1" y="4" width="22" height="16" rx="2" {...p} />
      <Line x1="1" y1="10" x2="23" y2="10" {...p} />
    </>
  ),
  "book-open": (p) => (
    <>
      <Path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" {...p} />
      <Path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" {...p} />
    </>
  ),
  check: (p) => <Polyline points="20 6 9 17 4 12" {...p} />,
  cloud: (p) => <Path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" {...p} />,
  code: (p) => (
    <>
      <Polyline points="16 18 22 12 16 6" {...p} />
      <Polyline points="8 6 2 12 8 18" {...p} />
    </>
  ),
  copy: (p) => (
    <>
      <Rect x="9" y="9" width="13" height="13" rx="2" ry="2" {...p} />
      <Path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" {...p} />
    </>
  ),
  "edit-3": (p) => (
    <>
      <Path d="M12 20h9" {...p} />
      <Path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" {...p} />
    </>
  ),
  folder: (p) => <Path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" {...p} />,
  "git-branch": (p) => (
    <>
      <Line x1="6" y1="3" x2="6" y2="15" {...p} />
      <Circle cx="18" cy="6" r="3" {...p} />
      <Circle cx="6" cy="18" r="3" {...p} />
      <Path d="M18 9a9 9 0 0 1-9 9" {...p} />
    </>
  ),
  globe: (p) => (
    <>
      <Circle cx="12" cy="12" r="10" {...p} />
      <Line x1="2" y1="12" x2="22" y2="12" {...p} />
      <Path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" {...p} />
    </>
  ),
  mail: (p) => (
    <>
      <Path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" {...p} />
      <Polyline points="22,6 12,13 2,6" {...p} />
    </>
  ),
  "message-circle": (p) => <Path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" {...p} />,
  settings: (p) => (
    <>
      <Circle cx="12" cy="12" r="3" {...p} />
      <Path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" {...p} />
    </>
  ),
  sliders: (p) => (
    <>
      <Line x1="4" y1="21" x2="4" y2="14" {...p} />
      <Line x1="4" y1="10" x2="4" y2="3" {...p} />
      <Line x1="12" y1="21" x2="12" y2="12" {...p} />
      <Line x1="12" y1="8" x2="12" y2="3" {...p} />
      <Line x1="20" y1="21" x2="20" y2="16" {...p} />
      <Line x1="20" y1="12" x2="20" y2="3" {...p} />
      <Line x1="1" y1="14" x2="7" y2="14" {...p} />
      <Line x1="9" y1="8" x2="15" y2="8" {...p} />
      <Line x1="17" y1="16" x2="23" y2="16" {...p} />
    </>
  ),
  user: (p) => (
    <>
      <Path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" {...p} />
      <Circle cx="12" cy="7" r="4" {...p} />
    </>
  ),
  x: (p) => (
    <>
      <Line x1="18" y1="6" x2="6" y2="18" {...p} />
      <Line x1="6" y1="6" x2="18" y2="18" {...p} />
    </>
  ),
};

export default function DrawerFeatherIcon({ name, size = 24, color = "currentColor", ...props }: Props) {
  const strokeProps = {
    fill: "none",
    stroke: color,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    strokeWidth: 2,
  };

  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" {...props}>
      {iconPaths[name](strokeProps)}
    </Svg>
  );
}
