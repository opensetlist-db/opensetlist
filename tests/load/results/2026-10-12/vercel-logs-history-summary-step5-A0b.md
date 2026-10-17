## Vercel runtime logs — 2026-10-12T06-42-16Z-vercel-logs-history-step5-A0b.txt

5497 entries; requests: /api/setlist 4987, other API 78, pages 432; error-level entries 0. Times: log clock +7 h.

### Builds per rev (`[liveSnapshot] build` lines: 1235)

| rev | builds | distinct instances | locales | build ms avg / max | first – last |
|---|---|---|---|---|---|
| 1608 | 144 | 65 | ko 46, ja 83, en 15 | 395 / 972 | 06:44:41 – 06:44:44 |
| 1609 | 239 | 81 | ja 139, en 38, ko 62 | 224 / 771 | 06:44:41 – 06:44:46 |
| 1610 | 274 | 68 | ja 170, ko 67, en 37 | 101 / 242 | 06:44:46 – 06:44:59 |
| 1611 | 261 | 18 | ja 178, ko 51, en 32 | 47 / 117 | 06:45:00 – 06:45:26 |
| 1612 | 281 | 17 | en 32, ja 184, ko 65 | 51 / 165 | 06:45:25 – 06:45:56 |
| 1613 | 15 | 8 | ko 6, ja 6, en 3 | 58 / 92 | 06:45:56 – 06:45:58 |
| 1614 | 21 | 8 | ja 15, en 4, ko 2 | 55 / 100 | 06:45:58 – 06:45:59 |

### Failures, repair reads, coalescing

| what | count | detail |
|---|---|---|
| EMAXCONN (pooler client cap) | 0 | API 0, SSR 0 |
| `[liveSnapshot] build-failed` | 0 | — |
| `[liveSnapshot] rev-read` (repair revision read) | 0 | rev=timeout 0, rev=error 0; ms p50 — / max —; by hint: — |
| `[liveSnapshot] coalesced` | 219 | waiters sum 594, max 9 |
| `[setlist] slow-hit` | 0 | max — ms |

### Hint outcomes (`[setlist] hint-fetch` lines: 2405)

Whole capture: satisfied 2405, fresh 0, memo 0, deferred 0, none 0, error 0, other 0. "other" = a `verify=` value this script does not know.

| minute | hint fetches | satisfied | fresh | memo | deferred | none | error | other |
|---|---|---|---|---|---|---|---|---|
| 06:44 | 452 | 452 | 0 | 0 | 0 | 0 | 0 | 0 |
| 06:45 | 1953 | 1953 | 0 | 0 | 0 | 0 | 0 | 0 |

### Warming (`[liveWarm]` jobs: 6; `[setlist] warm-lookup` lines: 2405)

**warm hit rate = hits ÷ hinted fetches = 2371 / 2405 = 98.6 %** (hinted fetches = `[setlist] hint-fetch` lines with a numeric minRev; lookups 2405).

schedule-failed 0; job-failed 0; set ok=false 0 (set-error lines 0); skips 0; lookup-error lines 0; warm builds matched 18.

Warm jobs. start → done = the job's own `done ms=` (it starts in `after()`, i.e. right after the save's response, so it is ≈ warm-complete − commit). Per locale: actual rev, bytes, build / set ms, ok.

| save rev | instance | start (log clock) | start → done ms | sets | skips | warm builds (unmatched) | job-failed |
|---|---|---|---|---|---|---|---|
| 1609 | a0aeb019 | 06:44:43 | 597 | en r1609 59042 B 281/6 ms; ja r1609 49958 B 299/8 ms; ko r1609 59971 B 319/7 ms | — | 3 | — |
| 1610 | 059cec8f | 06:44:46 | 118 | ko r1610 59970 B 61/17 ms; ja r1610 49957 B 64/20 ms; en r1610 59041 B 35/5 ms | — | 3 | — |
| 1611 | 059cec8f | 06:45:00 | 82 | ko r1611 59946 B 38/6 ms; ja r1611 49939 B 54/6 ms; en r1611 59021 B 33/5 ms | — | 3 | — |
| 1612 | ac87bfbc | 06:45:25 | 109 | ja r1612 49928 B 53/9 ms; ko r1612 59927 B 65/6 ms; en r1612 59007 B 39/7 ms | — | 3 | — |
| 1613 | a140e250 | 06:45:56 | 109 | ja r1613 49273 B 48/8 ms; ko r1613 59217 B 53/7 ms; en r1613 58297 B 46/6 ms | — | 3 | — |
| 1614 | a8067228 | 06:45:58 | 123 | ko r1614 59216 B 56/8 ms; ja r1614 49272 B 71/5 ms; en r1614 58296 B 52/6 ms | — | 3 | — |

Per save rev. builds = every `[liveSnapshot] build` at that rev; warm = the ones matched to a warm job (same instance, locale, rev); reader = the rest. Lookups and hinted fetches are keyed by their `minRev`.

| save rev | warm jobs | start → done ms | builds | warm | reader | hinted fetches | lookups | hit | miss | stale | invalid | error | timeout | memo-miss | capped | other | lookup ms p50 / p95 | hit rate |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1609 | 1 | 597 | 239 | 3 | 236 | 135 | 135 | 101 | 18 | 0 | 0 | 0 | 0 | 16 | 0 | 0 | 9 / 30 | 74.8 % |
| 1610 | 1 | 118 | 274 | 3 | 271 | 317 | 317 | 317 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 9 / 11 | 100.0 % |
| 1611 | 1 | 82 | 261 | 3 | 258 | 491 | 491 | 491 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 8 / 29 | 100.0 % |
| 1612 | 1 | 109 | 281 | 3 | 278 | 476 | 476 | 476 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 8 / 33 | 100.0 % |
| 1613 | 1 | 109 | 15 | 3 | 12 | 494 | 494 | 494 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 8 / 22 | 100.0 % |
| 1614 | 1 | 123 | 21 | 3 | 18 | 492 | 492 | 492 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 7 / 10 | 100.0 % |

Lookup ms by result (p50 / p95, n): hit 8 / 22 (2371); miss 5 / 7 (18); memo-miss 0 / 0 (16). Whole capture: hit 2371, miss 18, stale 0, invalid 0, error 0, timeout 0, memo-miss 16, capped 0, other 0.

| minute | lookups | hit | miss | stale | invalid | error | timeout | memo-miss | capped | other |
|---|---|---|---|---|---|---|---|---|---|---|
| 06:44 | 452 | 418 | 18 | 0 | 0 | 0 | 0 | 16 | 0 | 0 |
| 06:45 | 1953 | 1953 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |

### Admin writes (`[liveWriter]`)

| route | saves | acquire ms p50 / p95 | exec ms p50 / p95 | ok=false | failed kinds |
|---|---|---|---|---|---|
| admin-update | 4 | 3 / 4 | 80 / 124 | 0 | — |
| admin-delete | 2 | 4 / 5 | 31 / 31 | 0 | — |

Every save (routes with ≤ 12 saves; `at` = the server's commit time, epoch ms → UTC):

| route | rev | acquire ms | exec ms | ok | at (UTC) | instance |
|---|---|---|---|---|---|---|
| admin-update | 1609 | 3 | 124 | true | 2026-10-12T06:44:44.187Z | a0aeb019 |
| admin-update | 1610 | 3 | 80 | true | 2026-10-12T06:44:47.079Z | 059cec8f |
| admin-update | 1611 | 2 | 37 | true | 2026-10-12T06:45:01.042Z | 059cec8f |
| admin-update | 1612 | 4 | 91 | true | 2026-10-12T06:45:26.119Z | ac87bfbc |
| admin-delete | 1613 | 5 | 31 | true | 2026-10-12T06:45:57.131Z | a140e250 |
| admin-delete | 1614 | 4 | 31 | true | 2026-10-12T06:45:58.596Z | a8067228 |

### Per minute

| minute | requests | distinct instances | builds | EMAXCONN |
|---|---|---|---|---|
| 06:44 | 1936 | 94 | 657 | 0 |
| 06:45 | 3561 | 53 | 578 | 0 |

### Prisma pool totals per 5 s (app-side estimate of pooler clients)

Peak carried sum: **165** (carry 5 s). "reported" = instances that logged in the bucket (max total each); "carried" also counts an instance's last total for 5 s after its last line.

| bucket | reporting instances | Σ total (reported) | instances (carried) | Σ total (carried) | max waiting |
|---|---|---|---|---|---|
| 06:44:40 | 68 | 105 | 68 | 105 | 0 |
| 06:44:45 | 85 | 152 | 93 | 165 | 5 |
| 06:44:50 | 15 | 28 | 86 | 151 | 0 |
| 06:44:55 | 4 | 5 | 15 | 25 | 0 |
| 06:45:00 | 18 | 23 | 19 | 25 | 0 |
| 06:45:05 | 8 | 10 | 18 | 23 | 0 |
| 06:45:10 | 5 | 7 | 8 | 11 | 0 |
| 06:45:15 | 3 | 5 | 5 | 8 | 0 |
| 06:45:20 | 4 | 8 | 4 | 8 | 0 |
| 06:45:25 | 17 | 28 | 17 | 28 | 0 |
| 06:45:30 | 9 | 14 | 17 | 27 | 0 |
| 06:45:35 | 6 | 9 | 9 | 13 | 0 |
| 06:45:40 | 5 | 9 | 6 | 10 | 0 |
| 06:45:45 | 4 | 7 | 5 | 8 | 0 |
| 06:45:50 | 3 | 5 | 4 | 7 | 0 |
| 06:45:55 | 12 | 16 | 13 | 17 | 0 |

### Other lines

| kind | count |
|---|---|
| untagged: No logs found for opensetlist-projects/opensetlist | 10 |
