# Step 7 join — spam7 — step7-P1

- Inputs: tests/load/results/2026-10-12/2026-10-12T21-41-34-479Z-browsers-spam7.json, tests/load/results/2026-10-12/2026-10-12T21-33-11Z-vercel-logs-history-step7-P1.txt, tests/load/results/2026-10-12/2026-10-12T21-33-16-132Z-pooler-clients.csv, tests/load/results/2026-10-12/2026-10-12T21-33-16-141Z-supavisor-backends.csv
- Base https://opensetlist-git-dev-opensetlist-projects.vercel.app; measurement window 2026-10-12T21:34:12.648Z → 2026-10-12T21:41:12.648Z
- Phases: baseline 2026-10-12T21:34:12.648Z; spam start 2026-10-12T21:35:12.648Z; last send 2026-10-12T21:40:12.155Z; recovery end 2026-10-12T21:41:12.648Z; sends 600; writes 13 (0 anchor)
- Log clock → UTC: +7 h (fetch header tz=-0700). History-mode lines carry their request's START time; `[liveWriter]` lines carry the function's own `at`. Harness times are this host's clock; a comparison closer than the clock offset is indeterminate.
- Declared process: `{"pid":46380,"name":"k6.exe","cmd":"C:\\Users\\cheon\\AppData\\Local\\Temp\\claude\\F--work-ClaudeCode-opensetlist4\\d5b4d07b-b71e-4d5a-8c11-1c72a24fe58d\\scratchpad\\k6bin\\k6-v2.2.0-windows-amd64\\k6.exe run tests/load/viewers.js -e ADMIN_CYCLES=0 -e QUIET_CYCLES=0 -e COLD_START=0 -e POLL_RPS=1 -e SSR_RPS=2.5 -e STEADY_START=0 -e STEADY_SECONDS=683 -e REACTIONS=500 -e REACTION_AT=338 -e DRAIN_S=0 -e HINT_MODE=r2","startedAt":"2026-10-12T21:33:31.1963740Z","tree":[46380],"descendants":[],"seenAt":"2026-10-12T21:33:40.369Z","endedAt":null,"checks":[{"label":"mid-spam","at":1791841062645,"ok":true,"competing":[],"declaredAlive":true,"declaredTree":[46380]},{"label":"measurement end","at":1791841272647,"ok":true,"competing":[],"declaredAlive":true,"declaredTree":[46380]}]}`

## Resource gates (server logs)

Evidence complete: **yes**. A gate without complete evidence reads UNESTABLISHED, never PASS; positive evidence of a breach is a FAIL either way. Honest latency keeps its own verdict (harness).

| gate | measured | threshold | verdict | basis |
|---|---|---|---|---|
| EMAXCONN | 0 log line(s); pooler probe 0 | 0 | **PASS** | complete log evidence |
| Σ (sum of per-instance pool totals) | peak 173 (reported 124) at 2026-10-12T21:35:15.000Z | < 300 | **PASS** | complete log evidence; silent DB instances covered by the pooler side-car |
| writer acquire per write | max 2 ms over 1 write(s) | ≤ 500 ms | **PASS** | every 2xx write has its line |

## Log completeness

- Fetch: target `opensetlist-git-dev-opensetlist-projects.vercel.app`, span 2026-10-12T21:33:11.000Z → 2026-10-12T21:43:05.000Z (covers the window: yes), limit 5000, passes 2 (first 2026-10-12T21:47:20.473Z, second 2026-10-12T21:53:02.052Z).
- Slices 20 (disjoint; gaps 0), request records 40079 (max 4304 per slice), saturated 0, re-split 0, failed 0; CLI 'Fetched N' disagreeing 0, absent 0; marker ≠ parsed 0.
- Second pass: identical 39929, enriched (later copy with more lines) 0, new 75, pass-1-only 75; slices not re-fetched completely 0.
- Reconciliation, `[liveWriter]` ok=true lines vs 2xx harness writes (by rev): **1 / 1** (ok); writer lines not matching a harness write near the window: 7.
- Reconciliation, `[setlist] hint-fetch` lines in the window vs harness hinted requests (±5 s endpoint padding): **23230** vs expected 23230–23230 (from hintedStarts) → ok.
- Log span 2026-10-12T21:33:31.370Z → 2026-10-12T21:41:43.810Z (covers window start yes, end yes); 36463 request records in the window; largest gap between consecutive records (window edges included) 400 ms at 2026-10-12T21:34:16.040Z; 90 distinct instance(s).

## Server outcomes per minute (UTC, measurement window)

Revision reads: an uncached `verifiedRevision` read logs `[liveSnapshot] rev-read`; a memo answer has no line of its own — for hinted requests it is the `memo` column. Warm-job builds are counted at their job's start. `error (503)` = hinted requests answered 503 (text mode has no status codes; the authoritative 503 counts are the harness's and k6's).

| minute | hint fetches | satisfied | memo | deferred | fresh | none | error (503) | other | builds | warm-job | reader | rev-reads (uncached) | of them hint=1 | rev-read timeout | lookups | hit | miss | timeout | memo-miss | capped | other | pool waiting max (lines >0) | build-failed | EMAXCONN | instances | requests |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 21:34 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 414 | 0 | 414 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 (0) | 0 | 0 | 8 | 1294 |
| 21:35 | 4985 | 0 | 898 | 4001 | 86 | 0 | 0 | 0 | 646 | 0 | 646 | 818 | 664 | 731 | 4985 | 0 | 3435 | 0 | 1550 | 0 | 0 | 17 (357) | 4425 | 0 | 89 | 6728 |
| 21:36 | 4190 | 0 | 0 | 4190 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 883 | 648 | 883 | 4190 | 0 | 3327 | 0 | 863 | 0 | 0 | 0 (0) | 5852 | 0 | 38 | 5923 |
| 21:37 | 4254 | 0 | 0 | 4254 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 915 | 664 | 915 | 4254 | 0 | 3503 | 0 | 751 | 0 | 0 | 0 (0) | 5977 | 0 | 38 | 6047 |
| 21:38 | 4300 | 0 | 0 | 4300 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 922 | 686 | 922 | 4300 | 0 | 3570 | 0 | 730 | 0 | 0 | 0 (0) | 6013 | 0 | 38 | 6082 |
| 21:39 | 4241 | 0 | 0 | 4241 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 923 | 712 | 923 | 4241 | 0 | 3610 | 0 | 631 | 0 | 0 | 0 (0) | 5959 | 0 | 38 | 6405 |
| 21:40 | 1260 | 0 | 0 | 1260 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 388 | 195 | 388 | 1260 | 0 | 1069 | 0 | 191 | 0 | 0 | 0 (0) | 3520 | 0 | 38 | 3580 |
| 21:41 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 (0) | 389 | 0 | 22 | 404 |
| **window** | 23230 | 0 | 898 | 22246 | 86 | 0 | 0 | 0 | 1060 | 0 | 1060 | 4849 | 3569 | 4762 | 23230 | 0 | 18514 | 0 | 4716 | 0 | 0 | 17 (357) | 32135 | 0 | 90 | 36463 |

## Server outcomes per 10 s (spam start → recovery end)

| from | hint fetches | satisfied | memo | deferred | fresh | none | error (503) | other | builds | warm-job | reader | rev-reads (uncached) | of them hint=1 | rev-read timeout | lookups | hit | miss | timeout | memo-miss | capped | other | pool waiting max (lines >0) | build-failed | EMAXCONN | instances | requests |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 21:35:10 | 1749 | 0 | 898 | 766 | 85 | 0 | 0 | 0 | 521 | 0 | 521 | 236 | 225 | 150 | 1749 | 0 | 1097 | 0 | 652 | 0 | 0 | 17 (356) | 329 | 0 | 89 | 1870 |
| 21:35:20 | 1021 | 0 | 0 | 1021 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 138 | 106 | 138 | 1021 | 0 | 656 | 0 | 365 | 0 | 0 | 0 (0) | 1010 | 0 | 37 | 1306 |
| 21:35:30 | 746 | 0 | 0 | 746 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 150 | 111 | 150 | 746 | 0 | 561 | 0 | 185 | 0 | 0 | 0 (0) | 1028 | 0 | 37 | 1042 |
| 21:35:40 | 734 | 0 | 0 | 734 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 144 | 104 | 144 | 734 | 0 | 566 | 0 | 168 | 0 | 0 | 0 (0) | 1032 | 0 | 37 | 1046 |
| 21:35:50 | 734 | 0 | 0 | 734 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 149 | 117 | 149 | 734 | 0 | 554 | 0 | 180 | 0 | 0 | 0 (0) | 1026 | 0 | 37 | 1036 |
| 21:36:00 | 733 | 0 | 0 | 733 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 148 | 116 | 148 | 733 | 0 | 558 | 0 | 175 | 0 | 0 | 0 (0) | 999 | 0 | 37 | 1013 |
| 21:36:10 | 669 | 0 | 0 | 669 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 147 | 98 | 147 | 669 | 0 | 512 | 0 | 157 | 0 | 0 | 0 (0) | 953 | 0 | 37 | 965 |
| 21:36:20 | 686 | 0 | 0 | 686 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 148 | 108 | 148 | 686 | 0 | 544 | 0 | 142 | 0 | 0 | 0 (0) | 970 | 0 | 37 | 979 |
| 21:36:30 | 703 | 0 | 0 | 703 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 139 | 105 | 139 | 703 | 0 | 560 | 0 | 143 | 0 | 0 | 0 (0) | 980 | 0 | 37 | 991 |
| 21:36:40 | 687 | 0 | 0 | 687 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 147 | 109 | 147 | 687 | 0 | 562 | 0 | 125 | 0 | 0 | 0 (0) | 960 | 0 | 38 | 973 |
| 21:36:50 | 712 | 0 | 0 | 712 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 154 | 112 | 154 | 712 | 0 | 591 | 0 | 121 | 0 | 0 | 0 (0) | 990 | 0 | 38 | 1002 |
| 21:37:00 | 698 | 0 | 0 | 698 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 155 | 106 | 155 | 698 | 0 | 591 | 0 | 107 | 0 | 0 | 0 (0) | 1001 | 0 | 38 | 1011 |
| 21:37:10 | 754 | 0 | 0 | 754 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 154 | 114 | 154 | 754 | 0 | 629 | 0 | 125 | 0 | 0 | 0 (0) | 1030 | 0 | 38 | 1044 |
| 21:37:20 | 705 | 0 | 0 | 705 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 156 | 113 | 156 | 705 | 0 | 581 | 0 | 124 | 0 | 0 | 0 (0) | 1003 | 0 | 38 | 1016 |
| 21:37:30 | 696 | 0 | 0 | 696 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 153 | 112 | 153 | 696 | 0 | 571 | 0 | 125 | 0 | 0 | 0 (0) | 966 | 0 | 38 | 972 |
| 21:37:40 | 693 | 0 | 0 | 693 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 143 | 106 | 143 | 693 | 0 | 566 | 0 | 127 | 0 | 0 | 0 (0) | 975 | 0 | 38 | 991 |
| 21:37:50 | 708 | 0 | 0 | 708 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 154 | 113 | 154 | 708 | 0 | 565 | 0 | 143 | 0 | 0 | 0 (0) | 1002 | 0 | 38 | 1013 |
| 21:38:00 | 732 | 0 | 0 | 732 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 151 | 120 | 151 | 732 | 0 | 597 | 0 | 135 | 0 | 0 | 0 (0) | 1016 | 0 | 38 | 1024 |
| 21:38:10 | 722 | 0 | 0 | 722 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 155 | 109 | 155 | 722 | 0 | 606 | 0 | 116 | 0 | 0 | 0 (0) | 1016 | 0 | 38 | 1034 |
| 21:38:20 | 720 | 0 | 0 | 720 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 155 | 125 | 155 | 720 | 0 | 599 | 0 | 121 | 0 | 0 | 0 (0) | 1005 | 0 | 38 | 1013 |
| 21:38:30 | 699 | 0 | 0 | 699 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 157 | 116 | 157 | 699 | 0 | 586 | 0 | 113 | 0 | 0 | 0 (0) | 984 | 0 | 38 | 993 |
| 21:38:40 | 707 | 0 | 0 | 707 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 148 | 105 | 148 | 707 | 0 | 585 | 0 | 122 | 0 | 0 | 0 (0) | 993 | 0 | 38 | 1007 |
| 21:38:50 | 720 | 0 | 0 | 720 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 156 | 111 | 156 | 720 | 0 | 597 | 0 | 123 | 0 | 0 | 0 (0) | 999 | 0 | 38 | 1011 |
| 21:39:00 | 698 | 0 | 0 | 698 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 145 | 112 | 145 | 698 | 0 | 581 | 0 | 117 | 0 | 0 | 0 (0) | 985 | 0 | 38 | 995 |
| 21:39:10 | 717 | 0 | 0 | 717 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 160 | 129 | 160 | 717 | 0 | 623 | 0 | 94 | 0 | 0 | 0 (0) | 997 | 0 | 38 | 1306 |
| 21:39:20 | 711 | 0 | 0 | 711 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 151 | 114 | 151 | 711 | 0 | 601 | 0 | 110 | 0 | 0 | 0 (0) | 1008 | 0 | 38 | 1104 |
| 21:39:30 | 724 | 0 | 0 | 724 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 158 | 129 | 158 | 724 | 0 | 616 | 0 | 108 | 0 | 0 | 0 (0) | 1006 | 0 | 38 | 1017 |
| 21:39:40 | 710 | 0 | 0 | 710 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 157 | 108 | 157 | 710 | 0 | 591 | 0 | 119 | 0 | 0 | 0 (0) | 989 | 0 | 38 | 1002 |
| 21:39:50 | 681 | 0 | 0 | 681 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 152 | 120 | 152 | 681 | 0 | 598 | 0 | 83 | 0 | 0 | 0 (0) | 974 | 0 | 38 | 981 |
| 21:40:00 | 721 | 0 | 0 | 721 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 149 | 111 | 149 | 721 | 0 | 611 | 0 | 110 | 0 | 0 | 0 (0) | 1005 | 0 | 38 | 1017 |
| 21:40:10 ◂ last send | 539 | 0 | 0 | 539 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 149 | 84 | 149 | 539 | 0 | 458 | 0 | 81 | 0 | 0 | 0 (0) | 946 | 0 | 38 | 956 |
| 21:40:20 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 90 | 0 | 90 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 (0) | 705 | 0 | 38 | 713 |
| 21:40:30 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 (0) | 285 | 0 | 32 | 296 |
| 21:40:40 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 (0) | 313 | 0 | 23 | 324 |
| 21:40:50 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 (0) | 266 | 0 | 22 | 274 |
| 21:41:00 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 (0) | 305 | 0 | 22 | 317 |
| 21:41:10 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 (0) | 84 | 0 | 22 | 87 |

## First vs last attack minute

| minute | hint fetches | satisfied | memo | deferred | fresh | none | error (503) | other | builds | warm-job | reader | rev-reads (uncached) | of them hint=1 | rev-read timeout | lookups | hit | miss | timeout | memo-miss | capped | other | pool waiting max (lines >0) | build-failed | EMAXCONN | instances | requests |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| first (21:35:12 +60 s) | 5836 | 0 | 898 | 4853 | 85 | 0 | 0 | 0 | 521 | 0 | 521 | 1001 | 802 | 915 | 5836 | 0 | 4086 | 0 | 1750 | 0 | 0 | 17 (356) | 5607 | 0 | 89 | 7500 |
| last (21:39:12 → 21:40:12) | 4275 | 0 | 0 | 4275 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 930 | 709 | 930 | 4275 | 0 | 3650 | 0 | 625 | 0 | 0 | 0 (0) | 5980 | 0 | 38 | 6424 |

Σ peak: first minute 173, last minute 0.

## Writes — harness × `[liveWriter]` (by rev)

| k | label | rev | HTTP | PUT start (UTC) | PUT ms | writer `at` | where | acquire ms | exec ms | instance |
|---|---|---|---|---|---|---|---|---|---|---|
| 0 | anchor | 1892 | 200 | 2026-10-12T21:33:42.041Z | 616 | 2026-10-12T21:33:42.536Z | inside PUT | 2 | 254 | 6c3f472b |
| 1 | insert | — | 503 | 2026-10-12T21:35:22.655Z | 2413 | — | **no line** | — | — | — |
| 2 | put | — | 503 | 2026-10-12T21:35:47.658Z | 5360 | — | **no line** | — | — | — |
| 3 | insert | — | 503 | 2026-10-12T21:36:12.651Z | 2757 | — | **no line** | — | — | — |
| 4 | put | — | 503 | 2026-10-12T21:36:37.652Z | 5385 | — | **no line** | — | — | — |
| 5 | insert | — | 503 | 2026-10-12T21:37:02.654Z | 2349 | — | **no line** | — | — | — |
| 6 | put | — | 503 | 2026-10-12T21:37:27.653Z | 5355 | — | **no line** | — | — | — |
| 7 | insert | — | 503 | 2026-10-12T21:37:52.648Z | 2748 | — | **no line** | — | — | — |
| 8 | put | — | 503 | 2026-10-12T21:38:17.651Z | 5730 | — | **no line** | — | — | — |
| 9 | insert | — | 503 | 2026-10-12T21:38:42.657Z | 2375 | — | **no line** | — | — | — |
| 10 | put | — | 503 | 2026-10-12T21:39:07.660Z | 5375 | — | **no line** | — | — | — |
| 11 | insert | — | 503 | 2026-10-12T21:39:32.655Z | 2342 | — | **no line** | — | — | — |
| 12 | put | — | 503 | 2026-10-12T21:39:57.660Z | 5743 | — | **no line** | — | — | — |

Writer pre-execution failures in the window: admin-insert-after tx_max_wait @2026-10-12T21:35:22.660Z, admin-insert-after tx_max_wait @2026-10-12T21:36:13.010Z, admin-insert-after tx_max_wait @2026-10-12T21:37:02.650Z, admin-insert-after tx_max_wait @2026-10-12T21:37:53.030Z, admin-insert-after tx_max_wait @2026-10-12T21:38:42.680Z, admin-insert-after tx_max_wait @2026-10-12T21:39:32.640Z, admin-insert-after tx_max_wait @2026-10-12T21:39:32.640Z.

## Σ — sum of per-instance Prisma pool totals (app-side estimate)

- Peak **173** (carried; reported 124) at 2026-10-12T21:35:15.000Z over 87 instance(s); baseline max 171 / median 12.
- Estimator: 5 s buckets of per-instance MAXIMA (an upper bound within a bucket, not a simultaneous count); an instance is carried 5 s after its last pool line, then drops out — **silent instances expire by construction**, so a falling Σ means instances stopped logging, not that they closed their pooler clients. Times are request starts.
- Coverage: 84 bucket(s) in the window; 88 instance(s) logged pool lines; 2 instance(s) seen without any pool line (9fe03fc7, 02af55a4), of which 2 did database work (rev-read / writer / build-failed) — their connections are not in Σ; largest log gap 400 ms.
- After the last send (2026-10-12T21:40:12.155Z): Σ peak 0; first bucket at or below the baseline max 2026-10-12T21:40:15.000Z (+3 s) — an ESTIMATE (see the expiry caveat); the side-cars below are the corroboration.

| bucket (UTC) | Σ carried | Σ reported | instances (carried) | max waiting |
|---|---|---|---|---|
| 21:40:15 | 0 | 0 | 0 | 0 |
| 21:40:20 | 0 | 0 | 0 | 0 |
| 21:40:25 | 0 | 0 | 0 | 0 |
| 21:40:30 | 0 | 0 | 0 | 0 |
| 21:40:35 | 0 | 0 | 0 | 0 |
| 21:40:40 | 0 | 0 | 0 | 0 |
| 21:40:45 | 0 | 0 | 0 | 0 |
| 21:40:50 | 0 | 0 | 0 | 0 |
| 21:40:55 | 0 | 0 | 0 | 0 |
| 21:41:00 | 0 | 0 | 0 | 0 |
| 21:41:05 | 0 | 0 | 0 | 0 |
| 21:41:10 | 0 | 0 | 0 | 0 |

## Side-car — pooler-clients.mjs

- 68 sample(s) in the window; file spans 2026-10-12T21:33:17.293Z → 2026-10-12T21:41:35.298Z (covers the window ±5 s: yes); largest gap 10015 ms. Probe failures 36; EMAXCONN in probe / errors 0.

| period | samples | pooler used clients max | client active max | client waiting max | client max wait s max | backends max | backends active max | idle in tx max | probe ms max |
|---|---|---|---|---|---|---|---|---|---|
| baseline | 30 | 1 | 1 | 0 | 0 | 30 | 3 | 3 | 782 |
| attack (spam start → last send) | 32 | 1 | 1 | 0 | 0 | 30 | 14 | 16 | 2808 |
| attack, first minute | 8 | 1 | 1 | 0 | 0 | 30 | 14 | 16 | 2808 |
| attack, last minute | 6 | 1 | 1 | 0 | 0 | 30 | 1 | 16 | — |
| recovery (after the last send) | 6 | 1 | 1 | 0 | 0 | 30 | 1 | 16 | — |
| whole window | 68 | 1 | 1 | 0 | 0 | 30 | 14 | 16 | 2808 |

After the last send, per 10 s:

| from (UTC) | samples | pooler used clients | client active | client waiting | client max wait s | backends | backends active | idle in tx | probe ms |
|---|---|---|---|---|---|---|---|---|---|
| 21:40:12 | 1 | 1 | 1 | 0 | 0 | 30 | 1 | 16 | — |
| 21:40:22 | 1 | 1 | 1 | 0 | 0 | 30 | 1 | 16 | — |
| 21:40:32 | 1 | 1 | 1 | 0 | 0 | 30 | 1 | 16 | — |
| 21:40:42 | 1 | 1 | 1 | 0 | 0 | 30 | 1 | 16 | — |
| 21:40:52 | 1 | 1 | 1 | 0 | 0 | 30 | 1 | 16 | — |
| 21:41:02 | 1 | 1 | 1 | 0 | 0 | 30 | 1 | 16 | — |
| 21:41:12 | 0 | — | — | — | — | — | — | — | — |

## Side-car — supavisor-backends.mjs

- 420 sample(s) in the window; file spans 2026-10-12T21:33:16.142Z → 2026-10-12T21:41:35.144Z (covers the window ±5 s: yes); largest gap 1014 ms.

| period | samples | backends max | active max | idle in tx max | max tx age ms max | max active ms max | lock waits max |
|---|---|---|---|---|---|---|---|
| baseline | 60 | 20 | 5 | 5 | 142 | 108 | 0 |
| attack (spam start → last send) | 299 | 20 | 13 | 16 | 294378 | 221 | 0 |
| attack, first minute | 60 | 20 | 13 | 16 | 55378 | 221 | 0 |
| attack, last minute | 60 | 20 | 0 | 16 | 294378 | 0 | 0 |
| recovery (after the last send) | 61 | 20 | 0 | 16 | 355371 | 0 | 0 |
| whole window | 420 | 20 | 13 | 16 | 355371 | 221 | 0 |

After the last send, per 10 s:

| from (UTC) | samples | backends | active | idle in tx | max tx age ms | max active ms | lock waits |
|---|---|---|---|---|---|---|---|
| 21:40:12 | 10 | 20 | 0 | 16 | 304382 | 0 | 0 |
| 21:40:22 | 11 | 20 | 0 | 16 | 315375 | 0 | 0 |
| 21:40:32 | 10 | 20 | 0 | 16 | 325374 | 0 | 0 |
| 21:40:42 | 10 | 20 | 0 | 16 | 335370 | 0 | 0 |
| 21:40:52 | 10 | 20 | 0 | 16 | 345375 | 0 | 0 |
| 21:41:02 | 10 | 20 | 0 | 16 | 355371 | 0 | 0 |
| 21:41:12 | 0 | — | — | — | — | — | — |

Harness 503s in the 1 s buckets: 0; server 503 evidence: hinted `verify=error` 0, `build-failed` 32135, error-level records 32863.

