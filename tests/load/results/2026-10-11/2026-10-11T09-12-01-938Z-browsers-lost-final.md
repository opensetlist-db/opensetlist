# Browsers run — 2026-10-11T09:09:31.597Z

- Target: https://opensetlist-git-dev-opensetlist-projects.vercel.app/events/111/rehearsal-lovelive-fes-2020-day1 (event 111, start rev 874, 23 active rows; insert after row 2 = position 2)
- Population: 30 Chromium pages (ja/ko/en 70/20/10), 470 SDK subscribers in 4 worker thread(s)
- Edits: 3 × (insert-after + PUT marker song), every 25 s; timeout 30 s; drill: lost-final (edit 3, pages 30)
- Window (UTC): run start 2026-10-11T09:09:31.597Z, first edit 2026-10-11T09:10:20.003Z, last edit settled 2026-10-11T09:11:41.904Z, end 2026-10-11T09:12:01.736Z
- Label: warm-on-lost-final

## Gate verdicts

Latency = PUT (the save that makes the marker exist) request start of its FIRST attempt → marker link in the page DOM / SDK client applied a snapshot with rev ≥ the PUT's rev. Missing = not seen within the timeout. Monotonic: no page/client ever went back to an older version.

| Scope | n | p50 ms | p95 ms | max ms | missing | gate | verdict |
|---|---|---|---|---|---|---|---|
| all pairs (pages + SDK) | 1000 | 6614 | 14438 | 15740 | 0 | p95 ≤ 3000, 0 missing | **FAIL** |
| edit × page | 60 | 3035 | 4615 | 4902 | 0 | same | **FAIL** |
| edit × SDK client | 940 | 8223 | 14452 | 15740 | 0 | same | **FAIL** |
| drill lost-final (drilled pairs) | 500 | 14928 | 20578 | 23044 | 0 | max ≤ 26000 ms, 0 missing | **PASS** |
| monotonic DOM (pages: version shown never decreases) | 30 pages, 90 versions | — | — | — | 0 regressions on 0 page(s) | 0 | **PASS** |
| monotonic applied rev (SDK) | 470 clients, 5467 applies | — | — | — | 0 regressions on 0 client(s) | 0 | **PASS** |
| warming: warm hits ÷ hinted fetches (`x-snapshot-source: warm`) | SDK 2322/2486 (93.4 %), pages 205/205 (100.0 %) | — | — | — | — | informational; reader builds per save: `vercel-logs-summary.mjs` "Warming" on the history logs; arrival vs warm-complete: `warm-join.mjs` | n/a |
| edits with a retried save (clock from the 1st attempt) | 0 | — | — | — | 0 | informational — 0 edit(s); from the successful attempt p50/p95/max —/—/— | n/a |

Insert-start based (insert-after request start → marker), non-drilled: pages 60 | 3706 | 5236 | 5523 · SDK 940 | 8894 | 15123 | 16411 (n | p50 | p95 | max).

## Notification paths (PUT start → arrival)

An R1 page build (what the preview runs until R2 deploys, or after a rollback) is notified by postgres_changes and ignores the broadcast; an R2 build only has the broadcast. The SDK clients are always R2.

| Path | delivered / expected | p50 ms | p95 ms | max ms |
|---|---|---|---|---|
| postgres_changes UPDATE → pages (R1 build) | 0 / 90 | — | — | — |
| broadcast `rev` → pages | 60 / 90 | 575 | 1790 | 2425 |
| broadcast `rev` → SDK | 940 / 1410 | 2362 | 5264 | 7324 |

## Per edit

| # | row | marker song | insert start (UTC) | ins ms | rev | PUT start (UTC) | PUT ms | rev |
|---|---|---|---|---|---|---|---|---|
| 1 | 2050 | 392 ちょ、尊いLOVE | 2026-10-11T09:10:20.003Z | 600 | 875 | 2026-10-11T09:10:20.624Z | 414 | 876 |
| 2 | 2051 | 395 IcHiGo milK love | 2026-10-11T09:10:45.011Z | 523 | 877 | 2026-10-11T09:10:45.682Z | 389 | 878 |
| 3 (drill: 500) | 2052 | 396 乙女詞華集 | 2026-10-11T09:11:10.089Z | 667 | 879 | 2026-10-11T09:11:18.486Z | 582 | 880 |

### Per save — pages (PUT start → marker in the DOM)

| # | PUT rev | seen | p50 / p95 / max ms | missing | bcast → page p50 / p95 (n) | pg → page (n) | notification fetches (hint=1) | their x-snapshot-verify | warm / hinted | 1st hinted request start − commit p50 / p95 |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 876 | 30/30 | 4181 / 4675 / 4902 | 0 | 483 / 485 (30) | 0 | 27 | satisfied 27 | 27/27 | 3308 / 3898 |
| 2 | 878 | 30/30 | 2952 / 3580 / 3603 | 0 | 1308 / 2424 (30) | 0 | 23 | satisfied 23 | 23/23 | 2204 / 2819 |
| 3 (drill: 500) | 880 | 30/30 | 9914 / 20293 / 21752 | 0 | — / — (0) | 0 | 0 | — | 0/0 | — / — |

### Per save — SDK clients (PUT start → applied rev ≥ PUT rev)

| # | PUT rev | reached | p50 / p95 / max ms | missing | bcast → SDK p50 / p95 (n) | notification fetches | their x-snapshot-verify | ticket resolutions | rechecks (resolved) | exhausted | warm / hinted | 1st hinted send − commit p50 / p95 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 876 | 470/470 | 8712 / 11290 / 12044 | 0 | 4647 / 5279 (470) | 343 | satisfied 343 | satisfied 467 | 0 (0) | 0 | 343/343 | 4138 / 9087 |
| 2 | 878 | 470/470 | 7759 / 14870 / 15740 | 0 | 2362 / 4056 (470) | 366 | satisfied 366 | satisfied 468 | 0 (0) | 0 | 366/366 | 3452 / 9543 |
| 3 (drill: 500) | 880 | 470/470 | 14945 / 20675 / 23044 | 0 | — / — (0) | 0 | — | — | 0 (0) | 0 | 0/0 | — / — |

## Hint outcomes (whole run)

- SDK: 6274 requests; notification fetches (hint=1) 2486, their x-snapshot-verify: satisfied 1892; all 200 responses: none 470, satisfied 5031
  - ticket resolutions: satisfied 2391; rechecks 0 (0.0 % of notification fetches), resolved on the recheck 0; hints exhausted 0; highest serverRev held 883
  - request shapes (reason / generic / ticket): initial generic 470, catchup generic 470, periodic generic 2202, notification +hint=1 2339, retry generic +H 407, periodic generic +H 239, retry +hint=1 147; failures by kind: deadline 607
  - notification fetches by x-snapshot-source: warm 2322, no 200 164 (warm 2322/2486 (93.4 %))
- Pages: 437 /api/setlist responses; notification fetches (hint=1) 205, their x-snapshot-verify: satisfied 205; all 200 responses: satisfied 437 (an R1 page build sends no hint=1)
  - notification fetches by x-snapshot-source: warm 205 (warm 205/205 (100.0 %))

## Population

- Pages: 30/30 loaded; channel joined 30; visibility {"visible":30}; locales {"ja":21,"ko":6,"en":3}
  - open → join ms: n=30 p50=6344 p95=7431 max=7431
  - /api/setlist responses seen: 437 ({"cache":218,"warm":205,"build":14}); page errors: 0; ws opens 30, closes 0; rev broadcasts seen 270; dropped notification frames 30, blocked attempts 0
- SDK: 470/470 joined; all joined after 36.472 s (from population start)
  - subscribe → SUBSCRIBED ms: n=470 p50=711 p95=3110 max=3971
  - statuses {"SUBSCRIBED":470,"CLOSED":470}; disconnected episodes (polling while realtime-js rejoins) 0; channel re-creations 0; fetch failures 607 (with Retry-After 0); fetches by reason {"initial":470,"catchup":470,"periodic":2441,"notification":2339,"retry":554}; X-Snapshot-Source {"build":205,"cache":3535,"warm":2322}

## Drill events

- edit 3 2026-10-11T09:11:17.238Z: proxy drops notification frames on pages 0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29 + all SDK clients (insert notification delivered first)
- edit 3 2026-10-11T09:11:41.785Z: stop dropping (drilled clients repaired or timeout)

SDK clients: fetch reason that delivered the dropped save {"retry":227,"periodic":243}; dropped notifications recorded 470.

| drilled page | edit | locale | PUT → marker ms | dropped notification frames (proxy) | repairing fetch: ms after PUT, minRev, source |
|---|---|---|---|---|---|
| 0 | 3 | ja | 5217 | 1 | 5206, 879, cache |
| 1 | 3 | ko | 1830 | 1 | 1823, 879, build |
| 2 | 3 | ja | 21752 | 1 | 21744, 879, cache |
| 3 | 3 | en | 9462 | 1 | 9448, 879, cache |
| 4 | 3 | ja | 19419 | 1 | 19398, 879, cache |
| 5 | 3 | ja | 2870 | 1 | 2861, 879, cache |
| 6 | 3 | ko | 9121 | 1 | 9046, 879, cache |
| 7 | 3 | ja | 10159 | 1 | 10151, 879, cache |
| 8 | 3 | ja | 1348 | 1 | 1337, 879, build |
| 9 | 3 | ja | 3754 | 1 | 3739, 879, cache |
| 10 | 3 | ja | 11336 | 1 | 11297, 879, cache |
| 11 | 3 | ko | 20293 | 1 | 20298, 879, cache |
| 12 | 3 | ja | 9914 | 1 | 9915, 879, cache |
| 13 | 3 | en | 5894 | 1 | 5883, 879, cache |
| 14 | 3 | ja | 11162 | 1 | 11135, 879, cache |
| 15 | 3 | ja | 16095 | 1 | 16091, 879, cache |
| 16 | 3 | ko | 796 | 1 | 786, 879, build |
| 17 | 3 | ja | 13715 | 1 | 13716, 879, cache |
| 18 | 3 | ja | 13709 | 1 | 13702, 879, cache |
| 19 | 3 | ja | 17550 | 1 | 17536, 879, cache |
| 20 | 3 | ja | 13472 | 1 | 13459, 879, cache |
| 21 | 3 | ko | 2549 | 1 | 2534, 879, cache |
| 22 | 3 | ja | 12732 | 1 | 12723, 879, cache |
| 23 | 3 | en | 16643 | 1 | 16615, 879, cache |
| 24 | 3 | ja | 3715 | 1 | 3720, 879, cache |
| 25 | 3 | ja | 10854 | 1 | 10741, 879, cache |
| 26 | 3 | ko | 8060 | 1 | 8045, 879, cache |
| 27 | 3 | ja | 17354 | 1 | 17366, 879, cache |
| 28 | 3 | ja | 8769 | 1 | 8763, 879, cache |
| 29 | 3 | ja | 1338 | 1 | 1322, 879, build |

## Clean-up

- Soft-deleted 3/3 created rows; position restore: null
- Verify: {"dbActive":23,"snapshotItems":23,"snapshotRev":883,"startRows":23,"goneMeanwhile":0,"sameOrder":true,"samePositions":false,"oursStillActive":[]} (samePositions is expected to be false without --restore-positions: insert-after shifted rows below the insertion point and soft-delete does not compact)
