## Overlap join — 2026-10-12T04-33-39-344Z-browsers-overlap.json + 2026-10-12T04-30-20Z-vercel-logs-history-step4-S4b.txt

Scenario **S4**: **EXERCISED (4/6 ≥ 4)**. Server: EMAXCONN 0, `[liveWriter] failed kind=pool_acquire_timeout` 0 (all failed kinds 0), warm jobs 24, expire-warm lines 0.

Exposure from server timestamps (proxies; three clocks — server function `at*`, PostgreSQL `captureAt`, this machine for probes). (iii) cross-instance differences < 100 ms = indeterminate.

| group | saves (who rev: writer at UTC, acquire ms) | A fault ok | (i) B during A | (ii) tx overlap / build overlap | (iii) ja / ko / en | (iv) ja / ko / en | S3 (failed sets, misses during B) | exercised | acquire ≤ 500 | builds [start, +10 s] (per save) |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | A 1547: 04:31:24.167, 3; B 1548: 04:31:24.268, 3; C 1549: 04:31:24.343, 4 | yes | yes | yes / yes | indeterminate / in order / in order | — | 0, 0 | **yes** | yes (max 4) | 57 (19.0) |
| 2 | A 1551: 04:31:49.177, 2; B 1550: 04:31:49.144, 4; C 1552: 04:31:49.219, 3 | yes | yes | yes / yes | reversed / reversed / reversed | — | 0, 0 | **yes** | yes (max 4) | 61 (20.3) |
| 3 | A 1553: 04:32:14.182, 3; B 1554: 04:32:14.256, 4; C 1555: 04:32:14.317, 25 | yes | yes | yes / yes | in order / in order / in order | — | 0, 0 | **yes** | yes (max 25) | 83 (27.7) |
| 4 | A 1556: 04:32:39.385, 3; B 1557: 04:32:39.488, 2; C 1558: 04:32:39.547, 4 | yes | yes | no / no | in order / in order / in order | — | 0, 0 | no | yes (max 4) | 92 (30.7) |
| 5 | A 1559: 04:33:04.175, 2; B 1560: 04:33:04.250, 4; C 1561: 04:33:04.286, 4 | yes | yes | yes / yes | indeterminate / indeterminate / indeterminate | — | 0, 0 | **yes** | yes (max 4) | 87 (29.0) |
| 6 | A 1562: 04:33:29.220, 4; B 1563: 04:33:29.281, 1; C 1564: 04:33:29.332, 20 | yes | yes | no / yes | in order / in order / in order | — | 0, 1 | no | yes (max 20) | 98 (32.7) |

Commit → entry stored (server clock: set `at` − writer `at`, ms; `→N` = the entry's actual rev ≠ key) and the first `warm` probe of that key (+s after the last response; an upper bound):

| group | key (who) | ja | ko | en |
|---|---|---|---|---|
| 1 | 1547 (A) | 116; probe +1 s | 88; probe +1 s | 138; probe +1 s |
| 1 | 1548 (B) | 65; probe +1 s | 165; probe +1 s | 209 →1549; probe +1 s |
| 1 | 1549 (C) | 122; probe +1 s | 114; probe +1 s | 167; probe +1 s |
| 2 | 1551 (A) | 136 →1552; probe +1 s | 145 →1552; probe +1 s | 206 →1552; probe +1 s |
| 2 | 1550 (B) | 102 →1551; probe +1 s | 99; probe +1 s | 212 →1552; probe +1 s |
| 2 | 1552 (C) | 53; probe +1 s | 60; probe +1 s | 111; probe +1 s |
| 3 | 1553 (A) | 90; probe +1 s | 52; probe +1 s | 134 →1554; probe +1 s |
| 3 | 1554 (B) | 79; probe +1 s | 47; probe +1 s | 106 →1555; probe +1 s |
| 3 | 1555 (C) | 79; probe +1 s | 75; probe +1 s | 189; probe +1 s |
| 4 | 1556 (A) | 72; probe +1 s | 67; probe +1 s | 124; probe +1 s |
| 4 | 1557 (B) | 140 →1558; probe +1 s | 107; probe +1 s | 161 →1558; probe +1 s |
| 4 | 1558 (C) | 111; probe +1 s | 89; probe +1 s | 170; probe +1 s |
| 5 | 1559 (A) | 121 →1560; probe +1 s | 77; probe +1 s | 167 →1561; probe +1 s |
| 5 | 1560 (B) | 97 →1561; probe +1 s | 78; probe +1 s | 135 →1561; probe +1 s |
| 5 | 1561 (C) | 119; probe +1 s | 101; probe +1 s | 177; probe +1 s |
| 6 | 1562 (A) | 166 →1564; probe +1 s | 115 →1563; probe +1 s | 287 →1564; probe +1 s |
| 6 | 1563 (B) | 169 →1564; probe +1 s | 164 →1564; probe +1 s | 349 →1564; probe +1 s |
| 6 | 1564 (C) | 225; probe +1 s | 169; probe +1 s | 368; probe +1 s |

Client-side gates from the run (all pass): all intended saves committed (2xx) PASS; 5xx anywhere (saves, reloads, catalog, reactions, probes, SDK, pages) PASS; convergence to head from the last save start — pages PASS; convergence to head from the last save start — SDK PASS; DOM monotonicity (pages: marker-derived version never goes back) PASS; (rev, capturedAt) monotonicity (SDK applied) PASS; PUT latency, original attempt — save A PASS; PUT latency, original attempt — save B PASS; PUT latency, original attempt — save C PASS; admin editor reloads in the save window PASS.
