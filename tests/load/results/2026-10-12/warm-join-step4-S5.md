## Warm join — 2026-10-12T03-38-05-060Z-browsers-overlap.json + 2026-10-12T03-32-00Z-vercel-logs-history-step4-S5.txt

Per save and locale: warm-complete − commit (commit proxy = the PUT's response), and each client's FIRST notification fetch of the save split by whether it left after that locale's entry existed. hit = `x-snapshot-source: warm`.

- **SDK**: first hinted fetches 2803; arrived after warm-complete 819/2803 (29 %); hit rate after 0/819 (0 %), before 0/1984 (0 %); all hits 0; minRev ≠ rev 0; served newer than key 0
- **pages**: first hinted fetches 183; arrived after warm-complete 61/183 (33 %); hit rate after 0/61 (0 %), before 0/122 (0 %); all hits 0; minRev ≠ rev 0; served newer than key 0
- warm jobs in the logs: 16
- overlap groups (head = highest committed rev; the gate clock is the last save start): 1: A 1370, B 1371 → head 1371; 2: A 1372, B 1373 → head 1373; 3: A 1374, B 1375 → head 1375; 4: A 1376, B 1377 → head 1377; 5: A 1378, B 1379 → head 1379; 6: A 1380, B 1381 → head 1381
- offsets: `at` = server timestamps (set `at` − writer `at`); `log` / `rebuilt` = job-start based (older logs).

| # | rev | warm job (start → done ms) | offsets | log PUT − harness PUT ms | log: lookups / hits / hinted; builds warm / reader | entry rev ≠ key rev | locale | entry | warm-complete − commit ms | SDK: n, arrival p50 / p95, after (hits) / before (hits) | pages: same |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1A | 1370 | d0d80ae9 (3138) | at, unaccounted 0 ms | -162 | 233 / 5 / 233; 2 / 1 | en→1371 | ko | stored | 1576 | 50, 171 / 257, 0 (0) / 50 (0) | 1, 73 / 73, 0 (0) / 1 (0) |
| | | | | | | | ja | stored | 1569 | 140, 160 / 255, 0 (0) / 140 (0) | 9, 148 / 269, 0 (0) / 9 (0) |
| | | | | | | | en | stored | 3147 | 23, 187 / 263, 0 (0) / 23 (0) | 1, 165 / 165, 0 (0) / 1 (0) |
| 1B | 1371 | 346ff1ce (650) | at, unaccounted 0 ms | -168 | 277 / 0 / 277; 4 / 510 | — | ko | stored | 259 | 43, 132 / 287, 6 (0) / 37 (0) | 5, 153 / 318, 2 (0) / 3 (0) |
| | | | | | | | ja | stored | 265 | 185, 132 / 291, 21 (0) / 164 (0) | 11, 161 / 283, 1 (0) / 10 (0) |
| | | | | | | | en | stored | 661 | 22, 179 / 309, 0 (0) / 22 (0) | 2, 95 / 179, 0 (0) / 2 (0) |
| 2A | 1372 | 8d694227 (3269) | at, unaccounted 0 ms | -165 | 224 / 5 / 224; 2 / 6 | en→1373 | ko | stored | 1574 | 41, 177 / 262, 0 (0) / 41 (0) | 2, 177 / 177, 0 (0) / 2 (0) |
| | | | | | | | ja | stored | 1570 | 139, 168 / 263, 0 (0) / 139 (0) | 11, 192 / 255, 0 (0) / 11 (0) |
| | | | | | | | en | stored | 3287 | 20, 138 / 214, 0 (0) / 20 (0) | 2, 114 / 160, 0 (0) / 2 (0) |
| 2B | 1373 | 48ab60f3 (315) | at, unaccounted 0 ms | -165 | 286 / 0 / 286; 4 / 463 | — | ko | stored | 74 | 51, 134 / 398, 38 (0) / 13 (0) | 4, 66 / 165, 2 (0) / 2 (0) |
| | | | | | | | ja | stored | 80 | 185, 123 / 262, 127 (0) / 58 (0) | 10, 144 / 232, 8 (0) / 2 (0) |
| | | | | | | | en | stored | 324 | 26, 143 / 248, 0 (0) / 26 (0) | 1, 198 / 198, 0 (0) / 1 (0) |
| 3A | 1374 | 176a2eec (3118) | at, unaccounted 0 ms | -169 | 234 / 5 / 234; 2 / 5 | en→1375 | ko | stored | 1561 | 44, 149 / 263, 0 (0) / 44 (0) | 3, 131 / 187, 0 (0) / 3 (0) |
| | | | | | | | ja | stored | 1553 | 146, 155 / 269, 0 (0) / 146 (0) | 9, 206 / 272, 0 (0) / 9 (0) |
| | | | | | | | en | stored | 3126 | 22, 160 / 257, 0 (0) / 22 (0) | 1, 224 / 224, 0 (0) / 1 (0) |
| 3B | 1375 | c70dfa7c (307) | at, unaccounted 0 ms | -179 | 280 / 0 / 280; 4 / 411 | — | ko | stored | 71 | 49, 142 / 276, 38 (0) / 11 (0) | 3, 109 / 141, 3 (0) / 0 (0) |
| | | | | | | | ja | stored | 94 | 180, 104 / 269, 103 (0) / 77 (0) | 12, 118 / 271, 10 (0) / 2 (0) |
| | | | | | | | en | stored | 315 | 25, 89 / 254, 0 (0) / 25 (0) | 2, 214 / 236, 0 (0) / 2 (0) |
| 4A | 1376 | 5c170350 (3204) | at, unaccounted 0 ms | -163 | 324 / 6 / 324; 2 / 16 | en→1377 | ko | stored | 1564 | 62, 211 / 359, 0 (0) / 62 (0) | 5, 231 / 363, 0 (0) / 5 (0) |
| | | | | | | | ja | stored | 1581 | 204, 209 / 365, 0 (0) / 204 (0) | 14, 199 / 379, 0 (0) / 14 (0) |
| | | | | | | | en | stored | 3213 | 28, 226 / 357, 0 (0) / 28 (0) | 2, 136 / 323, 0 (0) / 2 (0) |
| 4B | 1377 | 5ce3fea9 (349) | at, unaccounted 0 ms | -162 | 215 / 0 / 215; 4 / 487 | — | ko | stored | 171 | 36, 88 / 713, 5 (0) / 31 (0) | 2, 10 / 741, 1 (0) / 1 (0) |
| | | | | | | | ja | stored | 194 | 139, 86 / 685, 20 (0) / 119 (0) | 11, 152 / 741, 5 (0) / 6 (0) |
| | | | | | | | en | stored | 362 | 17, 99 / 380, 1 (0) / 16 (0) | 1, 120 / 120, 0 (0) / 1 (0) |
| 5A | 1378 | b9f6c702 (3165) | at, unaccounted 0 ms | -168 | 169 / 5 / 169; 2 / 2 | en→1379 | ko | stored | 1578 | 31, 140 / 216, 0 (0) / 31 (0) | 2, 195 / 226, 0 (0) / 2 (0) |
| | | | | | | | ja | stored | 1558 | 106, 160 / 225, 0 (0) / 106 (0) | 7, 182 / 236, 0 (0) / 7 (0) |
| | | | | | | | en | stored | 3175 | 12, 166 / 220, 0 (0) / 12 (0) | 2, 60 / 97, 0 (0) / 2 (0) |
| 5B | 1379 | b9f6c702 (184) | at, unaccounted 0 ms | -164 | 342 / 0 / 342; 4 / 575 | — | ko | stored | 59 | 61, 148 / 289, 49 (0) / 12 (0) | 4, 135 / 231, 3 (0) / 1 (0) |
| | | | | | | | ja | stored | 73 | 218, 144 / 324, 179 (0) / 39 (0) | 14, 157 / 302, 10 (0) / 4 (0) |
| | | | | | | | en | stored | 192 | 35, 173 / 324, 13 (0) / 22 (0) | 1, 272 / 272, 1 (0) / 0 (0) |
| 6A | 1380 | f689c004 (3108) | at, unaccounted 0 ms | -174 | 235 / 31 / 235; 2 / 3 | en→1381 | ko | stored | 1565 | 38, 144 / 248, 0 (0) / 38 (0) | 4, 127 / 215, 0 (0) / 4 (0) |
| | | | | | | | ja | stored | 1559 | 118, 159 / 246, 0 (0) / 118 (0) | 7, 215 / 246, 0 (0) / 7 (0) |
| | | | | | | | en | stored | 3117 | 22, 146 / 226, 0 (0) / 22 (0) | 1, 68 / 68, 0 (0) / 1 (0) |
| 6B | 1381 | f689c004 (225) | at, unaccounted 0 ms | -170 | 347 / 0 / 347; 4 / 1577 | — | ko | stored | 77 | 56, 196 / 294, 49 (0) / 7 (0) | 1, 172 / 172, 1 (0) / 0 (0) |
| | | | | | | | ja | stored | 71 | 205, 127 / 322, 163 (0) / 42 (0) | 14, 115 / 357, 12 (0) / 2 (0) |
| | | | | | | | en | stored | 230 | 24, 184 / 318, 7 (0) / 17 (0) | 2, 284 / 357, 2 (0) / 0 (0) |
