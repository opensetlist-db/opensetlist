## Warm join — 2026-10-11T20-22-50-909Z-browsers.json + 2026-10-11T201844Z-vercel-logs-history-fault-setskip.txt

Per save and locale: warm-complete − commit (commit proxy = the PUT's response), and each client's FIRST notification fetch of the save split by whether it left after that locale's entry existed. hit = `x-snapshot-source: warm`.

- **SDK**: first hinted fetches 2571; arrived after warm-complete 2471/2571 (96 %); hit rate after 0/2471 (0 %), before 0/100 (0 %); all hits 0; minRev ≠ rev 0
- **pages**: first hinted fetches 206; arrived after warm-complete 198/206 (96 %); hit rate after 0/198 (0 %), before 0/8 (0 %); all hits 0; minRev ≠ rev 0
- warm jobs in the logs: 18

| # | rev | warm job (start → done ms) | offsets | log PUT − harness PUT ms | log: lookups / hits / hinted; builds warm / reader | locale | entry | warm-complete − commit ms | SDK: n, arrival p50 / p95, after (hits) / before (hits) | pages: same |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 1161 | 1c633af5 (1095) | rebuilt, unaccounted 1 ms | -476 | 235 / 0 / 235; 3 / 399 | ko | stored | 290 | 38, 279 / 548, 19 (0) / 19 (0) | 5, 525 / 636, 4 (0) / 1 (0) |
| | | | | | | ja | stored | 286 | 156, 374 / 574, 126 (0) / 30 (0) | 18, 418 / 621, 15 (0) / 3 (0) |
| | | | | | | en | stored | 1094 | 16, 307 / 575, 0 (0) / 16 (0) | 2, 342 / 571, 0 (0) / 2 (0) |
| 2 | 1162 | d55e2ace (79) | rebuilt, unaccounted 2 ms | -522 | 493 / 0 / 493; 3 / 373 | ko | stored | 52 | 92, 253 / 560, 92 (0) / 0 (0) | 6, 158 / 577, 6 (0) / 0 (0) |
| | | | | | | ja | stored | 45 | 325, 300 / 567, 325 (0) / 0 (0) | 21, 230 / 411, 21 (0) / 0 (0) |
| | | | | | | en | stored | 77 | 46, 297 / 549, 42 (0) / 4 (0) | 3, 317 / 547, 3 (0) / 0 (0) |
| 3 | 1164 | c2ec65ad (435) | rebuilt, unaccounted 1 ms | -556 | 139 / 0 / 139; 3 / 461 | ko | stored | 170 | 16, 500 / 773, 16 (0) / 0 (0) | 5, 552 / 628, 5 (0) / 0 (0) |
| | | | | | | ja | stored | 154 | 88, 515 / 731, 86 (0) / 2 (0) | 15, 708 / 810, 15 (0) / 0 (0) |
| | | | | | | en | stored | 434 | 13, 529 / 763, 12 (0) / 1 (0) | 2, 504 / 777, 2 (0) / 0 (0) |
| 4 | 1165 | 50e2ca7c (94) | rebuilt, unaccounted 0 ms | -520 | 494 / 0 / 494; 3 / 429 | ko | stored | 60 | 94, 268 / 526, 90 (0) / 4 (0) | 6, 306 / 469, 6 (0) / 0 (0) |
| | | | | | | ja | stored | 57 | 325, 294 / 534, 325 (0) / 0 (0) | 20, 252 / 529, 19 (0) / 1 (0) |
| | | | | | | en | stored | 94 | 46, 325 / 486, 45 (0) / 1 (0) | 3, 376 / 508, 3 (0) / 0 (0) |
| 5 | 1167 | ceabb3a1 (336) | rebuilt, unaccounted 0 ms | -552 | 258 / 0 / 258; 3 / 496 | ko | stored | 113 | 48, 449 / 687, 48 (0) / 0 (0) | 4, 493 / 676, 4 (0) / 0 (0) |
| | | | | | | ja | stored | 128 | 164, 461 / 718, 163 (0) / 1 (0) | 19, 482 / 799, 19 (0) / 0 (0) |
| | | | | | | en | stored | 336 | 20, 422 / 556, 18 (0) / 2 (0) | 3, 482 / 524, 3 (0) / 0 (0) |
| 6 | 1168 | e1657b2f (98) | rebuilt, unaccounted 1 ms | -525 | 489 / 0 / 489; 3 / 379 | ko | stored | 49 | 93, 350 / 531, 93 (0) / 0 (0) | 5, 223 / 356, 5 (0) / 0 (0) |
| | | | | | | ja | stored | 56 | 324, 288 / 532, 323 (0) / 1 (0) | 18, 223 / 541, 18 (0) / 0 (0) |
| | | | | | | en | stored | 97 | 46, 335 / 538, 43 (0) / 3 (0) | 3, 288 / 446, 3 (0) / 0 (0) |
| 7 | 1170 | aaed66e9 (582) | rebuilt, unaccounted 0 ms | -553 | 182 / 0 / 182; 3 / 511 | ko | stored | 228 | 32, 489 / 719, 32 (0) / 0 (0) | 5, 530 / 811, 5 (0) / 0 (0) |
| | | | | | | ja | stored | 340 | 114, 516 / 725, 113 (0) / 1 (0) | 13, 677 / 797, 13 (0) / 0 (0) |
| | | | | | | en | stored | 582 | 16, 489 / 720, 1 (0) / 15 (0) | 2, 564 / 646, 1 (0) / 1 (0) |
| 8 | 1171 | 46ec40b0 (90) | rebuilt, unaccounted 0 ms | -530 | 487 / 0 / 487; 3 / 181 | ko | stored | 50 | 92, 319 / 544, 92 (0) / 0 (0) | 6, 361 / 545, 6 (0) / 0 (0) |
| | | | | | | ja | stored | 58 | 321, 291 / 529, 321 (0) / 0 (0) | 19, 288 / 455, 19 (0) / 0 (0) |
| | | | | | | en | stored | 90 | 46, 280 / 547, 46 (0) / 0 (0) | 3, 419 / 560, 3 (0) / 0 (0) |
