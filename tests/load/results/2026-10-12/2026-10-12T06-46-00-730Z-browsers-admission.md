# Browsers run — 2026-10-12T06:42:37.127Z

- Target: https://opensetlist-git-dev-opensetlist-projects.vercel.app/events/111/rehearsal-lovelive-fes-2020-day1 (event 111, start rev 1607, 23 active rows; insert after row 2 = position 2)
- Population: 30 Chromium pages (ja/ko/en 70/20/10), 470 SDK subscribers in 4 worker thread(s)
- Edits: 0 × (insert-after + PUT marker song) — edit mode pair (anchor row 2361), every 25 s; timeout 30 s; drill: none
- Window (UTC): run start 2026-10-12T06:42:37.127Z, first edit 2026-10-12T06:45:27.799Z, last edit settled 2026-10-12T06:45:56.282Z, end 2026-10-12T06:46:00.720Z
- Label: step5-A0b
- Host guard at start: CPU 12.1 % busy (2 s CPU sample over 12 cores); 0 competing process(es) (--strict-host)

- Phase: admission — prepare via https://opensetlist-git-dev-opensetlist-projects.vercel.app, measured on https://opensetlist-git-dev-opensetlist-projects.vercel.app

## Admission (n14 step 5)

**Verdict: VALID + FAIL** — SDK aspect: VALID + FAIL; page aspect: VALID + FAIL; failed: event unchanged between prepare and the first admission save (first answers vs manifest rev); pages: complete expected setlist, navigation start →.

- Prepare via https://opensetlist-git-dev-opensetlist-projects.vercel.app (2026-10-12T06:42:40.897Z → 2026-10-12T06:42:43.542Z): anchor row 2361 @3 (rev 1608); manifest 24 active rows at rev 1608; file `2026-10-12T06-42-43-542Z-admission-manifest.json`
- Boundary: waited 117.3 s (--admit-file tests/load/results/2026-10-12/admit-A0b.json); **outbound requests during the wait: 0**; admit file: precursor dpl_2DCAkZQZdCjRf2zj6HABBANqauQS → measurement dpl_BrhaW5VGXe1SAz4Zwh3B7QoiUL3G
- T0 2026-10-12T06:44:40.803Z; measurement base https://opensetlist-git-dev-opensetlist-projects.vercel.app; pages 30 at concurrency 5, SDK 470 at 50/s, all started at T0; admission saves at +3 s, +6 s, +20 s, +45 s on their own timer (scheduled vs actual start: a1 +1 ms, a2 +4 ms, a3 +9 ms, a4 +11 ms)
- Exposure minimums (predeclared): SDK ≥ 100 connected through the save AND ≥ 100 not yet SUBSCRIBED at its PUT response; pages ≥ 5 navigated by the PUT start and not yet complete. Clocks: this host only (PUT response = upper bound of the commit); the server's commit `at` is a cross-check in `admission-join.mjs`.
- Resource diet: images, fonts and media are aborted on every page (the DOM is all that is measured); analytics and the Sentry tunnel too.

| admission gate | value | gate | verdict |
|---|---|---|---|
| outbound requests between prepare end and T0 | 0 | 0 | **PASS** |
| event unchanged between prepare and the first admission save (first answers vs manifest rev) | head seen 1609, manifest 1608 | ≤ manifest rev | **FAIL** |
| all intended saves committed (admission saves never retried) | 4/4 admission | all 2xx | **PASS** |
| 5xx anywhere (saves, pages incl. the document, SDK, guard read) | 0 (none) | 0 | **PASS** |
| 503 (subset of the above) | 0 | 0 | **PASS** |
| transport failures on saves | 0 | 0 | **PASS** |
| all joined within --join-timeout (120 s from T0) | SDK 470/470, pages 30/30 | all | **PASS** |
| pages: complete expected setlist, navigation start → | 30 / 952 / 4235 / 4487 | p95 ≤ 3000, every page | **FAIL** |
| pages: degraded SSR seed (no live seed in the HTML) | 0 (seeds {"live":30}) | 0 | **PASS** |
| SDK: time to first snapshot (start → first 200 applied) | 470 / 352 / 2319 / 2828 | p95 ≤ 3000, all | **PASS** |
| convergence SDK joined-before (from PUT start) | 1408 / 1108 / 1472 / 1621, missing 0 | p95 ≤ 3000, 0 missing | **PASS** |
| convergence SDK joined-after (from max(subscribedAt, PUT response)) | 472 / 153 / 489 / 713, missing 0 | p95 ≤ 3000, 0 missing | **PASS** |
| convergence pages joined-before (from PUT start; marker or a later one on the anchor) | 65 / 934 / 1155 / 1195, missing 0 | p95 ≤ 3000, 0 missing | **PASS** |
| convergence pages joined-after (from max(channel join, PUT response)) | 55 / 0 / 243 / 316, missing 0 | p95 ≤ 3000, 0 missing | **PASS** |
| monotonicity (pages: DOM version; SDK: applied rev and (rev, capturedAt)) | 0 DOM/rev regressions, 0 (rev, capturedAt) regressions | 0 | **PASS** |
| PUT end-to-end (every save of the run) | 4 / 427 / 541 / 541 | p95 ≤ 1500 | **PASS** |
| server side: writer acquire ≤ 500 ms, EMAXCONN 0, Σ < 300 with completeness, builds per minute / instance | — | `admission-join.mjs` on the history logs | n/a here |

### Per save — exposure, convergence, first answers

Convergence: joined-before from the PUT start, joined-after from max(subscribedAt / channel join, PUT response); p95 ms (n) / missing. Stale first answers = clients whose first read started after the PUT response but carried a lower rev (SDK: first request; pages: SSR seed) — counted, not a gate. Broadcast = clients that received this save's raw `rev` broadcast, separate from the reason of the fetch that applied it.

| save | label | rev | PUT start (UTC) | ms | SDK connected / not yet / dropped | pages in flight / future / settled | SDK before | SDK after | pages before | pages after | stale first: SDK / pages | broadcast received / population | applied by |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| a1 | SDK + page admission save | 1609 | 2026-10-12T06:44:43.804Z | 541 | 156 / 269 / 45 | 5 / 25 / 0 | 1291 (156) / 0 | 533 (314) / 0 | — (0) / 0 | 108 (30) / 0 | 0/262 / 0/25 | 207 / 470 | {"notification":135,"catchup":58,"initial":277} |
| a2 | SDK admission save | 1610 | 2026-10-12T06:44:46.807Z | 427 | 312 / 158 / 0 | 4 / 20 / 6 | 1169 (312) / 0 | 228 (158) / 0 | 1064 (5) / 0 | 254 (25) / 0 | 0/145 / 0/20 | 312 / 470 | {"notification":312,"initial":158} |
| a3 | after admission | 1611 | 2026-10-12T06:45:00.812Z | 385 | 470 / 0 / 0 | 0 / 0 / 30 | 1491 (470) / 0 | — (0) / 0 | 1100 (30) / 0 | — (0) / 0 | 0/0 / 0/0 | 470 / 470 | {"notification":461,"periodic":9} |
| a4 | after admission | 1612 | 2026-10-12T06:45:25.814Z | 467 | 470 / 0 / 0 | 0 / 0 / 30 | 1485 (470) / 0 | — (0) / 0 | 1194 (30) / 0 | — (0) / 0 | 0/0 / 0/0 | 470 / 470 | {"notification":446,"periodic":24} |

SDK first snapshot: sources {"cache":73,"build":397}; body bytes p50 / max 59924 / 80784; first-answer revs {"1608":193,"1609":119,"1610":158}.

### Pages (every page)

Times in ms from the page's navigation start (browser timeOrigin) unless noted; launch = navigation start − T0 (scheduled vs actual: wave × concurrency). Complete = the ordered rows match the manifest (multiplicity, per-row song order, medleys, the blank anchor or any run marker on it); matched = best ordered match before the first steady edit. Hydrated = first /api/setlist request or first Realtime socket.

| page | locale | wave | launch ms after T0 | doc | TTFB | DCL | complete | rows matched | hydrated | channel joined | first fetch (source, rev) | SSR seed | errors |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 0 | ja | 0 | 307 | 200 | 256 | 4491 | 4487 | 24/24 | 4809 | 4879 | build, 1609 | live 1609 |  |
| 1 | ko | 0 | 309 | 200 | 255 | 4242 | 4235 | 24/24 | 4604 | 4681 | build, 1609 | live 1609 |  |
| 2 | ja | 0 | 319 | 200 | 244 | 3998 | 3683 | 24/24 | 4169 | 4276 | build, 1609 | live 1608 |  |
| 3 | en | 0 | 329 | 200 | 235 | 4134 | 4128 | 24/24 | 4434 | 4555 | build, 1609 | live 1609 |  |
| 4 | ja | 0 | 337 | 200 | 226 | 3217 | 3001 | 24/24 | 3918 | 4053 | build, 1609 | live 1608 |  |
| 5 | ja | 1 | 5066 | 200 | 44 | 1044 | 670 | 24/24 | 1164 | 1254 | build, 1609 | live 1609 |  |
| 6 | ko | 1 | 5085 | 200 | 47 | 1323 | 1290 | 24/24 | 1574 | 1657 | build, 1610 | live 1609 |  |
| 7 | ja | 1 | 5101 | 200 | 43 | 1077 | 982 | 24/24 | 1333 | 1415 | build, 1610 | live 1609 |  |
| 8 | ja | 1 | 5109 | 200 | 44 | 1343 | 1338 | 24/24 | 1648 | 1730 | build, 1610 | live 1609 |  |
| 9 | ja | 1 | 5124 | 200 | 46 | 1060 | 1004 | 24/24 | 1309 | 1393 | build, 1610 | live 1609 |  |
| 10 | ja | 2 | 6703 | 200 | 48 | 930 | 612 | 24/24 | 1085 | 1158 | build, 1610 | live 1610 |  |
| 11 | ko | 2 | 6719 | 200 | 50 | 1283 | 952 | 24/24 | 1396 | 1453 | build, 1610 | live 1610 |  |
| 12 | ja | 2 | 6739 | 200 | 50 | 1591 | 1426 | 24/24 | 1825 | 1936 | build, 1610 | live 1610 |  |
| 13 | en | 2 | 6762 | 200 | 48 | 1052 | 1047 | 24/24 | 1324 | 1395 | build, 1610 | live 1610 |  |
| 14 | ja | 2 | 6783 | 200 | 45 | 994 | 919 | 24/24 | 1218 | 1302 | build, 1610 | live 1610 |  |
| 15 | ja | 3 | 8519 | 200 | 50 | 1571 | 1512 | 24/24 | 1775 | 1865 | build, 1610 | live 1610 |  |
| 16 | ko | 3 | 8539 | 200 | 87 | 1480 | 1200 | 24/24 | 1613 | 1685 | build, 1610 | live 1610 |  |
| 17 | ja | 3 | 8561 | 200 | 76 | 1481 | 1209 | 24/24 | 1627 | 1691 | build, 1610 | live 1610 |  |
| 18 | ja | 3 | 8584 | 200 | 65 | 879 | 715 | 24/24 | 1074 | 1156 | build, 1610 | live 1610 |  |
| 19 | ja | 3 | 8589 | 200 | 66 | 1793 | 1789 | 24/24 | 2182 | 2245 | build, 1610 | live 1610 |  |
| 20 | ja | 4 | 10725 | 200 | 47 | 859 | 500 | 24/24 | 1011 | 1074 | build, 1610 | live 1610 |  |
| 21 | ko | 4 | 10735 | 200 | 47 | 930 | 511 | 24/24 | 1048 | 1124 | build, 1610 | live 1610 |  |
| 22 | ja | 4 | 10754 | 200 | 45 | 844 | 606 | 24/24 | 1093 | 1165 | build, 1610 | live 1610 |  |
| 23 | en | 4 | 10771 | 200 | 39 | 864 | 858 | 24/24 | 1131 | 1199 | build, 1610 | live 1610 |  |
| 24 | ja | 4 | 10780 | 200 | 46 | 886 | 880 | 24/24 | 1185 | 1265 | build, 1610 | live 1610 |  |
| 25 | ja | 5 | 11930 | 200 | 48 | 710 | 487 | 24/24 | 1011 | 1090 | build, 1610 | live 1610 |  |
| 26 | ko | 5 | 11943 | 200 | 49 | 841 | 559 | 24/24 | 1083 | 1163 | build, 1610 | live 1610 |  |
| 27 | ja | 5 | 11955 | 200 | 55 | 845 | 800 | 24/24 | 1105 | 1179 | build, 1610 | live 1610 |  |
| 28 | ja | 5 | 11978 | 200 | 46 | 839 | 831 | 24/24 | 1125 | 1216 | build, 1610 | live 1610 |  |
| 29 | ja | 5 | 11986 | 200 | 45 | 863 | 612 | 24/24 | 1101 | 1265 | build, 1610 | live 1610 |  |

## Gate verdicts

Latency = save (the PUT that makes the marker exist; in a pair edit the insert-after came before it) request start of its FIRST attempt → marker link in the page DOM / SDK client applied a snapshot with rev ≥ the PUT's rev. Missing = not seen within the timeout. Monotonic: no page/client ever went back to an older version.

| Scope | n | p50 ms | p95 ms | max ms | missing | gate | verdict |
|---|---|---|---|---|---|---|---|
| all pairs (pages + SDK) | 1980 | 1163 | 4707 | 6781 | 20 | p95 ≤ 3000, 0 missing | n/a |
| edit × page | 100 | 1005 | 5465 | 6606 | 20 | same | n/a |
| edit × SDK client | 1880 | 1166 | 4688 | 6781 | 0 | same | n/a |
| monotonic DOM (pages: version shown never decreases) | 30 pages, 100 versions | — | — | — | 0 regressions on 0 page(s) | 0 | **PASS** |
| monotonic applied rev (SDK) | 470 clients, 4692 applies | — | — | — | 0 regressions on 0 client(s) | 0 | **PASS** |
| warming: warm hits ÷ hinted fetches (`x-snapshot-source: warm`) | SDK 2246/2280 (98.5 %), pages 125/125 (100.0 %) | — | — | — | — | informational; reader builds per save: `vercel-logs-summary.mjs` "Warming" on the history logs; arrival vs warm-complete: `warm-join.mjs` | n/a |
| edits with a retried save (clock from the 1st attempt) | 0 | — | — | — | 0 | informational — 0 edit(s); from the successful attempt p50/p95/max —/—/— | n/a |

Insert-start based (insert-after request start → marker; pair edits only), non-drilled: pages 0 | — | — | — · SDK 0 | — | — | — (n | p50 | p95 | max).

## Notification paths (PUT start → arrival)

An R1 page build (what the preview runs until R2 deploys, or after a rollback) is notified by postgres_changes and ignores the broadcast; an R2 build only has the broadcast. The SDK clients are always R2.

| Path | delivered / expected | p50 ms | p95 ms | max ms |
|---|---|---|---|---|
| postgres_changes UPDATE → pages (R1 build) | 0 / 120 | — | — | — |
| broadcast `rev` → pages | 66 / 120 | 489 | 518 | 574 |
| broadcast `rev` → SDK | 1459 / 1880 | 500 | 597 | 821 |

## Per edit

| # | mode | row | marker song | insert start (UTC) | ins ms | rev | save (PUT) start (UTC) | save ms | save rev |
|---|---|---|---|---|---|---|---|---|---|
| a1 | admission | 2361 | 1997 LOVE♡YOU♡Save the EARTH!! | — | — | — | 2026-10-12T06:44:43.804Z | 541 | 1609 |
| a2 | admission | 2361 | 1998 What is my LIFE? | — | — | — | 2026-10-12T06:44:46.807Z | 427 | 1610 |
| a3 | admission | 2361 | 2000 Trick or Toxic | — | — | — | 2026-10-12T06:45:00.812Z | 385 | 1611 |
| a4 | admission | 2361 | 2007 Daitan Party Time | — | — | — | 2026-10-12T06:45:25.814Z | 467 | 1612 |

### Per save — pages (save start → marker in the DOM)

| # | save rev | seen | p50 / p95 / max ms | missing | bcast → page p50 / p95 (n) | pg → page (n) | notification fetches (hint=1) | their x-snapshot-verify | warm / hinted | 1st hinted request start − commit p50 / p95 |
|---|---|---|---|---|---|---|---|---|---|---|
| a1 | 1609 | 10/30 | 1817 / 3252 / 3252 | 20 | — / — (0) | 0 | 0 | — | 0/0 | — / — |
| a2 | 1610 | 30/30 | 2160 / 6593 / 6606 | 0 | 489 / 490 (6) | 0 | 5 | satisfied 5 | 5/5 | 283 / 465 |
| a3 | 1611 | 30/30 | 907 / 1100 / 1111 | 0 | 438 / 459 (30) | 0 | 30 | satisfied 30 | 30/30 | 323 / 538 |
| a4 | 1612 | 30/30 | 938 / 1194 / 1195 | 0 | 513 / 518 (30) | 0 | 30 | satisfied 30 | 30/30 | 302 / 538 |

### Per save — SDK clients (save start → applied rev ≥ save rev)

| # | save rev | reached | p50 / p95 / max ms | missing | bcast → SDK p50 / p95 (n) | notification fetches | their x-snapshot-verify | ticket resolutions | rechecks (resolved) | exhausted | warm / hinted | 1st hinted send − commit p50 / p95 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| a1 | 1609 | 470/470 | 1716 / 5806 / 6781 | 0 | 596 / 599 (207) | 135 | satisfied 135 | satisfied 171 | 0 (0) | 0 | 101/135 | 384 / 545 |
| a2 | 1610 | 470/470 | 1013 / 2803 / 3778 | 0 | 489 / 503 (312) | 312 | satisfied 312 | satisfied 312 | 0 (0) | 0 | 312/312 | 355 / 553 |
| a3 | 1611 | 470/470 | 1159 / 1491 / 1621 | 0 | 440 / 445 (470) | 461 | satisfied 461 | satisfied 466 | 0 (0) | 0 | 461/461 | 317 / 523 |
| a4 | 1612 | 470/470 | 1174 / 1485 / 1574 | 0 | 517 / 521 (470) | 446 | satisfied 446 | satisfied 464 | 0 (0) | 0 | 446/446 | 287 / 525 |

## Hint outcomes (whole run)

- SDK: 4710 requests; notification fetches (hint=1) 2280, their x-snapshot-verify: satisfied 2280; all 200 responses: none 470, satisfied 4235
  - ticket resolutions: satisfied 2350; rechecks 0 (0.0 % of notification fetches), resolved on the recheck 0; hints exhausted 0; highest serverRev held 1614
  - request shapes (reason / generic / ticket): initial generic 470, catchup generic 434, notification +hint=1 2280, periodic generic 1456, periodic generic +H 34, catchup generic +H 36; failures by kind: —
  - notification fetches by x-snapshot-source: warm 2246, build 34 (warm 2246/2280 (98.5 %))
- Pages: 276 /api/setlist responses; notification fetches (hint=1) 125, their x-snapshot-verify: satisfied 125; all 200 responses: satisfied 276 (an R1 page build sends no hint=1)
  - notification fetches by x-snapshot-source: warm 125 (warm 125/125 (100.0 %))

## Measurement validity (load host)

Event-loop lag = how late a 100 ms interval tick ran, per thread, inside the measurement window 2026-10-12T06:44:40.803Z → 2026-10-12T06:45:56.282Z (p50 = median of the 10 s buckets' p50, p95 / p99 / max = the worst bucket). Heartbeats: one per second per worker, from its own loop. Deadline timers: fired − armed − 8,000 ms for every SDK request that hit the 8 s deadline. INVALID if any lag sample > 1000 ms or any heartbeat gap > 3000 ms.

| thread | lag p50 / p95 / p99 / max ms | samples > 1 s | heartbeats (max gap ms) | deadline timers fired: n, late p50 / p95 / max ms |
|---|---|---|---|---|
| main | 2 / 16 / 29 / 29 | 0 | — | — |
| worker 0 | 2 / 16 / 88 / 88 | 0 | 75 (1104) | 0, — / — / — |
| worker 1 | 2 / 15 / 42 / 42 | 0 | 75 (1093) | 0, — / — / — |
| worker 2 | 2 / 15 / 17 / 17 | 0 | 75 (1091) | 0, — / — / — |
| worker 3 | 2 / 15 / 48 / 48 | 0 | 75 (1098) | 0, — / — / — |

Verdict: valid.

Host (1 s samples; 12 logical cores, 65370 MB): host CPU = busy share of all cores; process CPU = this process (main + SDK workers) as a share of all cores; Chromium is in the host figure only. load1 is always 0 on Windows.

| phase | s | host CPU p50 / max % | process CPU p50 / max % | RSS max MB | free mem min MB | load1 max | threads |
|---|---|---|---|---|---|---|---|
| join | 47.0 | 22.1 / 71.7 | 1.9 / 16.1 | 704 | 34457 | 0 | 5 |
| settle | 0.0 | — / — | — / — | — | — | — | 0 |
| edits | 28.5 | 20.9 / 48 | 0.9 / 2.6 | 757 | 35155 | 0 | 5 |

## Population

- Pages: 30/30 loaded; channel joined 30; visibility {"visible":30}; locales {"ja":21,"ko":6,"en":3}
  - open → join ms: n=30 p50=1533 p95=4868 max=5064
  - /api/setlist responses seen: 276 ({"build":69,"warm":125,"cache":82}); page errors: 0; ws opens 30, closes 0; rev broadcasts seen 126; dropped notification frames 0, blocked attempts 0
- SDK: 470/470 joined; all joined after 13.413 s (from population start)
  - subscribe → SUBSCRIBED ms: n=470 p50=163 p95=324 max=1150
  - statuses {"SUBSCRIBED":470,"CLOSED":470}; disconnected episodes (polling while realtime-js rejoins) 0; channel re-creations 0; fetch failures 0 (with Retry-After 0); fetches by reason {"initial":470,"catchup":470,"notification":2280,"periodic":1490}; X-Snapshot-Source {"cache":1351,"build":1108,"warm":2246}

## Clean-up

- Soft-deleted 1/1 created rows; position restore: {"restored":21}
- Verify: {"dbActive":23,"snapshotItems":23,"snapshotRev":1614,"startRows":23,"goneMeanwhile":0,"sameOrder":true,"samePositions":true,"oursStillActive":[]}
