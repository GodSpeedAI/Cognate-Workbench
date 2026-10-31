#!/usr/bin/env bash
# External PostgreSQL (J-PKG-external-postgres) for an installed Cognate Workbench archive.
#
#   scripts/qualify-external.sh <archive.tar.gz> <work-dir> [port]
#
# A separately managed PostgreSQL server (a disposable pg0 instance with its own name and data directory,
# standing in for an operator's server) is started first. Workbench is then launched with COGNATE_POSTGRES_URL.
# It must never start, adopt or stop a bundled instance; a value written through it must persist across a
# restart; and the external server must still be running and unchanged after Workbench stops.
set -euo pipefail

ARCHIVE="${1:?usage: qualify-external.sh <archive.tar.gz> <work-dir> [port]}"
WORK_DIR="${2:?usage: qualify-external.sh <archive.tar.gz> <work-dir> [port]}"
PORT="${3:-3300}"
EXTERNAL="qualify-external-$$"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=qualify-lib.sh
source "$HERE/qualify-lib.sh"

install_archive "$ARCHIVE" "$WORK_DIR"
trap 'stop_pg0 "$EXTERNAL"' EXIT

# The external server: separately managed, its own data directory and password.
"$PG0" start --name "$EXTERNAL" --data-dir "$WORK/external-data" --password "ext-$RANDOM-$RANDOM" >/dev/null 2>&1
EXT_PID="$(pg0_pid "$EXTERNAL")"
[ -n "$EXT_PID" ] || { echo "FAIL: the external server did not start"; exit 1; }
export COGNATE_POSTGRES_URL="$("$PG0" info --name "$EXTERNAL" -o json | sed -n 's/.*"uri": *"\([^"]*\)".*/\1/p')"
echo "external: server \"$EXTERNAL\" pid=$EXT_PID"

# 1. Launch against the external URL: no bundled database may appear.
start_server first "$PORT"
TOKEN="$(boot_token "$PORT")"
[ "$(rpc "$PORT" "$TOKEN" Invoke '{"capability":"settings.changeSendBehavior","input":{"sendBehavior":"steer"}}' | tail -n 1)" = 200 ] || { echo "FAIL: write through the external database"; exit 1; }
[ "$(await_setting "$PORT" "$TOKEN" steer)" = steer ] || { echo "FAIL: write not visible through the external database"; exit 1; }
[ ! -e "$DATA_HOME/database/bundled.json" ] || { echo "FAIL: a bundled database was recorded while an external URL was set"; exit 1; }
BUNDLED_COUNT="$("$PG0" list 2>/dev/null | grep -c "cognate-workbench-" || true)"
[ "$BUNDLED_COUNT" = 0 ] || { echo "FAIL: a bundled instance exists in this home ($BUNDLED_COUNT)"; exit 1; }
echo "external: state written through COGNATE_POSTGRES_URL; no bundled instance in this home"

# 2. Stop Workbench: the external server must keep running, untouched.
stop_server first
[ "$(pg0_pid "$EXTERNAL")" = "$EXT_PID" ] || { echo "FAIL: the external server was stopped or replaced by a clean Workbench shutdown"; exit 1; }
echo "stop: external server still running (pid $EXT_PID)"

# 3. Restart: state continues from the external server.
start_server second "$PORT"
TOKEN2="$(boot_token "$PORT")"
[ "$(await_setting "$PORT" "$TOKEN2" steer)" = steer ] || { echo "FAIL: state lost across restart on the external server"; exit 1; }
stop_server second
[ "$(pg0_pid "$EXTERNAL")" = "$EXT_PID" ] || { echo "FAIL: the external server changed during the second run"; exit 1; }
echo "PASS: external PostgreSQL persisted state, bundled pg0 never started, external server untouched (J-PKG-external-postgres)"
