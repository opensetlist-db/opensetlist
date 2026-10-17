# Step 5 join — admission — step5-A0b

- Inputs: tests/load/results/2026-10-12/2026-10-12T06-46-00-730Z-browsers-admission.json, tests/load/results/2026-10-12/2026-10-12T06-42-16Z-vercel-logs-history-step5-A0b.txt
- Base https://opensetlist-git-dev-opensetlist-projects.vercel.app; T0 2026-10-12T06:44:40.803Z; window 2026-10-12T06:44:30.803Z → 2026-10-12T06:45:56.282Z
- Harness verdict: **VALID + FAIL** (SDK VALID + FAIL, page VALID + FAIL); outbound during the boundary wait: 0
- Clocks: harness = this host (save PUT start / response), server = the function's `at` (per instance), observer = the runner. Comparisons across clocks within the offset uncertainty are indeterminate; UTC does not synchronise them.

## Saves — exposure and the server's commit

| save | label | rev | PUT start (UTC) | PUT ms | server commit `at` | where | acquire ms | exec ms | SDK connected / not yet | pages in flight / future | stale first SDK / pages | convergence SDK before / after (p95 / missing) | pages before / after | broadcast received / pop. | observer received / n |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| a1 | SDK + page admission save | 1609 | 2026-10-12T06:44:43.804Z | 541 | 2026-10-12T06:44:44.187Z | inside [PUT start, PUT response] | 3 | 124 | 156 / 269 | 5 / 25 | 0/262 / 0/25 | 1291 / 0 · 533 / 0 | — / 0 · 108 / 0 | 207 / 470 | — |
| a2 | SDK admission save | 1610 | 2026-10-12T06:44:46.807Z | 427 | 2026-10-12T06:44:47.079Z | inside [PUT start, PUT response] | 3 | 80 | 312 / 158 | 4 / 20 | 0/145 / 0/20 | 1169 / 0 · 228 / 0 | 1064 / 0 · 254 / 0 | 312 / 470 | — |
| a3 | after admission | 1611 | 2026-10-12T06:45:00.812Z | 385 | 2026-10-12T06:45:01.042Z | inside [PUT start, PUT response] | 2 | 37 | 470 / 0 | 0 / 0 | 0/0 / 0/0 | 1491 / 0 · — / 0 | 1100 / 0 · — / 0 | 470 / 470 | — |
| a4 | after admission | 1612 | 2026-10-12T06:45:25.814Z | 467 | 2026-10-12T06:45:26.119Z | inside [PUT start, PUT response] | 4 | 91 | 470 / 0 | 0 / 0 | 0/0 / 0/0 | 1485 / 0 · — / 0 | 1194 / 0 · — / 0 | 470 / 470 | — |

Writer acquire max 4 ms (gate ≤ 500: **PASS**); writer pre-execution failures 0.

## Admission window (server)

- Coverage: 4449 log entries in the window; log spans 2026-10-12T06:44:41.050Z → 2026-10-12T06:45:59.940Z (covers the window start: **no**, end: yes); largest gap between consecutive entries 970 ms.
- Errors: EMAXCONN 0 (gate 0: **PASS**); hint fetches answered 503 (`verify=error`) 0; build-failed 0; entries at level error 0. (Page / SDK 5xx are counted client-side in the harness gates.)
- **Σ (sum of per-instance Prisma pool totals)**: peak 165 (carried; reported 152) at 2026-10-12T06:44:45.000Z over 93 instance(s) — gate < 300: **PASS**.
  - Completeness: 16 bucket(s) of 5 s; 94 instance(s) logged pool lines; 0 instance(s) seen in the window WITHOUT any pool line; an instance is carried ≤ 5 s after its last line; each bucket holds per-instance MAXIMA (an upper bound within the bucket, not a simultaneous count); a gap in the capture (largest 970 ms) is time Σ cannot see. Σ is an app-side estimate, not the pooler's own client count.

| minute (UTC) | builds | warm-job builds | reader builds | building instances |
|---|---|---|---|---|
| 06:44 | 657 | 6 | 651 | 94 |
| 06:45 | 542 | 6 | 536 | 26 |

| instance (by first appearance) | first seen (UTC) | builds | warm-job builds |
|---|---|---|---|
| 95c53114 | 2026-10-12T06:44:41.050Z | 5 | 0 |
| 252f13c5 | 2026-10-12T06:44:41.050Z | 33 | 0 |
| 3817b89f | 2026-10-12T06:44:41.050Z | 13 | 0 |
| 1102b08b | 2026-10-12T06:44:41.060Z | 29 | 0 |
| e74f4dc6 | 2026-10-12T06:44:41.060Z | 14 | 0 |
| 703c0932 | 2026-10-12T06:44:41.100Z | 2 | 0 |
| 586c9f46 | 2026-10-12T06:44:41.130Z | 19 | 0 |
| 2b3c15f6 | 2026-10-12T06:44:41.180Z | 12 | 0 |
| fa6047eb | 2026-10-12T06:44:41.180Z | 11 | 0 |
| d2d399b7 | 2026-10-12T06:44:41.220Z | 13 | 0 |
| 58e983bf | 2026-10-12T06:44:41.220Z | 8 | 0 |
| ddf25aac | 2026-10-12T06:44:41.220Z | 8 | 0 |
| 0da4c0bd | 2026-10-12T06:44:41.240Z | 14 | 0 |
| a0aeb019 | 2026-10-12T06:44:41.240Z | 18 | 3 |
| 750ed115 | 2026-10-12T06:44:41.240Z | 44 | 0 |
| 92895de9 | 2026-10-12T06:44:41.240Z | 3 | 0 |
| a936a8ce | 2026-10-12T06:44:41.240Z | 10 | 0 |
| 710c6eca | 2026-10-12T06:44:41.240Z | 4 | 0 |
| 9c232ee4 | 2026-10-12T06:44:41.250Z | 18 | 0 |
| cfb83629 | 2026-10-12T06:44:41.250Z | 31 | 0 |
| cdd75e15 | 2026-10-12T06:44:41.250Z | 14 | 0 |
| f7106395 | 2026-10-12T06:44:41.250Z | 18 | 0 |
| 041ad8cf | 2026-10-12T06:44:41.250Z | 17 | 0 |
| c40b0e01 | 2026-10-12T06:44:41.250Z | 7 | 0 |
| b573ed04 | 2026-10-12T06:44:41.250Z | 8 | 0 |
| 50e51076 | 2026-10-12T06:44:41.250Z | 9 | 0 |
| 72135466 | 2026-10-12T06:44:41.250Z | 5 | 0 |
| e3fb5356 | 2026-10-12T06:44:41.250Z | 4 | 0 |
| 26423c61 | 2026-10-12T06:44:41.250Z | 5 | 0 |
| 0c6b8886 | 2026-10-12T06:44:41.250Z | 7 | 0 |
| 7c44f26c | 2026-10-12T06:44:41.250Z | 2 | 0 |
| f56a1d57 | 2026-10-12T06:44:41.280Z | 5 | 0 |
| 5ed2882d | 2026-10-12T06:44:41.280Z | 4 | 0 |
| 3c8608ae | 2026-10-12T06:44:41.280Z | 2 | 0 |
| 34b80d94 | 2026-10-12T06:44:41.280Z | 2 | 0 |
| 51d24c73 | 2026-10-12T06:44:41.280Z | 2 | 0 |
| f4eaf420 | 2026-10-12T06:44:42.070Z | 17 | 0 |
| c014f9be | 2026-10-12T06:44:42.070Z | 85 | 0 |
| 768f255a | 2026-10-12T06:44:42.070Z | 5 | 0 |
| a72e6d52 | 2026-10-12T06:44:42.070Z | 93 | 0 |
| e0ba3107 | 2026-10-12T06:44:42.070Z | 6 | 0 |
| 37bbe87c | 2026-10-12T06:44:42.070Z | 8 | 0 |
| dfcc5387 | 2026-10-12T06:44:42.070Z | 3 | 0 |
| 0ed852d8 | 2026-10-12T06:44:42.170Z | 5 | 0 |
| 431b2fe9 | 2026-10-12T06:44:42.200Z | 8 | 0 |
| 09b60d12 | 2026-10-12T06:44:42.200Z | 11 | 0 |
| ef682ef4 | 2026-10-12T06:44:42.200Z | 10 | 0 |
| 79072a45 | 2026-10-12T06:44:42.200Z | 8 | 0 |
| e685ee19 | 2026-10-12T06:44:42.200Z | 3 | 0 |
| 2d74a972 | 2026-10-12T06:44:42.210Z | 88 | 0 |
| 2f061674 | 2026-10-12T06:44:42.210Z | 18 | 0 |
| c2ae1c3a | 2026-10-12T06:44:42.220Z | 25 | 0 |
| 059cec8f | 2026-10-12T06:44:42.220Z | 65 | 6 |
| b4af722b | 2026-10-12T06:44:42.220Z | 12 | 0 |
| ac87bfbc | 2026-10-12T06:44:42.220Z | 66 | 3 |
| 4670ab23 | 2026-10-12T06:44:42.220Z | 6 | 0 |
| 3249ce23 | 2026-10-12T06:44:42.220Z | 11 | 0 |
| 78c894f8 | 2026-10-12T06:44:42.220Z | 9 | 0 |
| 102d85ce | 2026-10-12T06:44:42.220Z | 3 | 0 |
| 0ec0766d | 2026-10-12T06:44:42.220Z | 3 | 0 |
| 34353b28 | 2026-10-12T06:44:42.220Z | 3 | 0 |
| a4594fb1 | 2026-10-12T06:44:42.220Z | 4 | 0 |
| c0aacd48 | 2026-10-12T06:44:42.220Z | 1 | 0 |
| 277e78c5 | 2026-10-12T06:44:42.220Z | 1 | 0 |
| a140e250 | 2026-10-12T06:44:42.230Z | 67 | 0 |
| c9893024 | 2026-10-12T06:44:42.230Z | 8 | 0 |
| 306cea28 | 2026-10-12T06:44:42.570Z | 4 | 0 |
| aec79cd9 | 2026-10-12T06:44:42.600Z | 10 | 0 |
| d9f4d591 | 2026-10-12T06:44:45.120Z | 6 | 0 |
| cf4d2d2e | 2026-10-12T06:44:45.130Z | 7 | 0 |
| a8067228 | 2026-10-12T06:44:45.140Z | 13 | 0 |
| 78735c9a | 2026-10-12T06:44:45.140Z | 3 | 0 |
| b9d37e82 | 2026-10-12T06:44:45.350Z | 1 | 0 |
| e5115907 | 2026-10-12T06:44:45.380Z | 3 | 0 |
| a1ba72ea | 2026-10-12T06:44:45.380Z | 12 | 0 |
| ed02a4a3 | 2026-10-12T06:44:45.380Z | 4 | 0 |
| 5514c8f5 | 2026-10-12T06:44:45.400Z | 3 | 0 |
| 142f3e06 | 2026-10-12T06:44:45.430Z | 2 | 0 |
| eed1694f | 2026-10-12T06:44:45.440Z | 13 | 0 |
| f61740d4 | 2026-10-12T06:44:45.440Z | 2 | 0 |
| 5aca3642 | 2026-10-12T06:44:45.440Z | 1 | 0 |
| b0331cd8 | 2026-10-12T06:44:45.450Z | 11 | 0 |
| 8c4c1c37 | 2026-10-12T06:44:45.460Z | 1 | 0 |
| ae1f6251 | 2026-10-12T06:44:45.460Z | 1 | 0 |
| 3c2634c8 | 2026-10-12T06:44:45.510Z | 5 | 0 |
| f025d364 | 2026-10-12T06:44:45.520Z | 3 | 0 |
| adedd48d | 2026-10-12T06:44:45.520Z | 1 | 0 |
| f6650b23 | 2026-10-12T06:44:45.530Z | 4 | 0 |
| f0046cdc | 2026-10-12T06:44:45.540Z | 7 | 0 |
| 0e03a889 | 2026-10-12T06:44:47.500Z | 1 | 0 |
| 17060506 | 2026-10-12T06:44:49.280Z | 2 | 0 |
| f8ccda75 | 2026-10-12T06:44:49.330Z | 3 | 0 |
| aa304791 | 2026-10-12T06:44:49.350Z | 3 | 0 |
| 02dedddf | 2026-10-12T06:44:52.740Z | 1 | 0 |

Warm lookups (whole log): {"hit":2371,"miss":18,"stale":0,"invalid":0,"error":0,"timeout":0,"memo-miss":16,"capped":0,"other":0}; warm jobs started in the window: 4.

