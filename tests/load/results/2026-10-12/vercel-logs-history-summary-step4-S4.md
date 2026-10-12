## Vercel runtime logs — 2026-10-12T04-24-25Z-vercel-logs-history-step4-S4.txt

12158 entries; requests: /api/setlist 11517, other API 181, pages 460; error-level entries 0. Times: log clock +7 h.

### Builds per rev (`[liveSnapshot] build` lines: 1879)

| rev | builds | distinct instances | locales | build ms avg / max | first – last |
|---|---|---|---|---|---|
| 1518 | 1 | 1 | ko 1 | 57 / 57 | 04:24:59 – 04:24:59 |
| 1519 | 3 | 1 | ko 1, ja 1, en 1 | 44 / 52 | 04:25:00 – 04:25:00 |
| 1520 | 3 | 1 | ja 1, ko 1, en 1 | 44 / 50 | 04:25:00 – 04:25:00 |
| 1521 | 681 | 24 | ja 422, ko 163, en 96 | 441 / 1941 | 04:25:01 – 04:25:28 |
| 1522 | 10 | 4 | en 2, ja 5, ko 3 | 84 / 154 | 04:25:28 – 04:25:28 |
| 1523 | 5 | 3 | ja 2, en 2, ko 1 | 62 / 92 | 04:25:28 – 04:25:29 |
| 1524 | 222 | 19 | en 26, ja 152, ko 44 | 53 / 146 | 04:25:29 – 04:25:53 |
| 1525 | 6 | 2 | ja 3, ko 2, en 1 | 44 / 65 | 04:25:53 – 04:25:53 |
| 1526 | 3 | 1 | ja 1, ko 1, en 1 | 56 / 89 | 04:25:53 – 04:25:53 |
| 1527 | 176 | 13 | ko 40, en 29, ja 107 | 55 / 513 | 04:25:53 – 04:26:18 |
| 1528 | 7 | 4 | ko 4, ja 2, en 1 | 48 / 59 | 04:26:18 – 04:26:19 |
| 1529 | 4 | 2 | ko 2, ja 1, en 1 | 57 / 69 | 04:26:18 – 04:26:19 |
| 1530 | 179 | 12 | ja 121, ko 33, en 25 | 51 / 528 | 04:26:19 – 04:26:43 |
| 1531 | 6 | 2 | ja 4, ko 1, en 1 | 36 / 45 | 04:26:43 – 04:26:44 |
| 1532 | 3 | 1 | ko 1, ja 1, en 1 | 66 / 96 | 04:26:43 – 04:26:43 |
| 1533 | 227 | 23 | ja 156, ko 49, en 22 | 50 / 119 | 04:26:44 – 04:27:08 |
| 1534 | 7 | 4 | en 2, ja 4, ko 1 | 38 / 54 | 04:27:08 – 04:27:08 |
| 1535 | 7 | 5 | ja 5, ko 1, en 1 | 51 / 67 | 04:27:08 – 04:27:09 |
| 1536 | 179 | 14 | ja 117, ko 43, en 19 | 53 / 142 | 04:27:08 – 04:27:32 |
| 1537 | 7 | 3 | ja 4, ko 2, en 1 | 59 / 80 | 04:27:33 – 04:27:34 |
| 1538 | 3 | 1 | ko 1, ja 1, en 1 | 72 / 97 | 04:27:33 – 04:27:33 |
| 1539 | 67 | 17 | ja 44, en 8, ko 15 | 71 / 534 | 04:27:34 – 04:27:40 |
| 1540 | 8 | 3 | ja 4, ko 3, en 1 | 32 / 41 | 04:27:40 – 04:27:40 |
| 1541 | 8 | 5 | ja 6, en 1, ko 1 | 57 / 88 | 04:27:40 – 04:27:41 |
| 1542 | 57 | 25 | ja 40, ko 12, en 5 | 76 / 515 | 04:27:41 – 04:27:43 |

### Failures, repair reads, coalescing

| what | count | detail |
|---|---|---|
| EMAXCONN (pooler client cap) | 0 | API 0, SSR 0 |
| `[liveSnapshot] build-failed` | 0 | — |
| `[liveSnapshot] rev-read` (repair revision read) | 0 | rev=timeout 0, rev=error 0; ms p50 — / max —; by hint: — |
| `[liveSnapshot] coalesced` | 69 | waiters sum 195, max 7 |
| `[setlist] slow-hit` | 0 | max — ms |

### Hint outcomes (`[setlist] hint-fetch` lines: 6852)

Whole capture: satisfied 6852, fresh 0, memo 0, deferred 0, none 0, error 0, other 0. "other" = a `verify=` value this script does not know.

| minute | hint fetches | satisfied | fresh | memo | deferred | none | error | other |
|---|---|---|---|---|---|---|---|---|
| 04:25 | 1978 | 1978 | 0 | 0 | 0 | 0 | 0 | 0 |
| 04:26 | 1981 | 1981 | 0 | 0 | 0 | 0 | 0 | 0 |
| 04:27 | 2893 | 2893 | 0 | 0 | 0 | 0 | 0 | 0 |

### Warming (`[liveWarm]` jobs: 24; `[setlist] warm-lookup` lines: 6852)

**warm hit rate = hits ÷ hinted fetches = 6852 / 6852 = 100.0 %** (hinted fetches = `[setlist] hint-fetch` lines with a numeric minRev; lookups 6852).

schedule-failed 0; job-failed 0; set ok=false 0 (set-error lines 0); skips 0; lookup-error lines 0; warm builds matched 72.

Warm jobs. start → done = the job's own `done ms=` (it starts in `after()`, i.e. right after the save's response, so it is ≈ warm-complete − commit). Per locale: actual rev, bytes, build / set ms, ok.

| save rev | instance | start (log clock) | start → done ms | sets | skips | warm builds (unmatched) | job-failed |
|---|---|---|---|---|---|---|---|
| 1519 | a97e72b8 | 04:25:00 | 111 | ko r1519 80830 B 43/14 ms; ja r1519 67230 B 54/12 ms; en r1519 79463 B 39/14 ms | — | 3 | — |
| 1520 | a97e72b8 | 04:25:00 | 106 | ja r1520 85188 B 45/10 ms; ko r1520 102444 B 52/7 ms; en r1520 100630 B 42/9 ms | — | 3 | — |
| 1521 | a97e72b8 | 04:25:01 | 117 | ja r1521 103146 B 48/14 ms; ko r1521 124058 B 58/10 ms; en r1521 121797 B 45/10 ms | — | 3 | — |
| 1522 | 040e21ca | 04:25:28 | 212 | ko r1522 103201 B 61/14 ms; ja r1522 85873 B 72/10 ms; en r1522 101377 B 124/13 ms | — | 3 | — |
| 1523 | 1fb7c808 | 04:25:28 | 134 | ko r1523 82451 B 58/9 ms; ja r1523 68624 B 64/9 ms; en r1523 81065 B 56/11 ms | — | 3 | — |
| 1524 | 1fb7c808 | 04:25:29 | 113 | ko r1524 61679 B 60/7 ms; ja r1524 51372 B 65/5 ms; en r1524 60732 B 40/5 ms | — | 3 | — |
| 1525 | 59b7d60f | 04:25:53 | 102 | ko r1525 61679 B 47/9 ms; ja r1525 51372 B 66/6 ms; en r1525 60732 B 38/8 ms | — | 3 | — |
| 1526 | 040e21ca | 04:25:53 | 172 | ja r1526 51337 B 32/6 ms; ko r1526 61626 B 50/8 ms; en r1526 60676 B 90/43 ms | — | 3 | — |
| 1527 | b262578d | 04:25:53 | 136 | ja r1527 51317 B 59/9 ms; ko r1527 61539 B 64/13 ms; en r1527 60588 B 55/12 ms | — | 3 | — |
| 1528 | e7875dfd | 04:26:18 | 101 | ja r1528 51317 B 48/6 ms; ko r1528 61536 B 58/5 ms; en r1528 60586 B 40/6 ms | — | 3 | — |
| 1529 | 2ce0033b | 04:26:18 | 137 | ja r1529 51329 B 61/6 ms; ko r1529 61550 B 71/8 ms; en r1529 60597 B 60/9 ms | — | 3 | — |
| 1530 | 83257bbe | 04:26:19 | 131 | ko r1530 61525 B 49/18 ms; ja r1530 51310 B 77/6 ms; en r1530 60576 B 44/15 ms | — | 3 | — |
| 1531 | 34446bdc | 04:26:43 | 81 | ja r1531 51281 B 34/5 ms; ko r1531 61482 B 47/4 ms; en r1531 60542 B 37/5 ms | — | 3 | — |
| 1532 | 065cf899 | 04:26:43 | 119 | ko r1532 61680 B 57/8 ms; ja r1532 51474 B 97/14 ms; en r1532 60737 B 48/6 ms | — | 3 | — |
| 1533 | f37c2992 | 04:26:44 | 156 | ko r1533 62003 B 78/9 ms; ja r1533 51722 B 120/7 ms; en r1533 61050 B 62/5 ms | — | 3 | — |
| 1534 | 8f9143a5 | 04:27:08 | 93 | ko r1534 62421 B 39/7 ms; ja r1534 51981 B 55/7 ms; en r1534 61447 B 39/7 ms | — | 3 | — |
| 1535 | 0e36bc74 | 04:27:08 | 117 | ja r1535 51819 B 49/14 ms; ko r1535 62194 B 61/5 ms; en r1535 61224 B 49/5 ms | — | 3 | — |
| 1536 | e7875dfd | 04:27:08 | 182 | ko r1536 61932 B 61/8 ms; ja r1536 51571 B 73/14 ms; en r1536 60978 B 89/23 ms | — | 3 | — |
| 1537 | 309af1d3 | 04:27:33 | 128 | ja r1537 51329 B 59/8 ms; ko r1537 61531 B 64/13 ms; en r1537 60598 B 45/14 ms | — | 3 | — |
| 1538 | 26703999 | 04:27:33 | 140 | ko r1538 61442 B 77/9 ms; ja r1538 51264 B 98/5 ms; en r1538 60523 B 47/5 ms | — | 3 | — |
| 1539 | 309af1d3 | 04:27:34 | 127 | ja r1539 51255 B 59/9 ms; ko r1539 61364 B 65/7 ms; en r1539 60444 B 52/7 ms | — | 3 | — |
| 1540 | 040e21ca | 04:27:40 | 81 | ja r1540 50598 B 31/8 ms; ko r1540 60652 B 36/16 ms; en r1540 59732 B 35/6 ms | — | 3 | — |
| 1541 | 86c76005 | 04:27:40 | 139 | ja r1541 49947 B 90/27 ms; en r1541 59026 B 64/6 ms; ko r1541 59946 B 60/9 ms | — | 3 | — |
| 1542 | 1fbe1734 | 04:27:41 | 180 | ko r1542 59219 B 59/20 ms; ja r1542 49275 B 116/34 ms; en r1542 58299 B 92/8 ms | — | 3 | — |

Per save rev. builds = every `[liveSnapshot] build` at that rev; warm = the ones matched to a warm job (same instance, locale, rev); reader = the rest. Lookups and hinted fetches are keyed by their `minRev`.

| save rev | warm jobs | start → done ms | builds | warm | reader | hinted fetches | lookups | hit | miss | stale | invalid | error | timeout | memo-miss | capped | other | lookup ms p50 / p95 | hit rate |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1519 | 1 | 111 | 3 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — / — | — |
| 1520 | 1 | 106 | 3 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — / — | — |
| 1521 | 1 | 117 | 681 | 3 | 678 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — / — | — |
| 1522 | 1 | 212 | 10 | 3 | 7 | 319 | 319 | 319 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 11 / 26 | 100.0 % |
| 1523 | 1 | 134 | 5 | 3 | 2 | 181 | 181 | 181 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 9 / 22 | 100.0 % |
| 1524 | 1 | 113 | 222 | 3 | 219 | 469 | 469 | 469 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 7 / 12 | 100.0 % |
| 1525 | 1 | 102 | 6 | 3 | 3 | 232 | 232 | 232 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 8 / 19 | 100.0 % |
| 1526 | 1 | 172 | 3 | 3 | 0 | 281 | 281 | 281 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 8 / 18 | 100.0 % |
| 1527 | 1 | 136 | 176 | 3 | 173 | 496 | 496 | 496 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 8 / 12 | 100.0 % |
| 1528 | 1 | 101 | 7 | 3 | 4 | 271 | 271 | 271 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 8 / 17 | 100.0 % |
| 1529 | 1 | 137 | 4 | 3 | 1 | 238 | 238 | 238 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 8 / 15 | 100.0 % |
| 1530 | 1 | 131 | 179 | 3 | 176 | 492 | 492 | 492 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 7 / 13 | 100.0 % |
| 1531 | 1 | 81 | 6 | 3 | 3 | 227 | 227 | 227 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 8 / 20 | 100.0 % |
| 1532 | 1 | 119 | 3 | 3 | 0 | 285 | 285 | 285 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 8 / 12 | 100.0 % |
| 1533 | 1 | 156 | 227 | 3 | 224 | 468 | 468 | 468 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 8 / 14 | 100.0 % |
| 1534 | 1 | 93 | 7 | 3 | 4 | 193 | 193 | 193 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 8 / 18 | 100.0 % |
| 1535 | 1 | 117 | 7 | 3 | 4 | 314 | 314 | 314 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 8 / 14 | 100.0 % |
| 1536 | 1 | 182 | 179 | 3 | 176 | 481 | 481 | 481 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 7 / 12 | 100.0 % |
| 1537 | 1 | 128 | 7 | 3 | 4 | 264 | 264 | 264 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 8 / 15 | 100.0 % |
| 1538 | 1 | 140 | 3 | 3 | 0 | 207 | 207 | 207 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 8 / 20 | 100.0 % |
| 1539 | 1 | 127 | 67 | 3 | 64 | 483 | 483 | 483 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 8 / 17 | 100.0 % |
| 1540 | 1 | 81 | 8 | 3 | 5 | 348 | 348 | 348 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 8 / 16 | 100.0 % |
| 1541 | 1 | 139 | 8 | 3 | 5 | 141 | 141 | 141 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 8 / 15 | 100.0 % |
| 1542 | 1 | 180 | 57 | 3 | 54 | 462 | 462 | 462 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 8 / 15 | 100.0 % |

Lookup ms by result (p50 / p95, n): hit 8 / 16 (6852). Whole capture: hit 6852, miss 0, stale 0, invalid 0, error 0, timeout 0, memo-miss 0, capped 0, other 0.

| minute | lookups | hit | miss | stale | invalid | error | timeout | memo-miss | capped | other |
|---|---|---|---|---|---|---|---|---|---|---|
| 04:25 | 1978 | 1978 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| 04:26 | 1981 | 1981 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| 04:27 | 2893 | 2893 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |

### Admin writes (`[liveWriter]`)

| route | saves | acquire ms p50 / p95 | exec ms p50 / p95 | ok=false | failed kinds |
|---|---|---|---|---|---|
| admin-insert-after | 3 | 3 / 17 | 100 / 117 | 0 | — |
| admin-update | 18 | 3 / 5 | 74 / 191 | 0 | — |
| admin-delete | 3 | 4 / 4 | 31 / 43 | 0 | — |

Every save (routes with ≤ 12 saves; `at` = the server's commit time, epoch ms → UTC):

| route | rev | acquire ms | exec ms | ok | at (UTC) | instance |
|---|---|---|---|---|---|---|
| admin-insert-after | 1519 | 17 | 117 | true | 2026-10-12T04:25:00.842Z | a97e72b8 |
| admin-insert-after | 1520 | 3 | 100 | true | 2026-10-12T04:25:01.267Z | a97e72b8 |
| admin-insert-after | 1521 | 3 | 98 | true | 2026-10-12T04:25:01.805Z | a97e72b8 |
| admin-delete | 1540 | 2 | 17 | true | 2026-10-12T04:27:40.868Z | 040e21ca |
| admin-delete | 1541 | 4 | 43 | true | 2026-10-12T04:27:41.222Z | 86c76005 |
| admin-delete | 1542 | 4 | 31 | true | 2026-10-12T04:27:41.616Z | 1fbe1734 |

### Per minute

| minute | requests | distinct instances | builds | EMAXCONN |
|---|---|---|---|---|
| 04:24 | 1 | 1 | 1 | 0 |
| 04:25 | 4530 | 50 | 971 | 0 |
| 04:26 | 3570 | 47 | 484 | 0 |
| 04:27 | 4057 | 53 | 423 | 0 |

### Prisma pool totals per 5 s (app-side estimate of pooler clients)

Peak carried sum: **46** (carry 5 s). "reported" = instances that logged in the bucket (max total each); "carried" also counts an instance's last total for 5 s after its last line.

| bucket | reporting instances | Σ total (reported) | instances (carried) | Σ total (carried) | max waiting |
|---|---|---|---|---|---|
| 04:24:55 | 1 | 1 | 1 | 1 | 0 |
| 04:25:00 | 20 | 39 | 21 | 40 | 4 |
| 04:25:05 | 22 | 44 | 23 | 46 | 9 |
| 04:25:10 | 21 | 42 | 23 | 46 | 1 |
| 04:25:15 | 2 | 2 | 21 | 40 | 0 |
| 04:25:20 | 4 | 6 | 4 | 6 | 0 |
| 04:25:25 | 10 | 16 | 10 | 16 | 1 |
| 04:25:30 | 18 | 25 | 19 | 26 | 0 |
| 04:25:35 | 3 | 4 | 18 | 23 | 0 |
| 04:25:40 | 4 | 7 | 4 | 7 | 0 |
| 04:25:45 | 4 | 8 | 4 | 8 | 0 |
| 04:25:50 | 6 | 10 | 6 | 10 | 0 |
| 04:25:55 | 13 | 15 | 15 | 19 | 0 |
| 04:26:00 | 5 | 7 | 13 | 16 | 0 |
| 04:26:05 | 4 | 8 | 5 | 9 | 0 |
| 04:26:10 | 4 | 8 | 4 | 8 | 0 |
| 04:26:15 | 7 | 11 | 7 | 11 | 0 |
| 04:26:20 | 12 | 14 | 12 | 14 | 0 |
| 04:26:25 | 8 | 12 | 12 | 17 | 0 |
| 04:26:30 | 8 | 12 | 8 | 12 | 0 |
| 04:26:35 | 6 | 7 | 8 | 10 | 0 |
| 04:26:40 | 7 | 11 | 8 | 13 | 0 |
| 04:26:45 | 21 | 28 | 23 | 30 | 0 |
| 04:26:50 | 5 | 7 | 21 | 29 | 0 |
| 04:26:55 | 2 | 4 | 5 | 8 | 0 |
| 04:27:00 | 4 | 8 | 4 | 8 | 0 |
| 04:27:05 | 9 | 14 | 9 | 14 | 0 |
| 04:27:10 | 13 | 16 | 15 | 20 | 0 |
| 04:27:15 | 7 | 10 | 13 | 16 | 0 |
| 04:27:20 | 6 | 8 | 7 | 10 | 0 |
| 04:27:25 | 5 | 10 | 6 | 11 | 0 |
| 04:27:30 | 5 | 9 | 6 | 11 | 0 |
| 04:27:35 | 17 | 21 | 18 | 23 | 0 |
| 04:27:40 | 28 | 35 | 29 | 36 | 0 |

### Other lines

| kind | count |
|---|---|
| untagged: No logs found for opensetlist-projects/opensetlist | 4 |
