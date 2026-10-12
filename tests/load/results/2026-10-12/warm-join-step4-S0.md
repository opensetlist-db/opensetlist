## Warm join — 2026-10-12T04-10-46-056Z-browsers-overlap.json + 2026-10-12T04-07-30Z-vercel-logs-history-step4-S0.txt

Per save and locale: warm-complete − commit (commit proxy = the PUT's response), and each client's FIRST notification fetch of the save split by whether it left after that locale's entry existed. hit = `x-snapshot-source: warm`.

- **SDK**: first hinted fetches 5488; arrived after warm-complete 5103/5488 (93 %); hit rate after 5103/5103 (100 %), before 385/385 (100 %); all hits 5488; minRev ≠ rev 0; served newer than key 0
- **pages**: first hinted fetches 351; arrived after warm-complete 324/351 (92 %); hit rate after 324/324 (100 %), before 27/27 (100 %); all hits 351; minRev ≠ rev 0; served newer than key 0
- warm jobs in the logs: 16
- overlap groups (head = highest committed rev; the gate clock is the last save start): 1: A 1470, B 1471 → head 1471; 2: A 1472, B 1473 → head 1473; 3: A 1474, B 1475 → head 1475; 4: A 1476, B 1477 → head 1477; 5: A 1478, B 1479 → head 1479; 6: A 1480, B 1481 → head 1481
- offsets: `at` = server timestamps (set `at` − writer `at`); `log` / `rebuilt` = job-start based (older logs).

| # | rev | warm job (start → done ms) | offsets | log PUT − harness PUT ms | log: lookups / hits / hinted; builds warm / reader | entry rev ≠ key rev | locale | entry | warm-complete − commit ms | SDK: n, arrival p50 / p95, after (hits) / before (hits) | pages: same |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1A | 1470 | f075f5fa (132) | at, unaccounted 0 ms | -182 | 482 / 482 / 482; 3 / 80 | — | ko | stored | 88 | 90, 322 / 529, 86 (86) / 4 (4) | 6, 305 / 554, 5 (5) / 1 (1) |
| | | | | | | | ja | stored | 72 | 310, 296 / 523, 301 (301) / 9 (9) | 20, 288 / 474, 20 (20) / 0 (0) |
| | | | | | | | en | stored | 142 | 44, 274 / 520, 40 (40) / 4 (4) | 3, 461 / 554, 3 (3) / 0 (0) |
| 1B | 1471 | 6194e334 (123) | at, unaccounted 0 ms | -214 | 496 / 496 / 496; 3 / 177 | — | ko | stored | 77 | 91, 268 / 519, 86 (86) / 5 (5) | 6, 310 / 501, 6 (6) / 0 (0) |
| | | | | | | | ja | stored | 79 | 320, 281 / 524, 305 (305) / 15 (15) | 20, 181 / 430, 18 (18) / 2 (2) |
| | | | | | | | en | stored | 132 | 47, 265 / 528, 40 (40) / 7 (7) | 3, 441 / 473, 3 (3) / 0 (0) |
| 2A | 1472 | 34446bdc (100) | at, unaccounted 0 ms | -183 | 493 / 493 / 493; 3 / 29 | — | ko | stored | 49 | 92, 291 / 518, 92 (92) / 0 (0) | 6, 134 / 382, 6 (6) / 0 (0) |
| | | | | | | | ja | stored | 60 | 317, 291 / 536, 313 (313) / 4 (4) | 20, 262 / 516, 20 (20) / 0 (0) |
| | | | | | | | en | stored | 106 | 46, 302 / 526, 41 (41) / 5 (5) | 3, 267 / 308, 3 (3) / 0 (0) |
| 2B | 1473 | 6be337b1 (127) | at, unaccounted 0 ms | -216 | 503 / 503 / 503; 3 / 174 | — | ko | stored | 90 | 94, 322 / 509, 86 (86) / 8 (8) | 6, 273 / 535, 6 (6) / 0 (0) |
| | | | | | | | ja | stored | 101 | 323, 316 / 509, 284 (284) / 39 (39) | 21, 351 / 507, 19 (19) / 2 (2) |
| | | | | | | | en | stored | 145 | 47, 341 / 485, 37 (37) / 10 (10) | 3, 443 / 499, 3 (3) / 0 (0) |
| 3A | 1474 | 34446bdc (82) | at, unaccounted 0 ms | -187 | 504 / 504 / 504; 3 / 14 | — | ko | stored | 45 | 94, 299 / 535, 94 (94) / 0 (0) | 6, 313 / 576, 6 (6) / 0 (0) |
| | | | | | | | ja | stored | 59 | 324, 301 / 547, 322 (322) / 2 (2) | 21, 386 / 546, 21 (21) / 0 (0) |
| | | | | | | | en | stored | 88 | 47, 329 / 518, 46 (46) / 1 (1) | 3, 314 / 497, 3 (3) / 0 (0) |
| 3B | 1475 | f62e882e (116) | at, unaccounted 0 ms | -208 | 502 / 502 / 502; 3 / 141 | — | ko | stored | 75 | 93, 334 / 520, 88 (88) / 5 (5) | 6, 274 / 458, 5 (5) / 1 (1) |
| | | | | | | | ja | stored | 99 | 323, 318 / 524, 291 (291) / 32 (32) | 21, 290 / 528, 18 (18) / 3 (3) |
| | | | | | | | en | stored | 125 | 47, 270 / 511, 35 (35) / 12 (12) | 3, 90 / 223, 1 (1) / 2 (2) |
| 4A | 1476 | 1fb7c808 (108) | at, unaccounted 0 ms | -187 | 493 / 493 / 493; 3 / 55 | — | ko | stored | 63 | 90, 305 / 571, 89 (89) / 1 (1) | 4, 349 / 522, 4 (4) / 0 (0) |
| | | | | | | | ja | stored | 109 | 320, 323 / 580, 283 (283) / 37 (37) | 21, 212 / 459, 15 (15) / 6 (6) |
| | | | | | | | en | stored | 119 | 46, 268 / 572, 34 (34) / 12 (12) | 3, 99 / 307, 1 (1) / 2 (2) |
| 4B | 1477 | c5d81a84 (136) | at, unaccounted 0 ms | -218 | 494 / 494 / 494; 3 / 144 | — | ko | stored | 92 | 93, 316 / 538, 85 (85) / 8 (8) | 6, 265 / 530, 5 (5) / 1 (1) |
| | | | | | | | ja | stored | 104 | 320, 307 / 527, 285 (285) / 35 (35) | 21, 347 / 552, 20 (20) / 1 (1) |
| | | | | | | | en | stored | 150 | 43, 239 / 487, 30 (30) / 13 (13) | 2, 219 / 279, 2 (2) / 0 (0) |
| 5A | 1478 | c5d81a84 (149) | at, unaccounted 0 ms | -183 | 492 / 492 / 492; 3 / 41 | — | ko | stored | 58 | 91, 305 / 529, 90 (90) / 1 (1) | 6, 256 / 507, 6 (6) / 0 (0) |
| | | | | | | | ja | stored | 107 | 317, 308 / 536, 284 (284) / 33 (33) | 20, 315 / 555, 20 (20) / 0 (0) |
| | | | | | | | en | stored | 155 | 46, 296 / 521, 40 (40) / 6 (6) | 3, 361 / 453, 2 (2) / 1 (1) |
| 5B | 1479 | 1fb7c808 (88) | at, unaccounted 0 ms | -208 | 494 / 494 / 494; 3 / 168 | — | ko | stored | 52 | 92, 301 / 556, 92 (92) / 0 (0) | 6, 213 / 416, 6 (6) / 0 (0) |
| | | | | | | | ja | stored | 66 | 319, 320 / 541, 314 (314) / 5 (5) | 20, 312 / 514, 20 (20) / 0 (0) |
| | | | | | | | en | stored | 95 | 45, 343 / 541, 43 (43) / 2 (2) | 3, 430 / 512, 3 (3) / 0 (0) |
| 6A | 1480 | 2e46a49f (202) | at, unaccounted 0 ms | -187 | 499 / 499 / 499; 3 / 21 | — | ko | stored | 89 | 89, 256 / 514, 80 (80) / 9 (9) | 6, 348 / 493, 6 (6) / 0 (0) |
| | | | | | | | ja | stored | 102 | 324, 297 / 528, 284 (284) / 40 (40) | 21, 234 / 463, 20 (20) / 1 (1) |
| | | | | | | | en | stored | 216 | 47, 293 / 500, 33 (33) / 14 (14) | 3, 127 / 173, 0 (0) / 3 (3) |
| 6B | 1481 | 2e46a49f (111) | at, unaccounted 0 ms | -216 | 495 / 495 / 495; 3 / 48 | — | ko | stored | 69 | 90, 242 / 544, 88 (88) / 2 (2) | 6, 192 / 441, 6 (6) / 0 (0) |
| | | | | | | | ja | stored | 64 | 320, 287 / 533, 319 (319) / 1 (1) | 20, 298 / 543, 20 (20) / 0 (0) |
| | | | | | | | en | stored | 116 | 47, 317 / 529, 43 (43) / 4 (4) | 3, 359 / 534, 2 (2) / 1 (1) |
