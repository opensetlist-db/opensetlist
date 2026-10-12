# Browsers run — 2026-10-12T07:21:32.781Z

- Target: https://opensetlist-appbunl4u-opensetlist-projects.vercel.app/events/111/rehearsal-lovelive-fes-2020-day1 (event 111, start rev 1658, 69 active rows; insert after row 2 = position 2)
- Population: 30 Chromium pages (ja/ko/en 70/20/10), 470 SDK subscribers in 4 worker thread(s)
- Edits: 0 × (insert-after + PUT marker song) — edit mode pair (anchor row 2507), every 25 s; timeout 30 s; drill: none
- Window (UTC): run start 2026-10-12T07:21:32.781Z, first edit 2026-10-12T07:22:53.970Z, last edit settled 2026-10-12T07:23:21.392Z, end 2026-10-12T07:23:27.458Z
- Label: step5-A4b
- Host guard at start: CPU 20.9 % busy (2 s CPU sample over 12 cores); 0 competing process(es) (--strict-host)

- Phase: admission — prepare via https://opensetlist-aq37mrxeu-opensetlist-projects.vercel.app, measured on https://opensetlist-appbunl4u-opensetlist-projects.vercel.app (deployment URL)

## Admission (n14 step 5)

**Verdict: VALID + FAIL** — SDK aspect: VALID + FAIL; page aspect: VALID + FAIL; failed: pages: complete expected setlist, navigation start →; convergence SDK joined-before (from PUT start); PUT end-to-end (every save of the run).

- Prepare via https://opensetlist-aq37mrxeu-opensetlist-projects.vercel.app (2026-10-12T07:21:36.604Z → 2026-10-12T07:21:42.367Z): anchor row 2507 @3 (rev 1659); manifest 70 active rows at rev 1659, 46 fixture clones (tests/load/results/2026-10-12/fixture-step5-A4b.json); file `2026-10-12T07-21-42-366Z-admission-manifest.json`
- Boundary: waited 23.5 s (--admit-file tests/load/results/2026-10-12/admit-A4b.json); **outbound requests during the wait: 0**; admit file: precursor dpl_FyMYr733ZQxtbspDmfJMTCSHU3zP → measurement dpl_At6o6q55TUC3zo32P5sgMMUbtWoK
- T0 2026-10-12T07:22:05.887Z; measurement base https://opensetlist-appbunl4u-opensetlist-projects.vercel.app; pages 30 at concurrency 5, SDK 470 at 50/s, all started at T0; admission saves at +3 s, +6 s, +20 s, +45 s on their own timer (scheduled vs actual start: a1 +14 ms, a2 +8 ms, a3 +4 ms, a4 +4 ms); measurement identity read at T0: ok (rev 1659, 1756 ms)
- Exposure minimums (predeclared): SDK ≥ 100 connected through the save AND ≥ 100 not yet SUBSCRIBED at its PUT response; pages ≥ 5 navigated by the PUT start and not yet complete. Clocks: this host only (PUT response = upper bound of the commit); the server's commit `at` is a cross-check in `admission-join.mjs`.
- Resource diet: images, fonts and media are aborted on every page (the DOM is all that is measured); analytics and the Sentry tunnel too.

| admission gate | value | gate | verdict |
|---|---|---|---|
| outbound requests between prepare end and T0 | 0 | 0 | **PASS** |
| event unchanged between prepare and the first admission save (first answers not from this run's saves vs manifest rev) | foreign head seen 1659, manifest 1659 | ≤ manifest rev | **PASS** |
| all intended saves committed (admission saves never retried) | 4/4 admission | all 2xx | **PASS** |
| 5xx anywhere (saves, pages incl. the document, SDK, guard read) | 0 (none) | 0 | **PASS** |
| 503 (subset of the above) | 0 | 0 | **PASS** |
| transport failures on saves | 0 | 0 | **PASS** |
| all joined within --join-timeout (120 s from T0) | SDK 470/470, pages 30/30 | all | **PASS** |
| pages: complete expected setlist, navigation start → | 30 / 1000 / 6157 / 6166 | p95 ≤ 3000, every page | **FAIL** |
| pages: degraded SSR seed (no live seed in the HTML) | 0 (seeds {"live":30}) | 0 | **PASS** |
| SDK: time to first snapshot (start → first 200 applied) | 470 / 1107 / 2748 / 3103 | p95 ≤ 3000, all | **PASS** |
| convergence SDK joined-before (from PUT start) | 1408 / 2254 / 4940 / 5909, missing 0 | p95 ≤ 3000, 0 missing | **FAIL** |
| convergence SDK joined-after (from max(subscribedAt, PUT response)) | 472 / 936 / 2299 / 3406, missing 0 | p95 ≤ 3000, 0 missing | **PASS** |
| convergence pages joined-before (from PUT start; marker or a later one on the anchor) | 62 / 1415 / 2178 / 4147, missing 0 | p95 ≤ 3000, 0 missing | **PASS** |
| convergence pages joined-after (from max(channel join, PUT response)) | 58 / 0 / 1353 / 3087, missing 0 | p95 ≤ 3000, 0 missing | **PASS** |
| monotonicity (pages: DOM version; SDK: applied rev and (rev, capturedAt)) | 0 DOM/rev regressions, 0 (rev, capturedAt) regressions | 0 | **PASS** |
| PUT end-to-end (every save of the run) | 4 / 532 / 2427 / 2427 | p95 ≤ 1500 | **FAIL** |
| server side: writer acquire ≤ 500 ms, EMAXCONN 0, Σ < 300 with completeness, builds per minute / instance | — | `admission-join.mjs` on the history logs | n/a here |

### Per save — exposure, convergence, first answers

Convergence: joined-before from the PUT start, joined-after from max(subscribedAt / channel join, PUT response); p95 ms (n) / missing. Stale first answers = clients whose first read started after the PUT response but carried a lower rev (SDK: first request; pages: SSR seed) — counted, not a gate. Broadcast = clients that received this save's raw `rev` broadcast, separate from the reason of the fetch that applied it.

| save | label | rev | PUT start (UTC) | ms | SDK connected / not yet / dropped | pages in flight / future / settled | SDK before | SDK after | pages before | pages after | stale first: SDK / pages | broadcast received / population | applied by |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| a1 | SDK + page admission save | 1660 | 2026-10-12T07:22:08.901Z | 1568 | 156 / 242 / 72 | 5 / 25 / 0 | 3794 (156) / 0 | 1945 (314) / 0 | — (0) / 0 | 1353 (30) / 0 | 0/210 / 0/25 | 255 / 470 | {"notification":181,"catchup":28,"initial":261} |
| a2 | after admission | 1661 | 2026-10-12T07:22:11.895Z | 2427 | 312 / 56 / 102 | 0 / 25 / 5 | 5676 (312) / 0 | 2890 (158) / 0 | 4147 (2) / 0 | 818 (28) / 0 | 0/54 / 0/20 | 414 / 470 | {"notification":342,"catchup":73,"initial":55} |
| a3 | after admission | 1662 | 2026-10-12T07:22:25.891Z | 483 | 470 / 0 / 0 | 0 / 0 / 30 | 3293 (470) / 0 | — (0) / 0 | 2092 (30) / 0 | — (0) / 0 | 0/0 / 0/0 | 470 / 470 | {"periodic":15,"notification":455} |
| a4 | after admission | 1663 | 2026-10-12T07:22:50.891Z | 532 | 470 / 0 / 0 | 0 / 0 / 30 | 2523 (470) / 0 | — (0) / 0 | 2178 (30) / 0 | — (0) / 0 | 0/0 / 0/0 | 470 / 470 | {"notification":449,"periodic":21} |

SDK first snapshot: sources {"build":408,"cache":62}; body bytes p50 / max 165188 / 198676; first-answer revs {"1659":209,"1660":206,"1661":55}.

### Pages (every page)

Times in ms from the page's navigation start (browser timeOrigin) unless noted; launch = navigation start − T0 (scheduled vs actual: wave × concurrency). Complete = the ordered rows match the manifest (multiplicity, per-row song order, medleys, the blank anchor or any run marker on it); matched = best ordered match before the first steady edit. Hydrated = first /api/setlist request or first Realtime socket.

| page | locale | wave | launch ms after T0 | doc | TTFB | DCL | complete | rows matched | hydrated | channel joined | first fetch (source, rev) | SSR seed | errors |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 0 | ja | 0 | 326 | 200 | 191 | 5451 | 5248 | 70/70 | 5670 | 5720 | build, 1660 | live 1659 |  |
| 1 | ko | 0 | 327 | 200 | 240 | 5318 | 5117 | 70/70 | 5504 | 5580 | build, 1660 | live 1659 |  |
| 2 | ja | 0 | 342 | 200 | 189 | 5442 | 5243 | 70/70 | 5669 | 5723 | build, 1660 | live 1659 |  |
| 3 | en | 0 | 360 | 200 | 260 | 5777 | 5295 | 70/70 | 5984 | 6040 | build, 1660 | live 1660 |  |
| 4 | ja | 0 | 349 | 200 | 209 | 4587 | 3997 | 70/70 | 4941 | 5017 | build, 1660 | live 1659 |  |
| 5 | ja | 1 | 6264 | 200 | 43 | 6289 | 5897 | 70/70 | 6467 | 6532 | build, 1661 | live 1661 |  |
| 6 | ko | 1 | 6289 | 200 | 51 | 3360 | 3167 | 70/70 | 3528 | 3587 | build, 1661 | live 1661 |  |
| 7 | ja | 1 | 6305 | 200 | 51 | 6335 | 6157 | 70/70 | 6545 | 6589 | build, 1661 | live 1661 |  |
| 8 | ja | 1 | 6325 | 200 | 47 | 6247 | 6166 | 70/70 | 6587 | 6645 | build, 1661 | live 1661 |  |
| 9 | ja | 1 | 6335 | 200 | 45 | 6199 | 6138 | 70/70 | 6525 | 6573 | build, 1661 | live 1661 |  |
| 10 | ja | 2 | 12862 | 200 | 61 | 1132 | 982 | 70/70 | 1305 | 1382 | build, 1661 | live 1661 |  |
| 11 | ko | 2 | 12900 | 200 | 42 | 1065 | 721 | 70/70 | 1229 | 1304 | build, 1661 | live 1661 |  |
| 12 | ja | 2 | 12906 | 200 | 45 | 1648 | 1503 | 70/70 | 1863 | 1930 | build, 1661 | live 1661 |  |
| 13 | en | 2 | 12913 | 200 | 46 | 1594 | 1345 | 70/70 | 1730 | 1812 | build, 1661 | live 1661 |  |
| 14 | ja | 2 | 12916 | 200 | 43 | 1066 | 1000 | 70/70 | 1328 | 1427 | cache, 1661 | live 1661 |  |
| 15 | ja | 3 | 14723 | 200 | 48 | 1081 | 1014 | 70/70 | 1394 | 1496 | cache, 1661 | live 1661 |  |
| 16 | ko | 3 | 14747 | 200 | 45 | 1133 | 718 | 70/70 | 1307 | 1368 | cache, 1661 | live 1661 |  |
| 17 | ja | 3 | 14758 | 200 | 45 | 1007 | 935 | 70/70 | 1291 | 1375 | cache, 1661 | live 1661 |  |
| 18 | ja | 3 | 14770 | 200 | 46 | 1317 | 985 | 70/70 | 1463 | 1536 | cache, 1661 | live 1661 |  |
| 19 | ja | 3 | 14787 | 200 | 49 | 1363 | 1132 | 70/70 | 1537 | 1603 | cache, 1661 | live 1661 |  |
| 20 | ja | 4 | 16287 | 200 | 46 | 956 | 899 | 70/70 | 1432 | 1540 | cache, 1661 | live 1661 |  |
| 21 | ko | 4 | 16304 | 200 | 50 | 1112 | 985 | 70/70 | 1573 | 1627 | cache, 1661 | live 1661 |  |
| 22 | ja | 4 | 16319 | 200 | 47 | 1027 | 927 | 70/70 | 1443 | 1558 | cache, 1661 | live 1661 |  |
| 23 | en | 4 | 16335 | 200 | 48 | 1186 | 914 | 70/70 | 1447 | 1542 | cache, 1661 | live 1661 |  |
| 24 | ja | 4 | 16346 | 200 | 48 | 1015 | 940 | 70/70 | 1434 | 1531 | cache, 1661 | live 1661 |  |
| 25 | ja | 5 | 17901 | 200 | 51 | 1113 | 1013 | 70/70 | 1559 | 1621 | cache, 1661 | live 1661 |  |
| 26 | ko | 5 | 17914 | 200 | 46 | 1132 | 916 | 70/70 | 1521 | 1609 | cache, 1661 | live 1661 |  |
| 27 | ja | 5 | 17920 | 200 | 43 | 1186 | 950 | 70/70 | 1481 | 1551 | cache, 1661 | live 1661 |  |
| 28 | ja | 5 | 17928 | 200 | 43 | 1108 | 980 | 70/70 | 1523 | 1583 | cache, 1661 | live 1661 |  |
| 29 | ja | 5 | 17936 | 200 | 42 | 1223 | 752 | 70/70 | 1480 | 1567 | cache, 1661 | live 1661 |  |

## Gate verdicts

Latency = save (the PUT that makes the marker exist; in a pair edit the insert-after came before it) request start of its FIRST attempt → marker link in the page DOM / SDK client applied a snapshot with rev ≥ the PUT's rev. Missing = not seen within the timeout. Monotonic: no page/client ever went back to an older version.

| Scope | n | p50 ms | p95 ms | max ms | missing | gate | verdict |
|---|---|---|---|---|---|---|---|
| all pairs (pages + SDK) | 1975 | 2590 | 5684 | 12820 | 25 | p95 ≤ 3000, 0 missing | n/a |
| edit × page | 95 | 1728 | 12624 | 12820 | 25 | same | n/a |
| edit × SDK client | 1880 | 2609 | 5587 | 8720 | 0 | same | n/a |
| monotonic DOM (pages: version shown never decreases) | 30 pages, 95 versions | — | — | — | 0 regressions on 0 page(s) | 0 | **PASS** |
| monotonic applied rev (SDK) | 470 clients, 4640 applies | — | — | — | 0 regressions on 0 client(s) | 0 | **PASS** |
| warming: warm hits ÷ hinted fetches (`x-snapshot-source: warm`) | SDK 0/2343 (0.0 %), pages 0/118 (0.0 %) | — | — | — | — | informational; reader builds per save: `vercel-logs-summary.mjs` "Warming" on the history logs; arrival vs warm-complete: `warm-join.mjs` | n/a |
| edits with a retried save (clock from the 1st attempt) | 0 | — | — | — | 0 | informational — 0 edit(s); from the successful attempt p50/p95/max —/—/— | n/a |

Insert-start based (insert-after request start → marker; pair edits only), non-drilled: pages 0 | — | — | — · SDK 0 | — | — | — (n | p50 | p95 | max).

## Notification paths (PUT start → arrival)

An R1 page build (what the preview runs until R2 deploys, or after a rollback) is notified by postgres_changes and ignores the broadcast; an R2 build only has the broadcast. The SDK clients are always R2.

| Path | delivered / expected | p50 ms | p95 ms | max ms |
|---|---|---|---|---|
| postgres_changes UPDATE → pages (R1 build) | 0 / 120 | — | — | — |
| broadcast `rev` → pages | 65 / 120 | 544 | 2477 | 2481 |
| broadcast `rev` → SDK | 1609 / 1880 | 560 | 2480 | 3268 |

## Per edit

| # | mode | row | marker song | insert start (UTC) | ins ms | rev | save (PUT) start (UTC) | save ms | save rev |
|---|---|---|---|---|---|---|---|---|---|
| a1 | admission | 2507 | 1997 LOVE♡YOU♡Save the EARTH!! | — | — | — | 2026-10-12T07:22:08.901Z | 1568 | 1660 |
| a2 | admission | 2507 | 2000 Trick or Toxic | — | — | — | 2026-10-12T07:22:11.895Z | 2427 | 1661 |
| a3 | admission | 2507 | 2014 POP LOVE | — | — | — | 2026-10-12T07:22:25.891Z | 483 | 1662 |
| a4 | admission | 2507 | 2017 Tale of Primavera | — | — | — | 2026-10-12T07:22:50.891Z | 532 | 1663 |

### Per save — pages (save start → marker in the DOM)

| # | save rev | seen | p50 / p95 / max ms | missing | bcast → page p50 / p95 (n) | pg → page (n) | notification fetches (hint=1) | their x-snapshot-verify | warm / hinted | 1st hinted request start − commit p50 / p95 |
|---|---|---|---|---|---|---|---|---|---|---|
| a1 | 1660 | 5/30 | 4088 / 4532 / 4532 | 25 | — / — (0) | 0 | 0 | — | 0/0 | — / — |
| a2 | 1661 | 30/30 | 8255 / 12701 / 12820 | 0 | 2477 / 2481 (5) | 0 | 4 | satisfied 4 | 0/4 | 257 / 458 |
| a3 | 1662 | 30/30 | 1379 / 2092 / 2416 | 0 | 532 / 540 (30) | 0 | 30 | satisfied 30 | 0/30 | 291 / 543 |
| a4 | 1663 | 30/30 | 1489 / 2178 / 2178 | 0 | 555 / 556 (30) | 0 | 29 | satisfied 29 | 0/29 | 308 / 508 |

### Per save — SDK clients (save start → applied rev ≥ save rev)

| # | save rev | reached | p50 / p95 / max ms | missing | bcast → SDK p50 / p95 (n) | notification fetches | their x-snapshot-verify | ticket resolutions | rechecks (resolved) | exhausted | warm / hinted | 1st hinted send − commit p50 / p95 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| a1 | 1660 | 470/470 | 3535 / 6651 / 8720 | 0 | 1621 / 1625 (255) | 181 | satisfied 181 | satisfied 188 | 0 (0) | 0 | 0/181 | 327 / 716 |
| a2 | 1661 | 470/470 | 3865 / 5592 / 5909 | 0 | 2476 / 2483 (414) | 342 | satisfied 342 | satisfied 361 | 0 (0) | 0 | 0/342 | 322 / 534 |
| a3 | 1662 | 470/470 | 1837 / 3293 / 3353 | 0 | 533 / 541 (470) | 455 | satisfied 455 | satisfied 463 | 0 (0) | 0 | 0/455 | 280 / 528 |
| a4 | 1663 | 470/470 | 1725 / 2523 / 2766 | 0 | 557 / 563 (470) | 449 | satisfied 449 | satisfied 461 | 0 (0) | 0 | 0/449 | 287 / 499 |

## Hint outcomes (whole run)

- SDK: 4810 requests; notification fetches (hint=1) 2343, their x-snapshot-verify: satisfied 2326; all 200 responses: none 470, satisfied 4290
  - ticket resolutions: satisfied 2381; rechecks 0 (0.0 % of notification fetches), resolved on the recheck 0; hints exhausted 0; highest serverRev held 1665
  - request shapes (reason / generic / ticket): initial generic 470, catchup generic 444, notification +hint=1 2343, periodic generic 1498, periodic generic +H 29, catchup generic +H 26; failures by kind: —
  - notification fetches by x-snapshot-source: build 2288, cache 54, no 200 1 (warm 0/2343 (0.0 %))
- Pages: 263 /api/setlist responses; notification fetches (hint=1) 118, their x-snapshot-verify: satisfied 118; all 200 responses: satisfied 263 (an R1 page build sends no hint=1)
  - notification fetches by x-snapshot-source: build 118 (warm 0/118 (0.0 %))

## Measurement validity (load host)

Event-loop lag = how late a 100 ms interval tick ran, per thread, inside the measurement window 2026-10-12T07:22:05.887Z → 2026-10-12T07:23:21.392Z (p50 = median of the 10 s buckets' p50, p95 / p99 / max = the worst bucket). Heartbeats: one per second per worker, from its own loop. Deadline timers: fired − armed − 8,000 ms for every SDK request that hit the 8 s deadline. INVALID if any lag sample > 1000 ms or any heartbeat gap > 3000 ms.

| thread | lag p50 / p95 / p99 / max ms | samples > 1 s | heartbeats (max gap ms) | deadline timers fired: n, late p50 / p95 / max ms |
|---|---|---|---|---|
| main | 3 / 16 / 92 / 92 | 0 | — | — |
| worker 0 | 3 / 16 / 37 / 37 | 0 | 76 (1094) | 0, — / — / — |
| worker 1 | 3 / 22 / 45 / 45 | 0 | 76 (1102) | 0, — / — / — |
| worker 2 | 3 / 15 / 34 / 34 | 0 | 76 (1090) | 0, — / — / — |
| worker 3 | 3 / 22 / 44 / 44 | 0 | 76 (1093) | 0, — / — / — |

Verdict: valid.

Host (1 s samples; 12 logical cores, 65370 MB): host CPU = busy share of all cores; process CPU = this process (main + SDK workers) as a share of all cores; Chromium is in the host figure only. load1 is always 0 on Windows.

| phase | s | host CPU p50 / max % | process CPU p50 / max % | RSS max MB | free mem min MB | load1 max | threads |
|---|---|---|---|---|---|---|---|
| join | 48.1 | 27.2 / 81.4 | 4.4 / 27 | 810 | 32884 | 0 | 5 |
| settle | 0.0 | — / — | — / — | — | — | — | 0 |
| edits | 27.4 | 24.1 / 46.8 | 1.6 / 7.3 | 655 | 33181 | 0 | 5 |

## Population

- Pages: 30/30 loaded; channel joined 30; visibility {"visible":30}; locales {"ja":21,"ko":6,"en":3}
  - open → join ms: n=30 p50=1805 p95=6730 max=6792
  - /api/setlist responses seen: 263 ({"build":162,"cache":101}); page errors: 0; ws opens 30, closes 0; rev broadcasts seen 125; dropped notification frames 0, blocked attempts 0
- SDK: 470/470 joined; all joined after 19.758 s (from population start)
  - subscribe → SUBSCRIBED ms: n=470 p50=185 p95=333 max=1835
  - statuses {"SUBSCRIBED":470,"CLOSED":470}; disconnected episodes (polling while realtime-js rejoins) 0; channel re-creations 0; fetch failures 0 (with Retry-After 0); fetches by reason {"initial":470,"catchup":470,"notification":2343,"periodic":1527}; X-Snapshot-Source {"build":3348,"cache":1445}

## Clean-up

- Soft-deleted 1/1 created rows; position restore: {"restored":67}
- Verify: {"dbActive":69,"snapshotItems":69,"snapshotRev":1665,"startRows":69,"goneMeanwhile":0,"sameOrder":true,"samePositions":true,"oursStillActive":[]}
