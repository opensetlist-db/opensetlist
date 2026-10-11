## Vercel runtime logs — 2026-10-11T09-12-10Z-vercel-logs-history-warm-spam.txt

10564 entries; requests: /api/setlist 9585, other API 114, pages 865; error-level entries 0. Times: log clock +7 h.

### Builds per rev (`[liveSnapshot] build` lines: 2528)

| rev | builds | distinct instances | locales | build ms avg / max | first – last |
|---|---|---|---|---|---|
| 884 | 621 | 23 | ja 402, ko 148, en 71 | 59 / 328 | 09:12:13 – 09:13:20 |
| 885 | 10 | 5 | ja 5, ko 4, en 1 | 47 / 89 | 09:13:19 – 09:13:20 |
| 886 | 1044 | 56 | ko 236, ja 690, en 118 | 130 / 630 | 09:13:20 – 09:13:45 |
| 887 | 42 | 22 | ja 27, en 8, ko 7 | 98 / 147 | 09:13:44 – 09:13:45 |
| 888 | 203 | 15 | en 20, ko 37, ja 146 | 48 / 115 | 09:13:45 – 09:14:09 |
| 889 | 11 | 5 | ja 8, ko 2, en 1 | 49 / 80 | 09:14:09 – 09:14:10 |
| 890 | 40 | 13 | ja 26, ko 10, en 4 | 51 / 90 | 09:14:10 – 09:14:13 |
| 891 | 8 | 5 | ja 6, ko 1, en 1 | 56 / 103 | 09:14:13 – 09:14:13 |
| 892 | 11 | 8 | ja 6, ko 4, en 1 | 63 / 103 | 09:14:13 – 09:14:14 |
| 893 | 31 | 18 | ja 19, en 3, ko 9 | 49 / 134 | 09:14:14 – 09:14:15 |
| 894 | 507 | 35 | ko 117, ja 340, en 50 | 123 / 367 | 09:14:20 – 09:14:35 |

### Failures, repair reads, coalescing

| what | count | detail |
|---|---|---|
| EMAXCONN (pooler client cap) | 0 | API 0, SSR 0 |
| `[liveSnapshot] build-failed` | 0 | — |
| `[liveSnapshot] rev-read` (repair revision read) | 695 | rev=timeout 0, rev=error 0; ms p50 16 / max 579; by hint: hint=1 595, hint=0 100 |
| `[liveSnapshot] coalesced` | 105 | waiters sum 244, max 5 |
| `[setlist] slow-hit` | 2 | max 639 ms |

### Hint outcomes (`[setlist] hint-fetch` lines: 5173)

Whole capture: satisfied 2729, fresh 595, memo 1849, deferred 0, none 0, error 0, other 0. "other" = a `verify=` value this script does not know.

| minute | hint fetches | satisfied | fresh | memo | deferred | none | error | other |
|---|---|---|---|---|---|---|---|---|
| 09:13 | 3349 | 905 | 595 | 1849 | 0 | 0 | 0 | 0 |
| 09:14 | 1824 | 1824 | 0 | 0 | 0 | 0 | 0 | 0 |

### Warming (`[liveWarm]` jobs: 11; `[setlist] warm-lookup` lines: 5173)

**warm hit rate = hits ÷ hinted fetches = 2724 / 5173 = 52.7 %** (hinted fetches = `[setlist] hint-fetch` lines with a numeric minRev; lookups 5173).

schedule-failed 0; job-failed 0; set ok=false 0 (set-error lines 0); skips 0; lookup-error lines 0; warm builds matched 33.

Warm jobs. start → done = the job's own `done ms=` (it starts in `after()`, i.e. right after the save's response, so it is ≈ warm-complete − commit). Per locale: actual rev, bytes, build / set ms, ok.

| save rev | instance | start (log clock) | start → done ms | sets | skips | warm builds (unmatched) | job-failed |
|---|---|---|---|---|---|---|---|
| 884 | 30ccb473 | 09:12:13 | 110 | ko r884 59215 B 50/7 ms; ja r884 49271 B 63/5 ms; en r884 58295 B 46/6 ms | — | 3 | — |
| 885 | 39664725 | 09:13:19 | 85 | ja r885 67229 B 42/6 ms; ko r885 80829 B 46/7 ms; en r885 79462 B 33/4 ms | — | 3 | — |
| 886 | 39664725 | 09:13:20 | 70 | ko r886 60000 B 31/5 ms; ja r886 49937 B 34/6 ms; en r886 59083 B 30/4 ms | — | 3 | — |
| 887 | 608f6699 | 09:13:44 | 103 | ja r887 67895 B 44/8 ms; ko r887 81614 B 49/7 ms; en r887 80250 B 44/7 ms | — | 3 | — |
| 888 | 500f746d | 09:13:45 | 92 | ja r888 50632 B 44/11 ms; ko r888 60826 B 53/7 ms; en r888 59903 B 31/5 ms | — | 3 | — |
| 889 | 30ccb473 | 09:14:09 | 152 | ko r889 82440 B 48/7 ms; ja r889 68590 B 58/7 ms; en r889 81070 B 82/15 ms | — | 3 | — |
| 890 | 30ccb473 | 09:14:10 | 123 | ja r890 51293 B 51/11 ms; ko r890 61609 B 55/10 ms; en r890 60679 B 56/5 ms | — | 3 | — |
| 891 | 30ccb473 | 09:14:13 | 163 | ko r891 60827 B 48/6 ms; ja r891 50633 B 96/29 ms; en r891 59904 B 104/5 ms | — | 3 | — |
| 892 | 363d88fb | 09:14:13 | 165 | ko r892 60002 B 52/9 ms; ja r892 49939 B 78/23 ms; en r892 59085 B 91/12 ms | — | 3 | — |
| 893 | 02fc4d19 | 09:14:14 | 109 | ko r893 59218 B 47/10 ms; ja r893 49274 B 60/7 ms; en r893 58298 B 45/6 ms | — | 3 | — |
| 894 | 6a464184 | 09:14:20 | 87 | ko r894 59215 B 36/10 ms; ja r894 49271 B 54/6 ms; en r894 58295 B 35/6 ms | — | 3 | — |

Per save rev. builds = every `[liveSnapshot] build` at that rev; warm = the ones matched to a warm job (same instance, locale, rev); reader = the rest. Lookups and hinted fetches are keyed by their `minRev`.

| save rev | warm jobs | start → done ms | builds | warm | reader | hinted fetches | lookups | hit | miss | stale | invalid | error | timeout | other | lookup ms p50 / p95 | hit rate |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 884 | 1 | 110 | 621 | 3 | 618 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — / — | — |
| 885 | 1 | 85 | 10 | 3 | 7 | 285 | 285 | 241 | 16 | 0 | 0 | 0 | 0 | 28 | 8 / 16 | 84.6 % |
| 886 | 1 | 70 | 1044 | 3 | 1041 | 186 | 186 | 186 | 0 | 0 | 0 | 0 | 0 | 0 | 7 / 9 | 100.0 % |
| 887 | 1 | 103 | 42 | 3 | 39 | 2630 | 2630 | 225 | 1814 | 0 | 0 | 0 | 0 | 591 | 3 / 9 | 8.6 % |
| 888 | 1 | 92 | 203 | 3 | 200 | 248 | 248 | 248 | 0 | 0 | 0 | 0 | 0 | 0 | 7 / 9 | 100.0 % |
| 889 | 1 | 152 | 11 | 3 | 8 | 378 | 378 | 378 | 0 | 0 | 0 | 0 | 0 | 0 | 9 / 21 | 100.0 % |
| 890 | 1 | 123 | 40 | 3 | 37 | 477 | 477 | 477 | 0 | 0 | 0 | 0 | 0 | 0 | 7 / 16 | 100.0 % |
| 891 | 1 | 163 | 8 | 3 | 5 | 375 | 375 | 375 | 0 | 0 | 0 | 0 | 0 | 0 | 7 / 9 | 100.0 % |
| 892 | 1 | 165 | 11 | 3 | 8 | 118 | 118 | 118 | 0 | 0 | 0 | 0 | 0 | 0 | 7 / 11 | 100.0 % |
| 893 | 1 | 109 | 31 | 3 | 28 | 476 | 476 | 476 | 0 | 0 | 0 | 0 | 0 | 0 | 7 / 10 | 100.0 % |
| 894 | 1 | 87 | 507 | 3 | 504 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — / — | — |

Lookup ms by result (p50 / p95, n): hit 8 / 14 (2724); miss 3 / 5 (1830); other 0 / 0 (619). Whole capture: hit 2724, miss 1830, stale 0, invalid 0, error 0, timeout 0, other 619.

| minute | lookups | hit | miss | stale | invalid | error | timeout | other |
|---|---|---|---|---|---|---|---|---|
| 09:13 | 3349 | 900 | 1830 | 0 | 0 | 0 | 0 | 619 |
| 09:14 | 1824 | 1824 | 0 | 0 | 0 | 0 | 0 | 0 |

### Admin writes (`[liveWriter]`)

| route | saves | acquire ms p50 / p95 | exec ms p50 / p95 | ok=false | failed kinds |
|---|---|---|---|---|---|
| admin-delete | 5 | 4 / 7 | 21 / 28 | 0 | — |
| admin-update | 3 | 3 / 3 | 68 / 78 | 0 | — |
| admin-insert-after | 3 | 4 / 4 | 150 / 192 | 0 | — |

### Per minute

| minute | requests | distinct instances | builds | EMAXCONN |
|---|---|---|---|---|
| 09:12 | 1730 | 22 | 440 | 0 |
| 09:13 | 5126 | 59 | 1418 | 0 |
| 09:14 | 3708 | 59 | 670 | 0 |

### Prisma pool totals per 5 s (app-side estimate of pooler clients)

Peak carried sum: **110** (carry 5 s). "reported" = instances that logged in the bucket (max total each); "carried" also counts an instance's last total for 5 s after its last line.

| bucket | reporting instances | Σ total (reported) | instances (carried) | Σ total (carried) | max waiting |
|---|---|---|---|---|---|
| 09:12:10 | 1 | 2 | 1 | 2 | 0 |
| 09:12:15 | 0 | 0 | 1 | 2 | 0 |
| 09:12:25 | 13 | 24 | 13 | 24 | 2 |
| 09:12:30 | 10 | 19 | 13 | 25 | 1 |
| 09:12:35 | 15 | 26 | 16 | 28 | 0 |
| 09:12:40 | 12 | 15 | 17 | 24 | 0 |
| 09:12:45 | 14 | 17 | 17 | 23 | 3 |
| 09:12:50 | 9 | 16 | 14 | 22 | 1 |
| 09:12:55 | 10 | 18 | 11 | 20 | 0 |
| 09:13:00 | 9 | 12 | 13 | 20 | 0 |
| 09:13:05 | 5 | 9 | 9 | 16 | 0 |
| 09:13:10 | 4 | 8 | 5 | 9 | 0 |
| 09:13:15 | 5 | 10 | 5 | 10 | 0 |
| 09:13:20 | 17 | 27 | 17 | 27 | 0 |
| 09:13:25 | 32 | 64 | 32 | 64 | 2 |
| 09:13:30 | 50 | 100 | 50 | 100 | 1 |
| 09:13:35 | 52 | 104 | 52 | 104 | 3 |
| 09:13:40 | 53 | 104 | 56 | 110 | 1 |
| 09:13:45 | 26 | 47 | 54 | 101 | 0 |
| 09:13:50 | 13 | 17 | 26 | 41 | 0 |
| 09:13:55 | 11 | 16 | 13 | 18 | 0 |
| 09:14:00 | 7 | 10 | 11 | 15 | 0 |
| 09:14:05 | 5 | 9 | 7 | 12 | 0 |
| 09:14:10 | 19 | 26 | 19 | 26 | 0 |
| 09:14:15 | 16 | 19 | 22 | 29 | 0 |
| 09:14:20 | 24 | 43 | 25 | 44 | 0 |
| 09:14:25 | 30 | 60 | 32 | 64 | 3 |
| 09:14:30 | 30 | 59 | 33 | 65 | 4 |
| 09:14:35 | 2 | 2 | 30 | 56 | 0 |

### Other lines

none
