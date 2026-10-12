## Vercel runtime logs — 2026-10-12T02-13-02Z-vercel-logs-history-step4-S2.txt

9054 entries; requests: /api/setlist 8458, other API 164, pages 432; error-level entries 0. Times: log clock +7 h.

### Builds per rev (`[liveSnapshot] build` lines: 2383)

| rev | builds | distinct instances | locales | build ms avg / max | first – last |
|---|---|---|---|---|---|
| 1333 | 1 | 1 | ko 1 | 486 / 486 | 02:13:37 – 02:13:37 |
| 1334 | 3 | 1 | ko 1, ja 1, en 1 | 52 / 72 | 02:13:40 – 02:13:40 |
| 1335 | 543 | 60 | en 87, ja 334, ko 122 | 256 / 912 | 02:13:40 – 02:14:06 |
| 1336 | 20 | 7 | ja 9, en 3, ko 8 | 61 / 101 | 02:14:05 – 02:14:06 |
| 1337 | 366 | 40 | ja 234, ko 87, en 45 | 93 / 332 | 02:14:05 – 02:14:31 |
| 1338 | 13 | 4 | en 2, ko 3, ja 8 | 49 / 73 | 02:14:30 – 02:14:31 |
| 1339 | 278 | 32 | en 49, ja 165, ko 64 | 115 / 421 | 02:14:30 – 02:14:55 |
| 1340 | 7 | 2 | ja 5, en 1, ko 1 | 47 / 75 | 02:14:55 – 02:14:56 |
| 1341 | 295 | 29 | ja 186, en 45, ko 64 | 72 / 304 | 02:14:55 – 02:15:21 |
| 1342 | 9 | 5 | ja 6, ko 3 | 49 / 74 | 02:15:20 – 02:15:21 |
| 1343 | 276 | 26 | en 37, ja 174, ko 65 | 77 / 352 | 02:15:20 – 02:15:45 |
| 1344 | 16 | 7 | ko 4, ja 10, en 2 | 45 / 96 | 02:15:45 – 02:15:46 |
| 1345 | 342 | 31 | ko 75, ja 208, en 59 | 85 / 367 | 02:15:45 – 02:16:11 |
| 1346 | 11 | 5 | ja 8, ko 2, en 1 | 42 / 62 | 02:16:10 – 02:16:11 |
| 1347 | 158 | 33 | en 30, ja 82, ko 46 | 117 / 261 | 02:16:10 – 02:16:16 |
| 1348 | 12 | 5 | ja 6, en 4, ko 2 | 41 / 51 | 02:16:16 – 02:16:16 |
| 1349 | 33 | 17 | ja 26, ko 4, en 3 | 46 / 88 | 02:16:16 – 02:16:18 |

### Failures, repair reads, coalescing

| what | count | detail |
|---|---|---|
| EMAXCONN (pooler client cap) | 0 | API 0, SSR 0 |
| `[liveSnapshot] build-failed` | 0 | — |
| `[liveSnapshot] rev-read` (repair revision read) | 0 | rev=timeout 0, rev=error 0; ms p50 — / max —; by hint: — |
| `[liveSnapshot] coalesced` | 434 | waiters sum 1438, max 13 |
| `[setlist] slow-hit` | 0 | max — ms |

### Hint outcomes (`[setlist] hint-fetch` lines: 3891)

Whole capture: satisfied 3891, fresh 0, memo 0, deferred 0, none 0, error 0, other 0. "other" = a `verify=` value this script does not know.

| minute | hint fetches | satisfied | fresh | memo | deferred | none | error | other |
|---|---|---|---|---|---|---|---|---|
| 02:14 | 1546 | 1546 | 0 | 0 | 0 | 0 | 0 | 0 |
| 02:15 | 1042 | 1042 | 0 | 0 | 0 | 0 | 0 | 0 |
| 02:16 | 1303 | 1303 | 0 | 0 | 0 | 0 | 0 | 0 |

### Warming (`[liveWarm]` jobs: 16; `[setlist] warm-lookup` lines: 3891)

**warm hit rate = hits ÷ hinted fetches = 2371 / 3891 = 60.9 %** (hinted fetches = `[setlist] hint-fetch` lines with a numeric minRev; lookups 3891).

schedule-failed 0; job-failed 0; set ok=false 0 (set-error lines 0); skips 0; lookup-error lines 0; warm builds matched 48.

Warm jobs. start → done = the job's own `done ms=` (it starts in `after()`, i.e. right after the save's response, so it is ≈ warm-complete − commit). Per locale: actual rev, bytes, build / set ms, ok.

| save rev | instance | start (log clock) | start → done ms | sets | skips | warm builds (unmatched) | job-failed |
|---|---|---|---|---|---|---|---|
| 1334 | 9f05b645 | 02:13:40 | 111 | ko r1334 80836 B 48/12 ms; ja r1334 67236 B 74/11 ms; en r1334 79469 B 42/8 ms | — | 3 | — |
| 1335 | 9f05b645 | 02:13:40 | 152 | ko r1335 102449 B 61/29 ms; ja r1335 85193 B 85/26 ms; en r1335 100635 B 44/9 ms | — | 3 | — |
| 1336 | cc1afb31 | 02:14:05 | 3159 | ko r1336 81571 B 63/10 ms; ja r1336 67905 B 70/11 ms; en r1337 59815 B 75/9 ms | — | 3 | — |
| 1337 | 3be4f9e6 | 02:14:06 | 388 | ko r1337 60761 B 148/8 ms; ja r1337 50612 B 192/6 ms; en r1337 59815 B 223/8 ms | — | 3 | — |
| 1338 | 62fc94ae | 02:14:30 | 3117 | ko r1338 60782 B 55/9 ms; ja r1338 50627 B 57/9 ms; en r1339 59775 B 43/9 ms | — | 3 | — |
| 1339 | ba09e515 | 02:14:31 | 420 | ko r1339 60713 B 121/8 ms; ja r1339 50625 B 163/6 ms; en r1339 59775 B 283/7 ms | — | 3 | — |
| 1340 | d1f443e5 | 02:14:55 | 3107 | en r1341 59908 B 36/8 ms; ko r1340 60820 B 54/7 ms; ja r1340 50649 B 77/5 ms | — | 3 | — |
| 1341 | d1f443e5 | 02:14:56 | 107 | ko r1341 60845 B 34/15 ms; ja r1341 50674 B 46/15 ms; en r1341 59908 B 40/17 ms | — | 3 | — |
| 1342 | 7b737ccf | 02:15:20 | 3107 | ko r1342 60831 B 51/7 ms; ja r1342 50671 B 75/6 ms; en r1343 59970 B 42/7 ms | — | 3 | — |
| 1343 | 7b737ccf | 02:15:21 | 210 | ko r1343 60913 B 50/13 ms; ja r1343 50689 B 154/7 ms; en r1343 59970 B 140/5 ms | — | 3 | — |
| 1344 | 3be4f9e6 | 02:15:45 | 3082 | ko r1344 60826 B 37/6 ms; ja r1344 50680 B 45/5 ms; en r1345 59791 B 32/7 ms | — | 3 | — |
| 1345 | cc1afb31 | 02:15:46 | 285 | en r1345 59791 B 182/8 ms; ja r1345 50646 B 87/7 ms; ko r1345 60728 B 101/7 ms | — | 3 | — |
| 1346 | d1f443e5 | 02:16:10 | 3089 | ja r1346 50653 B 33/7 ms; ko r1346 60813 B 45/6 ms; en r1347 59900 B 39/7 ms | — | 3 | — |
| 1347 | eb0eb601 | 02:16:11 | 207 | ja r1347 50678 B 75/7 ms; ko r1347 60838 B 93/8 ms; en r1347 59900 B 115/9 ms | — | 3 | — |
| 1348 | d1f443e5 | 02:16:16 | 103 | ja r1348 49982 B 37/7 ms; ko r1348 60070 B 49/6 ms; en r1348 59142 B 53/6 ms | — | 3 | — |
| 1349 | 62fc94ae | 02:16:16 | 101 | ko r1349 59223 B 42/7 ms; ja r1349 49279 B 46/21 ms; en r1349 58303 B 45/5 ms | — | 3 | — |

Per save rev. builds = every `[liveSnapshot] build` at that rev; warm = the ones matched to a warm job (same instance, locale, rev); reader = the rest. Lookups and hinted fetches are keyed by their `minRev`.

| save rev | warm jobs | start → done ms | builds | warm | reader | hinted fetches | lookups | hit | miss | stale | invalid | error | timeout | memo-miss | capped | other | lookup ms p50 / p95 | hit rate |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1334 | 1 | 111 | 3 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — / — | — |
| 1335 | 1 | 152 | 543 | 3 | 540 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — / — | — |
| 1336 | 1 | 3159 | 20 | 2 | 18 | 305 | 305 | 5 | 121 | 0 | 0 | 0 | 0 | 179 | 0 | 0 | 0 / 42 | 1.6 % |
| 1337 | 1 | 388 | 366 | 4 | 362 | 212 | 212 | 205 | 5 | 0 | 0 | 0 | 0 | 2 | 0 | 0 | 9 / 22 | 96.7 % |
| 1338 | 1 | 3117 | 13 | 2 | 11 | 278 | 278 | 5 | 104 | 0 | 0 | 0 | 0 | 169 | 0 | 0 | 0 / 15 | 1.8 % |
| 1339 | 1 | 420 | 278 | 4 | 274 | 245 | 245 | 241 | 4 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 9 / 21 | 98.4 % |
| 1340 | 1 | 3107 | 7 | 2 | 5 | 181 | 181 | 5 | 67 | 0 | 0 | 0 | 0 | 109 | 0 | 0 | 0 / 12 | 2.8 % |
| 1341 | 1 | 107 | 295 | 4 | 291 | 331 | 331 | 331 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 8 / 27 | 100.0 % |
| 1342 | 1 | 3107 | 9 | 2 | 7 | 234 | 234 | 5 | 74 | 0 | 0 | 0 | 0 | 155 | 0 | 0 | 0 / 10 | 2.1 % |
| 1343 | 1 | 210 | 276 | 4 | 272 | 277 | 277 | 277 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 8 / 23 | 100.0 % |
| 1344 | 1 | 3082 | 16 | 2 | 14 | 259 | 259 | 5 | 90 | 0 | 0 | 0 | 0 | 164 | 0 | 0 | 0 / 10 | 1.9 % |
| 1345 | 1 | 285 | 342 | 4 | 338 | 266 | 266 | 266 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 8 / 21 | 100.0 % |
| 1346 | 1 | 3089 | 11 | 2 | 9 | 282 | 282 | 5 | 93 | 0 | 0 | 0 | 0 | 184 | 0 | 0 | 0 / 10 | 1.8 % |
| 1347 | 1 | 207 | 158 | 4 | 154 | 242 | 242 | 242 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 8 / 20 | 100.0 % |
| 1348 | 1 | 103 | 12 | 3 | 9 | 287 | 287 | 287 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 8 / 14 | 100.0 % |
| 1349 | 1 | 101 | 33 | 3 | 30 | 492 | 492 | 492 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 8 / 10 | 100.0 % |

Lookup ms by result (p50 / p95, n): hit 8 / 20 (2371); miss 4 / 37 (558); memo-miss 0 / 0 (962). Whole capture: hit 2371, miss 558, stale 0, invalid 0, error 0, timeout 0, memo-miss 962, capped 0, other 0.

| minute | lookups | hit | miss | stale | invalid | error | timeout | memo-miss | capped | other |
|---|---|---|---|---|---|---|---|---|---|---|
| 02:14 | 1546 | 786 | 301 | 0 | 0 | 0 | 0 | 459 | 0 | 0 |
| 02:15 | 1042 | 559 | 164 | 0 | 0 | 0 | 0 | 319 | 0 | 0 |
| 02:16 | 1303 | 1026 | 93 | 0 | 0 | 0 | 0 | 184 | 0 | 0 |

### Admin writes (`[liveWriter]`)

| route | saves | acquire ms p50 / p95 | exec ms p50 / p95 | ok=false | failed kinds |
|---|---|---|---|---|---|
| admin-insert-after | 2 | 3 / 3 | 98 / 152 | 0 | — |
| admin-update | 12 | 3 / 14 | 70 / 85 | 0 | — |
| admin-delete | 2 | 3 / 4 | 26 / 29 | 0 | — |

Every save (routes with ≤ 12 saves; `at` = the server's commit time, epoch ms → UTC):

| route | rev | acquire ms | exec ms | ok | at (UTC) | instance |
|---|---|---|---|---|---|---|
| admin-insert-after | 1334 | 3 | 152 | true | 2026-10-12T02:13:40.759Z | 9f05b645 |
| admin-insert-after | 1335 | 3 | 98 | true | 2026-10-12T02:13:41.316Z | 9f05b645 |
| admin-update | 1336 | 3 | 78 | true | 2026-10-12T02:14:06.262Z | cc1afb31 |
| admin-update | 1337 | 4 | 78 | true | 2026-10-12T02:14:06.565Z | 3be4f9e6 |
| admin-update | 1338 | 3 | 71 | true | 2026-10-12T02:14:31.255Z | 62fc94ae |
| admin-update | 1339 | 14 | 85 | true | 2026-10-12T02:14:31.517Z | ba09e515 |
| admin-update | 1340 | 3 | 70 | true | 2026-10-12T02:14:56.221Z | d1f443e5 |
| admin-update | 1341 | 3 | 40 | true | 2026-10-12T02:14:56.390Z | d1f443e5 |
| admin-update | 1342 | 3 | 71 | true | 2026-10-12T02:15:21.266Z | 7b737ccf |
| admin-update | 1343 | 4 | 62 | true | 2026-10-12T02:15:21.483Z | 7b737ccf |
| admin-update | 1344 | 2 | 30 | true | 2026-10-12T02:15:46.147Z | 3be4f9e6 |
| admin-update | 1345 | 4 | 44 | true | 2026-10-12T02:15:46.424Z | cc1afb31 |
| admin-update | 1346 | 4 | 58 | true | 2026-10-12T02:16:11.268Z | d1f443e5 |
| admin-update | 1347 | 4 | 80 | true | 2026-10-12T02:16:11.536Z | eb0eb601 |
| admin-delete | 1348 | 4 | 26 | true | 2026-10-12T02:16:16.716Z | d1f443e5 |
| admin-delete | 1349 | 3 | 29 | true | 2026-10-12T02:16:17.067Z | 62fc94ae |

### Per minute

| minute | requests | distinct instances | builds | EMAXCONN |
|---|---|---|---|---|
| 02:13 | 1346 | 60 | 499 | 0 |
| 02:14 | 3276 | 50 | 848 | 0 |
| 02:15 | 2624 | 42 | 735 | 0 |
| 02:16 | 1808 | 45 | 301 | 0 |

### Prisma pool totals per 5 s (app-side estimate of pooler clients)

Peak carried sum: **95** (carry 5 s). "reported" = instances that logged in the bucket (max total each); "carried" also counts an instance's last total for 5 s after its last line.

| bucket | reporting instances | Σ total (reported) | instances (carried) | Σ total (carried) | max waiting |
|---|---|---|---|---|---|
| 02:13:35 | 1 | 1 | 1 | 1 | 0 |
| 02:13:40 | 56 | 75 | 56 | 75 | 1 |
| 02:13:45 | 59 | 93 | 60 | 95 | 4 |
| 02:13:50 | 41 | 59 | 60 | 89 | 0 |
| 02:13:55 | 7 | 9 | 41 | 58 | 0 |
| 02:14:00 | 6 | 8 | 7 | 9 | 0 |
| 02:14:05 | 40 | 64 | 40 | 64 | 1 |
| 02:14:10 | 17 | 33 | 40 | 64 | 0 |
| 02:14:15 | 4 | 6 | 17 | 26 | 0 |
| 02:14:20 | 4 | 7 | 5 | 8 | 0 |
| 02:14:25 | 4 | 8 | 4 | 8 | 0 |
| 02:14:30 | 32 | 57 | 32 | 57 | 1 |
| 02:14:35 | 9 | 12 | 32 | 52 | 0 |
| 02:14:40 | 8 | 11 | 9 | 13 | 0 |
| 02:14:45 | 5 | 10 | 8 | 13 | 0 |
| 02:14:50 | 3 | 6 | 5 | 10 | 0 |
| 02:14:55 | 29 | 48 | 29 | 48 | 0 |
| 02:15:00 | 14 | 22 | 29 | 46 | 0 |
| 02:15:05 | 14 | 16 | 14 | 16 | 0 |
| 02:15:10 | 11 | 12 | 14 | 16 | 0 |
| 02:15:15 | 8 | 9 | 11 | 12 | 0 |
| 02:15:20 | 26 | 45 | 26 | 45 | 1 |
| 02:15:25 | 12 | 19 | 26 | 40 | 0 |
| 02:15:30 | 9 | 11 | 12 | 15 | 0 |
| 02:15:35 | 7 | 8 | 9 | 10 | 0 |
| 02:15:40 | 5 | 9 | 7 | 11 | 0 |
| 02:15:45 | 31 | 56 | 31 | 56 | 1 |
| 02:15:50 | 16 | 31 | 31 | 55 | 0 |
| 02:15:55 | 8 | 9 | 16 | 22 | 0 |
| 02:16:00 | 5 | 9 | 8 | 12 | 0 |
| 02:16:05 | 5 | 10 | 5 | 10 | 0 |
| 02:16:10 | 33 | 57 | 33 | 57 | 0 |
| 02:16:15 | 20 | 31 | 35 | 57 | 0 |

### Other lines

| kind | count |
|---|---|
| untagged: No logs found for opensetlist-projects/opensetlist | 4 |
