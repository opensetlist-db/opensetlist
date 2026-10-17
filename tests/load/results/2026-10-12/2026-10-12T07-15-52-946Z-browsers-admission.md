# Browsers run — 2026-10-12T07:12:18.545Z

- Target: https://opensetlist-6pth66f6b-opensetlist-projects.vercel.app/events/111/rehearsal-lovelive-fes-2020-day1 (event 111, start rev 1648, 69 active rows; insert after row 2 = position 2)
- Population: 30 Chromium pages (ja/ko/en 70/20/10), 470 SDK subscribers in 4 worker thread(s)
- Edits: 0 × (insert-after + PUT marker song) — edit mode pair (anchor row 2460), every 25 s; timeout 30 s; drill: none
- Window (UTC): run start 2026-10-12T07:12:18.545Z, first edit 2026-10-12T07:15:19.906Z, last edit settled 2026-10-12T07:15:47.801Z, end 2026-10-12T07:15:52.935Z
- Label: step5-A4
- Host guard at start: CPU 19.7 % busy (2 s CPU sample over 12 cores); 0 competing process(es) (--strict-host)

- Phase: admission — prepare via https://opensetlist-aq37mrxeu-opensetlist-projects.vercel.app, measured on https://opensetlist-6pth66f6b-opensetlist-projects.vercel.app (deployment URL)

## Admission (n14 step 5)

**Verdict: VALID + FAIL** — SDK aspect: VALID + FAIL; page aspect: VALID + FAIL; failed: pages: complete expected setlist, navigation start →; PUT end-to-end (every save of the run).

- Prepare via https://opensetlist-aq37mrxeu-opensetlist-projects.vercel.app (2026-10-12T07:12:22.412Z → 2026-10-12T07:12:27.354Z): anchor row 2460 @3 (rev 1649); manifest 70 active rows at rev 1649, 46 fixture clones (tests/load/results/2026-10-12/fixture-step5-A4.json); file `2026-10-12T07-12-27-353Z-admission-manifest.json`
- Boundary: waited 125.0 s (--admit-file tests/load/results/2026-10-12/admit-A4.json); **outbound requests during the wait: 0**; admit file: precursor dpl_FyMYr733ZQxtbspDmfJMTCSHU3zP → measurement dpl_5LdfYHkHavbDiBDfeguz9a5AKusC
- T0 2026-10-12T07:14:32.390Z; measurement base https://opensetlist-6pth66f6b-opensetlist-projects.vercel.app; pages 30 at concurrency 5, SDK 470 at 50/s, all started at T0; admission saves at +3 s, +6 s, +20 s, +45 s on their own timer (scheduled vs actual start: a1 +2 ms, a2 +0 ms, a3 +10 ms, a4 +14 ms); measurement identity read at T0: ok (rev 1649, 1815 ms)
- Exposure minimums (predeclared): SDK ≥ 100 connected through the save AND ≥ 100 not yet SUBSCRIBED at its PUT response; pages ≥ 5 navigated by the PUT start and not yet complete. Clocks: this host only (PUT response = upper bound of the commit); the server's commit `at` is a cross-check in `admission-join.mjs`.
- Resource diet: images, fonts and media are aborted on every page (the DOM is all that is measured); analytics and the Sentry tunnel too.

| admission gate | value | gate | verdict |
|---|---|---|---|
| outbound requests between prepare end and T0 | 0 | 0 | **PASS** |
| event unchanged between prepare and the first admission save (first answers not from this run's saves vs manifest rev) | foreign head seen 1649, manifest 1649 | ≤ manifest rev | **PASS** |
| all intended saves committed (admission saves never retried) | 4/4 admission | all 2xx | **PASS** |
| 5xx anywhere (saves, pages incl. the document, SDK, guard read) | 0 (none) | 0 | **PASS** |
| 503 (subset of the above) | 0 | 0 | **PASS** |
| transport failures on saves | 0 | 0 | **PASS** |
| all joined within --join-timeout (120 s from T0) | SDK 470/470, pages 30/30 | all | **PASS** |
| pages: complete expected setlist, navigation start → | 30 / 1024 / 5272 / 5315 | p95 ≤ 3000, every page | **FAIL** |
| pages: degraded SSR seed (no live seed in the HTML) | 0 (seeds {"live":30}) | 0 | **PASS** |
| SDK: time to first snapshot (start → first 200 applied) | 470 / 991 / 2805 / 3178 | p95 ≤ 3000, all | **PASS** |
| convergence SDK joined-before (from PUT start) | 1407 / 1560 / 2850 / 3503, missing 0 | p95 ≤ 3000, 0 missing | **PASS** |
| convergence SDK joined-after (from max(subscribedAt, PUT response)) | 473 / 698 / 1552 / 2271, missing 0 | p95 ≤ 3000, 0 missing | **PASS** |
| convergence pages joined-before (from PUT start; marker or a later one on the anchor) | 61 / 1109 / 1268 / 2189, missing 0 | p95 ≤ 3000, 0 missing | **PASS** |
| convergence pages joined-after (from max(channel join, PUT response)) | 59 / 0 / 1202 / 1558, missing 0 | p95 ≤ 3000, 0 missing | **PASS** |
| monotonicity (pages: DOM version; SDK: applied rev and (rev, capturedAt)) | 0 DOM/rev regressions, 0 (rev, capturedAt) regressions | 0 | **PASS** |
| PUT end-to-end (every save of the run) | 4 / 471 / 1822 / 1822 | p95 ≤ 1500 | **FAIL** |
| server side: writer acquire ≤ 500 ms, EMAXCONN 0, Σ < 300 with completeness, builds per minute / instance | — | `admission-join.mjs` on the history logs | n/a here |

### Per save — exposure, convergence, first answers

Convergence: joined-before from the PUT start, joined-after from max(subscribedAt / channel join, PUT response); p95 ms (n) / missing. Stale first answers = clients whose first read started after the PUT response but carried a lower rev (SDK: first request; pages: SSR seed) — counted, not a gate. Broadcast = clients that received this save's raw `rev` broadcast, separate from the reason of the fetch that applied it.

| save | label | rev | PUT start (UTC) | ms | SDK connected / not yet / dropped | pages in flight / future / settled | SDK before | SDK after | pages before | pages after | stale first: SDK / pages | broadcast received / population | applied by |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| a1 | SDK + page admission save | 1650 | 2026-10-12T07:14:35.392Z | 1822 | 155 / 211 / 104 | 5 / 25 / 0 | 3348 (155) / 0 | 1529 (315) / 0 | — (0) / 0 | 864 (30) / 0 | 0/210 / 0/25 | 259 / 470 | {"notification":205,"catchup":55,"initial":210} |
| a2 | SDK admission save | 1651 | 2026-10-12T07:14:38.390Z | 867 | 312 / 107 / 51 | 0 / 25 / 5 | 2854 (312) / 0 | 1602 (158) / 0 | 2189 (1) / 0 | 1401 (29) / 0 | 0/106 / 0/20 | 363 / 470 | {"notification":282,"catchup":50,"initial":138} |
| a3 | after admission | 1652 | 2026-10-12T07:14:52.400Z | 471 | 470 / 0 / 0 | 0 / 0 / 30 | 1847 (470) / 0 | — (0) / 0 | 1268 (30) / 0 | — (0) / 0 | 0/0 / 0/0 | 470 / 470 | {"notification":457,"periodic":13} |
| a4 | after admission | 1653 | 2026-10-12T07:15:17.404Z | 456 | 470 / 0 / 0 | 0 / 0 / 30 | 1717 (470) / 0 | — (0) / 0 | 1222 (30) / 0 | — (0) / 0 | 0/0 / 0/0 | 470 / 470 | {"notification":452,"periodic":18} |

SDK first snapshot: sources {"build":342,"cache":128}; body bytes p50 / max 165188 / 198676; first-answer revs {"1649":260,"1650":72,"1651":138}.

### Pages (every page)

Times in ms from the page's navigation start (browser timeOrigin) unless noted; launch = navigation start − T0 (scheduled vs actual: wave × concurrency). Complete = the ordered rows match the manifest (multiplicity, per-row song order, medleys, the blank anchor or any run marker on it); matched = best ordered match before the first steady edit. Hydrated = first /api/setlist request or first Realtime socket.

| page | locale | wave | launch ms after T0 | doc | TTFB | DCL | complete | rows matched | hydrated | channel joined | first fetch (source, rev) | SSR seed | errors |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 0 | ja | 0 | 316 | 200 | 307 | 5657 | 5189 | 70/70 | 5874 | 5924 | build, 1650 | live 1649 |  |
| 1 | ko | 0 | 321 | 200 | 284 | 5532 | 5315 | 70/70 | 5711 | 5777 | build, 1650 | live 1649 |  |
| 2 | ja | 0 | 320 | 200 | 304 | 4992 | 4724 | 70/70 | 5375 | 5458 | build, 1650 | live 1649 |  |
| 3 | en | 0 | 323 | 200 | 300 | 5715 | 5272 | 70/70 | 5934 | 6001 | build, 1650 | live 1649 |  |
| 4 | ja | 0 | 336 | 200 | 276 | 5432 | 5185 | 70/70 | 5625 | 5707 | build, 1650 | live 1649 |  |
| 5 | ja | 1 | 6152 | 200 | 46 | 4264 | 3874 | 70/70 | 4466 | 4528 | cache, 1651 | live 1651 |  |
| 6 | ko | 1 | 6196 | 200 | 50 | 4193 | 3916 | 70/70 | 4509 | 4587 | cache, 1651 | live 1651 |  |
| 7 | ja | 1 | 6219 | 200 | 46 | 2629 | 2476 | 70/70 | 2798 | 2865 | cache, 1651 | live 1651 |  |
| 8 | ja | 1 | 6233 | 200 | 48 | 2825 | 2700 | 70/70 | 3022 | 3074 | cache, 1651 | live 1651 |  |
| 9 | ja | 1 | 6243 | 200 | 44 | 2563 | 2238 | 70/70 | 2718 | 2778 | build, 1651 | live 1651 |  |
| 10 | ja | 2 | 10646 | 200 | 49 | 1539 | 1412 | 70/70 | 1748 | 1806 | cache, 1651 | live 1651 |  |
| 11 | ko | 2 | 10665 | 200 | 48 | 1106 | 1068 | 70/70 | 1369 | 1454 | cache, 1651 | live 1651 |  |
| 12 | ja | 2 | 10670 | 200 | 53 | 1059 | 674 | 70/70 | 1228 | 1306 | cache, 1651 | live 1651 |  |
| 13 | en | 2 | 10679 | 200 | 48 | 1058 | 988 | 70/70 | 1372 | 1443 | build, 1651 | live 1651 |  |
| 14 | ja | 2 | 10693 | 200 | 50 | 1022 | 971 | 70/70 | 1309 | 1384 | cache, 1651 | live 1651 |  |
| 15 | ja | 3 | 12355 | 200 | 48 | 1213 | 1080 | 70/70 | 1573 | 1668 | cache, 1651 | live 1651 |  |
| 16 | ko | 3 | 12367 | 200 | 42 | 1360 | 1112 | 70/70 | 1558 | 1621 | cache, 1651 | live 1651 |  |
| 17 | ja | 3 | 12380 | 200 | 48 | 1285 | 829 | 70/70 | 1511 | 1578 | cache, 1651 | live 1651 |  |
| 18 | ja | 3 | 12389 | 200 | 46 | 1109 | 983 | 70/70 | 1361 | 1429 | cache, 1651 | live 1651 |  |
| 19 | ja | 3 | 12406 | 200 | 41 | 1124 | 709 | 70/70 | 1380 | 1464 | cache, 1651 | live 1651 |  |
| 20 | ja | 4 | 13899 | 200 | 58 | 1450 | 992 | 70/70 | 1602 | 1662 | cache, 1651 | live 1651 |  |
| 21 | ko | 4 | 13957 | 200 | 48 | 1070 | 1024 | 70/70 | 1349 | 1434 | cache, 1651 | live 1651 |  |
| 22 | ja | 4 | 13963 | 200 | 48 | 1070 | 963 | 70/70 | 1366 | 1412 | cache, 1651 | live 1651 |  |
| 23 | en | 4 | 13967 | 200 | 38 | 1059 | 637 | 70/70 | 1307 | 1375 | build, 1651 | live 1651 |  |
| 24 | ja | 4 | 13972 | 200 | 43 | 1075 | 870 | 70/70 | 1280 | 1322 | cache, 1651 | live 1651 |  |
| 25 | ja | 5 | 15469 | 200 | 42 | 1030 | 875 | 70/70 | 1368 | 1413 | cache, 1651 | live 1651 |  |
| 26 | ko | 5 | 15493 | 200 | 45 | 1149 | 969 | 70/70 | 1362 | 2445 | cache, 1651 | live 1651 |  |
| 27 | ja | 5 | 15523 | 200 | 39 | 1442 | 1304 | 70/70 | 1708 | 1795 | cache, 1651 | live 1651 |  |
| 28 | ja | 5 | 15535 | 200 | 38 | 1145 | 974 | 70/70 | 1384 | 1436 | cache, 1651 | live 1651 |  |
| 29 | ja | 5 | 15543 | 200 | 43 | 1005 | 925 | 70/70 | 1342 | 1408 | cache, 1651 | live 1651 |  |

## Gate verdicts

Latency = save (the PUT that makes the marker exist; in a pair edit the insert-after came before it) request start of its FIRST attempt → marker link in the page DOM / SDK client applied a snapshot with rev ≥ the PUT's rev. Missing = not seen within the timeout. Monotonic: no page/client ever went back to an older version.

| Scope | n | p50 ms | p95 ms | max ms | missing | gate | verdict |
|---|---|---|---|---|---|---|---|
| all pairs (pages + SDK) | 1975 | 1719 | 5857 | 10825 | 25 | p95 ≤ 3000, 0 missing | n/a |
| edit × page | 95 | 1220 | 10233 | 10825 | 25 | same | n/a |
| edit × SDK client | 1880 | 1728 | 5757 | 7024 | 0 | same | n/a |
| monotonic DOM (pages: version shown never decreases) | 30 pages, 95 versions | — | — | — | 0 regressions on 0 page(s) | 0 | **PASS** |
| monotonic applied rev (SDK) | 470 clients, 4667 applies | — | — | — | 0 regressions on 0 client(s) | 0 | **PASS** |
| warming: warm hits ÷ hinted fetches (`x-snapshot-source: warm`) | SDK 2010/2315 (86.8 %), pages 118/118 (100.0 %) | — | — | — | — | informational; reader builds per save: `vercel-logs-summary.mjs` "Warming" on the history logs; arrival vs warm-complete: `warm-join.mjs` | n/a |
| edits with a retried save (clock from the 1st attempt) | 0 | — | — | — | 0 | informational — 0 edit(s); from the successful attempt p50/p95/max —/—/— | n/a |

Insert-start based (insert-after request start → marker; pair edits only), non-drilled: pages 0 | — | — | — · SDK 0 | — | — | — (n | p50 | p95 | max).

## Notification paths (PUT start → arrival)

An R1 page build (what the preview runs until R2 deploys, or after a rollback) is notified by postgres_changes and ignores the broadcast; an R2 build only has the broadcast. The SDK clients are always R2.

| Path | delivered / expected | p50 ms | p95 ms | max ms |
|---|---|---|---|---|
| postgres_changes UPDATE → pages (R1 build) | 0 / 120 | — | — | — |
| broadcast `rev` → pages | 65 / 120 | 521 | 916 | 917 |
| broadcast `rev` → SDK | 1562 / 1880 | 529 | 1868 | 1874 |

## Per edit

| # | mode | row | marker song | insert start (UTC) | ins ms | rev | save (PUT) start (UTC) | save ms | save rev |
|---|---|---|---|---|---|---|---|---|---|
| a1 | admission | 2460 | 1997 LOVE♡YOU♡Save the EARTH!! | — | — | — | 2026-10-12T07:14:35.392Z | 1822 | 1650 |
| a2 | admission | 2460 | 2000 Trick or Toxic | — | — | — | 2026-10-12T07:14:38.390Z | 867 | 1651 |
| a3 | admission | 2460 | 2014 POP LOVE | — | — | — | 2026-10-12T07:14:52.400Z | 471 | 1652 |
| a4 | admission | 2460 | 2015 Spinning Parade | — | — | — | 2026-10-12T07:15:17.404Z | 456 | 1653 |

### Per save — pages (save start → marker in the DOM)

| # | save rev | seen | p50 / p95 / max ms | missing | bcast → page p50 / p95 (n) | pg → page (n) | notification fetches (hint=1) | their x-snapshot-verify | warm / hinted | 1st hinted request start − commit p50 / p95 |
|---|---|---|---|---|---|---|---|---|---|---|
| a1 | 1650 | 5/30 | 3975 / 4102 / 4102 | 25 | — / — (0) | 0 | 0 | — | 0/0 | — / — |
| a2 | 1651 | 30/30 | 5881 / 10342 / 10825 | 0 | 916 / 917 (5) | 0 | 1 | satisfied 1 | 1/1 | 786 / 786 |
| a3 | 1652 | 30/30 | 1151 / 1268 / 1379 | 0 | 522 / 527 (30) | 0 | 30 | satisfied 30 | 30/30 | 336 / 546 |
| a4 | 1653 | 30/30 | 1023 / 1222 / 1284 | 0 | 499 / 502 (30) | 0 | 29 | satisfied 29 | 29/29 | 249 / 533 |

### Per save — SDK clients (save start → applied rev ≥ save rev)

| # | save rev | reached | p50 / p95 / max ms | missing | bcast → SDK p50 / p95 (n) | notification fetches | their x-snapshot-verify | ticket resolutions | rechecks (resolved) | exhausted | warm / hinted | 1st hinted send − commit p50 / p95 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| a1 | 1650 | 470/470 | 3180 / 6384 / 7024 | 0 | 1868 / 1872 (259) | 205 | satisfied 205 | satisfied 208 | 0 (0) | 0 | 101/205 | 346 / 743 |
| a2 | 1651 | 470/470 | 2132 / 3424 / 4026 | 0 | 919 / 927 (363) | 282 | satisfied 282 | satisfied 301 | 0 (0) | 0 | 83/282 | 337 / 549 |
| a3 | 1652 | 470/470 | 1479 / 1847 / 2533 | 0 | 527 / 534 (470) | 457 | satisfied 457 | satisfied 464 | 0 (0) | 0 | 457/457 | 309 / 528 |
| a4 | 1653 | 470/470 | 1308 / 1717 / 2454 | 0 | 503 / 509 (470) | 452 | satisfied 452 | satisfied 462 | 0 (0) | 0 | 452/452 | 312 / 521 |

## Hint outcomes (whole run)

- SDK: 4747 requests; notification fetches (hint=1) 2315, their x-snapshot-verify: satisfied 2315; all 200 responses: none 470, satisfied 4273
  - ticket resolutions: satisfied 2369; rechecks 0 (0.0 % of notification fetches), resolved on the recheck 0; hints exhausted 0; highest serverRev held 1655
  - request shapes (reason / generic / ticket): initial generic 470, catchup generic 448, notification +hint=1 2315, periodic generic 1460, periodic generic +H 32, catchup generic +H 22; failures by kind: —
  - notification fetches by x-snapshot-source: warm 2010, build 305 (warm 2010/2315 (86.8 %))
- Pages: 269 /api/setlist responses; notification fetches (hint=1) 118, their x-snapshot-verify: satisfied 118; all 200 responses: satisfied 269 (an R1 page build sends no hint=1)
  - notification fetches by x-snapshot-source: warm 118 (warm 118/118 (100.0 %))

## Measurement validity (load host)

Event-loop lag = how late a 100 ms interval tick ran, per thread, inside the measurement window 2026-10-12T07:14:32.390Z → 2026-10-12T07:15:47.801Z (p50 = median of the 10 s buckets' p50, p95 / p99 / max = the worst bucket). Heartbeats: one per second per worker, from its own loop. Deadline timers: fired − armed − 8,000 ms for every SDK request that hit the 8 s deadline. INVALID if any lag sample > 1000 ms or any heartbeat gap > 3000 ms.

| thread | lag p50 / p95 / p99 / max ms | samples > 1 s | heartbeats (max gap ms) | deadline timers fired: n, late p50 / p95 / max ms |
|---|---|---|---|---|
| main | 5 / 16 / 93 / 93 | 0 | — | — |
| worker 0 | 7 / 16 / 132 / 132 | 0 | 75 (1131) | 0, — / — / — |
| worker 1 | 5 / 16 / 35 / 35 | 0 | 75 (1124) | 0, — / — / — |
| worker 2 | 5 / 15 / 40 / 40 | 0 | 75 (1102) | 0, — / — / — |
| worker 3 | 5 / 19 / 54 / 54 | 0 | 74 (1099) | 0, — / — / — |

Verdict: valid.

Host (1 s samples; 12 logical cores, 65370 MB): host CPU = busy share of all cores; process CPU = this process (main + SDK workers) as a share of all cores; Chromium is in the host figure only. load1 is always 0 on Windows.

| phase | s | host CPU p50 / max % | process CPU p50 / max % | RSS max MB | free mem min MB | load1 max | threads |
|---|---|---|---|---|---|---|---|
| join | 47.5 | 27.2 / 86.2 | 4.3 / 30.7 | 818 | 31964 | 0 | 5 |
| settle | 0.0 | — / — | — / — | — | — | — | 0 |
| edits | 27.9 | 19.3 / 25 | 1.7 / 4.4 | 793 | 32285 | 0 | 5 |

## Population

- Pages: 30/30 loaded; channel joined 30; visibility {"visible":30}; locales {"ja":21,"ko":6,"en":3}
  - open → join ms: n=30 p50=1734 p95=6100 max=6184
  - /api/setlist responses seen: 269 ({"build":18,"warm":118,"cache":133}); page errors: 0; ws opens 30, closes 0; rev broadcasts seen 125; dropped notification frames 0, blocked attempts 0
- SDK: 470/470 joined; all joined after 18.152 s (from population start)
  - subscribe → SUBSCRIBED ms: n=470 p50=224 p95=357 max=1303
  - statuses {"SUBSCRIBED":470,"CLOSED":470}; disconnected episodes (polling while realtime-js rejoins) 0; channel re-creations 0; fetch failures 0 (with Retry-After 0); fetches by reason {"initial":470,"catchup":470,"notification":2315,"periodic":1492}; X-Snapshot-Source {"build":1070,"warm":2010,"cache":1666}

## Clean-up

- Soft-deleted 1/1 created rows; position restore: {"restored":67}
- Verify: {"dbActive":69,"snapshotItems":69,"snapshotRev":1655,"startRows":69,"goneMeanwhile":0,"sameOrder":true,"samePositions":true,"oursStillActive":[]}
