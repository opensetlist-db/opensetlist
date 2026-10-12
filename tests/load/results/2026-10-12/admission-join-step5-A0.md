# Step 5 join — admission — step5-A0

- Inputs: tests/load/results/2026-10-12/2026-10-12T06-39-24-528Z-browsers-admission.json, tests/load/results/2026-10-12/2026-10-12T06-35-41Z-vercel-logs-history-step5-A0.txt
- Base https://opensetlist-git-dev-opensetlist-projects.vercel.app; T0 2026-10-12T06:38:04.746Z; window 2026-10-12T06:37:54.746Z → 2026-10-12T06:39:20.204Z
- Harness verdict: **VALID + FAIL** (SDK VALID + FAIL, page NOT EXERCISED); outbound during the boundary wait: 0
- Clocks: harness = this host (save PUT start / response), server = the function's `at` (per instance), observer = the runner. Comparisons across clocks within the offset uncertainty are indeterminate; UTC does not synchronise them.

## Saves — exposure and the server's commit

| save | label | rev | PUT start (UTC) | PUT ms | server commit `at` | where | acquire ms | exec ms | SDK connected / not yet | pages in flight / future | stale first SDK / pages | convergence SDK before / after (p95 / missing) | pages before / after | broadcast received / pop. | observer received / n |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| a1 | SDK admission save | 1603 | 2026-10-12T06:38:09.748Z | 552 | 2026-10-12T06:38:10.081Z | inside [PUT start, PUT response] | 5 | 103 | 258 / 212 | 0 / 25 | 0/158 / 0/20 | 16518 / 0 · 340 / 0 | 15824 / 0 · 15198 / 0 | 0 / 470 | — |
| a2 | after admission | 1604 | 2026-10-12T06:38:24.762Z | 442 | 2026-10-12T06:38:25.037Z | inside [PUT start, PUT response] | 3 | 70 | 470 / 0 | 0 / 0 | 0/0 / 0/0 | 1546 / 0 · — / 0 | 1124 / 0 · — / 0 | 470 / 470 | — |
| a3 | after admission | 1605 | 2026-10-12T06:38:49.762Z | 442 | 2026-10-12T06:38:50.038Z | inside [PUT start, PUT response] | 2 | 79 | 470 / 0 | 0 / 0 | 0/0 / 0/0 | 1405 / 0 · — / 0 | 1138 / 0 · — / 0 | 470 / 470 | — |

Writer acquire max 5 ms (gate ≤ 500: **PASS**); writer pre-execution failures 0.

## Admission window (server)

- Coverage: 3986 log entries in the window; log spans 2026-10-12T06:38:05.080Z → 2026-10-12T06:39:23.730Z (covers the window start: **no**, end: yes); largest gap between consecutive entries 2170 ms.
- Errors: EMAXCONN 0 (gate 0: **PASS**); hint fetches answered 503 (`verify=error`) 0; build-failed 0; entries at level error 0. (Page / SDK 5xx are counted client-side in the harness gates.)
- **Σ (sum of per-instance Prisma pool totals)**: peak 169 (carried; reported 113) at 2026-10-12T06:38:10.000Z over 104 instance(s) — gate < 300: **PASS**.
  - Completeness: 16 bucket(s) of 5 s; 104 instance(s) logged pool lines; 0 instance(s) seen in the window WITHOUT any pool line; an instance is carried ≤ 5 s after its last line; each bucket holds per-instance MAXIMA (an upper bound within the bucket, not a simultaneous count); a gap in the capture (largest 2170 ms) is time Σ cannot see. Σ is an app-side estimate, not the pooler's own client count.

| minute (UTC) | builds | warm-job builds | reader builds | building instances |
|---|---|---|---|---|
| 06:38 | 823 | 9 | 814 | 104 |
| 06:39 | 145 | 0 | 145 | 5 |

| instance (by first appearance) | first seen (UTC) | builds | warm-job builds |
|---|---|---|---|
| cc6fec02 | 2026-10-12T06:38:05.080Z | 8 | 0 |
| cf79a444 | 2026-10-12T06:38:05.080Z | 4 | 0 |
| a2ca1ce7 | 2026-10-12T06:38:05.080Z | 6 | 0 |
| 50853a97 | 2026-10-12T06:38:05.080Z | 1 | 0 |
| cbf3b06b | 2026-10-12T06:38:05.080Z | 1 | 0 |
| c53509bc | 2026-10-12T06:38:05.090Z | 3 | 0 |
| 50ba6dd8 | 2026-10-12T06:38:05.090Z | 2 | 0 |
| 5b1aba7e | 2026-10-12T06:38:05.110Z | 2 | 0 |
| f4c91beb | 2026-10-12T06:38:05.110Z | 1 | 0 |
| aaed03bb | 2026-10-12T06:38:05.120Z | 23 | 0 |
| d41b31c7 | 2026-10-12T06:38:05.120Z | 11 | 0 |
| db96b0a1 | 2026-10-12T06:38:05.120Z | 14 | 0 |
| 298295d9 | 2026-10-12T06:38:05.120Z | 7 | 0 |
| 6f31cf48 | 2026-10-12T06:38:05.120Z | 3 | 0 |
| 25e78e38 | 2026-10-12T06:38:05.130Z | 10 | 0 |
| ba819240 | 2026-10-12T06:38:05.130Z | 3 | 0 |
| 64186195 | 2026-10-12T06:38:05.130Z | 3 | 0 |
| 572791a9 | 2026-10-12T06:38:05.150Z | 18 | 0 |
| 20f18c16 | 2026-10-12T06:38:05.150Z | 1 | 0 |
| de138e48 | 2026-10-12T06:38:05.160Z | 15 | 0 |
| 3bc5c97f | 2026-10-12T06:38:05.160Z | 7 | 0 |
| 068ce127 | 2026-10-12T06:38:05.170Z | 7 | 0 |
| d0b36532 | 2026-10-12T06:38:05.170Z | 3 | 0 |
| 721fcd85 | 2026-10-12T06:38:05.170Z | 5 | 0 |
| 015087df | 2026-10-12T06:38:05.170Z | 5 | 0 |
| ac9b0966 | 2026-10-12T06:38:05.170Z | 2 | 0 |
| e8040109 | 2026-10-12T06:38:05.170Z | 4 | 0 |
| 788cb46d | 2026-10-12T06:38:05.180Z | 7 | 0 |
| a2d63760 | 2026-10-12T06:38:05.180Z | 5 | 0 |
| 4abfbdab | 2026-10-12T06:38:05.180Z | 7 | 0 |
| d2878dad | 2026-10-12T06:38:05.180Z | 2 | 0 |
| 08367b09 | 2026-10-12T06:38:05.200Z | 73 | 0 |
| 9f68058e | 2026-10-12T06:38:05.210Z | 3 | 0 |
| 3a3a6bf2 | 2026-10-12T06:38:05.220Z | 55 | 0 |
| 17fbd305 | 2026-10-12T06:38:05.220Z | 8 | 0 |
| 44f7ca34 | 2026-10-12T06:38:05.220Z | 8 | 0 |
| fd6ec2cc | 2026-10-12T06:38:05.230Z | 93 | 3 |
| 237d0e71 | 2026-10-12T06:38:05.230Z | 3 | 0 |
| 0a5ca774 | 2026-10-12T06:38:05.230Z | 7 | 0 |
| 7a261d56 | 2026-10-12T06:38:05.230Z | 11 | 0 |
| 0a4add7b | 2026-10-12T06:38:05.230Z | 5 | 0 |
| ac450b0e | 2026-10-12T06:38:05.230Z | 3 | 0 |
| e5b6eac3 | 2026-10-12T06:38:05.230Z | 92 | 0 |
| d211e078 | 2026-10-12T06:38:05.230Z | 3 | 0 |
| 8421d1a0 | 2026-10-12T06:38:05.230Z | 4 | 0 |
| 24595cd7 | 2026-10-12T06:38:05.230Z | 11 | 0 |
| c8ff8b92 | 2026-10-12T06:38:05.230Z | 6 | 0 |
| 40005fd6 | 2026-10-12T06:38:05.230Z | 3 | 0 |
| c62ee834 | 2026-10-12T06:38:05.230Z | 3 | 0 |
| 6e19e5f6 | 2026-10-12T06:38:05.230Z | 2 | 0 |
| 9228ae92 | 2026-10-12T06:38:05.230Z | 4 | 0 |
| 27f436bb | 2026-10-12T06:38:05.230Z | 4 | 0 |
| 5b00757d | 2026-10-12T06:38:05.230Z | 2 | 0 |
| 9f454da3 | 2026-10-12T06:38:05.230Z | 2 | 0 |
| 3983e8f8 | 2026-10-12T06:38:05.240Z | 5 | 0 |
| 45e0d9b8 | 2026-10-12T06:38:05.240Z | 1 | 0 |
| 07056c85 | 2026-10-12T06:38:05.240Z | 1 | 0 |
| 80ced1bd | 2026-10-12T06:38:06.070Z | 1 | 0 |
| b959e80d | 2026-10-12T06:38:06.100Z | 7 | 0 |
| 86a8b507 | 2026-10-12T06:38:06.100Z | 1 | 0 |
| e4b7ba7d | 2026-10-12T06:38:06.110Z | 15 | 0 |
| e5667679 | 2026-10-12T06:38:06.110Z | 3 | 0 |
| 8c7ca671 | 2026-10-12T06:38:06.110Z | 7 | 0 |
| e7af89dd | 2026-10-12T06:38:06.110Z | 15 | 0 |
| dd5d9c6a | 2026-10-12T06:38:06.120Z | 5 | 0 |
| d559a023 | 2026-10-12T06:38:06.120Z | 57 | 0 |
| 8ba08ac7 | 2026-10-12T06:38:06.120Z | 30 | 0 |
| 56f8c4e2 | 2026-10-12T06:38:06.120Z | 5 | 0 |
| 8f24a7cf | 2026-10-12T06:38:06.120Z | 8 | 0 |
| 30fedc47 | 2026-10-12T06:38:06.120Z | 11 | 0 |
| 5e10ccff | 2026-10-12T06:38:06.120Z | 4 | 0 |
| 3101df21 | 2026-10-12T06:38:06.120Z | 2 | 0 |
| 16b0dc9b | 2026-10-12T06:38:06.120Z | 1 | 0 |
| aa977c7a | 2026-10-12T06:38:06.120Z | 1 | 0 |
| 5a6a2448 | 2026-10-12T06:38:06.120Z | 1 | 0 |
| 238a4c08 | 2026-10-12T06:38:06.130Z | 9 | 3 |
| 02585bdd | 2026-10-12T06:38:06.130Z | 2 | 0 |
| f85a0f45 | 2026-10-12T06:38:06.160Z | 25 | 0 |
| 7fb87ca2 | 2026-10-12T06:38:06.160Z | 9 | 0 |
| 468696d6 | 2026-10-12T06:38:06.160Z | 2 | 0 |
| 7831eebb | 2026-10-12T06:38:06.160Z | 5 | 0 |
| 5f20a424 | 2026-10-12T06:38:06.160Z | 1 | 0 |
| 276ac108 | 2026-10-12T06:38:06.160Z | 1 | 0 |
| 118824fc | 2026-10-12T06:38:06.170Z | 18 | 0 |
| 7a1afadc | 2026-10-12T06:38:06.170Z | 4 | 0 |
| 0e63439c | 2026-10-12T06:38:06.170Z | 57 | 3 |
| bc091501 | 2026-10-12T06:38:06.170Z | 4 | 0 |
| 1f46f39d | 2026-10-12T06:38:06.170Z | 1 | 0 |
| 9728e76f | 2026-10-12T06:38:06.170Z | 1 | 0 |
| 72aa9798 | 2026-10-12T06:38:06.170Z | 1 | 0 |
| d33b198d | 2026-10-12T06:38:06.170Z | 1 | 0 |
| 56cc2b74 | 2026-10-12T06:38:06.180Z | 2 | 0 |
| 9729c6fb | 2026-10-12T06:38:06.190Z | 5 | 0 |
| da00dbd1 | 2026-10-12T06:38:06.190Z | 2 | 0 |
| b3763964 | 2026-10-12T06:38:06.200Z | 6 | 0 |
| e078deb3 | 2026-10-12T06:38:06.200Z | 4 | 0 |
| f5a3bc7c | 2026-10-12T06:38:06.200Z | 10 | 0 |
| 896a0376 | 2026-10-12T06:38:06.200Z | 4 | 0 |
| 560d6d56 | 2026-10-12T06:38:06.200Z | 4 | 0 |
| 51e54284 | 2026-10-12T06:38:06.200Z | 5 | 0 |
| 7b432539 | 2026-10-12T06:38:06.200Z | 1 | 0 |
| 1ce9868e | 2026-10-12T06:38:06.200Z | 1 | 0 |
| b52f70c5 | 2026-10-12T06:38:12.890Z | 4 | 0 |
| 85b4124c | 2026-10-12T06:38:12.910Z | 3 | 0 |

Warm lookups (whole log): {"hit":1942,"miss":0,"stale":0,"invalid":0,"error":0,"timeout":0,"memo-miss":0,"capped":0,"other":0}; warm jobs started in the window: 3.

