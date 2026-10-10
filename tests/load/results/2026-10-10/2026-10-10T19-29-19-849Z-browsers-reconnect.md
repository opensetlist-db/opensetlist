# Browsers run — 2026-10-10T19:26:12.316Z

- Target: https://opensetlist-git-dev-opensetlist-projects.vercel.app/events/111/rehearsal-lovelive-fes-2020-day1 (event 111, start rev 342, 23 active rows; insert after row 2 = position 2)
- Population: 30 Chromium pages (ja/ko/en 70/20/10), 120 SDK subscribers in 1 worker thread(s)
- Edits: 3 × (insert-after + PUT marker song), every 40 s; timeout 30 s; drill: reconnect (edit 2, pages all + all SDK)
- Window (UTC): run start 2026-10-10T19:26:12.316Z, first edit 2026-10-10T19:27:41.354Z, last edit settled 2026-10-10T19:29:16.089Z, end 2026-10-10T19:29:19.848Z
- Label: run2-reconnect

## Gate verdicts

Latency = PUT (the save that makes the marker exist) request start → marker link in the page DOM / SDK client applied a snapshot with rev ≥ the PUT's rev. Missing = not seen within the timeout.

| Scope | n | p50 ms | p95 ms | max ms | missing | gate | verdict |
|---|---|---|---|---|---|---|---|
| all pairs (pages + SDK) | 300 | 1674 | 12804 | 13937 | 0 | p95 ≤ 3000, 0 missing | **FAIL** |
| edit × page | 60 | 1608 | 12521 | 13051 | 0 | same | **FAIL** |
| edit × SDK client | 240 | 1674 | 13001 | 13937 | 0 | same | **FAIL** |
| drill reconnect (drilled pairs) | 150 | 2437 | 5170 | 6107 | 0 | informational (catch-up after reconnect) | n/a |

Insert-start based (insert-after request start → marker), non-drilled: pages 60 | 2289 | 13176 | 13706 · SDK 240 | 2355 | 13656 | 14592 (n | p50 | p95 | max).

## Notification paths (PUT start → arrival)

| Path | delivered / expected | p50 ms | p95 ms | max ms |
|---|---|---|---|---|
| R1 postgres_changes UPDATE → pages | 30 / 90 | 1205 | 1671 | 1695 |
| R1 postgres_changes UPDATE → SDK | 165 / 360 | 868 | 1491 | 1769 |
| R2 broadcast `rev` → SDK | 240 / 360 | 427 | 434 | 436 |

## Per edit

| # | row | marker song | insert start (UTC) | ins ms | rev | PUT start (UTC) | PUT ms | rev | pages seen | pages p50/p95/max | SDK seen | SDK p50/p95/max | pg→pages | pg→SDK | bcast→SDK p50/p95 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 1605 | 59 マハラジャンボリー | 2026-10-10T19:27:41.355Z | 552 | 343 | 2026-10-10T19:27:42.036Z | 362 | 344 | 30/30 | 1220/1593/1608 | 120/120 | 1652/1740/1871 | 30/30 | 120/120 | 425/435 (120) |
| 2 (drill: 150) | 1606 | 60 抱きしめる花びら | 2026-10-10T19:28:22.399Z | 601 | 345 | 2026-10-10T19:28:23.128Z | 398 | 346 | 30/30 | 3481/5932/6107 | 120/120 | 2273/4990/5633 | 0/30 | 0/120 | —/— (0) |
| 3 | 1607 | 61 STEP UP ! | 2026-10-10T19:29:01.363Z | 532 | 347 | 2026-10-10T19:29:02.018Z | 369 | 348 | 30/30 | 8066/12787/13051 | 120/120 | 7736/13419/13937 | 0/30 | 45/120 | 428/434 (120) |

## Population

- Pages: 30/30 loaded; channel joined 30; pg_changes registered 30; visibility {"visible":30}; locales {"ja":21,"ko":6,"en":3}
  - open → join ms: n=30 p50=1551 p95=2539 max=2731; open → pg_changes ready: n=30 p50=32130 p95=66089 max=68178
  - /api/setlist responses seen: 559 ({"cache":494,"build":65}); page errors: 0; ws opens 60, closes 30, dropped pg frames 0, blocked attempts 0
- SDK: 120/120 joined; pg_changes registered 120; all joined after 10.23 s, all registered after 77.405 s (from population start)
  - subscribe → SUBSCRIBED ms: n=120 p50=435 p95=522 max=579; subscribe → pg_changes ready: n=120 p50=37943 p95=71698 max=75292
  - statuses {"SUBSCRIBED":240,"CHANNEL_ERROR":120,"CLOSED":240}; R3 fallbacks 120; fetch failures 0; fetches by reason {"catchup":480,"periodic":1531,"notification":410}; X-Snapshot-Source {"cache":2013,"build":375}
  - channel errors: {"socket closed: 1005":120}

## Reconnect drill

- Rejoin after force-close: pages n=30 p50=30424 p95=30432 max=30435; SDK n=120 p50=30530 p95=30547 max=30553; SDK clients that went to the R3 polling fallback: 120

## Drill events

- edit 2 2026-10-10T19:28:21.358Z: force-closed 30 page sockets + 120 SDK sockets

## Clean-up

- Soft-deleted 3/3 created rows; position restore: null
- Verify: {"dbActive":23,"snapshotItems":23,"snapshotRev":351,"startRows":23,"goneMeanwhile":0,"sameOrder":true,"samePositions":false,"oursStillActive":[]} (samePositions is expected to be false without --restore-positions: insert-after shifted rows below the insertion point and soft-delete does not compact)
