# Browsers run — 2026-10-11T09:07:34.545Z

- Target: https://opensetlist-git-dev-opensetlist-projects.vercel.app/events/111/rehearsal-lovelive-fes-2020-day1 (event 111, start rev 863, 23 active rows; insert after row 2 = position 2)
- Population: 30 Chromium pages (ja/ko/en 70/20/10), 470 SDK subscribers in 4 worker thread(s)
- Edits: 3 × (insert-after + PUT marker song), every 25 s; timeout 30 s; drill: double-save (edit 2, pages 30)
- Window (UTC): run start 2026-10-11T09:07:34.545Z, first edit 2026-10-11T09:08:01.529Z, last edit settled 2026-10-11T09:08:57.657Z, end 2026-10-11T09:09:23.253Z
- Label: warm-on-double-save

## Gate verdicts

Latency = PUT (the save that makes the marker exist) request start of its FIRST attempt → marker link in the page DOM / SDK client applied a snapshot with rev ≥ the PUT's rev. Missing = not seen within the timeout. Monotonic: no page/client ever went back to an older version.

| Scope | n | p50 ms | p95 ms | max ms | missing | gate | verdict |
|---|---|---|---|---|---|---|---|
| all pairs (pages + SDK) | 1500 | 1623 | 4675 | 5078 | 0 | p95 ≤ 3000, 0 missing | **FAIL** |
| edit × page | 90 | 1343 | 1760 | 2086 | 0 | same | **PASS** |
| edit × SDK client | 1410 | 1637 | 4694 | 5078 | 0 | same | **FAIL** |
| drill double-save (edit 2: final save start → final state) | 500 | 2032 | 4743 | 4800 | 0 not converged | every client converges to the final save, 0 regressions | **PASS** |
| monotonic DOM (pages: version shown never decreases) | 30 pages, 93 versions | — | — | — | 0 regressions on 0 page(s) | 0 | **PASS** |
| monotonic applied rev (SDK) | 470 clients, 6064 applies | — | — | — | 0 regressions on 0 client(s) | 0 | **PASS** |
| warming: warm hits ÷ hinted fetches (`x-snapshot-source: warm`) | SDK 3593/3599 (99.8 %), pages 234/234 (100.0 %) | — | — | — | — | informational; reader builds per save: `vercel-logs-summary.mjs` "Warming" on the history logs; arrival vs warm-complete: `warm-join.mjs` | n/a |
| edits with a retried save (clock from the 1st attempt) | 0 | — | — | — | 0 | informational — 0 edit(s); from the successful attempt p50/p95/max —/—/— | n/a |

Insert-start based (insert-after request start → marker), non-drilled: pages 90 | 2262 | 2660 | 3227 · SDK 1410 | 2418 | 5759 | 5941 (n | p50 | p95 | max).

## Notification paths (PUT start → arrival)

An R1 page build (what the preview runs until R2 deploys, or after a rollback) is notified by postgres_changes and ignores the broadcast; an R2 build only has the broadcast. The SDK clients are always R2.

| Path | delivered / expected | p50 ms | p95 ms | max ms |
|---|---|---|---|---|
| postgres_changes UPDATE → pages (R1 build) | 0 / 90 | — | — | — |
| broadcast `rev` → pages | 90 / 90 | 560 | 678 | 731 |
| broadcast `rev` → SDK | 1410 / 1410 | 870 | 1680 | 1809 |

## Per edit

| # | row | marker song | insert start (UTC) | ins ms | rev | PUT start (UTC) | PUT ms | rev |
|---|---|---|---|---|---|---|---|---|
| 1 | 2047 | 391 ドライブ・スペード・クレイジー | 2026-10-11T09:08:01.529Z | 513 | 864 | 2026-10-11T09:08:02.158Z | 490 | 865 |
| 2 (double save) | 2048 | 394 Nεw Black | 2026-10-11T09:08:26.534Z | 697 | 866 | 2026-10-11T09:08:27.675Z | 613 | 868 |
| 3 | 2049 | 393 平成ギャルズ!!!! | 2026-10-11T09:08:51.540Z | 583 | 869 | 2026-10-11T09:08:52.266Z | 458 | 870 |

### Per save — pages (PUT start → marker in the DOM)

| # | PUT rev | seen | p50 / p95 / max ms | missing | bcast → page p50 / p95 (n) | pg → page (n) | notification fetches (hint=1) | their x-snapshot-verify | warm / hinted | 1st hinted request start − commit p50 / p95 |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 865 | 30/30 | 1491 / 1741 / 1757 | 0 | 526 / 557 (30) | 0 | 30 | satisfied 30 | 30/30 | 756 / 941 |
| 2 (double save) | 868 | 30/30 | 1206 / 2086 / 2086 | 0 | 673 / 713 (30) | 0 | 27 | satisfied 27 | 27/27 | 305 / 1033 |
| 3 | 870 | 30/30 | 1441 / 1782 / 1806 | 0 | 560 / 560 (30) | 0 | 30 | satisfied 30 | 30/30 | 697 / 944 |

### Per save — SDK clients (PUT start → applied rev ≥ PUT rev)

| # | PUT rev | reached | p50 / p95 / max ms | missing | bcast → SDK p50 / p95 (n) | notification fetches | their x-snapshot-verify | ticket resolutions | rechecks (resolved) | exhausted | warm / hinted | 1st hinted send − commit p50 / p95 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 865 | 470/470 | 1532 / 1915 / 1999 | 0 | 869 / 948 (470) | 416 | satisfied 416 | satisfied 457 | 0 (0) | 0 | 416/416 | 723 / 1252 |
| 2 (double save) | 868 | 470/470 | 3302 / 4745 / 4800 | 0 | 1646 / 1774 (470) | 446 | satisfied 446 | satisfied 467 | 0 (0) | 0 | 446/446 | 1151 / 3075 |
| 3 | 870 | 470/470 | 1739 / 4727 / 5078 | 0 | 923 / 989 (470) | 448 | satisfied 448 | satisfied 465 | 0 (0) | 0 | 448/448 | 872 / 1919 |

## Hint outcomes (whole run)

- SDK: 6212 requests; notification fetches (hint=1) 3599, their x-snapshot-verify: satisfied 3524; all 200 responses: none 470, satisfied 5640
  - ticket resolutions: satisfied 3665; rechecks 0 (0.0 % of notification fetches), resolved on the recheck 0; hints exhausted 0; highest serverRev held 873
  - request shapes (reason / generic / ticket): initial generic 470, catchup generic 470, periodic generic 1520, notification +hint=1 3599, periodic generic +H 153; failures by kind: —
  - notification fetches by x-snapshot-source: warm 3593, no 200 6 (warm 3593/3599 (99.8 %))
- Pages: 398 /api/setlist responses; notification fetches (hint=1) 234, their x-snapshot-verify: satisfied 234; all 200 responses: satisfied 398 (an R1 page build sends no hint=1)
  - notification fetches by x-snapshot-source: warm 234 (warm 234/234 (100.0 %))

## Population

- Pages: 30/30 loaded; channel joined 30; visibility {"visible":30}; locales {"ja":21,"ko":6,"en":3}
  - open → join ms: n=30 p50=1770 p95=3313 max=4622
  - /api/setlist responses seen: 398 ({"build":16,"cache":148,"warm":234}); page errors: 0; ws opens 30, closes 0; rev broadcasts seen 300; dropped notification frames 0, blocked attempts 0
- SDK: 470/470 joined; all joined after 15.262 s (from population start)
  - subscribe → SUBSCRIBED ms: n=470 p50=295 p95=515 max=1299
  - statuses {"SUBSCRIBED":470,"CLOSED":470}; disconnected episodes (polling while realtime-js rejoins) 0; channel re-creations 0; fetch failures 0 (with Retry-After 0); fetches by reason {"initial":470,"catchup":470,"periodic":1673,"notification":3599}; X-Snapshot-Source {"build":386,"cache":2215,"warm":3593}

## Double-save drill

- 2nd PUT started 310 ms after the 1st; final save = song 394 (rev 868), replaced song 392
- converged by the end of the edit window: pages 30/30 (final marker shown, replaced one gone), SDK 470/470 (applied ≥ rev 868); final save start → final state p50/p95/max 2032/4743/4800 ms

## Drill events

- edit 2 2026-10-11T09:08:28.306Z: double save: song 392 @2026-10-11T09:08:27.365Z rev 867, song 394 @2026-10-11T09:08:27.675Z rev 868 → final 394

## Clean-up

- Soft-deleted 3/3 created rows; position restore: null
- Verify: {"dbActive":23,"snapshotItems":23,"snapshotRev":873,"startRows":23,"goneMeanwhile":0,"sameOrder":true,"samePositions":false,"oursStillActive":[]} (samePositions is expected to be false without --restore-positions: insert-after shifted rows below the insertion point and soft-delete does not compact)
