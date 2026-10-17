## Warm join — 2026-10-11T20-18-17-453Z-browsers.json + 2026-10-11T201411Z-vercel-logs-history-fault-seterror.txt

Per save and locale: warm-complete − commit (commit proxy = the PUT's response), and each client's FIRST notification fetch of the save split by whether it left after that locale's entry existed. hit = `x-snapshot-source: warm`.

- **SDK**: first hinted fetches 2702; arrived after warm-complete 0/2702 (0 %); hit rate after 0/0, before 0/2702 (0 %); all hits 0; minRev ≠ rev 0
- **pages**: first hinted fetches 206; arrived after warm-complete 0/206 (0 %); hit rate after 0/0, before 0/206 (0 %); all hits 0; minRev ≠ rev 0
- warm jobs in the logs: 18

| # | rev | warm job (start → done ms) | offsets | log PUT − harness PUT ms | log: lookups / hits / hinted; builds warm / reader | locale | entry | warm-complete − commit ms | SDK: n, arrival p50 / p95, after (hits) / before (hits) | pages: same |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 1142 | 310b51b1 (302) | rebuilt, unaccounted 3 ms | -546 | 374 / 0 / 374; 3 / 474 | ko | — | — | 67, 310 / 528, 0 (0) / 67 (0) | 4, 380 / 427, 0 (0) / 4 (0) |
| | | | | | | ja | — | — | 247, 344 / 529, 0 (0) / 247 (0) | 20, 309 / 509, 0 (0) / 20 (0) |
| | | | | | | en | — | — | 33, 344 / 545, 0 (0) / 33 (0) | 3, 292 / 381, 0 (0) / 3 (0) |
| 2 | 1143 | c9d10b10 (79) | rebuilt, unaccounted 1 ms | -516 | 489 / 0 / 489; 3 / 301 | ko | — | — | 92, 334 / 531, 0 (0) / 92 (0) | 5, 374 / 510, 0 (0) / 5 (0) |
| | | | | | | ja | — | — | 322, 295 / 527, 0 (0) / 322 (0) | 20, 427 / 547, 0 (0) / 20 (0) |
| | | | | | | en | — | — | 47, 332 / 522, 0 (0) / 47 (0) | 3, 171 / 423, 0 (0) / 3 (0) |
| 3 | 1145 | 4d0357c7 (267) | rebuilt, unaccounted 0 ms | -548 | 87 / 0 / 87; 3 / 424 | ko | — | — | 14, 605 / 624, 0 (0) / 14 (0) | 1, 801 / 801, 0 (0) / 1 (0) |
| | | | | | | ja | — | — | 56, 613 / 803, 0 (0) / 56 (0) | 12, 686 / 853, 0 (0) / 12 (0) |
| | | | | | | en | — | — | 3, 598 / 619, 0 (0) / 3 (0) | 1, 66 / 66, 0 (0) / 1 (0) |
| 4 | 1146 | c9d10b10 (65) | rebuilt, unaccounted 1 ms | -522 | 491 / 0 / 491; 3 / 471 | ko | — | — | 90, 323 / 543, 0 (0) / 90 (0) | 6, 235 / 491, 0 (0) / 6 (0) |
| | | | | | | ja | — | — | 324, 311 / 507, 0 (0) / 324 (0) | 21, 373 / 544, 0 (0) / 21 (0) |
| | | | | | | en | — | — | 47, 345 / 540, 0 (0) / 47 (0) | 3, 401 / 544, 0 (0) / 3 (0) |
| 5 | 1148 | b4f3a03b (426) | rebuilt, unaccounted 1 ms | -546 | 250 / 0 / 250; 3 / 439 | ko | — | — | 51, 454 / 742, 0 (0) / 51 (0) | 6, 484 / 586, 0 (0) / 6 (0) |
| | | | | | | ja | — | — | 154, 460 / 725, 0 (0) / 154 (0) | 14, 569 / 771, 0 (0) / 14 (0) |
| | | | | | | en | — | — | 22, 493 / 610, 0 (0) / 22 (0) | 3, 586 / 652, 0 (0) / 3 (0) |
| 6 | 1149 | 55d2975c (106) | rebuilt, unaccounted 1 ms | -519 | 488 / 0 / 488; 3 / 433 | ko | — | — | 90, 283 / 516, 0 (0) / 90 (0) | 6, 378 / 552, 0 (0) / 6 (0) |
| | | | | | | ja | — | — | 322, 274 / 527, 0 (0) / 322 (0) | 20, 288 / 502, 0 (0) / 20 (0) |
| | | | | | | en | — | — | 47, 288 / 508, 0 (0) / 47 (0) | 3, 117 / 236, 0 (0) / 3 (0) |
| 7 | 1151 | 90934d82 (299) | rebuilt, unaccounted 0 ms | -553 | 239 / 0 / 239; 3 / 424 | ko | — | — | 51, 433 / 603, 0 (0) / 51 (0) | 4, 462 / 565, 0 (0) / 4 (0) |
| | | | | | | ja | — | — | 147, 447 / 599, 0 (0) / 147 (0) | 18, 612 / 781, 0 (0) / 18 (0) |
| | | | | | | en | — | — | 16, 395 / 632, 0 (0) / 16 (0) | 3, 529 / 529, 0 (0) / 3 (0) |
| 8 | 1152 | accf147c (108) | rebuilt, unaccounted 1 ms | -519 | 490 / 0 / 490; 3 / 210 | ko | — | — | 93, 307 / 507, 0 (0) / 93 (0) | 6, 252 / 466, 0 (0) / 6 (0) |
| | | | | | | ja | — | — | 320, 276 / 525, 0 (0) / 320 (0) | 21, 252 / 482, 0 (0) / 21 (0) |
| | | | | | | en | — | — | 47, 294 / 476, 0 (0) / 47 (0) | 3, 358 / 408, 0 (0) / 3 (0) |
