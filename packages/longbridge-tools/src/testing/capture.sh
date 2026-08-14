#!/usr/bin/env bash
# One-shot fixture capture helper. Not part of the test suite; run manually to refresh fixtures.
# Usage: run <fixture-name> <subcommand> [args...]
set -u

SYM="${SYMBOL:-NVDA.US}"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/fixtures"
mkdir -p "$DIR"

run() {
  local name="$1"; shift
  local subcmd="$1"; shift
  local out="$DIR/$name.json"
  local err="$DIR/$name.error.txt"
  local cmd="$DIR/$name.cmd.txt"
  rm -f "$out" "$err" "$cmd"

  # Record exact invocation
  printf 'longbridge %s%s --format json\n' "$subcmd" "$([ $# -gt 0 ] && printf ' %s' "$@")" > "$cmd"

  local stdout stderr rc
  stdout="$(longbridge "$subcmd" "$@" --format json 2>/tmp/lb_stderr.$$)"
  rc=$?
  stderr="$(cat /tmp/lb_stderr.$$ 2>/dev/null)"
  rm -f /tmp/lb_stderr.$$

  if [ "$rc" -eq 0 ] && [ -n "$stdout" ] && printf '%s' "$stdout" | jq -e . >/dev/null 2>&1; then
    printf '%s' "$stdout" | jq . > "$out"
    echo "OK   $name"
  else
    { echo "exit_code=$rc"; [ -n "$stderr" ] && echo "--- stderr ---" && echo "$stderr"; [ -n "$stdout" ] && echo "--- stdout ---" && echo "$stdout"; } > "$err"
    echo "ERR  $name (rc=$rc)"
  fi
}

run depth depth "$SYM"
run trades trades "$SYM" --count 20
run capital capital "$SYM"
run capital-flow capital "$SYM" --flow
run market-temp market-temp US
run financial-report financial-report "$SYM"
run institution-rating institution-rating "$SYM"
run dividend dividend "$SYM"
run forecast-eps forecast-eps "$SYM"
run finance-calendar finance-calendar financial
run trading trading session
run positions positions
run portfolio portfolio
run assets assets
run cash-flow cash-flow
run valuation valuation "$SYM"
run static static "$SYM"
run calc-index calc-index "$SYM"
run market-status market-status
run news news "$SYM" --count 20
