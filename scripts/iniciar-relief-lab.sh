#!/bin/zsh

set -u

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

SCRIPT_DIR="${0:A:h}"
PROJECT_DIR="${SCRIPT_DIR:h}"
PID_FILE="$PROJECT_DIR/.relief-lab-dev.pid"
LOG_FILE="$PROJECT_DIR/.relief-lab-dev.log"
URL="http://localhost:3001"

if [[ -f "$PID_FILE" ]]; then
  RUNNING_PID="$(<"$PID_FILE")"
  if [[ "$RUNNING_PID" == <-> ]] && kill -0 "$RUNNING_PID" 2>/dev/null; then
    print -r -- "Relief Lab já está ligado na porta 3001."
    exit 0
  fi
  rm -f "$PID_FILE"
fi

cd "$PROJECT_DIR" || exit 1
nohup npm run dev >>"$LOG_FILE" 2>&1 </dev/null &
SERVER_PID=$!
print -r -- "$SERVER_PID" >"$PID_FILE"

for _ in {1..60}; do
  if /usr/bin/curl -fsS "$URL" >/dev/null 2>&1; then
    print -r -- "Relief Lab iniciado na porta 3001."
    exit 0
  fi
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    rm -f "$PID_FILE"
    print -u2 -r -- "O Relief Lab não conseguiu iniciar. Consulte .relief-lab-dev.log."
    exit 1
  fi
  sleep 0.2
done

print -r -- "Relief Lab iniciado e ainda está preparando a primeira tela."
