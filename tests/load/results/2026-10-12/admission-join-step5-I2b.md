# Step 5 join — idle — step5-I2b

- Inputs: tests/load/results/2026-10-12/2026-10-12T10-03-04-968Z-browsers-idle-broadcast.json, tests/load/results/2026-10-12/2026-10-12T09-48-39Z-vercel-logs-history-step5-I2b.txt, tests/load/results/2026-10-12/observer-I2b/n14-observer-38232267518/2026-10-12T09-49-12-868Z-observer-step5-I2b.jsonl
- Base https://opensetlist-git-dev-opensetlist-projects.vercel.app; T0 2026-10-12T09:52:12.005Z; window 2026-10-12T09:52:02.005Z → 2026-10-12T10:03:29.915Z
- Harness verdict: **PASS**
- Clocks: harness = this host (save PUT start / response), server = the function's `at` (per instance), observer = the runner. Comparisons across clocks within the offset uncertainty are indeterminate; UTC does not synchronise them.

## Saves — exposure and the server's commit

| save | label | rev | PUT start (UTC) | PUT ms | server commit `at` | where | acquire ms | exec ms | SDK connected / not yet | pages in flight / future | stale first SDK / pages | convergence SDK before / after (p95 / missing) | pages before / after | broadcast received / pop. | observer received / n |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| s1 | idle-check | 1683 | 2026-10-12T09:52:12.005Z | 638 | 2026-10-12T09:52:12.497Z | inside [PUT start, PUT response] | 4 | 226 | — | — | — | — | — | — | 5 / 5 |
| w1 | idle-wake | 1684 | 2026-10-12T10:02:18.988Z | 1050 | 2026-10-12T10:02:19.898Z | inside [PUT start, PUT response] | 5 | 67 | — | — | — | — | — | — | 5 / 5 |
| w2 | idle-wake | 1685 | 2026-10-12T10:02:59.001Z | 914 | 2026-10-12T10:02:59.754Z | inside [PUT start, PUT response] | 3 | 100 | — | — | — | — | — | — | 5 / 5 |

Writer acquire max 5 ms (gate ≤ 500: **PASS**); writer pre-execution failures 0.

## Admission window (server)

- Coverage: 1279 log entries in the window; log spans 2026-10-12T09:48:44.430Z → 2026-10-12T10:04:00.240Z (covers the window start: yes, end: yes); largest gap between consecutive entries 5060 ms.
- Errors: EMAXCONN 0 (gate 0: **PASS**); hint fetches answered 503 (`verify=error`) 0; build-failed 0; entries at level error 0. (Page / SDK 5xx are counted client-side in the harness gates.)
- **Σ (sum of per-instance Prisma pool totals)**: peak 26 (carried; reported 1) at 2026-10-12T09:52:05.000Z over 26 instance(s) — gate < 300: **PASS**.
  - Completeness: 137 bucket(s) of 5 s; 19 instance(s) logged pool lines; 0 instance(s) seen in the window WITHOUT any pool line; an instance is carried ≤ 5 s after its last line; each bucket holds per-instance MAXIMA (an upper bound within the bucket, not a simultaneous count); a gap in the capture (largest 5060 ms) is time Σ cannot see. Σ is an app-side estimate, not the pooler's own client count.

| minute (UTC) | builds | warm-job builds | reader builds | building instances |
|---|---|---|---|---|
| 09:52 | 65 | 3 | 62 | 18 |
| 09:53 | 53 | 0 | 53 | 2 |
| 09:54 | 56 | 0 | 56 | 2 |
| 09:55 | 57 | 0 | 57 | 2 |
| 09:56 | 57 | 0 | 57 | 1 |
| 09:57 | 53 | 0 | 53 | 2 |
| 09:58 | 54 | 0 | 54 | 2 |
| 09:59 | 54 | 0 | 54 | 2 |
| 10:00 | 60 | 0 | 60 | 2 |
| 10:01 | 53 | 0 | 53 | 2 |
| 10:02 | 81 | 6 | 75 | 5 |
| 10:03 | 24 | 6 | 18 | 3 |

| instance (by first appearance) | first seen (UTC) | builds | warm-job builds |
|---|---|---|---|
| e1a4b0f2 | 2026-10-12T09:52:02.320Z | 2 | 0 |
| 9fd76bb3 | 2026-10-12T09:52:02.350Z | 1 | 0 |
| 9df28465 | 2026-10-12T09:52:02.350Z | 1 | 0 |
| 3dda1d77 | 2026-10-12T09:52:02.380Z | 151 | 0 |
| ab7696db | 2026-10-12T09:52:02.390Z | 1 | 0 |
| fe42846a | 2026-10-12T09:52:02.400Z | 2 | 0 |
| 7ed5af59 | 2026-10-12T09:52:02.420Z | 2 | 0 |
| c18ed680 | 2026-10-12T09:52:02.430Z | 2 | 0 |
| e0b0e94f | 2026-10-12T09:52:02.440Z | 1 | 0 |
| 3dec4e6c | 2026-10-12T09:52:02.450Z | 1 | 0 |
| 75dd8e65 | 2026-10-12T09:52:02.450Z | 1 | 0 |
| f395658f | 2026-10-12T09:52:02.460Z | 1 | 0 |
| 45369abb | 2026-10-12T09:52:02.470Z | 1 | 0 |
| 61992ed1 | 2026-10-12T09:52:02.480Z | 1 | 0 |
| 6b731dcd | 2026-10-12T09:52:02.500Z | 426 | 6 |
| f550baee | 2026-10-12T09:52:02.510Z | 2 | 0 |
| 2505cc60 | 2026-10-12T09:52:02.520Z | 1 | 0 |
| 1390b5f4 | 2026-10-12T09:52:02.540Z | 11 | 3 |
| 955207ff | 2026-10-12T10:02:20.470Z | 59 | 6 |

Warm lookups (whole log): {"hit":203,"miss":0,"stale":0,"invalid":0,"error":0,"timeout":0,"memo-miss":0,"capped":0,"other":0}; warm jobs started in the window: 5.

## I-cycles (eligibility + arrivals, harness cohorts and the observer)

### I2 — check save (incumbents) — save s1 rev 1683: harness **PASS**

- Harness: eligible 20/20 (spread 0.0 s); eligible clients received the broadcast 20/20, applied 20/20 by {"notification":20}; repair max — ms (healthy periodic repair 20 s ± 4 s — measured, not a bound)
- Observer (runner clock; judged with a 1000 ms cross-host clock margin: age must be within [7 s, 89 s], receipts up to 1000 ms before the PUT start still count): eligible 5/5 (spread 0.0 s, exercised yes); eligible received 5/5, applied 5/5 by {"notification":5}

| observer client | connected since | age s | eligible | broadcast ms after PUT response | applying fetch | repair ms |
|---|---|---|---|---|---|---|
| obs-4 | 2026-10-12T09:52:02.274Z | 9.7 | yes | 24 | notification | — |
| obs-2 | 2026-10-12T09:52:02.268Z | 9.7 | yes | 22 | notification | — |
| obs-1 | 2026-10-12T09:52:02.272Z | 9.7 | yes | 21 | notification | — |
| obs-0 | 2026-10-12T09:52:02.270Z | 9.7 | yes | 26 | notification | — |
| obs-3 | 2026-10-12T09:52:02.269Z | 9.7 | yes | 21 | notification | — |

### I2 — fresh cohort, save 6 s after join (incumbents kept) — save w1 rev 1684: harness **PASS**

- Harness: eligible 20/20 (spread 0.1 s); eligible clients received the broadcast 20/20, applied 20/20 by {"notification":20}; repair max — ms (healthy periodic repair 20 s ± 4 s — measured, not a bound)
- Observer (runner clock; judged with a 1000 ms cross-host clock margin: age must be within [7 s, 89 s], receipts up to 1000 ms before the PUT start still count): eligible 0/5 (spread 0.0 s, exercised **no**); eligible received 0/0, applied 0/0 by {}; not eligible: obs-4 (connected 616.7 s before the save (> --max-age 89 s)), obs-2 (connected 616.7 s before the save (> --max-age 89 s)), obs-1 (connected 616.7 s before the save (> --max-age 89 s)), obs-0 (connected 616.7 s before the save (> --max-age 89 s)), obs-3 (connected 616.7 s before the save (> --max-age 89 s))

| observer client | connected since | age s | eligible | broadcast ms after PUT response | applying fetch | repair ms |
|---|---|---|---|---|---|---|
| obs-4 | 2026-10-12T09:52:02.274Z | 616.7 | no — connected 616.7 s before the save (> --max-age 89 s) | 26 | notification | — |
| obs-2 | 2026-10-12T09:52:02.268Z | 616.7 | no — connected 616.7 s before the save (> --max-age 89 s) | 19 | notification | — |
| obs-1 | 2026-10-12T09:52:02.272Z | 616.7 | no — connected 616.7 s before the save (> --max-age 89 s) | 19 | notification | — |
| obs-0 | 2026-10-12T09:52:02.270Z | 616.7 | no — connected 616.7 s before the save (> --max-age 89 s) | 20 | notification | — |
| obs-3 | 2026-10-12T09:52:02.269Z | 616.7 | no — connected 616.7 s before the save (> --max-age 89 s) | 18 | notification | — |

Observer: 5 client(s), 5 with full timelines; connect-at 2026-10-12T09:52:00.000Z, connected 2026-10-12T09:52:00.000Z, ready 2026-10-12T09:52:03.034Z.

