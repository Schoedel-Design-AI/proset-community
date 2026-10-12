import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

/**
 * Email action links (password reset, email verification) reach the ANDROID APP,
 * not the browser: AndroidManifest.xml claims them with autoVerify App Links and
 * assetlinks.json carries the Play App Signing certificate, so Android hands the
 * URL straight to the app. From there the URL has to survive THREE steps, and
 * each of them fails SILENTLY — the app just stays on its initial route, which
 * for a signed-out user is the login screen:
 *
 *   1. linking.prefixes must match the URL (custom schemes alone do not cover
 *      https links) — covered by tests/app-links-assetlinks-contract.test.mjs.
 *   2. React Navigation's getStateFromPath must not throw while parsing the
 *      path. It parses the query string with query-string, whose
 *      `require('decode-uri-component')` expects the COMMONJS 0.2.x build.
 *      An override pulling in the ESM-only 0.4/0.5 line makes every
 *      `queryString.parse()` call throw "decodeComponent is not a function";
 *      useLinking catches the throw and drops the URL. That shipped once
 *      (override "decode-uri-component": "^0.5.0") and users reported "the
 *      forgot-password link sends me to the login page".
 *   3. the resolved route name and its params (mode, oobCode) must reach the
 *      screen that reads them.
 *
 * These tests run the router's own code, so they fail on the real defect rather
 * than on a lookalike.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(repoRoot, "package.json"));

async function linkingPrefixesAndScreens() {
  const src = await readFile(path.join(repoRoot, "lib/navigation.tsx"), "utf8");
  const prefixBlock = src.slice(src.indexOf("prefixes:"), src.indexOf("config:"));
  const prefixes = [...prefixBlock.matchAll(/"([^"]+)"/g)].map((m) => m[1]);

  const cfgStart = src.indexOf("config:", src.indexOf("const linking = useMemo"));
  const screensStart = src.indexOf("screens: {", cfgStart);
  const screensEnd = src.indexOf("\n      },", screensStart);
  const body = src.slice(screensStart + "screens: {".length, screensEnd);
  const screens = {};
  for (const line of body.split("\n")) {
    const m = line.match(/^\s*"?([^":]+)"?:\s*"([^"]*)",?\s*$/);
    if (m) screens[m[1].trim()] = m[2];
  }
  return { prefixes, screens };
}

test("query-string can parse a query string (its decode-uri-component must stay CommonJS)", async () => {
  const queryString = require("query-string");

  // Name the cause explicitly: this is the exact failure users saw.
  const decodePath = createRequire(require.resolve("query-string")).resolve("decode-uri-component");
  const decodeUriComponentModule = require(decodePath);
  assert.equal(
    typeof decodeUriComponentModule,
    "function",
    `decode-uri-component at ${decodePath} is not a callable CJS export. query-string@7 requires the ` +
      "CommonJS 0.2.x line; an ESM-only 0.4/0.5 build (npm override) makes every queryString.parse() call " +
      "throw, which drops every App Link URL on Android and strands users on the login screen.",
  );

  const parsed = queryString.parse("mode=resetPassword&oobCode=TEST-CODE");
  assert.equal(parsed.mode, "resetPassword", `parsed: ${JSON.stringify(parsed)}`);
  assert.equal(parsed.oobCode, "TEST-CODE", `parsed: ${JSON.stringify(parsed)}`);
});

test("an emailed password-reset App Link resolves to the reset-password route with its oobCode", async () => {
  const { prefixes, screens } = await linkingPrefixesAndScreens();
  const { extractPathFromURL } = await import(
    path.join(repoRoot, "node_modules/@react-navigation/native/lib/module/extractPathFromURL.js")
  );
  const { getStateFromPath } = await import(
    path.join(repoRoot, "node_modules/@react-navigation/core/lib/module/getStateFromPath.js")
  );

  for (const host of ["proset.ai", "www.proset.ai"]) {
    const url = `https://${host}/reset-password?mode=resetPassword&oobCode=TEST-CODE`;
    const linkPath = extractPathFromURL(prefixes, url);
    assert.ok(
      typeof linkPath === "string",
      `linking.prefixes must match ${url}; undefined means React Navigation drops the link`,
    );

    const state = getStateFromPath(linkPath, { screens });
    assert.equal(state?.routes?.[0]?.name, "reset-password", `state for ${url}: ${JSON.stringify(state)}`);
    assert.equal(state?.routes?.[0]?.params?.oobCode, "TEST-CODE", "the oobCode must survive routing");
  }
});

test("the email verification link routes too, and every linking screen is a registered native route", async () => {
  const { prefixes, screens } = await linkingPrefixesAndScreens();
  const { extractPathFromURL } = await import(
    path.join(repoRoot, "node_modules/@react-navigation/native/lib/module/extractPathFromURL.js")
  );
  const { getStateFromPath } = await import(
    path.join(repoRoot, "node_modules/@react-navigation/core/lib/module/getStateFromPath.js")
  );

  const verifyPath = extractPathFromURL(
    prefixes,
    "https://proset.ai/verify-email?mode=verifyEmail&oobCode=TEST-CODE",
  );
  assert.ok(typeof verifyPath === "string", "the verify-email link must match a prefix");
  const verifyState = getStateFromPath(verifyPath, { screens });
  assert.equal(verifyState?.routes?.[0]?.name, "verify-email");
  assert.equal(verifyState?.routes?.[0]?.params?.oobCode, "TEST-CODE");

  const routesSrc = await readFile(path.join(repoRoot, "lib/native-routes.ts"), "utf8");
  const constants = Object.fromEntries(
    [...routesSrc.matchAll(/export const (\w+)\s*=\s*"([^"]+)"/g)].map((m) => [m[1], m[2]]),
  );
  const anchor = routesSrc.indexOf("NATIVE_ROUTE_NAMES: readonly string[] = [");
  assert.ok(anchor > -1, "NATIVE_ROUTE_NAMES table not found in lib/native-routes.ts");
  const block = routesSrc.slice(anchor, routesSrc.indexOf("];", anchor));
  const registered = block
    .split("\n")
    .map((line) => {
      const literal = line.match(/"([^"]+)"/);
      if (literal) return literal[1];
      const identifier = line.match(/\b([A-Z][A-Z0-9_]+)\b/);
      return identifier ? constants[identifier[1]] : undefined;
    })
    .filter(Boolean);
  assert.ok(registered.length > 20, `expected the full native route table, parsed ${registered.length}`);

  const orphans = Object.keys(screens).filter((name) => !registered.includes(name));
  assert.deepEqual(
    orphans,
    [],
    "every screen in the linking config must exist in the navigator; a name that is not registered makes " +
      "React Navigation drop the whole state in a release build",
  );
});
