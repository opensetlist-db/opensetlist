# Step 6 transition join — step6-T0

- Inputs: tests/load/results/2026-10-12/2026-10-12T16-42-46-876Z-browsers-transition.json, dpl_FAt2Sp33CvHnRohZyHkH5bUHZ4X5=tests/load/results/2026-10-12/logs-step6-T0-dpl_FAt2Sp33CvHnRohZyHkH5bUHZ4X5.jsonl, tests/load/results/2026-10-12/switch-T0-1.json,tests/load/results/2026-10-12/switch-T0-2.json,tests/load/results/2026-10-12/switch-T0-3.json, tests/load/results/2026-10-12/step6-manifest-T0.json
- Base https://opensetlist-git-dev-opensetlist-projects.vercel.app; run 2026-10-12T16:31:17.856Z → 2026-10-12T16:42:45.667Z
- Clocks: harness, switch files (CLI start / end) and smoke = this laptop; log `timestamp` = Vercel edge arrival; writer `at` = the function. Propagation bounds use harness times only. Record − harness request start over 29451 matched responses: p5 -22 / p50 -18 / p95 1107 ms (min -2254, max 2521) — one-way latency plus clock offset; bounds closer than this spread are indeterminate.

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

Exported log windows (inferred from the records (union, 30 s gaps)): 16:32:49.133 → 16:34:43.894; 16:36:49.000 → 16:38:43.958; 16:40:49.066 → 16:42:43.998. Responses whose edge request time (from the request id) lies outside them are **not exported** (11883) — counted apart, outside every other column; coverage is over the exported windows only.
Incomplete log records (responseStatusCode 0, empty environment / cache, no nested lines; attributed by id / deployment / path, status not compared): 3 — sdk 197 qks5p-1791823011608-6387329ab706 (client saw 200); sdk 491 6nx92-1791823035711-b65c03fb6e70 (client saw 200); sdk 630 5jzh6-1791823284606-865567d6dc77 (client saw 200).

| population | not exported | responses (in windows) | with request id | matched | consistent (coverage) | inconsistent | unmatched | instrumentation (expected → present) | by deployment |
|---|---|---|---|---|---|---|---|---|---|
| document | 30 | 30 | 30 | 30 | 30 (100.0 %) | 0 | 0 | — | dpl_FAt2Sp33CvHnRohZyHkH5bUHZ4X5 30 |
| guard | 0 | 3 | 3 | 3 | 3 (100.0 %) | 0 | 0 | — | dpl_FAt2Sp33CvHnRohZyHkH5bUHZ4X5 3 |
| page | 740 | 1958 | 1958 | 1949 | 1949 (99.5 %) | 0 | 9 | 1127 → 1127 | dpl_FAt2Sp33CvHnRohZyHkH5bUHZ4X5 1949, (unmatched) 9 |
| probe | 304 | 340 | 340 | 340 | 340 (100.0 %) | 0 | 0 | 340 → 340 | dpl_FAt2Sp33CvHnRohZyHkH5bUHZ4X5 340 |
| route | 1 | 485 | 485 | 485 | 485 (100.0 %) | 0 | 0 | — | dpl_FAt2Sp33CvHnRohZyHkH5bUHZ4X5 485 |
| save | 0 | 24 | 24 | 24 | 24 (100.0 %) | 0 | 0 | 24 → 24 | dpl_FAt2Sp33CvHnRohZyHkH5bUHZ4X5 24 |
| sdk | 10059 | 25093 | 25093 | 24985 | 24985 (99.6 %) | 0 | 108 | 14455 → 14455 | dpl_FAt2Sp33CvHnRohZyHkH5bUHZ4X5 24985, (unmatched) 108 |
| sdk/ahead | 378 | 840 | 840 | 838 | 838 (99.8 %) | 0 | 2 | 498 → 498 | dpl_FAt2Sp33CvHnRohZyHkH5bUHZ4X5 838, (unmatched) 2 |
| sdk/hold | 371 | 771 | 771 | 770 | 770 (99.9 %) | 0 | 1 | 359 → 359 | dpl_FAt2Sp33CvHnRohZyHkH5bUHZ4X5 770, (unmatched) 1 |
| smoke | 0 | 27 | 27 | 27 | 27 (100.0 %) | 0 | 0 | — | dpl_FAt2Sp33CvHnRohZyHkH5bUHZ4X5 27 |
| ALL | 11883 | 29571 | 29571 | 29451 | 29451 (99.6 %) | 0 | 120 | 16803 → 16803 | dpl_FAt2Sp33CvHnRohZyHkH5bUHZ4X5 29451, (unmatched) 120 |

| deployment | log records | matched responses | consistent | first record | last record |
|---|---|---|---|---|---|
| dpl_FAt2Sp33CvHnRohZyHkH5bUHZ4X5 | 30553 | 29451 | 29451 | 2026-10-12T16:32:49.133Z | 2026-10-12T16:42:43.998Z |

Pin evidence per population (request-side): `x-deployment-id` header / `__vdpl` cookie / `dpl` query / none.

| population | n | header | cookie | query | none |
|---|---|---|---|---|---|
| probe | 644 | 0 | 0 | 0 | 644 |
| route | 486 | 0 | 0 | 0 | 486 |
| guard | 3 | 0 | 0 | 0 | 3 |
| smoke | 27 | 0 | 0 | 0 | 27 |
| save | 24 | 0 | 0 | 0 | 24 |
| sdk | 37512 | 0 | 0 | 0 | 37512 |
| page | 2698 | 0 | 0 | 0 | 2698 |
| document | 60 | 0 | 0 | 0 | 60 |

### Not attributed (120)

By reason: no log record with this id 120. Within 5 s of an exported-window edge: 0/120.

| population | client | request start | edge time (id) | Δ to window edge | Δ to nearest cliStart | status | path | request id | why |
|---|---|---|---|---|---|---|---|---|---|
| sdk | 11 | 16:41:44.500 | 16:41:44.580 | 55514 ms | switch 3: +15303 ms | 200 | /api/setlist | 8nz4h-1791823304580-f71a8fd5c8d2 | no log record with this id |
| sdk | 14 | 16:41:44.516 | 16:41:44.580 | 55514 ms | switch 3: +15319 ms | 200 | /api/setlist | gpncz-1791823304580-8ab52911f8a4 | no log record with this id |
| sdk | 17 | 16:41:44.578 | 16:41:44.584 | 55518 ms | switch 3: +15381 ms | 200 | /api/setlist | 7k6mb-1791823304584-04055ea1a963 | no log record with this id |
| sdk | 20 | 16:41:44.547 | 16:41:44.584 | 55518 ms | switch 3: +15350 ms | 200 | /api/setlist | 92cnt-1791823304584-4d9127624734 | no log record with this id |
| sdk | 32 | 16:41:44.485 | 16:41:44.580 | 55514 ms | switch 3: +15288 ms | 200 | /api/setlist | 92cnt-1791823304580-7a8c94c0373d | no log record with this id |
| sdk | 55 | 16:41:44.516 | 16:41:44.580 | 55514 ms | switch 3: +15319 ms | 200 | /api/setlist | h69c9-1791823304580-d849c91f981e | no log record with this id |
| sdk | 65 | 16:41:44.500 | 16:41:44.580 | 55514 ms | switch 3: +15303 ms | 200 | /api/setlist | bf2t7-1791823304580-74780ee1920f | no log record with this id |
| sdk | 76 | 16:41:44.548 | 16:41:44.584 | 55518 ms | switch 3: +15351 ms | 200 | /api/setlist | 2hrjx-1791823304584-deb378aba64a | no log record with this id |
| sdk | 86 | 16:41:44.578 | 16:41:44.584 | 55518 ms | switch 3: +15381 ms | 200 | /api/setlist | 9hn4p-1791823304584-f97821e4c1da | no log record with this id |
| sdk | 88 | 16:41:44.485 | 16:41:44.580 | 55514 ms | switch 3: +15288 ms | 200 | /api/setlist | dfqgj-1791823304580-ab84079c88eb | no log record with this id |
| sdk | 98 | 16:41:44.546 | 16:41:44.580 | 55514 ms | switch 3: +15349 ms | 200 | /api/setlist | 4lv85-1791823304580-f53e141ba4c9 | no log record with this id |
| sdk | 102 | 16:41:44.746 | 16:41:44.812 | 55746 ms | switch 3: +15549 ms | 200 | /api/setlist | 498vq-1791823304812-a43deaa5618d | no log record with this id |
| sdk | 105 | 16:41:44.601 | 16:41:44.584 | 55518 ms | switch 3: +15404 ms | 200 | /api/setlist | 752x7-1791823304584-4a75d088dd5c | no log record with this id |
| sdk | 108 | 16:41:44.761 | 16:41:44.811 | 55745 ms | switch 3: +15564 ms | 200 | /api/setlist | 8gpxz-1791823304811-a2b7687d0c78 | no log record with this id |
| sdk | 114 | 16:41:44.779 | 16:41:44.811 | 55745 ms | switch 3: +15582 ms | 200 | /api/setlist | 6j9m6-1791823304811-769d038eeb64 | no log record with this id |
| sdk | 116 | 16:41:44.562 | 16:41:44.580 | 55514 ms | switch 3: +15365 ms | 200 | /api/setlist | 9ctkl-1791823304580-d7faac56d42a | no log record with this id |
| sdk | 117 | 16:41:44.778 | 16:41:44.811 | 55745 ms | switch 3: +15581 ms | 200 | /api/setlist | 7vpfr-1791823304811-2955f6af7363 | no log record with this id |
| sdk | 127 | 16:41:44.716 | 16:41:44.811 | 55745 ms | switch 3: +15519 ms | 200 | /api/setlist | 77bfx-1791823304811-0037e7ff305a | no log record with this id |
| sdk | 138 | 16:41:44.578 | 16:41:44.584 | 55518 ms | switch 3: +15381 ms | 200 | /api/setlist | bzc9c-1791823304584-4236d738f475 | no log record with this id |
| sdk | 142 | 16:41:44.500 | 16:41:44.580 | 55514 ms | switch 3: +15303 ms | 200 | /api/setlist | 7fhjq-1791823304580-408bd1943e95 | no log record with this id |
| sdk | 160 | 16:41:44.578 | 16:41:44.580 | 55514 ms | switch 3: +15381 ms | 200 | /api/setlist | 6h7w5-1791823304580-4a7bbda82146 | no log record with this id |
| sdk | 163 | 16:41:44.746 | 16:41:44.811 | 55745 ms | switch 3: +15549 ms | 200 | /api/setlist | 6j7n2-1791823304811-f7d07715a2f2 | no log record with this id |
| sdk | 164 | 16:41:44.778 | 16:41:44.811 | 55745 ms | switch 3: +15581 ms | 200 | /api/setlist | 9cqpl-1791823304811-9ed9db352586 | no log record with this id |
| sdk | 171 | 16:41:44.592 | 16:41:44.584 | 55518 ms | switch 3: +15395 ms | 200 | /api/setlist | 5clzw-1791823304584-464cc5e83394 | no log record with this id |
| sdk | 172 | 16:41:44.732 | 16:41:44.811 | 55745 ms | switch 3: +15535 ms | 200 | /api/setlist | 22lgd-1791823304811-bd62f4dde4dd | no log record with this id |
| sdk | 178 | 16:41:44.515 | 16:41:44.580 | 55514 ms | switch 3: +15318 ms | 200 | /api/setlist | jkcn9-1791823304580-c2aabcc50655 | no log record with this id |
| sdk | 187 | 16:41:44.731 | 16:41:44.811 | 55745 ms | switch 3: +15534 ms | 200 | /api/setlist | 74q77-1791823304811-d31fe2a86b42 | no log record with this id |
| sdk | 191 | 16:41:44.485 | 16:41:44.580 | 55514 ms | switch 3: +15288 ms | 200 | /api/setlist | bw62m-1791823304580-dad5e8837786 | no log record with this id |
| sdk | 195 | 16:41:44.499 | 16:41:44.580 | 55514 ms | switch 3: +15302 ms | 200 | /api/setlist | 98tqr-1791823304580-0709c1e2c76c | no log record with this id |
| sdk | 204 | 16:41:44.603 | 16:41:44.584 | 55518 ms | switch 3: +15406 ms | 200 | /api/setlist | 46gmq-1791823304584-494e9b285f59 | no log record with this id |
| sdk | 209 | 16:41:44.546 | 16:41:44.580 | 55514 ms | switch 3: +15349 ms | 200 | /api/setlist | 95vds-1791823304580-9ab5caa83d0f | no log record with this id |
| sdk | 214 | 16:41:44.731 | 16:41:44.811 | 55745 ms | switch 3: +15534 ms | 200 | /api/setlist | 98tqr-1791823304811-17584a49cbbf | no log record with this id |
| sdk | 223 | 16:41:44.563 | 16:41:44.580 | 55514 ms | switch 3: +15366 ms | 200 | /api/setlist | 9zlz8-1791823304580-92cffaf25b0b | no log record with this id |
| sdk | 226 | 16:41:44.484 | 16:41:44.580 | 55514 ms | switch 3: +15287 ms | 200 | /api/setlist | 44kj9-1791823304580-6d229652df80 | no log record with this id |
| sdk | 227 | 16:41:44.578 | 16:41:44.584 | 55518 ms | switch 3: +15381 ms | 200 | /api/setlist | bgktb-1791823304584-6cc7a0438a5f | no log record with this id |
| sdk | 229 | 16:41:44.515 | 16:41:44.580 | 55514 ms | switch 3: +15318 ms | 200 | /api/setlist | gmsvf-1791823304580-38686b556881 | no log record with this id |
| sdk | 239 | 16:41:40.663 | 16:41:40.691 | 51625 ms | switch 3: +11466 ms | 200 | /api/setlist | 2jxvs-1791823300691-94eadd307147 | no log record with this id |
| sdk | 261 | 16:41:44.547 | 16:41:44.580 | 55514 ms | switch 3: +15350 ms | 200 | /api/setlist | gv2tl-1791823304580-afa90dd36831 | no log record with this id |
| sdk | 266 | 16:41:44.484 | 16:41:44.580 | 55514 ms | switch 3: +15287 ms | 200 | /api/setlist | 9xvht-1791823304580-59643fefb297 | no log record with this id |
| sdk | 270 | 16:41:44.499 | 16:41:44.580 | 55514 ms | switch 3: +15302 ms | 200 | /api/setlist | 9fmnq-1791823304580-ba99dabcd5d0 | no log record with this id |
| sdk | 285 | 16:41:44.762 | 16:41:44.811 | 55745 ms | switch 3: +15565 ms | 200 | /api/setlist | 85tc5-1791823304811-937319466459 | no log record with this id |
| sdk | 286 | 16:41:44.578 | 16:41:44.584 | 55518 ms | switch 3: +15381 ms | 200 | /api/setlist | bf2t7-1791823304584-9bcaeb1fda91 | no log record with this id |
| sdk | 288 | 16:41:44.563 | 16:41:44.584 | 55518 ms | switch 3: +15366 ms | 200 | /api/setlist | br86l-1791823304584-b5a263080a6f | no log record with this id |
| sdk | 293 | 16:41:44.531 | 16:41:44.580 | 55514 ms | switch 3: +15334 ms | 200 | /api/setlist | 2v225-1791823304580-e16b5729f80e | no log record with this id |
| sdk | 297 | 16:41:44.593 | 16:41:44.584 | 55518 ms | switch 3: +15396 ms | 200 | /api/setlist | b4tgv-1791823304584-cb86bbf8b421 | no log record with this id |
| sdk | 298 | 16:41:44.485 | 16:41:44.580 | 55514 ms | switch 3: +15288 ms | 200 | /api/setlist | gv2tl-1791823304580-6d0bbf348167 | no log record with this id |
| sdk | 308 | 16:41:44.578 | 16:41:44.584 | 55518 ms | switch 3: +15381 ms | 200 | /api/setlist | 4dhhg-1791823304584-51a641029d31 | no log record with this id |
| sdk | 313 | 16:41:44.530 | 16:41:44.580 | 55514 ms | switch 3: +15333 ms | 200 | /api/setlist | 7fhjq-1791823304580-e47a70b4a224 | no log record with this id |
| sdk | 322 | 16:41:40.680 | 16:41:40.691 | 51625 ms | switch 3: +11483 ms | 200 | /api/setlist | 47qdh-1791823300691-06d679a82c0b | no log record with this id |
| sdk | 327 | 16:41:44.578 | 16:41:44.584 | 55518 ms | switch 3: +15381 ms | 200 | /api/setlist | 4hfvv-1791823304584-3c857566a3ce | no log record with this id |
| sdk | 328 | 16:41:44.562 | 16:41:44.584 | 55518 ms | switch 3: +15365 ms | 200 | /api/setlist | 6h7w5-1791823304584-2f38c615081a | no log record with this id |
| sdk | 348 | 16:41:44.600 | 16:41:44.584 | 55518 ms | switch 3: +15403 ms | 200 | /api/setlist | 77bfx-1791823304584-4baf43400fe4 | no log record with this id |
| sdk | 354 | 16:41:44.731 | 16:41:44.811 | 55745 ms | switch 3: +15534 ms | 200 | /api/setlist | 2jxvs-1791823304811-168b340fb2a1 | no log record with this id |
| sdk | 356 | 16:41:44.593 | 16:41:44.584 | 55518 ms | switch 3: +15396 ms | 200 | /api/setlist | bmr4n-1791823304584-f3f60ca07a97 | no log record with this id |
| sdk | 358 | 16:41:44.531 | 16:41:44.580 | 55514 ms | switch 3: +15334 ms | 200 | /api/setlist | h8v4h-1791823304580-4a1e19aa936d | no log record with this id |
| sdk | 360 | 16:41:44.485 | 16:41:44.580 | 55514 ms | switch 3: +15288 ms | 200 | /api/setlist | ftdlz-1791823304580-c1dd94c2d2fa | no log record with this id |
| sdk | 367 | 16:41:44.484 | 16:41:44.580 | 55514 ms | switch 3: +15287 ms | 200 | /api/setlist | 9fmnq-1791823304580-25b14847cc82 | no log record with this id |
| sdk | 382 | 16:41:44.715 | 16:41:44.811 | 55745 ms | switch 3: +15518 ms | 200 | /api/setlist | 2kbf5-1791823304811-b13a2b27694d | no log record with this id |
| sdk | 384 | 16:41:44.500 | 16:41:44.580 | 55514 ms | switch 3: +15303 ms | 200 | /api/setlist | g5cjc-1791823304580-41db4ff95d85 | no log record with this id |
| sdk | 402 | 16:41:44.546 | 16:41:44.584 | 55518 ms | switch 3: +15349 ms | 200 | /api/setlist | djqrm-1791823304584-c554d086cb5c | no log record with this id |
| … 60 more (JSON) | | | | | | | | | |

## switch 1 (pseudo): dpl_FAt2Sp33CvHnRohZyHkH5bUHZ4X5 → dpl_FAt2Sp33CvHnRohZyHkH5bUHZ4X5

- planned 2026-10-12T16:33:29.000Z; CLI 16:33:29.081 → 16:33:32.841 (3760 ms, CPU 272 ms); target https://opensetlist-6l87uqc8o-opensetlist-projects.vercel.app

### Propagation — **EXERCISED**

| population | requests | → target | → old | → other | unmatched (in windows) | not exported | first target response (start → end) | last old request start | last old response end | old starts after cliStart |
|---|---|---|---|---|---|---|---|---|---|---|
| probe | 125 | 72 | 0 | 0 | 0 | 15 | 16:33:32.867 → 16:33:33.039 | — | — | 0 |
| route | 162 | 134 | 0 | 0 | 0 | 0 | 16:33:33.011 → 16:33:33.336 | — | — | 0 |
| sdk | 7508 | 4822 | 0 | 0 | 0 | 402 | 16:33:32.867 → 16:33:33.039 | — | — | 0 |
| page | 503 | 320 | 0 | 0 | 0 | 34 | 16:33:33.266 → 16:33:33.452 | — | — | 0 |
| document | 10 | 10 | 0 | 0 | 0 | 0 | 16:33:40.074 → 16:33:40.074 | — | — | 0 |
| all | 8308 | 5358 | 0 | 0 | 0 | 451 | 16:33:32.867 → 16:33:33.039 | — | — | 0 |

- Pseudo-switch (target = the serving deployment): no old deployment; "first target response" = first response whose request started after cliEnd; old-side bounds n/a.
- Sustained target routing over [cliEnd, cliEnd + 60 s] (probe): **yes** — 60 probe request(s), off-target after the first target probe 0, steady on the target from 16:33:32.867 (cliEnd +26 ms), largest probe gap 1028 ms.
- Harness provisional (live data-dpl-id route marker, no logs) — replaced by the bounds above: boundary 16:33:33.336 (route marker (data-dpl-id)); first target live 16:33:33.011 → 16:33:33.336 (pseudo: first marker started after cliEnd); routing sustained true, in window 121, off-target 0, last old start —, last old response —. Log-attributed first target response (all alias populations): 16:33:33.039 (-297 ms vs the harness boundary).
- Harness verdicts: {"continuity":"PASS","performance":"PASS","arrivals":"FAIL","smoke":"PASS","guard":"PASS"}; exposure {"pendingHinted":"NOT EXERCISED","oldAnswer":"EXERCISED","arrivalSdk":"NOT EXERCISED","arrivalPages":"EXERCISED"}

### Exposure (first attributed target response 16:33:33.039)

| exposure | measured | min | result | detail |
|---|---|---|---|---|
| pending hinted fetch (natural SDK) | 0 clients | 20 | **NOT EXERCISED** | 0 req; old-attributed 0, unmatched 0; after T: headers 0, body 0, eval 0, settled 0; subsets {"hold":13} |
| pending recheck (controlled) | 0 clients | 5 | **NOT EXERCISED** | queued 0, dispatched 0 (recheck responses of the controlled subset) |
| old answer after cutover → converged | 20 / 20 clients | 5 | **EXERCISED** | natural 0, controlled 20; regression check: n/a here (no appliedAll in the client records; the harness's monotonicity check covers it) |
| arrival save rev 1748 (+11 s) SDK | 0 / 100 not joined at PUT response | 20 | **NOT EXERCISED** | |
| arrival save rev 1748 pages | 1 / 10 incomplete | 3 | **NOT EXERCISED** | |
| arrival save rev 1749 (+15 s) SDK | 0 / 100 not joined at PUT response | 20 | **NOT EXERCISED** | |
| arrival save rev 1749 pages | 0 / 10 incomplete | 3 | **NOT EXERCISED** | |

### Target role evidence — ON (warming expected): **warm jobs seen**

- manifest role ON-A, LIVE_WARM_ENTRIES 1; 30553 log record(s) for the deployment
- saves in the leg 8: served by the target 8 (with writer line 8), not attributed 0; hinted reads 4376, not attributed inside the exported windows 0, outside them 15
- saves → serving deployment: put -30s rev 1744 → dpl_FAt2Sp33CvHnRohZyHkH5bUHZ4X5 ✓writer; put -1s rev 1745 → dpl_FAt2Sp33CvHnRohZyHkH5bUHZ4X5 ✓writer; put 1s rev 1746 → dpl_FAt2Sp33CvHnRohZyHkH5bUHZ4X5 ✓writer; put 5s rev 1747 → dpl_FAt2Sp33CvHnRohZyHkH5bUHZ4X5 ✓writer; put 11s rev 1748 → dpl_FAt2Sp33CvHnRohZyHkH5bUHZ4X5 ✓writer; put 15s rev 1749 → dpl_FAt2Sp33CvHnRohZyHkH5bUHZ4X5 ✓writer; put 30s rev 1750 → dpl_FAt2Sp33CvHnRohZyHkH5bUHZ4X5 ✓writer; put 60s rev 1751 → dpl_FAt2Sp33CvHnRohZyHkH5bUHZ4X5 ✓writer
- `[liveWarm] start` 26; any `[liveWarm]` 130; warm-lookup lines 16779; `source=warm` responses 16435; responses with a verify header 28885

### Continuity / performance per save and SDK group

Eligible = subscribed by the first save attempt; continuity = every eligible client at ≥ rev within 30 s of it (proposed operational acceptance); performance = p95 ≤ 3 s (kept visible). Joined-after clients are timed from max(join, PUT response).

| save rev | label | group | eligible | p50 / p95 / max ms | missing @30 s | continuity | p95 ≤ 3 s | joined after p95 / missing | not joined | broadcast received / pop. | applying fetch reasons | regressions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1744 | put -30s | incumbent | 430 | 1547 / 2284 / 3142 | 0 | PASS | PASS | — / 0 | 0 | 430 / 430 | {"notification":418,"periodic":12} | — |
| 1744 | put -30s | hold | 20 | 1393 / 1593 / 2427 | 0 | PASS | PASS | — / 0 | 0 | 20 / 20 | {"notification":19,"periodic":1} | — |
| 1744 | put -30s | ahead | 20 | 1602 / 2372 / 2481 | 0 | PASS | PASS | — / 0 | 0 | 20 / 20 | {"notification":20} | — |
| 1745 | put -1s | incumbent | 430 | 1755 / 2989 / 3397 | 0 | PASS | PASS | — / 0 | 0 | 430 / 430 | {"notification":420,"periodic":10} | — |
| 1745 | put -1s | hold | 20 | 5539 / 5855 / 5913 | 0 | PASS | FAIL | — / 0 | 0 | 20 / 20 | {"resume":4,"notification":16} | — |
| 1745 | put -1s | ahead | 20 | 1646 / 2768 / 3010 | 0 | PASS | PASS | — / 0 | 0 | 20 / 20 | {"notification":20} | — |
| 1745 | put -1s | arrival-1 | 0 | — / — / — | 0 | n/a | n/a | 299 / 0 | 0 | 0 / 100 | {"initial":100} | — |
| 1746 | put +1s | incumbent | 430 | 1141 / 1412 / 1713 | 0 | PASS | PASS | — / 0 | 0 | 430 / 430 | {"notification":419,"periodic":11} | — |
| 1746 | put +1s | hold | 20 | 3854 / 3916 / 3919 | 0 | PASS | FAIL | — / 0 | 0 | 20 / 20 | {"notification":5,"resume":10,"periodic":5} | — |
| 1746 | put +1s | ahead | 20 | 1047 / 1246 / 1524 | 0 | PASS | PASS | — / 0 | 0 | 20 / 20 | {"periodic":1,"notification":19} | — |
| 1746 | put +1s | arrival-1 | 0 | — / — / — | 0 | n/a | n/a | 299 / 0 | 0 | 0 / 100 | {"initial":100} | — |
| 1747 | put +5s | incumbent | 430 | 1318 / 1660 / 1762 | 0 | PASS | PASS | — / 0 | 0 | 430 / 430 | {"periodic":12,"notification":418} | — |
| 1747 | put +5s | hold | 20 | 1006 / 1174 / 1190 | 0 | PASS | PASS | — / 0 | 0 | 20 / 20 | {"notification":20} | — |
| 1747 | put +5s | ahead | 20 | 1232 / 1568 / 1669 | 0 | PASS | PASS | — / 0 | 0 | 20 / 20 | {"notification":19,"periodic":1} | — |
| 1747 | put +5s | arrival-1 | 0 | — / — / — | 0 | n/a | n/a | 299 / 0 | 0 | 0 / 100 | {"initial":100} | — |
| 1748 | put +11s | incumbent | 430 | 2176 / 2556 / 3281 | 0 | PASS | PASS | — / 0 | 0 | 430 / 430 | {"notification":418,"periodic":12} | — |
| 1748 | put +11s | hold | 20 | 2136 / 2430 / 2461 | 0 | PASS | PASS | — / 0 | 0 | 20 / 20 | {"notification":20} | — |
| 1748 | put +11s | ahead | 20 | 2289 / 2545 / 3399 | 0 | PASS | PASS | — / 0 | 0 | 20 / 20 | {"notification":19,"periodic":1} | — |
| 1748 | put +11s | arrival-1 | 50 | 2197 / 2451 / 3224 | 0 | PASS | PASS | 1319 / 0 | 0 | 100 / 100 | {"notification":50,"catchup":50} | — |
| 1749 | put +15s | incumbent | 430 | 1238 / 1478 / 2005 | 0 | PASS | PASS | — / 0 | 0 | 430 / 430 | {"notification":418,"periodic":12} | — |
| 1749 | put +15s | hold | 20 | 983 / 1127 / 1707 | 0 | PASS | PASS | — / 0 | 0 | 20 / 20 | {"notification":19,"periodic":1} | — |
| 1749 | put +15s | ahead | 20 | 1056 / 1255 / 1260 | 0 | PASS | PASS | — / 0 | 0 | 20 / 20 | {"notification":19,"periodic":1} | — |
| 1749 | put +15s | arrival-1 | 100 | 1345 / 1440 / 1707 | 0 | PASS | PASS | — / 0 | 0 | 100 / 100 | {"notification":100} | — |
| 1750 | put +30s | incumbent | 430 | 1598 / 2078 / 2845 | 0 | PASS | PASS | — / 0 | 0 | 430 / 430 | {"notification":418,"periodic":12} | — |
| 1750 | put +30s | hold | 20 | 1283 / 1879 / 2493 | 0 | PASS | PASS | — / 0 | 0 | 20 / 20 | {"notification":17,"periodic":3} | — |
| 1750 | put +30s | ahead | 20 | 1453 / 1881 / 1991 | 0 | PASS | PASS | — / 0 | 0 | 20 / 20 | {"notification":20} | — |
| 1750 | put +30s | arrival-1 | 100 | 1425 / 1985 / 2138 | 0 | PASS | PASS | — / 0 | 0 | 100 / 100 | {"notification":95,"periodic":5} | — |
| 1751 | put +60s | incumbent | 430 | 1595 / 2522 / 2673 | 0 | PASS | PASS | — / 0 | 0 | 430 / 430 | {"notification":423,"periodic":7} | — |
| 1751 | put +60s | hold | 20 | 1476 / 2417 / 2498 | 0 | PASS | PASS | — / 0 | 0 | 20 / 20 | {"notification":20} | — |
| 1751 | put +60s | ahead | 20 | 1636 / 2605 / 2616 | 0 | PASS | PASS | — / 0 | 0 | 20 / 20 | {"notification":20} | — |
| 1751 | put +60s | arrival-1 | 100 | 1696 / 2532 / 2664 | 0 | PASS | PASS | — / 0 | 0 | 100 / 100 | {"notification":100} | — |

### Reactions / wishes smoke from old pages

| page | locale | type | harness checks | pass | sub-requests (status → serving deployment) |
|---|---|---|---|---|---|
| 0 | ja | best | submitted ✓, persisted ✓, refreshed ✓, identityRetained ✓, wish ✓, no5xx ✓ | true | post 200 → dpl_FAt2Sp33CvHnRohZyHkH5bUHZ4X5; counts 200 → dpl_FAt2Sp33CvHnRohZyHkH5bUHZ4X5; wish 403 → dpl_FAt2Sp33CvHnRohZyHkH5bUHZ4X5 |
| 1 | ko | surprise | submitted ✓, persisted ✓, refreshed ✓, identityRetained ✓, wish ✓, no5xx ✓ | true | post 200 → dpl_FAt2Sp33CvHnRohZyHkH5bUHZ4X5; counts 200 → dpl_FAt2Sp33CvHnRohZyHkH5bUHZ4X5; wish 403 → dpl_FAt2Sp33CvHnRohZyHkH5bUHZ4X5 |
| 3 | en | moved | submitted ✓, persisted ✓, refreshed ✓, identityRetained ✓, wish ✓, no5xx ✓ | true | post 200 → dpl_FAt2Sp33CvHnRohZyHkH5bUHZ4X5; counts 200 → dpl_FAt2Sp33CvHnRohZyHkH5bUHZ4X5; wish 403 → dpl_FAt2Sp33CvHnRohZyHkH5bUHZ4X5 |

## switch 2 (pseudo): dpl_FAt2Sp33CvHnRohZyHkH5bUHZ4X5 → dpl_FAt2Sp33CvHnRohZyHkH5bUHZ4X5

- planned 2026-10-12T16:37:29.000Z; CLI 16:37:29.126 → 16:37:57.075 (27949 ms, CPU 287 ms); target https://opensetlist-6l87uqc8o-opensetlist-projects.vercel.app

### Propagation — **NOT EXERCISED** (13/98 defining probe request(s) not attributed)

| population | requests | → target | → old | → other | unmatched (in windows) | not exported | first target response (start → end) | last old request start | last old response end | old starts after cliStart |
|---|---|---|---|---|---|---|---|---|---|---|
| probe | 125 | 47 | 0 | 0 | 0 | 15 | 16:37:57.858 → 16:37:58.162 | — | — | 0 |
| route | 162 | 85 | 0 | 0 | 0 | 0 | 16:37:57.516 → 16:37:57.972 | — | — | 0 |
| sdk | 8787 | 2918 | 0 | 0 | 0 | 491 | 16:37:57.076 → 16:37:57.316 | — | — | 0 |
| page | 650 | 210 | 0 | 0 | 0 | 42 | 16:37:57.597 → 16:37:57.762 | — | — | 0 |
| document | 10 | 0 | 0 | 0 | 0 | 0 | — | — | — | 0 |
| all | 9734 | 3260 | 0 | 0 | 0 | 548 | 16:37:57.076 → 16:37:57.316 | — | — | 0 |

- Pseudo-switch (target = the serving deployment): no old deployment; "first target response" = first response whose request started after cliEnd; old-side bounds n/a.
- Sustained target routing over [cliEnd, cliEnd + 60 s] (probe): **no** — 60 probe request(s), off-target after the first target probe 0, steady on the target from 16:37:57.858 (cliEnd +783 ms), largest probe gap 1013 ms.
- Defining probe requests not attributed: 16:38:44.861 (outside the exported log windows); 16:38:45.860 (outside the exported log windows); 16:38:46.858 (outside the exported log windows); 16:38:47.862 (outside the exported log windows); 16:38:48.856 (outside the exported log windows); 16:38:49.859 (outside the exported log windows); 16:38:50.866 (outside the exported log windows); 16:38:51.860 (outside the exported log windows); 16:38:52.854 (outside the exported log windows); 16:38:53.867 (outside the exported log windows); 16:38:54.857 (outside the exported log windows); 16:38:55.861 (outside the exported log windows); 16:38:56.867 (outside the exported log windows)
- Harness provisional (live data-dpl-id route marker, no logs) — replaced by the bounds above: boundary 16:37:57.972 (route marker (data-dpl-id)); first target live 16:37:57.516 → 16:37:57.972 (pseudo: first marker started after cliEnd); routing sustained null, in window 84, off-target 0, last old start —, last old response —. Log-attributed first target response (all alias populations): 16:37:57.316 (-656 ms vs the harness boundary).
- Harness verdicts: {"continuity":"PASS","performance":"PASS","arrivals":"FAIL","smoke":"PASS","guard":"PASS"}; exposure {"pendingHinted":"NOT EXERCISED","oldAnswer":"NOT EXERCISED","arrivalSdk":"EXERCISED","arrivalPages":"EXERCISED"}

### Exposure (first attributed target response 16:37:57.316)

| exposure | measured | min | result | detail |
|---|---|---|---|---|
| pending hinted fetch (natural SDK) | 0 clients | 20 | **NOT EXERCISED** | 0 req; old-attributed 0, unmatched 0; after T: headers 0, body 0, eval 0, settled 0; subsets {} |
| pending recheck (controlled) | 0 clients | 5 | **NOT EXERCISED** | queued 0, dispatched 0 (recheck responses of the controlled subset) |
| old answer after cutover → converged | 0 / 0 clients | 5 | **NOT EXERCISED** | natural 0, controlled 0; regression check: n/a here (no appliedAll in the client records; the harness's monotonicity check covers it) |
| arrival save rev 1756 (+11 s) SDK | 100 / 100 not joined at PUT response | 20 | **EXERCISED** | |
| arrival save rev 1756 pages | 0 / 10 incomplete | 3 | **NOT EXERCISED** | |
| arrival save rev 1757 (+15 s) SDK | 0 / 100 not joined at PUT response | 20 | **NOT EXERCISED** | |
| arrival save rev 1757 pages | 0 / 10 incomplete | 3 | **NOT EXERCISED** | |

### Target role evidence — ON (warming expected): **warm jobs seen**

- manifest role ON-A, LIVE_WARM_ENTRIES 1; 30553 log record(s) for the deployment
- saves in the leg 8: served by the target 8 (with writer line 8), not attributed 0; hinted reads 5119, not attributed inside the exported windows 0, outside them 15
- saves → serving deployment: put -30s rev 1752 → dpl_FAt2Sp33CvHnRohZyHkH5bUHZ4X5 ✓writer; put -1s rev 1753 → dpl_FAt2Sp33CvHnRohZyHkH5bUHZ4X5 ✓writer; put 1s rev 1754 → dpl_FAt2Sp33CvHnRohZyHkH5bUHZ4X5 ✓writer; put 5s rev 1755 → dpl_FAt2Sp33CvHnRohZyHkH5bUHZ4X5 ✓writer; put 11s rev 1756 → dpl_FAt2Sp33CvHnRohZyHkH5bUHZ4X5 ✓writer; put 15s rev 1757 → dpl_FAt2Sp33CvHnRohZyHkH5bUHZ4X5 ✓writer; put 30s rev 1758 → dpl_FAt2Sp33CvHnRohZyHkH5bUHZ4X5 ✓writer; put 60s rev 1759 → dpl_FAt2Sp33CvHnRohZyHkH5bUHZ4X5 ✓writer
- `[liveWarm] start` 26; any `[liveWarm]` 130; warm-lookup lines 16779; `source=warm` responses 16435; responses with a verify header 28885

### Continuity / performance per save and SDK group

Eligible = subscribed by the first save attempt; continuity = every eligible client at ≥ rev within 30 s of it (proposed operational acceptance); performance = p95 ≤ 3 s (kept visible). Joined-after clients are timed from max(join, PUT response).

| save rev | label | group | eligible | p50 / p95 / max ms | missing @30 s | continuity | p95 ≤ 3 s | joined after p95 / missing | not joined | broadcast received / pop. | applying fetch reasons | regressions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1752 | put -30s | incumbent | 430 | 1727 / 2595 / 3040 | 0 | PASS | PASS | — / 0 | 0 | 430 / 430 | {"notification":421,"periodic":9} | — |
| 1752 | put -30s | hold | 20 | 1712 / 2001 / 2215 | 0 | PASS | PASS | — / 0 | 0 | 20 / 20 | {"notification":20} | — |
| 1752 | put -30s | ahead | 20 | 1695 / 1891 / 1920 | 0 | PASS | PASS | — / 0 | 0 | 20 / 20 | {"notification":20} | — |
| 1752 | put -30s | arrival-1 | 100 | 1737 / 2543 / 3202 | 0 | PASS | PASS | — / 0 | 0 | 100 / 100 | {"notification":97,"periodic":3} | — |
| 1753 | put -1s | incumbent | 430 | 1484 / 2512 / 3060 | 0 | PASS | PASS | — / 0 | 0 | 430 / 430 | {"notification":424,"periodic":6} | — |
| 1753 | put -1s | hold | 20 | — / — / — | 20 | FAIL | n/a | — / 0 | 0 | 20 / 20 | {"retry":16,"resume":2,"periodic":2} | — |
| 1753 | put -1s | ahead | 20 | 1573 / 2583 / 2586 | 0 | PASS | PASS | — / 0 | 0 | 20 / 20 | {"notification":19,"periodic":1} | — |
| 1753 | put -1s | arrival-1 | 100 | 1581 / 2544 / 3110 | 0 | PASS | PASS | — / 0 | 0 | 100 / 100 | {"notification":99,"periodic":1} | — |
| 1753 | put -1s | arrival-2 | 0 | — / — / — | 0 | n/a | n/a | 631 / 0 | 0 | 0 / 100 | {"initial":100} | — |
| 1754 | put +1s | incumbent | 430 | 1217 / 1493 / 2004 | 0 | PASS | PASS | — / 0 | 0 | 430 / 430 | {"notification":420,"periodic":10} | — |
| 1754 | put +1s | hold | 20 | 29141 / 29984 / 29984 | 11 | FAIL | FAIL | — / 0 | 0 | 20 / 20 | {"retry":16,"resume":2,"periodic":2} | — |
| 1754 | put +1s | ahead | 20 | 965 / 1220 / 1350 | 0 | PASS | PASS | — / 0 | 0 | 20 / 20 | {"notification":19,"periodic":1} | — |
| 1754 | put +1s | arrival-1 | 100 | 1275 / 1463 / 1550 | 0 | PASS | PASS | — / 0 | 0 | 100 / 100 | {"notification":100} | — |
| 1754 | put +1s | arrival-2 | 0 | — / — / — | 0 | n/a | n/a | 631 / 0 | 0 | 0 / 100 | {"initial":100} | — |
| 1755 | put +5s | incumbent | 430 | 1169 / 1359 / 1823 | 0 | PASS | PASS | — / 0 | 0 | 430 / 430 | {"notification":422,"periodic":8} | — |
| 1755 | put +5s | hold | 20 | 26012 / 27006 / 27068 | 0 | PASS | FAIL | — / 0 | 0 | 20 / 20 | {"retry":16,"resume":2,"periodic":2} | — |
| 1755 | put +5s | ahead | 20 | 1014 / 1130 / 1465 | 0 | PASS | PASS | — / 0 | 0 | 20 / 20 | {"notification":20} | — |
| 1755 | put +5s | arrival-1 | 100 | 1220 / 1348 / 1367 | 0 | PASS | PASS | — / 0 | 0 | 100 / 100 | {"notification":99,"periodic":1} | — |
| 1755 | put +5s | arrival-2 | 0 | — / — / — | 0 | n/a | n/a | 631 / 0 | 0 | 0 / 100 | {"initial":100} | — |
| 1756 | put +11s | incumbent | 430 | 1775 / 2832 / 3046 | 0 | PASS | PASS | — / 0 | 0 | 430 / 430 | {"notification":418,"periodic":12} | — |
| 1756 | put +11s | hold | 20 | 20015 / 21009 / 21071 | 0 | PASS | FAIL | — / 0 | 0 | 20 / 20 | {"retry":16,"resume":2,"periodic":2} | — |
| 1756 | put +11s | ahead | 20 | 1697 / 2351 / 2914 | 0 | PASS | PASS | — / 0 | 0 | 20 / 20 | {"notification":19,"periodic":1} | — |
| 1756 | put +11s | arrival-1 | 100 | 1874 / 2278 / 2914 | 0 | PASS | PASS | — / 0 | 0 | 100 / 100 | {"notification":99,"periodic":1} | — |
| 1756 | put +11s | arrival-2 | 0 | — / — / — | 0 | n/a | n/a | 631 / 0 | 0 | 0 / 100 | {"initial":100} | — |
| 1757 | put +15s | incumbent | 430 | 1347 / 1505 / 2110 | 0 | PASS | PASS | — / 0 | 0 | 430 / 430 | {"notification":417,"periodic":13} | — |
| 1757 | put +15s | hold | 20 | 16010 / 17004 / 17066 | 0 | PASS | FAIL | — / 0 | 0 | 20 / 20 | {"retry":16,"resume":2,"periodic":2} | — |
| 1757 | put +15s | ahead | 20 | 1162 / 1249 / 1262 | 0 | PASS | PASS | — / 0 | 0 | 20 / 20 | {"notification":19,"periodic":1} | — |
| 1757 | put +15s | arrival-1 | 100 | 1392 / 1538 / 1549 | 0 | PASS | PASS | — / 0 | 0 | 100 / 100 | {"notification":96,"periodic":4} | — |
| 1757 | put +15s | arrival-2 | 100 | 1301 / 1428 / 1555 | 0 | PASS | PASS | — / 0 | 0 | 100 / 100 | {"notification":100} | — |
| 1758 | put +30s | incumbent | 430 | 1782 / 2529 / 2855 | 0 | PASS | PASS | — / 0 | 0 | 430 / 430 | {"notification":418,"periodic":12} | — |
| 1758 | put +30s | hold | 20 | 1370 / 1880 / 1905 | 0 | PASS | PASS | — / 0 | 0 | 20 / 20 | {"notification":8,"retry":8,"resume":2,"periodic":2} | — |
| 1758 | put +30s | ahead | 20 | 1584 / 1954 / 2121 | 0 | PASS | PASS | — / 0 | 0 | 20 / 20 | {"notification":19,"periodic":1} | — |
| 1758 | put +30s | arrival-1 | 100 | 1905 / 2429 / 2808 | 0 | PASS | PASS | — / 0 | 0 | 100 / 100 | {"notification":98,"periodic":2} | — |
| 1758 | put +30s | arrival-2 | 100 | 1700 / 2413 / 2731 | 0 | PASS | PASS | — / 0 | 0 | 100 / 100 | {"notification":94,"periodic":6} | — |
| 1759 | put +60s | incumbent | 430 | 1821 / 2747 / 3120 | 0 | PASS | PASS | — / 0 | 0 | 430 / 430 | {"notification":422,"periodic":8} | — |
| 1759 | put +60s | hold | 20 | 1357 / 2678 / 2733 | 0 | PASS | PASS | — / 0 | 0 | 20 / 20 | {"notification":17,"periodic":3} | — |
| 1759 | put +60s | ahead | 20 | 1659 / 2242 / 2934 | 0 | PASS | PASS | — / 0 | 0 | 20 / 20 | {"notification":19,"periodic":1} | — |
| 1759 | put +60s | arrival-1 | 100 | 1808 / 2457 / 2713 | 0 | PASS | PASS | — / 0 | 0 | 100 / 100 | {"notification":98,"periodic":2} | — |
| 1759 | put +60s | arrival-2 | 100 | 1743 / 2741 / 3139 | 0 | PASS | PASS | — / 0 | 0 | 100 / 100 | {"notification":100} | — |

### Reactions / wishes smoke from old pages

| page | locale | type | harness checks | pass | sub-requests (status → serving deployment) |
|---|---|---|---|---|---|
| 0 | ja | surprise | submitted ✓, persisted ✓, refreshed ✓, identityRetained ✓, wish ✓, no5xx ✓ | true | post 200 → dpl_FAt2Sp33CvHnRohZyHkH5bUHZ4X5; counts 200 → dpl_FAt2Sp33CvHnRohZyHkH5bUHZ4X5; wish 403 → dpl_FAt2Sp33CvHnRohZyHkH5bUHZ4X5 |
| 1 | ko | moved | submitted ✓, persisted ✓, refreshed ✓, identityRetained ✓, wish ✓, no5xx ✓ | true | post 200 → dpl_FAt2Sp33CvHnRohZyHkH5bUHZ4X5; counts 200 → dpl_FAt2Sp33CvHnRohZyHkH5bUHZ4X5; wish 403 → dpl_FAt2Sp33CvHnRohZyHkH5bUHZ4X5 |
| 3 | en | waiting | submitted ✓, persisted ✓, refreshed ✓, identityRetained ✓, wish ✓, no5xx ✓ | true | post 200 → dpl_FAt2Sp33CvHnRohZyHkH5bUHZ4X5; counts 200 → dpl_FAt2Sp33CvHnRohZyHkH5bUHZ4X5; wish 403 → dpl_FAt2Sp33CvHnRohZyHkH5bUHZ4X5 |

## switch 3 (pseudo): dpl_FAt2Sp33CvHnRohZyHkH5bUHZ4X5 → dpl_FAt2Sp33CvHnRohZyHkH5bUHZ4X5

- planned 2026-10-12T16:41:29.000Z; CLI 16:41:29.197 → 16:41:33.499 (4302 ms, CPU 243 ms); target https://opensetlist-6l87uqc8o-opensetlist-projects.vercel.app

### Propagation — **EXERCISED**

| population | requests | → target | → old | → other | unmatched (in windows) | not exported | first target response (start → end) | last old request start | last old response end | old starts after cliStart |
|---|---|---|---|---|---|---|---|---|---|---|
| probe | 105 | 66 | 0 | 0 | 0 | 0 | 16:41:33.868 → 16:41:34.180 | — | — | 0 |
| route | 161 | 132 | 0 | 0 | 0 | 0 | 16:41:33.508 → 16:41:33.977 | — | — | 0 |
| sdk | 11206 | 7549 | 0 | 0 | 111 | 284 | 16:41:33.507 → 16:41:33.729 | — | — | 0 |
| page | 860 | 597 | 0 | 0 | 9 | 10 | 16:41:34.290 → 16:41:34.473 | — | — | 0 |
| document | 10 | 10 | 0 | 0 | 0 | 0 | 16:41:39.930 → 16:41:39.930 | — | — | 0 |
| all | 12342 | 8354 | 0 | 0 | 120 | 294 | 16:41:33.507 → 16:41:33.729 | — | — | 0 |

- Pseudo-switch (target = the serving deployment): no old deployment; "first target response" = first response whose request started after cliEnd; old-side bounds n/a.
- Sustained target routing over [cliEnd, cliEnd + 60 s] (probe): **yes** — 60 probe request(s), off-target after the first target probe 0, steady on the target from 16:41:33.868 (cliEnd +369 ms), largest probe gap 1081 ms.
- Harness provisional (live data-dpl-id route marker, no logs) — replaced by the bounds above: boundary 16:41:33.977 (route marker (data-dpl-id)); first target live 16:41:33.508 → 16:41:33.977 (pseudo: first marker started after cliEnd); routing sustained true, in window 121, off-target 0, last old start —, last old response —. Log-attributed first target response (all alias populations): 16:41:33.729 (-248 ms vs the harness boundary).
- Harness verdicts: {"continuity":"PASS","performance":"FAIL","arrivals":"PASS","smoke":"PASS","guard":"PASS"}; exposure {"pendingHinted":"NOT EXERCISED","oldAnswer":"EXERCISED","arrivalSdk":"EXERCISED","arrivalPages":"EXERCISED"}

### Exposure (first attributed target response 16:41:33.729)

| exposure | measured | min | result | detail |
|---|---|---|---|---|
| pending hinted fetch (natural SDK) | 0 clients | 20 | **NOT EXERCISED** | 0 req; old-attributed 0, unmatched 0; after T: headers 0, body 0, eval 0, settled 0; subsets {"hold":10} |
| pending recheck (controlled) | 0 clients | 5 | **NOT EXERCISED** | queued 0, dispatched 0 (recheck responses of the controlled subset) |
| old answer after cutover → converged | 20 / 20 clients | 5 | **EXERCISED** | natural 0, controlled 20; regression check: n/a here (no appliedAll in the client records; the harness's monotonicity check covers it) |
| arrival save rev 1764 (+11 s) SDK | 50 / 100 not joined at PUT response | 20 | **EXERCISED** | |
| arrival save rev 1764 pages | 2 / 10 incomplete | 3 | **NOT EXERCISED** | |
| arrival save rev 1765 (+15 s) SDK | 0 / 100 not joined at PUT response | 20 | **NOT EXERCISED** | |
| arrival save rev 1765 pages | 0 / 10 incomplete | 3 | **NOT EXERCISED** | |

### Target role evidence — ON (warming expected): **warm jobs seen**

- manifest role ON-A, LIVE_WARM_ENTRIES 1; 30553 log record(s) for the deployment
- saves in the leg 8: served by the target 8 (with writer line 8), not attributed 0; hinted reads 7620, not attributed inside the exported windows 119, outside them 202
- saves → serving deployment: put -30s rev 1760 → dpl_FAt2Sp33CvHnRohZyHkH5bUHZ4X5 ✓writer; put -1s rev 1761 → dpl_FAt2Sp33CvHnRohZyHkH5bUHZ4X5 ✓writer; put 1s rev 1762 → dpl_FAt2Sp33CvHnRohZyHkH5bUHZ4X5 ✓writer; put 5s rev 1763 → dpl_FAt2Sp33CvHnRohZyHkH5bUHZ4X5 ✓writer; put 11s rev 1764 → dpl_FAt2Sp33CvHnRohZyHkH5bUHZ4X5 ✓writer; put 15s rev 1765 → dpl_FAt2Sp33CvHnRohZyHkH5bUHZ4X5 ✓writer; put 30s rev 1766 → dpl_FAt2Sp33CvHnRohZyHkH5bUHZ4X5 ✓writer; put 60s rev 1767 → dpl_FAt2Sp33CvHnRohZyHkH5bUHZ4X5 ✓writer
- `[liveWarm] start` 26; any `[liveWarm]` 130; warm-lookup lines 16779; `source=warm` responses 16435; responses with a verify header 28885

### Continuity / performance per save and SDK group

Eligible = subscribed by the first save attempt; continuity = every eligible client at ≥ rev within 30 s of it (proposed operational acceptance); performance = p95 ≤ 3 s (kept visible). Joined-after clients are timed from max(join, PUT response).

| save rev | label | group | eligible | p50 / p95 / max ms | missing @30 s | continuity | p95 ≤ 3 s | joined after p95 / missing | not joined | broadcast received / pop. | applying fetch reasons | regressions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1760 | put -30s | incumbent | 430 | 1898 / 2489 / 2666 | 0 | PASS | PASS | — / 0 | 0 | 430 / 430 | {"notification":422,"periodic":8} | — |
| 1760 | put -30s | hold | 20 | 1894 / 2441 / 2652 | 0 | PASS | PASS | — / 0 | 0 | 20 / 20 | {"notification":20} | — |
| 1760 | put -30s | ahead | 20 | 1977 / 2416 / 2666 | 0 | PASS | PASS | — / 0 | 0 | 20 / 20 | {"notification":20} | — |
| 1760 | put -30s | arrival-1 | 100 | 1882 / 2560 / 2682 | 0 | PASS | PASS | — / 0 | 0 | 100 / 100 | {"notification":97,"periodic":3} | — |
| 1760 | put -30s | arrival-2 | 100 | 1871 / 2419 / 2559 | 0 | PASS | PASS | — / 0 | 0 | 100 / 100 | {"notification":97,"periodic":3} | — |
| 1761 | put -1s | incumbent | 430 | 1661 / 2141 / 2975 | 0 | PASS | PASS | — / 0 | 0 | 430 / 430 | {"notification":420,"periodic":10} | — |
| 1761 | put -1s | hold | 20 | 6165 / 6696 / 7082 | 0 | PASS | FAIL | — / 0 | 0 | 20 / 20 | {"resume":8,"notification":12} | — |
| 1761 | put -1s | ahead | 20 | 1368 / 1905 / 2391 | 0 | PASS | PASS | — / 0 | 0 | 20 / 20 | {"notification":19,"periodic":1} | — |
| 1761 | put -1s | arrival-1 | 100 | 1780 / 2301 / 2627 | 0 | PASS | PASS | — / 0 | 0 | 100 / 100 | {"notification":98,"periodic":2} | — |
| 1761 | put -1s | arrival-2 | 100 | 1639 / 2529 / 2651 | 0 | PASS | PASS | — / 0 | 0 | 100 / 100 | {"notification":96,"periodic":4} | — |
| 1761 | put -1s | arrival-3 | 0 | — / — / — | 0 | n/a | n/a | 499 / 0 | 0 | 0 / 100 | {"initial":100} | — |
| 1762 | put +1s | incumbent | 430 | 1205 / 1462 / 1524 | 0 | PASS | PASS | — / 0 | 0 | 430 / 430 | {"notification":417,"periodic":13} | — |
| 1762 | put +1s | hold | 20 | 4628 / 4770 / 5087 | 0 | PASS | FAIL | — / 0 | 0 | 20 / 20 | {"notification":7,"resume":11,"periodic":2} | — |
| 1762 | put +1s | ahead | 20 | 1090 / 1347 / 1431 | 0 | PASS | PASS | — / 0 | 0 | 20 / 20 | {"notification":20} | — |
| 1762 | put +1s | arrival-1 | 100 | 1397 / 1530 / 1641 | 0 | PASS | PASS | — / 0 | 0 | 100 / 100 | {"notification":97,"periodic":3} | — |
| 1762 | put +1s | arrival-2 | 100 | 1152 / 1344 / 1389 | 0 | PASS | PASS | — / 0 | 0 | 100 / 100 | {"notification":97,"periodic":3} | — |
| 1762 | put +1s | arrival-3 | 0 | — / — / — | 0 | n/a | n/a | 499 / 0 | 0 | 0 / 100 | {"initial":100} | — |
| 1763 | put +5s | incumbent | 430 | 1764 / 2887 / 3082 | 0 | PASS | PASS | — / 0 | 0 | 430 / 430 | {"notification":421,"periodic":9} | — |
| 1763 | put +5s | hold | 20 | 1102 / 1263 / 1284 | 0 | PASS | PASS | — / 0 | 0 | 20 / 20 | {"notification":19,"periodic":1} | — |
| 1763 | put +5s | ahead | 20 | 1843 / 2806 / 2922 | 0 | PASS | PASS | — / 0 | 0 | 20 / 20 | {"notification":20} | — |
| 1763 | put +5s | arrival-1 | 100 | 1967 / 2965 / 3086 | 0 | PASS | PASS | — / 0 | 0 | 100 / 100 | {"notification":96,"periodic":4} | — |
| 1763 | put +5s | arrival-2 | 100 | 1757 / 2869 / 3023 | 0 | PASS | PASS | — / 0 | 0 | 100 / 100 | {"notification":99,"periodic":1} | — |
| 1763 | put +5s | arrival-3 | 0 | — / — / — | 0 | n/a | n/a | 499 / 0 | 0 | 0 / 100 | {"initial":100} | — |
| 1764 | put +11s | incumbent | 430 | 1507 / 2231 / 2546 | 0 | PASS | PASS | — / 0 | 0 | 430 / 430 | {"notification":423,"periodic":7} | — |
| 1764 | put +11s | hold | 20 | 1239 / 1415 / 1572 | 0 | PASS | PASS | — / 0 | 0 | 20 / 20 | {"notification":20} | — |
| 1764 | put +11s | ahead | 20 | 1463 / 1533 / 1536 | 0 | PASS | PASS | — / 0 | 0 | 20 / 20 | {"notification":20} | — |
| 1764 | put +11s | arrival-1 | 100 | 1714 / 2243 / 2297 | 0 | PASS | PASS | — / 0 | 0 | 100 / 100 | {"notification":97,"periodic":3} | — |
| 1764 | put +11s | arrival-2 | 100 | 1479 / 2277 / 2313 | 0 | PASS | PASS | — / 0 | 0 | 100 / 100 | {"notification":97,"periodic":3} | — |
| 1764 | put +11s | arrival-3 | 50 | 1767 / 1895 / 2268 | 0 | PASS | PASS | 565 / 0 | 0 | 50 / 100 | {"notification":50,"initial":50} | — |
| 1765 | put +15s | incumbent | 430 | 1442 / 2086 / 2192 | 0 | PASS | PASS | — / 0 | 0 | 430 / 430 | {"notification":414,"periodic":16} | — |
| 1765 | put +15s | hold | 20 | 1128 / 2042 / 2095 | 0 | PASS | PASS | — / 0 | 0 | 20 / 20 | {"notification":20} | — |
| 1765 | put +15s | ahead | 20 | 1143 / 2087 / 2192 | 0 | PASS | PASS | — / 0 | 0 | 20 / 20 | {"notification":20} | — |
| 1765 | put +15s | arrival-1 | 100 | 1583 / 2074 / 2134 | 0 | PASS | PASS | — / 0 | 0 | 100 / 100 | {"notification":96,"periodic":4} | — |
| 1765 | put +15s | arrival-2 | 100 | 1384 / 2075 / 2141 | 0 | PASS | PASS | — / 0 | 0 | 100 / 100 | {"notification":98,"periodic":2} | — |
| 1765 | put +15s | arrival-3 | 100 | 1396 / 2046 / 2174 | 0 | PASS | PASS | — / 0 | 0 | 100 / 100 | {"notification":100} | — |
| 1766 | put +30s | incumbent | 430 | 2007 / 3127 / 3383 | 0 | PASS | FAIL | — / 0 | 0 | 430 / 430 | {"notification":421,"periodic":9} | — |
| 1766 | put +30s | hold | 20 | 1940 / 3083 / 3108 | 0 | PASS | FAIL | — / 0 | 0 | 20 / 20 | {"notification":19,"periodic":1} | — |
| 1766 | put +30s | ahead | 20 | 2739 / 2953 / 2957 | 0 | PASS | PASS | — / 0 | 0 | 20 / 20 | {"notification":20} | — |
| 1766 | put +30s | arrival-1 | 100 | 2152 / 3008 / 3051 | 0 | PASS | FAIL | — / 0 | 0 | 100 / 100 | {"notification":98,"periodic":2} | — |
| 1766 | put +30s | arrival-2 | 100 | 1896 / 3098 / 3255 | 0 | PASS | FAIL | — / 0 | 0 | 100 / 100 | {"notification":95,"periodic":5} | — |
| 1766 | put +30s | arrival-3 | 100 | 1986 / 3231 / 3357 | 0 | PASS | FAIL | — / 0 | 0 | 100 / 100 | {"notification":91,"periodic":9} | — |
| 1767 | put +60s | incumbent | 430 | 2003 / 2701 / 3710 | 0 | PASS | PASS | — / 0 | 0 | 430 / 430 | {"notification":418,"periodic":12} | — |
| 1767 | put +60s | hold | 20 | 1847 / 2483 / 2485 | 0 | PASS | PASS | — / 0 | 0 | 20 / 20 | {"notification":18,"periodic":2} | — |
| 1767 | put +60s | ahead | 20 | 2096 / 2744 / 3182 | 0 | PASS | PASS | — / 0 | 0 | 20 / 20 | {"notification":19,"periodic":1} | — |
| 1767 | put +60s | arrival-1 | 100 | 2166 / 2709 / 3522 | 0 | PASS | PASS | — / 0 | 0 | 100 / 100 | {"notification":98,"periodic":2} | — |
| 1767 | put +60s | arrival-2 | 100 | 2003 / 2636 / 3341 | 0 | PASS | PASS | — / 0 | 0 | 100 / 100 | {"notification":99,"periodic":1} | — |
| 1767 | put +60s | arrival-3 | 100 | 1947 / 2960 / 3230 | 0 | PASS | PASS | — / 0 | 0 | 100 / 100 | {"notification":100} | — |

### Reactions / wishes smoke from old pages

| page | locale | type | harness checks | pass | sub-requests (status → serving deployment) |
|---|---|---|---|---|---|
| 0 | ja | moved | submitted ✓, persisted ✓, refreshed ✓, identityRetained ✓, wish ✓, no5xx ✓ | true | post 200 → dpl_FAt2Sp33CvHnRohZyHkH5bUHZ4X5; counts 200 → dpl_FAt2Sp33CvHnRohZyHkH5bUHZ4X5; wish 403 → dpl_FAt2Sp33CvHnRohZyHkH5bUHZ4X5 |
| 1 | ko | waiting | submitted ✓, persisted ✓, refreshed ✓, identityRetained ✓, wish ✓, no5xx ✓ | true | post 200 → dpl_FAt2Sp33CvHnRohZyHkH5bUHZ4X5; counts 200 → dpl_FAt2Sp33CvHnRohZyHkH5bUHZ4X5; wish 403 → dpl_FAt2Sp33CvHnRohZyHkH5bUHZ4X5 |
| 3 | en | best | submitted ✓, persisted ✓, refreshed ✓, identityRetained ✓, wish ✓, no5xx ✓ | true | post 200 → dpl_FAt2Sp33CvHnRohZyHkH5bUHZ4X5; counts 200 → dpl_FAt2Sp33CvHnRohZyHkH5bUHZ4X5; wish 403 → dpl_FAt2Sp33CvHnRohZyHkH5bUHZ4X5 |

## Resources across deployments

Σ = sum of per-instance Prisma pool totals (vercel-logs-summary's estimator on the JSON export): 5 s buckets of per-instance MAXIMA (an upper bound within a bucket, not a simultaneous count), an instance carried ≤ 5 s after its last line, instances that never log a pool line are invisible; record times are request STARTS. An app-side estimate, not the pooler's own client count.

| deployment | Σ peak (carried / reported, instances) | at | writer lines | writer acquire max ms | EMAXCONN |
|---|---|---|---|---|---|
| dpl_FAt2Sp33CvHnRohZyHkH5bUHZ4X5 | 103 / 101 (67) | 16:41:40.000 | 26 | 210 | 0 |
| **combined** | 103 / 101 (67) | 16:41:40.000 | 26 | 210 | 0 |

| minute (UTC) | dpl_FAt2Sp33CvHnRohZyHkH5bUHZ4X5 requests / builds |
|---|---|
| 16:32 | 494 / 116 |
| 16:33 | 5350 / 750 |
| 16:34 | 2506 / 454 |
| 16:36 | 560 / 103 |
| 16:37 | 6034 / 874 |
| 16:38 | 3083 / 527 |
| 16:40 | 627 / 115 |
| 16:41 | 7097 / 1108 |
| 16:42 | 4802 / 544 |

## Harness provisional verdicts (verbatim)

```json
{
  "verdict": "VALID + FAIL",
  "exit": 1,
  "failed": [
    "switch 1 arrivals",
    "switch 2 arrivals",
    "switch 3 performance"
  ],
  "notExercised": [
    "switch 1 pendingHinted",
    "switch 1 arrivalSdk",
    "switch 2 pendingHinted",
    "switch 2 oldAnswer",
    "switch 3 pendingHinted"
  ]
}
```

