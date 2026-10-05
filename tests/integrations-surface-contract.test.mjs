// Contract: Settings → Integrations offers only what can actually run.
//
// Why this test exists:
//   A stored conversion destination has no consumer — `POST /api/calendar/export`
//   is its only route and `handleExportToCalendarProvider` in
//   app/recording/[id].tsx is never rendered — so the destination tab promised a
//   route that never runs (feedback #252), and a Google tab once offered Calendar
//   and Tasks rows that requested a *sensitive* Google scope for a feature with
//   no shipped delivery (feedback #253, docs/google-oauth-verification-kit.md §3
//   Track A). The Google tab itself was removed on 2026-09-29, so the Google
//   service rows and the account-connection request are gone from this screen
//   entirely (locked absence contract: tests/integrations-google-tab-removed-contract.test.mjs).
//   New destination creation remains gated by
//   `featureFlags.conversionDestinations`, while accounts with stored rows keep
//   a management-only revocation surface. This test fails if those gates are
//   loosened.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const read = (rel) => readFileSync(path.join(repoRoot, rel), "utf8");

const integrations = read("app/settings/integrations.tsx");
const featureFlags = read("lib/feature-flags.ts");
const i18n = read("lib/i18n.tsx");
const recordingDetail = read("app/recording/[id].tsx");

test("the destination tab appears only for the feature or stored rows", () => {
  assert.match(
    featureFlags,
    /conversionDestinations:\s*false/,
    "new destination creation must ship hidden until a conversion routes to a destination",
  );
  assert.match(
    integrations,
    /const hasStoredDestinations = calendarProviders\.length > 0;/,
    "persisted rows must be detected before deriving tab visibility",
  );
  assert.match(
    integrations,
    /const showDestinationsTab = featureFlags\.conversionDestinations \|\| hasStoredDestinations;/,
    "the tab must be visible only for enabled creation or a stored destination",
  );
  assert.match(
    integrations,
    /\.\.\.\(showDestinationsTab/,
    "the tab bar must use the derived destination visibility gate",
  );
  assert.match(
    integrations,
    /\{activeTab === "calendar" && showDestinationsTab && \(/,
    "the destination body must use the same visibility gate as the tab",
  );
});

test("the destination deep link follows stored-row visibility", () => {
  assert.match(
    integrations,
    /params\.tab === "calendar" && showDestinationsTab/,
    "?tab=calendar must use the same derived visibility gate",
  );
  assert.match(
    integrations,
    /\}, \[params\.tab, showDestinationsTab\]\);/,
    "the deep link must be reconsidered after stored destinations load",
  );
});

test("stored destinations stay revocable while creation remains gated", () => {
  assert.match(
    integrations,
    /if \(user && \(activeTab === "calendar" \|\| !featureFlags\.conversionDestinations\)\) \{\s*loadCalendarData\(\);/,
    "stored rows must load while the feature is off so the management tab can appear",
  );

  const cardsStart = integrations.indexOf("const calendarProviderCards =");
  const tabsStart = integrations.indexOf("const tabs:", cardsStart);
  assert.ok(cardsStart >= 0 && tabsStart > cardsStart, "the stored-destination card list must be defined");
  const cards = integrations.slice(cardsStart, tabsStart);
  assert.match(cards, /calendarProviders\.map\(\(cp\) =>/);
  assert.match(cards, /<Switch/);
  assert.match(cards, /onValueChange=\{\(\) => handleToggleCalendar\(cp\.id, cp\.enabled\)\}/);
  assert.match(cards, /onPress=\{\(\) => handleDeleteCalendar\(cp\.id\)\}/);
  assert.match(cards, /<Feather name="trash-2"/);

  const bodyStart = integrations.indexOf('{activeTab === "calendar" && showDestinationsTab && (');
  const nextTabBody = integrations.indexOf('{activeTab === "connectors" && user && (', bodyStart);
  assert.ok(bodyStart >= 0 && nextTabBody > bodyStart, "the destination body must be present");
  const destinationBody = integrations.slice(bodyStart, nextTabBody);
  const managementBranch = destinationBody.match(
    /\{!featureFlags\.conversionDestinations \? \(([\s\S]*?)\) : !user \? \(/,
  );
  assert.equal(
    managementBranch?.[1].trim(),
    "calendarProviderCards",
    "feature-off mode must render only the stored-destination card list",
  );
  assert.match(destinationBody, /setShowAddCalendar\(true\)/, "feature-on mode must retain the add button");
  assert.match(destinationBody, /style=\{bStyles\.addProviderForm\}/, "feature-on mode must retain the add form");

  assert.match(
    integrations,
    /if \(!showDestinationsTab && activeTab === "calendar"\) \{\s*setActiveTab\("storage"\);/,
    "removing the last stored destination must fall back to the screen's default tab",
  );
});

test("the section is no longer called Calendar in either language", () => {
  assert.doesNotMatch(
    integrations,
    /settings\.tabCalendar|settings\.calendarIntegrations|settings\.calendarPurpose/,
    "the screen must not use the retired calendar-framed strings",
  );
  assert.match(i18n, /"settings\.tabDestinations":\s*"Destinations"/);
  assert.match(i18n, /"settings\.tabDestinations":\s*"Destinos"/);
  assert.match(i18n, /"settings\.destinationIntegrations":\s*"Destination integrations"/);
  assert.match(i18n, /"settings\.destinationIntegrations":\s*"Integraciones de destino"/);
  const retired = i18n.match(/"settings\.tabCalendar"/g) || [];
  assert.equal(retired.length, 0, "the calendar-framed tab label must be gone from both catalogs");
});

test("the destination picker offers no Google service as selectable", () => {
  // google_calendar survives as metadata for stored rows, but must never be a
  // selectable service again: it only opened a pre-filled Google URL, and the
  // conversion's own Add to Calendar actions already do that.
  assert.match(integrations, /google_calendar: \{[^}]*ready: false \}/);
  assert.match(integrations, /outlook: \{[^}]*ready: false \}/);
  assert.match(integrations, /ical_download: \{[^}]*ready: false \}/);
  assert.match(
    integrations,
    /const READY_CALENDAR_PROVIDERS = Object\.entries\(CALENDAR_PROVIDER_INFO\)\.filter\(\(\[, info\]\) => info\.ready\)/,
  );
  assert.match(integrations, /\{READY_CALENDAR_PROVIDERS\s*\n\s*\.map\(/, "the picker must render ready entries only");
  assert.doesNotMatch(integrations, /\{Object\.entries\(CALENDAR_PROVIDER_INFO\)/, "the picker must not render every entry");
});

test("the destination picker defaults to a ready service", () => {
  assert.doesNotMatch(
    integrations,
    /useState<string>\("google_calendar"\)/,
    "the default selection must not be an unoffered service",
  );
  assert.match(integrations, /useState<string>\("caldav_nextcloud"\)/);
});

test("Google service rows and account requests are gone with the tab", () => {
  // The removal contract (tests/integrations-google-tab-removed-contract.test.mjs)
  // owns the absence assertions; this pins the two shapes that used to live here.
  assert.doesNotMatch(integrations, /delivered:/, "no Google service row metadata may remain in the screen");
  assert.doesNotMatch(integrations, /onConnect\(\["identity"/, "no account grant request may remain in the screen");
  assert.doesNotMatch(integrations, /GOOGLE_SERVICE_INFO|OFFERED_GOOGLE_SERVICES/);
});

test("the honest .ics route stays reachable on the conversion", () => {
  // Barry's ask: an ICS file comes from downloading an event conversion, not
  // from a settings tab.
  assert.match(recordingDetail, /const handleDownloadIcs = async \(\) =>/);
  assert.match(recordingDetail, /new URL\("\/api\/generate-ics", baseUrl\)/);
  assert.match(recordingDetail, /selectedConversion\?\.type === "calendar_event"/);
});
