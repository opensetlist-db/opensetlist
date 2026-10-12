# Step 5 join — idle — step5-I2a

- Inputs: tests/load/results/2026-10-12/2026-10-12T09-18-04-719Z-browsers-idle-broadcast.json, tests/load/results/2026-10-12/2026-10-12T09-03-40Z-vercel-logs-history-step5-I2a.txt, tests/load/results/2026-10-12/observer-I2a/n14-observer-38227438810/2026-10-12T09-04-12-872Z-observer-step5-I2a.jsonl
- Base https://opensetlist-git-dev-opensetlist-projects.vercel.app; T0 2026-10-12T09:07:12.015Z; window 2026-10-12T09:07:02.015Z → 2026-10-12T09:18:29.526Z
- Harness verdict: **PASS**
- Clocks: harness = this host (save PUT start / response), server = the function's `at` (per instance), observer = the runner. Comparisons across clocks within the offset uncertainty are indeterminate; UTC does not synchronise them.

## Saves — exposure and the server's commit

| save | label | rev | PUT start (UTC) | PUT ms | server commit `at` | where | acquire ms | exec ms | SDK connected / not yet | pages in flight / future | stale first SDK / pages | convergence SDK before / after (p95 / missing) | pages before / after | broadcast received / pop. | observer received / n |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| s1 | idle-check | 1678 | 2026-10-12T09:07:12.015Z | 1246 | 2026-10-12T09:07:13.138Z | inside [PUT start, PUT response] | 4 | 242 | — | — | — | — | — | — | 5 / 5 |
| w1 | idle-wake | 1679 | 2026-10-12T09:17:18.969Z | 1167 | 2026-10-12T09:17:20.005Z | inside [PUT start, PUT response] | 4 | 107 | — | — | — | — | — | — | 5 / 5 |
| w2 | idle-wake | 1680 | 2026-10-12T09:17:58.978Z | 548 | 2026-10-12T09:17:59.380Z | inside [PUT start, PUT response] | 3 | 80 | — | — | — | — | — | — | 5 / 5 |

Writer acquire max 4 ms (gate ≤ 500: **PASS**); writer pre-execution failures 0.

## Admission window (server)

- Coverage: 1268 log entries in the window; log spans 2026-10-12T09:03:51.370Z → 2026-10-12T09:19:02.280Z (covers the window start: yes, end: yes); largest gap between consecutive entries 5070 ms.
- Errors: EMAXCONN 0 (gate 0: **PASS**); hint fetches answered 503 (`verify=error`) 0; build-failed 0; entries at level error 0. (Page / SDK 5xx are counted client-side in the harness gates.)
- **Σ (sum of per-instance Prisma pool totals)**: peak 28 (carried; reported 1) at 2026-10-12T09:07:05.000Z over 26 instance(s) — gate < 300: **PASS**.
  - Completeness: 137 bucket(s) of 5 s; 24 instance(s) logged pool lines; 0 instance(s) seen in the window WITHOUT any pool line; an instance is carried ≤ 5 s after its last line; each bucket holds per-instance MAXIMA (an upper bound within the bucket, not a simultaneous count); a gap in the capture (largest 5070 ms) is time Σ cannot see. Σ is an app-side estimate, not the pooler's own client count.

| minute (UTC) | builds | warm-job builds | reader builds | building instances |
|---|---|---|---|---|
| 09:07 | 66 | 3 | 63 | 13 |
| 09:08 | 54 | 0 | 54 | 2 |
| 09:09 | 49 | 0 | 49 | 2 |
| 09:10 | 57 | 0 | 57 | 1 |
| 09:11 | 58 | 0 | 58 | 3 |
| 09:12 | 58 | 0 | 58 | 2 |
| 09:13 | 53 | 0 | 53 | 2 |
| 09:14 | 52 | 0 | 52 | 1 |
| 09:15 | 50 | 0 | 50 | 2 |
| 09:16 | 56 | 0 | 56 | 2 |
| 09:17 | 106 | 6 | 100 | 13 |
| 09:18 | 23 | 6 | 17 | 3 |

| instance (by first appearance) | first seen (UTC) | builds | warm-job builds |
|---|---|---|---|
| 73be1d05 | 2026-10-12T09:07:02.240Z | 162 | 3 |
| 28ca55e3 | 2026-10-12T09:07:02.250Z | 12 | 0 |
| d656016c | 2026-10-12T09:07:02.260Z | 3 | 0 |
| 6b1e5ef9 | 2026-10-12T09:07:02.300Z | 2 | 0 |
| ca32d537 | 2026-10-12T09:07:02.360Z | 1 | 0 |
| e7faf656 | 2026-10-12T09:07:02.370Z | 3 | 0 |
| aab19166 | 2026-10-12T09:07:02.380Z | 433 | 6 |
| d16a8b8d | 2026-10-12T09:07:02.390Z | 2 | 0 |
| c46b9f61 | 2026-10-12T09:07:02.390Z | 1 | 0 |
| 61bb498b | 2026-10-12T09:07:02.450Z | 1 | 0 |
| 91c4307c | 2026-10-12T09:07:02.460Z | 1 | 0 |
| ef102390 | 2026-10-12T09:07:02.470Z | 1 | 0 |
| 7cb8ddff | 2026-10-12T09:07:02.500Z | 1 | 0 |
| 377deb82 | 2026-10-12T09:07:13.510Z | 25 | 0 |
| dbaa82a8 | 2026-10-12T09:17:12.570Z | 3 | 0 |
| cdd4734a | 2026-10-12T09:17:12.630Z | 2 | 0 |
| d400275c | 2026-10-12T09:17:12.630Z | 1 | 0 |
| a2e6563e | 2026-10-12T09:17:12.640Z | 3 | 0 |
| a45a29f7 | 2026-10-12T09:17:12.640Z | 3 | 0 |
| 9fb10892 | 2026-10-12T09:17:12.640Z | 7 | 3 |
| 23cc8772 | 2026-10-12T09:17:12.640Z | 1 | 0 |
| b78c3630 | 2026-10-12T09:17:12.650Z | 12 | 3 |
| 5c28d6fd | 2026-10-12T09:17:12.650Z | 1 | 0 |
| c638e532 | 2026-10-12T09:17:12.650Z | 1 | 0 |

Warm lookups (whole log): {"hit":199,"miss":0,"stale":0,"invalid":0,"error":0,"timeout":0,"memo-miss":0,"capped":0,"other":0}; warm jobs started in the window: 5.

## I-cycles (eligibility + arrivals, harness cohorts and the observer)

### I2 — check save (incumbents) — save s1 rev 1678: harness **PASS**

- Harness: eligible 20/20 (spread 0.0 s); eligible clients received the broadcast 20/20, applied 20/20 by {"notification":20}; repair max — ms (healthy periodic repair 20 s ± 4 s — measured, not a bound)
- Observer (runner clock; judged with a 1000 ms cross-host clock margin: age must be within [7 s, 89 s], receipts up to 1000 ms before the PUT start still count): eligible 5/5 (spread 0.1 s, exercised yes); eligible received 5/5, applied 5/5 by {"notification":5}

| observer client | connected since | age s | eligible | broadcast ms after PUT response | applying fetch | repair ms |
|---|---|---|---|---|---|---|
| obs-1 | 2026-10-12T09:07:02.309Z | 9.7 | yes | 941 | notification | — |
| obs-0 | 2026-10-12T09:07:02.163Z | 9.9 | yes | 9 | notification | — |
| obs-3 | 2026-10-12T09:07:02.164Z | 9.9 | yes | 8 | notification | — |
| obs-2 | 2026-10-12T09:07:02.163Z | 9.9 | yes | 8 | notification | — |
| obs-4 | 2026-10-12T09:07:02.304Z | 9.7 | yes | 147 | notification | — |

### I2 — fresh cohort, save 6 s after join (incumbents kept) — save w1 rev 1679: harness **PASS**

- Harness: eligible 20/20 (spread 0.0 s); eligible clients received the broadcast 20/20, applied 20/20 by {"notification":20}; repair max — ms (healthy periodic repair 20 s ± 4 s — measured, not a bound)
- Observer (runner clock; judged with a 1000 ms cross-host clock margin: age must be within [7 s, 89 s], receipts up to 1000 ms before the PUT start still count): eligible 0/5 (spread 0.1 s, exercised **no**); eligible received 0/0, applied 0/0 by {}; not eligible: obs-1 (connected 616.7 s before the save (> --max-age 89 s)), obs-0 (connected 616.8 s before the save (> --max-age 89 s)), obs-3 (connected 616.8 s before the save (> --max-age 89 s)), obs-2 (connected 616.8 s before the save (> --max-age 89 s)), obs-4 (connected 616.7 s before the save (> --max-age 89 s))

| observer client | connected since | age s | eligible | broadcast ms after PUT response | applying fetch | repair ms |
|---|---|---|---|---|---|---|
| obs-1 | 2026-10-12T09:07:02.309Z | 616.7 | no — connected 616.7 s before the save (> --max-age 89 s) | 71 | notification | — |
| obs-0 | 2026-10-12T09:07:02.163Z | 616.8 | no — connected 616.8 s before the save (> --max-age 89 s) | -2 | notification | — |
| obs-3 | 2026-10-12T09:07:02.164Z | 616.8 | no — connected 616.8 s before the save (> --max-age 89 s) | -3 | notification | — |
| obs-2 | 2026-10-12T09:07:02.163Z | 616.8 | no — connected 616.8 s before the save (> --max-age 89 s) | 0 | notification | — |
| obs-4 | 2026-10-12T09:07:02.304Z | 616.7 | no — connected 616.7 s before the save (> --max-age 89 s) | 59 | notification | — |

Observer: 5 client(s), 5 with full timelines; connect-at 2026-10-12T09:07:00.000Z, connected 2026-10-12T09:07:00.001Z, ready 2026-10-12T09:07:03.028Z.

