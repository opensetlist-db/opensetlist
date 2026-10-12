# Step 7 join — spam7 — step7-P0

- Inputs: tests/load/results/2026-10-12/2026-10-12T21-20-13-998Z-browsers-spam7.json, tests/load/results/2026-10-12/2026-10-12T21-10-17Z-vercel-logs-history-step7-P0.txt, tests/load/results/2026-10-12/2026-10-12T21-19-15-062Z-viewers.json, tests/load/results/2026-10-12/2026-10-12T21-10-22-649Z-pooler-clients.csv, tests/load/results/2026-10-12/2026-10-12T21-10-22-649Z-supavisor-backends.csv
- Base https://opensetlist-git-dev-opensetlist-projects.vercel.app; measurement window 2026-10-12T21:13:00.714Z → 2026-10-12T21:20:00.714Z
- Phases: baseline 2026-10-12T21:13:00.714Z; spam start 2026-10-12T21:14:00.714Z; last send 2026-10-12T21:19:00.714Z; recovery end 2026-10-12T21:20:00.714Z; sends 0; writes 19 (0 anchor)
- Log clock → UTC: +7 h (fetch header tz=-0700). History-mode lines carry their request's START time; `[liveWriter]` lines carry the function's own `at`. Harness times are this host's clock; a comparison closer than the clock offset is indeterminate.
- Declared process: `{"pid":45044,"name":"k6.exe","cmd":"C:\\Users\\cheon\\AppData\\Local\\Temp\\claude\\F--work-ClaudeCode-opensetlist4\\d5b4d07b-b71e-4d5a-8c11-1c72a24fe58d\\scratchpad\\k6bin\\k6-v2.2.0-windows-amd64\\k6.exe run tests/load/viewers.js -e ADMIN_CYCLES=0 -e QUIET_CYCLES=0 -e COLD_START=0 -e POLL_RPS=1 -e SSR_RPS=2.5 -e STEADY_START=0 -e STEADY_SECONDS=515 -e REACTIONS=500 -e REACTION_AT=260 -e DRAIN_S=0 -e HINT_MODE=r2","startedAt":"2026-10-12T21:10:37.6937710Z","tree":[45044],"descendants":[],"seenAt":"2026-10-12T21:10:46.816Z","endedAt":"2026-10-12T21:19:16.695Z","checks":[{"label":"mid-spam","at":1791839790717,"ok":true,"competing":[],"declaredAlive":true,"declaredTree":[45044]},{"label":"measurement end","at":1791840000716,"ok":true,"competing":[],"declaredAlive":false,"declaredTree":[45044]}]}`

## Resource gates (server logs)

Evidence complete: **yes**. A gate without complete evidence reads UNESTABLISHED, never PASS; positive evidence of a breach is a FAIL either way. Honest latency keeps its own verdict (harness).

| gate | measured | threshold | verdict | basis |
|---|---|---|---|---|
| EMAXCONN | 0 log line(s); pooler probe 0 | 0 | **PASS** | complete log evidence |
| Σ (sum of per-instance pool totals) | peak 98 (reported 31) at 2026-10-12T21:15:05.000Z | < 300 | **PASS** | complete log evidence |
| writer acquire per write | max 18 ms over 19 write(s) | ≤ 500 ms | **PASS** | every 2xx write has its line |

## Log completeness

- Fetch: target `opensetlist-git-dev-opensetlist-projects.vercel.app`, span 2026-10-12T21:10:17.000Z → 2026-10-12T21:21:44.000Z (covers the window: yes), limit 5000, passes 2 (first 2026-10-12T21:27:07.643Z, second 2026-10-12T21:31:34.687Z).
- Slices 20 (disjoint; gaps 0), request records 29554 (max 2963 per slice), saturated 0, re-split 0, failed 0; CLI 'Fetched N' disagreeing 0, absent 0; marker ≠ parsed 0.
- Second pass: identical 29520, enriched (later copy with more lines) 0, new 17, pass-1-only 17; slices not re-fetched completely 0.
- Reconciliation, `[liveWriter]` ok=true lines vs 2xx harness writes (by rev): **19 / 19** (ok); writer lines not matching a harness write near the window: 0.
- Reconciliation, `[setlist] hint-fetch` lines in the window vs harness hinted requests (±5 s endpoint padding): **8650** vs expected 8650–8650 (from hintedStarts) → ok.
- Log span 2026-10-12T21:10:37.830Z → 2026-10-12T21:20:20.010Z (covers window start yes, end yes); 21953 request records in the window; largest gap between consecutive records (window edges included) 370 ms at 2026-10-12T21:18:53.260Z; 87 distinct instance(s).

## Server outcomes per minute (UTC, measurement window)

Revision reads: an uncached `verifiedRevision` read logs `[liveSnapshot] rev-read`; a memo answer has no line of its own — for hinted requests it is the `memo` column. Warm-job builds are counted at their job's start. `error (503)` = hinted requests answered 503 (text mode has no status codes; the authoritative 503 counts are the harness's and k6's).

| minute | hint fetches | satisfied | memo | deferred | fresh | none | error (503) | other | builds | warm-job | reader | rev-reads (uncached) | of them hint=1 | rev-read timeout | lookups | hit | miss | timeout | memo-miss | capped | other | pool waiting max (lines >0) | build-failed | EMAXCONN | instances | requests |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 21:13 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 468 | 0 | 468 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 (1) | 0 | 0 | 8 | 1746 |
| 21:14 | 1444 | 1444 | 0 | 0 | 0 | 0 | 0 | 0 | 706 | 9 | 697 | 0 | 0 | 0 | 1444 | 1431 | 7 | 0 | 6 | 0 | 0 | 5 (7) | 0 | 0 | 61 | 3351 |
| 21:15 | 2388 | 2388 | 0 | 0 | 0 | 0 | 0 | 0 | 714 | 15 | 699 | 0 | 0 | 0 | 2388 | 2380 | 6 | 0 | 2 | 0 | 0 | 13 (15) | 0 | 0 | 75 | 5132 |
| 21:16 | 1436 | 1436 | 0 | 0 | 0 | 0 | 0 | 0 | 801 | 9 | 792 | 0 | 0 | 0 | 1436 | 1436 | 0 | 0 | 0 | 0 | 0 | 2 (2) | 0 | 0 | 57 | 3208 |
| 21:17 | 1937 | 1937 | 0 | 0 | 0 | 0 | 0 | 0 | 543 | 12 | 531 | 0 | 0 | 0 | 1937 | 1934 | 2 | 0 | 1 | 0 | 0 | 1 (1) | 0 | 0 | 67 | 3704 |
| 21:18 | 1445 | 1445 | 0 | 0 | 0 | 0 | 0 | 0 | 629 | 9 | 620 | 0 | 0 | 0 | 1445 | 1444 | 0 | 1 | 0 | 0 | 0 | 1 (1) | 0 | 0 | 86 | 3188 |
| 21:19 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 457 | 0 | 457 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 (0) | 0 | 0 | 7 | 1612 |
| 21:20 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 (0) | 0 | 0 | 1 | 12 |
| **window** | 8650 | 8650 | 0 | 0 | 0 | 0 | 0 | 0 | 4319 | 54 | 4265 | 0 | 0 | 0 | 8650 | 8625 | 15 | 1 | 9 | 0 | 0 | 13 (27) | 0 | 0 | 87 | 21953 |

## Server outcomes per 10 s (spam start → recovery end)

| from | hint fetches | satisfied | memo | deferred | fresh | none | error (503) | other | builds | warm-job | reader | rev-reads (uncached) | of them hint=1 | rev-read timeout | lookups | hit | miss | timeout | memo-miss | capped | other | pool waiting max (lines >0) | build-failed | EMAXCONN | instances | requests |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 21:14:00 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 98 | 0 | 98 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 (0) | 0 | 0 | 6 | 255 |
| 21:14:10 | 962 | 962 | 0 | 0 | 0 | 0 | 0 | 0 | 190 | 6 | 184 | 0 | 0 | 0 | 962 | 949 | 7 | 0 | 6 | 0 | 0 | 1 (4) | 0 | 0 | 60 | 1281 |
| 21:14:20 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 113 | 0 | 113 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 (0) | 0 | 0 | 12 | 266 |
| 21:14:30 | 482 | 482 | 0 | 0 | 0 | 0 | 0 | 0 | 98 | 3 | 95 | 0 | 0 | 0 | 482 | 482 | 0 | 0 | 0 | 0 | 0 | 0 (0) | 0 | 0 | 47 | 911 |
| 21:14:40 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 102 | 0 | 102 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 (0) | 0 | 0 | 8 | 289 |
| 21:14:50 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 102 | 0 | 102 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 5 (3) | 0 | 0 | 7 | 327 |
| 21:15:00 | 954 | 954 | 0 | 0 | 0 | 0 | 0 | 0 | 186 | 6 | 180 | 0 | 0 | 0 | 954 | 946 | 6 | 0 | 2 | 0 | 0 | 13 (15) | 0 | 0 | 74 | 2218 |
| 21:15:10 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 110 | 0 | 110 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 (0) | 0 | 0 | 6 | 301 |
| 21:15:20 | 486 | 486 | 0 | 0 | 0 | 0 | 0 | 0 | 99 | 3 | 96 | 0 | 0 | 0 | 486 | 486 | 0 | 0 | 0 | 0 | 0 | 0 (0) | 0 | 0 | 40 | 766 |
| 21:15:30 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 87 | 0 | 87 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 (0) | 0 | 0 | 10 | 306 |
| 21:15:40 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 70 | 0 | 70 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 (0) | 0 | 0 | 8 | 291 |
| 21:15:50 | 948 | 948 | 0 | 0 | 0 | 0 | 0 | 0 | 162 | 6 | 156 | 0 | 0 | 0 | 948 | 948 | 0 | 0 | 0 | 0 | 0 | 0 (0) | 0 | 0 | 63 | 1250 |
| 21:16:00 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 115 | 0 | 115 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 (0) | 0 | 0 | 14 | 286 |
| 21:16:10 | 485 | 485 | 0 | 0 | 0 | 0 | 0 | 0 | 108 | 3 | 105 | 0 | 0 | 0 | 485 | 485 | 0 | 0 | 0 | 0 | 0 | 0 (0) | 0 | 0 | 44 | 797 |
| 21:16:20 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 79 | 0 | 79 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 (0) | 0 | 0 | 9 | 275 |
| 21:16:30 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 82 | 0 | 82 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 (0) | 0 | 0 | 7 | 307 |
| 21:16:40 | 951 | 951 | 0 | 0 | 0 | 0 | 0 | 0 | 217 | 6 | 211 | 0 | 0 | 0 | 951 | 951 | 0 | 0 | 0 | 0 | 0 | 0 (0) | 0 | 0 | 56 | 1238 |
| 21:16:50 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 200 | 0 | 200 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 2 (2) | 0 | 0 | 9 | 305 |
| 21:17:00 | 487 | 487 | 0 | 0 | 0 | 0 | 0 | 0 | 75 | 3 | 72 | 0 | 0 | 0 | 487 | 487 | 0 | 0 | 0 | 0 | 0 | 1 (1) | 0 | 0 | 48 | 778 |
| 21:17:10 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 81 | 0 | 81 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 (0) | 0 | 0 | 9 | 280 |
| 21:17:20 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 69 | 0 | 69 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 (0) | 0 | 0 | 7 | 296 |
| 21:17:30 | 961 | 961 | 0 | 0 | 0 | 0 | 0 | 0 | 123 | 6 | 117 | 0 | 0 | 0 | 961 | 958 | 2 | 0 | 1 | 0 | 0 | 0 (0) | 0 | 0 | 62 | 1265 |
| 21:17:40 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 89 | 0 | 89 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 (0) | 0 | 0 | 10 | 285 |
| 21:17:50 | 489 | 489 | 0 | 0 | 0 | 0 | 0 | 0 | 106 | 3 | 103 | 0 | 0 | 0 | 489 | 489 | 0 | 0 | 0 | 0 | 0 | 0 (0) | 0 | 0 | 67 | 800 |
| 21:18:00 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 129 | 0 | 129 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 (0) | 0 | 0 | 13 | 283 |
| 21:18:10 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 99 | 0 | 99 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 (1) | 0 | 0 | 10 | 290 |
| 21:18:20 | 957 | 957 | 0 | 0 | 0 | 0 | 0 | 0 | 90 | 6 | 84 | 0 | 0 | 0 | 957 | 957 | 0 | 0 | 0 | 0 | 0 | 0 (0) | 0 | 0 | 86 | 1258 |
| 21:18:30 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 83 | 0 | 83 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 (0) | 0 | 0 | 9 | 277 |
| 21:18:40 | 488 | 488 | 0 | 0 | 0 | 0 | 0 | 0 | 110 | 3 | 107 | 0 | 0 | 0 | 488 | 487 | 0 | 1 | 0 | 0 | 0 | 0 (0) | 0 | 0 | 52 | 805 |
| 21:18:50 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 118 | 0 | 118 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 (0) | 0 | 0 | 9 | 275 |
| 21:19:00 ◂ last send | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 92 | 0 | 92 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 (0) | 0 | 0 | 7 | 311 |
| 21:19:10 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 69 | 0 | 69 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 (0) | 0 | 0 | 5 | 255 |
| 21:19:20 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 86 | 0 | 86 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 (0) | 0 | 0 | 6 | 281 |
| 21:19:30 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 61 | 0 | 61 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 (0) | 0 | 0 | 6 | 247 |
| 21:19:40 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 80 | 0 | 80 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 (0) | 0 | 0 | 5 | 262 |
| 21:19:50 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 69 | 0 | 69 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 (0) | 0 | 0 | 5 | 256 |
| 21:20:00 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 (0) | 0 | 0 | 1 | 12 |

## First vs last attack minute

| minute | hint fetches | satisfied | memo | deferred | fresh | none | error (503) | other | builds | warm-job | reader | rev-reads (uncached) | of them hint=1 | rev-read timeout | lookups | hit | miss | timeout | memo-miss | capped | other | pool waiting max (lines >0) | build-failed | EMAXCONN | instances | requests |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| first (21:14:00 +60 s) | 1444 | 1444 | 0 | 0 | 0 | 0 | 0 | 0 | 711 | 9 | 702 | 0 | 0 | 0 | 1444 | 1431 | 7 | 0 | 6 | 0 | 0 | 5 (7) | 0 | 0 | 61 | 3420 |
| last (21:18:00 → 21:19:00) | 1445 | 1445 | 0 | 0 | 0 | 0 | 0 | 0 | 620 | 9 | 611 | 0 | 0 | 0 | 1445 | 1444 | 0 | 1 | 0 | 0 | 0 | 1 (1) | 0 | 0 | 86 | 3206 |

Σ peak: first minute 84, last minute 29.

## Writes — harness × `[liveWriter]` (by rev)

| k | label | rev | HTTP | PUT start (UTC) | PUT ms | writer `at` | where | acquire ms | exec ms | instance |
|---|---|---|---|---|---|---|---|---|---|---|
| 0 | anchor | 1862 | 200 | 2026-10-12T21:10:48.419Z | 692 | 2026-10-12T21:10:48.985Z | inside PUT | 3 | 321 | 45520092 |
| 1 | insert | 1863 | 200 | 2026-10-12T21:14:10.717Z | 1076 | 2026-10-12T21:14:11.537Z | inside PUT | 4 | 547 | e7257620 |
| 1 | put | 1864 | 200 | 2026-10-12T21:14:11.796Z | 962 | 2026-10-12T21:14:12.153Z | inside PUT | 3 | 91 | 23abd09c |
| 2 | put | 1865 | 200 | 2026-10-12T21:14:35.722Z | 462 | 2026-10-12T21:14:36.054Z | inside PUT | 3 | 64 | 109f3a10 |
| 3 | insert | 1866 | 200 | 2026-10-12T21:15:00.725Z | 947 | 2026-10-12T21:15:01.413Z | inside PUT | 5 | 419 | 85271042 |
| 3 | put | 1867 | 200 | 2026-10-12T21:15:01.672Z | 1002 | 2026-10-12T21:15:02.150Z | inside PUT | 6 | 159 | 2475080e |
| 4 | put | 1868 | 200 | 2026-10-12T21:15:25.716Z | 448 | 2026-10-12T21:15:26.046Z | inside PUT | 4 | 85 | cccb9150 |
| 5 | insert | 1869 | 200 | 2026-10-12T21:15:50.726Z | 878 | 2026-10-12T21:15:51.354Z | inside PUT | 2 | 394 | a5247706 |
| 5 | put | 1870 | 200 | 2026-10-12T21:15:51.605Z | 713 | 2026-10-12T21:15:52.079Z | inside PUT | 4 | 185 | 469e868e |
| 6 | put | 1871 | 200 | 2026-10-12T21:16:15.720Z | 481 | 2026-10-12T21:16:16.077Z | inside PUT | 3 | 74 | c1b6968a |
| 7 | insert | 1872 | 200 | 2026-10-12T21:16:40.718Z | 903 | 2026-10-12T21:16:41.332Z | inside PUT | 3 | 364 | c1b6968a |
| 7 | put | 1873 | 200 | 2026-10-12T21:16:41.622Z | 921 | 2026-10-12T21:16:42.027Z | inside PUT | 3 | 132 | d64dd608 |
| 8 | put | 1874 | 200 | 2026-10-12T21:17:05.714Z | 593 | 2026-10-12T21:17:06.189Z | inside PUT | 18 | 166 | 868e91ad |
| 9 | insert | 1875 | 200 | 2026-10-12T21:17:30.719Z | 786 | 2026-10-12T21:17:31.256Z | inside PUT | 3 | 291 | 13e90603 |
| 9 | put | 1876 | 200 | 2026-10-12T21:17:31.506Z | 868 | 2026-10-12T21:17:31.860Z | inside PUT | 3 | 74 | b20ae8aa |
| 10 | put | 1877 | 200 | 2026-10-12T21:17:55.714Z | 455 | 2026-10-12T21:17:56.031Z | inside PUT | 3 | 71 | 5841b49c |
| 11 | insert | 1878 | 200 | 2026-10-12T21:18:20.714Z | 819 | 2026-10-12T21:18:21.253Z | inside PUT | 2 | 274 | de7f3d32 |
| 11 | put | 1879 | 200 | 2026-10-12T21:18:21.533Z | 967 | 2026-10-12T21:18:21.815Z | inside PUT | 2 | 36 | 868e91ad |
| 12 | put | 1880 | 200 | 2026-10-12T21:18:45.716Z | 464 | 2026-10-12T21:18:46.034Z | inside PUT | 4 | 68 | 256b5062 |

## Σ — sum of per-instance Prisma pool totals (app-side estimate)

- Peak **98** (carried; reported 31) at 2026-10-12T21:15:05.000Z over 54 instance(s); baseline max 12 / median 10.
- Estimator: 5 s buckets of per-instance MAXIMA (an upper bound within a bucket, not a simultaneous count); an instance is carried 5 s after its last pool line, then drops out — **silent instances expire by construction**, so a falling Σ means instances stopped logging, not that they closed their pooler clients. Times are request starts.
- Coverage: 84 bucket(s) in the window; 81 instance(s) logged pool lines; 6 instance(s) seen without any pool line (3c36e2fe, 9e8c3223, 8a4de920, 37db3ba8, c104d721, 7f4b1da3), of which 0 did database work (rev-read / writer / build-failed) — their connections are not in Σ; largest log gap 370 ms.
- After the last send (2026-10-12T21:19:00.714Z): Σ peak 12; first bucket at or below the baseline max 2026-10-12T21:19:05.000Z (+4 s) — an ESTIMATE (see the expiry caveat); the side-cars below are the corroboration.

| bucket (UTC) | Σ carried | Σ reported | instances (carried) | max waiting |
|---|---|---|---|---|
| 21:19:05 | 11 | 11 | 7 | 0 |
| 21:19:10 | 12 | 10 | 7 | 0 |
| 21:19:15 | 10 | 8 | 5 | 0 |
| 21:19:20 | 8 | 8 | 4 | 0 |
| 21:19:25 | 10 | 10 | 6 | 0 |
| 21:19:30 | 10 | 10 | 6 | 0 |
| 21:19:35 | 11 | 7 | 6 | 0 |
| 21:19:40 | 7 | 7 | 4 | 0 |
| 21:19:45 | 8 | 6 | 4 | 0 |
| 21:19:50 | 7 | 7 | 4 | 0 |
| 21:19:55 | 9 | 7 | 5 | 0 |
| 21:20:00 | 8 | 8 | 4 | 0 |

## Side-car — pooler-clients.mjs

- 210 sample(s) in the window; file spans 2026-10-12T21:10:23.776Z → 2026-10-12T21:20:13.781Z (covers the window ±5 s: yes); largest gap 2015 ms. Probe failures 0; EMAXCONN in probe / errors 0.

| period | samples | pooler used clients max | client active max | client waiting max | client max wait s max | backends max | backends active max | idle in tx max | probe ms max |
|---|---|---|---|---|---|---|---|---|---|
| baseline | 30 | 1 | 1 | 0 | 0 | 30 | 2 | 2 | 793 |
| attack (spam start → last send) | 150 | 1 | 1 | 0 | 0 | 30 | 6 | 4 | 1528 |
| attack, first minute | 30 | 1 | 1 | 0 | 0 | 30 | 5 | 2 | 1053 |
| attack, last minute | 30 | 1 | 1 | 0 | 0 | 27 | 3 | 1 | 1528 |
| recovery (after the last send) | 30 | 1 | 1 | 0 | 0 | 27 | 5 | 2 | 829 |
| whole window | 210 | 1 | 1 | 0 | 0 | 30 | 6 | 4 | 1528 |

After the last send, per 10 s:

| from (UTC) | samples | pooler used clients | client active | client waiting | client max wait s | backends | backends active | idle in tx | probe ms |
|---|---|---|---|---|---|---|---|---|---|
| 21:19:00 | 5 | 1 | 1 | 0 | 0 | 27 | 5 | 2 | 777 |
| 21:19:10 | 5 | 1 | 1 | 0 | 0 | 27 | 1 | 1 | 749 |
| 21:19:20 | 5 | 1 | 1 | 0 | 0 | 27 | 2 | 1 | 758 |
| 21:19:30 | 5 | 1 | 1 | 0 | 0 | 27 | 1 | 1 | 829 |
| 21:19:40 | 5 | 1 | 1 | 0 | 0 | 27 | 1 | 0 | 769 |
| 21:19:50 | 5 | 1 | 1 | 0 | 0 | 27 | 2 | 1 | 755 |

## Side-car — supavisor-backends.mjs

- 420 sample(s) in the window; file spans 2026-10-12T21:10:22.650Z → 2026-10-12T21:20:13.658Z (covers the window ±5 s: yes); largest gap 1014 ms.

| period | samples | backends max | active max | idle in tx max | max tx age ms max | max active ms max | lock waits max |
|---|---|---|---|---|---|---|---|
| baseline | 60 | 20 | 2 | 2 | 167 | 28 | 0 |
| attack (spam start → last send) | 300 | 20 | 4 | 4 | 169 | 47 | 0 |
| attack, first minute | 60 | 20 | 4 | 2 | 75 | 47 | 0 |
| attack, last minute | 60 | 17 | 2 | 2 | 54 | 18 | 0 |
| recovery (after the last send) | 60 | 17 | 1 | 2 | 80 | 15 | 0 |
| whole window | 420 | 20 | 4 | 4 | 169 | 47 | 0 |

After the last send, per 10 s:

| from (UTC) | samples | backends | active | idle in tx | max tx age ms | max active ms | lock waits |
|---|---|---|---|---|---|---|---|
| 21:19:00 | 10 | 17 | 1 | 2 | 80 | 2 | 0 |
| 21:19:10 | 10 | 17 | 1 | 0 | 26 | 15 | 0 |
| 21:19:20 | 10 | 17 | 1 | 1 | 41 | 10 | 0 |
| 21:19:30 | 10 | 17 | 1 | 1 | 41 | 15 | 0 |
| 21:19:40 | 10 | 17 | 0 | 1 | 42 | 0 | 0 |
| 21:19:50 | 10 | 17 | 1 | 0 | 33 | 12 | 0 |

## k6 background (viewers.js)

- Configured: steady 515 s, poll 1 rps, SSR 2.5 rps, reactions 500 pairs @260s over 10s, HINT_MODE=r2; setup start rev 1861, started 2026-10-12T21:10:39.709Z.
- **5xx: unestablished** — http_req_failed: 3 of 2809 requests failed; their status codes are not in the k6 JSON. Requests 2809. Error COUNTS per stream (non-200 or transport; counts, not the thresholds' tolerated rates): snapshot 0/516, poll 0/516, ssr 3/1284, reactionPost 0/501, reactionDelete 0/501, admin 0/0.
- Generator: **SHORT** — poll 516 req = 1.00 rps (100.2 % of 1); SSR 1284 req = 2.49 rps (99.7 % of 2.5); reactions POST 501 / DELETE 501 = 501 pairs (100.2 % of 500); dropped iterations poll 0, SSR 4, reactions 0 (total 4). A SHORT generator is an INVALID candidate for the orchestrator (design §0), not a service result.
- p95: snapshot 420 ms, poll 420 ms, SSR 852 ms, reaction POST 532 ms / DELETE 555 ms; k6 hinted fetches 0.

Harness 503s in the 1 s buckets: 0; server 503 evidence: hinted `verify=error` 0, `build-failed` 0, error-level records 0.

