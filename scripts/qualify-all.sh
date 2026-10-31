#!/usr/bin/env bash
# Runs every installed-archive qualification against one archive, each in its own disposable work directory.
#
#   scripts/qualify-all.sh <archive.tar.gz> <work-root> [base-port]
#
# Each journey script gets its own port range, so the scripts never share a listener. Output for each lives in
# <work-root>/<name>.log. Exits non-zero if any journey fails; every failing journey is named.
set -uo pipefail

ARCHIVE="${1:?usage: qualify-all.sh <archive.tar.gz> <work-root> [base-port]}"
ROOT="${2:?usage: qualify-all.sh <archive.tar.gz> <work-root> [base-port]}"
BASE="${3:-3300}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
mkdir -p "$ROOT"
ARCHIVE="$(cd "$(dirname "$ARCHIVE")" && pwd)/$(basename "$ARCHIVE")"

FAILED=()
index=0
for journey in durable interrupted stale fail-closed external upgrade; do
  index=$((index + 1))
  port=$((BASE + index * 10))
  if bash "$HERE/qualify-$journey.sh" "$ARCHIVE" "$ROOT/$journey" "$port" > "$ROOT/$journey.log" 2>&1; then
    echo "PASS  $journey"
  else
    echo "FAIL  $journey (log: $ROOT/$journey.log)"
    tail -12 "$ROOT/$journey.log"
    FAILED+=("$journey")
  fi
done

# Browser qualification on a fresh install: the UI renders from the installed assets and drives Settings.
# Needs the repository checkout (its Playwright install); COGNATE_QUALIFY_BROWSER=0 skips it.
index=$((index + 1))
port=$((BASE + index * 10))
if [ "${COGNATE_QUALIFY_BROWSER:-1}" = 0 ]; then
  echo "SKIP  browser (COGNATE_QUALIFY_BROWSER=0)"
elif (
  source "$HERE/qualify-lib.sh"
  install_archive "$ARCHIVE" "$ROOT/browser"
  trap 'stop_server browser 2>/dev/null; stop_pg0' EXIT
  start_server browser "$port"
  cd "$(dirname "$HERE")" && bun scripts/qualify-browser.ts "http://127.0.0.1:$port/" "$ROOT/browser/shots" "${CHROMIUM:-}"
) > "$ROOT/browser.log" 2>&1; then
  echo "PASS  browser"
else
  echo "FAIL  browser (log: $ROOT/browser.log)"
  tail -12 "$ROOT/browser.log"
  FAILED+=("browser")
fi

if [ "${#FAILED[@]}" -gt 0 ]; then
  echo "qualification FAILED: ${FAILED[*]}"
  exit 1
fi
echo "qualification PASSED: all journeys on $(basename "$ARCHIVE")"
