## Vercel runtime logs — 2026-10-12T03-26-28Z-vercel-logs-history-step4-S3.txt

9096 entries; requests: /api/setlist 8495, other API 169, pages 432; error-level entries 6. Times: log clock +7 h.

### Builds per rev (`[liveSnapshot] build` lines: 2407)

| rev | builds | distinct instances | locales | build ms avg / max | first – last |
|---|---|---|---|---|---|
| 1350 | 1 | 1 | ko 1 | 516 / 516 | 03:27:02 – 03:27:02 |
| 1351 | 3 | 1 | ko 1, ja 1, en 1 | 69 / 94 | 03:27:06 – 03:27:06 |
| 1352 | 676 | 44 | ko 135, ja 457, en 84 | 293 / 1161 | 03:27:06 – 03:27:33 |
| 1353 | 28 | 7 | ja 14, en 5, ko 9 | 84 / 132 | 03:27:33 – 03:27:33 |
| 1354 | 403 | 40 | en 67, ja 234, ko 102 | 86 / 553 | 03:27:33 – 03:27:57 |
| 1355 | 6 | 3 | ko 3, ja 2, en 1 | 50 / 66 | 03:27:58 – 03:27:58 |
| 1356 | 243 | 25 | en 32, ja 155, ko 56 | 78 / 260 | 03:27:58 – 03:28:23 |
| 1357 | 5 | 3 | ja 2, ko 2, en 1 | 51 / 79 | 03:28:23 – 03:28:23 |
| 1358 | 305 | 35 | ja 194, en 44, ko 67 | 83 / 539 | 03:28:23 – 03:28:47 |
| 1359 | 9 | 4 | ko 2, ja 6, en 1 | 37 / 46 | 03:28:47 – 03:28:48 |
| 1360 | 251 | 22 | ko 58, ja 154, en 39 | 71 / 248 | 03:28:48 – 03:29:13 |
| 1361 | 7 | 3 | en 2, ja 4, ko 1 | 54 / 87 | 03:29:12 – 03:29:13 |
| 1362 | 258 | 31 | en 41, ko 66, ja 151 | 103 / 411 | 03:29:13 – 03:29:38 |
| 1363 | 6 | 3 | en 2, ja 3, ko 1 | 46 / 71 | 03:29:38 – 03:29:38 |
| 1364 | 172 | 30 | en 27, ko 48, ja 97 | 120 / 327 | 03:29:38 – 03:29:43 |
| 1365 | 4 | 2 | en 2, ko 1, ja 1 | 58 / 81 | 03:29:43 – 03:29:43 |
| 1366 | 30 | 17 | ja 15, ko 10, en 5 | 56 / 121 | 03:29:43 – 03:29:45 |

### Failures, repair reads, coalescing

| what | count | detail |
|---|---|---|
| EMAXCONN (pooler client cap) | 0 | API 0, SSR 0 |
| `[liveSnapshot] build-failed` | 0 | — |
| `[liveSnapshot] rev-read` (repair revision read) | 0 | rev=timeout 0, rev=error 0; ms p50 — / max —; by hint: — |
| `[liveSnapshot] coalesced` | 402 | waiters sum 1278, max 11 |
| `[setlist] slow-hit` | 0 | max — ms |

### Hint outcomes (`[setlist] hint-fetch` lines: 3905)

Whole capture: satisfied 3905, fresh 0, memo 0, deferred 0, none 0, error 0, other 0. "other" = a `verify=` value this script does not know.

| minute | hint fetches | satisfied | fresh | memo | deferred | none | error | other |
|---|---|---|---|---|---|---|---|---|
| 03:27 | 1026 | 1026 | 0 | 0 | 0 | 0 | 0 | 0 |
| 03:28 | 1043 | 1043 | 0 | 0 | 0 | 0 | 0 | 0 |
| 03:29 | 1836 | 1836 | 0 | 0 | 0 | 0 | 0 | 0 |

### Warming (`[liveWarm]` jobs: 16; `[setlist] warm-lookup` lines: 3905)

**warm hit rate = hits ÷ hinted fetches = 2404 / 3905 = 61.6 %** (hinted fetches = `[setlist] hint-fetch` lines with a numeric minRev; lookups 3905).

schedule-failed 0; job-failed 0; set ok=false 18 (set-error lines 18); skips 0; lookup-error lines 0; warm builds matched 48.

Warm jobs. start → done = the job's own `done ms=` (it starts in `after()`, i.e. right after the save's response, so it is ≈ warm-complete − commit). Per locale: actual rev, bytes, build / set ms, ok.

| save rev | instance | start (log clock) | start → done ms | sets | skips | warm builds (unmatched) | job-failed |
|---|---|---|---|---|---|---|---|
| 1351 | 6751f372 | 03:27:06 | 136 | ko r1351 80830 B 63/11 ms; ja r1351 67230 B 98/7 ms; en r1351 79463 B 53/8 ms | — | 3 | — |
| 1352 | 6751f372 | 03:27:06 | 175 | ko r1352 102444 B 68/43 ms; ja r1352 85188 B 103/14 ms; en r1352 100630 B 55/8 ms | — | 3 | — |
| 1353 | 2346ad36 | 03:27:33 | 137 | ko r1353 81566 B 82/1 ms **ok=false**; ja r1353 67900 B 92/1 ms **ok=false**; en r1353 80189 B 53/0 ms **ok=false** | — | 3 | — |
| 1354 | 46e0d997 | 03:27:33 | 256 | ja r1354 50607 B 60/8 ms; ko r1354 60756 B 105/18 ms; en r1354 59810 B 163/23 ms | — | 3 | — |
| 1355 | 5b7c1a28 | 03:27:58 | 117 | ko r1355 60777 B 63/1 ms **ok=false**; ja r1355 50622 B 66/1 ms **ok=false**; en r1355 59831 B 52/1 ms **ok=false** | — | 3 | — |
| 1356 | 5b7c1a28 | 03:27:58 | 176 | ko r1356 60708 B 58/7 ms; ja r1356 50620 B 69/5 ms; en r1356 59770 B 100/11 ms | — | 3 | — |
| 1357 | e93710aa | 03:28:23 | 109 | ko r1357 60815 B 70/0 ms **ok=false**; ja r1357 50644 B 80/0 ms **ok=false**; en r1357 59878 B 37/0 ms **ok=false** | — | 3 | — |
| 1358 | 46e0d997 | 03:28:23 | 254 | ko r1358 60840 B 80/9 ms; ja r1358 50669 B 104/6 ms; en r1358 59903 B 158/7 ms | — | 3 | — |
| 1359 | 2346ad36 | 03:28:47 | 74 | ko r1359 60826 B 38/0 ms **ok=false**; ja r1359 50666 B 41/0 ms **ok=false**; en r1359 59883 B 36/0 ms **ok=false** | — | 3 | — |
| 1360 | 1f20066c | 03:28:48 | 264 | ko r1360 60908 B 57/6 ms; ja r1360 50684 B 75/5 ms; en r1360 59965 B 193/6 ms | — | 3 | — |
| 1361 | f52151d6 | 03:29:12 | 94 | ko r1361 60821 B 56/1 ms **ok=false**; ja r1361 50675 B 88/0 ms **ok=false**; en r1361 59886 B 36/0 ms **ok=false** | — | 3 | — |
| 1362 | 6a8c472e | 03:29:13 | 510 | ko r1362 60723 B 158/32 ms; ja r1362 50641 B 265/6 ms; en r1362 59786 B 313/6 ms | — | 3 | — |
| 1363 | 8dc5142c | 03:29:38 | 86 | ko r1363 60788 B 48/0 ms **ok=false**; ja r1363 50628 B 72/0 ms **ok=false**; en r1363 59845 B 36/0 ms **ok=false** | — | 3 | — |
| 1364 | 2346ad36 | 03:29:38 | 226 | ko r1364 60861 B 91/6 ms; ja r1364 50630 B 127/5 ms; en r1364 59909 B 116/12 ms | — | 3 | — |
| 1365 | ff808a7b | 03:29:43 | 182 | ko r1365 60045 B 57/25 ms; ja r1365 49957 B 62/72 ms; en r1365 59112 B 83/5 ms | — | 3 | — |
| 1366 | 8dc5142c | 03:29:43 | 105 | ko r1366 59218 B 50/7 ms; ja r1366 49274 B 68/6 ms; en r1366 58298 B 41/7 ms | — | 3 | — |

Per save rev. builds = every `[liveSnapshot] build` at that rev; warm = the ones matched to a warm job (same instance, locale, rev); reader = the rest. Lookups and hinted fetches are keyed by their `minRev`.

| save rev | warm jobs | start → done ms | builds | warm | reader | hinted fetches | lookups | hit | miss | stale | invalid | error | timeout | memo-miss | capped | other | lookup ms p50 / p95 | hit rate |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1351 | 1 | 136 | 3 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — / — | — |
| 1352 | 1 | 175 | 676 | 3 | 673 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — / — | — |
| 1353 | 1 | 137 | 28 | 3 | 25 | 401 | 401 | 0 | 164 | 0 | 0 | 0 | 0 | 237 | 0 | 0 | 0 / 25 | 0.0 % |
| 1354 | 1 | 256 | 403 | 3 | 400 | 133 | 133 | 133 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 9 / 32 | 100.0 % |
| 1355 | 1 | 117 | 6 | 3 | 3 | 200 | 200 | 0 | 74 | 0 | 0 | 0 | 0 | 126 | 0 | 0 | 0 / 18 | 0.0 % |
| 1356 | 1 | 176 | 243 | 3 | 240 | 315 | 315 | 315 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 8 / 32 | 100.0 % |
| 1357 | 1 | 109 | 5 | 3 | 2 | 221 | 221 | 0 | 93 | 0 | 0 | 0 | 0 | 128 | 0 | 0 | 0 / 12 | 0.0 % |
| 1358 | 1 | 254 | 305 | 3 | 302 | 288 | 288 | 288 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 8 / 20 | 100.0 % |
| 1359 | 1 | 74 | 9 | 3 | 6 | 197 | 197 | 0 | 77 | 0 | 0 | 0 | 0 | 120 | 0 | 0 | 0 / 9 | 0.0 % |
| 1360 | 1 | 264 | 251 | 3 | 248 | 314 | 314 | 314 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 8 / 19 | 100.0 % |
| 1361 | 1 | 94 | 7 | 3 | 4 | 217 | 217 | 0 | 95 | 0 | 0 | 0 | 0 | 122 | 0 | 0 | 0 / 11 | 0.0 % |
| 1362 | 1 | 510 | 258 | 3 | 255 | 292 | 292 | 270 | 12 | 0 | 0 | 0 | 0 | 10 | 0 | 0 | 8 / 20 | 92.5 % |
| 1363 | 1 | 86 | 6 | 3 | 3 | 243 | 243 | 0 | 98 | 0 | 0 | 0 | 0 | 145 | 0 | 0 | 0 / 9 | 0.0 % |
| 1364 | 1 | 226 | 172 | 3 | 169 | 270 | 270 | 270 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 8 / 18 | 100.0 % |
| 1365 | 1 | 182 | 4 | 3 | 1 | 333 | 333 | 333 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 8 / 10 | 100.0 % |
| 1366 | 1 | 105 | 30 | 3 | 27 | 481 | 481 | 481 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 7 / 13 | 100.0 % |

Lookup ms by result (p50 / p95, n): hit 8 / 19 (2404); miss 4 / 28 (613); memo-miss 0 / 0 (888). Whole capture: hit 2404, miss 613, stale 0, invalid 0, error 0, timeout 0, memo-miss 888, capped 0, other 0.

| minute | lookups | hit | miss | stale | invalid | error | timeout | memo-miss | capped | other |
|---|---|---|---|---|---|---|---|---|---|---|
| 03:27 | 1026 | 431 | 232 | 0 | 0 | 0 | 0 | 363 | 0 | 0 |
| 03:28 | 1043 | 619 | 176 | 0 | 0 | 0 | 0 | 248 | 0 | 0 |
| 03:29 | 1836 | 1354 | 205 | 0 | 0 | 0 | 0 | 277 | 0 | 0 |

### Admin writes (`[liveWriter]`)

| route | saves | acquire ms p50 / p95 | exec ms p50 / p95 | ok=false | failed kinds |
|---|---|---|---|---|---|
| admin-insert-after | 2 | 5 / 5 | 153 / 218 | 0 | — |
| admin-update | 12 | 3 / 7 | 69 / 94 | 0 | — |
| admin-delete | 2 | 2 / 4 | 25 / 31 | 0 | — |

Every save (routes with ≤ 12 saves; `at` = the server's commit time, epoch ms → UTC):

| route | rev | acquire ms | exec ms | ok | at (UTC) | instance |
|---|---|---|---|---|---|---|
| admin-insert-after | 1351 | 5 | 218 | true | 2026-10-12T03:27:06.564Z | 6751f372 |
| admin-insert-after | 1352 | 5 | 153 | true | 2026-10-12T03:27:07.173Z | 6751f372 |
| admin-update | 1353 | 4 | 85 | true | 2026-10-12T03:27:33.350Z | 2346ad36 |
| admin-update | 1354 | 7 | 94 | true | 2026-10-12T03:27:33.722Z | 46e0d997 |
| admin-update | 1355 | 5 | 82 | true | 2026-10-12T03:27:58.342Z | 5b7c1a28 |
| admin-update | 1356 | 4 | 55 | true | 2026-10-12T03:27:58.550Z | 5b7c1a28 |
| admin-update | 1357 | 3 | 67 | true | 2026-10-12T03:28:23.322Z | e93710aa |
| admin-update | 1358 | 3 | 46 | true | 2026-10-12T03:28:23.540Z | 46e0d997 |
| admin-update | 1359 | 2 | 39 | true | 2026-10-12T03:28:48.270Z | 2346ad36 |
| admin-update | 1360 | 3 | 73 | true | 2026-10-12T03:28:48.563Z | 1f20066c |
| admin-update | 1361 | 3 | 70 | true | 2026-10-12T03:29:13.357Z | f52151d6 |
| admin-update | 1362 | 3 | 69 | true | 2026-10-12T03:29:13.582Z | 6a8c472e |
| admin-update | 1363 | 3 | 72 | true | 2026-10-12T03:29:38.340Z | 8dc5142c |
| admin-update | 1364 | 3 | 41 | true | 2026-10-12T03:29:38.558Z | 2346ad36 |
| admin-delete | 1365 | 4 | 31 | true | 2026-10-12T03:29:43.810Z | ff808a7b |
| admin-delete | 1366 | 2 | 25 | true | 2026-10-12T03:29:44.143Z | 8dc5142c |

### Per minute

| minute | requests | distinct instances | builds | EMAXCONN |
|---|---|---|---|---|
| 03:27 | 3484 | 54 | 1207 | 0 |
| 03:28 | 2598 | 45 | 647 | 0 |
| 03:29 | 3014 | 41 | 553 | 0 |

### Prisma pool totals per 5 s (app-side estimate of pooler clients)

Peak carried sum: **88** (carry 5 s). "reported" = instances that logged in the bucket (max total each); "carried" also counts an instance's last total for 5 s after its last line.

| bucket | reporting instances | Σ total (reported) | instances (carried) | Σ total (carried) | max waiting |
|---|---|---|---|---|---|
| 03:27:00 | 1 | 1 | 1 | 1 | 0 |
| 03:27:05 | 38 | 59 | 38 | 59 | 2 |
| 03:27:10 | 39 | 73 | 44 | 83 | 4 |
| 03:27:15 | 43 | 86 | 44 | 88 | 3 |
| 03:27:20 | 16 | 27 | 43 | 81 | 3 |
| 03:27:25 | 9 | 10 | 16 | 24 | 0 |
| 03:27:30 | 40 | 66 | 40 | 66 | 1 |
| 03:27:35 | 20 | 35 | 40 | 66 | 0 |
| 03:27:40 | 11 | 11 | 20 | 26 | 0 |
| 03:27:45 | 4 | 8 | 11 | 15 | 0 |
| 03:27:50 | 5 | 9 | 5 | 9 | 0 |
| 03:27:55 | 25 | 45 | 25 | 45 | 0 |
| 03:28:00 | 13 | 24 | 25 | 44 | 0 |
| 03:28:05 | 13 | 14 | 13 | 14 | 0 |
| 03:28:10 | 10 | 11 | 13 | 15 | 0 |
| 03:28:15 | 9 | 10 | 10 | 11 | 0 |
| 03:28:20 | 35 | 58 | 35 | 58 | 1 |
| 03:28:25 | 17 | 28 | 35 | 57 | 0 |
| 03:28:30 | 11 | 13 | 17 | 23 | 0 |
| 03:28:35 | 10 | 12 | 11 | 13 | 0 |
| 03:28:40 | 6 | 6 | 10 | 10 | 0 |
| 03:28:45 | 22 | 38 | 22 | 38 | 1 |
| 03:28:50 | 13 | 25 | 22 | 37 | 0 |
| 03:28:55 | 10 | 11 | 13 | 17 | 0 |
| 03:29:00 | 8 | 9 | 10 | 11 | 0 |
| 03:29:05 | 7 | 8 | 8 | 9 | 0 |
| 03:29:10 | 31 | 56 | 31 | 56 | 1 |
| 03:29:15 | 17 | 31 | 31 | 56 | 0 |
| 03:29:20 | 11 | 14 | 17 | 24 | 0 |
| 03:29:25 | 8 | 9 | 11 | 12 | 0 |
| 03:29:30 | 7 | 8 | 8 | 9 | 0 |
| 03:29:35 | 30 | 55 | 30 | 55 | 1 |
| 03:29:40 | 20 | 38 | 30 | 54 | 0 |
| 03:29:45 | 12 | 13 | 24 | 32 | 0 |

### Other lines

| kind | count |
|---|---|
| untagged: No logs found for opensetlist-projects/opensetlist | 4 |
