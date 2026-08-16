#!/usr/bin/env bash
# export-community-edition.sh
# Cuts a fresh Proset Community Edition snapshot from the main repo.
#
# The CE is the open-core: main minus internal surfaces (billing, admin,
# impersonation, deploy tooling, internal docs) plus whisper.cpp materialized
# and CE-specific docs (LICENSE, CONTRIBUTING, SECURITY, llms.txt).
#
# How it works (idempotent, deterministic):
#   1. Copies every tracked file from the current main tree.
#   2. Deletes the scrub list (scripts/ce-export/scrub-list.txt).
#   3. Overlays CE overrides (scripts/ce-export/overrides/) — files whose CE
#      version differs from main (billing stubs, admin-stripped surfaces).
#   4. Copies CE-only extras (scripts/ce-export/extra/).
#   5. Materializes the whisper.cpp submodule content (main tracks it as a
#      submodule; CE ships the vendored tree so users don't need submodules).
#   6. Aligns version metadata to the main repo's current version.
#   7. Verifies: tsc + eslint + server build (drift fails loudly, never
#      silently).
#
# Usage:
#   scripts/export-community-edition.sh <ce-dir> [--verify-only]
#     <ce-dir>      existing clone/worktree of the CE repo (or empty dir;
#                   --no-git to skip git operations)
#     --no-git      assemble files only (no commit/push/tag)
#
# Requirements:
#   - run from the main repo working tree (the source of truth)
#   - gh CLI authenticated for Schoedel-Design-AI org to push/tag
#
# After a successful export, commit + push + tag happen in <ce-dir>:
#   git add -A && git commit -m "Proset Community Edition vX.Y.Z (sync from main)"
#   git push origin main && git tag vX.Y.Z && git push origin vX.Y.Z
set -eo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CE_EXPORT_DIR="${SCRIPT_DIR}/ce-export"
REPO_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

CE_DIR="${1:?usage: export-community-edition.sh <ce-dir> [--no-git]}"
DO_GIT=1
if [[ "${2:-}" == "--no-git" ]]; then DO_GIT=0; fi

if [[ ! -d "${CE_DIR}" ]]; then
  echo "ERROR: <ce-dir> must exist (clone of Schoedel-Design-AI/proset-community or empty dir with --no-git)."
  exit 1
fi

# ---- 1. Source: current main tree ------------------------------------------
cd "${REPO_DIR}"
MAIN_VERSION="$(python3 -c "import json; print(json.load(open('package.json'))['version'])")"
echo "==> Exporting Proset CE from main @ $(git rev-parse --short HEAD) (v${MAIN_VERSION})"

# ---- 2-5. Assemble ----------------------------------------------------------
cd "${CE_DIR}"
# Remove everything tracked/untracked in the CE dir (keep .git).
# Must remove symlinks too (node_modules/.bin/* are symlinks — find -type f
# leaves them dangling, node_modules dir survives, and npm ci gets skipped).
if [[ -d .git ]]; then
  git rm -rq --cached . 2>/dev/null || true
fi
find . -path ./.git -prune -o -type f -print0 | xargs -0 rm -f 2>/dev/null || true
find . -path ./.git -prune -o -type l -print0 | xargs -0 rm -f 2>/dev/null || true
find . -path ./.git -prune -o -type d -empty -delete 2>/dev/null || true

# Copy all main tracked files (skip the whisper.cpp submodule gitlink —
# materialized separately below)
git -C "${REPO_DIR}" ls-files -z | while IFS= read -r -d '' f; do
  if [[ "${f}" == "android/app/src/main/cpp/whisper.cpp" ]]; then
    continue
  fi
  mkdir -p "$(dirname "${f}")"
  cp "${REPO_DIR}/${f}" "${f}"
done

# Scrub internal surfaces
while IFS= read -r f; do
  rm -f "${f}"
done < "${CE_EXPORT_DIR}/scrub-list.txt"

# Directory-level scrub: whole dirs that are internal-only and must NEVER ship
# (covers renames/new files inside them — the file-level list above can go
# stale when files move). Keep in sync with the file list.
for dir in \
  "_devprocess" \
  ".claude" \
  ".github" \
  ".hermes" \
  ".idea" \
  ".vscode" \
  "AI Fix Request Files" \
  "docs" \
  "docs-site" \
  "maestro" \
  "play-store-assets"; do
  rm -rf "${dir}"
done

# Overlay CE overrides
(cd "${CE_EXPORT_DIR}/overrides" && find . -type f | while read -r f; do
  rel="${f#./}"
  mkdir -p "${CE_DIR}/$(dirname "${rel}")"
  cp "${CE_EXPORT_DIR}/overrides/${f}" "${CE_DIR}/${rel}"
done)

# CE-only extras
(cd "${CE_EXPORT_DIR}/extra" && find . -type f | while read -r f; do
  rel="${f#./}"
  mkdir -p "${CE_DIR}/$(dirname "${rel}")"
  cp "${CE_EXPORT_DIR}/extra/${f}" "${CE_DIR}/${rel}"
done)

# Materialize whisper.cpp (main has it as a submodule)
if [[ -d "${REPO_DIR}/android/app/src/main/cpp/whisper.cpp" ]]; then
  rm -rf "android/app/src/main/cpp/whisper.cpp"
  mkdir -p "android/app/src/main/cpp"
  cp -a "${REPO_DIR}/android/app/src/main/cpp/whisper.cpp" "android/app/src/main/cpp/whisper.cpp"
  rm -rf "android/app/src/main/cpp/whisper.cpp/.git"
fi

# ---- 6. Version alignment ----------------------------------------------------
python3 - <<PY
import json
from pathlib import Path
root = Path(".")
for p in ("package.json", "app.json"):
    path = root / p
    if not path.exists():
        continue
    data = json.loads(path.read_text(encoding="utf-8"))
    data["version"] = "${MAIN_VERSION}"
    if p == "app.json" and "android" in data:
        data["android"]["versionCode"] = data.get("android", {}).get("versionCode")
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
print("version aligned to ${MAIN_VERSION}")
PY

echo "==> Assembled ${CE_DIR} ($(find . -path ./.git -prune -o -type f -print | wc -l) files)"

# ---- 7. Verify ---------------------------------------------------------------
echo "==> Installing dependencies + verifying (tsc + eslint + server build)..."
rm -rf node_modules
npm ci --no-audit --no-fund
npx tsc --noEmit
npx eslint .
npm run server:build

echo ""
echo "==> CE export verified OK (tsc + eslint + server build)."

if [[ "${DO_GIT}" == "1" && -d .git ]]; then
  # No-op guard: only commit/push/tag when the assembled tree differs from
  # HEAD. Stage first, then check the index against HEAD (git diff --cached
  # --quiet) — a `git status | grep -q` pipeline dies of SIGPIPE under
  # `set -o pipefail` and always reports "no changes".
  git add -A
  if ! git diff --cached --quiet; then
    git -c user.name="Proset CE Exporter" -c user.email="contact@schoedel.design" \
      commit -m "Proset Community Edition v${MAIN_VERSION} (sync from main)"
    git push origin main
    # Re-runs: move the tag if it already exists (export is idempotent)
    if git rev-parse -q --verify "refs/tags/v${MAIN_VERSION}" >/dev/null; then
      git tag -d "v${MAIN_VERSION}"
      git push origin ":refs/tags/v${MAIN_VERSION}" || true
    fi
    git tag "v${MAIN_VERSION}"
    git push origin "v${MAIN_VERSION}"
    echo "==> Pushed + tagged v${MAIN_VERSION}"
  else
    echo "==> No changes since last export — nothing to push."
  fi
else
  echo "==> --no-git: files assembled at ${CE_DIR}; commit/push/tag skipped."
fi
