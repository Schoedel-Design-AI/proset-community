const { getDefaultConfig, mergeConfig } = require("@react-native/metro-config");
const { createProxyMiddleware } = require("http-proxy-middleware");
const path = require("path");
const fs = require("fs");

const defaultConfig = getDefaultConfig(__dirname);

function resolveSourceFile(basePath, platform) {
  const exts = defaultConfig.resolver.sourceExts || ["js", "jsx", "ts", "tsx", "json"];
  const platformSuffixes = platform ? [platform, "native", ""] : [""];

  for (const suffix of platformSuffixes) {
    for (const ext of exts) {
      const candidate = suffix ? `${basePath}.${suffix}.${ext}` : `${basePath}.${ext}`;
      if (fs.existsSync(candidate)) {
        return { filePath: candidate, type: "sourceFile" };
      }
    }
  }

  for (const suffix of platformSuffixes) {
    for (const ext of exts) {
      const candidate = suffix
        ? path.join(basePath, `index.${suffix}.${ext}`)
        : path.join(basePath, `index.${ext}`);
      if (fs.existsSync(candidate)) {
        return { filePath: candidate, type: "sourceFile" };
      }
    }
  }

  return { filePath: basePath, type: "sourceFile" };
}

const config = {
  watcher: {
    additionalExts: [],
  },
  resolver: {
    blockList: [
      new RegExp(path.resolve(__dirname, ".local").replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(/.*)?$"),
    ],
    resolveRequest: (context, moduleName, platform) => {
      if (moduleName.startsWith("@/")) {
        const cleanPath = moduleName.slice(2);
        const basePath = path.resolve(__dirname, cleanPath);
        return resolveSourceFile(basePath, platform);
      }

      if (moduleName.startsWith("@shared/")) {
        const cleanPath = moduleName.slice(8); // "@shared/" is 8 chars
        const basePath = path.resolve(__dirname, 'shared', cleanPath);
        return resolveSourceFile(basePath, platform);
      }

      return context.resolveRequest(context, moduleName, platform);
    },
  },
  server: {
    enhanceMiddleware: (middleware) => {
      return (req, res, next) => {
        if (req.url && req.url.startsWith("/api")) {
          const proxy = createProxyMiddleware({
            target: "http://localhost:5000",
            changeOrigin: true,
          });
          return proxy(req, res, next);
        }
        return middleware(req, res, next);
      };
    },
  },
};

module.exports = mergeConfig(defaultConfig, config);
