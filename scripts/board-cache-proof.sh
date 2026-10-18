#!/usr/bin/env bash
# Show that the fan board aggregate is served from Next's data cache on
# a deployed Preview: two reads of the same (event, locale) inside the
# board TTL must carry the SAME `asOf` — `asOf` is stamped when the
# aggregate is computed, so equal values mean one computation served
# both requests. Unit tests can't show this (they stub `unstable_cache`).
#
#   scripts/board-cache-proof.sh <preview-base-url> <event-id> [locale]
#
# The event must have the board turned on (admin → event → 팬 보드) and
# be upcoming or completed; an ongoing/cancelled event answers with a
# locked stub that never reaches the aggregate. Paste the output into
# the PR as the evidence.
set -euo pipefail

base="${1:?usage: board-cache-proof.sh <preview-base-url> <event-id> [locale]}"
event="${2:?usage: board-cache-proof.sh <preview-base-url> <event-id> [locale]}"
locale="${3:-ja}"
url="${base%/}/api/events/${event}/board?locale=${locale}"

read_board() {
  # Prints "<asOf> <cache-control>"; the body must be the aggregate shape.
  local headers body asof cc
  headers="$(mktemp)"
  body="$(curl -sS -D "$headers" "$url")"
  cc="$(grep -i '^cache-control:' "$headers" | tr -d '\r' | cut -d' ' -f2-)"
  rm -f "$headers"
  asof="$(node -e '
    const b = JSON.parse(process.argv[1]);
    if (!b.enabled) { console.error("board is disabled for this event — turn it on in admin first"); process.exit(3); }
    if (!b.asOf) { console.error(`no aggregate: status=${b.status} (ongoing/cancelled events never reach it)`); process.exit(3); }
    process.stdout.write(b.asOf);
  ' "$body")" || return 3
  printf '%s %s\n' "$asof" "$cc"
}

echo "GET $url"
first="$(read_board)" || exit $?
sleep 2
second="$(read_board)" || exit $?
echo "1st: asOf=${first% *}  cache-control=${first#* }"
echo "2nd: asOf=${second% *}  cache-control=${second#* }"

if [ "${first% *}" = "${second% *}" ]; then
  echo "PASS — same asOf: one computation served both requests (HTTP stays no-store; the reuse is server-side)"
else
  # A first request can land just as the previous entry expires (TTL
  # 120 s); a single mismatch is worth one rerun before calling it.
  echo "FAIL — asOf differs: the aggregate was recomputed (rerun once; if it persists, the cache is not being hit)"
  exit 1
fi
