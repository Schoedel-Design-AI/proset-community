/**
 * Tests for the OAuth-based backup provider management module.
 *
 * Covers URL generation, CSRF state signing/verification, and provider
 * availability based on environment variables.
 */

import assert from "node:assert/strict";
import test from "node:test";

// Capture originals so they can be restored after the suite runs.
const _origBetterAuthSecret = process.env.BETTER_AUTH_SECRET;
const _origGoogleClientId = process.env.GOOGLE_CLIENT_ID;
const _origGoogleClientSecret = process.env.GOOGLE_CLIENT_SECRET;
const _origMicrosoftClientId = process.env.MICROSOFT_CLIENT_ID;
const _origMicrosoftClientSecret = process.env.MICROSOFT_CLIENT_SECRET;
const _origDropboxAppKey = process.env.DROPBOX_APP_KEY;
const _origDropboxAppSecret = process.env.DROPBOX_APP_SECRET;

// Set up env vars before module is loaded so that getBackupOAuthStateSecret()
// and getProviderConfig() can read them.
process.env.BETTER_AUTH_SECRET = "test-secret-for-backup-oauth-unit-tests";
process.env.GOOGLE_CLIENT_ID = "test-google-client-id";
process.env.GOOGLE_CLIENT_SECRET = "test-google-client-secret";
process.env.MICROSOFT_CLIENT_ID = "test-ms-client-id";
process.env.MICROSOFT_CLIENT_SECRET = "test-ms-client-secret";
// Dropbox credentials intentionally not set for the "not configured" tests.
delete process.env.DROPBOX_APP_KEY;
delete process.env.DROPBOX_APP_SECRET;

import {
  getAvailableBackupOAuthProviders,
  generateAuthorizationUrl,
  getPendingBackupOAuthReturnTo,
} from "../../server/oauth-backup";

// Restore the environment to its original state after all tests complete.
function restoreOrDelete(key: string, original: string | undefined): void {
  if (original === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = original;
  }
}

test.after(() => {
  restoreOrDelete("BETTER_AUTH_SECRET", _origBetterAuthSecret);
  restoreOrDelete("GOOGLE_CLIENT_ID", _origGoogleClientId);
  restoreOrDelete("GOOGLE_CLIENT_SECRET", _origGoogleClientSecret);
  restoreOrDelete("MICROSOFT_CLIENT_ID", _origMicrosoftClientId);
  restoreOrDelete("MICROSOFT_CLIENT_SECRET", _origMicrosoftClientSecret);
  restoreOrDelete("DROPBOX_APP_KEY", _origDropboxAppKey);
  restoreOrDelete("DROPBOX_APP_SECRET", _origDropboxAppSecret);
});

// ─── Provider availability ────────────────────────────────────────────────────

test("getAvailableBackupOAuthProviders includes google_drive when credentials are set", () => {
  const providers = getAvailableBackupOAuthProviders();
  assert.ok(providers.includes("google_drive"), "google_drive should be available");
});

test("getAvailableBackupOAuthProviders includes onedrive when credentials are set", () => {
  const providers = getAvailableBackupOAuthProviders();
  assert.ok(providers.includes("onedrive"), "onedrive should be available");
});

test("getAvailableBackupOAuthProviders excludes dropbox when credentials are missing", () => {
  const providers = getAvailableBackupOAuthProviders();
  assert.ok(!providers.includes("dropbox"), "dropbox should not be available without credentials");
});

// ─── Authorization URL generation ────────────────────────────────────────────

test("generateAuthorizationUrl returns null for an unknown provider", () => {
  const url = generateAuthorizationUrl("user-123", "unknown_provider");
  assert.equal(url, null);
});

test("generateAuthorizationUrl returns null for dropbox when credentials are missing", () => {
  const url = generateAuthorizationUrl("user-123", "dropbox");
  assert.equal(url, null);
});

test("generateAuthorizationUrl returns a valid Google accounts URL for google_drive", () => {
  const url = generateAuthorizationUrl("user-123", "google_drive");
  assert.ok(url !== null, "URL should not be null");
  const parsed = new URL(url!);
  assert.equal(parsed.hostname, "accounts.google.com", "URL must point to Google accounts");
  assert.equal(parsed.protocol, "https:", "URL must use HTTPS");
});

test("generateAuthorizationUrl includes the correct OAuth parameters for google_drive", () => {
  const url = generateAuthorizationUrl("user-123", "google_drive");
  const parsed = new URL(url!);

  assert.equal(parsed.searchParams.get("response_type"), "code");
  assert.equal(parsed.searchParams.get("client_id"), "test-google-client-id");
  assert.equal(parsed.searchParams.get("access_type"), "offline");
  assert.equal(parsed.searchParams.get("prompt"), "consent");
});

test("generateAuthorizationUrl requests the drive.file scope for google_drive", () => {
  const url = generateAuthorizationUrl("user-123", "google_drive");
  const parsed = new URL(url!);
  const scope = parsed.searchParams.get("scope") ?? "";
  assert.ok(scope.includes("drive.file"), "scope must include drive.file");
});

test("generateAuthorizationUrl sets the callback redirect URI for google_drive", () => {
  const url = generateAuthorizationUrl("user-123", "google_drive");
  const parsed = new URL(url!);
  const redirectUri = parsed.searchParams.get("redirect_uri") ?? "";
  assert.ok(redirectUri.includes("/api/backup/oauth/google_drive/callback"), "redirect_uri must include the callback path");
});

test("generateAuthorizationUrl includes a signed state token", () => {
  const url = generateAuthorizationUrl("user-123", "google_drive");
  const parsed = new URL(url!);
  const state = parsed.searchParams.get("state");
  assert.ok(state && state.length > 20, "state should be a non-trivial signed token");
});

test("generateAuthorizationUrl returns a valid OneDrive URL for onedrive", () => {
  const url = generateAuthorizationUrl("user-456", "onedrive");
  assert.ok(url !== null, "URL should not be null");
  const parsed = new URL(url!);
  assert.equal(parsed.hostname, "login.microsoftonline.com", "URL must point to Microsoft login");
  assert.equal(parsed.protocol, "https:", "URL must use HTTPS");
  assert.equal(parsed.searchParams.get("client_id"), "test-ms-client-id");
});

// ─── CSRF state round-trip ────────────────────────────────────────────────────

test("getPendingBackupOAuthReturnTo recovers the returnTo from a freshly generated state", () => {
  const url = generateAuthorizationUrl("user-123", "google_drive", "/settings/integrations");
  const state = new URL(url!).searchParams.get("state")!;

  const returnTo = getPendingBackupOAuthReturnTo(state);
  assert.equal(returnTo, "/settings/integrations");
});

test("getPendingBackupOAuthReturnTo returns undefined for undefined state", () => {
  assert.equal(getPendingBackupOAuthReturnTo(undefined), undefined);
});

test("getPendingBackupOAuthReturnTo returns undefined for an empty string", () => {
  assert.equal(getPendingBackupOAuthReturnTo(""), undefined);
});

test("getPendingBackupOAuthReturnTo returns undefined for a tampered state", () => {
  const url = generateAuthorizationUrl("user-123", "google_drive", "/settings/integrations");
  const state = new URL(url!).searchParams.get("state")!;

  // Flip the last few characters of the signature to simulate tampering.
  const tampered = state.slice(0, -4) + "XXXX";
  assert.equal(getPendingBackupOAuthReturnTo(tampered), undefined);
});

test("getPendingBackupOAuthReturnTo returns undefined for a state with a malformed signature segment", () => {
  assert.equal(getPendingBackupOAuthReturnTo("notavalidstate"), undefined);
});

test("getPendingBackupOAuthReturnTo strips unsafe returnTo values (external URL)", () => {
  // External URLs are not on the allow-list in sanitizeReturnTo.
  const url = generateAuthorizationUrl("user-123", "google_drive", "https://attacker.example.com/steal");
  const state = new URL(url!).searchParams.get("state")!;

  // The sanitized returnTo should be undefined (stripped), not the malicious URL.
  const returnTo = getPendingBackupOAuthReturnTo(state);
  assert.equal(returnTo, undefined);
});

test("getPendingBackupOAuthReturnTo accepts the mobile deep-link returnTo scheme", () => {
  const mobileReturn = "proset://settings/integrations";
  const url = generateAuthorizationUrl("user-123", "google_drive", mobileReturn);
  const state = new URL(url!).searchParams.get("state")!;

  const returnTo = getPendingBackupOAuthReturnTo(state);
  assert.equal(returnTo, mobileReturn);
});

test("getPendingBackupOAuthReturnTo accepts the three-slash mobile deep-link (proset:///)", () => {
  // The mobile deep-link helper produces "proset:///settings/integrations" (three slashes).
  const mobileReturn = "proset:///settings/integrations";
  const url = generateAuthorizationUrl("user-123", "google_drive", mobileReturn);
  const state = new URL(url!).searchParams.get("state")!;

  const returnTo = getPendingBackupOAuthReturnTo(state);
  assert.equal(returnTo, mobileReturn);
});
