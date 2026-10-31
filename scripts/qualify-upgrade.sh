#!/usr/bin/env bash
# Upgrade and uninstall (J-PKG-upgrade-uninstall) for an installed Cognate Workbench archive.
#
#   scripts/qualify-upgrade.sh <archive.tar.gz> <work-dir> [port]
#
# Install A writes durable state. Install B is a second, separate installation of the same archive, run against
# the same data home: it must read A's state. A is then removed: the data home, the bundled instance and an
# unrelated PostgreSQL instance in the same user profile must all survive. This checks the data-preservation
# contract; a real version-to-version migration needs two builds and is qualified per release.
set -euo pipefail

ARCHIVE="${1:?usage: qualify-upgrade.sh <archive.tar.gz> <work-dir> [port]}"
WORK_DIR="${2:?usage: qualify-upgrade.sh <archive.tar.gz> <work-dir> [port]}"
PORT="${3:-3300}"
UNRELATED="qualify-unrelated-$$"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=qualify-lib.sh
source "$HERE/qualify-lib.sh"

install_archive "$ARCHIVE" "$WORK_DIR"
INSTALL_A="$APP"
trap 'stop_pg0; stop_pg0 "$UNRELATED"' EXIT

# An unrelated instance owned by someone else on this machine: it must never be touched.
"$PG0" start --name "$UNRELATED" --data-dir "$WORK/unrelated-data" --password "unrel-$RANDOM" >/dev/null 2>&1
UNRELATED_PID="$(pg0_pid "$UNRELATED")"

# A. Install A writes durable state.
start_server a "$PORT"
TOKEN="$(boot_token "$PORT")"
[ "$(rpc "$PORT" "$TOKEN" Invoke '{"capability":"settings.changeSendBehavior","input":{"sendBehavior":"steer"}}' | tail -n 1)" = 200 ] || { echo "FAIL: write under install A"; exit 1; }
[ "$(await_setting "$PORT" "$TOKEN" steer)" = steer ] || { echo "FAIL: write not visible under install A"; exit 1; }
stop_server a
NAME="$(db_name)"
DATA_DIR="$(sed -n 's/.*"dataDir": *"\([^"]*\)".*/\1/p' "$DATA_HOME/database/bundled.json" | head -1)"
echo "install A: state written; database \"$NAME\" stopped"

# B. Install B: a second installation of the same archive, same data home.
INSTALL_B="$WORK/install-b"
mkdir -p "$INSTALL_B"
tar -xzf "$ARCHIVE" -C "$INSTALL_B"
APP="$(ls -d "$INSTALL_B"/cognate-workbench-*)"
BIN="$APP/bin/cognate-workbench"
PG0="$APP/share/cognate-workbench/bin/pg0"
start_server b "$PORT"
TOKEN_B="$(boot_token "$PORT")"
[ "$(await_setting "$PORT" "$TOKEN_B" steer)" = steer ] || { echo "FAIL: install B did not read install A's state"; exit 1; }
stop_server b
[ -n "$NAME" ] && [ "$(db_name)" = "$NAME" ] || { echo "FAIL: install B changed the database identity"; exit 1; }
echo "upgrade: install B reads install A's state from the same data home"

# C. Uninstall A: remove its binaries and resources only.
rm -rf "$INSTALL_A"
[ -d "$DATA_HOME" ] && [ -f "$DATA_HOME/database/bundled.json" ] && [ -d "$DATA_DIR" ] || { echo "FAIL: uninstalling A removed durable data"; exit 1; }
[ "$(pg0_pid "$UNRELATED")" = "$UNRELATED_PID" ] || { echo "FAIL: uninstalling A disturbed an unrelated instance"; exit 1; }
echo "uninstall: data home, bundled database files and the unrelated instance remain"

# D. Install B still runs and still holds the state.
start_server c "$PORT"
TOKEN_C="$(boot_token "$PORT")"
[ "$(await_setting "$PORT" "$TOKEN_C" steer)" = steer ] || { echo "FAIL: state lost after uninstalling A"; exit 1; }
stop_server c
[ "$(pg0_pid "$UNRELATED")" = "$UNRELATED_PID" ] || { echo "FAIL: the unrelated instance was disturbed by Workbench"; exit 1; }
echo "PASS: upgrade preserved state; uninstall kept data, the bundled database and unrelated instances (J-PKG-upgrade-uninstall)"
