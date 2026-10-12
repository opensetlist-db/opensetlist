## Warm join — 2026-10-12T04-21-55-670Z-browsers-overlap.json + 2026-10-12T04-18-44Z-vercel-logs-history-step4-S1b.txt

Per save and locale: warm-complete − commit (commit proxy = the PUT's response), and each client's FIRST notification fetch of the save split by whether it left after that locale's entry existed. hit = `x-snapshot-source: warm`.

- **SDK**: first hinted fetches 3391; arrived after warm-complete 2659/3391 (78 %); hit rate after 2659/2659 (100 %), before 732/732 (100 %); all hits 3391; minRev ≠ rev 0; served newer than key 21
- **pages**: first hinted fetches 221; arrived after warm-complete 178/221 (81 %); hit rate after 178/178 (100 %), before 43/43 (100 %); all hits 221; minRev ≠ rev 0; served newer than key 0
- warm jobs in the logs: 16
- overlap groups (head = highest committed rev; the gate clock is the last save start): 1: A 1504, B 1505 → head 1505; 2: A 1506, B 1507 → head 1507; 3: A 1508, B 1509 → head 1509; 4: A 1510, B 1511 → head 1511; 5: A 1512, B 1513 → head 1513; 6: A 1514, B 1515 → head 1515
- offsets: `at` = server timestamps (set `at` − writer `at`); `log` / `rebuilt` = job-start based (older logs).

| # | rev | warm job (start → done ms) | offsets | log PUT − harness PUT ms | log: lookups / hits / hinted; builds warm / reader | entry rev ≠ key rev | locale | entry | warm-complete − commit ms | SDK: n, arrival p50 / p95, after (hits) / before (hits) | pages: same |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1A | 1504 | 8cad27e0 (90) | at, unaccounted 0 ms | -184 | 166 / 166 / 166; 3 / 5 | — | ko | stored | 63 | 35, 136 / 199, 31 (31) / 4 (4) | 5, 138 / 154, 3 (3) / 2 (2) |
| | | | | | | | ja | stored | 49 | 94, 144 / 199, 92 (92) / 2 (2) | 8, 138 / 205, 8 (8) / 0 (0) |
| | | | | | | | en | stored | 97 | 15, 141 / 186, 12 (12) / 3 (3) | 0, — / —, 0 (0) / 0 (0) |
| 1B | 1505 | 8cad27e0 (155) | at, unaccounted 0 ms | -168 | 481 / 481 / 481; 3 / 234 | — | ko | stored | 63 | 91, 258 / 1038, 88 (88) / 3 (3) | 5, 979 / 1007, 5 (5) / 0 (0) |
| | | | | | | | ja | stored | 129 | 306, 224 / 1027, 226 (226) / 80 (80) | 21, 273 / 1045, 18 (18) / 3 (3) |
| | | | | | | | en | stored | 158 | 46, 233 / 1012, 31 (31) / 15 (15) | 3, 214 / 319, 2 (2) / 1 (1) |
| 2A | 1506 | 040e21ca (127) | at, unaccounted 0 ms | -182 | 106 / 106 / 106; 2 / 2 | en→1507 | ko | stored | 81 | 24, 74 / 125, 10 (10) / 14 (14) | 1, 97 / 97, 1 (1) / 0 (0) |
| | | | | | | | ja | stored | 89 | 59, 93 / 131, 33 (33) / 26 (26) | 3, 111 / 128, 2 (2) / 1 (1) |
| | | | | | | | en | stored | 147 | 10, 93 / 132, 0 (0) / 10 (10), served newer 10 | 0, — / —, 0 (0) / 0 (0) |
| 2B | 1507 | a3ca30b0 (144) | at, unaccounted 0 ms | -197 | 482 / 482 / 482; 4 / 158 | — | ko | stored | 86 | 89, 209 / 1017, 80 (80) / 9 (9) | 6, 143 / 1012, 5 (5) / 1 (1) |
| | | | | | | | ja | stored | 107 | 318, 213 / 1014, 253 (253) / 65 (65) | 21, 211 / 1025, 14 (14) / 7 (7) |
| | | | | | | | en | stored | 155 | 36, 192 / 386, 24 (24) / 12 (12) | 3, 182 / 459, 2 (2) / 1 (1) |
| 3A | 1508 | 0e36bc74 (198) | at, unaccounted 0 ms | -189 | 139 / 139 / 139; 2 / 3 | en→1509 | ko | stored | 157 | 21, 102 / 171, 4 (4) / 17 (17) | 0, — / —, 0 (0) / 0 (0) |
| | | | | | | | ja | stored | 171 | 93, 114 / 172, 7 (7) / 86 (86) | 5, 106 / 167, 0 (0) / 5 (5) |
| | | | | | | | en | stored | 206 | 11, 107 / 178, 0 (0) / 11 (11), served newer 11 | 0, — / —, 0 (0) / 0 (0) |
| 3B | 1509 | 8ad750c7 (148) | at, unaccounted 1 ms | -188 | 490 / 490 / 490; 4 / 169 | — | ko | stored | 110 | 93, 273 / 1003, 74 (74) / 19 (19) | 6, 115 / 261, 4 (4) / 2 (2) |
| | | | | | | | ja | stored | 123 | 324, 215 / 1024, 227 (227) / 97 (97) | 20, 198 / 960, 13 (13) / 7 (7) |
| | | | | | | | en | stored | 164 | 35, 146 / 352, 13 (13) / 22 (22) | 3, 223 / 256, 2 (2) / 1 (1) |
| 4A | 1510 | 6be337b1 (90) | at, unaccounted 0 ms | -188 | 121 / 121 / 121; 3 / 0 | — | ko | stored | 53 | 22, 112 / 170, 22 (22) / 0 (0) | 2, 112 / 146, 2 (2) / 0 (0) |
| | | | | | | | ja | stored | 66 | 71, 126 / 169, 69 (69) / 2 (2) | 4, 95 / 174, 4 (4) / 0 (0) |
| | | | | | | | en | stored | 98 | 12, 135 / 160, 11 (11) / 1 (1) | 1, 163 / 163, 1 (1) / 0 (0) |
| 4B | 1511 | 6be337b1 (123) | at, unaccounted 0 ms | -175 | 500 / 500 / 500; 3 / 177 | — | ko | stored | 117 | 94, 220 / 1004, 69 (69) / 25 (25) | 6, 304 / 991, 5 (5) / 1 (1) |
| | | | | | | | ja | stored | 105 | 322, 201 / 1010, 235 (235) / 87 (87) | 20, 146 / 943, 13 (13) / 7 (7) |
| | | | | | | | en | stored | 161 | 46, 184 / 1006, 24 (24) / 22 (22) | 3, 209 / 1012, 2 (2) / 1 (1) |
| 5A | 1512 | a3ca30b0 (105) | at, unaccounted 1 ms | -187 | 116 / 116 / 116; 3 / 4 | — | ko | stored | 64 | 18, 106 / 178, 18 (18) / 0 (0) | 0, — / —, 0 (0) / 0 (0) |
| | | | | | | | ja | stored | 51 | 68, 132 / 178, 68 (68) / 0 (0) | 7, 130 / 185, 7 (7) / 0 (0) |
| | | | | | | | en | stored | 111 | 13, 162 / 174, 9 (9) / 4 (4) | 1, 184 / 184, 1 (1) / 0 (0) |
| 5B | 1513 | 0e36bc74 (83) | at, unaccounted 0 ms | -182 | 492 / 492 / 492; 3 / 203 | — | ko | stored | 62 | 92, 215 / 1043, 90 (90) / 2 (2) | 6, 153 / 353, 6 (6) / 0 (0) |
| | | | | | | | ja | stored | 49 | 317, 233 / 1028, 317 (317) / 0 (0) | 21, 314 / 1063, 21 (21) / 0 (0) |
| | | | | | | | en | stored | 90 | 44, 254 / 1043, 42 (42) / 2 (2) | 3, 344 / 1066, 2 (2) / 1 (1) |
| 6A | 1514 | 040e21ca (130) | at, unaccounted 0 ms | -188 | 135 / 135 / 135; 3 / 2 | — | ko | stored | 73 | 18, 107 / 181, 14 (14) / 4 (4) | 1, 137 / 137, 1 (1) / 0 (0) |
| | | | | | | | ja | stored | 78 | 86, 109 / 184, 72 (72) / 14 (14) | 5, 128 / 185, 5 (5) / 0 (0) |
| | | | | | | | en | stored | 137 | 15, 151 / 189, 9 (9) / 6 (6) | 1, 112 / 112, 0 (0) / 1 (1) |
| 6B | 1515 | 34c653dc (132) | at, unaccounted 0 ms | -192 | 492 / 492 / 492; 3 / 54 | — | ko | stored | 78 | 89, 158 / 984, 79 (79) / 10 (10) | 6, 187 / 992, 5 (5) / 1 (1) |
| | | | | | | | ja | stored | 83 | 319, 198 / 1018, 269 (269) / 50 (50) | 21, 187 / 993, 21 (21) / 0 (0) |
| | | | | | | | en | stored | 141 | 45, 241 / 1035, 37 (37) / 8 (8) | 3, 342 / 961, 3 (3) / 0 (0) |
