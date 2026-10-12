## Vercel runtime logs — 2026-10-12T08-27-40Z-vercel-logs-history-step5-I1b.txt

362 entries; requests: /api/setlist 356, other API 6, pages 0; error-level entries 0. Times: log clock +7 h.

### Builds per rev (`[liveSnapshot] build` lines: 176)

| rev | builds | distinct instances | locales | build ms avg / max | first – last |
|---|---|---|---|---|---|
| 1672 | 48 | 26 | ja 34, ko 11, en 3 | 366 / 759 | 08:31:00 – 08:31:10 |
| 1673 | 33 | 1 | ko 9, ja 20, en 4 | 59 / 112 | 08:31:12 – 08:31:50 |
| 1674 | 56 | 1 | ja 35, en 9, ko 12 | 46 / 86 | 08:31:52 – 08:32:51 |
| 1675 | 4 | 1 | ja 2, ko 1, en 1 | 43 / 62 | 08:32:52 – 08:32:53 |
| 1676 | 6 | 1 | ja 2, ko 3, en 1 | 35 / 39 | 08:32:54 – 08:32:55 |
| 1677 | 29 | 1 | ja 18, ko 7, en 4 | 42 / 97 | 08:32:55 – 08:33:55 |

### Failures, repair reads, coalescing

| what | count | detail |
|---|---|---|
| EMAXCONN (pooler client cap) | 0 | API 0, SSR 0 |
| `[liveSnapshot] build-failed` | 0 | — |
| `[liveSnapshot] rev-read` (repair revision read) | 0 | rev=timeout 0, rev=error 0; ms p50 — / max —; by hint: — |
| `[liveSnapshot] coalesced` | 1 | waiters sum 2, max 2 |
| `[setlist] slow-hit` | 0 | max — ms |

### Hint outcomes (`[setlist] hint-fetch` lines: 123)

Whole capture: satisfied 123, fresh 0, memo 0, deferred 0, none 0, error 0, other 0. "other" = a `verify=` value this script does not know.

| minute | hint fetches | satisfied | fresh | memo | deferred | none | error | other |
|---|---|---|---|---|---|---|---|---|
| 08:31 | 49 | 49 | 0 | 0 | 0 | 0 | 0 | 0 |
| 08:32 | 74 | 74 | 0 | 0 | 0 | 0 | 0 | 0 |

### Warming (`[liveWarm]` jobs: 5; `[setlist] warm-lookup` lines: 123)

**warm hit rate = hits ÷ hinted fetches = 123 / 123 = 100.0 %** (hinted fetches = `[setlist] hint-fetch` lines with a numeric minRev; lookups 123).

schedule-failed 0; job-failed 0; set ok=false 0 (set-error lines 0); skips 0; lookup-error lines 0; warm builds matched 15.

Warm jobs. start → done = the job's own `done ms=` (it starts in `after()`, i.e. right after the save's response, so it is ≈ warm-complete − commit). Per locale: actual rev, bytes, build / set ms, ok.

| save rev | instance | start (log clock) | start → done ms | sets | skips | warm builds (unmatched) | job-failed |
|---|---|---|---|---|---|---|---|
| 1673 | 4c3d92e6 | 08:31:12 | 227 | ko r1673 80830 B 70/13 ms; ja r1673 67230 B 101/10 ms; en r1673 79463 B 122/21 ms | — | 3 | — |
| 1674 | 4c3d92e6 | 08:31:52 | 129 | ko r1674 59971 B 54/7 ms; ja r1674 49958 B 68/6 ms; en r1674 59042 B 62/6 ms | — | 3 | — |
| 1675 | 4c3d92e6 | 08:32:52 | 89 | ko r1675 60239 B 39/7 ms; ja r1675 50151 B 63/5 ms; en r1675 59301 B 37/6 ms | — | 3 | — |
| 1676 | 4c3d92e6 | 08:32:54 | 84 | ja r1676 49273 B 35/8 ms; ko r1676 59217 B 40/13 ms; en r1676 58297 B 35/6 ms | — | 3 | — |
| 1677 | 4c3d92e6 | 08:32:55 | 83 | ja r1677 49272 B 36/7 ms; ko r1677 59216 B 41/6 ms; en r1677 58296 B 35/5 ms | — | 3 | — |

Per save rev. builds = every `[liveSnapshot] build` at that rev; warm = the ones matched to a warm job (same instance, locale, rev); reader = the rest. Lookups and hinted fetches are keyed by their `minRev`.

| save rev | warm jobs | start → done ms | builds | warm | reader | hinted fetches | lookups | hit | miss | stale | invalid | error | timeout | memo-miss | capped | other | lookup ms p50 / p95 | hit rate |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1673 | 1 | 227 | 33 | 3 | 30 | 25 | 25 | 25 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 10 / 17 | 100.0 % |
| 1674 | 1 | 129 | 56 | 3 | 53 | 24 | 24 | 24 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 9 / 37 | 100.0 % |
| 1675 | 1 | 89 | 4 | 3 | 1 | 25 | 25 | 25 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 9 / 44 | 100.0 % |
| 1676 | 1 | 84 | 6 | 3 | 3 | 24 | 24 | 24 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 8 / 10 | 100.0 % |
| 1677 | 1 | 83 | 29 | 3 | 26 | 25 | 25 | 25 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 8 / 12 | 100.0 % |

Lookup ms by result (p50 / p95, n): hit 9 / 24 (123). Whole capture: hit 123, miss 0, stale 0, invalid 0, error 0, timeout 0, memo-miss 0, capped 0, other 0.

| minute | lookups | hit | miss | stale | invalid | error | timeout | memo-miss | capped | other |
|---|---|---|---|---|---|---|---|---|---|---|
| 08:31 | 49 | 49 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| 08:32 | 74 | 74 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |

### Admin writes (`[liveWriter]`)

| route | saves | acquire ms p50 / p95 | exec ms p50 / p95 | ok=false | failed kinds |
|---|---|---|---|---|---|
| admin-insert-after | 1 | 4 / 4 | 232 / 232 | 0 | — |
| admin-update | 2 | 3 / 4 | 36 / 64 | 0 | — |
| admin-delete | 2 | 2 / 3 | 15 / 16 | 0 | — |

Every save (routes with ≤ 12 saves; `at` = the server's commit time, epoch ms → UTC):

| route | rev | acquire ms | exec ms | ok | at (UTC) | instance |
|---|---|---|---|---|---|---|
| admin-insert-after | 1673 | 4 | 232 | true | 2026-10-12T08:31:13.129Z | 4c3d92e6 |
| admin-update | 1674 | 4 | 64 | true | 2026-10-12T08:31:52.341Z | 4c3d92e6 |
| admin-update | 1675 | 3 | 36 | true | 2026-10-12T08:32:52.295Z | 4c3d92e6 |
| admin-delete | 1676 | 3 | 15 | true | 2026-10-12T08:32:54.300Z | 4c3d92e6 |
| admin-delete | 1677 | 2 | 16 | true | 2026-10-12T08:32:55.591Z | 4c3d92e6 |

### Per minute

| minute | requests | distinct instances | builds | EMAXCONN |
|---|---|---|---|---|
| 08:27 | 1 | 0 | 0 | 0 |
| 08:31 | 174 | 26 | 91 | 0 |
| 08:32 | 160 | 6 | 60 | 0 |
| 08:33 | 27 | 1 | 25 | 0 |

### Prisma pool totals per 5 s (app-side estimate of pooler clients)

Peak carried sum: **30** (carry 5 s). "reported" = instances that logged in the bucket (max total each); "carried" also counts an instance's last total for 5 s after its last line.

| bucket | reporting instances | Σ total (reported) | instances (carried) | Σ total (carried) | max waiting |
|---|---|---|---|---|---|
| 08:31:00 | 26 | 30 | 26 | 30 | 0 |
| 08:31:05 | 1 | 1 | 26 | 30 | 0 |
| 08:31:10 | 1 | 2 | 1 | 2 | 0 |
| 08:31:15 | 1 | 2 | 1 | 2 | 0 |
| 08:31:20 | 1 | 2 | 1 | 2 | 0 |
| 08:31:25 | 1 | 2 | 1 | 2 | 0 |
| 08:31:30 | 1 | 1 | 1 | 1 | 0 |
| 08:31:35 | 1 | 2 | 1 | 2 | 0 |
| 08:31:40 | 1 | 2 | 1 | 2 | 0 |
| 08:31:45 | 1 | 2 | 1 | 2 | 0 |
| 08:31:50 | 1 | 2 | 1 | 2 | 0 |
| 08:31:55 | 1 | 2 | 1 | 2 | 0 |
| 08:32:00 | 1 | 2 | 1 | 2 | 0 |
| 08:32:05 | 1 | 2 | 1 | 2 | 0 |
| 08:32:10 | 1 | 1 | 1 | 1 | 0 |
| 08:32:15 | 1 | 1 | 1 | 1 | 0 |
| 08:32:20 | 1 | 1 | 1 | 1 | 0 |
| 08:32:25 | 1 | 1 | 1 | 1 | 0 |
| 08:32:30 | 1 | 1 | 1 | 1 | 0 |
| 08:32:35 | 1 | 1 | 1 | 1 | 0 |
| 08:32:40 | 1 | 1 | 1 | 1 | 0 |
| 08:32:45 | 1 | 1 | 1 | 1 | 0 |
| 08:32:50 | 1 | 2 | 1 | 2 | 0 |
| 08:32:55 | 1 | 2 | 1 | 2 | 0 |
| 08:33:00 | 1 | 2 | 1 | 2 | 0 |
| 08:33:05 | 1 | 1 | 1 | 1 | 0 |
| 08:33:10 | 1 | 1 | 1 | 1 | 0 |
| 08:33:15 | 1 | 1 | 1 | 1 | 0 |
| 08:33:20 | 1 | 1 | 1 | 1 | 0 |
| 08:33:25 | 1 | 1 | 1 | 1 | 0 |
| 08:33:30 | 1 | 2 | 1 | 2 | 0 |
| 08:33:35 | 1 | 1 | 1 | 1 | 0 |
| 08:33:40 | 1 | 1 | 1 | 1 | 0 |
| 08:33:45 | 1 | 1 | 1 | 1 | 0 |
| 08:33:50 | 1 | 1 | 1 | 1 | 0 |
| 08:33:55 | 1 | 1 | 1 | 1 | 0 |

### Other lines

| kind | count |
|---|---|
| untagged: No logs found for opensetlist-projects/opensetlist | 9 |
