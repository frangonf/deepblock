#!/usr/bin/env bash
set -euo pipefail

args=()
skip_next=0

for arg in "$@"; do
  if [[ "$skip_next" -eq 1 ]]; then
    skip_next=0
    continue
  fi

  case "$arg" in
    --host=*)
      ;;
    --host)
      skip_next=1
      ;;
    *)
      args+=("$arg")
      ;;
  esac
done

exec /usr/bin/safaridriver "${args[@]}"
