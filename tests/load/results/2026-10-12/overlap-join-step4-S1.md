## Overlap join — 2026-10-12T04-16-19-404Z-browsers-overlap.json + 2026-10-12T04-13-05Z-vercel-logs-history-step4-S1.txt

Scenario **S1**: **NOT EXERCISED (1/6 < 4) — re-run once with the gap adjusted; both runs stay in the record**. Server: EMAXCONN 0, `[liveWriter] failed kind=pool_acquire_timeout` 0 (all failed kinds 0), warm jobs 16, expire-warm lines 0.

Exposure from server timestamps (proxies; three clocks — server function `at*`, PostgreSQL `captureAt`, this machine for probes). (iii) cross-instance differences < 100 ms = indeterminate.

| group | saves (who rev: writer at UTC, acquire ms) | A fault ok | (i) B during A | (ii) tx overlap / build overlap | (iii) ja / ko / en | (iv) ja / ko / en | S3 (failed sets, misses during B) | exercised | acquire ≤ 500 | builds [start, +10 s] (per save) |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | A 1487: 04:14:06.262, 5; B 1488: 04:14:06.496, 3 | yes | no | no / no | in order / in order / in order | — | 0, 0 | no | yes (max 5) | 75 (37.5) |
| 2 | A 1489: 04:14:31.169, 4; B 1490: 04:14:31.364, 4 | yes | no | no / no | in order / in order / in order | — | 0, 0 | no | yes (max 4) | 65 (32.5) |
| 3 | A 1491: 04:14:56.223, 2; B 1492: 04:14:56.329, 4 | yes | yes | yes / yes | indeterminate / indeterminate / indeterminate | — | 0, 0 | **yes** | yes (max 4) | 77 (38.5) |
| 4 | A 1493: 04:15:21.175, 5; B 1494: 04:15:21.320, 4 | yes | no | no / no | in order / in order / in order | — | 0, 0 | no | yes (max 5) | 97 (48.5) |
| 5 | A 1495: 04:15:46.170, 2; B 1496: 04:15:46.336, 4 | yes | no | no / no | in order / in order / in order | — | 0, 0 | no | yes (max 4) | 118 (59.0) |
| 6 | A 1497: 04:16:11.088, 3; B 1498: 04:16:11.334, 4 | yes | no | no / no | in order / in order / in order | — | 0, 0 | no | yes (max 4) | 91 (45.5) |

Commit → entry stored (server clock: set `at` − writer `at`, ms; `→N` = the entry's actual rev ≠ key) and the first `warm` probe of that key (+s after the last response; an upper bound):

| group | key (who) | ja | ko | en |
|---|---|---|---|---|
| 1 | 1487 (A) | 99; probe +1 s | 90; probe +1 s | 154; probe +1 s |
| 1 | 1488 (B) | 133; probe +1 s | 80; probe +1 s | 144; probe +1 s |
| 2 | 1489 (A) | 115; probe +1 s | 111; probe +1 s | 174; probe +1 s |
| 2 | 1490 (B) | 77; probe +1 s | 67; probe +1 s | 146; probe +1 s |
| 3 | 1491 (A) | 119; probe +1 s | 95; probe +1 s | 133; probe +1 s |
| 3 | 1492 (B) | 81; probe +1 s | 55; probe +1 s | 106; probe +1 s |
| 4 | 1493 (A) | 91; probe +1 s | 84; probe +1 s | 134; probe +1 s |
| 4 | 1494 (B) | 48; probe +1 s | 61; probe +1 s | 143; probe +1 s |
| 5 | 1495 (A) | 85; probe +1 s | 75; probe +1 s | 117; probe +1 s |
| 5 | 1496 (B) | 49; probe +1 s | 78; probe +1 s | 107; probe +1 s |
| 6 | 1497 (A) | 61; probe +1 s | 49; probe +1 s | 110; probe +1 s |
| 6 | 1498 (B) | 53; probe +1 s | 62; probe +1 s | 105; probe +1 s |

Client-side gates from the run (all pass): all intended saves committed (2xx) PASS; 5xx anywhere (saves, reloads, catalog, reactions, probes, SDK, pages) PASS; convergence to head from the last save start — pages PASS; convergence to head from the last save start — SDK PASS; DOM monotonicity (pages: marker-derived version never goes back) PASS; (rev, capturedAt) monotonicity (SDK applied) PASS; PUT latency, original attempt — save A PASS; PUT latency, original attempt — save B PASS.
