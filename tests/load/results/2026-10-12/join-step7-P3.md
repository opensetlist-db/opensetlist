# Step 7 join — spam7 — step7-P3

- Inputs: tests/load/results/2026-10-12/2026-10-12T22-09-52-360Z-browsers-spam7.json, tests/load/results/2026-10-12/2026-10-12T22-05-38Z-vercel-logs-history-step7-P3.txt, tests/load/results/2026-10-12/2026-10-12T22-05-43-633Z-pooler-clients.csv, tests/load/results/2026-10-12/2026-10-12T22-05-43-652Z-supavisor-backends.csv
- Base https://opensetlist-git-dev-opensetlist-projects.vercel.app; measurement window 2026-10-12T22:06:41.142Z → 2026-10-12T22:09:41.142Z
- Phases: baseline 2026-10-12T22:06:41.142Z; spam start 2026-10-12T22:07:41.142Z; last send 2026-10-12T22:08:40.649Z; recovery end 2026-10-12T22:09:41.142Z; sends 120; writes 4 (0 anchor)
- Log clock → UTC: +7 h (fetch header tz=-0700). History-mode lines carry their request's START time; `[liveWriter]` lines carry the function's own `at`. Harness times are this host's clock; a comparison closer than the clock offset is indeterminate.
- Declared process: `{"pid":21760,"name":"k6.exe","cmd":"C:\\Users\\cheon\\AppData\\Local\\Temp\\claude\\F--work-ClaudeCode-opensetlist4\\d5b4d07b-b71e-4d5a-8c11-1c72a24fe58d\\scratchpad\\k6bin\\k6-v2.2.0-windows-amd64\\k6.exe run tests/load/viewers.js -e ADMIN_CYCLES=0 -e QUIET_CYCLES=0 -e COLD_START=0 -e POLL_RPS=1 -e SSR_RPS=2.5 -e STEADY_START=0 -e STEADY_SECONDS=443 -e REACTIONS=500 -e REACTION_AT=273 -e DRAIN_S=0 -e HINT_MODE=r2","startedAt":"2026-10-12T22:05:58.7125270Z","tree":[21760],"descendants":[],"seenAt":"2026-10-12T22:06:07.870Z","endedAt":null,"checks":[{"label":"mid-spam","at":1791842891143,"ok":true,"competing":[],"declaredAlive":true,"declaredTree":[21760]},{"label":"measurement end","at":1791842981151,"ok":true,"competing":[],"declaredAlive":true,"declaredTree":[21760]}]}`

## Resource gates (server logs)

Evidence complete: **yes**. A gate without complete evidence reads UNESTABLISHED, never PASS; positive evidence of a breach is a FAIL either way. Honest latency keeps its own verdict (harness).

| gate | measured | threshold | verdict | basis |
|---|---|---|---|---|
| EMAXCONN | 0 log line(s); pooler probe 0 | 0 | **PASS** | complete log evidence |
| Σ (sum of per-instance pool totals) | peak 26 (reported 26) at 2026-10-12T22:08:50.000Z | < 300 | **PASS** | complete log evidence |
| writer acquire per write | max 24 ms over 4 write(s) | ≤ 500 ms | **PASS** | every 2xx write has its line |

## Log completeness

- Fetch: target `opensetlist-git-dev-opensetlist-projects.vercel.app`, span 2026-10-12T22:05:38.000Z → 2026-10-12T22:11:22.000Z (covers the window: yes), limit 5000, passes 2 (first 2026-10-12T22:21:59.056Z, second 2026-10-12T22:24:25.055Z).
- Slices 20 (disjoint; gaps 0), request records 10461 (max 1749 per slice), saturated 0, re-split 0, failed 0; CLI 'Fetched N' disagreeing 0, absent 0; marker ≠ parsed 0.
- Second pass: identical 10455, enriched (later copy with more lines) 0, new 3, pass-1-only 3; slices not re-fetched completely 0.
- Reconciliation, `[liveWriter]` ok=true lines vs 2xx harness writes (by rev): **4 / 4** (ok); writer lines not matching a harness write near the window: 0.
- Reconciliation, `[setlist] hint-fetch` lines in the window vs harness hinted requests (±5 s endpoint padding): **1447** vs expected 1447–1447 (from hintedStarts) → ok.
- Log span 2026-10-12T22:05:58.870Z → 2026-10-12T22:09:58.330Z (covers window start yes, end yes); 6821 request records in the window; largest gap between consecutive records (window edges included) 400 ms at 2026-10-12T22:06:42.840Z; 49 distinct instance(s).

## Server outcomes per minute (UTC, measurement window)

Revision reads: an uncached `verifiedRevision` read logs `[liveSnapshot] rev-read`; a memo answer has no line of its own — for hinted requests it is the `memo` column. Warm-job builds are counted at their job's start. `error (503)` = hinted requests answered 503 (text mode has no status codes; the authoritative 503 counts are the harness's and k6's).

| minute | hint fetches | satisfied | memo | deferred | fresh | none | error (503) | other | builds | warm-job | reader | rev-reads (uncached) | of them hint=1 | rev-read timeout | lookups | hit | miss | timeout | memo-miss | capped | other | pool waiting max (lines >0) | build-failed | EMAXCONN | instances | requests |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 22:06 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 176 | 0 | 176 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 (0) | 0 | 0 | 11 | 545 |
| 22:07 | 957 | 957 | 0 | 0 | 0 | 0 | 0 | 0 | 538 | 6 | 532 | 0 | 0 | 0 | 957 | 957 | 0 | 0 | 0 | 0 | 0 | 1 (2) | 0 | 0 | 47 | 2694 |
| 22:08 | 490 | 490 | 0 | 0 | 0 | 0 | 0 | 0 | 511 | 3 | 508 | 0 | 0 | 0 | 490 | 490 | 0 | 0 | 0 | 0 | 0 | 0 (0) | 0 | 0 | 47 | 2374 |
| 22:09 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 344 | 0 | 344 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 (0) | 0 | 0 | 10 | 1208 |
| **window** | 1447 | 1447 | 0 | 0 | 0 | 0 | 0 | 0 | 1569 | 9 | 1560 | 0 | 0 | 0 | 1447 | 1447 | 0 | 0 | 0 | 0 | 0 | 1 (2) | 0 | 0 | 49 | 6821 |

## Server outcomes per 10 s (spam start → recovery end)

| from | hint fetches | satisfied | memo | deferred | fresh | none | error (503) | other | builds | warm-job | reader | rev-reads (uncached) | of them hint=1 | rev-read timeout | lookups | hit | miss | timeout | memo-miss | capped | other | pool waiting max (lines >0) | build-failed | EMAXCONN | instances | requests |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 22:07:40 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 81 | 0 | 81 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 (0) | 0 | 0 | 6 | 226 |
| 22:07:50 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 88 | 0 | 88 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 (1) | 0 | 0 | 6 | 324 |
| 22:08:00 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 64 | 0 | 64 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 (0) | 0 | 0 | 7 | 278 |
| 22:08:10 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 87 | 0 | 87 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 (0) | 0 | 0 | 7 | 307 |
| 22:08:20 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 81 | 0 | 81 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 (0) | 0 | 0 | 6 | 271 |
| 22:08:30 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 80 | 0 | 80 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 (0) | 0 | 0 | 7 | 318 |
| 22:08:40 ◂ last send | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 89 | 0 | 89 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 (0) | 0 | 0 | 6 | 280 |
| 22:08:50 | 490 | 490 | 0 | 0 | 0 | 0 | 0 | 0 | 110 | 3 | 107 | 0 | 0 | 0 | 490 | 490 | 0 | 0 | 0 | 0 | 0 | 0 (0) | 0 | 0 | 47 | 920 |
| 22:09:00 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 80 | 0 | 80 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 (0) | 0 | 0 | 10 | 285 |
| 22:09:10 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 87 | 0 | 87 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 (0) | 0 | 0 | 8 | 300 |
| 22:09:20 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 89 | 0 | 89 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 (0) | 0 | 0 | 5 | 285 |
| 22:09:30 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 77 | 0 | 77 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 (0) | 0 | 0 | 7 | 306 |
| 22:09:40 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 11 | 0 | 11 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 (0) | 0 | 0 | 4 | 32 |

## First vs last attack minute

| minute | hint fetches | satisfied | memo | deferred | fresh | none | error (503) | other | builds | warm-job | reader | rev-reads (uncached) | of them hint=1 | rev-read timeout | lookups | hit | miss | timeout | memo-miss | capped | other | pool waiting max (lines >0) | build-failed | EMAXCONN | instances | requests |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| first (22:07:41 +60 s) | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 487 | 0 | 487 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 (1) | 0 | 0 | 8 | 1753 |
| last (22:07:40 → 22:08:40) | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 492 | 0 | 492 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 (1) | 0 | 0 | 8 | 1753 |

Σ peak: first minute 14, last minute 14.

## Writes — harness × `[liveWriter]` (by rev)

| k | label | rev | HTTP | PUT start (UTC) | PUT ms | writer `at` | where | acquire ms | exec ms | instance |
|---|---|---|---|---|---|---|---|---|---|---|
| 0 | anchor | 1904 | 200 | 2026-10-12T22:06:09.500Z | 687 | 2026-10-12T22:06:10.066Z | inside PUT | 4 | 329 | 532f62db |
| 1 | insert | 1905 | 200 | 2026-10-12T22:07:21.150Z | 968 | 2026-10-12T22:07:21.872Z | inside PUT | 4 | 491 | e7fb19e7 |
| 1 | put | 1906 | 200 | 2026-10-12T22:07:22.119Z | 878 | 2026-10-12T22:07:22.411Z | inside PUT | 24 | 66 | e7fb19e7 |
| 2 | put | 1907 | 200 | 2026-10-12T22:08:51.146Z | 507 | 2026-10-12T22:08:51.530Z | inside PUT | 3 | 135 | bef43197 |

## Σ — sum of per-instance Prisma pool totals (app-side estimate)

- Peak **26** (carried; reported 26) at 2026-10-12T22:08:50.000Z over 19 instance(s); baseline max 19 / median 14.
- Estimator: 5 s buckets of per-instance MAXIMA (an upper bound within a bucket, not a simultaneous count); an instance is carried 5 s after its last pool line, then drops out — **silent instances expire by construction**, so a falling Σ means instances stopped logging, not that they closed their pooler clients. Times are request starts.
- Coverage: 36 bucket(s) in the window; 30 instance(s) logged pool lines; 19 instance(s) seen without any pool line (3fc30051, 1e05bd73, 7d417402, 821fbfb0, 6472501f, 4d0cdf5d, 1c656800, 281bebd7 …), of which 0 did database work (rev-read / writer / build-failed) — their connections are not in Σ; largest log gap 400 ms.
- After the last send (2026-10-12T22:08:40.649Z): Σ peak 26; first bucket at or below the baseline max 2026-10-12T22:08:45.000Z (+4 s) — an ESTIMATE (see the expiry caveat); the side-cars below are the corroboration.

| bucket (UTC) | Σ carried | Σ reported | instances (carried) | max waiting |
|---|---|---|---|---|
| 22:08:45 | 11 | 11 | 6 | 0 |
| 22:08:50 | 26 | 26 | 19 | 0 |
| 22:08:55 | 25 | 14 | 19 | 0 |
| 22:09:00 | 12 | 12 | 10 | 0 |
| 22:09:05 | 12 | 11 | 10 | 0 |
| 22:09:10 | 12 | 11 | 9 | 0 |
| 22:09:15 | 13 | 11 | 8 | 0 |
| 22:09:20 | 11 | 9 | 6 | 0 |
| 22:09:25 | 10 | 10 | 5 | 0 |
| 22:09:30 | 10 | 10 | 5 | 0 |
| 22:09:35 | 10 | 10 | 7 | 0 |
| 22:09:40 | 16 | 13 | 9 | 0 |

## Side-car — pooler-clients.mjs

- 90 sample(s) in the window; file spans 2026-10-12T22:05:44.206Z → 2026-10-12T22:09:52.214Z (covers the window ±5 s: yes); largest gap 2027 ms. Probe failures 0; EMAXCONN in probe / errors 0.

| period | samples | pooler used clients max | client active max | client waiting max | client max wait s max | backends max | backends active max | idle in tx max | probe ms max |
|---|---|---|---|---|---|---|---|---|---|
| baseline | 30 | 1 | 1 | 0 | 0 | 30 | 3 | 6 | 1086 |
| attack (spam start → last send) | 30 | 1 | 1 | 0 | 0 | 30 | 3 | 2 | 850 |
| attack, first minute | 30 | 1 | 1 | 0 | 0 | 30 | 3 | 2 | 850 |
| attack, last minute | 30 | 1 | 1 | 0 | 0 | 30 | 3 | 2 | 850 |
| recovery (after the last send) | 30 | 1 | 1 | 0 | 0 | 30 | 2 | 2 | 1064 |
| whole window | 90 | 1 | 1 | 0 | 0 | 30 | 3 | 6 | 1086 |

After the last send, per 10 s:

| from (UTC) | samples | pooler used clients | client active | client waiting | client max wait s | backends | backends active | idle in tx | probe ms |
|---|---|---|---|---|---|---|---|---|---|
| 22:08:40 | 5 | 1 | 1 | 0 | 0 | 30 | 2 | 2 | 781 |
| 22:08:50 | 5 | 1 | 1 | 0 | 0 | 30 | 2 | 1 | 1064 |
| 22:09:00 | 5 | 1 | 1 | 0 | 0 | 30 | 1 | 1 | 758 |
| 22:09:10 | 5 | 1 | 1 | 0 | 0 | 30 | 2 | 2 | 769 |
| 22:09:20 | 5 | 1 | 1 | 0 | 0 | 30 | 2 | 1 | 771 |
| 22:09:30 | 5 | 1 | 1 | 0 | 0 | 30 | 1 | 2 | 772 |
| 22:09:40 | 0 | — | — | — | — | — | — | — | — |

## Side-car — supavisor-backends.mjs

- 180 sample(s) in the window; file spans 2026-10-12T22:05:43.653Z → 2026-10-12T22:09:52.660Z (covers the window ±5 s: yes); largest gap 1015 ms.

| period | samples | backends max | active max | idle in tx max | max tx age ms max | max active ms max | lock waits max |
|---|---|---|---|---|---|---|---|
| baseline | 60 | 20 | 3 | 7 | 663031 | 42 | 0 |
| attack (spam start → last send) | 59 | 20 | 3 | 3 | 166 | 20 | 0 |
| attack, first minute | 60 | 20 | 3 | 3 | 166 | 20 | 0 |
| attack, last minute | 60 | 20 | 3 | 3 | 166 | 20 | 0 |
| recovery (after the last send) | 61 | 20 | 4 | 2 | 143 | 23 | 1 |
| whole window | 180 | 20 | 4 | 7 | 663031 | 42 | 1 |

After the last send, per 10 s:

| from (UTC) | samples | backends | active | idle in tx | max tx age ms | max active ms | lock waits |
|---|---|---|---|---|---|---|---|
| 22:08:40 | 10 | 20 | 2 | 2 | 18 | 9 | 0 |
| 22:08:50 | 10 | 20 | 3 | 1 | 65 | 20 | 1 |
| 22:09:00 | 10 | 20 | 1 | 1 | 41 | 3 | 0 |
| 22:09:10 | 10 | 20 | 3 | 1 | 143 | 23 | 0 |
| 22:09:20 | 10 | 20 | 4 | 1 | 46 | 23 | 0 |
| 22:09:30 | 10 | 20 | 2 | 1 | 52 | 16 | 0 |
| 22:09:40 | 1 | 20 | 1 | 0 | 3 | 1 | 0 |

Harness 503s in the 1 s buckets: 0; server 503 evidence: hinted `verify=error` 0, `build-failed` 0, error-level records 5.

