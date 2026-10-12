# Step 5 join — admission — step5-A2

- Inputs: tests/load/results/2026-10-12/2026-10-12T07-05-32-221Z-browsers-admission.json, tests/load/results/2026-10-12/2026-10-12T06-57-59Z-vercel-logs-history-step5-A2.txt
- Base https://opensetlist-git-dev-opensetlist-projects.vercel.app; T0 2026-10-12T07:00:23.696Z; window 2026-10-12T07:00:13.696Z → 2026-10-12T07:05:55.713Z
- Harness verdict: **VALID + FAIL** (SDK VALID + FAIL, page VALID + FAIL); outbound during the boundary wait: 0
- Clocks: harness = this host (save PUT start / response), server = the function's `at` (per instance), observer = the runner. Comparisons across clocks within the offset uncertainty are indeterminate; UTC does not synchronise them.

## Saves — exposure and the server's commit

| save | label | rev | PUT start (UTC) | PUT ms | server commit `at` | where | acquire ms | exec ms | SDK connected / not yet | pages in flight / future | stale first SDK / pages | convergence SDK before / after (p95 / missing) | pages before / after | broadcast received / pop. | observer received / n |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| a1 | SDK + page admission save | 1622 | 2026-10-12T07:00:26.712Z | 2087 | 2026-10-12T07:00:28.656Z | inside [PUT start, PUT response] | 310 | 147 | 156 / 231 | 5 / 25 | 0/210 / 0/25 | 4707 / 0 · 2270 / 0 | — / 0 · 567 / 0 | 0 / 490 | — |
| a2 | SDK admission save | 1623 | 2026-10-12T07:00:29.696Z | 529 | 2026-10-12T07:00:30.062Z | inside [PUT start, PUT response] | 9 | 136 | 312 / 178 | 2 / 25 | 0/106 / 0/22 | 1748 / 0 · 1158 / 0 | 1006 / 0 · 880 / 0 | 312 / 490 | — |
| a3 | after admission | 1624 | 2026-10-12T07:00:43.696Z | 420 | 2026-10-12T07:00:43.970Z | inside [PUT start, PUT response] | 3 | 57 | 470 / 20 | 0 / 0 | 0/0 / 0/0 | 2428 / 0 · 271 / 0 | 1245 / 0 · — / 0 | 470 / 490 | — |
| a4 | after admission | 1625 | 2026-10-12T07:01:08.697Z | 606 | 2026-10-12T07:01:09.118Z | inside [PUT start, PUT response] | 5 | 188 | 470 / 20 | 0 / 0 | 0/0 / 0/0 | 1825 / 0 · 271 / 0 | 1529 / 0 · — / 0 | 470 / 490 | — |
| 1 | after admission | 1627 | 2026-10-12T07:01:12.738Z | 521 | 2026-10-12T07:01:13.096Z | inside [PUT start, PUT response] | 16 | 85 | 470 / 20 | 0 / 0 | 0/0 / 0/0 | 2052 / 0 · 271 / 0 | 1738 / 0 · — / 0 | 470 / 490 | — |
| 2 | after admission | 1628 | 2026-10-12T07:01:37.791Z | 493 | 2026-10-12T07:01:38.144Z | inside [PUT start, PUT response] | 4 | 92 | 470 / 20 | 0 / 0 | 0/0 / 0/0 | 3233 / 0 · 271 / 0 | 1377 / 0 · — / 0 | 470 / 490 | — |
| 3 | after admission | 1630 | 2026-10-12T07:02:03.045Z | 1001 | 2026-10-12T07:02:03.495Z | inside [PUT start, PUT response] | 3 | 71 | 470 / 20 | 0 / 0 | 0/0 / 0/0 | 2153 / 0 · 271 / 0 | 1672 / 0 · — / 0 | 470 / 490 | — |
| 4 | after admission | 1631 | 2026-10-12T07:02:27.785Z | 504 | 2026-10-12T07:02:28.150Z | inside [PUT start, PUT response] | 4 | 102 | 470 / 20 | 0 / 0 | 0/0 / 0/0 | 1767 / 0 · 271 / 0 | 1362 / 0 · — / 0 | 470 / 490 | — |
| 5 | after admission | 1633 | 2026-10-12T07:02:52.876Z | 858 | 2026-10-12T07:02:53.519Z | inside [PUT start, PUT response] | 16 | 88 | 470 / 20 | 0 / 0 | 0/0 / 0/0 | 1838 / 0 · 271 / 0 | 1918 / 0 · — / 0 | 470 / 490 | — |
| 6 | after admission | 1634 | 2026-10-12T07:03:17.789Z | 453 | 2026-10-12T07:03:18.098Z | inside [PUT start, PUT response] | 4 | 73 | 470 / 20 | 0 / 0 | 0/0 / 0/0 | 1788 / 0 · 271 / 0 | 1289 / 0 · — / 0 | 470 / 490 | — |
| 7 | after admission | 1636 | 2026-10-12T07:03:42.613Z | 577 | 2026-10-12T07:03:43.034Z | inside [PUT start, PUT response] | 3 | 178 | 470 / 20 | 0 / 0 | 0/0 / 0/0 | 2091 / 0 · 271 / 0 | 2036 / 0 · — / 0 | 470 / 490 | — |
| 8 | after admission | 1637 | 2026-10-12T07:04:07.824Z | 634 | 2026-10-12T07:04:08.303Z | inside [PUT start, PUT response] | 2 | 210 | 470 / 20 | 0 / 0 | 0/0 / 0/0 | 1829 / 0 · 271 / 0 | 1400 / 0 · — / 0 | 470 / 490 | — |
| f1 | I3 final phase (after admission) | 1638 | 2026-10-12T07:04:45.292Z | 410 | 2026-10-12T07:04:45.554Z | inside [PUT start, PUT response] | 3 | 36 | 40 / 0 | 0 / 0 | 0/0 / 0/0 | 1147 / 0 · — / 0 | — | 40 / 40 | — |
| f2 | I3 final phase (after admission) | 1639 | 2026-10-12T07:05:25.303Z | 410 | 2026-10-12T07:05:25.569Z | inside [PUT start, PUT response] | 2 | 32 | 40 / 0 | 0 / 0 | 0/0 / 0/0 | 1206 / 0 · — / 0 | — | 40 / 40 | — |

Writer acquire max 310 ms (gate ≤ 500: **PASS**); writer pre-execution failures 0.

## Admission window (server)

- Coverage: 15135 log entries in the window; log spans 2026-10-12T07:00:23.980Z → 2026-10-12T07:05:36.830Z (covers the window start: **no**, end: **no**); largest gap between consecutive entries 5050 ms.
- Errors: EMAXCONN 0 (gate 0: **PASS**); hint fetches answered 503 (`verify=error`) 0; build-failed 0; entries at level error 0. (Page / SDK 5xx are counted client-side in the harness gates.)
- **Σ (sum of per-instance Prisma pool totals)**: peak 158 (carried; reported 130) at 2026-10-12T07:00:30.000Z over 90 instance(s) — gate < 300: **PASS**.
  - Completeness: 64 bucket(s) of 5 s; 95 instance(s) logged pool lines; 0 instance(s) seen in the window WITHOUT any pool line; an instance is carried ≤ 5 s after its last line; each bucket holds per-instance MAXIMA (an upper bound within the bucket, not a simultaneous count); a gap in the capture (largest 5050 ms) is time Σ cannot see. Σ is an app-side estimate, not the pooler's own client count.

| minute (UTC) | builds | warm-job builds | reader builds | building instances |
|---|---|---|---|---|
| 07:00 | 687 | 9 | 678 | 95 |
| 07:01 | 561 | 12 | 549 | 34 |
| 07:02 | 574 | 15 | 559 | 48 |
| 07:03 | 658 | 9 | 649 | 33 |
| 07:04 | 353 | 6 | 347 | 16 |
| 07:05 | 57 | 24 | 33 | 4 |

| instance (by first appearance) | first seen (UTC) | builds | warm-job builds |
|---|---|---|---|
| f86ef0c0 | 2026-10-12T07:00:23.980Z | 4 | 0 |
| 87880f22 | 2026-10-12T07:00:23.980Z | 4 | 0 |
| 86296099 | 2026-10-12T07:00:24.020Z | 3 | 0 |
| 035d6fb7 | 2026-10-12T07:00:24.080Z | 9 | 0 |
| ff508192 | 2026-10-12T07:00:24.090Z | 50 | 0 |
| 7925c67a | 2026-10-12T07:00:24.100Z | 26 | 0 |
| e535a9a1 | 2026-10-12T07:00:24.110Z | 8 | 0 |
| 916fa282 | 2026-10-12T07:00:24.140Z | 22 | 0 |
| aafed31b | 2026-10-12T07:00:24.140Z | 1 | 0 |
| 17f8c8c1 | 2026-10-12T07:00:24.150Z | 16 | 0 |
| 5a8ce2a6 | 2026-10-12T07:00:24.150Z | 4 | 0 |
| 6d2c279a | 2026-10-12T07:00:24.150Z | 4 | 0 |
| f240f55f | 2026-10-12T07:00:24.160Z | 158 | 3 |
| dc4c78e0 | 2026-10-12T07:00:24.160Z | 5 | 0 |
| 389a7701 | 2026-10-12T07:00:24.160Z | 83 | 6 |
| 0a64c241 | 2026-10-12T07:00:24.160Z | 17 | 0 |
| cd7ecca4 | 2026-10-12T07:00:24.160Z | 18 | 0 |
| 7df33d2d | 2026-10-12T07:00:24.160Z | 5 | 0 |
| 47fa11c0 | 2026-10-12T07:00:24.160Z | 6 | 0 |
| 63fc7fd4 | 2026-10-12T07:00:24.160Z | 12 | 3 |
| 4fc5076e | 2026-10-12T07:00:24.160Z | 3 | 0 |
| 78f6cb94 | 2026-10-12T07:00:24.160Z | 2 | 0 |
| c83d616a | 2026-10-12T07:00:24.170Z | 2 | 0 |
| 29fa8888 | 2026-10-12T07:00:24.190Z | 86 | 0 |
| 76c6d90c | 2026-10-12T07:00:24.190Z | 130 | 0 |
| 72ef8919 | 2026-10-12T07:00:24.190Z | 29 | 0 |
| 4a7fec64 | 2026-10-12T07:00:24.200Z | 15 | 0 |
| e926a760 | 2026-10-12T07:00:24.200Z | 37 | 0 |
| 624cfb39 | 2026-10-12T07:00:24.210Z | 40 | 3 |
| 263e0a0c | 2026-10-12T07:00:24.210Z | 61 | 0 |
| 5f701af8 | 2026-10-12T07:00:24.210Z | 5 | 0 |
| 1b8375ac | 2026-10-12T07:00:24.220Z | 67 | 0 |
| 868762fc | 2026-10-12T07:00:24.220Z | 89 | 3 |
| 2d4be023 | 2026-10-12T07:00:24.220Z | 23 | 0 |
| 773f23d3 | 2026-10-12T07:00:24.220Z | 7 | 0 |
| 74966edd | 2026-10-12T07:00:24.220Z | 3 | 0 |
| bd2fd6cd | 2026-10-12T07:00:24.230Z | 85 | 3 |
| 02bef709 | 2026-10-12T07:00:24.230Z | 71 | 3 |
| ef23c483 | 2026-10-12T07:00:24.230Z | 239 | 3 |
| 20518ff5 | 2026-10-12T07:00:24.230Z | 41 | 0 |
| 4e2394e7 | 2026-10-12T07:00:24.230Z | 3 | 0 |
| 80e28222 | 2026-10-12T07:00:25.000Z | 59 | 0 |
| 1b825eeb | 2026-10-12T07:00:25.000Z | 29 | 3 |
| 1b56ff48 | 2026-10-12T07:00:25.000Z | 6 | 0 |
| 4823ef1c | 2026-10-12T07:00:25.000Z | 30 | 0 |
| c3d3e4ae | 2026-10-12T07:00:25.010Z | 9 | 0 |
| a3eb3ad6 | 2026-10-12T07:00:25.010Z | 7 | 0 |
| 4f55374a | 2026-10-12T07:00:25.010Z | 2 | 0 |
| 7eb561d2 | 2026-10-12T07:00:25.020Z | 7 | 0 |
| 0533c860 | 2026-10-12T07:00:25.020Z | 1 | 0 |
| 44cdbc9c | 2026-10-12T07:00:25.110Z | 2 | 0 |
| c162f3f9 | 2026-10-12T07:00:25.120Z | 101 | 3 |
| 8ca3a710 | 2026-10-12T07:00:25.120Z | 29 | 3 |
| c2d74f40 | 2026-10-12T07:00:25.120Z | 2 | 0 |
| b81d7e5a | 2026-10-12T07:00:25.140Z | 114 | 6 |
| 4c5d290e | 2026-10-12T07:00:25.140Z | 39 | 0 |
| 5f9a4c1c | 2026-10-12T07:00:25.140Z | 36 | 0 |
| c78c9584 | 2026-10-12T07:00:25.140Z | 4 | 0 |
| 36c557d1 | 2026-10-12T07:00:25.140Z | 1 | 0 |
| ad76cb80 | 2026-10-12T07:00:25.150Z | 146 | 15 |
| fe969f60 | 2026-10-12T07:00:25.150Z | 7 | 0 |
| 5c62019e | 2026-10-12T07:00:25.150Z | 13 | 0 |
| a2419d0f | 2026-10-12T07:00:25.150Z | 2 | 0 |
| 7288b714 | 2026-10-12T07:00:25.150Z | 5 | 0 |
| 175d6f6e | 2026-10-12T07:00:25.150Z | 2 | 0 |
| 417fc399 | 2026-10-12T07:00:25.150Z | 2 | 0 |
| a4625a69 | 2026-10-12T07:00:25.150Z | 1 | 0 |
| c0439e39 | 2026-10-12T07:00:25.150Z | 1 | 0 |
| b49d622c | 2026-10-12T07:00:30.620Z | 24 | 0 |
| 72ba7bb8 | 2026-10-12T07:00:30.650Z | 55 | 0 |
| ff428823 | 2026-10-12T07:00:30.650Z | 18 | 0 |
| c9bee868 | 2026-10-12T07:00:30.650Z | 22 | 0 |
| cdccb5c7 | 2026-10-12T07:00:30.650Z | 42 | 6 |
| e5450b11 | 2026-10-12T07:00:30.670Z | 5 | 0 |
| d1a73990 | 2026-10-12T07:00:30.670Z | 2 | 0 |
| b590c251 | 2026-10-12T07:00:30.670Z | 8 | 0 |
| 53f0e606 | 2026-10-12T07:00:30.670Z | 2 | 0 |
| 5dc1c7df | 2026-10-12T07:00:30.700Z | 26 | 0 |
| caf7b7c0 | 2026-10-12T07:00:30.720Z | 11 | 0 |
| f6882d2d | 2026-10-12T07:00:30.720Z | 20 | 0 |
| 07ec23dc | 2026-10-12T07:00:30.730Z | 92 | 3 |
| 730b02d6 | 2026-10-12T07:00:30.850Z | 7 | 0 |
| e42046ee | 2026-10-12T07:00:30.890Z | 19 | 0 |
| f1d37476 | 2026-10-12T07:00:31.090Z | 131 | 0 |
| 7d703290 | 2026-10-12T07:00:31.100Z | 7 | 0 |
| dd37786d | 2026-10-12T07:00:31.100Z | 4 | 0 |
| c9e81641 | 2026-10-12T07:00:31.100Z | 7 | 0 |
| e66ca581 | 2026-10-12T07:00:31.110Z | 32 | 3 |
| 1ee73fc1 | 2026-10-12T07:00:31.110Z | 3 | 0 |
| ea0d7911 | 2026-10-12T07:00:31.110Z | 5 | 0 |
| 4977bc67 | 2026-10-12T07:00:31.120Z | 162 | 3 |
| ee3495b2 | 2026-10-12T07:00:31.140Z | 32 | 3 |
| ac63557d | 2026-10-12T07:00:35.750Z | 1 | 0 |
| f1f2e912 | 2026-10-12T07:00:37.540Z | 2 | 0 |
| de237bcd | 2026-10-12T07:00:37.560Z | 1 | 0 |

Warm lookups (whole log): {"hit":7250,"miss":30,"stale":0,"invalid":0,"error":0,"timeout":0,"memo-miss":26,"capped":0,"other":0}; warm jobs started in the window: 25.

## I-cycles (eligibility + arrivals, harness cohorts and the observer)

### I3 — fresh cohort, first save 6 s after join — save f1 rev 1638: harness **PASS**

- Harness: eligible 20/20 (spread 0.0 s); eligible clients received the broadcast 20/20, applied 20/20 by {"notification":20}; repair max — ms (healthy periodic repair 20 s ± 4 s — measured, not a bound)

### I3 — +40 s save — save f2 rev 1639: harness **PASS**

- Harness: eligible 20/20 (spread 0.0 s); eligible clients received the broadcast 20/20, applied 20/20 by {"notification":20}; repair max — ms (healthy periodic repair 20 s ± 4 s — measured, not a bound)

