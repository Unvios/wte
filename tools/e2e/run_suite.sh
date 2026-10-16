#!/usr/bin/env bash
# Runs a group of e2e scenarios sequentially and summarizes PASS/FAIL.
# Usage: tools/e2e/run_suite.sh [pattern] [extra run.sh flags...]
#   tools/e2e/run_suite.sh            # all hotbar-* scenarios, sandbox+headless
#   tools/e2e/run_suite.sh loot       # all loot-* scenarios
#   tools/e2e/run_suite.sh hotbar --keep
set -u
cd "$(dirname "$0")/../.."

PATTERN="${1:-hotbar}"
shift || true
FLAGS=("$@")
[ ${#FLAGS[@]} -eq 0 ] && FLAGS=(--sandbox --headless)

mapfile -t SCENARIOS < <(ls tools/e2e/scenarios/${PATTERN}*.mjs 2>/dev/null)
if [ ${#SCENARIOS[@]} -eq 0 ]; then
  echo "no scenarios match: tools/e2e/scenarios/${PATTERN}*.mjs"
  exit 2
fi

PASS=()
FAIL=()
for s in "${SCENARIOS[@]}"; do
  name=$(basename "$s" .mjs)
  echo "=== $name ==="
  if tools/e2e/run.sh "$s" "${FLAGS[@]}" > /tmp/e2e-suite-$$.log 2>&1; then
    PASS+=("$name")
    grep -E "^\[e2e\] PASS" /tmp/e2e-suite-$$.log
  else
    FAIL+=("$name")
    echo "--- tail of $name log ---"
    tail -25 /tmp/e2e-suite-$$.log
  fi
done
rm -f /tmp/e2e-suite-$$.log

echo
echo "=== suite '$PATTERN': ${#PASS[@]} passed, ${#FAIL[@]} failed ==="
for n in "${PASS[@]}"; do echo "  PASS $n"; done
for n in "${FAIL[@]}"; do echo "  FAIL $n"; done
[ ${#FAIL[@]} -eq 0 ]
