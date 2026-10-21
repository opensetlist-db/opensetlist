#!/usr/bin/env bash
# Warm TTFB of the event detail page on one running server — the number
# the `perf — event detail TTFB` workflow compares between a PR's merge
# commit and its base. The workflow calls this script for both sides, so
# a local run against `next start` measures exactly what CI measures:
#
#   scripts/ttfb-event-detail.sh <base-url> [label]
#   e.g. scripts/ttfb-event-detail.sh http://localhost:3000 LOCAL
#
# Prints the mean TTFB in seconds (e.g. `0.412`) on stdout and one line
# per sample on stderr. Shape, unchanged since the manual validation of
# PR #260: one warm-up pass to discard cold-start timing, then 2
# measurement passes over ko/ja/en × PERF_EVENT_IDS, each sample being
# curl's `time_starttransfer`. Only HTTP 200 samples enter the mean;
# when more than half the samples are non-200 the script exits 1 instead
# of printing a meaningless number.
#
# Measure a production build (`npm run build && npm run start`), not
# `next dev`: dev compiles each route on first hit and renders without
# the production caches, so its numbers are not comparable to CI's.
set -euo pipefail

base="${1:?usage: ttfb-event-detail.sh <base-url> [label]}"
base="${base%/}"
label="${2:-TTFB}"

# Events to sample, as `{id}/{db-slug}` — the canonical URL form. Bare
# `/events/{id}` 308s to the slug URL (see `enforceCanonicalSlug` in
# src/lib/seo/entityUrl.ts), and curl without -L would record every
# sample as a non-200. Following the redirect instead would bill the
# redirect hop to whichever side redirects, so the paths carry the slug
# directly. Defaults (dev DB):
#   1 = "Love Live! Hasunosora 6th Live Dream ~Bloom Garden Party~ Day 1"
#   2 = "Love Live! Hasunosora 6th Live Dream ~Bloom Garden Party~ Day 2"
# Both are completed events with full setlists / reactions / impressions
# populated, so every helper exercised by the page returns non-empty
# data. If those rows ever get soft-deleted, re-numbered or re-slugged in
# the dev DB, this default MUST be updated — otherwise every sample is a
# 404/308 and the non-200 refusal below fails the run.
PERF_EVENT_IDS="${PERF_EVENT_IDS:-1/hasunosora-6th-fukuoka-day1 2/hasunosora-6th-fukuoka-day2}"
if [ -z "${PERF_EVENT_IDS// /}" ]; then
  echo "$label: PERF_EVENT_IDS is empty; nothing to measure" >&2
  exit 1
fi

for locale in ko ja en; do
  for id in $PERF_EVENT_IDS; do
    curl -s -o /dev/null --max-time 30 "$base/$locale/events/$id" >/dev/null 2>&1 || true
  done
done

times=()
non200=0
total=0
for pass in 1 2; do
  for locale in ko ja en; do
    for id in $PERF_EVENT_IDS; do
      total=$((total + 1))
      # A failed curl (timeout, refused) exits non-zero, so the fallback
      # appends a `000` line to whatever -w printed; either way the code
      # is not `200` and the sample is excluded below.
      resp=$(curl -w '%{http_code} %{time_starttransfer}' -o /dev/null -s --max-time 30 \
        "$base/$locale/events/$id" 2>/dev/null || echo "000 30")
      code=$(echo "$resp" | awk '{print $1}')
      t=$(echo "$resp" | awk '{print $2}')
      if [ "$code" = "200" ]; then
        times+=("$t")
        echo "$label  $locale/$id  pass=$pass  http=$code  ttfb=${t}s" >&2
      else
        non200=$((non200 + 1))
        echo "$label  $locale/$id  pass=$pass  http=$code  ttfb=${t}s  ⚠️ EXCLUDED (non-200)" >&2
      fi
    done
  done
done

if [ "$non200" -gt $((total / 2)) ]; then
  echo "$label: $non200/$total samples were non-200; refusing to compute TTFB" >&2
  exit 1
fi
printf '%s\n' "${times[@]}" | awk '{s+=$1; n++} END {printf "%.3f\n", s/n}'
