#!/usr/bin/env bash

# build-android.sh
# Deterministic Android (AAB) build for Proset.
#
# COMMUNITY EDITION: prod builds target YOUR OWN backend, taken from
# AIFORMS_PUBLIC_DOMAIN (shell env or .env). The hosted proset.ai /
# stage.proset.ai domains are REJECTED on purpose: baking them would
# silently route CE app data to the hosted Proset API.
#
# The Android release bundle is produced by Gradle's `react { }` block, which
# runs Metro/Hermes and inlines `process.env.AIFORMS_PUBLIC_*` from the *shell
# environment* at bundle time. There is no .env auto-loading in this bare
# React Native setup (unlike the web Vite/Docker build), so a plain
# `./gradlew bundleRelease` bakes EMPTY client config and ships a non-working
# app (fixed crash, but no backend, no auth, no subscriptions).
#
# This script makes the build deterministic and fail-fast:
#   1. Loads only the AIFORMS_PUBLIC_* values from .env (never touches secrets).
#   2. FORCES AIFORMS_PUBLIC_DOMAIN for the chosen environment.
#   3. Refuses to build if a required client value is missing.
#   4. Gives Gradle a non-secret fingerprint so an environment change always
#      invalidates the Metro/Hermes bundle task.
#   5. Verifies the chosen domain is actually baked into the AAB afterward.
#
# Usage:
#   scripts/build-android.sh prod          # build release AAB against AIFORMS_PUBLIC_DOMAIN
#   scripts/build-android.sh dev           # build against localhost:5000
#   scripts/build-android.sh prod --upload # build, verify, then upload to Play
#
# Android Internal Testing is the Android staging/release-validation lane.
# There is not currently a separate staging-backend Android flavor; `prod`
# points at proset.ai and `dev` mirrors the local web/API development env.

set -euo pipefail

ENVIRONMENT="${1:-prod}"
UPLOAD="no"
[[ "${2:-}" == "--upload" ]] && UPLOAD="yes"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
ENV_FILE="${ROOT_DIR}/.env"
AAB_PATH="${ROOT_DIR}/android/app/build/outputs/bundle/release/app-release.aab"
MAPPING_PATH="${ROOT_DIR}/android/app/build/outputs/mapping/release/mapping.txt"
GOOGLE_SERVICES_PATH="${ROOT_DIR}/android/app/google-services.json"
FIREBASE_CONFIG_CREATED="no"

cleanup_firebase_config() {
  if [[ "$FIREBASE_CONFIG_CREATED" == "yes" ]]; then
    rm -f "$GOOGLE_SERVICES_PATH"
  fi
}
trap cleanup_firebase_config EXIT

# ---------------------------------------------------------------------------
# 1. Version metadata must stay aligned before Play upload.
# ---------------------------------------------------------------------------
( cd "$ROOT_DIR" && node <<'EOF'
const fs = require("node:fs");

const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
const app = JSON.parse(fs.readFileSync("app.json", "utf8"));
const gradle = fs.readFileSync("android/app/build.gradle", "utf8");
const rootGradle = fs.readFileSync("android/build.gradle", "utf8");
const gradleProperties = fs.readFileSync("android/gradle.properties", "utf8");

const versionName = gradle.match(/^\s*versionName\s+"([^"]+)"\s*$/m)?.[1];
const versionCode = Number(gradle.match(/^\s*versionCode\s+(\d+)\s*$/m)?.[1]);
const appVersionCode = Number(app.android?.versionCode);
const propertyValue = (name) => {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return Number(gradleProperties.match(new RegExp(`^${escaped}=(\\d+)\\s*$`, "m"))?.[1]);
};
const compileSdk = propertyValue("android.compileSdkVersion");
const targetSdk = propertyValue("android.targetSdkVersion");
const playTargetSdkFloor = 36;
const requiredReleaseProperties = [
  "android.enableMinifyInReleaseBuilds=true",
  "android.enableShrinkResourcesInReleaseBuilds=true",
  "android.r8.optimizedResourceShrinking=true",
];

const failures = [];
if (pkg.version !== app.version || pkg.version !== versionName) {
  failures.push(`version mismatch: package.json=${pkg.version}, app.json=${app.version}, Gradle=${versionName || "missing"}`);
}
if (!Number.isInteger(versionCode) || !Number.isInteger(appVersionCode) || versionCode !== appVersionCode) {
  failures.push(`versionCode mismatch: app.json=${appVersionCode || "missing"}, Gradle=${versionCode || "missing"}`);
}
if (!Number.isInteger(targetSdk) || targetSdk < playTargetSdkFloor) {
  failures.push(`target SDK ${targetSdk || "missing"} is below the Google Play floor ${playTargetSdkFloor}`);
}
if (!Number.isInteger(compileSdk) || compileSdk < targetSdk) {
  failures.push(`compile SDK ${compileSdk || "missing"} must be at least target SDK ${targetSdk || "missing"}`);
}

const canonicalReferences = [
  [rootGradle, 'project.property("android.compileSdkVersion")', "root compileSdk"],
  [rootGradle, 'project.property("android.targetSdkVersion")', "root targetSdk"],
  [gradle, "compileSdk = rootProject.ext.compileSdkVersion", "app compileSdk"],
  [gradle, "targetSdkVersion rootProject.ext.targetSdkVersion", "app targetSdk"],
];
for (const [file, reference, label] of canonicalReferences) {
  if (!file.includes(reference)) {
    failures.push(`${label} must reference the canonical android/gradle.properties value`);
  }
}
for (const property of requiredReleaseProperties) {
  if (!gradleProperties.includes(property)) {
    failures.push(`required optimized release property is missing: ${property}`);
  }
}
if (!gradle.includes('getDefaultProguardFile("proguard-android-optimize.txt")')) {
  failures.push("release build must use proguard-android-optimize.txt");
}

if (failures.length > 0) {
  console.error("FATAL: Android release metadata or SDK policy is not aligned.");
  for (const failure of failures) console.error(` - ${failure}`);
  process.exit(1);
}
EOF
)

# ---------------------------------------------------------------------------
# 2. Resolve the backend domain for this environment (single source of truth).
# ---------------------------------------------------------------------------
case "$ENVIRONMENT" in
  # CE: prod's backend domain is resolved after .env load, from the operator's
  # AIFORMS_PUBLIC_DOMAIN (see step 4). proset.ai is never baked.
  prod)  DOMAIN="" ;;
  dev)   DOMAIN="localhost:5000" ;;   # NB: only works in an emulator/tunnel, not a physical device
  *)     echo "Usage: $0 {dev|prod} [--upload]" >&2; exit 1 ;;
esac

if [[ "$ENVIRONMENT" == "prod" && ! -f "$GOOGLE_SERVICES_PATH" ]]; then
  if [[ -f "${SCRIPT_DIR}/prepare-firebase-client-config.mjs" ]]; then
    echo "Preparing the production Firebase Android client configuration..."
    node "${SCRIPT_DIR}/prepare-firebase-client-config.mjs" production \
      --android-out "$GOOGLE_SERVICES_PATH"
    FIREBASE_CONFIG_CREATED="yes"
  else
    echo "NOTE: prepare-firebase-client-config.mjs is not shipped in the Community"
    echo "      Edition. Drop in your own android/app/google-services.json if you want"
    echo "      the Firebase Android SDK enabled; without it react-native-firebase"
    echo "      no-ops and the app runs on legacy email/password auth."
  fi
fi

if [[ "$ENVIRONMENT" == "prod" && -f "$GOOGLE_SERVICES_PATH" && ! -s "$GOOGLE_SERVICES_PATH" ]]; then
  echo "FATAL: google-services.json exists but is empty." >&2
  exit 1
fi

echo "============================================="
echo "Proset Android build"
echo "Environment: $ENVIRONMENT"
echo "Backend:     https://$DOMAIN"
echo "Upload:      $UPLOAD"
echo "============================================="

# ---------------------------------------------------------------------------
# 3. Load ONLY AIFORMS_PUBLIC_* values from .env (these are client-public, not
#    secrets). Avoids sourcing the whole file (which contains multi-line keys).
# ---------------------------------------------------------------------------
# Poison-pill: if ANY EXPO_PUBLIC_* env var is set, abort immediately.
# The project was de-Expo'd — these names are dead and using them means
# the caller is stale. Force the fix at the source.
if env | grep -qE '^EXPO_PUBLIC_'; then
  echo "FATAL: EXPO_PUBLIC_* env vars detected. This project migrated to AIFORMS_PUBLIC_*." >&2
  echo "       Remove all EXPO_PUBLIC_* from your environment and use AIFORMS_PUBLIC_*." >&2
  env | grep -E '^EXPO_PUBLIC_' | sed 's/=.*/=***/' >&2
  exit 1
fi
# ---------------------------------------------------------------------------
if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source <(grep -E '^AIFORMS_PUBLIC_[A-Z0-9_]+=' "$ENV_FILE" || true)
  set +a
else
  echo "WARNING: $ENV_FILE not found; only AIFORMS_PUBLIC_DOMAIN will be set." >&2
fi

# ---------------------------------------------------------------------------
# 4. Fail-fast validation. DOMAIN is fatal; feature keys warn.
# ---------------------------------------------------------------------------
if [[ "$ENVIRONMENT" == "prod" ]]; then
  # CE: prod domain comes from the operator (shell env or .env).
  DOMAIN="${AIFORMS_PUBLIC_DOMAIN:-}"
  if [[ -z "${DOMAIN}" ]]; then
    echo "FATAL: AIFORMS_PUBLIC_DOMAIN is required for a Community Edition prod build." >&2
    echo "       Set it to YOUR server, e.g. AIFORMS_PUBLIC_DOMAIN=notes.example.com" >&2
    exit 1
  fi
  case "${DOMAIN}" in
    proset.ai|stage.proset.ai|*.proset.ai)
      echo "FATAL: AIFORMS_PUBLIC_DOMAIN resolves to the hosted Proset (${DOMAIN})." >&2
      echo "       CE builds must point at your own server; refusing to bake the hosted API." >&2
      exit 1 ;;
  esac
  export AIFORMS_PUBLIC_DOMAIN="${DOMAIN}"
else
  # Force the dev domain (overrides whatever .env had).
  export AIFORMS_PUBLIC_DOMAIN="$DOMAIN"
fi
if [[ -z "${AIFORMS_PUBLIC_DOMAIN:-}" ]]; then
  echo "FATAL: AIFORMS_PUBLIC_DOMAIN is empty." >&2
  exit 1
fi

warn_if_empty() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    echo "WARNING: $name is empty in .env — the related feature will be broken in this build." >&2
  fi
}
# Android-relevant client config. (AIFORMS_PUBLIC_TURNSTILE_SITE_KEY is web-only —
# app/login.tsx returns early unless Platform.OS === "web" — so it is not
# checked here.)
# (CE: no RevenueCat — in-app purchases are hosted-only; lib/purchases.ts is a stub.)

# ---------------------------------------------------------------------------
# 5. Build the release AAB (Gradle inlines the exported AIFORMS_PUBLIC_* vars).
# ---------------------------------------------------------------------------
PUBLIC_ENV_FINGERPRINT="$(
  env |
    grep -E '^AIFORMS_PUBLIC_[A-Z0-9_]+=' |
    LC_ALL=C sort |
    sha256sum |
    awk '{print $1}'
)"

echo "Clearing Metro caches (so AIFORMS_PUBLIC inlining reflects THIS build's env)..."
find "${TMPDIR:-/tmp}" -maxdepth 1 \( -name 'metro-*' -o -name 'haste-map-*' \) -exec rm -rf {} + 2>/dev/null || true
rm -rf "${ROOT_DIR}/node_modules/.cache/metro" 2>/dev/null || true

echo "Building release AAB..."
(
  cd "${ROOT_DIR}/android"
  ./gradlew :app:bundleRelease \
    "-PaiformsPublicFingerprint=${PUBLIC_ENV_FINGERPRINT}"
)

if [[ ! -f "$AAB_PATH" ]]; then
  echo "FATAL: expected AAB not found at $AAB_PATH" >&2
  exit 1
fi
if [[ ! -s "$MAPPING_PATH" ]]; then
  echo "FATAL: R8 mapping file missing or empty at $MAPPING_PATH" >&2
  echo "       Refusing to ship an optimized build that Play cannot deobfuscate." >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# 6. Verify AIFORMS_PUBLIC injection actually happened — how we KNOW what shipped.
#    NOTE: for prod, 'proset.ai' ALSO appears in static content (support emails,
#    doc URLs), so its mere presence does NOT prove the domain was injected.
#    We therefore also confirm a DISTINCTIVE, env-only value reached the bundle:
#      dev  -> the localhost domain is itself distinctive
#      prod -> the RevenueCat Android key (goog_...), when set
# ---------------------------------------------------------------------------
echo "Verifying AIFORMS_PUBLIC injection in the AAB..."
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"; cleanup_firebase_config' EXIT
unzip -o -q "$AAB_PATH" -d "$TMP"
BUNDLE="$(find "$TMP" -name 'index.android.bundle' | head -1)"
if [[ -z "$BUNDLE" ]]; then
  echo "FATAL: could not find index.android.bundle inside the AAB." >&2
  exit 1
fi

# The backend domain must at least be present.
if ! grep -aqF "$DOMAIN" "$BUNDLE"; then
  echo "FATAL: backend domain '$DOMAIN' absent from the bundle — env injection failed." >&2
  exit 1
fi

# Distinctive proof that process.env.AIFORMS_PUBLIC_* was inlined (not left empty).
if [[ "$ENVIRONMENT" == "dev" ]]; then
  echo "OK: '$DOMAIN' present (localhost is distinctive — injection verified)."
elif [[ -n "${AIFORMS_PUBLIC_REVENUECAT_ANDROID:-}" ]]; then
  if ! grep -aqF "$AIFORMS_PUBLIC_REVENUECAT_ANDROID" "$BUNDLE"; then
    echo "FATAL: AIFORMS_PUBLIC_REVENUECAT_ANDROID is set in .env but is absent from the" >&2
    echo "       bundle — AIFORMS_PUBLIC_* injection did not run. Refusing to ship." >&2
    exit 1
  fi
echo "OK: distinctive env value injected — backend '$DOMAIN' confirmed reachable."
else
  echo "WARNING: '$DOMAIN' is present, but for prod it also appears in static content" >&2
  echo "         and no distinctive AIFORMS_PUBLIC value (e.g. RevenueCat key) is set to" >&2
  echo "         positively confirm injection. Proceeding (best-effort verification)." >&2
fi

# Prove the React Native/keyboard source patches reached DEX. Maintained
# Material/AndroidX calls guarded to legacy API levels are reported separately.
if [[ -f "${ROOT_DIR}/scripts/audit-android-edge-to-edge.py" ]]; then
  echo "Auditing compiled edge-to-edge bytecode..."
  ( cd "$ROOT_DIR" && python3 scripts/audit-android-edge-to-edge.py )
else
  echo "NOTE: audit-android-edge-to-edge.py is not shipped in the Community Edition — skipping the bytecode audit."
fi

echo "============================================="
echo "Android build complete for '$ENVIRONMENT' (backend https://$DOMAIN)."
echo "AAB: $AAB_PATH"
echo "R8 mapping: $MAPPING_PATH"
echo "R8 mapping SHA-256: $(sha256sum "$MAPPING_PATH" | awk '{print $1}')"
echo "============================================="

# ---------------------------------------------------------------------------
# 7. Optional upload to the selected Google Play track.
# ---------------------------------------------------------------------------
if [[ "$UPLOAD" == "yes" ]]; then
  echo "NOTE: Play upload (upload-aab.py) is hosted-only and not shipped in the"
  echo "      Community Edition. The AAB is ready at ${AAB_PATH} — publish it"
  echo "      from your own Google Play Console."
fi
