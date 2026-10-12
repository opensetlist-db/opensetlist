## Vercel runtime logs — 2026-10-12T06-50-04Z-vercel-logs-history-step5-A1.txt

3495 entries; requests: /api/setlist 2890, other API 4, pages 601; error-level entries 0. Times: log clock +7 h.

### Builds per rev (`[liveSnapshot] build` lines: 1221)

| rev | builds | distinct instances | locales | build ms avg / max | first – last |
|---|---|---|---|---|---|
| 1615 | 168 | 96 | ja 122, en 16, ko 30 | 328 / 749 | 06:52:22 – 06:52:27 |
| 1616 | 363 | 105 | en 39, ja 244, ko 80 | 124 / 676 | 06:52:27 – 06:52:41 |
| 1617 | 684 | 52 | en 88, ko 174, ja 422 | 81 / 460 | 06:52:42 – 06:53:37 |
| 1618 | 3 | 1 | ko 1, ja 1, en 1 | 57 / 97 | 06:55:08 – 06:55:08 |
| 1619 | 3 | 1 | ja 1, ko 1, en 1 | 32 / 35 | 06:55:10 – 06:55:10 |

### Failures, repair reads, coalescing

| what | count | detail |
|---|---|---|
| EMAXCONN (pooler client cap) | 0 | API 0, SSR 0 |
| `[liveSnapshot] build-failed` | 0 | — |
| `[liveSnapshot] rev-read` (repair revision read) | 0 | rev=timeout 0, rev=error 0; ms p50 — / max —; by hint: — |
| `[liveSnapshot] coalesced` | 123 | waiters sum 332, max 7 |
| `[setlist] slow-hit` | 0 | max — ms |

### Hint outcomes (`[setlist] hint-fetch` lines: 471)

Whole capture: satisfied 471, fresh 0, memo 0, deferred 0, none 0, error 0, other 0. "other" = a `verify=` value this script does not know.

| minute | hint fetches | satisfied | fresh | memo | deferred | none | error | other |
|---|---|---|---|---|---|---|---|---|
| 06:52 | 471 | 471 | 0 | 0 | 0 | 0 | 0 | 0 |

### Warming (`[liveWarm]` jobs: 4; `[setlist] warm-lookup` lines: 471)

**warm hit rate = hits ÷ hinted fetches = 471 / 471 = 100.0 %** (hinted fetches = `[setlist] hint-fetch` lines with a numeric minRev; lookups 471).

schedule-failed 0; job-failed 0; set ok=false 0 (set-error lines 0); skips 0; lookup-error lines 0; warm builds matched 12.

Warm jobs. start → done = the job's own `done ms=` (it starts in `after()`, i.e. right after the save's response, so it is ≈ warm-complete − commit). Per locale: actual rev, bytes, build / set ms, ok.

| save rev | instance | start (log clock) | start → done ms | sets | skips | warm builds (unmatched) | job-failed |
|---|---|---|---|---|---|---|---|
| 1616 | 5e6f7198 | 06:52:27 | 144 | ko r1616 59971 B 73/20 ms; ja r1616 49958 B 80/24 ms; en r1616 59042 B 40/9 ms | — | 3 | — |
| 1617 | 7dfc0ccc | 06:52:42 | 131 | ja r1617 49957 B 49/8 ms; ko r1617 59970 B 61/12 ms; en r1617 59041 B 68/5 ms | — | 3 | — |
| 1618 | 7dfc0ccc | 06:55:08 | 143 | ko r1618 59216 B 34/6 ms; ja r1618 49272 B 42/27 ms; en r1618 58296 B 98/5 ms | — | 3 | — |
| 1619 | 7dfc0ccc | 06:55:10 | 75 | ja r1619 49272 B 30/8 ms; ko r1619 59216 B 35/12 ms; en r1619 58296 B 32/5 ms | — | 3 | — |

Per save rev. builds = every `[liveSnapshot] build` at that rev; warm = the ones matched to a warm job (same instance, locale, rev); reader = the rest. Lookups and hinted fetches are keyed by their `minRev`.

| save rev | warm jobs | start → done ms | builds | warm | reader | hinted fetches | lookups | hit | miss | stale | invalid | error | timeout | memo-miss | capped | other | lookup ms p50 / p95 | hit rate |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1616 | 1 | 144 | 363 | 3 | 360 | 167 | 167 | 167 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 10 / 111 | 100.0 % |
| 1617 | 1 | 131 | 684 | 3 | 681 | 304 | 304 | 304 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 9 / 24 | 100.0 % |
| 1618 | 1 | 143 | 3 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — / — | — |
| 1619 | 1 | 75 | 3 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — / — | — |

Lookup ms by result (p50 / p95, n): hit 9 / 29 (471). Whole capture: hit 471, miss 0, stale 0, invalid 0, error 0, timeout 0, memo-miss 0, capped 0, other 0.

| minute | lookups | hit | miss | stale | invalid | error | timeout | memo-miss | capped | other |
|---|---|---|---|---|---|---|---|---|---|---|
| 06:52 | 471 | 471 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |

### Admin writes (`[liveWriter]`)

| route | saves | acquire ms p50 / p95 | exec ms p50 / p95 | ok=false | failed kinds |
|---|---|---|---|---|---|
| admin-update | 2 | 3 / 4 | 72 / 81 | 0 | — |
| admin-delete | 2 | 2 / 3 | 14 / 17 | 0 | — |

Every save (routes with ≤ 12 saves; `at` = the server's commit time, epoch ms → UTC):

| route | rev | acquire ms | exec ms | ok | at (UTC) | instance |
|---|---|---|---|---|---|---|
| admin-update | 1616 | 3 | 72 | true | 2026-10-12T06:52:27.568Z | 5e6f7198 |
| admin-update | 1617 | 4 | 81 | true | 2026-10-12T06:52:42.601Z | 7dfc0ccc |
| admin-delete | 1618 | 3 | 17 | true | 2026-10-12T06:55:09.074Z | 7dfc0ccc |
| admin-delete | 1619 | 2 | 14 | true | 2026-10-12T06:55:10.357Z | 7dfc0ccc |

### Per minute

| minute | requests | distinct instances | builds | EMAXCONN |
|---|---|---|---|---|
| 06:52 | 2340 | 139 | 909 | 0 |
| 06:53 | 1153 | 10 | 306 | 0 |
| 06:55 | 2 | 1 | 6 | 0 |

### Prisma pool totals per 5 s (app-side estimate of pooler clients)

Peak carried sum: **187** (carry 5 s). "reported" = instances that logged in the bucket (max total each); "carried" also counts an instance's last total for 5 s after its last line.

| bucket | reporting instances | Σ total (reported) | instances (carried) | Σ total (carried) | max waiting |
|---|---|---|---|---|---|
| 06:52:20 | 88 | 107 | 88 | 107 | 0 |
| 06:52:25 | 109 | 159 | 131 | 187 | 0 |
| 06:52:30 | 29 | 46 | 113 | 166 | 0 |
| 06:52:35 | 8 | 16 | 29 | 47 | 0 |
| 06:52:40 | 51 | 83 | 55 | 91 | 10 |
| 06:52:45 | 23 | 39 | 51 | 82 | 0 |
| 06:52:50 | 13 | 16 | 23 | 31 | 3 |
| 06:52:55 | 13 | 16 | 13 | 16 | 0 |
| 06:53:00 | 9 | 12 | 13 | 16 | 2 |
| 06:53:05 | 8 | 11 | 10 | 14 | 1 |
| 06:53:10 | 8 | 11 | 8 | 11 | 0 |
| 06:53:15 | 7 | 12 | 8 | 13 | 0 |
| 06:53:20 | 7 | 12 | 7 | 12 | 0 |
| 06:53:25 | 4 | 5 | 7 | 10 | 0 |
| 06:53:30 | 4 | 5 | 5 | 6 | 0 |
| 06:53:35 | 4 | 5 | 4 | 5 | 0 |
| 06:53:40 | 0 | 0 | 4 | 5 | 0 |
| 06:55:05 | 1 | 2 | 1 | 2 | 0 |
| 06:55:10 | 1 | 2 | 1 | 2 | 0 |

### Other lines

| kind | count |
|---|---|
| untagged: No logs found for opensetlist-projects/opensetlist | 13 |
