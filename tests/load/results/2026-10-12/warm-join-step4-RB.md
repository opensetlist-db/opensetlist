## Warm join — 2026-10-12T04-04-55-512Z-browsers.json + 2026-10-12T04-00-54Z-vercel-logs-history-step4-RB.txt

Per save and locale: warm-complete − commit (commit proxy = the PUT's response), and each client's FIRST notification fetch of the save split by whether it left after that locale's entry existed. hit = `x-snapshot-source: warm`.

- **SDK**: first hinted fetches 3600; arrived after warm-complete 3352/3600 (93 %); hit rate after 3352/3352 (100 %), before 248/248 (100 %); all hits 3600; minRev ≠ rev 0; served newer than key 0
- **pages**: first hinted fetches 234; arrived after warm-complete 220/234 (94 %); hit rate after 220/220 (100 %), before 14/14 (100 %); all hits 234; minRev ≠ rev 0; served newer than key 0
- warm jobs in the logs: 18
- offsets: `at` = server timestamps (set `at` − writer `at`); `log` / `rebuilt` = job-start based (older logs).

| # | rev | warm job (start → done ms) | offsets | log PUT − harness PUT ms | log: lookups / hits / hinted; builds warm / reader | entry rev ≠ key rev | locale | entry | warm-complete − commit ms | SDK: n, arrival p50 / p95, after (hits) / before (hits) | pages: same |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 1451 | abe126f3 (164) | at, unaccounted 0 ms | -201 | 446 / 446 / 446; 3 / 201 | — | ko | stored | 90 | 87, 688 / 898, 87 (87) / 0 (0) | 6, 797 / 861, 6 (6) / 0 (0) |
| | | | | | | | ja | stored | 100 | 291, 667 / 906, 291 (291) / 0 (0) | 20, 732 / 903, 20 (20) / 0 (0) |
| | | | | | | | en | stored | 175 | 39, 601 / 902, 39 (39) / 0 (0) | 3, 455 / 686, 3 (3) / 0 (0) |
| 2 | 1452 | 4ea9b95b (102) | at, unaccounted 1 ms | -187 | 485 / 485 / 485; 3 / 180 | — | ko | stored | 70 | 91, 319 / 533, 88 (88) / 3 (3) | 5, 190 / 528, 5 (5) / 0 (0) |
| | | | | | | | ja | stored | 70 | 319, 287 / 531, 307 (307) / 12 (12) | 21, 206 / 517, 20 (20) / 1 (1) |
| | | | | | | | en | stored | 112 | 47, 314 / 514, 42 (42) / 5 (5) | 2, 285 / 508, 2 (2) / 0 (0) |
| 3 | 1454 | df9c2597 (192) | at, unaccounted 0 ms | -212 | 484 / 484 / 484; 3 / 183 | — | ko | stored | 153 | 89, 753 / 1061, 75 (75) / 14 (14) | 6, 943 / 985, 5 (5) / 1 (1) |
| | | | | | | | ja | stored | 153 | 320, 796 / 1061, 274 (274) / 46 (46) | 19, 774 / 1064, 19 (19) / 0 (0) |
| | | | | | | | en | stored | 204 | 47, 801 / 1068, 43 (43) / 4 (4) | 3, 753 / 910, 3 (3) / 0 (0) |
| 4 | 1455 | 34446bdc (105) | at, unaccounted 0 ms | -176 | 495 / 495 / 495; 3 / 177 | — | ko | stored | 75 | 92, 315 / 546, 91 (91) / 1 (1) | 6, 366 / 547, 6 (6) / 0 (0) |
| | | | | | | | ja | stored | 71 | 326, 318 / 528, 321 (321) / 5 (5) | 21, 321 / 510, 21 (21) / 0 (0) |
| | | | | | | | en | stored | 115 | 47, 348 / 531, 41 (41) / 6 (6) | 3, 380 / 472, 2 (2) / 1 (1) |
| 5 | 1457 | 39919ff9 (232) | at, unaccounted 0 ms | -202 | 468 / 468 / 468; 3 / 271 | — | ko | stored | 151 | 88, 381 / 784, 79 (79) / 9 (9) | 6, 385 / 477, 6 (6) / 0 (0) |
| | | | | | | | ja | stored | 202 | 306, 369 / 597, 250 (250) / 56 (56) | 21, 399 / 540, 18 (18) / 3 (3) |
| | | | | | | | en | stored | 242 | 44, 368 / 492, 38 (38) / 6 (6) | 3, 434 / 551, 3 (3) / 0 (0) |
| 6 | 1458 | 20a47ba8 (96) | at, unaccounted 0 ms | -180 | 486 / 486 / 486; 3 / 184 | — | ko | stored | 74 | 90, 306 / 528, 87 (87) / 3 (3) | 6, 465 / 532, 6 (6) / 0 (0) |
| | | | | | | | ja | stored | 83 | 321, 298 / 533, 302 (302) / 19 (19) | 21, 302 / 547, 19 (19) / 2 (2) |
| | | | | | | | en | stored | 119 | 45, 310 / 521, 41 (41) / 4 (4) | 3, 272 / 505, 3 (3) / 0 (0) |
| 7 | 1460 | f78c58aa (122) | at, unaccounted 0 ms | -211 | 479 / 479 / 479; 3 / 194 | — | ko | stored | 78 | 87, 736 / 966, 87 (87) / 0 (0) | 6, 662 / 931, 6 (6) / 0 (0) |
| | | | | | | | ja | stored | 99 | 318, 735 / 963, 318 (318) / 0 (0) | 20, 628 / 883, 20 (20) / 0 (0) |
| | | | | | | | en | stored | 133 | 45, 735 / 965, 45 (45) / 0 (0) | 3, 902 / 949, 3 (3) / 0 (0) |
| 8 | 1461 | 52a211a2 (147) | at, unaccounted 0 ms | -183 | 491 / 491 / 491; 3 / 19 | — | ko | stored | 76 | 93, 291 / 509, 84 (84) / 9 (9) | 6, 402 / 524, 6 (6) / 0 (0) |
| | | | | | | | ja | stored | 124 | 323, 296 / 524, 286 (286) / 37 (37) | 21, 276 / 429, 17 (17) / 4 (4) |
| | | | | | | | en | stored | 155 | 45, 321 / 524, 36 (36) / 9 (9) | 3, 113 / 509, 1 (1) / 2 (2) |
