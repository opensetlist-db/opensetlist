# Browsers run — 2026-10-11T04:41:10.809Z

- Target: https://opensetlist-git-dev-opensetlist-projects.vercel.app/events/111/rehearsal-lovelive-fes-2020-day1 (event 111, start rev 637, 23 active rows; insert after row 2 = position 2)
- Population: 30 Chromium pages (ja/ko/en 70/20/10), 470 SDK subscribers in 4 worker thread(s)
- Edits: 3 × (insert-after + PUT marker song), every 25 s; timeout 30 s; drill: double-save (edit 2, pages 30)
- Window (UTC): run start 2026-10-11T04:41:10.809Z, first edit 2026-10-11T04:41:33.229Z, last edit settled 2026-10-11T04:42:26.431Z, end 2026-10-11T04:42:30.844Z
- Label: r2-double-save

## Gate verdicts

Latency = PUT (the save that makes the marker exist) request start of its FIRST attempt → marker link in the page DOM / SDK client applied a snapshot with rev ≥ the PUT's rev. Missing = not seen within the timeout. Monotonic: no page/client ever went back to an older version.

| Scope | n | p50 ms | p95 ms | max ms | missing | gate | verdict |
|---|---|---|---|---|---|---|---|
| all pairs (pages + SDK) | 1500 | 1680 | 3729 | 7551 | 0 | p95 ≤ 3000, 0 missing | **FAIL** |
| edit × page | 90 | 1885 | 3824 | 5384 | 0 | same | **FAIL** |
| edit × SDK client | 1410 | 1669 | 3650 | 7551 | 0 | same | **FAIL** |
| drill double-save (edit 2: final save start → final state) | 500 | 3272 | 4291 | 7551 | 0 not converged | every client converges to the final save, 0 regressions | **PASS** |
| monotonic DOM (pages: version shown never decreases) | 30 pages, 119 versions | — | — | — | 0 regressions on 0 page(s) | 0 | **PASS** |
| monotonic applied rev (SDK) | 470 clients, 6342 applies | — | — | — | 0 regressions on 0 client(s) | 0 | **PASS** |
| edits with a retried save (clock from the 1st attempt) | 0 | — | — | — | 0 | informational — 0 edit(s); from the successful attempt p50/p95/max —/—/— | n/a |

Insert-start based (insert-after request start → marker), non-drilled: pages 90 | 2515 | 4653 | 6213 · SDK 1410 | 2320 | 4479 | 8380 (n | p50 | p95 | max).

## Notification paths (PUT start → arrival)

An R1 page build (what the preview runs until R2 deploys, or after a rollback) is notified by postgres_changes and ignores the broadcast; an R2 build only has the broadcast. The SDK clients are always R2.

| Path | delivered / expected | p50 ms | p95 ms | max ms |
|---|---|---|---|---|
| postgres_changes UPDATE → pages (R1 build) | 0 / 90 | — | — | — |
| broadcast `rev` → pages | 90 / 90 | 845 | 2190 | 2206 |
| broadcast `rev` → SDK | 1410 / 1410 | 977 | 2191 | 2207 |

## Per edit

| # | row | marker song | insert start (UTC) | ins ms | rev | PUT start (UTC) | PUT ms | rev |
|---|---|---|---|---|---|---|---|---|
| 1 | 1926 | 134 水彩世界 | 2026-10-11T04:41:33.229Z | 496 | 638 | 2026-10-11T04:41:33.854Z | 777 | 639 |
| 2 (double save) | 1927 | 137 Holiday∞Holiday | 2026-10-11T04:41:58.236Z | 510 | 640 | 2026-10-11T04:41:59.065Z | 2023 | 642 |
| 3 | 1928 | 136 Reflection in the mirror | 2026-10-11T04:42:23.238Z | 562 | 643 | 2026-10-11T04:42:23.933Z | 675 | 644 |

### Per save — pages (PUT start → marker in the DOM)

| # | PUT rev | seen | p50 / p95 / max ms | missing | bcast → page p50 / p95 (n) | pg → page (n) | notification fetches (hint=1) | their x-snapshot-verify |
|---|---|---|---|---|---|---|---|---|
| 1 | 639 | 30/30 | 1703 / 2125 / 2155 | 0 | 845 / 855 (30) | 0 | 26 | satisfied 26 |
| 2 (double save) | 642 | 30/30 | 3094 / 4495 / 5384 | 0 | 2188 / 2190 (30) | 0 | 27 | satisfied 26, missing 1 |
| 3 | 644 | 30/30 | 1607 / 2057 / 2225 | 0 | 743 / 743 (30) | 0 | 24 | satisfied 24 |

### Per save — SDK clients (PUT start → applied rev ≥ PUT rev)

| # | PUT rev | reached | p50 / p95 / max ms | missing | bcast → SDK p50 / p95 (n) | notification fetches | their x-snapshot-verify | ticket resolutions | rechecks (resolved) | exhausted |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 639 | 470/470 | 1459 / 2020 / 2346 | 0 | 954 / 1041 (470) | 252 | satisfied 252 | satisfied 260 | 0 (0) | 0 |
| 2 (double save) | 642 | 470/470 | 3272 / 4291 / 7551 | 0 | 2184 / 2199 (470) | 398 | satisfied 394 | satisfied 402 | 0 (0) | 0 |
| 3 | 644 | 470/470 | 1407 / 1857 / 2122 | 0 | 894 / 1004 (470) | 165 | satisfied 165 | satisfied 169 | 0 (0) | 0 |

## Hint outcomes (whole run)

- SDK: 6671 requests; notification fetches (hint=1) 3217, their x-snapshot-verify: satisfied 3210; all 200 responses: none 470, satisfied 6110
  - ticket resolutions: satisfied 3267; rechecks 0 (0.0 % of notification fetches), resolved on the recheck 0; hints exhausted 0; highest serverRev held 647
  - request shapes (reason / generic / ticket): initial generic 470, catchup generic 470, periodic generic 1392, notification +hint=1 3215, notification 1065, periodic generic +H 55, retry generic +H 2, retry +hint=1 2; failures by kind: http 4
- Pages: 431 /api/setlist responses; notification fetches (hint=1) 242, their x-snapshot-verify: satisfied 241; all 200 responses: satisfied 430 (an R1 page build sends no hint=1)

## Population

- Pages: 30/30 loaded; channel joined 30; visibility {"visible":30}; locales {"ja":21,"ko":6,"en":3}
  - open → join ms: n=30 p50=1633 p95=2162 max=2356
  - /api/setlist responses seen: 431 ({"build":296,"cache":134,"error":1}); page errors: 0; ws opens 30, closes 0; rev broadcasts seen 300; dropped notification frames 0, blocked attempts 0
- SDK: 470/470 joined; all joined after 10.761 s (from population start)
  - subscribe → SUBSCRIBED ms: n=470 p50=218 p95=374 max=1227
  - statuses {"SUBSCRIBED":470,"CLOSED":470}; disconnected episodes (polling while realtime-js rejoins) 0; channel re-creations 0; fetch failures 4 (with Retry-After 4); fetches by reason {"initial":470,"catchup":470,"periodic":1447,"notification":4280,"retry":4}; X-Snapshot-Source {"build":4501,"cache":2084}

## Double-save drill

- 2nd PUT started 299 ms after the 1st; final save = song 137 (rev 642), replaced song 135
- converged by the end of the edit window: pages 30/30 (final marker shown, replaced one gone), SDK 470/470 (applied ≥ rev 642); final save start → final state p50/p95/max 3272/4291/7551 ms

## Drill events

- edit 2 2026-10-11T04:42:01.092Z: double save: song 135 @2026-10-11T04:41:58.766Z rev 641, song 137 @2026-10-11T04:41:59.065Z rev 642 → final 137

## Clean-up

- Soft-deleted 3/3 created rows; position restore: null
- Verify: {"dbActive":23,"snapshotItems":23,"snapshotRev":647,"startRows":23,"goneMeanwhile":0,"sameOrder":true,"samePositions":false,"oursStillActive":[]} (samePositions is expected to be false without --restore-positions: insert-after shifted rows below the insertion point and soft-delete does not compact)
