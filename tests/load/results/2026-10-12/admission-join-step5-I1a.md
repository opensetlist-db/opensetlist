# Step 5 join — idle — step5-I1a

- Inputs: tests/load/results/2026-10-12/2026-10-12T07-57-53-535Z-browsers-idle-broadcast.json, tests/load/results/2026-10-12/2026-10-12T07-52-38Z-vercel-logs-history-step5-I1a.txt, tests/load/results/2026-10-12/observer-I1a/n14-observer-38220204608/2026-10-12T07-53-23-008Z-observer-step5-I1a.jsonl
- Base https://opensetlist-git-dev-opensetlist-projects.vercel.app; T0 2026-10-12T07:56:08.013Z; window 2026-10-12T07:55:58.013Z → 2026-10-12T07:58:18.541Z
- Harness verdict: **NOT EXERCISED**
- Clocks: harness = this host (save PUT start / response), server = the function's `at` (per instance), observer = the runner. Comparisons across clocks within the offset uncertainty are indeterminate; UTC does not synchronise them.

## Saves — exposure and the server's commit

| save | label | rev | PUT start (UTC) | PUT ms | server commit `at` | where | acquire ms | exec ms | SDK connected / not yet | pages in flight / future | stale first SDK / pages | convergence SDK before / after (p95 / missing) | pages before / after | broadcast received / pop. | observer received / n |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| s1 | idle-first | 1668 | 2026-10-12T07:56:08.013Z | 561 | 2026-10-12T07:56:08.454Z | inside [PUT start, PUT response] | 3 | 170 | — | — | — | — | — | — | 5 / 5 |
| s2 | idle | 1669 | 2026-10-12T07:56:48.026Z | 439 | 2026-10-12T07:56:48.348Z | inside [PUT start, PUT response] | 4 | 68 | — | — | — | — | — | — | 5 / 5 |
| s3 | idle | 1670 | 2026-10-12T07:57:48.016Z | 525 | 2026-10-12T07:57:48.414Z | inside [PUT start, PUT response] | 3 | 39 | — | — | — | — | — | — | 5 / 5 |

Writer acquire max 4 ms (gate ≤ 500: **PASS**); writer pre-execution failures 0.

## Admission window (server)

- Coverage: 342 log entries in the window; log spans 2026-10-12T07:52:43.340Z → 2026-10-12T07:58:52.670Z (covers the window start: yes, end: yes); largest gap between consecutive entries 5060 ms.
- Errors: EMAXCONN 0 (gate 0: **PASS**); hint fetches answered 503 (`verify=error`) 0; build-failed 0; entries at level error 0. (Page / SDK 5xx are counted client-side in the harness gates.)
- **Σ (sum of per-instance Prisma pool totals)**: peak 12 (carried; reported 2) at 2026-10-12T07:56:05.000Z over 11 instance(s) — gate < 300: **PASS**.
  - Completeness: 28 bucket(s) of 5 s; 11 instance(s) logged pool lines; 0 instance(s) seen in the window WITHOUT any pool line; an instance is carried ≤ 5 s after its last line; each bucket holds per-instance MAXIMA (an upper bound within the bucket, not a simultaneous count); a gap in the capture (largest 5060 ms) is time Σ cannot see. Σ is an app-side estimate, not the pooler's own client count.

| minute (UTC) | builds | warm-job builds | reader builds | building instances |
|---|---|---|---|---|
| 07:56 | 64 | 6 | 58 | 11 |
| 07:57 | 62 | 9 | 53 | 2 |
| 07:58 | 6 | 0 | 6 | 1 |

| instance (by first appearance) | first seen (UTC) | builds | warm-job builds |
|---|---|---|---|
| e5d0024d | 2026-10-12T07:56:00.110Z | 16 | 0 |
| e4909a30 | 2026-10-12T07:56:00.260Z | 1 | 0 |
| 2977d488 | 2026-10-12T07:56:00.260Z | 1 | 0 |
| 2543b5b5 | 2026-10-12T07:56:00.330Z | 5 | 0 |
| 498b2602 | 2026-10-12T07:56:00.420Z | 3 | 0 |
| 23a6a9e8 | 2026-10-12T07:56:00.430Z | 100 | 15 |
| 2b36b0f2 | 2026-10-12T07:56:00.430Z | 1 | 0 |
| ca4e62a8 | 2026-10-12T07:56:00.450Z | 2 | 0 |
| e11b8d31 | 2026-10-12T07:56:00.460Z | 1 | 0 |
| c2176d11 | 2026-10-12T07:56:00.490Z | 1 | 0 |
| c328604f | 2026-10-12T07:56:00.500Z | 1 | 0 |

Warm lookups (whole log): {"hit":124,"miss":0,"stale":0,"invalid":0,"error":0,"timeout":0,"memo-miss":0,"capped":0,"other":0}; warm jobs started in the window: 5.

## I-cycles (eligibility + arrivals, harness cohorts and the observer)

### I1 — first save after idle — save s1 rev 1668: harness **NOT EXERCISED**

- Harness: eligible 0/20 (spread 0.0 s); eligible clients received the broadcast 0/0, applied 0/0 by {}; repair max — ms (healthy periodic repair 20 s ± 4 s — measured, not a bound)
- Observer (runner clock; judged with a 1000 ms cross-host clock margin: age must be within [7 s, 89 s], receipts up to 1000 ms before the PUT start still count): eligible 0/5 (spread 0.0 s, exercised **no**); eligible received 0/0, applied 0/0 by {}; not eligible: obs-0 (connected only 5.9 s before the save (< 7 s)), obs-3 (connected only 5.9 s before the save (< 7 s)), obs-4 (connected only 5.9 s before the save (< 7 s)), obs-1 (connected only 5.9 s before the save (< 7 s)), obs-2 (connected only 5.9 s before the save (< 7 s))

| observer client | connected since | age s | eligible | broadcast ms after PUT response | applying fetch | repair ms |
|---|---|---|---|---|---|---|
| obs-0 | 2026-10-12T07:56:02.154Z | 5.9 | no — connected only 5.9 s before the save (< 7 s) | 31 | notification | — |
| obs-3 | 2026-10-12T07:56:02.158Z | 5.9 | no — connected only 5.9 s before the save (< 7 s) | 30 | notification | — |
| obs-4 | 2026-10-12T07:56:02.153Z | 5.9 | no — connected only 5.9 s before the save (< 7 s) | 30 | notification | — |
| obs-1 | 2026-10-12T07:56:02.153Z | 5.9 | no — connected only 5.9 s before the save (< 7 s) | 30 | notification | — |
| obs-2 | 2026-10-12T07:56:02.153Z | 5.9 | no — connected only 5.9 s before the save (< 7 s) | 30 | notification | — |

Observer: 5 client(s), 5 with full timelines; connect-at 2026-10-12T07:56:00.000Z, connected 2026-10-12T07:56:00.000Z, ready 2026-10-12T07:56:03.033Z.

