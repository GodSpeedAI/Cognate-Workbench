#!/usr/bin/env bash
# Isolated smoke test of a Cognate Workbench archive: database, browser and persistence, in /tmp.
#
#   bash smoke-cognate-workbench.sh <cognate-workbench-<version>-<tag>.tar.gz> [repo-checkout]
#
# Runs every installed-archive journey (first launch, durable restart, interrupted ownership, stale recovery,
# fail-closed, external PostgreSQL, upgrade/uninstall) against disposable homes under /tmp, then the browser check
# when a repository checkout (for its Playwright dependency) is given. Your home directory is never used.
set -euo pipefail

ARCHIVE="${1:?usage: smoke-cognate-workbench.sh <archive.tar.gz> [repo-checkout]}"
REPO="${2:-}"
ARCHIVE="$(cd "$(dirname "$ARCHIVE")" && pwd)/$(basename "$ARCHIVE")"
WORK="$(mktemp -d /tmp/cognate-smoke.XXXXXX)"
trap 'rm -rf "$WORK"' EXIT

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -n "$REPO" ]; then
  COGNATE_QUALIFY_BROWSER=1 bash "$REPO/scripts/qualify-all.sh" "$ARCHIVE" "$WORK/qualify" 3600
else
  COGNATE_QUALIFY_BROWSER=0 bash "$HERE/qualify-all.sh" "$ARCHIVE" "$WORK/qualify" 3600
fi
