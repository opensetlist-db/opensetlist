## Overlap join — 2026-10-12T03-44-39-774Z-browsers-overlap.json + 2026-10-12T03-40-30Z-vercel-logs-history-step4-S6.txt

Scenario **S6** (A's header fault, logged as `fault=slowbuild:1500 source=header`): **EXERCISED (6/6 ≥ 4)**. Server: EMAXCONN 0, `[liveWriter] failed kind=pool_acquire_timeout` 0 (all failed kinds 0), warm jobs 24, expire-warm lines 0.

Exposure from server timestamps (proxies; three clocks — server function `at*`, PostgreSQL `captureAt`, this machine for probes). (iii) cross-instance differences < 100 ms = indeterminate.

| group | saves (who rev: writer at UTC, acquire ms) | A fault ok | (i) B during A | (ii) tx overlap / build overlap | (iii) ja / ko / en | (iv) ja / ko / en | S3 (failed sets, misses during B) | exercised | acquire ≤ 500 | builds [start, +10 s] (per save) |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | A 1388: 03:41:33.615, 5; B 1389: 03:41:33.847, 3; C 1390: 03:41:34.508, 141 | yes | yes | yes / yes | reversed / reversed / reversed | — | 0, 134 | **yes** | yes (max 141) | 202 (67.3) |
| 2 | A 1391: 03:41:58.574, 2; B 1393: 03:42:00.680, 81; C 1392: 03:41:59.120, 6 | yes | yes | yes / yes | in order / in order / reversed | — | 0, 0 | **yes** | yes (max 81) | 273 (91.0) |
| 3 | A 1394: 03:42:23.604, 3; B 1395: 03:42:23.805, 4; C 1396: 03:42:25.317, 41 | yes | yes | yes / yes | reversed / reversed / reversed | — | 0, 65 | **yes** | yes (max 41) | 193 (64.3) |
| 4 | A 1397: 03:42:48.567, 3; B 1398: 03:42:48.844, 3; C 1399: 03:42:49.246, 31 | yes | yes | yes / yes | reversed / reversed / reversed | — | 0, 99 | **yes** | yes (max 31) | 195 (65.0) |
| 5 | A 1400: 03:43:13.524, 3; B 1402: 03:43:15.350, 80; C 1401: 03:43:14.126, 54 | yes | yes | yes / yes | in order / in order / reversed | — | 0, 0 | **yes** | yes (max 80) | 350 (116.7) |
| 6 | A 1403: 03:43:38.598, 8; B 1404: 03:43:40.423, 166; C 1405: 03:43:40.479, 88 | yes | yes | yes / yes | in order / in order / reversed | — | 0, 0 | **yes** | yes (max 166) | 381 (127.0) |

Commit → entry stored (server clock: set `at` − writer `at`, ms; `→N` = the entry's actual rev ≠ key) and the first `warm` probe of that key (+s after the last response; an upper bound):

| group | key (who) | ja | ko | en |
|---|---|---|---|---|
| 1 | 1388 (A) | 1598; probe +1 s | 1603; probe +1 s | 3252 →1390; probe +4 s |
| 1 | 1389 (B) | 194; probe +1 s | 172; probe +1 s | 329; probe +1 s |
| 1 | 1390 (C) | 101; probe +1 s | 91; probe +1 s | 159; probe +1 s |
| 2 | 1391 (A) | 1693; probe +1 s | 1713; probe +1 s | 3570 →1392; probe +2 s |
| 2 | 1393 (B) | 90; probe +1 s | 50; probe +1 s | 130; probe +1 s |
| 2 | 1392 (C) | 395; probe +1 s | 359; probe +1 s | 1432; probe +1 s |
| 3 | 1394 (A) | 1555; probe +1 s | 1572; probe +1 s | 3231 →1395; probe +2 s |
| 3 | 1395 (B) | 66; probe +1 s | 62; probe +1 s | 152; probe +1 s |
| 3 | 1396 (C) | 83; probe +1 s | 52; probe +1 s | 128; probe +1 s |
| 4 | 1397 (A) | 1576; probe +1 s | 1558; probe +1 s | 3228 →1399; probe +4 s |
| 4 | 1398 (B) | 140; probe +1 s | 110; probe +1 s | 204; probe +1 s |
| 4 | 1399 (C) | 326; probe +1 s | 228; probe +1 s | 419; probe +1 s |
| 5 | 1400 (A) | 1620; probe +1 s | 1641; probe +1 s | 3300 →1401; probe +2 s |
| 5 | 1402 (B) | 84; probe +1 s | 52; probe +1 s | 120; probe +1 s |
| 5 | 1401 (C) | 235; probe +1 s | 218; probe +1 s | 729; probe +1 s |
| 6 | 1403 (A) | 1603; probe +1 s | 1600; probe +1 s | 3314; probe +2 s |
| 6 | 1404 (B) | 214 →1405; probe +1 s | 171 →1405; probe +1 s | 759 →1405; probe +1 s |
| 6 | 1405 (C) | 350; probe +1 s | 221; probe +1 s | 945; probe +1 s |

Client-side gates from the run (**a gate failed**): all intended saves committed (2xx) PASS; 5xx anywhere (saves, reloads, catalog, reactions, probes, SDK, pages) PASS; convergence to head from the last save start — pages PASS; convergence to head from the last save start — SDK PASS; DOM monotonicity (pages: marker-derived version never goes back) PASS; (rev, capturedAt) monotonicity (SDK applied) PASS; PUT latency, original attempt — save A PASS; PUT latency, original attempt — save B FAIL; PUT latency, original attempt — save C FAIL; admin editor reloads in the save window PASS; raw reactions PASS.
