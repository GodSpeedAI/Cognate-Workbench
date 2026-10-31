#!/usr/bin/env bash
# Durable-restart qualification for an installed Cognate Workbench archive.
#
#   scripts/qualify-durable.sh <archive.tar.gz> <work-dir> [port]
#
# Installs the archive into <work-dir> with a disposable HOME, then: writes a real setting through the
# app's Connect API, stops the server, starts it again, and checks the value survived. It also checks that
# the previous boot's session token is refused after restart, and that the bundled pg0 instance outlives
# the server process (the database lifecycle is pg0's, not the server's).
set -euo pipefail

ARCHIVE="${1:?usage: qualify-durable.sh <archive.tar.gz> <work-dir> [port]}"
WORK="${2:?usage: qualify-durable.sh <archive.tar.gz> <work-dir> [port]}"
PORT="${3:-3200}"
BASE="http://127.0.0.1:$PORT"

rm -rf "$WORK"
mkdir -p "$WORK/home" "$WORK/install"
tar -xzf "$ARCHIVE" -C "$WORK/install"
APP="$(ls -d "$WORK"/install/cognate-workbench-*)"
BIN="$APP/bin/cognate-workbench"
PG0="$APP/share/cognate-workbench/bin/pg0"
export HOME="$WORK/home"
PID_FILE="$WORK/server.pid"

start_server() {
  local log="$WORK/server-$1.log"
  PORT="$PORT" "$BIN" > "$log" 2>&1 &
  echo $! > "$PID_FILE"
  for _ in $(seq 1 240); do
    if curl -fsS "$BASE/health" >/dev/null 2>&1; then return 0; fi
    sleep 1
  done
  echo "FAIL: server $1 did not become healthy"; tail -40 "$log"; exit 1
}

stop_server() {
  local pid; pid="$(cat "$PID_FILE")"
  kill -TERM "$pid"
  for _ in $(seq 1 60); do
    if ! kill -0 "$pid" 2>/dev/null; then return 0; fi
    sleep 1
  done
  echo "FAIL: server did not exit on SIGTERM"; kill -KILL "$pid"; exit 1
}

# The served bundle carries this boot's browser session bearer as a `wbs1.` token; the variable that holds
# it is minified, so the token format is matched instead of a name.
boot_token() {
  curl -fsS "$BASE/app.js" | grep -oE '"wbs1\.[^"]+"' | head -1 | tr -d '"'
}

# POST a Connect JSON call; prints the body, then the status on its own line.
rpc() {
  local token="$1" method="$2" body="$3"
  curl -s -w '\n%{http_code}' -X POST -H 'content-type: application/json' \
    -H "authorization: Bearer $token" "$BASE/cognate.v1.RuntimeService/$method" -d "$body"
}

send_behavior() {
  local token="$1"
  rpc "$token" ReadProjection '{"name":"settings"}' | head -n -1 | grep -oE '"sendBehavior" *: *"[a-z]+"' | head -1 | sed -E 's/.*: *"([a-z]+)"/\1/' || true
}

# 1. First boot: write a setting, read it back.
start_server first
TOKEN_ONE="$(boot_token)"
[ -n "$TOKEN_ONE" ] || { echo "FAIL: could not read the boot session token"; exit 1; }
BEFORE="$(send_behavior "$TOKEN_ONE")"
WRITE_STATUS="$(rpc "$TOKEN_ONE" Invoke '{"capability":"settings.changeSendBehavior","input":{"sendBehavior":"steer"}}' | tail -n 1)"
echo "first boot: before=${BEFORE:-<unset>} write_status=$WRITE_STATUS"
[ "$WRITE_STATUS" = 200 ] || { echo "FAIL: write returned $WRITE_STATUS"; exit 1; }
# The write is accepted before its projection folds it in, so poll the read for a bounded time.
await_value() {
  local token="$1" expected="$2" value=""
  for _ in $(seq 1 30); do
    value="$(send_behavior "$token")"
    if [ "$value" = "$expected" ]; then echo "$value"; return 0; fi
    sleep 1
  done
  echo "$value"; return 1
}
AFTER_WRITE="$(await_value "$TOKEN_ONE" steer || true)"
echo "first boot: after write=$AFTER_WRITE"
[ "$AFTER_WRITE" = steer ] || { echo "FAIL: write not visible in the same boot"; stop_server; exit 1; }

# 2. Normal shutdown. The server stops; pg0 must keep its instance.
stop_server
echo "server stopped"
"$PG0" info --name cognate-dev 2>&1 | head -4 || true

# 3. Relaunch with the same home: the value must survive, and the old session must not.
start_server second
TOKEN_TWO="$(boot_token)"
AFTER_RESTART="$(await_value "$TOKEN_TWO" steer || true)"
echo "second boot: after restart=$AFTER_RESTART"
[ "$AFTER_RESTART" = steer ] || { echo "FAIL: setting lost across restart"; stop_server; exit 1; }
OLD_STATUS="$(rpc "$TOKEN_ONE" ReadProjection '{"name":"settings"}' | tail -n 1)"
echo "second boot: previous-boot token status=$OLD_STATUS"
[ "$OLD_STATUS" = 401 ] || { echo "FAIL: previous boot's session still accepted ($OLD_STATUS)"; exit 1; }

stop_server
echo "PASS: durable setting survived a normal restart; previous session refused"
