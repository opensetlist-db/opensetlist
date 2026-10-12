## Warm join — 2026-10-12T02-16-19-723Z-browsers-overlap.json + 2026-10-12T02-13-02Z-vercel-logs-history-step4-S2.txt

Per save and locale: warm-complete − commit (commit proxy = the PUT's response), and each client's FIRST notification fetch of the save split by whether it left after that locale's entry existed. hit = `x-snapshot-source: warm`.

- **SDK**: first hinted fetches 2823; arrived after warm-complete 687/2823 (24 %); hit rate after 687/687 (100 %), before 726/2136 (34 %); all hits 1413; minRev ≠ rev 0; served newer than key 0
- **pages**: first hinted fetches 181; arrived after warm-complete 49/181 (27 %); hit rate after 49/49 (100 %), before 46/132 (35 %); all hits 95; minRev ≠ rev 0; served newer than key 0
- warm jobs in the logs: 16
- overlap groups (head = highest committed rev; the gate clock is the last save start): 1: A 1336, B 1337 → head 1337; 2: A 1338, B 1339 → head 1339; 3: A 1340, B 1341 → head 1341; 4: A 1342, B 1343 → head 1343; 5: A 1344, B 1345 → head 1345; 6: A 1346, B 1347 → head 1347
- offsets: `at` = server timestamps (set `at` − writer `at`); `log` / `rebuilt` = job-start based (older logs).

| # | rev | warm job (start → done ms) | offsets | log PUT − harness PUT ms | log: lookups / hits / hinted; builds warm / reader | entry rev ≠ key rev | locale | entry | warm-complete − commit ms | SDK: n, arrival p50 / p95, after (hits) / before (hits) | pages: same |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1A | 1336 | cc1afb31 (3159) | at, unaccounted 0 ms | -127 | 305 / 5 / 305; 2 / 18 | en→1337 | ko | stored | 1582 | 59, 239 / 351, 0 (0) / 59 (0) | 4, 210 / 325, 0 (0) / 4 (0) |
| | | | | | | | ja | stored | 1591 | 188, 203 / 342, 0 (0) / 188 (0) | 12, 261 / 359, 0 (0) / 12 (0) |
| | | | | | | | en | stored | 3167 | 31, 214 / 346, 0 (0) / 31 (0) | 2, 161 / 326, 0 (0) / 2 (0) |
| 1B | 1337 | 3be4f9e6 (388) | at, unaccounted 0 ms | -125 | 212 / 205 / 212; 4 / 362 | — | ko | stored | 200 | 36, 83 / 708, 8 (8) / 28 (28) | 2, 54 / 278, 1 (1) / 1 (1) |
| | | | | | | | ja | stored | 242 | 140, 65 / 676, 10 (10) / 130 (128) | 9, 71 / 731, 2 (2) / 7 (6) |
| | | | | | | | en | stored | 432 | 16, 82 / 725, 1 (1) / 15 (11) | 0, — / —, 0 (0) / 0 (0) |
| 2A | 1338 | 62fc94ae (3117) | at, unaccounted 0 ms | -131 | 278 / 5 / 278; 2 / 11 | en→1339 | ko | stored | 1579 | 43, 235 / 306, 0 (0) / 43 (0) | 2, 196 / 254, 0 (0) / 2 (0) |
| | | | | | | | ja | stored | 1582 | 183, 185 / 305, 0 (0) / 183 (0) | 11, 164 / 254, 0 (0) / 11 (0) |
| | | | | | | | en | stored | 3132 | 27, 166 / 289, 0 (0) / 27 (0) | 3, 115 / 129, 0 (0) / 3 (0) |
| 2B | 1339 | ba09e515 (420) | at, unaccounted 0 ms | -143 | 245 / 241 / 245; 4 / 274 | — | ko | stored | 144 | 50, 119 / 249, 18 (18) / 32 (32) | 3, 67 / 68, 0 (0) / 3 (3) |
| | | | | | | | ja | stored | 184 | 153, 131 / 747, 44 (44) / 109 (109) | 10, 103 / 782, 2 (2) / 8 (8) |
| | | | | | | | en | stored | 434 | 20, 77 / 236, 1 (1) / 19 (15) | 0, — / —, 0 (0) / 0 (0) |
| 3A | 1340 | d1f443e5 (3107) | at, unaccounted 0 ms | -135 | 181 / 5 / 181; 2 / 5 | en→1341 | ko | stored | 1573 | 28, 157 / 223, 0 (0) / 28 (0) | 4, 62 / 161, 0 (0) / 4 (0) |
| | | | | | | | ja | stored | 1593 | 118, 138 / 217, 0 (0) / 118 (0) | 5, 176 / 222, 0 (0) / 5 (0) |
| | | | | | | | en | stored | 3118 | 16, 96 / 217, 0 (0) / 16 (0) | 1, 60 / 60, 0 (0) / 1 (0) |
| 3B | 1341 | d1f443e5 (107) | at, unaccounted 0 ms | -139 | 331 / 331 / 331; 4 / 291 | — | ko | stored | 55 | 66, 155 / 350, 63 (63) / 3 (3) | 2, 75 / 132, 2 (2) / 0 (0) |
| | | | | | | | ja | stored | 67 | 206, 175 / 350, 194 (194) / 12 (12) | 16, 212 / 365, 14 (14) / 2 (2) |
| | | | | | | | en | stored | 112 | 31, 171 / 349, 23 (23) / 8 (8) | 1, 202 / 202, 1 (1) / 0 (0) |
| 4A | 1342 | 7b737ccf (3107) | at, unaccounted 0 ms | -128 | 234 / 5 / 234; 2 / 7 | en→1343 | ko | stored | 1574 | 43, 137 / 225, 0 (0) / 43 (0) | 2, 106 / 142, 0 (0) / 2 (0) |
| | | | | | | | ja | stored | 1597 | 151, 168 / 252, 0 (0) / 151 (0) | 8, 110 / 206, 0 (0) / 8 (0) |
| | | | | | | | en | stored | 3123 | 20, 96 / 251, 0 (0) / 20 (0) | 1, 258 / 258, 0 (0) / 1 (0) |
| 4B | 1343 | 7b737ccf (210) | at, unaccounted 1 ms | -132 | 277 / 277 / 277; 4 / 272 | — | ko | stored | 77 | 49, 118 / 304, 41 (41) / 8 (8) | 4, 90 / 182, 3 (3) / 1 (1) |
| | | | | | | | ja | stored | 175 | 175, 138 / 298, 52 (52) / 123 (123) | 13, 128 / 301, 6 (6) / 7 (7) |
| | | | | | | | en | stored | 223 | 25, 141 / 280, 7 (7) / 18 (18) | 2, 75 / 119, 0 (0) / 2 (2) |
| 5A | 1344 | 3be4f9e6 (3082) | at, unaccounted 0 ms | -139 | 259 / 5 / 259; 2 / 14 | en→1345 | ko | stored | 1553 | 41, 179 / 291, 0 (0) / 41 (0) | 4, 229 / 308, 0 (0) / 4 (0) |
| | | | | | | | ja | stored | 1559 | 167, 210 / 307, 0 (0) / 167 (0) | 10, 167 / 306, 0 (0) / 10 (0) |
| | | | | | | | en | stored | 3092 | 26, 148 / 316, 0 (0) / 26 (0) | 2, 59 / 199, 0 (0) / 2 (0) |
| 5B | 1345 | cc1afb31 (285) | at, unaccounted 0 ms | -134 | 266 / 266 / 266; 4 / 338 | — | ko | stored | 119 | 56, 130 / 753, 31 (31) / 25 (25) | 2, 51 / 98, 0 (0) / 2 (2) |
| | | | | | | | ja | stored | 105 | 163, 109 / 395, 82 (82) / 81 (81) | 12, 140 / 762, 8 (8) / 4 (4) |
| | | | | | | | en | stored | 295 | 22, 101 / 256, 1 (1) / 21 (21) | 2, 216 / 762, 1 (1) / 1 (1) |
| 6A | 1346 | d1f443e5 (3089) | at, unaccounted 1 ms | -135 | 282 / 5 / 282; 2 / 9 | en→1347 | ko | stored | 1560 | 49, 185 / 314, 0 (0) / 49 (0) | 3, 135 / 267, 0 (0) / 3 (0) |
| | | | | | | | ja | stored | 1548 | 184, 184 / 316, 0 (0) / 184 (0) | 11, 167 / 301, 0 (0) / 11 (0) |
| | | | | | | | en | stored | 3095 | 26, 253 / 320, 0 (0) / 26 (0) | 0, — / —, 0 (0) / 0 (0) |
| 6B | 1347 | eb0eb601 (207) | at, unaccounted 0 ms | -135 | 242 / 242 / 242; 4 / 154 | — | ko | stored | 116 | 43, 162 / 226, 26 (26) / 17 (17) | 3, 202 / 202, 2 (2) / 1 (1) |
| | | | | | | | ja | stored | 97 | 151, 114 / 736, 84 (84) / 67 (67) | 12, 98 / 796, 7 (7) / 5 (5) |
| | | | | | | | en | stored | 221 | 21, 128 / 207, 1 (1) / 20 (20) | 3, 36 / 163, 0 (0) / 3 (3) |
