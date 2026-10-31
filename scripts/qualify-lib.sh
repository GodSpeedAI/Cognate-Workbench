# Shared helpers for the installed-archive qualification scripts. Source this file; do not run it.
#
#   install_archive <archive.tar.gz> <work-dir>   fresh install + disposable HOME
#   start_server <label> <port>                   launch, wait for /health, record PID in $WORK/<label>.pid
#   stop_server <label>                           SIGTERM, wait for exit (fails if it does not exit)
#   kill_server <label>                           SIGKILL (abnormal termination), wait for exit
#   boot_token <port>                             the boot's `wbs1.` browser session bearer
#   rpc <port> <token> <method> <json>            Connect JSON call; prints body then HTTP status
#   setting <port> <token>                        the current sendBehavior value (empty if unset)
#   await_setting <port> <token> <expected>       poll until the projection shows the expected value
#   pg0_pid <name>                                PID of a running bundled pg0 instance (empty if none)
#   stop_pg0 <name>                               stop the bundled pg0 instance and wait for its postmaster
set -euo pipefail

install_archive() {
  local archive="$1" work="$2"
  rm -rf "$work"
  mkdir -p "$work/home" "$work/install"
  tar -xzf "$archive" -C "$work/install"
  WORK="$work"
  APP="$(ls -d "$work"/install/cognate-workbench-*)"
  BIN="$APP/bin/cognate-workbench"
  PG0="$APP/share/cognate-workbench/bin/pg0"
  export HOME="$work/home"
}

pid_of() { cat "$WORK/$1.pid"; }

start_server() {
  local label="$1" port="$2"
  PORT="$port" "$BIN" > "$WORK/server-$label.log" 2>&1 < /dev/null &
  echo $! > "$WORK/$label.pid"
  for _ in $(seq 1 240); do
    if curl -fsS "http://127.0.0.1:$port/health" >/dev/null 2>&1; then return 0; fi
    if ! kill -0 "$(pid_of "$label")" 2>/dev/null; then break; fi
    sleep 1
  done
  echo "FAIL: server $label did not become healthy"; tail -40 "$WORK/server-$label.log"; return 1
}

wait_exit() {
  local pid="$1"
  for _ in $(seq 1 60); do
    if ! kill -0 "$pid" 2>/dev/null; then return 0; fi
    sleep 1
  done
  return 1
}

stop_server() {
  local pid; pid="$(pid_of "$1")"
  kill -TERM "$pid" 2>/dev/null || true
  wait_exit "$pid" || { echo "FAIL: server $1 did not exit on SIGTERM"; kill -KILL "$pid" 2>/dev/null || true; return 1; }
}

kill_server() {
  local pid; pid="$(pid_of "$1")"
  kill -KILL "$pid"
  wait_exit "$pid" || { echo "FAIL: server $1 survived SIGKILL"; return 1; }
}

boot_token() {
  curl -fsS "http://127.0.0.1:$1/app.js" | grep -oE '"wbs1\.[^"]+"' | head -1 | tr -d '"'
}

rpc() {
  local port="$1" token="$2" method="$3" body="$4"
  curl -s -w '\n%{http_code}' -X POST -H 'content-type: application/json' \
    -H "authorization: Bearer $token" "http://127.0.0.1:$port/cognate.v1.RuntimeService/$method" -d "$body"
}

setting() {
  rpc "$1" "$2" ReadProjection '{"name":"settings"}' | head -n -1 | grep -oE '"sendBehavior" *: *"[a-z]+"' | head -1 | sed -E 's/.*: *"([a-z]+)"/\1/' || true
}

# The projection folds a write in shortly after the write is accepted, so read with a bounded poll.
await_setting() {
  local port="$1" token="$2" expected="$3" value=""
  for _ in $(seq 1 30); do
    value="$(setting "$port" "$token")"
    if [ "$value" = "$expected" ]; then echo "$value"; return 0; fi
    sleep 1
  done
  echo "$value"; return 1
}

pg0_pid() {
  "$PG0" info --name "$1" 2>/dev/null | awk '/PID:/ {print $2; exit}' || true
}

stop_pg0() {
  HOME="$WORK/home" "$PG0" stop --name "$1" >/dev/null 2>&1 || true
}
