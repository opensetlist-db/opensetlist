## Vercel runtime logs — 2026-10-11T200507Z-vercel-logs-history-fault-locale-ja.txt

12923 entries; requests: /api/setlist 12278, other API 213, pages 432; error-level entries 0. Times: log clock +7 h.

### Builds per rev (`[liveSnapshot] build` lines: 3747)

| rev | builds | distinct instances | locales | build ms avg / max | first – last |
|---|---|---|---|---|---|
| 1101 | 1 | 1 | ko 1 | 512 / 512 | 20:05:41 – 20:05:41 |
| 1102 | 427 | 51 | ja 257, ko 116, en 54 | 145 / 878 | 20:05:44 – 20:06:08 |
| 1103 | 43 | 28 | ja 37, ko 5, en 1 | 117 / 213 | 20:06:07 – 20:06:08 |
| 1104 | 379 | 73 | ko 66, ja 272, en 41 | 146 / 869 | 20:06:08 – 20:06:34 |
| 1105 | 320 | 43 | ja 246, ko 49, en 25 | 74 / 213 | 20:06:33 – 20:06:57 |
| 1106 | 60 | 27 | ja 56, ko 2, en 2 | 99 / 187 | 20:06:57 – 20:06:59 |
| 1107 | 327 | 44 | ja 251, ko 42, en 34 | 66 / 168 | 20:06:58 – 20:07:23 |
| 1108 | 353 | 45 | ko 51, en 42, ja 260 | 66 / 186 | 20:07:23 – 20:07:48 |
| 1109 | 62 | 24 | ja 57, en 4, ko 1 | 90 / 231 | 20:07:47 – 20:07:48 |
| 1110 | 401 | 52 | ko 72, ja 285, en 44 | 76 / 289 | 20:07:48 – 20:08:13 |
| 1111 | 354 | 40 | ko 69, en 28, ja 257 | 61 / 238 | 20:08:13 – 20:08:37 |
| 1112 | 73 | 27 | ja 67, en 2, ko 4 | 79 / 168 | 20:08:37 – 20:08:39 |
| 1113 | 461 | 46 | ko 65, ja 357, en 39 | 65 / 217 | 20:08:38 – 20:09:04 |
| 1114 | 156 | 44 | ja 143, ko 10, en 3 | 77 / 152 | 20:09:03 – 20:09:06 |
| 1115 | 37 | 25 | ja 33, ko 2, en 2 | 113 / 216 | 20:09:06 – 20:09:06 |
| 1116 | 64 | 39 | ja 54, ko 6, en 4 | 138 / 259 | 20:09:06 – 20:09:07 |
| 1117 | 13 | 12 | ja 11, ko 1, en 1 | 92 / 122 | 20:09:07 – 20:09:07 |
| 1118 | 87 | 60 | ja 81, ko 5, en 1 | 193 / 298 | 20:09:07 – 20:09:08 |
| 1119 | 129 | 62 | ja 115, ko 10, en 4 | 146 / 278 | 20:09:08 – 20:09:09 |

### Failures, repair reads, coalescing

| what | count | detail |
|---|---|---|
| EMAXCONN (pooler client cap) | 0 | API 0, SSR 0 |
| `[liveSnapshot] build-failed` | 0 | — |
| `[liveSnapshot] rev-read` (repair revision read) | 0 | rev=timeout 0, rev=error 0; ms p50 — / max —; by hint: — |
| `[liveSnapshot] coalesced` | 1194 | waiters sum 4360, max 14 |
| `[setlist] slow-hit` | 0 | max — ms |

### Hint outcomes (`[setlist] hint-fetch` lines: 6540)

Whole capture: satisfied 6540, fresh 0, memo 0, deferred 0, none 0, error 0, other 0. "other" = a `verify=` value this script does not know.

| minute | hint fetches | satisfied | fresh | memo | deferred | none | error | other |
|---|---|---|---|---|---|---|---|---|
| 20:06 | 1973 | 1973 | 0 | 0 | 0 | 0 | 0 | 0 |
| 20:07 | 1312 | 1312 | 0 | 0 | 0 | 0 | 0 | 0 |
| 20:08 | 1323 | 1323 | 0 | 0 | 0 | 0 | 0 | 0 |
| 20:09 | 1932 | 1932 | 0 | 0 | 0 | 0 | 0 | 0 |

### Warming (`[liveWarm]` jobs: 18; `[setlist] warm-lookup` lines: 6540)

**warm hit rate = hits ÷ hinted fetches = 2153 / 6540 = 32.9 %** (hinted fetches = `[setlist] hint-fetch` lines with a numeric minRev; lookups 6540).

schedule-failed 0; job-failed 0; set ok=false 0 (set-error lines 0); skips fault-locale 18; lookup-error lines 0; warm builds matched 36.

Warm jobs. start → done = the job's own `done ms=` (it starts in `after()`, i.e. right after the save's response, so it is ≈ warm-complete − commit). Per locale: actual rev, bytes, build / set ms, ok.

| save rev | instance | start (log clock) | start → done ms | sets | skips | warm builds (unmatched) | job-failed |
|---|---|---|---|---|---|---|---|
| 1102 | 388ff932 | 20:05:44 | 108 | ko r1102 80830 B 62/13 ms; en r1102 79463 B 92/10 ms | ja fault-locale 0 ms | 2 | — |
| 1103 | 0e1ae6d3 | 20:06:07 | 81 | ko r1103 102444 B 58/7 ms; en r1103 100630 B 73/7 ms | ja fault-locale 0 ms | 2 | — |
| 1104 | f7af8031 | 20:06:08 | 235 | ko r1104 81466 B 188/10 ms; en r1104 80099 B 220/6 ms | ja fault-locale 0 ms | 2 | — |
| 1105 | 9c85a565 | 20:06:33 | 63 | en r1105 59597 B 47/6 ms; ko r1105 60523 B 58/5 ms | ja fault-locale 0 ms | 2 | — |
| 1106 | 9c85a565 | 20:06:57 | 155 | en r1106 80764 B 54/57 ms; ko r1106 82137 B 144/11 ms | ja fault-locale 0 ms | 2 | — |
| 1107 | 2a5a7544 | 20:06:58 | 139 | ko r1107 61999 B 125/6 ms; en r1107 61038 B 134/5 ms | ja fault-locale 0 ms | 2 | — |
| 1108 | 2a5a7544 | 20:07:23 | 101 | ko r1108 63039 B 50/6 ms; en r1108 62037 B 95/5 ms | ja fault-locale 0 ms | 2 | — |
| 1109 | 23e30bb2 | 20:07:47 | 127 | ko r1109 84653 B 75/18 ms; en r1109 83204 B 119/6 ms | ja fault-locale 0 ms | 2 | — |
| 1110 | bf4ccaec | 20:07:48 | 115 | ko r1110 64762 B 96/6 ms; en r1110 63712 B 109/6 ms | ja fault-locale 0 ms | 2 | — |
| 1111 | d1418238 | 20:08:13 | 87 | ko r1111 63817 B 58/8 ms; en r1111 62817 B 80/7 ms | ja fault-locale 0 ms | 2 | — |
| 1112 | 97ab6f4c | 20:08:37 | 87 | ko r1112 85431 B 42/12 ms; en r1112 83984 B 77/9 ms | ja fault-locale 0 ms | 2 | — |
| 1113 | 6f368e2c | 20:08:38 | 109 | en r1113 63589 B 92/8 ms; ko r1113 64589 B 98/11 ms | ja fault-locale 0 ms | 2 | — |
| 1114 | 7f96c1bf | 20:09:03 | 81 | ko r1114 64570 B 62/9 ms; en r1114 63567 B 68/12 ms | ja fault-locale 0 ms | 2 | — |
| 1115 | 23e30bb2 | 20:09:06 | 55 | ko r1115 63799 B 36/6 ms; en r1115 62796 B 50/5 ms | ja fault-locale 0 ms | 2 | — |
| 1116 | 3a06c40c | 20:09:06 | 265 | ko r1116 62077 B 186/6 ms; en r1116 61122 B 260/5 ms | ja fault-locale 0 ms | 2 | — |
| 1117 | 28c0aac4 | 20:09:07 | 81 | ko r1117 60602 B 48/10 ms; en r1117 59682 B 72/8 ms | ja fault-locale 0 ms | 2 | — |
| 1118 | 0ad039e9 | 20:09:07 | 163 | ko r1118 59967 B 103/10 ms; en r1118 59047 B 155/8 ms | ja fault-locale 0 ms | 2 | — |
| 1119 | 9c85a565 | 20:09:08 | 125 | ko r1119 59221 B 109/6 ms; en r1119 58301 B 119/5 ms | ja fault-locale 0 ms | 2 | — |

Per save rev. builds = every `[liveSnapshot] build` at that rev; warm = the ones matched to a warm job (same instance, locale, rev); reader = the rest. Lookups and hinted fetches are keyed by their `minRev`.

| save rev | warm jobs | start → done ms | builds | warm | reader | hinted fetches | lookups | hit | miss | stale | invalid | error | timeout | other | lookup ms p50 / p95 | hit rate |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1102 | 1 | 108 | 427 | 2 | 425 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — / — | — |
| 1103 | 1 | 81 | 43 | 2 | 41 | 473 | 473 | 140 | 132 | 0 | 0 | 0 | 0 | 201 | 4 / 50 | 29.6 % |
| 1104 | 1 | 235 | 379 | 2 | 377 | 223 | 223 | 130 | 49 | 0 | 0 | 0 | 0 | 44 | 9 / 25 | 58.3 % |
| 1105 | 1 | 63 | 320 | 2 | 318 | 488 | 488 | 146 | 93 | 0 | 0 | 0 | 0 | 249 | 0 / 24 | 29.9 % |
| 1106 | 1 | 155 | 60 | 2 | 58 | 492 | 492 | 148 | 94 | 0 | 0 | 0 | 0 | 250 | 0 / 20 | 30.1 % |
| 1107 | 1 | 139 | 327 | 2 | 325 | 321 | 321 | 146 | 54 | 0 | 0 | 0 | 0 | 121 | 4 / 11 | 45.5 % |
| 1108 | 1 | 101 | 353 | 2 | 351 | 497 | 497 | 149 | 91 | 0 | 0 | 0 | 0 | 257 | 0 / 18 | 30.0 % |
| 1109 | 1 | 127 | 62 | 2 | 60 | 483 | 483 | 144 | 86 | 0 | 0 | 0 | 0 | 253 | 0 / 17 | 29.8 % |
| 1110 | 1 | 115 | 401 | 2 | 399 | 308 | 308 | 140 | 61 | 0 | 0 | 0 | 0 | 107 | 4 / 13 | 45.5 % |
| 1111 | 1 | 87 | 354 | 2 | 352 | 480 | 480 | 143 | 90 | 0 | 0 | 0 | 0 | 247 | 0 / 14 | 29.8 % |
| 1112 | 1 | 87 | 73 | 2 | 71 | 488 | 488 | 145 | 87 | 0 | 0 | 0 | 0 | 256 | 0 / 16 | 29.7 % |
| 1113 | 1 | 109 | 461 | 2 | 459 | 355 | 355 | 141 | 70 | 0 | 0 | 0 | 0 | 144 | 3 / 12 | 39.7 % |
| 1114 | 1 | 81 | 156 | 2 | 154 | 491 | 491 | 149 | 75 | 0 | 0 | 0 | 0 | 267 | 0 / 16 | 30.3 % |
| 1115 | 1 | 55 | 37 | 2 | 35 | 416 | 416 | 121 | 53 | 0 | 0 | 0 | 0 | 242 | 0 / 10 | 29.1 % |
| 1116 | 1 | 265 | 64 | 2 | 62 | 78 | 78 | 22 | 27 | 0 | 0 | 0 | 0 | 29 | 3 / 12 | 28.2 % |
| 1117 | 1 | 81 | 13 | 2 | 11 | 262 | 262 | 71 | 55 | 0 | 0 | 0 | 0 | 136 | 0 / 15 | 27.1 % |
| 1118 | 1 | 163 | 87 | 2 | 85 | 224 | 224 | 75 | 50 | 0 | 0 | 0 | 0 | 99 | 3 / 11 | 33.5 % |
| 1119 | 1 | 125 | 129 | 2 | 127 | 461 | 461 | 143 | 80 | 0 | 0 | 0 | 0 | 238 | 0 / 10 | 31.0 % |

Lookup ms by result (p50 / p95, n): hit 10 / 27 (2153); miss 4 / 24 (1247); other 0 / 0 (3140). Whole capture: hit 2153, miss 1247, stale 0, invalid 0, error 0, timeout 0, other 3140.

| minute | lookups | hit | miss | stale | invalid | error | timeout | other |
|---|---|---|---|---|---|---|---|---|
| 20:06 | 1973 | 696 | 414 | 0 | 0 | 0 | 0 | 863 |
| 20:07 | 1312 | 447 | 246 | 0 | 0 | 0 | 0 | 619 |
| 20:08 | 1323 | 429 | 247 | 0 | 0 | 0 | 0 | 647 |
| 20:09 | 1932 | 581 | 340 | 0 | 0 | 0 | 0 | 1011 |

### Admin writes (`[liveWriter]`)

| route | saves | acquire ms p50 / p95 | exec ms p50 / p95 | ok=false | failed kinds |
|---|---|---|---|---|---|
| admin-insert-after | 5 | 4 / 5 | 186 / 247 | 0 | — |
| admin-update | 8 | 3 / 6 | 88 / 144 | 0 | — |
| admin-delete | 5 | 7 / 148 | 27 / 41 | 0 | — |

### Per minute

| minute | requests | distinct instances | builds | EMAXCONN |
|---|---|---|---|---|
| 20:05 | 1321 | 52 | 375 | 0 |
| 20:06 | 3664 | 78 | 984 | 0 |
| 20:07 | 2879 | 53 | 921 | 0 |
| 20:08 | 2872 | 47 | 949 | 0 |
| 20:09 | 2187 | 67 | 518 | 0 |

### Prisma pool totals per 5 s (app-side estimate of pooler clients)

Peak carried sum: **90** (carry 5 s). "reported" = instances that logged in the bucket (max total each); "carried" also counts an instance's last total for 5 s after its last line.

| bucket | reporting instances | Σ total (reported) | instances (carried) | Σ total (carried) | max waiting |
|---|---|---|---|---|---|
| 20:05:40 | 1 | 2 | 1 | 2 | 0 |
| 20:05:45 | 45 | 68 | 45 | 68 | 0 |
| 20:05:50 | 50 | 84 | 50 | 84 | 0 |
| 20:05:55 | 12 | 18 | 51 | 78 | 0 |
| 20:06:00 | 2 | 2 | 12 | 17 | 0 |
| 20:06:05 | 74 | 87 | 74 | 87 | 0 |
| 20:06:10 | 48 | 61 | 74 | 90 | 1 |
| 20:06:15 | 6 | 6 | 48 | 57 | 0 |
| 20:06:20 | 5 | 5 | 6 | 6 | 0 |
| 20:06:25 | 5 | 9 | 5 | 9 | 0 |
| 20:06:30 | 41 | 52 | 41 | 52 | 0 |
| 20:06:35 | 35 | 44 | 43 | 54 | 0 |
| 20:06:40 | 7 | 9 | 35 | 41 | 0 |
| 20:06:45 | 7 | 11 | 7 | 11 | 0 |
| 20:06:50 | 4 | 7 | 7 | 11 | 0 |
| 20:06:55 | 44 | 52 | 44 | 52 | 0 |
| 20:07:00 | 27 | 32 | 44 | 51 | 0 |
| 20:07:05 | 14 | 16 | 27 | 31 | 0 |
| 20:07:10 | 11 | 13 | 14 | 16 | 0 |
| 20:07:15 | 10 | 11 | 11 | 12 | 0 |
| 20:07:20 | 26 | 29 | 26 | 29 | 0 |
| 20:07:25 | 43 | 47 | 45 | 49 | 0 |
| 20:07:30 | 16 | 18 | 43 | 47 | 0 |
| 20:07:35 | 14 | 17 | 16 | 19 | 0 |
| 20:07:40 | 10 | 12 | 14 | 16 | 0 |
| 20:07:45 | 52 | 65 | 52 | 65 | 0 |
| 20:07:50 | 31 | 42 | 52 | 68 | 0 |
| 20:07:55 | 15 | 17 | 31 | 37 | 0 |
| 20:08:00 | 9 | 9 | 15 | 15 | 0 |
| 20:08:05 | 8 | 8 | 9 | 9 | 0 |
| 20:08:10 | 38 | 44 | 38 | 44 | 0 |
| 20:08:15 | 31 | 39 | 40 | 48 | 0 |
| 20:08:20 | 15 | 18 | 31 | 37 | 0 |
| 20:08:25 | 10 | 12 | 15 | 19 | 0 |
| 20:08:30 | 8 | 9 | 10 | 12 | 0 |
| 20:08:35 | 46 | 58 | 46 | 58 | 0 |
| 20:08:40 | 29 | 39 | 46 | 58 | 0 |
| 20:08:45 | 14 | 22 | 29 | 40 | 0 |
| 20:08:50 | 11 | 15 | 14 | 19 | 0 |
| 20:08:55 | 10 | 11 | 11 | 12 | 0 |
| 20:09:00 | 37 | 40 | 37 | 40 | 0 |
| 20:09:05 | 66 | 88 | 66 | 88 | 0 |

### Other lines

| kind | count |
|---|---|
| [liveWarm] fault | 78 |
| untagged: No logs found for opensetlist-projects/opensetlist | 4 |
