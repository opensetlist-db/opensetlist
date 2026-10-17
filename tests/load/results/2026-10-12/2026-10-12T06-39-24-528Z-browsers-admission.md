# Browsers run — 2026-10-12T06:36:01.650Z

- Target: https://opensetlist-git-dev-opensetlist-projects.vercel.app/events/111/rehearsal-lovelive-fes-2020-day1 (event 111, start rev 1601, 23 active rows; insert after row 2 = position 2)
- Population: 30 Chromium pages (ja/ko/en 70/20/10), 470 SDK subscribers in 4 worker thread(s)
- Edits: 0 × (insert-after + PUT marker song) — edit mode pair (anchor row 2360), every 25 s; timeout 30 s; drill: none
- Window (UTC): run start 2026-10-12T06:36:01.650Z, first edit 2026-10-12T06:38:51.730Z, last edit settled 2026-10-12T06:39:20.173Z, end 2026-10-12T06:39:24.520Z
- Label: step5-A0
- Host guard at start: CPU 18.4 % busy (2 s CPU sample over 12 cores); 0 competing process(es) (--strict-host)

- Phase: admission — prepare via https://opensetlist-git-dev-opensetlist-projects.vercel.app, measured on https://opensetlist-git-dev-opensetlist-projects.vercel.app

## Admission (n14 step 5)

**Verdict: VALID + FAIL** — SDK aspect: VALID + FAIL; page aspect: NOT EXERCISED; failed: pages: complete expected setlist, navigation start →; convergence SDK joined-before (from PUT start); convergence pages joined-after (from max(channel join, PUT response)).

- Prepare via https://opensetlist-git-dev-opensetlist-projects.vercel.app (2026-10-12T06:36:05.459Z → 2026-10-12T06:36:10.559Z): anchor row 2360 @3 (rev 1602); manifest 24 active rows at rev 1602; file `2026-10-12T06-36-10-558Z-admission-manifest.json`
- Boundary: waited 114.2 s (--admit-file tests/load/results/2026-10-12/admit-A0.json); **outbound requests during the wait: 0**; admit file: precursor dpl_C4qNzDuLijkiTj7BQ5mRg2r9H6K9 → measurement dpl_2DCAkZQZdCjRf2zj6HABBANqauQS
- T0 2026-10-12T06:38:04.746Z; measurement base https://opensetlist-git-dev-opensetlist-projects.vercel.app; pages 30 at concurrency 5, SDK 470 at 50/s, all started at T0; admission saves at +5 s, +20 s, +45 s on their own timer (scheduled vs actual start: a1 +2 ms, a2 +16 ms, a3 +16 ms)
- Exposure minimums (predeclared): SDK ≥ 100 connected through the save AND ≥ 100 not yet SUBSCRIBED at its PUT response; pages ≥ 5 navigated by the PUT start and not yet complete. Clocks: this host only (PUT response = upper bound of the commit); the server's commit `at` is a cross-check in `admission-join.mjs`.
- Resource diet: images, fonts and media are aborted on every page (the DOM is all that is measured); analytics and the Sentry tunnel too.

| admission gate | value | gate | verdict |
|---|---|---|---|
| outbound requests between prepare end and T0 | 0 | 0 | **PASS** |
| event unchanged between prepare and the first admission save (first answers vs manifest rev) | head seen 1602, manifest 1602 | ≤ manifest rev | **PASS** |
| all intended saves committed (admission saves never retried) | 3/3 admission | all 2xx | **PASS** |
| 5xx anywhere (saves, pages incl. the document, SDK, guard read) | 0 (none) | 0 | **PASS** |
| 503 (subset of the above) | 0 | 0 | **PASS** |
| transport failures on saves | 0 | 0 | **PASS** |
| all joined within --join-timeout (120 s from T0) | SDK 470/470, pages 30/30 | all | **PASS** |
| pages: complete expected setlist, navigation start → | 30 / 902 / 4476 / 4545 | p95 ≤ 3000, every page | **FAIL** |
| pages: degraded SSR seed (no live seed in the HTML) | 0 (seeds {"live":30}) | 0 | **PASS** |
| SDK: time to first snapshot (start → first 200 applied) | 470 / 425 / 2589 / 2861 | p95 ≤ 3000, all | **PASS** |
| convergence SDK joined-before (from PUT start) | 1198 / 1234 / 16342 / 16652, missing 0 | p95 ≤ 3000, 0 missing | **FAIL** |
| convergence SDK joined-after (from max(subscribedAt, PUT response)) | 212 / 102 / 340 / 623, missing 0 | p95 ≤ 3000, 0 missing | **PASS** |
| convergence pages joined-before (from PUT start; marker or a later one on the anchor) | 61 / 903 / 1138 / 15824, missing 0 | p95 ≤ 3000, 0 missing | **PASS** |
| convergence pages joined-after (from max(channel join, PUT response)) | 29 / 0 / 15198 / 15497, missing 0 | p95 ≤ 3000, 0 missing | **FAIL** |
| monotonicity (pages: DOM version; SDK: applied rev and (rev, capturedAt)) | 0 DOM/rev regressions, 0 (rev, capturedAt) regressions | 0 | **PASS** |
| PUT end-to-end (every save of the run) | 3 / 442 / 552 / 552 | p95 ≤ 1500 | **PASS** |
| server side: writer acquire ≤ 500 ms, EMAXCONN 0, Σ < 300 with completeness, builds per minute / instance | — | `admission-join.mjs` on the history logs | n/a here |

### Per save — exposure, convergence, first answers

Convergence: joined-before from the PUT start, joined-after from max(subscribedAt / channel join, PUT response); p95 ms (n) / missing. Stale first answers = clients whose first read started after the PUT response but carried a lower rev (SDK: first request; pages: SSR seed) — counted, not a gate. Broadcast = clients that received this save's raw `rev` broadcast, separate from the reason of the fetch that applied it.

| save | label | rev | PUT start (UTC) | ms | SDK connected / not yet / dropped | pages in flight / future / settled | SDK before | SDK after | pages before | pages after | stale first: SDK / pages | broadcast received / population | applied by |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| a1 | SDK admission save | 1603 | 2026-10-12T06:38:09.748Z | 552 | 258 / 212 / 0 | 0 / 25 / 5 | 16518 (258) / 0 | 340 (212) / 0 | 15824 (1) / 0 | 15198 (29) / 0 | 0/158 / 0/20 | 0 / 470 | {"periodic":88,"notification":170,"catchup":2,"initial":210} |
| a2 | after admission | 1604 | 2026-10-12T06:38:24.762Z | 442 | 470 / 0 / 0 | 0 / 0 / 30 | 1546 (470) / 0 | — (0) / 0 | 1124 (30) / 0 | — (0) / 0 | 0/0 / 0/0 | 470 / 470 | {"notification":458,"periodic":12} |
| a3 | after admission | 1605 | 2026-10-12T06:38:49.762Z | 442 | 470 / 0 / 0 | 0 / 0 / 30 | 1405 (470) / 0 | — (0) / 0 | 1138 (30) / 0 | — (0) / 0 | 0/0 / 0/0 | 470 / 470 | {"notification":449,"periodic":21} |

SDK first snapshot: sources {"build":360,"cache":110}; body bytes p50 / max 67184 / 80784; first-answer revs {"1602":260,"1603":210}.

### Pages (every page)

Times in ms from the page's navigation start (browser timeOrigin) unless noted; launch = navigation start − T0 (scheduled vs actual: wave × concurrency). Complete = the ordered rows match the manifest (multiplicity, per-row song order, medleys, the blank anchor or any run marker on it); matched = best ordered match before the first steady edit. Hydrated = first /api/setlist request or first Realtime socket.

| page | locale | wave | launch ms after T0 | doc | TTFB | DCL | complete | rows matched | hydrated | channel joined | first fetch (source, rev) | SSR seed | errors |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 0 | ja | 0 | 256 | 200 | 327 | 4585 | 4335 | 24/24 | 4837 | 4940 | cache, 1602 | live 1602 |  |
| 1 | ko | 0 | 260 | 200 | 323 | 4595 | 4545 | 24/24 | 4847 | 4922 | cache, 1602 | live 1602 |  |
| 2 | ja | 0 | 278 | 200 | 305 | 4693 | 4417 | 24/24 | 4803 | 4869 | cache, 1602 | live 1602 |  |
| 3 | en | 0 | 290 | 200 | 293 | 3378 | 3218 | 24/24 | 3583 | 3690 | cache, 1602 | live 1602 |  |
| 4 | ja | 0 | 301 | 200 | 289 | 4617 | 4476 | 24/24 | 4750 | 4824 | cache, 1602 | live 1602 |  |
| 5 | ja | 1 | 5105 | 200 | 50 | 945 | 683 | 24/24 | 1064 | 1189 | build, 1603 | live 1603 |  |
| 6 | ko | 1 | 5136 | 200 | 45 | 971 | 768 | 24/24 | 1192 | 1293 | build, 1603 | live 1603 |  |
| 7 | ja | 1 | 5140 | 200 | 49 | 1218 | 1009 | 24/24 | 1469 | 1569 | build, 1603 | live 1603 |  |
| 8 | ja | 1 | 5145 | 200 | 47 | 1233 | 1228 | 24/24 | 1508 | 1586 | build, 1603 | live 1603 |  |
| 9 | ja | 1 | 5155 | 200 | 45 | 1194 | 1191 | 24/24 | 1549 | 1606 | build, 1603 | live 1603 |  |
| 10 | ja | 2 | 6650 | 200 | 51 | 1052 | 701 | 24/24 | 1205 | 1278 | build, 1603 | live 1603 |  |
| 11 | ko | 2 | 6681 | 200 | 53 | 1108 | 1080 | 24/24 | 1353 | 1426 | cache, 1603 | live 1603 |  |
| 12 | ja | 2 | 6694 | 200 | 46 | 1077 | 820 | 24/24 | 1331 | 1411 | build, 1603 | live 1603 |  |
| 13 | en | 2 | 6703 | 200 | 47 | 1155 | 902 | 24/24 | 1296 | 1377 | cache, 1603 | live 1603 |  |
| 14 | ja | 2 | 6717 | 200 | 50 | 1222 | 985 | 24/24 | 1487 | 1558 | build, 1603 | live 1603 |  |
| 15 | ja | 3 | 8161 | 200 | 56 | 859 | 696 | 24/24 | 1079 | 1162 | cache, 1603 | live 1603 |  |
| 16 | ko | 3 | 8180 | 200 | 63 | 2021 | 1851 | 24/24 | 2236 | 2314 | cache, 1603 | live 1603 |  |
| 17 | ja | 3 | 8200 | 200 | 65 | 1385 | 1215 | 24/24 | 1587 | 1660 | cache, 1603 | live 1603 |  |
| 18 | ja | 3 | 8214 | 200 | 62 | 1045 | 773 | 24/24 | 1173 | 1379 | cache, 1603 | live 1603 |  |
| 19 | ja | 3 | 8228 | 200 | 47 | 1029 | 1025 | 24/24 | 1258 | 1322 | cache, 1603 | live 1603 |  |
| 20 | ja | 4 | 10391 | 200 | 49 | 859 | 629 | 24/24 | 1154 | 1250 | cache, 1603 | live 1603 |  |
| 21 | ko | 4 | 10400 | 200 | 46 | 892 | 887 | 24/24 | 1193 | 1280 | cache, 1603 | live 1603 |  |
| 22 | ja | 4 | 10415 | 200 | 51 | 702 | 485 | 24/24 | 1027 | 1066 | cache, 1603 | live 1603 |  |
| 23 | en | 4 | 10434 | 200 | 44 | 893 | 671 | 24/24 | 1194 | 1320 | cache, 1603 | live 1603 |  |
| 24 | ja | 4 | 10443 | 200 | 36 | 930 | 924 | 24/24 | 1287 | 1378 | cache, 1603 | live 1603 |  |
| 25 | ja | 5 | 11698 | 200 | 48 | 837 | 471 | 24/24 | 1044 | 1079 | cache, 1603 | live 1603 |  |
| 26 | ko | 5 | 11712 | 200 | 46 | 917 | 911 | 24/24 | 1200 | 1277 | cache, 1603 | live 1603 |  |
| 27 | ja | 5 | 11725 | 200 | 52 | 809 | 514 | 24/24 | 1093 | 1171 | cache, 1603 | live 1603 |  |
| 28 | ja | 5 | 11745 | 200 | 46 | 680 | 662 | 24/24 | 1167 | 1257 | cache, 1603 | live 1603 |  |
| 29 | ja | 5 | 11760 | 200 | 46 | 786 | 781 | 24/24 | 1118 | 1181 | cache, 1603 | live 1603 |  |

## Gate verdicts

Latency = save (the PUT that makes the marker exist; in a pair edit the insert-after came before it) request start of its FIRST attempt → marker link in the page DOM / SDK client applied a snapshot with rev ≥ the PUT's rev. Missing = not seen within the timeout. Monotonic: no page/client ever went back to an older version.

| Scope | n | p50 ms | p95 ms | max ms | missing | gate | verdict |
|---|---|---|---|---|---|---|---|
| all pairs (pages + SDK) | 1496 | 1270 | 16250 | 16652 | 4 | p95 ≤ 3000, 0 missing | n/a |
| edit × page | 86 | 967 | 7166 | 7538 | 4 | same | n/a |
| edit × SDK client | 1410 | 1280 | 16279 | 16652 | 0 | same | n/a |
| monotonic DOM (pages: version shown never decreases) | 30 pages, 86 versions | — | — | — | 0 regressions on 0 page(s) | 0 | **PASS** |
| monotonic applied rev (SDK) | 470 clients, 4181 applies | — | — | — | 0 regressions on 0 client(s) | 0 | **PASS** |
| warming: warm hits ÷ hinted fetches (`x-snapshot-source: warm`) | SDK 1825/1825 (100.0 %), pages 117/117 (100.0 %) | — | — | — | — | informational; reader builds per save: `vercel-logs-summary.mjs` "Warming" on the history logs; arrival vs warm-complete: `warm-join.mjs` | n/a |
| edits with a retried save (clock from the 1st attempt) | 0 | — | — | — | 0 | informational — 0 edit(s); from the successful attempt p50/p95/max —/—/— | n/a |

Insert-start based (insert-after request start → marker; pair edits only), non-drilled: pages 0 | — | — | — · SDK 0 | — | — | — (n | p50 | p95 | max).

## Notification paths (PUT start → arrival)

An R1 page build (what the preview runs until R2 deploys, or after a rollback) is notified by postgres_changes and ignores the broadcast; an R2 build only has the broadcast. The SDK clients are always R2.

| Path | delivered / expected | p50 ms | p95 ms | max ms |
|---|---|---|---|---|
| postgres_changes UPDATE → pages (R1 build) | 0 / 90 | — | — | — |
| broadcast `rev` → pages | 60 / 90 | 494 | 501 | 503 |
| broadcast `rev` → SDK | 940 / 1410 | 497 | 503 | 507 |

## Per edit

| # | mode | row | marker song | insert start (UTC) | ins ms | rev | save (PUT) start (UTC) | save ms | save rev |
|---|---|---|---|---|---|---|---|---|---|
| a1 | admission | 2360 | 1997 LOVE♡YOU♡Save the EARTH!! | — | — | — | 2026-10-12T06:38:09.748Z | 552 | 1603 |
| a2 | admission | 2360 | 1998 What is my LIFE? | — | — | — | 2026-10-12T06:38:24.762Z | 442 | 1604 |
| a3 | admission | 2360 | 1999 イキタクナイevery day | — | — | — | 2026-10-12T06:38:49.762Z | 442 | 1605 |

### Per save — pages (save start → marker in the DOM)

| # | save rev | seen | p50 / p95 / max ms | missing | bcast → page p50 / p95 (n) | pg → page (n) | notification fetches (hint=1) | their x-snapshot-verify | warm / hinted | 1st hinted request start − commit p50 / p95 |
|---|---|---|---|---|---|---|---|---|---|---|
| a1 | 1603 | 26/30 | 3984 / 7402 / 7538 | 4 | — / — (0) | 0 | 0 | — | 0/0 | — / — |
| a2 | 1604 | 30/30 | 855 / 1124 / 1159 | 0 | 493 / 500 (30) | 0 | 30 | satisfied 30 | 30/30 | 229 / 497 |
| a3 | 1605 | 30/30 | 930 / 1138 / 1203 | 0 | 496 / 501 (30) | 0 | 28 | satisfied 28 | 28/28 | 328 / 512 |

### Per save — SDK clients (save start → applied rev ≥ save rev)

| # | save rev | reached | p50 / p95 / max ms | missing | bcast → SDK p50 / p95 (n) | notification fetches | their x-snapshot-verify | ticket resolutions | rechecks (resolved) | exhausted | warm / hinted | 1st hinted send − commit p50 / p95 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| a1 | 1603 | 470/470 | 13758 / 16476 / 16652 | 0 | — / — (0) | 0 | — | — | 0 (0) | 0 | 0/0 | — / — |
| a2 | 1604 | 470/470 | 1183 / 1546 / 1689 | 0 | 497 / 503 (470) | 458 | satisfied 458 | satisfied 463 | 0 (0) | 0 | 458/458 | 302 / 535 |
| a3 | 1605 | 470/470 | 1124 / 1405 / 1518 | 0 | 496 / 502 (470) | 449 | satisfied 449 | satisfied 461 | 0 (0) | 0 | 449/449 | 311 / 535 |

## Hint outcomes (whole run)

- SDK: 4256 requests; notification fetches (hint=1) 1825, their x-snapshot-verify: satisfied 1825; all 200 responses: none 470, satisfied 3782
  - ticket resolutions: satisfied 1854; rechecks 0 (0.0 % of notification fetches), resolved on the recheck 0; hints exhausted 0; highest serverRev held 1607
  - request shapes (reason / generic / ticket): initial generic 470, catchup generic 470, periodic generic 1462, notification +hint=1 1825, periodic generic +H 29; failures by kind: —
  - notification fetches by x-snapshot-source: warm 1825 (warm 1825/1825 (100.0 %))
- Pages: 269 /api/setlist responses; notification fetches (hint=1) 117, their x-snapshot-verify: satisfied 117; all 200 responses: satisfied 269 (an R1 page build sends no hint=1)
  - notification fetches by x-snapshot-source: warm 117 (warm 117/117 (100.0 %))

## Measurement validity (load host)

Event-loop lag = how late a 100 ms interval tick ran, per thread, inside the measurement window 2026-10-12T06:38:04.746Z → 2026-10-12T06:39:20.173Z (p50 = median of the 10 s buckets' p50, p95 / p99 / max = the worst bucket). Heartbeats: one per second per worker, from its own loop. Deadline timers: fired − armed − 8,000 ms for every SDK request that hit the 8 s deadline. INVALID if any lag sample > 1000 ms or any heartbeat gap > 3000 ms.

| thread | lag p50 / p95 / p99 / max ms | samples > 1 s | heartbeats (max gap ms) | deadline timers fired: n, late p50 / p95 / max ms |
|---|---|---|---|---|
| main | 2 / 16 / 29 / 29 | 0 | — | — |
| worker 0 | 2 / 16 / 34 / 34 | 0 | 75 (1097) | 0, — / — / — |
| worker 1 | 2 / 16 / 40 / 40 | 0 | 75 (1093) | 0, — / — / — |
| worker 2 | 2 / 15 / 29 / 29 | 0 | 75 (1097) | 0, — / — / — |
| worker 3 | 2 / 15 / 32 / 32 | 0 | 75 (1109) | 0, — / — / — |

Verdict: valid.

Host (1 s samples; 12 logical cores, 65370 MB): host CPU = busy share of all cores; process CPU = this process (main + SDK workers) as a share of all cores; Chromium is in the host figure only. load1 is always 0 on Windows.

| phase | s | host CPU p50 / max % | process CPU p50 / max % | RSS max MB | free mem min MB | load1 max | threads |
|---|---|---|---|---|---|---|---|
| join | 47.0 | 17.7 / 72 | 1.6 / 25.6 | 702 | 35215 | 0 | 5 |
| settle | 0.0 | — / — | — / — | — | — | — | 0 |
| edits | 28.4 | 17.6 / 28.4 | 1 / 1.8 | 741 | 35334 | 0 | 5 |

## Population

- Pages: 30/30 loaded; channel joined 30; visibility {"visible":30}; locales {"ja":21,"ko":6,"en":3}
  - open → join ms: n=30 p50=1513 p95=5067 max=5081
  - /api/setlist responses seen: 269 ({"cache":127,"warm":117,"build":25}); page errors: 0; ws opens 30, closes 0; rev broadcasts seen 120; dropped notification frames 0, blocked attempts 0
- SDK: 470/470 joined; all joined after 13.067 s (from population start)
  - subscribe → SUBSCRIBED ms: n=470 p50=217 p95=1850 max=2315
  - statuses {"SUBSCRIBED":470,"CLOSED":470}; disconnected episodes (polling while realtime-js rejoins) 0; channel re-creations 0; fetch failures 0 (with Retry-After 0); fetches by reason {"initial":470,"catchup":470,"periodic":1491,"notification":1825}; X-Snapshot-Source {"build":830,"cache":1597,"warm":1825}

## Clean-up

- Soft-deleted 1/1 created rows; position restore: {"restored":21}
- Verify: {"dbActive":23,"snapshotItems":23,"snapshotRev":1607,"startRows":23,"goneMeanwhile":0,"sameOrder":true,"samePositions":true,"oursStillActive":[]}
