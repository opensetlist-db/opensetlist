## Warm join — 2026-10-11T20-00-02-312Z-browsers.json + 2026-10-11T195557Z-vercel-logs-history-fault-absent.txt

Per save and locale: warm-complete − commit (commit proxy = the PUT's response), and each client's FIRST notification fetch of the save split by whether it left after that locale's entry existed. hit = `x-snapshot-source: warm`.

- **SDK**: first hinted fetches 2615; arrived after warm-complete 2188/2615 (84 %); hit rate after 0/2188 (0 %), before 0/427 (0 %); all hits 0; minRev ≠ rev 0
- **pages**: first hinted fetches 203; arrived after warm-complete 168/203 (83 %); hit rate after 0/168 (0 %), before 0/35 (0 %); all hits 0; minRev ≠ rev 0
- warm jobs in the logs: 18

| # | rev | warm job (start → done ms) | offsets | log PUT − harness PUT ms | log: lookups / hits / hinted; builds warm / reader | locale | entry | warm-complete − commit ms | SDK: n, arrival p50 / p95, after (hits) / before (hits) | pages: same |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 1066 | 89998a8b (1578) | rebuilt, unaccounted 0 ms | -497 | 306 / 0 / 306; 3 / 404 | ko | stored | 1480 | 52, 261 / 500, 0 (0) / 52 (0) | 4, 146 / 343, 0 (0) / 4 (0) |
| | | | | | | ja | stored | 1510 | 192, 262 / 521, 0 (0) / 192 (0) | 20, 294 / 560, 0 (0) / 20 (0) |
| | | | | | | en | stored | 1578 | 37, 223 / 521, 0 (0) / 37 (0) | 1, 244 / 244, 0 (0) / 1 (0) |
| 2 | 1067 | bd01b400 (98) | rebuilt, unaccounted 8 ms | -501 | 495 / 0 / 495; 3 / 420 | ko | stored | 56 | 94, 310 / 549, 94 (0) / 0 (0) | 6, 274 / 557, 6 (0) / 0 (0) |
| | | | | | | ja | stored | 48 | 325, 294 / 533, 325 (0) / 0 (0) | 20, 307 / 525, 20 (0) / 0 (0) |
| | | | | | | en | stored | 90 | 47, 343 / 515, 44 (0) / 3 (0) | 3, 141 / 374, 3 (0) / 0 (0) |
| 3 | 1069 | 914bf072 (590) | rebuilt, unaccounted 0 ms | -536 | 120 / 0 / 120; 3 / 424 | ko | stored | 274 | 26, 528 / 719, 26 (0) / 0 (0) | 2, 559 / 560, 2 (0) / 0 (0) |
| | | | | | | ja | stored | 314 | 71, 544 / 650, 67 (0) / 4 (0) | 10, 610 / 796, 9 (0) / 1 (0) |
| | | | | | | en | stored | 590 | 10, 528 / 587, 0 (0) / 10 (0) | 1, 542 / 542, 0 (0) / 1 (0) |
| 4 | 1070 | bead2882 (120) | rebuilt, unaccounted 0 ms | -498 | 484 / 0 / 484; 3 / 550 | ko | stored | 73 | 92, 275 / 517, 89 (0) / 3 (0) | 6, 369 / 552, 6 (0) / 0 (0) |
| | | | | | | ja | stored | 61 | 315, 308 / 530, 306 (0) / 9 (0) | 21, 289 / 521, 21 (0) / 0 (0) |
| | | | | | | en | stored | 120 | 47, 227 / 502, 39 (0) / 8 (0) | 3, 188 / 420, 3 (0) / 0 (0) |
| 5 | 1072 | 1b38f1bd (461) | rebuilt, unaccounted 0 ms | -523 | 245 / 0 / 245; 3 / 437 | ko | stored | 200 | 49, 464 / 713, 47 (0) / 2 (0) | 6, 495 / 868, 6 (0) / 0 (0) |
| | | | | | | ja | stored | 240 | 145, 461 / 833, 143 (0) / 2 (0) | 18, 563 / 794, 18 (0) / 0 (0) |
| | | | | | | en | stored | 461 | 26, 460 / 765, 13 (0) / 13 (0) | 1, 456 / 456, 0 (0) / 1 (0) |
| 6 | 1073 | 1b38f1bd (122) | rebuilt, unaccounted 20 ms | -497 | 487 / 0 / 487; 3 / 471 | ko | stored | 47 | 92, 307 / 516, 92 (0) / 0 (0) | 6, 395 / 535, 6 (0) / 0 (0) |
| | | | | | | ja | stored | 86 | 320, 312 / 526, 304 (0) / 16 (0) | 20, 311 / 462, 20 (0) / 0 (0) |
| | | | | | | en | stored | 102 | 46, 328 / 529, 44 (0) / 2 (0) | 3, 345 / 444, 3 (0) / 0 (0) |
| 7 | 1075 | 1b38f1bd (873) | rebuilt, unaccounted 0 ms | -522 | 191 / 0 / 191; 3 / 497 | ko | stored | 299 | 43, 462 / 722, 42 (0) / 1 (0) | 4, 509 / 607, 4 (0) / 0 (0) |
| | | | | | | ja | stored | 450 | 109, 470 / 706, 69 (0) / 40 (0) | 17, 592 / 824, 15 (0) / 2 (0) |
| | | | | | | en | stored | 873 | 17, 423 / 552, 0 (0) / 17 (0) | 1, 558 / 558, 0 (0) / 1 (0) |
| 8 | 1076 | 6af9d1bc (111) | rebuilt, unaccounted 2 ms | -500 | 490 / 0 / 490; 3 / 196 | ko | stored | 59 | 92, 322 / 535, 91 (0) / 1 (0) | 6, 226 / 497, 6 (0) / 0 (0) |
| | | | | | | ja | stored | 83 | 323, 301 / 533, 310 (0) / 13 (0) | 21, 259 / 496, 18 (0) / 3 (0) |
| | | | | | | en | stored | 109 | 45, 334 / 545, 43 (0) / 2 (0) | 3, 209 / 350, 2 (0) / 1 (0) |
