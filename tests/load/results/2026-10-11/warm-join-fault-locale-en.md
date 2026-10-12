## Warm join — 2026-10-11T20-13-42-983Z-browsers.json + 2026-10-11T200938Z-vercel-logs-history-fault-locale-en.txt

Per save and locale: warm-complete − commit (commit proxy = the PUT's response), and each client's FIRST notification fetch of the save split by whether it left after that locale's entry existed. hit = `x-snapshot-source: warm`.

- **SDK**: first hinted fetches 3484; arrived after warm-complete 3200/3484 (92 %); hit rate after 3200/3200 (100 %), before 38/284 (13 %); all hits 3238; minRev ≠ rev 0
- **pages**: first hinted fetches 229; arrived after warm-complete 207/229 (90 %); hit rate after 207/207 (100 %), before 0/22 (0 %); all hits 207; minRev ≠ rev 0
- warm jobs in the logs: 18

| # | rev | warm job (start → done ms) | offsets | log PUT − harness PUT ms | log: lookups / hits / hinted; builds warm / reader | locale | entry | warm-complete − commit ms | SDK: n, arrival p50 / p95, after (hits) / before (hits) | pages: same |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 1123 | b163b96e (141) | rebuilt, unaccounted 3 ms | -543 | 411 / 397 / 411; 2 / 322 | ko | stored | 137 | 82, 693 / 947, 82 (82) / 0 (0) | 6, 664 / 916, 6 (6) / 0 (0) |
| | | | | | | ja | stored | 138 | 288, 671 / 941, 288 (288) / 0 (0) | 21, 680 / 917, 21 (21) / 0 (0) |
| | | | | | | en | — | — | 11, 521 / 704, 0 (0) / 11 (0) | 3, 501 / 782, 0 (0) / 3 (0) |
| 2 | 1124 | 1820d149 (68) | rebuilt, unaccounted 1 ms | -513 | 486 / 438 / 486; 2 / 225 | ko | stored | 67 | 94, 290 / 538, 92 (92) / 2 (2) | 6, 311 / 490, 6 (6) / 0 (0) |
| | | | | | | ja | stored | 63 | 318, 297 / 531, 313 (313) / 5 (5) | 20, 311 / 548, 20 (20) / 0 (0) |
| | | | | | | en | — | — | 45, 343 / 587, 0 (0) / 45 (0) | 3, 121 / 425, 0 (0) / 3 (0) |
| 3 | 1126 | 1a0b5043 (69) | rebuilt, unaccounted 1 ms | -536 | 456 / 434 / 456; 2 / 249 | ko | stored | 65 | 90, 571 / 845, 90 (90) / 0 (0) | 5, 620 / 759, 5 (5) / 0 (0) |
| | | | | | | ja | stored | 68 | 320, 632 / 846, 320 (320) / 0 (0) | 19, 653 / 862, 19 (19) / 0 (0) |
| | | | | | | en | — | — | 20, 515 / 749, 0 (0) / 20 (0) | 2, 545 / 636, 0 (0) / 2 (0) |
| 4 | 1127 | 04aa72a3 (72) | rebuilt, unaccounted 1 ms | -510 | 487 / 442 / 487; 2 / 234 | ko | stored | 71 | 91, 282 / 545, 87 (87) / 4 (4) | 6, 232 / 563, 6 (6) / 0 (0) |
| | | | | | | ja | stored | 63 | 325, 292 / 515, 319 (319) / 6 (6) | 20, 236 / 548, 20 (20) / 0 (0) |
| | | | | | | en | — | — | 42, 244 / 519, 0 (0) / 42 (0) | 3, 403 / 508, 0 (0) / 3 (0) |
| 5 | 1129 | f453d02b (120) | rebuilt, unaccounted 0 ms | -539 | 442 / 420 / 442; 2 / 248 | ko | stored | 72 | 88, 608 / 1124, 88 (88) / 0 (0) | 5, 533 / 735, 5 (5) / 0 (0) |
| | | | | | | ja | stored | 120 | 306, 583 / 1105, 306 (306) / 0 (0) | 21, 620 / 804, 21 (21) / 0 (0) |
| | | | | | | en | — | — | 19, 533 / 716, 0 (0) / 19 (0) | 3, 524 / 525, 0 (0) / 3 (0) |
| 6 | 1130 | 488e1f6b (76) | rebuilt, unaccounted 1 ms | -481 | 492 / 443 / 492; 2 / 205 | ko | stored | 63 | 92, 292 / 551, 91 (91) / 1 (1) | 6, 259 / 527, 6 (6) / 0 (0) |
| | | | | | | ja | stored | 75 | 325, 318 / 541, 316 (316) / 9 (9) | 20, 295 / 510, 20 (20) / 0 (0) |
| | | | | | | en | — | — | 46, 336 / 541, 0 (0) / 46 (0) | 3, 441 / 473, 0 (0) / 3 (0) |
| 7 | 1132 | 5ca6d0c9 (104) | rebuilt, unaccounted 1 ms | -547 | 452 / 432 / 452; 2 / 249 | ko | stored | 74 | 91, 742 / 921, 91 (91) / 0 (0) | 5, 701 / 934, 5 (5) / 0 (0) |
| | | | | | | ja | stored | 103 | 315, 710 / 923, 315 (315) / 0 (0) | 21, 700 / 950, 21 (21) / 0 (0) |
| | | | | | | en | — | — | 18, 530 / 826, 0 (0) / 18 (0) | 2, 769 / 833, 0 (0) / 2 (0) |
| 8 | 1133 | 5ca6d0c9 (77) | rebuilt, unaccounted 0 ms | -513 | 487 / 439 / 487; 2 / 81 | ko | stored | 49 | 88, 342 / 534, 88 (88) / 0 (0) | 5, 382 / 480, 5 (5) / 0 (0) |
| | | | | | | ja | stored | 77 | 325, 288 / 523, 314 (314) / 11 (11) | 21, 324 / 556, 21 (21) / 0 (0) |
| | | | | | | en | — | — | 45, 301 / 547, 0 (0) / 45 (0) | 3, 337 / 367, 0 (0) / 3 (0) |
