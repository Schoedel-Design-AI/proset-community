// Hermes (Android) does not implement Web Crypto: `globalThis.crypto` is
// undefined, so `crypto.getRandomValues()` throws "No cryptographically secure
// RNG available". lib/password-generator.ts depends on it and deliberately
// refuses to fall back to Math.random() for passwords, so every "Generate
// password" control (reset, register, force-change, settings, admin user
// management) failed on device.
//
// This installs the native implementation. It MUST be imported before any
// module that reads crypto while loading. Browsers ship crypto natively and the
// web app boots from its own entry (index.web.tsx), so it stays native-only.
import "react-native-get-random-values";
import { AppRegistry } from "react-native";
import App from "./app/_layout";
import { installStructuredClonePolyfill } from "./lib/structured-clone-polyfill";

// Hermes lacks structuredClone; dicebear avatar rendering requires it.
installStructuredClonePolyfill();

AppRegistry.registerComponent("proset-native", () => App);
