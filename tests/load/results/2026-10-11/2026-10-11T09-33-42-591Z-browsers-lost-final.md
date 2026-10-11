# Browsers run — 2026-10-11T09:31:56.967Z

- Target: https://opensetlist-git-dev-opensetlist-projects.vercel.app/events/111/rehearsal-lovelive-fes-2020-day1 (event 111, start rev 914, 23 active rows; insert after row 2 = position 2)
- Population: 30 Chromium pages (ja/ko/en 70/20/10), 470 SDK subscribers in 4 worker thread(s)
- Edits: 3 × (insert-after + PUT marker song), every 25 s; timeout 30 s; drill: lost-final (edit 3, pages 30)
- Window (UTC): run start 2026-10-11T09:31:56.967Z, first edit 2026-10-11T09:32:21.022Z, last edit settled 2026-10-11T09:33:37.893Z, end 2026-10-11T09:33:42.586Z
- Label: warm-on-lost-final-2

## Gate verdicts

Latency = PUT (the save that makes the marker exist) request start of its FIRST attempt → marker link in the page DOM / SDK client applied a snapshot with rev ≥ the PUT's rev. Missing = not seen within the timeout. Monotonic: no page/client ever went back to an older version.

| Scope | n | p50 ms | p95 ms | max ms | missing | gate | verdict |
|---|---|---|---|---|---|---|---|
| all pairs (pages + SDK) | 1000 | 1500 | 2242 | 2352 | 0 | p95 ≤ 3000, 0 missing | **PASS** |
| edit × page | 60 | 1458 | 1629 | 1767 | 0 | same | **PASS** |
| edit × SDK client | 940 | 1508 | 2243 | 2352 | 0 | same | **PASS** |
| drill lost-final (drilled pairs) | 500 | 9394 | 18341 | 23896 | 0 | max ≤ 26000 ms, 0 missing | **PASS** |
| monotonic DOM (pages: version shown never decreases) | 30 pages, 90 versions | — | — | — | 0 regressions on 0 page(s) | 0 | **PASS** |
| monotonic applied rev (SDK) | 470 clients, 6037 applies | — | — | — | 0 regressions on 0 client(s) | 0 | **PASS** |
| warming: warm hits ÷ hinted fetches (`x-snapshot-source: warm`) | SDK 3056/3056 (100.0 %), pages 199/199 (100.0 %) | — | — | — | — | informational; reader builds per save: `vercel-logs-summary.mjs` "Warming" on the history logs; arrival vs warm-complete: `warm-join.mjs` | n/a |
| edits with a retried save (clock from the 1st attempt) | 0 | — | — | — | 0 | informational — 0 edit(s); from the successful attempt p50/p95/max —/—/— | n/a |

Insert-start based (insert-after request start → marker), non-drilled: pages 60 | 2110 | 2298 | 2407 · SDK 940 | 2168 | 2883 | 2992 (n | p50 | p95 | max).

## Notification paths (PUT start → arrival)

An R1 page build (what the preview runs until R2 deploys, or after a rollback) is notified by postgres_changes and ignores the broadcast; an R2 build only has the broadcast. The SDK clients are always R2.

| Path | delivered / expected | p50 ms | p95 ms | max ms |
|---|---|---|---|---|
| postgres_changes UPDATE → pages (R1 build) | 0 / 90 | — | — | — |
| broadcast `rev` → pages | 60 / 90 | 626 | 846 | 893 |
| broadcast `rev` → SDK | 940 / 1410 | 777 | 901 | 968 |

## Per edit

| # | row | marker song | insert start (UTC) | ins ms | rev | PUT start (UTC) | PUT ms | rev |
|---|---|---|---|---|---|---|---|---|
| 1 | 2062 | 407 Hip, hip, hooray! | 2026-10-11T09:32:21.022Z | 517 | 915 | 2026-10-11T09:32:21.662Z | 370 | 916 |
| 2 | 2063 | 408 令嬢モブ！ | 2026-10-11T09:32:46.036Z | 541 | 917 | 2026-10-11T09:32:46.705Z | 460 | 918 |
| 3 (drill: 500) | 2064 | 409 不思議と君とライブラリー | 2026-10-11T09:33:11.024Z | 604 | 919 | 2026-10-11T09:33:13.773Z | 358 | 920 |

### Per save — pages (PUT start → marker in the DOM)

| # | PUT rev | seen | p50 / p95 / max ms | missing | bcast → page p50 / p95 (n) | pg → page (n) | notification fetches (hint=1) | their x-snapshot-verify | warm / hinted | 1st hinted request start − commit p50 / p95 |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 916 | 30/30 | 1429 / 1708 / 1767 | 0 | 469 / 892 (30) | 0 | 27 | satisfied 27 | 27/27 | 850 / 1048 |
| 2 | 918 | 30/30 | 1484 / 1620 / 1629 | 0 | 650 / 773 (30) | 0 | 27 | satisfied 27 | 27/27 | 808 / 952 |
| 3 (drill: 500) | 920 | 30/30 | 11189 / 20088 / 21432 | 0 | — / — (0) | 0 | 0 | — | 0/0 | — / — |

### Per save — SDK clients (PUT start → applied rev ≥ PUT rev)

| # | PUT rev | reached | p50 / p95 / max ms | missing | bcast → SDK p50 / p95 (n) | notification fetches | their x-snapshot-verify | ticket resolutions | rechecks (resolved) | exhausted | warm / hinted | 1st hinted send − commit p50 / p95 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 916 | 470/470 | 1717 / 2268 / 2352 | 0 | 862 / 952 (470) | 389 | satisfied 389 | satisfied 453 | 0 (0) | 0 | 389/389 | 1009 / 1672 |
| 2 | 918 | 470/470 | 1396 / 1709 / 1856 | 0 | 777 / 809 (470) | 428 | satisfied 428 | satisfied 463 | 0 (0) | 0 | 428/428 | 713 / 973 |
| 3 (drill: 500) | 920 | 470/470 | 9203 / 18341 / 23896 | 0 | — / — (0) | 0 | — | — | 0 (0) | 0 | 0/0 | — / — |

## Hint outcomes (whole run)

- SDK: 6085 requests; notification fetches (hint=1) 3056, their x-snapshot-verify: satisfied 3056; all 200 responses: none 470, satisfied 5607
  - ticket resolutions: satisfied 3212; rechecks 0 (0.0 % of notification fetches), resolved on the recheck 0; hints exhausted 0; highest serverRev held 923
  - request shapes (reason / generic / ticket): initial generic 470, catchup generic 470, periodic generic 1933, notification +hint=1 3056, periodic generic +H 156; failures by kind: —
  - notification fetches by x-snapshot-source: warm 3056 (warm 3056/3056 (100.0 %))
- Pages: 389 /api/setlist responses; notification fetches (hint=1) 199, their x-snapshot-verify: satisfied 199; all 200 responses: satisfied 389 (an R1 page build sends no hint=1)
  - notification fetches by x-snapshot-source: warm 199 (warm 199/199 (100.0 %))

## Population

- Pages: 30/30 loaded; channel joined 30; visibility {"visible":30}; locales {"ja":21,"ko":6,"en":3}
  - open → join ms: n=30 p50=1854 p95=2467 max=3410
  - /api/setlist responses seen: 389 ({"build":20,"cache":170,"warm":199}); page errors: 0; ws opens 30, closes 0; rev broadcasts seen 270; dropped notification frames 30, blocked attempts 0
- SDK: 470/470 joined; all joined after 12.281 s (from population start)
  - subscribe → SUBSCRIBED ms: n=470 p50=321 p95=422 max=1413
  - statuses {"SUBSCRIBED":470,"CLOSED":470}; disconnected episodes (polling while realtime-js rejoins) 0; channel re-creations 0; fetch failures 0 (with Retry-After 0); fetches by reason {"initial":470,"catchup":470,"periodic":2089,"notification":3056}; X-Snapshot-Source {"build":496,"cache":2525,"warm":3056}

## Drill events

- edit 3 2026-10-11T09:33:13.773Z: proxy drops notification frames on pages 0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29 + all SDK clients (insert notification delivered first)
- edit 3 2026-10-11T09:33:37.892Z: stop dropping (drilled clients repaired or timeout)

SDK clients: fetch reason that delivered the dropped save {"periodic":470}; dropped notifications recorded 470.

| drilled page | edit | locale | PUT → marker ms | dropped notification frames (proxy) | repairing fetch: ms after PUT, minRev, source |
|---|---|---|---|---|---|
| 0 | 3 | ja | 10385 | 1 | 10315, 919, cache |
| 1 | 3 | ko | 7065 | 1 | 7016, 919, cache |
| 2 | 3 | ja | 2930 | 1 | 2920, 919, cache |
| 3 | 3 | en | 17071 | 1 | 17022, 919, cache |
| 4 | 3 | ja | 6752 | 1 | 6706, 919, cache |
| 5 | 3 | ja | 11189 | 1 | 11181, 919, cache |
| 6 | 3 | ko | 17643 | 1 | 17584, 919, cache |
| 7 | 3 | ja | 10531 | 1 | 10491, 919, cache |
| 8 | 3 | ja | 5888 | 1 | 5880, 919, cache |
| 9 | 3 | ja | 9321 | 1 | 9313, 919, cache |
| 10 | 3 | ja | 12112 | 1 | 12070, 919, cache |
| 11 | 3 | ko | 17876 | 1 | 17871, 919, cache |
| 12 | 3 | ja | 8444 | 1 | 8409, 919, cache |
| 13 | 3 | en | 9094 | 1 | 9040, 919, cache |
| 14 | 3 | ja | 11143 | 1 | 11135, 919, cache |
| 15 | 3 | ja | 15952 | 1 | 15945, 919, cache |
| 16 | 3 | ko | 12064 | 1 | 12063, 919, cache |
| 17 | 3 | ja | 2686 | 1 | 2676, 919, cache |
| 18 | 3 | ja | 9055 | 1 | 9042, 919, cache |
| 19 | 3 | ja | 8859 | 1 | 8853, 919, cache |
| 20 | 3 | ja | 12211 | 1 | 12137, 919, cache |
| 21 | 3 | ko | 3422 | 1 | 3413, 919, cache |
| 22 | 3 | ja | 20088 | 1 | 20040, 919, cache |
| 23 | 3 | en | 16235 | 1 | 16227, 919, cache |
| 24 | 3 | ja | 14570 | 1 | 14515, 919, cache |
| 25 | 3 | ja | 21432 | 1 | 21426, 919, cache |
| 26 | 3 | ko | 13919 | 1 | 13904, 919, cache |
| 27 | 3 | ja | 15076 | 1 | 15067, 919, cache |
| 28 | 3 | ja | 12096 | 1 | 12038, 919, cache |
| 29 | 3 | ja | 17740 | 1 | 17735, 919, cache |

## Clean-up

- Soft-deleted 3/3 created rows; position restore: null
- Verify: {"dbActive":23,"snapshotItems":23,"snapshotRev":923,"startRows":23,"goneMeanwhile":0,"sameOrder":true,"samePositions":false,"oursStillActive":[]} (samePositions is expected to be false without --restore-positions: insert-after shifted rows below the insertion point and soft-delete does not compact)
