## Vercel runtime logs — 2026-10-12T04-00-54Z-vercel-logs-history-step4-RB.txt

13523 entries; requests: /api/setlist 12877, other API 214, pages 432; error-level entries 0. Times: log clock +7 h.

### Builds per rev (`[liveSnapshot] build` lines: 1917)

| rev | builds | distinct instances | locales | build ms avg / max | first – last |
|---|---|---|---|---|---|
| 1448 | 1 | 1 | ko 1 | 79 / 79 | 04:01:28 – 04:01:28 |
| 1449 | 360 | 35 | en 42, ja 217, ko 101 | 131 / 727 | 04:01:29 – 04:01:52 |
| 1450 | 10 | 5 | ko 4, ja 5, en 1 | 57 / 84 | 04:01:52 – 04:01:53 |
| 1451 | 204 | 19 | ja 131, en 24, ko 49 | 68 / 595 | 04:01:53 – 04:02:18 |
| 1452 | 183 | 15 | ja 123, ko 36, en 24 | 63 / 514 | 04:02:18 – 04:02:42 |
| 1453 | 8 | 3 | ko 4, ja 3, en 1 | 53 / 79 | 04:02:42 – 04:02:43 |
| 1454 | 186 | 15 | ja 120, ko 43, en 23 | 55 / 500 | 04:02:43 – 04:03:08 |
| 1455 | 180 | 8 | ja 122, ko 35, en 23 | 52 / 562 | 04:03:08 – 04:03:32 |
| 1456 | 15 | 8 | ja 9, en 3, ko 3 | 122 / 552 | 04:03:32 – 04:03:34 |
| 1457 | 274 | 30 | ja 187, ko 53, en 34 | 68 / 691 | 04:03:33 – 04:03:58 |
| 1458 | 187 | 17 | ja 115, en 25, ko 47 | 53 / 127 | 04:03:58 – 04:04:23 |
| 1459 | 5 | 2 | ja 3, ko 1, en 1 | 65 / 79 | 04:04:22 – 04:04:23 |
| 1460 | 197 | 13 | ko 41, ja 129, en 27 | 51 / 135 | 04:04:23 – 04:04:48 |
| 1461 | 22 | 5 | ja 16, en 3, ko 3 | 76 / 470 | 04:04:48 – 04:04:51 |
| 1462 | 11 | 4 | ja 6, ko 3, en 2 | 53 / 95 | 04:04:51 – 04:04:51 |
| 1463 | 10 | 8 | ja 7, ko 2, en 1 | 113 / 466 | 04:04:51 – 04:04:52 |
| 1464 | 6 | 3 | ko 3, ja 2, en 1 | 57 / 85 | 04:04:52 – 04:04:52 |
| 1465 | 12 | 9 | ja 7, en 3, ko 2 | 53 / 82 | 04:04:52 – 04:04:52 |
| 1466 | 46 | 19 | en 6, ko 12, ja 28 | 61 / 469 | 04:04:52 – 04:04:54 |

### Failures, repair reads, coalescing

| what | count | detail |
|---|---|---|
| EMAXCONN (pooler client cap) | 0 | API 0, SSR 0 |
| `[liveSnapshot] build-failed` | 0 | — |
| `[liveSnapshot] rev-read` (repair revision read) | 0 | rev=timeout 0, rev=error 0; ms p50 — / max —; by hint: — |
| `[liveSnapshot] coalesced` | 67 | waiters sum 151, max 7 |
| `[setlist] slow-hit` | 0 | max — ms |

### Hint outcomes (`[setlist] hint-fetch` lines: 7144)

Whole capture: satisfied 7144, fresh 0, memo 0, deferred 0, none 0, error 0, other 0. "other" = a `verify=` value this script does not know.

| minute | hint fetches | satisfied | fresh | memo | deferred | none | error | other |
|---|---|---|---|---|---|---|---|---|
| 04:01 | 931 | 931 | 0 | 0 | 0 | 0 | 0 | 0 |
| 04:02 | 1395 | 1395 | 0 | 0 | 0 | 0 | 0 | 0 |
| 04:03 | 1940 | 1940 | 0 | 0 | 0 | 0 | 0 | 0 |
| 04:04 | 2878 | 2878 | 0 | 0 | 0 | 0 | 0 | 0 |

### Warming (`[liveWarm]` jobs: 18; `[setlist] warm-lookup` lines: 7144)

**warm hit rate = hits ÷ hinted fetches = 7144 / 7144 = 100.0 %** (hinted fetches = `[setlist] hint-fetch` lines with a numeric minRev; lookups 7144).

schedule-failed 0; job-failed 0; set ok=false 0 (set-error lines 0); skips 0; lookup-error lines 0; warm builds matched 54.

Warm jobs. start → done = the job's own `done ms=` (it starts in `after()`, i.e. right after the save's response, so it is ≈ warm-complete − commit). Per locale: actual rev, bytes, build / set ms, ok.

| save rev | instance | start (log clock) | start → done ms | sets | skips | warm builds (unmatched) | job-failed |
|---|---|---|---|---|---|---|---|
| 1449 | c4592e23 | 04:01:29 | 131 | ko r1449 80830 B 55/9 ms; ja r1449 67230 B 80/7 ms; en r1449 79463 B 59/7 ms | — | 3 | — |
| 1450 | 6f274429 | 04:01:52 | 132 | ja r1450 85188 B 63/9 ms; ko r1450 102444 B 85/7 ms; en r1450 100630 B 51/7 ms | — | 3 | — |
| 1451 | abe126f3 | 04:01:53 | 164 | ko r1451 81634 B 63/16 ms; ja r1451 67895 B 74/14 ms; en r1451 80251 B 68/17 ms | — | 3 | — |
| 1452 | 4ea9b95b | 04:02:18 | 102 | ko r1452 60777 B 46/12 ms; ja r1452 50622 B 51/7 ms; en r1452 59831 B 37/5 ms | — | 3 | — |
| 1453 | df9c2597 | 04:02:42 | 131 | ko r1453 82391 B 51/10 ms; ja r1453 68580 B 58/9 ms; en r1453 80998 B 62/7 ms | — | 3 | — |
| 1454 | df9c2597 | 04:02:43 | 192 | ko r1454 61512 B 104/37 ms; ja r1454 51285 B 137/4 ms; en r1454 60558 B 45/6 ms | — | 3 | — |
| 1455 | 34446bdc | 04:03:08 | 105 | ja r1455 51309 B 45/16 ms; ko r1455 61619 B 58/7 ms; en r1455 60666 B 35/8 ms | — | 3 | — |
| 1456 | 9088cbf7 | 04:03:32 | 104 | ko r1456 83233 B 47/8 ms; ja r1456 69267 B 67/7 ms; en r1456 81833 B 40/7 ms | — | 3 | — |
| 1457 | 39919ff9 | 04:03:33 | 232 | ko r1457 62469 B 114/26 ms; ja r1457 52015 B 175/16 ms; en r1457 61501 B 62/20 ms | — | 3 | — |
| 1458 | 20a47ba8 | 04:03:58 | 96 | ko r1458 62447 B 44/6 ms; ja r1458 52012 B 53/6 ms; en r1458 61480 B 38/6 ms | — | 3 | — |
| 1459 | 4ea9b95b | 04:04:22 | 125 | ko r1459 84061 B 40/7 ms; ja r1459 69970 B 66/6 ms; en r1459 82647 B 71/6 ms | — | 3 | — |
| 1460 | f78c58aa | 04:04:23 | 122 | ko r1460 63210 B 58/8 ms; ja r1460 52709 B 82/5 ms; en r1460 62236 B 49/6 ms | — | 3 | — |
| 1461 | 52a211a2 | 04:04:48 | 147 | ko r1461 63112 B 53/10 ms; ja r1461 52675 B 107/4 ms; en r1461 62136 B 72/6 ms | — | 3 | — |
| 1462 | afb91b5f | 04:04:51 | 108 | ko r1462 62350 B 46/8 ms; ja r1462 51979 B 50/8 ms; en r1462 61381 B 46/7 ms | — | 3 | — |
| 1463 | 4ea9b95b | 04:04:51 | 180 | ko r1463 61501 B 62/14 ms; ja r1463 51274 B 94/7 ms; en r1463 60547 B 79/25 ms | — | 3 | — |
| 1464 | 88949671 | 04:04:52 | 134 | ko r1464 60767 B 48/13 ms; ja r1464 50612 B 59/7 ms; en r1464 59821 B 66/6 ms | — | 3 | — |
| 1465 | 88949671 | 04:04:52 | 85 | ja r1465 49948 B 37/7 ms; ko r1465 59964 B 42/5 ms; en r1465 59034 B 34/6 ms | — | 3 | — |
| 1466 | f78c58aa | 04:04:52 | 139 | ko r1466 59221 B 51/8 ms; ja r1466 49277 B 97/10 ms; en r1466 58301 B 45/35 ms | — | 3 | — |

Per save rev. builds = every `[liveSnapshot] build` at that rev; warm = the ones matched to a warm job (same instance, locale, rev); reader = the rest. Lookups and hinted fetches are keyed by their `minRev`.

| save rev | warm jobs | start → done ms | builds | warm | reader | hinted fetches | lookups | hit | miss | stale | invalid | error | timeout | memo-miss | capped | other | lookup ms p50 / p95 | hit rate |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1449 | 1 | 131 | 360 | 3 | 357 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — / — | — |
| 1450 | 1 | 132 | 10 | 3 | 7 | 485 | 485 | 485 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 11 / 42 | 100.0 % |
| 1451 | 1 | 164 | 204 | 3 | 201 | 446 | 446 | 446 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 10 / 50 | 100.0 % |
| 1452 | 1 | 102 | 183 | 3 | 180 | 485 | 485 | 485 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 8 / 38 | 100.0 % |
| 1453 | 1 | 131 | 8 | 3 | 5 | 426 | 426 | 426 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 9 / 24 | 100.0 % |
| 1454 | 1 | 192 | 186 | 3 | 183 | 484 | 484 | 484 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 8 / 17 | 100.0 % |
| 1455 | 1 | 105 | 180 | 3 | 177 | 495 | 495 | 495 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 8 / 21 | 100.0 % |
| 1456 | 1 | 104 | 15 | 3 | 12 | 491 | 491 | 491 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 10 / 38 | 100.0 % |
| 1457 | 1 | 232 | 274 | 3 | 271 | 468 | 468 | 468 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 8 / 21 | 100.0 % |
| 1458 | 1 | 96 | 187 | 3 | 184 | 486 | 486 | 486 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 8 / 27 | 100.0 % |
| 1459 | 1 | 125 | 5 | 3 | 2 | 494 | 494 | 494 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 9 / 21 | 100.0 % |
| 1460 | 1 | 122 | 197 | 3 | 194 | 479 | 479 | 479 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 8 / 14 | 100.0 % |
| 1461 | 1 | 147 | 22 | 3 | 19 | 491 | 491 | 491 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 8 / 18 | 100.0 % |
| 1462 | 1 | 108 | 11 | 3 | 8 | 375 | 375 | 375 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 8 / 15 | 100.0 % |
| 1463 | 1 | 180 | 10 | 3 | 7 | 117 | 117 | 117 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 7 / 12 | 100.0 % |
| 1464 | 1 | 134 | 6 | 3 | 3 | 103 | 103 | 103 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 8 / 10 | 100.0 % |
| 1465 | 1 | 85 | 12 | 3 | 9 | 351 | 351 | 351 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 7 / 17 | 100.0 % |
| 1466 | 1 | 139 | 46 | 3 | 43 | 468 | 468 | 468 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 7 / 9 | 100.0 % |

Lookup ms by result (p50 / p95, n): hit 8 / 23 (7144). Whole capture: hit 7144, miss 0, stale 0, invalid 0, error 0, timeout 0, memo-miss 0, capped 0, other 0.

| minute | lookups | hit | miss | stale | invalid | error | timeout | memo-miss | capped | other |
|---|---|---|---|---|---|---|---|---|---|---|
| 04:01 | 931 | 931 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| 04:02 | 1395 | 1395 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| 04:03 | 1940 | 1940 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| 04:04 | 2878 | 2878 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |

### Admin writes (`[liveWriter]`)

| route | saves | acquire ms p50 / p95 | exec ms p50 / p95 | ok=false | failed kinds |
|---|---|---|---|---|---|
| admin-insert-after | 5 | 3 / 5 | 165 / 209 | 0 | — |
| admin-update | 8 | 3 / 11 | 83 / 198 | 0 | — |
| admin-delete | 5 | 4 / 9 | 27 / 29 | 0 | — |

Every save (routes with ≤ 12 saves; `at` = the server's commit time, epoch ms → UTC):

| route | rev | acquire ms | exec ms | ok | at (UTC) | instance |
|---|---|---|---|---|---|---|
| admin-insert-after | 1449 | 5 | 165 | true | 2026-10-12T04:01:29.843Z | c4592e23 |
| admin-insert-after | 1450 | 5 | 209 | true | 2026-10-12T04:01:53.202Z | 6f274429 |
| admin-insert-after | 1453 | 3 | 149 | true | 2026-10-12T04:02:43.168Z | df9c2597 |
| admin-insert-after | 1456 | 3 | 165 | true | 2026-10-12T04:03:33.134Z | 9088cbf7 |
| admin-insert-after | 1459 | 2 | 146 | true | 2026-10-12T04:04:23.124Z | 4ea9b95b |
| admin-update | 1451 | 6 | 97 | true | 2026-10-12T04:01:53.837Z | abe126f3 |
| admin-update | 1452 | 2 | 62 | true | 2026-10-12T04:02:18.947Z | 4ea9b95b |
| admin-update | 1454 | 3 | 67 | true | 2026-10-12T04:02:43.576Z | df9c2597 |
| admin-update | 1455 | 3 | 92 | true | 2026-10-12T04:03:08.965Z | 34446bdc |
| admin-update | 1457 | 11 | 198 | true | 2026-10-12T04:03:34.228Z | 39919ff9 |
| admin-update | 1458 | 2 | 114 | true | 2026-10-12T04:03:59.038Z | 20a47ba8 |
| admin-update | 1460 | 3 | 83 | true | 2026-10-12T04:04:23.704Z | f78c58aa |
| admin-update | 1461 | 3 | 71 | true | 2026-10-12T04:04:48.987Z | 52a211a2 |
| admin-delete | 1462 | 4 | 29 | true | 2026-10-12T04:04:51.537Z | afb91b5f |
| admin-delete | 1463 | 9 | 29 | true | 2026-10-12T04:04:51.917Z | 4ea9b95b |
| admin-delete | 1464 | 8 | 27 | true | 2026-10-12T04:04:52.309Z | 88949671 |
| admin-delete | 1465 | 3 | 14 | true | 2026-10-12T04:04:52.640Z | 88949671 |
| admin-delete | 1466 | 3 | 23 | true | 2026-10-12T04:04:53.015Z | f78c58aa |

### Per minute

| minute | requests | distinct instances | builds | EMAXCONN |
|---|---|---|---|---|
| 04:01 | 2719 | 50 | 453 | 0 |
| 04:02 | 3048 | 44 | 439 | 0 |
| 04:03 | 3506 | 61 | 558 | 0 |
| 04:04 | 4250 | 47 | 467 | 0 |

### Prisma pool totals per 5 s (app-side estimate of pooler clients)

Peak carried sum: **57** (carry 5 s). "reported" = instances that logged in the bucket (max total each); "carried" also counts an instance's last total for 5 s after its last line.

| bucket | reporting instances | Σ total (reported) | instances (carried) | Σ total (carried) | max waiting |
|---|---|---|---|---|---|
| 04:01:25 | 1 | 2 | 1 | 2 | 0 |
| 04:01:30 | 30 | 46 | 30 | 46 | 0 |
| 04:01:35 | 32 | 51 | 35 | 57 | 0 |
| 04:01:40 | 13 | 16 | 32 | 42 | 0 |
| 04:01:45 | 3 | 6 | 13 | 19 | 0 |
| 04:01:50 | 20 | 28 | 20 | 28 | 0 |
| 04:01:55 | 17 | 24 | 20 | 28 | 0 |
| 04:02:00 | 9 | 10 | 17 | 21 | 0 |
| 04:02:05 | 6 | 7 | 9 | 10 | 0 |
| 04:02:10 | 5 | 9 | 6 | 10 | 0 |
| 04:02:15 | 16 | 20 | 16 | 20 | 0 |
| 04:02:20 | 6 | 9 | 16 | 19 | 0 |
| 04:02:25 | 4 | 6 | 6 | 10 | 0 |
| 04:02:30 | 4 | 8 | 4 | 8 | 0 |
| 04:02:35 | 3 | 6 | 5 | 10 | 0 |
| 04:02:40 | 15 | 20 | 15 | 20 | 0 |
| 04:02:45 | 8 | 8 | 15 | 18 | 0 |
| 04:02:50 | 6 | 6 | 8 | 8 | 0 |
| 04:02:55 | 5 | 10 | 6 | 11 | 0 |
| 04:03:00 | 4 | 8 | 5 | 10 | 0 |
| 04:03:05 | 6 | 9 | 7 | 11 | 0 |
| 04:03:10 | 8 | 11 | 8 | 11 | 0 |
| 04:03:15 | 6 | 8 | 8 | 10 | 0 |
| 04:03:20 | 5 | 7 | 6 | 8 | 0 |
| 04:03:25 | 4 | 6 | 5 | 7 | 0 |
| 04:03:30 | 31 | 39 | 31 | 39 | 0 |
| 04:03:35 | 21 | 26 | 31 | 39 | 0 |
| 04:03:40 | 9 | 10 | 21 | 24 | 0 |
| 04:03:45 | 6 | 7 | 9 | 10 | 0 |
| 04:03:50 | 4 | 8 | 6 | 10 | 0 |
| 04:03:55 | 15 | 18 | 16 | 20 | 0 |
| 04:04:00 | 13 | 16 | 17 | 20 | 0 |
| 04:04:05 | 7 | 7 | 13 | 13 | 0 |
| 04:04:10 | 5 | 9 | 7 | 11 | 0 |
| 04:04:15 | 3 | 6 | 5 | 9 | 0 |
| 04:04:20 | 15 | 21 | 15 | 21 | 1 |
| 04:04:25 | 11 | 15 | 15 | 21 | 0 |
| 04:04:30 | 4 | 8 | 11 | 17 | 0 |
| 04:04:35 | 3 | 6 | 4 | 8 | 0 |
| 04:04:40 | 3 | 6 | 3 | 6 | 0 |
| 04:04:45 | 6 | 10 | 6 | 10 | 0 |
| 04:04:50 | 25 | 36 | 25 | 36 | 0 |

### Other lines

| kind | count |
|---|---|
| untagged: No logs found for opensetlist-projects/opensetlist | 4 |
