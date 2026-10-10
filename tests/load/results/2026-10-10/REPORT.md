# n12 run #1 — 2026-10-10 (UTC) / 2026-10-09 PT

Target: dev preview `opensetlist-git-dev-opensetlist-projects.vercel.app`
(build `740974c`, Vercel functions **icn1**, Fluid on). Supabase dev
**Micro**, shared pooler pool **15** / max clients **200**,
`max_connections` 60. dev == prod on all of these.
Generator: one Windows laptop, k6 v2.2.0, IP 99.7.59.33 (US west coast).
Each request crosses the Pacific, so absolute latencies include ~120 ms
of RTT that a JP/KR viewer doesn't pay.

Events: **111** `rehearsal-lovelive-fes-2020-day1` (23 rows / 28 songs,
`ongoing`, ja snapshot 47 KB) and **82** `niji-5th-live-cdcs-day2`
(40 rows, 65 KB) as the upper bound.

## Results

### Ramp, event 111

| Stage | achieved rps | p95 / p99 | http err % | bad bodies | Verdict |
|---|---|---|---|---|---|
| 20 | 20 | 249 / 341 ms | 0 | 0 / 237 | PASS |
| 50 | 50 | 223 / 314 ms | 0 | 0 / 584 | PASS |
| 100 | 100 | 413 / 948 ms | 0.008 | 0 / 1193 | PASS |
| 200 | 32 (578 dropped) | 5107 / 6742 ms | 0 | 0 / 386 | collapse, aborted |

### Ramp, event 82 (40 rows)

| Stage | achieved rps | p95 / p99 | Verdict |
|---|---|---|---|
| 20 / 50 / 100 | on target | ≤ 252 / ≤ 338 ms | PASS |
| 200 | 127 (484 dropped) | 5153 / 6799 ms | collapse, aborted at 16 s |

Row count (23 vs 40) makes no visible difference at ≤ 100 rps. The
ceiling sits **between 100 and 200 rps** for both events.

### Hold, event 111, 100 rps × 600 s (90 snapshot + 10 SSR) + admin + bursts

| Stream | Result |
|---|---|
| Snapshot hold (90 rps) | 89.3 rps achieved, **median 194 ms, p90 255 ms, p95 412 ms**, p99 5.9 s (the tail is the burst window). http err 0.062 %. 0 / 5,345 bad bodies. 430 dropped, all in the burst window |
| SSR event page (10 rps) | 10.0 rps, p95 843 ms, p99 2.4 s, err 0.017 % |
| Admin, 24 timed saves | **PASS**: save+reload p95 **775 ms**, 24/24 visible in the first snapshot, 0 lost |
| Burst 500 in 5 s (+100 rps on top) | p95 **2.5 s**, 0 errors → FAIL on latency |
| Burst 2,000 in 5 s (+400 rps on top) | p95 **10.1 s**, **10.2 % errors**, 163 dropped → FAIL |

### DB side (`pg_stat_activity`, 5 s samples)

- Steady 90–100 rps: **3–6 active** backends.
- 200 rps stages and both bursts: **15–17 active**, i.e. the pooler's
  pool of 15 is saturated and requests queue for a backend. That's the
  latency cliff. It's server-side, not the generator: dropped
  iterations only appear once responses take seconds.
- Supabase DB report (last hour): CPU peak 68 %, network out peak
  61 MB/s, memory 0.9 / 1.1 GB.
- Pooler *client* connections chart failed to load on the dashboard,
  so that gate has no number. Re-read it on the next run.

## Verdict against the gates

| Gate | Steady 100 rps | Edit burst |
|---|---|---|
| p95 ≤ 1 s / p99 ≤ 2 s | p95 ✅ / p99 ✅ in the ramp; hold p99 ❌ only via the bursts | ❌ |
| errors ≤ 0.1 % | ✅ | ❌ (10 % at 2,000) |
| bodies correct | ✅ | ✅ |
| admin p95 ≤ 3 s, no lost edit | ✅ | — |
| pooler clients ≤ 70 % | not measured | not measured |

**Steady-state polling up to ~100 rps is fine. One operator save
fanning a full refetch out to every Realtime subscriber is not.** 500
subscribers already push p95 to 2.5 s, and 2,000 starts failing
requests.

## Worse than the model: one save can fan out many times

`useRealtimeEventChannel` refetches `/api/setlist` on **every**
`SetlistItem` postgres_changes push (`scopedRefetch` →
`fetchSnapshot`). Bursts of pushes are "collapsed" by aborting the
previous in-flight fetch, but **an aborted fetch has already reached
the server**: the DB work happens anyway, and only the response is
discarded. Writes that touch several rows push several times:

- insert-after at position *p* shifts every later row → (rows − p) + 1 pushes
- swap → 3 pushes
- the edit-burst test modelled **1** refetch per subscriber per save

So inserting a forgotten song near the top of a 30-row setlist, with
500 Realtime viewers, is ~30 × 500 = 15,000 requests within a second
or two. That is well past the burst that already failed.

## Egress (cost, not just speed)

F24 measured ~83 KB per `/api/setlist` call on the **uncompressed
pooler wire**, and that wire is ~all of our metered egress. At the
steady 90 rps above that is ~7.5 MB/s ≈ **27 GB per show hour**, so
a 4-hour show day costs ~100 GB and both Fes days ~200 GB. The org
quota is 250 GB per cycle, and the **spend cap is on**: overrun means
restriction, not a bill. The test runs themselves used about
110 k requests (~6–9 GB). The Usage page hadn't refreshed yet; re-read
it to get the measured per-request number.

## Decision (Step 3)

The gates fail on the burst, and the failure mode is **duplicated
identical reads saturating the 15-backend pool**. That is the case the
spec reserves (iii) for. Order, cheapest first:

1. **Client: debounce + jitter the Realtime refetch** instead of
   abort-and-refetch. One trailing fetch per burst of pushes (~300 ms
   quiet window), then a random 0–3 s delay so N subscribers spread
   out instead of arriving together. This removes the per-row fan-out
   and flattens the spike by ~10×. Small change, belongs with n13.
2. **(i) Poll 5 s → 10 s ± 2 s** in `useSetlistPolling` (default
   `intervalMs = 5000`). This halves steady load per viewer.
3. **(iii) Server snapshot cache**, key `event:<id>:<locale>`, TTL 2 s,
   with per-instance in-flight coalescing. With Fluid compute many
   concurrent requests share an instance, so a 2,000-request burst
   collapses to a handful of DB reads. It also cuts **egress** by
   the same factor, which (1) and (2) only partly do. Needs the
   staleness proof from the spec plus n13's bounded follow-up fetch.
4. **(ii) Realtime limit:** usage shows peak 2 connections so far.
   Still confirm the effective cap (field says 10,000, docs say 500
   with the spend cap on) before 11/7.

Re-run (run #2) after 1 + 2, then after 3: same hold, plus a burst
shaped like the real fan-out (insert-after near the top).
