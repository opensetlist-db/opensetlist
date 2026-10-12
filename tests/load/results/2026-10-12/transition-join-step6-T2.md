# Step 6 transition join — step6-T2

- Inputs: tests/load/results/2026-10-12/2026-10-12T18-46-51-402Z-browsers-transition.json, dpl_F5VocFcajvm1wf2aFqdMaBNhHvaK=tests/load/results/2026-10-12/logs-step6-T2-dpl_F5VocFcajvm1wf2aFqdMaBNhHvaK.jsonl,dpl_GN57F4UStRok7DRsu9bJ4bn7Yzcd=tests/load/results/2026-10-12/logs-step6-T2-dpl_GN57F4UStRok7DRsu9bJ4bn7Yzcd.jsonl,dpl_5nR6mGHXsx2z1TsgChikER9ZHB5q=tests/load/results/2026-10-12/logs-step6-T2-dpl_5nR6mGHXsx2z1TsgChikER9ZHB5q.jsonl, tests/load/results/2026-10-12/switch-T2-1.json,tests/load/results/2026-10-12/switch-T2-2.json, tests/load/results/2026-10-12/step6-manifest-T2.json
- Base https://opensetlist-git-dev-opensetlist-projects.vercel.app; run 2026-10-12T18:38:57.093Z → 2026-10-12T18:46:50.587Z
- Clocks: harness, switch files (CLI start / end) and smoke = this laptop; log `timestamp` = Vercel edge arrival; writer `at` = the function. Propagation bounds use harness times only. Record − harness request start over 18259 matched responses: p5 -26 / p50 -22 / p95 719 ms (min -5645, max 1986) — one-way latency plus clock offset; bounds closer than this spread are indeterminate.

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

Exported log windows (inferred from the records (union, 30 s gaps)): 18:40:32.083 → 18:42:26.990; 18:44:32.047 → 18:46:26.992. Responses whose edge request time (from the request id) lies outside them are **not exported** (10731) — counted apart, outside every other column; coverage is over the exported windows only.

| population | not exported | responses (in windows) | with request id | matched | consistent (coverage) | inconsistent | unmatched | instrumentation (expected → present) | by deployment |
|---|---|---|---|---|---|---|---|---|---|
| document | 30 | 25 | 25 | 25 | 25 (100.0 %) | 0 | 0 | — | dpl_GN57F4UStRok7DRsu9bJ4bn7Yzcd 18, dpl_5nR6mGHXsx2z1TsgChikER9ZHB5q 7 |
| guard | 0 | 2 | 2 | 2 | 2 (100.0 %) | 0 | 0 | — | dpl_GN57F4UStRok7DRsu9bJ4bn7Yzcd 1, dpl_5nR6mGHXsx2z1TsgChikER9ZHB5q 1 |
| page | 750 | 1243 | 1243 | 1243 | 1243 (100.0 %) | 0 | 0 | 292 → 292 | dpl_F5VocFcajvm1wf2aFqdMaBNhHvaK 173, dpl_GN57F4UStRok7DRsu9bJ4bn7Yzcd 568, dpl_5nR6mGHXsx2z1TsgChikER9ZHB5q 502 |
| probe | 199 | 230 | 230 | 230 | 230 (100.0 %) | 0 | 0 | 113 → 113 | dpl_F5VocFcajvm1wf2aFqdMaBNhHvaK 46, dpl_GN57F4UStRok7DRsu9bJ4bn7Yzcd 117, dpl_5nR6mGHXsx2z1TsgChikER9ZHB5q 67 |
| route | 1 | 323 | 323 | 323 | 323 (100.0 %) | 0 | 0 | — | dpl_F5VocFcajvm1wf2aFqdMaBNhHvaK 34, dpl_GN57F4UStRok7DRsu9bJ4bn7Yzcd 162, dpl_5nR6mGHXsx2z1TsgChikER9ZHB5q 127 |
| save | 2 | 17 | 17 | 17 | 17 (100.0 %) | 0 | 0 | 17 → 17 | dpl_F5VocFcajvm1wf2aFqdMaBNhHvaK 4, dpl_GN57F4UStRok7DRsu9bJ4bn7Yzcd 8, dpl_5nR6mGHXsx2z1TsgChikER9ZHB5q 5 |
| sdk | 9048 | 15299 | 15299 | 15299 | 15299 (100.0 %) | 0 | 0 | 4632 → 4632 | dpl_F5VocFcajvm1wf2aFqdMaBNhHvaK 2426, dpl_GN57F4UStRok7DRsu9bJ4bn7Yzcd 7363, dpl_5nR6mGHXsx2z1TsgChikER9ZHB5q 5510 |
| sdk/ahead | 352 | 587 | 587 | 587 | 587 (100.0 %) | 0 | 0 | 173 → 173 | dpl_F5VocFcajvm1wf2aFqdMaBNhHvaK 109, dpl_GN57F4UStRok7DRsu9bJ4bn7Yzcd 302, dpl_5nR6mGHXsx2z1TsgChikER9ZHB5q 176 |
| sdk/hold | 349 | 515 | 515 | 515 | 515 (100.0 %) | 0 | 0 | 135 → 135 | dpl_F5VocFcajvm1wf2aFqdMaBNhHvaK 81, dpl_GN57F4UStRok7DRsu9bJ4bn7Yzcd 250, dpl_5nR6mGHXsx2z1TsgChikER9ZHB5q 184 |
| smoke | 0 | 18 | 18 | 18 | 18 (100.0 %) | 0 | 0 | — | dpl_GN57F4UStRok7DRsu9bJ4bn7Yzcd 9, dpl_5nR6mGHXsx2z1TsgChikER9ZHB5q 9 |
| ALL | 10731 | 18259 | 18259 | 18259 | 18259 (100.0 %) | 0 | 0 | 5362 → 5362 | dpl_F5VocFcajvm1wf2aFqdMaBNhHvaK 2873, dpl_GN57F4UStRok7DRsu9bJ4bn7Yzcd 8798, dpl_5nR6mGHXsx2z1TsgChikER9ZHB5q 6588 |

| deployment | log records | matched responses | consistent | first record | last record |
|---|---|---|---|---|---|
| dpl_F5VocFcajvm1wf2aFqdMaBNhHvaK | 3043 | 2873 | 2873 | 2026-10-12T18:40:32.083Z | 2026-10-12T18:45:44.040Z |
| dpl_GN57F4UStRok7DRsu9bJ4bn7Yzcd | 9208 | 8798 | 8798 | 2026-10-12T18:41:16.585Z | 2026-10-12T18:45:27.796Z |
| dpl_5nR6mGHXsx2z1TsgChikER9ZHB5q | 6808 | 6588 | 6588 | 2026-10-12T18:45:16.561Z | 2026-10-12T18:46:26.992Z |

Pin evidence per population (request-side): `x-deployment-id` header / `__vdpl` cookie / `dpl` query / none.

| population | n | header | cookie | query | none |
|---|---|---|---|---|---|
| probe | 429 | 0 | 0 | 0 | 429 |
| route | 324 | 0 | 0 | 0 | 324 |
| guard | 2 | 0 | 0 | 0 | 2 |
| smoke | 18 | 0 | 0 | 0 | 18 |
| save | 19 | 0 | 0 | 0 | 19 |
| sdk | 26150 | 0 | 0 | 0 | 26150 |
| page | 1993 | 0 | 0 | 0 | 1993 |
| document | 55 | 0 | 0 | 0 | 55 |

## switch 1 (r1): dpl_F5VocFcajvm1wf2aFqdMaBNhHvaK → dpl_GN57F4UStRok7DRsu9bJ4bn7Yzcd

- planned 2026-10-12T18:41:12.000Z; CLI 18:41:12.147 → 18:41:16.080 (3933 ms, CPU 334 ms); target https://opensetlist-meqyujqe8-opensetlist-projects.vercel.app

### Propagation — **EXERCISED**

| population | requests | → target | → old | → other | unmatched (in windows) | not exported | first target response (start → end) | last old request start | last old response end | old starts after cliStart |
|---|---|---|---|---|---|---|---|---|---|---|
| probe | 125 | 69 | 41 | 0 | 0 | 15 | 18:41:19.538 → 18:41:20.271 | 18:41:17.550 | 18:41:17.718 | 6 |
| route | 162 | 128 | 34 | 0 | 0 | 0 | 18:41:18.013 → 18:41:20.287 | 18:41:20.002 | 18:41:20.486 | 13 |
| sdk | 7497 | 4581 | 2507 | 0 | 0 | 409 | 18:41:16.918 → 18:41:19.060 | 18:41:25.487 | 18:41:26.717 | 764 |
| page | 526 | 321 | 166 | 0 | 0 | 39 | 18:41:18.306 → 18:41:19.011 | 18:41:24.917 | 18:41:25.768 | 57 |
| document | 15 | 15 | 0 | 0 | 0 | 0 | 18:41:25.579 → 18:41:25.579 | — | — | 0 |
| all | 8325 | 5114 | 2748 | 0 | 0 | 463 | 18:41:18.306 → 18:41:19.011 | 18:41:25.487 | 18:41:26.717 | 840 |

- Sustained target routing over [cliEnd, cliEnd + 60 s] (probe): **yes** — 60 probe request(s), off-target after the first target probe 0, steady on the target from 18:41:19.538 (cliEnd +3458 ms), largest probe gap 1034 ms.
- Harness provisional (live data-dpl-id route marker, no logs) — replaced by the bounds above: boundary 18:41:20.287 (route marker (data-dpl-id)); first target live 18:41:18.013 → 18:41:20.287 (marker served by the target id); routing sustained false, in window 121, off-target 2, last old start 18:41:20.002, last old response 18:41:20.486. Log-attributed first target response (all alias populations): 18:41:19.011 (-1276 ms vs the harness boundary).
- Harness verdicts: {"continuity":"PASS","performance":"FAIL","arrivals":"FAIL","smoke":"PASS","guard":"PASS"}; exposure {"pendingHinted":"NOT EXERCISED","oldAnswer":"NOT EXERCISED","arrivalSdk":"NOT EXERCISED","arrivalPages":"EXERCISED"}

### Exposure (first attributed target response 18:41:19.011)

| exposure | measured | min | result | detail |
|---|---|---|---|---|
| pending hinted fetch (natural SDK) | 0 clients | 20 | **NOT EXERCISED** | 0 req; old-attributed 0, unmatched 0; after T: headers 0, body 0, eval 0, settled 0; subsets {"hold":13} |
| pending recheck (controlled) | 0 clients | 5 | **NOT EXERCISED** | queued 0, dispatched 0 (recheck responses of the controlled subset) |
| old answer after cutover → converged | 185 / 186 clients | 5 | **EXERCISED** | natural 178, controlled 7; regression check: n/a here (no appliedAll in the client records; the harness's monotonicity check covers it) |
| arrival save rev 1808 (+11 s) SDK | 0 / 100 not joined at PUT response | 20 | **NOT EXERCISED** | |
| arrival save rev 1808 pages | 5 / 15 incomplete | 3 | **EXERCISED** | |
| arrival save rev 1809 (+15 s) SDK | 0 / 100 not joined at PUT response | 20 | **NOT EXERCISED** | |
| arrival save rev 1809 pages | 2 / 15 incomplete | 3 | **NOT EXERCISED** | |

### Target role evidence — R1 (no warming, no verify header): **PASS**

- manifest role R1-1, LIVE_WARM_ENTRIES ; 9208 log record(s) for the deployment
- saves in the leg 8: served by the target 4 (with writer line 4), not attributed 0; hinted reads 4329, not attributed inside the exported windows 0, outside them 15
- saves → serving deployment: put -30s rev 1804 → dpl_F5VocFcajvm1wf2aFqdMaBNhHvaK ✓writer; put -1s rev 1805 → dpl_F5VocFcajvm1wf2aFqdMaBNhHvaK ✓writer; put 1s rev 1806 → dpl_F5VocFcajvm1wf2aFqdMaBNhHvaK ✓writer; put 5s rev 1807 → dpl_F5VocFcajvm1wf2aFqdMaBNhHvaK ✓writer; put 11s rev 1808 → dpl_GN57F4UStRok7DRsu9bJ4bn7Yzcd ✓writer; put 15s rev 1809 → dpl_GN57F4UStRok7DRsu9bJ4bn7Yzcd ✓writer; put 30s rev 1810 → dpl_GN57F4UStRok7DRsu9bJ4bn7Yzcd ✓writer; put 60s rev 1811 → dpl_GN57F4UStRok7DRsu9bJ4bn7Yzcd ✓writer
- `[liveWarm] start` 0; any `[liveWarm]` 0; warm-lookup lines 0; `source=warm` responses 0; responses with a verify header 0

### Drain — old deployment dpl_F5VocFcajvm1wf2aFqdMaBNhHvaK after 18:41:19.011

- requests after 197; last request 18:41:25.465; last pool line 18:41:24.913. An instance that stops logging has not necessarily closed its pooler connections (the estimator only sees log lines).

| +s | requests | pool lines | max pool total | instances logging pool |
|---|---|---|---|---|
| +0 | 197 | 23 | 2 | 5 |

### Continuity / performance per save and SDK group

Eligible = subscribed by the first save attempt; continuity = every eligible client at ≥ rev within 30 s of it (proposed operational acceptance); performance = p95 ≤ 3 s (kept visible). Joined-after clients are timed from max(join, PUT response).

| save rev | label | group | eligible | p50 / p95 / max ms | missing @30 s | continuity | p95 ≤ 3 s | joined after p95 / missing | not joined | broadcast received / pop. | applying fetch reasons | regressions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1804 | put -30s | incumbent | 430 | 1420 / 1863 / 2066 | 0 | PASS | PASS | — / 0 | 0 | 430 / 430 | {"notification":420,"periodic":10} | — |
| 1804 | put -30s | hold | 20 | 1278 / 1637 / 1687 | 0 | PASS | PASS | — / 0 | 0 | 20 / 20 | {"notification":18,"periodic":2} | — |
| 1804 | put -30s | ahead | 20 | 1217 / 1728 / 2050 | 0 | PASS | PASS | — / 0 | 0 | 20 / 20 | {"notification":19,"periodic":1} | — |
| 1805 | put -1s | incumbent | 430 | 1361 / 1798 / 1979 | 0 | PASS | PASS | — / 0 | 0 | 430 / 430 | {"notification":421,"periodic":9} | — |
| 1805 | put -1s | hold | 20 | 9909 / 11405 / 12277 | 0 | PASS | FAIL | — / 0 | 0 | 20 / 20 | {"retry":4,"resume":13,"periodic":3} | — |
| 1805 | put -1s | ahead | 20 | 1291 / 1744 / 1747 | 0 | PASS | PASS | — / 0 | 0 | 20 / 20 | {"notification":20} | — |
| 1805 | put -1s | r1-1 | 0 | — / — / — | 0 | n/a | n/a | 2339 / 0 | 0 | 0 / 100 | {"initial":100} | — |
| 1806 | put +1s | incumbent | 430 | 1065 / 1318 / 1486 | 0 | PASS | PASS | — / 0 | 0 | 430 / 430 | {"notification":420,"periodic":10} | — |
| 1806 | put +1s | hold | 20 | 7907 / 9403 / 10275 | 0 | PASS | FAIL | — / 0 | 0 | 20 / 20 | {"retry":4,"resume":13,"periodic":3} | — |
| 1806 | put +1s | ahead | 20 | 972 / 1294 / 1299 | 0 | PASS | PASS | — / 0 | 0 | 20 / 20 | {"notification":19,"periodic":1} | — |
| 1806 | put +1s | r1-1 | 0 | — / — / — | 0 | n/a | n/a | 2339 / 0 | 0 | 0 / 100 | {"initial":100} | — |
| 1807 | put +5s | incumbent | 430 | 1401 / 3407 / 3910 | 0 | PASS | FAIL | — / 0 | 0 | 430 / 430 | {"notification":415,"periodic":15} | — |
| 1807 | put +5s | hold | 20 | 1398 / 2894 / 3766 | 0 | PASS | PASS | — / 0 | 0 | 20 / 20 | {"retry":4,"resume":13,"periodic":3} | — |
| 1807 | put +5s | ahead | 20 | 1364 / 2651 / 2815 | 0 | PASS | PASS | — / 0 | 0 | 20 / 20 | {"notification":20} | — |
| 1807 | put +5s | r1-1 | 0 | — / — / — | 0 | n/a | n/a | 2339 / 0 | 0 | 0 / 100 | {"initial":100} | — |
| 1808 | put +11s | incumbent | 430 | 3599 / 4781 / 5023 | 0 | PASS | FAIL | — / 0 | 0 | 430 / 430 | {"notification":427,"periodic":3} | — |
| 1808 | put +11s | hold | 20 | 3616 / 4510 / 4770 | 0 | PASS | FAIL | — / 0 | 0 | 20 / 20 | {"notification":19,"periodic":1} | — |
| 1808 | put +11s | ahead | 20 | 3379 / 4530 / 4931 | 0 | PASS | FAIL | — / 0 | 0 | 20 / 20 | {"notification":20} | — |
| 1808 | put +11s | r1-1 | 50 | 3636 / 4774 / 4988 | 0 | PASS | FAIL | 3437 / 0 | 0 | 100 / 100 | {"notification":51,"catchup":49} | — |
| 1809 | put +15s | incumbent | 430 | 1946 / 2995 / 3321 | 0 | PASS | PASS | — / 0 | 0 | 430 / 430 | {"notification":417,"periodic":13} | — |
| 1809 | put +15s | hold | 20 | 1817 / 3176 / 3321 | 0 | PASS | FAIL | — / 0 | 0 | 20 / 20 | {"notification":18,"periodic":2} | — |
| 1809 | put +15s | ahead | 20 | 1851 / 3099 / 3112 | 0 | PASS | FAIL | — / 0 | 0 | 20 / 20 | {"notification":18,"periodic":2} | — |
| 1809 | put +15s | r1-1 | 100 | 1917 / 2987 / 3168 | 0 | PASS | PASS | — / 0 | 0 | 100 / 100 | {"notification":100} | — |
| 1810 | put +30s | incumbent | 430 | 1907 / 2955 / 3169 | 0 | PASS | PASS | — / 0 | 0 | 430 / 430 | {"notification":423,"periodic":7} | — |
| 1810 | put +30s | hold | 20 | 1803 / 2737 / 2933 | 0 | PASS | PASS | — / 0 | 0 | 20 / 20 | {"notification":19,"periodic":1} | — |
| 1810 | put +30s | ahead | 20 | 1811 / 2471 / 2680 | 0 | PASS | PASS | — / 0 | 0 | 20 / 20 | {"notification":20} | — |
| 1810 | put +30s | r1-1 | 100 | 1825 / 2966 / 3141 | 0 | PASS | PASS | — / 0 | 0 | 100 / 100 | {"notification":96,"periodic":4} | — |
| 1811 | put +60s | incumbent | 430 | 2034 / 2812 / 3184 | 0 | PASS | PASS | — / 0 | 0 | 430 / 430 | {"notification":419,"periodic":11} | — |
| 1811 | put +60s | hold | 20 | 1667 / 2575 / 2804 | 0 | PASS | PASS | — / 0 | 0 | 20 / 20 | {"notification":20} | — |
| 1811 | put +60s | ahead | 20 | 1641 / 2253 / 2776 | 0 | PASS | PASS | — / 0 | 0 | 20 / 20 | {"notification":20} | — |
| 1811 | put +60s | r1-1 | 100 | 2028 / 2683 / 3081 | 0 | PASS | PASS | — / 0 | 0 | 100 / 100 | {"notification":100} | — |

### R1 cohort — per save: postgres_changes receipt → fetch (serving deployment) → DOM

R1-build pages 18; per save only those whose postgres subscription was ready by the PUT start (receipts / pages). A receipt is this save's until the next save on the same row (≤ 30 s). Times from the save's PUT start (receipt, DOM) and from the receipt (fetch). Soft delete = UPDATE with isDeleted (U+del). DOM < 16 s = before the earliest periodic repair.

| save | op | rev | row | receipts / pages (type ok) | receipt types | PUT → receipt p50 / max ms | receipt → fetch p50 / max ms | fetches → deployment | PUT → DOM p50 / max ms (n) | DOM < 16 s |
|---|---|---|---|---|---|---|---|---|---|---|
| 1.2 | put | 1806 | 2660 | 0 / 0 (0) | — | — / — | — / — | — | — / — (0) | 0/0 |
| 1.3 | put | 1807 | 2660 | 0 / 0 (0) | — | — / — | — / — | — | — / — (0) | 0/0 |
| 1.4 | put | 1808 | 2660 | 0 / 0 (0) | — | — / — | — / — | — | — / — (0) | 0/0 |
| 1.5 | put | 1809 | 2660 | 0 / 0 (0) | — | — / — | — / — | — | — / — (0) | 0/0 |
| 1.6 | put | 1810 | 2660 | 15 / 15 (15) | U | 1095 / 1095 | 345 / 519 | dpl_GN57F4UStRok7DRsu9bJ4bn7Yzcd 15 | 2209 / 2992 (15) | 15/15 |
| 1.7 | put | 1811 | 2660 | 15 / 15 (15) | U | 609 / 611 | 337 / 483 | dpl_GN57F4UStRok7DRsu9bJ4bn7Yzcd 15 | 1652 / 2217 (15) | 15/15 |

### Reactions / wishes smoke from old pages

| page | locale | type | harness checks | pass | sub-requests (status → serving deployment) |
|---|---|---|---|---|---|
| 0 | ja | best | submitted ✓, persisted ✓, refreshed ✓, identityRetained ✓, wish ✓, no5xx ✓ | true | post 200 → dpl_GN57F4UStRok7DRsu9bJ4bn7Yzcd; counts 200 → dpl_GN57F4UStRok7DRsu9bJ4bn7Yzcd; wish 403 → dpl_GN57F4UStRok7DRsu9bJ4bn7Yzcd |
| 1 | ko | surprise | submitted ✓, persisted ✓, refreshed ✓, identityRetained ✓, wish ✓, no5xx ✓ | true | post 200 → dpl_GN57F4UStRok7DRsu9bJ4bn7Yzcd; counts 200 → dpl_GN57F4UStRok7DRsu9bJ4bn7Yzcd; wish 403 → dpl_GN57F4UStRok7DRsu9bJ4bn7Yzcd |
| 3 | en | moved | submitted ✓, persisted ✓, refreshed ✓, identityRetained ✓, wish ✓, no5xx ✓ | true | post 200 → dpl_GN57F4UStRok7DRsu9bJ4bn7Yzcd; counts 200 → dpl_GN57F4UStRok7DRsu9bJ4bn7Yzcd; wish 403 → dpl_GN57F4UStRok7DRsu9bJ4bn7Yzcd |

## switch 2 (return-from-r1): dpl_GN57F4UStRok7DRsu9bJ4bn7Yzcd → dpl_5nR6mGHXsx2z1TsgChikER9ZHB5q

- planned 2026-10-12T18:45:12.000Z; CLI 18:45:12.058 → 18:45:16.117 (4059 ms, CPU 165 ms); target https://opensetlist-e7i9t0p57-opensetlist-projects.vercel.app

### Propagation — **EXERCISED**

| population | requests | → target | → old | → other | unmatched (in windows) | not exported | first target response (start → end) | last old request start | last old response end | old starts after cliStart |
|---|---|---|---|---|---|---|---|---|---|---|
| probe | 128 | 67 | 43 | 0 | 0 | 18 | 18:45:17.539 → 18:45:19.635 | 18:45:24.539 | 18:45:25.977 | 8 |
| route | 161 | 127 | 34 | 0 | 0 | 0 | 18:45:19.006 → 18:45:19.380 | 18:45:22.000 | 18:45:22.339 | 13 |
| sdk | 12440 | 5870 | 3203 | 0 | 0 | 3367 | 18:45:16.586 → 18:45:18.917 | 18:45:25.509 | 18:45:26.656 | 1173 |
| page | 1034 | 502 | 233 | 0 | 0 | 299 | 18:45:16.850 → 18:45:18.900 | 18:45:24.662 | 18:45:26.532 | 84 |
| document | 10 | 7 | 3 | 0 | 0 | 0 | 18:45:24.548 → 18:45:24.548 | 18:45:25.987 | 18:45:25.987 | 3 |
| all | 13773 | 6573 | 3516 | 0 | 0 | 3684 | 18:45:16.850 → 18:45:18.900 | 18:45:25.987 | 18:45:26.656 | 1281 |

- Sustained target routing over [cliEnd, cliEnd + 60 s] (probe): **no** — 60 probe request(s), off-target after the first target probe 3 (18:45:18.538 → dpl_GN57F4UStRok7DRsu9bJ4bn7Yzcd, 18:45:20.537 → dpl_GN57F4UStRok7DRsu9bJ4bn7Yzcd, 18:45:24.539 → dpl_GN57F4UStRok7DRsu9bJ4bn7Yzcd; mixed routing for 7000 ms after the first target probe), steady on the target from 18:45:25.538 (cliEnd +9421 ms), largest probe gap 1066 ms.
- Harness provisional (live data-dpl-id route marker, no logs) — replaced by the bounds above: boundary 18:45:19.380 (route marker (data-dpl-id)); first target live 18:45:19.006 → 18:45:19.380 (marker served by the target id); routing sustained false, in window 121, off-target 2, last old start 18:45:22.000, last old response 18:45:22.339. Log-attributed first target response (all alias populations): 18:45:18.900 (-480 ms vs the harness boundary).
- Harness verdicts: {"continuity":"PASS","performance":"FAIL","arrivals":"FAIL","smoke":"PASS","guard":"PASS"}; exposure {"pendingHinted":"NOT EXERCISED","pendingRecheck":"EXERCISED","oldAnswer":"EXERCISED","arrivalSdk":"NOT EXERCISED","arrivalPages":"EXERCISED"}

### Exposure (first attributed target response 18:45:18.900)

| exposure | measured | min | result | detail |
|---|---|---|---|---|
| pending hinted fetch (natural SDK) | 0 clients | 20 | **NOT EXERCISED** | 0 req; old-attributed 0, unmatched 0; after T: headers 0, body 0, eval 0, settled 0; subsets {"hold":11} |
| pending recheck (controlled) | 0 clients | 5 | **NOT EXERCISED** | queued 0, dispatched 0 (recheck responses of the controlled subset) |
| old answer after cutover → converged | 333 / 354 clients | 5 | **EXERCISED** | natural 308, controlled 25; regression check: n/a here (no appliedAll in the client records; the harness's monotonicity check covers it) |
| arrival save rev 1816 (+11 s) SDK | 0 / 100 not joined at PUT response | 20 | **NOT EXERCISED** | |
| arrival save rev 1816 pages | 5 / 10 incomplete | 3 | **EXERCISED** | |
| arrival save rev 1817 (+15 s) SDK | 0 / 100 not joined at PUT response | 20 | **NOT EXERCISED** | |
| arrival save rev 1817 pages | 5 / 10 incomplete | 3 | **EXERCISED** | |

### Target role evidence — ON (warming expected): **warm jobs seen**

- manifest role ON-C, LIVE_WARM_ENTRIES 1; 6808 log record(s) for the deployment
- saves in the leg 11: served by the target 5 (with writer line 5), not attributed 2; hinted reads 8559, not attributed inside the exported windows 0, outside them 2770
- saves → serving deployment: put -30s rev 1812 → dpl_GN57F4UStRok7DRsu9bJ4bn7Yzcd ✓writer; put -1s rev 1813 → dpl_GN57F4UStRok7DRsu9bJ4bn7Yzcd ✓writer; put 1s rev 1814 → dpl_GN57F4UStRok7DRsu9bJ4bn7Yzcd ✓writer; put 5s rev 1815 → dpl_GN57F4UStRok7DRsu9bJ4bn7Yzcd ✓writer; put 11s rev 1816 → dpl_5nR6mGHXsx2z1TsgChikER9ZHB5q ✓writer; put 15s rev 1817 → dpl_5nR6mGHXsx2z1TsgChikER9ZHB5q ✓writer; put 30s rev 1818 → dpl_5nR6mGHXsx2z1TsgChikER9ZHB5q ✓writer; put 60s rev 1819 → dpl_5nR6mGHXsx2z1TsgChikER9ZHB5q ✓writer; insert 70s rev 1820 → dpl_5nR6mGHXsx2z1TsgChikER9ZHB5q ✓writer; update 80s rev 1821 → unattributed; delete 90s rev 1822 → unattributed
- `[liveWarm] start` 5; any `[liveWarm]` 25; warm-lookup lines 3704; `source=warm` responses 2970; responses with a verify header 6440

### Drain — old deployment dpl_GN57F4UStRok7DRsu9bJ4bn7Yzcd after 18:45:18.900

- requests after 428; last request 18:45:27.796; last pool line 18:45:24.678. An instance that stops logging has not necessarily closed its pooler connections (the estimator only sees log lines).

| +s | requests | pool lines | max pool total | instances logging pool |
|---|---|---|---|---|
| +0 | 428 | 125 | 2 | 31 |

### Continuity / performance per save and SDK group

Eligible = subscribed by the first save attempt; continuity = every eligible client at ≥ rev within 30 s of it (proposed operational acceptance); performance = p95 ≤ 3 s (kept visible). Joined-after clients are timed from max(join, PUT response).

| save rev | label | group | eligible | p50 / p95 / max ms | missing @30 s | continuity | p95 ≤ 3 s | joined after p95 / missing | not joined | broadcast received / pop. | applying fetch reasons | regressions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1812 | put -30s | incumbent | 430 | 1847 / 2826 / 3018 | 0 | PASS | PASS | — / 0 | 0 | 430 / 430 | {"notification":418,"periodic":12} | — |
| 1812 | put -30s | hold | 20 | 1702 / 2711 / 3017 | 0 | PASS | PASS | — / 0 | 0 | 20 / 20 | {"notification":19,"periodic":1} | — |
| 1812 | put -30s | ahead | 20 | 1846 / 2609 / 2884 | 0 | PASS | PASS | — / 0 | 0 | 20 / 20 | {"notification":19,"periodic":1} | — |
| 1812 | put -30s | r1-1 | 100 | 1886 / 2879 / 2989 | 0 | PASS | PASS | — / 0 | 0 | 100 / 100 | {"notification":95,"periodic":5} | — |
| 1813 | put -1s | incumbent | 430 | 2145 / 3238 / 3517 | 0 | PASS | FAIL | — / 0 | 0 | 430 / 430 | {"notification":418,"periodic":12} | — |
| 1813 | put -1s | hold | 20 | 8583 / 11054 / 11061 | 0 | PASS | FAIL | — / 0 | 0 | 20 / 20 | {"retry":6,"notification":12,"resume":2} | — |
| 1813 | put -1s | ahead | 20 | 2088 / 3221 / 3227 | 0 | PASS | FAIL | — / 0 | 0 | 20 / 20 | {"notification":19,"periodic":1} | — |
| 1813 | put -1s | r1-1 | 100 | 2200 / 3022 / 3323 | 0 | PASS | FAIL | — / 0 | 0 | 100 / 100 | {"notification":98,"periodic":2} | — |
| 1813 | put -1s | arrival-2 | 0 | — / — / — | 0 | n/a | n/a | 1245 / 0 | 0 | 0 / 100 | {"initial":100} | — |
| 1814 | put +1s | incumbent | 430 | 2524 / 3506 / 3758 | 0 | PASS | FAIL | — / 0 | 0 | 430 / 430 | {"notification":416,"periodic":14} | — |
| 1814 | put +1s | hold | 20 | 7124 / 9053 / 9060 | 0 | PASS | FAIL | — / 0 | 0 | 20 / 20 | {"retry":6,"periodic":6,"resume":8} | — |
| 1814 | put +1s | ahead | 20 | 2223 / 3560 / 3676 | 0 | PASS | FAIL | — / 0 | 0 | 20 / 20 | {"notification":10,"periodic":3,"recheck":7} | — |
| 1814 | put +1s | r1-1 | 100 | 2466 / 3493 / 3703 | 0 | PASS | FAIL | — / 0 | 0 | 100 / 100 | {"notification":99,"periodic":1} | — |
| 1814 | put +1s | arrival-2 | 0 | — / — / — | 0 | n/a | n/a | 1245 / 0 | 0 | 0 / 100 | {"initial":100} | — |
| 1815 | put +5s | incumbent | 430 | 2268 / 3771 / 4447 | 0 | PASS | FAIL | — / 0 | 0 | 430 / 430 | {"notification":423,"periodic":7} | — |
| 1815 | put +5s | hold | 20 | 1885 / 3849 / 4443 | 0 | PASS | FAIL | — / 0 | 0 | 20 / 20 | {"retry":5,"notification":13,"resume":2} | — |
| 1815 | put +5s | ahead | 20 | 2244 / 3816 / 3918 | 0 | PASS | FAIL | — / 0 | 0 | 20 / 20 | {"notification":20} | — |
| 1815 | put +5s | r1-1 | 100 | 2216 / 3873 / 4345 | 0 | PASS | FAIL | — / 0 | 0 | 100 / 100 | {"notification":99,"periodic":1} | — |
| 1815 | put +5s | arrival-2 | 0 | — / — / — | 0 | n/a | n/a | 1245 / 0 | 0 | 0 / 100 | {"initial":100} | — |
| 1816 | put +11s | incumbent | 430 | 2627 / 3360 / 4553 | 0 | PASS | FAIL | — / 0 | 0 | 430 / 430 | {"notification":422,"periodic":8} | — |
| 1816 | put +11s | hold | 20 | 2787 / 3258 / 3487 | 0 | PASS | FAIL | — / 0 | 0 | 20 / 20 | {"notification":19,"periodic":1} | — |
| 1816 | put +11s | ahead | 20 | 2506 / 3159 / 3371 | 0 | PASS | FAIL | — / 0 | 0 | 20 / 20 | {"notification":20} | — |
| 1816 | put +11s | r1-1 | 100 | 2581 / 3379 / 4619 | 0 | PASS | FAIL | — / 0 | 0 | 100 / 100 | {"notification":98,"recheck":1,"periodic":1} | — |
| 1816 | put +11s | arrival-2 | 49 | 2080 / 3501 / 3589 | 0 | PASS | FAIL | 1866 / 0 | 0 | 100 / 100 | {"catchup":45,"notification":24,"initial":31} | — |
| 1817 | put +15s | incumbent | 430 | 1548 / 1937 / 2222 | 0 | PASS | PASS | — / 0 | 0 | 430 / 430 | {"notification":418,"periodic":11,"recheck":1} | — |
| 1817 | put +15s | hold | 20 | 1329 / 1493 / 1505 | 0 | PASS | PASS | — / 0 | 0 | 20 / 20 | {"notification":20} | — |
| 1817 | put +15s | ahead | 20 | 1274 / 1542 / 1557 | 0 | PASS | PASS | — / 0 | 0 | 20 / 20 | {"notification":18,"periodic":2} | — |
| 1817 | put +15s | r1-1 | 100 | 1716 / 1911 / 1941 | 0 | PASS | PASS | — / 0 | 0 | 100 / 100 | {"notification":96,"periodic":4} | — |
| 1817 | put +15s | arrival-2 | 100 | 1574 / 1722 / 1871 | 0 | PASS | PASS | — / 0 | 0 | 100 / 100 | {"notification":100} | — |
| 1818 | put +30s | incumbent | 430 | 1780 / 2446 / 3008 | 0 | PASS | PASS | — / 0 | 0 | 430 / 430 | {"notification":417,"periodic":13} | — |
| 1818 | put +30s | hold | 20 | 1495 / 2065 / 2131 | 0 | PASS | PASS | — / 0 | 0 | 20 / 20 | {"notification":20} | — |
| 1818 | put +30s | ahead | 20 | 1744 / 2893 / 3048 | 0 | PASS | PASS | — / 0 | 0 | 20 / 20 | {"notification":20} | — |
| 1818 | put +30s | r1-1 | 100 | 1941 / 2430 / 2705 | 0 | PASS | PASS | — / 0 | 0 | 100 / 100 | {"notification":98,"periodic":2} | — |
| 1818 | put +30s | arrival-2 | 100 | 1622 / 2449 / 2794 | 0 | PASS | PASS | — / 0 | 0 | 100 / 100 | {"notification":96,"periodic":4} | — |
| 1819 | put +60s | incumbent | 430 | 1874 / 2312 / 3253 | 0 | PASS | PASS | — / 0 | 0 | 430 / 430 | {"notification":420,"periodic":10} | — |
| 1819 | put +60s | hold | 20 | 1668 / 2241 / 2418 | 0 | PASS | PASS | — / 0 | 0 | 20 / 20 | {"notification":19,"periodic":1} | — |
| 1819 | put +60s | ahead | 20 | 1873 / 2400 / 2548 | 0 | PASS | PASS | — / 0 | 0 | 20 / 20 | {"notification":20} | — |
| 1819 | put +60s | r1-1 | 100 | 1996 / 2677 / 2794 | 0 | PASS | PASS | — / 0 | 0 | 100 / 100 | {"notification":98,"periodic":2} | — |
| 1819 | put +60s | arrival-2 | 100 | 1766 / 2404 / 3031 | 0 | PASS | PASS | — / 0 | 0 | 100 / 100 | {"notification":100} | — |
| 1820 | insert +70s | incumbent | 430 | 2290 / 3249 / 3321 | 0 | PASS | FAIL | — / 0 | 0 | 430 / 430 | {"notification":421,"periodic":9} | — |
| 1820 | insert +70s | hold | 20 | 1616 / 2129 / 2139 | 0 | PASS | PASS | — / 0 | 0 | 20 / 20 | {"notification":18,"periodic":2} | — |
| 1820 | insert +70s | ahead | 20 | 2226 / 2962 / 2968 | 0 | PASS | PASS | — / 0 | 0 | 20 / 20 | {"notification":20} | — |
| 1820 | insert +70s | r1-1 | 100 | 3107 / 3242 / 3263 | 0 | PASS | FAIL | — / 0 | 0 | 100 / 100 | {"notification":97,"periodic":3} | — |
| 1820 | insert +70s | arrival-2 | 100 | 2312 / 2475 / 2497 | 0 | PASS | PASS | — / 0 | 0 | 100 / 100 | {"notification":97,"periodic":3} | — |
| 1821 | update +80s | incumbent | 430 | 1688 / 2449 / 3028 | 0 | PASS | PASS | — / 0 | 0 | 430 / 430 | {"notification":421,"periodic":9} | — |
| 1821 | update +80s | hold | 20 | 1530 / 2632 / 2856 | 0 | PASS | PASS | — / 0 | 0 | 20 / 20 | {"notification":20} | — |
| 1821 | update +80s | ahead | 20 | 1809 / 2869 / 2988 | 0 | PASS | PASS | — / 0 | 0 | 20 / 20 | {"notification":20} | — |
| 1821 | update +80s | r1-1 | 100 | 2041 / 2840 / 3300 | 0 | PASS | PASS | — / 0 | 0 | 100 / 100 | {"notification":99,"periodic":1} | — |
| 1821 | update +80s | arrival-2 | 100 | 1561 / 2329 / 2833 | 0 | PASS | PASS | — / 0 | 0 | 100 / 100 | {"notification":100} | — |
| 1822 | delete +90s | incumbent | 430 | 1786 / 2509 / 3020 | 0 | PASS | PASS | — / 0 | 0 | 430 / 430 | {"notification":420,"periodic":10} | — |
| 1822 | delete +90s | hold | 20 | 1286 / 2503 / 2519 | 0 | PASS | PASS | — / 0 | 0 | 20 / 20 | {"notification":19,"periodic":1} | — |
| 1822 | delete +90s | ahead | 20 | 1732 / 2196 / 2250 | 0 | PASS | PASS | — / 0 | 0 | 20 / 20 | {"notification":20} | — |
| 1822 | delete +90s | r1-1 | 100 | 2067 / 2452 / 3079 | 0 | PASS | PASS | — / 0 | 0 | 100 / 100 | {"notification":94,"periodic":6} | — |
| 1822 | delete +90s | arrival-2 | 100 | 1667 / 2441 / 2825 | 0 | PASS | PASS | — / 0 | 0 | 100 / 100 | {"notification":95,"periodic":5} | — |

### R1 cohort — per save: postgres_changes receipt → fetch (serving deployment) → DOM

R1-build pages 18; per save only those whose postgres subscription was ready by the PUT start (receipts / pages). A receipt is this save's until the next save on the same row (≤ 30 s). Times from the save's PUT start (receipt, DOM) and from the receipt (fetch). Soft delete = UPDATE with isDeleted (U+del). DOM < 16 s = before the earliest periodic repair.

| save | op | rev | row | receipts / pages (type ok) | receipt types | PUT → receipt p50 / max ms | receipt → fetch p50 / max ms | fetches → deployment | PUT → DOM p50 / max ms (n) | DOM < 16 s |
|---|---|---|---|---|---|---|---|---|---|---|
| 2.8-insert | insert | 1820 | 2661 | 18 / 18 (18) | I | 2404 / 2405 | 658 / 713 | dpl_5nR6mGHXsx2z1TsgChikER9ZHB5q 18 | 2685 / 2915 (18) | 18/18 |
| 2.9-update | update | 1821 | 2661 | 18 / 18 (18) | U | 469 / 473 | 301 / 932 | unattributed 18 | 1104 / 2019 (18) | 18/18 |
| 2.10-delete | delete | 1822 | 2661 | 18 / 18 (18) | U+del | 1142 / 1143 | 135 / 251 | unattributed 18 | 1773 / 1917 (18) | 18/18 |

### Reactions / wishes smoke from old pages

| page | locale | type | harness checks | pass | sub-requests (status → serving deployment) |
|---|---|---|---|---|---|
| 0 | ja | surprise | submitted ✓, persisted ✓, refreshed ✓, identityRetained ✓, wish ✓, no5xx ✓ | true | post 200 → dpl_5nR6mGHXsx2z1TsgChikER9ZHB5q; counts 200 → dpl_5nR6mGHXsx2z1TsgChikER9ZHB5q; wish 403 → dpl_5nR6mGHXsx2z1TsgChikER9ZHB5q |
| 1 | ko | moved | submitted ✓, persisted ✓, refreshed ✓, identityRetained ✓, wish ✓, no5xx ✓ | true | post 200 → dpl_5nR6mGHXsx2z1TsgChikER9ZHB5q; counts 200 → dpl_5nR6mGHXsx2z1TsgChikER9ZHB5q; wish 403 → dpl_5nR6mGHXsx2z1TsgChikER9ZHB5q |
| 3 | en | waiting | submitted ✓, persisted ✓, refreshed ✓, identityRetained ✓, wish ✓, no5xx ✓ | true | post 200 → dpl_5nR6mGHXsx2z1TsgChikER9ZHB5q; counts 200 → dpl_5nR6mGHXsx2z1TsgChikER9ZHB5q; wish 403 → dpl_5nR6mGHXsx2z1TsgChikER9ZHB5q |

## Resources across deployments

Σ = sum of per-instance Prisma pool totals (vercel-logs-summary's estimator on the JSON export): 5 s buckets of per-instance MAXIMA (an upper bound within a bucket, not a simultaneous count), an instance carried ≤ 5 s after its last line, instances that never log a pool line are invisible; record times are request STARTS. An app-side estimate, not the pooler's own client count.

| deployment | Σ peak (carried / reported, instances) | at | writer lines | writer acquire max ms | EMAXCONN |
|---|---|---|---|---|---|
| dpl_F5VocFcajvm1wf2aFqdMaBNhHvaK | 33 / 33 (24) | 18:41:10.000 | 4 | 4 | 0 |
| dpl_GN57F4UStRok7DRsu9bJ4bn7Yzcd | 111 / 100 (58) | 18:41:25.000 | 8 | 472 | 0 |
| dpl_5nR6mGHXsx2z1TsgChikER9ZHB5q | 129 / 93 (78) | 18:45:25.000 | 5 | 73 | 0 |
| **combined** | 183 / 93 (109) | 18:45:25.000 | 17 | 472 | 0 |

| minute (UTC) | dpl_F5VocFcajvm1wf2aFqdMaBNhHvaK requests / builds | dpl_GN57F4UStRok7DRsu9bJ4bn7Yzcd requests / builds | dpl_5nR6mGHXsx2z1TsgChikER9ZHB5q requests / builds |
|---|---|---|---|
| 18:40 | 1371 / 253 | — | — |
| 18:41 | 1666 / 212 | 3855 / 1165 | — |
| 18:42 | — | 1574 / 613 | — |
| 18:44 | — | 1530 / 614 | — |
| 18:45 | 6 / 0 | 2249 / 638 | 4223 / 821 |
| 18:46 | — | — | 2585 / 342 |

## Harness provisional verdicts (verbatim)

```json
{
  "verdict": "VALID + FAIL",
  "exit": 1,
  "failed": [
    "switch 1 performance",
    "switch 1 arrivals",
    "switch 2 performance",
    "switch 2 arrivals"
  ],
  "notExercised": [
    "switch 1 pendingHinted",
    "switch 1 oldAnswer",
    "switch 1 arrivalSdk",
    "switch 2 pendingHinted",
    "switch 2 arrivalSdk"
  ]
}
```

