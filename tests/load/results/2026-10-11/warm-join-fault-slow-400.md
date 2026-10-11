## Warm join — 2026-10-11T20-27-26-437Z-browsers.json + 2026-10-11T202319Z-vercel-logs-history-fault-slow-400.txt

Per save and locale: warm-complete − commit (commit proxy = the PUT's response), and each client's FIRST notification fetch of the save split by whether it left after that locale's entry existed. hit = `x-snapshot-source: warm`.

- **SDK**: first hinted fetches 2666; arrived after warm-complete 2511/2666 (94 %); hit rate after 840/2511 (33 %), before 10/155 (6 %); all hits 850; minRev ≠ rev 0
- **pages**: first hinted fetches 182; arrived after warm-complete 172/182 (95 %); hit rate after 63/172 (37 %), before 0/10 (0 %); all hits 63; minRev ≠ rev 0
- warm jobs in the logs: 18

| # | rev | warm job (start → done ms) | offsets | log PUT − harness PUT ms | log: lookups / hits / hinted; builds warm / reader | locale | entry | warm-complete − commit ms | SDK: n, arrival p50 / p95, after (hits) / before (hits) | pages: same |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 1180 | 881cc7c8 (192) | rebuilt, unaccounted 2 ms | -556 | 162 / 37 / 162; 3 / 418 | ko | stored | 126 | 26, 736 / 1020, 26 (3) / 0 (0) | 1, 791 / 791, 1 (0) / 0 (0) |
| | | | | | | ja | stored | 133 | 122, 802 / 1006, 122 (32) / 0 (0) | 5, 823 / 1023, 5 (2) / 0 (0) |
| | | | | | | en | stored | 190 | 7, 632 / 1104, 7 (0) / 0 (0) | 1, 890 / 890, 1 (0) / 0 (0) |
| 2 | 1181 | eec8dc05 (93) | rebuilt, unaccounted 1 ms | -528 | 494 / 167 / 494; 3 / 314 | ko | stored | 60 | 91, 296 / 539, 90 (24) / 1 (0) | 6, 294 / 558, 6 (3) / 0 (0) |
| | | | | | | ja | stored | 54 | 328, 316 / 538, 328 (122) / 0 (0) | 20, 218 / 480, 20 (7) / 0 (0) |
| | | | | | | en | stored | 92 | 46, 240 / 520, 40 (11) / 6 (0) | 3, 494 / 526, 2 (0) / 1 (0) |
| 3 | 1183 | 891a7765 (310) | rebuilt, unaccounted 1 ms | -550 | 228 / 78 / 228; 3 / 466 | ko | stored | 197 | 22, 765 / 992, 22 (6) / 0 (0) | 2, 520 / 800, 2 (1) / 0 (0) |
| | | | | | | ja | stored | 235 | 174, 702 / 958, 174 (64) / 0 (0) | 11, 819 / 1000, 11 (5) / 0 (0) |
| | | | | | | en | stored | 309 | 17, 687 / 945, 17 (2) / 0 (0) | 2, 635 / 785, 2 (0) / 0 (0) |
| 4 | 1184 | 8834bbee (169) | rebuilt, unaccounted 2 ms | -519 | 489 / 158 / 489; 3 / 366 | ko | stored | 76 | 92, 294 / 539, 88 (23) / 4 (0) | 6, 390 / 487, 6 (3) / 0 (0) |
| | | | | | | ja | stored | 141 | 321, 309 / 537, 270 (110) / 51 (8) | 21, 323 / 496, 16 (7) / 5 (0) |
| | | | | | | en | stored | 167 | 46, 293 / 522, 39 (7) / 7 (0) | 3, 323 / 554, 2 (0) / 1 (0) |
| 5 | 1186 | 0712e7e2 (309) | rebuilt, unaccounted 1 ms | -559 | 178 / 39 / 178; 3 / 328 | ko | stored | 216 | 29, 815 / 1059, 28 (4) / 1 (0) | 3, 803 / 831, 3 (0) / 0 (0) |
| | | | | | | ja | stored | 220 | 122, 734 / 980, 119 (29) / 3 (0) | 13, 783 / 992, 13 (6) / 0 (0) |
| | | | | | | en | stored | 308 | 10, 784 / 954, 10 (0) / 0 (0) | 1, 923 / 923, 1 (0) / 0 (0) |
| 6 | 1187 | 5227edf4 (99) | rebuilt, unaccounted 0 ms | -530 | 483 / 152 / 483; 3 / 403 | ko | stored | 51 | 91, 317 / 526, 91 (26) / 0 (0) | 6, 262 / 542, 6 (0) / 0 (0) |
| | | | | | | ja | stored | 80 | 319, 307 / 533, 303 (110) / 16 (0) | 19, 342 / 557, 16 (7) / 3 (0) |
| | | | | | | en | stored | 99 | 45, 328 / 554, 42 (8) / 3 (0) | 3, 258 / 508, 3 (1) / 0 (0) |
| 7 | 1189 | de26d80a (271) | rebuilt, unaccounted 1 ms | -534 | 319 / 105 / 319; 3 / 400 | ko | stored | 146 | 54, 370 / 624, 54 (12) / 0 (0) | 4, 551 / 649, 4 (2) / 0 (0) |
| | | | | | | ja | stored | 237 | 217, 377 / 600, 190 (80) / 27 (2) | 19, 466 / 618, 19 (7) / 0 (0) |
| | | | | | | en | stored | 270 | 22, 339 / 586, 15 (2) / 7 (0) | 3, 465 / 512, 3 (0) / 0 (0) |
| 8 | 1190 | 437fad09 (99) | rebuilt, unaccounted 1 ms | -527 | 495 / 177 / 495; 3 / 186 | ko | stored | 51 | 94, 301 / 532, 93 (25) / 1 (0) | 6, 194 / 377, 6 (2) / 0 (0) |
| | | | | | | ja | stored | 82 | 324, 271 / 517, 299 (129) / 25 (0) | 21, 213 / 361, 21 (10) / 0 (0) |
| | | | | | | en | stored | 98 | 47, 291 / 499, 44 (11) / 3 (0) | 3, 227 / 511, 3 (0) / 0 (0) |
