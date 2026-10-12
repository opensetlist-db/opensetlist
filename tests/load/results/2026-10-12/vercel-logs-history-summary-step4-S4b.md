## Vercel runtime logs — 2026-10-12T04-30-20Z-vercel-logs-history-step4-S4b.txt

9956 entries; requests: /api/setlist 9314, other API 182, pages 460; error-level entries 0. Times: log clock +7 h.

### Builds per rev (`[liveSnapshot] build` lines: 1679)

| rev | builds | distinct instances | locales | build ms avg / max | first – last |
|---|---|---|---|---|---|
| 1543 | 1 | 1 | ko 1 | 56 / 56 | 04:30:54 – 04:30:54 |
| 1544 | 3 | 1 | ko 1, ja 1, en 1 | 50 / 60 | 04:30:55 – 04:30:55 |
| 1545 | 3 | 1 | ko 1, ja 1, en 1 | 58 / 69 | 04:30:56 – 04:30:56 |
| 1546 | 606 | 31 | en 82, ja 381, ko 143 | 193 / 677 | 04:30:56 – 04:31:24 |
| 1547 | 5 | 3 | ja 3, ko 1, en 1 | 63 / 96 | 04:31:23 – 04:31:24 |
| 1548 | 3 | 2 | ko 2, ja 1 | 63 / 102 | 04:31:23 – 04:31:24 |
| 1549 | 166 | 14 | ja 102, ko 39, en 25 | 50 / 137 | 04:31:23 – 04:31:48 |
| 1550 | 1 | 1 | ko 1 | 69 / 69 | 04:31:48 – 04:31:48 |
| 1551 | 1 | 1 | ja 1 | 78 / 78 | 04:31:48 – 04:31:48 |
| 1552 | 161 | 9 | ja 105, ko 36, en 20 | 51 / 133 | 04:31:48 – 04:32:14 |
| 1553 | 4 | 2 | ko 2, en 1, ja 1 | 56 / 69 | 04:32:13 – 04:32:14 |
| 1554 | 4 | 2 | ja 2, ko 1, en 1 | 64 / 76 | 04:32:13 – 04:32:14 |
| 1555 | 183 | 8 | en 32, ja 113, ko 38 | 53 / 525 | 04:32:13 – 04:32:39 |
| 1556 | 5 | 2 | ja 2, ko 2, en 1 | 48 / 56 | 04:32:39 – 04:32:39 |
| 1557 | 4 | 3 | ja 2, ko 2 | 62 / 95 | 04:32:39 – 04:32:39 |
| 1558 | 196 | 15 | ja 126, ko 45, en 25 | 53 / 656 | 04:32:39 – 04:33:03 |
| 1559 | 2 | 2 | ko 2 | 48 / 49 | 04:33:03 – 04:33:04 |
| 1560 | 2 | 2 | ko 1, ja 1 | 74 / 97 | 04:33:03 – 04:33:03 |
| 1561 | 223 | 12 | ko 51, ja 147, en 25 | 49 / 118 | 04:33:03 – 04:33:29 |
| 1563 | 2 | 2 | ja 1, ko 1 | 60 / 83 | 04:33:28 – 04:33:29 |
| 1564 | 56 | 10 | ko 12, ja 32, en 12 | 80 / 511 | 04:33:28 – 04:33:35 |
| 1565 | 4 | 2 | ja 2, ko 1, en 1 | 59 / 97 | 04:33:35 – 04:33:35 |
| 1566 | 7 | 5 | ja 4, ko 2, en 1 | 62 / 81 | 04:33:36 – 04:33:36 |
| 1567 | 37 | 20 | ja 27, en 5, ko 5 | 74 / 553 | 04:33:36 – 04:33:38 |

### Failures, repair reads, coalescing

| what | count | detail |
|---|---|---|
| EMAXCONN (pooler client cap) | 0 | API 0, SSR 0 |
| `[liveSnapshot] build-failed` | 0 | — |
| `[liveSnapshot] rev-read` (repair revision read) | 0 | rev=timeout 0, rev=error 0; ms p50 — / max —; by hint: — |
| `[liveSnapshot] coalesced` | 108 | waiters sum 266, max 6 |
| `[setlist] slow-hit` | 0 | max — ms |

### Hint outcomes (`[setlist] hint-fetch` lines: 4663)

Whole capture: satisfied 4663, fresh 0, memo 0, deferred 0, none 0, error 0, other 0. "other" = a `verify=` value this script does not know.

| minute | hint fetches | satisfied | fresh | memo | deferred | none | error | other |
|---|---|---|---|---|---|---|---|---|
| 04:31 | 1254 | 1254 | 0 | 0 | 0 | 0 | 0 | 0 |
| 04:32 | 1327 | 1327 | 0 | 0 | 0 | 0 | 0 | 0 |
| 04:33 | 2082 | 2082 | 0 | 0 | 0 | 0 | 0 | 0 |

### Warming (`[liveWarm]` jobs: 24; `[setlist] warm-lookup` lines: 4663)

**warm hit rate = hits ÷ hinted fetches = 4660 / 4663 = 99.9 %** (hinted fetches = `[setlist] hint-fetch` lines with a numeric minRev; lookups 4663).

schedule-failed 0; job-failed 0; set ok=false 0 (set-error lines 0); skips 0; lookup-error lines 0; warm builds matched 72.

Warm jobs. start → done = the job's own `done ms=` (it starts in `after()`, i.e. right after the save's response, so it is ≈ warm-complete − commit). Per locale: actual rev, bytes, build / set ms, ok.

| save rev | instance | start (log clock) | start → done ms | sets | skips | warm builds (unmatched) | job-failed |
|---|---|---|---|---|---|---|---|
| 1544 | 26703999 | 04:30:55 | 108 | ko r1544 80830 B 42/9 ms; ja r1544 67230 B 61/6 ms; en r1544 79463 B 50/7 ms | — | 3 | — |
| 1545 | 26703999 | 04:30:56 | 150 | ko r1545 102444 B 44/27 ms; ja r1545 85188 B 66/24 ms; en r1545 100630 B 71/7 ms | — | 3 | — |
| 1546 | 26703999 | 04:30:56 | 138 | ja r1546 103146 B 48/15 ms; ko r1546 124058 B 59/11 ms; en r1546 121797 B 49/26 ms | — | 3 | — |
| 1547 | 178c16e7 | 04:31:23 | 126 | ko r1547 103201 B 58/18 ms; ja r1547 85873 B 97/7 ms; en r1547 101377 B 42/8 ms | — | 3 | — |
| 1548 | 46f862ec | 04:31:23 | 200 | ja r1548 68624 B 43/13 ms; ko r1548 82451 B 120/36 ms; en r1549 60732 B 139/5 ms | — | 3 | — |
| 1549 | afb766c8 | 04:31:23 | 161 | ko r1549 61679 B 101/7 ms; ja r1549 51372 B 111/5 ms; en r1549 60732 B 48/5 ms | — | 3 | — |
| 1550 | afb766c8 | 04:31:48 | 206 | en r1552 60588 B 105/8 ms; ko r1550 61626 B 71/22 ms; ja r1551 51337 B 89/7 ms | — | 3 | — |
| 1551 | afb766c8 | 04:31:48 | 201 | ja r1552 51317 B 126/5 ms; ko r1552 61539 B 134/6 ms; en r1552 60588 B 60/10 ms | — | 3 | — |
| 1552 | 8f9143a5 | 04:31:48 | 104 | en r1552 60588 B 51/7 ms; ja r1552 51317 B 35/11 ms; ko r1552 61539 B 43/10 ms | — | 3 | — |
| 1553 | afb91b5f | 04:32:13 | 123 | en r1554 60597 B 77/4 ms; ko r1553 61536 B 34/6 ms; ja r1553 51317 B 70/8 ms | — | 3 | — |
| 1554 | afb91b5f | 04:32:13 | 102 | ko r1554 61550 B 39/4 ms; ja r1554 51329 B 70/5 ms; en r1555 60576 B 52/6 ms | — | 3 | — |
| 1555 | 8ad750c7 | 04:32:13 | 182 | ko r1555 61525 B 60/8 ms; ja r1555 51310 B 65/7 ms; en r1555 60576 B 107/6 ms | — | 3 | — |
| 1556 | 8ad750c7 | 04:32:39 | 117 | ko r1556 61482 B 50/10 ms; ja r1556 51281 B 57/8 ms; en r1556 60542 B 50/7 ms | — | 3 | — |
| 1557 | 5fd95f2f | 04:32:39 | 128 | ko r1557 61680 B 54/19 ms; ja r1558 51722 B 99/7 ms; en r1558 61050 B 46/8 ms | — | 3 | — |
| 1558 | afb91b5f | 04:32:39 | 166 | ko r1558 62003 B 80/5 ms; ja r1558 51722 B 103/4 ms; en r1558 61050 B 76/5 ms | — | 3 | — |
| 1559 | 579a5afe | 04:33:03 | 150 | ko r1559 62421 B 47/13 ms; ja r1560 51819 B 98/6 ms; en r1561 60978 B 73/16 ms | — | 3 | — |
| 1560 | 0b6a1b20 | 04:33:03 | 120 | ko r1560 62194 B 53/9 ms; ja r1561 51571 B 74/7 ms; en r1561 60978 B 49/8 ms | — | 3 | — |
| 1561 | 579a5afe | 04:33:03 | 170 | ko r1561 61932 B 83/11 ms; ja r1561 51571 B 91/21 ms; en r1561 60978 B 66/10 ms | — | 3 | — |
| 1562 | c4b22cb9 | 04:33:28 | 264 | ko r1563 61631 B 84/7 ms; ja r1564 51299 B 122/20 ms; en r1564 60701 B 161/10 ms | — | 3 | — |
| 1563 | c4b22cb9 | 04:33:28 | 343 | ko r1564 61645 B 143/13 ms; ja r1564 51299 B 152/9 ms; en r1564 60701 B 179/6 ms | — | 3 | — |
| 1564 | c4b22cb9 | 04:33:28 | 363 | ko r1564 61645 B 154/10 ms; ja r1564 51299 B 210/10 ms; en r1564 60701 B 169/30 ms | — | 3 | — |
| 1565 | c4b22cb9 | 04:33:35 | 89 | ko r1565 60841 B 34/7 ms; ja r1565 50626 B 71/9 ms; en r1565 59902 B 37/11 ms | — | 3 | — |
| 1566 | b9939274 | 04:33:36 | 113 | ko r1566 60050 B 64/6 ms; ja r1566 49958 B 82/5 ms; en r1566 59110 B 36/5 ms | — | 3 | — |
| 1567 | 6be337b1 | 04:33:36 | 128 | ja r1567 49275 B 63/18 ms; ko r1567 59219 B 74/10 ms; en r1567 58299 B 41/6 ms | — | 3 | — |

Per save rev. builds = every `[liveSnapshot] build` at that rev; warm = the ones matched to a warm job (same instance, locale, rev); reader = the rest. Lookups and hinted fetches are keyed by their `minRev`.

| save rev | warm jobs | start → done ms | builds | warm | reader | hinted fetches | lookups | hit | miss | stale | invalid | error | timeout | memo-miss | capped | other | lookup ms p50 / p95 | hit rate |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1544 | 1 | 108 | 3 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — / — | — |
| 1545 | 1 | 150 | 3 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — / — | — |
| 1546 | 1 | 138 | 606 | 3 | 603 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — / — | — |
| 1547 | 1 | 126 | 5 | 3 | 2 | 100 | 100 | 100 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 11 / 24 | 100.0 % |
| 1548 | 1 | 200 | 3 | 2 | 1 | 121 | 121 | 121 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 9 / 18 | 100.0 % |
| 1549 | 1 | 161 | 166 | 4 | 162 | 466 | 466 | 466 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 7 / 15 | 100.0 % |
| 1550 | 1 | 206 | 1 | 1 | 0 | 61 | 61 | 61 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 8 / 15 | 100.0 % |
| 1551 | 1 | 201 | 1 | 1 | 0 | 89 | 89 | 89 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 8 / 15 | 100.0 % |
| 1552 | 1 | 104 | 161 | 7 | 154 | 417 | 417 | 417 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 8 / 19 | 100.0 % |
| 1553 | 1 | 123 | 4 | 2 | 2 | 77 | 77 | 77 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 8 / 35 | 100.0 % |
| 1554 | 1 | 102 | 4 | 3 | 1 | 110 | 110 | 110 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 8 / 16 | 100.0 % |
| 1555 | 1 | 182 | 183 | 4 | 179 | 492 | 492 | 492 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 8 / 18 | 100.0 % |
| 1556 | 1 | 117 | 5 | 3 | 2 | 117 | 117 | 117 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 8 / 20 | 100.0 % |
| 1557 | 1 | 128 | 4 | 1 | 3 | 92 | 92 | 92 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 8 / 10 | 100.0 % |
| 1558 | 1 | 166 | 196 | 5 | 191 | 439 | 439 | 439 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 8 / 17 | 100.0 % |
| 1559 | 1 | 150 | 2 | 1 | 1 | 88 | 88 | 88 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 8 / 18 | 100.0 % |
| 1560 | 1 | 120 | 2 | 2 | 0 | 71 | 71 | 71 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 8 / 22 | 100.0 % |
| 1561 | 1 | 170 | 223 | 6 | 217 | 432 | 432 | 432 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 8 / 18 | 100.0 % |
| 1562 | 1 | 264 | 0 | 0 | 0 | 86 | 86 | 85 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 8 / 17 | 98.8 % |
| 1563 | 1 | 343 | 2 | 1 | 1 | 70 | 70 | 70 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 8 / 14 | 100.0 % |
| 1564 | 1 | 363 | 56 | 8 | 48 | 381 | 381 | 379 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 8 / 19 | 99.5 % |
| 1565 | 1 | 89 | 4 | 3 | 1 | 349 | 349 | 349 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 8 / 17 | 100.0 % |
| 1566 | 1 | 113 | 7 | 3 | 4 | 141 | 141 | 141 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 7 / 19 | 100.0 % |
| 1567 | 1 | 128 | 37 | 3 | 34 | 464 | 464 | 464 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 7 / 14 | 100.0 % |

Lookup ms by result (p50 / p95, n): hit 8 / 18 (4660); miss 3 / 4 (3). Whole capture: hit 4660, miss 3, stale 0, invalid 0, error 0, timeout 0, memo-miss 0, capped 0, other 0.

| minute | lookups | hit | miss | stale | invalid | error | timeout | memo-miss | capped | other |
|---|---|---|---|---|---|---|---|---|---|---|
| 04:31 | 1254 | 1254 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| 04:32 | 1327 | 1327 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| 04:33 | 2082 | 2079 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |

### Admin writes (`[liveWriter]`)

| route | saves | acquire ms p50 / p95 | exec ms p50 / p95 | ok=false | failed kinds |
|---|---|---|---|---|---|
| admin-insert-after | 3 | 3 / 4 | 116 / 126 | 0 | — |
| admin-update | 18 | 3 / 25 | 71 / 117 | 0 | — |
| admin-delete | 3 | 2 / 5 | 23 / 43 | 0 | — |

Every save (routes with ≤ 12 saves; `at` = the server's commit time, epoch ms → UTC):

| route | rev | acquire ms | exec ms | ok | at (UTC) | instance |
|---|---|---|---|---|---|---|
| admin-insert-after | 1544 | 3 | 126 | true | 2026-10-12T04:30:55.969Z | 26703999 |
| admin-insert-after | 1545 | 2 | 101 | true | 2026-10-12T04:30:56.524Z | 26703999 |
| admin-insert-after | 1546 | 4 | 116 | true | 2026-10-12T04:30:57.109Z | 26703999 |
| admin-delete | 1565 | 1 | 16 | true | 2026-10-12T04:33:35.982Z | c4b22cb9 |
| admin-delete | 1566 | 2 | 23 | true | 2026-10-12T04:33:36.345Z | b9939274 |
| admin-delete | 1567 | 5 | 43 | true | 2026-10-12T04:33:36.717Z | 6be337b1 |

### Per minute

| minute | requests | distinct instances | builds | EMAXCONN |
|---|---|---|---|---|
| 04:30 | 339 | 30 | 161 | 0 |
| 04:31 | 3601 | 66 | 699 | 0 |
| 04:32 | 2910 | 62 | 460 | 0 |
| 04:33 | 3106 | 65 | 359 | 0 |

### Prisma pool totals per 5 s (app-side estimate of pooler clients)

Peak carried sum: **61** (carry 5 s). "reported" = instances that logged in the bucket (max total each); "carried" also counts an instance's last total for 5 s after its last line.

| bucket | reporting instances | Σ total (reported) | instances (carried) | Σ total (carried) | max waiting |
|---|---|---|---|---|---|
| 04:30:50 | 1 | 1 | 1 | 1 | 0 |
| 04:30:55 | 30 | 51 | 30 | 51 | 4 |
| 04:31:00 | 31 | 61 | 31 | 61 | 3 |
| 04:31:05 | 26 | 51 | 31 | 60 | 4 |
| 04:31:10 | 2 | 3 | 26 | 50 | 0 |
| 04:31:15 | 3 | 5 | 3 | 5 | 0 |
| 04:31:20 | 11 | 17 | 11 | 17 | 0 |
| 04:31:25 | 13 | 19 | 14 | 21 | 0 |
| 04:31:30 | 4 | 4 | 13 | 17 | 0 |
| 04:31:35 | 4 | 8 | 4 | 8 | 0 |
| 04:31:40 | 4 | 8 | 4 | 8 | 0 |
| 04:31:45 | 6 | 10 | 6 | 10 | 1 |
| 04:31:50 | 9 | 11 | 9 | 11 | 0 |
| 04:31:55 | 5 | 10 | 9 | 14 | 0 |
| 04:32:00 | 4 | 8 | 5 | 10 | 0 |
| 04:32:05 | 3 | 5 | 4 | 7 | 0 |
| 04:32:10 | 3 | 6 | 3 | 6 | 1 |
| 04:32:15 | 8 | 11 | 8 | 11 | 0 |
| 04:32:20 | 4 | 7 | 8 | 12 | 0 |
| 04:32:25 | 3 | 6 | 4 | 7 | 0 |
| 04:32:30 | 3 | 6 | 3 | 6 | 0 |
| 04:32:35 | 4 | 7 | 4 | 7 | 1 |
| 04:32:40 | 15 | 19 | 15 | 19 | 0 |
| 04:32:45 | 6 | 7 | 15 | 17 | 0 |
| 04:32:50 | 6 | 8 | 6 | 8 | 0 |
| 04:32:55 | 4 | 8 | 6 | 10 | 0 |
| 04:33:00 | 6 | 9 | 7 | 11 | 1 |
| 04:33:05 | 12 | 17 | 12 | 17 | 0 |
| 04:33:10 | 5 | 7 | 12 | 16 | 0 |
| 04:33:15 | 4 | 8 | 5 | 10 | 0 |
| 04:33:20 | 4 | 8 | 4 | 8 | 0 |
| 04:33:25 | 6 | 9 | 7 | 11 | 4 |
| 04:33:30 | 9 | 11 | 11 | 15 | 0 |
| 04:33:35 | 21 | 25 | 25 | 29 | 0 |

### Other lines

| kind | count |
|---|---|
| untagged: No logs found for opensetlist-projects/opensetlist | 4 |
