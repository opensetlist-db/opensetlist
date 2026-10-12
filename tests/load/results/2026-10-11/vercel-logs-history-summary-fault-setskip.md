## Vercel runtime logs — 2026-10-11T201844Z-vercel-logs-history-fault-setskip.txt

13139 entries; requests: /api/setlist 12487, other API 220, pages 432; error-level entries 0. Times: log clock +7 h.

### Builds per rev (`[liveSnapshot] build` lines: 4597)

| rev | builds | distinct instances | locales | build ms avg / max | first – last |
|---|---|---|---|---|---|
| 1158 | 1 | 1 | ko 1 | 476 / 476 | 20:19:17 – 20:19:17 |
| 1159 | 468 | 49 | ko 108, ja 306, en 54 | 171 / 755 | 20:19:21 – 20:19:46 |
| 1160 | 80 | 26 | ja 38, en 18, ko 24 | 164 / 368 | 20:19:46 – 20:19:47 |
| 1161 | 402 | 46 | en 63, ja 247, ko 92 | 182 / 958 | 20:19:47 – 20:20:12 |
| 1162 | 376 | 39 | ja 208, ko 110, en 58 | 95 / 425 | 20:20:12 – 20:20:36 |
| 1163 | 43 | 17 | ja 23, en 8, ko 12 | 106 / 256 | 20:20:36 – 20:20:37 |
| 1164 | 464 | 72 | ja 277, en 69, ko 118 | 155 / 709 | 20:20:36 – 20:21:01 |
| 1165 | 432 | 39 | ja 258, ko 107, en 67 | 94 / 353 | 20:21:02 – 20:21:25 |
| 1166 | 73 | 20 | ja 36, ko 25, en 12 | 162 / 310 | 20:21:26 – 20:21:27 |
| 1167 | 499 | 38 | ja 308, ko 112, en 79 | 126 / 562 | 20:21:26 – 20:21:52 |
| 1168 | 382 | 45 | ja 213, ko 103, en 66 | 112 / 415 | 20:21:52 – 20:22:16 |
| 1169 | 58 | 16 | ja 33, ko 15, en 10 | 121 / 210 | 20:22:16 – 20:22:17 |
| 1170 | 514 | 46 | ja 313, ko 125, en 76 | 139 / 664 | 20:22:17 – 20:22:42 |
| 1171 | 184 | 41 | en 37, ja 91, ko 56 | 228 / 472 | 20:22:42 – 20:22:44 |
| 1172 | 71 | 25 | ko 22, en 13, ja 36 | 174 / 364 | 20:22:44 – 20:22:45 |
| 1173 | 84 | 36 | ja 34, en 25, ko 25 | 374 / 674 | 20:22:45 – 20:22:46 |
| 1174 | 143 | 53 | ko 37, en 35, ja 71 | 343 / 727 | 20:22:45 – 20:22:46 |
| 1175 | 168 | 51 | ja 80, ko 51, en 37 | 331 / 724 | 20:22:46 – 20:22:48 |
| 1176 | 155 | 41 | ko 47, en 33, ja 75 | 288 / 663 | 20:22:47 – 20:22:49 |

### Failures, repair reads, coalescing

| what | count | detail |
|---|---|---|
| EMAXCONN (pooler client cap) | 0 | API 0, SSR 0 |
| `[liveSnapshot] build-failed` | 0 | — |
| `[liveSnapshot] rev-read` (repair revision read) | 0 | rev=timeout 0, rev=error 0; ms p50 — / max —; by hint: — |
| `[liveSnapshot] coalesced` | 1457 | waiters sum 6036, max 15 |
| `[setlist] slow-hit` | 0 | max — ms |

### Hint outcomes (`[setlist] hint-fetch` lines: 6648)

Whole capture: satisfied 6648, fresh 0, memo 0, deferred 0, none 0, error 0, other 0. "other" = a `verify=` value this script does not know.

| minute | hint fetches | satisfied | fresh | memo | deferred | none | error | other |
|---|---|---|---|---|---|---|---|---|
| 20:19 | 711 | 711 | 0 | 0 | 0 | 0 | 0 | 0 |
| 20:20 | 1125 | 1125 | 0 | 0 | 0 | 0 | 0 | 0 |
| 20:21 | 1730 | 1730 | 0 | 0 | 0 | 0 | 0 | 0 |
| 20:22 | 3082 | 3082 | 0 | 0 | 0 | 0 | 0 | 0 |

### Warming (`[liveWarm]` jobs: 18; `[setlist] warm-lookup` lines: 6648)

**warm hit rate = hits ÷ hinted fetches = 0 / 6648 = 0.0 %** (hinted fetches = `[setlist] hint-fetch` lines with a numeric minRev; lookups 6648).

schedule-failed 0; job-failed 0; set ok=false 0 (set-error lines 0); skips 0; lookup-error lines 0; warm builds matched 54.

Warm jobs. start → done = the job's own `done ms=` (it starts in `after()`, i.e. right after the save's response, so it is ≈ warm-complete − commit). Per locale: actual rev, bytes, build / set ms, ok.

| save rev | instance | start (log clock) | start → done ms | sets | skips | warm builds (unmatched) | job-failed |
|---|---|---|---|---|---|---|---|
| 1159 | aaed66e9 | 20:19:21 | 114 | ko r1159 80830 B 49/0 ms; ja r1159 67230 B 75/0 ms; en r1159 79463 B 54/0 ms | — | 3 | — |
| 1160 | ceabb3a1 | 20:19:46 | 140 | ja r1160 85188 B 53/0 ms; ko r1160 102444 B 69/0 ms; en r1160 100630 B 74/0 ms | — | 3 | — |
| 1161 | 1c633af5 | 20:19:47 | 1095 | ja r1161 67874 B 286/0 ms; ko r1161 81586 B 290/0 ms; en r1161 80216 B 808/0 ms | — | 3 | — |
| 1162 | d55e2ace | 20:20:12 | 79 | ja r1162 50518 B 45/0 ms; ko r1162 60700 B 52/0 ms; en r1162 59758 B 32/0 ms | — | 3 | — |
| 1163 | b5471deb | 20:20:36 | 98 | ko r1163 82314 B 51/0 ms; ja r1163 68476 B 59/0 ms; en r1163 80925 B 47/0 ms | — | 3 | — |
| 1164 | c2ec65ad | 20:20:36 | 435 | ja r1164 51166 B 154/0 ms; ko r1164 61493 B 170/0 ms; en r1164 60534 B 280/0 ms | — | 3 | — |
| 1165 | 50e2ca7c | 20:21:02 | 94 | ja r1165 51176 B 57/0 ms; ko r1165 61445 B 60/0 ms; en r1165 60496 B 37/0 ms | — | 3 | — |
| 1166 | 118c31a7 | 20:21:26 | 129 | ja r1166 69134 B 45/0 ms; ko r1166 83059 B 52/0 ms; en r1166 81663 B 69/0 ms | — | 3 | — |
| 1167 | ceabb3a1 | 20:21:26 | 336 | ko r1167 62190 B 113/0 ms; ja r1167 51799 B 128/0 ms; en r1167 61235 B 223/0 ms | — | 3 | — |
| 1168 | e1657b2f | 20:21:52 | 98 | ko r1168 62268 B 49/0 ms; ja r1168 51814 B 56/0 ms; en r1168 61305 B 48/0 ms | — | 3 | — |
| 1169 | f94998bc | 20:22:16 | 96 | ko r1169 83882 B 51/0 ms; ja r1169 69772 B 70/0 ms; en r1169 82472 B 44/0 ms | — | 3 | — |
| 1170 | aaed66e9 | 20:22:17 | 582 | ko r1170 63060 B 228/0 ms; ja r1170 52468 B 340/0 ms; en r1170 62086 B 354/0 ms | — | 3 | — |
| 1171 | 46ec40b0 | 20:22:42 | 90 | ko r1171 63100 B 50/0 ms; ja r1171 52498 B 58/0 ms; en r1171 62134 B 40/0 ms | — | 3 | — |
| 1172 | aaed66e9 | 20:22:44 | 75 | ja r1172 51845 B 37/0 ms; ko r1172 62309 B 43/0 ms; en r1172 61354 B 37/0 ms | — | 3 | — |
| 1173 | 5e6516ca | 20:22:45 | 616 | ko r1173 61565 B 357/0 ms; ja r1173 51223 B 465/0 ms; en r1173 60616 B 258/0 ms | — | 3 | — |
| 1174 | e1657b2f | 20:22:45 | 413 | ko r1174 60773 B 128/0 ms; ja r1174 50576 B 136/0 ms; en r1174 59841 B 283/0 ms | — | 3 | — |
| 1175 | 7e4abd71 | 20:22:46 | 189 | ko r1175 60018 B 143/0 ms; ja r1175 49933 B 149/0 ms; en r1175 59089 B 45/0 ms | — | 3 | — |
| 1176 | 0a861db2 | 20:22:47 | 129 | ko r1176 59221 B 84/0 ms; ja r1176 49277 B 118/0 ms; en r1176 58301 B 43/0 ms | — | 3 | — |

Per save rev. builds = every `[liveSnapshot] build` at that rev; warm = the ones matched to a warm job (same instance, locale, rev); reader = the rest. Lookups and hinted fetches are keyed by their `minRev`.

| save rev | warm jobs | start → done ms | builds | warm | reader | hinted fetches | lookups | hit | miss | stale | invalid | error | timeout | other | lookup ms p50 / p95 | hit rate |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1159 | 1 | 114 | 468 | 3 | 465 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — / — | — |
| 1160 | 1 | 140 | 80 | 3 | 77 | 476 | 476 | 0 | 187 | 0 | 0 | 0 | 0 | 289 | 0 / 24 | 0.0 % |
| 1161 | 1 | 1095 | 402 | 3 | 399 | 235 | 235 | 0 | 92 | 0 | 0 | 0 | 0 | 143 | 0 / 5 | 0.0 % |
| 1162 | 1 | 79 | 376 | 3 | 373 | 493 | 493 | 0 | 172 | 0 | 0 | 0 | 0 | 321 | 0 / 12 | 0.0 % |
| 1163 | 1 | 98 | 43 | 3 | 40 | 493 | 493 | 0 | 162 | 0 | 0 | 0 | 0 | 331 | 0 / 12 | 0.0 % |
| 1164 | 1 | 435 | 464 | 3 | 461 | 139 | 139 | 0 | 83 | 0 | 0 | 0 | 0 | 56 | 3 / 40 | 0.0 % |
| 1165 | 1 | 94 | 432 | 3 | 429 | 494 | 494 | 0 | 176 | 0 | 0 | 0 | 0 | 318 | 0 / 11 | 0.0 % |
| 1166 | 1 | 129 | 73 | 3 | 70 | 489 | 489 | 0 | 169 | 0 | 0 | 0 | 0 | 320 | 0 / 11 | 0.0 % |
| 1167 | 1 | 336 | 499 | 3 | 496 | 258 | 258 | 0 | 97 | 0 | 0 | 0 | 0 | 161 | 0 / 5 | 0.0 % |
| 1168 | 1 | 98 | 382 | 3 | 379 | 489 | 489 | 0 | 167 | 0 | 0 | 0 | 0 | 322 | 0 / 12 | 0.0 % |
| 1169 | 1 | 96 | 58 | 3 | 55 | 492 | 492 | 0 | 156 | 0 | 0 | 0 | 0 | 336 | 0 / 11 | 0.0 % |
| 1170 | 1 | 582 | 514 | 3 | 511 | 182 | 182 | 0 | 83 | 0 | 0 | 0 | 0 | 99 | 0 / 5 | 0.0 % |
| 1171 | 1 | 90 | 184 | 3 | 181 | 487 | 487 | 0 | 176 | 0 | 0 | 0 | 0 | 311 | 0 / 9 | 0.0 % |
| 1172 | 1 | 75 | 71 | 3 | 68 | 485 | 485 | 0 | 138 | 0 | 0 | 0 | 0 | 347 | 0 / 4 | 0.0 % |
| 1173 | 1 | 616 | 84 | 3 | 81 | 208 | 208 | 0 | 70 | 0 | 0 | 0 | 0 | 138 | 0 / 4 | 0.0 % |
| 1174 | 1 | 413 | 143 | 3 | 140 | 285 | 285 | 0 | 108 | 0 | 0 | 0 | 0 | 177 | 0 / 8 | 0.0 % |
| 1175 | 1 | 189 | 168 | 3 | 165 | 463 | 463 | 0 | 146 | 0 | 0 | 0 | 0 | 317 | 0 / 4 | 0.0 % |
| 1176 | 1 | 129 | 155 | 3 | 152 | 480 | 480 | 0 | 139 | 0 | 0 | 0 | 0 | 341 | 0 / 4 | 0.0 % |

Lookup ms by result (p50 / p95, n): miss 4 / 24 (2321); other 0 / 0 (4327). Whole capture: hit 0, miss 2321, stale 0, invalid 0, error 0, timeout 0, other 4327.

| minute | lookups | hit | miss | stale | invalid | error | timeout | other |
|---|---|---|---|---|---|---|---|---|
| 20:19 | 711 | 0 | 279 | 0 | 0 | 0 | 0 | 432 |
| 20:20 | 1125 | 0 | 417 | 0 | 0 | 0 | 0 | 708 |
| 20:21 | 1730 | 0 | 609 | 0 | 0 | 0 | 0 | 1121 |
| 20:22 | 3082 | 0 | 1016 | 0 | 0 | 0 | 0 | 2066 |

### Admin writes (`[liveWriter]`)

| route | saves | acquire ms p50 / p95 | exec ms p50 / p95 | ok=false | failed kinds |
|---|---|---|---|---|---|
| admin-insert-after | 5 | 3 / 6 | 193 / 227 | 0 | — |
| admin-update | 8 | 5 / 109 | 79 / 135 | 0 | — |
| admin-delete | 5 | 145 / 386 | 35 / 44 | 0 | — |

### Per minute

| minute | requests | distinct instances | builds | EMAXCONN |
|---|---|---|---|---|
| 20:19 | 2593 | 55 | 814 | 0 |
| 20:20 | 2841 | 72 | 1007 | 0 |
| 20:21 | 3301 | 51 | 1258 | 0 |
| 20:22 | 4404 | 54 | 1518 | 0 |

### Prisma pool totals per 5 s (app-side estimate of pooler clients)

Peak carried sum: **115** (carry 5 s). "reported" = instances that logged in the bucket (max total each); "carried" also counts an instance's last total for 5 s after its last line.

| bucket | reporting instances | Σ total (reported) | instances (carried) | Σ total (carried) | max waiting |
|---|---|---|---|---|---|
| 20:19:15 | 1 | 1 | 1 | 1 | 0 |
| 20:19:20 | 46 | 59 | 46 | 59 | 0 |
| 20:19:25 | 47 | 74 | 47 | 74 | 3 |
| 20:19:30 | 38 | 56 | 49 | 74 | 1 |
| 20:19:35 | 7 | 8 | 38 | 55 | 0 |
| 20:19:40 | 5 | 9 | 7 | 11 | 1 |
| 20:19:45 | 46 | 87 | 46 | 87 | 1 |
| 20:19:50 | 23 | 44 | 46 | 87 | 0 |
| 20:19:55 | 10 | 11 | 23 | 34 | 0 |
| 20:20:00 | 6 | 11 | 10 | 15 | 0 |
| 20:20:05 | 5 | 9 | 6 | 11 | 0 |
| 20:20:10 | 39 | 67 | 39 | 67 | 0 |
| 20:20:15 | 13 | 26 | 39 | 67 | 0 |
| 20:20:20 | 11 | 13 | 13 | 17 | 0 |
| 20:20:25 | 8 | 11 | 11 | 14 | 0 |
| 20:20:30 | 7 | 9 | 8 | 10 | 0 |
| 20:20:35 | 72 | 115 | 72 | 115 | 1 |
| 20:20:40 | 23 | 43 | 72 | 114 | 0 |
| 20:20:45 | 20 | 22 | 23 | 26 | 0 |
| 20:20:50 | 16 | 17 | 20 | 22 | 0 |
| 20:20:55 | 9 | 9 | 16 | 16 | 0 |
| 20:21:00 | 39 | 67 | 39 | 67 | 0 |
| 20:21:05 | 21 | 41 | 39 | 67 | 0 |
| 20:21:10 | 20 | 24 | 21 | 26 | 0 |
| 20:21:15 | 13 | 14 | 20 | 23 | 0 |
| 20:21:20 | 8 | 9 | 13 | 14 | 0 |
| 20:21:25 | 38 | 75 | 38 | 75 | 1 |
| 20:21:30 | 17 | 34 | 38 | 75 | 0 |
| 20:21:35 | 10 | 13 | 17 | 24 | 0 |
| 20:21:40 | 5 | 9 | 10 | 14 | 0 |
| 20:21:45 | 5 | 9 | 5 | 9 | 0 |
| 20:21:50 | 45 | 76 | 45 | 76 | 0 |
| 20:21:55 | 17 | 32 | 45 | 75 | 0 |
| 20:22:00 | 12 | 13 | 17 | 20 | 0 |
| 20:22:05 | 10 | 11 | 12 | 13 | 0 |
| 20:22:10 | 9 | 9 | 10 | 10 | 0 |
| 20:22:15 | 46 | 88 | 46 | 88 | 2 |
| 20:22:20 | 20 | 40 | 46 | 88 | 0 |
| 20:22:25 | 15 | 19 | 20 | 28 | 0 |
| 20:22:30 | 9 | 10 | 15 | 18 | 0 |
| 20:22:35 | 6 | 7 | 9 | 10 | 0 |
| 20:22:40 | 41 | 75 | 41 | 75 | 0 |
| 20:22:45 | 54 | 106 | 54 | 106 | 1 |

### Other lines

| kind | count |
|---|---|
| [liveWarm] fault | 72 |
| untagged: No logs found for opensetlist-projects/opensetlist | 4 |
