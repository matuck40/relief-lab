#!/bin/zsh

set -u

SCRIPT_DIR="${0:A:h}"
PROJECT_DIR="${SCRIPT_DIR:h}"
PID_FILE="$PROJECT_DIR/.relief-lab-dev.pid"

if [[ ! -f "$PID_FILE" ]]; then
  print -r -- "Relief Lab já está desligado."
  exit 0
fi

SERVER_PID="$(<"$PID_FILE")"
if [[ "$SERVER_PID" != <-> ]] || ! kill -0 "$SERVER_PID" 2>/dev/null; then
  rm -f "$PID_FILE"
  print -r -- "Relief Lab já está desligado."
  exit 0
fi

SERVER_COMMAND="$(/bin/ps -p "$SERVER_PID" -o command= 2>/dev/null)"
if [[ "$SERVER_COMMAND" != *"npm run dev"* ]]; then
  rm -f "$PID_FILE"
  print -u2 -r -- "O processo registrado não pertence ao Relief Lab e não foi encerrado."
  exit 1
fi

function stop_tree() {
  local parent_pid="$1"
  local child_pid
  for child_pid in $(/usr/bin/pgrep -P "$parent_pid" 2>/dev/null); do
    stop_tree "$child_pid"
  done
  kill -TERM "$parent_pid" 2>/dev/null || true
}

stop_tree "$SERVER_PID"
for _ in {1..30}; do
  kill -0 "$SERVER_PID" 2>/dev/null || break
  sleep 0.1
done
kill -KILL "$SERVER_PID" 2>/dev/null || true
rm -f "$PID_FILE"
print -r -- "Relief Lab desligado."
