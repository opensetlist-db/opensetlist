## Vercel runtime logs — 2026-10-11T203226Z-vercel-logs-history-fault-geterror.txt

13080 entries; requests: /api/setlist 12433, other API 215, pages 432; error-level entries 1623. Times: log clock +7 h.

### Builds per rev (`[liveSnapshot] build` lines: 4270)

| rev | builds | distinct instances | locales | build ms avg / max | first – last |
|---|---|---|---|---|---|
| 1215 | 1 | 1 | ko 1 | 487 / 487 | 20:33:00 – 20:33:00 |
| 1216 | 342 | 43 | ko 103, ja 191, en 48 | 138 / 730 | 20:33:03 – 20:33:27 |
| 1217 | 66 | 22 | ko 21, ja 35, en 10 | 119 / 317 | 20:33:27 – 20:33:28 |
| 1218 | 488 | 86 | ko 109, ja 313, en 66 | 259 / 1132 | 20:33:28 – 20:33:53 |
| 1219 | 347 | 33 | ja 211, ko 87, en 49 | 77 / 329 | 20:33:53 – 20:34:17 |
| 1220 | 72 | 21 | ja 37, ko 19, en 16 | 173 / 278 | 20:34:17 – 20:34:18 |
| 1221 | 441 | 36 | ja 277, ko 102, en 62 | 117 / 511 | 20:34:18 – 20:34:43 |
| 1222 | 403 | 34 | ko 88, ja 249, en 66 | 60 / 194 | 20:34:43 – 20:35:07 |
| 1223 | 62 | 17 | ja 28, ko 20, en 14 | 152 / 401 | 20:35:07 – 20:35:08 |
| 1224 | 382 | 29 | ko 120, en 65, ja 197 | 126 / 488 | 20:35:08 – 20:35:33 |
| 1225 | 386 | 41 | ja 252, en 48, ko 86 | 71 / 190 | 20:35:33 – 20:35:57 |
| 1226 | 92 | 25 | en 21, ja 44, ko 27 | 193 / 373 | 20:35:57 – 20:35:58 |
| 1227 | 454 | 38 | ja 286, en 72, ko 96 | 133 / 563 | 20:35:58 – 20:36:23 |
| 1228 | 123 | 35 | en 42, ja 66, ko 15 | 92 / 184 | 20:36:23 – 20:36:26 |
| 1229 | 105 | 36 | ja 51, ko 35, en 19 | 287 / 605 | 20:36:26 – 20:36:26 |
| 1230 | 54 | 28 | ja 22, ko 16, en 16 | 380 / 644 | 20:36:26 – 20:36:27 |
| 1231 | 129 | 43 | ko 43, ja 58, en 28 | 365 / 729 | 20:36:27 – 20:36:28 |
| 1232 | 151 | 52 | en 29, ja 73, ko 49 | 310 / 757 | 20:36:27 – 20:36:29 |
| 1233 | 172 | 40 | ja 82, ko 55, en 35 | 312 / 796 | 20:36:28 – 20:36:31 |

### Failures, repair reads, coalescing

| what | count | detail |
|---|---|---|
| EMAXCONN (pooler client cap) | 0 | API 0, SSR 0 |
| `[liveSnapshot] build-failed` | 0 | — |
| `[liveSnapshot] rev-read` (repair revision read) | 0 | rev=timeout 0, rev=error 0; ms p50 — / max —; by hint: — |
| `[liveSnapshot] coalesced` | 1414 | waiters sum 5682, max 19 |
| `[setlist] slow-hit` | 0 | max — ms |

### Hint outcomes (`[setlist] hint-fetch` lines: 6607)

Whole capture: satisfied 6607, fresh 0, memo 0, deferred 0, none 0, error 0, other 0. "other" = a `verify=` value this script does not know.

| minute | hint fetches | satisfied | fresh | memo | deferred | none | error | other |
|---|---|---|---|---|---|---|---|---|
| 20:33 | 1100 | 1100 | 0 | 0 | 0 | 0 | 0 | 0 |
| 20:34 | 1209 | 1209 | 0 | 0 | 0 | 0 | 0 | 0 |
| 20:35 | 1907 | 1907 | 0 | 0 | 0 | 0 | 0 | 0 |
| 20:36 | 2391 | 2391 | 0 | 0 | 0 | 0 | 0 | 0 |

### Warming (`[liveWarm]` jobs: 18; `[setlist] warm-lookup` lines: 6607)

**warm hit rate = hits ÷ hinted fetches = 0 / 6607 = 0.0 %** (hinted fetches = `[setlist] hint-fetch` lines with a numeric minRev; lookups 6607).

schedule-failed 0; job-failed 0; set ok=false 0 (set-error lines 0); skips 0; lookup-error lines 1623; warm builds matched 54.

Warm jobs. start → done = the job's own `done ms=` (it starts in `after()`, i.e. right after the save's response, so it is ≈ warm-complete − commit). Per locale: actual rev, bytes, build / set ms, ok.

| save rev | instance | start (log clock) | start → done ms | sets | skips | warm builds (unmatched) | job-failed |
|---|---|---|---|---|---|---|---|
| 1216 | ea672bc5 | 20:33:03 | 137 | ko r1216 80830 B 50/25 ms; ja r1216 67230 B 85/10 ms; en r1216 79463 B 52/7 ms | — | 3 | — |
| 1217 | a7e441bc | 20:33:27 | 138 | ja r1217 85188 B 60/7 ms; ko r1217 102444 B 72/7 ms; en r1217 100630 B 60/8 ms | — | 3 | — |
| 1218 | adfb4aeb | 20:33:28 | 576 | ko r1218 81619 B 270/8 ms; ja r1218 67878 B 321/8 ms; en r1218 80241 B 288/9 ms | — | 3 | — |
| 1219 | 269e56f5 | 20:33:53 | 113 | ja r1219 50565 B 52/5 ms; ko r1219 60785 B 61/5 ms; en r1219 59847 B 40/6 ms | — | 3 | — |
| 1220 | f8334b11 | 20:34:17 | 136 | ko r1220 82399 B 68/6 ms; ja r1220 68523 B 86/5 ms; en r1220 81014 B 56/5 ms | — | 3 | — |
| 1221 | 7455dd0a | 20:34:18 | 713 | ko r1221 61580 B 240/5 ms; ja r1221 51222 B 407/5 ms; en r1221 60635 B 459/8 ms | — | 3 | — |
| 1222 | 5743c507 | 20:34:43 | 94 | ko r1222 61583 B 50/6 ms; ja r1222 51225 B 66/5 ms; en r1222 60635 B 31/5 ms | — | 3 | — |
| 1223 | c84b1eff | 20:35:07 | 110 | ko r1223 83197 B 46/13 ms; ja r1223 69183 B 72/9 ms; en r1223 81802 B 41/9 ms | — | 3 | — |
| 1224 | 8d6f664b | 20:35:08 | 696 | ko r1224 62400 B 223/6 ms; ja r1224 51883 B 411/5 ms; en r1224 61432 B 460/6 ms | — | 3 | — |
| 1225 | 8d6f664b | 20:35:33 | 86 | ja r1225 51887 B 37/5 ms; ko r1225 62416 B 51/6 ms; en r1225 61440 B 37/6 ms | — | 3 | — |
| 1226 | 7455dd0a | 20:35:57 | 107 | ko r1226 84030 B 45/6 ms; ja r1226 69845 B 58/8 ms; en r1226 82607 B 48/6 ms | — | 3 | — |
| 1227 | c84b1eff | 20:35:58 | 689 | ja r1227 52536 B 239/8 ms; ko r1227 63212 B 244/9 ms; en r1227 62221 B 434/8 ms | — | 3 | — |
| 1228 | b39d18cd | 20:36:23 | 115 | ko r1228 63209 B 56/13 ms; ja r1228 52533 B 67/13 ms; en r1228 62221 B 37/7 ms | — | 3 | — |
| 1229 | 61d129e2 | 20:36:26 | 157 | ko r1229 62414 B 40/16 ms; ja r1229 51885 B 70/39 ms; en r1229 61441 B 93/7 ms | — | 3 | — |
| 1230 | a72bfc75 | 20:36:26 | 496 | ko r1230 61598 B 339/7 ms; ja r1230 51228 B 344/7 ms; en r1230 60645 B 142/6 ms | — | 3 | — |
| 1231 | e9e6d374 | 20:36:27 | 435 | ja r1231 50572 B 104/6 ms; ko r1231 60804 B 132/5 ms; en r1231 59858 B 320/5 ms | — | 3 | — |
| 1232 | 2c905657 | 20:36:27 | 221 | ko r1232 60016 B 113/13 ms; ja r1232 49925 B 124/6 ms; en r1232 59081 B 87/8 ms | — | 3 | — |
| 1233 | 0ba98e85 | 20:36:28 | 481 | ja r1233 49277 B 195/22 ms; ko r1233 59221 B 214/17 ms; en r1233 58301 B 258/5 ms | — | 3 | — |

Per save rev. builds = every `[liveSnapshot] build` at that rev; warm = the ones matched to a warm job (same instance, locale, rev); reader = the rest. Lookups and hinted fetches are keyed by their `minRev`.

| save rev | warm jobs | start → done ms | builds | warm | reader | hinted fetches | lookups | hit | miss | stale | invalid | error | timeout | other | lookup ms p50 / p95 | hit rate |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1216 | 1 | 137 | 342 | 3 | 339 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — / — | — |
| 1217 | 1 | 138 | 66 | 3 | 63 | 473 | 473 | 0 | 0 | 0 | 0 | 180 | 0 | 293 | 0 / 59 | 0.0 % |
| 1218 | 1 | 576 | 488 | 3 | 485 | 141 | 141 | 0 | 0 | 0 | 0 | 97 | 0 | 44 | 6 / 105 | 0.0 % |
| 1219 | 1 | 113 | 347 | 3 | 344 | 486 | 486 | 0 | 0 | 0 | 0 | 94 | 0 | 392 | 0 / 16 | 0.0 % |
| 1220 | 1 | 136 | 72 | 3 | 69 | 494 | 494 | 0 | 0 | 0 | 0 | 103 | 0 | 391 | 0 / 15 | 0.0 % |
| 1221 | 1 | 713 | 441 | 3 | 438 | 226 | 226 | 0 | 0 | 0 | 0 | 69 | 0 | 157 | 0 / 6 | 0.0 % |
| 1222 | 1 | 94 | 403 | 3 | 400 | 489 | 489 | 0 | 0 | 0 | 0 | 98 | 0 | 391 | 0 / 14 | 0.0 % |
| 1223 | 1 | 110 | 62 | 3 | 59 | 486 | 486 | 0 | 0 | 0 | 0 | 75 | 0 | 411 | 0 / 10 | 0.0 % |
| 1224 | 1 | 696 | 382 | 3 | 379 | 192 | 192 | 0 | 0 | 0 | 0 | 56 | 0 | 136 | 0 / 7 | 0.0 % |
| 1225 | 1 | 86 | 386 | 3 | 383 | 494 | 494 | 0 | 0 | 0 | 0 | 108 | 0 | 386 | 0 / 13 | 0.0 % |
| 1226 | 1 | 107 | 92 | 3 | 89 | 485 | 485 | 0 | 0 | 0 | 0 | 98 | 0 | 387 | 0 / 13 | 0.0 % |
| 1227 | 1 | 689 | 454 | 3 | 451 | 254 | 254 | 0 | 0 | 0 | 0 | 77 | 0 | 177 | 0 / 7 | 0.0 % |
| 1228 | 1 | 115 | 123 | 3 | 120 | 490 | 490 | 0 | 0 | 0 | 0 | 110 | 0 | 380 | 0 / 14 | 0.0 % |
| 1229 | 1 | 157 | 105 | 3 | 102 | 492 | 492 | 0 | 0 | 0 | 0 | 97 | 0 | 395 | 0 / 6 | 0.0 % |
| 1230 | 1 | 496 | 54 | 3 | 51 | 201 | 201 | 0 | 0 | 0 | 0 | 71 | 0 | 130 | 0 / 6 | 0.0 % |
| 1231 | 1 | 435 | 129 | 3 | 126 | 315 | 315 | 0 | 0 | 0 | 0 | 91 | 0 | 224 | 0 / 6 | 0.0 % |
| 1232 | 1 | 221 | 151 | 3 | 148 | 449 | 449 | 0 | 0 | 0 | 0 | 119 | 0 | 330 | 0 / 6 | 0.0 % |
| 1233 | 1 | 481 | 172 | 3 | 169 | 440 | 440 | 0 | 0 | 0 | 0 | 102 | 0 | 338 | 0 / 5 | 0.0 % |

Lookup ms by result (p50 / p95, n): error 6 / 41 (1645); other 0 / 0 (4962). Whole capture: hit 0, miss 0, stale 0, invalid 0, error 1645, timeout 0, other 4962.

| minute | lookups | hit | miss | stale | invalid | error | timeout | other |
|---|---|---|---|---|---|---|---|---|
| 20:33 | 1100 | 0 | 0 | 0 | 0 | 371 | 0 | 729 |
| 20:34 | 1209 | 0 | 0 | 0 | 0 | 270 | 0 | 939 |
| 20:35 | 1907 | 0 | 0 | 0 | 0 | 413 | 0 | 1494 |
| 20:36 | 2391 | 0 | 0 | 0 | 0 | 591 | 0 | 1800 |

### Admin writes (`[liveWriter]`)

| route | saves | acquire ms p50 / p95 | exec ms p50 / p95 | ok=false | failed kinds |
|---|---|---|---|---|---|
| admin-insert-after | 5 | 3 / 4 | 164 / 264 | 0 | — |
| admin-update | 8 | 5 / 131 | 66 / 183 | 0 | — |
| admin-delete | 5 | 242 / 409 | 34 / 38 | 0 | — |

### Per minute

| minute | requests | distinct instances | builds | EMAXCONN |
|---|---|---|---|---|
| 20:33 | 3608 | 108 | 1066 | 0 |
| 20:34 | 2777 | 37 | 1033 | 0 |
| 20:35 | 3486 | 43 | 1134 | 0 |
| 20:36 | 3209 | 53 | 1037 | 0 |

### Prisma pool totals per 5 s (app-side estimate of pooler clients)

Peak carried sum: **142** (carry 5 s). "reported" = instances that logged in the bucket (max total each); "carried" also counts an instance's last total for 5 s after its last line.

| bucket | reporting instances | Σ total (reported) | instances (carried) | Σ total (carried) | max waiting |
|---|---|---|---|---|---|
| 20:33:00 | 25 | 35 | 25 | 35 | 0 |
| 20:33:05 | 38 | 55 | 41 | 60 | 0 |
| 20:33:10 | 39 | 55 | 42 | 61 | 0 |
| 20:33:15 | 15 | 19 | 39 | 51 | 0 |
| 20:33:20 | 6 | 6 | 15 | 18 | 0 |
| 20:33:25 | 86 | 142 | 86 | 142 | 1 |
| 20:33:30 | 49 | 90 | 86 | 142 | 0 |
| 20:33:35 | 14 | 17 | 49 | 80 | 0 |
| 20:33:40 | 10 | 11 | 14 | 15 | 0 |
| 20:33:45 | 8 | 10 | 10 | 12 | 0 |
| 20:33:50 | 33 | 58 | 33 | 58 | 0 |
| 20:33:55 | 18 | 33 | 33 | 58 | 0 |
| 20:34:00 | 13 | 13 | 18 | 22 | 0 |
| 20:34:05 | 5 | 10 | 13 | 18 | 0 |
| 20:34:10 | 3 | 6 | 5 | 10 | 0 |
| 20:34:15 | 36 | 71 | 36 | 71 | 1 |
| 20:34:20 | 19 | 38 | 36 | 71 | 0 |
| 20:34:25 | 15 | 19 | 19 | 27 | 0 |
| 20:34:30 | 10 | 14 | 15 | 19 | 0 |
| 20:34:35 | 10 | 12 | 10 | 12 | 0 |
| 20:34:40 | 34 | 56 | 34 | 56 | 0 |
| 20:34:45 | 22 | 38 | 34 | 56 | 0 |
| 20:34:50 | 17 | 18 | 22 | 25 | 0 |
| 20:34:55 | 13 | 15 | 17 | 19 | 0 |
| 20:35:00 | 9 | 9 | 13 | 14 | 0 |
| 20:35:05 | 29 | 57 | 29 | 57 | 1 |
| 20:35:10 | 21 | 42 | 29 | 57 | 0 |
| 20:35:15 | 13 | 15 | 21 | 30 | 0 |
| 20:35:20 | 10 | 11 | 13 | 14 | 0 |
| 20:35:25 | 7 | 9 | 10 | 13 | 0 |
| 20:35:30 | 41 | 67 | 41 | 67 | 0 |
| 20:35:35 | 26 | 47 | 41 | 66 | 0 |
| 20:35:40 | 16 | 18 | 26 | 37 | 0 |
| 20:35:45 | 12 | 14 | 16 | 18 | 0 |
| 20:35:50 | 11 | 13 | 12 | 14 | 0 |
| 20:35:55 | 38 | 76 | 38 | 76 | 1 |
| 20:36:00 | 25 | 49 | 38 | 75 | 0 |
| 20:36:05 | 15 | 17 | 25 | 35 | 0 |
| 20:36:10 | 11 | 12 | 15 | 17 | 0 |
| 20:36:15 | 10 | 10 | 11 | 11 | 0 |
| 20:36:20 | 34 | 53 | 34 | 53 | 0 |
| 20:36:25 | 53 | 104 | 53 | 104 | 1 |
| 20:36:30 | 38 | 76 | 53 | 104 | 0 |

### Other lines

| kind | count |
|---|---|
| [liveWarm] fault | 100 |
| untagged: No logs found for opensetlist-projects/opensetlist | 4 |
