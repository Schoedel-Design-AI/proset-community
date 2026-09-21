import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * An Android release must never carry a non-production Firebase project.
 *
 * `build-android.sh` used to generate `google-services.json` only when the file
 * was absent, so a staging config left behind by a test build was silently
 * reused. The result was an app pointed at the production API but the STAGING
 * Firebase project — it installed, launched, and refused every sign-in because
 * no production credential exists there. Fail the build instead of the sign-in.
 */
test("the Android release build cannot bake a non-production Firebase project", () => {
  const android = readFileSync("scripts/build-android.sh", "utf8");

  // Always regenerate, never reuse whatever happens to be on disk.
  assert.match(android, /prepare-firebase-client-config\.mjs" production/);
  assert.doesNotMatch(android, /! -f "\$GOOGLE_SERVICES_PATH" \]\]/);

  // Verify the baked project id against the configured production project.
  assert.match(android, /FATAL: Android Firebase configuration targets/);
  assert.match(android, /Firebase project verified: \$ACTUAL_FIREBASE_PROJECT/);

  // A developer's pre-existing file is restored when the build finishes.
  assert.match(android, /FIREBASE_CONFIG_BACKUP/);

  // The fail-closed guard that predates this change must survive.
  assert.match(android, /production Firebase Android configuration is missing/);
});

test("the registered production project id is what the build verifies against", () => {
  const config = JSON.parse(readFileSync("config/firebase-auth-environments.json", "utf8"));
  const production = config.environments.production;
  assert.equal(production.projectId, "barry-ai-native");
  assert.equal(production.apps.android.packageName, "ms.aifor.app");
  assert.notEqual(
    production.projectId,
    config.environments.staging.projectId,
    "staging and production must not share a Firebase project",
  );
  // The build script must read the same key this test asserts on.
  const android = readFileSync("scripts/build-android.sh", "utf8");
  assert.match(android, /environments\.production\.projectId/);
});
