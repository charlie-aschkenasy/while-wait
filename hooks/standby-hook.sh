#!/bin/sh
# Standby hook for Claude Code: forwards the hook's stdin JSON to the
# Standby extension's localhost listener. Must be fast and silent — if the
# extension isn't running, fail without slowing Claude Code down.
#
# Usage (written into ~/.claude/settings.json by the installer):
#   standby-hook.sh [port]

PORT="${1:-48219}"

curl -s --max-time 0.3 \
  -X POST "http://127.0.0.1:${PORT}/event" \
  -H 'Content-Type: application/json' \
  --data-binary @- \
  >/dev/null 2>&1 || true

exit 0
