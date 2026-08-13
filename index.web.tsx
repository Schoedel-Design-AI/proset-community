import React from "react";
import { createRoot } from "react-dom/client";
import RootLayout from "./app/_layout";

// Reset some basic body styles for react-native-web
const style = document.createElement("style");
style.textContent = `
  @font-face {
    font-family: 'Inter_400Regular';
    src: local('Inter Regular'), local('Inter-Regular'), url('https://fonts.gstatic.com/s/inter/v20/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIw2boKoduKmMEVuLyfMZ0.woff2') format('woff2');
    font-weight: normal;
    font-style: normal;
    font-display: swap;
  }
  @font-face {
    font-family: 'Inter_500Medium';
    src: local('Inter Medium'), local('Inter-Medium'), url('https://fonts.gstatic.com/s/inter/v20/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIw2boKoduKmMEVuI6fMZ0.woff2') format('woff2');
    font-weight: normal;
    font-style: normal;
    font-display: swap;
  }
  @font-face {
    font-family: 'Inter_600SemiBold';
    src: local('Inter SemiBold'), local('Inter-SemiBold'), url('https://fonts.gstatic.com/s/inter/v20/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIw2boKoduKmMEVuGKYMZ0.woff2') format('woff2');
    font-weight: normal;
    font-style: normal;
    font-display: swap;
  }
  @font-face {
    font-family: 'Inter_700Bold';
    src: local('Inter Bold'), local('Inter-Bold'), url('https://fonts.gstatic.com/s/inter/v20/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIw2boKoduKmMEVuFuYMZ0.woff2') format('woff2');
    font-weight: normal;
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
