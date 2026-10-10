# Browsers run — 2026-10-10T19:21:00.560Z

- Target: https://opensetlist-git-dev-opensetlist-projects.vercel.app/events/111/rehearsal-lovelive-fes-2020-day1 (event 111, start rev 324, 23 active rows; insert after row 2 = position 2)
- Population: 30 Chromium pages (ja/ko/en 70/20/10), 120 SDK subscribers in 1 worker thread(s)
- Edits: 3 × (insert-after + PUT marker song), every 25 s; timeout 30 s; drill: silent-loss (edit 3, pages 10)
- Window (UTC): run start 2026-10-10T19:21:00.560Z, first edit 2026-10-10T19:22:28.458Z, last edit settled 2026-10-10T19:23:32.913Z, end 2026-10-10T19:23:36.810Z
- Label: run2-silent-loss

## Gate verdicts

Latency = PUT (the save that makes the marker exist) request start → marker link in the page DOM / SDK client applied a snapshot with rev ≥ the PUT's rev. Missing = not seen within the timeout.

| Scope | n | p50 ms | p95 ms | max ms | missing | gate | verdict |
|---|---|---|---|---|---|---|---|
| all pairs (pages + SDK) | 440 | 1824 | 2341 | 2399 | 0 | p95 ≤ 3000, 0 missing | **PASS** |
| edit × page | 80 | 805 | 1207 | 1226 | 0 | same | **PASS** |
| edit × SDK client | 360 | 1858 | 2352 | 2399 | 0 | same | **PASS** |
| drill silent-loss (drilled pairs) | 10 | 8439 | 13687 | 13687 | 0 | max ≤ 24000 ms, 0 missing | **PASS** |

Insert-start based (insert-after request start → marker), non-drilled: pages 80 | 1515 | 1837 | 1856 · SDK 360 | 2502 | 2947 | 2994 (n | p50 | p95 | max).

## Notification paths (PUT start → arrival)

| Path | delivered / expected | p50 ms | p95 ms | max ms |
|---|---|---|---|---|
| R1 postgres_changes UPDATE → pages | 90 / 90 | 946 | 1054 | 1445 |
| R1 postgres_changes UPDATE → SDK | 360 / 360 | 1068 | 1308 | 1600 |
| R2 broadcast `rev` → SDK | 360 / 360 | 960 | 1308 | 1600 |

## Per edit

| # | row | marker song | insert start (UTC) | ins ms | rev | PUT start (UTC) | PUT ms | rev | pages seen | pages p50/p95/max | SDK seen | SDK p50/p95/max | pg→pages | pg→SDK | bcast→SDK p50/p95 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 1599 | 53 ミルク | 2026-10-10T19:22:28.459Z | 463 | 325 | 2026-10-10T19:22:29.054Z | 389 | 326 | 30/30 | 733/853/873 | 120/120 | 2017/2373/2399 | 30/30 | 120/120 | 928/1078 (120) |
| 2 | 1600 | 54 Colorfulness | 2026-10-10T19:22:53.472Z | 506 | 327 | 2026-10-10T19:22:54.102Z | 568 | 328 | 30/30 | 986/1218/1226 | 120/120 | 1879/1969/2023 | 30/30 | 120/120 | 799/1083 (120) |
| 3 (drill: 10) | 1601 | 55 ハッピー至上主義！ | 2026-10-10T19:23:18.472Z | 599 | 329 | 2026-10-10T19:23:19.202Z | 378 | 330 | 30/30 | 893/13641/13687 | 120/120 | 1583/1841/1902 | 30/30 | 120/120 | 1007/1424 (120) |

## Population

- Pages: 30/30 loaded; channel joined 30; pg_changes registered 30; visibility {"visible":30}; locales {"ja":21,"ko":6,"en":3}
  - open → join ms: n=30 p50=1545 p95=2340 max=2386; open → pg_changes ready: n=30 p50=29153 p95=66068 max=67542
  - /api/setlist responses seen: 481 ({"cache":277,"build":204}); page errors: 0; ws opens 30, closes 0, dropped pg frames 250, blocked attempts 0
- SDK: 120/120 joined; pg_changes registered 120; all joined after 10.916 s, all registered after 76.206 s (from population start)
  - subscribe → SUBSCRIBED ms: n=120 p50=465 p95=643 max=828; subscribe → pg_changes ready: n=120 p50=36785 p95=69483 max=74616
  - statuses {"SUBSCRIBED":120,"CLOSED":120}; R3 fallbacks 0; fetch failures 0; fetches by reason {"catchup":240,"periodic":821,"notification":949}; X-Snapshot-Source {"cache":1255,"build":755}

## Drill events

- edit 3 2026-10-10T19:23:18.472Z: drop postgres_changes frames on pages 0,1,2,3,4,5,6,7,8,9
- edit 3 2026-10-10T19:23:32.912Z: stop dropping (drilled pages repaired or timeout)

| drilled page | edit | locale | PUT → marker ms | dropped pg frames | repairing fetch: ms after PUT, minRev, source |
|---|---|---|---|---|---|
| 0 | 3 | ja | 775 | 25 | 718, 328, build |
| 1 | 3 | ko | 12218 | 25 | 12178, 328, cache |
| 2 | 3 | ja | 8935 | 25 | 8854, 328, cache |
| 3 | 3 | en | 8439 | 25 | 8323, 328, cache |
| 4 | 3 | ja | 7449 | 25 | 7379, 328, cache |
| 5 | 3 | ja | 3900 | 25 | 3852, 328, cache |
| 6 | 3 | ko | 5657 | 25 | 5540, 328, cache |
| 7 | 3 | ja | 13641 | 25 | 13600, 328, cache |
| 8 | 3 | ja | 13687 | 25 | 13613, 328, cache |
| 9 | 3 | ja | 10884 | 25 | 10852, 328, cache |

## Clean-up

- Soft-deleted 3/3 created rows; position restore: null
- Verify: {"dbActive":23,"snapshotItems":23,"snapshotRev":333,"startRows":23,"goneMeanwhile":0,"sameOrder":true,"samePositions":false,"oursStillActive":[]} (samePositions is expected to be false without --restore-positions: insert-after shifted rows below the insertion point and soft-delete does not compact)
