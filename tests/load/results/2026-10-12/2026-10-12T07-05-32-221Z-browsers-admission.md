# Browsers run — 2026-10-12T06:58:20.092Z

- Target: https://opensetlist-git-dev-opensetlist-projects.vercel.app/events/111/rehearsal-lovelive-fes-2020-day1 (event 111, start rev 1620, 69 active rows; insert after row 2 = position 2)
- Population: 30 Chromium pages (ja/ko/en 70/20/10), 470 SDK subscribers in 4 worker thread(s) (+ 20 fresh in the I3 final phase)
- Edits: 8 × pair on odd edits, standalone on even — edit mode mixed (anchor row 2409), every 25 s; timeout 30 s; drill: none
- Window (UTC): run start 2026-10-12T06:58:20.092Z, first edit 2026-10-12T07:01:11.891Z, last edit settled 2026-10-12T07:05:26.726Z, end 2026-10-12T07:05:32.194Z
- Label: step5-A2
- Host guard at start: CPU 18.3 % busy (2 s CPU sample over 12 cores); 0 competing process(es) (--strict-host)

- Phase: admission — prepare via https://opensetlist-git-dev-opensetlist-projects.vercel.app, measured on https://opensetlist-git-dev-opensetlist-projects.vercel.app

## Admission (n14 step 5)

**Verdict: VALID + FAIL** — SDK aspect: VALID + FAIL; page aspect: VALID + FAIL; failed: pages: complete expected setlist, navigation start →; PUT end-to-end (every save of the run).

- Prepare via https://opensetlist-git-dev-opensetlist-projects.vercel.app (2026-10-12T06:58:24.156Z → 2026-10-12T06:58:27.171Z): anchor row 2409 @3 (rev 1621); manifest 70 active rows at rev 1621, 46 fixture clones (tests/load/results/2026-10-12/fixture-step5-A2.json); file `2026-10-12T06-58-27-170Z-admission-manifest.json`
- Boundary: waited 116.5 s (--admit-file tests/load/results/2026-10-12/admit-A2.json); **outbound requests during the wait: 0**; admit file: precursor dpl_HQHzU1BduyJoxTXsu8gH3efgahiu → measurement dpl_FAt2Sp33CvHnRohZyHkH5bUHZ4X5
- T0 2026-10-12T07:00:23.696Z; measurement base https://opensetlist-git-dev-opensetlist-projects.vercel.app; pages 30 at concurrency 5, SDK 470 at 50/s, all started at T0; admission saves at +3 s, +6 s, +20 s, +45 s on their own timer (scheduled vs actual start: a1 +16 ms, a2 +0 ms, a3 +0 ms, a4 +1 ms)
- Exposure minimums (predeclared): SDK ≥ 100 connected through the save AND ≥ 100 not yet SUBSCRIBED at its PUT response; pages ≥ 5 navigated by the PUT start and not yet complete. Clocks: this host only (PUT response = upper bound of the commit); the server's commit `at` is a cross-check in `admission-join.mjs`.
- Resource diet: images, fonts and media are aborted on every page (the DOM is all that is measured); analytics and the Sentry tunnel too.

| admission gate | value | gate | verdict |
|---|---|---|---|
| outbound requests between prepare end and T0 | 0 | 0 | **PASS** |
| event unchanged between prepare and the first admission save (first answers not from this run's saves vs manifest rev) | foreign head seen 1621, manifest 1621 | ≤ manifest rev | **PASS** |
| all intended saves committed (admission saves never retried) | 4/4 admission | all 2xx | **PASS** |
| 5xx anywhere (saves, pages incl. the document, SDK, guard read) | 0 (none) | 0 | **PASS** |
| 503 (subset of the above) | 0 | 0 | **PASS** |
| transport failures on saves | 0 | 0 | **PASS** |
| all joined within --join-timeout (120 s from T0) | SDK 470/470, pages 30/30 | all | **PASS** |
| pages: complete expected setlist, navigation start → | 30 / 1079 / 5844 / 5869 | p95 ≤ 3000, every page | **FAIL** |
| pages: degraded SSR seed (no live seed in the HTML) | 0 (seeds {"live":30}) | 0 | **PASS** |
| SDK: time to first snapshot (start → first 200 applied) | 470 / 817 / 2817 / 3253 | p95 ≤ 3000, all | **PASS** |
| convergence SDK joined-before (from PUT start) | 5248 / 1545 / 2735 / 5390, missing 0 | p95 ≤ 3000, 0 missing | **PASS** |
| convergence SDK joined-after (from max(subscribedAt, PUT response)) | 712 / 424 / 2092 / 3383, missing 0 | p95 ≤ 3000, 0 missing | **PASS** |
| convergence pages joined-before (from PUT start; marker or a later one on the anchor) | 301 / 1251 / 1702 / 2066, missing 0 | p95 ≤ 3000, 0 missing | **PASS** |
| convergence pages joined-after (from max(channel join, PUT response)) | 59 / 0 / 880 / 1081, missing 0 | p95 ≤ 3000, 0 missing | **PASS** |
| monotonicity (pages: DOM version; SDK: applied rev and (rev, capturedAt)) | 0 DOM/rev regressions, 0 (rev, capturedAt) regressions | 0 | **PASS** |
| PUT end-to-end (every save of the run) | 14 / 521 / 2087 / 2087 | p95 ≤ 1500 | **FAIL** |
| server side: writer acquire ≤ 500 ms, EMAXCONN 0, Σ < 300 with completeness, builds per minute / instance | — | `admission-join.mjs` on the history logs | n/a here |

### Per save — exposure, convergence, first answers

Convergence: joined-before from the PUT start, joined-after from max(subscribedAt / channel join, PUT response); p95 ms (n) / missing. Stale first answers = clients whose first read started after the PUT response but carried a lower rev (SDK: first request; pages: SSR seed) — counted, not a gate. Broadcast = clients that received this save's raw `rev` broadcast, separate from the reason of the fetch that applied it.

| save | label | rev | PUT start (UTC) | ms | SDK connected / not yet / dropped | pages in flight / future / settled | SDK before | SDK after | pages before | pages after | stale first: SDK / pages | broadcast received / population | applied by |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| a1 | SDK + page admission save | 1622 | 2026-10-12T07:00:26.712Z | 2087 | 156 / 231 / 103 | 5 / 25 / 0 | 4707 (156) / 0 | 2270 (334) / 0 | — (0) / 0 | 567 (30) / 0 | 0/210 / 0/25 | 0 / 490 | {"notification":238,"catchup":22,"initial":230} |
| a2 | SDK admission save | 1623 | 2026-10-12T07:00:29.696Z | 529 | 312 / 178 / 0 | 2 / 25 / 3 | 1748 (312) / 0 | 1158 (178) / 0 | 1006 (1) / 0 | 880 (29) / 0 | 0/106 / 0/22 | 312 / 490 | {"notification":306,"catchup":6,"initial":178} |
| a3 | after admission | 1624 | 2026-10-12T07:00:43.696Z | 420 | 470 / 20 / 0 | 0 / 0 / 30 | 2428 (470) / 0 | 271 (20) / 0 | 1245 (30) / 0 | — (0) / 0 | 0/0 / 0/0 | 470 / 490 | {"notification":460,"periodic":10,"initial":20} |
| a4 | after admission | 1625 | 2026-10-12T07:01:08.697Z | 606 | 470 / 20 / 0 | 0 / 0 / 30 | 1825 (470) / 0 | 271 (20) / 0 | 1529 (30) / 0 | — (0) / 0 | 0/0 / 0/0 | 470 / 490 | {"notification":456,"periodic":14,"initial":20} |
| 1 | after admission | 1627 | 2026-10-12T07:01:12.738Z | 521 | 470 / 20 / 0 | 0 / 0 / 30 | 2052 (470) / 0 | 271 (20) / 0 | 1738 (30) / 0 | — (0) / 0 | 0/0 / 0/0 | 470 / 490 | {"notification":446,"periodic":24,"initial":20} |
| 2 | after admission | 1628 | 2026-10-12T07:01:37.791Z | 493 | 470 / 20 / 0 | 0 / 0 / 30 | 3233 (470) / 0 | 271 (20) / 0 | 1377 (30) / 0 | — (0) / 0 | 0/0 / 0/0 | 470 / 490 | {"notification":462,"periodic":8,"initial":20} |
| 3 | after admission | 1630 | 2026-10-12T07:02:03.045Z | 1001 | 470 / 20 / 0 | 0 / 0 / 30 | 2153 (470) / 0 | 271 (20) / 0 | 1672 (30) / 0 | — (0) / 0 | 0/0 / 0/0 | 470 / 490 | {"notification":441,"periodic":29,"initial":20} |
| 4 | after admission | 1631 | 2026-10-12T07:02:27.785Z | 504 | 470 / 20 / 0 | 0 / 0 / 30 | 1767 (470) / 0 | 271 (20) / 0 | 1362 (30) / 0 | — (0) / 0 | 0/0 / 0/0 | 470 / 490 | {"notification":461,"periodic":9,"initial":20} |
| 5 | after admission | 1633 | 2026-10-12T07:02:52.876Z | 858 | 470 / 20 / 0 | 0 / 0 / 30 | 1838 (470) / 0 | 271 (20) / 0 | 1918 (30) / 0 | — (0) / 0 | 0/0 / 0/0 | 470 / 490 | {"notification":440,"periodic":30,"initial":20} |
| 6 | after admission | 1634 | 2026-10-12T07:03:17.789Z | 453 | 470 / 20 / 0 | 0 / 0 / 30 | 1788 (470) / 0 | 271 (20) / 0 | 1289 (30) / 0 | — (0) / 0 | 0/0 / 0/0 | 470 / 490 | {"notification":458,"periodic":12,"initial":20} |
| 7 | after admission | 1636 | 2026-10-12T07:03:42.613Z | 577 | 470 / 20 / 0 | 0 / 0 / 30 | 2091 (470) / 0 | 271 (20) / 0 | 2036 (30) / 0 | — (0) / 0 | 0/0 / 0/0 | 470 / 490 | {"notification":445,"periodic":25,"initial":20} |
| 8 | after admission | 1637 | 2026-10-12T07:04:07.824Z | 634 | 470 / 20 / 0 | 0 / 0 / 30 | 1829 (470) / 0 | 271 (20) / 0 | 1400 (30) / 0 | — (0) / 0 | 0/0 / 0/0 | 470 / 490 | {"notification":456,"periodic":14,"initial":20} |
| f1 | I3 final phase (after admission) | 1638 | 2026-10-12T07:04:45.292Z | 410 | 40 / 0 / 0 | 0 / 0 / 30 | 1147 (40) / 0 | — (0) / 0 | — | — | 0/0 / 0/0 | 40 / 40 | {"notification":40} |
| f2 | I3 final phase (after admission) | 1639 | 2026-10-12T07:05:25.303Z | 410 | 40 / 0 / 0 | 0 / 0 / 30 | 1206 (40) / 0 | — (0) / 0 | — | — | 0/0 / 0/0 | 40 / 40 | {"notification":37,"periodic":3} |

SDK first snapshot: sources {"build":350,"cache":120}; body bytes p50 / max 165188 / 198676; first-answer revs {"1621":260,"1622":52,"1623":158}.

### Pages (every page)

Times in ms from the page's navigation start (browser timeOrigin) unless noted; launch = navigation start − T0 (scheduled vs actual: wave × concurrency). Complete = the ordered rows match the manifest (multiplicity, per-row song order, medleys, the blank anchor or any run marker on it); matched = best ordered match before the first steady edit. Hydrated = first /api/setlist request or first Realtime socket.

| page | locale | wave | launch ms after T0 | doc | TTFB | DCL | complete | rows matched | hydrated | channel joined | first fetch (source, rev) | SSR seed | errors |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 0 | ja | 0 | 254 | 200 | 182 | 5965 | 5869 | 70/70 | 6255 | 6350 | build, 1623 | live 1622 |  |
| 1 | ko | 0 | 275 | 200 | 160 | 5630 | 5331 | 70/70 | 5791 | 5892 | build, 1622 | live 1621 |  |
| 2 | ja | 0 | 275 | 200 | 216 | 5275 | 5219 | 70/70 | 5583 | 5642 | build, 1622 | live 1621 |  |
| 3 | en | 0 | 294 | 200 | 290 | 5972 | 5844 | 70/70 | 6232 | 6344 | build, 1623 | live 1622 |  |
| 4 | ja | 0 | 300 | 200 | 250 | 5523 | 5369 | 70/70 | 5847 | 5896 | build, 1623 | live 1621 |  |
| 5 | ja | 1 | 6443 | 200 | 65 | 3562 | 3402 | 70/70 | 3818 | 3881 | cache, 1623 | live 1623 |  |
| 6 | ko | 1 | 6469 | 200 | 87 | 3909 | 3752 | 70/70 | 4112 | 4174 | cache, 1623 | live 1623 |  |
| 7 | ja | 1 | 6504 | 200 | 95 | 3695 | 3515 | 70/70 | 3872 | 3939 | cache, 1623 | live 1623 |  |
| 8 | ja | 1 | 6540 | 200 | 73 | 3824 | 3564 | 70/70 | 4019 | 4103 | cache, 1623 | live 1623 |  |
| 9 | ja | 1 | 6553 | 200 | 60 | 3807 | 3632 | 70/70 | 3992 | 4055 | cache, 1623 | live 1623 |  |
| 10 | ja | 2 | 10523 | 200 | 45 | 899 | 733 | 70/70 | 1034 | 1136 | cache, 1623 | live 1623 |  |
| 11 | ko | 2 | 10545 | 200 | 50 | 1231 | 1079 | 70/70 | 1373 | 1428 | cache, 1623 | live 1623 |  |
| 12 | ja | 2 | 10577 | 200 | 51 | 1244 | 1118 | 70/70 | 1427 | 1487 | cache, 1623 | live 1623 |  |
| 13 | en | 2 | 10587 | 200 | 48 | 1299 | 1159 | 70/70 | 1508 | 1580 | cache, 1623 | live 1623 |  |
| 14 | ja | 2 | 10598 | 200 | 44 | 1150 | 976 | 70/70 | 1316 | 1367 | cache, 1623 | live 1623 |  |
| 15 | ja | 3 | 12053 | 200 | 46 | 1023 | 648 | 70/70 | 1167 | 1240 | cache, 1623 | live 1623 |  |
| 16 | ko | 3 | 12072 | 200 | 42 | 1130 | 1015 | 70/70 | 1281 | 1340 | cache, 1623 | live 1623 |  |
| 17 | ja | 3 | 12085 | 200 | 37 | 1553 | 1429 | 70/70 | 1754 | 1836 | cache, 1623 | live 1623 |  |
| 18 | ja | 3 | 12098 | 200 | 45 | 1173 | 1027 | 70/70 | 1334 | 1403 | cache, 1623 | live 1623 |  |
| 19 | ja | 3 | 12111 | 200 | 40 | 1569 | 865 | 70/70 | 1718 | 1762 | cache, 1623 | live 1623 |  |
| 20 | ja | 4 | 13824 | 200 | 55 | 1113 | 734 | 70/70 | 1340 | 1578 | cache, 1623 | live 1623 |  |
| 21 | ko | 4 | 13875 | 200 | 45 | 1543 | 1472 | 70/70 | 1823 | 1900 | cache, 1623 | live 1623 |  |
| 22 | ja | 4 | 13894 | 200 | 42 | 1494 | 1352 | 70/70 | 1676 | 1892 | cache, 1623 | live 1623 |  |
| 23 | en | 4 | 13900 | 200 | 43 | 1031 | 986 | 70/70 | 1375 | 1431 | cache, 1623 | live 1623 |  |
| 24 | ja | 4 | 13906 | 200 | 37 | 1108 | 693 | 70/70 | 1307 | 1374 | cache, 1623 | live 1623 |  |
| 25 | ja | 5 | 15656 | 200 | 46 | 1191 | 1022 | 70/70 | 1488 | 1536 | cache, 1623 | live 1623 |  |
| 26 | ko | 5 | 15666 | 200 | 45 | 1276 | 744 | 70/70 | 1429 | 1499 | cache, 1623 | live 1623 |  |
| 27 | ja | 5 | 15682 | 200 | 45 | 1131 | 910 | 70/70 | 1345 | 1409 | cache, 1623 | live 1623 |  |
| 28 | ja | 5 | 15695 | 200 | 49 | 1229 | 981 | 70/70 | 1435 | 1497 | cache, 1623 | live 1623 |  |
| 29 | ja | 5 | 15713 | 200 | 43 | 1251 | 997 | 70/70 | 1428 | 1479 | cache, 1623 | live 1623 |  |

### I3 — final phase (`--final-cohort`)

- 20/20 incumbents kept connected (others stopped at 2026-10-12T07:04:38.886Z, pages closed at 2026-10-12T07:04:38.242Z); 20 of them continuously connected through the first I3 save; 20 fresh clients started 2026-10-12T07:04:38.892Z, all connected 2026-10-12T07:04:39.285Z.

#### I3 — fresh cohort, first save 6 s after join — save f1 rev 1638 at 2026-10-12T07:04:45.292Z (PUT 410 ms): **PASS**

- Eligibility (connected 6 s … 90 s before the save, without interruption through its response): 20/20 eligible; cohort first-SUBSCRIBED spread 0.0 s (≤ 30 s: yes)
- Eligible clients: raw broadcast received 20/20 (PUT response → receipt p50 / p95 / max 42 / 43 / 43 ms); applied 20/20, by {"notification":20}; repair (applied without the broadcast; healthy periodic poll 20 s ± 4 s — measured, not a bound) p50 / max — / — ms (n 0)
- All local clients of the run on this save: received 40/40, applied 40/40 by {"notification":40}

| client | cohort | connected since (UTC) | age at save s | eligible | broadcast ms after PUT response | applying fetch | apply ms after PUT start | repair ms |
|---|---|---|---|---|---|---|---|---|
| 0 | — | — | — | (other cohort) | 40 | notification | 944 | — |
| 1 | — | — | — | (other cohort) | 41 | notification | 861 | — |
| 2 | — | — | — | (other cohort) | 42 | notification | 763 | — |
| 3 | — | — | — | (other cohort) | 40 | notification | 1147 | — |
| 4 | — | — | — | (other cohort) | 41 | notification | 770 | — |
| 5 | — | — | — | (other cohort) | 40 | notification | 688 | — |
| 6 | — | — | — | (other cohort) | 41 | notification | 934 | — |
| 7 | — | — | — | (other cohort) | 41 | notification | 1024 | — |
| 8 | — | — | — | (other cohort) | 44 | notification | 1267 | — |
| 9 | — | — | — | (other cohort) | 40 | notification | 1109 | — |
| 10 | — | — | — | (other cohort) | 40 | notification | 870 | — |
| 11 | — | — | — | (other cohort) | 39 | notification | 1091 | — |
| 12 | — | — | — | (other cohort) | 39 | notification | 906 | — |
| 13 | — | — | — | (other cohort) | 40 | notification | 1058 | — |
| 14 | — | — | — | (other cohort) | 39 | notification | 749 | — |
| 15 | — | — | — | (other cohort) | 40 | notification | 1088 | — |
| 16 | — | — | — | (other cohort) | 41 | notification | 908 | — |
| 17 | — | — | — | (other cohort) | 42 | notification | 963 | — |
| 18 | — | — | — | (other cohort) | 40 | notification | 659 | — |
| 19 | — | — | — | (other cohort) | 40 | notification | 1143 | — |
| 470 | fresh | 2026-10-12T07:04:39.245Z | 6.0 | yes | 43 | notification | 1081 | — |
| 471 | fresh | 2026-10-12T07:04:39.248Z | 6.0 | yes | 43 | notification | 843 | — |
| 472 | fresh | 2026-10-12T07:04:39.245Z | 6.0 | yes | 40 | notification | 993 | — |
| 473 | fresh | 2026-10-12T07:04:39.283Z | 6.0 | yes | 42 | notification | 1038 | — |
| 474 | fresh | 2026-10-12T07:04:39.247Z | 6.0 | yes | 41 | notification | 1169 | — |
| 475 | fresh | 2026-10-12T07:04:39.267Z | 6.0 | yes | 43 | notification | 837 | — |
| 476 | fresh | 2026-10-12T07:04:39.276Z | 6.0 | yes | 42 | notification | 991 | — |
| 477 | fresh | 2026-10-12T07:04:39.245Z | 6.0 | yes | 42 | notification | 764 | — |
| 478 | fresh | 2026-10-12T07:04:39.245Z | 6.0 | yes | 41 | notification | 1015 | — |
| 479 | fresh | 2026-10-12T07:04:39.252Z | 6.0 | yes | 40 | notification | 877 | — |
| 480 | fresh | 2026-10-12T07:04:39.276Z | 6.0 | yes | 40 | notification | 1097 | — |
| 481 | fresh | 2026-10-12T07:04:39.253Z | 6.0 | yes | 42 | notification | 1057 | — |
| 482 | fresh | 2026-10-12T07:04:39.276Z | 6.0 | yes | 42 | notification | 862 | — |
| 483 | fresh | 2026-10-12T07:04:39.252Z | 6.0 | yes | 41 | notification | 1049 | — |
| 484 | fresh | 2026-10-12T07:04:39.270Z | 6.0 | yes | 42 | notification | 934 | — |
| 485 | fresh | 2026-10-12T07:04:39.276Z | 6.0 | yes | 43 | notification | 1064 | — |
| 486 | fresh | 2026-10-12T07:04:39.265Z | 6.0 | yes | 41 | notification | 894 | — |
| 487 | fresh | 2026-10-12T07:04:39.245Z | 6.0 | yes | 42 | notification | 1024 | — |
| 488 | fresh | 2026-10-12T07:04:39.283Z | 6.0 | yes | 41 | notification | 1070 | — |
| 489 | fresh | 2026-10-12T07:04:39.253Z | 6.0 | yes | 43 | notification | 888 | — |

#### I3 — +40 s save — save f2 rev 1639 at 2026-10-12T07:05:25.303Z (PUT 410 ms): **PASS**

- Eligibility (connected 6 s … 130 s before the save, without interruption through its response): 20/20 eligible; cohort first-SUBSCRIBED spread 0.0 s (≤ 30 s: yes)
- Eligible clients: raw broadcast received 20/20 (PUT response → receipt p50 / p95 / max 52 / 55 / 73 ms); applied 20/20, by {"notification":20}; repair (applied without the broadcast; healthy periodic poll 20 s ± 4 s — measured, not a bound) p50 / max — / — ms (n 0)
- All local clients of the run on this save: received 40/40, applied 40/40 by {"notification":37,"periodic":3}

| client | cohort | connected since (UTC) | age at save s | eligible | broadcast ms after PUT response | applying fetch | apply ms after PUT start | repair ms |
|---|---|---|---|---|---|---|---|---|
| 0 | — | — | — | (other cohort) | 50 | notification | 1119 | — |
| 1 | — | — | — | (other cohort) | 54 | notification | 1191 | — |
| 2 | — | — | — | (other cohort) | 51 | notification | 871 | — |
| 3 | — | — | — | (other cohort) | 53 | notification | 1225 | — |
| 4 | — | — | — | (other cohort) | 52 | notification | 947 | — |
| 5 | — | — | — | (other cohort) | 51 | notification | 1046 | — |
| 6 | — | — | — | (other cohort) | 50 | notification | 933 | — |
| 7 | — | — | — | (other cohort) | 53 | notification | 1031 | — |
| 8 | — | — | — | (other cohort) | 52 | periodic | 749 | — |
| 9 | — | — | — | (other cohort) | 51 | notification | 732 | — |
| 10 | — | — | — | (other cohort) | 53 | notification | 1228 | — |
| 11 | — | — | — | (other cohort) | 50 | notification | 1054 | — |
| 12 | — | — | — | (other cohort) | 50 | notification | 1000 | — |
| 13 | — | — | — | (other cohort) | 54 | notification | 893 | — |
| 14 | — | — | — | (other cohort) | 49 | periodic | 852 | — |
| 15 | — | — | — | (other cohort) | 54 | notification | 1197 | — |
| 16 | — | — | — | (other cohort) | 52 | notification | 1185 | — |
| 17 | — | — | — | (other cohort) | 52 | notification | 1092 | — |
| 18 | — | — | — | (other cohort) | 50 | notification | 976 | — |
| 19 | — | — | — | (other cohort) | 50 | periodic | 863 | — |
| 470 | fresh | 2026-10-12T07:04:39.245Z | 46.1 | yes | 54 | notification | 1000 | — |
| 471 | fresh | 2026-10-12T07:04:39.248Z | 46.1 | yes | 53 | notification | 1049 | — |
| 472 | fresh | 2026-10-12T07:04:39.245Z | 46.1 | yes | 51 | notification | 1034 | — |
| 473 | fresh | 2026-10-12T07:04:39.283Z | 46.0 | yes | 47 | notification | 959 | — |
| 474 | fresh | 2026-10-12T07:04:39.247Z | 46.1 | yes | 49 | notification | 1099 | — |
| 475 | fresh | 2026-10-12T07:04:39.267Z | 46.0 | yes | 52 | notification | 800 | — |
| 476 | fresh | 2026-10-12T07:04:39.276Z | 46.0 | yes | 51 | notification | 847 | — |
| 477 | fresh | 2026-10-12T07:04:39.245Z | 46.1 | yes | 48 | notification | 1004 | — |
| 478 | fresh | 2026-10-12T07:04:39.245Z | 46.1 | yes | 48 | notification | 1119 | — |
| 479 | fresh | 2026-10-12T07:04:39.252Z | 46.1 | yes | 48 | notification | 1100 | — |
| 480 | fresh | 2026-10-12T07:04:39.276Z | 46.0 | yes | 54 | notification | 946 | — |
| 481 | fresh | 2026-10-12T07:04:39.253Z | 46.0 | yes | 52 | notification | 1026 | — |
| 482 | fresh | 2026-10-12T07:04:39.276Z | 46.0 | yes | 52 | notification | 1102 | — |
| 483 | fresh | 2026-10-12T07:04:39.252Z | 46.1 | yes | 51 | notification | 912 | — |
| 484 | fresh | 2026-10-12T07:04:39.270Z | 46.0 | yes | 55 | notification | 1125 | — |
| 485 | fresh | 2026-10-12T07:04:39.276Z | 46.0 | yes | 73 | notification | 680 | — |
| 486 | fresh | 2026-10-12T07:04:39.265Z | 46.0 | yes | 53 | notification | 875 | — |
| 487 | fresh | 2026-10-12T07:04:39.245Z | 46.1 | yes | 48 | notification | 845 | — |
| 488 | fresh | 2026-10-12T07:04:39.283Z | 46.0 | yes | 53 | notification | 1166 | — |
| 489 | fresh | 2026-10-12T07:04:39.253Z | 46.0 | yes | 55 | notification | 1206 | — |

## Gate verdicts

Latency = save (the PUT that makes the marker exist; in a pair edit the insert-after came before it) request start of its FIRST attempt → marker link in the page DOM / SDK client applied a snapshot with rev ≥ the PUT's rev. Missing = not seen within the timeout. Monotonic: no page/client ever went back to an older version.

| Scope | n | p50 ms | p95 ms | max ms | missing | gate | verdict |
|---|---|---|---|---|---|---|---|
| all pairs (pages + SDK) | 6054 | 1566 | 4113 | 10467 | 1226 | p95 ≤ 3000, 0 missing | n/a |
| edit × page | 334 | 1303 | 5490 | 10467 | 86 | same | n/a |
| edit × SDK client | 5720 | 1580 | 4106 | 6833 | 1140 | same | n/a |
| monotonic DOM (pages: version shown never decreases) | 30 pages, 334 versions | — | — | — | 0 regressions on 0 page(s) | 0 | **PASS** |
| monotonic applied rev (SDK) | 490 clients, 13514 applies | — | — | — | 0 regressions on 0 client(s) | 0 | **PASS** |
| warming: warm hits ÷ hinted fetches (`x-snapshot-source: warm`) | SDK 6835/6891 (99.2 %), pages 415/415 (100.0 %) | — | — | — | — | informational; reader builds per save: `vercel-logs-summary.mjs` "Warming" on the history logs; arrival vs warm-complete: `warm-join.mjs` | n/a |
| edits with a retried save (clock from the 1st attempt) | 0 | — | — | — | 0 | informational — 0 edit(s); from the successful attempt p50/p95/max —/—/— | n/a |

Insert-start based (insert-after request start → marker; pair edits only), non-drilled: pages 120 | 2460 | 2781 | 2916 · SDK 1880 | 2599 | 3096 | 3473 (n | p50 | p95 | max).

## Notification paths (PUT start → arrival)

An R1 page build (what the preview runs until R2 deploys, or after a rollback) is notified by postgres_changes and ignores the broadcast; an R2 build only has the broadcast. The SDK clients are always R2.

| Path | delivered / expected | p50 ms | p95 ms | max ms |
|---|---|---|---|---|
| postgres_changes UPDATE → pages (R1 build) | 0 / 420 | — | — | — |
| broadcast `rev` → pages | 303 / 420 | 617 | 1113 | 1209 |
| broadcast `rev` → SDK | 5092 / 6860 | 616 | 1104 | 1142 |

## Per edit

| # | mode | row | marker song | insert start (UTC) | ins ms | rev | save (PUT) start (UTC) | save ms | save rev |
|---|---|---|---|---|---|---|---|---|---|
| a1 | admission | 2409 | 1997 LOVE♡YOU♡Save the EARTH!! | — | — | — | 2026-10-12T07:00:26.712Z | 2087 | 1622 |
| a2 | admission | 2409 | 2000 Trick or Toxic | — | — | — | 2026-10-12T07:00:29.696Z | 529 | 1623 |
| a3 | admission | 2409 | 2014 POP LOVE | — | — | — | 2026-10-12T07:00:43.696Z | 420 | 1624 |
| a4 | admission | 2409 | 2015 Spinning Parade | — | — | — | 2026-10-12T07:01:08.697Z | 606 | 1625 |
| 1 | pair | 2410 | 2016 チュリ♡CHUちゅきらり♪ | 2026-10-12T07:01:11.891Z | 723 | 1626 | 2026-10-12T07:01:12.738Z | 521 | 1627 |
| 2 | standalone | 2409 | 2017 Tale of Primavera | — | — | — | 2026-10-12T07:01:37.791Z | 493 | 1628 |
| 3 | pair | 2411 | 2018 始まりは君の空 | 2026-10-12T07:02:01.892Z | 1019 | 1629 | 2026-10-12T07:02:03.045Z | 1001 | 1630 |
| 4 | standalone | 2409 | 2025 未来予報ハレルヤ！ | — | — | — | 2026-10-12T07:02:27.785Z | 504 | 1631 |
| 5 | pair | 2412 | 2026 Tiny Stars | 2026-10-12T07:02:51.904Z | 829 | 1632 | 2026-10-12T07:02:52.876Z | 858 | 1633 |
| 6 | standalone | 2409 | 2027 GOING UP | — | — | — | 2026-10-12T07:03:17.789Z | 453 | 1634 |
| 7 | pair | 2413 | 2028 心キラララ | 2026-10-12T07:03:41.902Z | 698 | 1635 | 2026-10-12T07:03:42.613Z | 577 | 1636 |
| 8 | standalone | 2409 | 2029 常夏☆サンシャイン | — | — | — | 2026-10-12T07:04:07.824Z | 634 | 1637 |
| f1 | final | 2409 | 2030 Wish Song | — | — | — | 2026-10-12T07:04:45.292Z | 410 | 1638 |
| f2 | final | 2409 | 2031 バイバイしちゃえば！？ | — | — | — | 2026-10-12T07:05:25.303Z | 410 | 1639 |

### Per save — pages (save start → marker in the DOM)

| # | save rev | seen | p50 / p95 / max ms | missing | bcast → page p50 / p95 (n) | pg → page (n) | notification fetches (hint=1) | their x-snapshot-verify | warm / hinted | 1st hinted request start − commit p50 / p95 |
|---|---|---|---|---|---|---|---|---|---|---|
| a1 | 1622 | 4/30 | 2927 / 3559 / 3559 | 26 | — / — (0) | 0 | 0 | — | 0/0 | — / — |
| a2 | 1623 | 30/30 | 5578 / 10466 / 10467 | 0 | 562 / 583 (3) | 0 | 0 | — | 0/0 | — / — |
| a3 | 1624 | 30/30 | 1005 / 1245 / 1275 | 0 | 470 / 474 (30) | 0 | 30 | satisfied 30 | 30/30 | 255 / 514 |
| a4 | 1625 | 30/30 | 1202 / 1529 / 1679 | 0 | 614 / 622 (30) | 0 | 30 | satisfied 30 | 30/30 | 278 / 449 |
| 1 | 1627 | 30/30 | 1582 / 1738 / 1781 | 0 | 1113 / 1207 (30) | 0 | 29 | satisfied 29 | 29/29 | 756 / 904 |
| 2 | 1628 | 30/30 | 1108 / 1377 / 1377 | 0 | 548 / 554 (30) | 0 | 30 | satisfied 30 | 30/30 | 262 / 507 |
| 3 | 1630 | 30/30 | 1491 / 1672 / 1722 | 0 | 1072 / 1100 (30) | 0 | 29 | satisfied 29 | 29/29 | 235 / 408 |
| 4 | 1631 | 30/30 | 1153 / 1362 / 1503 | 0 | 533 / 540 (30) | 0 | 29 | satisfied 29 | 29/29 | 306 / 514 |
| 5 | 1633 | 30/30 | 1474 / 1918 / 1944 | 0 | 993 / 1022 (30) | 0 | 29 | satisfied 29 | 29/29 | 382 / 539 |
| 6 | 1634 | 30/30 | 1012 / 1289 / 1316 | 0 | 504 / 507 (30) | 0 | 30 | satisfied 30 | 30/30 | 266 / 540 |
| 7 | 1636 | 30/30 | 1565 / 2036 / 2066 | 0 | 1050 / 1111 (30) | 0 | 30 | satisfied 30 | 30/30 | 667 / 970 |
| 8 | 1637 | 30/30 | 1145 / 1400 / 1461 | 0 | 618 / 626 (30) | 0 | 30 | satisfied 30 | 30/30 | 244 / 484 |
| f1 | 1638 | 0/30 | — / — / — | 30 | — / — (0) | 0 | 0 | — | 0/0 | — / — |
| f2 | 1639 | 0/30 | — / — / — | 30 | — / — (0) | 0 | 0 | — | 0/0 | — / — |

### Per save — SDK clients (save start → applied rev ≥ save rev)

| # | save rev | reached | p50 / p95 / max ms | missing | bcast → SDK p50 / p95 (n) | notification fetches | their x-snapshot-verify | ticket resolutions | rechecks (resolved) | exhausted | warm / hinted | 1st hinted send − commit p50 / p95 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| a1 | 1622 | 470/490 | 4173 / 6236 / 6833 | 20 | — / — (0) | 0 | — | — | 0 (0) | 0 | 0/0 | — / — |
| a2 | 1623 | 470/490 | 1273 / 3252 / 3849 | 20 | 568 / 586 (312) | 306 | satisfied 306 | satisfied 306 | 0 (0) | 0 | 265/306 | 354 / 572 |
| a3 | 1624 | 470/490 | 1413 / 2428 / 2889 | 20 | 472 / 477 (470) | 460 | satisfied 460 | satisfied 466 | 0 (0) | 0 | 460/460 | 269 / 532 |
| a4 | 1625 | 470/490 | 1446 / 1825 / 2758 | 20 | 617 / 622 (470) | 456 | satisfied 456 | satisfied 462 | 0 (0) | 0 | 441/456 | 255 / 494 |
| 1 | 1627 | 470/490 | 1714 / 2052 / 2133 | 20 | 659 / 1130 (470) | 446 | satisfied 446 | satisfied 463 | 0 (0) | 0 | 446/446 | 715 / 1033 |
| 2 | 1628 | 470/490 | 1986 / 3233 / 4549 | 20 | 549 / 554 (470) | 462 | satisfied 462 | satisfied 465 | 0 (0) | 0 | 462/462 | 295 / 533 |
| 3 | 1630 | 470/490 | 1762 / 2153 / 2320 | 20 | 688 / 1104 (470) | 441 | satisfied 441 | satisfied 466 | 0 (0) | 0 | 441/441 | 264 / 952 |
| 4 | 1631 | 470/490 | 1444 / 1767 / 2756 | 20 | 535 / 543 (470) | 461 | satisfied 461 | satisfied 464 | 0 (0) | 0 | 461/461 | 280 / 506 |
| 5 | 1633 | 470/490 | 1612 / 1838 / 2122 | 20 | 892 / 1043 (470) | 440 | satisfied 440 | satisfied 461 | 0 (0) | 0 | 440/440 | 377 / 644 |
| 6 | 1634 | 470/490 | 1397 / 1788 / 2703 | 20 | 505 / 509 (470) | 458 | satisfied 458 | satisfied 464 | 0 (0) | 0 | 458/458 | 302 / 537 |
| 7 | 1636 | 470/490 | 1791 / 2091 / 2489 | 20 | 633 / 1127 (470) | 445 | satisfied 445 | satisfied 466 | 0 (0) | 0 | 445/445 | 761 / 1217 |
| 8 | 1637 | 470/490 | 1440 / 1829 / 2670 | 20 | 619 / 625 (470) | 456 | satisfied 456 | satisfied 465 | 0 (0) | 0 | 456/456 | 245 / 463 |
| f1 | 1638 | 40/490 | 963 / 1147 / 1267 | 450 | 451 / 453 (40) | 40 | satisfied 40 | satisfied 40 | 0 (0) | 0 | 40/40 | 254 / 474 |
| f2 | 1639 | 40/490 | 1004 / 1206 / 1228 | 450 | 462 / 465 (40) | 37 | satisfied 37 | satisfied 37 | 0 (0) | 0 | 37/37 | 336 / 492 |

## Hint outcomes (whole run)

- SDK: 13610 requests; notification fetches (hint=1) 6891, their x-snapshot-verify: satisfied 6891; all 200 responses: none 490, satisfied 13115
  - ticket resolutions: satisfied 7031; rechecks 0 (0.0 % of notification fetches), resolved on the recheck 0; hints exhausted 0; highest serverRev held 1645
  - request shapes (reason / generic / ticket): initial generic 490, catchup generic 490, notification +hint=1 6891, periodic generic 5599, periodic generic +H 140; failures by kind: —
  - notification fetches by x-snapshot-source: build 56, warm 6835 (warm 6835/6891 (99.2 %))
- Pages: 826 /api/setlist responses; notification fetches (hint=1) 415, their x-snapshot-verify: satisfied 415; all 200 responses: satisfied 826 (an R1 page build sends no hint=1)
  - notification fetches by x-snapshot-source: warm 415 (warm 415/415 (100.0 %))

## Measurement validity (load host)

Event-loop lag = how late a 100 ms interval tick ran, per thread, inside the measurement window 2026-10-12T07:00:23.696Z → 2026-10-12T07:05:26.726Z (p50 = median of the 10 s buckets' p50, p95 / p99 / max = the worst bucket). Heartbeats: one per second per worker, from its own loop. Deadline timers: fired − armed − 8,000 ms for every SDK request that hit the 8 s deadline. INVALID if any lag sample > 1000 ms or any heartbeat gap > 3000 ms.

| thread | lag p50 / p95 / p99 / max ms | samples > 1 s | heartbeats (max gap ms) | deadline timers fired: n, late p50 / p95 / max ms |
|---|---|---|---|---|
| main | 3 / 18 / 452 / 452 | 0 | — | — |
| worker 0 | 3 / 28 / 584 / 584 | 0 | 289 (1531) | 0, — / — / — |
| worker 1 | 3 / 16 / 50 / 50 | 0 | 290 (1108) | 0, — / — / — |
| worker 2 | 3 / 16 / 74 / 74 | 0 | 290 (1112) | 0, — / — / — |
| worker 3 | 3 / 27 / 101 / 101 | 0 | 290 (1109) | 0, — / — / — |
| worker 4 | 8 / 17 / 18 / 18 | 0 | 49 (1100) | 0, — / — / — |

Verdict: valid.

Host (1 s samples; 12 logical cores, 65370 MB): host CPU = busy share of all cores; process CPU = this process (main + SDK workers) as a share of all cores; Chromium is in the host figure only. load1 is always 0 on Windows.

| phase | s | host CPU p50 / max % | process CPU p50 / max % | RSS max MB | free mem min MB | load1 max | threads |
|---|---|---|---|---|---|---|---|
| join | 48.2 | 29.6 / 70.1 | 3.1 / 23.9 | 834 | 33895 | 0 | 5 |
| settle | 0.0 | — / — | — / — | — | — | — | 0 |
| edits | 254.8 | 20.7 / 91.1 | 1.3 / 42.3 | 1440 | 32067 | 0 | 6 |

## Population

- Pages: 30/30 loaded; channel joined 30; visibility {"visible":30}; locales {"ja":21,"ko":6,"en":3}
  - open → join ms: n=30 p50=1674 p95=6489 max=6523
  - /api/setlist responses seen: 826 ({"build":35,"warm":415,"cache":376}); page errors: 0; ws opens 30, closes 0; rev broadcasts seen 423; dropped notification frames 0, blocked attempts 0
- SDK: 490/490 joined; all joined after 17.304 s (from population start)
  - subscribe → SUBSCRIBED ms: n=490 p50=195 p95=1850 max=1919
  - statuses {"SUBSCRIBED":490,"CLOSED":490}; disconnected episodes (polling while realtime-js rejoins) 0; channel re-creations 0; fetch failures 0 (with Retry-After 0); fetches by reason {"initial":490,"catchup":490,"notification":6891,"periodic":5739}; X-Snapshot-Source {"build":1188,"cache":5585,"warm":6835}

## Clean-up

- Soft-deleted 5/5 created rows; position restore: {"restored":67}
- Verify: {"dbActive":69,"snapshotItems":69,"snapshotRev":1645,"startRows":69,"goneMeanwhile":0,"sameOrder":true,"samePositions":true,"oursStillActive":[]}
