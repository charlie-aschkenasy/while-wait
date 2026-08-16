#!/bin/sh
# Simulates a Claude Code session against the Standby listener.
# Usage: scripts/fake-agent.sh [cwd] [port]
#   cwd defaults to $PWD (must be inside the extension host's workspace).
#   port: explicit $2 or $STANDBY_PORT wins; otherwise resolved from
#   ~/.standby/ports.tsv by cwd (so it drives that window in multi-window mode);
#   else falls back to 48219.

. "$(dirname "$0")/resolve-port.sh"

CWD="${1:-$PWD}"
PORT=$(resolve_standby_port "$CWD" "${2:-$STANDBY_PORT}")

send() {
  event="$1"
  message="$2"
  if [ -n "$message" ]; then
    data="{\"hook_event_name\":\"$event\",\"cwd\":\"$CWD\",\"message\":\"$message\"}"
  else
    data="{\"hook_event_name\":\"$event\",\"cwd\":\"$CWD\"}"
  fi
  echo "→ $event${message:+ ($message)}"
  curl -s --max-time 1 -X POST "http://127.0.0.1:$PORT/event" \
    -H 'Content-Type: application/json' \
    --data "$data" >/dev/null || echo "   send failed — is the extension running on port $PORT?"
}

echo "fake agent session (cwd=$CWD, port=$PORT)"

send UserPromptSubmit
sleep 2

send PostToolUse
sleep 2

send Notification "Claude needs your permission to use Bash"
sleep 3

send PostToolUse      # approval granted → back to working
sleep 2

send Stop             # → done after the ~300ms settle window
sleep 2

echo "--- rapid Stop → UserPromptSubmit (must not flash) ---"
send UserPromptSubmit
sleep 1
send Stop
send UserPromptSubmit # arrives inside the settle window → stays working
sleep 2

send Stop
sleep 1
send SessionEnd

echo "done"
