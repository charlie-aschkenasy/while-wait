# Shared Standby port resolver, sourced by fake-agent.sh and stress-agent.sh.
# Mirrors hooks/standby-hook.sh routing so the harness drives the same window a
# real hook would: resolve cwd to its physical path, then find the longest
# registered workspace folder that contains it in ~/.standby/ports.tsv.
#
#   resolve_standby_port <cwd> [explicitPort]
#     - explicitPort (positional $2 or $STANDBY_PORT) wins if set
#     - else the registry longest-prefix match of the resolved cwd
#     - else 48219, with a note on stderr so the tester isn't confused

resolve_standby_port() {
  _cwd="$1"
  _explicit="$2"
  if [ -n "$_explicit" ]; then
    echo "$_explicit"
    return
  fi
  _reg="${HOME}/.standby/ports.tsv"
  _tab=$(printf '\t')
  if [ -n "$_cwd" ] && cd "$_cwd" 2>/dev/null; then
    _cwd=$(pwd -P)
    cd - >/dev/null 2>&1 || true
  fi
  _port=""
  _best=0
  if [ -n "$_cwd" ] && [ -r "$_reg" ]; then
    while IFS="$_tab" read -r _folder _p; do
      [ -n "$_folder" ] || continue
      case "$_cwd" in
        "$_folder" | "$_folder"/*)
          _len=${#_folder}
          if [ "$_len" -gt "$_best" ]; then
            _best=$_len
            _port=$_p
          fi
          ;;
      esac
    done < "$_reg"
  fi
  if [ -z "$_port" ]; then
    echo "no registry match, using fallback 48219" >&2
    _port=48219
  fi
  echo "$_port"
}
