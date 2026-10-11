# n14 qualification step 2 — instrumented flag-on 500-viewer sessions on the final candidate

Candidate: dev `0bfc67b` (PR #580: harness validity, observer, fault switch; R2 + ticket-less skip + Prisma 7.10 + warming track), deployment `3lpq1flux` (`dpl_91VLPeZ2zF7NCUkuHhZ1HfEcp67P`, Ready 17:14:58Z) with `LIVE_WARM_ENTRIES=1`, served by the dev alias. Supabase **Small**. Jitter 500 ms. Event 111 (23 rows). Harness: `tests/load/browsers/run.mjs --pages=30 --subs=470 --edits=12 --pause=25 --edit-mode=mixed` (pair saves on odd edits, standalone saves on even edits, anchor row created before the population joins). Codex's step-2 requirements: two independent sessions separated in time, a standalone save alongside pairs, an independent observer, aggregate / per-save / pages / SDK reported without excluding spikes, original-attempt latency, zero-5xx, invalid measurement distinguished from a valid failure.

## Session A (17:27:00–17:32:10Z) — VALID + PASS, no observer

**Measurement validity** (new in PR #580): window 17:27:02.655 → 17:32:04.326Z; event-loop lag p50 / p95 / p99 / max — main 8 / 15 / 614 / 614 ms, workers 8 / 14–15 / 62–75 / 62–75 ms; samples > 1 s: 0; heartbeat max gap 1,096–1,109 ms (1 s beats); deadline timers fired: 0. **Verdict: valid.** Host: 12 cores, host CPU p50 / max 30 / 77 % in the edits phase (Chromium included), process CPU 2 / 37 %, RSS max 865 MB. Host guard ran in warn mode (the only other process was the 1 s `supavisor-backends.mjs` side-car, which is not yet on the guard's allowlist — harness follow-up); the `--strict-host` refusal at 17:23:44Z and the stray local observer it caught are recorded in `browsers-step2-A-refused.out.log`. **No independent observer ran for Session A** (the "remote" observer host turned out to be this laptop and was stopped before the run; see step 1's smoke).

**Gates**

| Scope | n | p50 | p95 | max | missing | verdict |
|---|---|---|---|---|---|---|
| all pairs | 6,000 | 1,354 | **1,671** | 2,386 | 0 | PASS |
| edit × page | 360 | 1,200 | 1,666 | 1,800 | 0 | PASS |
| edit × SDK | 5,640 | 1,364 | 1,672 | 2,386 | 0 | PASS |
| monotonic DOM / applied rev | 360 versions / 17,546 applies | — | — | — | 0 regressions | PASS |
| warm hits ÷ hinted fetches | SDK 9,864/9,867 (100.0 %), pages 632/632 | | | | | informational |
| retried saves | 0 | | | | | n/a |

Server side (history logs 17:26:30–17:33:40Z, 19,544 entries): **0 × 5xx, 0 EMAXCONN, 0 build-failed**, warm hit rate 10,498/10,499, warm jobs 12 × 94–258 ms, lookup p50 7–11 ms; pool Σ peak **61**; builds per save: pair-insert / standalone-burst windows **5–10 builds on 3–7 instances** (revs 993, 996, 999, 1002, 1005 …), PUT-save 25 s intervals 155–255 (periodic-poll generic regenerations). Backend sampler: busy max 1–4 during every save (one 16-busy sample with 4 lock waits at 17:27:04Z = the anchor-row creation during the population join, before edit 1). `warm-join`: SDK first hinted fetches 5,387, 98 % sent after warm-complete, hit rate after 100 % / before 99 %; pages 347, 99 % / 100 %.

**Per save (SDK p50 / p95 / max ms; pages p50 / p95; broadcast → SDK p50; first hinted send − commit p50)**

| # | mode | rev | SDK | pages | bcast → SDK | send − commit |
|---|---|---|---|---|---|---|
| 1 | pair | 994 | 1,496 / 1,733 / 2,162 | 1,434 / 1,694 | 626 | 837 |
| 2 | standalone | 995 | 1,189 / 1,531 / 1,964 | 969 / 1,319 | 498 | 293 |
| 3 | pair | 997 | 1,364 / 1,586 / 2,163 | 1,254 / 1,605 | 568 | 664 |
| 4 | standalone | 998 | 1,285 / 1,544 / 1,641 | 978 / 1,221 | 524 | 312 |
| 5 | pair | 1000 | 1,456 / 1,721 / 2,031 | 1,381 / 1,701 | 565 | 793 |
| 6 | standalone | 1001 | 1,193 / 1,542 / 1,719 | 993 / 1,226 | 531 | 305 |
| 7 | pair | 1003 | 1,377 / 1,587 / 2,026 | 1,364 / 1,597 | 682 | 578 |
| 8 | standalone | 1004 | 1,256 / 1,586 / 1,667 | 1,044 / 1,205 | 539 | 304 |
| 9 | pair | 1006 | 1,486 / 1,717 / 1,863 | 1,508 / 1,773 | 574 | 781 |
| 10 | standalone | 1007 | 1,478 / 1,686 / 1,765 | 1,053 / 1,246 | 538 | 305 |
| 11 | pair | 1009 | 1,381 / 1,639 / 2,304 | 1,478 / 1,625 | 485 | 743 |
| 12 | standalone | 1010 | 1,287 / 1,596 / 2,386 | 938 / 1,199 | 510 | 316 |

No save over 2.5 s p95; no broadcast-delivery spike (broadcast → SDK p50 485–682 ms from PUT start on every save, i.e. ≈ 50 ms after the PUT returned). **Standalone vs pair**: the client's first hinted send comes ~300 ms after commit for a standalone save versus ~580–840 ms for the PUT of a pair (the pair's second fetch waits behind the insert fetch's 1 s cooldown); pages see a standalone save at p50 0.94–1.05 s and a pair's at 1.25–1.51 s. The real show is closer to standalone saves (one operator action per save).

## Session B (17:56:40–18:01:54Z, 24 min after A ended) — VALID + PASS, with the GitHub Actions observer

Same harness line, label `step2-B`, on deployment `j04gt1baj` (dev alias after PR #582, `LIVE_WARM_ENTRIES=1`, same application code as A plus the observer workflow's Node 24 pin — no `src/` change). Independent observer: `.github/workflows/n14-observer.yml` run 38161366834 on a GitHub-hosted runner (`runnervmmprz5`, linux x64, node 24.21), 5 SDK clients (ja/ko/en/ja/ko) + one plain 5 s poller, window 17:51:57 → 18:06:58Z, subscribed 4 min 40 s before the session started.

**Measurement validity**: window 17:56:45.614 → 18:01:46.743Z; event-loop lag p50 / p95 / p99 / max — main 4 / 16 / 574 / 574 ms, workers 4 / 15–19 / 35–166 / 35–166 ms; samples > 1 s: 0; heartbeat max gap 1,095–1,125 ms; deadline timers fired: 0. **Verdict: valid.** Host CPU p50 / max — join 43 / 76 %, edits 18 / 67 %; process CPU 1 / 26 %; RSS max 850 MB. Host guard again in warn mode (backend sampler not allowlisted). Unlike Session A the laptop was not otherwise empty: another Claude session's Codex runtime processes and two Next dev servers of a different project were resident (not started by this run, not touched); they were idle enough that the validity gates passed with margin, which is exactly what the step-1 verdict exists to establish. Observer host: event-loop lag p50 / p95 / max 0 / 1 / 2 ms over 8,981 samples, SDK worker event-loop utilisation 0.002.

**Gates**

| Scope | n | p50 | p95 | max | missing | verdict |
|---|---|---|---|---|---|---|
| all pairs | 6,000 | 1,340 | **1,673** | 2,935 | 0 | PASS |
| edit × page | 360 | 1,179 | 1,602 | 2,192 | 0 | PASS |
| edit × SDK | 5,640 | 1,346 | 1,676 | 2,935 | 0 | PASS |
| monotonic DOM / applied rev | 360 versions / 17,425 applies | — | — | — | 0 regressions | PASS |
| warm hits ÷ hinted fetches | SDK 9,718/9,722 (100.0 %), pages 622/622 | | | | | informational |
| retried saves | 0 | | | | | n/a |

Server side (history logs 17:56:00–18:03:20Z, 19,706 entries): **0 error-level entries, 0 EMAXCONN, 0 build-failed, 0 repair reads**; coalesced 94 (waiters max 6); warm hit rate 10,456/10,459 (2 misses + 1 "other" on rev 1030, the one save whose PUT took 897 ms); warm jobs 27 × 77–300 ms; lookup p50 7–13 ms, hit p95 19 ms; hint outcomes: notification fetches 9,722 all `satisfied`, rechecks 0, exhausted 0. Pool Σ peak **70** at 17:56:50 (population join: rev 1019 built 486× on 43 instances as 500 clients arrived; A's join peak was 61); Σ peak during the edits **41**. Builds per save: insert revs 7–15 builds on 3–8 instances; each PUT / standalone rev then accrues 163–227 generic regenerations over its 25 s lifetime (2 s TTL × ~40 instances), as in A. Backend sampler: per-save busy max 1–7 (p50 3) over [start − 1 s, +6 s), lock waits 0; the only busy ≥ 15 samples (15 and 16, two seconds at 17:56:50–52) are the population join's SSR + initial builds, 17 s before edit 1; pooler-clients probe failures 0, `pg_stat` backends peak 31. `warm-join`: SDK first hinted fetches 5,377, 97 % after warm-complete, hit rate after 100 % / before 99 %; pages 348, 98 % / 100 %.

**Per save (SDK p50 / p95 / max ms; pages p50 / p95; broadcast → SDK p50; first hinted send − commit p50)**

| # | mode | rev | PUT ms | SDK | pages | bcast → SDK | send − commit |
|---|---|---|---|---|---|---|---|
| 1 | pair | 1021 | 533 | 1,491 / 1,769 / 2,237 | 1,542 / 1,850 | 642 | 739 |
| 2 | standalone | 1022 | 438 | 1,376 / 1,648 / 2,286 | 914 / 1,164 | 491 | 302 |
| 3 | pair | 1024 | 479 | 1,342 / 1,579 / 1,887 | 1,387 / 1,602 | 540 | 688 |
| 4 | standalone | 1025 | 439 | 1,160 / 1,513 / 1,627 | 952 / 1,178 | 492 | 295 |
| 5 | pair | 1027 | 476 | 1,459 / 1,715 / 1,943 | 1,520 / 1,698 | 565 | 811 |
| 6 | standalone | 1028 | 565 | 1,283 / 1,637 / 1,709 | 1,017 / 1,295 | 595 | 271 |
| 7 | pair | 1030 | **897** | 1,469 / 1,663 / 1,920 | 1,428 / 1,631 | **956** | 389 |
| 8 | standalone | 1031 | 404 | 1,150 / 1,428 / 1,551 | 948 / 1,103 | 456 | 320 |
| 9 | pair | 1033 | 514 | 1,335 / 1,562 / 1,670 | 1,390 / 1,600 | 560 | 653 |
| 10 | standalone | 1034 | 468 | 1,133 / 1,433 / 1,566 | 1,019 / 1,201 | 523 | 317 |
| 11 | pair | 1036 | 509 | 1,336 / 1,578 / 1,697 | 1,344 / 1,592 | 568 | 656 |
| 12 | standalone | 1037 | 473 | 1,554 / **2,448** / **2,935** | 977 / 1,179 | 516 | 310 |

Two things worth naming rather than averaging away:

- **Save 7 (rev 1030)**: the PUT itself took 897 ms (others 404–565), so the broadcast reached the SDK at 956 ms instead of ~500; the clients' first hinted send came 389 ms after commit and the save still landed at p50 1,469 / p95 1,663. The 2 warm misses of the run are on this rev (the warm job finished 249 ms after commit; two hinted fetches arrived before it and fell through to the reader build). It is the clearest illustration that save → visible is bounded from below by PUT duration + ~50 ms broadcast + client cooldown/jitter.
- **Save 12 (rev 1037) SDK tail, unexplained**: 42 of 470 clients took 2,448–2,744 ms (max 2,935). For all 42 the broadcast arrived normally (512–521 ms after PUT start) and the hinted fetch was sent on time (836–993 ms), but the fetch itself took ~1.8 s before returning 200 / `satisfied` / `warm`. Server-side warm lookups for rev 1037 were ≤ 82 ms; the load host's worker lag in that window was ≤ 166 ms and no deadline timer fired, so it is not a host stall; the 42 clients span all four workers. 39 of that second's hinted fetches landed on one instance (`65314d36`), the largest share in the run, which is the only server-side oddity visible without per-request durations (the runtime log lines carry none). Session A's widest SDK tail was also on its save 12 (max 2,386 ms). Both are under the 3 s gate and are reported, not excluded; the cold-admission step (step 5) should check whether a single instance absorbing ~40 concurrent hinted fetches is the mechanism.

**Observer (independent host) — per rev**: every one of the 26 revs 1019–1044 (anchor, 18 edit revs, 7 clean-up soft-deletes) and the restore rev 1045 reached **5/5** observer clients; first-arrival spread across the 5 clients ≤ 19 ms (typically 1–3 ms); hinted fetch from the Azure runner p50 153–201 ms, p95 ≤ 396 ms, every one a warm hit; applied − first arrival 166–1,125 ms (client cooldown/jitter + fetch); **revs applied without a broadcast: none** (only the starting rev 1018 from the join's own fetch); the plain poller saw every rev. Absolute cross-host latency is not comparable: the observer's first arrival sits 72–164 ms after the harness's PUT *start* on the laptop clock, while the laptop's own clients saw the same broadcasts 456–956 ms after PUT start, so the two clocks differ by roughly 0.4 s in an unknown direction and no NTP offset was captured. What the observer establishes independently of the load host: zero missed or late broadcasts over the whole session including the clean-up burst (7 saves in 1.3 s, revs 1038–1044, all 5/5 with spread ≤ 19 ms), no Realtime delivery spike, and a save → applied path of ≤ 1.3 s from an idle host.

## Standalone vs pair, both sessions

| | pages p50 (A / B) | pages p95 (A / B) | SDK p50 (A / B) | SDK p95 (A / B) | first hinted send − commit p50 (A / B) |
|---|---|---|---|---|---|
| standalone saves (6 each) | 938–1,053 / 914–1,019 | 1,199–1,319 / 1,103–1,295 | 1,189–1,478 / 1,133–1,554 | 1,531–1,686 / 1,428–2,448 | 293–316 / 271–320 |
| pair PUTs (6 each) | 1,254–1,508 / 1,344–1,542 | 1,597–1,773 / 1,592–1,850 | 1,364–1,496 / 1,335–1,491 | 1,586–1,733 / 1,562–1,769 | 578–837 / 389–811 |

A standalone save (the real-show shape) is seen by pages at ~1.0 s p50 and by SDK clients at ~1.2–1.4 s; a pair's PUT costs ~0.4 s more because the second notification fetch waits behind the insert fetch's 1 s cooldown.

## Verdict

- **Session A: VALID + PASS** — p95 1,671 ms, 0 missing, 0 × 5xx, 0 EMAXCONN. No independent observer (the "remote" host turned out to be the load laptop and was stopped).
- **Session B: VALID + PASS** — p95 1,673 ms, 0 missing, 0 × 5xx, 0 EMAXCONN; independent GitHub-hosted observer saw 27/27 revs at 5/5 clients with no delivery spike.
- Step 2 of the qualification order is complete on candidate `0bfc67b` + `LIVE_WARM_ENTRIES=1` on Supabase Small. Carried forward: the save-12 SDK tail (unexplained, under gate) and the single-instance concentration hypothesis for step 5; the host guard allowlist for `supavisor-backends.mjs`; capturing a cross-host clock offset (an NTP query at observer start) if cross-host absolute latency is ever needed.

Files: `browsers-step2-{A,B}.out.log` (harness reports), `browsers-step2-A-refused.*` (the `--strict-host` refusal), `vercel-logs-history-summary-step2-{A,B}.md`, `warm-join-step2-{A,B}.md`, `backends-step2-{A,B}.md`, `observer-step2-B.md` (artifact of run 38161366834), `pooler-clients-step2-{A,B}.out`, `2026-10-11T17-{22-14-839,47-31-238}Z-supavisor-backends.csv`. Raw history logs (4.6 MB each), `*-browsers.json`, `*-timelines.jsonl` and the observer `.jsonl` are kept locally only.
