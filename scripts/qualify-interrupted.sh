#!/usr/bin/env bash
# Interrupted-ownership qualification for an installed Cognate Workbench archive.
#
#   scripts/qualify-interrupted.sh <archive.tar.gz> <work-dir> [port]
#
# The owner process is killed with SIGKILL while it holds durable state. The bundled pg0 instance
# is left running (it outlives the server by design). The test then checks that a relaunch:
#   1. reconnects to the same pg0 instance (same postmaster PID: no re-initialisation, no second start),
#   2. returns the value written before the crash, and refuses the crashed boot's session,
#   3. refuses a second owner on the same port without touching the database,
#   4. shuts down cleanly on SIGTERM.
set -euo pipefail

ARCHIVE="${1:?usage: qualify-interrupted.sh <archive.tar.gz> <work-dir> [port]}"
WORK_DIR="${2:?usage: qualify-interrupted.sh <archive.tar.gz> <work-dir> [port]}"
PORT="${3:-3300}"
PORT_TWO="$((PORT + 1))"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=qualify-lib.sh
source "$HERE/qualify-lib.sh"

install_archive "$ARCHIVE" "$WORK_DIR"
trap 'stop_pg0 cognate-dev' EXIT

# 1. Owner boot: write durable state, record the database owner.
start_server owner "$PORT"
TOKEN_CRASHED="$(boot_token "$PORT")"
[ -n "$TOKEN_CRASHED" ] || { echo "FAIL: no boot token"; exit 1; }
WRITE="$(rpc "$PORT" "$TOKEN_CRASHED" Invoke '{"capability":"settings.changeSendBehavior","input":{"sendBehavior":"steer"}}' | tail -n 1)"
[ "$WRITE" = 200 ] || { echo "FAIL: write returned $WRITE"; exit 1; }
[ "$(await_setting "$PORT" "$TOKEN_CRASHED" steer)" = steer ] || { echo "FAIL: write not visible before the crash"; exit 1; }
PG0_OWNER="$(pg0_pid cognate-dev)"
[ -n "$PG0_OWNER" ] || { echo "FAIL: no running pg0 instance"; exit 1; }
echo "owner: wrote steer; pg0 postmaster pid=$PG0_OWNER"

# 2. Abnormal termination of the owner process.
kill_server owner
echo "owner: killed with SIGKILL"

# 3. Relaunch: must reconnect, not re-initialise.
start_server recovered "$PORT"
PG0_RECOVERED="$(pg0_pid cognate-dev)"
[ "$PG0_RECOVERED" = "$PG0_OWNER" ] || { echo "FAIL: relaunch changed the postmaster ($PG0_OWNER -> $PG0_RECOVERED)"; exit 1; }
TOKEN_RECOVERED="$(boot_token "$PORT")"
VALUE="$(await_setting "$PORT" "$TOKEN_RECOVERED" steer || true)"
echo "recovered: pg0 pid=$PG0_RECOVERED value=${VALUE:-<unset>}"
[ "$VALUE" = steer ] || { echo "FAIL: durable value lost across the crash"; exit 1; }
OLD="$(rpc "$PORT" "$TOKEN_CRASHED" ReadProjection '{"name":"settings"}' | tail -n 1)"
[ "$OLD" = 401 ] || { echo "FAIL: crashed boot's session still accepted ($OLD)"; exit 1; }

# 4. A second owner on the same port must refuse to start and must leave the database alone.
PORT="$PORT" "$BIN" > "$WORK/server-conflict.log" 2>&1 < /dev/null &
CONFLICT_PID=$!
set +e; wait "$CONFLICT_PID"; CONFLICT_EXIT=$?; set -e
[ "$CONFLICT_EXIT" -ne 0 ] || { echo "FAIL: a second owner started on an occupied port"; exit 1; }
grep -q 'EADDRINUSE' "$WORK/server-conflict.log" || { echo "FAIL: conflict was not reported as a port conflict"; tail -20 "$WORK/server-conflict.log"; exit 1; }
[ "$(pg0_pid cognate-dev)" = "$PG0_OWNER" ] || { echo "FAIL: the conflicting launch disturbed the database"; exit 1; }
[ "$(await_setting "$PORT" "$TOKEN_RECOVERED" steer)" = steer ] || { echo "FAIL: recovered owner lost state after the conflict"; exit 1; }
echo "conflict: second owner refused (exit $CONFLICT_EXIT, EADDRINUSE); recovered owner intact"

# 5. The recovered owner shuts down cleanly.
stop_server recovered
echo "recovered: clean SIGTERM shutdown"
echo "PASS: interrupted owner recovered without data loss, duplicate initialisation, or a second owner"
