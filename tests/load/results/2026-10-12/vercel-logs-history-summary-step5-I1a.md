## Vercel runtime logs — 2026-10-12T07-52-38Z-vercel-logs-history-step5-I1a.txt

359 entries; requests: /api/setlist 353, other API 6, pages 0; error-level entries 0. Times: log clock +7 h.

### Builds per rev (`[liveSnapshot] build` lines: 145)

| rev | builds | distinct instances | locales | build ms avg / max | first – last |
|---|---|---|---|---|---|
| 1667 | 16 | 11 | ja 3, ko 10, en 3 | 376 / 624 | 07:56:00 – 07:56:05 |
| 1668 | 32 | 4 | ja 18, en 5, ko 9 | 62 / 90 | 07:56:08 – 07:56:44 |
| 1669 | 59 | 2 | ja 35, ko 15, en 9 | 42 / 58 | 07:56:48 – 07:57:47 |
| 1670 | 4 | 1 | ja 2, ko 1, en 1 | 47 / 73 | 07:57:48 – 07:57:50 |
| 1671 | 3 | 1 | ko 1, ja 1, en 1 | 41 / 50 | 07:57:50 – 07:57:50 |
| 1672 | 31 | 1 | ko 8, ja 18, en 5 | 45 / 107 | 07:57:51 – 07:58:52 |

### Failures, repair reads, coalescing

| what | count | detail |
|---|---|---|
| EMAXCONN (pooler client cap) | 0 | API 0, SSR 0 |
| `[liveSnapshot] build-failed` | 0 | — |
| `[liveSnapshot] rev-read` (repair revision read) | 0 | rev=timeout 0, rev=error 0; ms p50 — / max —; by hint: — |
| `[liveSnapshot] coalesced` | 4 | waiters sum 8, max 2 |
| `[setlist] slow-hit` | 0 | max — ms |

### Hint outcomes (`[setlist] hint-fetch` lines: 124)

Whole capture: satisfied 124, fresh 0, memo 0, deferred 0, none 0, error 0, other 0. "other" = a `verify=` value this script does not know.

| minute | hint fetches | satisfied | fresh | memo | deferred | none | error | other |
|---|---|---|---|---|---|---|---|---|
| 07:56 | 50 | 50 | 0 | 0 | 0 | 0 | 0 | 0 |
| 07:57 | 74 | 74 | 0 | 0 | 0 | 0 | 0 | 0 |

### Warming (`[liveWarm]` jobs: 5; `[setlist] warm-lookup` lines: 124)

**warm hit rate = hits ÷ hinted fetches = 124 / 124 = 100.0 %** (hinted fetches = `[setlist] hint-fetch` lines with a numeric minRev; lookups 124).

schedule-failed 0; job-failed 0; set ok=false 0 (set-error lines 0); skips 0; lookup-error lines 0; warm builds matched 15.

Warm jobs. start → done = the job's own `done ms=` (it starts in `after()`, i.e. right after the save's response, so it is ≈ warm-complete − commit). Per locale: actual rev, bytes, build / set ms, ok.

| save rev | instance | start (log clock) | start → done ms | sets | skips | warm builds (unmatched) | job-failed |
|---|---|---|---|---|---|---|---|
| 1668 | 23a6a9e8 | 07:56:08 | 124 | ko r1668 80830 B 54/8 ms; ja r1668 67230 B 87/6 ms; en r1668 79463 B 52/8 ms | — | 3 | — |
| 1669 | 23a6a9e8 | 07:56:48 | 106 | ko r1669 59971 B 54/8 ms; ja r1669 49958 B 59/10 ms; en r1669 59042 B 38/6 ms | — | 3 | — |
| 1670 | 23a6a9e8 | 07:57:48 | 98 | ko r1670 59946 B 42/8 ms; ja r1670 49939 B 74/6 ms; en r1670 59021 B 40/7 ms | — | 3 | — |
| 1671 | 23a6a9e8 | 07:57:50 | 89 | ko r1671 59217 B 38/6 ms; ja r1671 49273 B 51/6 ms; en r1671 58297 B 38/7 ms | — | 3 | — |
| 1672 | 23a6a9e8 | 07:57:51 | 92 | ko r1672 59216 B 39/7 ms; ja r1672 49272 B 52/5 ms; en r1672 58296 B 39/7 ms | — | 3 | — |

Per save rev. builds = every `[liveSnapshot] build` at that rev; warm = the ones matched to a warm job (same instance, locale, rev); reader = the rest. Lookups and hinted fetches are keyed by their `minRev`.

| save rev | warm jobs | start → done ms | builds | warm | reader | hinted fetches | lookups | hit | miss | stale | invalid | error | timeout | memo-miss | capped | other | lookup ms p50 / p95 | hit rate |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1668 | 1 | 124 | 32 | 3 | 29 | 25 | 25 | 25 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 10 / 27 | 100.0 % |
| 1669 | 1 | 106 | 59 | 3 | 56 | 25 | 25 | 25 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 8 / 20 | 100.0 % |
| 1670 | 1 | 98 | 4 | 3 | 1 | 25 | 25 | 25 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 7 / 9 | 100.0 % |
| 1671 | 1 | 89 | 3 | 3 | 0 | 25 | 25 | 25 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 7 / 23 | 100.0 % |
| 1672 | 1 | 92 | 31 | 3 | 28 | 24 | 24 | 24 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 7 / 9 | 100.0 % |

Lookup ms by result (p50 / p95, n): hit 8 / 20 (124). Whole capture: hit 124, miss 0, stale 0, invalid 0, error 0, timeout 0, memo-miss 0, capped 0, other 0.

| minute | lookups | hit | miss | stale | invalid | error | timeout | memo-miss | capped | other |
|---|---|---|---|---|---|---|---|---|---|---|
| 07:56 | 50 | 50 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| 07:57 | 74 | 74 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |

### Admin writes (`[liveWriter]`)

| route | saves | acquire ms p50 / p95 | exec ms p50 / p95 | ok=false | failed kinds |
|---|---|---|---|---|---|
| admin-insert-after | 1 | 3 / 3 | 170 / 170 | 0 | — |
| admin-update | 2 | 3 / 4 | 39 / 68 | 0 | — |
| admin-delete | 2 | 2 / 3 | 16 / 16 | 0 | — |

Every save (routes with ≤ 12 saves; `at` = the server's commit time, epoch ms → UTC):

| route | rev | acquire ms | exec ms | ok | at (UTC) | instance |
|---|---|---|---|---|---|---|
| admin-insert-after | 1668 | 3 | 170 | true | 2026-10-12T07:56:08.454Z | 23a6a9e8 |
| admin-update | 1669 | 4 | 68 | true | 2026-10-12T07:56:48.348Z | 23a6a9e8 |
| admin-update | 1670 | 3 | 39 | true | 2026-10-12T07:57:48.414Z | 23a6a9e8 |
| admin-delete | 1671 | 2 | 16 | true | 2026-10-12T07:57:50.469Z | 23a6a9e8 |
| admin-delete | 1672 | 3 | 16 | true | 2026-10-12T07:57:51.739Z | 23a6a9e8 |

### Per minute

| minute | requests | distinct instances | builds | EMAXCONN |
|---|---|---|---|---|
| 07:52 | 1 | 0 | 0 | 0 |
| 07:56 | 179 | 11 | 64 | 0 |
| 07:57 | 157 | 5 | 62 | 0 |
| 07:58 | 22 | 1 | 19 | 0 |

### Prisma pool totals per 5 s (app-side estimate of pooler clients)

Peak carried sum: **12** (carry 5 s). "reported" = instances that logged in the bucket (max total each); "carried" also counts an instance's last total for 5 s after its last line.

| bucket | reporting instances | Σ total (reported) | instances (carried) | Σ total (carried) | max waiting |
|---|---|---|---|---|---|
| 07:56:00 | 11 | 11 | 11 | 11 | 0 |
| 07:56:05 | 1 | 2 | 11 | 12 | 0 |
| 07:56:10 | 1 | 2 | 1 | 2 | 0 |
| 07:56:15 | 4 | 5 | 4 | 5 | 0 |
| 07:56:20 | 3 | 4 | 4 | 5 | 0 |
| 07:56:25 | 0 | 0 | 3 | 3 | 0 |
| 07:56:30 | 1 | 1 | 1 | 1 | 0 |
| 07:56:35 | 2 | 3 | 2 | 3 | 0 |
| 07:56:40 | 2 | 3 | 2 | 3 | 0 |
| 07:56:45 | 1 | 2 | 2 | 3 | 0 |
| 07:56:50 | 1 | 2 | 1 | 2 | 0 |
| 07:56:55 | 1 | 1 | 1 | 1 | 0 |
| 07:57:00 | 1 | 1 | 1 | 1 | 0 |
| 07:57:05 | 1 | 1 | 1 | 1 | 0 |
| 07:57:10 | 1 | 1 | 1 | 1 | 0 |
| 07:57:15 | 1 | 1 | 1 | 1 | 0 |
| 07:57:20 | 1 | 1 | 1 | 1 | 0 |
| 07:57:25 | 1 | 1 | 1 | 1 | 0 |
| 07:57:30 | 1 | 1 | 1 | 1 | 0 |
| 07:57:35 | 1 | 1 | 1 | 1 | 0 |
| 07:57:40 | 2 | 2 | 2 | 2 | 0 |
| 07:57:45 | 2 | 3 | 2 | 3 | 0 |
| 07:57:50 | 1 | 2 | 2 | 3 | 0 |
| 07:57:55 | 1 | 2 | 1 | 2 | 0 |
| 07:58:00 | 1 | 1 | 1 | 1 | 0 |
| 07:58:05 | 1 | 1 | 1 | 1 | 0 |
| 07:58:10 | 1 | 1 | 1 | 1 | 0 |
| 07:58:15 | 1 | 1 | 1 | 1 | 0 |
| 07:58:20 | 1 | 1 | 1 | 1 | 0 |
| 07:58:25 | 1 | 1 | 1 | 1 | 0 |
| 07:58:30 | 1 | 1 | 1 | 1 | 0 |
| 07:58:35 | 1 | 2 | 1 | 2 | 0 |
| 07:58:40 | 1 | 1 | 1 | 1 | 0 |
| 07:58:45 | 0 | 0 | 1 | 1 | 0 |
| 07:58:50 | 1 | 1 | 1 | 1 | 0 |

### Other lines

| kind | count |
|---|---|
| untagged: No logs found for opensetlist-projects/opensetlist | 9 |
