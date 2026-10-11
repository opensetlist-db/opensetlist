# Browsers run — 2026-10-11T09:34:12.280Z

- Target: https://opensetlist-git-dev-opensetlist-projects.vercel.app/events/111/rehearsal-lovelive-fes-2020-day1 (event 111, start rev 924, 23 active rows; insert after row 2 = position 2)
- Population: 30 Chromium pages (ja/ko/en 70/20/10), 470 SDK subscribers in 4 worker thread(s)
- Edits: 3 × (insert-after + PUT marker song), every 25 s; timeout 30 s; drill: double-save (edit 2, pages 30)
- Window (UTC): run start 2026-10-11T09:34:12.280Z, first edit 2026-10-11T09:34:37.411Z, last edit settled 2026-10-11T09:35:30.788Z, end 2026-10-11T09:35:35.405Z
- Label: warm-on-double-save-2

## Gate verdicts

Latency = PUT (the save that makes the marker exist) request start of its FIRST attempt → marker link in the page DOM / SDK client applied a snapshot with rev ≥ the PUT's rev. Missing = not seen within the timeout. Monotonic: no page/client ever went back to an older version.

| Scope | n | p50 ms | p95 ms | max ms | missing | gate | verdict |
|---|---|---|---|---|---|---|---|
| all pairs (pages + SDK) | 1500 | 1617 | 3864 | 4007 | 0 | p95 ≤ 3000, 0 missing | **FAIL** |
| edit × page | 90 | 1556 | 2017 | 2042 | 0 | same | **PASS** |
| edit × SDK client | 1410 | 1619 | 3867 | 4007 | 0 | same | **FAIL** |
| drill double-save (edit 2: final save start → final state) | 500 | 1227 | 1982 | 1998 | 0 not converged | every client converges to the final save, 0 regressions | **PASS** |
| monotonic DOM (pages: version shown never decreases) | 30 pages, 100 versions | — | — | — | 0 regressions on 0 page(s) | 0 | **PASS** |
| monotonic applied rev (SDK) | 470 clients, 6115 applies | — | — | — | 0 regressions on 0 client(s) | 0 | **PASS** |
| warming: warm hits ÷ hinted fetches (`x-snapshot-source: warm`) | SDK 3737/3737 (100.0 %), pages 239/239 (100.0 %) | — | — | — | — | informational; reader builds per save: `vercel-logs-summary.mjs` "Warming" on the history logs; arrival vs warm-complete: `warm-join.mjs` | n/a |
| edits with a retried save (clock from the 1st attempt) | 0 | — | — | — | 0 | informational — 0 edit(s); from the successful attempt p50/p95/max —/—/— | n/a |

Insert-start based (insert-after request start → marker), non-drilled: pages 90 | 2378 | 2977 | 2984 · SDK 1410 | 2383 | 4499 | 4639 (n | p50 | p95 | max).

## Notification paths (PUT start → arrival)

An R1 page build (what the preview runs until R2 deploys, or after a rollback) is notified by postgres_changes and ignores the broadcast; an R2 build only has the broadcast. The SDK clients are always R2.

| Path | delivered / expected | p50 ms | p95 ms | max ms |
|---|---|---|---|---|
| postgres_changes UPDATE → pages (R1 build) | 0 / 90 | — | — | — |
| broadcast `rev` → pages | 90 / 90 | 683 | 1054 | 1088 |
| broadcast `rev` → SDK | 1410 / 1410 | 692 | 2120 | 2261 |

## Per edit

| # | row | marker song | insert start (UTC) | ins ms | rev | PUT start (UTC) | PUT ms | rev |
|---|---|---|---|---|---|---|---|---|
| 1 | 2065 | 410 不思議と君とライブラリー | 2026-10-11T09:34:37.411Z | 626 | 925 | 2026-10-11T09:34:38.043Z | 536 | 926 |
| 2 (double save) | 2066 | 414 アンブレラ | 2026-10-11T09:35:02.413Z | 496 | 927 | 2026-10-11T09:35:03.466Z | 621 | 929 |
| 3 | 2067 | 413 アイシイ | 2026-10-11T09:35:27.418Z | 685 | 930 | 2026-10-11T09:35:28.240Z | 429 | 931 |

### Per save — pages (PUT start → marker in the DOM)

| # | PUT rev | seen | p50 / p95 / max ms | missing | bcast → page p50 / p95 (n) | pg → page (n) | notification fetches (hint=1) | their x-snapshot-verify | warm / hinted | 1st hinted request start − commit p50 / p95 |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 926 | 30/30 | 1932 / 2040 / 2042 | 0 | 1036 / 1087 (30) | 0 | 28 | satisfied 28 | 28/28 | 1083 / 1165 |
| 2 (double save) | 929 | 30/30 | 1156 / 1926 / 1931 | 0 | 683 / 695 (30) | 0 | 28 | satisfied 28 | 28/28 | 279 / 1023 |
| 3 | 931 | 30/30 | 1400 / 1670 / 1740 | 0 | 501 / 523 (30) | 0 | 29 | satisfied 29 | 29/29 | 740 / 953 |

### Per save — SDK clients (PUT start → applied rev ≥ PUT rev)

| # | PUT rev | reached | p50 / p95 / max ms | missing | bcast → SDK p50 / p95 (n) | notification fetches | their x-snapshot-verify | ticket resolutions | rechecks (resolved) | exhausted | warm / hinted | 1st hinted send − commit p50 / p95 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 926 | 470/470 | 2948 / 3933 / 4007 | 0 | 1631 / 2124 (470) | 390 | satisfied 390 | satisfied 465 | 0 (0) | 0 | 390/390 | 999 / 2967 |
| 2 (double save) | 929 | 470/470 | 1234 / 1983 / 1998 | 0 | 692 / 717 (470) | 435 | satisfied 435 | satisfied 460 | 0 (0) | 0 | 435/435 | 438 / 1047 |
| 3 | 931 | 470/470 | 1576 / 2383 / 2409 | 0 | 831 / 850 (470) | 450 | satisfied 450 | satisfied 466 | 0 (0) | 0 | 450/450 | 801 / 1677 |

## Hint outcomes (whole run)

- SDK: 6200 requests; notification fetches (hint=1) 3737, their x-snapshot-verify: satisfied 3737; all 200 responses: none 470, satisfied 5723
  - ticket resolutions: satisfied 3895; rechecks 0 (0.0 % of notification fetches), resolved on the recheck 0; hints exhausted 0; highest serverRev held 934
  - request shapes (reason / generic / ticket): initial generic 470, catchup generic 470, periodic generic 1365, notification +hint=1 3737, periodic generic +H 158; failures by kind: —
  - notification fetches by x-snapshot-source: warm 3737 (warm 3737/3737 (100.0 %))
- Pages: 393 /api/setlist responses; notification fetches (hint=1) 239, their x-snapshot-verify: satisfied 239; all 200 responses: satisfied 393 (an R1 page build sends no hint=1)
  - notification fetches by x-snapshot-source: warm 239 (warm 239/239 (100.0 %))

## Population

- Pages: 30/30 loaded; channel joined 30; visibility {"visible":30}; locales {"ja":21,"ko":6,"en":3}
  - open → join ms: n=30 p50=2064 p95=2508 max=2774
  - /api/setlist responses seen: 393 ({"build":14,"cache":140,"warm":239}); page errors: 0; ws opens 30, closes 0; rev broadcasts seen 300; dropped notification frames 0, blocked attempts 0
- SDK: 470/470 joined; all joined after 13.355 s (from population start)
  - subscribe → SUBSCRIBED ms: n=470 p50=285 p95=656 max=2076
  - statuses {"SUBSCRIBED":470,"CLOSED":470}; disconnected episodes (polling while realtime-js rejoins) 0; channel re-creations 0; fetch failures 0 (with Retry-After 0); fetches by reason {"initial":470,"catchup":470,"periodic":1523,"notification":3737}; X-Snapshot-Source {"build":304,"cache":2152,"warm":3737}

## Double-save drill

- 2nd PUT started 413 ms after the 1st; final save = song 414 (rev 929), replaced song 412
- converged by the end of the edit window: pages 30/30 (final marker shown, replaced one gone), SDK 470/470 (applied ≥ rev 929); final save start → final state p50/p95/max 1227/1982/1998 ms

## Drill events

- edit 2 2026-10-11T09:35:04.095Z: double save: song 412 @2026-10-11T09:35:03.053Z rev 928, song 414 @2026-10-11T09:35:03.466Z rev 929 → final 414

## Clean-up

- Soft-deleted 3/3 created rows; position restore: null
- Verify: {"dbActive":23,"snapshotItems":23,"snapshotRev":934,"startRows":23,"goneMeanwhile":0,"sameOrder":true,"samePositions":false,"oursStillActive":[]} (samePositions is expected to be false without --restore-positions: insert-after shifted rows below the insertion point and soft-delete does not compact)
