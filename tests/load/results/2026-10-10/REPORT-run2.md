# n14 run #2 — 2026-10-10 (UTC) / 2026-10-10 PT

Target: dev preview `opensetlist-git-dev-opensetlist-projects.vercel.app`
(dev `1ef5144` = R1 + #568, Vercel functions **icn1**, Fluid on, deployment
`dpl_25ADcdRh3Q69puN8uTcfD3sz7Nc8`). Supabase dev **Micro**: shared pooler
pool 15 backends / **max 200 clients**, `max_connections` 60. Generator: one
Windows laptop (US west coast, ~120 ms RTT to icn1), k6 v2.2.0, Node 24,
Playwright 1.60 / Chromium. Event **111** `rehearsal-lovelive-fes-2020-day1`
(23 rows, `ongoing`, ja snapshot ~47 KB).

Three streams, built by three agents and run one at a time so they don't
contaminate each other: `viewers.js` (k6 500-viewer model), `races/`
(cache races), `browsers/` (real pages + SDK subscribers).

## Headline

**R1 as deployed does not survive a 500-viewer edit burst on Supabase Micro.**
Not because of the 15-backend pool (the 150-request step-up passed every
gate) but because the burst fans out across Vercel function instances —
142 of them for the cold burst, 32 for a warm one — and each instance opens
its own Prisma pool (max 5, idle 20 s) against the pooler's **200-client
cap**. The result is `EMAXCONN` 500s on the API and on SSR, and the 500-burst
run aborted at its first admin cycle.

All six cache-race drills passed at full scale, so the revision/acceptance
design itself is sound; the failure is capacity shape (instances × pool),
and the levers are listed at the end.

## 1. k6 — `viewers.js`

### 1a. Step-up: bursts of 150, 2 admin cycles, 150 s steady → PASS

| Gate | measured | gate |
|---|---|---|
| snapshot p95 whole run | 419 ms (p99 1308 ms, n=6101) | ≤ 1 s |
| snapshot errors | 0.000 % | ≤ 0.1 % |
| burst windows p95 (worst / rest) | 1952 ms (cold b00) / ≤ 539 ms | ≤ 3 s |
| admin save+reload p95, burst windows | 977 ms, 13/13 visible, 0 lost | ≤ 3 s |
| reactions 501 POST + 501 DELETE | 0 errors; `ackAt` ≥ request start 100 % (lead 73–482 ms) | ≤ 0.1 % |
| steady poll 25 rps | p50 181 / p95 301 / p99 383 ms; source build/cache 480/3270 | — |
| SSR 2.5 rps | p95 725 ms, p99 2.96 s | — |

DB side: 12–13 active backends at burst peaks, 28/60 total peak. Report:
`2026-10-10T18-58-46-821Z-viewers.md`.

### 1b. Full: bursts of 500 → ABORTED at b01

| Burst | requests | p95 / max | errors |
|---|---|---|---|
| b00 cold start (create) | 614 | 2426 / 2739 ms | 0 |
| b01 c1 create | 586 | 614 / 797 ms | **38 (6.5 %) — HTTP 500** → abort gate (2 %) |

Whole-run gates (1,860 snapshot requests before the abort): p95 1980 ms
FAIL, errors 2.097 % FAIL, admin burst-window p95 755 ms PASS (2/2 visible).
Event reconciled to 23 rows; 0 reactions left. Report:
`2026-10-10T19-03-56-013Z-viewers.md`.

**Vercel runtime logs for 19:03–19:04** (1,946 entries, `vercel-logs-b00-b01.err`;
one `[liveSnapshot] build … instance=` line per real build):

| rev | what | real builds | distinct instances | build ms avg / max |
|---|---|---|---|---|
| 231 | b00 cold burst | 249 | **142** | 485 / 1100 |
| 232 | steady polls 6–40 s | 191 | 5 | 56 / 291 |
| 233 | b01 burst | 125 | 32 | 190 / 405 |

- 45 × `DriverAdapterError: (EMAXCONN) max client connections reached, limit: 200`
  (39 in the API route chunk, 6 in SSR). 144 distinct instances in one minute.
- The orchestrator's own `pg` check from the laptop was refused with the same
  EMAXCONN at 19:04 → **pooler client peak ≥ 200 (gate ≤ 140: FAIL)**. The
  dashboard's "Shared Pooler client connections" chart failed to load for the
  third run in a row, so the error is the reading.
- Live DB view during a burst: 27/60 backends, all 15 Supavisor backends in
  snapshot transactions (10 idle-in-transaction between statements).

Mechanism: save → `revalidateEventData` purges the tag → 500 fetches in
U(0, 500 ms) → Fluid spreads them over N instances → every instance misses
(coalescing is per instance; the Data Cache write isn't visible to the
others yet) → N × 3 locales builds → each instance holds up to 5 pooler
clients for 20 s → clients > 200. Warm instances from the previous burst
still hold their idle pools, which is why b01 (32 instances) failed although
it was far smaller than b00.

**Header caveat.** `x-snapshot-source: build` over-counts: requests coalesced
behind an in-flight build on the same instance share the first request's
result object, header included (`liveSnapshot.ts` `coalesce` +
`readThroughCache`). The step-up's "158 builds per save" from the header was
wrong; the log count is the truth. The header should be fixed to report
`cache` for coalesced waiters (or the report should stop using it).

## 2. Cache races — `races/` (full scale, 19:08–19:18, 0 foreign saves)

| Race | verdict | evidence |
|---|---|---|
| 1. commit during an in-flight build | PASS | 0 stale responses > 2 s after the ack; `minRev` first-try at the new rev 3/3; converged 6/6 |
| 2. notification before the tag purge propagates | PASS | 0 of the `minRev` responses behind the committed rev across 8 trigger groups (0–500 ms after the save, real-broadcast triggered, two saves 410 ms apart) |
| 3. single viewer in a sparse locale (en) | PASS | 3/3 both orders at the new rev, 230–280 ms |
| 4. regeneration while the pool is saturated (22 sleepers, probe waited 19.6 s) | PASS on the invariant | nothing applied backwards, converged after release; **behaviour during the stall is the finding (below)** |
| 5. stale response arriving last | PASS | 12/12 at the committed rev; 6 stale-after-fresh trials, all rejected by the app's acceptance class |
| 6. status boundary without a write | PASS | API `ongoing` 389 ms after startTime from cache, rev constant; SSR flipped ≈ 600 ms; 0 wrong-side renders |

Race 4 findings (file:line in the report `2026-10-10T19-08-07-021Z-races.md`):
1. **Cache hits are held hostage by the DB.** Plain requests answered from
   cache (`servedAt` right at arrival) took 2.1–5.3 s to be delivered while
   the pool was stalled; `unstable_cache` (revalidate 2) serves the stale
   entry but the response evidently waits for the background regeneration
   to settle (Prisma `maxWait` 5 s). 6 of 40 plain warm requests were bare
   500s. The cache shields the DB, not latency.
2. **Bare 500, empty body, ~5 s, no `Retry-After`** when a build can't get a
   connection — `/api/setlist` has no error handling around
   `getLiveSnapshot`. Clients treat it as a failure and retry, so nothing
   stale is applied, but 503 + `Retry-After` or the last good entry is the
   deliberate behaviour.
3. **The repair path's uncached revision read has no timeout**: requests
   carrying a hint above the cached rev were held 2.2–17.2 s for the whole
   stall. On the public channel anyone can send such a hint.

## 3. Real browsers + SDK subscribers — `browsers/`

Reduced scale on purpose: **30 Chromium pages + 120 SDK subscribers** (the
planned 470 subscribers fetch within the same 500 ms jitter window and would
reproduce 1b's instance fan-out instead of measuring the delivery path).
12 insert-after edits near the top (after row 2), one every 25 s, each
followed by a PUT that sets a unique marker song; latency = PUT request
start → marker in the page DOM / SDK client applied a snapshot with
rev ≥ the PUT's rev; missing = not seen within 30 s.

### 3a. Main run (19:14–19:20, report `2026-10-10T19-20-40-759Z-browsers.md`) → PASS

| Scope | n | p50 | p95 | max | missing | gate |
|---|---|---|---|---|---|---|
| all pairs | 1800 | 1634 ms | **2160 ms** | 3302 ms | **0** | p95 ≤ 3 s, 0 missing → PASS |
| edit × page | 360 | 1085 ms | 1440 ms | 2606 ms | 0 | PASS |
| edit × SDK client | 1440 | 1743 ms | 2168 ms | 3302 ms | 0 | PASS |

From the operator's first click (the insert-after request, which precedes
the PUT): pages p95 2229 ms, SDK p95 2984 ms, max 3858 ms.

Notification path, PUT start → arrival, on the same clients:

| Path | delivered | p50 | p95 | max |
|---|---|---|---|---|
| R1 `postgres_changes` UPDATE → pages | 360/360 | 1114 ms | 1522 ms | 1734 ms |
| R1 `postgres_changes` UPDATE → SDK | 1440/1440 | 1234 ms | 1569 ms | 1968 ms |
| R2 broadcast `rev` → SDK | 1440/1440 | **547 ms** | 1254 ms | 1451 ms |

So on R1 the notification itself eats 1.1–1.5 s of the 3 s budget; the R2
transport halves that (p50) on the very same sockets. The fetch + render
after the notification is ~0.4–0.6 s.

Population facts worth keeping:
- `postgres_changes` registration for 150 clients: p95 **68–73 s** after
  subscribe (SDK p50 7.6 s, pages p50 33 s). The n12 registration
  bottleneck is visible even at 150; the run waited for it before editing.
  Broadcast joins: p95 0.5 s (SDK), 3.9 s (pages).
- /api/setlist sources seen by the SDK clients: build 3037 / cache 2673 /
  repair 2 (header, so over-counted as in §1b); fetch failures 0; R3
  fallbacks 0; page errors 0.
- Clean-up: 12/12 rows soft-deleted, 23 rows, order intact; positions
  compacted to 1..23 afterwards with `browsers/restore.mjs --compact`.

### 3b. Drills (same population, 3 edits each)

| Drill | what | drilled pairs | p50 / p95 / max | missing | gate | verdict |
|---|---|---|---|---|---|---|
| silent-loss | 10 pages have their Realtime notification frames dropped for one edit; only the 20 s ± 4 s poll can repair them | 10 | 8.4 s / 13.7 s / 13.7 s | 0 | max ≤ 24 s | **PASS** |
| ws-blocked | 10 pages with the websocket blocked from the start; the 5 s ± 1 s polling fallback carries them | 30 | 3.3 s / 5.2 s / 5.4 s | 0 | max ≤ 7 s | **PASS** |
| reconnect | every page and SDK socket force-closed 1 s before edit 2 | 150 | 2.4 s / 5.2 s / 6.1 s (catch-up, informational) | 0 | — | n/a |

Non-drilled pairs in the first two runs stayed at p95 2.1–2.3 s with 0
missing (reports `…-browsers-silent-loss.md`, `…-browsers-ws-blocked.md`).

**Reconnect run: main gate FAIL** (all pairs p95 **12.8 s**, max 13.9 s, 0
missing; report `…-browsers-reconnect.md`). Every page and SDK client got
`CHANNEL_ERROR` on the unclean close, switched to the R3 polling fallback
(120/120 SDK clients) and only retried Realtime after the 30 s recovery delay
(`RECOVERY_DELAY_MS`, `src/lib/realtimeRecovery.ts:30`; rejoin p50 30.4 s pages
/ 30.5 s SDK). Edit 2 was caught up by the 5 s fallback poll (p95 5.2 s), but
edit 3 at +40 s landed in the middle of the mass rejoin and its p95 went to
~13 s. realtime-js would have rejoined on its own in about a second; the
30 s hold-off is the cost. A venue Wi-Fi blip at the Fes would look exactly
like this.

## 4. Egress (Supabase Usage, project filter openset-dev; refreshes hourly)

| Reading | 18:40 UTC (before) | 19:31 UTC (after; lags ≤ 1 h) | delta |
|---|---|---|---|
| Egress, cycle to date | 9.861 GB | 10.234 GB | **+0.373 GB** |
| Realtime messages | 127,342 | 130,458 | +3,116 |
| Realtime peak connections | 601 | 601 | — (today's 150-client runs were below the probe's 601) |

Real builds counted from the logs for the one-minute k6-full window alone:
571 × ~83 KB ≈ 47 MB. The whole session (step-up + full + races + 4 browser
runs) is in the right range for the 83 KB/build model given the hourly lag;
re-read tomorrow for the settled number. Browser/SDK fetches go through
Vercel, not Supabase egress.

## 5. Verdict and levers

| Gate | Result |
|---|---|
| 500-viewer burst: snapshot p95 ≤ 1 s, errors ≤ 0.1 % | **FAIL** (EMAXCONN) |
| 150-viewer burst | PASS |
| pooler clients ≤ 140 | **FAIL** (≥ 200) |
| admin save+reload p95 ≤ 3 s in steady and burst windows | PASS where measured (755–977 ms) |
| reactions | PASS |
| cache-race invariants | PASS 6/6 |
| real clients (30 pages + 120 SDK): save → DOM p95 ≤ 3 s, 0 missing | PASS (2.16 s; 1.44 s pages) |
| silent-loss repair ≤ 24 s / ws-blocked ≤ 7 s | PASS (13.7 s / 5.2 s) |
| reconnect: p95 ≤ 3 s after a mass socket drop | **FAIL** (12.8 s; 30 s Realtime recovery hold-off) |

Levers, to be decided before run #2b (each testable with the same harness):
1. **Per-instance Prisma pool max 5 → 2** (`src/lib/prisma.ts`). Coalescing
   means an instance rarely needs more than one connection per locale build.
   142 × 2 = 284 is still over the cap cold, 32 × 2 = 64 warm — necessary,
   not sufficient alone.
2. **Client jitter U(0, 500 ms) → U(0, 1500–2000 ms).** Fewer concurrent
   requests → fewer instances. Costs ~0.5–0.75 s mean freshness, inside the
   3 s target.
3. **Revision-keyed cache without a tag purge on write.** R2's broadcast
   carries the exact rev; `cachedSnapshotAtRev(rev)` is a shared Data Cache
   key, so only the instances that miss inside the first ~150 ms build.
   Removes the "every instance misses" storm by design.
4. **Supabase Micro → Small for the Fes week** (400 clients): operator lever,
   2× headroom, ~$15/mo prorated.
5. Fix the race-4 items: route-level error handling (503 + `Retry-After` or
   last-good), a timeout on the repair revision read, and decouple the
   cached response from the background rebuild.
