## Warm join — 2026-10-11T20-36-32-229Z-browsers.json + 2026-10-11T203226Z-vercel-logs-history-fault-geterror.txt

Per save and locale: warm-complete − commit (commit proxy = the PUT's response), and each client's FIRST notification fetch of the save split by whether it left after that locale's entry existed. hit = `x-snapshot-source: warm`.

- **SDK**: first hinted fetches 2562; arrived after warm-complete 2319/2562 (91 %); hit rate after 0/2319 (0 %), before 0/243 (0 %); all hits 0; minRev ≠ rev 0
- **pages**: first hinted fetches 210; arrived after warm-complete 189/210 (90 %); hit rate after 0/189 (0 %), before 0/21 (0 %); all hits 0; minRev ≠ rev 0
- warm jobs in the logs: 18

| # | rev | warm job (start → done ms) | offsets | log PUT − harness PUT ms | log: lookups / hits / hinted; builds warm / reader | locale | entry | warm-complete − commit ms | SDK: n, arrival p50 / p95, after (hits) / before (hits) | pages: same |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 1218 | adfb4aeb (576) | rebuilt, unaccounted 1 ms | -547 | 141 / 0 / 141; 3 / 485 | ko | stored | 278 | 23, 397 / 546, 20 (0) / 3 (0) | 5, 496 / 709, 5 (0) / 0 (0) |
| | | | | | | ja | stored | 329 | 86, 443 / 716, 80 (0) / 6 (0) | 16, 612 / 794, 15 (0) / 1 (0) |
| | | | | | | en | stored | 575 | 10, 412 / 564, 0 (0) / 10 (0) | 1, 492 / 492, 0 (0) / 1 (0) |
| 2 | 1219 | 269e56f5 (113) | rebuilt, unaccounted 10 ms | -502 | 486 / 0 / 486; 3 / 344 | ko | stored | 66 | 89, 313 / 521, 85 (0) / 4 (0) | 6, 346 / 442, 6 (0) / 0 (0) |
| | | | | | | ja | stored | 57 | 323, 316 / 524, 318 (0) / 5 (0) | 21, 235 / 521, 21 (0) / 0 (0) |
| | | | | | | en | stored | 103 | 44, 255 / 535, 40 (0) / 4 (0) | 3, 181 / 522, 2 (0) / 1 (0) |
| 3 | 1221 | 7455dd0a (713) | rebuilt, unaccounted 1 ms | -531 | 226 / 0 / 226; 3 / 438 | ko | stored | 245 | 32, 428 / 681, 32 (0) / 0 (0) | 4, 394 / 477, 4 (0) / 0 (0) |
| | | | | | | ja | stored | 412 | 150, 412 / 692, 75 (0) / 75 (0) | 19, 511 / 754, 13 (0) / 6 (0) |
| | | | | | | en | stored | 712 | 19, 387 / 691, 0 (0) / 19 (0) | 2, 411 / 575, 0 (0) / 2 (0) |
| 4 | 1222 | 5743c507 (94) | rebuilt, unaccounted 2 ms | -497 | 489 / 0 / 489; 3 / 400 | ko | stored | 56 | 91, 283 / 507, 91 (0) / 0 (0) | 6, 252 / 495, 6 (0) / 0 (0) |
| | | | | | | ja | stored | 71 | 321, 319 / 521, 316 (0) / 5 (0) | 21, 411 / 526, 21 (0) / 0 (0) |
| | | | | | | en | stored | 92 | 47, 273 / 503, 42 (0) / 5 (0) | 3, 285 / 511, 3 (0) / 0 (0) |
| 5 | 1224 | 8d6f664b (696) | rebuilt, unaccounted 1 ms | -527 | 192 / 0 / 192; 3 / 379 | ko | stored | 229 | 38, 442 / 694, 37 (0) / 1 (0) | 4, 599 / 756, 4 (0) / 0 (0) |
| | | | | | | ja | stored | 416 | 119, 477 / 704, 96 (0) / 23 (0) | 14, 565 / 833, 12 (0) / 2 (0) |
| | | | | | | en | stored | 695 | 16, 446 / 545, 0 (0) / 16 (0) | 1, 427 / 427, 0 (0) / 1 (0) |
| 6 | 1225 | 8d6f664b (86) | rebuilt, unaccounted 1 ms | -491 | 494 / 0 / 494; 3 / 383 | ko | stored | 57 | 93, 280 / 523, 92 (0) / 1 (0) | 6, 217 / 414, 6 (0) / 0 (0) |
| | | | | | | ja | stored | 42 | 325, 299 / 538, 325 (0) / 0 (0) | 20, 231 / 478, 20 (0) / 0 (0) |
| | | | | | | en | stored | 85 | 47, 219 / 498, 45 (0) / 2 (0) | 3, 379 / 524, 3 (0) / 0 (0) |
| 7 | 1227 | c84b1eff (689) | rebuilt, unaccounted 0 ms | -520 | 254 / 0 / 254; 3 / 451 | ko | stored | 253 | 38, 334 / 551, 32 (0) / 6 (0) | 6, 492 / 578, 6 (0) / 0 (0) |
| | | | | | | ja | stored | 247 | 165, 379 / 567, 151 (0) / 14 (0) | 17, 561 / 660, 14 (0) / 3 (0) |
| | | | | | | en | stored | 689 | 25, 351 / 646, 0 (0) / 25 (0) | 3, 378 / 539, 0 (0) / 3 (0) |
| 8 | 1228 | b39d18cd (115) | rebuilt, unaccounted 2 ms | -482 | 490 / 0 / 490; 3 / 120 | ko | stored | 69 | 93, 361 / 531, 92 (0) / 1 (0) | 6, 172 / 470, 6 (0) / 0 (0) |
| | | | | | | ja | stored | 80 | 324, 310 / 538, 310 (0) / 14 (0) | 20, 214 / 529, 19 (0) / 1 (0) |
| | | | | | | en | stored | 113 | 44, 339 / 514, 40 (0) / 4 (0) | 3, 377 / 432, 3 (0) / 0 (0) |
