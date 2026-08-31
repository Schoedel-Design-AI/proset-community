import React from "react";
import { createRoot } from "react-dom/client";
import RootLayout from "./app/_layout";
import { installStructuredClonePolyfill } from "./lib/structured-clone-polyfill";

// No-op in modern browsers; guards older webviews that lack structuredClone.
installStructuredClonePolyfill();

// Reset some basic body styles for react-native-web
const style = document.createElement("style");
style.textContent = `
  @font-face {
    font-family: 'Inter_400Regular';
    src: url('/fonts/inter-400.woff2') format('woff2');
    font-weight: 400;
    font-style: normal;
    font-display: swap;
  }
  @font-face {
    font-family: 'Inter_500Medium';
    src: url('/fonts/inter-500.woff2') format('woff2');
    font-weight: 500;
    font-style: normal;
    font-display: swap;
  }
  @font-face {
    font-family: 'Inter_600SemiBold';
    src: url('/fonts/inter-600.woff2') format('woff2');
    font-weight: 600;
    font-style: normal;
    font-display: swap;
  }
  @font-face {
    font-family: 'Inter_700Bold';
    src: url('/fonts/inter-700.woff2') format('woff2');
    font-weight: 700;
    font-style: normal;
    font-display: swap;
  }
  html, body, #root {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    margin: 0;
    padding: 0;
    overflow: hidden;
    background-color: #0b0f19;
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  }
`;
document.head.appendChild(style);

const container = document.getElementById("root");
if (container) {
  const root = createRoot(container);
  root.render(<RootLayout />);
}
