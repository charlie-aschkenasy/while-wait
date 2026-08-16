#!/bin/sh
# Standby hook for Claude Code: forwards the hook's stdin JSON to the right
# Standby extension window's localhost listener. Must be fast and silent — if no
# window is listening, fail without slowing Claude Code down.
#
# Routing: each Standby window registers its ephemeral port and workspace
# folder(s) in ~/.standby/ports.tsv (one `<folder>\t<port>` line per folder).
# This hook resolves its own cwd to the physical path, finds the LONGEST folder
# that contains it, and posts to that window's port. Falls back to the port
# passed as $1 (legacy fixed-port mode); an argument of 0 means "no fallback".
#
# Usage (written into ~/.claude/settings.json by the installer):
#   standby-hook.sh [fallbackPort]

FALLBACK_PORT="${1:-48219}"
[ "$FALLBACK_PORT" = 0 ] && FALLBACK_PORT=""
REGISTRY="${HOME}/.standby/ports.tsv"
TAB=$(printf '\t')

# Buffer the tiny (<=64KB) hook JSON so we can read cwd before posting.
body=$(cat)

# Extract "cwd":"…" with POSIX sed (no jq dependency).
cwd=$(printf '%s' "$body" | sed -n 's/.*"cwd"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')

# Resolve to the physical path so a symlinked workspace matches the realpath the
# extension stored. If the dir is gone, keep the raw cwd (worst case: fallback).
if [ -n "$cwd" ] && cd "$cwd" 2>/dev/null; then
  cwd=$(pwd -P)
  cd - >/dev/null 2>&1 || true
fi

# Find the longest registered folder that contains cwd; that window's port wins.
resolved_port=""
best_len=0
if [ -n "$cwd" ] && [ -r "$REGISTRY" ]; then
  while IFS="$TAB" read -r folder p; do
    [ -n "$folder" ] || continue
    case "$cwd" in
      "$folder" | "$folder"/*)
        len=${#folder}
        if [ "$len" -gt "$best_len" ]; then
          best_len=$len
          resolved_port=$p
        fi
        ;;
    esac
  done < "$REGISTRY"
fi

port=${resolved_port:-$FALLBACK_PORT}
[ -z "$port" ] && exit 0   # nothing to post to — silent, as required

printf '%s' "$body" | curl -s --max-time 0.3 \
  -X POST "http://127.0.0.1:${port}/event" \
  -H 'Content-Type: application/json' \
  --data-binary @- \
  >/dev/null 2>&1 || true

exit 0
