#!/usr/bin/env bash
# First launch (J-PKG-first-launch) and durable restart (J-PKG-durable-restart) for an installed archive.
#
#   scripts/qualify-durable.sh <archive.tar.gz> <work-dir> [port]
#
# With a fresh, disposable data home: the bundled pg0 is verified against the release manifest, initialises
# itself, listens on loopback, and serves the canonical semantic model. A real setting is written through the
# Connect API, the server is stopped cleanly (the bundled database must stop with it), relaunched, and the
# value must still be there. The previous boot's browser session must be refused.
set -euo pipefail

ARCHIVE="${1:?usage: qualify-durable.sh <archive.tar.gz> <work-dir> [port]}"
WORK_DIR="${2:?usage: qualify-durable.sh <archive.tar.gz> <work-dir> [port]}"
PORT="${3:-3300}"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=qualify-lib.sh
source "$HERE/qualify-lib.sh"

install_archive "$ARCHIVE" "$WORK_DIR"
trap 'stop_pg0' EXIT

# A. First launch.
MANIFEST="$APP/share/cognate-workbench/MANIFEST.json"
EXPECTED_PG0="$(sed -n '/"pg0": {/,/}/p' "$MANIFEST" | sed -n 's/.*"sha256": *"\([0-9a-f]\{64\}\)".*/\1/p')"
ACTUAL_PG0="$(sha256sum "$PG0" | cut -d' ' -f1)"
[ "$ACTUAL_PG0" = "$EXPECTED_PG0" ] || { echo "FAIL: bundled pg0 digest $ACTUAL_PG0 does not match the manifest"; exit 1; }
echo "first launch: bundled pg0 digest matches the manifest"

start_server first "$PORT"
HEALTH="$(curl -fsS "http://127.0.0.1:$PORT/health")"
echo "$HEALTH" | grep -q '"ok":true' || { echo "FAIL: /health not ok: $HEALTH"; exit 1; }
echo "$HEALTH" | grep -qE '"objects": *[1-9]' || { echo "FAIL: semantic model not loaded: $HEALTH"; exit 1; }
echo "first launch: /health ok, semantic model loaded"

NAME="$(db_name)"
[ -n "$NAME" ] || { echo "FAIL: no database record after first launch"; exit 1; }
PG0_PORT="$("$PG0" info --name "$NAME" -o json | sed -n 's/.*"port": *\([0-9]*\).*/\1/p')"
(exec 3<>"/dev/tcp/127.0.0.1/$PG0_PORT") 2>/dev/null || { echo "FAIL: PostgreSQL is not listening on 127.0.0.1:$PG0_PORT"; exit 1; }
echo "first launch: PostgreSQL \"$NAME\" listening on 127.0.0.1:$PG0_PORT"

# B. Durable restart.
TOKEN_FIRST="$(boot_token "$PORT")"
[ -n "$TOKEN_FIRST" ] || { echo "FAIL: no boot token"; exit 1; }
WRITE="$(rpc "$PORT" "$TOKEN_FIRST" Invoke '{"capability":"settings.changeSendBehavior","input":{"sendBehavior":"steer"}}' | tail -n 1)"
[ "$WRITE" = 200 ] || { echo "FAIL: write returned $WRITE"; exit 1; }
[ "$(await_setting "$PORT" "$TOKEN_FIRST" steer)" = steer ] || { echo "FAIL: write not visible before the restart"; exit 1; }
echo "restart: wrote sendBehavior=steer"

stop_server first
[ -z "$(pg0_pid "$NAME")" ] || { echo "FAIL: bundled database still running after a clean shutdown"; exit 1; }
echo "restart: clean shutdown stopped the bundled database"

start_server second "$PORT"
[ "$(pg0_pid "$NAME")" != "" ] || { echo "FAIL: bundled database not running after relaunch"; exit 1; }
TOKEN_SECOND="$(boot_token "$PORT")"
VALUE="$(await_setting "$PORT" "$TOKEN_SECOND" steer || true)"
[ "$VALUE" = steer ] || { echo "FAIL: durable value lost across restart (got '${VALUE:-<unset>}')"; exit 1; }
OLD="$(rpc "$PORT" "$TOKEN_FIRST" ReadProjection '{"name":"settings"}' | tail -n 1)"
[ "$OLD" = 401 ] || { echo "FAIL: previous boot's session still accepted ($OLD)"; exit 1; }
echo "restart: value survived; previous boot's session refused (401)"

stop_server second
[ -z "$(pg0_pid "$NAME")" ] || { echo "FAIL: bundled database still running after second clean shutdown"; exit 1; }
echo "PASS: first launch and durable restart on the installed package (J-PKG-first-launch, J-PKG-durable-restart)"
