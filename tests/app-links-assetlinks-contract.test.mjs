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
