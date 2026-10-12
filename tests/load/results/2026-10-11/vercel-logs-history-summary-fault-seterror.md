## Vercel runtime logs — 2026-10-11T201411Z-vercel-logs-history-fault-seterror.txt

13271 entries; requests: /api/setlist 12620, other API 219, pages 432; error-level entries 18. Times: log clock +7 h.

### Builds per rev (`[liveSnapshot] build` lines: 4396)

| rev | builds | distinct instances | locales | build ms avg / max | first – last |
|---|---|---|---|---|---|
| 1139 | 1 | 1 | ko 1 | 492 / 492 | 20:14:44 – 20:14:44 |
| 1140 | 308 | 49 | en 51, ja 184, ko 73 | 203 / 761 | 20:14:47 – 20:15:10 |
| 1141 | 97 | 40 | en 16, ko 27, ja 54 | 236 / 503 | 20:15:11 – 20:15:12 |
| 1142 | 477 | 103 | ja 277, en 75, ko 125 | 265 / 1137 | 20:15:12 – 20:15:37 |
| 1143 | 304 | 37 | ja 165, ko 88, en 51 | 91 / 289 | 20:15:37 – 20:16:00 |
| 1144 | 35 | 16 | en 4, ko 10, ja 21 | 104 / 190 | 20:16:01 – 20:16:02 |
| 1145 | 427 | 54 | ko 102, ja 254, en 71 | 152 / 614 | 20:16:02 – 20:16:27 |
| 1146 | 474 | 44 | ja 303, ko 103, en 68 | 95 / 406 | 20:16:27 – 20:16:51 |
| 1147 | 72 | 23 | en 13, ja 41, ko 18 | 160 / 366 | 20:16:51 – 20:16:52 |
| 1148 | 442 | 41 | ja 268, ko 114, en 60 | 119 / 480 | 20:16:52 – 20:17:17 |
| 1149 | 436 | 34 | ja 256, en 61, ko 119 | 99 / 348 | 20:17:17 – 20:17:41 |
| 1150 | 72 | 22 | ja 43, en 14, ko 15 | 165 / 351 | 20:17:41 – 20:17:42 |
| 1151 | 427 | 37 | ko 110, ja 246, en 71 | 113 / 499 | 20:17:42 – 20:18:07 |
| 1152 | 213 | 44 | ko 60, ja 120, en 33 | 139 / 380 | 20:18:07 – 20:18:11 |
| 1153 | 143 | 40 | ja 67, ko 44, en 32 | 301 / 649 | 20:18:10 – 20:18:12 |
| 1154 | 33 | 20 | ja 19, ko 6, en 8 | 120 / 507 | 20:18:11 – 20:18:12 |
| 1155 | 119 | 44 | en 30, ko 41, ja 48 | 383 / 733 | 20:18:12 – 20:18:13 |
| 1156 | 165 | 48 | ja 79, ko 50, en 36 | 335 / 810 | 20:18:12 – 20:18:14 |
| 1157 | 151 | 48 | en 35, ja 71, ko 45 | 282 / 640 | 20:18:13 – 20:18:15 |

### Failures, repair reads, coalescing

| what | count | detail |
|---|---|---|
| EMAXCONN (pooler client cap) | 0 | API 0, SSR 0 |
| `[liveSnapshot] build-failed` | 0 | — |
| `[liveSnapshot] rev-read` (repair revision read) | 0 | rev=timeout 0, rev=error 0; ms p50 — / max —; by hint: — |
| `[liveSnapshot] coalesced` | 1490 | waiters sum 5953, max 16 |
| `[setlist] slow-hit` | 0 | max — ms |

### Hint outcomes (`[setlist] hint-fetch` lines: 6787)

Whole capture: satisfied 6787, fresh 0, memo 0, deferred 0, none 0, error 0, other 0. "other" = a `verify=` value this script does not know.

| minute | hint fetches | satisfied | fresh | memo | deferred | none | error | other |
|---|---|---|---|---|---|---|---|---|
| 20:15 | 1338 | 1338 | 0 | 0 | 0 | 0 | 0 | 0 |
| 20:16 | 1810 | 1810 | 0 | 0 | 0 | 0 | 0 | 0 |
| 20:17 | 1219 | 1219 | 0 | 0 | 0 | 0 | 0 | 0 |
| 20:18 | 2420 | 2420 | 0 | 0 | 0 | 0 | 0 | 0 |

### Warming (`[liveWarm]` jobs: 18; `[setlist] warm-lookup` lines: 6787)

**warm hit rate = hits ÷ hinted fetches = 0 / 6787 = 0.0 %** (hinted fetches = `[setlist] hint-fetch` lines with a numeric minRev; lookups 6787).

schedule-failed 0; job-failed 0; set ok=false 54 (set-error lines 54); skips 0; lookup-error lines 0; warm builds matched 54.

Warm jobs. start → done = the job's own `done ms=` (it starts in `after()`, i.e. right after the save's response, so it is ≈ warm-complete − commit). Per locale: actual rev, bytes, build / set ms, ok.

| save rev | instance | start (log clock) | start → done ms | sets | skips | warm builds (unmatched) | job-failed |
|---|---|---|---|---|---|---|---|
| 1140 | c9d10b10 | 20:14:47 | 131 | ko r1140 80830 B 61/0 ms **ok=false**; ja r1140 67230 B 98/0 ms **ok=false**; en r1140 79463 B 66/1 ms **ok=false** | — | 3 | — |
| 1141 | 710b5e10 | 20:15:11 | 120 | ja r1141 85188 B 60/1 ms **ok=false**; ko r1141 102444 B 76/1 ms **ok=false**; en r1141 100630 B 58/0 ms **ok=false** | — | 3 | — |
| 1142 | 310b51b1 | 20:15:12 | 302 | ja r1142 68537 B 148/0 ms **ok=false**; ko r1142 82541 B 157/0 ms **ok=false**; en r1142 81127 B 151/0 ms **ok=false** | — | 3 | — |
| 1143 | c9d10b10 | 20:15:37 | 79 | ja r1143 51223 B 45/1 ms **ok=false**; ko r1143 61683 B 53/0 ms **ok=false**; en r1143 60713 B 32/0 ms **ok=false** | — | 3 | — |
| 1144 | 6ec943a9 | 20:16:01 | 121 | ko r1144 83297 B 53/0 ms **ok=false**; ja r1144 69181 B 64/0 ms **ok=false**; en r1144 81880 B 68/0 ms **ok=false** | — | 3 | — |
| 1145 | 4d0357c7 | 20:16:02 | 267 | ko r1145 63080 B 130/1 ms **ok=false**; ja r1145 52358 B 242/0 ms **ok=false**; en r1145 62081 B 136/0 ms **ok=false** | — | 3 | — |
| 1146 | c9d10b10 | 20:16:27 | 65 | ko r1146 63052 B 31/1 ms **ok=false**; ja r1146 52316 B 50/0 ms **ok=false**; en r1146 62037 B 32/0 ms **ok=false** | — | 3 | — |
| 1147 | 48be87d7 | 20:16:51 | 99 | ko r1147 84666 B 50/1 ms **ok=false**; ja r1147 70274 B 82/0 ms **ok=false**; en r1147 83204 B 46/1 ms **ok=false** | — | 3 | — |
| 1148 | b4f3a03b | 20:16:52 | 426 | en r1148 62815 B 176/0 ms **ok=false**; ja r1148 52966 B 248/1 ms **ok=false**; ko r1148 63851 B 252/0 ms **ok=false** | — | 3 | — |
| 1149 | 55d2975c | 20:17:17 | 106 | ko r1149 63916 B 58/0 ms **ok=false**; ja r1149 53012 B 86/0 ms **ok=false**; en r1149 62882 B 47/0 ms **ok=false** | — | 3 | — |
| 1150 | 5063ce7f | 20:17:41 | 138 | ko r1150 85530 B 55/1 ms **ok=false**; ja r1150 70970 B 78/0 ms **ok=false**; en r1150 84049 B 80/0 ms **ok=false** | — | 3 | — |
| 1151 | 90934d82 | 20:17:42 | 299 | ja r1151 53644 B 120/1 ms **ok=false**; ko r1151 64672 B 134/0 ms **ok=false**; en r1151 63635 B 178/0 ms **ok=false** | — | 3 | — |
| 1152 | accf147c | 20:18:07 | 108 | ko r1152 64560 B 65/1 ms **ok=false**; ja r1152 53609 B 69/0 ms **ok=false**; en r1152 63530 B 41/0 ms **ok=false** | — | 3 | — |
| 1153 | efaacf76 | 20:18:10 | 81 | ja r1153 52978 B 40/0 ms **ok=false**; ko r1153 63805 B 53/0 ms **ok=false**; en r1153 62778 B 40/0 ms **ok=false** | — | 3 | — |
| 1154 | 598c567b | 20:18:11 | 109 | ko r1154 63007 B 74/1 ms **ok=false**; ja r1154 52329 B 89/0 ms **ok=false**; en r1154 62001 B 33/0 ms **ok=false** | — | 3 | — |
| 1155 | 90934d82 | 20:18:12 | 861 | ko r1155 61611 B 197/0 ms **ok=false**; ja r1155 51195 B 502/0 ms **ok=false**; en r1155 60634 B 663/0 ms **ok=false** | — | 3 | — |
| 1156 | 310b51b1 | 20:18:12 | 177 | ko r1156 59901 B 64/0 ms **ok=false**; ja r1156 49889 B 82/0 ms **ok=false**; en r1156 58971 B 113/0 ms **ok=false** | — | 3 | — |
| 1157 | bad67c9f | 20:18:13 | 212 | ja r1157 49277 B 162/1 ms **ok=false**; ko r1157 59221 B 170/1 ms **ok=false**; en r1157 58301 B 48/0 ms **ok=false** | — | 3 | — |

Per save rev. builds = every `[liveSnapshot] build` at that rev; warm = the ones matched to a warm job (same instance, locale, rev); reader = the rest. Lookups and hinted fetches are keyed by their `minRev`.

| save rev | warm jobs | start → done ms | builds | warm | reader | hinted fetches | lookups | hit | miss | stale | invalid | error | timeout | other | lookup ms p50 / p95 | hit rate |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1140 | 1 | 131 | 308 | 3 | 305 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — / — | — |
| 1141 | 1 | 120 | 97 | 3 | 94 | 475 | 475 | 0 | 204 | 0 | 0 | 0 | 0 | 271 | 0 / 34 | 0.0 % |
| 1142 | 1 | 302 | 477 | 3 | 474 | 374 | 374 | 0 | 176 | 0 | 0 | 0 | 0 | 198 | 0 / 79 | 0.0 % |
| 1143 | 1 | 79 | 304 | 3 | 301 | 489 | 489 | 0 | 161 | 0 | 0 | 0 | 0 | 328 | 0 / 11 | 0.0 % |
| 1144 | 1 | 121 | 35 | 3 | 32 | 490 | 490 | 0 | 213 | 0 | 0 | 0 | 0 | 277 | 0 / 14 | 0.0 % |
| 1145 | 1 | 267 | 427 | 3 | 424 | 87 | 87 | 0 | 50 | 0 | 0 | 0 | 0 | 37 | 3 / 5 | 0.0 % |
| 1146 | 1 | 65 | 474 | 3 | 471 | 491 | 491 | 0 | 178 | 0 | 0 | 0 | 0 | 313 | 0 / 11 | 0.0 % |
| 1147 | 1 | 99 | 72 | 3 | 69 | 492 | 492 | 0 | 178 | 0 | 0 | 0 | 0 | 314 | 0 / 10 | 0.0 % |
| 1148 | 1 | 426 | 442 | 3 | 439 | 250 | 250 | 0 | 96 | 0 | 0 | 0 | 0 | 154 | 0 / 5 | 0.0 % |
| 1149 | 1 | 106 | 436 | 3 | 433 | 488 | 488 | 0 | 164 | 0 | 0 | 0 | 0 | 324 | 0 / 8 | 0.0 % |
| 1150 | 1 | 138 | 72 | 3 | 69 | 492 | 492 | 0 | 171 | 0 | 0 | 0 | 0 | 321 | 0 / 8 | 0.0 % |
| 1151 | 1 | 299 | 427 | 3 | 424 | 239 | 239 | 0 | 85 | 0 | 0 | 0 | 0 | 154 | 0 / 4 | 0.0 % |
| 1152 | 1 | 108 | 213 | 3 | 210 | 490 | 490 | 0 | 222 | 0 | 0 | 0 | 0 | 268 | 0 / 10 | 0.0 % |
| 1153 | 1 | 81 | 143 | 3 | 140 | 489 | 489 | 0 | 138 | 0 | 0 | 0 | 0 | 351 | 0 / 4 | 0.0 % |
| 1154 | 1 | 109 | 33 | 3 | 30 | 306 | 306 | 0 | 106 | 0 | 0 | 0 | 0 | 200 | 0 / 4 | 0.0 % |
| 1155 | 1 | 861 | 119 | 3 | 116 | 238 | 238 | 0 | 101 | 0 | 0 | 0 | 0 | 137 | 0 / 4 | 0.0 % |
| 1156 | 1 | 177 | 165 | 3 | 162 | 430 | 430 | 0 | 150 | 0 | 0 | 0 | 0 | 280 | 0 / 4 | 0.0 % |
| 1157 | 1 | 212 | 151 | 3 | 148 | 467 | 467 | 0 | 150 | 0 | 0 | 0 | 0 | 317 | 0 / 4 | 0.0 % |

Lookup ms by result (p50 / p95, n): miss 4 / 23 (2543); other 0 / 0 (4244). Whole capture: hit 0, miss 2543, stale 0, invalid 0, error 0, timeout 0, other 4244.

| minute | lookups | hit | miss | stale | invalid | error | timeout | other |
|---|---|---|---|---|---|---|---|---|
| 20:15 | 1338 | 0 | 541 | 0 | 0 | 0 | 0 | 797 |
| 20:16 | 1810 | 0 | 715 | 0 | 0 | 0 | 0 | 1095 |
| 20:17 | 1219 | 0 | 420 | 0 | 0 | 0 | 0 | 799 |
| 20:18 | 2420 | 0 | 867 | 0 | 0 | 0 | 0 | 1553 |

### Admin writes (`[liveWriter]`)

| route | saves | acquire ms p50 / p95 | exec ms p50 / p95 | ok=false | failed kinds |
|---|---|---|---|---|---|
| admin-insert-after | 5 | 4 / 5 | 209 / 245 | 0 | — |
| admin-update | 8 | 4 / 158 | 79 / 138 | 0 | — |
| admin-delete | 5 | 5 / 512 | 32 / 42 | 0 | — |

### Per minute

| minute | requests | distinct instances | builds | EMAXCONN |
|---|---|---|---|---|
| 20:14 | 1259 | 50 | 260 | 0 |
| 20:15 | 3042 | 106 | 923 | 0 |
| 20:16 | 3359 | 55 | 1270 | 0 |
| 20:17 | 2776 | 37 | 1066 | 0 |
| 20:18 | 2835 | 48 | 877 | 0 |

### Prisma pool totals per 5 s (app-side estimate of pooler clients)

Peak carried sum: **169** (carry 5 s). "reported" = instances that logged in the bucket (max total each); "carried" also counts an instance's last total for 5 s after its last line.

| bucket | reporting instances | Σ total (reported) | instances (carried) | Σ total (carried) | max waiting |
|---|---|---|---|---|---|
| 20:14:40 | 1 | 1 | 1 | 1 | 0 |
| 20:14:45 | 30 | 36 | 30 | 36 | 0 |
| 20:14:50 | 45 | 64 | 45 | 64 | 0 |
| 20:14:55 | 43 | 65 | 49 | 74 | 0 |
| 20:15:00 | 9 | 11 | 43 | 62 | 0 |
| 20:15:05 | 4 | 7 | 9 | 14 | 0 |
| 20:15:10 | 106 | 168 | 106 | 168 | 1 |
| 20:15:15 | 25 | 47 | 106 | 169 | 0 |
| 20:15:20 | 11 | 16 | 25 | 40 | 0 |
| 20:15:25 | 11 | 12 | 11 | 12 | 0 |
| 20:15:30 | 10 | 12 | 11 | 13 | 0 |
| 20:15:35 | 37 | 62 | 37 | 62 | 0 |
| 20:15:40 | 15 | 26 | 37 | 61 | 0 |
| 20:15:45 | 9 | 10 | 15 | 20 | 0 |
| 20:15:50 | 6 | 9 | 9 | 12 | 0 |
| 20:15:55 | 5 | 8 | 6 | 9 | 0 |
| 20:16:00 | 54 | 94 | 54 | 94 | 0 |
| 20:16:05 | 18 | 31 | 54 | 92 | 0 |
| 20:16:10 | 16 | 18 | 19 | 22 | 0 |
| 20:16:15 | 12 | 12 | 16 | 16 | 0 |
| 20:16:20 | 9 | 9 | 12 | 12 | 0 |
| 20:16:25 | 44 | 75 | 44 | 75 | 0 |
| 20:16:30 | 24 | 45 | 44 | 75 | 0 |
| 20:16:35 | 20 | 22 | 24 | 28 | 0 |
| 20:16:40 | 17 | 18 | 20 | 22 | 0 |
| 20:16:45 | 10 | 11 | 17 | 18 | 0 |
| 20:16:50 | 41 | 79 | 41 | 79 | 0 |
| 20:16:55 | 27 | 52 | 41 | 79 | 0 |
| 20:17:00 | 17 | 19 | 27 | 37 | 0 |
| 20:17:05 | 9 | 11 | 17 | 19 | 0 |
| 20:17:10 | 8 | 11 | 9 | 12 | 0 |
| 20:17:15 | 34 | 62 | 34 | 62 | 0 |
| 20:17:20 | 16 | 32 | 34 | 62 | 0 |
| 20:17:25 | 14 | 15 | 16 | 19 | 0 |
| 20:17:30 | 12 | 13 | 14 | 15 | 0 |
| 20:17:35 | 9 | 9 | 12 | 12 | 0 |
| 20:17:40 | 37 | 73 | 37 | 73 | 0 |
| 20:17:45 | 20 | 38 | 37 | 71 | 0 |
| 20:17:50 | 13 | 17 | 20 | 28 | 0 |
| 20:17:55 | 7 | 10 | 13 | 17 | 0 |
| 20:18:00 | 6 | 11 | 7 | 13 | 0 |
| 20:18:05 | 44 | 76 | 44 | 76 | 0 |
| 20:18:10 | 48 | 93 | 48 | 93 | 1 |
| 20:18:15 | 41 | 82 | 48 | 96 | 0 |

### Other lines

| kind | count |
|---|---|
| [liveWarm] fault | 106 |
| untagged: No logs found for opensetlist-projects/opensetlist | 4 |
