# Browsers run — 2026-10-12T15:53:57.031Z

- Target: https://opensetlist-git-dev-opensetlist-projects.vercel.app/events/111/rehearsal-lovelive-fes-2020-day1 (event 111, start rev 1718, 23 active rows; insert after row 2 = position 2)
- Population: 2 Chromium pages (ja/ko/en 70/20/10), 5 SDK subscribers in 1 worker thread(s)
- Edits: 12 × (insert-after + PUT marker song) — edit mode pair (anchor row 2516), every 25 s; timeout 30 s; drill: none
- Window (UTC): run start 2026-10-12T15:53:57.031Z, first edit 2026-10-12T15:54:26.640Z, last edit settled 2026-10-12T15:58:02.635Z, end 2026-10-12T15:58:05.323Z
- Label: smoke-transition-3
- Host guard at start: CPU 10 % busy (2 s CPU sample over 12 cores); 0 competing process(es)

- Phase: transition — 2 switch(es) on https://opensetlist-git-dev-opensetlist-projects.vercel.app

## Transition (n14 step 6)

**Verdict: NOT EXERCISED** — not exercised: switch 1 pendingHinted; switch 1 oldAnswer; switch 1 arrivalSdk; switch 1 arrivalPages; switch 2 pendingHinted; switch 2 pendingRecheck; switch 2 oldAnswer; switch 2 arrivalSdk; switch 2 arrivalPages.

- Anchor row 2516 (rev 1719); manifest 24 rows at rev 1719 (`2026-10-12T15-54-03-413Z-transition-manifest.json`). Population: 2 pages + 5 SDK (3 natural, hold 1, ahead-hint 1); growth initial: 2p + 5s → r1-1: 4p + 7s → arrival-2: 5p + 9s.
- Saves at P-20, -1, +1, +5, +11, +15 s on the anchor (never retried); continuity 30 s from the first save attempt; performance p95 ≤ 3000 ms per save per population; leg gap 20 s; probe every 1000 ms (216 requests); route marker 2/s over P-10…+70 s.
- The boundary ("first target response") is PROVISIONAL here: the route marker's live identification (`data-dpl-id`), else cliEnd. `../transition-join.mjs` attributes every recorded `x-vercel-id` to its deployment from the Vercel logs.

| switch | kind | P (UTC) | CLI (s) | target | first target live | guard | continuity | performance | arrivals | smoke | exposure |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 smoke pseudo-switch | r1 | 2026-10-12T15:55:56.632Z | 0.1…2.5 (0 ms CPU) | dpl_FAt2Sp33CvHnRohZyHkH5bUHZ4X5 | +2.9 s | **PASS** | **PASS** | **PASS** | **PASS** | **PASS** | pendingHinted NOT, oldAnswer NOT, arrivalSdk NOT, arrivalPages NOT |
| 2 smoke pseudo-switch | return-from-r1 | 2026-10-12T15:56:51.645Z | 0.1…2.5 (0 ms CPU) | dpl_FAt2Sp33CvHnRohZyHkH5bUHZ4X5 | +3.0 s | **PASS** | **PASS** | **PASS** | **PASS** | **PASS** | pendingHinted NOT, pendingRecheck NOT, oldAnswer NOT, arrivalSdk NOT, arrivalPages NOT |

### Switch 1 — smoke pseudo-switch (r1)

- File `s3a.json` seen 2026-10-12T15:54:26.645Z (notice 120.0 s), complete 2026-10-12T15:55:59.639Z; target https://opensetlist-6l87uqc8o-opensetlist-projects.vercel.app; baseline dpl_FAt2Sp33CvHnRohZyHkH5bUHZ4X5.
- Live routing (route marker): first target 2026-10-12T15:55:59.578Z (pseudo: first marker started after cliEnd); last old request start null, last old response null; sustained target routing over 60 s: yes. Boundary: 2026-10-12T15:55:59.578Z (route marker (data-dpl-id)).
- Identity guard through https://opensetlist-6l87uqc8o-opensetlist-projects.vercel.app: ok (1762 ms, 1 attempt(s), started 1 ms after the file completed).
- Saves: 1.0 put P-20s 200 rev 1720 396 ms (late 6, cliEnd-22.5 s); 1.1 put P-1s 200 rev 1721 400 ms (late 12, cliEnd-3.5 s); 1.2 put P+1s 200 rev 1722 352 ms (late 7, cliEnd-1.5 s); 1.3 put P+5s 200 rev 1723 379 ms (late 10, cliEnd+2.5 s); 1.4 put P+11s 200 rev 1724 366 ms (late -1, cliEnd+8.5 s); 1.5 put P+15s 200 rev 1725 370 ms (late 11, cliEnd+12.5 s).

| check (continuity) | value | verdict |
|---|---|---|
| every planned save 2xx (never retried) | 6/6 | **PASS** |
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
| 1.0 | put | 1720 | 853 (3) / 0 | 181 (4) / 0 | 1105 (2) / 0 | — (0) / 0 | — | 3 / 3 | 2 / 2 | {"satisfied-first-fetch":3,"initial":4,"(superseded)":4} |
| 1.1 | put | 1721 | 1101 (3) / 0 | 181 (4) / 0 | 959 (2) / 0 | 0 (2) / 0 | — | 3 / 3 | 2 / 2 | {"satisfied-first-fetch":3,"initial":4,"(superseded)":4} |
| 1.2 | put | 1722 | 1054 (3) / 0 | 181 (4) / 0 | 948 (2) / 0 | 0 (2) / 0 | — | 3 / 3 | 2 / 2 | {"satisfied-first-fetch":3,"initial":4,"(superseded)":4} |
| 1.3 | put | 1723 | 950 (3) / 0 | 181 (4) / 0 | 1036 (2) / 0 | 0 (2) / 0 | — | 3 / 3 | 2 / 2 | {"satisfied-first-fetch":3,"initial":4,"(superseded)":2} |
| 1.4 | put | 1724 | 1071 (5) / 0 | 181 (2) / 0 | 850 (2) / 0 | 160 (2) / 0 | — | 5 / 5 | 2 / 2 | {"satisfied-first-fetch":5,"initial":2,"(superseded)":2} |
| 1.5 | put | 1725 | 959 (5) / 0 | 181 (2) / 0 | 999 (4) / 0 | — (0) / 0 | — | 5 / 5 | 4 / 4 | {"satisfied-first-fetch":5,"initial":2,"(superseded)":2} |

- Performance: every save × population p95 ≤ the gate.
- Exposure (provisional boundary): pending hinted fetch 0 (≥ 20) → NOT EXERCISED; old answer after cutover, converged without regression: natural 0/0, hold 1/1 (≥ 5) → NOT EXERCISED; arrival saves 1.4 (P+11): SDK unjoined 0, pages incomplete 0; 1.5 (P+15): SDK unjoined 0, pages incomplete 0.
- Hold subset: armed 2026-10-12T15:55:55.142Z, triggers P-1s 1, P+1s 0, P+3s 0, released 2026-10-12T15:55:59.793Z (target+200ms); 1 response(s) held; held → deadline 0.
- Arrivals r1-1 (R1 cohort) at 2026-10-12T15:56:06.637Z: pages 2 (builds {"r2":2}), time to usable (later of complete setlist and readiness) p50 / p95 / max 1125 / 1239 / 1239 ms, wave 0 p95 1239, unusable 0; SDK 2, first snapshot p50 / p95 320 / 394 ms, without 0.
- Reaction / wish smoke (old pages): p0 ja: reaction 200, wish 403 → ok; p1 ko: reaction 200, wish 403 → ok.
- Pins: SDK 0/62 requests pinned, page API 0/31, probe 0; framework assets after the switch 60 (pinned 60, 404 0) — "no chunk 404 after the switch": holds for the assets fetched. Update gaps (natural SDK, max interval between successful responses in the window) p50 / max 14923 / 18048 ms.

### Switch 2 — smoke pseudo-switch (return-from-r1)

- File `s3b.json` seen 2026-10-12T15:56:12.014Z (notice 175.0 s), complete 2026-10-12T15:56:54.697Z; target https://opensetlist-6l87uqc8o-opensetlist-projects.vercel.app; baseline dpl_FAt2Sp33CvHnRohZyHkH5bUHZ4X5.
- Live routing (route marker): first target 2026-10-12T15:56:54.635Z (pseudo: first marker started after cliEnd); last old request start null, last old response null; sustained target routing over 60 s: yes. Boundary: 2026-10-12T15:56:54.635Z (route marker (data-dpl-id)).
- Identity guard through https://opensetlist-6l87uqc8o-opensetlist-projects.vercel.app: ok (1572 ms, 1 attempt(s), started 0 ms after the file completed).
- Saves: 2.0 put P-20s 200 rev 1726 418 ms (late 7, cliEnd-22.5 s); 2.1 put P-1s 200 rev 1727 989 ms (late 2, cliEnd-3.5 s); 2.2 put P+1s 200 rev 1728 346 ms (late 13, cliEnd-1.5 s); 2.3 put P+5s 200 rev 1729 347 ms (late 11, cliEnd+2.5 s); 2.4 put P+11s 200 rev 1730 340 ms (late 3, cliEnd+8.5 s); 2.5 put P+15s 200 rev 1731 352 ms (late 13, cliEnd+12.5 s); 2.6-insert insert P+20s 200 rev 1732 475 ms (late 11, cliEnd+17.5 s); 2.7-update update P+25s 200 rev 1733 378 ms (late 9, cliEnd+22.5 s); 2.8-delete delete P+30s 200 rev 1734 344 ms (late 5, cliEnd+27.5 s).

| check (continuity) | value | verdict |
|---|---|---|
| every planned save 2xx (never retried) | 9/9 | **PASS** |
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
| 2.0 | put | 1726 | 1101 (5) / 0 | 181 (2) / 0 | 1008 (4) / 0 | — (0) / 0 | — | 5 / 5 | 4 / 4 | {"satisfied-first-fetch":5,"initial":2,"(superseded)":2} |
| 2.1 | put | 1727 | 1623 (5) / 0 | 181 (2) / 0 | 1681 (4) / 0 | 0 (1) / 0 | — | 5 / 5 | 4 / 4 | {"satisfied-first-fetch":5,"initial":2,"(superseded)":2} |
| 2.2 | put | 1728 | 1075 (5) / 0 | 181 (2) / 0 | 1067 (4) / 0 | 0 (1) / 0 | — | 5 / 5 | 4 / 4 | {"satisfied-first-fetch":5,"initial":2,"(superseded)":2} |
| 2.3 | put | 1729 | 939 (5) / 0 | 181 (2) / 0 | 976 (4) / 0 | 0 (1) / 0 | — | 5 / 5 | 4 / 4 | {"satisfied-first-fetch":5,"initial":2} |
| 2.4 | put | 1730 | 1025 (7) / 0 | — (0) / 0 | 1058 (4) / 0 | 975 (1) / 0 | — | 7 / 7 | 4 / 4 | {"satisfied-first-fetch":7} |
| 2.5 | put | 1731 | 1026 (7) / 0 | — (0) / 0 | 956 (5) / 0 | — (0) / 0 | — | 7 / 7 | 5 / 5 | {"satisfied-first-fetch":7} |
| 2.6-insert | insert | 1732 | 1157 (7) / 0 | — (0) / 0 | — | — | 1111 (5) / 0 | 7 / 7 | 5 / 5 | {"satisfied-first-fetch":7} |
| 2.7-update | update | 1733 | 1109 (7) / 0 | — (0) / 0 | 1106 (5) / 0 | — (0) / 0 | — | 7 / 7 | 5 / 5 | {"satisfied-first-fetch":7} |
| 2.8-delete | delete | 1734 | 1000 (7) / 0 | — (0) / 0 | — | — | 1035 (5) / 0 | 7 / 7 | 5 / 5 | {"satisfied-first-fetch":7} |

- Performance: every save × population p95 ≤ the gate.
- Exposure (provisional boundary): pending hinted fetch 0 (≥ 20) → NOT EXERCISED; pending recheck 0 (queued 0, dispatched 0; ≥ 5) → NOT EXERCISED; old answer after cutover, converged without regression: natural 0/0, hold 1/1 (≥ 5) → NOT EXERCISED; arrival saves 2.4 (P+11): SDK unjoined 0, pages incomplete 0; 2.5 (P+15): SDK unjoined 0, pages incomplete 0.
- Hold subset: armed 2026-10-12T15:56:50.147Z, triggers P-1s 1, P+1s 0, P+3s 0, released 2026-10-12T15:56:54.845Z (target+200ms); 1 response(s) held; held → deadline 0.
- Ahead-hint subset: synthetic rev 1731 (P-1.2s 1/1 news); at P 0 ticket(s) queued for a recheck.
- Arrivals arrival-2 at 2026-10-12T15:57:01.657Z: pages 1 (builds {"r2":1}), time to usable (later of complete setlist and readiness) p50 / p95 / max 932 / 932 / 932 ms, wave 0 p95 932, unusable 0; SDK 2, first snapshot p50 / p95 273 / 369 ms, without 0.
- Reaction / wish smoke (old pages): p0 ja: reaction 200, wish 403 → ok; p1 ko: reaction 200, wish 403 → ok.
- Pins: SDK 0/111 requests pinned, page API 0/60, probe 0; framework assets after the switch 20 (pinned 20, 404 0) — "no chunk 404 after the switch": holds for the assets fetched. Update gaps (natural SDK, max interval between successful responses in the window) p50 / max 17575 / 19422 ms.

## Gate verdicts

Latency = save (the PUT that makes the marker exist; in a pair edit the insert-after came before it) request start of its FIRST attempt → marker link in the page DOM / SDK client applied a snapshot with rev ≥ the PUT's rev. Missing = not seen within the timeout. Monotonic: no page/client ever went back to an older version.

| Scope | n | p50 ms | p95 ms | max ms | missing | gate | verdict |
|---|---|---|---|---|---|---|---|
| all pairs (pages + SDK) | 151 | 929 | 9669 | 11830 | 31 | p95 ≤ 3000, 0 missing | n/a |
| edit × page | 50 | 886 | 5555 | 5871 | 15 | same | n/a |
| edit × SDK client | 101 | 939 | 9729 | 11830 | 16 | same | n/a |
| monotonic DOM (pages: version shown never decreases) | 5 pages, 55 versions | — | — | — | 0 regressions on 0 page(s) | 0 | **PASS** |
| monotonic applied rev (SDK) | 9 clients, 207 applies | — | — | — | 0 regressions on 0 client(s) | 0 | **PASS** |
| warming: warm hits ÷ hinted fetches (`x-snapshot-source: warm`) | SDK 112/114 (98.2 %), pages 59/59 (100.0 %) | — | — | — | — | informational; reader builds per save: `vercel-logs-summary.mjs` "Warming" on the history logs; arrival vs warm-complete: `warm-join.mjs` | n/a |
| edits with a retried save (clock from the 1st attempt) | 0 | — | — | — | 0 | informational — 0 edit(s); from the successful attempt p50/p95/max —/—/— | n/a |

Insert-start based (insert-after request start → marker; pair edits only), non-drilled: pages 5 | 5869 | 6104 | 6104 · SDK 9 | 5839 | 6107 | 6107 (n | p50 | p95 | max).

## Notification paths (PUT start → arrival)

An R1 page build (what the preview runs until R2 deploys, or after a rollback) is notified by postgres_changes and ignores the broadcast; an R2 build only has the broadcast. The SDK clients are always R2.

| Path | delivered / expected | p50 ms | p95 ms | max ms |
|---|---|---|---|---|
| postgres_changes UPDATE → pages (R1 build) | 0 / 65 | — | — | — |
| broadcast `rev` → pages | 47 / 65 | 412 | 1014 | 1016 |
| broadcast `rev` → SDK | 89 / 117 | 416 | 1013 | 1023 |

## Per edit

| # | mode | row | marker song | insert start (UTC) | ins ms | rev | save (PUT) start (UTC) | save ms | save rev |
|---|---|---|---|---|---|---|---|---|---|
| 1.0 | transition | 2516 | 1997 LOVE♡YOU♡Save the EARTH!! | — | — | — | 2026-10-12T15:55:36.638Z | 396 | 1720 |
| 1.1 | transition | 2516 | 2030 Wish Song | — | — | — | 2026-10-12T15:55:55.644Z | 400 | 1721 |
| 1.2 | transition | 2516 | 2032 ノンフィクション!! | — | — | — | 2026-10-12T15:55:57.639Z | 352 | 1722 |
| 1.3 | transition | 2516 | 2033 Starlight Prologue | — | — | — | 2026-10-12T15:56:01.642Z | 379 | 1723 |
| 1.4 | transition | 2516 | 2039 だいすきのうた | — | — | — | 2026-10-12T15:56:07.631Z | 366 | 1724 |
| 1.5 | transition | 2516 | 2040 Tiny Stars | — | — | — | 2026-10-12T15:56:11.643Z | 370 | 1725 |
| 2.0 | transition | 2516 | 2041 未来は風のように | — | — | — | 2026-10-12T15:56:31.652Z | 418 | 1726 |
| 2.1 | transition | 2516 | 2044 グソクムシのうた | — | — | — | 2026-10-12T15:56:50.647Z | 989 | 1727 |
| 2.2 | transition | 2516 | 2046 未来は風のように | — | — | — | 2026-10-12T15:56:52.658Z | 346 | 1728 |
| 2.3 | transition | 2516 | 2047 未来は風のように | — | — | — | 2026-10-12T15:56:56.656Z | 347 | 1729 |
| 2.4 | transition | 2516 | 2050 未来は風のように | — | — | — | 2026-10-12T15:57:02.648Z | 340 | 1730 |
| 2.5 | transition | 2516 | 2056 私のSymphony | — | — | — | 2026-10-12T15:57:06.658Z | 352 | 1731 |
| 2.7-update | transition-after | 2517 | 2060 Primary | 2026-10-12T15:57:11.656Z | 475 | 1732 | 2026-10-12T15:57:16.654Z | 378 | 1733 |

### Per save — pages (save start → marker in the DOM)

| # | save rev | seen | p50 / p95 / max ms | missing | bcast → page p50 / p95 (n) | pg → page (n) | notification fetches (hint=1) | their x-snapshot-verify | warm / hinted | 1st hinted request start − commit p50 / p95 |
|---|---|---|---|---|---|---|---|---|---|---|
| 1.0 | 1720 | 2/5 | 968 / 1105 / 1105 | 3 | 446 / 446 (2) | 0 | 2 | satisfied 2 | 2/2 | 398 / 498 |
| 1.1 | 1721 | 2/5 | 731 / 959 / 959 | 3 | 445 / 445 (2) | 0 | 2 | satisfied 2 | 2/2 | 152 / 385 |
| 1.2 | 1722 | 2/5 | 884 / 948 / 948 | 3 | 393 / 394 (2) | 0 | 2 | satisfied 2 | 2/2 | 355 / 416 |
| 1.3 | 1723 | 4/5 | 1036 / 5871 / 5871 | 1 | 424 / 425 (2) | 0 | 2 | satisfied 2 | 2/2 | 359 / 475 |
| 1.4 | 1724 | 4/5 | 526 / 850 / 850 | 1 | 410 / 412 (4) | 0 | 2 | satisfied 2 | 2/2 | 259 / 316 |
| 1.5 | 1725 | 4/5 | 807 / 999 / 999 | 1 | 417 / 421 (4) | 0 | 4 | satisfied 4 | 4/4 | 267 / 456 |
| 2.0 | 1726 | 4/5 | 866 / 1008 / 1008 | 1 | 472 / 472 (4) | 0 | 4 | satisfied 4 | 4/4 | 273 / 407 |
| 2.1 | 1727 | 4/5 | 1536 / 1681 / 1681 | 1 | 1014 / 1016 (4) | 0 | 4 | satisfied 4 | 4/4 | 372 / 514 |
| 2.2 | 1728 | 4/5 | 807 / 1067 / 1067 | 1 | 398 / 400 (4) | 0 | 4 | satisfied 4 | 4/4 | 287 / 539 |
| 2.3 | 1729 | 5/5 | 932 / 5555 / 5555 | 0 | 395 / 395 (4) | 0 | 3 | satisfied 3 | 3/3 | 299 / 439 |
| 2.4 | 1730 | 5/5 | 803 / 1315 / 1315 | 0 | 394 / 394 (5) | 0 | 5 | satisfied 5 | 5/5 | 263 / 805 |
| 2.5 | 1731 | 5/5 | 901 / 956 / 956 | 0 | 401 / 409 (5) | 0 | 5 | satisfied 5 | 5/5 | 382 / 413 |
| 2.7-update | 1733 | 5/5 | 871 / 1106 / 1106 | 0 | 429 / 429 (5) | 0 | 5 | satisfied 5 | 5/5 | 326 / 524 |

### Per save — SDK clients (save start → applied rev ≥ save rev)

| # | save rev | reached | p50 / p95 / max ms | missing | bcast → SDK p50 / p95 (n) | notification fetches | their x-snapshot-verify | ticket resolutions | rechecks (resolved) | exhausted | warm / hinted | 1st hinted send − commit p50 / p95 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1.0 | 1720 | 5/9 | 853 / 1063 / 1063 | 4 | 444 / 449 (5) | 5 | satisfied 5 | satisfied 5 | 0 (0) | 0 | 5/5 | 296 / 456 |
| 1.1 | 1721 | 7/9 | 1101 / 11830 / 11830 | 2 | 443 / 456 (5) | 4 | satisfied 4 | satisfied 5 | 0 (0) | 0 | 4/4 | 288 / 536 |
| 1.2 | 1722 | 7/9 | 1054 / 9835 / 9835 | 2 | 395 / 395 (5) | 5 | satisfied 5 | satisfied 5 | 0 (0) | 0 | 5/5 | 380 / 1817 |
| 1.3 | 1723 | 7/9 | 980 / 5832 / 5832 | 2 | 422 / 427 (5) | 5 | satisfied 5 | satisfied 5 | 0 (0) | 0 | 5/5 | 368 / 414 |
| 1.4 | 1724 | 7/9 | 843 / 1071 / 1071 | 2 | 409 / 411 (7) | 7 | satisfied 7 | satisfied 7 | 0 (0) | 0 | 7/7 | 318 / 549 |
| 1.5 | 1725 | 7/9 | 873 / 959 / 959 | 2 | 416 / 428 (7) | 7 | satisfied 7 | satisfied 7 | 0 (0) | 0 | 7/7 | 313 / 405 |
| 2.0 | 1726 | 7/9 | 986 / 1101 / 1101 | 2 | 471 / 472 (7) | 7 | satisfied 7 | satisfied 7 | 0 (0) | 0 | 7/7 | 357 / 515 |
| 2.1 | 1727 | 9/9 | 1585 / 11719 / 11719 | 0 | 1014 / 1023 (7) | 6 | satisfied 6 | satisfied 6 | 0 (0) | 0 | 5/6 | 87 / 478 |
| 2.2 | 1728 | 9/9 | 1061 / 9708 / 9708 | 0 | 397 / 404 (7) | 7 | satisfied 7 | satisfied 7 | 0 (0) | 0 | 7/7 | 414 / 1846 |
| 2.3 | 1729 | 9/9 | 844 / 5710 / 5710 | 0 | 394 / 395 (7) | 7 | satisfied 7 | satisfied 7 | 0 (0) | 0 | 7/7 | 246 / 432 |
| 2.4 | 1730 | 9/9 | 921 / 1025 / 1025 | 0 | 392 / 394 (9) | 9 | satisfied 9 | satisfied 9 | 0 (0) | 0 | 9/9 | 364 / 489 |
| 2.5 | 1731 | 9/9 | 935 / 1026 / 1026 | 0 | 399 / 400 (9) | 10 | satisfied 9, fresh 1 | satisfied 9, disproved 1 | 0 (0) | 0 | 9/10 | 414 / 507 |
| 2.7-update | 1733 | 9/9 | 841 / 1109 / 1109 | 0 | 427 / 430 (9) | 9 | satisfied 9 | satisfied 9 | 0 (0) | 0 | 9/9 | 259 / 557 |

## Hint outcomes (whole run)

- SDK: 208 requests; notification fetches (hint=1) 114, their x-snapshot-verify: satisfied 113, fresh 1; all 200 responses: none 9, satisfied 198, fresh 1
  - ticket resolutions: satisfied 114, disproved 1; rechecks 0 (0.0 % of notification fetches), resolved on the recheck 0; hints exhausted 0; highest serverRev held 1735
  - request shapes (reason / generic / ticket): initial generic 9, catchup generic 9, periodic generic 74, notification +hint=1 114, resume generic +H 1, resume generic 1; failures by kind: —
  - notification fetches by x-snapshot-source: warm 112, build 1, cache 1 (warm 112/114 (98.2 %))
- Pages: 106 /api/setlist responses; notification fetches (hint=1) 59, their x-snapshot-verify: satisfied 59; all 200 responses: satisfied 106 (an R1 page build sends no hint=1)
  - notification fetches by x-snapshot-source: warm 59 (warm 59/59 (100.0 %))

## Measurement validity (load host)

Event-loop lag = how late a 100 ms interval tick ran, per thread, inside the measurement window 2026-10-12T15:54:03.415Z → 2026-10-12T15:58:02.635Z (p50 = median of the 10 s buckets' p50, p95 / p99 / max = the worst bucket). Heartbeats: one per second per worker, from its own loop. Deadline timers: fired − armed − 8,000 ms for every SDK request that hit the 8 s deadline. INVALID if any lag sample > 1000 ms or any heartbeat gap > 3000 ms.

| thread | lag p50 / p95 / p99 / max ms | samples > 1 s | heartbeats (max gap ms) | deadline timers fired: n, late p50 / p95 / max ms |
|---|---|---|---|---|
| main | 9 / 13 / 27 / 27 | 0 | — | — |
| worker 0 | 9 / 11 / 16 / 16 | 0 | 222 (1101) | 0, — / — / — |
| worker 1 | 9 / 12 / 15 / 15 | 0 | 222 (1101) | 0, — / — / — |
| worker 2 | 9 / 11 / 14 / 14 | 0 | 221 (1102) | 0, — / — / — |
| worker 3 | 9 / 11 / 14 / 14 | 0 | 108 (1096) | 0, — / — / — |
| worker 4 | 9 / 11 / 12 / 12 | 0 | 58 (1096) | 0, — / — / — |

Verdict: valid.

Host (1 s samples; 12 logical cores, 65370 MB): host CPU = busy share of all cores; process CPU = this process (main + SDK workers) as a share of all cores; Chromium is in the host figure only. load1 is always 0 on Windows.

| phase | s | host CPU p50 / max % | process CPU p50 / max % | RSS max MB | free mem min MB | load1 max | threads |
|---|---|---|---|---|---|---|---|
| join | 3.2 | 16.2 / 22.6 | 4.2 / 8.6 | 256 | 36490 | 0 | 4 |
| settle | 20.0 | 10.6 / 23.1 | 0 / 3.1 | 238 | 36418 | 0 | 4 |
| edits | 216.0 | 10.2 / 39.3 | 0.4 / 5.3 | 411 | 36030 | 0 | 6 |

## Population

- Pages: 5/5 loaded; channel joined 5; visibility {"visible":5}; locales {"ja":3,"ko":1,"en":1}
  - open → join ms: n=5 p50=1325 p95=2779 max=2779
  - /api/setlist responses seen: 106 ({"build":18,"cache":29,"warm":59}); page errors: 0; ws opens 5, closes 0; rev broadcasts seen 62; dropped notification frames 0, blocked attempts 0
- SDK: 9/9 joined; all joined after 3.202 s (from population start)
  - subscribe → SUBSCRIBED ms: n=9 p50=248 p95=283 max=283
  - statuses {"SUBSCRIBED":9,"CLOSED":9}; disconnected episodes (polling while realtime-js rejoins) 0; channel re-creations 0; fetch failures 0 (with Retry-After 0); fetches by reason {"initial":9,"catchup":9,"periodic":74,"notification":114,"resume":2}; X-Snapshot-Source {"cache":71,"warm":112,"build":25}

## Clean-up

- Soft-deleted 1/1 created rows; position restore: null
- Verify: {"dbActive":23,"snapshotItems":23,"snapshotRev":1735,"startRows":23,"goneMeanwhile":0,"sameOrder":true,"samePositions":false,"oursStillActive":[]} (samePositions is expected to be false without --restore-positions: insert-after shifted rows below the insertion point and soft-delete does not compact)
