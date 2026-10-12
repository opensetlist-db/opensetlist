# Browsers run — 2026-10-11T09:14:22.209Z

- Target: https://opensetlist-git-dev-opensetlist-projects.vercel.app/events/111/rehearsal-lovelive-fes-2020-day1 (event 111, start rev 894, 23 active rows; insert after row 2 = position 2)
- Population: 30 Chromium pages (ja/ko/en 70/20/10), 470 SDK subscribers in 4 worker thread(s)
- Edits: 3 × (insert-after + PUT marker song), every 25 s; timeout 30 s; drill: verify-ambiguity (edit 2, pages 30)
- Window (UTC): run start 2026-10-11T09:14:22.209Z, first edit 2026-10-11T09:14:46.251Z, last edit settled 2026-10-11T09:15:39.949Z, end 2026-10-11T09:15:45.208Z
- Label: warm-on-verify-ambiguity

## Gate verdicts

Latency = PUT (the save that makes the marker exist) request start of its FIRST attempt → marker link in the page DOM / SDK client applied a snapshot with rev ≥ the PUT's rev. Missing = not seen within the timeout. Monotonic: no page/client ever went back to an older version.

| Scope | n | p50 ms | p95 ms | max ms | missing | gate | verdict |
|---|---|---|---|---|---|---|---|
| all pairs (pages + SDK) | 1500 | 1370 | 1983 | 2739 | 0 | p95 ≤ 3000, 0 missing | **PASS** |
| edit × page | 90 | 1404 | 1648 | 1766 | 0 | same | **PASS** |
| edit × SDK client | 1410 | 1368 | 1987 | 2739 | 0 | same | **PASS** |
| drill verify-ambiguity (rev 898) | 457 notification fetches | — | — | — | memo 0 → recheck ok 0, not ok 0, none 0 | every SDK client answered `memo` for the drilled save resolves it on its one recheck (n/a when no memo was observed) | n/a |
| monotonic DOM (pages: version shown never decreases) | 30 pages, 90 versions | — | — | — | 0 regressions on 0 page(s) | 0 | **PASS** |
| monotonic applied rev (SDK) | 470 clients, 5968 applies | — | — | — | 0 regressions on 0 client(s) | 0 | **PASS** |
| warming: warm hits ÷ hinted fetches (`x-snapshot-source: warm`) | SDK 3618/3618 (100.0 %), pages 233/233 (100.0 %) | — | — | — | — | informational; reader builds per save: `vercel-logs-summary.mjs` "Warming" on the history logs; arrival vs warm-complete: `warm-join.mjs` | n/a |
| edits with a retried save (clock from the 1st attempt) | 0 | — | — | — | 0 | informational — 0 edit(s); from the successful attempt p50/p95/max —/—/— | n/a |

Insert-start based (insert-after request start → marker), non-drilled: pages 90 | 2410 | 4240 | 4333 · SDK 1410 | 2632 | 4259 | 4723 (n | p50 | p95 | max).

## Notification paths (PUT start → arrival)

An R1 page build (what the preview runs until R2 deploys, or after a rollback) is notified by postgres_changes and ignores the broadcast; an R2 build only has the broadcast. The SDK clients are always R2.

| Path | delivered / expected | p50 ms | p95 ms | max ms |
|---|---|---|---|---|
| postgres_changes UPDATE → pages (R1 build) | 0 / 90 | — | — | — |
| broadcast `rev` → pages | 90 / 90 | 645 | 716 | 724 |
| broadcast `rev` → SDK | 1410 / 1410 | 625 | 787 | 856 |

## Per edit

| # | row | marker song | insert start (UTC) | ins ms | rev | PUT start (UTC) | PUT ms | rev |
|---|---|---|---|---|---|---|---|---|
| 1 | 2056 | 401 チャーミングな花束を！ | 2026-10-11T09:14:46.251Z | 627 | 895 | 2026-10-11T09:14:47.009Z | 490 | 896 |
| 2 | 2057 | 402 Runway | 2026-10-11T09:15:11.252Z | 644 | 897 | 2026-10-11T09:15:14.331Z | 461 | 898 |
| 3 | 2058 | 403 Echoes Beyond | 2026-10-11T09:15:36.266Z | 797 | 899 | 2026-10-11T09:15:37.185Z | 603 | 900 |

### Per save — pages (PUT start → marker in the DOM)

| # | PUT rev | seen | p50 / p95 / max ms | missing | bcast → page p50 / p95 (n) | pg → page (n) | notification fetches (hint=1) | their x-snapshot-verify | warm / hinted | 1st hinted request start − commit p50 / p95 |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 896 | 30/30 | 1472 / 1684 / 1766 | 0 | 661 / 720 (30) | 0 | 29 | satisfied 29 | 29/29 | 759 / 931 |
| 2 | 898 | 30/30 | 1026 / 1226 / 1254 | 0 | 539 / 542 (30) | 0 | 30 | satisfied 30 | 30/30 | 345 / 565 |
| 3 | 900 | 30/30 | 1461 / 1648 / 1655 | 0 | 645 / 657 (30) | 0 | 27 | satisfied 27 | 27/27 | 568 / 819 |

### Per save — SDK clients (PUT start → applied rev ≥ PUT rev)

| # | PUT rev | reached | p50 / p95 / max ms | missing | bcast → SDK p50 / p95 (n) | notification fetches | their x-snapshot-verify | ticket resolutions | rechecks (resolved) | exhausted | warm / hinted | 1st hinted send − commit p50 / p95 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 896 | 470/470 | 1480 / 1813 / 1948 | 0 | 735 / 805 (470) | 422 | satisfied 422 | satisfied 459 | 0 (0) | 0 | 422/422 | 707 / 1144 |
| 2 | 898 | 470/470 | 997 / 1218 / 1644 | 0 | 533 / 543 (470) | 457 | satisfied 457 | satisfied 465 | 0 (0) | 0 | 457/457 | 309 / 562 |
| 3 | 900 | 470/470 | 1706 / 2291 / 2739 | 0 | 642 / 714 (470) | 449 | satisfied 449 | satisfied 467 | 0 (0) | 0 | 449/449 | 659 / 1512 |

## Hint outcomes (whole run)

- SDK: 6053 requests; notification fetches (hint=1) 3618, their x-snapshot-verify: satisfied 3618; all 200 responses: none 470, satisfied 5577
  - ticket resolutions: satisfied 3713; rechecks 0 (0.0 % of notification fetches), resolved on the recheck 0; hints exhausted 0; highest serverRev held 903
  - request shapes (reason / generic / ticket): initial generic 470, catchup generic 470, periodic generic 1400, notification +hint=1 3618, periodic generic +H 95; failures by kind: —
  - notification fetches by x-snapshot-source: warm 3618 (warm 3618/3618 (100.0 %))
- Pages: 386 /api/setlist responses; notification fetches (hint=1) 233, their x-snapshot-verify: satisfied 233; all 200 responses: satisfied 386 (an R1 page build sends no hint=1)
  - notification fetches by x-snapshot-source: warm 233 (warm 233/233 (100.0 %))

## Population

- Pages: 30/30 loaded; channel joined 30; visibility {"visible":30}; locales {"ja":21,"ko":6,"en":3}
  - open → join ms: n=30 p50=2149 p95=2346 max=2603
  - /api/setlist responses seen: 386 ({"build":25,"cache":128,"warm":233}); page errors: 0; ws opens 30, closes 0; rev broadcasts seen 270; dropped notification frames 0, blocked attempts 0
- SDK: 470/470 joined; all joined after 11.693 s (from population start)
  - subscribe → SUBSCRIBED ms: n=470 p50=395 p95=714 max=1393
  - statuses {"SUBSCRIBED":470,"CLOSED":470}; disconnected episodes (polling while realtime-js rejoins) 0; channel re-creations 0; fetch failures 0 (with Retry-After 0); fetches by reason {"initial":470,"catchup":470,"periodic":1495,"notification":3618}; X-Snapshot-Source {"build":450,"cache":1979,"warm":3618}

## Verify-ambiguity drill

- drilled save rev 898: SDK notification fetches 457, x-snapshot-verify satisfied 457; memo share 0.0 % (0 client(s))
- after a memo answer: recheck resolved 0, recheck NOT resolved 0, no recheck 0; pages' notification fetches for that rev: satisfied 30
- memo only appears when a hinted fetch lands on a primed instance within 1 s AND its snapshot read still returned the pre-save revision (a coalesced read that began before the commit, or a cache entry the purge had not reached yet); Vercel decides the routing, so 0 memo is a valid outcome (verdict n/a), not a pass.

## Drill events

- edit 2 2026-10-11T09:15:14.110Z: memo priming: 60 request(s) minRev=1897 sent 150 ms before the PUT; responses {"200 fresh":33,"200 memo":27}, ms 236/414/414/427/453/389/447/377/447/397/447/427/453/451/453/511/471/475/475/449/453/542/569/568/433/574/551/551/562/561/594/568/593/453/551/551/569/554/533/562/642/449/477/676/551/476/554/491/551/472/451/550/472/508/453/551/504/477/472/527

## Clean-up

- Soft-deleted 3/3 created rows; position restore: null
- Verify: {"dbActive":23,"snapshotItems":23,"snapshotRev":903,"startRows":23,"goneMeanwhile":0,"sameOrder":true,"samePositions":false,"oursStillActive":[]} (samePositions is expected to be false without --restore-positions: insert-after shifted rows below the insertion point and soft-delete does not compact)
