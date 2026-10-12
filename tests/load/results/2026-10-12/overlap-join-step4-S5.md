## Overlap join — 2026-10-12T03-38-05-060Z-browsers-overlap.json + 2026-10-12T03-32-00Z-vercel-logs-history-step4-S5.txt

Scenario **S5** (A's header fault, logged as `fault=slowset:1500 source=header`): **EXERCISED (4/6 ≥ 3)**. Server: EMAXCONN 0, `[liveWriter] failed kind=pool_acquire_timeout` 0 (all failed kinds 0), warm jobs 16, expire-warm lines 36.

Exposure from server timestamps (proxies; three clocks — server function `at*`, PostgreSQL `captureAt`, this machine for probes). (iii) cross-instance differences < 100 ms = indeterminate.

| group | saves (who rev: writer at UTC, acquire ms) | A fault ok | (i) B during A | (ii) tx overlap / build overlap | (iii) ja / ko / en | (iv) ja / ko / en | S3 (failed sets, misses during B) | exercised | acquire ≤ 500 | builds [start, +10 s] (per save) |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | A 1370: 03:32:59.893, 4; B 1371: 03:33:00.101, 2 | yes | yes | no / no | reversed / reversed / reversed | no, stale 2 / no, stale 2 / no | 0, 192 | no | yes (max 4) | 429 (214.5) |
| 2 | A 1372: 03:33:24.895, 9; B 1373: 03:33:25.123, 4 | yes | yes | no / no | reversed / reversed / reversed | race, stale 2 / race, stale 2 / no | 0, 83 | **yes** | yes (max 9) | 345 (172.5) |
| 3 | A 1374: 03:33:49.832, 12; B 1375: 03:33:50.058, 4 | yes | yes | no / no | reversed / reversed / reversed | race, stale 2 / race, stale 2 / no | 0, 121 | **yes** | yes (max 12) | 293 (146.5) |
| 4 | A 1376: 03:34:14.790, 2; B 1377: 03:34:15.119, 5 | yes | yes | no / no | reversed / reversed / reversed | no, stale 2 / no, stale 3 / no | 0, 152 | no | yes (max 5) | 368 (184.0) |
| 5 | A 1378: 03:34:39.835, 5; B 1379: 03:34:40.011, 4 | yes | yes | no / no | reversed / reversed / reversed | race, stale 2 / race, stale 2 (censored) / no | 0, 71 | **yes** | yes (max 5) | 415 (207.5) |
| 6 | A 1380: 03:35:04.804, 5; B 1381: 03:35:04.998, 4 | yes | yes | no / no | reversed / reversed / reversed | race, stale 2 / race, stale 2 / no | 0, 79 | **yes** | yes (max 5) | 337 (168.5) |

Commit → entry stored (server clock: set `at` − writer `at`, ms; `→N` = the entry's actual rev ≠ key) and the first `warm` probe of that key (+s after the last response; an upper bound):

| group | key (who) | ja | ko | en |
|---|---|---|---|---|
| 1 | 1370 (A) | 1569; probe +2 s | 1576; probe +2 s | 3147 →1371; probe +4 s |
| 1 | 1371 (B) | 265; probe never warm | 259; probe never warm | 661; probe never warm |
| 2 | 1372 (A) | 1570; probe +2 s | 1574; probe +2 s | 3287 →1373; probe +4 s |
| 2 | 1373 (B) | 80; probe never warm | 74; probe never warm | 324; probe never warm |
| 3 | 1374 (A) | 1553; probe +2 s | 1561; probe +2 s | 3126 →1375; probe +4 s |
| 3 | 1375 (B) | 94; probe never warm | 71; probe never warm | 315; probe never warm |
| 4 | 1376 (A) | 1581; probe +2 s | 1564; probe +1 s | 3213 →1377; probe +4 s |
| 4 | 1377 (B) | 194; probe never warm | 171; probe never warm | 362; probe never warm |
| 5 | 1378 (A) | 1558; probe +2 s | 1578; probe +2 s | 3175 →1379; probe +4 s |
| 5 | 1379 (B) | 73; probe never warm | 59; probe never warm | 192; probe never warm |
| 6 | 1380 (A) | 1559; probe +2 s | 1565; probe +2 s | 3117 →1381; probe +4 s |
| 6 | 1381 (B) | 71; probe never warm | 77; probe never warm | 230; probe never warm |

Catalog race (S5) per locale: expiry start / done (server clock), why a locale did NOT race, content-proven stale answers (a `warm` answer after the expiry with the pre-edit title):

- group 1: expire-warm 2026-10-12T03:33:00.201Z → 2026-10-12T03:33:00.206Z; ja: no (B not published before the expiry), captured 299 ms before the expiry, B's key gone after expiry, **stale 2× 2026-10-12T03:33:02.416Z → 2026-10-12T03:33:04.417Z**; ko: no (B not published before the expiry), captured 298 ms before the expiry, B's key gone after expiry, **stale 2× 2026-10-12T03:33:02.417Z → 2026-10-12T03:33:04.417Z**; en: no (A captured after the expiry started; B not published before the expiry), captured -1261 ms before the expiry, B's key gone after expiry
- group 2: expire-warm 2026-10-12T03:33:25.223Z → 2026-10-12T03:33:25.229Z; ja: race, captured 310 ms before the expiry, B's key gone after expiry, **stale 2× 2026-10-12T03:33:27.436Z → 2026-10-12T03:33:29.447Z**; ko: race, captured 310 ms before the expiry, B's key gone after expiry, **stale 2× 2026-10-12T03:33:27.437Z → 2026-10-12T03:33:29.448Z**; en: no (A captured after the expiry started; B not published before the expiry), captured -1367 ms before the expiry, B's key gone after expiry
- group 3: expire-warm 2026-10-12T03:33:50.161Z → 2026-10-12T03:33:50.190Z; ja: race, captured 322 ms before the expiry, B's key gone after expiry, **stale 2× 2026-10-12T03:33:52.377Z → 2026-10-12T03:33:54.377Z**; ko: race, captured 322 ms before the expiry, B's key gone after expiry, **stale 2× 2026-10-12T03:33:52.378Z → 2026-10-12T03:33:54.378Z**; en: no (A captured after the expiry started; B not published before the expiry), captured -1245 ms before the expiry, B's key gone after expiry
- group 4: expire-warm 2026-10-12T03:34:15.160Z → 2026-10-12T03:34:15.186Z; ja: no (B not published before the expiry), captured 338 ms before the expiry, B's key gone after expiry, **stale 2× 2026-10-12T03:34:17.473Z → 2026-10-12T03:34:19.461Z**; ko: no (B not published before the expiry), captured 361 ms before the expiry, B's key gone after expiry, **stale 3× 2026-10-12T03:34:16.461Z → 2026-10-12T03:34:19.462Z**; en: no (A captured after the expiry started; B not published before the expiry), captured -1278 ms before the expiry, B's key gone after expiry
- group 5: expire-warm 2026-10-12T03:34:40.126Z → 2026-10-12T03:34:40.134Z; ja: race, captured 282 ms before the expiry, B's key gone after expiry, **stale 2× 2026-10-12T03:34:42.321Z → 2026-10-12T03:34:44.315Z**; ko: race, captured 281 ms before the expiry, B's key gone after expiry, **stale 2× 2026-10-12T03:34:42.322Z → 2026-10-12T03:34:44.316Z (censored)**; en: no (A captured after the expiry started; B not published before the expiry), captured -1299 ms before the expiry, B's key gone after expiry
- group 6: expire-warm 2026-10-12T03:35:05.189Z → 2026-10-12T03:35:05.195Z; ja: race, captured 377 ms before the expiry, B's key gone after expiry, **stale 2× 2026-10-12T03:35:07.306Z → 2026-10-12T03:35:09.307Z**; ko: race, captured 377 ms before the expiry, B's key gone after expiry, **stale 2× 2026-10-12T03:35:07.306Z → 2026-10-12T03:35:09.307Z**; en: no (A captured after the expiry started; B not published before the expiry), captured -1174 ms before the expiry, B's key gone after expiry

Client-side gates from the run (all pass): all intended saves committed (2xx) PASS; 5xx anywhere (saves, reloads, catalog, reactions, probes, SDK, pages) PASS; convergence to head from the last save start — pages PASS; convergence to head from the last save start — SDK PASS; DOM monotonicity (pages: marker-derived version never goes back) PASS; (rev, capturedAt) monotonicity (SDK applied) PASS; PUT latency, original attempt — save A PASS; PUT latency, original attempt — save B PASS; raw reactions PASS; page reaction ack hold PASS.
