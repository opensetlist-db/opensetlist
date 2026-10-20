#!/usr/bin/env bash
# Show that the fan board aggregate is served from Next's data cache on
# a deployed Preview: two reads of the same (event, locale) inside the
# board TTL (CACHE_TTL.board) must carry the SAME `asOf` — `asOf` is
# stamped when the aggregate is computed, so equal values mean one
# computation served both requests. Unit tests can't show this (they
# stub `unstable_cache`).
#
#   scripts/board-cache-proof.sh <preview-base-url> <event-id> [locale]
#
# The event must have the board turned on (admin → event → 팬 보드) and
# be upcoming or completed; an ongoing/cancelled event answers with a
# locked stub that never reaches the aggregate. A protected Preview
# needs VERCEL_AUTOMATION_BYPASS_SECRET in the environment. Paste the
# output into the PR as the evidence.
set -euo pipefail

base="${1:?usage: board-cache-proof.sh <preview-base-url> <event-id> [locale]}"
event="${2:?usage: board-cache-proof.sh <preview-base-url> <event-id> [locale]}"
locale="${3:-ja}"
url="${base%/}/api/events/${event}/board?locale=${locale}"

bypass=()
if [ -n "${VERCEL_AUTOMATION_BYPASS_SECRET:-}" ]; then
  bypass=(-H "x-vercel-protection-bypass: ${VERCEL_AUTOMATION_BYPASS_SECRET}")
fi

headers="$(mktemp)"
trap 'rm -f "$headers"' EXIT

# Prints "<asOf> <cache-control…>" (asOf has no spaces; cache-control may).
read_board() {
  local body status cc asof
  body="$(curl -sS -D "$headers" -w '\n%{http_code}' "${bypass[@]}" "$url")" || return 4
  status="${body##*$'\n'}"
  body="${body%$'\n'*}"
  case "$status" in
    200) ;;
    401|403) echo "HTTP $status — the Preview is protected; set VERCEL_AUTOMATION_BYPASS_SECRET" >&2; return 4 ;;
    *) echo "HTTP $status from $url" >&2; return 4 ;;
  esac
  cc="$(grep -i '^cache-control:' "$headers" | tr -d '\r' | cut -d' ' -f2-)"
  asof="$(node -e '
    let b;
    try { b = JSON.parse(process.argv[1]); } catch { console.error("not JSON — is this the app?"); process.exit(3); }
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
echo "1st: asOf=${first%% *}  cache-control=${first#* }"
echo "2nd: asOf=${second%% *}  cache-control=${second#* }"

if [ "${first%% *}" = "${second%% *}" ]; then
  echo "PASS — same asOf: one computation served both requests (HTTP stays no-store; the reuse is server-side)"
else
  # The first request can land just as the previous entry expires; a
  # single mismatch is worth one rerun before calling it.
  echo "FAIL — asOf differs: the aggregate was recomputed (rerun once; if it persists, the cache is not being hit)"
  exit 1
fi
