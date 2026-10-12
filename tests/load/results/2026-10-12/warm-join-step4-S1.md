## Warm join — 2026-10-12T04-16-19-404Z-browsers-overlap.json + 2026-10-12T04-13-05Z-vercel-logs-history-step4-S1.txt

Per save and locale: warm-complete − commit (commit proxy = the PUT's response), and each client's FIRST notification fetch of the save split by whether it left after that locale's entry existed. hit = `x-snapshot-source: warm`.

- **SDK**: first hinted fetches 3686; arrived after warm-complete 3093/3686 (84 %); hit rate after 3093/3093 (100 %), before 593/593 (100 %); all hits 3686; minRev ≠ rev 0; served newer than key 0
- **pages**: first hinted fetches 244; arrived after warm-complete 201/244 (82 %); hit rate after 201/201 (100 %), before 43/43 (100 %); all hits 244; minRev ≠ rev 0; served newer than key 0
- warm jobs in the logs: 16
- overlap groups (head = highest committed rev; the gate clock is the last save start): 1: A 1487, B 1488 → head 1488; 2: A 1489, B 1490 → head 1490; 3: A 1491, B 1492 → head 1492; 4: A 1493, B 1494 → head 1494; 5: A 1495, B 1496 → head 1496; 6: A 1497, B 1498 → head 1498
- offsets: `at` = server timestamps (set `at` − writer `at`); `log` / `rebuilt` = job-start based (older logs).

| # | rev | warm job (start → done ms) | offsets | log PUT − harness PUT ms | log: lookups / hits / hinted; builds warm / reader | entry rev ≠ key rev | locale | entry | warm-complete − commit ms | SDK: n, arrival p50 / p95, after (hits) / before (hits) | pages: same |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1A | 1487 | c5d81a84 (149) | at, unaccounted 1 ms | -143 | 224 / 224 / 224; 3 / 11 | — | ko | stored | 90 | 47, 190 / 276, 42 (42) / 5 (5) | 4, 130 / 245, 4 (4) / 0 (0) |
| | | | | | | | ja | stored | 99 | 136, 175 / 284, 120 (120) / 16 (16) | 10, 192 / 261, 9 (9) / 1 (1) |
| | | | | | | | en | stored | 154 | 17, 221 / 276, 12 (12) / 5 (5) | 1, 101 / 101, 0 (0) / 1 (1) |
| 1B | 1488 | 0797c6ca (138) | at, unaccounted 0 ms | -143 | 478 / 478 / 478; 3 / 195 | — | ko | stored | 80 | 89, 254 / 990, 73 (73) / 16 (16) | 6, 828 / 969, 5 (5) / 1 (1) |
| | | | | | | | ja | stored | 133 | 307, 254 / 989, 211 (211) / 96 (96) | 20, 249 / 956, 13 (13) / 7 (7) |
| | | | | | | | en | stored | 144 | 44, 224 / 975, 24 (24) / 20 (20) | 3, 300 / 828, 3 (3) / 0 (0) |
| 2A | 1489 | 1bf0d46e (141) | at, unaccounted 0 ms | -180 | 197 / 197 / 197; 3 / 2 | — | ko | stored | 111 | 39, 146 / 203, 23 (23) / 16 (16) | 3, 180 / 230, 2 (2) / 1 (1) |
| | | | | | | | ja | stored | 115 | 115, 116 / 217, 58 (58) / 57 (57) | 11, 87 / 194, 4 (4) / 7 (7) |
| | | | | | | | en | stored | 174 | 17, 162 / 217, 7 (7) / 10 (10) | 3, 208 / 213, 2 (2) / 1 (1) |
| 2B | 1490 | f62e882e (139) | at, unaccounted 0 ms | -185 | 493 / 493 / 493; 3 / 159 | — | ko | stored | 67 | 93, 268 / 999, 88 (88) / 5 (5) | 6, 231 / 1046, 5 (5) / 1 (1) |
| | | | | | | | ja | stored | 77 | 318, 232 / 1010, 279 (279) / 39 (39) | 20, 284 / 981, 18 (18) / 2 (2) |
| | | | | | | | en | stored | 146 | 45, 218 / 1022, 31 (31) / 14 (14) | 2, 966 / 1032, 2 (2) / 0 (0) |
| 3A | 1491 | afb766c8 (116) | at, unaccounted 1 ms | -181 | 111 / 111 / 111; 3 / 2 | — | ko | stored | 95 | 18, 83 / 144, 7 (7) / 11 (11) | 3, 59 / 103, 1 (1) / 2 (2) |
| | | | | | | | ja | stored | 119 | 69, 99 / 147, 18 (18) / 51 (51) | 2, 58 / 70, 0 (0) / 2 (2) |
| | | | | | | | en | stored | 133 | 9, 89 / 144, 1 (1) / 8 (8) | 1, 66 / 66, 0 (0) / 1 (1) |
| 3B | 1492 | f62e882e (102) | at, unaccounted 0 ms | -184 | 496 / 496 / 496; 3 / 174 | — | ko | stored | 55 | 91, 206 / 1016, 91 (91) / 0 (0) | 6, 430 / 1020, 6 (6) / 0 (0) |
| | | | | | | | ja | stored | 81 | 321, 225 / 1033, 302 (302) / 19 (19) | 21, 197 / 980, 19 (19) / 2 (2) |
| | | | | | | | en | stored | 106 | 45, 205 / 1033, 35 (35) / 10 (10) | 3, 260 / 979, 3 (3) / 0 (0) |
| 4A | 1493 | 8cad27e0 (123) | at, unaccounted 0 ms | -176 | 153 / 153 / 153; 3 / 2 | — | ko | stored | 84 | 29, 149 / 178, 23 (23) / 6 (6) | 2, 131 / 135, 2 (2) / 0 (0) |
| | | | | | | | ja | stored | 91 | 95, 102 / 182, 56 (56) / 39 (39) | 7, 104 / 183, 5 (5) / 2 (2) |
| | | | | | | | en | stored | 134 | 10, 87 / 187, 3 (3) / 7 (7) | 1, 60 / 60, 0 (0) / 1 (1) |
| 4B | 1494 | f62e882e (137) | at, unaccounted 0 ms | -195 | 493 / 493 / 493; 3 / 197 | — | ko | stored | 61 | 92, 245 / 1025, 87 (87) / 5 (5) | 6, 278 / 992, 5 (5) / 1 (1) |
| | | | | | | | ja | stored | 48 | 319, 215 / 1019, 311 (311) / 8 (8) | 19, 187 / 1040, 18 (18) / 1 (1) |
| | | | | | | | en | stored | 143 | 45, 281 / 973, 35 (35) / 10 (10) | 3, 357 / 912, 3 (3) / 0 (0) |
| 5A | 1495 | 86c76005 (104) | at, unaccounted 0 ms | -193 | 156 / 156 / 156; 3 / 6 | — | ko | stored | 75 | 26, 90 / 206, 19 (19) / 7 (7) | 4, 133 / 177, 3 (3) / 1 (1) |
| | | | | | | | ja | stored | 85 | 96, 130 / 209, 73 (73) / 23 (23) | 3, 149 / 225, 3 (3) / 0 (0) |
| | | | | | | | en | stored | 117 | 17, 108 / 207, 7 (7) / 10 (10) | 1, 51 / 51, 0 (0) / 1 (1) |
| 5B | 1496 | 8cad27e0 (101) | at, unaccounted 0 ms | -191 | 484 / 484 / 484; 3 / 218 | — | ko | stored | 78 | 86, 227 / 1009, 80 (80) / 6 (6) | 6, 897 / 999, 5 (5) / 1 (1) |
| | | | | | | | ja | stored | 49 | 315, 239 / 1008, 309 (309) / 6 (6) | 21, 171 / 981, 21 (21) / 0 (0) |
| | | | | | | | en | stored | 107 | 44, 222 / 1008, 38 (38) / 6 (6) | 3, 264 / 881, 3 (3) / 0 (0) |
| 6A | 1497 | 8cad27e0 (105) | at, unaccounted 0 ms | -181 | 259 / 259 / 259; 3 / 5 | — | ko | stored | 49 | 56, 171 / 306, 56 (56) / 0 (0) | 3, 265 / 284, 3 (3) / 0 (0) |
| | | | | | | | ja | stored | 61 | 160, 177 / 289, 158 (158) / 2 (2) | 11, 196 / 283, 11 (11) / 0 (0) |
| | | | | | | | en | stored | 110 | 20, 135 / 296, 12 (12) / 8 (8) | 0, — / —, 0 (0) / 0 (0) |
| 6B | 1498 | f62e882e (97) | at, unaccounted 0 ms | -190 | 494 / 494 / 494; 3 / 53 | — | ko | stored | 62 | 91, 815 / 1008, 78 (78) / 13 (13) | 6, 78 / 1034, 5 (5) / 1 (1) |
| | | | | | | | ja | stored | 53 | 318, 250 / 973, 292 (292) / 26 (26) | 20, 244 / 973, 16 (16) / 4 (4) |
| | | | | | | | en | stored | 105 | 47, 210 / 996, 34 (34) / 13 (13) | 3, 196 / 230, 2 (2) / 1 (1) |
