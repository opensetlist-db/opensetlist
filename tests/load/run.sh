#!/usr/bin/env bash
# Thin wrapper around `k6 run` for the n12 harness.
#
#   tests/load/run.sh <script.js> [extra k6 args...]
#   e.g. tests/load/run.sh setlist-snapshot.js -e EXPECTED_ROWS=50
#
# Why it exists: handleSummary writes into tests/load/results/<UTC date>/
# and k6 does not create missing directories — without the mkdir the
# run finishes and the report silently goes nowhere except stdout.
# Also cds to the repo root, because the summary paths are relative to
# the working directory.
#
# Reads the common target settings from the environment so they don't
# have to be repeated on every command line:
#   BASE_URL EVENT_ID EVENT_SLUG EXPECTED_ROWS VERCEL_BYPASS ADMIN_PASSWORD
# Set K6=/path/to/k6 if k6 is not on PATH.
set -euo pipefail

cd "$(dirname "$0")/../.."
script="$1"; shift
mkdir -p "tests/load/results/$(date -u +%F)"

args=()
for v in BASE_URL EVENT_ID EVENT_SLUG EXPECTED_ROWS ROW_SLACK VERCEL_BYPASS ADMIN_PASSWORD HOLD_RPS HOLD_SECONDS; do
  if [ -n "${!v:-}" ]; then args+=(-e "$v=${!v}"); fi
done

exec "${K6:-k6}" run "${args[@]}" "$@" "tests/load/${script#tests/load/}"
