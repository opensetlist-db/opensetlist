## Overlap join — 2026-10-12T03-29-47-072Z-browsers-overlap.json + 2026-10-12T03-26-28Z-vercel-logs-history-step4-S3.txt

Scenario **S3** (A's header fault, logged as `fault=seterror source=header`): **EXERCISED (6/6 ≥ 4)**. Server: EMAXCONN 0, `[liveWriter] failed kind=pool_acquire_timeout` 0 (all failed kinds 0), warm jobs 16, expire-warm lines 0.

Exposure from server timestamps (proxies; three clocks — server function `at*`, PostgreSQL `captureAt`, this machine for probes). (iii) cross-instance differences < 100 ms = indeterminate.

| group | saves (who rev: writer at UTC, acquire ms) | A fault ok | (i) B during A | (ii) tx overlap / build overlap | (iii) ja / ko / en | (iv) ja / ko / en | S3 (failed sets, misses during B) | exercised | acquire ≤ 500 | builds [start, +10 s] (per save) |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | A 1353: 03:27:33.350, 4; B 1354: 03:27:33.722, 7 | yes | n/a | no / no | n/a / n/a / n/a | — | 3, 123 | **yes** | yes (max 7) | 274 (137.0) |
| 2 | A 1355: 03:27:58.342, 5; B 1356: 03:27:58.550, 4 | yes | n/a | no / no | n/a / n/a / n/a | — | 3, 94 | **yes** | yes (max 5) | 142 (71.0) |
| 3 | A 1357: 03:28:23.322, 3; B 1358: 03:28:23.540, 3 | yes | n/a | no / no | n/a / n/a / n/a | — | 3, 109 | **yes** | yes (max 3) | 195 (97.5) |
| 4 | A 1359: 03:28:48.270, 2; B 1360: 03:28:48.563, 3 | yes | n/a | no / no | n/a / n/a / n/a | — | 3, 107 | **yes** | yes (max 3) | 172 (86.0) |
| 5 | A 1361: 03:29:13.357, 3; B 1362: 03:29:13.582, 3 | yes | n/a | no / no | n/a / n/a / n/a | — | 3, 166 | **yes** | yes (max 3) | 172 (86.0) |
| 6 | A 1363: 03:29:38.340, 3; B 1364: 03:29:38.558, 3 | yes | n/a | no / no | n/a / n/a / n/a | — | 3, 77 | **yes** | yes (max 3) | 209 (104.5) |

Commit → entry stored (server clock: set `at` − writer `at`, ms; `→N` = the entry's actual rev ≠ key) and the first `warm` probe of that key (+s after the last response; an upper bound):

| group | key (who) | ja | ko | en |
|---|---|---|---|---|
| 1 | 1353 (A) | —; probe never warm | —; probe never warm | —; probe never warm |
| 1 | 1354 (B) | 78; probe +1 s | 133; probe +1 s | 264; probe +1 s |
| 2 | 1355 (A) | —; probe never warm | —; probe never warm | —; probe never warm |
| 2 | 1356 (B) | 78; probe +1 s | 69; probe +1 s | 180; probe +1 s |
| 3 | 1357 (A) | —; probe never warm | —; probe never warm | —; probe never warm |
| 3 | 1358 (B) | 117; probe +1 s | 96; probe +1 s | 261; probe +1 s |
| 4 | 1359 (A) | —; probe never warm | —; probe never warm | —; probe never warm |
| 4 | 1360 (B) | 97; probe +1 s | 80; probe +1 s | 280; probe +1 s |
| 5 | 1361 (A) | —; probe never warm | —; probe never warm | —; probe never warm |
| 5 | 1362 (B) | 296; probe +1 s | 215; probe +1 s | 534; probe +1 s |
| 6 | 1363 (A) | —; probe never warm | —; probe never warm | —; probe never warm |
| 6 | 1364 (B) | 137; probe +1 s | 102; probe +1 s | 231; probe +1 s |

Client-side gates from the run (all pass): all intended saves committed (2xx) PASS; 5xx anywhere (saves, reloads, catalog, reactions, probes, SDK, pages) PASS; convergence to head from the last save start — pages PASS; convergence to head from the last save start — SDK PASS; DOM monotonicity (pages: marker-derived version never goes back) PASS; (rev, capturedAt) monotonicity (SDK applied) PASS; PUT latency, original attempt — save A PASS; PUT latency, original attempt — save B PASS.
