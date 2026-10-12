## Vercel runtime logs — 2026-10-12T04-18-44Z-vercel-logs-history-step4-S1b.txt

9631 entries; requests: /api/setlist 9033, other API 166, pages 432; error-level entries 0. Times: log clock +7 h.

### Builds per rev (`[liveSnapshot] build` lines: 1521)

| rev | builds | distinct instances | locales | build ms avg / max | first – last |
|---|---|---|---|---|---|
| 1501 | 1 | 1 | ko 1 | 91 / 91 | 04:19:19 – 04:19:19 |
| 1502 | 3 | 1 | ko 1, ja 1, en 1 | 58 / 75 | 04:19:19 – 04:19:19 |
| 1503 | 442 | 31 | ko 110, en 75, ja 257 | 171 / 721 | 04:19:20 – 04:19:42 |
| 1504 | 8 | 3 | en 2, ja 3, ko 3 | 47 / 55 | 04:19:42 – 04:19:42 |
| 1505 | 237 | 17 | ko 66, ja 145, en 26 | 52 / 120 | 04:19:42 – 04:20:07 |
| 1506 | 4 | 3 | ja 3, ko 1 | 54 / 68 | 04:20:07 – 04:20:07 |
| 1507 | 162 | 10 | en 32, ja 90, ko 40 | 52 / 510 | 04:20:07 – 04:20:32 |
| 1508 | 5 | 2 | ja 3, en 1, ko 1 | 77 / 115 | 04:20:32 – 04:20:32 |
| 1509 | 173 | 9 | ja 100, ko 43, en 30 | 47 / 122 | 04:20:32 – 04:20:57 |
| 1510 | 3 | 1 | ko 1, ja 1, en 1 | 39 / 48 | 04:20:57 – 04:20:57 |
| 1511 | 180 | 10 | ja 122, ko 34, en 24 | 50 / 524 | 04:20:57 – 04:21:21 |
| 1512 | 7 | 2 | ja 4, en 2, ko 1 | 45 / 52 | 04:21:22 – 04:21:22 |
| 1513 | 206 | 12 | en 23, ja 131, ko 52 | 45 / 99 | 04:21:22 – 04:21:47 |
| 1514 | 5 | 2 | ko 2, ja 2, en 1 | 48 / 54 | 04:21:47 – 04:21:47 |
| 1515 | 57 | 12 | ko 14, en 6, ja 37 | 65 / 542 | 04:21:47 – 04:21:52 |
| 1516 | 4 | 1 | ja 2, ko 1, en 1 | 39 / 50 | 04:21:52 – 04:21:52 |
| 1517 | 24 | 12 | ja 11, ko 8, en 5 | 54 / 99 | 04:21:52 – 04:21:54 |

### Failures, repair reads, coalescing

| what | count | detail |
|---|---|---|
| EMAXCONN (pooler client cap) | 0 | API 0, SSR 0 |
| `[liveSnapshot] build-failed` | 0 | — |
| `[liveSnapshot] rev-read` (repair revision read) | 0 | rev=timeout 0, rev=error 0; ms p50 — / max —; by hint: — |
| `[liveSnapshot] coalesced` | 95 | waiters sum 236, max 5 |
| `[setlist] slow-hit` | 0 | max — ms |

### Hint outcomes (`[setlist] hint-fetch` lines: 4538)

Whole capture: satisfied 4538, fresh 0, memo 0, deferred 0, none 0, error 0, other 0. "other" = a `verify=` value this script does not know.

| minute | hint fetches | satisfied | fresh | memo | deferred | none | error | other |
|---|---|---|---|---|---|---|---|---|
| 04:19 | 647 | 647 | 0 | 0 | 0 | 0 | 0 | 0 |
| 04:20 | 1832 | 1832 | 0 | 0 | 0 | 0 | 0 | 0 |
| 04:21 | 2059 | 2059 | 0 | 0 | 0 | 0 | 0 | 0 |

### Warming (`[liveWarm]` jobs: 16; `[setlist] warm-lookup` lines: 4538)

**warm hit rate = hits ÷ hinted fetches = 4538 / 4538 = 100.0 %** (hinted fetches = `[setlist] hint-fetch` lines with a numeric minRev; lookups 4538).

schedule-failed 0; job-failed 0; set ok=false 0 (set-error lines 0); skips 0; lookup-error lines 0; warm builds matched 48.

Warm jobs. start → done = the job's own `done ms=` (it starts in `after()`, i.e. right after the save's response, so it is ≈ warm-complete − commit). Per locale: actual rev, bytes, build / set ms, ok.

| save rev | instance | start (log clock) | start → done ms | sets | skips | warm builds (unmatched) | job-failed |
|---|---|---|---|---|---|---|---|
| 1502 | 1b0a972d | 04:19:19 | 119 | ko r1502 80830 B 57/9 ms; ja r1502 67230 B 76/6 ms; en r1502 79463 B 44/8 ms | — | 3 | — |
| 1503 | 1b0a972d | 04:19:20 | 108 | ja r1503 85188 B 45/12 ms; ko r1503 102444 B 52/14 ms; en r1503 100630 B 42/8 ms | — | 3 | — |
| 1504 | 8cad27e0 | 04:19:42 | 90 | ja r1504 67915 B 37/5 ms; ko r1504 81587 B 51/5 ms; en r1504 80210 B 42/6 ms | — | 3 | — |
| 1505 | 8cad27e0 | 04:19:42 | 155 | ko r1505 60837 B 51/9 ms; ja r1505 50666 B 121/5 ms; en r1505 59898 B 90/5 ms | — | 3 | — |
| 1506 | 040e21ca | 04:20:07 | 127 | ko r1506 60922 B 55/6 ms; ja r1506 50687 B 64/5 ms; en r1507 59877 B 59/7 ms | — | 3 | — |
| 1507 | a3ca30b0 | 04:20:07 | 144 | ko r1507 60815 B 67/7 ms; ja r1507 50663 B 90/5 ms; en r1507 59877 B 63/6 ms | — | 3 | — |
| 1508 | 0e36bc74 | 04:20:32 | 198 | ko r1508 60784 B 110/38 ms; ja r1508 50631 B 127/35 ms; en r1509 59841 B 41/7 ms | — | 3 | — |
| 1509 | 8ad750c7 | 04:20:32 | 148 | ko r1509 60782 B 85/7 ms; ja r1509 50632 B 69/36 ms; en r1509 59841 B 49/4 ms | — | 3 | — |
| 1510 | 6be337b1 | 04:20:57 | 90 | ko r1510 60725 B 35/9 ms; ja r1510 50643 B 50/7 ms; en r1510 59787 B 37/8 ms | — | 3 | — |
| 1511 | 6be337b1 | 04:20:57 | 123 | ja r1511 50643 B 58/8 ms; ko r1511 60795 B 71/7 ms; en r1511 59851 B 48/7 ms | — | 3 | — |
| 1512 | a3ca30b0 | 04:21:22 | 105 | ja r1512 50625 B 38/6 ms; ko r1512 60771 B 50/7 ms; en r1512 59831 B 54/6 ms | — | 3 | — |
| 1513 | 0e36bc74 | 04:21:22 | 83 | ja r1513 50595 B 33/9 ms; ko r1513 60657 B 40/15 ms; en r1513 59732 B 35/6 ms | — | 3 | — |
| 1514 | 040e21ca | 04:21:47 | 130 | ko r1514 60956 B 47/18 ms; ja r1514 50828 B 55/15 ms; en r1514 60019 B 46/18 ms | — | 3 | — |
| 1515 | 34c653dc | 04:21:47 | 132 | ko r1515 61314 B 59/10 ms; ja r1515 51053 B 67/7 ms; en r1515 60361 B 53/10 ms | — | 3 | — |
| 1516 | 34c653dc | 04:21:52 | 95 | ko r1516 60246 B 45/9 ms; ja r1516 50173 B 51/18 ms; en r1516 59309 B 35/6 ms | — | 3 | — |
| 1517 | 34c653dc | 04:21:52 | 113 | ko r1517 59218 B 56/6 ms; ja r1517 49274 B 60/7 ms; en r1517 58298 B 45/6 ms | — | 3 | — |

Per save rev. builds = every `[liveSnapshot] build` at that rev; warm = the ones matched to a warm job (same instance, locale, rev); reader = the rest. Lookups and hinted fetches are keyed by their `minRev`.

| save rev | warm jobs | start → done ms | builds | warm | reader | hinted fetches | lookups | hit | miss | stale | invalid | error | timeout | memo-miss | capped | other | lookup ms p50 / p95 | hit rate |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1502 | 1 | 119 | 3 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — / — | — |
| 1503 | 1 | 108 | 442 | 3 | 439 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — / — | — |
| 1504 | 1 | 90 | 8 | 3 | 5 | 166 | 166 | 166 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 9 / 20 | 100.0 % |
| 1505 | 1 | 155 | 237 | 3 | 234 | 481 | 481 | 481 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 8 / 16 | 100.0 % |
| 1506 | 1 | 127 | 4 | 2 | 2 | 106 | 106 | 106 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 8 / 23 | 100.0 % |
| 1507 | 1 | 144 | 162 | 4 | 158 | 482 | 482 | 482 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 8 / 16 | 100.0 % |
| 1508 | 1 | 198 | 5 | 2 | 3 | 139 | 139 | 139 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 8 / 19 | 100.0 % |
| 1509 | 1 | 148 | 173 | 4 | 169 | 490 | 490 | 490 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 8 / 17 | 100.0 % |
| 1510 | 1 | 90 | 3 | 3 | 0 | 121 | 121 | 121 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 8 / 19 | 100.0 % |
| 1511 | 1 | 123 | 180 | 3 | 177 | 500 | 500 | 500 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 8 / 15 | 100.0 % |
| 1512 | 1 | 105 | 7 | 3 | 4 | 116 | 116 | 116 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 8 / 21 | 100.0 % |
| 1513 | 1 | 83 | 206 | 3 | 203 | 492 | 492 | 492 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 8 / 15 | 100.0 % |
| 1514 | 1 | 130 | 5 | 3 | 2 | 135 | 135 | 135 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 8 / 16 | 100.0 % |
| 1515 | 1 | 132 | 57 | 3 | 54 | 492 | 492 | 492 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 8 / 18 | 100.0 % |
| 1516 | 1 | 95 | 4 | 3 | 1 | 334 | 334 | 334 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 8 / 16 | 100.0 % |
| 1517 | 1 | 113 | 24 | 3 | 21 | 484 | 484 | 484 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 7 / 10 | 100.0 % |

Lookup ms by result (p50 / p95, n): hit 8 / 17 (4538). Whole capture: hit 4538, miss 0, stale 0, invalid 0, error 0, timeout 0, memo-miss 0, capped 0, other 0.

| minute | lookups | hit | miss | stale | invalid | error | timeout | memo-miss | capped | other |
|---|---|---|---|---|---|---|---|---|---|---|
| 04:19 | 647 | 647 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| 04:20 | 1832 | 1832 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| 04:21 | 2059 | 2059 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |

### Admin writes (`[liveWriter]`)

| route | saves | acquire ms p50 / p95 | exec ms p50 / p95 | ok=false | failed kinds |
|---|---|---|---|---|---|
| admin-insert-after | 2 | 3 / 3 | 108 / 154 | 0 | — |
| admin-update | 12 | 3 / 4 | 59 / 103 | 0 | — |
| admin-delete | 2 | 3 / 3 | 19 / 24 | 0 | — |

Every save (routes with ≤ 12 saves; `at` = the server's commit time, epoch ms → UTC):

| route | rev | acquire ms | exec ms | ok | at (UTC) | instance |
|---|---|---|---|---|---|---|
| admin-insert-after | 1502 | 3 | 154 | true | 2026-10-12T04:19:20.313Z | 1b0a972d |
| admin-insert-after | 1503 | 3 | 108 | true | 2026-10-12T04:19:20.861Z | 1b0a972d |
| admin-update | 1504 | 4 | 62 | true | 2026-10-12T04:19:42.612Z | 8cad27e0 |
| admin-update | 1505 | 3 | 46 | true | 2026-10-12T04:19:42.761Z | 8cad27e0 |
| admin-update | 1506 | 3 | 94 | true | 2026-10-12T04:20:07.689Z | 040e21ca |
| admin-update | 1507 | 4 | 103 | true | 2026-10-12T04:20:07.782Z | a3ca30b0 |
| admin-update | 1508 | 2 | 59 | true | 2026-10-12T04:20:32.633Z | 0e36bc74 |
| admin-update | 1509 | 2 | 82 | true | 2026-10-12T04:20:32.763Z | 8ad750c7 |
| admin-update | 1510 | 2 | 44 | true | 2026-10-12T04:20:57.601Z | 6be337b1 |
| admin-update | 1511 | 3 | 51 | true | 2026-10-12T04:20:57.722Z | 6be337b1 |
| admin-update | 1512 | 4 | 54 | true | 2026-10-12T04:21:22.630Z | a3ca30b0 |
| admin-update | 1513 | 3 | 84 | true | 2026-10-12T04:21:22.754Z | 0e36bc74 |
| admin-update | 1514 | 4 | 43 | true | 2026-10-12T04:21:47.633Z | 040e21ca |
| admin-update | 1515 | 3 | 68 | true | 2026-10-12T04:21:47.766Z | 34c653dc |
| admin-delete | 1516 | 3 | 24 | true | 2026-10-12T04:21:52.911Z | 34c653dc |
| admin-delete | 1517 | 3 | 19 | true | 2026-10-12T04:21:53.234Z | 34c653dc |

### Per minute

| minute | requests | distinct instances | builds | EMAXCONN |
|---|---|---|---|---|
| 04:19 | 2679 | 45 | 608 | 0 |
| 04:20 | 3422 | 47 | 454 | 0 |
| 04:21 | 3530 | 50 | 459 | 0 |

### Prisma pool totals per 5 s (app-side estimate of pooler clients)

Peak carried sum: **61** (carry 5 s). "reported" = instances that logged in the bucket (max total each); "carried" also counts an instance's last total for 5 s after its last line.

| bucket | reporting instances | Σ total (reported) | instances (carried) | Σ total (carried) | max waiting |
|---|---|---|---|---|---|
| 04:19:15 | 1 | 2 | 1 | 2 | 0 |
| 04:19:20 | 27 | 46 | 27 | 46 | 3 |
| 04:19:25 | 29 | 57 | 31 | 61 | 1 |
| 04:19:30 | 10 | 19 | 29 | 55 | 0 |
| 04:19:35 | 2 | 2 | 10 | 17 | 0 |
| 04:19:40 | 17 | 22 | 17 | 22 | 1 |
| 04:19:45 | 10 | 15 | 17 | 23 | 0 |
| 04:19:50 | 9 | 13 | 10 | 14 | 0 |
| 04:19:55 | 3 | 4 | 9 | 11 | 0 |
| 04:20:00 | 4 | 8 | 4 | 8 | 0 |
| 04:20:05 | 10 | 13 | 11 | 15 | 0 |
| 04:20:10 | 7 | 10 | 10 | 14 | 0 |
| 04:20:15 | 5 | 5 | 7 | 8 | 0 |
| 04:20:20 | 4 | 7 | 5 | 8 | 0 |
| 04:20:25 | 5 | 9 | 5 | 9 | 0 |
| 04:20:30 | 10 | 16 | 10 | 16 | 0 |
| 04:20:35 | 7 | 9 | 10 | 13 | 0 |
| 04:20:40 | 6 | 12 | 7 | 14 | 0 |
| 04:20:45 | 5 | 10 | 6 | 12 | 0 |
| 04:20:50 | 3 | 5 | 5 | 9 | 0 |
| 04:20:55 | 10 | 12 | 10 | 12 | 0 |
| 04:21:00 | 6 | 7 | 10 | 11 | 0 |
| 04:21:05 | 5 | 8 | 6 | 9 | 0 |
| 04:21:10 | 4 | 8 | 5 | 9 | 0 |
| 04:21:15 | 3 | 6 | 4 | 8 | 0 |
| 04:21:20 | 13 | 16 | 13 | 16 | 0 |
| 04:21:25 | 6 | 10 | 13 | 18 | 0 |
| 04:21:30 | 5 | 8 | 6 | 10 | 0 |
| 04:21:35 | 4 | 8 | 5 | 10 | 0 |
| 04:21:40 | 2 | 4 | 4 | 8 | 0 |
| 04:21:45 | 11 | 16 | 11 | 16 | 0 |
| 04:21:50 | 16 | 21 | 18 | 23 | 0 |

### Other lines

| kind | count |
|---|---|
| untagged: No logs found for opensetlist-projects/opensetlist | 4 |
