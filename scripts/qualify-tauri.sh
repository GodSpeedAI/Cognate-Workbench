#!/usr/bin/env bash
# Tauri desktop-shell smoke harness (desktop-native-completion B2).
#
#   scripts/qualify-tauri.sh --shell <path> [--port N] [--xvfb]     raw shell (debug/dev path)
#   scripts/qualify-tauri.sh --bundle <deb> [--port N] [--xvfb]     packaged shell (deb, extracted)
#   scripts/qualify-tauri.sh --bundle <shell-deb> --coexist <cli-deb>   package-identity pass
#
# Platform-independent rows (design §4): launch → port parsed from desktop-shell.log →
# /health ok → a second instance focuses the first instead of spawning a second backend →
# close (SIGTERM) → sidecar down, bundled pg0 stopped, server.lock released → relaunch →
# clean respawn with the lock re-created → close. Runs against a disposable data home.
#
# Gated rows, enabled when their owning tranche lands (env flags):
#   WB_TAURI_CHECK_IDENTITY=1  (B5)  /health reports the shell identity (COGNATE_SHELL).
#
# One self-contained file for now (no qualify-tauri-lib.sh): a second consumer does not
# exist yet; split it when one does.
set -euo pipefail
set -E
trap 'echo "FAIL: ${BASH_SOURCE[0]##*/} line $LINENO exited $?" >&2' ERR

MODE=""; SHELL_BIN=""; BUNDLE=""; COEXIST=""; PORT_BASE=3720; XVFB=0
while [ $# -gt 0 ]; do
  case "$1" in
    --shell) MODE=shell; SHELL_BIN="$2"; shift 2 ;;
    --bundle) MODE=bundle; BUNDLE="$2"; shift 2 ;;
    --coexist) COEXIST="$2"; shift 2 ;;
    --port) PORT_BASE="$2"; shift 2 ;;
    --xvfb) XVFB=1; shift ;;
    *) echo "unknown argument: $1"; exit 2 ;;
  esac
done
[ -n "$MODE" ] || { echo "usage: qualify-tauri.sh --shell <path> | --bundle <deb> [--coexist <deb>] [--port N] [--xvfb]"; exit 2; }

WORK="$(mktemp -d)"
SHELL_PID=""
cleanup() {
  [ -n "$SHELL_PID" ] && kill -TERM "$SHELL_PID" 2>/dev/null || true
  rm -rf "$WORK"
}
trap cleanup EXIT

echo "== qualify-tauri: mode=$MODE"

if [ "$MODE" = bundle ]; then
  mkdir -p "$WORK/install"
  dpkg-deb -x "$BUNDLE" "$WORK/install"
  # The shell is the executable that is neither the staged sidecar (a rust triple in its
  # name) nor anything under the resources tree (pg0 et al).
  SHELL_BIN="$(find "$WORK/install" -type f -executable \
    ! -path '*/resources/*' \
    ! -name '*-unknown-linux-gnu*' ! -name '*-apple-darwin*' ! -name '*-pc-windows-msvc*' | head -1)"
  [ -n "$SHELL_BIN" ] || { echo "FAIL: no shell binary found in $BUNDLE"; exit 1; }
  echo "shell binary: $SHELL_BIN"
fi
[ -x "$SHELL_BIN" ] || { echo "FAIL: shell binary not executable: $SHELL_BIN"; exit 1; }

# Disposable data home. The harness pins it explicitly (COGNATE_WORKBENCH_HOME) so both
# shell modes agree with the sidecar: debug builds would otherwise hardcode the checkout's
# .data (backend.rs debug path), packaged shells would use the platform default.
export COGNATE_WORKBENCH_HOME="$WORK/data"
mkdir -p "$COGNATE_WORKBENCH_HOME"
DATA_HOME="$COGNATE_WORKBENCH_HOME"
LOG="$DATA_HOME/desktop-shell.log"

pg0_bin() {
  if [ "$MODE" = bundle ]; then
    find "$WORK/install" -type f -name pg0 | head -1
  elif [ -x .tmp/pg0/pg0 ]; then
    echo ".tmp/pg0/pg0"
  else
    find . -maxdepth 4 -type f -name pg0 -path '*share*' 2>/dev/null | head -1
  fi
}
db_name() { sed -n 's/.*"name": *"@\([^"]*\)".*/\1/p' "$DATA_HOME/database/bundled.json" 2>/dev/null | head -1; }
pg0_pid() {
  local name pg0; name="$(db_name)"; pg0="$(pg0_bin)"
  [ -n "$name" ] && [ -n "$pg0" ] || { echo ""; return 0; }
  "$pg0" info --name "$name" 2>/dev/null | awk '/PID:/ {print $2; exit}' || true
}

wait_health() {
  local port="$1" deadline=$((SECONDS + 90)) body=""
  while [ $SECONDS -lt $deadline ]; do
    body="$(curl -fsS "http://127.0.0.1:$port/health" 2>/dev/null || true)"
    case "$body" in *'"ok":true'*) echo "$body"; return 0 ;; esac
    sleep 1
  done
  echo "FAIL: /health never answered on port $port"; tail -40 "$LOG" || true; return 1
}

wait_port_in_log() {
  local deadline=$((SECONDS + 90)) port=""
  while [ $SECONDS -lt $deadline ]; do
    if [ -f "$LOG" ]; then
      port="$(sed -n 's/.*starting backend on port \([0-9]*\).*/\1/p' "$LOG" 2>/dev/null | tail -1 || true)"
      [ -n "$port" ] && { echo "$port"; return 0; }
    fi
    sleep 1
  done
  echo "FAIL: desktop-shell.log never named a backend port"; tail -40 "$LOG" 2>/dev/null || true; return 1
}

launch_shell() {
  local log_line
  if [ "$XVFB" = 1 ] && [ -z "${DISPLAY:-}" ]; then
    xvfb-run -a "$SHELL_BIN" > "$WORK/shell-$1.out" 2>&1 &
  else
    "$SHELL_BIN" > "$WORK/shell-$1.out" 2>&1 &
  fi
  SHELL_PID=$!
  echo "launched shell pid $SHELL_PID ($1)"
}

assert_no_sidecar() {
  # Any cognate-workbench* process still alive after the shell's clean stop is a leak.
  local strays
  strays="$(pgrep -af 'cognate-workbench' | grep -v "qualify-tauri" || true)"
  # In dev (debug-shell) mode the sidecar is a `bun src/cli.ts start` child of the shell —
  # gone when the shell is gone; pgrep for the checkout path would match THIS script's grep
  # otherwise. The port check below is the load-bearing assertion; the process scan is best-effort.
  case "$strays" in
    *cognate-workbench-*-unknown-linux-gnu*|*cognate-workbench-*-apple-darwin*|*cognate-workbench-*-pc-windows-msvc*)
      echo "FAIL: sidecar process survived the shell: $strays"; return 1 ;;
  esac
  return 0
}

# --- 1. Launch and readiness -------------------------------------------------
rm -f "$LOG"
launch_shell first
PORT="$(wait_port_in_log)"
HEALTH="$(wait_health "$PORT")"
echo "$HEALTH" | grep -qE '"objects": *[1-9]' || { echo "FAIL: semantic model not loaded: $HEALTH"; exit 1; }
echo "backend ready on port $PORT"
if [ "${WB_TAURI_CHECK_IDENTITY:-0}" = 1 ]; then
  echo "$HEALTH" | grep -q '"shell":"tauri@' || { echo "FAIL: /health carries no shell identity: $HEALTH"; exit 1; }
  echo "shell identity present"
fi

# --- 2. Second instance focuses, does not spawn a second backend -------------
"$SHELL_BIN" > "$WORK/shell-second.out" 2>&1 &
SECOND_PID=$!
SECOND_EXITED=0
for _ in $(seq 1 30); do
  if ! kill -0 "$SECOND_PID" 2>/dev/null; then SECOND_EXITED=1; break; fi
  sleep 1
done
[ "$SECOND_EXITED" = 1 ] || { echo "FAIL: second instance did not exit (single-instance focus expected)"; exit 1; }
curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null || { echo "FAIL: first backend unhealthy after second launch"; exit 1; }
echo "second instance exited; first backend still serving (single-instance focus)"

# --- 3. Close: SIGTERM → sidecar down, pg0 stopped, lock released ------------
kill -TERM "$SHELL_PID"
for _ in $(seq 1 45); do
  kill -0 "$SHELL_PID" 2>/dev/null || break
  sleep 1
done
kill -0 "$SHELL_PID" 2>/dev/null && { echo "FAIL: shell survived SIGTERM (45 s)"; exit 1; }
SHELL_PID=""
assert_no_sidecar
for _ in $(seq 1 35); do
  [ -z "$(pg0_pid)" ] && break
  sleep 1
done
[ -z "$(pg0_pid)" ] || { echo "FAIL: bundled pg0 still running after shell close (pid $(pg0_pid))"; exit 1; }
[ ! -e "$DATA_HOME/server.lock" ] || { echo "FAIL: server.lock not released"; exit 1; }
curl -s --max-time 2 "http://127.0.0.1:$PORT/health" >/dev/null 2>&1 \
  && { echo "FAIL: backend port still answering after close"; exit 1; }
echo "close: sidecar down, pg0 stopped, lock released"

# --- 4. Relaunch: clean respawn, lock re-created -----------------------------
rm -f "$LOG"
launch_shell second
PORT2="$(wait_port_in_log)"
wait_health "$PORT2" >/dev/null
[ -e "$DATA_HOME/server.lock" ] || { echo "FAIL: server.lock not re-created on respawn"; exit 1; }
echo "respawn healthy on port $PORT2 with lock re-created"

# --- 5. Final close ----------------------------------------------------------
kill -TERM "$SHELL_PID"
for _ in $(seq 1 45); do kill -0 "$SHELL_PID" 2>/dev/null || break; sleep 1; done
SHELL_PID=""
for _ in $(seq 1 35); do [ -z "$(pg0_pid)" ] && break; sleep 1; done
[ -z "$(pg0_pid)" ] || { echo "FAIL: pg0 survived the final close"; exit 1; }
[ ! -e "$DATA_HOME/server.lock" ] || { echo "FAIL: lock survived the final close"; exit 1; }
echo "final close clean"

# --- 6. Package-identity pass (optional) -------------------------------------
if [ -n "$COEXIST" ]; then
  [ "$MODE" = bundle ] || { echo "FAIL: --coexist requires --bundle <shell-deb>"; exit 1; }
  SHELL_PKG="$(dpkg-deb -f "$BUNDLE" Package)"
  CLI_PKG="$(dpkg-deb -f "$COEXIST" Package)"
  [ "$SHELL_PKG" != "$CLI_PKG" ] || { echo "FAIL: both debs claim package '$SHELL_PKG' — collision"; exit 1; }
  echo "packages distinct: $SHELL_PKG vs $CLI_PKG"
  overlap="$(mktemp)"
  dpkg-deb -c "$BUNDLE" | awk '{print $NF}' | sort > "$WORK/paths-shell"
  dpkg-deb -c "$COEXIST" | awk '{print $NF}' | sort > "$WORK/paths-cli"
  comm -12 "$WORK/paths-shell" "$WORK/paths-cli" > "$overlap" || true
  if [ -s "$overlap" ]; then
    echo "FAIL: the two debs ship overlapping file paths:"; head -20 "$overlap"; exit 1
  fi
  echo "no overlapping file paths between the packages"
fi

echo "PASS: qualify-tauri ($MODE)"
