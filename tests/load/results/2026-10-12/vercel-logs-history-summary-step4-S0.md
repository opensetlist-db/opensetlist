## Vercel runtime logs — 2026-10-12T04-07-30Z-vercel-logs-history-step4-S0.txt

11947 entries; requests: /api/setlist 11342, other API 173, pages 432; error-level entries 0. Times: log clock +7 h.

### Builds per rev (`[liveSnapshot] build` lines: 1748)

| rev | builds | distinct instances | locales | build ms avg / max | first – last |
|---|---|---|---|---|---|
| 1467 | 1 | 1 | ko 1 | 49 / 49 | 04:08:04 – 04:08:04 |
| 1468 | 3 | 1 | ko 1, ja 1, en 1 | 64 / 79 | 04:08:05 – 04:08:05 |
| 1469 | 573 | 35 | ko 144, ja 346, en 83 | 218 / 825 | 04:08:06 – 04:08:29 |
| 1470 | 83 | 24 | ja 52, ko 19, en 12 | 73 / 540 | 04:08:29 – 04:08:31 |
| 1471 | 180 | 18 | ja 117, en 24, ko 39 | 49 / 127 | 04:08:32 – 04:08:54 |
| 1472 | 32 | 12 | en 3, ko 9, ja 20 | 113 / 591 | 04:08:54 – 04:08:57 |
| 1473 | 177 | 10 | ja 119, ko 37, en 21 | 47 / 101 | 04:08:57 – 04:09:19 |
| 1474 | 17 | 6 | ja 8, ko 6, en 3 | 73 / 498 | 04:09:19 – 04:09:22 |
| 1475 | 144 | 10 | en 25, ja 89, ko 30 | 46 / 109 | 04:09:22 – 04:09:44 |
| 1476 | 58 | 17 | ja 37, en 7, ko 14 | 62 / 526 | 04:09:44 – 04:09:47 |
| 1477 | 147 | 14 | ja 95, ko 32, en 20 | 52 / 117 | 04:09:47 – 04:10:09 |
| 1478 | 44 | 14 | ko 11, ja 29, en 4 | 84 / 542 | 04:10:09 – 04:10:12 |
| 1479 | 171 | 16 | ko 33, ja 113, en 25 | 47 / 98 | 04:10:12 – 04:10:34 |
| 1480 | 24 | 9 | ja 10, ko 11, en 3 | 93 / 624 | 04:10:34 – 04:10:37 |
| 1481 | 51 | 13 | en 5, ko 13, ja 33 | 57 / 502 | 04:10:37 – 04:10:42 |
| 1482 | 7 | 4 | ja 3, ko 3, en 1 | 39 / 57 | 04:10:42 – 04:10:43 |
| 1483 | 36 | 16 | ja 26, en 3, ko 7 | 86 / 706 | 04:10:43 – 04:10:45 |

### Failures, repair reads, coalescing

| what | count | detail |
|---|---|---|
| EMAXCONN (pooler client cap) | 0 | API 0, SSR 0 |
| `[liveSnapshot] build-failed` | 0 | — |
| `[liveSnapshot] rev-read` (repair revision read) | 0 | rev=timeout 0, rev=error 0; ms p50 — / max —; by hint: — |
| `[liveSnapshot] coalesced` | 124 | waiters sum 301, max 6 |
| `[setlist] slow-hit` | 0 | max — ms |

### Hint outcomes (`[setlist] hint-fetch` lines: 6747)

Whole capture: satisfied 6747, fresh 0, memo 0, deferred 0, none 0, error 0, other 0. "other" = a `verify=` value this script does not know.

| minute | hint fetches | satisfied | fresh | memo | deferred | none | error | other |
|---|---|---|---|---|---|---|---|---|
| 04:08 | 1962 | 1962 | 0 | 0 | 0 | 0 | 0 | 0 |
| 04:09 | 2005 | 2005 | 0 | 0 | 0 | 0 | 0 | 0 |
| 04:10 | 2780 | 2780 | 0 | 0 | 0 | 0 | 0 | 0 |

### Warming (`[liveWarm]` jobs: 16; `[setlist] warm-lookup` lines: 6747)

**warm hit rate = hits ÷ hinted fetches = 6747 / 6747 = 100.0 %** (hinted fetches = `[setlist] hint-fetch` lines with a numeric minRev; lookups 6747).

schedule-failed 0; job-failed 0; set ok=false 0 (set-error lines 0); skips 0; lookup-error lines 0; warm builds matched 48.

Warm jobs. start → done = the job's own `done ms=` (it starts in `after()`, i.e. right after the save's response, so it is ≈ warm-complete − commit). Per locale: actual rev, bytes, build / set ms, ok.

| save rev | instance | start (log clock) | start → done ms | sets | skips | warm builds (unmatched) | job-failed |
|---|---|---|---|---|---|---|---|
| 1468 | a97e72b8 | 04:08:05 | 143 | ko r1468 80830 B 56/15 ms; ja r1468 67230 B 91/22 ms; en r1468 79463 B 62/9 ms | — | 3 | — |
| 1469 | a97e72b8 | 04:08:06 | 109 | ja r1469 85188 B 39/15 ms; ko r1469 102444 B 49/20 ms; en r1469 100630 B 45/10 ms | — | 3 | — |
| 1470 | f075f5fa | 04:08:29 | 132 | ja r1470 67915 B 53/8 ms; ko r1470 81587 B 69/8 ms; en r1470 80210 B 61/9 ms | — | 3 | — |
| 1471 | 6194e334 | 04:08:32 | 123 | ko r1471 60837 B 57/10 ms; ja r1471 50666 B 62/7 ms; en r1471 59898 B 48/7 ms | — | 3 | — |
| 1472 | 34446bdc | 04:08:54 | 100 | ko r1472 60922 B 35/7 ms; ja r1472 50687 B 48/5 ms; en r1472 59985 B 51/6 ms | — | 3 | — |
| 1473 | 6be337b1 | 04:08:57 | 127 | ko r1473 60815 B 62/9 ms; ja r1473 50663 B 75/7 ms; en r1473 59877 B 46/8 ms | — | 3 | — |
| 1474 | 34446bdc | 04:09:19 | 82 | ko r1474 60784 B 34/5 ms; ja r1474 50631 B 46/7 ms; en r1474 59842 B 37/6 ms | — | 3 | — |
| 1475 | f62e882e | 04:09:22 | 116 | ko r1475 60782 B 59/6 ms; ja r1475 50632 B 84/5 ms; en r1475 59841 B 45/5 ms | — | 3 | — |
| 1476 | 1fb7c808 | 04:09:44 | 108 | ko r1476 60725 B 44/7 ms; ja r1476 50643 B 91/6 ms; en r1476 59787 B 49/6 ms | — | 3 | — |
| 1477 | c5d81a84 | 04:09:47 | 136 | ko r1477 60795 B 70/7 ms; ja r1477 50643 B 84/5 ms; en r1477 59851 B 52/6 ms | — | 3 | — |
| 1478 | c5d81a84 | 04:10:09 | 149 | ko r1478 60771 B 45/7 ms; ja r1478 50625 B 85/16 ms; en r1478 59831 B 91/6 ms | — | 3 | — |
| 1479 | 1fb7c808 | 04:10:12 | 88 | ko r1479 60657 B 36/8 ms; ja r1479 50595 B 52/6 ms; en r1479 59732 B 36/7 ms | — | 3 | — |
| 1480 | 2e46a49f | 04:10:34 | 202 | ko r1480 60616 B 67/7 ms; ja r1480 50566 B 82/5 ms; en r1480 59696 B 112/15 ms | — | 3 | — |
| 1481 | 2e46a49f | 04:10:37 | 111 | ja r1481 50631 B 48/11 ms; ko r1481 60762 B 56/8 ms; en r1481 59844 B 46/6 ms | — | 3 | — |
| 1482 | 0797c6ca | 04:10:42 | 84 | ja r1482 49911 B 35/9 ms; ko r1482 59906 B 40/13 ms; en r1482 58986 B 33/7 ms | — | 3 | — |
| 1483 | 0797c6ca | 04:10:43 | 171 | ja r1483 49274 B 39/8 ms; ko r1483 59218 B 44/16 ms; en r1483 58298 B 116/7 ms | — | 3 | — |

Per save rev. builds = every `[liveSnapshot] build` at that rev; warm = the ones matched to a warm job (same instance, locale, rev); reader = the rest. Lookups and hinted fetches are keyed by their `minRev`.

| save rev | warm jobs | start → done ms | builds | warm | reader | hinted fetches | lookups | hit | miss | stale | invalid | error | timeout | memo-miss | capped | other | lookup ms p50 / p95 | hit rate |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1468 | 1 | 143 | 3 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — / — | — |
| 1469 | 1 | 109 | 573 | 3 | 570 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — / — | — |
| 1470 | 1 | 132 | 83 | 3 | 80 | 482 | 482 | 482 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 9 / 22 | 100.0 % |
| 1471 | 1 | 123 | 180 | 3 | 177 | 496 | 496 | 496 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 7 / 17 | 100.0 % |
| 1472 | 1 | 100 | 32 | 3 | 29 | 493 | 493 | 493 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 8 / 26 | 100.0 % |
| 1473 | 1 | 127 | 177 | 3 | 174 | 503 | 503 | 503 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 8 / 11 | 100.0 % |
| 1474 | 1 | 82 | 17 | 3 | 14 | 504 | 504 | 504 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 8 / 17 | 100.0 % |
| 1475 | 1 | 116 | 144 | 3 | 141 | 502 | 502 | 502 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 8 / 11 | 100.0 % |
| 1476 | 1 | 108 | 58 | 3 | 55 | 493 | 493 | 493 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 8 / 18 | 100.0 % |
| 1477 | 1 | 136 | 147 | 3 | 144 | 494 | 494 | 494 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 7 / 12 | 100.0 % |
| 1478 | 1 | 149 | 44 | 3 | 41 | 492 | 492 | 492 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 8 / 22 | 100.0 % |
| 1479 | 1 | 88 | 171 | 3 | 168 | 494 | 494 | 494 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 7 / 15 | 100.0 % |
| 1480 | 1 | 202 | 24 | 3 | 21 | 499 | 499 | 499 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 8 / 20 | 100.0 % |
| 1481 | 1 | 111 | 51 | 3 | 48 | 495 | 495 | 495 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 7 / 11 | 100.0 % |
| 1482 | 1 | 84 | 7 | 3 | 4 | 316 | 316 | 316 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 7 / 15 | 100.0 % |
| 1483 | 1 | 171 | 36 | 3 | 33 | 484 | 484 | 484 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 7 / 16 | 100.0 % |

Lookup ms by result (p50 / p95, n): hit 8 / 18 (6747). Whole capture: hit 6747, miss 0, stale 0, invalid 0, error 0, timeout 0, memo-miss 0, capped 0, other 0.

| minute | lookups | hit | miss | stale | invalid | error | timeout | memo-miss | capped | other |
|---|---|---|---|---|---|---|---|---|---|---|
| 04:08 | 1962 | 1962 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| 04:09 | 2005 | 2005 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| 04:10 | 2780 | 2780 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |

### Admin writes (`[liveWriter]`)

| route | saves | acquire ms p50 / p95 | exec ms p50 / p95 | ok=false | failed kinds |
|---|---|---|---|---|---|
| admin-insert-after | 2 | 2 / 3 | 99 / 156 | 0 | — |
| admin-update | 12 | 3 / 4 | 81 / 222 | 0 | — |
| admin-delete | 2 | 2 / 2 | 14 / 18 | 0 | — |

Every save (routes with ≤ 12 saves; `at` = the server's commit time, epoch ms → UTC):

| route | rev | acquire ms | exec ms | ok | at (UTC) | instance |
|---|---|---|---|---|---|---|
| admin-insert-after | 1468 | 2 | 156 | true | 2026-10-12T04:08:05.893Z | a97e72b8 |
| admin-insert-after | 1469 | 3 | 99 | true | 2026-10-12T04:08:06.447Z | a97e72b8 |
| admin-update | 1470 | 3 | 86 | true | 2026-10-12T04:08:29.946Z | f075f5fa |
| admin-update | 1471 | 4 | 90 | true | 2026-10-12T04:08:32.922Z | 6194e334 |
| admin-update | 1472 | 3 | 33 | true | 2026-10-12T04:08:54.920Z | 34446bdc |
| admin-update | 1473 | 4 | 81 | true | 2026-10-12T04:08:57.934Z | 6be337b1 |
| admin-update | 1474 | 2 | 50 | true | 2026-10-12T04:09:19.857Z | 34446bdc |
| admin-update | 1475 | 4 | 85 | true | 2026-10-12T04:09:22.879Z | f62e882e |
| admin-update | 1476 | 2 | 222 | true | 2026-10-12T04:09:45.098Z | 1fb7c808 |
| admin-update | 1477 | 4 | 87 | true | 2026-10-12T04:09:47.951Z | c5d81a84 |
| admin-update | 1478 | 3 | 40 | true | 2026-10-12T04:10:09.897Z | c5d81a84 |
| admin-update | 1479 | 3 | 32 | true | 2026-10-12T04:10:12.853Z | 1fb7c808 |
| admin-update | 1480 | 4 | 88 | true | 2026-10-12T04:10:34.934Z | 2e46a49f |
| admin-update | 1481 | 4 | 57 | true | 2026-10-12T04:10:37.860Z | 2e46a49f |
| admin-delete | 1482 | 2 | 18 | true | 2026-10-12T04:10:42.969Z | 0797c6ca |
| admin-delete | 1483 | 2 | 14 | true | 2026-10-12T04:10:43.282Z | 0797c6ca |

### Per minute

| minute | requests | distinct instances | builds | EMAXCONN |
|---|---|---|---|---|
| 04:08 | 4440 | 47 | 882 | 0 |
| 04:09 | 3557 | 42 | 466 | 0 |
| 04:10 | 3950 | 50 | 400 | 0 |

### Prisma pool totals per 5 s (app-side estimate of pooler clients)

Peak carried sum: **68** (carry 5 s). "reported" = instances that logged in the bucket (max total each); "carried" also counts an instance's last total for 5 s after its last line.

| bucket | reporting instances | Σ total (reported) | instances (carried) | Σ total (carried) | max waiting |
|---|---|---|---|---|---|
| 04:08:00 | 1 | 1 | 1 | 1 | 0 |
| 04:08:05 | 29 | 54 | 29 | 54 | 8 |
| 04:08:10 | 35 | 68 | 35 | 68 | 3 |
| 04:08:15 | 20 | 38 | 35 | 67 | 0 |
| 04:08:20 | 2 | 3 | 20 | 36 | 0 |
| 04:08:25 | 6 | 10 | 6 | 10 | 1 |
| 04:08:30 | 25 | 37 | 25 | 37 | 0 |
| 04:08:35 | 10 | 13 | 25 | 34 | 0 |
| 04:08:40 | 4 | 4 | 10 | 13 | 0 |
| 04:08:45 | 4 | 8 | 4 | 8 | 0 |
| 04:08:50 | 4 | 8 | 4 | 8 | 0 |
| 04:08:55 | 13 | 17 | 15 | 20 | 0 |
| 04:09:00 | 8 | 10 | 13 | 16 | 0 |
| 04:09:05 | 4 | 7 | 8 | 12 | 0 |
| 04:09:10 | 4 | 8 | 4 | 8 | 0 |
| 04:09:15 | 3 | 6 | 4 | 8 | 0 |
| 04:09:20 | 11 | 14 | 12 | 16 | 0 |
| 04:09:25 | 8 | 9 | 11 | 12 | 0 |
| 04:09:30 | 5 | 6 | 8 | 9 | 0 |
| 04:09:35 | 4 | 6 | 5 | 8 | 0 |
| 04:09:40 | 4 | 7 | 4 | 7 | 0 |
| 04:09:45 | 18 | 27 | 18 | 27 | 0 |
| 04:09:50 | 9 | 15 | 18 | 28 | 0 |
| 04:09:55 | 7 | 8 | 9 | 11 | 0 |
| 04:10:00 | 5 | 8 | 7 | 10 | 0 |
| 04:10:05 | 4 | 6 | 5 | 7 | 0 |
| 04:10:10 | 17 | 21 | 17 | 21 | 0 |
| 04:10:15 | 10 | 12 | 17 | 21 | 0 |
| 04:10:20 | 6 | 7 | 10 | 13 | 0 |
| 04:10:25 | 6 | 10 | 6 | 10 | 0 |
| 04:10:30 | 4 | 8 | 6 | 11 | 0 |
| 04:10:35 | 15 | 19 | 16 | 21 | 0 |
| 04:10:40 | 17 | 23 | 21 | 27 | 0 |
| 04:10:45 | 2 | 3 | 17 | 23 | 0 |

### Other lines

| kind | count |
|---|---|
| untagged: No logs found for opensetlist-projects/opensetlist | 4 |
