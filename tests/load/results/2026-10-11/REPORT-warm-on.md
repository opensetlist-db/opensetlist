# n14 warming run — flag ON (2026-10-11, 08:47–09:36 UTC)

Target: dev preview `opensetlist-git-dev-opensetlist-projects.vercel.app` served by deployment `or10hn1nt` = dev `9b8a6b6` (PR #578 warming track, PR #575 ticket-less skip, Prisma 7.10) redeployed with `LIVE_WARM_ENTRIES=1` in the Vercel Preview environment (`LIVE_WARM_CONCURRENCY` unset → 2 locale builds in parallel). Supabase **Small** (Pool Size 15, max clients 400). Jitter 500 ms. Event 111 (23 rows). Controls (flag off, same code minus warming, Small): `REPORT-small-control.md` (`small-warm`, `small-warm-2`, cold k6). Executed by an operator agent (preflight + k6) and the orchestrator (browsers, drills, analysis).

Files: k6 `2026-10-11T08-56-03-705Z-viewers.md`, browsers `2026-10-11T09-06-06-726Z-browsers.md`, drills `…T09-09-23…-double-save.md` / `…T09-35-35…-double-save.md` (re-run), `…T09-12-01…-lost-final.md` / `…T09-33-42…-lost-final.md` (re-run), `…T09-14-17…-spam.md` / `…T09-31-52…-spam.md` (re-run), `…T09-15-45…-verify-ambiguity.md`; log summaries `vercel-logs-history-summary-warm-{k6,browsers,spam}.md`; `warm-join.md`; `backends-warm-browsers.md`; side-car CSVs `…T08-49-03…` and `…T09-00-13…`; `warm-on-preflight.log`. Raw logs > 2 MB and `.json` stay out of git.

## Headline

**Warming does what it was built for.** With the flag on, 99.8–99.9 % of notification fetches are served from the pre-warmed entry (lookup p50 9 ms), the per-save burst storm drops from 215–326 builds on 47–100 instances to **5–17 builds on 3–7 instances**, the Supavisor backend pool that was fully busy for ~2 s on every save now peaks at **4 of 15**, the app-side pooler Σ on a cold 500-burst drops from 400 (the cap) to **104**, and the cold-fleet k6 burst answers **0 × 503** (control 12 %). Every hint-contract and consistency gate holds (hints all `satisfied`, 0 rechecks on honest traffic, 0 monotonicity regressions, lost-final / double-save / spam drills PASS on their own gates).

**What warming does not change: the honest-traffic save → visible p50 (~1.4 s).** Its floor is the operator's PUT (0.4–0.9 s) + the broadcast (≈ 50 ms after the PUT returns) + the client's own jitter/cooldown (the harness's insert+PUT pair puts the PUT's fetch behind the 1 s cooldown of the insert's fetch) + a now-cheap fetch. Per-save SDK p95 is 1.6–2.3 s on 11 of 12 saves (control 1.7–2.1 s); one save (edit 3) had a **3.3 s Realtime delivery delay** for all 500 clients and dragged the run p95 to 3.6 s. That delivery spike is the third seen on Small today (`small-warm` edits 5/6/12; none in `small-warm-2`); it is independent of warming and of the fetch path.

| Question | Answer |
|---|---|
| (a) reader builds per save | burst window: **5–17** (insert saves 827–851 odd revs) vs control 215–326. The 150–220 builds seen over a PUT save's 25 s interval are the periodic polls' 2 s generic-entry regenerations across 10–19 instances, not the burst |
| (b) backend pool | busy max **4** (median 1–2) during the 12 saves; 15–16 only in the k6 cold b00 (10 of 25 bursts, one 1 s sample each). Control: 15–16 for ~2 s on every save |
| (c) save → visible | SDK p50 1,500 / p95 3,596 (FAIL) / max 5,331, pages 1,477 / 2,181 / 4,039, 0 missing; excluding the delivery-delay save: SDK p95 1,609–2,302 per save. Warm hit rate SDK 12,813/12,822, pages 829/831 |
| (d) drills | double-save PASS (converged p95 1,982 ms); lost-final PASS (repair p95 18.3 s, max 23.9 s ≤ 26 s); spam PASS on its gate with 0 failures / 0 missing, honest saves p95 2.9 s (Micro flag-off: 4.2 s); verify-ambiguity n/a (no `memo` possible: hinted fetches hit the warm entry) |
| (e) cold k6 | b00: 0 × 503 (control 74/600), p95 2,171 ms (control 4,464), Σ 104 (control 400), 120 builds / 99 instances (control 421 / 389), EMAXCONN 0; all 25 bursts fired, whole-run p95 470 ms |

## 1. Preflight (08:47–08:49Z)

Alias answered `x-snapshot-verify: satisfied` (source `cache`). Warm-path check: an insert-after (rev 787) and a soft-delete (rev 788) each produced `[liveWarm] start → set ×3 (ok) → done` in 172 / 112 ms (build 38–54 ms, set 10–20 ms, 49–59 KB per locale), and hinted requests for all three locales answered `x-snapshot-source: warm`, `verify: satisfied`, body rev = minRev (`warm-lookup result=hit` in 7–18 ms). The marker PUT on a tail-appended row is refused (HTTP 400: an ordinary row cannot follow the encore at position 23) — the check used the insert and the delete as its saves. Event restored.

## 2. k6 cold burst (08:49–08:56Z)

| | Small cold control (flag off) | flag on |
|---|---|---|
| b00 requests / 503 | 600 / 74 (12.3 %) | 610 / **0** |
| b00 p50 / p95 / max | 2,411 / 4,464 / 4,847 | 1,493 / 2,171 / 2,555 |
| b00 builds / instances (saved rev) | 421 / 389 | **120 / 99** (3 warm + 117 reader) |
| pool Σ peak | 400 | **104** |
| EMAXCONN logs / probe | 74 / 3 | 0 / 0 of 216 |
| bursts | aborted at b00 | 25/25, 0 errors, b01–b24 p95 263–674 ms |
| hint outcomes | — | 9,937 `satisfied`, 0 fresh/memo/deferred, 0 rechecks |
| warm lookups | — | 9,906 hit / 6 miss / 10 other (all on rev 792, the one 251 ms job); hit p50 9 / p95 43 ms |
| warm jobs | — | 38, 91–251 ms start → done, 3 sets each, 0 failures |
| backend busy | 16 for ~2 s per save | 15–16 for one 1 s sample on 10 of 25 saves; ≤ 12 otherwise; quiet saves ≤ 4 |

Reader builds that remain per burst save (119–348 on 32–65 instances) come from the non-hinted traffic in the model: the 20 % old-build tabs (no `minRev`) and the 25 rps periodic polls, which never take the lookup.

## 3. Browsers — 30 pages + 470 SDK (09:00–09:06Z)

| Scope | n | p50 | p95 | max | missing |
|---|---|---|---|---|---|
| all pairs | 6,000 | 1,497 | 3,588 | 5,331 | 0 |
| edit × page | 360 | 1,477 | 2,181 | 4,039 | 0 |
| edit × SDK | 5,640 | 1,500 | 3,596 | 5,331 | 0 |

Per save (SDK p95): 1,858 / 1,611 / **4,945** / 1,726 / 1,656 / 2,704 / 1,728 / 1,609 / 2,302 / 1,751 / 2,003 / 1,625. Edit 3: broadcast → SDK p50 **3,263** / p95 3,786 ms and → pages 1,179 / 1,517 ms (other saves 519–1,011 p50) — the save was delivered late by Realtime to every client; the fetches themselves were warm hits. Edit 6 (p95 2,704) and 9 (2,302): broadcast p95 531 / 1,145 — the "first hinted send − commit" p95 1,952 / 1,675 ms shows the cooldown/jitter tail, not the server.

`warm-join` (per save/locale): warm-complete − commit 48–194 ms; SDK first hinted fetches sent after warm-complete 5,220/5,249 (99 %), hit rate after 100 %, before 90 % (26/29); pages 332/337 after, 100 %. Hint outcomes: SDK 12,822 hinted fetches all `satisfied` (warm 12,813, build 9), pages 831 (warm 829); rechecks 0; `periodic generic +H` 464 (the second broadcast of a pair riding on a periodic poll — the PR #575 skip is active: no ticket-less notification requests). Backend busy per save max 1–4, xact ≤ 149 ms (sampler `backends-warm-browsers.md`). Pool Σ peak 132 at the population join, ≤ 20 between saves; 0 EMAXCONN.

Builds per rev (history logs): insert saves 5–17 on 3–7 instances; PUT saves 156–220 over their 25 s interval on 10–19 instances = the periodic polls regenerating the 2 s generic entry (≈ 12 regenerations per instance per 25 s). That residual is the next lever if steady-state build churn matters (longer generic TTL, or serving periodic polls from the newest warm entry).

## 4. Drills (30 pages + 470 SDK, 3 edits)

| Drill | first run (09:07–09:16) | re-run with the load host idle (09:30–09:36) |
|---|---|---|
| double-save | own gate PASS (converged p95 4,743) | own gate **PASS**, converged p50 / p95 1,227 / 1,982 ms; primary FAIL by construction (3,867) |
| lost-final | own gate PASS (20.6 s) but **607 client deadline failures** | **PASS** everywhere: primary p95 2,242, repair p95 18,341 / max 23,896 ≤ 26 s, 0 failures |
| spam 2 msg/s × 20 s | **FAIL: 224 missing, 594 client deadline failures**, honest p95 11.3 s | **PASS on its gate**: 0 failures, 0 missing, cooldown held (min gap 1,006 ms, ≤ 0.58 hinted req/s per client); honest saves p95 2,875 all pairs (pages 3,280 FAIL by 280 ms); server: memo 5,974 / fresh 474 / deferred 1,051, rechecks 247, exhausted 226; warm hit rate 25 % (forged "ahead" hints miss the exact key by design) |
| verify-ambiguity (20 primes/locale) | n/a — 0 `memo` on the drilled save: hinted fetches hit the warm entry, so the repair path is not reachable this way | — |

**The first spam / lost-final failures were a measurement artefact, not warming.** Analysis (`warm-spam-analysis.md` (next to this report)): the 224 clients that "missed" rev 886 were exactly the clients of 2 of the 4 SDK worker threads; those threads started 397 requests in the spam window and every one failed on the 8 s deadline before reaching Vercel (the server logged none of them), their 8 s timers fired 1.7–6.8 s late, and page joins / broadcast arrivals on the whole host were 4–8× slower than the Micro runs — the load host (the operator laptop) was saturated by the orchestrator's concurrent 6-way history-log fetch and summarisers running during those two drills. The server side in that window was healthy (0 × 5xx, 0 EMAXCONN, 0 build-failed, warm lookups 3–9 ms, rev-reads ≤ 579 ms). The re-runs on an idle host pass. Lesson for the harness: add a per-worker event-loop lag monitor and invalidate a run when it exceeds ~1 s; never run log fetches on the load host during a run.

What spam still costs with warming on: a forged hint ahead of head (`latest+1`) misses the exact-key warm entry and drops onto the generic path — 1,044 builds for the save inside the spam window (84 % are the 2 s generic-entry refreshes on 56 instances, median 0.7 builds/s per instance), hinted throughput capped by the 1 s client cooldown, 0 errors. Honest-save p95 under spam 2.9 s (vs 4.2 s flag-off on Micro). Candidate to cut that cost (not needed for the gate): when `dbRev < minRev` and a warm entry exists for `dbRev`, serve it (labelled `fresh`, never `satisfied`) instead of the generic entry.

## 5. What this means

1. **Capacity**: warming removes the storm as a capacity problem — Σ 104 on a cold 500-burst, backend pool at ≤ 4/15 on saves, 0 × 503 cold. Together with Small this is the first configuration that survives a cold fleet.
2. **Latency**: p95 per save improves modestly (storm no longer in the fetch); the p50 is bounded by PUT + broadcast + client jitter/cooldown, not by the server. The remaining p95 risk is Realtime delivery spikes (1–3 s, seen on 3 saves across 36 today), which neither warming nor the cache path touches.
3. **Safety**: hint contract, monotonicity, poison/spam bounds and the lost-notification repair all hold with the flag on; a warm miss is always the old path.
4. **Decision proposed**: ship R2 with `LIVE_WARM_ENTRIES=1` on **production** for 11/4–6 (set the env var on the Production environment before the release deploy), keep the warming-off deployment as the rollback target and drill that flip at the 11/7 rehearsal; keep the flag on dev. Follow-ups, none gating: per-worker lag monitor in the harness; the ahead-hint warm fallback; a decision on the periodic-poll generic churn (TTL or newest-warm serving); watch Realtime delivery spikes at the 11/7 rehearsal.
