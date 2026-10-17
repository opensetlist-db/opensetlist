# Warm-on spam drill (09:13Z, Small): why 224 SDK clients missed rev 886

Sources: `2026-10-11T09-14-17-765Z-browsers-spam.json/.md`, `…09-12-10Z-vercel-logs-history-warm-spam.txt` (parsed by entry, log clock +7 h), `…04-36-12-699Z-browsers-spam.json/.md` (Micro, flag off), and the neighbouring runs `…09-06-06…`, `…09-09-23…double-save`, `…09-12-01…lost-final`, `…09-15-45…verify-ambiguity`.
Scripts used: scratchpad `ws/parse.mjs`, `ws/a1…a6.mjs`.

**Data limitation:** the browsers JSON does **not** contain the per-client `reqs` rows (worker array `[tStart, reason, generic, hint, notify, minRev, status, verify, bodyRev, resolution, tEnd, outcome, source]`). run.mjs keeps only (i) `warm.saves[k].sdk` = each client's FIRST hint=1 fetch whose hint == the save rev (`[idx, locale, send−commit, end−commit, source, verify, minRev]`), (ii) `spam.per` = per-client counts inside the spam window, (iii) page fetch rows. Full 09:13:19–09:13:50 timelines per SDK client cannot be rebuilt; what follows uses those three sources. Clients map to workers by idx: w0 0–117, w1 118–235, w2 236–353, w3 354–469.
Clock: server log time ≈ harness time − 0.5…0.9 s (first `minRev=886` server line 09:13:21.58 vs first page send 09:13:22.43; first `minRev=887` server 09:13:24.26 vs the guest's first 887 send 09:13:24.71).

## Headline

The 224 missing clients are (almost) exactly worker threads 1 and 2 of the load generator. Those two threads were stalled; their requests mostly never reached Vercel. The server answered everything that did arrive quickly. Nothing here is specific to warming. The same host had already degraded in the previous run (lost-final, 09:10–09:12, **no spam**, 607 deadline failures). Both earlier and later runs had warming on and 0 failures.

## (1) The clients that did not reach 886

Spam-window counts per worker (`spam.per`, 09:13:20.1–09:13:42.5):

| worker | clients | requests | hard failures | clients with ≥1 failure | broadcasts received |
|---|---|---|---|---|---|
| w0 | 118 | 1,389 | **0** | 0 | 4,012 |
| w1 | 118 | 225 | **225** | 118 | 3,957 |
| w2 | 118 | 172 | **172** | 118 | **3,091** (−22 %) |
| w3 | 116 | 1,239 | **0** | 0 | 3,944 |

Every request that w1/w2 started inside the window failed: 397 of the 594 run-wide `deadline` failures. w0/w3 had none. In w1/w2 that is 236 clients, against 224 missing. The 12 that still reached 886 were late w1/w2 successes.

First hint=886 notification fetch per worker (commit proxy = PUT end 09:13:21.931):

| worker | clients with one | 200 | send (UTC) min / p50 / max | outcome |
|---|---|---|---|---|
| w0 | 42 | 42 | 22.16 / 22.84 / 24.14 | all `warm`/`satisfied`, end +1.2…3.8 s |
| w3 | 78 | 78 | 22.27 / 23.66 / 24.80 | all `warm`/`satisfied`, end +2.0…4.0 s |
| w1 | 59 | **0** | 24.30 / 25.42 / 26.79 | all deadline, end +11.5…13.2 s |
| w2 | 85 | 6 | 23.85 / 25.32 / 27.34 | 79 deadline (end +11.1…18.3 s); the 6 "ok" got `x-snapshot-source: warm` headers but **no parsed body** (verify null) |

w1/w2 clients also sent their first 886 fetch about 1.5–2.5 s later than w0/w3. That is slow broadcast processing inside the stalled threads.

Representative clients. "Requests" and "fails" are spam-window counts. The 888 and 890 columns show the first hinted fetch for that save.

| client (worker) | req / fails / bcasts | 886 | 888 | 890 |
|---|---|---|---|---|
| 0 (w0) | 12 / 0 / 34 | send 22.265 → 23.570 (1.3 s) warm, satisfied, minRev 886 | 49.873 → 50.548 warm | 11.910 → 12.176 warm |
| 355 (w3) | 10 / 0 / 34 | 24.800 → 25.892 (1.1 s) warm, satisfied | 46.805 → 48.298 warm | 12.122 → 12.330 warm |
| 118 (w1) | **2 / 2** / 34 | 26.790 → deadline 35.178 (8.39 s); next start 14.3 s later | none sent | 11.841 → 12.041 warm |
| 236 (w2) | **1 / 1** / 27 | 26.881 → deadline 40.208 (**13.3 s** for an 8 s timer) | none sent | 11.972 → 12.457 warm |
| 263 (w2) | **2 / 2** / 24 | 23.869 → headers `warm`, body not read → deadline 33.027 (9.2 s) | none sent | 11.378 → 12.540 warm |

In aggregate:

- w1/w2 sent about 1.9 and 1.5 requests per client in 22 s (w0 sent 11.8). Each request was an 8 s deadline followed by a backoff retry (`retry generic +H` 340, `retry +hint=1` 36).
- No client saw `fresh`/`memo` with a body below 886 on these requests, and no `serverGap` fired (`failKinds` = `{deadline: 594}` only, no `gap`).
- For save 888, w1 had only 12 hinted fetches (send +4.1 s, end +8 s) and w2 had 0. Their clients reached ≥888 through generic or retry fetches after the stall ended, around 09:13:52–58. That gives save 2 its p95 of 11.8 s and max of 12.9 s, and puts their 886 apply after the 30 s cut-off at 09:13:51.3.
- By save 890 all four workers were normal: p95 1.9 s, all `warm`.

## (2) The 594 deadline failures

- **Concentrated in 2 of 4 workers.** All 397 in the spam window are in w1/w2; w0/w3 have 0.
- **Event-loop stall in the client.** `armSnapshotDeadline` is a plain `setTimeout(8000)` armed in the same tick the row is created. For the 138 failed first-886 fetches, `tEnd − tStart − 8000` is min 191, p50 1,751, p90 6,598, max 6,787 ms. Per worker: w1 p50 952 (max 1,762), w2 p50 6,547 (max 6,787). A timer firing up to 6.8 s late means the thread's event loop was blocked.
  - The same stall explains w2's 22 % shortfall in broadcasts counted inside the window, and the 6 w2 fetches that received response headers but never parsed the body.
- **The server never saw most of these requests.** It logged 186 `minRev=886` hint fetches. 153 of them fall before 09:13:26.0 (log time), which is exactly w0+w3 (120) + pages (27) + the 6 w2 header-only responses. The 138 failed w1/w2 first-886 sends (09:13:23.9–27.3) have no matching server line. Another 33 `minRev=886` lines at 09:13:32–39 are late w1/w2 retries.
  - The server's own latency for what it received was low: warm lookup p50 3–9 ms, build avg 130 / max 630 ms, rev-read max 579 ms, `slow-hit` ×2 (max 639 ms), 0 5xx, 0 EMAXCONN, 0 build-failed.
- **The whole host was slow.**

  | metric | 09:13 warm spam | Micro off spam (04:36) | lost-final (09:10, no spam) | verify-ambiguity (09:15) |
  |---|---|---|---|---|
  | page open → join p50 | 6,877 ms | 1,564 ms | 6,344 ms | 2,149 ms |
  | SDK subscribe p50 / p95 | 2,020 / 5,428 ms | 154 / 413 ms | 711 / 3,110 ms | 395 / 714 ms |
  | all SDK joined after | 44.8 s | 11.2 s | — | — |
  | broadcast → SDK, save 1, p50 / p95 | 858 / 2,984 ms | 372 / 382 ms | — | — |
  | page broadcast p95 | 3,148 ms | 381 ms | — | — |
  | page fetch round trip (spam window) | p50 0.8–1.6 s, p95 ≤ 2.8 s (0.2–0.4 s outside it) | — | — | — |

  - The guest's sends got slow acks: only 32 of 40 sent, 8 slots skipped. In the Micro run 120 of 120 went out.
  - lost-final had **607 deadline failures with no spam at all**.
  - All the 09:06–09:15 runs had warming on. Only the two runs inside 09:10–09:14 failed.

## (3) Where the 1,044 builds for rev 886 come from

Classified by line order inside each request's log entry. A build line that appears after that request's `hint-fetch` line means the snapshot was served first and rebuilt afterwards, i.e. an `unstable_cache` stale-while-revalidate regeneration.

| class | builds |
|---|---|
| hinted (`minRev=887`), build after the response line → background regeneration of the 2 s generic entry | **873** (84 %) |
| hinted, blocking generic build before the verify (first read after the save's tag purge) | 20 |
| non-hinted (periodic / catch-up / retry), build only | 119 |
| non-hinted, rev-read → build | 28 (spread 09:13:25–45; consistent with regeneration, see below) |
| warm job (`PUT` entry) | 3 |

- **No repairs as seen by clients.** `x-snapshot-source: repair` appears 0 times for SDK clients and 0 for pages (Micro off: 343 repairs). Every `rev-read` returned 886. A repair needs a cached `rev` below the database (885 < 886), which only happens in the first second after the purge.
- **Rate.** 56 instances; per instance median 17 builds and max 46 over 24.3 s, i.e. 0.70 builds/s (max 1.89/s). That is about 0.25/s per instance-locale.
  - Gaps between consecutive 886 builds of the same instance+locale: p10 50, p50 880, p90 4,360 ms. So regenerations are sometimes duplicated within one TTL.
- **Rev-reads stay bounded.** Never more than 1 per instance per second (695 rev-reads, 0 instance-seconds with 2). The memo works.
- **Why spam produces these builds.** From 09:13:24 every notification fetch carries the forged `minRev=887`. The warm lookups for 887 were 225 hits (all after the real 887 at 09:13:44), 1,814 misses and 591 memo-misses. Each miss reads the generic entry, so each instance regenerates it every TTL while the flood lasts. Without spam a save gets 5–17 builds because hinted traffic stops after one warm hit.
- **This is not what broke the clients.** The pool peaked at Σ 110 with max 3 waiting. The Micro flag-off spam had 10,872 `build`-source SDK responses and no failures.

## (4) Is there a warming-specific mechanism?

- **Forged-ahead hints dodging the exact-key warm entry: yes, but it is harmless.** For 887 the warm hit rate fell to 8.6 % and those fetches took the flag-off path: memo 1,849 and fresh 595 in minute 09:13. Their body was the generic entry at 886, so every client that could reach the server held 886 already. This is the flag-off cost, not a failure.
- **`fresh=886` with body 885 → serverGap loop: no.** 0 `gap` failures, 0 `repair` responses, and the `disproved` resolutions (578) all had `dbRev` < H.
- **Would the fix candidates have avoided the 224?** None of them. The failing requests did not reach the server, or reached it after the client had given up. What each one would change:

| candidate | effect | catch |
|---|---|---|
| (a) newest warm entry ≥ serverRev on an exact miss | ≈2,405 forged-887 fetches served from warm 886; most of the 873 regenerations disappear | `verify` still has to be `memo`/`fresh` (rev < minRev). The server only receives `minRev = max(serverRev, H)`, so "≥ serverRev" needs a new parameter or a per-event `latest` pointer (Runtime Cache has no range scan, and pointer writes from concurrent saves can race and go backwards). |
| (b) warm job also refreshes the generic `unstable_cache` entry | removes only the first blocking build per instance-locale after the purge (20 hinted + part of 119) | does not touch the 873 regenerations that sustained traffic causes; ordering against the save's own `expire: 0` purge; lowest value |
| (c) after the rev read, if `dbRev` < minRev and `warm(dbRev)` exists, serve it | same server saving as (a), uses the `dbRev` already read (≤1 read per instance per second) and an exact key | must be labelled `fresh`/`memo`, not `satisfied`: `satisfied` means rev ≥ minRev |

## (5) Why the Micro flag-off spam missed nothing

- **The load generator was healthy.** Per worker: 5,590 / 5,590 / 5,603 / 5,513 requests with 0 hard failures. That is about 4× the warm run's request volume and 4× its server builds. Subscribe p50 154 ms, broadcast p95 378 ms, 120 of 120 guest sends.
- **The server path was heavier, not lighter.** memo 14.5k, deferred 3.1k, `build` responses 10,872, 343 repairs. It still produced 0 failures and an honest p95 of 4.2 s.
- So the difference between the runs is the client-side environment in the 09:10–09:14 window, not warming. With warming on and a healthy host:
  - 09:06 browsers: 0 failures.
  - 09:09 double-save: 0 failures.
  - 09:15 verify-ambiguity: 0 failures, p95 2.0 s.

## Recommended next steps

1. **Fix the measurement first.**
   - Add `perf_hooks.monitorEventLoopDelay` to each worker (p99 and max, every 1 s) and to the main thread.
   - Record host CPU and memory.
   - Persist each worker's `reqs` and `applied` (or a spam-window slice) to a sidecar file.
   - Fail the run as "harness invalid" when any worker's event-loop lag exceeds 1 s.
2. **Rerun the spam drill** with the flag on and off back-to-back on the same fleet. Consider 6–8 workers or fewer clients per worker.
3. **Optional server work against spam cost: (c)**, since it reuses the existing rev read. Combine with the earlier R2 follow-up (a per-instance ceiling for hinted `minRev` above the memoised head, answering without a read).
4. **(a)** only if the wire gains a separate `have=serverRev`. **(b)** is not worth it.
