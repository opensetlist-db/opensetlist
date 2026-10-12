## Warm join — 2026-10-11T20-41-04-232Z-browsers.json + 2026-10-11T203659Z-vercel-logs-history-fault-slowjob-1000.txt

Per save and locale: warm-complete − commit (commit proxy = the PUT's response), and each client's FIRST notification fetch of the save split by whether it left after that locale's entry existed. hit = `x-snapshot-source: warm`.

- **SDK**: first hinted fetches 2555; arrived after warm-complete 1261/2555 (49 %); hit rate after 1/1261 (0 %), before 16/1294 (1 %); all hits 17; minRev ≠ rev 0
- **pages**: first hinted fetches 208; arrived after warm-complete 108/208 (52 %); hit rate after 0/108 (0 %), before 6/100 (6 %); all hits 6; minRev ≠ rev 0
- warm jobs in the logs: 18

| # | rev | warm job (start → done ms) | offsets | log PUT − harness PUT ms | log: lookups / hits / hinted; builds warm / reader | locale | entry | warm-complete − commit ms | SDK: n, arrival p50 / p95, after (hits) / before (hits) | pages: same |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 1237 | a39e681e (2722) | rebuilt, unaccounted 1953 ms | -497 | 203 / 22 / 203; 6 / 445 | ko | stored | 661 | 26, 328 / 553, 0 (0) / 26 (7) | 4, 361 / 571, 0 (0) / 4 (2) |
| | | | | | | ja | stored | 769 | 140, 332 / 543, 0 (0) / 140 (9) | 19, 470 / 590, 0 (0) / 19 (4) |
| | | | | | | en | stored | 721 | 11, 299 / 360, 0 (0) / 11 (0) | 3, 502 / 586, 0 (0) / 3 (0) |
| 2 | 1238 | b7a18017 (2271) | rebuilt, unaccounted 2002 ms | -475 | 492 / 1 / 492; 3 / 455 | ko | stored | 214 | 93, 280 / 530, 58 (0) / 35 (0) | 6, 278 / 499, 5 (0) / 1 (0) |
| | | | | | | ja | stored | 210 | 322, 299 / 514, 213 (1) / 109 (0) | 21, 277 / 511, 13 (0) / 8 (0) |
| | | | | | | en | stored | 269 | 47, 275 / 491, 24 (0) / 23 (0) | 3, 281 / 433, 2 (0) / 1 (0) |
| 3 | 1240 | 79597a16 (2344) | rebuilt, unaccounted 2003 ms | -479 | 327 / 0 / 327; 6 / 402 | ko | stored | 295 | 58, 341 / 591, 35 (0) / 23 (0) | 6, 348 / 555, 6 (0) / 0 (0) |
| | | | | | | ja | stored | 282 | 218, 362 / 570, 161 (0) / 57 (0) | 20, 365 / 588, 15 (0) / 5 (0) |
| | | | | | | en | stored | 341 | 22, 285 / 532, 10 (0) / 12 (0) | 3, 319 / 487, 1 (0) / 2 (0) |
| 4 | 1241 | 79597a16 (2296) | rebuilt, unaccounted 1965 ms | -455 | 493 / 0 / 493; 3 / 372 | ko | stored | 234 | 92, 319 / 549, 57 (0) / 35 (0) | 6, 278 / 537, 5 (0) / 1 (0) |
| | | | | | | ja | stored | 331 | 324, 299 / 535, 143 (0) / 181 (0) | 21, 328 / 533, 10 (0) / 11 (0) |
| | | | | | | en | stored | 295 | 47, 296 / 537, 24 (0) / 23 (0) | 3, 395 / 438, 2 (0) / 1 (0) |
| 5 | 1243 | da8d9a9d (2392) | rebuilt, unaccounted 2000 ms | -488 | 129 / 0 / 129; 6 / 436 | ko | stored | 336 | 23, 629 / 703, 15 (0) / 8 (0) | 2, 768 / 890, 2 (0) / 0 (0) |
| | | | | | | ja | stored | 337 | 82, 639 / 730, 56 (0) / 26 (0) | 9, 673 / 784, 8 (0) / 1 (0) |
| | | | | | | en | stored | 392 | 12, 644 / 940, 9 (0) / 3 (0) | 1, 89 / 89, 0 (0) / 1 (0) |
| 6 | 1244 | fa2019c8 (2291) | rebuilt, unaccounted 1818 ms | -456 | 486 / 0 / 486; 3 / 391 | ko | stored | 245 | 92, 295 / 524, 51 (0) / 41 (0) | 6, 240 / 483, 3 (0) / 3 (0) |
| | | | | | | ja | stored | 473 | 318, 287 / 535, 52 (0) / 266 (0) | 20, 284 / 506, 2 (0) / 18 (0) |
| | | | | | | en | stored | 289 | 47, 263 / 515, 20 (0) / 27 (0) | 3, 98 / 334, 1 (0) / 2 (0) |
| 7 | 1246 | e79a1c2b (2152) | rebuilt, unaccounted 2003 ms | -472 | 139 / 0 / 139; 6 / 378 | ko | stored | 113 | 22, 468 / 819, 22 (0) / 0 (0) | 5, 572 / 681, 5 (0) / 0 (0) |
| | | | | | | ja | stored | 91 | 82, 465 / 763, 82 (0) / 0 (0) | 15, 663 / 864, 15 (0) / 0 (0) |
| | | | | | | en | stored | 149 | 13, 436 / 609, 13 (0) / 0 (0) | 2, 589 / 714, 2 (0) / 0 (0) |
| 8 | 1247 | e1b7965c (2269) | rebuilt, unaccounted 1881 ms | -444 | 494 / 0 / 494; 3 / 214 | ko | stored | 214 | 92, 347 / 532, 63 (0) / 29 (0) | 6, 207 / 408, 3 (0) / 3 (0) |
| | | | | | | ja | stored | 388 | 326, 304 / 532, 126 (0) / 200 (0) | 21, 245 / 528, 6 (0) / 15 (0) |
| | | | | | | en | stored | 267 | 46, 330 / 529, 27 (0) / 19 (0) | 3, 291 / 415, 2 (0) / 1 (0) |
