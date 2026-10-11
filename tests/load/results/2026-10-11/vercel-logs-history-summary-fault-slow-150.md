## Vercel runtime logs — 2026-10-11T202753Z-vercel-logs-history-fault-slow-150.txt

13698 entries; requests: /api/setlist 13046, other API 220, pages 432; error-level entries 0. Times: log clock +7 h.

### Builds per rev (`[liveSnapshot] build` lines: 1907)

| rev | builds | distinct instances | locales | build ms avg / max | first – last |
|---|---|---|---|---|---|
| 1196 | 1 | 1 | ko 1 | 456 / 456 | 20:28:27 – 20:28:27 |
| 1197 | 326 | 32 | ja 200, en 45, ko 81 | 114 / 663 | 20:28:30 – 20:28:55 |
| 1198 | 17 | 5 | ja 9, ko 4, en 4 | 61 / 101 | 20:28:54 – 20:28:55 |
| 1199 | 234 | 25 | ko 49, en 26, ja 159 | 68 / 668 | 20:28:55 – 20:29:20 |
| 1200 | 178 | 15 | en 23, ko 39, ja 116 | 53 / 532 | 20:29:20 – 20:29:45 |
| 1201 | 9 | 3 | ja 4, ko 2, en 3 | 49 / 76 | 20:29:44 – 20:29:45 |
| 1202 | 174 | 14 | ja 105, ko 48, en 21 | 50 / 141 | 20:29:45 – 20:30:10 |
| 1203 | 189 | 8 | en 23, ja 124, ko 42 | 49 / 118 | 20:30:10 – 20:30:34 |
| 1204 | 18 | 9 | ja 10, ko 5, en 3 | 62 / 130 | 20:30:34 – 20:30:36 |
| 1205 | 228 | 25 | ja 149, ko 52, en 27 | 66 / 760 | 20:30:35 – 20:31:00 |
| 1206 | 199 | 17 | ja 130, ko 44, en 25 | 51 / 506 | 20:31:00 – 20:31:25 |
| 1207 | 7 | 4 | ko 3, en 2, ja 2 | 46 / 51 | 20:31:24 – 20:31:25 |
| 1208 | 184 | 21 | ja 121, en 23, ko 40 | 65 / 813 | 20:31:25 – 20:31:49 |
| 1209 | 36 | 10 | ja 24, en 5, ko 7 | 58 / 535 | 20:31:50 – 20:31:53 |
| 1210 | 10 | 6 | en 3, ko 3, ja 4 | 46 / 70 | 20:31:53 – 20:31:54 |
| 1211 | 10 | 8 | ja 4, en 3, ko 3 | 56 / 101 | 20:31:54 – 20:31:54 |
| 1212 | 5 | 3 | en 3, ja 1, ko 1 | 50 / 63 | 20:31:54 – 20:31:54 |
| 1213 | 42 | 23 | ja 31, ko 8, en 3 | 62 / 584 | 20:31:54 – 20:31:55 |
| 1214 | 40 | 22 | ja 28, ko 7, en 5 | 116 / 617 | 20:31:55 – 20:31:57 |

### Failures, repair reads, coalescing

| what | count | detail |
|---|---|---|
| EMAXCONN (pooler client cap) | 0 | API 0, SSR 0 |
| `[liveSnapshot] build-failed` | 0 | — |
| `[liveSnapshot] rev-read` (repair revision read) | 0 | rev=timeout 0, rev=error 0; ms p50 — / max —; by hint: — |
| `[liveSnapshot] coalesced` | 69 | waiters sum 159, max 7 |
| `[setlist] slow-hit` | 0 | max — ms |

### Hint outcomes (`[setlist] hint-fetch` lines: 7250)

Whole capture: satisfied 7250, fresh 0, memo 0, deferred 0, none 0, error 0, other 0. "other" = a `verify=` value this script does not know.

| minute | hint fetches | satisfied | fresh | memo | deferred | none | error | other |
|---|---|---|---|---|---|---|---|---|
| 20:28 | 908 | 908 | 0 | 0 | 0 | 0 | 0 | 0 |
| 20:29 | 1464 | 1464 | 0 | 0 | 0 | 0 | 0 | 0 |
| 20:30 | 1453 | 1453 | 0 | 0 | 0 | 0 | 0 | 0 |
| 20:31 | 3425 | 3425 | 0 | 0 | 0 | 0 | 0 | 0 |

### Warming (`[liveWarm]` jobs: 18; `[setlist] warm-lookup` lines: 7250)

**warm hit rate = hits ÷ hinted fetches = 7214 / 7250 = 99.5 %** (hinted fetches = `[setlist] hint-fetch` lines with a numeric minRev; lookups 7250).

schedule-failed 0; job-failed 0; set ok=false 0 (set-error lines 0); skips 0; lookup-error lines 0; warm builds matched 54.

Warm jobs. start → done = the job's own `done ms=` (it starts in `after()`, i.e. right after the save's response, so it is ≈ warm-complete − commit). Per locale: actual rev, bytes, build / set ms, ok.

| save rev | instance | start (log clock) | start → done ms | sets | skips | warm builds (unmatched) | job-failed |
|---|---|---|---|---|---|---|---|
| 1197 | e5539e1c | 20:28:30 | 153 | ko r1197 80830 B 58/22 ms; ja r1197 67230 B 91/16 ms; en r1197 79463 B 60/10 ms | — | 3 | — |
| 1198 | d0d17594 | 20:28:54 | 157 | en r1198 100630 B 70/8 ms; ja r1198 85188 B 61/13 ms; ko r1198 102444 B 69/10 ms | — | 3 | — |
| 1199 | b8af25a6 | 20:28:55 | 95 | ja r1199 67842 B 37/11 ms; ko r1199 81510 B 66/6 ms; en r1199 80134 B 40/6 ms | — | 3 | — |
| 1200 | d0d17594 | 20:29:20 | 87 | ko r1200 60685 B 39/6 ms; ja r1200 50532 B 47/5 ms; en r1200 59745 B 37/5 ms | — | 3 | — |
| 1201 | ef533b5b | 20:29:44 | 144 | ja r1201 68490 B 67/14 ms; ko r1201 82299 B 78/14 ms; en r1201 80912 B 55/7 ms | — | 3 | — |
| 1202 | 401bd520 | 20:29:45 | 227 | ko r1202 61480 B 63/13 ms; ja r1202 51186 B 115/37 ms; en r1202 60530 B 142/8 ms | — | 3 | — |
| 1203 | ef533b5b | 20:30:10 | 137 | ko r1203 61471 B 41/6 ms; ja r1203 51183 B 72/12 ms; en r1203 60525 B 84/5 ms | — | 3 | — |
| 1204 | ef533b5b | 20:30:34 | 216 | ja r1204 69141 B 42/6 ms; ko r1204 83085 B 57/7 ms; en r1204 81692 B 143/25 ms | — | 3 | — |
| 1205 | 7215ae77 | 20:30:35 | 316 | ko r1205 62239 B 117/49 ms; ja r1205 51813 B 198/13 ms; en r1205 61281 B 127/22 ms | — | 3 | — |
| 1206 | 19131805 | 20:31:00 | 106 | ko r1206 62254 B 52/6 ms; ja r1206 51825 B 75/5 ms; en r1206 61296 B 40/6 ms | — | 3 | — |
| 1207 | 19131805 | 20:31:24 | 100 | ja r1207 69783 B 42/5 ms; ko r1207 83868 B 51/7 ms; en r1207 82463 B 47/6 ms | — | 3 | — |
| 1208 | 7eaca367 | 20:31:25 | 193 | ko r1208 63034 B 106/14 ms; ja r1208 52470 B 144/5 ms; en r1208 62069 B 47/5 ms | — | 3 | — |
| 1209 | 19131805 | 20:31:50 | 88 | ko r1209 63040 B 39/7 ms; ja r1209 52467 B 54/4 ms; en r1209 62070 B 37/5 ms | — | 3 | — |
| 1210 | d080a704 | 20:31:53 | 98 | ja r1210 51823 B 42/8 ms; ko r1210 62261 B 47/9 ms; en r1210 61298 B 41/7 ms | — | 3 | — |
| 1211 | 93b95eaf | 20:31:54 | 131 | ko r1211 61494 B 78/10 ms; ja r1211 51194 B 102/5 ms; en r1211 60543 B 38/5 ms | — | 3 | — |
| 1212 | d080a704 | 20:31:54 | 116 | ja r1212 50541 B 44/10 ms; ko r1212 60700 B 51/37 ms; en r1212 59759 B 56/6 ms | — | 3 | — |
| 1213 | ef02f0cd | 20:31:54 | 90 | ko r1213 60021 B 39/6 ms; ja r1213 49930 B 48/6 ms; en r1213 59089 B 37/7 ms | — | 3 | — |
| 1214 | 73fa94d1 | 20:31:55 | 216 | ko r1214 59221 B 116/8 ms; ja r1214 49277 B 122/13 ms; en r1214 58301 B 81/10 ms | — | 3 | — |

Per save rev. builds = every `[liveSnapshot] build` at that rev; warm = the ones matched to a warm job (same instance, locale, rev); reader = the rest. Lookups and hinted fetches are keyed by their `minRev`.

| save rev | warm jobs | start → done ms | builds | warm | reader | hinted fetches | lookups | hit | miss | stale | invalid | error | timeout | other | lookup ms p50 / p95 | hit rate |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1197 | 1 | 153 | 326 | 3 | 323 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — / — | — |
| 1198 | 1 | 157 | 17 | 3 | 14 | 471 | 471 | 470 | 0 | 0 | 0 | 0 | 1 | 0 | 137 / 176 | 99.8 % |
| 1199 | 1 | 95 | 234 | 3 | 231 | 437 | 437 | 430 | 0 | 0 | 0 | 0 | 7 | 0 | 138 / 178 | 98.4 % |
| 1200 | 1 | 87 | 178 | 3 | 175 | 484 | 484 | 479 | 0 | 0 | 0 | 0 | 5 | 0 | 122 / 168 | 99.0 % |
| 1201 | 1 | 144 | 9 | 3 | 6 | 490 | 490 | 490 | 0 | 0 | 0 | 0 | 0 | 0 | 126 / 169 | 100.0 % |
| 1202 | 1 | 227 | 174 | 3 | 171 | 490 | 490 | 490 | 0 | 0 | 0 | 0 | 0 | 0 | 128 / 170 | 100.0 % |
| 1203 | 1 | 137 | 189 | 3 | 186 | 491 | 491 | 491 | 0 | 0 | 0 | 0 | 0 | 0 | 130 / 167 | 100.0 % |
| 1204 | 1 | 216 | 18 | 3 | 15 | 483 | 483 | 483 | 0 | 0 | 0 | 0 | 0 | 0 | 130 / 172 | 100.0 % |
| 1205 | 1 | 316 | 228 | 3 | 225 | 479 | 479 | 474 | 0 | 0 | 0 | 0 | 4 | 1 | 121 / 174 | 99.0 % |
| 1206 | 1 | 106 | 199 | 3 | 196 | 487 | 487 | 487 | 0 | 0 | 0 | 0 | 0 | 0 | 128 / 168 | 100.0 % |
| 1207 | 1 | 100 | 7 | 3 | 4 | 489 | 489 | 489 | 0 | 0 | 0 | 0 | 0 | 0 | 120 / 170 | 100.0 % |
| 1208 | 1 | 193 | 184 | 3 | 181 | 473 | 473 | 465 | 0 | 0 | 0 | 0 | 8 | 0 | 118 / 171 | 98.3 % |
| 1209 | 1 | 88 | 36 | 3 | 33 | 486 | 486 | 485 | 0 | 0 | 0 | 0 | 1 | 0 | 126 / 169 | 99.8 % |
| 1210 | 1 | 98 | 10 | 3 | 7 | 361 | 361 | 361 | 0 | 0 | 0 | 0 | 0 | 0 | 122 / 164 | 100.0 % |
| 1211 | 1 | 131 | 10 | 3 | 7 | 126 | 126 | 126 | 0 | 0 | 0 | 0 | 0 | 0 | 138 / 167 | 100.0 % |
| 1212 | 1 | 116 | 5 | 3 | 2 | 42 | 42 | 42 | 0 | 0 | 0 | 0 | 0 | 0 | 157 / 160 | 100.0 % |
| 1213 | 1 | 90 | 42 | 3 | 39 | 475 | 475 | 470 | 0 | 0 | 0 | 0 | 5 | 0 | 129 / 163 | 98.9 % |
| 1214 | 1 | 216 | 40 | 3 | 37 | 486 | 486 | 482 | 0 | 0 | 0 | 0 | 4 | 0 | 120 / 162 | 99.2 % |

Lookup ms by result (p50 / p95, n): hit 127 / 169 (7214); timeout 334 / 522 (35); other 0 / 0 (1). Whole capture: hit 7214, miss 0, stale 0, invalid 0, error 0, timeout 35, other 1.

| minute | lookups | hit | miss | stale | invalid | error | timeout | other |
|---|---|---|---|---|---|---|---|---|
| 20:28 | 908 | 900 | 0 | 0 | 0 | 0 | 8 | 0 |
| 20:29 | 1464 | 1459 | 0 | 0 | 0 | 0 | 5 | 0 |
| 20:30 | 1453 | 1448 | 0 | 0 | 0 | 0 | 4 | 1 |
| 20:31 | 3425 | 3407 | 0 | 0 | 0 | 0 | 18 | 0 |

### Admin writes (`[liveWriter]`)

| route | saves | acquire ms p50 / p95 | exec ms p50 / p95 | ok=false | failed kinds |
|---|---|---|---|---|---|
| admin-insert-after | 5 | 4 / 5 | 180 / 280 | 0 | — |
| admin-update | 8 | 3 / 5 | 140 / 172 | 0 | — |
| admin-delete | 5 | 3 / 4 | 27 / 134 | 0 | — |

### Per minute

| minute | requests | distinct instances | builds | EMAXCONN |
|---|---|---|---|---|
| 20:28 | 2669 | 40 | 433 | 0 |
| 20:29 | 3090 | 39 | 440 | 0 |
| 20:30 | 2998 | 65 | 495 | 0 |
| 20:31 | 4941 | 44 | 539 | 0 |

### Prisma pool totals per 5 s (app-side estimate of pooler clients)

Peak carried sum: **51** (carry 5 s). "reported" = instances that logged in the bucket (max total each); "carried" also counts an instance's last total for 5 s after its last line.

| bucket | reporting instances | Σ total (reported) | instances (carried) | Σ total (carried) | max waiting |
|---|---|---|---|---|---|
| 20:28:25 | 1 | 1 | 1 | 1 | 0 |
| 20:28:30 | 30 | 42 | 30 | 42 | 0 |
| 20:28:35 | 32 | 51 | 32 | 51 | 0 |
| 20:28:40 | 26 | 38 | 32 | 48 | 0 |
| 20:28:45 | 6 | 7 | 26 | 36 | 0 |
| 20:28:50 | 5 | 9 | 6 | 10 | 0 |
| 20:28:55 | 25 | 31 | 25 | 31 | 0 |
| 20:29:00 | 7 | 8 | 25 | 29 | 0 |
| 20:29:05 | 4 | 4 | 7 | 7 | 0 |
| 20:29:10 | 4 | 6 | 4 | 6 | 0 |
| 20:29:15 | 4 | 7 | 5 | 8 | 0 |
| 20:29:20 | 15 | 21 | 15 | 21 | 0 |
| 20:29:25 | 5 | 8 | 15 | 21 | 0 |
| 20:29:30 | 4 | 7 | 5 | 9 | 0 |
| 20:29:35 | 5 | 10 | 5 | 10 | 0 |
| 20:29:40 | 4 | 8 | 5 | 10 | 0 |
| 20:29:45 | 15 | 19 | 15 | 19 | 0 |
| 20:29:50 | 4 | 7 | 15 | 19 | 0 |
| 20:29:55 | 4 | 7 | 5 | 9 | 0 |
| 20:30:00 | 3 | 6 | 4 | 8 | 0 |
| 20:30:05 | 4 | 7 | 4 | 7 | 0 |
| 20:30:10 | 7 | 11 | 7 | 11 | 1 |
| 20:30:15 | 7 | 12 | 8 | 14 | 0 |
| 20:30:20 | 6 | 10 | 7 | 12 | 0 |
| 20:30:25 | 4 | 7 | 6 | 10 | 0 |
| 20:30:30 | 4 | 7 | 4 | 7 | 1 |
| 20:30:35 | 26 | 30 | 26 | 30 | 0 |
| 20:30:40 | 7 | 9 | 26 | 29 | 0 |
| 20:30:45 | 6 | 8 | 7 | 9 | 0 |
| 20:30:50 | 5 | 8 | 6 | 10 | 0 |
| 20:30:55 | 5 | 9 | 5 | 9 | 0 |
| 20:31:00 | 17 | 21 | 17 | 21 | 0 |
| 20:31:05 | 7 | 8 | 17 | 20 | 0 |
| 20:31:10 | 6 | 7 | 7 | 8 | 0 |
| 20:31:15 | 5 | 8 | 6 | 9 | 0 |
| 20:31:20 | 4 | 7 | 5 | 9 | 0 |
| 20:31:25 | 22 | 28 | 22 | 28 | 0 |
| 20:31:30 | 8 | 10 | 22 | 27 | 0 |
| 20:31:35 | 6 | 9 | 8 | 11 | 0 |
| 20:31:40 | 4 | 8 | 6 | 11 | 0 |
| 20:31:45 | 4 | 7 | 4 | 7 | 0 |
| 20:31:50 | 16 | 21 | 17 | 23 | 0 |
| 20:31:55 | 29 | 40 | 30 | 41 | 0 |

### Other lines

| kind | count |
|---|---|
| [liveWarm] fault | 65 |
| untagged: No logs found for opensetlist-projects/opensetlist | 4 |
