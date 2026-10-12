# Step 6 transition join — step6-T1

- Inputs: 2026-10-12T18-00-30-749Z-browsers-transition.json, dpl_FAt2Sp33CvHnRohZyHkH5bUHZ4X5=logs-step6-T1-dpl_FAt2Sp33CvHnRohZyHkH5bUHZ4X5.jsonl,dpl_7H9E2oNx1gkv9VX2CZzKeCtFB73e=logs-step6-T1-dpl_7H9E2oNx1gkv9VX2CZzKeCtFB73e.jsonl,dpl_F5VocFcajvm1wf2aFqdMaBNhHvaK=logs-step6-T1-dpl_F5VocFcajvm1wf2aFqdMaBNhHvaK.jsonl, switch-T1-1.json,switch-T1-2.json,switch-T1-3.json, step6-manifest-T1.json
- Base https://opensetlist-git-dev-opensetlist-projects.vercel.app; run 2026-10-12T17:49:01.710Z → 2026-10-12T18:00:29.670Z
- Clocks: harness, switch files (CLI start / end) and smoke = this laptop; log `timestamp` = Vercel edge arrival; writer `at` = the function. Propagation bounds use harness times only. Record − harness request start over 29874 matched responses: p5 -22 / p50 -18 / p95 870 ms (min -5954, max 2215) — one-way latency plus clock offset; bounds closer than this spread are indeterminate.

## Deployments (manifest)

| id | role | kind | commit | LIVE_WARM_ENTRIES | url |
|---|---|---|---|---|---|
| dpl_FAt2Sp33CvHnRohZyHkH5bUHZ4X5 | ON-A | ON | dev HEAD (alias) | 1 | https://opensetlist-6l87uqc8o-opensetlist-projects.vercel.app |
| dpl_8qRfFMK5uKUcPPh9kSqeurcYR3gp | ON-Ap | ON | 5475bf2 | 1 | https://opensetlist-j3su3g2p0-opensetlist-projects.vercel.app |
| dpl_7H9E2oNx1gkv9VX2CZzKeCtFB73e | OFF-1 | OFF | 5475bf2 | 0 | https://opensetlist-fvbdesrew-opensetlist-projects.vercel.app |
| dpl_8yTfqrJL7ZxtgtGv7K2AvxXp8NKS | OFF-1t | OFF | 5475bf2 | 0 | https://opensetlist-fz4puazfz-opensetlist-projects.vercel.app |
| dpl_F5VocFcajvm1wf2aFqdMaBNhHvaK | ON-B | ON | 5475bf2 | 1 | https://opensetlist-8kis2jv91-opensetlist-projects.vercel.app |
| dpl_5nR6mGHXsx2z1TsgChikER9ZHB5q | ON-C | ON | 5475bf2 | 1 | https://opensetlist-e7i9t0p57-opensetlist-projects.vercel.app |
| dpl_GN57F4UStRok7DRsu9bJ4bn7Yzcd | R1-1 | R1 | 385e5f0 |  | https://opensetlist-meqyujqe8-opensetlist-projects.vercel.app |
| dpl_AYZRKimPsQgFqprm1U61Yio5jEEJ | R1-1t | R1 | 385e5f0 |  | https://opensetlist-btb4zk5cq-opensetlist-projects.vercel.app |

## Attribution

Request attribution = request id matched to a log record whose deployment / path / status / method agree with the response. Function instrumentation = the record also carries the lines the serving deployment must log (2xx save → `[liveWriter]`; hinted read on an R2 deployment → `[setlist] hint-fetch`).

Exported log windows (inferred from the records (union, 30 s gaps)): 17:50:33.027 → 17:52:27.993; 17:54:33.000 → 17:56:27.949; 17:58:33.026 → 18:00:28.000. Responses whose edge request time (from the request id) lies outside them are **not exported** (11691) — counted apart, outside every other column; coverage is over the exported windows only.
Incomplete log records (responseStatusCode 0, empty environment / cache, no nested lines; attributed by id / deployment / path, status not compared): 6 — sdk 38 6nzdl-1791827764444-9276278766f0 (client saw 200); sdk 237 lvdhc-1791827771131-6efc7e1f5d12 (client saw 200); sdk 416 mk55s-1791827725265-758691e0b1fc (client saw 200); sdk 597 bbnvv-1791827765123-e7631cbbb205 (client saw 200); sdk 647 mk55s-1791827724868-d56c84ec58d6 (client saw 200); page page-4 sb5hn-1791827923648-31fa5779fc38 (client saw 200).

| population | not exported | responses (in windows) | with request id | matched | consistent (coverage) | inconsistent | unmatched | instrumentation (expected → present) | by deployment |
|---|---|---|---|---|---|---|---|---|---|
| document | 30 | 30 | 30 | 30 | 30 (100.0 %) | 0 | 0 | — | dpl_7H9E2oNx1gkv9VX2CZzKeCtFB73e 12, dpl_FAt2Sp33CvHnRohZyHkH5bUHZ4X5 9, dpl_F5VocFcajvm1wf2aFqdMaBNhHvaK 9 |
| guard | 0 | 3 | 3 | 3 | 3 (100.0 %) | 0 | 0 | — | dpl_7H9E2oNx1gkv9VX2CZzKeCtFB73e 1, dpl_FAt2Sp33CvHnRohZyHkH5bUHZ4X5 1, dpl_F5VocFcajvm1wf2aFqdMaBNhHvaK 1 |
| page | 750 | 1933 | 1933 | 1933 | 1933 (100.0 %) | 0 | 0 | 1107 → 1107 | dpl_FAt2Sp33CvHnRohZyHkH5bUHZ4X5 845, dpl_7H9E2oNx1gkv9VX2CZzKeCtFB73e 527, dpl_F5VocFcajvm1wf2aFqdMaBNhHvaK 561 |
| probe | 304 | 340 | 340 | 340 | 340 (100.0 %) | 0 | 0 | 340 → 340 | dpl_FAt2Sp33CvHnRohZyHkH5bUHZ4X5 162, dpl_7H9E2oNx1gkv9VX2CZzKeCtFB73e 115, dpl_F5VocFcajvm1wf2aFqdMaBNhHvaK 63 |
| route | 1 | 485 | 485 | 485 | 485 (100.0 %) | 0 | 0 | — | dpl_FAt2Sp33CvHnRohZyHkH5bUHZ4X5 196, dpl_7H9E2oNx1gkv9VX2CZzKeCtFB73e 162, dpl_F5VocFcajvm1wf2aFqdMaBNhHvaK 127 |
| save | 0 | 24 | 24 | 24 | 24 (100.0 %) | 0 | 0 | 24 → 24 | dpl_FAt2Sp33CvHnRohZyHkH5bUHZ4X5 12, dpl_7H9E2oNx1gkv9VX2CZzKeCtFB73e 7, dpl_F5VocFcajvm1wf2aFqdMaBNhHvaK 5 |
| sdk | 9872 | 25376 | 25376 | 25376 | 25376 (100.0 %) | 0 | 0 | 14854 → 14854 | dpl_FAt2Sp33CvHnRohZyHkH5bUHZ4X5 10828, dpl_7H9E2oNx1gkv9VX2CZzKeCtFB73e 7352, dpl_F5VocFcajvm1wf2aFqdMaBNhHvaK 7196 |
| sdk/ahead | 367 | 850 | 850 | 850 | 850 (100.0 %) | 0 | 0 | 504 → 504 | dpl_FAt2Sp33CvHnRohZyHkH5bUHZ4X5 379, dpl_7H9E2oNx1gkv9VX2CZzKeCtFB73e 276, dpl_F5VocFcajvm1wf2aFqdMaBNhHvaK 195 |
| sdk/hold | 367 | 806 | 806 | 806 | 806 (100.0 %) | 0 | 0 | 406 → 406 | dpl_FAt2Sp33CvHnRohZyHkH5bUHZ4X5 349, dpl_7H9E2oNx1gkv9VX2CZzKeCtFB73e 260, dpl_F5VocFcajvm1wf2aFqdMaBNhHvaK 197 |
| smoke | 0 | 27 | 27 | 27 | 27 (100.0 %) | 0 | 0 | — | dpl_7H9E2oNx1gkv9VX2CZzKeCtFB73e 9, dpl_FAt2Sp33CvHnRohZyHkH5bUHZ4X5 9, dpl_F5VocFcajvm1wf2aFqdMaBNhHvaK 9 |
| ALL | 11691 | 29874 | 29874 | 29874 | 29874 (100.0 %) | 0 | 0 | 17235 → 17235 | dpl_FAt2Sp33CvHnRohZyHkH5bUHZ4X5 12790, dpl_7H9E2oNx1gkv9VX2CZzKeCtFB73e 8721, dpl_F5VocFcajvm1wf2aFqdMaBNhHvaK 8363 |

| deployment | log records | matched responses | consistent | first record | last record |
|---|---|---|---|---|---|
| dpl_FAt2Sp33CvHnRohZyHkH5bUHZ4X5 | 13333 | 12790 | 12790 | 2026-10-12T17:50:33.027Z | 2026-10-12T17:59:45.147Z |
| dpl_7H9E2oNx1gkv9VX2CZzKeCtFB73e | 9036 | 8721 | 8721 | 2026-10-12T17:51:17.245Z | 2026-10-12T17:59:44.868Z |
| dpl_F5VocFcajvm1wf2aFqdMaBNhHvaK | 8619 | 8363 | 8363 | 2026-10-12T17:59:17.675Z | 2026-10-12T18:00:28.000Z |

Pin evidence per population (request-side): `x-deployment-id` header / `__vdpl` cookie / `dpl` query / none.

| population | n | header | cookie | query | none |
|---|---|---|---|---|---|
| probe | 644 | 0 | 0 | 0 | 644 |
| route | 486 | 0 | 0 | 0 | 486 |
| guard | 3 | 0 | 0 | 0 | 3 |
| smoke | 27 | 0 | 0 | 0 | 27 |
| save | 24 | 0 | 0 | 0 | 24 |
| sdk | 37638 | 0 | 0 | 0 | 37638 |
| page | 2683 | 0 | 0 | 0 | 2683 |
| document | 60 | 0 | 0 | 0 | 60 |

## switch 1 (off): dpl_FAt2Sp33CvHnRohZyHkH5bUHZ4X5 → dpl_7H9E2oNx1gkv9VX2CZzKeCtFB73e

- planned 2026-10-12T17:51:13.000Z; CLI 17:51:13.058 → 17:51:16.824 (3766 ms, CPU 242 ms); target https://opensetlist-fvbdesrew-opensetlist-projects.vercel.app

### Propagation — **EXERCISED**

| population | requests | → target | → old | → other | unmatched (in windows) | not exported | first target response (start → end) | last old request start | last old response end | old starts after cliStart |
|---|---|---|---|---|---|---|---|---|---|---|
| probe | 125 | 69 | 41 | 0 | 0 | 15 | 17:51:19.951 → 17:51:20.363 | 17:51:20.946 | 17:51:21.314 | 6 |
| route | 162 | 130 | 32 | 0 | 0 | 0 | 17:51:18.011 → 17:51:20.356 | 17:51:20.012 | 17:51:20.479 | 11 |
| sdk | 7485 | 4584 | 2507 | 0 | 0 | 394 | 17:51:19.278 → 17:51:19.603 | 17:51:27.168 | 17:51:28.314 | 780 |
| page | 494 | 307 | 157 | 0 | 0 | 30 | 17:51:18.272 → 17:51:20.379 | 17:51:24.639 | 17:51:24.810 | 52 |
| document | 10 | 10 | 0 | 0 | 0 | 0 | 17:51:27.109 → 17:51:27.109 | — | — | 0 |
| all | 8276 | 5100 | 2737 | 0 | 0 | 439 | 17:51:19.278 → 17:51:19.603 | 17:51:27.168 | 17:51:28.314 | 849 |

- Sustained target routing over [cliEnd, cliEnd + 60 s] (probe): **no** — 60 probe request(s), off-target after the first target probe 1 (17:51:20.946 → dpl_FAt2Sp33CvHnRohZyHkH5bUHZ4X5; mixed routing for 995 ms after the first target probe), steady on the target from 17:51:21.957 (cliEnd +5133 ms), largest probe gap 1015 ms.
- Harness provisional (live data-dpl-id route marker, no logs) — replaced by the bounds above: boundary 17:51:20.356 (route marker (data-dpl-id)); first target live 17:51:18.011 → 17:51:20.356 (marker served by the target id); routing sustained false, in window 121, off-target 2, last old start 17:51:20.012, last old response 17:51:20.479. Log-attributed first target response (all alias populations): 17:51:19.603 (-753 ms vs the harness boundary).
- Harness verdicts: {"continuity":"PASS","performance":"FAIL","arrivals":"FAIL","smoke":"PASS","guard":"PASS"}; exposure {"pendingHinted":"NOT EXERCISED","oldAnswer":"EXERCISED","arrivalSdk":"NOT EXERCISED","arrivalPages":"EXERCISED"}

### Exposure (first attributed target response 17:51:19.603)

| exposure | measured | min | result | detail |
|---|---|---|---|---|
| pending hinted fetch (natural SDK) | 0 clients | 20 | **NOT EXERCISED** | 0 req; old-attributed 0, unmatched 0; after T: headers 0, body 0, eval 0, settled 0; subsets {"hold":11} |
| pending recheck (controlled) | 0 clients | 5 | **NOT EXERCISED** | queued 0, dispatched 0 (recheck responses of the controlled subset) |
| old answer after cutover → converged | 201 / 202 clients | 5 | **EXERCISED** | natural 179, controlled 22; regression check: n/a here (no appliedAll in the client records; the harness's monotonicity check covers it) |
| arrival save rev 1778 (+11 s) SDK | 0 / 100 not joined at PUT response | 20 | **NOT EXERCISED** | |
| arrival save rev 1778 pages | 5 / 10 incomplete | 3 | **EXERCISED** | |
| arrival save rev 1779 (+15 s) SDK | 0 / 100 not joined at PUT response | 20 | **NOT EXERCISED** | |
| arrival save rev 1779 pages | 5 / 10 incomplete | 3 | **EXERCISED** | |

### Target role evidence — OFF absence: **PASS**

- manifest role OFF-1, LIVE_WARM_ENTRIES 0; 9036 log record(s) for the deployment
- saves in the leg 8: served by the target 4 (with writer line 4), not attributed 0; hinted reads 4364, not attributed inside the exported windows 0, outside them 15
- saves → serving deployment: put -30s rev 1774 → dpl_FAt2Sp33CvHnRohZyHkH5bUHZ4X5 ✓writer; put -1s rev 1775 → dpl_FAt2Sp33CvHnRohZyHkH5bUHZ4X5 ✓writer; put 1s rev 1776 → dpl_FAt2Sp33CvHnRohZyHkH5bUHZ4X5 ✓writer; put 5s rev 1777 → dpl_FAt2Sp33CvHnRohZyHkH5bUHZ4X5 ✓writer; put 11s rev 1778 → dpl_7H9E2oNx1gkv9VX2CZzKeCtFB73e ✓writer; put 15s rev 1779 → dpl_7H9E2oNx1gkv9VX2CZzKeCtFB73e ✓writer; put 30s rev 1780 → dpl_7H9E2oNx1gkv9VX2CZzKeCtFB73e ✓writer; put 60s rev 1781 → dpl_7H9E2oNx1gkv9VX2CZzKeCtFB73e ✓writer
- `[liveWarm] start` 0; any `[liveWarm]` 0; warm-lookup lines 0; `source=warm` responses 0; responses with a verify header 8531

### Drain — old deployment dpl_FAt2Sp33CvHnRohZyHkH5bUHZ4X5 after 17:51:19.603

- requests after 202; last request 17:51:27.148; last pool line 17:51:27.148. An instance that stops logging has not necessarily closed its pooler connections (the estimator only sees log lines).

| +s | requests | pool lines | max pool total | instances logging pool |
|---|---|---|---|---|
| +0 | 202 | 41 | 2 | 6 |

### Continuity / performance per save and SDK group

Eligible = subscribed by the first save attempt; continuity = every eligible client at ≥ rev within 30 s of it (proposed operational acceptance); performance = p95 ≤ 3 s (kept visible). Joined-after clients are timed from max(join, PUT response).

| save rev | label | group | eligible | p50 / p95 / max ms | missing @30 s | continuity | p95 ≤ 3 s | joined after p95 / missing | not joined | broadcast received / pop. | applying fetch reasons | regressions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1774 | put -30s | incumbent | 430 | 1460 / 1917 / 2048 | 0 | PASS | PASS | — / 0 | 0 | 430 / 430 | {"notification":420,"periodic":10} | — |
| 1774 | put -30s | hold | 20 | 1449 / 1723 / 1899 | 0 | PASS | PASS | — / 0 | 0 | 20 / 20 | {"notification":20} | — |
| 1774 | put -30s | ahead | 20 | 1298 / 1671 / 1740 | 0 | PASS | PASS | — / 0 | 0 | 20 / 20 | {"notification":20} | — |
| 1775 | put -1s | incumbent | 430 | 1468 / 1838 / 1886 | 0 | PASS | PASS | — / 0 | 0 | 430 / 430 | {"notification":425,"periodic":5} | — |
| 1775 | put -1s | hold | 20 | 8554 / 9756 / 9921 | 0 | PASS | FAIL | — / 0 | 0 | 20 / 20 | {"resume":6,"notification":13,"retry":1} | — |
| 1775 | put -1s | ahead | 20 | 1499 / 1744 / 1758 | 0 | PASS | PASS | — / 0 | 0 | 20 / 20 | {"notification":20} | — |
| 1775 | put -1s | arrival-1 | 0 | — / — / — | 0 | n/a | n/a | 2286 / 0 | 0 | 0 / 100 | {"initial":100} | — |
| 1776 | put +1s | incumbent | 430 | 1103 / 1340 / 1555 | 0 | PASS | PASS | — / 0 | 0 | 430 / 430 | {"notification":424,"periodic":6} | — |
| 1776 | put +1s | hold | 20 | 7218 / 7755 / 7920 | 0 | PASS | FAIL | — / 0 | 0 | 20 / 20 | {"resume":13,"periodic":6,"retry":1} | — |
| 1776 | put +1s | ahead | 20 | 1097 / 1359 / 1396 | 0 | PASS | PASS | — / 0 | 0 | 20 / 20 | {"notification":20} | — |
| 1776 | put +1s | arrival-1 | 0 | — / — / — | 0 | n/a | n/a | 2286 / 0 | 0 | 0 / 100 | {"initial":100} | — |
| 1777 | put +5s | incumbent | 430 | 1471 / 3502 / 3881 | 0 | PASS | FAIL | — / 0 | 0 | 430 / 430 | {"notification":418,"periodic":12} | — |
| 1777 | put +5s | hold | 20 | 1035 / 1572 / 1737 | 0 | PASS | PASS | — / 0 | 0 | 20 / 20 | {"resume":13,"periodic":6,"retry":1} | — |
| 1777 | put +5s | ahead | 20 | 1250 / 3667 / 3903 | 0 | PASS | FAIL | — / 0 | 0 | 20 / 20 | {"periodic":2,"notification":18} | — |
| 1777 | put +5s | arrival-1 | 0 | — / — / — | 0 | n/a | n/a | 2286 / 0 | 0 | 0 / 100 | {"initial":100} | — |
| 1778 | put +11s | incumbent | 430 | 5276 / 6675 / 7174 | 0 | PASS | FAIL | — / 0 | 0 | 430 / 430 | {"notification":422,"periodic":8} | — |
| 1778 | put +11s | hold | 20 | 5370 / 6330 / 6678 | 0 | PASS | FAIL | — / 0 | 0 | 20 / 20 | {"notification":19,"periodic":1} | — |
| 1778 | put +11s | ahead | 20 | 5668 / 6734 / 6736 | 0 | PASS | FAIL | — / 0 | 0 | 20 / 20 | {"notification":20} | — |
| 1778 | put +11s | arrival-1 | 50 | 5172 / 6762 / 6880 | 0 | PASS | FAIL | 3972 / 0 | 0 | 100 / 100 | {"notification":91,"catchup":9} | — |
| 1779 | put +15s | incumbent | 430 | 3721 / 4954 / 5343 | 0 | PASS | FAIL | — / 0 | 0 | 430 / 430 | {"periodic":37,"notification":393} | — |
| 1779 | put +15s | hold | 20 | 3504 / 4859 / 5126 | 0 | PASS | FAIL | — / 0 | 0 | 20 / 20 | {"notification":19,"periodic":1} | — |
| 1779 | put +15s | ahead | 20 | 3507 / 5095 / 5268 | 0 | PASS | FAIL | — / 0 | 0 | 20 / 20 | {"notification":20} | — |
| 1779 | put +15s | arrival-1 | 100 | 3712 / 4961 / 5302 | 0 | PASS | FAIL | — / 0 | 0 | 100 / 100 | {"notification":100} | — |
| 1780 | put +30s | incumbent | 430 | 2077 / 3088 / 3507 | 0 | PASS | FAIL | — / 0 | 0 | 430 / 430 | {"notification":422,"periodic":8} | — |
| 1780 | put +30s | hold | 20 | 2032 / 3010 / 3126 | 0 | PASS | FAIL | — / 0 | 0 | 20 / 20 | {"notification":20} | — |
| 1780 | put +30s | ahead | 20 | 2061 / 2905 / 3137 | 0 | PASS | PASS | — / 0 | 0 | 20 / 20 | {"notification":19,"periodic":1} | — |
| 1780 | put +30s | arrival-1 | 100 | 2068 / 3144 / 3476 | 0 | PASS | FAIL | — / 0 | 0 | 100 / 100 | {"periodic":4,"notification":96} | — |
| 1781 | put +60s | incumbent | 430 | 1942 / 2899 / 3139 | 0 | PASS | PASS | — / 0 | 0 | 430 / 430 | {"notification":417,"periodic":13} | — |
| 1781 | put +60s | hold | 20 | 1648 / 2411 / 2642 | 0 | PASS | PASS | — / 0 | 0 | 20 / 20 | {"notification":20} | — |
| 1781 | put +60s | ahead | 20 | 1731 / 2546 / 2638 | 0 | PASS | PASS | — / 0 | 0 | 20 / 20 | {"notification":20} | — |
| 1781 | put +60s | arrival-1 | 100 | 1964 / 2903 / 3119 | 0 | PASS | PASS | — / 0 | 0 | 100 / 100 | {"notification":98,"periodic":2} | — |

### Reactions / wishes smoke from old pages

| page | locale | type | harness checks | pass | sub-requests (status → serving deployment) |
|---|---|---|---|---|---|
| 0 | ja | best | submitted ✓, persisted ✓, refreshed ✓, identityRetained ✓, wish ✓, no5xx ✓ | true | post 200 → dpl_7H9E2oNx1gkv9VX2CZzKeCtFB73e; counts 200 → dpl_7H9E2oNx1gkv9VX2CZzKeCtFB73e; wish 403 → dpl_7H9E2oNx1gkv9VX2CZzKeCtFB73e |
| 1 | ko | surprise | submitted ✓, persisted ✓, refreshed ✓, identityRetained ✓, wish ✓, no5xx ✓ | true | post 200 → dpl_7H9E2oNx1gkv9VX2CZzKeCtFB73e; counts 200 → dpl_7H9E2oNx1gkv9VX2CZzKeCtFB73e; wish 403 → dpl_7H9E2oNx1gkv9VX2CZzKeCtFB73e |
| 3 | en | moved | submitted ✓, persisted ✓, refreshed ✓, identityRetained ✓, wish ✓, no5xx ✓ | true | post 200 → dpl_7H9E2oNx1gkv9VX2CZzKeCtFB73e; counts 200 → dpl_7H9E2oNx1gkv9VX2CZzKeCtFB73e; wish 403 → dpl_7H9E2oNx1gkv9VX2CZzKeCtFB73e |

## switch 2 (return): dpl_7H9E2oNx1gkv9VX2CZzKeCtFB73e → dpl_FAt2Sp33CvHnRohZyHkH5bUHZ4X5

- planned 2026-10-12T17:55:13.000Z; CLI 17:55:13.044 → 17:55:17.035 (3991 ms, CPU 273 ms); target https://opensetlist-6l87uqc8o-opensetlist-projects.vercel.app

### Propagation — **EXERCISED**

| population | requests | → target | → old | → other | unmatched (in windows) | not exported | first target response (start → end) | last old request start | last old response end | old starts after cliStart |
|---|---|---|---|---|---|---|---|---|---|---|
| probe | 125 | 69 | 41 | 0 | 0 | 15 | 17:55:18.950 → 17:55:19.192 | 17:55:19.954 | 17:55:21.455 | 6 |
| route | 162 | 130 | 32 | 0 | 0 | 0 | 17:55:17.500 → 17:55:18.028 | 17:55:20.000 | 17:55:20.524 | 11 |
| sdk | 8900 | 5250 | 3180 | 0 | 0 | 470 | 17:55:17.160 → 17:55:17.994 | 17:55:25.519 | 17:55:26.527 | 1062 |
| page | 639 | 404 | 208 | 0 | 0 | 27 | 17:55:17.725 → 17:55:18.075 | 17:55:25.500 | 17:55:26.091 | 63 |
| document | 10 | 8 | 2 | 0 | 0 | 0 | 17:55:24.640 → 17:55:24.640 | 17:55:23.858 | 17:55:23.858 | 2 |
| all | 9836 | 5861 | 3463 | 0 | 0 | 512 | 17:55:17.160 → 17:55:17.994 | 17:55:25.519 | 17:55:26.527 | 1144 |

- Sustained target routing over [cliEnd, cliEnd + 60 s] (probe): **no** — 60 probe request(s), off-target after the first target probe 1 (17:55:19.954 → dpl_7H9E2oNx1gkv9VX2CZzKeCtFB73e; mixed routing for 1004 ms after the first target probe), steady on the target from 17:55:20.947 (cliEnd +3912 ms), largest probe gap 1013 ms.
- Harness provisional (live data-dpl-id route marker, no logs) — replaced by the bounds above: boundary 17:55:18.028 (route marker (data-dpl-id)); first target live 17:55:17.500 → 17:55:18.028 (marker served by the target id); routing sustained false, in window 120, off-target 3, last old start 17:55:20.000, last old response 17:55:20.524. Log-attributed first target response (all alias populations): 17:55:17.994 (-34 ms vs the harness boundary).
- Harness verdicts: {"continuity":"PASS","performance":"FAIL","arrivals":"FAIL","smoke":"PASS","guard":"PASS"}; exposure {"pendingHinted":"NOT EXERCISED","oldAnswer":"EXERCISED","arrivalSdk":"NOT EXERCISED","arrivalPages":"EXERCISED"}

### Exposure (first attributed target response 17:55:17.994)

| exposure | measured | min | result | detail |
|---|---|---|---|---|
| pending hinted fetch (natural SDK) | 0 clients | 20 | **NOT EXERCISED** | 0 req; old-attributed 0, unmatched 0; after T: headers 0, body 0, eval 0, settled 0; subsets {"hold":13} |
| pending recheck (controlled) | 0 clients | 5 | **NOT EXERCISED** | queued 0, dispatched 0 (recheck responses of the controlled subset) |
| old answer after cutover → converged | 386 / 387 clients | 5 | **EXERCISED** | natural 353, controlled 33; regression check: n/a here (no appliedAll in the client records; the harness's monotonicity check covers it) |
| arrival save rev 1786 (+11 s) SDK | 1 / 100 not joined at PUT response | 20 | **NOT EXERCISED** | |
| arrival save rev 1786 pages | 3 / 10 incomplete | 3 | **EXERCISED** | |
| arrival save rev 1787 (+15 s) SDK | 0 / 100 not joined at PUT response | 20 | **NOT EXERCISED** | |
| arrival save rev 1787 pages | 0 / 10 incomplete | 3 | **NOT EXERCISED** | |

### Target role evidence — ON (warming expected): **warm jobs seen**

- manifest role ON-A, LIVE_WARM_ENTRIES 1; 13333 log record(s) for the deployment
- saves in the leg 8: served by the target 5 (with writer line 5), not attributed 0; hinted reads 5243, not attributed inside the exported windows 0, outside them 15
- saves → serving deployment: put -30s rev 1782 → dpl_7H9E2oNx1gkv9VX2CZzKeCtFB73e ✓writer; put -1s rev 1783 → dpl_7H9E2oNx1gkv9VX2CZzKeCtFB73e ✓writer; put 1s rev 1784 → dpl_7H9E2oNx1gkv9VX2CZzKeCtFB73e ✓writer; put 5s rev 1785 → dpl_FAt2Sp33CvHnRohZyHkH5bUHZ4X5 ✓writer; put 11s rev 1786 → dpl_FAt2Sp33CvHnRohZyHkH5bUHZ4X5 ✓writer; put 15s rev 1787 → dpl_FAt2Sp33CvHnRohZyHkH5bUHZ4X5 ✓writer; put 30s rev 1788 → dpl_FAt2Sp33CvHnRohZyHkH5bUHZ4X5 ✓writer; put 60s rev 1789 → dpl_FAt2Sp33CvHnRohZyHkH5bUHZ4X5 ✓writer
- `[liveWarm] start` 12; any `[liveWarm]` 60; warm-lookup lines 7069; `source=warm` responses 6632; responses with a verify header 12564

### Drain — old deployment dpl_7H9E2oNx1gkv9VX2CZzKeCtFB73e after 17:55:17.994

- requests after 461; last request 17:55:26.130; last pool line 17:55:26.118. An instance that stops logging has not necessarily closed its pooler connections (the estimator only sees log lines).

| +s | requests | pool lines | max pool total | instances logging pool |
|---|---|---|---|---|
| +0 | 461 | 163 | 2 | 42 |

### Continuity / performance per save and SDK group

Eligible = subscribed by the first save attempt; continuity = every eligible client at ≥ rev within 30 s of it (proposed operational acceptance); performance = p95 ≤ 3 s (kept visible). Joined-after clients are timed from max(join, PUT response).

| save rev | label | group | eligible | p50 / p95 / max ms | missing @30 s | continuity | p95 ≤ 3 s | joined after p95 / missing | not joined | broadcast received / pop. | applying fetch reasons | regressions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1782 | put -30s | incumbent | 430 | 2220 / 2879 / 3101 | 0 | PASS | PASS | — / 0 | 0 | 430 / 430 | {"notification":414,"periodic":16} | — |
| 1782 | put -30s | hold | 20 | 2316 / 3000 / 3067 | 0 | PASS | PASS | — / 0 | 0 | 20 / 20 | {"notification":20} | — |
| 1782 | put -30s | ahead | 20 | 2087 / 3003 / 3107 | 0 | PASS | FAIL | — / 0 | 0 | 20 / 20 | {"notification":20} | — |
| 1782 | put -30s | arrival-1 | 100 | 2086 / 2884 / 3007 | 0 | PASS | PASS | — / 0 | 0 | 100 / 100 | {"notification":95,"periodic":5} | — |
| 1783 | put -1s | incumbent | 430 | 1967 / 3323 / 3549 | 0 | PASS | FAIL | — / 0 | 0 | 430 / 430 | {"notification":422,"periodic":8} | — |
| 1783 | put -1s | hold | 20 | 6228 / 6812 / 6985 | 0 | PASS | FAIL | — / 0 | 0 | 20 / 20 | {"resume":4,"notification":16} | — |
| 1783 | put -1s | ahead | 20 | 1957 / 3402 / 3529 | 0 | PASS | FAIL | — / 0 | 0 | 20 / 20 | {"notification":19,"periodic":1} | — |
| 1783 | put -1s | arrival-1 | 100 | 1963 / 3157 / 3543 | 0 | PASS | FAIL | — / 0 | 0 | 100 / 100 | {"notification":97,"periodic":3} | — |
| 1783 | put -1s | arrival-2 | 0 | — / — / — | 0 | n/a | n/a | 283 / 0 | 0 | 0 / 100 | {"initial":100} | — |
| 1784 | put +1s | incumbent | 430 | 2644 / 3678 / 3890 | 0 | PASS | FAIL | — / 0 | 0 | 430 / 430 | {"notification":418,"periodic":12} | — |
| 1784 | put +1s | hold | 20 | 4824 / 4981 / 5044 | 0 | PASS | FAIL | — / 0 | 0 | 20 / 20 | {"notification":7,"resume":9,"periodic":4} | — |
| 1784 | put +1s | ahead | 20 | 2822 / 3595 / 3663 | 0 | PASS | FAIL | — / 0 | 0 | 20 / 20 | {"notification":17,"periodic":3} | — |
| 1784 | put +1s | arrival-1 | 100 | 2691 / 3719 / 3903 | 0 | PASS | FAIL | — / 0 | 0 | 100 / 100 | {"notification":98,"periodic":2} | — |
| 1784 | put +1s | arrival-2 | 0 | — / — / — | 0 | n/a | n/a | 283 / 0 | 0 | 0 / 100 | {"initial":100} | — |
| 1785 | put +5s | incumbent | 430 | 1197 / 2288 / 2533 | 0 | PASS | PASS | — / 0 | 0 | 430 / 430 | {"notification":417,"periodic":13} | — |
| 1785 | put +5s | hold | 20 | 1174 / 2232 / 2239 | 0 | PASS | PASS | — / 0 | 0 | 20 / 20 | {"periodic":1,"notification":19} | — |
| 1785 | put +5s | ahead | 20 | 1162 / 2232 / 2280 | 0 | PASS | PASS | — / 0 | 0 | 20 / 20 | {"notification":19,"periodic":1} | — |
| 1785 | put +5s | arrival-1 | 100 | 1264 / 2080 / 2517 | 0 | PASS | PASS | — / 0 | 0 | 100 / 100 | {"notification":98,"periodic":2} | — |
| 1785 | put +5s | arrival-2 | 0 | — / — / — | 0 | n/a | n/a | 283 / 0 | 0 | 0 / 100 | {"initial":100} | — |
| 1786 | put +11s | incumbent | 430 | 2092 / 3560 / 4096 | 0 | PASS | FAIL | — / 0 | 0 | 430 / 430 | {"notification":424,"periodic":6} | — |
| 1786 | put +11s | hold | 20 | 2078 / 2405 / 3437 | 0 | PASS | PASS | — / 0 | 0 | 20 / 20 | {"notification":19,"periodic":1} | — |
| 1786 | put +11s | ahead | 20 | 1954 / 3450 / 3461 | 0 | PASS | FAIL | — / 0 | 0 | 20 / 20 | {"notification":19,"periodic":1} | — |
| 1786 | put +11s | arrival-1 | 100 | 2155 / 3568 / 3712 | 0 | PASS | FAIL | — / 0 | 0 | 100 / 100 | {"notification":95,"periodic":5} | — |
| 1786 | put +11s | arrival-2 | 50 | 1899 / 2572 / 2926 | 0 | PASS | PASS | 888 / 0 | 0 | 99 / 100 | {"notification":50,"catchup":50} | — |
| 1787 | put +15s | incumbent | 430 | 1228 / 1484 / 1952 | 0 | PASS | PASS | — / 0 | 0 | 430 / 430 | {"notification":420,"periodic":10} | — |
| 1787 | put +15s | hold | 20 | 1072 / 1303 / 1313 | 0 | PASS | PASS | — / 0 | 0 | 20 / 20 | {"notification":19,"periodic":1} | — |
| 1787 | put +15s | ahead | 20 | 1307 / 1344 / 1346 | 0 | PASS | PASS | — / 0 | 0 | 20 / 20 | {"notification":20} | — |
| 1787 | put +15s | arrival-1 | 100 | 1411 / 1511 / 1952 | 0 | PASS | PASS | — / 0 | 0 | 100 / 100 | {"notification":97,"periodic":3} | — |
| 1787 | put +15s | arrival-2 | 100 | 1246 / 1383 / 1396 | 0 | PASS | PASS | — / 0 | 0 | 100 / 100 | {"notification":100} | — |
| 1788 | put +30s | incumbent | 430 | 1680 / 2480 / 3039 | 0 | PASS | PASS | — / 0 | 0 | 430 / 430 | {"notification":420,"periodic":10} | — |
| 1788 | put +30s | hold | 20 | 1671 / 2325 / 2327 | 0 | PASS | PASS | — / 0 | 0 | 20 / 20 | {"notification":19,"periodic":1} | — |
| 1788 | put +30s | ahead | 20 | 1734 / 2002 / 2006 | 0 | PASS | PASS | — / 0 | 0 | 20 / 20 | {"notification":20} | — |
| 1788 | put +30s | arrival-1 | 100 | 1734 / 2501 / 3109 | 0 | PASS | PASS | — / 0 | 0 | 100 / 100 | {"notification":98,"periodic":2} | — |
| 1788 | put +30s | arrival-2 | 100 | 1734 / 2597 / 2812 | 0 | PASS | PASS | — / 0 | 0 | 100 / 100 | {"notification":100} | — |
| 1789 | put +60s | incumbent | 430 | 1711 / 2547 / 3152 | 0 | PASS | PASS | — / 0 | 0 | 430 / 430 | {"notification":423,"periodic":7} | — |
| 1789 | put +60s | hold | 20 | 1654 / 2025 / 2079 | 0 | PASS | PASS | — / 0 | 0 | 20 / 20 | {"notification":20} | — |
| 1789 | put +60s | ahead | 20 | 1785 / 2243 / 2449 | 0 | PASS | PASS | — / 0 | 0 | 20 / 20 | {"notification":20} | — |
| 1789 | put +60s | arrival-1 | 100 | 1714 / 2832 / 3071 | 0 | PASS | PASS | — / 0 | 0 | 100 / 100 | {"notification":99,"periodic":1} | — |
| 1789 | put +60s | arrival-2 | 100 | 1682 / 2423 / 2838 | 0 | PASS | PASS | — / 0 | 0 | 100 / 100 | {"notification":99,"periodic":1} | — |

### Existing-deployment return — first target answers vs the committed head

| population | clients | stale | unknown | sources | stale revs |
|---|---|---|---|---|---|
| sdk | 684 | 0 | 0 | {"build":110,"cache":188,"warm":386} | {} |
| route | 1 | 0 | 1 | {"none":1} | {} |
| page | 51 | 0 | 0 | {"build":14,"cache":9,"warm":28} | {} |
| probe | 1 | 0 | 0 | {"cache":1} | {} |
| document | 9 | 0 | 9 | {"none":9} | {} |

### Reactions / wishes smoke from old pages

| page | locale | type | harness checks | pass | sub-requests (status → serving deployment) |
|---|---|---|---|---|---|
| 0 | ja | surprise | submitted ✓, persisted ✓, refreshed ✓, identityRetained ✓, wish ✓, no5xx ✓ | true | post 200 → dpl_FAt2Sp33CvHnRohZyHkH5bUHZ4X5; counts 200 → dpl_FAt2Sp33CvHnRohZyHkH5bUHZ4X5; wish 403 → dpl_FAt2Sp33CvHnRohZyHkH5bUHZ4X5 |
| 1 | ko | moved | submitted ✓, persisted ✓, refreshed ✓, identityRetained ✓, wish ✓, no5xx ✓ | true | post 200 → dpl_FAt2Sp33CvHnRohZyHkH5bUHZ4X5; counts 200 → dpl_FAt2Sp33CvHnRohZyHkH5bUHZ4X5; wish 403 → dpl_FAt2Sp33CvHnRohZyHkH5bUHZ4X5 |
| 3 | en | waiting | submitted ✓, persisted ✓, refreshed ✓, identityRetained ✓, wish ✓, no5xx ✓ | true | post 200 → dpl_FAt2Sp33CvHnRohZyHkH5bUHZ4X5; counts 200 → dpl_FAt2Sp33CvHnRohZyHkH5bUHZ4X5; wish 403 → dpl_FAt2Sp33CvHnRohZyHkH5bUHZ4X5 |

## switch 3 (fresh): dpl_FAt2Sp33CvHnRohZyHkH5bUHZ4X5 → dpl_F5VocFcajvm1wf2aFqdMaBNhHvaK

- planned 2026-10-12T17:59:13.000Z; CLI 17:59:13.187 → 17:59:17.630 (4443 ms, CPU 166 ms); target https://opensetlist-8kis2jv91-opensetlist-projects.vercel.app

### Propagation — **EXERCISED**

| population | requests | → target | → old | → other | unmatched (in windows) | not exported | first target response (start → end) | last old request start | last old response end | old starts after cliStart |
|---|---|---|---|---|---|---|---|---|---|---|
| probe | 105 | 63 | 42 | 0 | 0 | 0 | 17:59:17.953 → 17:59:20.137 | 17:59:20.950 | 17:59:21.913 | 7 |
| route | 161 | 127 | 34 | 0 | 0 | 0 | 17:59:18.010 → 17:59:20.261 | 17:59:23.511 | 17:59:23.985 | 13 |
| sdk | 11259 | 7588 | 3564 | 0 | 0 | 107 | 17:59:19.503 → 17:59:19.790 | 17:59:26.283 | 17:59:26.915 | 1088 |
| page | 855 | 561 | 264 | 0 | 0 | 30 | 17:59:17.745 → 17:59:19.790 | 17:59:26.485 | 17:59:26.852 | 77 |
| document | 10 | 9 | 1 | 0 | 0 | 0 | 17:59:25.236 → 17:59:25.236 | 17:59:23.788 | 17:59:23.788 | 1 |
| all | 12390 | 8348 | 3905 | 0 | 0 | 137 | 17:59:19.503 → 17:59:19.790 | 17:59:26.485 | 17:59:26.915 | 1186 |

- Sustained target routing over [cliEnd, cliEnd + 60 s] (probe): **no** — 60 probe request(s), off-target after the first target probe 3 (17:59:18.955 → dpl_FAt2Sp33CvHnRohZyHkH5bUHZ4X5, 17:59:19.947 → dpl_FAt2Sp33CvHnRohZyHkH5bUHZ4X5, 17:59:20.950 → dpl_FAt2Sp33CvHnRohZyHkH5bUHZ4X5; mixed routing for 2997 ms after the first target probe), steady on the target from 17:59:21.943 (cliEnd +4313 ms), largest probe gap 1142 ms.
- Harness provisional (live data-dpl-id route marker, no logs) — replaced by the bounds above: boundary 17:59:20.261 (route marker (data-dpl-id)); first target live 17:59:18.010 → 17:59:20.261 (marker served by the target id); routing sustained false, in window 121, off-target 4, last old start 17:59:23.511, last old response 17:59:23.985. Log-attributed first target response (all alias populations): 17:59:19.790 (-471 ms vs the harness boundary).
- Harness verdicts: {"continuity":"PASS","performance":"FAIL","arrivals":"FAIL","smoke":"PASS","guard":"PASS"}; exposure {"pendingHinted":"NOT EXERCISED","oldAnswer":"EXERCISED","arrivalSdk":"NOT EXERCISED","arrivalPages":"EXERCISED"}

### Exposure (first attributed target response 17:59:19.790)

| exposure | measured | min | result | detail |
|---|---|---|---|---|
| pending hinted fetch (natural SDK) | 0 clients | 20 | **NOT EXERCISED** | 0 req; old-attributed 0, unmatched 0; after T: headers 0, body 0, eval 0, settled 0; subsets {"hold":11} |
| pending recheck (controlled) | 0 clients | 5 | **NOT EXERCISED** | queued 0, dispatched 0 (recheck responses of the controlled subset) |
| old answer after cutover → converged | 285 / 286 clients | 5 | **EXERCISED** | natural 262, controlled 23; regression check: n/a here (no appliedAll in the client records; the harness's monotonicity check covers it) |
| arrival save rev 1794 (+11 s) SDK | 0 / 100 not joined at PUT response | 20 | **NOT EXERCISED** | |
| arrival save rev 1794 pages | 2 / 10 incomplete | 3 | **NOT EXERCISED** | |
| arrival save rev 1795 (+15 s) SDK | 0 / 100 not joined at PUT response | 20 | **NOT EXERCISED** | |
| arrival save rev 1795 pages | 5 / 10 incomplete | 3 | **EXERCISED** | |

### Target role evidence — ON (warming expected): **warm jobs seen**

- manifest role ON-B, LIVE_WARM_ENTRIES 1; 8619 log record(s) for the deployment
- saves in the leg 8: served by the target 5 (with writer line 5), not attributed 0; hinted reads 7695, not attributed inside the exported windows 0, outside them 76
- saves → serving deployment: put -30s rev 1790 → dpl_FAt2Sp33CvHnRohZyHkH5bUHZ4X5 ✓writer; put -1s rev 1791 → dpl_FAt2Sp33CvHnRohZyHkH5bUHZ4X5 ✓writer; put 1s rev 1792 → dpl_FAt2Sp33CvHnRohZyHkH5bUHZ4X5 ✓writer; put 5s rev 1793 → dpl_F5VocFcajvm1wf2aFqdMaBNhHvaK ✓writer; put 11s rev 1794 → dpl_F5VocFcajvm1wf2aFqdMaBNhHvaK ✓writer; put 15s rev 1795 → dpl_F5VocFcajvm1wf2aFqdMaBNhHvaK ✓writer; put 30s rev 1796 → dpl_F5VocFcajvm1wf2aFqdMaBNhHvaK ✓writer; put 60s rev 1797 → dpl_F5VocFcajvm1wf2aFqdMaBNhHvaK ✓writer
- `[liveWarm] start` 7; any `[liveWarm]` 35; warm-lookup lines 5279; `source=warm` responses 5072; responses with a verify header 8213

### Drain — old deployment dpl_FAt2Sp33CvHnRohZyHkH5bUHZ4X5 after 17:59:19.790

- requests after 366; last request 17:59:45.147; last pool line 17:59:26.262. An instance that stops logging has not necessarily closed its pooler connections (the estimator only sees log lines).

| +s | requests | pool lines | max pool total | instances logging pool |
|---|---|---|---|---|
| +0 | 312 | 104 | 2 | 15 |
| +20 | 54 | 0 | — | 0 |

### Continuity / performance per save and SDK group

Eligible = subscribed by the first save attempt; continuity = every eligible client at ≥ rev within 30 s of it (proposed operational acceptance); performance = p95 ≤ 3 s (kept visible). Joined-after clients are timed from max(join, PUT response).

| save rev | label | group | eligible | p50 / p95 / max ms | missing @30 s | continuity | p95 ≤ 3 s | joined after p95 / missing | not joined | broadcast received / pop. | applying fetch reasons | regressions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1790 | put -30s | incumbent | 430 | 1797 / 2438 / 2835 | 0 | PASS | PASS | — / 0 | 0 | 430 / 430 | {"notification":425,"periodic":5} | — |
| 1790 | put -30s | hold | 20 | 1628 / 2627 / 2630 | 0 | PASS | PASS | — / 0 | 0 | 20 / 20 | {"notification":19,"periodic":1} | — |
| 1790 | put -30s | ahead | 20 | 1718 / 2272 / 2583 | 0 | PASS | PASS | — / 0 | 0 | 20 / 20 | {"notification":20} | — |
| 1790 | put -30s | arrival-1 | 100 | 1824 / 2319 / 2697 | 0 | PASS | PASS | — / 0 | 0 | 100 / 100 | {"notification":98,"periodic":2} | — |
| 1790 | put -30s | arrival-2 | 100 | 1817 / 2414 / 2722 | 0 | PASS | PASS | — / 0 | 0 | 100 / 100 | {"notification":98,"periodic":2} | — |
| 1791 | put -1s | incumbent | 430 | 1624 / 2631 / 3089 | 0 | PASS | PASS | — / 0 | 0 | 430 / 430 | {"notification":422,"periodic":8} | — |
| 1791 | put -1s | hold | 20 | 8474 / 9950 / 10102 | 0 | PASS | FAIL | — / 0 | 0 | 20 / 20 | {"retry":3,"notification":11,"resume":5,"periodic":1} | — |
| 1791 | put -1s | ahead | 20 | 1811 / 2329 / 2387 | 0 | PASS | PASS | — / 0 | 0 | 20 / 20 | {"notification":19,"periodic":1} | — |
| 1791 | put -1s | arrival-1 | 100 | 1698 / 2687 / 3304 | 0 | PASS | PASS | — / 0 | 0 | 100 / 100 | {"notification":96,"periodic":4} | — |
| 1791 | put -1s | arrival-2 | 100 | 1714 / 2501 / 3103 | 0 | PASS | PASS | — / 0 | 0 | 100 / 100 | {"notification":98,"periodic":2} | — |
| 1791 | put -1s | arrival-3 | 0 | — / — / — | 0 | n/a | n/a | 625 / 0 | 0 | 0 / 100 | {"initial":100} | — |
| 1792 | put +1s | incumbent | 430 | 1222 / 1610 / 2088 | 0 | PASS | PASS | — / 0 | 0 | 430 / 430 | {"notification":414,"periodic":16} | — |
| 1792 | put +1s | hold | 20 | 6958 / 7948 / 8100 | 0 | PASS | FAIL | — / 0 | 0 | 20 / 20 | {"retry":3,"resume":12,"periodic":5} | — |
| 1792 | put +1s | ahead | 20 | 1065 / 1286 / 1320 | 0 | PASS | PASS | — / 0 | 0 | 20 / 20 | {"notification":20} | — |
| 1792 | put +1s | arrival-1 | 100 | 1493 / 1616 / 1952 | 0 | PASS | PASS | — / 0 | 0 | 100 / 100 | {"notification":96,"periodic":4} | — |
| 1792 | put +1s | arrival-2 | 100 | 1262 / 1469 / 1510 | 0 | PASS | PASS | — / 0 | 0 | 100 / 100 | {"notification":96,"periodic":4} | — |
| 1792 | put +1s | arrival-3 | 0 | — / — / — | 0 | n/a | n/a | 625 / 0 | 0 | 0 / 100 | {"initial":100} | — |
| 1793 | put +5s | incumbent | 430 | 1851 / 2999 / 3422 | 0 | PASS | PASS | — / 0 | 0 | 430 / 430 | {"notification":415,"periodic":15} | — |
| 1793 | put +5s | hold | 20 | 1586 / 2183 / 2279 | 0 | PASS | PASS | — / 0 | 0 | 20 / 20 | {"retry":3,"notification":11,"resume":5,"periodic":1} | — |
| 1793 | put +5s | ahead | 20 | 1848 / 2844 / 2935 | 0 | PASS | PASS | — / 0 | 0 | 20 / 20 | {"notification":18,"periodic":2} | — |
| 1793 | put +5s | arrival-1 | 100 | 1843 / 2764 / 3340 | 0 | PASS | PASS | — / 0 | 0 | 100 / 100 | {"notification":97,"periodic":3} | — |
| 1793 | put +5s | arrival-2 | 100 | 1876 / 2678 / 3185 | 0 | PASS | PASS | — / 0 | 0 | 100 / 100 | {"notification":99,"periodic":1} | — |
| 1793 | put +5s | arrival-3 | 0 | — / — / — | 0 | n/a | n/a | 625 / 0 | 0 | 0 / 100 | {"initial":100} | — |
| 1794 | put +11s | incumbent | 430 | 3397 / 4263 / 4843 | 0 | PASS | FAIL | — / 0 | 0 | 430 / 430 | {"notification":425,"periodic":5} | — |
| 1794 | put +11s | hold | 20 | 3071 / 3974 / 4296 | 0 | PASS | FAIL | — / 0 | 0 | 20 / 20 | {"notification":20} | — |
| 1794 | put +11s | ahead | 20 | 3257 / 4838 / 4923 | 0 | PASS | FAIL | — / 0 | 0 | 20 / 20 | {"notification":20} | — |
| 1794 | put +11s | arrival-1 | 100 | 3558 / 4339 / 4817 | 0 | PASS | FAIL | — / 0 | 0 | 100 / 100 | {"notification":98,"periodic":2} | — |
| 1794 | put +11s | arrival-2 | 100 | 3562 / 4754 / 4865 | 0 | PASS | FAIL | — / 0 | 0 | 100 / 100 | {"notification":99,"periodic":1} | — |
| 1794 | put +11s | arrival-3 | 49 | 2999 / 3203 / 3217 | 0 | PASS | FAIL | 987 / 0 | 0 | 100 / 100 | {"notification":100} | — |
| 1795 | put +15s | incumbent | 430 | 1366 / 1896 / 2143 | 0 | PASS | PASS | — / 0 | 0 | 430 / 430 | {"notification":421,"periodic":9} | — |
| 1795 | put +15s | hold | 20 | 1032 / 1258 / 1343 | 0 | PASS | PASS | — / 0 | 0 | 20 / 20 | {"notification":20} | — |
| 1795 | put +15s | ahead | 20 | 1399 / 1462 / 1465 | 0 | PASS | PASS | — / 0 | 0 | 20 / 20 | {"notification":19,"periodic":1} | — |
| 1795 | put +15s | arrival-1 | 100 | 1797 / 1916 / 1937 | 0 | PASS | PASS | — / 0 | 0 | 100 / 100 | {"notification":99,"periodic":1} | — |
| 1795 | put +15s | arrival-2 | 100 | 1392 / 1645 / 2193 | 0 | PASS | PASS | — / 0 | 0 | 100 / 100 | {"notification":94,"periodic":6} | — |
| 1795 | put +15s | arrival-3 | 100 | 1279 / 1488 / 1514 | 0 | PASS | PASS | — / 0 | 0 | 100 / 100 | {"notification":100} | — |
| 1796 | put +30s | incumbent | 430 | 1755 / 2888 / 3300 | 0 | PASS | PASS | — / 0 | 0 | 430 / 430 | {"notification":413,"periodic":17} | — |
| 1796 | put +30s | hold | 20 | 1757 / 2869 / 3099 | 0 | PASS | PASS | — / 0 | 0 | 20 / 20 | {"notification":20} | — |
| 1796 | put +30s | ahead | 20 | 1722 / 2635 / 2771 | 0 | PASS | PASS | — / 0 | 0 | 20 / 20 | {"notification":20} | — |
| 1796 | put +30s | arrival-1 | 100 | 1830 / 2813 / 2976 | 0 | PASS | PASS | — / 0 | 0 | 100 / 100 | {"notification":97,"periodic":3} | — |
| 1796 | put +30s | arrival-2 | 100 | 1712 / 3128 / 3308 | 0 | PASS | FAIL | — / 0 | 0 | 100 / 100 | {"notification":96,"periodic":4} | — |
| 1796 | put +30s | arrival-3 | 100 | 1658 / 2892 / 3295 | 0 | PASS | PASS | — / 0 | 0 | 100 / 100 | {"notification":94,"periodic":6} | — |
| 1797 | put +60s | incumbent | 430 | 1839 / 3364 / 3580 | 0 | PASS | FAIL | — / 0 | 0 | 430 / 430 | {"notification":418,"periodic":12} | — |
| 1797 | put +60s | hold | 20 | 1668 / 3358 / 3565 | 0 | PASS | FAIL | — / 0 | 0 | 20 / 20 | {"periodic":1,"notification":19} | — |
| 1797 | put +60s | ahead | 20 | 1782 / 2739 / 3349 | 0 | PASS | PASS | — / 0 | 0 | 20 / 20 | {"notification":20} | — |
| 1797 | put +60s | arrival-1 | 100 | 1814 / 3088 / 3387 | 0 | PASS | FAIL | — / 0 | 0 | 100 / 100 | {"notification":93,"periodic":7} | — |
| 1797 | put +60s | arrival-2 | 100 | 1864 / 3393 / 3575 | 0 | PASS | FAIL | — / 0 | 0 | 100 / 100 | {"notification":100} | — |
| 1797 | put +60s | arrival-3 | 100 | 1859 / 3369 / 3570 | 0 | PASS | FAIL | — / 0 | 0 | 100 / 100 | {"notification":100} | — |

### Reactions / wishes smoke from old pages

| page | locale | type | harness checks | pass | sub-requests (status → serving deployment) |
|---|---|---|---|---|---|
| 0 | ja | moved | submitted ✓, persisted ✓, refreshed ✓, identityRetained ✓, wish ✓, no5xx ✓ | true | post 200 → dpl_F5VocFcajvm1wf2aFqdMaBNhHvaK; counts 200 → dpl_F5VocFcajvm1wf2aFqdMaBNhHvaK; wish 403 → dpl_F5VocFcajvm1wf2aFqdMaBNhHvaK |
| 1 | ko | waiting | submitted ✓, persisted ✓, refreshed ✓, identityRetained ✓, wish ✓, no5xx ✓ | true | post 200 → dpl_F5VocFcajvm1wf2aFqdMaBNhHvaK; counts 200 → dpl_F5VocFcajvm1wf2aFqdMaBNhHvaK; wish 403 → dpl_F5VocFcajvm1wf2aFqdMaBNhHvaK |
| 3 | en | best | submitted ✓, persisted ✓, refreshed ✓, identityRetained ✓, wish ✓, no5xx ✓ | true | post 200 → dpl_F5VocFcajvm1wf2aFqdMaBNhHvaK; counts 200 → dpl_F5VocFcajvm1wf2aFqdMaBNhHvaK; wish 403 → dpl_F5VocFcajvm1wf2aFqdMaBNhHvaK |

## Resources across deployments

Σ = sum of per-instance Prisma pool totals (vercel-logs-summary's estimator on the JSON export): 5 s buckets of per-instance MAXIMA (an upper bound within a bucket, not a simultaneous count), an instance carried ≤ 5 s after its last line, instances that never log a pool line are invisible; record times are request STARTS. An app-side estimate, not the pooler's own client count.

| deployment | Σ peak (carried / reported, instances) | at | writer lines | writer acquire max ms | EMAXCONN |
|---|---|---|---|---|---|
| dpl_FAt2Sp33CvHnRohZyHkH5bUHZ4X5 | 90 / 90 (61) | 17:55:25.000 | 12 | 13 | 0 |
| dpl_7H9E2oNx1gkv9VX2CZzKeCtFB73e | 119 / 109 (65) | 17:51:25.000 | 7 | 1686 | 0 |
| dpl_F5VocFcajvm1wf2aFqdMaBNhHvaK | 93 / 91 (56) | 17:59:25.000 | 7 | 963 | 0 |
| **combined** | 154 / 102 (95) | 17:55:25.000 | 26 | 1686 | 0 |

| minute (UTC) | dpl_FAt2Sp33CvHnRohZyHkH5bUHZ4X5 requests / builds | dpl_7H9E2oNx1gkv9VX2CZzKeCtFB73e requests / builds | dpl_F5VocFcajvm1wf2aFqdMaBNhHvaK requests / builds |
|---|---|---|---|
| 17:50 | 1285 / 195 | — | — |
| 17:51 | 1703 / 215 | 3740 / 1270 | — |
| 17:52 | — | 1599 / 617 | — |
| 17:54 | — | 1458 / 488 | — |
| 17:55 | 4204 / 675 | 2233 / 626 | — |
| 17:56 | 1903 / 274 | — | — |
| 17:58 | 1739 / 310 | — | — |
| 17:59 | 2499 / 643 | 6 / 0 | 5006 / 786 |
| 18:00 | — | — | 3613 / 550 |

## Harness provisional verdicts (verbatim)

```json
{
  "verdict": "VALID + FAIL",
  "exit": 1,
  "failed": [
    "switch 1 performance",
    "switch 1 arrivals",
    "switch 2 performance",
    "switch 2 arrivals",
    "switch 3 performance",
    "switch 3 arrivals"
  ],
  "notExercised": [
    "switch 1 pendingHinted",
    "switch 1 arrivalSdk",
    "switch 2 pendingHinted",
    "switch 2 arrivalSdk",
    "switch 3 pendingHinted",
    "switch 3 arrivalSdk"
  ]
}
```

