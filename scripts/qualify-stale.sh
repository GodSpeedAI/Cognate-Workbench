#!/usr/bin/env bash
# Stale database recovery (J-PKG-interrupted-ownership, stale variant) for an installed archive.
#
#   scripts/qualify-stale.sh <archive.tar.gz> <work-dir> [port]
#
# The server AND its PostgreSQL postmaster are killed together, leaving postmaster.pid behind. The relaunch
# must clear the stale lock file, start a new postmaster on the same data directory, return the value written
# before the crash, and shut down cleanly.
set -euo pipefail

ARCHIVE="${1:?usage: qualify-stale.sh <archive.tar.gz> <work-dir> [port]}"
WORK_DIR="${2:?usage: qualify-stale.sh <archive.tar.gz> <work-dir> [port]}"
PORT="${3:-3300}"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=qualify-lib.sh
source "$HERE/qualify-lib.sh"

install_archive "$ARCHIVE" "$WORK_DIR"
trap 'stop_pg0' EXIT

start_server first "$PORT"
TOKEN="$(boot_token "$PORT")"
WRITE="$(rpc "$PORT" "$TOKEN" Invoke '{"capability":"settings.changeSendBehavior","input":{"sendBehavior":"steer"}}' | tail -n 1)"
[ "$WRITE" = 200 ] || { echo "FAIL: write returned $WRITE"; exit 1; }
[ "$(await_setting "$PORT" "$TOKEN" steer)" = steer ] || { echo "FAIL: write not visible before the crash"; exit 1; }

NAME="$(db_name)"
PG0_BEFORE="$(pg0_pid "$NAME")"
[ -n "$PG0_BEFORE" ] || { echo "FAIL: no running bundled instance"; exit 1; }
DATA_DIR="$(sed -n 's/.*"dataDir": *"\([^"]*\)".*/\1/p' "$DATA_HOME/database/bundled.json" | head -1)"
[ -f "$DATA_DIR/postmaster.pid" ] || { echo "FAIL: no postmaster.pid in $DATA_DIR"; exit 1; }

# Abnormal end of both processes: the database never got a chance to remove its lock file.
kill_server first
kill -KILL "$PG0_BEFORE"
for _ in $(seq 1 30); do kill -0 "$PG0_BEFORE" 2>/dev/null || break; sleep 1; done
[ -f "$DATA_DIR/postmaster.pid" ] || { echo "FAIL: the crash did not leave a stale postmaster.pid to recover from"; exit 1; }
echo "crash: server and postmaster $PG0_BEFORE killed; stale postmaster.pid left in place"

start_server recovered "$PORT"
PG0_AFTER="$(pg0_pid "$NAME")"
[ -n "$PG0_AFTER" ] && [ "$PG0_AFTER" != "$PG0_BEFORE" ] || { echo "FAIL: no new postmaster after recovery (before=$PG0_BEFORE after=${PG0_AFTER:-none})"; exit 1; }
TOKEN2="$(boot_token "$PORT")"
VALUE="$(await_setting "$PORT" "$TOKEN2" steer || true)"
[ "$VALUE" = steer ] || { echo "FAIL: value lost after stale recovery (got '${VALUE:-<unset>}')"; exit 1; }
echo "recovered: new postmaster $PG0_AFTER on the same data; value survived"

stop_server recovered
[ -z "$(pg0_pid "$NAME")" ] || { echo "FAIL: database still running after clean shutdown"; exit 1; }
echo "PASS: stale postmaster recovered without data loss (J-PKG-interrupted-ownership)"
