#!/bin/sh
set -eu

if [ "$#" -eq 0 ]; then
  printf '%s\n' "usage: run_image_python.sh SCRIPT [ARGS...]" >&2
  exit 2
fi

try_python() {
  candidate="$1"
  shift
  [ -n "$candidate" ] || return 1
  if [ "$candidate" = "python3" ]; then
    command -v python3 >/dev/null 2>&1 || return 1
  fi
  "$candidate" -c 'import numpy, PIL' >/dev/null 2>&1 || return 1
  exec "$candidate" "$@"
}

try_python "${PYTHON:-}" "$@" || true
try_python "${CODEX_PYTHON:-}" "$@" || true
try_python "python3" "$@" || true
try_python "${HOME:-}/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3" "$@" || true

printf '%s\n' "No Python runtime with numpy and Pillow was found." >&2
printf '%s\n' "Set PYTHON=/path/to/python3 or install requirements-image.txt." >&2
exit 1
