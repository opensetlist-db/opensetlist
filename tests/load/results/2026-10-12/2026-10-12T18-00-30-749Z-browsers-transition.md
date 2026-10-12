# Browsers run — 2026-10-12T17:48:52.377Z

- Target: https://opensetlist-git-dev-opensetlist-projects.vercel.app/events/111/rehearsal-lovelive-fes-2020-day1 (event 111, start rev 1772, 69 active rows; insert after row 2 = position 2)
- Population: 30 Chromium pages (ja/ko/en 70/20/10), 470 SDK subscribers in 4 worker thread(s)
- Edits: 12 × (insert-after + PUT marker song) — edit mode pair (anchor row 2613), every 25 s; timeout 30 s; drill: none
- Window (UTC): run start 2026-10-12T17:48:52.377Z, first edit 2026-10-12T17:49:39.959Z, last edit settled 2026-10-12T18:00:23.953Z, end 2026-10-12T18:00:30.626Z
- Label: step6-T1
- Host guard at start: CPU 12.7 % busy (2 s CPU sample over 12 cores); 0 competing process(es) (--strict-host)

- Phase: transition — 3 switch(es) on https://opensetlist-git-dev-opensetlist-projects.vercel.app

## Transition (n14 step 6)

**Verdict: VALID + FAIL** — failed: switch 1 performance; switch 1 arrivals; switch 2 performance; switch 2 arrivals; switch 3 performance; switch 3 arrivals — not exercised: switch 1 pendingHinted; switch 1 arrivalSdk; switch 2 pendingHinted; switch 2 arrivalSdk; switch 3 pendingHinted; switch 3 arrivalSdk.

- Anchor row 2613 (rev 1773); manifest 70 rows at rev 1773 (`2026-10-12T17-49-01-395Z-transition-manifest.json`). Population: 30 pages + 470 SDK (430 natural, hold 20, ahead-hint 20); growth initial: 30p + 470s → arrival-1: 40p + 570s → arrival-2: 50p + 670s → arrival-3: 60p + 770s.
- Saves at P-30, -1, +1, +5, +11, +15, +30, +60 s on the anchor (never retried); continuity 30 s from the first save attempt; performance p95 ≤ 3000 ms per save per population; leg gap 90 s; probe every 1000 ms (644 requests); route marker 2/s over P-10…+70 s.
- The boundary ("first target response") is PROVISIONAL here: the route marker's live identification (`data-dpl-id`), else cliEnd. `../transition-join.mjs` attributes every recorded `x-vercel-id` to its deployment from the Vercel logs.

| switch | kind | P (UTC) | CLI (s) | target | first target live | guard | continuity | performance | arrivals | smoke | exposure |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1  | off | 2026-10-12T17:51:13.000Z | 0.1…3.8 (242 ms CPU) | dpl_7H9E2oNx1gkv9VX2CZzKeCtFB73e | +7.4 s | **PASS** | **PASS** | **FAIL** | **FAIL** | **PASS** | pendingHinted NOT, oldAnswer ✓, arrivalSdk NOT, arrivalPages ✓ |
| 2  | return | 2026-10-12T17:55:13.000Z | 0.0…4.0 (273 ms CPU) | dpl_FAt2Sp33CvHnRohZyHkH5bUHZ4X5 | +5.0 s | **PASS** | **PASS** | **FAIL** | **FAIL** | **PASS** | pendingHinted NOT, oldAnswer ✓, arrivalSdk NOT, arrivalPages ✓ |
| 3  | fresh | 2026-10-12T17:59:13.000Z | 0.2…4.6 (166 ms CPU) | dpl_F5VocFcajvm1wf2aFqdMaBNhHvaK | +7.3 s | **PASS** | **PASS** | **FAIL** | **FAIL** | **PASS** | pendingHinted NOT, oldAnswer ✓, arrivalSdk NOT, arrivalPages ✓ |

### Switch 1 (off)

- File `switch-T1-1.json` seen 2026-10-12T17:49:39.960Z (notice 145.4 s), complete 2026-10-12T17:51:17.205Z; target https://opensetlist-fvbdesrew-opensetlist-projects.vercel.app; baseline dpl_FAt2Sp33CvHnRohZyHkH5bUHZ4X5.
- Live routing (route marker): first target 2026-10-12T17:51:20.356Z (marker served by the target id); last old request start 2026-10-12T17:51:20.012Z, last old response 2026-10-12T17:51:20.479Z; sustained target routing over 60 s: **no** (2 off-target). Boundary: 2026-10-12T17:51:20.356Z (route marker (data-dpl-id)).
- Identity guard through https://opensetlist-fvbdesrew-opensetlist-projects.vercel.app: ok (2989 ms, 1 attempt(s), started 1 ms after the file completed).
- Saves: 1.0 put P-30s 200 rev 1774 493 ms (late 1, cliEnd-33.8 s); 1.1 put P-1s 200 rev 1775 544 ms (late 11, cliEnd-4.8 s); 1.2 put P+1s 200 rev 1776 474 ms (late 12, cliEnd-2.8 s); 1.3 put P+5s 200 rev 1777 426 ms (late 2195, cliEnd+3.4 s, gated 2184); 1.4 put P+11s 200 rev 1778 3021 ms (late 13, cliEnd+7.2 s); 1.5 put P+15s 200 rev 1779 2505 ms (late 4, cliEnd+11.2 s); 1.6 put P+30s 200 rev 1780 795 ms (late 11, cliEnd+26.2 s); 1.7 put P+60s 200 rev 1781 413 ms (late 12, cliEnd+56.2 s).

| check (continuity) | value | verdict |
|---|---|---|
| every planned save 2xx (never retried) | 8/8 | **PASS** |
| every eligible client ≥ the saved rev within 30 s of the first save attempt (incumbents from the PUT start, arrivals from max(join, PUT response)) | 0 missing | **PASS** |
| every continuously connected eligible R2 client received the committed broadcast | SDK 0 missed, R2 pages 0 missed | **PASS** |
| 5xx (saves, SDK, pages incl. documents, probe, route marker, guard, smoke) | 0 {"saves":0,"sdk":0,"pages":0,"probe":0,"route":0,"guard":0,"smoke":0} | **PASS** |
| transport failures (held hold-subset deadlines excluded, listed apart) | 0 {"saves":0,"sdk":0,"pages":0,"probe":0}; held → deadline 7 | **PASS** |
| malformed bodies | 0 {"sdk":0,"pages":0,"probe":0} | **PASS** |
| unexpected reloads (pages) | 0 | **PASS** |
| page errors | 0 | **PASS** |
| monotonicity regressions (SDK applied rev, pages DOM version) | SDK 0, pages 0 | **PASS** |

| save | op | rev | SDK before p95 (n) / miss | SDK after p95 (n) / miss | pages before | pages after | pages DOM rows (structural) | broadcast SDK recv / eligible | R2 pages recv / eligible | outcomes |
|---|---|---|---|---|---|---|---|---|---|---|
| 1.0 | put | 1774 | 1917 (430) / 0 | 1631 (300) / 0 | 1479 (30) / 0 | — (0) / 0 | — | 430 / 430 | 30 / 30 | {"satisfied-first-fetch":420,"periodic-repaired":10,"initial":300,"(superseded)":300} |
| 1.1 | put | 1775 | 1838 (430) / 0 | 1631 (300) / 0 | 1350 (30) / 0 | 0 (10) / 0 | — | 430 / 430 | 30 / 30 | {"satisfied-first-fetch":425,"periodic-repaired":5,"initial":300,"(superseded)":300} |
| 1.2 | put | 1776 | 1340 (430) / 0 | 1631 (300) / 0 | 1392 (30) / 0 | 0 (10) / 0 | — | 430 / 430 | 30 / 30 | {"satisfied-first-fetch":424,"periodic-repaired":6,"initial":300,"(superseded)":300} |
| 1.3 | put | 1777 | 3502 (430) / 0 | 1631 (300) / 0 | 1791 (30) / 0 | 0 (10) / 0 | — | 430 / 430 | 30 / 30 | {"satisfied-first-fetch":418,"periodic-repaired":12,"initial":300,"(superseded)":200} |
| 1.4 | put | 1778 | 6686 (480) / 0 | 3293 (250) / 0 | 6573 (30) / 0 | 1671 (10) / 0 | — | 480 / 480 | 30 / 30 | {"satisfied-first-fetch":513,"periodic-repaired":8,"(superseded)":211,"catchup":9,"initial":200} |
| 1.5 | put | 1779 | 4961 (530) / 0 | 510 (200) / 0 | 4790 (31) / 0 | 2504 (9) / 0 | — | 530 / 530 | 31 / 31 | {"periodic-repaired":37,"satisfied-first-fetch":493,"initial":200,"(superseded)":200} |
| 1.6 | put | 1780 | 3093 (530) / 0 | 510 (200) / 0 | 2048 (40) / 0 | — (0) / 0 | — | 530 / 530 | 40 / 40 | {"satisfied-first-fetch":518,"periodic-repaired":12,"initial":200,"(superseded)":200} |
| 1.7 | put | 1781 | 2903 (530) / 0 | 510 (200) / 0 | 2023 (40) / 0 | — (0) / 0 | — | 530 / 530 | 40 / 40 | {"satisfied-first-fetch":515,"periodic-repaired":15,"initial":200,"(superseded)":200} |

- Performance: **FAIL** — 1.3 sdkBefore p95 3502; 1.4 sdkBefore p95 6686; 1.4 sdkAfter p95 3293; 1.4 pagesBefore p95 6573; 1.5 sdkBefore p95 4961; 1.5 pagesBefore p95 4790; 1.6 sdkBefore p95 3093.
- Exposure (provisional boundary): pending hinted fetch 0 (≥ 20) → NOT EXERCISED; old answer after cutover, converged without regression: natural 0/0, hold 15/15 (≥ 5) → EXERCISED; arrival saves 1.4 (P+11): SDK unjoined 0, pages incomplete 5 ✓; 1.5 (P+15): SDK unjoined 0, pages incomplete 2.
- Hold subset: armed 2026-10-12T17:51:11.502Z, triggers P-1s 7, P+1s 7, P+3s 6, released 2026-10-12T17:51:20.564Z (target+200ms); 20 response(s) held; held → deadline 7.
- Arrivals arrival-1 at 2026-10-12T17:51:23.000Z: pages 10 (builds {"r2":10}), time to usable (later of complete setlist and readiness) p50 / p95 / max 2645 / 6850 / 6850 ms, wave 0 p95 6850, unusable 0; SDK 100, first snapshot p50 / p95 1303 / 2688 ms, without 0.
- Reaction / wish smoke (old pages): p0 ja: reaction 200, wish 403 → ok; p1 ko: reaction 200, wish 403 → ok; p3 en: reaction 200, wish 403 → ok.
- Pins: SDK 0/7485 requests pinned, page API 0/493, probe 0; framework assets after the switch 600 (pinned 600, 404 0) — "no chunk 404 after the switch": holds for the assets fetched. Update gaps (natural SDK, max interval between successful responses in the window) p50 / max 20473 / 24446 ms.

### Switch 2 (return)

- File `switch-T1-2.json` seen 2026-10-12T17:52:13.426Z (notice 383.3 s), complete 2026-10-12T17:55:17.374Z; target https://opensetlist-6l87uqc8o-opensetlist-projects.vercel.app; baseline dpl_7H9E2oNx1gkv9VX2CZzKeCtFB73e.
- Live routing (route marker): first target 2026-10-12T17:55:18.028Z (marker served by the target id); last old request start 2026-10-12T17:55:20.000Z, last old response 2026-10-12T17:55:20.524Z; sustained target routing over 60 s: **no** (3 off-target). Boundary: 2026-10-12T17:55:18.028Z (route marker (data-dpl-id)).
- Identity guard through https://opensetlist-6l87uqc8o-opensetlist-projects.vercel.app: ok (1862 ms, 1 attempt(s), started 1 ms after the file completed).
- Saves: 2.0 put P-30s 200 rev 1782 548 ms (late 11, cliEnd-34.0 s); 2.1 put P-1s 200 rev 1783 447 ms (late 1, cliEnd-5.0 s); 2.2 put P+1s 200 rev 1784 1327 ms (late 12, cliEnd-3.0 s); 2.3 put P+5s 200 rev 1785 419 ms (late 1237, cliEnd+2.2 s, gated 1222); 2.4 put P+11s 200 rev 1786 959 ms (late 1, cliEnd+7.0 s); 2.5 put P+15s 200 rev 1787 425 ms (late 6, cliEnd+11.0 s); 2.6 put P+30s 200 rev 1788 467 ms (late 12, cliEnd+26.0 s); 2.7 put P+60s 200 rev 1789 404 ms (late 6, cliEnd+56.0 s).

| check (continuity) | value | verdict |
|---|---|---|
| every planned save 2xx (never retried) | 8/8 | **PASS** |
| every eligible client ≥ the saved rev within 30 s of the first save attempt (incumbents from the PUT start, arrivals from max(join, PUT response)) | 0 missing | **PASS** |
| every continuously connected eligible R2 client received the committed broadcast | SDK 0 missed, R2 pages 0 missed | **PASS** |
| 5xx (saves, SDK, pages incl. documents, probe, route marker, guard, smoke) | 0 {"saves":0,"sdk":0,"pages":0,"probe":0,"route":0,"guard":0,"smoke":0} | **PASS** |
| transport failures (held hold-subset deadlines excluded, listed apart) | 0 {"saves":0,"sdk":0,"pages":0,"probe":0}; held → deadline 0 | **PASS** |
| malformed bodies | 0 {"sdk":0,"pages":0,"probe":0} | **PASS** |
| unexpected reloads (pages) | 0 | **PASS** |
| page errors | 0 | **PASS** |
| monotonicity regressions (SDK applied rev, pages DOM version) | SDK 0, pages 0 | **PASS** |

| save | op | rev | SDK before p95 (n) / miss | SDK after p95 (n) / miss | pages before | pages after | pages DOM rows (structural) | broadcast SDK recv / eligible | R2 pages recv / eligible | outcomes |
|---|---|---|---|---|---|---|---|---|---|---|
| 2.0 | put | 1782 | 2880 (530) / 0 | 510 (200) / 0 | 2026 (40) / 0 | — (0) / 0 | — | 530 / 530 | 40 / 40 | {"satisfied-first-fetch":509,"periodic-repaired":21,"initial":200,"(superseded)":200} |
| 2.1 | put | 1783 | 3323 (530) / 0 | 510 (200) / 0 | 1758 (40) / 0 | 0 (10) / 0 | — | 530 / 530 | 40 / 40 | {"satisfied-first-fetch":519,"periodic-repaired":11,"initial":200,"(superseded)":200} |
| 2.2 | put | 1784 | 3691 (530) / 0 | 510 (200) / 0 | 3657 (40) / 0 | 0 (10) / 0 | — | 530 / 530 | 40 / 40 | {"satisfied-first-fetch":516,"periodic-repaired":14,"initial":200,"(superseded)":200} |
| 2.3 | put | 1785 | 2259 (530) / 0 | 510 (200) / 0 | 1641 (40) / 0 | 0 (10) / 0 | — | 530 / 530 | 40 / 40 | {"satisfied-first-fetch":515,"periodic-repaired":15,"initial":200,"(superseded)":100} |
| 2.4 | put | 1786 | 3560 (580) / 0 | 798 (150) / 0 | 2224 (40) / 0 | 1656 (10) / 0 | — | 580 / 580 | 40 / 40 | {"satisfied-first-fetch":569,"periodic-repaired":11,"catchup":50,"initial":100,"(superseded)":100} |
| 2.5 | put | 1787 | 1491 (630) / 0 | 625 (100) / 0 | 1566 (49) / 0 | 220 (1) / 0 | — | 630 / 630 | 49 / 49 | {"satisfied-first-fetch":617,"periodic-repaired":13,"initial":100,"(superseded)":100} |
| 2.6 | put | 1788 | 2496 (630) / 0 | 625 (100) / 0 | 1399 (50) / 0 | — (0) / 0 | — | 630 / 630 | 50 / 50 | {"satisfied-first-fetch":618,"periodic-repaired":12,"initial":100,"(superseded)":100} |
| 2.7 | put | 1789 | 2550 (630) / 0 | 625 (100) / 0 | 1548 (50) / 0 | — (0) / 0 | — | 630 / 630 | 50 / 50 | {"satisfied-first-fetch":621,"periodic-repaired":9,"initial":100,"(superseded)":100} |

- Performance: **FAIL** — 2.1 sdkBefore p95 3323; 2.2 sdkBefore p95 3691; 2.2 pagesBefore p95 3657; 2.4 sdkBefore p95 3560.
- Exposure (provisional boundary): pending hinted fetch 0 (≥ 20) → NOT EXERCISED; old answer after cutover, converged without regression: natural 0/0, hold 20/20 (≥ 5) → EXERCISED; arrival saves 2.4 (P+11): SDK unjoined 1, pages incomplete 5 ✓; 2.5 (P+15): SDK unjoined 0, pages incomplete 1.
- Hold subset: armed 2026-10-12T17:55:11.507Z, triggers P-1s 7, P+1s 7, P+3s 6, released 2026-10-12T17:55:18.229Z (target+200ms); 20 response(s) held; held → deadline 0.
- Arrivals arrival-2 at 2026-10-12T17:55:23.007Z: pages 10 (builds {"r2":10}), time to usable (later of complete setlist and readiness) p50 / p95 / max 1612 / 3186 / 3186 ms, wave 0 p95 3186, unusable 0; SDK 100, first snapshot p50 / p95 517 / 721 ms, without 0.
- Reaction / wish smoke (old pages): p0 ja: reaction 200, wish 403 → ok; p1 ko: reaction 200, wish 403 → ok; p3 en: reaction 200, wish 403 → ok.
- Existing-ON return, first answers after the boundary: 0/791 stale — reported, not a gate.
- Pins: SDK 0/8901 requests pinned, page API 0/638, probe 0; framework assets after the switch 400 (pinned 400, 404 0) — "no chunk 404 after the switch": holds for the assets fetched. Update gaps (natural SDK, max interval between successful responses in the window) p50 / max 20272 / 25304 ms.

### Switch 3 (fresh)

- File `switch-T1-3.json` seen 2026-10-12T17:56:13.411Z (notice 620.9 s), complete 2026-10-12T17:59:17.930Z; target https://opensetlist-8kis2jv91-opensetlist-projects.vercel.app; baseline dpl_FAt2Sp33CvHnRohZyHkH5bUHZ4X5.
- Live routing (route marker): first target 2026-10-12T17:59:20.261Z (marker served by the target id); last old request start 2026-10-12T17:59:23.511Z, last old response 2026-10-12T17:59:23.985Z; sustained target routing over 60 s: **no** (4 off-target). Boundary: 2026-10-12T17:59:20.261Z (route marker (data-dpl-id)).
- Identity guard through https://opensetlist-8kis2jv91-opensetlist-projects.vercel.app: ok (2354 ms, 1 attempt(s), started 1 ms after the file completed).
- Saves: 3.0 put P-30s 200 rev 1790 574 ms (late 2, cliEnd-34.6 s); 3.1 put P-1s 200 rev 1791 403 ms (late 0, cliEnd-5.6 s); 3.2 put P+1s 200 rev 1792 505 ms (late 2, cliEnd-3.6 s); 3.3 put P+5s 200 rev 1793 476 ms (late 2285, cliEnd+2.7 s, gated 2275); 3.4 put P+11s 200 rev 1794 2221 ms (late 6, cliEnd+6.4 s); 3.5 put P+15s 200 rev 1795 426 ms (late 3, cliEnd+10.4 s); 3.6 put P+30s 200 rev 1796 368 ms (late 3, cliEnd+25.4 s); 3.7 put P+60s 200 rev 1797 365 ms (late 12, cliEnd+55.4 s).

| check (continuity) | value | verdict |
|---|---|---|
| every planned save 2xx (never retried) | 8/8 | **PASS** |
| every eligible client ≥ the saved rev within 30 s of the first save attempt (incumbents from the PUT start, arrivals from max(join, PUT response)) | 0 missing | **PASS** |
| every continuously connected eligible R2 client received the committed broadcast | SDK 0 missed, R2 pages 0 missed | **PASS** |
| 5xx (saves, SDK, pages incl. documents, probe, route marker, guard, smoke) | 0 {"saves":0,"sdk":0,"pages":0,"probe":0,"route":0,"guard":0,"smoke":0} | **PASS** |
| transport failures (held hold-subset deadlines excluded, listed apart) | 0 {"saves":0,"sdk":0,"pages":0,"probe":0}; held → deadline 9 | **PASS** |
| malformed bodies | 0 {"sdk":0,"pages":0,"probe":0} | **PASS** |
| unexpected reloads (pages) | 0 | **PASS** |
| page errors | 0 | **PASS** |
| monotonicity regressions (SDK applied rev, pages DOM version) | SDK 0, pages 0 | **PASS** |

| save | op | rev | SDK before p95 (n) / miss | SDK after p95 (n) / miss | pages before | pages after | pages DOM rows (structural) | broadcast SDK recv / eligible | R2 pages recv / eligible | outcomes |
|---|---|---|---|---|---|---|---|---|---|---|
| 3.0 | put | 1790 | 2433 (630) / 0 | 625 (100) / 0 | 1531 (50) / 0 | — (0) / 0 | — | 630 / 630 | 50 / 50 | {"satisfied-first-fetch":621,"periodic-repaired":9,"initial":100,"(superseded)":100} |
| 3.1 | put | 1791 | 2640 (630) / 0 | 625 (100) / 0 | 1434 (50) / 0 | 0 (10) / 0 | — | 630 / 630 | 50 / 50 | {"satisfied-first-fetch":616,"periodic-repaired":14,"initial":100,"(superseded)":100} |
| 3.2 | put | 1792 | 1605 (630) / 0 | 625 (100) / 0 | 1633 (50) / 0 | 0 (10) / 0 | — | 630 / 630 | 50 / 50 | {"satisfied-first-fetch":606,"periodic-repaired":24,"initial":100,"(superseded)":100} |
| 3.3 | put | 1793 | 2916 (630) / 0 | 625 (100) / 0 | 1718 (50) / 0 | 0 (10) / 0 | — | 630 / 630 | 50 / 50 | {"satisfied-first-fetch":611,"periodic-repaired":19,"initial":100} |
| 3.4 | put | 1794 | 4335 (679) / 0 | 987 (51) / 0 | 3295 (50) / 0 | 677 (10) / 0 | — | 679 / 679 | 50 / 50 | {"satisfied-first-fetch":722,"periodic-repaired":8} |
| 3.5 | put | 1795 | 1891 (730) / 0 | — (0) / 0 | 2112 (55) / 0 | 1086 (5) / 0 | — | 730 / 730 | 55 / 55 | {"satisfied-first-fetch":714,"periodic-repaired":16} |
| 3.6 | put | 1796 | 2908 (730) / 0 | — (0) / 0 | 1670 (60) / 0 | — (0) / 0 | — | 730 / 730 | 60 / 60 | {"satisfied-first-fetch":700,"periodic-repaired":30} |
| 3.7 | put | 1797 | 3367 (730) / 0 | — (0) / 0 | 3358 (60) / 0 | — (0) / 0 | — | 730 / 730 | 60 / 60 | {"satisfied-first-fetch":711,"periodic-repaired":19} |

- Performance: **FAIL** — 3.4 sdkBefore p95 4335; 3.4 pagesBefore p95 3295; 3.7 sdkBefore p95 3367; 3.7 pagesBefore p95 3358.
- Exposure (provisional boundary): pending hinted fetch 0 (≥ 20) → NOT EXERCISED; old answer after cutover, converged without regression: natural 0/0, hold 14/14 (≥ 5) → EXERCISED; arrival saves 3.4 (P+11): SDK unjoined 0, pages incomplete 5 ✓; 3.5 (P+15): SDK unjoined 0, pages incomplete 5 ✓.
- Hold subset: armed 2026-10-12T17:59:11.510Z, triggers P-1s 7, P+1s 7, P+3s 6, released 2026-10-12T17:59:20.474Z (target+200ms); 20 response(s) held; held → deadline 9.
- Arrivals arrival-3 at 2026-10-12T17:59:23.010Z: pages 10 (builds {"r2":10}), time to usable (later of complete setlist and readiness) p50 / p95 / max 2073 / 4755 / 4755 ms, wave 0 p95 4755, unusable 0; SDK 100, first snapshot p50 / p95 708 / 1055 ms, without 0.
- Reaction / wish smoke (old pages): p0 ja: reaction 200, wish 403 → ok; p1 ko: reaction 200, wish 403 → ok; p3 en: reaction 200, wish 403 → ok.
- Pins: SDK 0/11259 requests pinned, page API 0/856, probe 0; framework assets after the switch 200 (pinned 200, 404 0) — "no chunk 404 after the switch": holds for the assets fetched. Update gaps (natural SDK, max interval between successful responses in the window) p50 / max 19932 / 25086 ms.

## Gate verdicts

Latency = save (the PUT that makes the marker exist; in a pair edit the insert-after came before it) request start of its FIRST attempt → marker link in the page DOM / SDK client applied a snapshot with rev ≥ the PUT's rev. Missing = not seen within the timeout. Monotonic: no page/client ever went back to an older version.

| Scope | n | p50 ms | p95 ms | max ms | missing | gate | verdict |
|---|---|---|---|---|---|---|---|
| all pairs (pages + SDK) | 16872 | 1794 | 6246 | 15291 | 3048 | p95 ≤ 3000, 0 missing | n/a |
| edit × page | 1092 | 1285 | 4657 | 11073 | 348 | same | n/a |
| edit × SDK client | 15780 | 1827 | 6360 | 15291 | 2700 | same | n/a |
| monotonic DOM (pages: version shown never decreases) | 60 pages, 1092 versions | — | — | — | 0 regressions on 0 page(s) | 0 | **PASS** |
| monotonic applied rev (SDK) | 770 clients, 37155 applies | — | — | — | 0 regressions on 0 client(s) | 0 | **PASS** |
| warming: warm hits ÷ hinted fetches (`x-snapshot-source: warm`) | SDK 10797/15821 (68.2 %), pages 770/1126 (68.4 %) | — | — | — | — | informational; reader builds per save: `vercel-logs-summary.mjs` "Warming" on the history logs; arrival vs warm-complete: `warm-join.mjs` | n/a |
| edits with a retried save (clock from the 1st attempt) | 0 | — | — | — | 0 | informational — 0 edit(s); from the successful attempt p50/p95/max —/—/— | n/a |

Insert-start based (insert-after request start → marker; pair edits only), non-drilled: pages 0 | — | — | — · SDK 0 | — | — | — (n | p50 | p95 | max).

## Notification paths (PUT start → arrival)

An R1 page build (what the preview runs until R2 deploys, or after a rollback) is notified by postgres_changes and ignores the broadcast; an R2 build only has the broadcast. The SDK clients are always R2.

| Path | delivered / expected | p50 ms | p95 ms | max ms |
|---|---|---|---|---|
| postgres_changes UPDATE → pages (R1 build) | 0 / 1440 | — | — | — |
| broadcast `rev` → pages | 1045 / 1440 | 522 | 2555 | 3080 |
| broadcast `rev` → SDK | 14879 / 18480 | 524 | 2556 | 3081 |

## Per edit

| # | mode | row | marker song | insert start (UTC) | ins ms | rev | save (PUT) start (UTC) | save ms | save rev |
|---|---|---|---|---|---|---|---|---|---|
| 1.0 | transition | 2613 | 1997 LOVE♡YOU♡Save the EARTH!! | — | — | — | 2026-10-12T17:50:43.001Z | 493 | 1774 |
| 1.1 | transition | 2613 | 2030 Wish Song | — | — | — | 2026-10-12T17:51:12.011Z | 544 | 1775 |
| 1.2 | transition | 2613 | 2032 ノンフィクション!! | — | — | — | 2026-10-12T17:51:14.012Z | 474 | 1776 |
| 1.3 | transition | 2613 | 2033 Starlight Prologue | — | — | — | 2026-10-12T17:51:20.195Z | 426 | 1777 |
| 1.4 | transition | 2613 | 2039 だいすきのうた | — | — | — | 2026-10-12T17:51:24.013Z | 3021 | 1778 |
| 1.5 | transition | 2613 | 2040 Tiny Stars | — | — | — | 2026-10-12T17:51:28.004Z | 2505 | 1779 |
| 1.6 | transition | 2613 | 2041 未来は風のように | — | — | — | 2026-10-12T17:51:43.011Z | 795 | 1780 |
| 1.7 | transition | 2613 | 2044 グソクムシのうた | — | — | — | 2026-10-12T17:52:13.012Z | 413 | 1781 |
| 2.0 | transition | 2613 | 2046 未来は風のように | — | — | — | 2026-10-12T17:54:43.011Z | 548 | 1782 |
| 2.1 | transition | 2613 | 2047 未来は風のように | — | — | — | 2026-10-12T17:55:12.001Z | 447 | 1783 |
| 2.2 | transition | 2613 | 2050 未来は風のように | — | — | — | 2026-10-12T17:55:14.012Z | 1327 | 1784 |
| 2.3 | transition | 2613 | 2061 Memories | — | — | — | 2026-10-12T17:55:19.237Z | 419 | 1785 |
| 2.4 | transition | 2613 | 2062 Memories | — | — | — | 2026-10-12T17:55:24.001Z | 959 | 1786 |
| 2.5 | transition | 2613 | 2063 Anniversary | — | — | — | 2026-10-12T17:55:28.006Z | 425 | 1787 |
| 2.6 | transition | 2613 | 2064 Anniversary | — | — | — | 2026-10-12T17:55:43.012Z | 467 | 1788 |
| 2.7 | transition | 2613 | 2065 Message | — | — | — | 2026-10-12T17:56:13.006Z | 404 | 1789 |
| 3.0 | transition | 2613 | 2066 Message | — | — | — | 2026-10-12T17:58:43.002Z | 574 | 1790 |
| 3.1 | transition | 2613 | 2067 Ringing! | — | — | — | 2026-10-12T17:59:12.000Z | 403 | 1791 |
| 3.2 | transition | 2613 | 2068 Ringing! | — | — | — | 2026-10-12T17:59:14.002Z | 505 | 1792 |
| 3.3 | transition | 2613 | 2069 Dears | — | — | — | 2026-10-12T17:59:20.285Z | 476 | 1793 |
| 3.4 | transition | 2613 | 2070 Dears | — | — | — | 2026-10-12T17:59:24.006Z | 2221 | 1794 |
| 3.5 | transition | 2613 | 2071 Departure | — | — | — | 2026-10-12T17:59:28.003Z | 426 | 1795 |
| 3.6 | transition | 2613 | 2072 Oh！レディ・ステディ・ポジティブ | — | — | — | 2026-10-12T17:59:43.003Z | 368 | 1796 |
| 3.7 | transition | 2613 | 2074 ヒロインズ☆ランウェイ | — | — | — | 2026-10-12T18:00:13.012Z | 365 | 1797 |

### Per save — pages (save start → marker in the DOM)

| # | save rev | seen | p50 / p95 / max ms | missing | bcast → page p50 / p95 (n) | pg → page (n) | notification fetches (hint=1) | their x-snapshot-verify | warm / hinted | 1st hinted request start − commit p50 / p95 |
|---|---|---|---|---|---|---|---|---|---|---|
| 1.0 | 1774 | 30/60 | 1084 / 1479 / 1498 | 30 | 549 / 554 (30) | 0 | 27 | satisfied 27 | 27/27 | 289 / 587 |
| 1.1 | 1775 | 30/60 | 1216 / 1350 / 1436 | 30 | 596 / 599 (30) | 0 | 29 | satisfied 29 | 29/29 | 383 / 540 |
| 1.2 | 1776 | 30/60 | 1135 / 1392 / 1480 | 30 | 523 / 527 (30) | 0 | 29 | satisfied 29 | 28/29 | 371 / 489 |
| 1.3 | 1777 | 34/60 | 1243 / 7352 / 11073 | 26 | 481 / 485 (30) | 0 | 29 | satisfied 29 | 8/29 | 366 / 533 |
| 1.4 | 1778 | 39/60 | 5113 / 7704 / 7908 | 21 | 3074 / 3077 (30) | 0 | 29 | satisfied 29 | 0/29 | 354 / 782 |
| 1.5 | 1779 | 40/60 | 4042 / 5207 / 5349 | 20 | 2555 / 2576 (35) | 0 | 32 | satisfied 32 | 0/32 | 296 / 510 |
| 1.6 | 1780 | 40/60 | 1666 / 2048 / 2177 | 20 | 859 / 861 (40) | 0 | 39 | satisfied 39 | 0/39 | 318 / 534 |
| 1.7 | 1781 | 40/60 | 1328 / 2023 / 2126 | 20 | 459 / 464 (40) | 0 | 40 | satisfied 40 | 0/40 | 294 / 544 |
| 2.0 | 1782 | 40/60 | 1517 / 2026 / 2205 | 20 | 561 / 571 (40) | 0 | 39 | satisfied 39 | 0/39 | 268 / 481 |
| 2.1 | 1783 | 40/60 | 1277 / 1758 / 1864 | 20 | 503 / 509 (40) | 0 | 40 | satisfied 40 | 0/40 | 306 / 527 |
| 2.2 | 1784 | 40/60 | 2483 / 3657 / 3696 | 20 | 1381 / 1386 (40) | 0 | 40 | satisfied 40 | 0/40 | 254 / 525 |
| 2.3 | 1785 | 45/60 | 1148 / 5551 / 5684 | 15 | 464 / 470 (40) | 0 | 39 | satisfied 39 | 30/39 | 301 / 517 |
| 2.4 | 1786 | 50/60 | 1773 / 3721 / 3977 | 10 | 1035 / 1036 (42) | 0 | 41 | satisfied 41 | 23/41 | 287 / 623 |
| 2.5 | 1787 | 50/60 | 1089 / 1566 / 1671 | 10 | 492 / 496 (50) | 0 | 49 | satisfied 49 | 49/49 | 369 / 916 |
| 2.6 | 1788 | 50/60 | 1107 / 1399 / 1462 | 10 | 520 / 526 (50) | 0 | 47 | satisfied 47 | 47/47 | 315 / 645 |
| 2.7 | 1789 | 50/60 | 1044 / 1548 / 1577 | 10 | 470 / 471 (50) | 0 | 49 | satisfied 49 | 49/49 | 320 / 798 |
| 3.0 | 1790 | 50/60 | 1169 / 1531 / 1663 | 10 | 624 / 630 (50) | 0 | 47 | satisfied 47 | 47/47 | 331 / 610 |
| 3.1 | 1791 | 50/60 | 1027 / 1434 / 1465 | 10 | 467 / 474 (50) | 0 | 50 | satisfied 50 | 50/50 | 276 / 698 |
| 3.2 | 1792 | 50/60 | 1149 / 1633 / 1668 | 10 | 532 / 537 (50) | 0 | 48 | satisfied 48 | 47/48 | 274 / 724 |
| 3.3 | 1793 | 55/60 | 1223 / 5325 / 6574 | 5 | 530 / 543 (50) | 0 | 46 | satisfied 46 | 18/46 | 269 / 504 |
| 3.4 | 1794 | 59/60 | 2900 / 4624 / 4713 | 1 | 2275 / 2291 (53) | 0 | 49 | satisfied 49 | 35/49 | 271 / 845 |
| 3.5 | 1795 | 60/60 | 1668 / 2293 / 2924 | 0 | 505 / 507 (55) | 0 | 53 | satisfied 53 | 53/53 | 561 / 1313 |
| 3.6 | 1796 | 60/60 | 999 / 1670 / 1721 | 0 | 428 / 432 (60) | 0 | 59 | satisfied 59 | 59/59 | 292 / 1006 |
| 3.7 | 1797 | 60/60 | 1084 / 3358 / 3574 | 0 | 430 / 436 (60) | 0 | 59 | satisfied 59 | 55/59 | 391 / 893 |

### Per save — SDK clients (save start → applied rev ≥ save rev)

| # | save rev | reached | p50 / p95 / max ms | missing | bcast → SDK p50 / p95 (n) | notification fetches | their x-snapshot-verify | ticket resolutions | rechecks (resolved) | exhausted | warm / hinted | 1st hinted send − commit p50 / p95 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1.0 | 1774 | 470/770 | 1449 / 1915 / 2048 | 300 | 546 / 551 (470) | 460 | satisfied 460 | satisfied 467 | 0 (0) | 0 | 460/460 | 312 / 554 |
| 1.1 | 1775 | 570/770 | 1552 / 14128 / 15291 | 200 | 590 / 597 (470) | 458 | satisfied 458 | satisfied 461 | 0 (0) | 0 | 455/458 | 305 / 531 |
| 1.2 | 1776 | 570/770 | 1159 / 12127 / 13290 | 200 | 521 / 527 (470) | 444 | satisfied 444 | satisfied 462 | 0 (0) | 0 | 441/444 | 309 / 518 |
| 1.3 | 1777 | 570/770 | 1560 / 5944 / 7107 | 200 | 481 / 485 (470) | 436 | satisfied 436 | satisfied 450 | 0 (0) | 0 | 140/436 | 300 / 532 |
| 1.4 | 1778 | 570/770 | 5317 / 6736 / 7174 | 200 | 3073 / 3079 (570) | 552 | satisfied 552 | satisfied 560 | 0 (0) | 0 | 0/552 | 339 / 1018 |
| 1.5 | 1779 | 570/770 | 3702 / 4963 / 5343 | 200 | 2554 / 2562 (570) | 523 | satisfied 523 | satisfied 533 | 0 (0) | 0 | 0/523 | 293 / 532 |
| 1.6 | 1780 | 570/770 | 2073 / 3093 / 3507 | 200 | 857 / 863 (570) | 557 | satisfied 557 | satisfied 565 | 0 (0) | 0 | 0/557 | 329 / 540 |
| 1.7 | 1781 | 570/770 | 1932 / 2897 / 3139 | 200 | 457 / 465 (570) | 555 | satisfied 555 | satisfied 564 | 0 (0) | 0 | 0/555 | 282 / 529 |
| 2.0 | 1782 | 570/770 | 2193 / 2891 / 3107 | 200 | 560 / 570 (570) | 549 | satisfied 549 | satisfied 560 | 0 (0) | 0 | 0/549 | 254 / 480 |
| 2.1 | 1783 | 670/770 | 2108 / 12879 / 13114 | 100 | 503 / 510 (570) | 551 | satisfied 551 | satisfied 558 | 0 (0) | 0 | 0/551 | 302 / 516 |
| 2.2 | 1784 | 670/770 | 2880 / 10868 / 11103 | 100 | 1381 / 1388 (570) | 540 | satisfied 540 | satisfied 565 | 0 (0) | 0 | 0/540 | 295 / 538 |
| 2.3 | 1785 | 670/770 | 1279 / 5643 / 5878 | 100 | 464 / 471 (570) | 553 | satisfied 553 | satisfied 563 | 0 (0) | 0 | 249/553 | 298 / 523 |
| 2.4 | 1786 | 670/770 | 2051 / 3519 / 4096 | 100 | 999 / 1011 (669) | 607 | satisfied 607 | satisfied 618 | 0 (0) | 0 | 436/607 | 291 / 535 |
| 2.5 | 1787 | 670/770 | 1254 / 1490 / 1952 | 100 | 482 / 492 (670) | 656 | satisfied 656 | satisfied 664 | 0 (0) | 0 | 654/656 | 312 / 548 |
| 2.6 | 1788 | 670/770 | 1706 / 2486 / 3109 | 100 | 522 / 533 (670) | 657 | satisfied 657 | satisfied 664 | 0 (0) | 0 | 657/657 | 311 / 542 |
| 2.7 | 1789 | 670/770 | 1708 / 2499 / 3152 | 100 | 468 / 473 (670) | 661 | satisfied 661 | satisfied 664 | 0 (0) | 0 | 661/661 | 312 / 570 |
| 3.0 | 1790 | 670/770 | 1802 / 2437 / 2835 | 100 | 622 / 630 (670) | 660 | satisfied 660 | satisfied 665 | 0 (0) | 0 | 660/660 | 288 / 534 |
| 3.1 | 1791 | 770/770 | 1771 / 12887 / 13809 | 0 | 466 / 473 (670) | 646 | satisfied 646 | satisfied 650 | 0 (0) | 0 | 645/646 | 333 / 544 |
| 3.2 | 1792 | 770/770 | 1321 / 10885 / 11807 | 0 | 533 / 547 (670) | 626 | satisfied 626 | satisfied 645 | 0 (0) | 0 | 600/626 | 259 / 529 |
| 3.3 | 1793 | 770/770 | 1896 / 4602 / 5524 | 0 | 530 / 539 (670) | 640 | satisfied 640 | satisfied 657 | 0 (0) | 0 | 395/640 | 307 / 536 |
| 3.4 | 1794 | 770/770 | 3363 / 4319 / 4923 | 0 | 2276 / 2286 (770) | 762 | satisfied 762 | satisfied 765 | 0 (0) | 0 | 702/762 | 307 / 544 |
| 3.5 | 1795 | 770/770 | 1387 / 1886 / 2193 | 0 | 495 / 503 (770) | 753 | satisfied 753 | satisfied 764 | 0 (0) | 0 | 753/753 | 318 / 560 |
| 3.6 | 1796 | 770/770 | 1758 / 2905 / 3308 | 0 | 425 / 433 (770) | 740 | satisfied 740 | satisfied 757 | 0 (0) | 0 | 740/740 | 324 / 901 |
| 3.7 | 1797 | 770/770 | 1843 / 3366 / 3580 | 0 | 430 / 438 (770) | 750 | satisfied 750 | satisfied 757 | 0 (0) | 0 | 682/750 | 311 / 554 |

## Hint outcomes (whole run)

- SDK: 37638 requests; notification fetches (hint=1) 15821, their x-snapshot-verify: satisfied 15809; all 200 responses: none 770, satisfied 36825
  - ticket resolutions: satisfied 16080; rechecks 0 (0.0 % of notification fetches), resolved on the recheck 0; hints exhausted 0; highest serverRev held 1799
  - request shapes (reason / generic / ticket): initial generic 770, catchup generic 762, periodic generic 19990, notification +hint=1 15821, periodic generic +H 228, resume generic 20, resume generic +H 34, retry generic +H 4, catchup generic +H 9; failures by kind: deadline 16
  - notification fetches by x-snapshot-source: warm 10797, build 4712, cache 301, no 200 11 (warm 10797/15821 (68.2 %))
- Pages: 2683 /api/setlist responses; notification fetches (hint=1) 1126, their x-snapshot-verify: satisfied 1126; all 200 responses: satisfied 2683 (an R1 page build sends no hint=1)
  - notification fetches by x-snapshot-source: warm 770, build 354, cache 2 (warm 770/1126 (68.4 %))

## Measurement validity (load host)

Event-loop lag = how late a 100 ms interval tick ran, per thread, inside the measurement window 2026-10-12T17:49:01.397Z → 2026-10-12T18:00:23.953Z (p50 = median of the 10 s buckets' p50, p95 / p99 / max = the worst bucket). Heartbeats: one per second per worker, from its own loop. Deadline timers: fired − armed − 8,000 ms for every SDK request that hit the 8 s deadline. INVALID if any lag sample > 1000 ms or any heartbeat gap > 3000 ms.

| thread | lag p50 / p95 / p99 / max ms | samples > 1 s | heartbeats (max gap ms) | deadline timers fired: n, late p50 / p95 / max ms |
|---|---|---|---|---|
| main | 7 / 41 / 783 / 783 | 0 | — | — |
| worker 0 | 7 / 126 / 749 / 749 | 0 | 642 (1307) | 0, — / — / — |
| worker 1 | 7 / 25 / 102 / 102 | 0 | 642 (1100) | 0, — / — / — |
| worker 2 | 7 / 14 / 124 / 124 | 0 | 642 (1116) | 0, — / — / — |
| worker 3 | 7 / 23 / 147 / 147 | 0 | 642 (1097) | 0, — / — / — |
| worker 4 | 7 / 12 / 69 / 69 | 0 | 639 (1102) | 16, 6 / 14 / 14 |
| worker 5 | 8 / 72 / 661 / 661 | 0 | 639 (1403) | 0, — / — / — |
| worker 6 | 7 / 116 / 815 / 815 | 0 | 509 (1908) | 0, — / — / — |
| worker 7 | 7 / 25 / 142 / 142 | 0 | 286 (1138) | 0, — / — / — |
| worker 8 | 7 / 43 / 153 / 153 | 0 | 61 (1097) | 0, — / — / — |

Verdict: valid.

Host (1 s samples; 12 logical cores, 65370 MB): host CPU = busy share of all cores; process CPU = this process (main + SDK workers) as a share of all cores; Chromium is in the host figure only. load1 is always 0 on Windows.

| phase | s | host CPU p50 / max % | process CPU p50 / max % | RSS max MB | free mem min MB | load1 max | threads |
|---|---|---|---|---|---|---|---|
| join | 18.5 | 30.8 / 64.2 | 6.6 / 26.3 | 840 | 33163 | 0 | 7 |
| settle | 20.0 | 17.8 / 37.2 | 2.1 / 4.9 | 648 | 33170 | 0 | 7 |
| edits | 644.0 | 22.5 / 92.9 | 2.3 / 36.5 | 2732 | 28331 | 0 | 10 |

## Population

- Pages: 60/60 loaded; channel joined 60; visibility {"visible":60}; locales {"ja":42,"ko":12,"en":6}
  - open → join ms: n=60 p50=2452 p95=5584 max=6986
  - /api/setlist responses seen: 2683 ({"cache":1430,"warm":770,"build":483}); page errors: 0; ws opens 60, closes 0; rev broadcasts seen 1165; dropped notification frames 0, blocked attempts 0
- SDK: 770/770 joined; all joined after 18.539 s (from population start)
  - subscribe → SUBSCRIBED ms: n=770 p50=383 p95=1820 max=2070
  - statuses {"SUBSCRIBED":771,"CLOSED":770,"CHANNEL_ERROR":1}; disconnected episodes (polling while realtime-js rejoins) 1; channel re-creations 0; fetch failures 16 (with Retry-After 0); fetches by reason {"initial":770,"catchup":771,"periodic":20218,"notification":15821,"resume":54,"retry":4}; X-Snapshot-Source {"cache":20583,"warm":10797,"build":6236}
  - channel errors: {"channel error: transport failure":1}

## Clean-up

- Soft-deleted 1/1 created rows; position restore: {"restored":67}
- Verify: {"dbActive":69,"snapshotItems":69,"snapshotRev":1799,"startRows":69,"goneMeanwhile":0,"sameOrder":true,"samePositions":true,"oursStillActive":[]}
