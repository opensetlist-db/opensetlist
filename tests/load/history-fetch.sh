#!/usr/bin/env bash
# Export a deployment's runtime logs for a time window as TEXT (history
# mode, `--expand`), completely and checkably, for the n14 step-7 join
# (spam7-join.mjs) and the text summariser (vercel-logs-summary.mjs).
#
#   tests/load/history-fetch.sh <alias-or-deployment> <since ISO> <until ISO> <out.txt> [slices=20] [limit=5000] [--second-pass]
#
# Env: VERCEL_SCOPE   (default opensetlist-projects)
#      VERCEL_PROJECT (default opensetlist — a git worktree has no `.vercel/`)
#      MIN_SLICE_MS   (default 5000) — a saturated slice is not split below this
#      PAR            (default = slices) — CLI calls in flight at once
#
# Origin: the parallel fetcher used ad hoc in steps 4–6 (20 parallel
# `vercel logs --since --until --limit 5000 --expand` slices, concatenated).
# What this version adds, and why (Codex step-7 round 2 §4):
#   - DISJOINT slices. `--since` / `--until` are both inclusive at ms
#     precision (README, "vercel-logs-json.sh — export caveats"), so
#     slice [a, b) is fetched as `--since a --until b−1ms`. Text records
#     have no request id, so overlapping slices could not be deduplicated
#     reliably afterwards (two requests with the same header line within
#     10 ms are routine at 50 req/s); disjoint bounds make dedupe
#     unnecessary instead.
#   - Saturation judged by parsed REQUEST RECORDS, not lines. The CLI's
#     `--limit` counts records and, when a window holds more, silently
#     keeps the NEWEST ones. One record = a header line + any number of
#     nested function lines, so a line count says nothing about the limit.
#     history-merge.mjs `count` uses the summariser's own header parser.
#     A slice with records ≥ limit is split in half and both halves are
#     re-fetched (recursively, down to MIN_SLICE_MS); a slice still at the
#     limit there is kept but marked `status=saturated`.
#   - In TEXT mode the CLI writes everything — banner, the records and its
#     closing `Fetched <N> logs for …` line — to STDERR, and nothing to
#     STDOUT (verified 2026-10-12, CLI 63.1.2; the JSON mode is the other
#     way round). So both streams go to the slice file (the summariser's
#     META filter skips the banner), and the CLI's own `Fetched N` is kept
#     next to the parsed count (`cli=` on the slice marker): saturation is
#     judged on the larger of the two, a disagreement is visible.
#   - Failed CLI calls are retried once (after 3 s); a slice that fails
#     twice is marked `status=failed`. The export is never silently short:
#     saturated / failed slices are listed and the script exits 3.
#   - A SECOND PASS (`--second-pass`, same arguments, a few minutes later)
#     re-fetches the same slices and merges each slice's records by
#     content (history-merge.mjs header: identical / enriched / new /
#     pass1Only): background `after()` lines — the writer's warm job and
#     its builds and pool lines — land in a record after the response, so
#     a fetch made right after the run can miss them (README l.1246).
#   - A self-describing output: a `### capture history-fetch …` header
#     (target, window, limit, the CLI machine's UTC offset `tz=` — history
#     times are LOCAL clock times without a date, the join derives
#     `--add-hours` from it), one `### capture slice …` marker per slice
#     (bounds, records, status, both passes) and a `### capture coverage …`
#     footer, also printed on stdout:
#       slices= records= saturated= resplit= failed= passes= pass2Failed=
#       identical= enriched= new= pass1Only= maxPerSlice= limit= span=
#     Every marker begins with `### capture`, which the summariser skips.
#   - Retention: runtime logs are kept for a limited, plan-dependent time
#     and a deleted deployment's logs are gone — fetch (both passes) before
#     any cleanup that deletes a deployment.
# Read-only: it only calls `vercel logs`.
set -uo pipefail

SECOND=0
ARGS=()
for a in "$@"; do
  if [ "$a" = "--second-pass" ]; then SECOND=1; else ARGS+=("$a"); fi
done
if [ "${#ARGS[@]}" -lt 4 ]; then
  echo "usage: $0 <alias-or-deployment> <since ISO> <until ISO> <out.txt> [slices=20] [limit=5000] [--second-pass]" >&2
  exit 2
fi
TARGET="${ARGS[0]}"; SINCE="${ARGS[1]}"; UNTIL="${ARGS[2]}"; OUT="${ARGS[3]}"
SLICES="${ARGS[4]:-20}"; LIMIT="${ARGS[5]:-5000}"
SCOPE="${VERCEL_SCOPE:-opensetlist-projects}"
PROJECT="${VERCEL_PROJECT:-opensetlist}"
MIN_SLICE_MS="${MIN_SLICE_MS:-5000}"
PAR="${PAR:-$SLICES}"
HERE="$(cd "$(dirname "$0")" && pwd)"
MERGE="$HERE/history-merge.mjs"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
# The manifest is read by node: on Git Bash / MSYS a POSIX path inside a
# FILE is not translated the way a command-line argument is, so the
# manifest carries the native spelling.
TMPN="$TMP"
command -v cygpath > /dev/null 2>&1 && TMPN="$(cygpath -m "$TMP")"

toms() { node -e 'const t=Date.parse(process.argv[1]); if(!Number.isFinite(t)){process.exit(1)} console.log(t)' "$1"; }
toiso() { node -e 'console.log(new Date(Number(process.argv[1])).toISOString())' "$1"; }

A="$(toms "$SINCE")" || { echo "bad since: $SINCE" >&2; exit 2; }
B="$(toms "$UNTIL")" || { echo "bad until: $UNTIL" >&2; exit 2; }
if [ "$B" -le "$A" ]; then echo "until must be after since" >&2; exit 2; fi
SINCE_ISO="$(toiso "$A")"; UNTIL_ISO="$(toiso "$B")"

Q="$TMP/queue"; : > "$Q"
if [ "$SECOND" -eq 1 ]; then
  [ -s "$OUT" ] || { echo "--second-pass: $OUT does not exist (run the first pass first)" >&2; exit 2; }
  # The same slices as the first pass (its splits included), so every
  # pass-2 leaf falls inside exactly one existing slice.
  node "$MERGE" slices "$OUT" > "$Q"
  [ -s "$Q" ] || { echo "--second-pass: $OUT has no slice markers (not written by this script)" >&2; exit 2; }
else
  # SLICES equal disjoint slices [a, b); the last one ends exactly at B.
  span=$((B - A))
  for ((i = 0; i < SLICES; i++)); do
    f=$((A + span * i / SLICES)); u=$((A + span * (i + 1) / SLICES))
    [ "$u" -gt "$f" ] && echo "$f $u" >> "$Q"
  done
fi

# One slice: up to 2 attempts; writes <base>.txt (CLI stdout) and
# <base>.res ("ok <records>" or "failed 0").
fetch_one() {
  local f="$1" u="$2" base="$TMP/s_$1_$2"
  local since until
  since="$(toiso "$f")"; until="$(toiso $((u - 1)))"
  for attempt in 1 2; do
    if npx vercel logs "$TARGET" --since "$since" --until "$until" --limit "$LIMIT" --expand \
        --project "$PROJECT" --scope "$SCOPE" > "$base.txt" 2>&1; then
      # "<parsed records> <the CLI's own 'Fetched N logs' count, or ?>"
      echo "ok $(node "$MERGE" count "$base.txt")" > "$base.res"
      return 0
    fi
    [ "$attempt" -eq 1 ] && sleep 3
  done
  echo "  slice $since → $until: CLI failed twice; stderr tail:" >&2
  tail -n 3 "$base.txt" >&2
  echo "failed 0 ?" > "$base.res"
}

MANIFEST="$TMP/manifest"; : > "$MANIFEST"
resplit=0; waves=0
started=$(date +%s)
while [ -s "$Q" ]; do
  waves=$((waves + 1))
  mv "$Q" "$TMP/wave"; : > "$Q"
  while read -r f u; do
    fetch_one "$f" "$u" &
    while [ "$(jobs -rp | wc -l)" -ge "$PAR" ]; do sleep 0.5; done
  done < "$TMP/wave"
  wait
  while read -r f u; do
    read -r st n cli < "$TMP/s_${f}_${u}.res"
    # Saturation on the larger of the two record counts (they agree
    # unless the parser and the CLI disagree on what a record is — that
    # disagreement is kept per slice as cli= next to records=).
    if [ "$cli" != "?" ] && [ "$cli" -gt "$n" ]; then n="$cli"; fi
    if [ "$st" = "ok" ] && [ "$n" -ge "$LIMIT" ]; then
      if [ $(((u - f) / 2)) -ge "$MIN_SLICE_MS" ]; then
        m=$(((f + u) / 2))
        echo "$f $m" >> "$Q"; echo "$m $u" >> "$Q"
        resplit=$((resplit + 1))
        echo "  slice $(toiso "$f") → $(toiso "$u"): $n records ≥ limit $LIMIT — split in half" >&2
        continue
      fi
      st="saturated"
      echo "SATURATED slice $(toiso "$f") → $(toiso "$u"): $n ≥ limit $LIMIT at the minimum width — export INCOMPLETE" >&2
    fi
    echo "$f $u $st $n $cli $TMPN/s_${f}_${u}.txt" >> "$MANIFEST"
  done < "$TMP/wave"
done

PASSFLAG=()
[ "$SECOND" -eq 1 ] && PASSFLAG=(--second-pass)
node "$MERGE" assemble "$OUT" "$MANIFEST" --target="$TARGET" --since="$SINCE_ISO" --until="$UNTIL_ISO" \
  --limit="$LIMIT" --tz="$(date +%z)" --resplit="$resplit" "${PASSFLAG[@]}"
rc=$?
echo "pass $((SECOND + 1)): $waves wave(s), $(( $(date +%s) - started )) s → $OUT"
exit "$rc"
