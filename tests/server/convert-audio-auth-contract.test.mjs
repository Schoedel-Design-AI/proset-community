import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

/**
 * POST /api/convert-audio runs ffmpeg on whatever it is given, and its JSON body can
 * name an `audioUri` for the server to fetch itself. It shipped with NO session check:
 * measured on staging 2026-09-30, an anonymous request reached the audio handling and
 * answered 400 "No audio provided for conversion." — i.e. it was past every guard, so
 * an unauthenticated caller could spend the server's CPU on a 500 MB upload or make it
 * fetch a URL of their choosing.
 *
 * Both copies of the route must keep the session requirement: the live server and the
 * Community Edition override, which the exporter copies over the assembled tree.
 */
const ROUTE_SOURCES = ["server/routes.ts", "scripts/ce-export/overrides/server/routes.ts"];

const ROUTE_DECLARATION = 'app.post("/api/convert-audio", requireAuth, audioConvertUpload.single("audio")';

test("the audio conversion route requires a session in both copies", () => {
  for (const file of ROUTE_SOURCES) {
    const source = readFileSync(file, "utf8");
    assert.ok(
      source.includes(ROUTE_DECLARATION),
      `${file}: /api/convert-audio must be behind requireAuth; it runs ffmpeg and can fetch a URL`,
    );
    assert.equal(
      /app\.post\("\/api\/convert-audio",\s*audioConvertUpload/.test(source),
      false,
      `${file}: the unauthenticated declaration must not come back`,
    );
  }
});

test("the route refuses anything but our own storage, in both copies", () => {
  for (const file of ROUTE_SOURCES) {
    const source = readFileSync(file, "utf8");
    assert.equal(
      /audioUri\.startsWith\("http/.test(source),
      false,
      `${file}: the http(s) fetch branch let a signed-in account use the server as a request proxy (SSRF); it must stay deleted`,
    );
    assert.equal(
      source.includes("Failed to fetch audio from URL."),
      false,
      `${file}: the URL-fetch error string is the fingerprint of that removed branch`,
    );
    assert.match(
      source,
      /return res\.status\(400\)\.json\(\{ error: "Audio must be uploaded or referenced from Proset storage\." \}\)/,
      `${file}: a non-storage audioUri must be refused, not fetched`,
    );
  }
});

test("the client callers send a session on both paths", () => {
  // Web posts a Blob through authFetch; native posts a file or a bucket URI through
  // authFetch/authExpoFetch with the auth headers. If a caller ever switches to a
  // bare fetch, downloads break with the 401 this guard exists to produce.
  for (const file of ["app/recording/[id].tsx", "scripts/ce-export/overrides/app/recording/[id].tsx"]) {
    const source = readFileSync(file, "utf8");
    const anchor = source.indexOf("/api/convert-audio");
    assert.notEqual(anchor, -1, `${file}: the convert-audio call is gone; update this guard`);
    const callSite = source.slice(anchor, anchor + 1200);
    assert.match(
      callSite,
      /authFetch\(convertUrl/,
      `${file}: the conversion request must go through authFetch, which attaches the session`,
    );
  }
});
