## Overlap join — 2026-10-12T04-27-44-047Z-browsers-overlap.json + 2026-10-12T04-24-25Z-vercel-logs-history-step4-S4.txt

Scenario **S4**: **NOT EXERCISED (0/6 < 4) — re-run once with the gap adjusted; both runs stay in the record**. Server: EMAXCONN 0, `[liveWriter] failed kind=pool_acquire_timeout` 0 (all failed kinds 0), warm jobs 24, expire-warm lines 0.

Exposure from server timestamps (proxies; three clocks — server function `at*`, PostgreSQL `captureAt`, this machine for probes). (iii) cross-instance differences < 100 ms = indeterminate.

| group | saves (who rev: writer at UTC, acquire ms) | A fault ok | (i) B during A | (ii) tx overlap / build overlap | (iii) ja / ko / en | (iv) ja / ko / en | S3 (failed sets, misses during B) | exercised | acquire ≤ 500 | builds [start, +10 s] (per save) |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | A 1522: 04:25:28.806, 4; B 1523: 04:25:29.102, 2; C 1524: 04:25:29.416, 3 | yes | no | no / no | in order / in order / in order | — | 0, 0 | no | yes (max 4) | 97 (32.3) |
| 2 | A 1525: 04:25:53.857, 2; B 1526: 04:25:54.087, 3; C 1527: 04:25:54.471, 5 | yes | no | no / no | in order / in order / in order | — | 0, 0 | no | yes (max 5) | 66 (22.0) |
| 3 | A 1528: 04:26:18.885, 4; B 1529: 04:26:19.156, 4; C 1530: 04:26:19.379, 3 | yes | no | no / no | in order / in order / in order | — | 0, 0 | no | yes (max 4) | 87 (29.0) |
| 4 | A 1531: 04:26:43.890, 4; B 1532: 04:26:44.126, 3; C 1533: 04:26:44.438, 4 | yes | no | no / no | in order / in order / in order | — | 0, 0 | no | yes (max 4) | 129 (43.0) |
| 5 | A 1534: 04:27:08.863, 3; B 1535: 04:27:09.048, 3; C 1536: 04:27:09.364, 4 | yes | no | no / no | in order / in order / in order | — | 0, 0 | no | yes (max 4) | 85 (28.3) |
| 6 | A 1537: 04:27:33.877, 3; B 1538: 04:27:34.133, 5; C 1539: 04:27:34.300, 4 | yes | no | no / no | in order / in order / in order | — | 0, 0 | no | yes (max 5) | 147 (49.0) |

Commit → entry stored (server clock: set `at` − writer `at`, ms; `→N` = the entry's actual rev ≠ key) and the first `warm` probe of that key (+s after the last response; an upper bound):

| group | key (who) | ja | ko | en |
|---|---|---|---|---|
| 1 | 1522 (A) | 91; probe +1 s | 84; probe +1 s | 221; probe +1 s |
| 1 | 1523 (B) | 81; probe +1 s | 75; probe +1 s | 142; probe +1 s |
| 1 | 1524 (C) | 81; probe +1 s | 78; probe +1 s | 123; probe +1 s |
| 2 | 1525 (A) | 87; probe +1 s | 71; probe +1 s | 117; probe +1 s |
| 2 | 1526 (B) | 50; probe +1 s | 70; probe +1 s | 184; probe +1 s |
| 2 | 1527 (C) | 78; probe +1 s | 87; probe +1 s | 145; probe +1 s |
| 3 | 1528 (A) | 71; probe +1 s | 79; probe +1 s | 117; probe +1 s |
| 3 | 1529 (B) | 74; probe +1 s | 86; probe +1 s | 143; probe +1 s |
| 3 | 1530 (C) | 97; probe +1 s | 81; probe +1 s | 140; probe +1 s |
| 4 | 1531 (A) | 45; probe +1 s | 57; probe +1 s | 87; probe +1 s |
| 4 | 1532 (B) | 123; probe +1 s | 77; probe +1 s | 131; probe +1 s |
| 4 | 1533 (C) | 146; probe +1 s | 106; probe +1 s | 173; probe +1 s |
| 5 | 1534 (A) | 83; probe +1 s | 67; probe +1 s | 113; probe +1 s |
| 5 | 1535 (B) | 69; probe +1 s | 72; probe +1 s | 123; probe +1 s |
| 5 | 1536 (C) | 97; probe +1 s | 79; probe +1 s | 192; probe +1 s |
| 6 | 1537 (A) | 77; probe +1 s | 87; probe +1 s | 137; probe +1 s |
| 6 | 1538 (B) | 126; probe +1 s | 109; probe +1 s | 162; probe +1 s |
| 6 | 1539 (C) | 73; probe +1 s | 77; probe +1 s | 132; probe +1 s |

Client-side gates from the run (all pass): all intended saves committed (2xx) PASS; 5xx anywhere (saves, reloads, catalog, reactions, probes, SDK, pages) PASS; convergence to head from the last save start — pages PASS; convergence to head from the last save start — SDK PASS; DOM monotonicity (pages: marker-derived version never goes back) PASS; (rev, capturedAt) monotonicity (SDK applied) PASS; PUT latency, original attempt — save A PASS; PUT latency, original attempt — save B PASS; PUT latency, original attempt — save C PASS; admin editor reloads in the save window PASS.
