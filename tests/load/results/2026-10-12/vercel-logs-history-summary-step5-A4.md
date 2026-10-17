## Vercel runtime logs — 2026-10-12T07-11-58Z-vercel-logs-history-step5-A4.txt

5524 entries; requests: /api/setlist 5018, other API 74, pages 432; error-level entries 0. Times: log clock +7 h.

### Builds per rev (`[liveSnapshot] build` lines: 1000)

| rev | builds | distinct instances | locales | build ms avg / max | first – last |
|---|---|---|---|---|---|
| 1649 | 147 | 81 | en 20, ko 14, ja 113 | 814 / 1320 | 07:14:32 – 07:14:36 |
| 1650 | 133 | 76 | ja 83, en 26, ko 24 | 604 / 1147 | 07:14:35 – 07:14:38 |
| 1651 | 255 | 80 | ko 70, ja 137, en 48 | 688 / 2653 | 07:14:38 – 07:14:52 |
| 1652 | 200 | 15 | ja 124, en 26, ko 50 | 82 / 189 | 07:14:52 – 07:15:17 |
| 1653 | 221 | 13 | ja 150, ko 46, en 25 | 85 / 237 | 07:15:17 – 07:15:47 |
| 1654 | 20 | 13 | en 5, ja 13, ko 2 | 99 / 179 | 07:15:48 – 07:15:49 |
| 1655 | 24 | 14 | ja 12, en 6, ko 6 | 82 / 220 | 07:15:49 – 07:15:51 |

### Failures, repair reads, coalescing

| what | count | detail |
|---|---|---|
| EMAXCONN (pooler client cap) | 0 | API 0, SSR 0 |
| `[liveSnapshot] build-failed` | 0 | — |
| `[liveSnapshot] rev-read` (repair revision read) | 0 | rev=timeout 0, rev=error 0; ms p50 — / max —; by hint: — |
| `[liveSnapshot] coalesced` | 227 | waiters sum 808, max 18 |
| `[setlist] slow-hit` | 0 | max — ms |

### Hint outcomes (`[setlist] hint-fetch` lines: 2433)

Whole capture: satisfied 2433, fresh 0, memo 0, deferred 0, none 0, error 0, other 0. "other" = a `verify=` value this script does not know.

| minute | hint fetches | satisfied | fresh | memo | deferred | none | error | other |
|---|---|---|---|---|---|---|---|---|
| 07:14 | 975 | 975 | 0 | 0 | 0 | 0 | 0 | 0 |
| 07:15 | 1458 | 1458 | 0 | 0 | 0 | 0 | 0 | 0 |

### Warming (`[liveWarm]` jobs: 6; `[setlist] warm-lookup` lines: 2433)

**warm hit rate = hits ÷ hinted fetches = 2128 / 2433 = 87.5 %** (hinted fetches = `[setlist] hint-fetch` lines with a numeric minRev; lookups 2433).

schedule-failed 0; job-failed 0; set ok=false 0 (set-error lines 0); skips 0; lookup-error lines 0; warm builds matched 18.

Warm jobs. start → done = the job's own `done ms=` (it starts in `after()`, i.e. right after the save's response, so it is ≈ warm-complete − commit). Per locale: actual rev, bytes, build / set ms, ok.

| save rev | instance | start (log clock) | start → done ms | sets | skips | warm builds (unmatched) | job-failed |
|---|---|---|---|---|---|---|---|
| 1650 | a24596ba | 07:14:35 | 1227 | ja r1650 147962 B 501/9 ms; en r1650 175094 B 948/10 ms; ko r1650 177863 B 253/12 ms | — | 3 | — |
| 1651 | 691c7002 | 07:14:38 | 2682 | ja r1651 147943 B 600/14 ms; ko r1651 177838 B 644/10 ms; en r1651 175073 B 2042/25 ms | — | 3 | — |
| 1652 | 292622a0 | 07:14:52 | 172 | ko r1652 178131 B 76/15 ms; ja r1652 148155 B 110/12 ms; en r1652 175353 B 66/14 ms | — | 3 | — |
| 1653 | 5ee856ce | 07:15:17 | 199 | ko r1653 178161 B 81/19 ms; ja r1653 148191 B 95/11 ms; en r1653 175386 B 89/8 ms | — | 3 | — |
| 1654 | db5794bb | 07:15:48 | 252 | ko r1654 177109 B 73/15 ms; ja r1654 147277 B 97/62 ms; en r1654 174349 B 155/9 ms | — | 3 | — |
| 1655 | 389b0d8c | 07:15:49 | 221 | ko r1655 177108 B 67/32 ms; ja r1655 147276 B 146/30 ms; en r1655 174348 B 110/9 ms | — | 3 | — |

Per save rev. builds = every `[liveSnapshot] build` at that rev; warm = the ones matched to a warm job (same instance, locale, rev); reader = the rest. Lookups and hinted fetches are keyed by their `minRev`.

| save rev | warm jobs | start → done ms | builds | warm | reader | hinted fetches | lookups | hit | miss | stale | invalid | error | timeout | memo-miss | capped | other | lookup ms p50 / p95 | hit rate |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1650 | 1 | 1227 | 133 | 3 | 130 | 205 | 205 | 101 | 64 | 0 | 0 | 0 | 0 | 40 | 0 | 0 | 13 / 42 | 49.3 % |
| 1651 | 1 | 2682 | 255 | 3 | 252 | 283 | 283 | 84 | 84 | 0 | 0 | 0 | 0 | 115 | 0 | 0 | 3 / 19 | 29.7 % |
| 1652 | 1 | 172 | 200 | 3 | 197 | 487 | 487 | 487 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 17 / 57 | 100.0 % |
| 1653 | 1 | 199 | 221 | 3 | 218 | 481 | 481 | 481 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 17 / 62 | 100.0 % |
| 1654 | 1 | 252 | 20 | 3 | 17 | 486 | 486 | 486 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 17 / 51 | 100.0 % |
| 1655 | 1 | 221 | 24 | 3 | 21 | 491 | 491 | 489 | 1 | 0 | 0 | 0 | 0 | 1 | 0 | 0 | 15 / 31 | 99.6 % |

Lookup ms by result (p50 / p95, n): hit 17 / 51 (2128); miss 4 / 10 (149); memo-miss 0 / 0 (156). Whole capture: hit 2128, miss 149, stale 0, invalid 0, error 0, timeout 0, memo-miss 156, capped 0, other 0.

| minute | lookups | hit | miss | stale | invalid | error | timeout | memo-miss | capped | other |
|---|---|---|---|---|---|---|---|---|---|---|
| 07:14 | 975 | 672 | 148 | 0 | 0 | 0 | 0 | 155 | 0 | 0 |
| 07:15 | 1458 | 1456 | 1 | 0 | 0 | 0 | 0 | 1 | 0 | 0 |

### Admin writes (`[liveWriter]`)

| route | saves | acquire ms p50 / p95 | exec ms p50 / p95 | ok=false | failed kinds |
|---|---|---|---|---|---|
| admin-update | 4 | 3 / 794 | 93 / 176 | 0 | — |
| admin-delete | 2 | 3 / 4 | 25 / 27 | 0 | — |

Every save (routes with ≤ 12 saves; `at` = the server's commit time, epoch ms → UTC):

| route | rev | acquire ms | exec ms | ok | at (UTC) | instance |
|---|---|---|---|---|---|---|
| admin-update | 1650 | 794 | 93 | true | 2026-10-12T07:14:37.068Z | a24596ba |
| admin-update | 1651 | 76 | 176 | true | 2026-10-12T07:14:39.122Z | 691c7002 |
| admin-update | 1652 | 3 | 97 | true | 2026-10-12T07:14:52.737Z | 292622a0 |
| admin-update | 1653 | 3 | 59 | true | 2026-10-12T07:15:17.715Z | 5ee856ce |
| admin-delete | 1654 | 3 | 27 | true | 2026-10-12T07:15:48.655Z | db5794bb |
| admin-delete | 1655 | 4 | 25 | true | 2026-10-12T07:15:50.171Z | 389b0d8c |

### Per minute

| minute | requests | distinct instances | builds | EMAXCONN |
|---|---|---|---|---|
| 07:14 | 2823 | 105 | 625 | 0 |
| 07:15 | 2701 | 64 | 375 | 0 |

### Prisma pool totals per 5 s (app-side estimate of pooler clients)

Peak carried sum: **167** (carry 5 s). "reported" = instances that logged in the bucket (max total each); "carried" also counts an instance's last total for 5 s after its last line.

| bucket | reporting instances | Σ total (reported) | instances (carried) | Σ total (carried) | max waiting |
|---|---|---|---|---|---|
| 07:14:30 | 81 | 93 | 81 | 93 | 0 |
| 07:14:35 | 91 | 157 | 101 | 167 | 5 |
| 07:14:40 | 50 | 90 | 92 | 159 | 2 |
| 07:14:45 | 11 | 18 | 53 | 90 | 1 |
| 07:14:50 | 16 | 20 | 21 | 30 | 0 |
| 07:14:55 | 10 | 14 | 16 | 21 | 0 |
| 07:15:00 | 9 | 10 | 10 | 11 | 0 |
| 07:15:05 | 3 | 3 | 9 | 9 | 0 |
| 07:15:10 | 4 | 8 | 4 | 8 | 0 |
| 07:15:15 | 12 | 17 | 12 | 17 | 0 |
| 07:15:20 | 11 | 16 | 13 | 18 | 0 |
| 07:15:25 | 7 | 8 | 11 | 13 | 0 |
| 07:15:30 | 7 | 9 | 7 | 9 | 0 |
| 07:15:35 | 6 | 9 | 7 | 10 | 0 |
| 07:15:40 | 5 | 8 | 6 | 10 | 0 |
| 07:15:45 | 14 | 19 | 14 | 19 | 0 |
| 07:15:50 | 14 | 17 | 20 | 24 | 0 |

### Other lines

| kind | count |
|---|---|
| untagged: No logs found for opensetlist-projects/opensetlist | 10 |
