#!/usr/bin/env bash
set -euo pipefail

export CHATGPT_LOCAL_HOME="${CHATGPT_LOCAL_HOME:-/data}"

cmd="${1:-serve}"
shift || true

bool() {
  case "${1:-}" in
    1|true|TRUE|yes|YES|on|ON) return 0;;
    *) return 1;;
  esac
}

if [[ "$cmd" == "serve" ]]; then
  PORT="${PORT:-8000}"
  ARGS=(serve --host 0.0.0.0 --port "${PORT}")

  if [[ "$#" -gt 0 ]]; then
    ARGS+=("$@")
  fi

  exec python -m chatmock.cli "${ARGS[@]}"
elif [[ "$cmd" == "login" ]]; then
  ARGS=(login --no-browser)
  if [[ "$#" -gt 0 ]]; then
    ARGS+=("$@")
  fi

  exec python -m chatmock.cli "${ARGS[@]}"
else
  exec "$cmd" "$@"
fi
