## Vercel runtime logs — 2026-10-11T195557Z-vercel-logs-history-fault-absent.txt

13170 entries; requests: /api/setlist 12513, other API 225, pages 432; error-level entries 0. Times: log clock +7 h.

### Builds per rev (`[liveSnapshot] build` lines: 4761)

| rev | builds | distinct instances | locales | build ms avg / max | first – last |
|---|---|---|---|---|---|
| 1063 | 1 | 1 | ko 1 | 72 / 72 | 19:56:30 – 19:56:30 |
| 1064 | 377 | 42 | ja 250, en 45, ko 82 | 159 / 741 | 19:56:32 – 19:56:57 |
| 1065 | 126 | 35 | ko 39, ja 62, en 25 | 308 / 678 | 19:56:57 – 19:56:58 |
| 1066 | 407 | 82 | ko 85, en 61, ja 261 | 379 / 1503 | 19:56:57 – 19:57:23 |
| 1067 | 423 | 43 | en 55, ja 259, ko 109 | 136 / 606 | 19:57:22 – 19:57:47 |
| 1068 | 51 | 16 | ko 16, ja 26, en 9 | 135 / 298 | 19:57:47 – 19:57:47 |
| 1069 | 427 | 48 | en 64, ja 259, ko 104 | 158 / 630 | 19:57:47 – 19:58:13 |
| 1070 | 553 | 32 | ja 339, en 80, ko 134 | 93 / 395 | 19:58:12 – 19:58:37 |
| 1071 | 77 | 18 | ko 24, en 16, ja 37 | 169 / 320 | 19:58:37 – 19:58:37 |
| 1072 | 440 | 48 | ja 261, ko 109, en 70 | 142 / 536 | 19:58:37 – 19:59:03 |
| 1073 | 474 | 52 | ja 291, ko 114, en 69 | 152 / 783 | 19:59:02 – 19:59:27 |
| 1074 | 66 | 17 | ko 22, ja 33, en 11 | 144 / 353 | 19:59:27 – 19:59:27 |
| 1075 | 500 | 41 | ja 317, en 73, ko 110 | 136 / 681 | 19:59:27 – 19:59:53 |
| 1076 | 199 | 39 | ja 97, ko 67, en 35 | 200 / 567 | 19:59:52 – 19:59:56 |
| 1077 | 137 | 43 | ja 67, ko 42, en 28 | 306 / 711 | 19:59:55 – 19:59:56 |
| 1078 | 81 | 37 | en 18, ja 42, ko 21 | 247 / 671 | 19:59:56 – 19:59:57 |
| 1079 | 94 | 43 | ja 41, en 24, ko 29 | 418 / 725 | 19:59:57 – 19:59:58 |
| 1080 | 166 | 68 | ja 80, ko 54, en 32 | 393 / 855 | 19:59:57 – 19:59:59 |
| 1081 | 162 | 54 | ko 50, ja 78, en 34 | 401 / 885 | 19:59:58 – 20:00:00 |

### Failures, repair reads, coalescing

| what | count | detail |
|---|---|---|
| EMAXCONN (pooler client cap) | 0 | API 0, SSR 0 |
| `[liveSnapshot] build-failed` | 0 | — |
| `[liveSnapshot] rev-read` (repair revision read) | 0 | rev=timeout 0, rev=error 0; ms p50 — / max —; by hint: — |
| `[liveSnapshot] coalesced` | 1561 | waiters sum 6310, max 22 |
| `[setlist] slow-hit` | 0 | max — ms |

### Hint outcomes (`[setlist] hint-fetch` lines: 6669)

Whole capture: satisfied 6669, fresh 0, memo 0, deferred 0, none 0, error 0, other 0. "other" = a `verify=` value this script does not know.

| minute | hint fetches | satisfied | fresh | memo | deferred | none | error | other |
|---|---|---|---|---|---|---|---|---|
| 19:56 | 789 | 789 | 0 | 0 | 0 | 0 | 0 | 0 |
| 19:57 | 1107 | 1107 | 0 | 0 | 0 | 0 | 0 | 0 |
| 19:58 | 1206 | 1206 | 0 | 0 | 0 | 0 | 0 | 0 |
| 19:59 | 3245 | 3245 | 0 | 0 | 0 | 0 | 0 | 0 |
| 20:00 | 322 | 322 | 0 | 0 | 0 | 0 | 0 | 0 |

### Warming (`[liveWarm]` jobs: 18; `[setlist] warm-lookup` lines: 6669)

**warm hit rate = hits ÷ hinted fetches = 0 / 6669 = 0.0 %** (hinted fetches = `[setlist] hint-fetch` lines with a numeric minRev; lookups 6669).

schedule-failed 0; job-failed 0; set ok=false 0 (set-error lines 0); skips 0; lookup-error lines 0; warm builds matched 54.

Warm jobs. start → done = the job's own `done ms=` (it starts in `after()`, i.e. right after the save's response, so it is ≈ warm-complete − commit). Per locale: actual rev, bytes, build / set ms, ok.

| save rev | instance | start (log clock) | start → done ms | sets | skips | warm builds (unmatched) | job-failed |
|---|---|---|---|---|---|---|---|
| 1064 | 98864db4 | 19:56:32 | 171 | ko r1064 80830 B 58/19 ms; ja r1064 67230 B 105/18 ms; en r1064 79463 B 84/8 ms | — | 3 | — |
| 1065 | 8b3154de | 19:56:57 | 175 | ko r1065 102444 B 57/16 ms; ja r1065 85188 B 68/16 ms; en r1065 100630 B 78/22 ms | — | 3 | — |
| 1066 | 89998a8b | 19:56:57 | 1578 | ko r1066 81513 B 1471/9 ms; ja r1066 67854 B 1504/6 ms; en r1066 80145 B 92/6 ms | — | 3 | — |
| 1067 | bd01b400 | 19:57:22 | 98 | ja r1067 50503 B 42/6 ms; ko r1067 60633 B 51/5 ms; en r1067 59703 B 36/6 ms | — | 3 | — |
| 1068 | bc5030af | 19:57:47 | 120 | ko r1068 82247 B 54/10 ms; ja r1068 68461 B 85/7 ms; en r1068 80870 B 48/7 ms | — | 3 | — |
| 1069 | 914bf072 | 19:57:47 | 590 | ko r1069 61346 B 266/8 ms; ja r1069 51090 B 308/6 ms; en r1069 60403 B 309/7 ms | — | 3 | — |
| 1070 | bead2882 | 19:58:12 | 120 | ja r1070 51070 B 52/9 ms; ko r1070 61248 B 57/16 ms; en r1070 60314 B 52/7 ms | — | 3 | — |
| 1071 | 914bf072 | 19:58:37 | 132 | ko r1071 82862 B 41/8 ms; ja r1071 69028 B 52/7 ms; en r1071 81481 B 61/22 ms | — | 3 | — |
| 1072 | 1b38f1bd | 19:58:37 | 461 | ko r1072 61921 B 193/7 ms; ja r1072 51681 B 231/9 ms; en r1072 60978 B 255/6 ms | — | 3 | — |
| 1073 | 1b38f1bd | 19:59:02 | 122 | ko r1073 61931 B 41/6 ms; ja r1073 51678 B 76/10 ms; en r1073 60982 B 42/13 ms | — | 3 | — |
| 1074 | 8ddba87f | 19:59:27 | 131 | ko r1074 83545 B 68/12 ms; ja r1074 69636 B 94/8 ms; en r1074 82149 B 40/11 ms | — | 3 | — |
| 1075 | 1b38f1bd | 19:59:27 | 873 | ko r1075 62588 B 292/7 ms; ja r1075 52270 B 445/5 ms; en r1075 61633 B 566/8 ms | — | 3 | — |
| 1076 | 6af9d1bc | 19:59:52 | 111 | ko r1076 62600 B 48/11 ms; ja r1076 52279 B 76/7 ms; en r1076 61640 B 43/7 ms | — | 3 | — |
| 1077 | bd01b400 | 19:59:55 | 100 | ja r1077 51688 B 41/10 ms; ko r1077 61944 B 46/16 ms; en r1077 60990 B 42/7 ms | — | 3 | — |
| 1078 | e0fd6a83 | 19:59:56 | 284 | ja r1078 51078 B 212/7 ms; ko r1078 61272 B 235/4 ms; en r1078 60327 B 60/5 ms | — | 3 | — |
| 1079 | c0c5e25d | 19:59:57 | 747 | ja r1079 50492 B 439/9 ms; ko r1079 60560 B 492/10 ms; en r1079 59628 B 288/8 ms | — | 3 | — |
| 1080 | 862413ff | 19:59:57 | 453 | ko r1080 59878 B 154/10 ms; ja r1080 49869 B 332/6 ms; en r1080 58947 B 281/7 ms | — | 3 | — |
| 1081 | 4fe80aec | 19:59:58 | 214 | ja r1081 49277 B 162/7 ms; ko r1081 59221 B 177/4 ms; en r1081 58301 B 37/6 ms | — | 3 | — |

Per save rev. builds = every `[liveSnapshot] build` at that rev; warm = the ones matched to a warm job (same instance, locale, rev); reader = the rest. Lookups and hinted fetches are keyed by their `minRev`.

| save rev | warm jobs | start → done ms | builds | warm | reader | hinted fetches | lookups | hit | miss | stale | invalid | error | timeout | other | lookup ms p50 / p95 | hit rate |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1064 | 1 | 171 | 377 | 3 | 374 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — / — | — |
| 1065 | 1 | 175 | 126 | 3 | 123 | 483 | 483 | 0 | 232 | 0 | 0 | 0 | 0 | 251 | 0 / 2 | 0.0 % |
| 1066 | 1 | 1578 | 407 | 3 | 404 | 306 | 306 | 0 | 122 | 0 | 0 | 0 | 0 | 184 | 0 / 1 | 0.0 % |
| 1067 | 1 | 98 | 423 | 3 | 420 | 495 | 495 | 0 | 178 | 0 | 0 | 0 | 0 | 317 | 0 / 1 | 0.0 % |
| 1068 | 1 | 120 | 51 | 3 | 48 | 492 | 492 | 0 | 169 | 0 | 0 | 0 | 0 | 323 | 0 / 0 | 0.0 % |
| 1069 | 1 | 590 | 427 | 3 | 424 | 120 | 120 | 0 | 60 | 0 | 0 | 0 | 0 | 60 | 0 / 1 | 0.0 % |
| 1070 | 1 | 120 | 553 | 3 | 550 | 484 | 484 | 0 | 158 | 0 | 0 | 0 | 0 | 326 | 0 / 0 | 0.0 % |
| 1071 | 1 | 132 | 77 | 3 | 74 | 477 | 477 | 0 | 143 | 0 | 0 | 0 | 0 | 334 | 0 / 0 | 0.0 % |
| 1072 | 1 | 461 | 440 | 3 | 437 | 245 | 245 | 0 | 104 | 0 | 0 | 0 | 0 | 141 | 0 / 1 | 0.0 % |
| 1073 | 1 | 122 | 474 | 3 | 471 | 487 | 487 | 0 | 190 | 0 | 0 | 0 | 0 | 297 | 0 / 0 | 0.0 % |
| 1074 | 1 | 131 | 66 | 3 | 63 | 490 | 490 | 0 | 157 | 0 | 0 | 0 | 0 | 333 | 0 / 0 | 0.0 % |
| 1075 | 1 | 873 | 500 | 3 | 497 | 191 | 191 | 0 | 82 | 0 | 0 | 0 | 0 | 109 | 0 / 0 | 0.0 % |
| 1076 | 1 | 111 | 199 | 3 | 196 | 490 | 490 | 0 | 164 | 0 | 0 | 0 | 0 | 326 | 0 / 0 | 0.0 % |
| 1077 | 1 | 100 | 137 | 3 | 134 | 494 | 494 | 0 | 162 | 0 | 0 | 0 | 0 | 332 | 0 / 0 | 0.0 % |
| 1078 | 1 | 284 | 81 | 3 | 78 | 444 | 444 | 0 | 130 | 0 | 0 | 0 | 0 | 314 | 0 / 0 | 0.0 % |
| 1079 | 1 | 747 | 94 | 3 | 91 | 167 | 167 | 0 | 82 | 0 | 0 | 0 | 0 | 85 | 0 / 0 | 0.0 % |
| 1080 | 1 | 453 | 166 | 3 | 163 | 349 | 349 | 0 | 139 | 0 | 0 | 0 | 0 | 210 | 0 / 0 | 0.0 % |
| 1081 | 1 | 214 | 162 | 3 | 159 | 455 | 455 | 0 | 151 | 0 | 0 | 0 | 0 | 304 | 0 / 0 | 0.0 % |

Lookup ms by result (p50 / p95, n): miss 0 / 1 (2423); other 0 / 0 (4246). Whole capture: hit 0, miss 2423, stale 0, invalid 0, error 0, timeout 0, other 4246.

| minute | lookups | hit | miss | stale | invalid | error | timeout | other |
|---|---|---|---|---|---|---|---|---|
| 19:56 | 789 | 0 | 354 | 0 | 0 | 0 | 0 | 435 |
| 19:57 | 1107 | 0 | 407 | 0 | 0 | 0 | 0 | 700 |
| 19:58 | 1206 | 0 | 405 | 0 | 0 | 0 | 0 | 801 |
| 19:59 | 3245 | 0 | 1168 | 0 | 0 | 0 | 0 | 2077 |
| 20:00 | 322 | 0 | 89 | 0 | 0 | 0 | 0 | 233 |

### Admin writes (`[liveWriter]`)

| route | saves | acquire ms p50 / p95 | exec ms p50 / p95 | ok=false | failed kinds |
|---|---|---|---|---|---|
| admin-insert-after | 5 | 3 / 3 | 158 / 175 | 0 | — |
| admin-update | 8 | 5 / 279 | 89 / 202 | 0 | — |
| admin-delete | 5 | 108 / 400 | 39 / 78 | 0 | — |

### Per minute

| minute | requests | distinct instances | builds | EMAXCONN |
|---|---|---|---|---|
| 19:56 | 2490 | 101 | 678 | 0 |
| 19:57 | 2753 | 50 | 1053 | 0 |
| 19:58 | 2752 | 48 | 1133 | 0 |
| 19:59 | 4819 | 78 | 1822 | 0 |
| 20:00 | 356 | 46 | 75 | 0 |

### Prisma pool totals per 5 s (app-side estimate of pooler clients)

Peak carried sum: **150** (carry 5 s). "reported" = instances that logged in the bucket (max total each); "carried" also counts an instance's last total for 5 s after its last line.

| bucket | reporting instances | Σ total (reported) | instances (carried) | Σ total (carried) | max waiting |
|---|---|---|---|---|---|
| 19:56:30 | 30 | 41 | 30 | 41 | 0 |
| 19:56:35 | 40 | 63 | 42 | 67 | 1 |
| 19:56:40 | 35 | 58 | 42 | 69 | 0 |
| 19:56:45 | 3 | 3 | 35 | 54 | 0 |
| 19:56:50 | 3 | 6 | 4 | 7 | 0 |
| 19:56:55 | 86 | 150 | 86 | 150 | 2 |
| 19:57:00 | 25 | 47 | 86 | 150 | 0 |
| 19:57:05 | 12 | 13 | 25 | 38 | 0 |
| 19:57:10 | 9 | 10 | 12 | 13 | 0 |
| 19:57:15 | 8 | 13 | 9 | 14 | 0 |
| 19:57:20 | 43 | 83 | 43 | 83 | 0 |
| 19:57:25 | 16 | 31 | 43 | 82 | 0 |
| 19:57:30 | 13 | 18 | 16 | 22 | 0 |
| 19:57:35 | 7 | 14 | 13 | 22 | 0 |
| 19:57:40 | 7 | 13 | 7 | 13 | 0 |
| 19:57:45 | 48 | 85 | 48 | 85 | 1 |
| 19:57:50 | 27 | 50 | 48 | 85 | 0 |
| 19:57:55 | 17 | 20 | 27 | 38 | 0 |
| 19:58:00 | 13 | 13 | 17 | 18 | 0 |
| 19:58:05 | 10 | 10 | 13 | 13 | 0 |
| 19:58:10 | 32 | 59 | 32 | 59 | 0 |
| 19:58:15 | 13 | 26 | 32 | 59 | 0 |
| 19:58:20 | 10 | 14 | 13 | 20 | 0 |
| 19:58:25 | 10 | 13 | 10 | 13 | 0 |
| 19:58:30 | 7 | 9 | 10 | 13 | 0 |
| 19:58:35 | 48 | 89 | 48 | 89 | 1 |
| 19:58:40 | 19 | 37 | 48 | 89 | 0 |
| 19:58:45 | 12 | 12 | 19 | 25 | 0 |
| 19:58:50 | 9 | 9 | 12 | 12 | 0 |
| 19:58:55 | 8 | 9 | 9 | 10 | 0 |
| 19:59:00 | 52 | 92 | 52 | 92 | 0 |
| 19:59:05 | 24 | 45 | 52 | 93 | 0 |
| 19:59:10 | 15 | 15 | 24 | 32 | 0 |
| 19:59:15 | 12 | 12 | 15 | 15 | 0 |
| 19:59:20 | 9 | 10 | 12 | 13 | 0 |
| 19:59:25 | 41 | 79 | 41 | 79 | 1 |
| 19:59:30 | 18 | 34 | 41 | 77 | 0 |
| 19:59:35 | 16 | 22 | 18 | 26 | 0 |
| 19:59:40 | 12 | 14 | 16 | 20 | 0 |
| 19:59:45 | 9 | 10 | 12 | 13 | 0 |
| 19:59:50 | 39 | 71 | 39 | 71 | 1 |
| 19:59:55 | 78 | 139 | 78 | 139 | 2 |
| 20:00:00 | 38 | 75 | 78 | 143 | 1 |

### Other lines

| kind | count |
|---|---|
| [liveWarm] fault | 93 |
| untagged: No logs found for opensetlist-projects/opensetlist | 4 |
