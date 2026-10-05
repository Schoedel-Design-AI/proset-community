// Contract: the Google tab is gone from Settings → Integrations, and the Google
// Slides integration went with it.
//
// Why this test exists: the tab first shipped locked-until-you-have-an-account so
// the surface stayed discoverable while the work was unfinished (issue #265).
// Barry removed it on 2026-09-29 — "remove the Google tab here and the slides
// integration. This tab needs to go away." That removal also takes away the only
// way to connect, manage or revoke a Google account, plus the deck → Google
// Slides export that was the single production caller of a Google service scope.
// This file fails if any of it creeps back without the integration being finished
// and deliberately re-introduced.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const read = (rel) => readFileSync(path.join(repoRoot, rel), "utf8");

const integrations = read("app/settings/integrations.tsx");
const recordingDetail = read("app/recording/[id].tsx");
const i18n = read("lib/i18n.tsx");

test("the integrations screen has no Google tab", () => {
  assert.doesNotMatch(integrations, /\{ key: "google"/, "no Google entry may return to the tabs array");
  assert.doesNotMatch(integrations, /activeTab === "google"/, "the Google tab body must stay removed");
  assert.doesNotMatch(
    integrations,
    /\| "connectors" \| "google"/,
    "the tab union must not carry a Google member",
  );
});

test("no Google account management code remains in the screen", () => {
  const removed = [
    "/api/google/",
    "loadGoogleStatus",
    "startGoogleConnect",
    "reconnectGoogleAccount",
    "disconnectGoogleAccount",
    "setGoogleServiceDefault",
    "GoogleWorkspaceSection",
    "google-service-row",
    "hasExistingGoogleAccounts",
    "google_connected",
  ];
  for (const symbol of removed) {
    assert.ok(
      !integrations.includes(symbol),
      `${symbol} must not come back without the tab that manages it`,
    );
  }
});

test("the locked-tab mechanism went with the only tab that used it", () => {
  assert.doesNotMatch(integrations, /tab\.locked/);
  assert.doesNotMatch(integrations, /tabLocked:|tabTextLocked:|tabLockGlyph:/);
  // a11y.locked is retained as shared accessibility vocabulary even though the
  // Google tab's locked branch, like the drawer's Music row, has been removed.
  const keys = i18n.match(/"a11y\.locked":/g) || [];
  assert.equal(keys.length, 2, "a11y.locked must still exist in both EN and ES catalogs");
});

test("the deck no longer exports to Google Slides", () => {
  assert.ok(!recordingDetail.includes("handleOpenDeckInGoogleSlides"), "the deck Slides handler must stay removed");
  assert.ok(!recordingDetail.includes("deck-google-slides-button"), "the deck Slides button must stay removed");
  assert.ok(!recordingDetail.includes("/api/google/decks/"), "nothing may call the deck Slides endpoint");
  const keys = i18n.match(/"deck\.openInGoogleSlides/g) || [];
  assert.equal(keys.length, 0, "the Google Slides deck strings must be gone from both catalogs");
});

test("a deep link cannot activate a Google tab that no longer exists", () => {
  assert.doesNotMatch(integrations, /params\.tab === "google"/);
});
