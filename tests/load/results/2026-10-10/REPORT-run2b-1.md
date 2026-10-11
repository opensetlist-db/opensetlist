# n14 run #2b-1 — corrected package A on the 500-viewer model (2026-10-10, 23:44–23:52 UTC)

Target: dev preview `opensetlist-git-dev-opensetlist-projects.vercel.app` at dev `0638878` (PR #570 merged: pool 2 / idle 5 s / `attachDatabasePool`, 503 + `Retry-After` on build failure, bounded repair read, writer 503 on pre-execution failures, client `Retry-After` floor + Realtime recovery ownership). Database: dev Supabase **Micro** through Supavisor (200-client cap). Event 111 (23 rows). Jitter **500 ms** (unchanged, by decision). Operator: this run was executed by an agent following `tests/load/README.md` → "n14 run #2b-1"; the report is written by the orchestrator from the committed summaries.

Files next to this report: `2026-10-10T23-52-07-385Z-viewers.md` / `.json` (k6), `k6-run2b.{out,err}.log`, `2026-10-10T23-44-58-992Z-pooler-clients.csv` + `-pooler-metrics.txt` + `pooler-clients.out` (side-car), `vercel-logs-history-summary.md` (**authoritative** — history-mode re-fetch, 23,763 entries) and `vercel-logs-summary.md` (the `--follow` capture, which lost ~71 % of the entries; kept for the record). Raw logs (2.2 MB + 4.5 MB) and `viewers.json` of the follow capture stay out of git.

## Headline

**The hard failure of run #2 is gone: 25 bursts of ~600 requests each (one cold, 24 warm, 8 s apart) produced 0 HTTP 500, 0 HTTP 503 and 0 `EMAXCONN` — in the Vercel runtime logs and in the side-car's own transaction-pooler probe (218/218 connects).** Admin saves stayed under 1.1 s p95 inside the bursts, every write was visible, reactions 0 errors.

Two gates miss, both marginal and both explained by what package A does *not* do (fix the build storm):

| Gate (run #2 definition) | Measured | Verdict |
|---|---|---|
| snapshot p95 ≤ 1 s, whole run (polls + bursts, n = 21,971) | **920 ms** (p99 1,627) | PASS |
| snapshot p95 ≤ 1 s, bursts only | all 25 bursts **1,019 ms**; warm bursts 644–1,071 ms (5 of 24 over 1 s); cold b00 **2,638 ms** | **FAIL by 19 ms**; cold start is the test's artefact |
| errors ≤ 0.1 % | **0.000 %** — 0 × 500, 0 × 503, bad bodies 0/2,123 | PASS |
| pooler clients ≤ 140, 0 EMAXCONN | app-side Σ of per-instance Prisma pools (5 s carry): **153 at b00** (152 instances × 1 connection), warm peak **131** (23:48:00), typical warm burst 85–105; EMAXCONN **0** (probe 0/218, logs 0) | **FAIL on the cold-fleet estimate** (153 > 140), PASS on EMAXCONN; 47 clients of headroom at the worst moment |
| drain: back to baseline within 30 s of the last burst | Σ 84 → 17 within ~15 s of b24; held at 12–16 while the 25 rps steady polls ran; **0 within 6 s** of the polls stopping (23:50:37 → :43) | PASS (idle 5 s + `attachDatabasePool` work as intended) |
| admin save+reload p95 ≤ 3 s, steady / burst | **806 / 1,003 ms**; 37/37 writes visible; `[liveWriter]` acquire p95 ≤ 5 ms, exec p95 ≤ 137 ms, `ok=false` 0 | PASS |
| reactions ≤ 0.1 % errors | 501 POST + 501 DELETE, 0 errors, 0 left behind | PASS |
| generator | 25.0 of 25 rps, dropped 0, 25/25 bursts fired | PASS |

Verdict: **PASS on every hard gate (no errors, no cap hit, writes land), marginal on the two soft ones.** Package A does what it was meant to do — bound the pooler clients — and the measured bound is 1 connection per instance that serves a burst, i.e. the pooler budget now equals the Vercel instance count. It does **not** reduce the number of instances that build (see §3), which is why the burst p95 sits at the 1 s line instead of under it.

## 1. What the bursts looked like

k6 model: cold start (1 save + burst b00), steady 15–295 s (polls 25 rps + SSR 2.5 rps), admin cycles c1/c3/c4/c6 = 6 saves each with a 500-request burst per save (R1 tabs over U(0, 500 ms); 20 % old-build tabs over a pinned U(0, 500 ms), repeating once at +1 s), quiet cycles c2/c5, reactions 500 POST + DELETE at 150 s, quiet drain 90 s. Run length 385 s.

| Burst | p50 / p95 / max | errors | header build share |
|---|---|---|---|
| b00 cold create | 1,540 / **2,638** / 2,881 ms | 0 | 188 / 597 |
| c1 b01–b06 | p95 644–1,025 ms | 0 | 420–590 / ~600 |
| c3 b07–b12 | p95 668–1,038 ms | 0 | 548–585 / ~600 |
| c4 b13–b18 | p95 670–1,071 ms | 0 | 508–580 / ~600 |
| c6 b19–b24 | p95 653–970 ms | 0 | 581–593 / ~600 |

Bursts over 1 s p95: b03 1,025, b10 1,032, b11 1,038, b15 1,071, b17 1,038. R1 requests (with `minRev`): p95 1,079 ms, `rev ≥ minRev` 100 %. Old-build requests: p95 902 ms, saw the post-save revision on the first request 100 %. Steady polls: p50 195 / p95 445 ms, source build/cache 1,485 / 5,516. SSR event page: p95 1,372 ms.

## 2. Pooler clients

The Supabase metrics endpoint turned out **not** to answer the question: with the service-role key it exposes `pgbouncer_*` gauges, and `pgbouncer_used_clients` read **1** in all 218 samples, b00 included (`free_clients` 49, `server_used` 0 throughout). Those gauges belong to the project's dedicated PgBouncer, not to Supavisor (`aws-1-….pooler.supabase.com:6543`), which the app uses. The README's "Supavisor exports pgbouncer-compatible names" (written before this run) is wrong for the client gauges and is corrected in this PR. Supavisor's own client count is still not observable from outside; the two usable signals are:

- **App-side Σ of per-instance Prisma pool totals** (`[prisma] pool total=… instance=…`, summed per 5 s with a 5 s carry = the idle timeout): baseline 9, **153 at b00** (152 instances reporting `total=1` — with coalescing one connection per instance was enough, the pool `max 2` was never reached cold), warm bursts 74–131, quiet-cycle saves 14–18, drain to 0 within 6 s of the last request. `waiting` (requests queued for a slot) peaked at 13 in warm bursts, 0 cold.
- **The side-car's transaction-pooler probe**: a fresh connect every 2 s, **0 failures in 218** (725–1,301 ms each), i.e. the cap was never reached at any sampled instant. Supavisor's server side in `pg_stat_activity` went 9 → 23 backends at b00 and stayed there (peak `num_backends` 26, active 4, idle-in-tx 5).

Run #2, same model, same preview region: 249 builds on 142 instances cold with pool 5 and idle 20 s → > 200 clients → 45 × EMAXCONN. Run #2b-1: 171 builds on 152 instances cold with pool 2 and idle 5 s → Σ 153 → 0 × EMAXCONN. The cold-fleet instance count is the same order as before; the per-instance footprint is what changed.

## 3. Builds per save (the storm is still there)

From the history logs (`[liveSnapshot] build` lines: 7,346 in the run):

| Save | builds | distinct instances | build ms avg / max |
|---|---|---|---|
| b00 cold (rev 394) | 171 | **152** | 722 / 1,146 |
| warm burst saves (24) | 199–290 | 38–73 | 182–353 / 650–1,101 |
| quiet-cycle saves (12) | 42–89 | 9–13 | 44–57 / 69–149 |
| steady-poll revision (395) | 177 | 7 | 47 / 235 |

Coalescing worked inside instances (2,977 coalesce events, 13,300 waiters, max 17 per build), `build-failed` 0, repair reads 0 (no client ever needed the repair path — every R1 request found `rev ≥ minRev`), `slow-hit` 0. The header proxy said 545 builds per save, about 2× the real number — as expected, do not use it.

So each save still triggers 200–290 builds across 40–70 instances. That is the Codex prediction from the design discussion: package A caps the pool per instance, it does not stop every instance from missing the purged tag at once. The burst p95 (~1 s) is the cost of 40–70 parallel REPEATABLE READ builds of ~200–350 ms against a 23-backend Supavisor pool; the 5 bursts over 1 s are the ones with the most instances (b11: 73 instances, 276 builds, max build 1,101 ms).

## 4. Operational notes

- `vercel logs --follow` is not a reliable capture: 6,993 of ~24.7k entries (29 %); for b00 it showed 85 builds / 67 instances against the true 171 / 152. The history mode (`--since/--until` in 20 s windows, `--limit 5000 --expand`) got 23,763 entries and is what this report uses. The README recipe now says to re-fetch in history mode after every run.
- No k6 abort. Side-cars exited on `run2b.STOP`. Event 111 reconciled: 23 rows, positions 1..23, 0 leftover reactions, final rev 431.
- The run crossed UTC midnight on the laptop clock but not in UTC; everything is in `results/2026-10-10`.

## 5. What this means for the Fes path

1. **Micro + package A survives the 500-viewer edit burst with zero errors.** The pooler budget is now "one client per instance that serves the burst"; at 152 cold instances that is 153 of 200. Small (400 clients) would turn that into a 2.6× margin and is still the right insurance for the show week.
2. **The remaining cost is latency, not availability**: ~1 s p95 per burst from the build storm (40–70 instances × 200–350 ms builds). Real-client save → DOM was 2.16 s p95 in run #2 with the same storm, inside the 3 s target; the storm adds ~0.5 s to that, not 2 s.
3. **The next lever is the storm itself**, and that is an R2 topic (exact `rev` in the notification makes a revision-keyed shared entry or a writer-side pre-warm possible — rejected for R1, to be re-evaluated on R2's exact-rev notification fetches with a warmer-off control). Nothing in this run argues for widening the jitter: the bursts pass on errors at 500 ms, and widening would spend freshness budget for a latency gate that is 19 ms over.
4. **Cold start** (2.6 s p95 on b00) is the test's doing — a show audience arrives over 30+ minutes. The one real-world analogue is a deploy during the show; do not deploy during the show.

Decision proposed: treat run #2b-1 as the capacity sign-off for R1 on Micro at 500 (errors, cap, writes), carry the burst-latency gate forward as an R2 target, resize to Small before the 11/7 rehearsal, and measure the actual R2 path (470 SDK + 30 pages, broadcast-driven fetches) before the Fes.
