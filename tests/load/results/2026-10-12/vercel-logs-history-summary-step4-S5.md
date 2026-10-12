## Vercel runtime logs — 2026-10-12T03-32-00Z-vercel-logs-history-step4-S5.txt

14118 entries; requests: /api/setlist 12807, other API 837, pages 474; error-level entries 1. Times: log clock +7 h.

### Builds per rev (`[liveSnapshot] build` lines: 4802)

| rev | builds | distinct instances | locales | build ms avg / max | first – last |
|---|---|---|---|---|---|
| 1367 | 1 | 1 | ko 1 | 52 / 52 | 03:32:34 – 03:32:34 |
| 1368 | 3 | 1 | ko 1, ja 1, en 1 | 55 / 72 | 03:32:35 – 03:32:35 |
| 1369 | 512 | 36 | ko 138, en 86, ja 288 | 197 / 680 | 03:32:36 – 03:32:59 |
| 1370 | 3 | 1 | ja 2, ko 1 | 62 / 85 | 03:32:59 – 03:32:59 |
| 1371 | 514 | 33 | ko 126, ja 318, en 70 | 115 / 663 | 03:32:59 – 03:33:24 |
| 1372 | 8 | 3 | ja 6, ko 2 | 48 / 67 | 03:33:24 – 03:33:25 |
| 1373 | 467 | 55 | en 75, ja 289, ko 103 | 128 / 719 | 03:33:24 – 03:33:49 |
| 1374 | 7 | 3 | ja 4, en 1, ko 2 | 44 / 60 | 03:33:49 – 03:33:49 |
| 1375 | 415 | 44 | ja 242, ko 104, en 69 | 121 / 477 | 03:33:49 – 03:34:14 |
| 1376 | 18 | 7 | ja 12, ko 5, en 1 | 65 / 152 | 03:34:14 – 03:34:15 |
| 1377 | 491 | 40 | en 77, ja 283, ko 131 | 112 / 506 | 03:34:14 – 03:34:39 |
| 1378 | 4 | 2 | ja 3, ko 1 | 47 / 58 | 03:34:39 – 03:34:39 |
| 1379 | 579 | 37 | ja 381, en 80, ko 118 | 96 / 462 | 03:34:39 – 03:35:04 |
| 1380 | 5 | 2 | ko 2, ja 3 | 54 / 75 | 03:35:04 – 03:35:04 |
| 1381 | 1581 | 37 | ja 996, ko 372, en 213 | 64 / 472 | 03:35:04 – 03:37:58 |
| 1382 | 6 | 2 | ja 4, ko 1, en 1 | 44 / 60 | 03:37:59 – 03:37:59 |
| 1383 | 188 | 41 | ko 54, ja 92, en 42 | 242 / 666 | 03:37:59 – 03:38:04 |

### Failures, repair reads, coalescing

| what | count | detail |
|---|---|---|
| EMAXCONN (pooler client cap) | 0 | API 0, SSR 0 |
| `[liveSnapshot] build-failed` | 0 | — |
| `[liveSnapshot] rev-read` (repair revision read) | 0 | rev=timeout 0, rev=error 0; ms p50 — / max —; by hint: — |
| `[liveSnapshot] coalesced` | 884 | waiters sum 3297, max 15 |
| `[setlist] slow-hit` | 0 | max — ms |

### Hint outcomes (`[setlist] hint-fetch` lines: 4023)

Whole capture: satisfied 4023, fresh 0, memo 0, deferred 0, none 0, error 0, other 0. "other" = a `verify=` value this script does not know.

| minute | hint fetches | satisfied | fresh | memo | deferred | none | error | other |
|---|---|---|---|---|---|---|---|---|
| 03:33 | 1534 | 1534 | 0 | 0 | 0 | 0 | 0 | 0 |
| 03:34 | 1050 | 1050 | 0 | 0 | 0 | 0 | 0 | 0 |
| 03:35 | 546 | 546 | 0 | 0 | 0 | 0 | 0 | 0 |
| 03:36 | 30 | 30 | 0 | 0 | 0 | 0 | 0 | 0 |
| 03:37 | 131 | 131 | 0 | 0 | 0 | 0 | 0 | 0 |
| 03:38 | 732 | 732 | 0 | 0 | 0 | 0 | 0 | 0 |

### Warming (`[liveWarm]` jobs: 16; `[setlist] warm-lookup` lines: 4023)

**warm hit rate = hits ÷ hinted fetches = 527 / 4023 = 13.1 %** (hinted fetches = `[setlist] hint-fetch` lines with a numeric minRev; lookups 4023).

schedule-failed 0; job-failed 0; set ok=false 0 (set-error lines 0); skips 0; lookup-error lines 0; warm builds matched 48.

Warm jobs. start → done = the job's own `done ms=` (it starts in `after()`, i.e. right after the save's response, so it is ≈ warm-complete − commit). Per locale: actual rev, bytes, build / set ms, ok.

| save rev | instance | start (log clock) | start → done ms | sets | skips | warm builds (unmatched) | job-failed |
|---|---|---|---|---|---|---|---|
| 1368 | f4049a6e | 03:32:35 | 110 | ko r1368 80830 B 50/8 ms; ja r1368 67230 B 73/5 ms; en r1368 79463 B 47/5 ms | — | 3 | — |
| 1369 | f4049a6e | 03:32:36 | 121 | ko r1369 102444 B 52/9 ms; ja r1369 85188 B 56/19 ms; en r1369 100630 B 54/6 ms | — | 3 | — |
| 1370 | d0d80ae9 | 03:32:59 | 3138 | ja r1370 67791 B 48/10 ms; ko r1370 81460 B 56/10 ms; en r1371 59655 B 69/8 ms | — | 3 | — |
| 1371 | 346ff1ce | 03:32:59 | 650 | ko r1371 60582 B 239/8 ms; ja r1371 50503 B 244/9 ms; en r1371 59655 B 395/7 ms | — | 3 | — |
| 1372 | 8d694227 | 03:33:24 | 3269 | ja r1372 50506 B 45/5 ms; ko r1372 60585 B 48/7 ms; en r1373 59720 B 210/6 ms | — | 3 | — |
| 1373 | 48ab60f3 | 03:33:24 | 315 | ko r1373 60653 B 56/8 ms; ja r1373 50501 B 62/8 ms; en r1373 59720 B 232/18 ms | — | 3 | — |
| 1374 | 176a2eec | 03:33:49 | 3118 | ja r1374 50511 B 38/6 ms; ko r1374 60663 B 43/10 ms; en r1375 59689 B 65/7 ms | — | 3 | — |
| 1375 | c70dfa7c | 03:33:49 | 307 | ko r1375 60616 B 55/7 ms; ja r1375 50531 B 65/20 ms; en r1375 59689 B 240/4 ms | — | 3 | — |
| 1376 | 5c170350 | 03:34:14 | 3204 | ko r1376 60616 B 46/9 ms; ja r1376 50531 B 64/7 ms; en r1377 59669 B 138/10 ms | — | 3 | — |
| 1377 | 5ce3fea9 | 03:34:14 | 349 | ko r1377 60597 B 150/7 ms; ja r1377 50512 B 175/5 ms; en r1377 59669 B 181/10 ms | — | 3 | — |
| 1378 | b9f6c702 | 03:34:39 | 3165 | ja r1378 50509 B 40/8 ms; ko r1378 60594 B 59/7 ms; en r1379 59797 B 110/7 ms | — | 3 | — |
| 1379 | b9f6c702 | 03:34:39 | 184 | ko r1379 60723 B 42/9 ms; ja r1379 50555 B 58/7 ms; en r1379 59794 B 126/7 ms | — | 3 | — |
| 1380 | f689c004 | 03:35:04 | 3108 | ja r1380 50555 B 43/5 ms; ko r1380 60723 B 46/9 ms; en r1381 59694 B 51/8 ms | — | 3 | — |
| 1381 | f689c004 | 03:35:04 | 225 | ja r1381 50534 B 57/8 ms; ko r1381 60619 B 62/9 ms; en r1381 59691 B 154/5 ms | — | 3 | — |
| 1382 | aa396a76 | 03:37:59 | 105 | ja r1382 49795 B 40/11 ms; ko r1382 59808 B 48/10 ms; en r1382 58888 B 48/6 ms | — | 3 | — |
| 1383 | 81de42d3 | 03:37:59 | 109 | ko r1383 59218 B 49/9 ms; ja r1383 49274 B 67/12 ms; en r1383 58298 B 43/7 ms | — | 3 | — |

Per save rev. builds = every `[liveSnapshot] build` at that rev; warm = the ones matched to a warm job (same instance, locale, rev); reader = the rest. Lookups and hinted fetches are keyed by their `minRev`.

| save rev | warm jobs | start → done ms | builds | warm | reader | hinted fetches | lookups | hit | miss | stale | invalid | error | timeout | memo-miss | capped | other | lookup ms p50 / p95 | hit rate |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1368 | 1 | 110 | 3 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — / — | — |
| 1369 | 1 | 121 | 512 | 3 | 509 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — / — | — |
| 1370 | 1 | 3138 | 3 | 2 | 1 | 233 | 233 | 5 | 84 | 0 | 0 | 0 | 0 | 144 | 0 | 0 | 0 / 10 | 2.1 % |
| 1371 | 1 | 650 | 514 | 4 | 510 | 277 | 277 | 0 | 114 | 0 | 0 | 0 | 0 | 163 | 0 | 0 | 0 / 10 | 0.0 % |
| 1372 | 1 | 3269 | 8 | 2 | 6 | 224 | 224 | 5 | 88 | 0 | 0 | 0 | 0 | 131 | 0 | 0 | 0 / 10 | 2.2 % |
| 1373 | 1 | 315 | 467 | 4 | 463 | 286 | 286 | 0 | 166 | 0 | 0 | 0 | 0 | 120 | 0 | 0 | 3 / 93 | 0.0 % |
| 1374 | 1 | 3118 | 7 | 2 | 5 | 234 | 234 | 5 | 91 | 0 | 0 | 0 | 0 | 138 | 0 | 0 | 0 / 13 | 2.1 % |
| 1375 | 1 | 307 | 415 | 4 | 411 | 280 | 280 | 0 | 123 | 0 | 0 | 0 | 0 | 157 | 0 | 0 | 0 / 15 | 0.0 % |
| 1376 | 1 | 3204 | 18 | 2 | 16 | 324 | 324 | 6 | 113 | 0 | 0 | 0 | 0 | 205 | 0 | 0 | 0 / 11 | 1.9 % |
| 1377 | 1 | 349 | 491 | 4 | 487 | 215 | 215 | 0 | 112 | 0 | 0 | 0 | 0 | 103 | 0 | 0 | 3 / 13 | 0.0 % |
| 1378 | 1 | 3165 | 4 | 2 | 2 | 169 | 169 | 5 | 67 | 0 | 0 | 0 | 0 | 97 | 0 | 0 | 0 / 12 | 3.0 % |
| 1379 | 1 | 184 | 579 | 4 | 575 | 342 | 342 | 0 | 158 | 0 | 0 | 0 | 0 | 184 | 0 | 0 | 0 / 10 | 0.0 % |
| 1380 | 1 | 3108 | 5 | 2 | 3 | 235 | 235 | 31 | 86 | 0 | 0 | 0 | 0 | 118 | 0 | 0 | 1 / 15 | 13.2 % |
| 1381 | 1 | 225 | 1581 | 4 | 1577 | 347 | 347 | 0 | 165 | 0 | 0 | 0 | 0 | 182 | 0 | 0 | 0 / 10 | 0.0 % |
| 1382 | 1 | 105 | 6 | 3 | 3 | 387 | 387 | 382 | 5 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 8 / 18 | 98.7 % |
| 1383 | 1 | 109 | 188 | 3 | 185 | 470 | 470 | 88 | 120 | 0 | 0 | 0 | 0 | 262 | 0 | 0 | 0 / 10 | 18.7 % |

Lookup ms by result (p50 / p95, n): hit 8 / 18 (527); miss 4 / 31 (1492); memo-miss 0 / 0 (2004). Whole capture: hit 527, miss 1492, stale 0, invalid 0, error 0, timeout 0, memo-miss 2004, capped 0, other 0.

| minute | lookups | hit | miss | stale | invalid | error | timeout | memo-miss | capped | other |
|---|---|---|---|---|---|---|---|---|---|---|
| 03:33 | 1534 | 15 | 666 | 0 | 0 | 0 | 0 | 853 | 0 | 0 |
| 03:34 | 1050 | 11 | 450 | 0 | 0 | 0 | 0 | 589 | 0 | 0 |
| 03:35 | 546 | 22 | 224 | 0 | 0 | 0 | 0 | 300 | 0 | 0 |
| 03:36 | 30 | 9 | 21 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| 03:37 | 131 | 125 | 6 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| 03:38 | 732 | 345 | 125 | 0 | 0 | 0 | 0 | 262 | 0 | 0 |

### Admin writes (`[liveWriter]`)

| route | saves | acquire ms p50 / p95 | exec ms p50 / p95 | ok=false | failed kinds |
|---|---|---|---|---|---|
| admin-insert-after | 2 | 5 / 27 | 202 / 218 | 0 | — |
| admin-update | 12 | 4 / 12 | 81 / 125 | 0 | — |
| admin-delete | 2 | 3 / 4 | 23 / 30 | 0 | — |

Every save (routes with ≤ 12 saves; `at` = the server's commit time, epoch ms → UTC):

| route | rev | acquire ms | exec ms | ok | at (UTC) | instance |
|---|---|---|---|---|---|---|
| admin-insert-after | 1368 | 27 | 218 | true | 2026-10-12T03:32:35.975Z | f4049a6e |
| admin-insert-after | 1369 | 5 | 202 | true | 2026-10-12T03:32:36.526Z | f4049a6e |
| admin-update | 1370 | 4 | 103 | true | 2026-10-12T03:32:59.893Z | d0d80ae9 |
| admin-update | 1371 | 2 | 90 | true | 2026-10-12T03:33:00.101Z | 346ff1ce |
| admin-update | 1372 | 9 | 109 | true | 2026-10-12T03:33:24.895Z | 8d694227 |
| admin-update | 1373 | 4 | 81 | true | 2026-10-12T03:33:25.123Z | 48ab60f3 |
| admin-update | 1374 | 12 | 81 | true | 2026-10-12T03:33:49.832Z | 176a2eec |
| admin-update | 1375 | 4 | 73 | true | 2026-10-12T03:33:50.058Z | c70dfa7c |
| admin-update | 1376 | 2 | 61 | true | 2026-10-12T03:34:14.790Z | 5c170350 |
| admin-update | 1377 | 5 | 125 | true | 2026-10-12T03:34:15.119Z | 5ce3fea9 |
| admin-update | 1378 | 5 | 96 | true | 2026-10-12T03:34:39.835Z | b9f6c702 |
| admin-update | 1379 | 4 | 58 | true | 2026-10-12T03:34:40.011Z | b9f6c702 |
| admin-update | 1380 | 5 | 70 | true | 2026-10-12T03:35:04.804Z | f689c004 |
| admin-update | 1381 | 4 | 47 | true | 2026-10-12T03:35:04.998Z | f689c004 |
| admin-delete | 1382 | 4 | 30 | true | 2026-10-12T03:37:59.491Z | aa396a76 |
| admin-delete | 1383 | 3 | 23 | true | 2026-10-12T03:37:59.870Z | 81de42d3 |

### Warm expiry (`[dataCache] expire-warm` lines: 36)

The warm-tag expiry run by `revalidatePublicData()` (catalog edits). start = before `expireTag`, done = when it settled. `at` = server epoch ms.

| request | phase | ok | ms | at (UTC) | instance |
|---|---|---|---|---|---|
| POST /api/admin/songs | start | — | — | 2026-10-12T03:32:36.883Z | f4049a6e |
| POST /api/admin/songs | done | true | 6 | 2026-10-12T03:32:36.889Z | f4049a6e |
| POST /api/admin/songs | start | — | — | 2026-10-12T03:32:37.220Z | f4049a6e |
| POST /api/admin/songs | done | true | 4 | 2026-10-12T03:32:37.224Z | f4049a6e |
| POST /api/admin/songs | start | — | — | 2026-10-12T03:32:37.562Z | f4049a6e |
| POST /api/admin/songs | done | true | 5 | 2026-10-12T03:32:37.567Z | f4049a6e |
| POST /api/admin/songs | start | — | — | 2026-10-12T03:32:37.896Z | f4049a6e |
| POST /api/admin/songs | done | true | 5 | 2026-10-12T03:32:37.901Z | f4049a6e |
| POST /api/admin/songs | start | — | — | 2026-10-12T03:32:38.252Z | f4049a6e |
| POST /api/admin/songs | done | true | 5 | 2026-10-12T03:32:38.257Z | f4049a6e |
| POST /api/admin/songs | start | — | — | 2026-10-12T03:32:38.601Z | f4049a6e |
| POST /api/admin/songs | done | true | 5 | 2026-10-12T03:32:38.606Z | f4049a6e |
| PUT /api/admin/songs/4989 | start | — | — | 2026-10-12T03:33:00.201Z | d0d80ae9 |
| PUT /api/admin/songs/4989 | done | true | 5 | 2026-10-12T03:33:00.206Z | d0d80ae9 |
| PUT /api/admin/songs/4990 | start | — | — | 2026-10-12T03:33:25.223Z | f4049a6e |
| PUT /api/admin/songs/4990 | done | true | 6 | 2026-10-12T03:33:25.229Z | f4049a6e |
| PUT /api/admin/songs/4991 | start | — | — | 2026-10-12T03:33:50.161Z | 933ee253 |
| PUT /api/admin/songs/4991 | done | true | 29 | 2026-10-12T03:33:50.190Z | 933ee253 |
| PUT /api/admin/songs/4992 | start | — | — | 2026-10-12T03:34:15.160Z | bd790f61 |
| PUT /api/admin/songs/4992 | done | true | 26 | 2026-10-12T03:34:15.186Z | bd790f61 |
| PUT /api/admin/songs/4993 | start | — | — | 2026-10-12T03:34:40.126Z | b51f717b |
| PUT /api/admin/songs/4993 | done | true | 8 | 2026-10-12T03:34:40.134Z | b51f717b |
| PUT /api/admin/songs/4994 | start | — | — | 2026-10-12T03:35:05.189Z | ff5b19af |
| PUT /api/admin/songs/4994 | done | true | 6 | 2026-10-12T03:35:05.195Z | ff5b19af |
| DELETE /api/admin/songs/4989 | start | — | — | 2026-10-12T03:38:00.646Z | 003d55bb |
| DELETE /api/admin/songs/4989 | done | true | 7 | 2026-10-12T03:38:00.653Z | 003d55bb |
| DELETE /api/admin/songs/4990 | start | — | — | 2026-10-12T03:38:01.703Z | 933ee253 |
| DELETE /api/admin/songs/4990 | done | true | 5 | 2026-10-12T03:38:01.708Z | 933ee253 |
| DELETE /api/admin/songs/4991 | start | — | — | 2026-10-12T03:38:02.028Z | 176a2eec |
| DELETE /api/admin/songs/4991 | done | true | 7 | 2026-10-12T03:38:02.035Z | 176a2eec |
| DELETE /api/admin/songs/4992 | start | — | — | 2026-10-12T03:38:02.342Z | c70dfa7c |
| DELETE /api/admin/songs/4992 | done | true | 4 | 2026-10-12T03:38:02.346Z | c70dfa7c |
| DELETE /api/admin/songs/4993 | start | — | — | 2026-10-12T03:38:02.657Z | d99d2c19 |
| DELETE /api/admin/songs/4993 | done | true | 6 | 2026-10-12T03:38:02.663Z | d99d2c19 |
| DELETE /api/admin/songs/4994 | start | — | — | 2026-10-12T03:38:02.980Z | 72f8a575 |
| DELETE /api/admin/songs/4994 | done | true | 18 | 2026-10-12T03:38:02.998Z | 72f8a575 |

### Per minute

| minute | requests | distinct instances | builds | EMAXCONN |
|---|---|---|---|---|
| 03:32 | 1464 | 37 | 523 | 0 |
| 03:33 | 3254 | 73 | 1287 | 0 |
| 03:34 | 2692 | 41 | 1152 | 0 |
| 03:35 | 2176 | 37 | 792 | 0 |
| 03:36 | 1599 | 9 | 434 | 0 |
| 03:37 | 1936 | 13 | 429 | 0 |
| 03:38 | 997 | 41 | 185 | 0 |

### Prisma pool totals per 5 s (app-side estimate of pooler clients)

Peak carried sum: **88** (carry 5 s). "reported" = instances that logged in the bucket (max total each); "carried" also counts an instance's last total for 5 s after its last line.

| bucket | reporting instances | Σ total (reported) | instances (carried) | Σ total (carried) | max waiting |
|---|---|---|---|---|---|
| 03:32:30 | 1 | 1 | 1 | 1 | 0 |
| 03:32:35 | 18 | 30 | 19 | 31 | 0 |
| 03:32:40 | 34 | 62 | 34 | 62 | 8 |
| 03:32:45 | 35 | 68 | 36 | 70 | 7 |
| 03:32:50 | 0 | 0 | 35 | 67 | 0 |
| 03:32:55 | 6 | 11 | 6 | 11 | 1 |
| 03:33:00 | 33 | 63 | 33 | 63 | 2 |
| 03:33:05 | 12 | 24 | 33 | 63 | 0 |
| 03:33:10 | 6 | 6 | 12 | 15 | 0 |
| 03:33:15 | 3 | 5 | 7 | 9 | 0 |
| 03:33:20 | 5 | 9 | 5 | 9 | 2 |
| 03:33:25 | 55 | 88 | 55 | 88 | 1 |
| 03:33:30 | 8 | 15 | 55 | 87 | 0 |
| 03:33:35 | 5 | 7 | 8 | 10 | 0 |
| 03:33:40 | 3 | 6 | 5 | 8 | 0 |
| 03:33:45 | 8 | 14 | 8 | 14 | 1 |
| 03:33:50 | 44 | 77 | 44 | 77 | 2 |
| 03:33:55 | 13 | 21 | 44 | 73 | 0 |
| 03:34:00 | 11 | 13 | 13 | 15 | 0 |
| 03:34:05 | 11 | 13 | 11 | 13 | 0 |
| 03:34:10 | 9 | 17 | 11 | 19 | 0 |
| 03:34:15 | 40 | 74 | 40 | 74 | 2 |
| 03:34:20 | 13 | 26 | 40 | 74 | 0 |
| 03:34:25 | 10 | 13 | 13 | 17 | 0 |
| 03:34:30 | 7 | 8 | 10 | 13 | 0 |
| 03:34:35 | 9 | 17 | 9 | 17 | 1 |
| 03:34:40 | 37 | 72 | 37 | 72 | 1 |
| 03:34:45 | 5 | 10 | 37 | 72 | 0 |
| 03:34:50 | 4 | 8 | 5 | 10 | 0 |
| 03:34:55 | 4 | 7 | 5 | 9 | 0 |
| 03:35:00 | 13 | 21 | 14 | 23 | 1 |
| 03:35:05 | 37 | 69 | 37 | 69 | 1 |
| 03:35:10 | 6 | 12 | 37 | 70 | 0 |
| 03:35:15 | 3 | 6 | 6 | 11 | 0 |
| 03:35:20 | 4 | 7 | 4 | 7 | 0 |
| 03:35:25 | 5 | 6 | 5 | 6 | 0 |
| 03:35:30 | 4 | 5 | 5 | 6 | 0 |
| 03:35:35 | 5 | 9 | 5 | 9 | 0 |
| 03:35:40 | 4 | 8 | 5 | 10 | 0 |
| 03:35:45 | 3 | 5 | 4 | 7 | 0 |
| 03:35:50 | 3 | 5 | 3 | 5 | 0 |
| 03:35:55 | 3 | 5 | 3 | 5 | 0 |
| 03:36:00 | 4 | 6 | 5 | 7 | 0 |
| 03:36:05 | 4 | 6 | 4 | 6 | 0 |
| 03:36:10 | 3 | 5 | 4 | 7 | 0 |
| 03:36:15 | 4 | 7 | 4 | 7 | 0 |
| 03:36:20 | 4 | 8 | 4 | 8 | 0 |
| 03:36:25 | 4 | 6 | 4 | 6 | 0 |
| 03:36:30 | 3 | 6 | 4 | 7 | 0 |
| 03:36:35 | 3 | 5 | 3 | 5 | 0 |
| 03:36:40 | 5 | 8 | 5 | 8 | 0 |
| 03:36:45 | 3 | 5 | 5 | 8 | 0 |
| 03:36:50 | 4 | 7 | 4 | 7 | 0 |
| 03:36:55 | 3 | 6 | 4 | 8 | 0 |
| 03:37:00 | 3 | 6 | 4 | 8 | 0 |
| 03:37:05 | 2 | 4 | 3 | 6 | 0 |
| 03:37:10 | 5 | 9 | 5 | 9 | 0 |
| 03:37:15 | 4 | 8 | 6 | 11 | 0 |
| 03:37:20 | 4 | 7 | 6 | 11 | 0 |
| 03:37:25 | 3 | 6 | 5 | 9 | 0 |
| 03:37:30 | 4 | 8 | 4 | 8 | 0 |
| 03:37:35 | 3 | 6 | 5 | 10 | 0 |
| 03:37:40 | 5 | 9 | 5 | 9 | 0 |
| 03:37:45 | 4 | 8 | 5 | 9 | 0 |
| 03:37:50 | 4 | 8 | 4 | 8 | 0 |
| 03:37:55 | 3 | 6 | 4 | 8 | 0 |
| 03:38:00 | 41 | 75 | 41 | 75 | 0 |

### Other lines

| kind | count |
|---|---|
| untagged: No logs found for opensetlist-projects/opensetlist | 4 |
| untagged: revalidating cache with key: async()=>JSON.stringi | 1 |
