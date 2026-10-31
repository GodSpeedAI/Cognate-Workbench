#!/usr/bin/env bash
# Stale-database qualification for an installed Cognate Workbench archive.
#
#   scripts/qualify-stale.sh <archive.tar.gz> <work-dir> [port]
#
# Host-style crash: the server and the bundled PostgreSQL postmaster are both killed with SIGKILL, so the
# data directory is left with a stale postmaster.pid. A relaunch must start the instance again, keep every
# durable value, and must not reinitialise the data directory.
set -euo pipefail

ARCHIVE="${1:?usage: qualify-stale.sh <archive.tar.gz> <work-dir> [port]}"
WORK_DIR="${2:?usage: qualify-stale.sh <archive.tar.gz> <work-dir> [port]}"
PORT="${3:-3600}"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=qualify-lib.sh
source "$HERE/qualify-lib.sh"

install_archive "$ARCHIVE" "$WORK_DIR"
trap 'stop_pg0 cognate-dev' EXIT

start_server first "$PORT"
TOKEN="$(boot_token "$PORT")"
WRITE="$(rpc "$PORT" "$TOKEN" Invoke '{"capability":"settings.changeSendBehavior","input":{"sendBehavior":"steer"}}' | tail -n 1)"
[ "$WRITE" = 200 ] || { echo "FAIL: write returned $WRITE"; exit 1; }
[ "$(await_setting "$PORT" "$TOKEN" steer)" = steer ] || { echo "FAIL: write not visible before the crash"; exit 1; }
PG0_BEFORE="$(pg0_pid cognate-dev)"
[ -n "$PG0_BEFORE" ] || { echo "FAIL: no running pg0 instance"; exit 1; }
DATA_DIR="$(find "$WORK_DIR/home" -name postmaster.pid -path "*cognate-dev*" | head -1 | xargs dirname)"
echo "before crash: pg0 postmaster pid=$PG0_BEFORE data=$DATA_DIR"

# Simulate a host crash: the database and the server die together, leaving postmaster.pid behind.
kill -KILL "$PG0_BEFORE"
kill_server first || true
sleep 2
[ -f "$DATA_DIR/postmaster.pid" ] || { echo "FAIL: no stale postmaster.pid was left to recover from"; exit 1; }
echo "after crash: stale postmaster.pid present"

start_server second "$PORT"
PG0_AFTER="$(pg0_pid cognate-dev)"
[ -n "$PG0_AFTER" ] || { echo "FAIL: pg0 not running after relaunch"; exit 1; }
[ "$PG0_AFTER" != "$PG0_BEFORE" ] || { echo "FAIL: the crashed postmaster pid was reused"; exit 1; }
TOKEN2="$(boot_token "$PORT")"
VALUE="$(await_setting "$PORT" "$TOKEN2" steer || true)"
echo "after relaunch: pg0 pid=$PG0_AFTER value=${VALUE:-<unset>}"
[ "$VALUE" = steer ] || { echo "FAIL: durable value lost after the database crash"; exit 1; }
stop_server second
[ -z "$(pg0_pid cognate-dev)" ] || { echo "FAIL: database still running after clean shutdown"; exit 1; }
echo "PASS: stale database recovered without data loss or reinitialisation"
