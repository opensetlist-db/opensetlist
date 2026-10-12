# Step 5 join — admission — step5-A4b

- Inputs: tests/load/results/2026-10-12/2026-10-12T07-23-27-467Z-browsers-admission.json, tests/load/results/2026-10-12/2026-10-12T07-21-12Z-vercel-logs-history-step5-A4b.txt
- Base https://opensetlist-appbunl4u-opensetlist-projects.vercel.app; T0 2026-10-12T07:22:05.887Z; window 2026-10-12T07:21:55.887Z → 2026-10-12T07:23:21.423Z
- Harness verdict: **VALID + FAIL** (SDK VALID + FAIL, page VALID + FAIL); outbound during the boundary wait: 0
- Clocks: harness = this host (save PUT start / response), server = the function's `at` (per instance), observer = the runner. Comparisons across clocks within the offset uncertainty are indeterminate; UTC does not synchronise them.

## Saves — exposure and the server's commit

| save | label | rev | PUT start (UTC) | PUT ms | server commit `at` | where | acquire ms | exec ms | SDK connected / not yet | pages in flight / future | stale first SDK / pages | convergence SDK before / after (p95 / missing) | pages before / after | broadcast received / pop. | observer received / n |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| a1 | SDK + page admission save | 1660 | 2026-10-12T07:22:08.901Z | 1568 | 2026-10-12T07:22:10.340Z | inside [PUT start, PUT response] | 498 | 154 | 156 / 242 | 5 / 25 | 0/210 / 0/25 | 3794 / 0 · 1945 / 0 | — / 0 · 1353 / 0 | 255 / 470 | — |
| a2 | after admission | 1661 | 2026-10-12T07:22:11.895Z | 2427 | 2026-10-12T07:22:14.191Z | inside [PUT start, PUT response] | 528 | 161 | 312 / 56 | 0 / 25 | 0/54 / 0/20 | 5676 / 0 · 2890 / 0 | 4147 / 0 · 818 / 0 | 414 / 470 | — |
| a3 | after admission | 1662 | 2026-10-12T07:22:25.891Z | 483 | 2026-10-12T07:22:26.241Z | inside [PUT start, PUT response] | 3 | 67 | 470 / 0 | 0 / 0 | 0/0 / 0/0 | 3293 / 0 · — / 0 | 2092 / 0 · — / 0 | 470 / 470 | — |
| a4 | after admission | 1663 | 2026-10-12T07:22:50.891Z | 532 | 2026-10-12T07:22:51.257Z | inside [PUT start, PUT response] | 3 | 105 | 470 / 0 | 0 / 0 | 0/0 / 0/0 | 2523 / 0 · — / 0 | 2178 / 0 · — / 0 | 470 / 470 | — |

Writer acquire max 528 ms (gate ≤ 500: **FAIL**); writer pre-execution failures 0.

## Admission window (server)

- Coverage: 4482 log entries in the window; log spans 2026-10-12T07:22:05.940Z → 2026-10-12T07:23:26.950Z (covers the window start: **no**, end: yes); largest gap between consecutive entries 990 ms.
- Errors: EMAXCONN 0 (gate 0: **PASS**); hint fetches answered 503 (`verify=error`) 0; build-failed 0; entries at level error 0. (Page / SDK 5xx are counted client-side in the harness gates.)
- **Σ (sum of per-instance Prisma pool totals)**: peak 190 (carried; reported 177) at 2026-10-12T07:22:10.000Z over 106 instance(s) — gate < 300: **PASS**.
  - Completeness: 16 bucket(s) of 5 s; 108 instance(s) logged pool lines; 0 instance(s) seen in the window WITHOUT any pool line; an instance is carried ≤ 5 s after its last line; each bucket holds per-instance MAXIMA (an upper bound within the bucket, not a simultaneous count); a gap in the capture (largest 990 ms) is time Σ cannot see. Σ is an app-side estimate, not the pooler's own client count.

| minute (UTC) | builds | warm-job builds | reader builds | building instances |
|---|---|---|---|---|
| 07:22 | 1354 | 12 | 1342 | 108 |
| 07:23 | 144 | 0 | 144 | 14 |

| instance (by first appearance) | first seen (UTC) | builds | warm-job builds |
|---|---|---|---|
| 3142b5df | 2026-10-12T07:22:05.940Z | 50 | 0 |
| cf975f3c | 2026-10-12T07:22:06.280Z | 3 | 0 |
| a405254d | 2026-10-12T07:22:06.290Z | 5 | 0 |
| 97ec2b12 | 2026-10-12T07:22:06.310Z | 52 | 0 |
| b9611a15 | 2026-10-12T07:22:06.310Z | 34 | 0 |
| 3886c548 | 2026-10-12T07:22:06.310Z | 12 | 0 |
| eef74f5b | 2026-10-12T07:22:06.310Z | 3 | 0 |
| 16833f77 | 2026-10-12T07:22:06.320Z | 5 | 0 |
| 2c97255a | 2026-10-12T07:22:06.330Z | 10 | 0 |
| 6bcd72c7 | 2026-10-12T07:22:06.330Z | 15 | 0 |
| 65ebce06 | 2026-10-12T07:22:06.330Z | 9 | 0 |
| 210ab186 | 2026-10-12T07:22:06.330Z | 7 | 0 |
| 06790f94 | 2026-10-12T07:22:06.350Z | 57 | 0 |
| d93f5984 | 2026-10-12T07:22:06.360Z | 4 | 0 |
| b8162e6f | 2026-10-12T07:22:06.370Z | 22 | 0 |
| f6fb8cb6 | 2026-10-12T07:22:06.370Z | 12 | 0 |
| a6df130b | 2026-10-12T07:22:06.370Z | 10 | 0 |
| 356de6a0 | 2026-10-12T07:22:06.400Z | 25 | 0 |
| a69bf341 | 2026-10-12T07:22:06.400Z | 12 | 0 |
| ff928026 | 2026-10-12T07:22:06.400Z | 9 | 0 |
| 986f4628 | 2026-10-12T07:22:06.400Z | 30 | 0 |
| 455bd63d | 2026-10-12T07:22:06.400Z | 12 | 0 |
| 237f1aa3 | 2026-10-12T07:22:06.400Z | 5 | 0 |
| 44737f1a | 2026-10-12T07:22:06.400Z | 1 | 0 |
| 3b8f46cb | 2026-10-12T07:22:06.400Z | 2 | 0 |
| cc6b3163 | 2026-10-12T07:22:06.410Z | 31 | 0 |
| d9cd2d78 | 2026-10-12T07:22:06.420Z | 9 | 0 |
| 8826f4d4 | 2026-10-12T07:22:06.440Z | 13 | 3 |
| 9fb1c1cd | 2026-10-12T07:22:06.440Z | 2 | 0 |
| 6f7764cf | 2026-10-12T07:22:06.450Z | 6 | 0 |
| e05fbd53 | 2026-10-12T07:22:06.450Z | 10 | 0 |
| d9257194 | 2026-10-12T07:22:06.450Z | 3 | 0 |
| 5d8e0eb5 | 2026-10-12T07:22:06.450Z | 7 | 0 |
| 92501d8f | 2026-10-12T07:22:06.450Z | 8 | 0 |
| 30a5eaa4 | 2026-10-12T07:22:06.450Z | 5 | 0 |
| 2d6c189f | 2026-10-12T07:22:06.450Z | 74 | 3 |
| 7cf4c14f | 2026-10-12T07:22:06.450Z | 10 | 0 |
| b57af941 | 2026-10-12T07:22:06.450Z | 35 | 0 |
| 364db588 | 2026-10-12T07:22:06.450Z | 33 | 0 |
| 9788ef1a | 2026-10-12T07:22:06.450Z | 34 | 0 |
| 3be93c3d | 2026-10-12T07:22:06.450Z | 3 | 0 |
| e5570e60 | 2026-10-12T07:22:06.450Z | 2 | 0 |
| 5c59dcc5 | 2026-10-12T07:22:06.450Z | 1 | 0 |
| b607297a | 2026-10-12T07:22:06.470Z | 9 | 0 |
| 77729d82 | 2026-10-12T07:22:06.470Z | 3 | 0 |
| d71f9969 | 2026-10-12T07:22:06.470Z | 5 | 0 |
| 697963d7 | 2026-10-12T07:22:06.470Z | 6 | 0 |
| 0d9bcb4d | 2026-10-12T07:22:07.280Z | 69 | 3 |
| 9b6398c6 | 2026-10-12T07:22:07.290Z | 6 | 0 |
| b0057297 | 2026-10-12T07:22:07.300Z | 36 | 0 |
| 6d48cd4e | 2026-10-12T07:22:07.300Z | 3 | 0 |
| c9bc297c | 2026-10-12T07:22:07.300Z | 4 | 0 |
| 14c98744 | 2026-10-12T07:22:07.320Z | 11 | 0 |
| 1f095b8b | 2026-10-12T07:22:07.320Z | 5 | 0 |
| 1253097a | 2026-10-12T07:22:07.320Z | 1 | 0 |
| 13c81f24 | 2026-10-12T07:22:07.330Z | 8 | 0 |
| c9356463 | 2026-10-12T07:22:07.330Z | 6 | 0 |
| 1dd37753 | 2026-10-12T07:22:07.330Z | 9 | 0 |
| 16f7b679 | 2026-10-12T07:22:07.330Z | 10 | 0 |
| 1827dc8d | 2026-10-12T07:22:07.330Z | 25 | 0 |
| 42b9713f | 2026-10-12T07:22:07.330Z | 58 | 0 |
| a6e20ea0 | 2026-10-12T07:22:07.340Z | 10 | 0 |
| 578c7946 | 2026-10-12T07:22:07.410Z | 47 | 0 |
| 7411b623 | 2026-10-12T07:22:07.410Z | 14 | 0 |
| 1e855714 | 2026-10-12T07:22:07.410Z | 14 | 0 |
| 0e1fccba | 2026-10-12T07:22:07.410Z | 9 | 0 |
| 848545cc | 2026-10-12T07:22:07.410Z | 7 | 0 |
| 3e685b05 | 2026-10-12T07:22:07.410Z | 3 | 0 |
| 6665be6b | 2026-10-12T07:22:07.410Z | 4 | 0 |
| e01bbe2d | 2026-10-12T07:22:07.410Z | 10 | 0 |
| 9bdeb7eb | 2026-10-12T07:22:07.410Z | 37 | 0 |
| 5fa76490 | 2026-10-12T07:22:07.410Z | 7 | 0 |
| c4688bed | 2026-10-12T07:22:07.410Z | 2 | 0 |
| ec3a52cd | 2026-10-12T07:22:07.420Z | 6 | 0 |
| ebb5a8a5 | 2026-10-12T07:22:07.420Z | 6 | 0 |
| bbd072e0 | 2026-10-12T07:22:07.420Z | 15 | 0 |
| bcc19f10 | 2026-10-12T07:22:07.420Z | 4 | 0 |
| b90d8d20 | 2026-10-12T07:22:11.110Z | 18 | 0 |
| c0437f78 | 2026-10-12T07:22:11.140Z | 4 | 0 |
| d38bea56 | 2026-10-12T07:22:11.240Z | 2 | 0 |
| da477c44 | 2026-10-12T07:22:11.280Z | 7 | 0 |
| 57e35277 | 2026-10-12T07:22:11.280Z | 2 | 0 |
| d1de70b6 | 2026-10-12T07:22:11.290Z | 39 | 3 |
| 9feac2f1 | 2026-10-12T07:22:11.290Z | 15 | 0 |
| 5d0fb5ed | 2026-10-12T07:22:11.290Z | 3 | 0 |
| b1c5b216 | 2026-10-12T07:22:11.290Z | 6 | 0 |
| b3e7b610 | 2026-10-12T07:22:11.310Z | 48 | 0 |
| 2cdf11b7 | 2026-10-12T07:22:11.340Z | 2 | 0 |
| 14095da0 | 2026-10-12T07:22:11.380Z | 2 | 0 |
| 09c00b7c | 2026-10-12T07:22:11.400Z | 3 | 0 |
| b5d3a793 | 2026-10-12T07:22:11.400Z | 4 | 0 |
| 7b67a5d2 | 2026-10-12T07:22:11.400Z | 3 | 0 |
| 853ee1c8 | 2026-10-12T07:22:11.400Z | 4 | 0 |
| 82b3688f | 2026-10-12T07:22:11.400Z | 3 | 0 |
| 0d6f57dc | 2026-10-12T07:22:11.410Z | 17 | 0 |
| fa1f334d | 2026-10-12T07:22:11.420Z | 6 | 0 |
| bca13c12 | 2026-10-12T07:22:11.480Z | 7 | 0 |
| 3f3e3c75 | 2026-10-12T07:22:11.500Z | 11 | 0 |
| 500e8884 | 2026-10-12T07:22:11.500Z | 3 | 0 |
| caa31cee | 2026-10-12T07:22:11.510Z | 25 | 0 |
| 04c0feca | 2026-10-12T07:22:11.510Z | 53 | 0 |
| 4bc6e83b | 2026-10-12T07:22:11.510Z | 5 | 0 |
| ad98cfd6 | 2026-10-12T07:22:11.510Z | 9 | 0 |
| 42d5a2b0 | 2026-10-12T07:22:11.520Z | 3 | 0 |
| f78e2ccd | 2026-10-12T07:22:11.520Z | 27 | 0 |
| 8e2986f1 | 2026-10-12T07:22:11.520Z | 2 | 0 |
| f82cab2c | 2026-10-12T07:22:18.780Z | 2 | 0 |
| 002eb5a5 | 2026-10-12T07:22:18.780Z | 2 | 0 |

Warm lookups (whole log): {"hit":0,"miss":969,"stale":0,"invalid":0,"error":0,"timeout":0,"memo-miss":1492,"capped":0,"other":0}; warm jobs started in the window: 4.

## A4 fault evidence (`getnull`)

- `[liveWarm] fault armed mode=getnull` lines: 91; other armed modes: 0; `fault-invalid`: 0; `fault-blocked`: 0
- warm lookups 2461 (tagged `fault=getnull`: 2461); results {"miss":969,"memo-miss":1492}; **warm hits 0** (must be 0)
- Evidence complete: **yes**

