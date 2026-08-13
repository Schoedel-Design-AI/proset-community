/**
 * Reanimated's development assertion imports a Node-only CommonJS validator
 * that reads react-native-worklets/package.json with require(). Vite executes
 * that validator in Node while loading vite.config.mts, then aliases the
 * browser import here so the already-completed compatibility check is not
 * repeated in an environment where CommonJS require is unavailable.
 */
export default function validateReanimatedWorkletsVersion() {
  return { ok: true } as const;
}
