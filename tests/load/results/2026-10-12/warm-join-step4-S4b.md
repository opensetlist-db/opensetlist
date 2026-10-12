## Warm join — 2026-10-12T04-33-39-344Z-browsers-overlap.json + 2026-10-12T04-30-20Z-vercel-logs-history-step4-S4b.txt

Per save and locale: warm-complete − commit (commit proxy = the PUT's response), and each client's FIRST notification fetch of the save split by whether it left after that locale's entry existed. hit = `x-snapshot-source: warm`.

- **SDK**: first hinted fetches 3323; arrived after warm-complete 1965/3323 (59 %); hit rate after 1965/1965 (100 %), before 1356/1358 (100 %); all hits 3321; minRev ≠ rev 0; served newer than key 422
- **pages**: first hinted fetches 222; arrived after warm-complete 117/222 (53 %); hit rate after 117/117 (100 %), before 104/105 (99 %); all hits 221; minRev ≠ rev 0; served newer than key 35
- warm jobs in the logs: 24
- overlap groups (head = highest committed rev; the gate clock is the last save start): 1: A 1547, B 1548, C 1549 → head 1549; 2: A 1551, B 1550, C 1552 → head 1552; 3: A 1553, B 1554, C 1555 → head 1555; 4: A 1556, B 1557, C 1558 → head 1558; 5: A 1559, B 1560, C 1561 → head 1561; 6: A 1562, B 1563, C 1564 → head 1564
- offsets: `at` = server timestamps (set `at` − writer `at`); `log` / `rebuilt` = job-start based (older logs).

| # | rev | warm job (start → done ms) | offsets | log PUT − harness PUT ms | log: lookups / hits / hinted; builds warm / reader | entry rev ≠ key rev | locale | entry | warm-complete − commit ms | SDK: n, arrival p50 / p95, after (hits) / before (hits) | pages: same |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1A | 1547 | 178c16e7 (126) | at, unaccounted 0 ms | -219 | 100 / 100 / 100; 3 / 2 | — | ko | stored | 88 | 13, 105 / 151, 8 (8) / 5 (5) | 1, 107 / 107, 1 (1) / 0 (0) |
| | | | | | | | ja | stored | 116 | 62, 101 / 145, 25 (25) / 37 (37) | 6, 94 / 142, 2 (2) / 4 (4) |
| | | | | | | | en | stored | 138 | 8, 93 / 149, 2 (2) / 6 (6) | 1, 142 / 142, 1 (1) / 0 (0) |
| 1B | 1548 | 46f862ec (200) | at, unaccounted 0 ms | -190 | 121 / 121 / 121; 2 / 1 | en→1549 | ko | stored | 165 | 19, 100 / 143, 0 (0) / 19 (19) | 2, 107 / 134, 0 (0) / 2 (2) |
| | | | | | | | ja | stored | 65 | 74, 98 / 136, 65 (65) / 9 (9) | 4, 71 / 107, 3 (3) / 1 (1) |
| | | | | | | | en | stored | 209 | 13, 91 / 129, 0 (0) / 13 (13), served newer 13 | 0, — / —, 0 (0) / 0 (0) |
| 1C | 1549 | afb766c8 (161) | at, unaccounted 0 ms | -190 | 466 / 466 / 466; 4 / 162 | — | ko | stored | 114 | 88, 198 / 1020, 73 (73) / 15 (15) | 4, 148 / 1056, 3 (3) / 1 (1) |
| | | | | | | | ja | stored | 122 | 309, 235 / 1024, 242 (242) / 67 (67) | 21, 195 / 1017, 16 (16) / 5 (5) |
| | | | | | | | en | stored | 167 | 32, 173 / 931, 18 (18) / 14 (14) | 3, 184 / 949, 2 (2) / 1 (1) |
| 2A | 1551 | afb766c8 (201) | at, unaccounted 0 ms | -161 | 89 / 89 / 89; 1 / 0 | ja→1552, ko→1552, en→1552 | ko | stored | 145 | 14, 50 / 77, 0 (0) / 14 (14), served newer 14 | 2, 42 / 78, 0 (0) / 2 (2), served newer 2 |
| | | | | | | | ja | stored | 136 | 45, 58 / 85, 0 (0) / 45 (45), served newer 45 | 8, 60 / 79, 0 (0) / 8 (8), served newer 8 |
| | | | | | | | en | stored | 206 | 10, 54 / 88, 0 (0) / 10 (10), served newer 10 | 1, 66 / 66, 0 (0) / 1 (1), served newer 1 |
| 2B | 1550 | afb766c8 (206) | at, unaccounted 0 ms | -194 | 61 / 61 / 61; 1 / 0 | en→1552, ja→1551 | ko | stored | 99 | 11, 76 / 94, 0 (0) / 11 (11) | 0, — / —, 0 (0) / 0 (0) |
| | | | | | | | ja | stored | 102 | 35, 75 / 97, 0 (0) / 35 (35), served newer 35 | 0, — / —, 0 (0) / 0 (0) |
| | | | | | | | en | stored | 212 | 6, 76 / 87, 0 (0) / 6 (6), served newer 6 | 0, — / —, 0 (0) / 0 (0) |
| 2C | 1552 | 8f9143a5 (104) | at, unaccounted 0 ms | -195 | 417 / 417 / 417; 7 / 154 | — | ko | stored | 60 | 79, 147 / 985, 69 (69) / 10 (10) | 4, 46 / 103, 2 (2) / 2 (2) |
| | | | | | | | ja | stored | 53 | 279, 158 / 983, 254 (254) / 25 (25) | 13, 133 / 420, 10 (10) / 3 (3) |
| | | | | | | | en | stored | 111 | 31, 106 / 411, 14 (14) / 17 (17) | 2, 87 / 133, 1 (1) / 1 (1) |
| 3A | 1553 | afb91b5f (123) | at, unaccounted 0 ms | -186 | 77 / 77 / 77; 2 / 2 | en→1554 | ko | stored | 52 | 10, 109 / 118, 10 (10) / 0 (0) | 2, 59 / 67, 2 (2) / 0 (0) |
| | | | | | | | ja | stored | 90 | 44, 92 / 128, 26 (26) / 18 (18) | 4, 77 / 146, 2 (2) / 2 (2) |
| | | | | | | | en | stored | 134 | 8, 93 / 138, 2 (2) / 6 (6), served newer 8 | 0, — / —, 0 (0) / 0 (0) |
| 3B | 1554 | afb91b5f (102) | at, unaccounted 0 ms | -191 | 110 / 110 / 110; 3 / 1 | en→1555 | ko | stored | 47 | 17, 47 / 76, 8 (8) / 9 (9) | 1, 55 / 55, 1 (1) / 0 (0) |
| | | | | | | | ja | stored | 79 | 65, 39 / 64, 1 (1) / 64 (64) | 9, 29 / 75, 0 (0) / 9 (9) |
| | | | | | | | en | stored | 106 | 8, 40 / 68, 0 (0) / 8 (8), served newer 8 | 1, 30 / 30, 0 (0) / 1 (1), served newer 1 |
| 3C | 1555 | 8ad750c7 (182) | at, unaccounted 0 ms | -192 | 492 / 492 / 492; 4 / 179 | — | ko | stored | 75 | 93, 208 / 1052, 77 (77) / 16 (16) | 6, 187 / 1033, 6 (6) / 0 (0) |
| | | | | | | | ja | stored | 79 | 322, 239 / 1041, 286 (286) / 36 (36) | 21, 990 / 1050, 18 (18) / 3 (3) |
| | | | | | | | en | stored | 189 | 39, 154 / 1003, 16 (16) / 23 (23) | 2, 47 / 257, 1 (1) / 1 (1) |
| 4A | 1556 | 8ad750c7 (117) | at, unaccounted 0 ms | 76 | 117 / 117 / 117; 3 / 2 | — | ko | stored | 67 | 20, 104 / 148, 17 (17) / 3 (3) | 2, 128 / 139, 2 (2) / 0 (0) |
| | | | | | | | ja | stored | 72 | 68, 106 / 164, 58 (58) / 10 (10) | 5, 144 / 166, 4 (4) / 1 (1) |
| | | | | | | | en | stored | 124 | 11, 120 / 155, 4 (4) / 7 (7) | 2, 60 / 70, 0 (0) / 2 (2) |
| 4B | 1557 | 5fd95f2f (128) | at, unaccounted 0 ms | 75 | 92 / 92 / 92; 1 / 3 | ja→1558, en→1558 | ko | stored | 107 | 20, 65 / 90, 0 (0) / 20 (20) | 1, 47 / 47, 0 (0) / 1 (1) |
| | | | | | | | ja | stored | 140 | 52, 61 / 97, 0 (0) / 52 (52), served newer 52 | 4, 62 / 65, 0 (0) / 4 (4), served newer 4 |
| | | | | | | | en | stored | 161 | 5, 76 / 123, 0 (0) / 5 (5), served newer 5 | 0, — / —, 0 (0) / 0 (0) |
| 4C | 1558 | afb91b5f (166) | at, unaccounted 0 ms | 81 | 439 / 439 / 439; 5 / 191 | — | ko | stored | 89 | 93, 267 / 1044, 86 (86) / 7 (7) | 6, 344 / 1014, 4 (4) / 2 (2) |
| | | | | | | | ja | stored | 111 | 268, 161 / 976, 196 (196) / 72 (72) | 17, 233 / 994, 15 (15) / 2 (2) |
| | | | | | | | en | stored | 170 | 42, 158 / 975, 19 (19) / 23 (23) | 3, 902 / 902, 3 (3) / 0 (0) |
| 5A | 1559 | 579a5afe (150) | at, unaccounted 0 ms | -183 | 88 / 88 / 88; 1 / 1 | ja→1560, en→1561 | ko | stored | 77 | 18, 90 / 124, 15 (15) / 3 (3) | 1, 68 / 68, 0 (0) / 1 (1) |
| | | | | | | | ja | stored | 121 | 47, 89 / 119, 2 (2) / 45 (45), served newer 47 | 4, 107 / 122, 1 (1) / 3 (3), served newer 4 |
| | | | | | | | en | stored | 167 | 8, 72 / 110, 0 (0) / 8 (8), served newer 8 | 1, 108 / 108, 0 (0) / 1 (1), served newer 1 |
| 5B | 1560 | 0b6a1b20 (120) | at, unaccounted 0 ms | -197 | 71 / 71 / 71; 2 / 0 | ja→1561, en→1561 | ko | stored | 78 | 12, 69 / 92, 2 (2) / 10 (10) | 2, 62 / 62, 0 (0) / 2 (2) |
| | | | | | | | ja | stored | 97 | 41, 64 / 79, 0 (0) / 41 (41), served newer 41 | 3, 78 / 92, 0 (0) / 3 (3), served newer 3 |
| | | | | | | | en | stored | 135 | 3, 61 / 76, 0 (0) / 3 (3), served newer 3 | 1, 39 / 39, 0 (0) / 1 (1), served newer 1 |
| 5C | 1561 | 579a5afe (170) | at, unaccounted 0 ms | -203 | 432 / 432 / 432; 6 / 217 | — | ko | stored | 101 | 91, 188 / 1044, 77 (77) / 14 (14) | 6, 329 / 1031, 5 (5) / 1 (1) |
| | | | | | | | ja | stored | 119 | 275, 160 / 998, 176 (176) / 99 (99) | 15, 130 / 1013, 8 (8) / 7 (7) |
| | | | | | | | en | stored | 177 | 35, 133 / 379, 12 (12) / 23 (23) | 1, 88 / 88, 0 (0) / 1 (1) |
| 6A | 1562 | c4b22cb9 (264) | at, unaccounted 0 ms | -186 | 86 / 85 / 86; 0 / 0 | ko→1563, ja→1564, en→1564 | ko | stored | 115 | 19, 86 / 136, 1 (1) / 18 (18), served newer 19 | 1, 68 / 68, 0 (0) / 1 (1), served newer 1 |
| | | | | | | | ja | stored | 166 | 44, 68 / 116, 0 (0) / 44 (44), served newer 44 | 4, 59 / 104, 0 (0) / 4 (4), served newer 4 |
| | | | | | | | en | stored | 287 | 7, 88 / 116, 0 (0) / 7 (6), served newer 6 | 2, 88 / 89, 0 (0) / 2 (2), served newer 2 |
| 6B | 1563 | c4b22cb9 (343) | at, unaccounted 1 ms | -189 | 70 / 70 / 70; 1 / 1 | ko→1564, ja→1564, en→1564 | ko | stored | 164 | 12, 84 / 112, 0 (0) / 12 (12), served newer 12 | 1, 77 / 77, 0 (0) / 1 (1), served newer 1 |
| | | | | | | | ja | stored | 169 | 39, 91 / 113, 0 (0) / 39 (39), served newer 39 | 2, 113 / 116, 0 (0) / 2 (2), served newer 2 |
| | | | | | | | en | stored | 349 | 7, 97 / 109, 0 (0) / 7 (7), served newer 7 | 0, — / —, 0 (0) / 0 (0) |
| 6C | 1564 | c4b22cb9 (363) | at, unaccounted 0 ms | -195 | 381 / 379 / 381; 8 / 48 | — | ko | stored | 169 | 80, 185 / 982, 43 (43) / 37 (37) | 5, 304 / 946, 3 (3) / 2 (2) |
| | | | | | | | ja | stored | 225 | 240, 130 / 322, 61 (61) / 179 (179) | 14, 83 / 351, 1 (1) / 13 (13) |
| | | | | | | | en | stored | 368 | 32, 126 / 305, 0 (0) / 32 (31) | 1, 149 / 149, 0 (0) / 1 (0) |
