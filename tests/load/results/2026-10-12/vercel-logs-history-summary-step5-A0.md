## Vercel runtime logs — 2026-10-12T06-35-41Z-vercel-logs-history-step5-A0.txt

5034 entries; requests: /api/setlist 4526, other API 76, pages 432; error-level entries 0. Times: log clock +7 h.

### Builds per rev (`[liveSnapshot] build` lines: 1021)

| rev | builds | distinct instances | locales | build ms avg / max | first – last |
|---|---|---|---|---|---|
| 1602 | 198 | 102 | ja 127, ko 45, en 26 | 545 / 1016 | 06:38:05 – 06:38:09 |
| 1603 | 281 | 65 | ko 67, ja 172, en 42 | 146 / 466 | 06:38:09 – 06:38:24 |
| 1604 | 245 | 16 | ja 166, ko 48, en 31 | 49 / 125 | 06:38:24 – 06:38:49 |
| 1605 | 246 | 15 | ja 159, ko 56, en 31 | 48 / 116 | 06:38:49 – 06:39:20 |
| 1606 | 30 | 11 | ja 22, ko 7, en 1 | 55 / 109 | 06:39:20 – 06:39:22 |
| 1607 | 21 | 10 | en 4, ko 7, ja 10 | 48 / 88 | 06:39:22 – 06:39:23 |

### Failures, repair reads, coalescing

| what | count | detail |
|---|---|---|
| EMAXCONN (pooler client cap) | 0 | API 0, SSR 0 |
| `[liveSnapshot] build-failed` | 0 | — |
| `[liveSnapshot] rev-read` (repair revision read) | 0 | rev=timeout 0, rev=error 0; ms p50 — / max —; by hint: — |
| `[liveSnapshot] coalesced` | 174 | waiters sum 478, max 9 |
| `[setlist] slow-hit` | 0 | max — ms |

### Hint outcomes (`[setlist] hint-fetch` lines: 1942)

Whole capture: satisfied 1942, fresh 0, memo 0, deferred 0, none 0, error 0, other 0. "other" = a `verify=` value this script does not know.

| minute | hint fetches | satisfied | fresh | memo | deferred | none | error | other |
|---|---|---|---|---|---|---|---|---|
| 06:38 | 965 | 965 | 0 | 0 | 0 | 0 | 0 | 0 |
| 06:39 | 977 | 977 | 0 | 0 | 0 | 0 | 0 | 0 |

### Warming (`[liveWarm]` jobs: 5; `[setlist] warm-lookup` lines: 1942)

**warm hit rate = hits ÷ hinted fetches = 1942 / 1942 = 100.0 %** (hinted fetches = `[setlist] hint-fetch` lines with a numeric minRev; lookups 1942).

schedule-failed 0; job-failed 0; set ok=false 0 (set-error lines 0); skips 0; lookup-error lines 0; warm builds matched 15.

Warm jobs. start → done = the job's own `done ms=` (it starts in `after()`, i.e. right after the save's response, so it is ≈ warm-complete − commit). Per locale: actual rev, bytes, build / set ms, ok.

| save rev | instance | start (log clock) | start → done ms | sets | skips | warm builds (unmatched) | job-failed |
|---|---|---|---|---|---|---|---|
| 1603 | 238a4c08 | 06:38:09 | 513 | ko r1603 59971 B 155/7 ms; ja r1603 49958 B 182/7 ms; en r1603 59042 B 342/7 ms | — | 3 | — |
| 1604 | fd6ec2cc | 06:38:24 | 101 | ko r1604 59970 B 43/9 ms; ja r1604 49957 B 62/7 ms; en r1604 59041 B 40/8 ms | — | 3 | — |
| 1605 | 0e63439c | 06:38:49 | 102 | ko r1605 60041 B 51/7 ms; ja r1605 49958 B 61/5 ms; en r1605 59106 B 37/6 ms | — | 3 | — |
| 1606 | 3a3a6bf2 | 06:39:20 | 104 | ko r1606 59217 B 46/8 ms; ja r1606 49273 B 69/5 ms; en r1606 58297 B 43/6 ms | — | 3 | — |
| 1607 | e5b6eac3 | 06:39:22 | 110 | ko r1607 59216 B 50/6 ms; ja r1607 49272 B 76/6 ms; en r1607 58296 B 46/5 ms | — | 3 | — |

Per save rev. builds = every `[liveSnapshot] build` at that rev; warm = the ones matched to a warm job (same instance, locale, rev); reader = the rest. Lookups and hinted fetches are keyed by their `minRev`.

| save rev | warm jobs | start → done ms | builds | warm | reader | hinted fetches | lookups | hit | miss | stale | invalid | error | timeout | memo-miss | capped | other | lookup ms p50 / p95 | hit rate |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1603 | 1 | 513 | 281 | 3 | 278 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — / — | — |
| 1604 | 1 | 101 | 245 | 3 | 242 | 488 | 488 | 488 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 8 / 24 | 100.0 % |
| 1605 | 1 | 102 | 246 | 3 | 243 | 477 | 477 | 477 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 8 / 25 | 100.0 % |
| 1606 | 1 | 104 | 30 | 3 | 27 | 491 | 491 | 491 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 8 / 19 | 100.0 % |
| 1607 | 1 | 110 | 21 | 3 | 18 | 486 | 486 | 486 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 8 / 12 | 100.0 % |

Lookup ms by result (p50 / p95, n): hit 8 / 20 (1942). Whole capture: hit 1942, miss 0, stale 0, invalid 0, error 0, timeout 0, memo-miss 0, capped 0, other 0.

| minute | lookups | hit | miss | stale | invalid | error | timeout | memo-miss | capped | other |
|---|---|---|---|---|---|---|---|---|---|---|
| 06:38 | 965 | 965 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| 06:39 | 977 | 977 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |

### Admin writes (`[liveWriter]`)

| route | saves | acquire ms p50 / p95 | exec ms p50 / p95 | ok=false | failed kinds |
|---|---|---|---|---|---|
| admin-update | 3 | 3 / 5 | 79 / 103 | 0 | — |
| admin-delete | 2 | 4 / 4 | 28 / 32 | 0 | — |

Every save (routes with ≤ 12 saves; `at` = the server's commit time, epoch ms → UTC):

| route | rev | acquire ms | exec ms | ok | at (UTC) | instance |
|---|---|---|---|---|---|---|
| admin-update | 1603 | 5 | 103 | true | 2026-10-12T06:38:10.081Z | 238a4c08 |
| admin-update | 1604 | 3 | 70 | true | 2026-10-12T06:38:25.037Z | fd6ec2cc |
| admin-update | 1605 | 2 | 79 | true | 2026-10-12T06:38:50.038Z | 0e63439c |
| admin-delete | 1606 | 4 | 28 | true | 2026-10-12T06:39:21.033Z | 3a3a6bf2 |
| admin-delete | 1607 | 4 | 32 | true | 2026-10-12T06:39:22.542Z | e5b6eac3 |

### Per minute

| minute | requests | distinct instances | builds | EMAXCONN |
|---|---|---|---|---|
| 06:38 | 3453 | 104 | 823 | 0 |
| 06:39 | 1581 | 41 | 198 | 0 |

### Prisma pool totals per 5 s (app-side estimate of pooler clients)

Peak carried sum: **169** (carry 5 s). "reported" = instances that logged in the bucket (max total each); "carried" also counts an instance's last total for 5 s after its last line.

| bucket | reporting instances | Σ total (reported) | instances (carried) | Σ total (carried) | max waiting |
|---|---|---|---|---|---|
| 06:38:05 | 102 | 133 | 102 | 133 | 0 |
| 06:38:10 | 63 | 113 | 104 | 169 | 0 |
| 06:38:15 | 16 | 24 | 64 | 106 | 0 |
| 06:38:20 | 4 | 7 | 16 | 25 | 0 |
| 06:38:25 | 16 | 25 | 16 | 25 | 0 |
| 06:38:30 | 7 | 10 | 16 | 25 | 0 |
| 06:38:35 | 5 | 6 | 7 | 9 | 0 |
| 06:38:40 | 3 | 4 | 5 | 6 | 0 |
| 06:38:45 | 5 | 10 | 5 | 10 | 0 |
| 06:38:50 | 15 | 23 | 15 | 23 | 0 |
| 06:38:55 | 6 | 7 | 15 | 18 | 0 |
| 06:39:00 | 5 | 7 | 6 | 8 | 0 |
| 06:39:05 | 5 | 8 | 5 | 8 | 0 |
| 06:39:10 | 4 | 7 | 5 | 9 | 0 |
| 06:39:15 | 3 | 5 | 4 | 6 | 0 |
| 06:39:20 | 13 | 17 | 14 | 19 | 0 |

### Other lines

| kind | count |
|---|---|
| untagged: No logs found for opensetlist-projects/opensetlist | 10 |
