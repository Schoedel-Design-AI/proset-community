#!/usr/bin/env bash
# Environment validation for Proset Community Edition self-hosting.
# Usage: ./scripts/validate-env.sh
# Exit code: 0 if all checks pass, 1 if any critical check fails.

set -euo pipefail

ERRORS=0
WARNINGS=0

error() { echo "❌ ERROR: $1"; ERRORS=$((ERRORS + 1)); }
warn()  { echo "⚠️  WARN:  $1"; WARNINGS=$((WARNINGS + 1)); }
ok()    { echo "✅ OK:    $1"; }

echo "=== Proset Community Edition Environment Validation ==="
echo ""

# --- Required variables ---

if [ -z "${BETTER_AUTH_SECRET:-}" ]; then
  error "BETTER_AUTH_SECRET is not set"
elif [ "${#BETTER_AUTH_SECRET}" -lt 32 ]; then
  error "BETTER_AUTH_SECRET is too short (${#BETTER_AUTH_SECRET} chars, need ≥32)"
elif echo "$BETTER_AUTH_SECRET" | grep -qiE "(replace|placeholder|example|changeme|secret)"; then
  error "BETTER_AUTH_SECRET looks like a placeholder value"
else
  ok "BETTER_AUTH_SECRET is set (${#BETTER_AUTH_SECRET} chars)"
fi

# --- AI provider keys (at least one is required for transcription) ---

if [ -z "${OPENAI_API_KEY:-}" ] && [ -z "${GROQ_API_KEY:-}" ] && [ -z "${DEEPSEEK_API_KEY:-}" ] && [ -z "${MISTRAL_API_KEY:-}" ] && [ -z "${AI_FIREWORKS_API_KEY:-}" ]; then
  error "No AI provider key set — add at least one of OPENAI_API_KEY, GROQ_API_KEY, DEEPSEEK_API_KEY, MISTRAL_API_KEY, or AI_FIREWORKS_API_KEY"
else
  ok "At least one AI provider key is set"
fi

# --- Optional but recommended ---

if [ -z "${SENDGRID_API_KEY:-}" ]; then
  warn "SENDGRID_API_KEY is not set — email features will be disabled"
else
  ok "SENDGRID_API_KEY is set"
fi

if [ -z "${PUBLIC_APP_URL:-}" ]; then
  warn "PUBLIC_APP_URL is not set — canonical URL unknown"
else
  ok "PUBLIC_APP_URL is set: ${PUBLIC_APP_URL}"
fi

# --- Summary ---
echo ""
echo "=== Results ==="
echo "Errors:   $ERRORS"
echo "Warnings: $WARNINGS"

if [ "$ERRORS" -gt 0 ]; then
  echo ""
  echo "🚫 Validation FAILED — fix the errors above before deploying."
  exit 1
else
  echo ""
  echo "✅ Validation PASSED"
  exit 0
fi
