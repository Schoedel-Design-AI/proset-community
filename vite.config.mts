import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

type WorkletsValidationResult = {
  ok: boolean;
  message?: string;
};

const reanimatedPackage = require("react-native-reanimated/package.json") as {
  version: string;
};
const validateWorkletsVersion = require(
  "react-native-reanimated/scripts/validate-worklets-version",
) as (reanimatedVersion: string) => WorkletsValidationResult;
const workletsValidation = validateWorkletsVersion(reanimatedPackage.version);

if (!workletsValidation.ok) {
  throw new Error(`[Reanimated] ${workletsValidation.message}`);
}

type RollupWarning = {
  code?: string;
  id?: string;
  message?: string;
};

function isReanimatedWorkletDirectiveWarning(warning: RollupWarning) {
  const id = warning.id ?? "";
  return (
    warning.code === "MODULE_LEVEL_DIRECTIVE" &&
    warning.message?.includes('"worklet"') &&
    (id.includes("react-native-reanimated") || id.includes("react-native-worklets"))
  );
}

function resolveVendorChunk(id: string) {
  if (!id.includes("node_modules")) return undefined;
  const packageName = getPackageName(id);

  if (id.includes("lucide-react") || id.includes("@lucide/lab")) {
    return "vendor-icons";
  }

  if (
    id.includes("react-native-reanimated") ||
    id.includes("react-native-worklets")
  ) {
    return "vendor-native";
  }

  if (
    id.includes("react-native-screens")
  ) {
    return "vendor-native";
  }

  if (
    packageName === "@react-navigation/native" ||
    packageName === "@react-navigation/native-stack" ||
    packageName === "@react-navigation/elements" ||
    packageName === "@react-navigation/routers" ||
    packageName === "@react-navigation/core"
  ) {
    return "vendor-navigation";
  }

  if (
    id.includes("react-native") ||
    id.includes("@react-native") ||
    id.includes("react-native-web")
  ) {
    return "vendor-native";
  }

  if (
    id.includes("/react/") ||
    id.includes("/react-dom/") ||
    id.includes("/scheduler/") ||
    id.includes("/use-sync-external-store/")
  ) {
    return "vendor-react";
  }

  if (
    id.includes("@tanstack") ||
    id.includes("zod") ||
    id.includes("flatted") ||
    id.includes("clsx")
  ) {
    return "vendor-state";
  }

  if (
    id.includes("firebase") ||
    id.includes("@react-native-firebase")
  ) {
    return "vendor-firebase";
  }

  if (
    id.includes("/stripe/") ||
    id.includes("@stripe") ||
    id.includes("@linear") ||
    id.includes("/asana/")
  ) {
    return "vendor-integrations";
  }

  if (
    id.includes("@aws-sdk") ||
    id.includes("googleapis") ||
    id.includes("openai") ||
    id.includes("@octokit")
  ) {
    return "vendor-api";
  }

  if (
    id.includes("/buffer/") ||
    id.includes("readable-stream") ||
    id.includes("stream-browserify") ||
    id.includes("crypto-browserify") ||
    id.includes("process/browser")
  ) {
    return "vendor-polyfills";
  }

  if (
    id.includes("docx") ||
    id.includes("pdfkit") ||
    id.includes("mammoth") ||
    id.includes("tesseract") ||
    id.includes("html2canvas") ||
    id.includes("sharp")
  ) {
    return "vendor-documents";
  }

  if (packageName.startsWith("@dicebear/")) {
    if (packageName.includes("notionists")) {
      return "vendor-avatars-notionists";
    }
    if (packageName.includes("adventurer")) {
      return "vendor-avatars-adventurer";
    }
    return "vendor-avatars-core";
  }

  if (
    [
      "postcss-value-parser",
      "invariant",
      "is-plain-obj",
      "hoist-non-react-statics",
      "nullthrows",
      "hyphenate-style-name",
      "fbjs",
      "ieee754",
      "dijkstrajs",
      "base64-js",
      "merge-options",
      "styleq",
      "react-is",
      "css-in-js-utils",
      "inline-style-prefixer",
    ].includes(packageName)
  ) {
    return "vendor-utils";
  }

  return `vendor-${packageName.replace(/[@/]/g, "-")}`;
}

function getPackageName(id: string) {
  const segments = id.split("node_modules/").pop()?.split("/") ?? [];
  if (segments[0]?.startsWith("@") && segments[1]) {
    return `${segments[0]}/${segments[1]}`;
  }
  return segments[0] || "misc";
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");

  return {
    plugins: [
      react({
        exclude: /\/node_modules\/(?!react-native-worklets\/)/,
        babel: {
          plugins: [
            [
              "react-native-worklets/plugin",
              {
                disableSourceMaps: true,
                omitNativeOnlyData: true,
                substituteWebPlatformChecks: true,
              },
            ],
          ],
        },
      }),
    ],
    resolve: {
      alias: [
        {
          find: /^react-native-reanimated\/scripts\/validate-worklets-version$/,
          replacement: path.resolve(
            __dirname,
            "./lib/validate-reanimated-worklets-version.web.ts",
          ),
        },
        { find: /^react-native\/Libraries\/.*/, replacement: path.resolve(__dirname, "./lib/react-native-internals.tsx") },
        { find: /^react-native$/, replacement: path.resolve(__dirname, "./lib/react-native.ts") },
        { find: "@react-native-vector-icons/feather/static", replacement: path.resolve(__dirname, "./lib/Feather") },
        { find: "@react-native-vector-icons/fontawesome/static", replacement: path.resolve(__dirname, "./lib/FontAwesome") },
        { find: "expo-av", replacement: path.resolve(__dirname, "./lib/audio.ts") },
        { find: "expo-file-system/legacy", replacement: path.resolve(__dirname, "./lib/file-system.ts") },
        { find: "expo-file-system", replacement: path.resolve(__dirname, "./lib/file-system.ts") },
        { find: "expo-document-picker", replacement: path.resolve(__dirname, "./lib/expo-document-picker.ts") },
        { find: "@", replacement: path.resolve(__dirname, "./") },
        { find: "@shared", replacement: path.resolve(__dirname, "./shared") },
      ],
      extensions: [
        ".web.tsx",
        ".web.ts",
        ".web.jsx",
        ".web.js",
        ".tsx",
        ".ts",
        ".jsx",
        ".js",
      ],
    },
    optimizeDeps: {
      // Worklets relies on ESM initialization order to detect web. Vite
      // prebundling flattens that order and makes it initialize as native.
      exclude: [
        "react-native-file-access",
        "react-native-linear-gradient",
        "react-native-worklets",
      ],
      esbuildOptions: {
        loader: { ".js": "jsx" },
        resolveExtensions: [
          ".web.tsx",
          ".web.ts",
          ".web.jsx",
          ".web.js",
          ".tsx",
          ".ts",
          ".jsx",
          ".js",
        ],
      },
    },
    server: {
      port: 8081,
      proxy: {
        "/api": {
          target: "http://localhost:5000",
          changeOrigin: true,
        },
      },
    },
    build: {
      outDir: "web-build",
      emptyOutDir: true,
      rollupOptions: {
        onwarn(warning, defaultHandler) {
          if (isReanimatedWorkletDirectiveWarning(warning)) {
            return;
          }
          defaultHandler(warning);
        },
        output: {
          manualChunks: resolveVendorChunk,
        },
      },
    },
    define: {
      global: "window",
      __DEV__: mode === "development" ? "true" : "false",
      "process.env.NODE_ENV": JSON.stringify(mode),
      "process.env.AIFORMS_PUBLIC_DOMAIN": JSON.stringify(env.AIFORMS_PUBLIC_DOMAIN || ""),
      "process.env.AIFORMS_PUBLIC_STRIPE_KEY": JSON.stringify(env.AIFORMS_PUBLIC_STRIPE_KEY || ""),
      "process.env.AIFORMS_PUBLIC_REVENUECAT_ANDROID": JSON.stringify(env.AIFORMS_PUBLIC_REVENUECAT_ANDROID || ""),
      "process.env.AIFORMS_PUBLIC_TURNSTILE_SITE_KEY": JSON.stringify(env.AIFORMS_PUBLIC_TURNSTILE_SITE_KEY || ""),
      "process.env.AIFORMS_PUBLIC_FIREBASE_API_KEY": JSON.stringify(env.AIFORMS_PUBLIC_FIREBASE_API_KEY || ""),
      "process.env.AIFORMS_PUBLIC_FIREBASE_AUTH_DOMAIN": JSON.stringify(env.AIFORMS_PUBLIC_FIREBASE_AUTH_DOMAIN || ""),
      "process.env.AIFORMS_PUBLIC_FIREBASE_PROJECT_ID": JSON.stringify(env.AIFORMS_PUBLIC_FIREBASE_PROJECT_ID || ""),
      "process.env.AIFORMS_PUBLIC_FIREBASE_STORAGE_BUCKET": JSON.stringify(env.AIFORMS_PUBLIC_FIREBASE_STORAGE_BUCKET || ""),
      "process.env.AIFORMS_PUBLIC_FIREBASE_MESSAGING_SENDER_ID": JSON.stringify(env.AIFORMS_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || ""),
      "process.env.AIFORMS_PUBLIC_FIREBASE_APP_ID": JSON.stringify(env.AIFORMS_PUBLIC_FIREBASE_APP_ID || ""),
    },
  };
});
