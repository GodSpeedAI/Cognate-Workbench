#!/usr/bin/env bash
# Fail-closed database behaviour (J-PKG-fail-closed) for an installed Cognate Workbench archive.
#
#   scripts/qualify-fail-closed.sh <archive.tar.gz> <work-dir> [port]
#
# Every case must refuse to run, name its condition, and leave no new store, adopt no instance, and fall back
# to nothing: no bundled database for an external failure, no in-memory store, no empty database.
set -euo pipefail

ARCHIVE="${1:?usage: qualify-fail-closed.sh <archive.tar.gz> <work-dir> [port]}"
WORK_DIR="${2:?usage: qualify-fail-closed.sh <archive.tar.gz> <work-dir> [port]}"
PORT="${3:-3300}"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=qualify-lib.sh
source "$HERE/qualify-lib.sh"

install_archive "$ARCHIVE" "$WORK_DIR"
trap 'stop_pg0; stop_pg0 qualify-fc-external' EXIT

# A healthy first launch gives a recorded, initialised bundled database to attack.
start_server baseline "$PORT"
TOKEN="$(boot_token "$PORT")"
[ "$(rpc "$PORT" "$TOKEN" Invoke '{"capability":"settings.changeSendBehavior","input":{"sendBehavior":"steer"}}' | tail -n 1)" = 200 ] || { echo "FAIL: baseline write"; exit 1; }
stop_server baseline
NAME="$(db_name)"
RECORD="$DATA_HOME/database/bundled.json"
DATA_DIR="$(sed -n 's/.*"dataDir": *"\([^"]*\)".*/\1/p' "$RECORD" | head -1)"
cp "$RECORD" "$WORK/record.good"
echo "baseline: bundled database \"$NAME\" initialised at $DATA_DIR"

# 1. Missing bundled pg0.
mv "$PG0" "$PG0.away"
expect_refusal missing-pg0 "$PORT" "bundled pg0 is missing"
mv "$PG0.away" "$PG0"

# 2. Corrupted bundled pg0 (one byte changed): integrity verification must fail before anything runs.
cp "$PG0" "$PG0.bak"
printf 'x' | dd of="$PG0" bs=1 seek=4096 conv=notrunc 2>/dev/null
expect_refusal corrupted-pg0 "$PORT" "integrity verification"
mv "$PG0.bak" "$PG0"

# 3. Stale metadata: the recorded instance's data directory has disappeared. It must not be recreated empty.
stop_pg0 "$NAME"
mv "$DATA_DIR" "$WORK/data-moved-aside"
expect_refusal stale-data-directory "$PORT" "refusing to create an empty store"
[ ! -e "$DATA_DIR" ] || { echo "FAIL: an empty data directory was created"; exit 1; }
mv "$WORK/data-moved-aside" "$DATA_DIR"

# 4. Conflicting instance: the record is gone but pg0 still has an instance with this name. Never adopt it.
rm -f "$RECORD"
"$PG0" stop --name "$NAME" >/dev/null 2>&1 || true
expect_refusal unrecorded-instance "$PORT" "refusing to adopt"
cp "$WORK/record.good" "$RECORD"

# 5. Incompatible PostgreSQL version recorded for the instance.
sed -i.bak 's/"version": *"[^"]*"/"version": "17.0.0"/' "$RECORD" && rm -f "$RECORD.bak"
expect_refusal incompatible-version "$PORT" "this build expects 17.0.0"
cp "$WORK/record.good" "$RECORD"

# 6. External PostgreSQL with invalid credentials: start a disposable external server, then use the wrong password.
"$PG0" start --name qualify-fc-external --data-dir "$WORK/external-data" --password "right-$RANDOM$RANDOM" >/dev/null 2>&1
EXT_URI="$("$PG0" info --name qualify-fc-external -o json | sed -n 's/.*"uri": *"\([^"]*\)".*/\1/p')"
BAD_URI="$(printf '%s' "$EXT_URI" | sed 's#//postgres:[^@]*@#//postgres:wrong-password@#')"
RECORD_BEFORE="$(cat "$RECORD")"
export COGNATE_POSTGRES_URL="$BAD_URI"
expect_refusal external-bad-credentials "$PORT" "."
unset COGNATE_POSTGRES_URL
[ "$(cat "$RECORD")" = "$RECORD_BEFORE" ] || { echo "FAIL: an external failure changed the bundled record"; exit 1; }
[ -n "$(pg0_pid qualify-fc-external)" ] || { echo "FAIL: the external server was disturbed"; exit 1; }
echo "external: invalid credentials refused; the bundled record and the external server are untouched"

# 7. External PostgreSQL unreachable: no fallback to the bundled instance and no in-memory store.
export COGNATE_POSTGRES_URL="postgres://postgres:x@127.0.0.1:1/postgres"
expect_refusal external-unreachable "$PORT" "."
unset COGNATE_POSTGRES_URL
if grep -qi "in-memory\|memory store" "$WORK/server-external-unreachable.log"; then echo "FAIL: fell back to an in-memory store"; exit 1; fi
echo "external: unreachable server refused; no in-memory fallback"

# 8. Finally, the untouched healthy database still starts and holds its state.
start_server recovered "$PORT"
TOKEN="$(boot_token "$PORT")"
[ "$(await_setting "$PORT" "$TOKEN" steer)" = steer ] || { echo "FAIL: the healthy database lost its state after the refusals"; exit 1; }
stop_server recovered
echo "PASS: every fail-closed case refused without creating, adopting, or falling back (J-PKG-fail-closed)"
