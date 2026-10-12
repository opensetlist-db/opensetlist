## Vercel runtime logs — 2026-10-12T04-13-05Z-vercel-logs-history-step4-S1.txt

10049 entries; requests: /api/setlist 9449, other API 168, pages 432; error-level entries 0. Times: log clock +7 h.

### Builds per rev (`[liveSnapshot] build` lines: 1656)

| rev | builds | distinct instances | locales | build ms avg / max | first – last |
|---|---|---|---|---|---|
| 1484 | 1 | 1 | ko 1 | 59 / 59 | 04:13:39 – 04:13:39 |
| 1485 | 3 | 1 | ko 1, ja 1, en 1 | 50 / 60 | 04:13:40 – 04:13:40 |
| 1486 | 561 | 37 | ja 302, ko 167, en 92 | 167 / 615 | 04:13:41 – 04:14:06 |
| 1487 | 14 | 7 | ja 11, ko 2, en 1 | 58 / 79 | 04:14:05 – 04:14:06 |
| 1488 | 198 | 15 | en 22, ja 131, ko 45 | 54 / 150 | 04:14:06 – 04:14:30 |
| 1489 | 5 | 2 | ko 2, ja 2, en 1 | 71 / 109 | 04:14:30 – 04:14:31 |
| 1490 | 162 | 9 | ko 40, ja 98, en 24 | 47 / 100 | 04:14:31 – 04:14:56 |
| 1491 | 5 | 1 | ja 3, ko 1, en 1 | 89 / 170 | 04:14:55 – 04:14:56 |
| 1492 | 177 | 7 | ja 109, en 22, ko 46 | 50 / 137 | 04:14:56 – 04:15:20 |
| 1493 | 5 | 2 | ko 2, ja 2, en 1 | 55 / 70 | 04:15:20 – 04:15:21 |
| 1494 | 200 | 11 | ja 128, ko 44, en 28 | 49 / 115 | 04:15:21 – 04:15:46 |
| 1495 | 9 | 3 | ko 4, ja 3, en 2 | 46 / 83 | 04:15:45 – 04:15:46 |
| 1496 | 221 | 14 | en 24, ja 148, ko 49 | 49 / 502 | 04:15:46 – 04:16:10 |
| 1497 | 8 | 3 | en 3, ja 4, ko 1 | 49 / 65 | 04:16:10 – 04:16:11 |
| 1498 | 56 | 15 | ja 43, en 5, ko 8 | 49 / 104 | 04:16:11 – 04:16:16 |
| 1499 | 9 | 4 | ja 6, en 2, ko 1 | 40 / 57 | 04:16:16 – 04:16:16 |
| 1500 | 22 | 14 | ko 5, ja 15, en 2 | 57 / 118 | 04:16:16 – 04:16:18 |

### Failures, repair reads, coalescing

| what | count | detail |
|---|---|---|
| EMAXCONN (pooler client cap) | 0 | API 0, SSR 0 |
| `[liveSnapshot] build-failed` | 0 | — |
| `[liveSnapshot] rev-read` (repair revision read) | 0 | rev=timeout 0, rev=error 0; ms p50 — / max —; by hint: — |
| `[liveSnapshot] coalesced` | 90 | waiters sum 219, max 5 |
| `[setlist] slow-hit` | 0 | max — ms |

### Hint outcomes (`[setlist] hint-fetch` lines: 4896)

Whole capture: satisfied 4896, fresh 0, memo 0, deferred 0, none 0, error 0, other 0. "other" = a `verify=` value this script does not know.

| minute | hint fetches | satisfied | fresh | memo | deferred | none | error | other |
|---|---|---|---|---|---|---|---|---|
| 04:14 | 1993 | 1993 | 0 | 0 | 0 | 0 | 0 | 0 |
| 04:15 | 1292 | 1292 | 0 | 0 | 0 | 0 | 0 | 0 |
| 04:16 | 1611 | 1611 | 0 | 0 | 0 | 0 | 0 | 0 |

### Warming (`[liveWarm]` jobs: 16; `[setlist] warm-lookup` lines: 4896)

**warm hit rate = hits ÷ hinted fetches = 4896 / 4896 = 100.0 %** (hinted fetches = `[setlist] hint-fetch` lines with a numeric minRev; lookups 4896).

schedule-failed 0; job-failed 0; set ok=false 0 (set-error lines 0); skips 0; lookup-error lines 0; warm builds matched 48.

Warm jobs. start → done = the job's own `done ms=` (it starts in `after()`, i.e. right after the save's response, so it is ≈ warm-complete − commit). Per locale: actual rev, bytes, build / set ms, ok.

| save rev | instance | start (log clock) | start → done ms | sets | skips | warm builds (unmatched) | job-failed |
|---|---|---|---|---|---|---|---|
| 1485 | 2ce0033b | 04:13:40 | 135 | ko r1485 80830 B 53/12 ms; ja r1485 67230 B 61/11 ms; en r1485 79463 B 41/19 ms | — | 3 | — |
| 1486 | 2ce0033b | 04:13:41 | 106 | ja r1486 85188 B 42/13 ms; ko r1486 102444 B 52/8 ms; en r1486 100630 B 44/6 ms | — | 3 | — |
| 1487 | c5d81a84 | 04:14:05 | 149 | ko r1487 81587 B 74/9 ms; ja r1487 67915 B 80/12 ms; en r1487 80210 B 57/6 ms | — | 3 | — |
| 1488 | 0797c6ca | 04:14:06 | 138 | ko r1488 60837 B 68/6 ms; ja r1488 50666 B 114/13 ms; en r1488 59898 B 59/5 ms | — | 3 | — |
| 1489 | 1bf0d46e | 04:14:30 | 141 | ko r1489 60922 B 72/6 ms; ja r1489 50687 B 76/6 ms; en r1489 59985 B 49/13 ms | — | 3 | — |
| 1490 | f62e882e | 04:14:31 | 139 | ko r1490 60815 B 49/11 ms; ja r1490 50663 B 54/16 ms; en r1490 59877 B 73/6 ms | — | 3 | — |
| 1491 | afb766c8 | 04:14:55 | 116 | ko r1491 60784 B 71/5 ms; ja r1491 50631 B 93/7 ms; en r1491 59842 B 32/5 ms | — | 3 | — |
| 1492 | f62e882e | 04:14:56 | 102 | ko r1492 60782 B 44/6 ms; ja r1492 50632 B 68/8 ms; en r1492 59841 B 44/7 ms | — | 3 | — |
| 1493 | 8cad27e0 | 04:15:20 | 123 | ko r1493 60725 B 66/7 ms; ja r1493 50643 B 71/9 ms; en r1493 59787 B 44/6 ms | — | 3 | — |
| 1494 | f62e882e | 04:15:21 | 137 | ja r1494 50643 B 37/5 ms; ko r1494 60795 B 50/5 ms; en r1494 59851 B 85/10 ms | — | 3 | — |
| 1495 | 86c76005 | 04:15:45 | 104 | ko r1495 60771 B 44/17 ms; ja r1495 50625 B 58/13 ms; en r1495 59831 B 36/6 ms | — | 3 | — |
| 1496 | 8cad27e0 | 04:15:46 | 101 | ja r1496 50595 B 38/5 ms; ko r1496 60657 B 51/21 ms; en r1496 59732 B 53/5 ms | — | 3 | — |
| 1497 | 8cad27e0 | 04:16:10 | 105 | ko r1497 60725 B 38/6 ms; ja r1497 50637 B 51/5 ms; en r1497 59793 B 54/7 ms | — | 3 | — |
| 1498 | f62e882e | 04:16:11 | 97 | ja r1498 50724 B 40/5 ms; ko r1498 60911 B 48/6 ms; en r1498 59979 B 47/5 ms | — | 3 | — |
| 1499 | 8cad27e0 | 04:16:16 | 115 | ja r1499 49982 B 44/6 ms; ko r1499 60015 B 54/6 ms; en r1499 59083 B 59/5 ms | — | 3 | — |
| 1500 | 26703999 | 04:16:16 | 174 | ko r1500 59218 B 67/15 ms; ja r1500 49274 B 119/21 ms; en r1500 58298 B 79/13 ms | — | 3 | — |

Per save rev. builds = every `[liveSnapshot] build` at that rev; warm = the ones matched to a warm job (same instance, locale, rev); reader = the rest. Lookups and hinted fetches are keyed by their `minRev`.

| save rev | warm jobs | start → done ms | builds | warm | reader | hinted fetches | lookups | hit | miss | stale | invalid | error | timeout | memo-miss | capped | other | lookup ms p50 / p95 | hit rate |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1485 | 1 | 135 | 3 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — / — | — |
| 1486 | 1 | 106 | 561 | 3 | 558 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — / — | — |
| 1487 | 1 | 149 | 14 | 3 | 11 | 224 | 224 | 224 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 9 / 21 | 100.0 % |
| 1488 | 1 | 138 | 198 | 3 | 195 | 478 | 478 | 478 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 7 / 16 | 100.0 % |
| 1489 | 1 | 141 | 5 | 3 | 2 | 197 | 197 | 197 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 8 / 18 | 100.0 % |
| 1490 | 1 | 139 | 162 | 3 | 159 | 493 | 493 | 493 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 7 / 13 | 100.0 % |
| 1491 | 1 | 116 | 5 | 3 | 2 | 111 | 111 | 111 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 8 / 18 | 100.0 % |
| 1492 | 1 | 102 | 177 | 3 | 174 | 496 | 496 | 496 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 8 / 14 | 100.0 % |
| 1493 | 1 | 123 | 5 | 3 | 2 | 153 | 153 | 153 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 8 / 20 | 100.0 % |
| 1494 | 1 | 137 | 200 | 3 | 197 | 493 | 493 | 493 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 7 / 13 | 100.0 % |
| 1495 | 1 | 104 | 9 | 3 | 6 | 156 | 156 | 156 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 7 / 17 | 100.0 % |
| 1496 | 1 | 101 | 221 | 3 | 218 | 484 | 484 | 484 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 7 / 13 | 100.0 % |
| 1497 | 1 | 105 | 8 | 3 | 5 | 259 | 259 | 259 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 8 / 20 | 100.0 % |
| 1498 | 1 | 97 | 56 | 3 | 53 | 494 | 494 | 494 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 8 / 15 | 100.0 % |
| 1499 | 1 | 115 | 9 | 3 | 6 | 373 | 373 | 373 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 7 / 15 | 100.0 % |
| 1500 | 1 | 174 | 22 | 3 | 19 | 485 | 485 | 485 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 8 / 16 | 100.0 % |

Lookup ms by result (p50 / p95, n): hit 8 / 16 (4896). Whole capture: hit 4896, miss 0, stale 0, invalid 0, error 0, timeout 0, memo-miss 0, capped 0, other 0.

| minute | lookups | hit | miss | stale | invalid | error | timeout | memo-miss | capped | other |
|---|---|---|---|---|---|---|---|---|---|---|
| 04:14 | 1993 | 1993 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| 04:15 | 1292 | 1292 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| 04:16 | 1611 | 1611 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |

### Admin writes (`[liveWriter]`)

| route | saves | acquire ms p50 / p95 | exec ms p50 / p95 | ok=false | failed kinds |
|---|---|---|---|---|---|
| admin-insert-after | 2 | 2 / 2 | 100 / 158 | 0 | — |
| admin-update | 12 | 4 / 5 | 60 / 164 | 0 | — |
| admin-delete | 2 | 4 / 5 | 24 / 35 | 0 | — |

Every save (routes with ≤ 12 saves; `at` = the server's commit time, epoch ms → UTC):

| route | rev | acquire ms | exec ms | ok | at (UTC) | instance |
|---|---|---|---|---|---|---|
| admin-insert-after | 1485 | 2 | 158 | true | 2026-10-12T04:13:41.113Z | 2ce0033b |
| admin-insert-after | 1486 | 2 | 100 | true | 2026-10-12T04:13:41.657Z | 2ce0033b |
| admin-update | 1487 | 5 | 78 | true | 2026-10-12T04:14:06.262Z | c5d81a84 |
| admin-update | 1488 | 3 | 76 | true | 2026-10-12T04:14:06.496Z | 0797c6ca |
| admin-update | 1489 | 4 | 81 | true | 2026-10-12T04:14:31.169Z | 1bf0d46e |
| admin-update | 1490 | 4 | 55 | true | 2026-10-12T04:14:31.364Z | f62e882e |
| admin-update | 1491 | 2 | 164 | true | 2026-10-12T04:14:56.223Z | afb766c8 |
| admin-update | 1492 | 4 | 49 | true | 2026-10-12T04:14:56.329Z | f62e882e |
| admin-update | 1493 | 5 | 103 | true | 2026-10-12T04:15:21.175Z | 8cad27e0 |
| admin-update | 1494 | 4 | 52 | true | 2026-10-12T04:15:21.320Z | f62e882e |
| admin-update | 1495 | 2 | 74 | true | 2026-10-12T04:15:46.170Z | 86c76005 |
| admin-update | 1496 | 4 | 51 | true | 2026-10-12T04:15:46.336Z | 8cad27e0 |
| admin-update | 1497 | 3 | 40 | true | 2026-10-12T04:16:11.088Z | 8cad27e0 |
| admin-update | 1498 | 4 | 60 | true | 2026-10-12T04:16:11.334Z | f62e882e |
| admin-delete | 1499 | 4 | 24 | true | 2026-10-12T04:16:16.526Z | 8cad27e0 |
| admin-delete | 1500 | 5 | 35 | true | 2026-10-12T04:16:16.909Z | 26703999 |

### Per minute

| minute | requests | distinct instances | builds | EMAXCONN |
|---|---|---|---|---|
| 04:13 | 1349 | 37 | 494 | 0 |
| 04:14 | 3728 | 38 | 476 | 0 |
| 04:15 | 2878 | 33 | 518 | 0 |
| 04:16 | 2094 | 50 | 168 | 0 |

### Prisma pool totals per 5 s (app-side estimate of pooler clients)

Peak carried sum: **64** (carry 5 s). "reported" = instances that logged in the bucket (max total each); "carried" also counts an instance's last total for 5 s after its last line.

| bucket | reporting instances | Σ total (reported) | instances (carried) | Σ total (carried) | max waiting |
|---|---|---|---|---|---|
| 04:13:35 | 1 | 1 | 1 | 1 | 0 |
| 04:13:40 | 27 | 45 | 27 | 45 | 0 |
| 04:13:45 | 33 | 62 | 34 | 64 | 2 |
| 04:13:50 | 33 | 59 | 36 | 64 | 2 |
| 04:13:55 | 3 | 4 | 33 | 58 | 0 |
| 04:14:00 | 4 | 8 | 4 | 8 | 1 |
| 04:14:05 | 15 | 22 | 15 | 22 | 0 |
| 04:14:10 | 8 | 13 | 15 | 21 | 0 |
| 04:14:15 | 5 | 6 | 8 | 10 | 0 |
| 04:14:20 | 4 | 7 | 5 | 8 | 0 |
| 04:14:25 | 5 | 10 | 5 | 10 | 1 |
| 04:14:30 | 9 | 13 | 10 | 15 | 0 |
| 04:14:35 | 5 | 8 | 9 | 13 | 0 |
| 04:14:40 | 4 | 8 | 5 | 9 | 0 |
| 04:14:45 | 3 | 6 | 4 | 8 | 0 |
| 04:14:50 | 3 | 6 | 3 | 6 | 0 |
| 04:14:55 | 8 | 10 | 9 | 12 | 1 |
| 04:15:00 | 4 | 7 | 8 | 12 | 0 |
| 04:15:05 | 4 | 8 | 5 | 10 | 0 |
| 04:15:10 | 3 | 6 | 4 | 8 | 0 |
| 04:15:15 | 3 | 6 | 3 | 6 | 0 |
| 04:15:20 | 11 | 16 | 11 | 16 | 1 |
| 04:15:25 | 6 | 9 | 11 | 16 | 0 |
| 04:15:30 | 5 | 8 | 6 | 9 | 0 |
| 04:15:35 | 3 | 4 | 5 | 7 | 0 |
| 04:15:40 | 4 | 7 | 4 | 7 | 0 |
| 04:15:45 | 14 | 20 | 14 | 20 | 0 |
| 04:15:50 | 8 | 13 | 14 | 20 | 0 |
| 04:15:55 | 6 | 9 | 8 | 12 | 0 |
| 04:16:00 | 4 | 6 | 6 | 9 | 0 |
| 04:16:05 | 3 | 5 | 4 | 6 | 0 |
| 04:16:10 | 15 | 20 | 15 | 20 | 0 |
| 04:16:15 | 16 | 19 | 18 | 22 | 0 |

### Other lines

| kind | count |
|---|---|
| untagged: No logs found for opensetlist-projects/opensetlist | 4 |
