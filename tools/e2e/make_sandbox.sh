#!/usr/bin/env bash
# Builds tools/e2e/sandbox/: junctions to the live game directories (content
# stays in sync with game updates automatically) + a real save/ holding the
# test fixtures. Tests run here, so the real save/ is never touched and the
# user can play while tests run. Re-run after a game update that adds or
# removes top-level entries.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SB="$ROOT/tools/e2e/sandbox"
FX="$ROOT/tools/e2e/fixtures"

rm -rf "$SB"
mkdir -p "$SB/save"

mkjunction() {
  powershell.exe -NoProfile -Command \
    "New-Item -ItemType Junction -Path '$(cygpath -w "$1")' -Target '$(cygpath -w "$2")' | Out-Null"
}

cd "$ROOT"
for entry in *; do
  case "$entry" in
    save|.git|dist|docs|tools) continue;;
  esac
  if [ -d "$entry" ]; then
    mkjunction "$SB/$entry" "$ROOT/$entry"
  else
    cp "$entry" "$SB/$entry"
  fi
done

cp "$FX"/*.rmmzsave "$SB/save/" 2>/dev/null || true
echo "sandbox ready: $SB"
ls "$SB/save"
