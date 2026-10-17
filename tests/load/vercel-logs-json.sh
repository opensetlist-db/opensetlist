#!/usr/bin/env bash
# Export one deployment's request logs for a time window as JSON Lines,
# completely, for the n14 step-6 joins (transition-join.mjs,
# attribution-smoke.mjs).
#
#   tests/load/vercel-logs-json.sh <deployment-url-or-id> <since ISO> <until ISO> <out.jsonl> [limit=1000]
#
# Env: SLICE_S (default 60) — the bounded window per CLI call;
#      VERCEL_SCOPE (default opensetlist-projects);
#      VERCEL_PROJECT (default opensetlist; needed when the cwd is not a
#        linked checkout — a git worktree has no `.vercel/`);
#      MIN_SLICE_MS (default 1000) — a slice is not split below this.
#
# Why it is not one `vercel logs … --json` call:
#   - the CLI returns at most `--limit` records (default 100!) and, when a
#     window holds more, keeps the NEWEST ones — the oldest part of the
#     window silently disappears. A run at 50 req/s fills 100 records in
#     2 s. So the window is cut into SLICE_S slices, each fetched with a
#     high limit, and any slice that comes back with ≥ limit records is
#     split in half and re-fetched (recursively, down to MIN_SLICE_MS; a
#     slice that still saturates there is reported as SATURATED — the
#     export is then known-incomplete, never silently short);
#   - `--since` and `--until` are both inclusive at ms precision (verified
#     2026-10-12 on CLI 63.1.2), so adjacent slices share their boundary
#     millisecond: records are deduplicated by `id` (= the request id, the
#     `<reqid>` suffix of the response's `X-Vercel-Id`). When two copies of
#     one id differ, the one with more nested `logs[]` lines is kept: a
#     request's background work (`after()` — the writer's warm job) lands
#     in its record LATER than the response, so an early fetch can hold a
#     shorter copy of the same record;
#   - for the same reason the export is idempotent and MERGES into an
#     existing <out.jsonl>: run it once right after the measurement and
#     again a few minutes later (the "second pass") and the background-job
#     lines that arrived in between are merged in by id. Coverage is
#     printed for each pass.
#   - the CLI prints its banner / progress ("Resolving deployment …",
#     "Fetching logs...") on STDERR and only the JSON Lines on STDOUT
#     (verified). STDERR goes to a temp file whose tail is printed when a
#     call fails (kept out of the results folder: it is noise otherwise).
#   - retention: runtime request logs are kept only for a limited,
#     plan-dependent time — export right after the run (and the second
#     pass a few minutes later), and always BEFORE deleting a deployment:
#     a deleted deployment's logs cannot be retrieved.
#
# Output: <out.jsonl> sorted by timestamp, one record per request id;
# a coverage line on stdout:
#   slices=<fetched> splits=<n> saturated=<n> failed=<slices the CLI never answered> records=<unique> raw=<fetched
#   records> dupes=<removed> maxPerSlice=<n> hitLimit=<slices that came
#   back with ≥ limit records> new=<records added to an existing file>
#   enriched=<existing records replaced by a copy with more logs[]>
set -euo pipefail

if [ $# -lt 4 ]; then
  echo "usage: $0 <deployment-url-or-id> <since ISO> <until ISO> <out.jsonl> [limit=1000]" >&2
  exit 2
fi
DEP="$1"; SINCE="$2"; UNTIL="$3"; OUT="$4"; LIMIT="${5:-1000}"
SLICE_S="${SLICE_S:-60}"
SCOPE="${VERCEL_SCOPE:-opensetlist-projects}"
PROJECT="${VERCEL_PROJECT:-opensetlist}"
MIN_SLICE_MS="${MIN_SLICE_MS:-1000}"
HERE="$(cd "$(dirname "$0")" && pwd)"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
RAW="$TMP/raw.jsonl"
: > "$RAW"
ERRLOG="$TMP/stderr.log"
: > "$ERRLOG"

toms() { node -e 'const t=Date.parse(process.argv[1]); if(!Number.isFinite(t)){process.exit(1)} console.log(t)' "$1"; }
toiso() { node -e 'console.log(new Date(Number(process.argv[1])).toISOString())' "$1"; }

A="$(toms "$SINCE")" || { echo "bad since: $SINCE" >&2; exit 2; }
B="$(toms "$UNTIL")" || { echo "bad until: $UNTIL" >&2; exit 2; }
if [ "$B" -le "$A" ]; then echo "until must be after since" >&2; exit 2; fi

# Work queue of "from to" ms pairs (a plain file: bash arrays + recursion
# would do, but a file keeps the order visible when debugging).
Q="$TMP/queue"
STEP=$((SLICE_S * 1000))
t="$A"
: > "$Q"
while [ "$t" -lt "$B" ]; do
  e=$((t + STEP)); [ "$e" -gt "$B" ] && e="$B"
  echo "$t $e" >> "$Q"
  t="$e"
done

slices=0; splits=0; saturated=0; failed=0; maxper=0; hitlimit=0
while [ -s "$Q" ]; do
  read -r f u < "$Q"
  sed -i '1d' "$Q"
  slices=$((slices + 1))
  part="$TMP/part.jsonl"
  ok=0
  for attempt in 1 2 3; do
    if npx vercel logs "$DEP" --json --since "$(toiso "$f")" --until "$(toiso "$u")" \
        --limit "$LIMIT" --project "$PROJECT" --scope "$SCOPE" > "$part" 2>> "$ERRLOG"; then
      ok=1; break
    fi
    echo "  slice $(toiso "$f") → $(toiso "$u"): CLI failed (attempt $attempt); CLI stderr:" >&2
    tail -n 5 "$ERRLOG" >&2
    sleep $((attempt * 3))
  done
  if [ "$ok" -ne 1 ]; then
    echo "FAILED slice $(toiso "$f") → $(toiso "$u") after 3 attempts — export INCOMPLETE" >&2
    failed=$((failed + 1))
    continue
  fi
  n="$(grep -c '^{' "$part" || true)"
  [ "$n" -gt "$maxper" ] && maxper="$n"
  if [ "$n" -ge "$LIMIT" ]; then
    hitlimit=$((hitlimit + 1))
    if [ $((u - f)) -gt "$MIN_SLICE_MS" ]; then
      m=$(((f + u) / 2))
      # Re-fetch both halves; this slice's partial (newest-only) records
      # are kept too — dedupe makes that free and loses nothing.
      echo "$f $m" >> "$Q"; echo "$m $u" >> "$Q"
      splits=$((splits + 1))
    else
      echo "SATURATED slice $(toiso "$f") → $(toiso "$u"): $n ≥ limit $LIMIT at the minimum slice width — export INCOMPLETE" >&2
      saturated=$((saturated + 1))
    fi
  fi
  grep '^{' "$part" >> "$RAW" || true
done

node "$HERE/transition-join.mjs" merge-logs "$OUT" "$RAW" \
  --coverage="slices=$slices splits=$splits saturated=$saturated failed=$failed maxPerSlice=$maxper hitLimit=$hitlimit limit=$LIMIT sliceS=$SLICE_S"
if [ "$saturated" -gt 0 ] || [ "$failed" -gt 0 ]; then exit 3; fi
