// Client-public env vars inlined into the NATIVE bundle at build time.
// Keep in sync with the `define` block in vite.config.mts — Vite inlines these
// for the browser; this plugin does the same for the native (Metro/Hermes)
// build. They are NOT secrets (they ship inside the app). Real secrets stay
// server-side (Google Secret Manager).
//
// Why this exists: Expo was removed from this project (its modules are now real
// @react-native-* packages), but the AIFORMS_PUBLIC_ naming stayed. Without Expo's
// babel-preset, bare React Native does NOT inline `process.env.AIFORMS_PUBLIC_*`,
// so on device those reads were `undefined` and the app could not reach its
// backend. This restores inlining for Metro ONLY.
const CLIENT_ENV = [
  "AIFORMS_PUBLIC_DOMAIN",
  "AIFORMS_PUBLIC_STRIPE_KEY",
  "AIFORMS_PUBLIC_STRIPE_KEY_TEST",
  "AIFORMS_PUBLIC_REVENUECAT_ANDROID",
  "AIFORMS_PUBLIC_REVENUECAT_IOS",
  "AIFORMS_PUBLIC_TURNSTILE_SITE_KEY",
];

// Replace `process.env.AIFORMS_PUBLIC_*` (dot or bracket access) with a string literal.
function inlineClientEnv({ types: t }) {
  const nameOf = (prop, computed) => {
    if (!computed && t.isIdentifier(prop)) return prop.name;
    if (computed && t.isStringLiteral(prop)) return prop.value;
    return null;
  };
  return {
    name: "inline-expo-public-env",
    visitor: {
      MemberExpression(path) {
        const { node } = path;
        const name = nameOf(node.property, node.computed);
        if (!name || !CLIENT_ENV.includes(name)) return;
        const obj = node.object; // expect `process.env`
        const isProcessEnv =
          t.isMemberExpression(obj) &&
          t.isIdentifier(obj.object, { name: "process" }) &&
          ((!obj.computed && t.isIdentifier(obj.property, { name: "env" })) ||
            (obj.computed && t.isStringLiteral(obj.property, { value: "env" })));
        if (!isProcessEnv) return;
        path.replaceWith(t.stringLiteral(process.env[name] || ""));
      },
    },
  };
}

module.exports = function (api) {
  // Only inline for the native (Metro) build. The web build (Vite +
  // @vitejs/plugin-react, which also reads this file) already inlines these via
  // its own `define` block; running here too could bake empty values on web.
  const isNative = api.caller(
    (caller) =>
      !!caller &&
      (caller.name === "metro" ||
        caller.name === "@react-native/metro-babel-transformer" ||
        caller.platform === "android" ||
        caller.platform === "ios"),
  );

  // Invalidate Babel's cache when an inlined value (or the target) changes, so a
  // dev build is never served a cached prod transform (or a web transform).
  api.cache.using(() =>
    isNative ? "native:" + CLIENT_ENV.map((k) => process.env[k] || "").join(" ") : "other",
  );

  const plugins = [];
  if (isNative) plugins.push(inlineClientEnv);
  // Reanimated requires the Worklets plugin to be last.
  plugins.push("react-native-worklets/plugin");
  return {
    presets: ["module:@react-native/babel-preset"],
    plugins,
  };
};
