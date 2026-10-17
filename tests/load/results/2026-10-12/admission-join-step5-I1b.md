# Step 5 join — idle — step5-I1b

- Inputs: tests/load/results/2026-10-12/2026-10-12T08-32-57-351Z-browsers-idle-broadcast.json, tests/load/results/2026-10-12/2026-10-12T08-27-40Z-vercel-logs-history-step5-I1b.txt, tests/load/results/2026-10-12/observer-I1b/n14-observer-38223683237/2026-10-12T08-28-22-628Z-observer-step5-I1b.jsonl
- Base https://opensetlist-git-dev-opensetlist-projects.vercel.app; T0 2026-10-12T08:31:12.009Z; window 2026-10-12T08:31:02.009Z → 2026-10-12T08:33:22.413Z
- Harness verdict: **PASS**
- Clocks: harness = this host (save PUT start / response), server = the function's `at` (per instance), observer = the runner. Comparisons across clocks within the offset uncertainty are indeterminate; UTC does not synchronise them.

## Saves — exposure and the server's commit

| save | label | rev | PUT start (UTC) | PUT ms | server commit `at` | where | acquire ms | exec ms | SDK connected / not yet | pages in flight / future | stale first SDK / pages | convergence SDK before / after (p95 / missing) | pages before / after | broadcast received / pop. | observer received / n |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| s1 | idle-first | 1673 | 2026-10-12T08:31:12.009Z | 1240 | 2026-10-12T08:31:13.129Z | inside [PUT start, PUT response] | 4 | 232 | — | — | — | — | — | — | 5 / 5 |
| s2 | idle | 1674 | 2026-10-12T08:31:52.023Z | 437 | 2026-10-12T08:31:52.341Z | inside [PUT start, PUT response] | 4 | 64 | — | — | — | — | — | — | 5 / 5 |
| s3 | idle | 1675 | 2026-10-12T08:32:52.009Z | 404 | 2026-10-12T08:32:52.295Z | inside [PUT start, PUT response] | 3 | 36 | — | — | — | — | — | — | 5 / 5 |

Writer acquire max 4 ms (gate ≤ 500: **PASS**); writer pre-execution failures 0.

## Admission window (server)

- Coverage: 319 log entries in the window; log spans 2026-10-12T08:27:44.720Z → 2026-10-12T08:33:55.090Z (covers the window start: yes, end: yes); largest gap between consecutive entries 5060 ms.
- Errors: EMAXCONN 0 (gate 0: **PASS**); hint fetches answered 503 (`verify=error`) 0; build-failed 0; entries at level error 0. (Page / SDK 5xx are counted client-side in the harness gates.)
- **Σ (sum of per-instance Prisma pool totals)**: peak 30 (carried; reported 1) at 2026-10-12T08:31:05.000Z over 26 instance(s) — gate < 300: **PASS**.
  - Completeness: 28 bucket(s) of 5 s; 15 instance(s) logged pool lines; 0 instance(s) seen in the window WITHOUT any pool line; an instance is carried ≤ 5 s after its last line; each bucket holds per-instance MAXIMA (an upper bound within the bucket, not a simultaneous count); a gap in the capture (largest 5060 ms) is time Σ cannot see. Σ is an app-side estimate, not the pooler's own client count.

| minute (UTC) | builds | warm-job builds | reader builds | building instances |
|---|---|---|---|---|
| 08:31 | 65 | 6 | 59 | 15 |
| 08:32 | 60 | 9 | 51 | 1 |
| 08:33 | 10 | 0 | 10 | 1 |

| instance (by first appearance) | first seen (UTC) | builds | warm-job builds |
|---|---|---|---|
| 643f8e53 | 2026-10-12T08:31:02.200Z | 1 | 0 |
| 534bb1c4 | 2026-10-12T08:31:02.210Z | 1 | 0 |
| 3d5504ff | 2026-10-12T08:31:02.260Z | 2 | 0 |
| f903e9b9 | 2026-10-12T08:31:02.270Z | 1 | 0 |
| 2fe022f0 | 2026-10-12T08:31:02.280Z | 2 | 0 |
| 4c3d92e6 | 2026-10-12T08:31:02.350Z | 116 | 15 |
| 536628f2 | 2026-10-12T08:31:02.350Z | 1 | 0 |
| e5e12818 | 2026-10-12T08:31:02.390Z | 1 | 0 |
| ea21013e | 2026-10-12T08:31:02.400Z | 2 | 0 |
| 7e760a17 | 2026-10-12T08:31:02.400Z | 1 | 0 |
| 481ec23a | 2026-10-12T08:31:02.410Z | 2 | 0 |
| 1e79edee | 2026-10-12T08:31:02.420Z | 2 | 0 |
| 11aacc8f | 2026-10-12T08:31:02.420Z | 1 | 0 |
| c27a3dd5 | 2026-10-12T08:31:02.430Z | 1 | 0 |
| dc3eea71 | 2026-10-12T08:31:02.440Z | 1 | 0 |

Warm lookups (whole log): {"hit":123,"miss":0,"stale":0,"invalid":0,"error":0,"timeout":0,"memo-miss":0,"capped":0,"other":0}; warm jobs started in the window: 5.

## I-cycles (eligibility + arrivals, harness cohorts and the observer)

### I1 — first save after idle — save s1 rev 1673: harness **PASS**

- Harness: eligible 20/20 (spread 0.0 s); eligible clients received the broadcast 20/20, applied 20/20 by {"notification":20}; repair max — ms (healthy periodic repair 20 s ± 4 s — measured, not a bound)
- Observer (runner clock; judged with a 1000 ms cross-host clock margin: age must be within [7 s, 89 s], receipts up to 1000 ms before the PUT start still count): eligible 5/5 (spread 0.0 s, exercised yes); eligible received 5/5, applied 5/5 by {"notification":5}

| observer client | connected since | age s | eligible | broadcast ms after PUT response | applying fetch | repair ms |
|---|---|---|---|---|---|---|
| obs-0 | 2026-10-12T08:31:02.156Z | 9.9 | yes | 11 | notification | — |
| obs-3 | 2026-10-12T08:31:02.156Z | 9.9 | yes | 11 | notification | — |
| obs-1 | 2026-10-12T08:31:02.157Z | 9.9 | yes | 12 | notification | — |
| obs-4 | 2026-10-12T08:31:02.157Z | 9.9 | yes | 12 | notification | — |
| obs-2 | 2026-10-12T08:31:02.156Z | 9.9 | yes | 12 | notification | — |

Observer: 5 client(s), 5 with full timelines; connect-at 2026-10-12T08:31:00.000Z, connected 2026-10-12T08:31:00.000Z, ready 2026-10-12T08:31:03.032Z.

