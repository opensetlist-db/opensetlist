# Step 5 join — admission — step5-A4

- Inputs: tests/load/results/2026-10-12/2026-10-12T07-15-52-946Z-browsers-admission.json, tests/load/results/2026-10-12/2026-10-12T07-11-58Z-vercel-logs-history-step5-A4.txt
- Base https://opensetlist-6pth66f6b-opensetlist-projects.vercel.app; T0 2026-10-12T07:14:32.390Z; window 2026-10-12T07:14:22.390Z → 2026-10-12T07:15:47.860Z
- Harness verdict: **VALID + FAIL** (SDK VALID + FAIL, page VALID + FAIL); outbound during the boundary wait: 0
- Clocks: harness = this host (save PUT start / response), server = the function's `at` (per instance), observer = the runner. Comparisons across clocks within the offset uncertainty are indeterminate; UTC does not synchronise them.

## Saves — exposure and the server's commit

| save | label | rev | PUT start (UTC) | PUT ms | server commit `at` | where | acquire ms | exec ms | SDK connected / not yet | pages in flight / future | stale first SDK / pages | convergence SDK before / after (p95 / missing) | pages before / after | broadcast received / pop. | observer received / n |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| a1 | SDK + page admission save | 1650 | 2026-10-12T07:14:35.392Z | 1822 | 2026-10-12T07:14:37.068Z | inside [PUT start, PUT response] | 794 | 93 | 155 / 211 | 5 / 25 | 0/210 / 0/25 | 3348 / 0 · 1529 / 0 | — / 0 · 864 / 0 | 259 / 470 | — |
| a2 | SDK admission save | 1651 | 2026-10-12T07:14:38.390Z | 867 | 2026-10-12T07:14:39.122Z | inside [PUT start, PUT response] | 76 | 176 | 312 / 107 | 0 / 25 | 0/106 / 0/20 | 2854 / 0 · 1602 / 0 | 2189 / 0 · 1401 / 0 | 363 / 470 | — |
| a3 | after admission | 1652 | 2026-10-12T07:14:52.400Z | 471 | 2026-10-12T07:14:52.737Z | inside [PUT start, PUT response] | 3 | 97 | 470 / 0 | 0 / 0 | 0/0 / 0/0 | 1847 / 0 · — / 0 | 1268 / 0 · — / 0 | 470 / 470 | — |
| a4 | after admission | 1653 | 2026-10-12T07:15:17.404Z | 456 | 2026-10-12T07:15:17.715Z | inside [PUT start, PUT response] | 3 | 59 | 470 / 0 | 0 / 0 | 0/0 / 0/0 | 1717 / 0 · — / 0 | 1222 / 0 · — / 0 | 470 / 470 | — |

Writer acquire max 794 ms (gate ≤ 500: **FAIL**); writer pre-execution failures 0.

## Admission window (server)

- Coverage: 4466 log entries in the window; log spans 2026-10-12T07:14:32.440Z → 2026-10-12T07:15:52.240Z (covers the window start: **no**, end: yes); largest gap between consecutive entries 1000 ms.
- Errors: EMAXCONN 0 (gate 0: **PASS**); hint fetches answered 503 (`verify=error`) 0; build-failed 0; entries at level error 0. (Page / SDK 5xx are counted client-side in the harness gates.)
- **Σ (sum of per-instance Prisma pool totals)**: peak 167 (carried; reported 157) at 2026-10-12T07:14:35.000Z over 101 instance(s) — gate < 300: **PASS**.
  - Completeness: 16 bucket(s) of 5 s; 104 instance(s) logged pool lines; 1 instance(s) seen in the window WITHOUT any pool line (cd904b18) — their connections are not in Σ; an instance is carried ≤ 5 s after its last line; each bucket holds per-instance MAXIMA (an upper bound within the bucket, not a simultaneous count); a gap in the capture (largest 1000 ms) is time Σ cannot see. Σ is an app-side estimate, not the pooler's own client count.

| minute (UTC) | builds | warm-job builds | reader builds | building instances |
|---|---|---|---|---|
| 07:14 | 625 | 9 | 616 | 104 |
| 07:15 | 331 | 3 | 328 | 16 |

| instance (by first appearance) | first seen (UTC) | builds | warm-job builds |
|---|---|---|---|
| 610b3cdc | 2026-10-12T07:14:32.440Z | 8 | 0 |
| 526ac92e | 2026-10-12T07:14:32.840Z | 9 | 0 |
| fa60c68c | 2026-10-12T07:14:32.840Z | 6 | 0 |
| 3cfbad9f | 2026-10-12T07:14:32.860Z | 8 | 0 |
| 62e460d1 | 2026-10-12T07:14:32.860Z | 6 | 0 |
| 57961bae | 2026-10-12T07:14:32.860Z | 9 | 0 |
| 1a805e8c | 2026-10-12T07:14:32.860Z | 23 | 0 |
| 4e40075f | 2026-10-12T07:14:32.860Z | 8 | 0 |
| a24596ba | 2026-10-12T07:14:32.860Z | 12 | 3 |
| 28f57bca | 2026-10-12T07:14:32.860Z | 1 | 0 |
| 691c7002 | 2026-10-12T07:14:32.870Z | 56 | 3 |
| 308814e8 | 2026-10-12T07:14:32.870Z | 5 | 0 |
| efb29c6f | 2026-10-12T07:14:32.870Z | 3 | 0 |
| c592854e | 2026-10-12T07:14:32.870Z | 4 | 0 |
| 0702ea7d | 2026-10-12T07:14:32.880Z | 1 | 0 |
| c6a13de3 | 2026-10-12T07:14:32.880Z | 4 | 0 |
| adbed4c0 | 2026-10-12T07:14:32.890Z | 6 | 0 |
| c94538e1 | 2026-10-12T07:14:32.900Z | 8 | 0 |
| 51a42ed5 | 2026-10-12T07:14:32.900Z | 5 | 0 |
| 92b99e14 | 2026-10-12T07:14:32.900Z | 8 | 0 |
| 4b697d3f | 2026-10-12T07:14:32.900Z | 4 | 0 |
| 77c3b210 | 2026-10-12T07:14:32.900Z | 5 | 0 |
| 981bba6e | 2026-10-12T07:14:32.900Z | 1 | 0 |
| 6bcc6442 | 2026-10-12T07:14:32.910Z | 7 | 0 |
| 9439972b | 2026-10-12T07:14:32.910Z | 3 | 0 |
| 5b860579 | 2026-10-12T07:14:32.920Z | 9 | 0 |
| 2516c19f | 2026-10-12T07:14:32.920Z | 3 | 0 |
| db5794bb | 2026-10-12T07:14:32.930Z | 64 | 0 |
| ad6db0b5 | 2026-10-12T07:14:32.930Z | 7 | 0 |
| 94128ae2 | 2026-10-12T07:14:32.930Z | 15 | 0 |
| 038e5ec0 | 2026-10-12T07:14:32.930Z | 19 | 0 |
| 48869704 | 2026-10-12T07:14:32.930Z | 3 | 0 |
| ce187e06 | 2026-10-12T07:14:32.930Z | 8 | 0 |
| 716aa362 | 2026-10-12T07:14:32.930Z | 5 | 0 |
| 7006f831 | 2026-10-12T07:14:32.930Z | 1 | 0 |
| 2fa65216 | 2026-10-12T07:14:32.940Z | 3 | 0 |
| 48a7b832 | 2026-10-12T07:14:32.940Z | 4 | 0 |
| ee5c405e | 2026-10-12T07:14:32.940Z | 6 | 0 |
| 28b6867b | 2026-10-12T07:14:32.960Z | 5 | 0 |
| 7fdc1273 | 2026-10-12T07:14:32.960Z | 18 | 0 |
| 3a143b9b | 2026-10-12T07:14:32.960Z | 54 | 0 |
| 557c5d05 | 2026-10-12T07:14:32.960Z | 6 | 0 |
| b031814f | 2026-10-12T07:14:32.960Z | 77 | 0 |
| 69811091 | 2026-10-12T07:14:32.960Z | 4 | 0 |
| 3e64c408 | 2026-10-12T07:14:32.960Z | 1 | 0 |
| 9f0d198b | 2026-10-12T07:14:32.970Z | 5 | 0 |
| 00c0ddc6 | 2026-10-12T07:14:32.980Z | 24 | 0 |
| ccde42ab | 2026-10-12T07:14:32.980Z | 8 | 0 |
| cc3abed1 | 2026-10-12T07:14:33.820Z | 6 | 0 |
| 707db1b7 | 2026-10-12T07:14:33.840Z | 8 | 0 |
| d839d14d | 2026-10-12T07:14:33.840Z | 84 | 0 |
| f7e8f0c9 | 2026-10-12T07:14:33.840Z | 8 | 0 |
| 57d05d11 | 2026-10-12T07:14:33.840Z | 1 | 0 |
| 17caf26b | 2026-10-12T07:14:33.840Z | 1 | 0 |
| c844c85b | 2026-10-12T07:14:33.850Z | 7 | 0 |
| 25baff4b | 2026-10-12T07:14:33.850Z | 5 | 0 |
| fd1236e8 | 2026-10-12T07:14:33.850Z | 2 | 0 |
| 47d91933 | 2026-10-12T07:14:33.850Z | 1 | 0 |
| dc86df1d | 2026-10-12T07:14:33.870Z | 25 | 0 |
| ddee9e11 | 2026-10-12T07:14:33.870Z | 8 | 0 |
| ac4597ba | 2026-10-12T07:14:33.870Z | 1 | 0 |
| a8330e19 | 2026-10-12T07:14:33.880Z | 6 | 0 |
| 6d6120fb | 2026-10-12T07:14:33.880Z | 3 | 0 |
| 9e256200 | 2026-10-12T07:14:33.880Z | 4 | 0 |
| 292622a0 | 2026-10-12T07:14:33.880Z | 22 | 3 |
| 49bf8ddc | 2026-10-12T07:14:33.880Z | 2 | 0 |
| af8ef861 | 2026-10-12T07:14:33.880Z | 1 | 0 |
| c3b73471 | 2026-10-12T07:14:33.890Z | 4 | 0 |
| 1efa08d7 | 2026-10-12T07:14:33.910Z | 5 | 0 |
| 048a6445 | 2026-10-12T07:14:33.910Z | 5 | 0 |
| ef196874 | 2026-10-12T07:14:33.910Z | 9 | 0 |
| e24fe86e | 2026-10-12T07:14:33.910Z | 5 | 0 |
| 9e16a212 | 2026-10-12T07:14:33.910Z | 7 | 0 |
| f50afac0 | 2026-10-12T07:14:33.910Z | 2 | 0 |
| 3bab2109 | 2026-10-12T07:14:33.930Z | 5 | 0 |
| ad9fe789 | 2026-10-12T07:14:33.930Z | 4 | 0 |
| bf6566c1 | 2026-10-12T07:14:33.930Z | 4 | 0 |
| 877f14c5 | 2026-10-12T07:14:33.930Z | 2 | 0 |
| 7dd38d38 | 2026-10-12T07:14:33.940Z | 9 | 0 |
| 5ee856ce | 2026-10-12T07:14:33.940Z | 47 | 3 |
| d2fdfedd | 2026-10-12T07:14:33.940Z | 2 | 0 |
| afb96525 | 2026-10-12T07:14:37.570Z | 3 | 0 |
| cd266cfc | 2026-10-12T07:14:37.580Z | 5 | 0 |
| 290a0d11 | 2026-10-12T07:14:37.620Z | 5 | 0 |
| dc3993b6 | 2026-10-12T07:14:37.700Z | 2 | 0 |
| 835ea7fe | 2026-10-12T07:14:37.700Z | 4 | 0 |
| 11b615ad | 2026-10-12T07:14:37.730Z | 3 | 0 |
| 5c3e66c8 | 2026-10-12T07:14:37.810Z | 4 | 0 |
| f19e54fe | 2026-10-12T07:14:37.810Z | 2 | 0 |
| d95c3fb3 | 2026-10-12T07:14:37.820Z | 4 | 0 |
| c447a9bb | 2026-10-12T07:14:37.830Z | 2 | 0 |
| 389b0d8c | 2026-10-12T07:14:37.830Z | 3 | 0 |
| 3f7940f6 | 2026-10-12T07:14:37.870Z | 6 | 0 |
| 69b1698e | 2026-10-12T07:14:37.870Z | 30 | 0 |
| 90a94073 | 2026-10-12T07:14:37.890Z | 1 | 0 |
| 8b45e00b | 2026-10-12T07:14:37.900Z | 2 | 0 |
| 62a5a261 | 2026-10-12T07:14:37.920Z | 3 | 0 |
| 66aafc86 | 2026-10-12T07:14:37.940Z | 1 | 0 |
| 62f60b65 | 2026-10-12T07:14:37.960Z | 5 | 0 |
| 34def943 | 2026-10-12T07:14:37.990Z | 2 | 0 |
| cd904b18 | 2026-10-12T07:14:38.000Z | 0 | 0 |
| b96eb0ae | 2026-10-12T07:14:38.020Z | 2 | 0 |
| 9648c6db | 2026-10-12T07:14:43.020Z | 1 | 0 |
| c444bc82 | 2026-10-12T07:14:47.840Z | 1 | 0 |
| 4dd37b86 | 2026-10-12T07:14:47.890Z | 1 | 0 |

Warm lookups (whole log): {"hit":2128,"miss":149,"stale":0,"invalid":0,"error":0,"timeout":0,"memo-miss":156,"capped":0,"other":0}; warm jobs started in the window: 4.

## A4 fault evidence (`getnull`)

- `[liveWarm] fault armed mode=getnull` lines: 0; other armed modes: 0; `fault-invalid`: 0; `fault-blocked`: 0
- warm lookups 2433 (tagged `fault=getnull`: 0); results {"miss":149,"hit":2128,"memo-miss":156}; **warm hits 2128** (must be 0)
- Evidence complete: **no** — the drill cannot claim the fault was in force

