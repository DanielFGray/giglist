#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
caddy_bin=${CADDY_BIN:-caddy}
api_port=${PRODUCTION_CHECK_API_PORT:-3399}
web_port=${PRODUCTION_CHECK_WEB_PORT:-3499}
scratch=$(mktemp -d /tmp/giglist-production.XXXXXX)
api_pid=
caddy_pid=

cleanup() {
  local status=$?
  for pid in "$caddy_pid" "$api_pid"; do
    if [[ -n "$pid" ]]; then
      kill "$pid" 2>/dev/null || true
      wait "$pid" 2>/dev/null || true
    fi
  done
  if [[ "$status" == 0 ]]; then
    rm -rf "$scratch"
  else
    echo "Production check logs: $scratch" >&2
  fi
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

command -v "$caddy_bin" >/dev/null
bun run build >"$scratch/build.log" 2>&1

# Test Caddy must never save a configuration or use the host's TLS storage.
{
  printf '{\n\tadmin off\n\tauto_https off\n\tpersist_config off\n\tdefault_bind 127.0.0.1\n}\n'
  cat deploy/Caddyfile
} >"$scratch/Caddyfile"

NODE_ENV=production API_HOST=127.0.0.1 PORT="$api_port" \
  bun src/server/main.ts >"$scratch/api.log" 2>&1 &
api_pid=$!
GIGLIST_SITE="http://127.0.0.1:$web_port" GIGLIST_DIST="$PWD/dist" \
  GIGLIST_API_UPSTREAM="127.0.0.1:$api_port" \
  XDG_CONFIG_HOME="$scratch/config" XDG_DATA_HOME="$scratch/data" \
  "$caddy_bin" run --config "$scratch/Caddyfile" --adapter caddyfile >"$scratch/caddy.log" 2>&1 &
caddy_pid=$!

for attempt in {1..20}; do
  kill -0 "$api_pid" "$caddy_pid"
  if curl --silent --fail --max-time 6 "http://127.0.0.1:$web_port/api/health" >/dev/null; then
    break
  fi
  sleep 0.2
done
kill -0 "$api_pid" "$caddy_pid"
bash scripts/checkProduction.sh "http://127.0.0.1:$web_port"
