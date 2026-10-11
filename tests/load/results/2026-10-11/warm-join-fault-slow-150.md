## Warm join — 2026-10-11T20-31-58-716Z-browsers.json + 2026-10-11T202753Z-vercel-logs-history-fault-slow-150.txt

Per save and locale: warm-complete − commit (commit proxy = the PUT's response), and each client's FIRST notification fetch of the save split by whether it left after that locale's entry existed. hit = `x-snapshot-source: warm`.

- **SDK**: first hinted fetches 3597; arrived after warm-complete 3478/3597 (97 %); hit rate after 3455/3478 (99 %), before 118/119 (99 %); all hits 3573; minRev ≠ rev 0
- **pages**: first hinted fetches 230; arrived after warm-complete 220/230 (96 %); hit rate after 218/220 (99 %), before 10/10 (100 %); all hits 228; minRev ≠ rev 0
- warm jobs in the logs: 18

| # | rev | warm job (start → done ms) | offsets | log PUT − harness PUT ms | log: lookups / hits / hinted; builds warm / reader | locale | entry | warm-complete − commit ms | SDK: n, arrival p50 / p95, after (hits) / before (hits) | pages: same |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 1199 | b8af25a6 (95) | rebuilt, unaccounted 1 ms | -554 | 437 / 430 / 437; 3 / 231 | ko | stored | 72 | 82, 651 / 942, 82 (81) / 0 (0) | 6, 823 / 909, 6 (6) / 0 (0) |
| | | | | | | ja | stored | 48 | 285, 687 / 942, 285 (281) / 0 (0) | 20, 557 / 923, 20 (19) / 0 (0) |
| | | | | | | en | stored | 94 | 41, 669 / 921, 41 (40) / 0 (0) | 3, 619 / 793, 3 (3) / 0 (0) |
| 2 | 1200 | d0d17594 (87) | rebuilt, unaccounted 0 ms | -524 | 484 / 479 / 484; 3 / 175 | ko | stored | 45 | 90, 265 / 536, 90 (88) / 0 (0) | 5, 426 / 518, 5 (5) / 0 (0) |
| | | | | | | ja | stored | 52 | 320, 309 / 541, 320 (317) / 0 (0) | 21, 321 / 503, 21 (21) / 0 (0) |
| | | | | | | en | stored | 87 | 45, 211 / 498, 40 (40) / 5 (5) | 3, 242 / 465, 2 (2) / 1 (1) |
| 3 | 1202 | 401bd520 (227) | rebuilt, unaccounted 1 ms | -562 | 490 / 490 / 490; 3 / 171 | ko | stored | 76 | 90, 604 / 915, 90 (90) / 0 (0) | 6, 747 / 870, 6 (6) / 0 (0) |
| | | | | | | ja | stored | 152 | 325, 643 / 898, 325 (325) / 0 (0) | 21, 628 / 881, 21 (21) / 0 (0) |
| | | | | | | en | stored | 226 | 45, 606 / 898, 45 (45) / 0 (0) | 3, 599 / 746, 3 (3) / 0 (0) |
| 4 | 1203 | ef533b5b (137) | rebuilt, unaccounted 1 ms | -523 | 491 / 491 / 491; 3 / 186 | ko | stored | 47 | 93, 357 / 589, 93 (93) / 0 (0) | 5, 250 / 547, 5 (5) / 0 (0) |
| | | | | | | ja | stored | 84 | 324, 320 / 561, 315 (315) / 9 (9) | 21, 287 / 571, 20 (20) / 1 (1) |
| | | | | | | en | stored | 136 | 46, 366 / 587, 43 (43) / 3 (3) | 2, 157 / 173, 2 (2) / 0 (0) |
| 5 | 1205 | 7215ae77 (316) | rebuilt, unaccounted 1 ms | -561 | 479 / 474 / 479; 3 / 225 | ko | stored | 166 | 89, 348 / 510, 87 (87) / 2 (2) | 4, 336 / 505, 4 (4) / 0 (0) |
| | | | | | | ja | stored | 211 | 316, 363 / 517, 265 (261) / 51 (50) | 20, 336 / 525, 16 (16) / 4 (4) |
| | | | | | | en | stored | 315 | 47, 316 / 519, 24 (24) / 23 (23) | 3, 306 / 553, 1 (1) / 2 (2) |
| 6 | 1206 | 19131805 (106) | rebuilt, unaccounted 2 ms | -535 | 487 / 487 / 487; 3 / 196 | ko | stored | 58 | 92, 276 / 506, 91 (91) / 1 (1) | 6, 137 / 526, 6 (6) / 0 (0) |
| | | | | | | ja | stored | 80 | 319, 294 / 532, 305 (305) / 14 (14) | 21, 338 / 543, 19 (19) / 2 (2) |
| | | | | | | en | stored | 104 | 46, 244 / 538, 40 (40) / 6 (6) | 3, 517 / 543, 3 (3) / 0 (0) |
| 7 | 1208 | 7eaca367 (193) | rebuilt, unaccounted 21 ms | -562 | 473 / 465 / 473; 3 / 181 | ko | stored | 120 | 91, 778 / 995, 90 (89) / 1 (1) | 6, 745 / 894, 6 (6) / 0 (0) |
| | | | | | | ja | stored | 149 | 308, 773 / 991, 308 (303) / 0 (0) | 20, 760 / 974, 20 (19) / 0 (0) |
| | | | | | | en | stored | 172 | 45, 785 / 987, 45 (44) / 0 (0) | 3, 683 / 878, 3 (3) / 0 (0) |
| 8 | 1209 | 19131805 (88) | rebuilt, unaccounted 0 ms | -526 | 486 / 485 / 486; 3 / 33 | ko | stored | 46 | 91, 301 / 535, 91 (91) / 0 (0) | 6, 191 / 542, 6 (6) / 0 (0) |
| | | | | | | ja | stored | 58 | 320, 309 / 530, 319 (318) / 1 (1) | 19, 308 / 543, 19 (19) / 0 (0) |
| | | | | | | en | stored | 88 | 47, 318 / 545, 44 (44) / 3 (3) | 3, 310 / 382, 3 (3) / 0 (0) |
