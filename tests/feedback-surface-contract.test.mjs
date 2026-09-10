import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * Contract test for feedback platform provenance.
 *
 * Ticket #327 / issue #190 could not be triaged because an in-app report never
 * said whether it came from the Android app or the web app — and Proset users
 * routinely use both. These assertions fail the build if any link in that chain
 * is removed: the client stops sending its surface, the server stops reading it,
 * the payload stops carrying it, CORS stops allowing the header, or the CE
 * override drifts away from main.
 */

const read = (relative) => readFileSync(new URL(relative, import.meta.url), "utf8");

const sharedSurface = read("../shared/client-surface.ts");
const clientSurface = read("../lib/client-surface.ts");
const queryClient = read("../lib/query-client.ts");
const feedbackModal = read("../components/FeedbackModal.tsx");
const serverSurface = read("../server/client-surface.ts");
const auth = read("../server/auth.ts");
const routes = read("../server/routes.ts");
const serverIndex = read("../server/index.ts");
const emailService = read("../server/email-service.ts");
const githubService = read("../server/github-feedback-service.ts");

const ceQueryClient = read("../scripts/ce-export/overrides/lib/query-client.ts");
const ceAuth = read("../scripts/ce-export/overrides/server/auth.ts");
const ceRoutes = read("../scripts/ce-export/overrides/server/routes.ts");
const ceServerIndex = read("../scripts/ce-export/overrides/server/index.ts");

/** The single source of truth for the header name, read out of the shared module. */
const HEADER = /CLIENT_SURFACE_HEADER = "([^"]+)"/.exec(sharedSurface)?.[1];

test("the surface header name is defined once and is lowercase", () => {
  assert.equal(HEADER, "x-proset-surface");
});

test("the app sends its surface on every authenticated request", () => {
  for (const [name, source] of [
    ["lib/query-client.ts", queryClient],
    ["CE override lib/query-client.ts", ceQueryClient],
  ]) {
    assert.match(source, /import \{ getSurfaceHeaders \} from "@\/lib\/client-surface";/, name);
    assert.match(source, /Object\.assign\(headers, getSurfaceHeaders\(\)\)/, name);
  }
});

test("the feedback modal also puts the surface in the request body", () => {
  // Belt and braces: a proxy may drop an unknown header, and a report with no
  // surface is the exact ambiguity this feature removes.
  assert.match(feedbackModal, /import \{ getEncodedSurface \} from "@\/lib\/client-surface";/);
  assert.match(feedbackModal, /formData\.append\("surface", getEncodedSurface\(\)\)/);
});

test("the client reports app version and build from the version-gated app.json", () => {
  // build-android.sh refuses to build unless package.json, app.json and Gradle
  // versionName agree, so app.json is a guarded single source of truth.
  assert.match(clientSurface, /import appConfig from "\.\.\/app\.json";/);
  assert.match(clientSurface, /appVersion/);
  assert.match(clientSurface, /versionCode/);
});

test("CORS allows the surface header wherever it is enumerated", () => {
  for (const [name, source] of [
    ["server/index.ts", serverIndex],
    ["CE override server/index.ts", ceServerIndex],
  ]) {
    // server/index.ts declares more than one allow-list (the Matrix
    // .well-known endpoint has its own, Content-Type only). The API one is
    // identified by carrying Authorization.
    const allowLists = [...source.matchAll(/Access-Control-Allow-Headers",\s*\n?\s*"([^"]+)"/g)]
      .map((match) => match[1])
      .filter((list) => /authorization/i.test(list));
    assert.equal(allowLists.length, 1, `${name}: expected exactly one API CORS allow-list`);
    assert.ok(
      allowLists[0].split(",").map((entry) => entry.trim().toLowerCase()).includes(HEADER),
      `${name}: ${HEADER} missing from the CORS allow-list`,
    );
  }
});

test("surface tracking runs on authenticated requests without blocking them", () => {
  for (const [name, source] of [
    ["server/auth.ts", auth],
    ["CE override server/auth.ts", ceAuth],
  ]) {
    assert.match(source, /import \{ recordUserSurface \} from "\.\/client-surface";/, name);
    assert.match(source, /void recordUserSurface\(dbUser, req\);/, name);
    // Telemetry must never sit in front of a user's request.
    assert.doesNotMatch(source, /await recordUserSurface\(/, name);
  }
});

test("the surface recorder only writes when the account gains a new surface", () => {
  assert.match(serverSurface, /if \(merged\.length === known\.length\) return;/);
  assert.match(serverSurface, /storage\.users\.update\(user\.id, \{ surfacesSeen: merged \}/);
  // A failed write is telemetry, not a reason to fail the request.
  assert.match(serverSurface, /catch \(error: any\)/);
});

test("the feedback route reads the reported surface and attaches it to the payload", () => {
  for (const [name, source] of [
    ["server/routes.ts", routes],
    ["CE override server/routes.ts", ceRoutes],
  ]) {
    const start = source.indexOf('app.post("/api/feedback"');
    assert.ok(start >= 0, `${name}: feedback route must exist`);
    const route = source.slice(start, source.indexOf("res.json({ success: true })", start));

    assert.match(route, /readReportedSurface\(req, req\.body\?\.surface\)/, name);
    assert.match(route, /buildFeedbackSurfaceFields\(reportedSurface, user\)/, name);
    assert.match(route, /\.\.\.surfaceFields,/, name);
    // Raw client text must never reach the email/issue unsanitized.
    assert.doesNotMatch(route, /reportedFrom: req\.body/, name);
  }
});

test("the payload distinguishes where a report came from and every surface the account uses", () => {
  assert.match(serverSurface, /reportedFrom: formatSurface\(reported\)/);
  assert.match(serverSurface, /accountSurfaces: formatSurfaces\(surfaces\)/);
  assert.match(serverSurface, /crossSurface: isCrossSurface\(surfaces\)/);
});

test("the support email shows the reporting surface and the account's surfaces", () => {
  assert.match(emailService, /Reported from: \$\{reportedFrom\}/);
  assert.match(emailService, /Account uses: \$\{accountSurfaces\}/);
  // Both values are client-derived, so the HTML body must escape them.
  assert.match(emailService, /escapeHtml\(reportedFrom\)/);
  assert.match(emailService, /escapeHtml\(accountSurfaces\)/);
});

test("the GitHub issue records both facts and labels the surface", () => {
  assert.match(githubService, /Reported from: \$\{opts\.reportedFrom\}/);
  assert.match(githubService, /Account surfaces: \$\{opts\.accountSurfaces\}/);
  assert.match(githubService, /labels: buildIssueLabels\(opts\)/);
  assert.match(githubService, /labels\.push\(`platform:\$\{surface\}`\)/);
  assert.match(githubService, /platform:cross-surface/);
  // "Android" must not imply "Android only" when the user also uses the web app.
  assert.match(githubService, /Reproduce on \*\*both\*\* surfaces/);
});

test("surface values are sanitized before they can reach HTML or Markdown", () => {
  assert.match(sharedSurface, /const SAFE_VALUE = \/\[\^A-Za-z0-9 \._\+\(\)\/:-\]\/g;/);
  assert.match(sharedSurface, /MAX_VALUE_LENGTH = \d+/);
  assert.match(sharedSurface, /export function sanitizeSurfaceValue/);
  // The parser is the trust boundary: every accepted field passes through it.
  const parser = sharedSurface.slice(sharedSurface.indexOf("export function parseSurfaceHeader"));
  assert.match(parser, /sanitizeSurfaceValue\(segment\.slice\(index \+ 1\)\)/);
});
