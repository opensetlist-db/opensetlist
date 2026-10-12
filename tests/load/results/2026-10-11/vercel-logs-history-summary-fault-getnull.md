## Vercel runtime logs — 2026-10-11T200032Z-vercel-logs-history-fault-getnull.txt

12787 entries; requests: /api/setlist 12140, other API 215, pages 432; error-level entries 0. Times: log clock +7 h.

### Builds per rev (`[liveSnapshot] build` lines: 4578)

| rev | builds | distinct instances | locales | build ms avg / max | first – last |
|---|---|---|---|---|---|
| 1082 | 1 | 1 | ko 1 | 466 / 466 | 20:01:06 – 20:01:06 |
| 1083 | 482 | 46 | ko 95, ja 320, en 67 | 203 / 940 | 20:01:09 – 20:01:33 |
| 1084 | 84 | 36 | en 11, ja 54, ko 19 | 201 / 552 | 20:01:33 – 20:01:34 |
| 1085 | 440 | 80 | ko 112, ja 255, en 73 | 313 / 1215 | 20:01:34 – 20:01:59 |
| 1086 | 302 | 32 | ko 74, ja 165, en 63 | 74 / 268 | 20:01:59 – 20:02:23 |
| 1087 | 62 | 14 | ko 20, en 12, ja 30 | 143 / 320 | 20:02:23 – 20:02:24 |
| 1088 | 491 | 38 | ja 297, en 73, ko 121 | 109 / 507 | 20:02:24 – 20:02:48 |
| 1089 | 398 | 36 | ja 226, en 68, ko 104 | 75 / 262 | 20:02:49 – 20:03:13 |
| 1090 | 30 | 11 | ja 19, ko 9, en 2 | 68 / 102 | 20:03:13 – 20:03:14 |
| 1091 | 542 | 50 | ja 337, en 78, ko 127 | 105 / 569 | 20:03:14 – 20:03:39 |
| 1092 | 438 | 42 | ja 269, ko 97, en 72 | 94 / 388 | 20:03:39 – 20:04:03 |
| 1093 | 35 | 10 | ja 18, en 9, ko 8 | 100 / 211 | 20:04:03 – 20:04:04 |
| 1094 | 434 | 34 | ko 112, ja 253, en 69 | 117 / 524 | 20:04:04 – 20:04:29 |
| 1095 | 195 | 40 | ko 48, ja 109, en 38 | 186 / 468 | 20:04:29 – 20:04:33 |
| 1096 | 80 | 31 | ja 41, en 18, ko 21 | 208 / 403 | 20:04:33 – 20:04:33 |
| 1097 | 82 | 41 | ko 27, ja 39, en 16 | 386 / 671 | 20:04:33 – 20:04:34 |
| 1098 | 146 | 50 | ja 69, ko 46, en 31 | 391 / 815 | 20:04:33 – 20:04:35 |
| 1099 | 168 | 53 | ja 84, ko 52, en 32 | 342 / 792 | 20:04:34 – 20:04:36 |
| 1100 | 168 | 53 | en 35, ko 51, ja 82 | 337 / 784 | 20:04:35 – 20:04:38 |

### Failures, repair reads, coalescing

| what | count | detail |
|---|---|---|
| EMAXCONN (pooler client cap) | 0 | API 0, SSR 0 |
| `[liveSnapshot] build-failed` | 0 | — |
| `[liveSnapshot] rev-read` (repair revision read) | 0 | rev=timeout 0, rev=error 0; ms p50 — / max —; by hint: — |
| `[liveSnapshot] coalesced` | 1378 | waiters sum 5443, max 17 |
| `[setlist] slow-hit` | 0 | max — ms |

### Hint outcomes (`[setlist] hint-fetch` lines: 6304)

Whole capture: satisfied 6304, fresh 0, memo 0, deferred 0, none 0, error 0, other 0. "other" = a `verify=` value this script does not know.

| minute | hint fetches | satisfied | fresh | memo | deferred | none | error | other |
|---|---|---|---|---|---|---|---|---|
| 20:01 | 676 | 676 | 0 | 0 | 0 | 0 | 0 | 0 |
| 20:02 | 1609 | 1609 | 0 | 0 | 0 | 0 | 0 | 0 |
| 20:03 | 1026 | 1026 | 0 | 0 | 0 | 0 | 0 | 0 |
| 20:04 | 2993 | 2993 | 0 | 0 | 0 | 0 | 0 | 0 |

### Warming (`[liveWarm]` jobs: 18; `[setlist] warm-lookup` lines: 6304)

**warm hit rate = hits ÷ hinted fetches = 0 / 6304 = 0.0 %** (hinted fetches = `[setlist] hint-fetch` lines with a numeric minRev; lookups 6304).

schedule-failed 0; job-failed 0; set ok=false 0 (set-error lines 0); skips 0; lookup-error lines 0; warm builds matched 54.

Warm jobs. start → done = the job's own `done ms=` (it starts in `after()`, i.e. right after the save's response, so it is ≈ warm-complete − commit). Per locale: actual rev, bytes, build / set ms, ok.

| save rev | instance | start (log clock) | start → done ms | sets | skips | warm builds (unmatched) | job-failed |
|---|---|---|---|---|---|---|---|
| 1083 | 41c3b43b | 20:01:09 | 136 | ko r1083 80830 B 59/19 ms; ja r1083 67230 B 88/10 ms; en r1083 79463 B 49/7 ms | — | 3 | — |
| 1084 | 67fbed81 | 20:01:33 | 123 | ko r1084 102444 B 59/10 ms; ja r1084 85188 B 86/6 ms; en r1084 100630 B 45/8 ms | — | 3 | — |
| 1085 | ea02cb44 | 20:01:34 | 888 | ko r1085 81564 B 568/9 ms; ja r1085 67837 B 686/6 ms; en r1085 80188 B 303/7 ms | — | 3 | — |
| 1086 | 9130cfe0 | 20:01:59 | 129 | ko r1086 60586 B 61/6 ms; ja r1086 50466 B 88/5 ms; en r1086 59657 B 55/6 ms | — | 3 | — |
| 1087 | 516c5695 | 20:02:23 | 112 | ko r1087 82200 B 48/8 ms; ja r1087 68424 B 91/12 ms; en r1087 80824 B 44/12 ms | — | 3 | — |
| 1088 | 5b17487f | 20:02:24 | 576 | ko r1088 61232 B 248/6 ms; ja r1088 51050 B 323/8 ms; en r1088 60297 B 316/6 ms | — | 3 | — |
| 1089 | 94a9fc47 | 20:02:49 | 100 | ko r1089 61267 B 46/12 ms; ja r1089 51069 B 53/18 ms; en r1089 60326 B 34/7 ms | — | 3 | — |
| 1090 | a8a308ff | 20:03:13 | 160 | ko r1090 82881 B 59/9 ms; ja r1090 69027 B 85/8 ms; en r1090 81493 B 74/6 ms | — | 3 | — |
| 1091 | 663d93cf | 20:03:14 | 250 | ja r1091 51656 B 121/5 ms; ko r1091 61913 B 130/5 ms; en r1091 60971 B 103/21 ms | — | 3 | — |
| 1092 | 4547a4c9 | 20:03:39 | 107 | ko r1092 62718 B 53/8 ms; ja r1092 52200 B 70/6 ms; en r1092 61747 B 39/7 ms | — | 3 | — |
| 1093 | a8a308ff | 20:04:03 | 96 | ko r1093 84332 B 42/9 ms; ja r1093 70158 B 48/8 ms; en r1093 82914 B 38/7 ms | — | 3 | — |
| 1094 | d6726cb4 | 20:04:04 | 297 | ja r1094 54879 B 97/5 ms; ko r1094 66310 B 113/7 ms; en r1094 65226 B 189/5 ms | — | 3 | — |
| 1095 | 1c211a24 | 20:04:29 | 104 | ko r1095 66579 B 50/8 ms; ja r1095 55058 B 66/5 ms; en r1095 65481 B 39/6 ms | — | 3 | — |
| 1096 | 266ed554 | 20:04:33 | 110 | ja r1096 52380 B 49/7 ms; ko r1096 62988 B 54/7 ms; en r1096 62003 B 46/6 ms | — | 3 | — |
| 1097 | af125b19 | 20:04:33 | 1058 | ko r1097 62343 B 524/11 ms; ja r1097 51794 B 538/8 ms; en r1098 60720 B 516/7 ms | — | 3 | — |
| 1098 | f691a8e8 | 20:04:34 | 605 | ko r1098 61698 B 135/21 ms; ja r1098 51211 B 140/16 ms; en r1098 60720 B 442/6 ms | — | 3 | — |
| 1099 | ac1d0b30 | 20:04:34 | 199 | ja r1099 50605 B 126/8 ms; ko r1099 60965 B 137/6 ms; en r1099 59996 B 59/6 ms | — | 3 | — |
| 1100 | d4f1219e | 20:04:35 | 149 | ko r1100 59221 B 96/8 ms; ja r1100 49277 B 101/8 ms; en r1100 58301 B 36/7 ms | — | 3 | — |

Per save rev. builds = every `[liveSnapshot] build` at that rev; warm = the ones matched to a warm job (same instance, locale, rev); reader = the rest. Lookups and hinted fetches are keyed by their `minRev`.

| save rev | warm jobs | start → done ms | builds | warm | reader | hinted fetches | lookups | hit | miss | stale | invalid | error | timeout | other | lookup ms p50 / p95 | hit rate |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1083 | 1 | 136 | 482 | 3 | 479 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — / — | — |
| 1084 | 1 | 123 | 84 | 3 | 81 | 480 | 480 | 0 | 273 | 0 | 0 | 0 | 0 | 207 | 5 / 55 | 0.0 % |
| 1085 | 1 | 888 | 440 | 3 | 437 | 175 | 175 | 0 | 104 | 0 | 0 | 0 | 1 | 70 | 3 / 40 | 0.0 % |
| 1086 | 1 | 129 | 302 | 3 | 299 | 487 | 487 | 0 | 181 | 0 | 0 | 0 | 0 | 306 | 0 / 15 | 0.0 % |
| 1087 | 1 | 112 | 62 | 3 | 59 | 495 | 495 | 0 | 175 | 0 | 0 | 0 | 0 | 320 | 0 / 15 | 0.0 % |
| 1088 | 1 | 576 | 491 | 3 | 488 | 158 | 158 | 0 | 70 | 0 | 0 | 0 | 0 | 88 | 0 / 8 | 0.0 % |
| 1089 | 1 | 100 | 398 | 3 | 395 | 490 | 490 | 0 | 183 | 0 | 0 | 0 | 0 | 307 | 0 / 13 | 0.0 % |
| 1090 | 1 | 160 | 30 | 3 | 27 | 421 | 421 | 0 | 200 | 0 | 0 | 0 | 0 | 221 | 0 / 17 | 0.0 % |
| 1091 | 1 | 250 | 542 | 3 | 539 | 120 | 120 | 0 | 80 | 0 | 0 | 0 | 0 | 40 | 4 / 7 | 0.0 % |
| 1092 | 1 | 107 | 438 | 3 | 435 | 485 | 485 | 0 | 183 | 0 | 0 | 0 | 0 | 302 | 0 / 13 | 0.0 % |
| 1093 | 1 | 96 | 35 | 3 | 32 | 454 | 454 | 0 | 154 | 0 | 0 | 0 | 0 | 300 | 0 / 16 | 0.0 % |
| 1094 | 1 | 297 | 434 | 3 | 431 | 113 | 113 | 0 | 62 | 0 | 0 | 0 | 0 | 51 | 4 / 12 | 0.0 % |
| 1095 | 1 | 104 | 195 | 3 | 192 | 489 | 489 | 0 | 172 | 0 | 0 | 0 | 0 | 317 | 0 / 13 | 0.0 % |
| 1096 | 1 | 110 | 80 | 3 | 77 | 491 | 491 | 0 | 142 | 0 | 0 | 0 | 0 | 349 | 0 / 6 | 0.0 % |
| 1097 | 1 | 1058 | 82 | 2 | 80 | 243 | 243 | 0 | 96 | 0 | 0 | 0 | 0 | 147 | 0 / 10 | 0.0 % |
| 1098 | 1 | 605 | 146 | 4 | 142 | 260 | 260 | 0 | 109 | 0 | 0 | 0 | 0 | 151 | 0 / 7 | 0.0 % |
| 1099 | 1 | 199 | 168 | 3 | 165 | 471 | 471 | 0 | 166 | 0 | 0 | 0 | 0 | 305 | 0 / 6 | 0.0 % |
| 1100 | 1 | 149 | 168 | 3 | 165 | 472 | 472 | 0 | 155 | 0 | 0 | 0 | 0 | 317 | 0 / 6 | 0.0 % |

Lookup ms by result (p50 / p95, n): miss 6 / 29 (2505); timeout 316 / 316 (1); other 0 / 0 (3798). Whole capture: hit 0, miss 2505, stale 0, invalid 0, error 0, timeout 1, other 3798.

| minute | lookups | hit | miss | stale | invalid | error | timeout | other |
|---|---|---|---|---|---|---|---|---|
| 20:01 | 676 | 0 | 388 | 0 | 0 | 0 | 1 | 287 |
| 20:02 | 1609 | 0 | 598 | 0 | 0 | 0 | 0 | 1011 |
| 20:03 | 1026 | 0 | 463 | 0 | 0 | 0 | 0 | 563 |
| 20:04 | 2993 | 0 | 1056 | 0 | 0 | 0 | 0 | 1937 |

### Admin writes (`[liveWriter]`)

| route | saves | acquire ms p50 / p95 | exec ms p50 / p95 | ok=false | failed kinds |
|---|---|---|---|---|---|
| admin-insert-after | 5 | 3 / 5 | 211 / 240 | 0 | — |
| admin-update | 8 | 4 / 205 | 82 / 139 | 0 | — |
| admin-delete | 5 | 48 / 597 | 30 / 37 | 0 | — |

### Per minute

| minute | requests | distinct instances | builds | EMAXCONN |
|---|---|---|---|---|
| 20:01 | 2976 | 88 | 1026 | 0 |
| 20:02 | 3259 | 42 | 1127 | 0 |
| 20:03 | 2571 | 52 | 1084 | 0 |
| 20:04 | 3981 | 55 | 1341 | 0 |

### Prisma pool totals per 5 s (app-side estimate of pooler clients)

Peak carried sum: **146** (carry 5 s). "reported" = instances that logged in the bucket (max total each); "carried" also counts an instance's last total for 5 s after its last line.

| bucket | reporting instances | Σ total (reported) | instances (carried) | Σ total (carried) | max waiting |
|---|---|---|---|---|---|
| 20:01:05 | 1 | 2 | 1 | 2 | 0 |
| 20:01:10 | 45 | 69 | 45 | 69 | 0 |
| 20:01:15 | 44 | 79 | 46 | 83 | 6 |
| 20:01:20 | 10 | 17 | 44 | 75 | 0 |
| 20:01:25 | 3 | 4 | 10 | 16 | 0 |
| 20:01:30 | 40 | 71 | 40 | 71 | 2 |
| 20:01:35 | 78 | 140 | 81 | 146 | 0 |
| 20:01:40 | 14 | 22 | 78 | 135 | 0 |
| 20:01:45 | 9 | 10 | 14 | 19 | 0 |
| 20:01:50 | 7 | 12 | 9 | 14 | 0 |
| 20:01:55 | 7 | 14 | 7 | 14 | 0 |
| 20:02:00 | 32 | 56 | 32 | 56 | 0 |
| 20:02:05 | 12 | 14 | 32 | 48 | 0 |
| 20:02:10 | 9 | 12 | 12 | 15 | 0 |
| 20:02:15 | 8 | 11 | 9 | 13 | 0 |
| 20:02:20 | 21 | 41 | 21 | 41 | 1 |
| 20:02:25 | 38 | 71 | 38 | 71 | 0 |
| 20:02:30 | 14 | 18 | 38 | 61 | 0 |
| 20:02:35 | 12 | 15 | 14 | 17 | 0 |
| 20:02:40 | 10 | 12 | 12 | 14 | 0 |
| 20:02:45 | 8 | 13 | 10 | 16 | 0 |
| 20:02:50 | 36 | 63 | 36 | 63 | 0 |
| 20:02:55 | 18 | 29 | 36 | 56 | 0 |
| 20:03:00 | 12 | 14 | 18 | 23 | 0 |
| 20:03:05 | 7 | 8 | 12 | 14 | 0 |
| 20:03:10 | 19 | 36 | 19 | 36 | 1 |
| 20:03:15 | 50 | 79 | 50 | 79 | 0 |
| 20:03:20 | 23 | 34 | 50 | 70 | 0 |
| 20:03:25 | 17 | 21 | 23 | 28 | 0 |
| 20:03:30 | 12 | 13 | 17 | 19 | 0 |
| 20:03:35 | 11 | 19 | 12 | 20 | 1 |
| 20:03:40 | 42 | 72 | 42 | 72 | 0 |
| 20:03:45 | 14 | 22 | 42 | 67 | 0 |
| 20:03:50 | 13 | 17 | 14 | 18 | 0 |
| 20:03:55 | 7 | 11 | 13 | 17 | 0 |
| 20:04:00 | 34 | 65 | 34 | 65 | 1 |
| 20:04:05 | 28 | 55 | 34 | 65 | 0 |
| 20:04:10 | 16 | 22 | 29 | 47 | 0 |
| 20:04:15 | 15 | 20 | 16 | 22 | 0 |
| 20:04:20 | 10 | 13 | 15 | 18 | 0 |
| 20:04:25 | 9 | 16 | 10 | 17 | 0 |
| 20:04:30 | 54 | 107 | 54 | 107 | 1 |
| 20:04:35 | 55 | 110 | 55 | 110 | 1 |

### Other lines

| kind | count |
|---|---|
| [liveWarm] fault | 82 |
| untagged: No logs found for opensetlist-projects/opensetlist | 4 |
