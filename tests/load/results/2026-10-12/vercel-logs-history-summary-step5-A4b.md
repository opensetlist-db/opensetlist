## Vercel runtime logs — 2026-10-12T07-21-12Z-vercel-logs-history-step5-A4b.txt

5579 entries; requests: /api/setlist 5077, other API 69, pages 433; error-level entries 0. Times: log clock +7 h.

### Builds per rev (`[liveSnapshot] build` lines: 1780)

| rev | builds | distinct instances | locales | build ms avg / max | first – last |
|---|---|---|---|---|---|
| 1659 | 136 | 76 | ja 108, en 13, ko 15 | 795 / 1333 | 07:22:05 – 07:22:09 |
| 1660 | 239 | 94 | ja 133, ko 63, en 43 | 1005 / 2072 | 07:22:06 – 07:22:13 |
| 1661 | 250 | 95 | ko 69, ja 130, en 51 | 1132 / 3924 | 07:22:11 – 07:22:25 |
| 1662 | 502 | 52 | ja 312, en 70, ko 120 | 296 / 1697 | 07:22:25 – 07:22:51 |
| 1663 | 374 | 40 | ja 229, en 53, ko 92 | 242 / 1212 | 07:22:50 – 07:23:22 |
| 1664 | 135 | 37 | ko 40, ja 66, en 29 | 537 / 1122 | 07:23:21 – 07:23:24 |
| 1665 | 144 | 44 | ja 67, ko 46, en 31 | 726 / 1530 | 07:23:23 – 07:23:26 |

### Failures, repair reads, coalescing

| what | count | detail |
|---|---|---|
| EMAXCONN (pooler client cap) | 0 | API 0, SSR 0 |
| `[liveSnapshot] build-failed` | 0 | — |
| `[liveSnapshot] rev-read` (repair revision read) | 0 | rev=timeout 0, rev=error 0; ms p50 — / max —; by hint: — |
| `[liveSnapshot] coalesced` | 675 | waiters sum 3079, max 21 |
| `[setlist] slow-hit` | 0 | max — ms |

### Hint outcomes (`[setlist] hint-fetch` lines: 2461)

Whole capture: satisfied 2461, fresh 0, memo 0, deferred 0, none 0, error 0, other 0. "other" = a `verify=` value this script does not know.

| minute | hint fetches | satisfied | fresh | memo | deferred | none | error | other |
|---|---|---|---|---|---|---|---|---|
| 07:22 | 1490 | 1490 | 0 | 0 | 0 | 0 | 0 | 0 |
| 07:23 | 971 | 971 | 0 | 0 | 0 | 0 | 0 | 0 |

### Warming (`[liveWarm]` jobs: 6; `[setlist] warm-lookup` lines: 2461)

**warm hit rate = hits ÷ hinted fetches = 0 / 2461 = 0.0 %** (hinted fetches = `[setlist] hint-fetch` lines with a numeric minRev; lookups 2461).

schedule-failed 0; job-failed 0; set ok=false 0 (set-error lines 0); skips 0; lookup-error lines 0; warm builds matched 18.

Warm jobs. start → done = the job's own `done ms=` (it starts in `after()`, i.e. right after the save's response, so it is ≈ warm-complete − commit). Per locale: actual rev, bytes, build / set ms, ok.

| save rev | instance | start (log clock) | start → done ms | sets | skips | warm builds (unmatched) | job-failed |
|---|---|---|---|---|---|---|---|
| 1660 | 8826f4d4 | 07:22:08 | 1190 | ja r1660 147962 B 293/33 ms; ko r1660 177863 B 310/31 ms; en r1660 175094 B 845/17 ms | — | 3 | — |
| 1661 | d1de70b6 | 07:22:11 | 2101 | ko r1661 177838 B 587/24 ms; ja r1661 147943 B 599/17 ms; en r1661 175073 B 1473/16 ms | — | 3 | — |
| 1662 | 2d6c189f | 07:22:25 | 156 | ko r1662 178131 B 65/10 ms; ja r1662 148155 B 100/8 ms; en r1662 175353 B 63/9 ms | — | 3 | — |
| 1663 | 0d9bcb4d | 07:22:50 | 180 | ko r1663 177904 B 85/10 ms; ja r1663 147993 B 145/11 ms; en r1663 175130 B 76/9 ms | — | 3 | — |
| 1664 | 986f4628 | 07:23:21 | 166 | ko r1664 177109 B 72/12 ms; ja r1664 147277 B 100/8 ms; en r1664 174349 B 73/9 ms | — | 3 | — |
| 1665 | 986f4628 | 07:23:23 | 439 | ko r1665 177108 B 187/19 ms; ja r1665 147276 B 201/12 ms; en r1665 174348 B 224/9 ms | — | 3 | — |

Per save rev. builds = every `[liveSnapshot] build` at that rev; warm = the ones matched to a warm job (same instance, locale, rev); reader = the rest. Lookups and hinted fetches are keyed by their `minRev`.

| save rev | warm jobs | start → done ms | builds | warm | reader | hinted fetches | lookups | hit | miss | stale | invalid | error | timeout | memo-miss | capped | other | lookup ms p50 / p95 | hit rate |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1660 | 1 | 1190 | 239 | 3 | 236 | 181 | 181 | 0 | 123 | 0 | 0 | 0 | 0 | 58 | 0 | 0 | 7 / 23 | 0.0 % |
| 1661 | 1 | 2101 | 250 | 3 | 247 | 346 | 346 | 0 | 171 | 0 | 0 | 0 | 0 | 175 | 0 | 0 | 1 / 12 | 0.0 % |
| 1662 | 1 | 156 | 502 | 3 | 499 | 485 | 485 | 0 | 192 | 0 | 0 | 0 | 0 | 293 | 0 | 0 | 0 / 51 | 0.0 % |
| 1663 | 1 | 180 | 374 | 3 | 371 | 478 | 478 | 0 | 169 | 0 | 0 | 0 | 0 | 309 | 0 | 0 | 0 / 24 | 0.0 % |
| 1664 | 1 | 166 | 135 | 3 | 132 | 489 | 489 | 0 | 170 | 0 | 0 | 0 | 0 | 319 | 0 | 0 | 0 / 18 | 0.0 % |
| 1665 | 1 | 439 | 144 | 3 | 141 | 482 | 482 | 0 | 144 | 0 | 0 | 0 | 0 | 338 | 0 | 0 | 0 / 9 | 0.0 % |

Lookup ms by result (p50 / p95, n): miss 8 / 51 (969); memo-miss 0 / 0 (1492). Whole capture: hit 0, miss 969, stale 0, invalid 0, error 0, timeout 0, memo-miss 1492, capped 0, other 0.

| minute | lookups | hit | miss | stale | invalid | error | timeout | memo-miss | capped | other |
|---|---|---|---|---|---|---|---|---|---|---|
| 07:22 | 1490 | 0 | 655 | 0 | 0 | 0 | 0 | 835 | 0 | 0 |
| 07:23 | 971 | 0 | 314 | 0 | 0 | 0 | 0 | 657 | 0 | 0 |

### Admin writes (`[liveWriter]`)

| route | saves | acquire ms p50 / p95 | exec ms p50 / p95 | ok=false | failed kinds |
|---|---|---|---|---|---|
| admin-update | 4 | 3 / 528 | 105 / 161 | 0 | — |
| admin-delete | 2 | 3 / 42 | 29 / 41 | 0 | — |

Every save (routes with ≤ 12 saves; `at` = the server's commit time, epoch ms → UTC):

| route | rev | acquire ms | exec ms | ok | at (UTC) | instance |
|---|---|---|---|---|---|---|
| admin-update | 1660 | 498 | 154 | true | 2026-10-12T07:22:10.340Z | 8826f4d4 |
| admin-update | 1661 | 528 | 161 | true | 2026-10-12T07:22:14.191Z | d1de70b6 |
| admin-update | 1662 | 3 | 67 | true | 2026-10-12T07:22:26.241Z | 2d6c189f |
| admin-update | 1663 | 3 | 105 | true | 2026-10-12T07:22:51.257Z | 0d9bcb4d |
| admin-delete | 1664 | 3 | 29 | true | 2026-10-12T07:23:22.289Z | 986f4628 |
| admin-delete | 1665 | 42 | 41 | true | 2026-10-12T07:23:24.368Z | 986f4628 |

### Per minute

| minute | requests | distinct instances | builds | EMAXCONN |
|---|---|---|---|---|
| 07:22 | 3954 | 108 | 1354 | 0 |
| 07:23 | 1625 | 44 | 426 | 0 |

### Prisma pool totals per 5 s (app-side estimate of pooler clients)

Peak carried sum: **190** (carry 5 s). "reported" = instances that logged in the bucket (max total each); "carried" also counts an instance's last total for 5 s after its last line.

| bucket | reporting instances | Σ total (reported) | instances (carried) | Σ total (carried) | max waiting |
|---|---|---|---|---|---|
| 07:22:05 | 77 | 101 | 77 | 101 | 0 |
| 07:22:10 | 97 | 177 | 106 | 190 | 2 |
| 07:22:15 | 21 | 39 | 100 | 179 | 0 |
| 07:22:20 | 13 | 20 | 26 | 44 | 2 |
| 07:22:25 | 52 | 94 | 58 | 105 | 0 |
| 07:22:30 | 26 | 50 | 52 | 94 | 0 |
| 07:22:35 | 17 | 18 | 26 | 31 | 0 |
| 07:22:40 | 7 | 7 | 17 | 18 | 0 |
| 07:22:45 | 7 | 10 | 7 | 10 | 0 |
| 07:22:50 | 40 | 74 | 40 | 74 | 0 |
| 07:22:55 | 21 | 42 | 40 | 74 | 0 |
| 07:23:00 | 14 | 19 | 21 | 29 | 0 |
| 07:23:05 | 10 | 13 | 14 | 17 | 0 |
| 07:23:10 | 9 | 10 | 10 | 11 | 0 |
| 07:23:15 | 7 | 7 | 9 | 9 | 0 |
| 07:23:20 | 44 | 85 | 44 | 85 | 0 |
| 07:23:25 | 16 | 32 | 44 | 85 | 0 |

### Other lines

| kind | count |
|---|---|
| [liveWarm] fault | 91 |
| untagged: No logs found for opensetlist-projects/opensetlist | 11 |
