#!/usr/bin/env python3
"""Bump the Android versionCode + versionName across the three aligned files.

build-android.sh refuses to build if version metadata differs across:
  android/app/build.gradle  (versionCode N, versionName "X.Y.Z")
  app.json                  ("version": "X.Y.Z", "android": {"versionCode": N})
  package.json              ("version": "X.Y.Z")

Default bump: versionCode += 1 and versionName patch += 1. Used by the daily
Android deploy workflow (deploy-android.yml) before building the release AAB.

Play-aware floor (2026-08-28): if the Play service-account key is available
(play-publisher.json), the script queries the highest versionCode already
published on ANY track and bumps to max(local, highest_published) + 1. This
closes the blind-+1 trap that left `main` at 99 while Play's internal track
already held 100 (a prior run uploaded 100 but failed before its commit step,
so the next run re-bumped to 100 and Play refused with "versionCode must be
greater than every versionCode already published"). Querying Play makes the
bump idempotent and self-healing against that lost-commit failure mode.
"""

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
GRADLE = ROOT / "android" / "app" / "build.gradle"
APP_JSON = ROOT / "app.json"
PKG_JSON = ROOT / "package.json"
PACKAGE_NAME = "ms.aifor.app"


def bump_patch(version: str) -> str:
    parts = version.split(".")
    try:
        parts[-1] = str(int(parts[-1]) + 1)
    except (ValueError, IndexError):
        parts.append("1")
    return ".".join(parts)


def _highest_published_version_code() -> int | None:
    """Return the highest versionCode published on any Play track.

    Returns None when the Play service-account key is absent (local dry-run).
    Raises when the key is present but the query fails — a blind +1 in that
    state would risk re-bumping into an already-published versionCode, the
    exact failure this guard exists to prevent.
    """
    key_path = Path.home() / ".config" / "gcloud" / "play-publisher.json"
    if not key_path.exists():
        return None
    try:
        from google.oauth2 import service_account
        import google_auth_httplib2
        import googleapiclient.discovery
        import httplib2
    except ImportError as exc:
        raise RuntimeError(
            "play-publisher.json exists but Play query deps are missing "
            "(google-api-python-client, google-auth-httplib2)"
        ) from exc

    creds = service_account.Credentials.from_service_account_file(
        str(key_path),
        scopes=["https://www.googleapis.com/auth/androidpublisher"],
    )
    http = google_auth_httplib2.AuthorizedHttp(
        creds, http=httplib2.Http(timeout=60)
    )
    service = googleapiclient.discovery.build(
        "androidpublisher", "v3", http=http, cache_discovery=False
    )
    edit = service.edits().insert(packageName=PACKAGE_NAME).execute()
    edit_id = edit["id"]
    try:
        tracks = (
            service.edits()
            .tracks()
            .list(packageName=PACKAGE_NAME, editId=edit_id)
            .execute()
            .get("tracks", [])
        )
        codes = []
        for t in tracks:
            for release in t.get("releases", []):
                for code in release.get("versionCodes", []):
                    try:
                        codes.append(int(code))
                    except ValueError:
                        pass
        return max(codes) if codes else None
    finally:
        service.edits().delete(packageName=PACKAGE_NAME, editId=edit_id).execute()


def main() -> None:
    gradle = GRADLE.read_text(encoding="utf-8")
    m_code = re.search(r"^(\s*versionCode\s+)(\d+)(\s*)$", gradle, re.MULTILINE)
    m_name = re.search(r'^(\s*versionName\s+")([^"]+)("\s*)$', gradle, re.MULTILINE)
    if not m_code or not m_name:
        print("FATAL: versionCode/versionName not found in build.gradle", file=sys.stderr)
        sys.exit(1)

    old_code = int(m_code.group(2))
    old_name = m_name.group(2)

    highest = _highest_published_version_code()
    floor = old_code
    if highest is not None and highest >= old_code:
        floor = highest
        print(
            f"Play already holds versionCode {highest} >= local {old_code}; "
            f"bumping above the published ceiling."
        )
    new_code = floor + 1
    new_name = bump_patch(old_name)

    gradle = re.sub(
        r"^(\s*versionCode\s+)\d+(\s*)$",
        lambda m: f"{m.group(1)}{new_code}{m.group(2)}",
        gradle,
        count=1,
        flags=re.MULTILINE,
    )
    gradle = re.sub(
        r'^(\s*versionName\s+)"[^"]+"(\s*)$',
        lambda m: f'{m.group(1)}"{new_name}"{m.group(2)}',
        gradle,
        count=1,
        flags=re.MULTILINE,
    )
    GRADLE.write_text(gradle, encoding="utf-8")

    app = APP_JSON.read_text(encoding="utf-8")
    app = re.sub(r'("version"\s*:\s*)"[^"]*"', lambda m: f'{m.group(1)}"{new_name}"', app, count=1)
    app = re.sub(r'("versionCode"\s*:\s*)\d+', lambda m: f"{m.group(1)}{new_code}", app, count=1)
    APP_JSON.write_text(app, encoding="utf-8")

    pkg = PKG_JSON.read_text(encoding="utf-8")
    pkg = re.sub(r'("version"\s*:\s*)"[^"]*"', lambda m: f'{m.group(1)}"{new_name}"', pkg, count=1)
    PKG_JSON.write_text(pkg, encoding="utf-8")

    print(f"Bumped versionCode {old_code} -> {new_code}, versionName {old_name} -> {new_name}")


if __name__ == "__main__":
    main()
