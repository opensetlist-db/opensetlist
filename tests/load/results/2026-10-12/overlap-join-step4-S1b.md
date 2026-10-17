## Overlap join — 2026-10-12T04-21-55-670Z-browsers-overlap.json + 2026-10-12T04-18-44Z-vercel-logs-history-step4-S1b.txt

Scenario **S1**: **NOT EXERCISED (1/6 < 4) — re-run once with the gap adjusted; both runs stay in the record**. Server: EMAXCONN 0, `[liveWriter] failed kind=pool_acquire_timeout` 0 (all failed kinds 0), warm jobs 16, expire-warm lines 0.

Exposure from server timestamps (proxies; three clocks — server function `at*`, PostgreSQL `captureAt`, this machine for probes). (iii) cross-instance differences < 100 ms = indeterminate.

| group | saves (who rev: writer at UTC, acquire ms) | A fault ok | (i) B during A | (ii) tx overlap / build overlap | (iii) ja / ko / en | (iv) ja / ko / en | S3 (failed sets, misses during B) | exercised | acquire ≤ 500 | builds [start, +10 s] (per save) |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | A 1504: 04:19:42.612, 4; B 1505: 04:19:42.761, 3 | yes | no | no / no | in order / in order / in order | — | 0, 0 | no | yes (max 4) | 133 (66.5) |
| 2 | A 1506: 04:20:07.689, 3; B 1507: 04:20:07.782, 4 | yes | yes | no / yes | in order / indeterminate / in order | — | 0, 0 | no | yes (max 4) | 59 (29.5) |
| 3 | A 1508: 04:20:32.633, 2; B 1509: 04:20:32.763, 2 | yes | yes | yes / yes | indeterminate / indeterminate / indeterminate | — | 0, 0 | **yes** | yes (max 2) | 70 (35.0) |
| 4 | A 1510: 04:20:57.601, 2; B 1511: 04:20:57.722, 3 | yes | no | no / no | in order / in order / in order | — | 0, 0 | no | yes (max 3) | 80 (40.0) |
| 5 | A 1512: 04:21:22.630, 4; B 1513: 04:21:22.754, 3 | yes | no | no / no | in order / in order / in order | — | 0, 0 | no | yes (max 4) | 91 (45.5) |
| 6 | A 1514: 04:21:47.633, 4; B 1515: 04:21:47.766, 3 | yes | yes | no / no | in order / in order / in order | — | 0, 0 | no | yes (max 4) | 84 (42.0) |

Commit → entry stored (server clock: set `at` − writer `at`, ms; `→N` = the entry's actual rev ≠ key) and the first `warm` probe of that key (+s after the last response; an upper bound):

| group | key (who) | ja | ko | en |
|---|---|---|---|---|
| 1 | 1504 (A) | 49; probe +1 s | 63; probe +1 s | 97; probe +1 s |
| 1 | 1505 (B) | 129; probe +1 s | 63; probe +1 s | 158; probe +1 s |
| 2 | 1506 (A) | 89; probe +1 s | 81; probe +1 s | 147 →1507; probe +1 s |
| 2 | 1507 (B) | 107; probe +1 s | 86; probe +1 s | 155; probe +1 s |
| 3 | 1508 (A) | 171; probe +1 s | 157; probe +1 s | 206 →1509; probe +1 s |
| 3 | 1509 (B) | 123; probe +1 s | 110; probe +1 s | 164; probe +1 s |
| 4 | 1510 (A) | 66; probe +1 s | 53; probe +1 s | 98; probe +1 s |
| 4 | 1511 (B) | 105; probe +1 s | 117; probe +1 s | 161; probe +1 s |
| 5 | 1512 (A) | 51; probe +1 s | 64; probe +1 s | 111; probe +1 s |
| 5 | 1513 (B) | 49; probe +1 s | 62; probe +1 s | 90; probe +1 s |
| 6 | 1514 (A) | 78; probe +1 s | 73; probe +1 s | 137; probe +1 s |
| 6 | 1515 (B) | 83; probe +1 s | 78; probe +1 s | 141; probe +1 s |

Client-side gates from the run (all pass): all intended saves committed (2xx) PASS; 5xx anywhere (saves, reloads, catalog, reactions, probes, SDK, pages) PASS; convergence to head from the last save start — pages PASS; convergence to head from the last save start — SDK PASS; DOM monotonicity (pages: marker-derived version never goes back) PASS; (rev, capturedAt) monotonicity (SDK applied) PASS; PUT latency, original attempt — save A PASS; PUT latency, original attempt — save B PASS.
