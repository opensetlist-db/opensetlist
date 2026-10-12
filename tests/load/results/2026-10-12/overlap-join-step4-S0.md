## Overlap join — 2026-10-12T04-10-46-056Z-browsers-overlap.json + 2026-10-12T04-07-30Z-vercel-logs-history-step4-S0.txt

Scenario **S0**: **control (no exposure intended)**. Server: EMAXCONN 0, `[liveWriter] failed kind=pool_acquire_timeout` 0 (all failed kinds 0), warm jobs 16, expire-warm lines 0.

Exposure from server timestamps (proxies; three clocks — server function `at*`, PostgreSQL `captureAt`, this machine for probes). (iii) cross-instance differences < 100 ms = indeterminate.

| group | saves (who rev: writer at UTC, acquire ms) | A fault ok | (i) B during A | (ii) tx overlap / build overlap | (iii) ja / ko / en | (iv) ja / ko / en | S3 (failed sets, misses during B) | exercised | acquire ≤ 500 | builds [start, +10 s] (per save) |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | A 1470: 04:08:29.946, 3; B 1471: 04:08:32.922, 4 | yes | no | no / no | in order / in order / in order | — | 0, 0 | n/a | yes (max 4) | 135 (67.5) |
| 2 | A 1472: 04:08:54.920, 3; B 1473: 04:08:57.934, 4 | yes | no | no / no | in order / in order / in order | — | 0, 0 | n/a | yes (max 4) | 69 (34.5) |
| 3 | A 1474: 04:09:19.857, 2; B 1475: 04:09:22.879, 4 | yes | no | no / no | in order / in order / in order | — | 0, 0 | n/a | yes (max 4) | 83 (41.5) |
| 4 | A 1476: 04:09:45.098, 2; B 1477: 04:09:47.951, 4 | yes | no | no / no | in order / in order / in order | — | 0, 0 | n/a | yes (max 4) | 119 (59.5) |
| 5 | A 1478: 04:10:09.897, 3; B 1479: 04:10:12.853, 3 | yes | no | no / no | in order / in order / in order | — | 0, 0 | n/a | yes (max 3) | 104 (52.0) |
| 6 | A 1480: 04:10:34.934, 4; B 1481: 04:10:37.860, 4 | yes | no | no / no | in order / in order / in order | — | 0, 0 | n/a | yes (max 4) | 110 (55.0) |

Commit → entry stored (server clock: set `at` − writer `at`, ms; `→N` = the entry's actual rev ≠ key) and the first `warm` probe of that key (+s after the last response; an upper bound):

| group | key (who) | ja | ko | en |
|---|---|---|---|---|
| 1 | 1470 (A) | 72; probe +1 s | 88; probe +1 s | 142; probe +1 s |
| 1 | 1471 (B) | 79; probe +1 s | 77; probe +1 s | 132; probe +1 s |
| 2 | 1472 (A) | 60; probe +1 s | 49; probe +1 s | 106; probe +1 s |
| 2 | 1473 (B) | 101; probe +1 s | 90; probe +1 s | 145; probe +1 s |
| 3 | 1474 (A) | 59; probe +1 s | 45; probe +1 s | 88; probe +1 s |
| 3 | 1475 (B) | 99; probe +1 s | 75; probe +1 s | 125; probe +1 s |
| 4 | 1476 (A) | 109; probe +1 s | 63; probe +1 s | 119; probe +1 s |
| 4 | 1477 (B) | 104; probe +1 s | 92; probe +1 s | 150; probe +1 s |
| 5 | 1478 (A) | 107; probe +1 s | 58; probe +1 s | 155; probe +1 s |
| 5 | 1479 (B) | 66; probe +1 s | 52; probe +1 s | 95; probe +1 s |
| 6 | 1480 (A) | 102; probe +1 s | 89; probe +1 s | 216; probe +1 s |
| 6 | 1481 (B) | 64; probe +1 s | 69; probe +1 s | 116; probe +1 s |

Client-side gates from the run (all pass): all intended saves committed (2xx) PASS; 5xx anywhere (saves, reloads, catalog, reactions, probes, SDK, pages) PASS; convergence to head from the last save start — pages PASS; convergence to head from the last save start — SDK PASS; DOM monotonicity (pages: marker-derived version never goes back) PASS; (rev, capturedAt) monotonicity (SDK applied) PASS; PUT latency, original attempt — save A PASS; PUT latency, original attempt — save B PASS.
