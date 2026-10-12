## Warm join — 2026-10-11T20-09-11-132Z-browsers.json + 2026-10-11T200507Z-vercel-logs-history-fault-locale-ja.txt

Per save and locale: warm-complete − commit (commit proxy = the PUT's response), and each client's FIRST notification fetch of the save split by whether it left after that locale's entry existed. hit = `x-snapshot-source: warm`.

- **SDK**: first hinted fetches 2945; arrived after warm-complete 1052/2945 (36 %); hit rate after 1052/1052 (100 %), before 24/1893 (1 %); all hits 1076; minRev ≠ rev 0
- **pages**: first hinted fetches 218; arrived after warm-complete 67/218 (31 %); hit rate after 67/67 (100 %), before 1/151 (1 %); all hits 68; minRev ≠ rev 0
- warm jobs in the logs: 18

| # | rev | warm job (start → done ms) | offsets | log PUT − harness PUT ms | log: lookups / hits / hinted; builds warm / reader | locale | entry | warm-complete − commit ms | SDK: n, arrival p50 / p95, after (hits) / before (hits) | pages: same |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 1104 | f7af8031 (235) | rebuilt, unaccounted 9 ms | -519 | 223 / 130 / 223; 2 / 377 | ko | stored | 198 | 85, 658 / 900, 85 (85) / 0 (0) | 5, 598 / 716, 5 (5) / 0 (0) |
| | | | | | | ja | — | — | 78, 498 / 740, 0 (0) / 78 (0) | 15, 582 / 799, 0 (0) / 15 (0) |
| | | | | | | en | stored | 226 | 38, 578 / 880, 38 (38) / 0 (0) | 2, 482 / 631, 2 (2) / 0 (0) |
| 2 | 1105 | 9c85a565 (63) | rebuilt, unaccounted 0 ms | -516 | 488 / 146 / 488; 2 / 318 | ko | stored | 63 | 92, 288 / 528, 91 (91) / 1 (1) | 6, 199 / 492, 6 (6) / 0 (0) |
| | | | | | | ja | — | — | 322, 322 / 529, 0 (0) / 322 (0) | 20, 338 / 506, 0 (0) / 20 (0) |
| | | | | | | en | stored | 53 | 45, 291 / 526, 45 (45) / 0 (0) | 3, 271 / 441, 3 (3) / 0 (0) |
| 3 | 1107 | 2a5a7544 (139) | rebuilt, unaccounted 0 ms | -535 | 321 / 146 / 321; 2 / 325 | ko | stored | 131 | 92, 557 / 818, 92 (92) / 0 (0) | 5, 477 / 794, 5 (5) / 0 (0) |
| | | | | | | ja | — | — | 158, 489 / 726, 0 (0) / 158 (0) | 17, 560 / 846, 0 (0) / 17 (0) |
| | | | | | | en | stored | 139 | 47, 537 / 827, 47 (47) / 0 (0) | 2, 393 / 459, 2 (2) / 0 (0) |
| 4 | 1108 | 2a5a7544 (101) | rebuilt, unaccounted 1 ms | -488 | 497 / 149 / 497; 2 / 351 | ko | stored | 56 | 93, 313 / 524, 92 (92) / 1 (1) | 6, 314 / 555, 6 (6) / 0 (0) |
| | | | | | | ja | — | — | 327, 297 / 528, 0 (0) / 327 (0) | 21, 315 / 525, 0 (0) / 21 (0) |
| | | | | | | en | stored | 100 | 47, 296 / 514, 41 (41) / 6 (6) | 3, 372 / 490, 3 (3) / 0 (0) |
| 5 | 1110 | bf4ccaec (115) | rebuilt, unaccounted 0 ms | -538 | 308 / 140 / 308; 2 / 399 | ko | stored | 102 | 88, 683 / 849, 88 (88) / 0 (0) | 6, 596 / 820, 6 (6) / 0 (0) |
| | | | | | | ja | — | — | 153, 516 / 732, 0 (0) / 153 (0) | 15, 563 / 779, 0 (0) / 15 (0) |
| | | | | | | en | stored | 115 | 43, 587 / 834, 42 (42) / 1 (1) | 3, 786 / 880, 3 (3) / 0 (0) |
| 6 | 1111 | d1418238 (87) | rebuilt, unaccounted 0 ms | -505 | 480 / 143 / 480; 2 / 352 | ko | stored | 66 | 89, 275 / 539, 86 (86) / 3 (3) | 6, 236 / 419, 6 (6) / 0 (0) |
| | | | | | | ja | — | — | 316, 303 / 525, 0 (0) / 316 (0) | 21, 402 / 520, 0 (0) / 21 (0) |
| | | | | | | en | stored | 87 | 45, 358 / 503, 42 (42) / 3 (3) | 3, 352 / 553, 2 (2) / 1 (1) |
| 7 | 1113 | 6f368e2c (109) | rebuilt, unaccounted 0 ms | -517 | 355 / 141 / 355; 2 / 459 | ko | stored | 109 | 87, 546 / 784, 87 (87) / 0 (0) | 6, 470 / 578, 6 (6) / 0 (0) |
| | | | | | | ja | — | — | 194, 452 / 729, 0 (0) / 194 (0) | 20, 552 / 701, 0 (0) / 20 (0) |
| | | | | | | en | stored | 100 | 45, 567 / 771, 45 (45) / 0 (0) | 3, 673 / 735, 3 (3) / 0 (0) |
| 8 | 1114 | 7f96c1bf (81) | rebuilt, unaccounted 1 ms | -466 | 491 / 149 / 491; 2 / 154 | ko | stored | 71 | 93, 326 / 537, 90 (90) / 3 (3) | 6, 346 / 477, 6 (6) / 0 (0) |
| | | | | | | ja | — | — | 321, 304 / 529, 0 (0) / 321 (0) | 21, 345 / 527, 0 (0) / 21 (0) |
| | | | | | | en | stored | 80 | 47, 327 / 527, 41 (41) / 6 (6) | 3, 307 / 344, 3 (3) / 0 (0) |
