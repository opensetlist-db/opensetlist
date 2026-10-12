## Vercel runtime logs — 2026-10-11T210558Z-vercel-logs-history-fault-locale-ja-2.txt

12923 entries; requests: /api/setlist 12273, other API 218, pages 432; error-level entries 2. Times: log clock +7 h.

### Builds per rev (`[liveSnapshot] build` lines: 3760)

| rev | builds | distinct instances | locales | build ms avg / max | first – last |
|---|---|---|---|---|---|
| 1253 | 1 | 1 | ko 1 | 502 / 502 | 21:06:33 – 21:06:33 |
| 1254 | 424 | 48 | ko 110, en 49, ja 265 | 204 / 940 | 21:06:37 – 21:07:02 |
| 1255 | 55 | 22 | ja 51, en 2, ko 2 | 92 / 198 | 21:07:01 – 21:07:03 |
| 1256 | 429 | 62 | ko 83, ja 305, en 41 | 125 / 874 | 21:07:02 – 21:07:28 |
| 1257 | 420 | 38 | ko 50, ja 337, en 33 | 56 / 159 | 21:07:27 – 21:07:52 |
| 1258 | 36 | 22 | ja 32, ko 2, en 2 | 103 / 210 | 21:07:51 – 21:07:52 |
| 1259 | 331 | 53 | ja 248, en 29, ko 54 | 68 / 197 | 21:07:52 – 21:08:18 |
| 1260 | 369 | 37 | ko 65, en 38, ja 266 | 62 / 196 | 21:08:17 – 21:08:42 |
| 1261 | 74 | 30 | ja 71, ko 2, en 1 | 81 / 198 | 21:08:41 – 21:08:43 |
| 1262 | 370 | 44 | en 30, ko 68, ja 272 | 75 / 222 | 21:08:42 – 21:09:07 |
| 1263 | 305 | 40 | ja 239, en 27, ko 39 | 65 / 201 | 21:09:07 – 21:09:32 |
| 1264 | 57 | 17 | ja 54, en 2, ko 1 | 69 / 115 | 21:09:31 – 21:09:32 |
| 1265 | 388 | 48 | ja 283, en 36, ko 69 | 71 / 226 | 21:09:32 – 21:09:58 |
| 1266 | 154 | 41 | en 3, ko 10, ja 141 | 86 / 177 | 21:09:57 – 21:10:00 |
| 1267 | 42 | 23 | ja 38, ko 3, en 1 | 88 / 131 | 21:10:00 – 21:10:01 |
| 1268 | 70 | 38 | ja 59, en 8, ko 3 | 142 / 254 | 21:10:00 – 21:10:01 |
| 1269 | 11 | 9 | ja 9, en 1, ko 1 | 80 / 151 | 21:10:01 – 21:10:01 |
| 1270 | 95 | 56 | ja 84, ko 8, en 3 | 191 / 285 | 21:10:01 – 21:10:02 |
| 1271 | 129 | 58 | ko 10, ja 115, en 4 | 138 / 303 | 21:10:02 – 21:10:04 |

### Failures, repair reads, coalescing

| what | count | detail |
|---|---|---|
| EMAXCONN (pooler client cap) | 0 | API 0, SSR 0 |
| `[liveSnapshot] build-failed` | 0 | — |
| `[liveSnapshot] rev-read` (repair revision read) | 0 | rev=timeout 0, rev=error 0; ms p50 — / max —; by hint: — |
| `[liveSnapshot] coalesced` | 1192 | waiters sum 4335, max 13 |
| `[setlist] slow-hit` | 0 | max — ms |

### Hint outcomes (`[setlist] hint-fetch` lines: 6508)

Whole capture: satisfied 6508, fresh 0, memo 0, deferred 0, none 0, error 0, other 0. "other" = a `verify=` value this script does not know.

| minute | hint fetches | satisfied | fresh | memo | deferred | none | error | other |
|---|---|---|---|---|---|---|---|---|
| 21:07 | 2001 | 2001 | 0 | 0 | 0 | 0 | 0 | 0 |
| 21:08 | 1295 | 1295 | 0 | 0 | 0 | 0 | 0 | 0 |
| 21:09 | 1775 | 1775 | 0 | 0 | 0 | 0 | 0 | 0 |
| 21:10 | 1437 | 1437 | 0 | 0 | 0 | 0 | 0 | 0 |

### Warming (`[liveWarm]` jobs: 18; `[setlist] warm-lookup` lines: 6508)

**warm hit rate = hits ÷ hinted fetches = 2149 / 6508 = 33.0 %** (hinted fetches = `[setlist] hint-fetch` lines with a numeric minRev; lookups 6508).

schedule-failed 0; job-failed 0; set ok=false 0 (set-error lines 0); skips fault-locale 18; lookup-error lines 0; warm builds matched 36.

Warm jobs. start → done = the job's own `done ms=` (it starts in `after()`, i.e. right after the save's response, so it is ≈ warm-complete − commit). Per locale: actual rev, bytes, build / set ms, ok.

| save rev | instance | start (log clock) | start → done ms | sets | skips | warm builds (unmatched) | job-failed |
|---|---|---|---|---|---|---|---|
| 1254 | e77497ac | 21:06:37 | 112 | ko r1254 80830 B 56/12 ms; en r1254 79463 B 89/19 ms | ja fault-locale 0 ms | 2 | — |
| 1255 | 8d6166a1 | 21:07:01 | 74 | en r1255 100630 B 54/8 ms; ko r1255 102444 B 66/7 ms | ja fault-locale 0 ms | 2 | — |
| 1256 | ae7813cd | 21:07:02 | 194 | en r1256 80236 B 169/21 ms; ko r1256 81613 B 175/19 ms | ja fault-locale 0 ms | 2 | — |
| 1257 | c82c686e | 21:07:27 | 80 | ko r1257 60810 B 51/9 ms; en r1257 59865 B 71/8 ms | ja fault-locale 0 ms | 2 | — |
| 1258 | f1b139cf | 21:07:51 | 79 | ko r1258 82424 B 53/7 ms; en r1258 81032 B 63/6 ms | ja fault-locale 0 ms | 2 | — |
| 1259 | 120eeb91 | 21:07:52 | 153 | ko r1259 61615 B 121/10 ms; en r1259 60647 B 147/6 ms | ja fault-locale 0 ms | 2 | — |
| 1260 | 94791370 | 21:08:17 | 86 | ko r1260 61609 B 59/6 ms; en r1260 60637 B 78/6 ms | ja fault-locale 0 ms | 2 | — |
| 1261 | 636d1d67 | 21:08:41 | 78 | ko r1261 83223 B 49/7 ms; en r1261 81804 B 61/6 ms | ja fault-locale 0 ms | 2 | — |
| 1262 | 29e00a5b | 21:08:42 | 161 | ko r1262 62411 B 147/9 ms; en r1262 61422 B 154/7 ms | ja fault-locale 0 ms | 2 | — |
| 1263 | 636d1d67 | 21:09:07 | 79 | ko r1263 62400 B 42/7 ms; en r1263 61420 B 73/5 ms | ja fault-locale 0 ms | 2 | — |
| 1264 | 0bcd5d90 | 21:09:31 | 60 | ko r1264 84014 B 40/9 ms; en r1264 82587 B 52/7 ms | ja fault-locale 0 ms | 2 | — |
| 1265 | f1b139cf | 21:09:32 | 160 | ko r1265 63838 B 119/6 ms; en r1265 62822 B 154/5 ms | ja fault-locale 0 ms | 2 | — |
| 1266 | 9db7710b | 21:09:57 | 69 | en r1266 62817 B 47/10 ms; ko r1266 63837 B 54/15 ms | ja fault-locale 0 ms | 2 | — |
| 1267 | 9db7710b | 21:10:00 | 62 | ko r1267 62400 B 44/12 ms; en r1267 61416 B 53/8 ms | ja fault-locale 0 ms | 2 | — |
| 1268 | d7b7ac80 | 21:10:00 | 304 | ko r1268 61599 B 113/17 ms; en r1268 60632 B 270/34 ms | ja fault-locale 0 ms | 2 | — |
| 1269 | 6648ff12 | 21:10:01 | 60 | en r1269 59851 B 46/5 ms; ko r1269 60795 B 54/5 ms | ja fault-locale 0 ms | 2 | — |
| 1270 | f1b139cf | 21:10:01 | 205 | ko r1270 60013 B 148/6 ms; en r1270 59079 B 200/5 ms | ja fault-locale 0 ms | 2 | — |
| 1271 | c2bd3365 | 21:10:02 | 152 | ko r1271 59221 B 103/35 ms; en r1271 58301 B 136/15 ms | ja fault-locale 0 ms | 2 | — |

Per save rev. builds = every `[liveSnapshot] build` at that rev; warm = the ones matched to a warm job (same instance, locale, rev); reader = the rest. Lookups and hinted fetches are keyed by their `minRev`.

| save rev | warm jobs | start → done ms | builds | warm | reader | hinted fetches | lookups | hit | miss | stale | invalid | error | timeout | other | lookup ms p50 / p95 | hit rate |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1254 | 1 | 112 | 424 | 2 | 422 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — / — | — |
| 1255 | 1 | 74 | 55 | 2 | 53 | 476 | 476 | 143 | 115 | 0 | 0 | 0 | 0 | 218 | 3 / 34 | 30.0 % |
| 1256 | 1 | 194 | 429 | 2 | 427 | 278 | 278 | 129 | 54 | 0 | 0 | 0 | 0 | 95 | 5 / 20 | 46.4 % |
| 1257 | 1 | 80 | 420 | 2 | 418 | 485 | 485 | 144 | 81 | 0 | 0 | 0 | 0 | 260 | 0 / 26 | 29.7 % |
| 1258 | 1 | 79 | 36 | 2 | 34 | 495 | 495 | 148 | 95 | 0 | 0 | 0 | 0 | 252 | 0 / 20 | 29.9 % |
| 1259 | 1 | 153 | 331 | 2 | 329 | 267 | 267 | 145 | 42 | 0 | 0 | 0 | 0 | 80 | 7 / 15 | 54.3 % |
| 1260 | 1 | 86 | 369 | 2 | 367 | 484 | 484 | 145 | 73 | 0 | 0 | 0 | 0 | 266 | 0 / 14 | 30.0 % |
| 1261 | 1 | 78 | 74 | 2 | 72 | 483 | 483 | 144 | 81 | 0 | 0 | 0 | 0 | 258 | 0 / 16 | 29.8 % |
| 1262 | 1 | 161 | 370 | 2 | 368 | 328 | 328 | 139 | 59 | 0 | 0 | 0 | 0 | 130 | 3 / 10 | 42.4 % |
| 1263 | 1 | 79 | 305 | 2 | 303 | 492 | 492 | 148 | 80 | 0 | 0 | 0 | 0 | 264 | 0 / 12 | 30.1 % |
| 1264 | 1 | 60 | 57 | 2 | 55 | 495 | 495 | 149 | 83 | 0 | 0 | 0 | 0 | 263 | 0 / 13 | 30.1 % |
| 1265 | 1 | 160 | 388 | 2 | 386 | 301 | 301 | 142 | 52 | 0 | 0 | 0 | 0 | 107 | 4 / 11 | 47.2 % |
| 1266 | 1 | 69 | 154 | 2 | 152 | 487 | 487 | 148 | 79 | 0 | 0 | 0 | 0 | 260 | 0 / 15 | 30.4 % |
| 1267 | 1 | 62 | 42 | 2 | 40 | 409 | 409 | 118 | 50 | 0 | 0 | 0 | 0 | 241 | 0 / 10 | 28.9 % |
| 1268 | 1 | 304 | 70 | 2 | 68 | 78 | 78 | 21 | 33 | 0 | 0 | 0 | 0 | 24 | 4 / 12 | 26.9 % |
| 1269 | 1 | 60 | 11 | 2 | 9 | 214 | 214 | 58 | 48 | 0 | 0 | 0 | 0 | 108 | 0 / 10 | 27.1 % |
| 1270 | 1 | 205 | 95 | 2 | 93 | 263 | 263 | 84 | 54 | 0 | 0 | 0 | 0 | 125 | 3 / 10 | 31.9 % |
| 1271 | 1 | 152 | 129 | 2 | 127 | 473 | 473 | 144 | 85 | 0 | 0 | 0 | 0 | 244 | 0 / 9 | 30.4 % |

Lookup ms by result (p50 / p95, n): hit 9 / 23 (2149); miss 4 / 22 (1164); other 0 / 0 (3195). Whole capture: hit 2149, miss 1164, stale 0, invalid 0, error 0, timeout 0, other 3195.

| minute | lookups | hit | miss | stale | invalid | error | timeout | other |
|---|---|---|---|---|---|---|---|---|
| 21:07 | 2001 | 709 | 387 | 0 | 0 | 0 | 0 | 905 |
| 21:08 | 1295 | 428 | 213 | 0 | 0 | 0 | 0 | 654 |
| 21:09 | 1775 | 587 | 294 | 0 | 0 | 0 | 0 | 894 |
| 21:10 | 1437 | 425 | 270 | 0 | 0 | 0 | 0 | 742 |

### Admin writes (`[liveWriter]`)

| route | saves | acquire ms p50 / p95 | exec ms p50 / p95 | ok=false | failed kinds |
|---|---|---|---|---|---|
| admin-insert-after | 5 | 4 / 318 | 164 / 580 | 0 | — |
| admin-update | 8 | 4 / 5 | 87 / 167 | 0 | — |
| admin-delete | 5 | 4 / 125 | 33 / 39 | 0 | — |

### Per minute

| minute | requests | distinct instances | builds | EMAXCONN |
|---|---|---|---|---|
| 21:06 | 1415 | 49 | 400 | 0 |
| 21:07 | 3734 | 62 | 1162 | 0 |
| 21:08 | 2870 | 44 | 882 | 0 |
| 21:09 | 3345 | 50 | 961 | 0 |
| 21:10 | 1559 | 59 | 355 | 0 |

### Prisma pool totals per 5 s (app-side estimate of pooler clients)

Peak carried sum: **88** (carry 5 s). "reported" = instances that logged in the bucket (max total each); "carried" also counts an instance's last total for 5 s after its last line.

| bucket | reporting instances | Σ total (reported) | instances (carried) | Σ total (carried) | max waiting |
|---|---|---|---|---|---|
| 21:06:30 | 1 | 1 | 1 | 1 | 0 |
| 21:06:35 | 14 | 21 | 15 | 22 | 0 |
| 21:06:40 | 44 | 65 | 47 | 71 | 1 |
| 21:06:45 | 45 | 70 | 48 | 75 | 1 |
| 21:06:50 | 13 | 17 | 45 | 62 | 0 |
| 21:06:55 | 6 | 9 | 14 | 21 | 0 |
| 21:07:00 | 62 | 88 | 62 | 88 | 0 |
| 21:07:05 | 31 | 46 | 62 | 86 | 0 |
| 21:07:10 | 16 | 16 | 31 | 36 | 0 |
| 21:07:15 | 8 | 8 | 16 | 16 | 0 |
| 21:07:20 | 7 | 8 | 8 | 9 | 0 |
| 21:07:25 | 38 | 45 | 38 | 45 | 0 |
| 21:07:30 | 14 | 16 | 38 | 44 | 0 |
| 21:07:35 | 11 | 12 | 14 | 15 | 0 |
| 21:07:40 | 10 | 13 | 11 | 14 | 0 |
| 21:07:45 | 9 | 12 | 10 | 13 | 0 |
| 21:07:50 | 53 | 61 | 53 | 61 | 0 |
| 21:07:55 | 17 | 21 | 53 | 60 | 0 |
| 21:08:00 | 13 | 15 | 17 | 19 | 0 |
| 21:08:05 | 10 | 13 | 13 | 16 | 0 |
| 21:08:10 | 8 | 9 | 10 | 12 | 0 |
| 21:08:15 | 37 | 49 | 37 | 49 | 0 |
| 21:08:20 | 18 | 25 | 37 | 50 | 0 |
| 21:08:25 | 15 | 17 | 18 | 22 | 0 |
| 21:08:30 | 12 | 14 | 15 | 18 | 0 |
| 21:08:35 | 9 | 11 | 12 | 14 | 0 |
| 21:08:40 | 44 | 56 | 44 | 56 | 0 |
| 21:08:45 | 23 | 30 | 44 | 57 | 0 |
| 21:08:50 | 14 | 15 | 23 | 27 | 0 |
| 21:08:55 | 7 | 9 | 14 | 16 | 0 |
| 21:09:00 | 7 | 11 | 7 | 11 | 0 |
| 21:09:05 | 40 | 48 | 40 | 48 | 0 |
| 21:09:10 | 19 | 23 | 40 | 46 | 0 |
| 21:09:15 | 9 | 10 | 19 | 22 | 0 |
| 21:09:20 | 8 | 10 | 9 | 11 | 0 |
| 21:09:25 | 5 | 8 | 8 | 13 | 0 |
| 21:09:30 | 48 | 59 | 48 | 59 | 0 |
| 21:09:35 | 20 | 27 | 48 | 61 | 0 |
| 21:09:40 | 17 | 24 | 20 | 28 | 0 |
| 21:09:45 | 9 | 10 | 17 | 21 | 0 |
| 21:09:50 | 7 | 7 | 9 | 9 | 0 |
| 21:09:55 | 41 | 49 | 41 | 49 | 0 |
| 21:10:00 | 59 | 87 | 59 | 87 | 0 |

### Other lines

| kind | count |
|---|---|
| [liveWarm] fault | 62 |
| untagged: No logs found for opensetlist-projects/opensetlist | 4 |
| untagged: revalidating cache with key: async()=>JSON.stringi | 3 |
