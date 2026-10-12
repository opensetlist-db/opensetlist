## Warm join — 2026-10-11T20-04-39-389Z-browsers.json + 2026-10-11T200032Z-vercel-logs-history-fault-getnull.txt

Per save and locale: warm-complete − commit (commit proxy = the PUT's response), and each client's FIRST notification fetch of the save split by whether it left after that locale's entry existed. hit = `x-snapshot-source: warm`.

- **SDK**: first hinted fetches 2324; arrived after warm-complete 1981/2324 (85 %); hit rate after 0/1981 (0 %), before 0/343 (0 %); all hits 0; minRev ≠ rev 0
- **pages**: first hinted fetches 193; arrived after warm-complete 159/193 (82 %); hit rate after 0/159 (0 %), before 0/34 (0 %); all hits 0; minRev ≠ rev 0
- warm jobs in the logs: 18

| # | rev | warm job (start → done ms) | offsets | log PUT − harness PUT ms | log: lookups / hits / hinted; builds warm / reader | locale | entry | warm-complete − commit ms | SDK: n, arrival p50 / p95, after (hits) / before (hits) | pages: same |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 1085 | ea02cb44 (888) | rebuilt, unaccounted 1 ms | -537 | 175 / 0 / 175; 3 / 437 | ko | stored | 577 | 24, 354 / 620, 2 (0) / 22 (0) | 3, 372 / 522, 0 (0) / 3 (0) |
| | | | | | | ja | stored | 692 | 118, 317 / 599, 5 (0) / 113 (0) | 18, 387 / 537, 0 (0) / 18 (0) |
| | | | | | | en | stored | 887 | 9, 450 / 615, 0 (0) / 9 (0) | 3, 441 / 535, 0 (0) / 3 (0) |
| 2 | 1086 | 9130cfe0 (129) | rebuilt, unaccounted 1 ms | -507 | 487 / 0 / 487; 3 / 299 | ko | stored | 67 | 92, 276 / 515, 85 (0) / 7 (0) | 6, 358 / 440, 6 (0) / 0 (0) |
| | | | | | | ja | stored | 93 | 321, 281 / 525, 288 (0) / 33 (0) | 20, 344 / 531, 18 (0) / 2 (0) |
| | | | | | | en | stored | 128 | 45, 339 / 550, 42 (0) / 3 (0) | 3, 209 / 443, 3 (0) / 0 (0) |
| 3 | 1088 | 5b17487f (576) | rebuilt, unaccounted 0 ms | -536 | 158 / 0 / 158; 3 / 488 | ko | stored | 254 | 27, 477 / 545, 27 (0) / 0 (0) | 5, 765 / 850, 5 (0) / 0 (0) |
| | | | | | | ja | stored | 331 | 97, 469 / 722, 95 (0) / 2 (0) | 15, 615 / 830, 15 (0) / 0 (0) |
| | | | | | | en | stored | 576 | 14, 479 / 708, 1 (0) / 13 (0) | 0, — / —, 0 (0) / 0 (0) |
| 4 | 1089 | 94a9fc47 (100) | rebuilt, unaccounted 1 ms | -499 | 490 / 0 / 490; 3 / 395 | ko | stored | 58 | 91, 324 / 517, 90 (0) / 1 (0) | 6, 193 / 543, 6 (0) / 0 (0) |
| | | | | | | ja | stored | 71 | 322, 311 / 544, 316 (0) / 6 (0) | 21, 347 / 548, 21 (0) / 0 (0) |
| | | | | | | en | stored | 99 | 47, 289 / 547, 43 (0) / 4 (0) | 3, 379 / 511, 3 (0) / 0 (0) |
| 5 | 1091 | 663d93cf (250) | rebuilt, unaccounted 0 ms | -536 | 120 / 0 / 120; 3 / 539 | ko | stored | 135 | 25, 107 / 661, 8 (0) / 17 (0) | 2, 655 / 757, 2 (0) / 0 (0) |
| | | | | | | ja | stored | 126 | 73, 108 / 671, 28 (0) / 45 (0) | 14, 724 / 822, 12 (0) / 2 (0) |
| | | | | | | en | stored | 250 | 5, 112 / 636, 1 (0) / 4 (0) | 1, 111 / 111, 0 (0) / 1 (0) |
| 6 | 1092 | 4547a4c9 (107) | rebuilt, unaccounted 0 ms | -497 | 485 / 0 / 485; 3 / 435 | ko | stored | 61 | 91, 258 / 540, 91 (0) / 0 (0) | 6, 438 / 505, 6 (0) / 0 (0) |
| | | | | | | ja | stored | 76 | 318, 303 / 537, 310 (0) / 8 (0) | 21, 319 / 544, 21 (0) / 0 (0) |
| | | | | | | en | stored | 107 | 46, 325 / 520, 41 (0) / 5 (0) | 3, 190 / 190, 3 (0) / 0 (0) |
| 7 | 1094 | d6726cb4 (297) | rebuilt, unaccounted 1 ms | -527 | 113 / 0 / 113; 3 / 431 | ko | stored | 120 | 16, 589 / 639, 12 (0) / 4 (0) | 2, 627 / 676, 2 (0) / 0 (0) |
| | | | | | | ja | stored | 102 | 70, 586 / 657, 44 (0) / 26 (0) | 11, 677 / 725, 8 (0) / 3 (0) |
| | | | | | | en | stored | 296 | 13, 573 / 634, 9 (0) / 4 (0) | 1, 627 / 627, 1 (0) / 0 (0) |
| 8 | 1095 | 1c211a24 (104) | rebuilt, unaccounted 1 ms | -508 | 489 / 0 / 489; 3 / 192 | ko | stored | 58 | 93, 329 / 531, 90 (0) / 3 (0) | 6, 373 / 555, 6 (0) / 0 (0) |
| | | | | | | ja | stored | 71 | 321, 317 / 531, 311 (0) / 10 (0) | 20, 305 / 539, 19 (0) / 1 (0) |
| | | | | | | en | stored | 103 | 46, 284 / 506, 42 (0) / 4 (0) | 3, 493 / 537, 2 (0) / 1 (0) |
