## Overlap join — 2026-10-12T02-16-19-723Z-browsers-overlap.json + 2026-10-12T02-13-02Z-vercel-logs-history-step4-S2.txt

Scenario **S2** (A's header fault, logged as `fault=slowset:1500 source=header`): **EXERCISED (6/6 ≥ 4)**. Server: EMAXCONN 0, `[liveWriter] failed kind=pool_acquire_timeout` 0 (all failed kinds 0), warm jobs 16, expire-warm lines 0.

Exposure from server timestamps (proxies; three clocks — server function `at*`, PostgreSQL `captureAt`, this machine for probes). (iii) cross-instance differences < 100 ms = indeterminate.

| group | saves (who rev: writer at UTC, acquire ms) | A fault ok | (i) B during A | (ii) tx overlap / build overlap | (iii) ja / ko / en | (iv) ja / ko / en | S3 (failed sets, misses during B) | exercised | acquire ≤ 500 | builds [start, +10 s] (per save) |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | A 1336: 02:14:06.262, 3; B 1337: 02:14:06.565, 4 | yes | yes | no / no | reversed / reversed / reversed | — | 0, 167 | **yes** | yes (max 4) | 234 (117.0) |
| 2 | A 1338: 02:14:31.255, 3; B 1339: 02:14:31.517, 14 | yes | yes | no / no | reversed / reversed / reversed | — | 0, 180 | **yes** | yes (max 14) | 166 (83.0) |
| 3 | A 1340: 02:14:56.221, 3; B 1341: 02:14:56.390, 3 | yes | yes | no / no | reversed / reversed / reversed | — | 0, 45 | **yes** | yes (max 3) | 181 (90.5) |
| 4 | A 1342: 02:15:21.266, 3; B 1343: 02:15:21.483, 4 | yes | yes | no / no | reversed / reversed / reversed | — | 0, 99 | **yes** | yes (max 4) | 176 (88.0) |
| 5 | A 1344: 02:15:46.147, 2; B 1345: 02:15:46.424, 4 | yes | yes | no / no | reversed / reversed / reversed | — | 0, 139 | **yes** | yes (max 4) | 235 (117.5) |
| 6 | A 1346: 02:16:11.268, 4; B 1347: 02:16:11.536, 4 | yes | yes | no / no | reversed / reversed / reversed | — | 0, 115 | **yes** | yes (max 4) | 216 (108.0) |

Commit → entry stored (server clock: set `at` − writer `at`, ms; `→N` = the entry's actual rev ≠ key) and the first `warm` probe of that key (+s after the last response; an upper bound):

| group | key (who) | ja | ko | en |
|---|---|---|---|---|
| 1 | 1336 (A) | 1591; probe +2 s | 1582; probe +2 s | 3167 →1337; probe +4 s |
| 1 | 1337 (B) | 242; probe +1 s | 200; probe +1 s | 432; probe +1 s |
| 2 | 1338 (A) | 1582; probe +2 s | 1579; probe +2 s | 3132 →1339; probe +4 s |
| 2 | 1339 (B) | 184; probe +1 s | 144; probe +1 s | 434; probe +1 s |
| 3 | 1340 (A) | 1593; probe +2 s | 1573; probe +2 s | 3118 →1341; probe +4 s |
| 3 | 1341 (B) | 67; probe +1 s | 55; probe +1 s | 112; probe +1 s |
| 4 | 1342 (A) | 1597; probe +2 s | 1574; probe +2 s | 3123 →1343; probe +4 s |
| 4 | 1343 (B) | 175; probe +1 s | 77; probe +1 s | 223; probe +1 s |
| 5 | 1344 (A) | 1559; probe +2 s | 1553; probe +2 s | 3092 →1345; probe +4 s |
| 5 | 1345 (B) | 105; probe +1 s | 119; probe +1 s | 295; probe +1 s |
| 6 | 1346 (A) | 1548; probe +2 s | 1560; probe +2 s | 3095 →1347; probe +4 s |
| 6 | 1347 (B) | 97; probe +1 s | 116; probe +1 s | 221; probe +1 s |

Client-side gates from the run (all pass): all intended saves committed (2xx) PASS; 5xx anywhere (saves, reloads, catalog, reactions, probes, SDK, pages) PASS; convergence to head from the last save start — pages PASS; convergence to head from the last save start — SDK PASS; DOM monotonicity (pages: marker-derived version never goes back) PASS; (rev, capturedAt) monotonicity (SDK applied) PASS; PUT latency, original attempt — save A PASS; PUT latency, original attempt — save B PASS.
