#!/usr/bin/env bash
# Interrupted ownership (J-PKG-interrupted-ownership) for an installed Cognate Workbench archive.
#
#   scripts/qualify-interrupted.sh <archive.tar.gz> <work-dir> [port]
#
# The owner process is killed with SIGKILL while it holds durable state. The bundled pg0 instance is left
# running (it outlives the server by design). The relaunch must:
#   1. reuse the same database process (same postmaster PID: no re-initialisation, no second start),
#   2. return the value written before the crash, and refuse the crashed boot's session,
#   3. refuse a second live owner of the same data home (lock), and a second owner on an occupied port
#      (EADDRINUSE) without disturbing either database,
#   4. shut down cleanly on SIGTERM, stopping the bundled database it owns.
set -euo pipefail

ARCHIVE="${1:?usage: qualify-interrupted.sh <archive.tar.gz> <work-dir> [port]}"
WORK_DIR="${2:?usage: qualify-interrupted.sh <archive.tar.gz> <work-dir> [port]}"
PORT="${3:-3300}"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=qualify-lib.sh
source "$HERE/qualify-lib.sh"

install_archive "$ARCHIVE" "$WORK_DIR"
trap 'stop_pg0' EXIT

# 1. Owner boot: write durable state, record the database owner.
start_server owner "$PORT"
TOKEN_CRASHED="$(boot_token "$PORT")"
[ -n "$TOKEN_CRASHED" ] || { echo "FAIL: no boot token"; exit 1; }
WRITE="$(rpc "$PORT" "$TOKEN_CRASHED" Invoke '{"capability":"settings.changeSendBehavior","input":{"sendBehavior":"steer"}}' | tail -n 1)"
[ "$WRITE" = 200 ] || { echo "FAIL: write returned $WRITE"; exit 1; }
[ "$(await_setting "$PORT" "$TOKEN_CRASHED" steer)" = steer ] || { echo "FAIL: write not visible before the crash"; exit 1; }
NAME="$(db_name)"
PG0_OWNER="$(pg0_pid "$NAME")"
[ -n "$PG0_OWNER" ] || { echo "FAIL: no running bundled instance"; exit 1; }
echo "owner: wrote steer; database \"$NAME\" postmaster pid=$PG0_OWNER"

# 2. Abnormal termination of the owner process.
kill_server owner
echo "owner: killed with SIGKILL (its lock is left behind)"

# 3. Relaunch: must take over the lock, reconnect, and not re-initialise.
start_server recovered "$PORT"
PG0_RECOVERED="$(pg0_pid "$NAME")"
[ "$PG0_RECOVERED" = "$PG0_OWNER" ] || { echo "FAIL: relaunch changed the postmaster ($PG0_OWNER -> $PG0_RECOVERED)"; exit 1; }
TOKEN_RECOVERED="$(boot_token "$PORT")"
VALUE="$(await_setting "$PORT" "$TOKEN_RECOVERED" steer || true)"
echo "recovered: database pid=$PG0_RECOVERED value=${VALUE:-<unset>}"
[ "$VALUE" = steer ] || { echo "FAIL: durable value lost across the crash"; exit 1; }
OLD="$(rpc "$PORT" "$TOKEN_CRASHED" ReadProjection '{"name":"settings"}' | tail -n 1)"
[ "$OLD" = 401 ] || { echo "FAIL: crashed boot's session still accepted ($OLD)"; exit 1; }

# 4a. A second live owner of the same data home must be refused by the lock, before any database work.
expect_refusal same-home-second-owner "$((PORT + 1))" "is using data home"
[ "$(pg0_pid "$NAME")" = "$PG0_OWNER" ] || { echo "FAIL: the refused owner disturbed the database"; exit 1; }

# 4b. A second owner with its own home on the occupied port must fail to listen and leave this database alone.
OTHER_HOME="$WORK/other-home"
mkdir -p "$OTHER_HOME"
export COGNATE_WORKBENCH_HOME="$OTHER_HOME"
expect_refusal occupied-port-second-owner "$PORT" "EADDRINUSE"
unset COGNATE_WORKBENCH_HOME
# The refused owner must not have created a database; if it had, it would be this other home's to stop.
if [ -f "$OTHER_HOME/database/bundled.json" ]; then
  stop_pg0 "$(sed -n 's/.*"name": *"\([^"]*\)".*/\1/p' "$OTHER_HOME/database/bundled.json" | head -1)"
fi
[ "$(pg0_pid "$NAME")" = "$PG0_OWNER" ] || { echo "FAIL: the port conflict disturbed the database"; exit 1; }
[ "$(await_setting "$PORT" "$TOKEN_RECOVERED" steer)" = steer ] || { echo "FAIL: recovered owner lost state after the conflicts"; exit 1; }
echo "conflicts: second owners refused; recovered owner and its database intact"

# 5. The recovered owner shuts down cleanly and stops the database it owns.
stop_server recovered
[ -z "$(pg0_pid "$NAME")" ] || { echo "FAIL: bundled database still running after a clean shutdown"; exit 1; }
echo "PASS: interrupted owner recovered without data loss, duplicate initialisation, or a second owner (J-PKG-interrupted-ownership)"
