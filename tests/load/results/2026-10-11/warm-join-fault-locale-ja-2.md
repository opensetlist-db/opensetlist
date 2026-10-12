## Warm join — 2026-10-11T21-10-04-842Z-browsers.json + 2026-10-11T210558Z-vercel-logs-history-fault-locale-ja-2.txt

Per save and locale: warm-complete − commit (commit proxy = the PUT's response), and each client's FIRST notification fetch of the save split by whether it left after that locale's entry existed. hit = `x-snapshot-source: warm`.

- **SDK**: first hinted fetches 2899; arrived after warm-complete 1051/2899 (36 %); hit rate after 1051/1051 (100 %), before 18/1848 (1 %); all hits 1069; minRev ≠ rev 0
- **pages**: first hinted fetches 223; arrived after warm-complete 70/223 (31 %); hit rate after 70/70 (100 %), before 1/153 (1 %); all hits 71; minRev ≠ rev 0
- warm jobs in the logs: 18

| # | rev | warm job (start → done ms) | offsets | log PUT − harness PUT ms | log: lookups / hits / hinted; builds warm / reader | locale | entry | warm-complete − commit ms | SDK: n, arrival p50 / p95, after (hits) / before (hits) | pages: same |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 1256 | ae7813cd (194) | rebuilt, unaccounted 0 ms | -289 | 278 / 129 / 278; 2 / 427 | ko | stored | 194 | 78, 609 / 947, 77 (77) / 1 (1) | 6, 526 / 832, 6 (6) / 0 (0) |
| | | | | | | ja | — | — | 130, 485 / 659, 0 (0) / 130 (0) | 19, 662 / 783, 0 (0) / 19 (0) |
| | | | | | | en | stored | 190 | 42, 633 / 925, 42 (42) / 0 (0) | 3, 718 / 869, 3 (3) / 0 (0) |
| 2 | 1257 | c82c686e (80) | rebuilt, unaccounted 1 ms | -255 | 485 / 144 / 485; 2 / 418 | ko | stored | 60 | 92, 278 / 551, 92 (92) / 0 (0) | 6, 332 / 556, 6 (6) / 0 (0) |
| | | | | | | ja | — | — | 323, 306 / 534, 0 (0) / 323 (0) | 18, 302 / 544, 0 (0) / 18 (0) |
| | | | | | | en | stored | 79 | 43, 267 / 522, 38 (38) / 5 (5) | 3, 269 / 269, 3 (3) / 0 (0) |
| 3 | 1259 | 120eeb91 (153) | rebuilt, unaccounted 0 ms | -283 | 267 / 145 / 267; 2 / 329 | ko | stored | 131 | 92, 788 / 1014, 91 (91) / 1 (1) | 5, 821 / 939, 5 (5) / 0 (0) |
| | | | | | | ja | — | — | 109, 626 / 806, 0 (0) / 109 (0) | 13, 684 / 829, 0 (0) / 13 (0) |
| | | | | | | en | stored | 153 | 45, 734 / 976, 44 (44) / 1 (1) | 3, 684 / 790, 3 (3) / 0 (0) |
| 4 | 1260 | 94791370 (86) | rebuilt, unaccounted 2 ms | -245 | 484 / 145 / 484; 2 / 367 | ko | stored | 65 | 91, 261 / 515, 88 (88) / 3 (3) | 6, 207 / 535, 5 (5) / 1 (1) |
| | | | | | | ja | — | — | 319, 287 / 530, 0 (0) / 319 (0) | 20, 291 / 454, 0 (0) / 20 (0) |
| | | | | | | en | stored | 84 | 45, 286 / 514, 42 (42) / 3 (3) | 3, 271 / 326, 3 (3) / 0 (0) |
| 5 | 1262 | 29e00a5b (161) | rebuilt, unaccounted 0 ms | -263 | 328 / 139 / 328; 2 / 368 | ko | stored | 156 | 86, 522 / 696, 85 (85) / 1 (1) | 6, 476 / 678, 6 (6) / 0 (0) |
| | | | | | | ja | — | — | 170, 435 / 696, 0 (0) / 170 (0) | 19, 520 / 789, 0 (0) / 19 (0) |
| | | | | | | en | stored | 161 | 44, 576 / 742, 44 (44) / 0 (0) | 3, 553 / 728, 3 (3) / 0 (0) |
| 6 | 1263 | 636d1d67 (79) | rebuilt, unaccounted 1 ms | -249 | 492 / 148 / 492; 2 / 303 | ko | stored | 49 | 92, 321 / 540, 92 (92) / 0 (0) | 6, 306 / 526, 6 (6) / 0 (0) |
| | | | | | | ja | — | — | 323, 303 / 536, 0 (0) / 323 (0) | 21, 324 / 554, 0 (0) / 21 (0) |
| | | | | | | en | stored | 78 | 47, 306 / 528, 46 (46) / 1 (1) | 3, 400 / 572, 3 (3) / 0 (0) |
| 7 | 1265 | f1b139cf (160) | rebuilt, unaccounted 1 ms | -258 | 301 / 142 / 301; 2 / 386 | ko | stored | 125 | 87, 644 / 871, 87 (87) / 0 (0) | 6, 659 / 721, 6 (6) / 0 (0) |
| | | | | | | ja | — | — | 138, 510 / 786, 0 (0) / 138 (0) | 21, 514 / 846, 0 (0) / 21 (0) |
| | | | | | | en | stored | 159 | 46, 634 / 819, 46 (46) / 0 (0) | 3, 812 / 846, 3 (3) / 0 (0) |
| 8 | 1266 | 9db7710b (69) | rebuilt, unaccounted 0 ms | -252 | 487 / 148 / 487; 2 / 152 | ko | stored | 69 | 92, 317 / 537, 90 (90) / 2 (2) | 6, 227 / 457, 6 (6) / 0 (0) |
| | | | | | | ja | — | — | 318, 305 / 530, 0 (0) / 318 (0) | 21, 273 / 531, 0 (0) / 21 (0) |
| | | | | | | en | stored | 57 | 47, 324 / 526, 47 (47) / 0 (0) | 3, 380 / 399, 3 (3) / 0 (0) |
