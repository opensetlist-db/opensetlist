# Step 7 join — spam7 — step7-P2

- Inputs: tests/load/results/2026-10-12/2026-10-12T22-02-35-022Z-browsers-spam7.json, tests/load/results/2026-10-12/2026-10-12T21-54-16Z-vercel-logs-history-step7-P2.txt, tests/load/results/2026-10-12/2026-10-12T21-54-21-236Z-pooler-clients.csv, tests/load/results/2026-10-12/2026-10-12T21-54-21-258Z-supavisor-backends.csv
- Base https://opensetlist-git-dev-opensetlist-projects.vercel.app; measurement window 2026-10-12T21:55:18.464Z → 2026-10-12T22:02:18.464Z
- Phases: baseline 2026-10-12T21:55:18.464Z; spam start 2026-10-12T21:56:18.464Z; last send 2026-10-12T22:01:17.979Z; recovery end 2026-10-12T22:02:18.464Z; sends 600; writes 13 (0 anchor)
- Log clock → UTC: +7 h (fetch header tz=-0700). History-mode lines carry their request's START time; `[liveWriter]` lines carry the function's own `at`. Harness times are this host's clock; a comparison closer than the clock offset is indeterminate.
- Declared process: `{"pid":42132,"name":"k6.exe","cmd":"C:\\Users\\cheon\\AppData\\Local\\Temp\\claude\\F--work-ClaudeCode-opensetlist4\\d5b4d07b-b71e-4d5a-8c11-1c72a24fe58d\\scratchpad\\k6bin\\k6-v2.2.0-windows-amd64\\k6.exe run tests/load/viewers.js -e ADMIN_CYCLES=0 -e QUIET_CYCLES=0 -e COLD_START=0 -e POLL_RPS=1 -e SSR_RPS=2.5 -e STEADY_START=0 -e STEADY_SECONDS=683 -e REACTIONS=500 -e REACTION_AT=338 -e DRAIN_S=0 -e HINT_MODE=r2","startedAt":"2026-10-12T21:54:36.2520060Z","tree":[42132],"descendants":[],"seenAt":"2026-10-12T21:54:45.439Z","endedAt":null,"checks":[{"label":"mid-spam","at":1791842328461,"ok":true,"competing":[],"declaredAlive":true,"declaredTree":[42132]},{"label":"measurement end","at":1791842538465,"ok":true,"competing":[],"declaredAlive":true,"declaredTree":[42132]}]}`

## Resource gates (server logs)

Evidence complete: **yes**. A gate without complete evidence reads UNESTABLISHED, never PASS; positive evidence of a breach is a FAIL either way. Honest latency keeps its own verdict (harness).

| gate | measured | threshold | verdict | basis |
|---|---|---|---|---|
| EMAXCONN | 55 log line(s); pooler probe 1 | 0 | **FAIL** | EMAXCONN present |
| Σ (sum of per-instance pool totals) | peak 271 (reported 105) at 2026-10-12T21:56:20.000Z | < 300 | **PASS** | complete log evidence; silent DB instances covered by the pooler side-car |
| writer acquire per write | max 4 ms over 1 write(s) | ≤ 500 ms | **PASS** | every 2xx write has its line |

## Log completeness

- Fetch: target `opensetlist-git-dev-opensetlist-projects.vercel.app`, span 2026-10-12T21:54:16.000Z → 2026-10-12T22:04:05.000Z (covers the window: yes), limit 5000, passes 2 (first 2026-10-12T22:14:45.870Z, second 2026-10-12T22:20:23.399Z).
- Slices 20 (disjoint; gaps 0), request records 39801 (max 3869 per slice), saturated 0, re-split 0, failed 0; CLI 'Fetched N' disagreeing 0, absent 0; marker ≠ parsed 0.
- Second pass: identical 39761, enriched (later copy with more lines) 0, new 20, pass-1-only 20; slices not re-fetched completely 0.
- Reconciliation, `[liveWriter]` ok=true lines vs 2xx harness writes (by rev): **1 / 1** (ok); writer lines not matching a harness write near the window: 6.
- Reconciliation, `[setlist] hint-fetch` lines in the window vs harness hinted requests (±5 s endpoint padding): **23114** vs expected 23114–23114 (from hintedStarts) → ok.
- Log span 2026-10-12T21:54:36.460Z → 2026-10-12T22:02:42.290Z (covers window start yes, end yes); 36308 request records in the window; largest gap between consecutive records (window edges included) 400 ms at 2026-10-12T21:58:30.090Z; 231 distinct instance(s).

## Server outcomes per minute (UTC, measurement window)

Revision reads: an uncached `verifiedRevision` read logs `[liveSnapshot] rev-read`; a memo answer has no line of its own — for hinted requests it is the `memo` column. Warm-job builds are counted at their job's start. `error (503)` = hinted requests answered 503 (text mode has no status codes; the authoritative 503 counts are the harness's and k6's).

| minute | hint fetches | satisfied | memo | deferred | fresh | none | error (503) | other | builds | warm-job | reader | rev-reads (uncached) | of them hint=1 | rev-read timeout | lookups | hit | miss | timeout | memo-miss | capped | other | pool waiting max (lines >0) | build-failed | EMAXCONN | instances | requests |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 21:55 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 348 | 0 | 348 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 (5) | 0 | 0 | 10 | 1200 |
| 21:56 | 4341 | 0 | 549 | 3740 | 52 | 0 | 0 | 0 | 516 | 0 | 516 | 894 | 746 | 821 | 4341 | 0 | 3122 | 0 | 1219 | 0 | 0 | 12 (151) | 4031 | 55 | 230 | 6053 |
| 21:57 | 4192 | 0 | 0 | 4192 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 936 | 697 | 936 | 4192 | 0 | 3330 | 0 | 862 | 0 | 0 | 0 (0) | 5817 | 0 | 45 | 5900 |
| 21:58 | 4400 | 0 | 0 | 4400 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1027 | 754 | 1027 | 4400 | 0 | 3642 | 0 | 758 | 0 | 0 | 0 (0) | 6135 | 0 | 45 | 6207 |
| 21:59 | 4233 | 0 | 0 | 4233 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 994 | 740 | 994 | 4233 | 0 | 3522 | 0 | 711 | 0 | 0 | 0 (0) | 5897 | 0 | 45 | 5967 |
| 22:00 | 4328 | 0 | 0 | 4328 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 994 | 752 | 994 | 4328 | 0 | 3616 | 0 | 712 | 0 | 0 | 0 (0) | 6073 | 0 | 45 | 6523 |
| 22:01 | 1620 | 0 | 0 | 1620 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 506 | 300 | 506 | 1620 | 0 | 1362 | 0 | 258 | 0 | 0 | 0 (0) | 3839 | 0 | 53 | 3917 |
| 22:02 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 (0) | 524 | 0 | 10 | 541 |
| **window** | 23114 | 0 | 549 | 22513 | 52 | 0 | 0 | 0 | 864 | 0 | 864 | 5351 | 3989 | 5278 | 23114 | 0 | 18594 | 0 | 4520 | 0 | 0 | 12 (156) | 32316 | 55 | 231 | 36308 |

## Server outcomes per 10 s (spam start → recovery end)

| from | hint fetches | satisfied | memo | deferred | fresh | none | error (503) | other | builds | warm-job | reader | rev-reads (uncached) | of them hint=1 | rev-read timeout | lookups | hit | miss | timeout | memo-miss | capped | other | pool waiting max (lines >0) | build-failed | EMAXCONN | instances | requests |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 21:56:10 | 796 | 0 | 506 | 249 | 41 | 0 | 0 | 0 | 268 | 0 | 268 | 182 | 178 | 141 | 796 | 0 | 459 | 0 | 337 | 0 | 0 | 12 (110) | 40 | 0 | 174 | 820 |
| 21:56:20 | 1379 | 0 | 41 | 1338 | 0 | 0 | 0 | 0 | 71 | 0 | 71 | 256 | 237 | 235 | 1379 | 0 | 981 | 0 | 398 | 0 | 0 | 11 (40) | 942 | 55 | 175 | 1589 |
| 21:56:30 | 695 | 0 | 0 | 695 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 150 | 106 | 150 | 695 | 0 | 542 | 0 | 153 | 0 | 0 | 0 (0) | 1020 | 0 | 45 | 1033 |
| 21:56:40 | 785 | 0 | 0 | 785 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 150 | 122 | 150 | 785 | 0 | 595 | 0 | 190 | 0 | 0 | 0 (0) | 1030 | 0 | 44 | 1037 |
| 21:56:50 | 673 | 0 | 0 | 673 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 145 | 92 | 145 | 673 | 0 | 533 | 0 | 140 | 0 | 0 | 0 (0) | 999 | 0 | 45 | 1019 |
| 21:57:00 | 694 | 0 | 0 | 694 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 150 | 114 | 150 | 694 | 0 | 536 | 0 | 158 | 0 | 0 | 0 (0) | 922 | 0 | 45 | 933 |
| 21:57:10 | 688 | 0 | 0 | 688 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 159 | 113 | 159 | 688 | 0 | 544 | 0 | 144 | 0 | 0 | 0 (0) | 987 | 0 | 45 | 1004 |
| 21:57:20 | 717 | 0 | 0 | 717 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 165 | 131 | 165 | 717 | 0 | 565 | 0 | 152 | 0 | 0 | 0 (0) | 974 | 0 | 45 | 991 |
| 21:57:30 | 687 | 0 | 0 | 687 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 162 | 115 | 162 | 687 | 0 | 553 | 0 | 134 | 0 | 0 | 0 (0) | 959 | 0 | 45 | 968 |
| 21:57:40 | 703 | 0 | 0 | 703 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 162 | 121 | 162 | 703 | 0 | 572 | 0 | 131 | 0 | 0 | 0 (0) | 981 | 0 | 45 | 996 |
| 21:57:50 | 703 | 0 | 0 | 703 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 138 | 103 | 138 | 703 | 0 | 560 | 0 | 143 | 0 | 0 | 0 (0) | 994 | 0 | 45 | 1008 |
| 21:58:00 | 735 | 0 | 0 | 735 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 161 | 119 | 161 | 735 | 0 | 613 | 0 | 122 | 0 | 0 | 0 (0) | 1027 | 0 | 45 | 1040 |
| 21:58:10 | 737 | 0 | 0 | 737 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 173 | 123 | 173 | 737 | 0 | 608 | 0 | 129 | 0 | 0 | 0 (0) | 1026 | 0 | 45 | 1036 |
| 21:58:20 | 759 | 0 | 0 | 759 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 173 | 130 | 173 | 759 | 0 | 635 | 0 | 124 | 0 | 0 | 0 (0) | 1033 | 0 | 45 | 1047 |
| 21:58:30 | 709 | 0 | 0 | 709 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 173 | 126 | 173 | 709 | 0 | 580 | 0 | 129 | 0 | 0 | 0 (0) | 1015 | 0 | 45 | 1025 |
| 21:58:40 | 741 | 0 | 0 | 741 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 171 | 130 | 171 | 741 | 0 | 605 | 0 | 136 | 0 | 0 | 0 (0) | 1018 | 0 | 45 | 1027 |
| 21:58:50 | 719 | 0 | 0 | 719 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 176 | 126 | 176 | 719 | 0 | 601 | 0 | 118 | 0 | 0 | 0 (0) | 1016 | 0 | 45 | 1032 |
| 21:59:00 | 721 | 0 | 0 | 721 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 166 | 125 | 166 | 721 | 0 | 598 | 0 | 123 | 0 | 0 | 0 (0) | 1000 | 0 | 45 | 1015 |
| 21:59:10 | 696 | 0 | 0 | 696 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 156 | 107 | 156 | 696 | 0 | 576 | 0 | 120 | 0 | 0 | 0 (0) | 981 | 0 | 45 | 986 |
| 21:59:20 | 698 | 0 | 0 | 698 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 160 | 126 | 160 | 698 | 0 | 584 | 0 | 114 | 0 | 0 | 0 (0) | 969 | 0 | 45 | 983 |
| 21:59:30 | 694 | 0 | 0 | 694 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 171 | 125 | 171 | 694 | 0 | 580 | 0 | 114 | 0 | 0 | 0 (0) | 975 | 0 | 45 | 993 |
| 21:59:40 | 713 | 0 | 0 | 713 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 173 | 139 | 173 | 713 | 0 | 587 | 0 | 126 | 0 | 0 | 0 (0) | 980 | 0 | 45 | 990 |
| 21:59:50 | 711 | 0 | 0 | 711 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 168 | 118 | 168 | 711 | 0 | 597 | 0 | 114 | 0 | 0 | 0 (0) | 992 | 0 | 45 | 1000 |
| 22:00:00 | 692 | 0 | 0 | 692 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 166 | 124 | 166 | 692 | 0 | 575 | 0 | 117 | 0 | 0 | 0 (0) | 976 | 0 | 45 | 995 |
| 22:00:10 | 711 | 0 | 0 | 711 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 148 | 117 | 148 | 711 | 0 | 597 | 0 | 114 | 0 | 0 | 0 (0) | 993 | 0 | 45 | 1096 |
| 22:00:20 | 727 | 0 | 0 | 727 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 166 | 127 | 166 | 727 | 0 | 617 | 0 | 110 | 0 | 0 | 0 (0) | 1022 | 0 | 45 | 1316 |
| 22:00:30 | 738 | 0 | 0 | 738 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 174 | 138 | 174 | 738 | 0 | 618 | 0 | 120 | 0 | 0 | 0 (0) | 1031 | 0 | 45 | 1046 |
| 22:00:40 | 724 | 0 | 0 | 724 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 172 | 119 | 172 | 724 | 0 | 608 | 0 | 116 | 0 | 0 | 0 (0) | 1031 | 0 | 45 | 1039 |
| 22:00:50 | 736 | 0 | 0 | 736 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 168 | 127 | 168 | 736 | 0 | 601 | 0 | 135 | 0 | 0 | 0 (0) | 1020 | 0 | 45 | 1031 |
| 22:01:00 | 743 | 0 | 0 | 743 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 167 | 132 | 167 | 743 | 0 | 623 | 0 | 120 | 0 | 0 | 0 (0) | 1010 | 0 | 46 | 1031 |
| 22:01:10 ◂ last send | 722 | 0 | 0 | 722 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 169 | 132 | 169 | 722 | 0 | 602 | 0 | 120 | 0 | 0 | 0 (0) | 1016 | 0 | 44 | 1027 |
| 22:01:20 | 155 | 0 | 0 | 155 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 156 | 36 | 156 | 155 | 0 | 137 | 0 | 18 | 0 | 0 | 0 (0) | 819 | 0 | 43 | 832 |
| 22:01:30 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 14 | 0 | 14 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 (0) | 430 | 0 | 44 | 446 |
| 22:01:40 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 (0) | 272 | 0 | 10 | 276 |
| 22:01:50 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 (0) | 292 | 0 | 10 | 305 |
| 22:02:00 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 (0) | 288 | 0 | 10 | 299 |
| 22:02:10 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 (0) | 236 | 0 | 10 | 242 |

## First vs last attack minute

| minute | hint fetches | satisfied | memo | deferred | fresh | none | error (503) | other | builds | warm-job | reader | rev-reads (uncached) | of them hint=1 | rev-read timeout | lookups | hit | miss | timeout | memo-miss | capped | other | pool waiting max (lines >0) | build-failed | EMAXCONN | instances | requests |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| first (21:56:18 +60 s) | 5528 | 0 | 547 | 4940 | 41 | 0 | 0 | 0 | 339 | 0 | 339 | 1156 | 932 | 1094 | 5528 | 0 | 4041 | 0 | 1487 | 0 | 0 | 12 (150) | 5703 | 55 | 230 | 7195 |
| last (22:00:17 → 22:01:17) | 4229 | 0 | 0 | 4229 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 993 | 759 | 993 | 4229 | 0 | 3541 | 0 | 688 | 0 | 0 | 0 (0) | 5902 | 0 | 46 | 6356 |

Σ peak: first minute 271, last minute 0.

## Writes — harness × `[liveWriter]` (by rev)

| k | label | rev | HTTP | PUT start (UTC) | PUT ms | writer `at` | where | acquire ms | exec ms | instance |
|---|---|---|---|---|---|---|---|---|---|---|
| 0 | anchor | 1898 | 200 | 2026-10-12T21:54:47.051Z | 786 | 2026-10-12T21:54:47.709Z | inside PUT | 4 | 420 | a81bedad |
| 1 | insert | — | 503 | 2026-10-12T21:56:28.465Z | 2402 | — | **no line** | — | — | — |
| 2 | put | — | 503 | 2026-10-12T21:56:53.468Z | 5357 | — | **no line** | — | — | — |
| 3 | insert | — | 503 | 2026-10-12T21:57:18.462Z | 2363 | — | **no line** | — | — | — |
| 4 | put | — | 503 | 2026-10-12T21:57:43.478Z | 5378 | — | **no line** | — | — | — |
| 5 | insert | — | 503 | 2026-10-12T21:58:08.476Z | 2371 | — | **no line** | — | — | — |
| 6 | put | — | 503 | 2026-10-12T21:58:33.465Z | 5346 | — | **no line** | — | — | — |
| 7 | insert | — | 503 | 2026-10-12T21:58:58.474Z | 2357 | — | **no line** | — | — | — |
| 8 | put | — | 503 | 2026-10-12T21:59:23.474Z | 5366 | — | **no line** | — | — | — |
| 9 | insert | — | 503 | 2026-10-12T21:59:48.458Z | 2375 | — | **no line** | — | — | — |
| 10 | put | — | 503 | 2026-10-12T22:00:13.469Z | 5411 | — | **no line** | — | — | — |
| 11 | insert | — | 503 | 2026-10-12T22:00:38.468Z | 2344 | — | **no line** | — | — | — |
| 12 | put | — | 503 | 2026-10-12T22:01:03.469Z | 5350 | — | **no line** | — | — | — |

Writer pre-execution failures in the window: admin-insert-after tx_max_wait @2026-10-12T21:56:28.470Z, admin-insert-after tx_max_wait @2026-10-12T21:57:18.450Z, admin-insert-after tx_max_wait @2026-10-12T21:58:08.470Z, admin-insert-after tx_max_wait @2026-10-12T21:58:58.470Z, admin-insert-after tx_max_wait @2026-10-12T21:59:48.470Z, admin-insert-after tx_max_wait @2026-10-12T22:00:38.450Z.

## Σ — sum of per-instance Prisma pool totals (app-side estimate)

- Peak **271** (carried; reported 105) at 2026-10-12T21:56:20.000Z over 138 instance(s); baseline max 237 / median 12.
- Estimator: 5 s buckets of per-instance MAXIMA (an upper bound within a bucket, not a simultaneous count); an instance is carried 5 s after its last pool line, then drops out — **silent instances expire by construction**, so a falling Σ means instances stopped logging, not that they closed their pooler clients. Times are request starts.
- Coverage: 84 bucket(s) in the window; 139 instance(s) logged pool lines; 92 instance(s) seen without any pool line (0d291702, d1b7ad4a, f7b40779, 01e85159, 75020389, adc61224, 5dac7ca0, 16fbdf57 …), of which 92 did database work (rev-read / writer / build-failed) — their connections are not in Σ; largest log gap 400 ms.
- After the last send (2026-10-12T22:01:17.979Z): Σ peak 0; first bucket at or below the baseline max 2026-10-12T22:01:20.000Z (+2 s) — an ESTIMATE (see the expiry caveat); the side-cars below are the corroboration.

| bucket (UTC) | Σ carried | Σ reported | instances (carried) | max waiting |
|---|---|---|---|---|
| 22:01:20 | 0 | 0 | 0 | 0 |
| 22:01:25 | 0 | 0 | 0 | 0 |
| 22:01:30 | 0 | 0 | 0 | 0 |
| 22:01:35 | 0 | 0 | 0 | 0 |
| 22:01:40 | 0 | 0 | 0 | 0 |
| 22:01:45 | 0 | 0 | 0 | 0 |
| 22:01:50 | 0 | 0 | 0 | 0 |
| 22:01:55 | 0 | 0 | 0 | 0 |
| 22:02:00 | 0 | 0 | 0 | 0 |
| 22:02:05 | 0 | 0 | 0 | 0 |
| 22:02:10 | 0 | 0 | 0 | 0 |
| 22:02:15 | 0 | 0 | 0 | 0 |

## Side-car — pooler-clients.mjs

- 68 sample(s) in the window; file spans 2026-10-12T21:54:22.067Z → 2026-10-12T22:02:36.083Z (covers the window ±5 s: yes); largest gap 10011 ms. Probe failures 37; EMAXCONN in probe / errors 1.

| period | samples | pooler used clients max | client active max | client waiting max | client max wait s max | backends max | backends active max | idle in tx max | probe ms max |
|---|---|---|---|---|---|---|---|---|---|
| baseline | 30 | 1 | 1 | 0 | 0 | 30 | 5 | 2 | 1097 |
| attack (spam start → last send) | 32 | 1 | 1 | 0 | 0 | 30 | 15 | 16 | 1921 |
| attack, first minute | 8 | 1 | 1 | 0 | 0 | 30 | 15 | 16 | 1921 |
| attack, last minute | 6 | 1 | 1 | 0 | 0 | 30 | 1 | 16 | — |
| recovery (after the last send) | 6 | 1 | 1 | 0 | 0 | 30 | 1 | 16 | — |
| whole window | 68 | 1 | 1 | 0 | 0 | 30 | 15 | 16 | 1921 |

After the last send, per 10 s:

| from (UTC) | samples | pooler used clients | client active | client waiting | client max wait s | backends | backends active | idle in tx | probe ms |
|---|---|---|---|---|---|---|---|---|---|
| 22:01:17 | 1 | 1 | 1 | 0 | 0 | 30 | 1 | 16 | — |
| 22:01:27 | 1 | 1 | 1 | 0 | 0 | 30 | 1 | 16 | — |
| 22:01:37 | 1 | 1 | 1 | 0 | 0 | 30 | 1 | 16 | — |
| 22:01:47 | 1 | 1 | 1 | 0 | 0 | 30 | 1 | 16 | — |
| 22:01:57 | 1 | 1 | 1 | 0 | 0 | 30 | 1 | 16 | — |
| 22:02:07 | 1 | 1 | 1 | 0 | 0 | 30 | 1 | 16 | — |
| 22:02:17 | 0 | — | — | — | — | — | — | — | — |

## Side-car — supavisor-backends.mjs

- 420 sample(s) in the window; file spans 2026-10-12T21:54:21.259Z → 2026-10-12T22:02:35.266Z (covers the window ±5 s: yes); largest gap 1015 ms.

| period | samples | backends max | active max | idle in tx max | max tx age ms max | max active ms max | lock waits max |
|---|---|---|---|---|---|---|---|
| baseline | 60 | 20 | 2 | 4 | 101 | 24 | 0 |
| attack (spam start → last send) | 299 | 20 | 13 | 16 | 296079 | 230 | 0 |
| attack, first minute | 60 | 20 | 13 | 16 | 57094 | 230 | 0 |
| attack, last minute | 60 | 20 | 0 | 16 | 296079 | 0 | 0 |
| recovery (after the last send) | 61 | 20 | 0 | 16 | 357079 | 0 | 0 |
| whole window | 420 | 20 | 13 | 16 | 357079 | 230 | 0 |

After the last send, per 10 s:

| from (UTC) | samples | backends | active | idle in tx | max tx age ms | max active ms | lock waits |
|---|---|---|---|---|---|---|---|
| 22:01:17 | 10 | 20 | 0 | 16 | 306079 | 0 | 0 |
| 22:01:27 | 10 | 20 | 0 | 16 | 316082 | 0 | 0 |
| 22:01:37 | 10 | 20 | 0 | 16 | 326082 | 0 | 0 |
| 22:01:47 | 10 | 20 | 0 | 16 | 336082 | 0 | 0 |
| 22:01:57 | 10 | 20 | 0 | 16 | 346078 | 0 | 0 |
| 22:02:07 | 10 | 20 | 0 | 16 | 356083 | 0 | 0 |
| 22:02:17 | 1 | 20 | 0 | 16 | 357079 | 0 | 0 |

Harness 503s in the 1 s buckets: 0; server 503 evidence: hinted `verify=error` 0, `build-failed` 32316, error-level records 33051.

