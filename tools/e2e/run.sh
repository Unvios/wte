#!/usr/bin/env bash
# Удобная обёртка: node не всегда в PATH текущего шелла (стоит в D:\programs\nodejs).
# Usage: tools/e2e/run.sh <scenario.mjs> [--keep] [--port N]
set -e
NODE="$(command -v node || echo /d/programs/nodejs/node.exe)"
exec "$NODE" "$(dirname "$0")/run.mjs" "$@"
