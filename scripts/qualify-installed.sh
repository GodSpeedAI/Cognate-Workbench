#!/usr/bin/env bash
# Smoke test of an installed executable at its installed path (a .deb or .pkg install, not an archive).
#
#   scripts/qualify-installed.sh <cognate-workbench> [port]
#
# The caller sets HOME to a disposable directory. Checks: the executable reports its version, doctor reports
# the bundled database, start serves /health with the semantic model and the UI assets, the boot token is
# substituted, and a SIGTERM stops the bundled database the data home owns.
set -euo pipefail

BIN="${1:?usage: qualify-installed.sh <cognate-workbench> [port]}"
PORT="${2:-3390}"
WORK="$(mktemp -d)"
trap 'kill "$SERVER" 2>/dev/null || true; rm -rf "$WORK"' EXIT

VERSION="$("$BIN" --version)"
case "$VERSION" in "cognate-workbench "*) ;; *) echo "FAIL: unexpected version output: $VERSION"; exit 1 ;; esac
echo "version: $VERSION"

"$BIN" doctor > "$WORK/doctor-before.txt" 2>&1 || true
cat "$WORK/doctor-before.txt"
NAME="$(sed -n 's/.*bundled pg0 (instance "\([^"]*\)").*/\1/p' "$WORK/doctor-before.txt" | head -1)"
[ -n "$NAME" ] || { echo "FAIL: doctor does not report the bundled database"; exit 1; }

PORT="$PORT" "$BIN" start > "$WORK/server.log" 2>&1 &
SERVER=$!
HEALTH=""
for _ in $(seq 1 300); do
  HEALTH="$(curl -fsS "http://127.0.0.1:$PORT/health" 2>/dev/null || true)"
  [ -n "$HEALTH" ] && break
  kill -0 "$SERVER" 2>/dev/null || break
  sleep 1
done
[ -n "$HEALTH" ] || { echo "FAIL: /health never answered"; tail -40 "$WORK/server.log"; exit 1; }
echo "$HEALTH" | grep -q '"ok":true' || { echo "FAIL: /health not ok: $HEALTH"; exit 1; }
echo "$HEALTH" | grep -qE '"objects": *[1-9]' || { echo "FAIL: semantic model not loaded"; exit 1; }
for path in / /app.js /app.css /astryx.css /theme.css; do
  code="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT$path")"
  echo "$path $code"
  [ "$code" = 200 ] || { echo "FAIL: $path returned $code"; exit 1; }
done
curl -fsS "http://127.0.0.1:$PORT/app.js" | grep -q '__COGNATE_BOOT_TOKEN__' && { echo "FAIL: boot token placeholder was not substituted"; exit 1; }

kill -TERM "$SERVER"
wait "$SERVER" || true
"$BIN" doctor > "$WORK/doctor-after.txt" 2>&1 || true
grep -q 'bundled pg0' "$WORK/doctor-after.txt" || { echo "FAIL: doctor lost the database mode after shutdown"; exit 1; }
if grep -q "database instance  *running," "$WORK/doctor-after.txt"; then
  echo "FAIL: the bundled database still runs after a clean shutdown"; exit 1
fi
echo "PASS: installed executable serves the UI and stops its bundled database on SIGTERM"
