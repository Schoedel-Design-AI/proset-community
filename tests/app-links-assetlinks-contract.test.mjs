import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

/**
 * App Links need BOTH halves, and either one alone is a silent no-op:
 *
 *   1. /.well-known/assetlinks.json must list the certificate that signed the
 *      installed APK. Play re-signs every distributed APK with the Play App
 *      Signing key, so listing only the upload key verifies nothing for real
 *      users — the one mistake that looks configured but never works.
 *   2. AndroidManifest.xml must declare an autoVerify https intent-filter for the
 *      same hosts. Without it, serving the file changes nothing at all.
 *
 * When this is wrong the failure is invisible: Android just quietly opens the
 * browser, which is what it did before anyone tried to fix it.
 */

const read = (path) => readFile(path, "utf8");

test("the server serves assetlinks.json for the right package", async () => {
  const server = await read("server/index.ts");
  assert.match(
    server,
    /app\.get\("\/\.well-known\/assetlinks\.json"/,
    "the assetlinks endpoint must exist; /.well-known/* is proxied to the app",
  );
  assert.match(server, /namespace:\s*"android_app"/, "target namespace must be android_app");
  assert.match(
    server,
    /package_name:\s*"ms\.aifor\.app"/,
    "the package must match applicationId in android/app/build.gradle",
  );
  assert.match(
    server,
    /relation:\s*\["delegate_permission\/common\.handle_all_urls"\]/,
    "the handle_all_urls relation is what lets https links open the app",
  );
});

test("assetlinks lists a distinct Play App Signing certificate, not only the upload key", async () => {
  const server = await read("server/index.ts");
  const block = server.slice(server.indexOf("assetlinks.json"));
  const fingerprints = [...block.matchAll(/"([0-9A-F]{2}(?::[0-9A-F]{2}){31})"/g)].map((m) => m[1]);
  assert.ok(
    fingerprints.length >= 2,
    `expected the app signing key AND the upload key, found ${fingerprints.length} fingerprint(s)`,
  );
  assert.equal(
    new Set(fingerprints).size,
    fingerprints.length,
    "duplicate fingerprints means one of the two keys was dropped",
  );
  for (const fp of fingerprints) {
    assert.match(fp, /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/, `malformed SHA-256 fingerprint: ${fp}`);
  }
});

test("the manifest declares autoVerify https App Links for proset.ai", async () => {
  const manifest = await read("android/app/src/main/AndroidManifest.xml");
  const filter = manifest.slice(manifest.indexOf('android:autoVerify="true"'));
  assert.ok(filter.length > 0, "an autoVerify intent-filter is required for App Links");
  assert.match(filter, /android:scheme="https"/, "App Links must use the https scheme");
  assert.match(filter, /android:host="proset\.ai"/, "the verified host must be proset.ai");
  // The headline case: the checkout return must be able to open the app.
  assert.match(filter, /android:path="\/choose-plan"/, "/choose-plan must be claimed by the app");
});

test("the manifest keeps marketing and docs routes on the web", async () => {
  const manifest = await read("android/app/src/main/AndroidManifest.xml");
  const filter = manifest.slice(manifest.indexOf('android:autoVerify="true"'));
  for (const path of ["/documentation", "/privacy", "/refund", "/terms"]) {
    assert.doesNotMatch(
      filter,
      new RegExp(`android:path(?:Prefix)?="${path}"`),
      `${path} should stay in the browser, not be hijacked by the app`,
    );
  }
});

/**
 * The THIRD half of App Links, and the one nothing checked until a user
 * reported it (2026-10-05: "the forgot password link sends people to the
 * login page with no way to set a new password").
 *
 * Once Android hand-off is verified, the URL never reaches the browser, so the
 * app's own router must be able to resolve it. React Navigation matches the URL
 * against `linking.prefixes` FIRST (extractPathFromURL) and returns undefined
 * when nothing matches; the URL is then dropped and the app stays on its
 * initial route — the login screen for a signed-out user. Declaring custom
 * schemes alone (aiforms://) does not cover the https links the manifest claims,
 * so an email action link silently dead-ends on the login screen.
 */

async function nativeLinkingPrefixes() {
  const nav = await read("lib/navigation.tsx");
  const block = nav.slice(nav.indexOf("prefixes:"), nav.indexOf("config:"));
  return [...block.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

test("the native router can resolve every https host the manifest claims", async () => {
  const manifest = await read("android/app/src/main/AndroidManifest.xml");
  const filter = manifest.slice(manifest.indexOf('android:autoVerify="true"'));
  const hosts = [...filter.matchAll(/android:host="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(hosts.length > 0, "the autoVerify filter must claim at least one https host");

  const prefixes = await nativeLinkingPrefixes();
  for (const host of hosts) {
    assert.ok(
      prefixes.includes(`https://${host}`),
      `lib/navigation.tsx must list "https://${host}" in linking.prefixes — ` +
        "Android hands those links to the app (verified App Links), so a missing " +
        "prefix makes the app drop the URL instead of opening the linked screen",
    );
  }
});

test("an emailed password-reset link resolves to the reset-password screen", async () => {
  // Resolve against the router's OWN implementation, not a re-implementation of
  // its rules: this is the code that decides whether the URL survives.
  const { extractPathFromURL } = await import(
    new URL("../node_modules/@react-navigation/native/lib/module/extractPathFromURL.js", import.meta.url).href
  );

  const prefixes = await nativeLinkingPrefixes();
  // Shape sent by server/auth.ts POST /api/auth/forget-password.
  const url = "https://proset.ai/reset-password?mode=resetPassword&oobCode=TEST-CODE";
  const rawPath = extractPathFromURL(prefixes, url);
  // The router may return the remainder with a leading slash ("/reset-password?...")
  // depending on whether the URL also carried a query string.
  const path = typeof rawPath === "string" ? rawPath.replace(/^\//, "") : rawPath;

  assert.ok(
    typeof path === "string" && path.startsWith("reset-password"),
    `the reset link must resolve to the reset-password route, got ${JSON.stringify(rawPath)} — ` +
      "undefined means React Navigation drops the link and the user lands on the login screen",
  );
  assert.match(
    path,
    /oobCode=TEST-CODE/,
    "the oobCode query parameter must survive routing; the screen reads it to verify the link",
  );
});
