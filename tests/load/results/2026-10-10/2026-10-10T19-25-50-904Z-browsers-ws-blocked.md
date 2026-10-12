# Browsers run — 2026-10-10T19:23:52.359Z

- Target: https://opensetlist-git-dev-opensetlist-projects.vercel.app/events/111/rehearsal-lovelive-fes-2020-day1 (event 111, start rev 333, 23 active rows; insert after row 2 = position 2)
- Population: 30 Chromium pages (ja/ko/en 70/20/10), 120 SDK subscribers in 1 worker thread(s)
- Edits: 3 × (insert-after + PUT marker song), every 25 s; timeout 30 s; drill: ws-blocked (edit all, pages 10)
- Window (UTC): run start 2026-10-10T19:23:52.359Z, first edit 2026-10-10T19:24:51.223Z, last edit settled 2026-10-10T19:25:47.004Z, end 2026-10-10T19:25:50.902Z
- Label: run2-ws-blocked

## Gate verdicts

Latency = PUT (the save that makes the marker exist) request start → marker link in the page DOM / SDK client applied a snapshot with rev ≥ the PUT's rev. Missing = not seen within the timeout.

| Scope | n | p50 ms | p95 ms | max ms | missing | gate | verdict |
|---|---|---|---|---|---|---|---|
| all pairs (pages + SDK) | 420 | 1951 | 2149 | 2249 | 0 | p95 ≤ 3000, 0 missing | **PASS** |
| edit × page | 60 | 1062 | 1301 | 1714 | 0 | same | **PASS** |
| edit × SDK client | 360 | 1974 | 2152 | 2249 | 0 | same | **PASS** |
| drill ws-blocked (drilled pairs) | 30 | 3267 | 5163 | 5363 | 0 | max ≤ 7000 ms, 0 missing | **PASS** |

Insert-start based (insert-after request start → marker), non-drilled: pages 60 | 1586 | 1928 | 2341 · SDK 360 | 2512 | 2688 | 2788 (n | p50 | p95 | max).

## Notification paths (PUT start → arrival)

| Path | delivered / expected | p50 ms | p95 ms | max ms |
|---|---|---|---|---|
| R1 postgres_changes UPDATE → pages | 60 / 90 | 942 | 1360 | 1378 |
| R1 postgres_changes UPDATE → SDK | 360 / 360 | 1261 | 1686 | 1772 |
| R2 broadcast `rev` → SDK | 360 / 360 | 439 | 471 | 483 |

## Per edit

| # | row | marker song | insert start (UTC) | ins ms | rev | PUT start (UTC) | PUT ms | rev | pages seen | pages p50/p95/max | SDK seen | SDK p50/p95/max | pg→pages | pg→SDK | bcast→SDK p50/p95 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 (drill: 10) | 1602 | 56 Pleasure Feather | 2026-10-10T19:24:51.223Z | 485 | 334 | 2026-10-10T19:24:51.718Z | 379 | 335 | 30/30 | 1065/5097/5163 | 120/120 | 1986/2136/2158 | 20/30 | 120/120 | 439/444 (120) |
| 2 (drill: 10) | 1603 | 57 以心☆電信 | 2026-10-10T19:25:16.232Z | 532 | 336 | 2026-10-10T19:25:16.771Z | 363 | 337 | 30/30 | 1083/4491/5363 | 120/120 | 2012/2208/2249 | 20/30 | 120/120 | 421/425 (120) |
| 3 (drill: 10) | 1604 | 58 BANG YOU グラビティ | 2026-10-10T19:25:41.227Z | 618 | 338 | 2026-10-10T19:25:41.854Z | 414 | 339 | 30/30 | 1293/4188/4877 | 120/120 | 1822/2012/2022 | 20/30 | 120/120 | 468/472 (120) |

## Population

- Pages: 30/30 loaded; channel joined 20; pg_changes registered 20; visibility {"visible":30}; locales {"ja":21,"ko":6,"en":3}
  - open → join ms: n=20 p50=1456 p95=1771 max=1792; open → pg_changes ready: n=20 p50=34533 p95=37088 max=37782
  - /api/setlist responses seen: 516 ({"cache":341,"build":175}); page errors: 0; ws opens 160, closes 140, dropped pg frames 0, blocked attempts 140
- SDK: 120/120 joined; pg_changes registered 120; all joined after 10.018 s, all registered after 47.179 s (from population start)
  - subscribe → SUBSCRIBED ms: n=120 p50=441 p95=485 max=630; subscribe → pg_changes ready: n=120 p50=35426 p95=44495 max=46623
  - statuses {"SUBSCRIBED":120,"CLOSED":120}; R3 fallbacks 0; fetch failures 0; fetches by reason {"catchup":240,"periodic":572,"notification":934}; X-Snapshot-Source {"cache":884,"build":838}

| drilled page | edit | locale | PUT → marker ms | dropped pg frames | repairing fetch: ms after PUT, minRev, source |
|---|---|---|---|---|---|
| 0 | 1 | ja | 2986 | 0 | 2931, 333, cache |
| 1 | 1 | ko | 1389 | 0 | 1330, 333, build |
| 2 | 1 | ja | 3902 | 0 | 3801, 333, cache |
| 3 | 1 | en | 4218 | 0 | 4135, 333, cache |
| 4 | 1 | ja | 598 | 0 | 572, 333, build |
| 5 | 1 | ja | 2197 | 0 | 2122, 333, cache |
| 6 | 1 | ko | 5097 | 0 | 5039, 333, cache |
| 7 | 1 | ja | 952 | 0 | 912, 333, build |
| 8 | 1 | ja | 4249 | 0 | 4238, 334, cache |
| 9 | 1 | ja | 5163 | 0 | 5139, 334, cache |
| 0 | 2 | ja | 1886 | 0 | 1842, 335, build |
| 1 | 2 | ko | 4491 | 0 | 4422, 335, cache |
| 2 | 2 | ja | 4270 | 0 | 4231, 335, cache |
| 3 | 2 | en | 4326 | 0 | 4296, 335, cache |
| 4 | 2 | ja | 3544 | 0 | 3501, 335, cache |
| 5 | 2 | ja | 5363 | 0 | 5272, 335, cache |
| 6 | 2 | ko | 2468 | 0 | 2416, 335, build |
| 7 | 2 | ja | 3267 | 0 | 3221, 335, build |
| 8 | 2 | ja | 3000 | 0 | 2952, 335, build |
| 9 | 2 | ja | 4321 | 0 | 4309, 336, cache |
| 0 | 3 | ja | 1722 | 0 | 1665, 337, build |
| 1 | 3 | ko | 3215 | 0 | 3194, 337, cache |
| 2 | 3 | ja | 4188 | 0 | 4156, 337, cache |
| 3 | 3 | en | 1311 | 0 | 1360, 337, build |
| 4 | 3 | ja | 1705 | 0 | 1635, 337, build |
| 5 | 3 | ja | 1729 | 0 | 1712, 337, build |
| 6 | 3 | ko | 3402 | 0 | 3317, 337, cache |
| 7 | 3 | ja | 4877 | 0 | 4798, 338, cache |
| 8 | 3 | ja | 2829 | 0 | 2780, 337, cache |
| 9 | 3 | ja | 3365 | 0 | 3333, 337, cache |

## Clean-up

- Soft-deleted 3/3 created rows; position restore: null
- Verify: {"dbActive":23,"snapshotItems":23,"snapshotRev":342,"startRows":23,"goneMeanwhile":0,"sameOrder":true,"samePositions":false,"oursStillActive":[]} (samePositions is expected to be false without --restore-positions: insert-after shifted rows below the insertion point and soft-delete does not compact)
