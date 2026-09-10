import assert from "node:assert/strict";
import test from "node:test";

import {
  CLIENT_SURFACE_HEADER,
  encodeSurfaceHeader,
  formatSurface,
  formatSurfaces,
  isCrossSurface,
  mergeSurfaces,
  normalizeSurfaces,
  parseSurfaceHeader,
  sanitizeSurfaceValue,
  surfaceFromUserAgent,
} from "../../shared/client-surface";

test("the header name stays lowercase so Express and CORS agree on it", () => {
  assert.equal(CLIENT_SURFACE_HEADER, "x-proset-surface");
  assert.equal(CLIENT_SURFACE_HEADER, CLIENT_SURFACE_HEADER.toLowerCase());
});

test("encode/parse round-trips a full Android snapshot", () => {
  const snapshot = {
    surface: "android" as const,
    appVersion: "1.0.61",
    build: "96",
    osVersion: "Android 14",
    device: "Pixel 7",
  };
  const encoded = encodeSurfaceHeader(snapshot);
  assert.equal(encoded, "android; v=1.0.61; b=96; os=Android 14; d=Pixel 7");
  assert.deepEqual(parseSurfaceHeader(encoded), snapshot);
});

test("encode/parse round-trips a web snapshot including the host", () => {
  const snapshot = {
    surface: "web" as const,
    appVersion: "1.0.61",
    osVersion: "Android 14",
    device: "Chrome 141",
    origin: "proset.ai",
  };
  assert.deepEqual(parseSurfaceHeader(encodeSurfaceHeader(snapshot)), snapshot);
});

test("parse rejects anything that is not a known surface", () => {
  assert.equal(parseSurfaceHeader(""), null);
  assert.equal(parseSurfaceHeader("   "), null);
  assert.equal(parseSurfaceHeader("windows; v=1.0.61"), null);
  assert.equal(parseSurfaceHeader(undefined), null);
  assert.equal(parseSurfaceHeader(42), null);
  assert.deepEqual(parseSurfaceHeader("ANDROID"), { surface: "android" });
});

test("parse ignores unknown keys and malformed segments", () => {
  assert.deepEqual(parseSurfaceHeader("web; zz=1; =nope; v=1.0.61; junk"), {
    surface: "web",
    appVersion: "1.0.61",
  });
});

test("client-supplied values cannot inject headers, HTML, or Markdown", () => {
  // Header/response splitting.
  assert.equal(sanitizeSurfaceValue("Pixel\r\nX-Evil: 1"), "Pixel X-Evil: 1");
  // HTML into the support email.
  assert.equal(sanitizeSurfaceValue('<img src=x onerror="alert(1)">'), "img src x onerror alert(1)");
  // Markdown link/image injection into the GitHub issue body.
  assert.equal(sanitizeSurfaceValue("](https://evil.example)"), "(https://evil.example)");
  assert.equal(sanitizeSurfaceValue("`rm -rf /`"), "rm -rf /");
  assert.equal(sanitizeSurfaceValue(""), undefined);
  assert.equal(sanitizeSurfaceValue("   "), undefined);
  assert.equal(sanitizeSurfaceValue(null), undefined);
});

test("values are length-capped so a hostile client cannot pad a report", () => {
  const long = "A".repeat(400);
  const value = sanitizeSurfaceValue(long);
  assert.ok(value && value.length <= 48, `expected <= 48 chars, got ${value?.length}`);
});

test("a poisoned value cannot smuggle a second field through the wire format", () => {
  const encoded = encodeSurfaceHeader({
    surface: "android",
    device: "Pixel; v=9.9.9; d=spoofed",
  });
  const parsed = parseSurfaceHeader(encoded);
  assert.equal(parsed?.appVersion, undefined);
  assert.equal(parsed?.device, "Pixel v 9.9.9 d spoofed");
});

test("formatSurface reads as a support line, degrading field by field", () => {
  assert.equal(
    formatSurface({
      surface: "android",
      appVersion: "1.0.61",
      build: "96",
      osVersion: "Android 14",
      device: "Pixel 7",
    }),
    "Android app 1.0.61 (build 96) · Android 14 · Pixel 7",
  );
  assert.equal(
    formatSurface({ surface: "web", appVersion: "1.0.61", device: "Chrome 141", origin: "proset.ai" }),
    "Web 1.0.61 · Chrome 141 · proset.ai",
  );
  assert.equal(formatSurface({ surface: "web" }), "Web");
  assert.equal(formatSurface(null), "Unknown surface");
});

test("surface sets are deduplicated, ordered, and junk-tolerant", () => {
  assert.deepEqual(normalizeSurfaces(["web", "android", "web"]), ["android", "web"]);
  assert.deepEqual(normalizeSurfaces(["WEB", "nope", 7, null]), ["web"]);
  assert.deepEqual(normalizeSurfaces("android"), []);
  assert.deepEqual(normalizeSurfaces(undefined), []);
});

test("mergeSurfaces grows the set without reordering or duplicating", () => {
  assert.deepEqual(mergeSurfaces(["web"], "android"), ["android", "web"]);
  assert.deepEqual(mergeSurfaces(["android"], "android"), ["android"]);
  assert.deepEqual(mergeSurfaces(null, "web"), ["web"]);
  assert.deepEqual(mergeSurfaces(["android", "web"], null), ["android", "web"]);
});

test("the Android-and-Web case is reported as both, never as one", () => {
  assert.equal(formatSurfaces(["android", "web"]), "Android + Web");
  assert.equal(isCrossSurface(["android", "web"]), true);
  assert.equal(formatSurfaces(["android"]), "Android");
  assert.equal(isCrossSurface(["android"]), false);
  assert.equal(formatSurfaces([]), "Unknown");
});

test("User-Agent fallback separates native app traffic from browser traffic", () => {
  // React Native's fetch on Android/iOS.
  assert.equal(surfaceFromUserAgent("okhttp/4.12.0"), "android");
  assert.equal(surfaceFromUserAgent("Proset/1.0.61 CFNetwork/1494.0.7 Darwin/23.4.0"), "ios");
  // Desktop and mobile browsers, including an Android browser (which must NOT
  // be mistaken for the Android app — that confusion is the whole point).
  assert.equal(
    surfaceFromUserAgent(
      "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36",
    ),
    "web",
  );
  assert.equal(
    surfaceFromUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Gecko/20100101 Firefox/135.0"),
    "web",
  );
  assert.equal(surfaceFromUserAgent(""), null);
  assert.equal(surfaceFromUserAgent(undefined), null);
});
