## Vercel runtime logs — 2026-10-11T202319Z-vercel-logs-history-fault-slow-400.txt

12855 entries; requests: /api/setlist 12202, other API 221, pages 432; error-level entries 0. Times: log clock +7 h.

### Builds per rev (`[liveSnapshot] build` lines: 3969)

| rev | builds | distinct instances | locales | build ms avg / max | first – last |
|---|---|---|---|---|---|
| 1177 | 1 | 1 | ko 1 | 622 / 622 | 20:23:52 – 20:23:52 |
| 1178 | 440 | 57 | ja 286, ko 83, en 71 | 179 / 762 | 20:23:56 – 20:24:21 |
| 1179 | 14 | 4 | ja 6, ko 3, en 5 | 52 / 87 | 20:24:20 – 20:24:21 |
| 1180 | 421 | 45 | ja 282, en 34, ko 105 | 108 / 710 | 20:24:21 – 20:24:47 |
| 1181 | 317 | 34 | ko 82, en 58, ja 177 | 71 / 241 | 20:24:46 – 20:25:11 |
| 1182 | 11 | 5 | ko 2, en 2, ja 7 | 71 / 118 | 20:25:10 – 20:25:11 |
| 1183 | 469 | 31 | ko 127, en 75, ja 267 | 72 / 314 | 20:25:11 – 20:25:37 |
| 1184 | 369 | 30 | ja 204, en 63, ko 102 | 70 / 319 | 20:25:36 – 20:26:01 |
| 1185 | 13 | 4 | ja 8, ko 3, en 2 | 45 / 70 | 20:26:00 – 20:26:01 |
| 1186 | 331 | 31 | ja 178, ko 88, en 65 | 59 / 213 | 20:26:01 – 20:26:26 |
| 1187 | 406 | 35 | en 60, ja 237, ko 109 | 69 / 279 | 20:26:26 – 20:26:50 |
| 1188 | 60 | 21 | ja 30, en 11, ko 19 | 136 / 269 | 20:26:50 – 20:26:51 |
| 1189 | 403 | 43 | ja 225, en 60, ko 118 | 114 / 447 | 20:26:51 – 20:27:17 |
| 1190 | 189 | 39 | ko 54, en 27, ja 108 | 132 / 412 | 20:27:16 – 20:27:19 |
| 1191 | 7 | 4 | ja 4, en 2, ko 1 | 49 / 66 | 20:27:20 – 20:27:20 |
| 1192 | 154 | 42 | en 34, ja 74, ko 46 | 266 / 549 | 20:27:20 – 20:27:22 |
| 1193 | 54 | 27 | ja 35, en 7, ko 12 | 129 / 217 | 20:27:21 – 20:27:22 |
| 1194 | 154 | 43 | ko 49, en 30, ja 75 | 290 / 660 | 20:27:22 – 20:27:23 |
| 1195 | 156 | 40 | en 35, ko 51, ja 70 | 118 / 445 | 20:27:22 – 20:27:25 |

### Failures, repair reads, coalescing

| what | count | detail |
|---|---|---|
| EMAXCONN (pooler client cap) | 0 | API 0, SSR 0 |
| `[liveSnapshot] build-failed` | 0 | — |
| `[liveSnapshot] rev-read` (repair revision read) | 3 | rev=timeout 0, rev=error 0; ms p50 14 / max 54; by hint: hint=1 2, hint=0 1 |
| `[liveSnapshot] coalesced` | 1034 | waiters sum 3337, max 12 |
| `[setlist] slow-hit` | 1 | max 513 ms |

### Hint outcomes (`[setlist] hint-fetch` lines: 6368)

Whole capture: satisfied 6368, fresh 0, memo 0, deferred 0, none 0, error 0, other 0. "other" = a `verify=` value this script does not know.

| minute | hint fetches | satisfied | fresh | memo | deferred | none | error | other |
|---|---|---|---|---|---|---|---|---|
| 20:24 | 1124 | 1124 | 0 | 0 | 0 | 0 | 0 | 0 |
| 20:25 | 1213 | 1213 | 0 | 0 | 0 | 0 | 0 | 0 |
| 20:26 | 1955 | 1955 | 0 | 0 | 0 | 0 | 0 | 0 |
| 20:27 | 2076 | 2076 | 0 | 0 | 0 | 0 | 0 | 0 |

### Warming (`[liveWarm]` jobs: 18; `[setlist] warm-lookup` lines: 6368)

**warm hit rate = hits ÷ hinted fetches = 2072 / 6368 = 32.5 %** (hinted fetches = `[setlist] hint-fetch` lines with a numeric minRev; lookups 6368).

schedule-failed 0; job-failed 0; set ok=false 0 (set-error lines 0); skips 0; lookup-error lines 0; warm builds matched 54.

Warm jobs. start → done = the job's own `done ms=` (it starts in `after()`, i.e. right after the save's response, so it is ≈ warm-complete − commit). Per locale: actual rev, bytes, build / set ms, ok.

| save rev | instance | start (log clock) | start → done ms | sets | skips | warm builds (unmatched) | job-failed |
|---|---|---|---|---|---|---|---|
| 1178 | 914501ec | 20:23:56 | 141 | ko r1178 80830 B 48/9 ms; ja r1178 67230 B 83/7 ms; en r1178 79463 B 63/7 ms | — | 3 | — |
| 1179 | e9f273f3 | 20:24:20 | 116 | ko r1179 102444 B 49/9 ms; ja r1179 85188 B 89/7 ms; en r1179 100630 B 49/7 ms | — | 3 | — |
| 1180 | 881cc7c8 | 20:24:21 | 192 | ko r1180 81558 B 111/15 ms; ja r1180 67832 B 118/15 ms; en r1180 80172 B 55/9 ms | — | 3 | — |
| 1181 | eec8dc05 | 20:24:46 | 93 | ja r1181 50486 B 40/14 ms; ko r1181 60624 B 51/9 ms; en r1181 59676 B 32/6 ms | — | 3 | — |
| 1182 | 05088deb | 20:25:10 | 101 | ja r1182 68444 B 40/7 ms; ko r1182 82238 B 51/7 ms; en r1182 80843 B 47/6 ms | — | 3 | — |
| 1183 | 891a7765 | 20:25:11 | 310 | ko r1183 61382 B 146/51 ms; ja r1183 51113 B 230/5 ms; en r1183 60417 B 107/5 ms | — | 3 | — |
| 1184 | 8834bbee | 20:25:36 | 169 | ko r1184 61491 B 56/20 ms; ja r1184 51149 B 116/25 ms; en r1184 60524 B 84/7 ms | — | 3 | — |
| 1185 | 5227edf4 | 20:26:00 | 125 | ko r1185 83105 B 63/12 ms; ja r1185 69107 B 71/11 ms; en r1185 81691 B 42/8 ms | — | 3 | — |
| 1186 | 0712e7e2 | 20:26:01 | 309 | ko r1186 62277 B 204/12 ms; ja r1186 51800 B 214/6 ms; en r1186 61301 B 84/8 ms | — | 3 | — |
| 1187 | 5227edf4 | 20:26:26 | 99 | ko r1187 62283 B 42/9 ms; ja r1187 51806 B 74/6 ms; en r1187 61308 B 41/7 ms | — | 3 | — |
| 1188 | aef9d425 | 20:26:50 | 184 | ko r1188 83897 B 115/13 ms; ja r1188 69764 B 125/9 ms; en r1188 82475 B 47/8 ms | — | 3 | — |
| 1189 | de26d80a | 20:26:51 | 271 | ko r1189 63061 B 141/5 ms; ja r1189 52452 B 232/5 ms; en r1189 62084 B 117/7 ms | — | 3 | — |
| 1190 | 437fad09 | 20:27:16 | 99 | ko r1190 63055 B 45/6 ms; ja r1190 52443 B 77/5 ms; en r1190 62073 B 41/6 ms | — | 3 | — |
| 1191 | bff5d847 | 20:27:20 | 103 | ko r1191 62278 B 44/14 ms; ja r1191 51798 B 55/6 ms; en r1191 61298 B 36/8 ms | — | 3 | — |
| 1192 | d6881463 | 20:27:20 | 102 | ja r1192 51148 B 39/16 ms; ko r1192 61493 B 53/9 ms; en r1192 60522 B 40/6 ms | — | 3 | — |
| 1193 | ad94ff62 | 20:27:21 | 151 | ko r1193 60736 B 87/11 ms; ja r1193 50522 B 125/6 ms; en r1193 59782 B 47/5 ms | — | 3 | — |
| 1194 | 1e278126 | 20:27:22 | 111 | ja r1194 49921 B 40/10 ms; ko r1194 60009 B 49/9 ms; en r1194 59074 B 53/6 ms | — | 3 | — |
| 1195 | bff5d847 | 20:27:22 | 147 | ko r1195 59221 B 92/8 ms; ja r1195 49277 B 96/6 ms; en r1195 58301 B 40/7 ms | — | 3 | — |

Per save rev. builds = every `[liveSnapshot] build` at that rev; warm = the ones matched to a warm job (same instance, locale, rev); reader = the rest. Lookups and hinted fetches are keyed by their `minRev`.

| save rev | warm jobs | start → done ms | builds | warm | reader | hinted fetches | lookups | hit | miss | stale | invalid | error | timeout | other | lookup ms p50 / p95 | hit rate |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1178 | 1 | 141 | 440 | 3 | 437 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — / — | — |
| 1179 | 1 | 116 | 14 | 3 | 11 | 468 | 468 | 163 | 0 | 0 | 0 | 0 | 238 | 67 | 299 / 312 | 34.8 % |
| 1180 | 1 | 192 | 421 | 3 | 418 | 162 | 162 | 37 | 0 | 0 | 0 | 0 | 116 | 9 | 300 / 319 | 22.8 % |
| 1181 | 1 | 93 | 317 | 3 | 314 | 494 | 494 | 167 | 0 | 0 | 0 | 0 | 241 | 86 | 297 / 310 | 33.8 % |
| 1182 | 1 | 101 | 11 | 3 | 8 | 496 | 496 | 173 | 0 | 0 | 0 | 0 | 268 | 55 | 300 / 311 | 34.9 % |
| 1183 | 1 | 310 | 469 | 3 | 466 | 228 | 228 | 78 | 0 | 0 | 0 | 0 | 121 | 29 | 300 / 301 | 34.2 % |
| 1184 | 1 | 169 | 369 | 3 | 366 | 489 | 489 | 158 | 0 | 0 | 0 | 0 | 244 | 87 | 299 / 305 | 32.3 % |
| 1185 | 1 | 125 | 13 | 3 | 10 | 490 | 490 | 183 | 0 | 0 | 0 | 0 | 257 | 50 | 299 / 307 | 37.3 % |
| 1186 | 1 | 309 | 331 | 3 | 328 | 178 | 178 | 39 | 0 | 0 | 0 | 0 | 124 | 15 | 300 / 310 | 21.9 % |
| 1187 | 1 | 99 | 406 | 3 | 403 | 483 | 483 | 152 | 0 | 0 | 0 | 0 | 258 | 73 | 299 / 306 | 31.5 % |
| 1188 | 1 | 184 | 60 | 3 | 57 | 485 | 485 | 184 | 0 | 0 | 0 | 0 | 246 | 55 | 299 / 304 | 37.9 % |
| 1189 | 1 | 271 | 403 | 3 | 400 | 319 | 319 | 105 | 0 | 0 | 0 | 0 | 187 | 27 | 300 / 302 | 32.9 % |
| 1190 | 1 | 99 | 189 | 3 | 186 | 495 | 495 | 177 | 0 | 0 | 0 | 0 | 250 | 68 | 299 / 303 | 35.8 % |
| 1191 | 1 | 103 | 7 | 3 | 4 | 343 | 343 | 110 | 0 | 0 | 0 | 0 | 217 | 16 | 300 / 303 | 32.1 % |
| 1192 | 1 | 102 | 154 | 3 | 151 | 255 | 255 | 49 | 0 | 0 | 0 | 0 | 204 | 2 | 300 / 305 | 19.2 % |
| 1193 | 1 | 151 | 54 | 3 | 51 | 316 | 316 | 98 | 0 | 0 | 0 | 0 | 195 | 23 | 300 / 302 | 31.0 % |
| 1194 | 1 | 111 | 154 | 3 | 151 | 263 | 263 | 57 | 0 | 0 | 0 | 0 | 198 | 8 | 300 / 302 | 21.7 % |
| 1195 | 1 | 147 | 156 | 3 | 153 | 404 | 404 | 142 | 0 | 0 | 0 | 0 | 226 | 36 | 300 / 302 | 35.1 % |

Lookup ms by result (p50 / p95, n): hit 220 / 297 (2072); timeout 300 / 310 (3590); other 0 / 0 (706). Whole capture: hit 2072, miss 0, stale 0, invalid 0, error 0, timeout 3590, other 706.

| minute | lookups | hit | miss | stale | invalid | error | timeout | other |
|---|---|---|---|---|---|---|---|---|
| 20:24 | 1124 | 367 | 0 | 0 | 0 | 0 | 595 | 162 |
| 20:25 | 1213 | 409 | 0 | 0 | 0 | 0 | 633 | 171 |
| 20:26 | 1955 | 663 | 0 | 0 | 0 | 0 | 1072 | 220 |
| 20:27 | 2076 | 633 | 0 | 0 | 0 | 0 | 1290 | 153 |

### Admin writes (`[liveWriter]`)

| route | saves | acquire ms p50 / p95 | exec ms p50 / p95 | ok=false | failed kinds |
|---|---|---|---|---|---|
| admin-insert-after | 5 | 4 / 22 | 211 / 259 | 0 | — |
| admin-update | 8 | 3 / 60 | 69 / 149 | 0 | — |
| admin-delete | 5 | 4 / 486 | 35 / 42 | 0 | — |

### Per minute

| minute | requests | distinct instances | builds | EMAXCONN |
|---|---|---|---|---|
| 20:23 | 297 | 50 | 112 | 0 |
| 20:24 | 3508 | 58 | 988 | 0 |
| 20:25 | 2772 | 31 | 929 | 0 |
| 20:26 | 3529 | 44 | 1091 | 0 |
| 20:27 | 2749 | 47 | 849 | 0 |

### Prisma pool totals per 5 s (app-side estimate of pooler clients)

Peak carried sum: **92** (carry 5 s). "reported" = instances that logged in the bucket (max total each); "carried" also counts an instance's last total for 5 s after its last line.

| bucket | reporting instances | Σ total (reported) | instances (carried) | Σ total (carried) | max waiting |
|---|---|---|---|---|---|
| 20:23:50 | 1 | 1 | 1 | 1 | 0 |
| 20:23:55 | 50 | 68 | 50 | 68 | 1 |
| 20:24:00 | 54 | 77 | 54 | 77 | 0 |
| 20:24:05 | 49 | 63 | 57 | 78 | 0 |
| 20:24:10 | 8 | 10 | 49 | 63 | 0 |
| 20:24:15 | 5 | 8 | 8 | 11 | 0 |
| 20:24:20 | 45 | 75 | 45 | 75 | 0 |
| 20:24:25 | 17 | 29 | 45 | 73 | 0 |
| 20:24:30 | 7 | 7 | 17 | 19 | 0 |
| 20:24:35 | 6 | 10 | 7 | 11 | 0 |
| 20:24:40 | 5 | 10 | 6 | 11 | 0 |
| 20:24:45 | 34 | 54 | 34 | 54 | 0 |
| 20:24:50 | 11 | 18 | 34 | 52 | 0 |
| 20:24:55 | 6 | 9 | 11 | 16 | 0 |
| 20:25:00 | 5 | 10 | 6 | 11 | 0 |
| 20:25:05 | 4 | 8 | 5 | 10 | 0 |
| 20:25:10 | 31 | 58 | 31 | 58 | 2 |
| 20:25:15 | 10 | 19 | 31 | 58 | 0 |
| 20:25:20 | 9 | 16 | 10 | 17 | 0 |
| 20:25:25 | 6 | 12 | 9 | 17 | 0 |
| 20:25:30 | 5 | 7 | 6 | 9 | 0 |
| 20:25:35 | 30 | 54 | 30 | 54 | 0 |
| 20:25:40 | 14 | 27 | 30 | 53 | 1 |
| 20:25:45 | 11 | 15 | 14 | 18 | 0 |
| 20:25:50 | 7 | 10 | 11 | 15 | 0 |
| 20:25:55 | 6 | 10 | 7 | 12 | 0 |
| 20:26:00 | 31 | 47 | 31 | 47 | 1 |
| 20:26:05 | 16 | 29 | 31 | 45 | 0 |
| 20:26:10 | 11 | 11 | 16 | 17 | 0 |
| 20:26:15 | 6 | 6 | 11 | 11 | 0 |
| 20:26:20 | 5 | 9 | 6 | 10 | 0 |
| 20:26:25 | 35 | 60 | 35 | 60 | 0 |
| 20:26:30 | 14 | 27 | 35 | 59 | 0 |
| 20:26:35 | 12 | 15 | 14 | 19 | 0 |
| 20:26:40 | 10 | 13 | 12 | 15 | 0 |
| 20:26:45 | 9 | 11 | 10 | 12 | 0 |
| 20:26:50 | 43 | 82 | 43 | 82 | 1 |
| 20:26:55 | 18 | 35 | 43 | 82 | 0 |
| 20:27:00 | 10 | 12 | 18 | 26 | 0 |
| 20:27:05 | 8 | 10 | 10 | 12 | 0 |
| 20:27:10 | 6 | 7 | 8 | 9 | 0 |
| 20:27:15 | 39 | 65 | 39 | 65 | 1 |
| 20:27:20 | 47 | 92 | 47 | 92 | 1 |
| 20:27:25 | 3 | 6 | 47 | 92 | 0 |

### Other lines

| kind | count |
|---|---|
| [liveWarm] fault | 48 |
| untagged: No logs found for opensetlist-projects/opensetlist | 4 |
