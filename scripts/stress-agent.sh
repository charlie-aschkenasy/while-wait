#!/bin/sh
# Flicker/robustness audit for the Standby lifecycle: rapid, duplicated, and
# out-of-order event sequences. Watch the panel and status bar for flashes.
# Usage: scripts/stress-agent.sh [cwd] [port]

CWD="${1:-$PWD}"
PORT="${2:-${STANDBY_PORT:-48219}}"

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

echo "stress sequences (cwd=$CWD, port=$PORT)"

echo "--- 1. stop/start churn inside 1s: panel must stay up, no flicker ---"
send UserPromptSubmit
sleep 1
for i in 1 2 3; do
  send Stop
  sleep 0.1
  send UserPromptSubmit
  sleep 0.3
done
sleep 1

echo "--- 2. double notification: needs-you must not glitch ---"
send Notification "Claude needs your permission to use Bash"
sleep 0.1
send Notification "Claude needs your permission to use Bash"
sleep 2

echo "--- 3. out-of-order: PostToolUse after Stop settles → back to working ---"
send Stop
sleep 1
send PostToolUse
sleep 2

echo "--- 4. malformed + wrong-cwd payloads: all must be ignored ---"
curl -s --max-time 1 -X POST "http://127.0.0.1:$PORT/event" \
  -H 'Content-Type: application/json' --data 'not json' >/dev/null
curl -s --max-time 1 -X POST "http://127.0.0.1:$PORT/event" \
  -H 'Content-Type: application/json' \
  --data '{"hook_event_name":"Stop"}' >/dev/null
curl -s --max-time 1 -X POST "http://127.0.0.1:$PORT/event" \
  -H 'Content-Type: application/json' \
  --data '{"hook_event_name":"UserPromptSubmit","cwd":"/somewhere/else"}' >/dev/null
echo "→ sent 3 junk payloads (no state change expected)"
sleep 2

echo "--- 5. rapid done→working→done: exactly one hide at the end ---"
send Stop
sleep 0.6
send UserPromptSubmit
sleep 0.5
send Stop
sleep 1
send SessionEnd

echo "done — panel should be hidden, state ✓ done"
