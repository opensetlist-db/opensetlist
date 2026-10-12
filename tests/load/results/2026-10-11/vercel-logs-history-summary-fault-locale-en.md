## Vercel runtime logs — 2026-10-11T200938Z-vercel-logs-history-fault-locale-en.txt

13442 entries; requests: /api/setlist 12792, other API 218, pages 432; error-level entries 0. Times: log clock +7 h.

### Builds per rev (`[liveSnapshot] build` lines: 2624)

| rev | builds | distinct instances | locales | build ms avg / max | first – last |
|---|---|---|---|---|---|
| 1120 | 1 | 1 | ko 1 | 482 / 482 | 20:10:12 – 20:10:12 |
| 1121 | 547 | 41 | ko 122, ja 342, en 83 | 238 / 1450 | 20:10:15 – 20:10:40 |
| 1122 | 25 | 10 | en 12, ko 3, ja 10 | 63 / 151 | 20:10:40 – 20:10:41 |
| 1123 | 324 | 41 | ja 181, en 74, ko 69 | 77 / 621 | 20:10:40 – 20:11:06 |
| 1124 | 227 | 21 | ja 134, ko 33, en 60 | 48 / 120 | 20:11:06 – 20:11:30 |
| 1125 | 22 | 13 | en 18, ja 3, ko 1 | 71 / 107 | 20:11:30 – 20:11:31 |
| 1126 | 251 | 32 | ja 143, ko 39, en 69 | 59 / 564 | 20:11:30 – 20:11:56 |
| 1127 | 236 | 26 | ko 49, en 64, ja 123 | 54 / 519 | 20:11:56 – 20:12:20 |
| 1128 | 24 | 12 | en 15, ko 3, ja 6 | 59 / 112 | 20:12:20 – 20:12:21 |
| 1129 | 250 | 33 | en 67, ko 40, ja 143 | 66 / 693 | 20:12:20 – 20:12:46 |
| 1130 | 207 | 18 | en 62, ja 111, ko 34 | 50 / 145 | 20:12:46 – 20:13:09 |
| 1131 | 18 | 11 | en 11, ja 5, ko 2 | 76 / 149 | 20:13:10 – 20:13:11 |
| 1132 | 251 | 29 | ja 150, en 55, ko 46 | 53 / 559 | 20:13:10 – 20:13:36 |
| 1133 | 83 | 26 | ja 29, en 47, ko 7 | 57 / 142 | 20:13:36 – 20:13:38 |
| 1134 | 16 | 13 | en 10, ko 3, ja 3 | 51 / 65 | 20:13:38 – 20:13:39 |
| 1135 | 38 | 23 | en 30, ko 4, ja 4 | 63 / 98 | 20:13:38 – 20:13:39 |
| 1136 | 7 | 5 | ja 2, ko 2, en 3 | 59 / 92 | 20:13:39 – 20:13:39 |
| 1137 | 27 | 21 | ja 11, en 14, ko 2 | 65 / 112 | 20:13:39 – 20:13:40 |
| 1138 | 70 | 34 | ko 11, ja 29, en 30 | 82 / 565 | 20:13:40 – 20:13:42 |

### Failures, repair reads, coalescing

| what | count | detail |
|---|---|---|
| EMAXCONN (pooler client cap) | 0 | API 0, SSR 0 |
| `[liveSnapshot] build-failed` | 0 | — |
| `[liveSnapshot] rev-read` (repair revision read) | 0 | rev=timeout 0, rev=error 0; ms p50 — / max —; by hint: — |
| `[liveSnapshot] coalesced` | 156 | waiters sum 334, max 4 |
| `[setlist] slow-hit` | 0 | max — ms |

### Hint outcomes (`[setlist] hint-fetch` lines: 7036)

Whole capture: satisfied 7036, fresh 0, memo 0, deferred 0, none 0, error 0, other 0. "other" = a `verify=` value this script does not know.

| minute | hint fetches | satisfied | fresh | memo | deferred | none | error | other |
|---|---|---|---|---|---|---|---|---|
| 20:10 | 884 | 884 | 0 | 0 | 0 | 0 | 0 | 0 |
| 20:11 | 1925 | 1925 | 0 | 0 | 0 | 0 | 0 | 0 |
| 20:12 | 1417 | 1417 | 0 | 0 | 0 | 0 | 0 | 0 |
| 20:13 | 2810 | 2810 | 0 | 0 | 0 | 0 | 0 | 0 |

### Warming (`[liveWarm]` jobs: 18; `[setlist] warm-lookup` lines: 7036)

**warm hit rate = hits ÷ hinted fetches = 6460 / 7036 = 91.8 %** (hinted fetches = `[setlist] hint-fetch` lines with a numeric minRev; lookups 7036).

schedule-failed 0; job-failed 0; set ok=false 0 (set-error lines 0); skips fault-locale 18; lookup-error lines 0; warm builds matched 36.

Warm jobs. start → done = the job's own `done ms=` (it starts in `after()`, i.e. right after the save's response, so it is ≈ warm-complete − commit). Per locale: actual rev, bytes, build / set ms, ok.

| save rev | instance | start (log clock) | start → done ms | sets | skips | warm builds (unmatched) | job-failed |
|---|---|---|---|---|---|---|---|
| 1121 | a6ef691a | 20:10:15 | 83 | ko r1121 80830 B 52/10 ms; ja r1121 67230 B 75/7 ms | en fault-locale 0 ms | 2 | — |
| 1122 | 72fd67d9 | 20:10:40 | 90 | ko r1122 102444 B 50/7 ms; ja r1122 85188 B 84/5 ms | en fault-locale 0 ms | 2 | — |
| 1123 | b163b96e | 20:10:40 | 141 | ko r1123 81501 B 99/38 ms; ja r1123 67836 B 106/32 ms | en fault-locale 0 ms | 2 | — |
| 1124 | 1820d149 | 20:11:06 | 68 | ja r1124 51185 B 52/11 ms; ko r1124 61598 B 60/7 ms | en fault-locale 0 ms | 2 | — |
| 1125 | 4c2e0e7d | 20:11:30 | 70 | ko r1125 83212 B 39/7 ms; ja r1125 69143 B 49/19 ms | en fault-locale 0 ms | 2 | — |
| 1126 | 1a0b5043 | 20:11:30 | 69 | ko r1126 62364 B 52/13 ms; ja r1126 51885 B 58/10 ms | en fault-locale 0 ms | 2 | — |
| 1127 | 04aa72a3 | 20:11:56 | 72 | ja r1127 51222 B 57/6 ms; ko r1127 61409 B 66/5 ms | en fault-locale 0 ms | 2 | — |
| 1128 | af40a90b | 20:12:20 | 74 | ja r1128 69180 B 50/14 ms; ko r1128 83023 B 60/13 ms | en fault-locale 0 ms | 2 | — |
| 1129 | f453d02b | 20:12:20 | 120 | ko r1129 62365 B 60/12 ms; ja r1129 51997 B 98/22 ms | en fault-locale 0 ms | 2 | — |
| 1130 | 488e1f6b | 20:12:46 | 76 | ko r1130 63006 B 48/15 ms; ja r1130 52488 B 58/17 ms | en fault-locale 0 ms | 2 | — |
| 1131 | 1a0b5043 | 20:13:10 | 59 | ko r1131 84620 B 40/12 ms; ja r1131 70446 B 49/9 ms | en fault-locale 0 ms | 2 | — |
| 1132 | 5ca6d0c9 | 20:13:10 | 104 | ko r1132 63956 B 63/11 ms; ja r1132 53263 B 77/26 ms | en fault-locale 0 ms | 2 | — |
| 1133 | 5ca6d0c9 | 20:13:36 | 77 | ko r1133 63252 B 41/8 ms; ja r1133 52747 B 71/6 ms | en fault-locale 0 ms | 2 | — |
| 1134 | 103aa275 | 20:13:38 | 54 | ko r1134 62303 B 39/9 ms; ja r1134 51973 B 46/7 ms | en fault-locale 0 ms | 2 | — |
| 1135 | f0d0d39d | 20:13:38 | 78 | ko r1135 61348 B 54/10 ms; ja r1135 51199 B 71/6 ms | en fault-locale 0 ms | 2 | — |
| 1136 | cffbabd5 | 20:13:39 | 66 | ko r1136 60583 B 49/10 ms; ja r1136 50500 B 56/9 ms | en fault-locale 0 ms | 2 | — |
| 1137 | 30454506 | 20:13:39 | 60 | ko r1137 59913 B 38/8 ms; ja r1137 49895 B 54/5 ms | en fault-locale 0 ms | 2 | — |
| 1138 | c73a3407 | 20:13:40 | 134 | ja r1138 49277 B 101/7 ms; ko r1138 59221 B 122/11 ms | en fault-locale 0 ms | 2 | — |

Per save rev. builds = every `[liveSnapshot] build` at that rev; warm = the ones matched to a warm job (same instance, locale, rev); reader = the rest. Lookups and hinted fetches are keyed by their `minRev`.

| save rev | warm jobs | start → done ms | builds | warm | reader | hinted fetches | lookups | hit | miss | stale | invalid | error | timeout | other | lookup ms p50 / p95 | hit rate |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1121 | 1 | 83 | 547 | 2 | 545 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — / — | — |
| 1122 | 1 | 90 | 25 | 2 | 23 | 473 | 473 | 426 | 33 | 0 | 0 | 0 | 1 | 13 | 11 / 43 | 90.1 % |
| 1123 | 1 | 141 | 324 | 2 | 322 | 411 | 411 | 397 | 13 | 0 | 0 | 0 | 0 | 1 | 9 / 18 | 96.6 % |
| 1124 | 1 | 68 | 227 | 2 | 225 | 486 | 486 | 438 | 29 | 0 | 0 | 0 | 0 | 19 | 8 / 25 | 90.1 % |
| 1125 | 1 | 70 | 22 | 2 | 20 | 496 | 496 | 446 | 38 | 0 | 0 | 0 | 0 | 12 | 10 / 38 | 89.9 % |
| 1126 | 1 | 69 | 251 | 2 | 249 | 456 | 456 | 434 | 17 | 0 | 0 | 0 | 0 | 5 | 8 / 11 | 95.2 % |
| 1127 | 1 | 72 | 236 | 2 | 234 | 487 | 487 | 442 | 30 | 0 | 0 | 0 | 0 | 15 | 8 / 23 | 90.8 % |
| 1128 | 1 | 74 | 24 | 2 | 22 | 483 | 483 | 437 | 30 | 0 | 0 | 0 | 0 | 16 | 9 / 22 | 90.5 % |
| 1129 | 1 | 120 | 250 | 2 | 248 | 442 | 442 | 420 | 20 | 0 | 0 | 0 | 0 | 2 | 8 / 19 | 95.0 % |
| 1130 | 1 | 76 | 207 | 2 | 205 | 492 | 492 | 443 | 29 | 0 | 0 | 0 | 0 | 20 | 8 / 17 | 90.0 % |
| 1131 | 1 | 59 | 18 | 2 | 16 | 487 | 487 | 440 | 27 | 0 | 0 | 0 | 0 | 20 | 9 / 21 | 90.3 % |
| 1132 | 1 | 104 | 251 | 2 | 249 | 452 | 452 | 432 | 16 | 0 | 0 | 0 | 0 | 4 | 8 / 11 | 95.6 % |
| 1133 | 1 | 77 | 83 | 2 | 81 | 487 | 487 | 439 | 32 | 0 | 0 | 0 | 0 | 16 | 7 / 18 | 90.1 % |
| 1134 | 1 | 54 | 16 | 2 | 14 | 343 | 343 | 309 | 21 | 0 | 0 | 0 | 0 | 13 | 7 / 11 | 90.1 % |
| 1135 | 1 | 78 | 38 | 2 | 36 | 151 | 151 | 135 | 12 | 0 | 0 | 0 | 0 | 4 | 7 / 13 | 89.4 % |
| 1136 | 1 | 66 | 7 | 2 | 5 | 70 | 70 | 61 | 8 | 0 | 0 | 0 | 0 | 1 | 7 / 9 | 87.1 % |
| 1137 | 1 | 60 | 27 | 2 | 25 | 376 | 376 | 341 | 28 | 0 | 0 | 0 | 0 | 7 | 7 / 16 | 90.7 % |
| 1138 | 1 | 134 | 70 | 2 | 68 | 444 | 444 | 420 | 19 | 0 | 0 | 0 | 0 | 5 | 7 / 9 | 94.6 % |

Lookup ms by result (p50 / p95, n): hit 8 / 21 (6460); miss 3 / 18 (402); timeout 316 / 316 (1); other 0 / 0 (173). Whole capture: hit 6460, miss 402, stale 0, invalid 0, error 0, timeout 1, other 173.

| minute | lookups | hit | miss | stale | invalid | error | timeout | other |
|---|---|---|---|---|---|---|---|---|
| 20:10 | 884 | 823 | 46 | 0 | 0 | 0 | 1 | 14 |
| 20:11 | 1925 | 1760 | 114 | 0 | 0 | 0 | 0 | 51 |
| 20:12 | 1417 | 1300 | 79 | 0 | 0 | 0 | 0 | 38 |
| 20:13 | 2810 | 2577 | 163 | 0 | 0 | 0 | 0 | 70 |

### Admin writes (`[liveWriter]`)

| route | saves | acquire ms p50 / p95 | exec ms p50 / p95 | ok=false | failed kinds |
|---|---|---|---|---|---|
| admin-insert-after | 5 | 3 / 4 | 181 / 184 | 0 | — |
| admin-update | 8 | 3 / 10 | 87 / 174 | 0 | — |
| admin-delete | 5 | 3 / 7 | 34 / 41 | 0 | — |

### Per minute

| minute | requests | distinct instances | builds | EMAXCONN |
|---|---|---|---|---|
| 20:10 | 2947 | 55 | 836 | 0 |
| 20:11 | 3604 | 60 | 636 | 0 |
| 20:12 | 2995 | 51 | 558 | 0 |
| 20:13 | 3896 | 43 | 594 | 0 |

### Prisma pool totals per 5 s (app-side estimate of pooler clients)

Peak carried sum: **76** (carry 5 s). "reported" = instances that logged in the bucket (max total each); "carried" also counts an instance's last total for 5 s after its last line.

| bucket | reporting instances | Σ total (reported) | instances (carried) | Σ total (carried) | max waiting |
|---|---|---|---|---|---|
| 20:10:10 | 1 | 1 | 1 | 1 | 0 |
| 20:10:15 | 37 | 54 | 37 | 54 | 1 |
| 20:10:20 | 38 | 72 | 38 | 72 | 4 |
| 20:10:25 | 19 | 33 | 41 | 76 | 0 |
| 20:10:30 | 9 | 10 | 20 | 27 | 0 |
| 20:10:35 | 9 | 12 | 9 | 12 | 0 |
| 20:10:40 | 41 | 56 | 41 | 56 | 0 |
| 20:10:45 | 15 | 22 | 41 | 53 | 0 |
| 20:10:50 | 6 | 8 | 15 | 20 | 0 |
| 20:10:55 | 5 | 10 | 6 | 11 | 0 |
| 20:11:00 | 5 | 9 | 5 | 9 | 0 |
| 20:11:05 | 21 | 27 | 21 | 27 | 0 |
| 20:11:10 | 5 | 6 | 21 | 26 | 0 |
| 20:11:15 | 4 | 6 | 5 | 7 | 0 |
| 20:11:20 | 4 | 8 | 4 | 8 | 0 |
| 20:11:25 | 3 | 5 | 4 | 7 | 0 |
| 20:11:30 | 33 | 41 | 33 | 41 | 0 |
| 20:11:35 | 11 | 14 | 33 | 39 | 0 |
| 20:11:40 | 10 | 12 | 11 | 13 | 0 |
| 20:11:45 | 9 | 9 | 10 | 11 | 0 |
| 20:11:50 | 6 | 6 | 9 | 9 | 0 |
| 20:11:55 | 26 | 30 | 26 | 30 | 0 |
| 20:12:00 | 13 | 15 | 26 | 30 | 0 |
| 20:12:05 | 10 | 12 | 13 | 15 | 0 |
| 20:12:10 | 8 | 9 | 10 | 11 | 0 |
| 20:12:15 | 6 | 9 | 8 | 12 | 0 |
| 20:12:20 | 33 | 44 | 33 | 44 | 0 |
| 20:12:25 | 12 | 16 | 33 | 42 | 0 |
| 20:12:30 | 7 | 7 | 12 | 12 | 0 |
| 20:12:35 | 7 | 12 | 7 | 12 | 0 |
| 20:12:40 | 5 | 9 | 7 | 12 | 0 |
| 20:12:45 | 18 | 24 | 19 | 26 | 0 |
| 20:12:50 | 11 | 14 | 18 | 23 | 0 |
| 20:12:55 | 6 | 6 | 11 | 13 | 0 |
| 20:13:00 | 4 | 7 | 6 | 9 | 0 |
| 20:13:05 | 3 | 6 | 4 | 7 | 0 |
| 20:13:10 | 30 | 36 | 30 | 36 | 0 |
| 20:13:15 | 12 | 16 | 30 | 36 | 0 |
| 20:13:20 | 10 | 11 | 12 | 13 | 0 |
| 20:13:25 | 7 | 9 | 10 | 12 | 0 |
| 20:13:30 | 5 | 7 | 7 | 11 | 0 |
| 20:13:35 | 31 | 44 | 31 | 44 | 0 |
| 20:13:40 | 39 | 58 | 42 | 62 | 0 |

### Other lines

| kind | count |
|---|---|
| [liveWarm] fault | 60 |
| untagged: No logs found for opensetlist-projects/opensetlist | 4 |
