## Overlap join — 2026-10-12T03-52-57-081Z-browsers-overlap.json + 2026-10-12T03-48-45Z-vercel-logs-history-step4-S6b.txt

Scenario **S6** (A's header fault, logged as `fault=slowbuild:500 source=header`): **EXERCISED (6/6 ≥ 4)**. Server: EMAXCONN 0, `[liveWriter] failed kind=pool_acquire_timeout` 0 (all failed kinds 0), warm jobs 24, expire-warm lines 0.

Exposure from server timestamps (proxies; three clocks — server function `at*`, PostgreSQL `captureAt`, this machine for probes). (iii) cross-instance differences < 100 ms = indeterminate.

| group | saves (who rev: writer at UTC, acquire ms) | A fault ok | (i) B during A | (ii) tx overlap / build overlap | (iii) ja / ko / en | (iv) ja / ko / en | S3 (failed sets, misses during B) | exercised | acquire ≤ 500 | builds [start, +10 s] (per save) |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | A 1413: 03:49:50.239, 2; B 1414: 03:49:50.645, 7; C 1415: 03:49:51.078, 91 | yes | yes | yes / yes | indeterminate / indeterminate / reversed | — | 0, 114 | **yes** | yes (max 91) | 171 (57.0) |
| 2 | A 1416: 03:50:15.288, 3; B 1418: 03:50:16.377, 221; C 1417: 03:50:15.912, 20 | yes | yes | yes / yes | in order / in order / reversed | — | 0, 0 | **yes** | yes (max 221) | 178 (59.3) |
| 3 | A 1419: 03:50:40.307, 3; B 1420: 03:50:40.549, 2; C 1421: 03:50:40.835, 25 | yes | yes | yes / yes | reversed / reversed / reversed | — | 0, 98 | **yes** | yes (max 25) | 192 (64.0) |
| 4 | A 1422: 03:51:05.232, 3; B 1424: 03:51:06.380, 342; C 1423: 03:51:06.055, 298 | yes | yes | yes / yes | in order / in order / reversed | — | 0, 0 | **yes** | yes (max 342) | 231 (77.0) |
| 5 | A 1425: 03:51:30.243, 2; B 1426: 03:51:30.603, 5; C 1427: 03:51:31.039, 61 | yes | yes | yes / yes | indeterminate / reversed / reversed | — | 0, 129 | **yes** | yes (max 61) | 219 (73.0) |
| 6 | A 1428: 03:51:55.299, 11; B 1430: 03:51:56.296, 222; C 1429: 03:51:55.908, 60 | yes | yes | yes / yes | in order / in order / reversed | — | 0, 4 | **yes** | yes (max 222) | 214 (71.3) |

Commit → entry stored (server clock: set `at` − writer `at`, ms; `→N` = the entry's actual rev ≠ key) and the first `warm` probe of that key (+s after the last response; an upper bound):

| group | key (who) | ja | ko | en |
|---|---|---|---|---|
| 1 | 1413 (A) | 679; probe +1 s | 675; probe +1 s | 1576 →1415; probe +1 s |
| 1 | 1414 (B) | 201; probe +1 s | 191; probe +1 s | 606 →1415; probe +1 s |
| 1 | 1415 (C) | 192; probe +1 s | 144; probe +1 s | 208; probe +1 s |
| 2 | 1416 (A) | 658; probe +1 s | 653; probe +1 s | 1583 →1417; probe +1 s |
| 2 | 1418 (B) | 158; probe +1 s | 65; probe +1 s | 207; probe +1 s |
| 2 | 1417 (C) | 364; probe +1 s | 291; probe +1 s | 373; probe +1 s |
| 3 | 1419 (A) | 627; probe +1 s | 643; probe +1 s | 1395 →1421; probe +1 s |
| 3 | 1420 (B) | 119; probe +1 s | 78; probe +1 s | 220; probe +1 s |
| 3 | 1421 (C) | 296; probe +1 s | 264; probe +1 s | 344; probe +1 s |
| 4 | 1422 (A) | 673; probe +1 s | 668; probe +1 s | 1587 →1423; probe +1 s |
| 4 | 1424 (B) | 133; probe +1 s | 101; probe +1 s | 169; probe +1 s |
| 4 | 1423 (C) | 298; probe +1 s | 207; probe +1 s | 326; probe +1 s |
| 5 | 1425 (A) | 621; probe +1 s | 625; probe +1 s | 1439 →1427; probe +1 s |
| 5 | 1426 (B) | 236; probe +1 s | 121; probe +1 s | 289; probe +1 s |
| 5 | 1427 (C) | 186; probe +1 s | 162; probe +1 s | 237; probe +1 s |
| 6 | 1428 (A) | 630; probe +1 s | 648; probe +1 s | 1454 →1429; probe +1 s |
| 6 | 1430 (B) | 113; probe +1 s | 69; probe +1 s | 169; probe +1 s |
| 6 | 1429 (C) | 286; probe +1 s | 226; probe +1 s | 364; probe +1 s |

Client-side gates from the run (all pass): all intended saves committed (2xx) PASS; 5xx anywhere (saves, reloads, catalog, reactions, probes, SDK, pages) PASS; convergence to head from the last save start — pages PASS; convergence to head from the last save start — SDK PASS; DOM monotonicity (pages: marker-derived version never goes back) PASS; (rev, capturedAt) monotonicity (SDK applied) PASS; PUT latency, original attempt — save A PASS; PUT latency, original attempt — save B PASS; PUT latency, original attempt — save C PASS; admin editor reloads in the save window PASS; raw reactions PASS.
