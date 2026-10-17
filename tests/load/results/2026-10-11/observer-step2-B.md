# Independent observer — step2-B

- host: `runnervmmprz5` (linux 6.17.0-1022-azure x64, node v24.21.0)
- base: https://opensetlist-git-dev-opensetlist-projects.vercel.app · event 111 · 5 SDK clients + 1 plain poller (5 s)
- window: 2026-10-11T17:51:57.712Z → 2026-10-11T18:06:58.057Z (UTC)
- event-loop lag (main thread, 100 ms timer): p50 0 · p95 1 · max 2 ms (n=8981)
- SDK worker event-loop utilisation over the run: 0.002
- all SDK requests: n=347 · statuses {"200":347} · duration p50/p95/max 198 / 301 / 2118 ms
- plain poller: statuses {"200":180} · 200 duration p50/p95/max 216 / 291 / 2283 ms

Times are UTC wall clock of this host. Compare a rev's first arrival with the harness report's arrival for the same rev.

## Per rev (broadcast arrivals)

| rev | first arrival (UTC) | clients | spread ms | hinted fetch p50 / p95 ms | n | sources | applied − first arrival ms (min…max) | poller saw it (ms after) |
|---|---|---|---|---|---|---|---|---|
| 1019 | 17:56:45.116 | 5 | 1 | 179 / 242 | 5 | warm 5 | 166…291 (5) | 2864 |
| 1020 | 17:57:08.030 | 5 | 2 | 177 / 396 | 5 | warm 5 | 225…648 (5) | 71 |
| 1021 | 17:57:08.561 | 5 | 1 | 172 / 282 | 5 | warm 5 | 697…1122 (5) | 4407 |
| 1022 | 17:57:33.822 | 5 | 1 | 178 / 187 | 5 | warm 5 | 231…633 (5) | 4142 |
| 1023 | 17:57:58.006 | 5 | 5 | 173 / 321 | 5 | warm 5 | 338…757 (5) | 25 |
| 1024 | 17:57:58.612 | 5 | 2 | 162 / 217 | 5 | warm 5 | 742…1026 (5) | 4369 |
| 1025 | 17:58:23.807 | 5 | 1 | 169 / 182 | 5 | warm 5 | 188…573 (5) | 4158 |
| 1026 | 17:58:48.093 | 5 | 3 | 201 / 289 | 5 | warm 5 | 241…707 (5) | 4874 |
| 1027 | 17:58:48.581 | 5 | 1 | 154 / 166 | 5 | warm 5 | 754…1083 (5) | 4386 |
| 1028 | 17:59:13.914 | 5 | 9 | 165 / 173 | 5 | warm 5 | 271…646 (5) | 4114 |
| 1029 | 17:59:37.951 | 5 | 1 | 167 / 175 | 5 | warm 5 | 194…585 (5) | 114 |
| 1030 | 17:59:39.000 | 5 | 3 | 154 / 169 | 5 | warm 5 | 299…606 (5) | 3982 |
| 1031 | 18:00:03.799 | 5 | 2 | 179 / 181 | 5 | warm 5 | 194…476 (5) | 4192 |
| 1032 | 18:00:28.091 | 5 | 1 | 187 / 295 | 5 | warm 5 | 206…532 (5) | 4899 |
| 1033 | 18:00:28.736 | 5 | 2 | 174 / 252 | 5 | warm 5 | 543…884 (5) | 4254 |
| 1034 | 18:00:53.823 | 5 | 3 | 182 / 279 | 4 | warm 4 | 215…604 (5) | 4192 |
| 1035 | 18:01:18.022 | 5 | 2 | 170 / 318 | 5 | warm 5 | 194…778 (5) | 39 |
| 1036 | 18:01:18.653 | 5 | 1 | 161 / 198 | 5 | warm 5 | 600…997 (5) | 4357 |
| 1037 | 18:01:43.834 | 5 | 1 | 160 / 193 | 5 | warm 5 | 215…363 (5) | 4221 |
| 1038 | 18:01:47.333 | 5 | 2 | 157 / 171 | 3 | warm 3 | 203…736 (5) | 722 |
| 1039 | 18:01:47.757 | 5 | 2 | 156 / 308 | 2 | warm 2 | 203…1021 (5) | 298 |
| 1040 | 18:01:48.140 | 5 | 2 | 154 / 154 | 1 | warm 1 | 394…820 (5) | 4865 |
| 1041 | 18:01:48.506 | 5 | 1 | 162 / 189 | 4 | warm 4 | 255…1031 (5) | 4499 |
| 1042 | 18:01:48.891 | 5 | 19 | – | 0 | – | 646…1069 (5) | 4114 |
| 1043 | 18:01:49.255 | 5 | 4 | 156 / 157 | 2 | warm 2 | 282…705 (5) | 3750 |
| 1044 | 18:01:49.606 | 5 | 3 | 153 / 170 | 5 | warm 5 | 180…1125 (5) | 3399 |
| 1045 | 18:03:06.253 | 5 | 1 | 187 / 220 | 4 | warm 4 | 226…656 (5) | 1836 |

## Revs applied without any broadcast

No client received these revs' `rev` broadcast; a poll brought them. Check the clients' first SUBSCRIBED time below — a save before it is expected here.

- rev 1018: first applied 17:51:59.915 by a `initial` fetch — lowest applied rev, applied by the join's own fetch: probably the clients' starting state, not a lost broadcast

## Clients

| client | locale | first SUBSCRIBED (UTC) | SUBSCRIBED | statuses | fallbacks | recreates | errors |
|---|---|---|---|---|---|---|---|
| 0 | ja | 17:51:59.560 | 1 | {"SUBSCRIBED":1,"CLOSED":1} | 0 | 0 | – |
| 1 | ko | 17:51:59.559 | 1 | {"SUBSCRIBED":1,"CLOSED":1} | 0 | 0 | – |
| 2 | en | 17:51:59.559 | 1 | {"SUBSCRIBED":1,"CLOSED":1} | 0 | 0 | – |
| 3 | ja | 17:51:59.559 | 1 | {"SUBSCRIBED":1,"CLOSED":1} | 0 | 0 | – |
| 4 | ko | 17:51:59.560 | 1 | {"SUBSCRIBED":1,"CLOSED":1} | 0 | 0 | – |
