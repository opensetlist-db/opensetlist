# n14 first Small control — cold k6 + warm browsers on Supabase Small (2026-10-11, 05:34–05:44 UTC)

Target: dev preview `opensetlist-git-dev-opensetlist-projects.vercel.app`, deployment `dpl_Wbm7QT6C…` created 05:13:12Z (dev `9883ec4`, same live-path code as `83cfe06`). Dev Supabase resized Micro → **Small** before the run. Event 111 (23 rows), jitter 500 ms, `HINT_MODE=r2`. Same recipe as `REPORT-r2-baseline.md`; compared against its Micro numbers (k6 attempt 1 cold, browsers `r2-baseline-2`). Executed by an operator agent.

Files: k6 `2026-10-11T05-35-48-883Z-viewers.md`; browsers `2026-10-11T05-44-15-055Z-browsers.md`; history log summaries `vercel-logs-history-summary-small-{k6,browsers}.md`; side-car CSVs `…T05-34-50…` (k6) and `…T05-38-23…` (browsers): `pooler-clients.csv` (2 s) and `supavisor-backends.csv` (1 s, new one-off sampler `supavisor-backends.mjs` in this folder).

## Preflight (effective settings)

| Setting | Value |
|---|---|
| `show max_connections` (DATABASE_URL_UNPOOLED) | **90** (`superuser_reserved_connections` 3); PostgreSQL 17.6 |
| `pgbouncer_config_max_client_connections` (metrics endpoint — the dedicated PgBouncer, not Supavisor) | 400 (was 200 on Micro) |
| Supavisor client cap seen by the app | **400** — the EMAXCONN text in the Vercel logs reads `max client connections reached, limit: 400` |
| Supavisor backends at rest (`pg_stat_activity`, `application_name LIKE 'Supavisor%'`) | 2 pooled + 2 `auth_query` (Micro at rest: 16–17 pooled, idle) |
| Hinted request | `x-snapshot-verify: satisfied` (one preflight request at 05:33:32Z — one instance touched before the cold run) |

## 1. k6 cold control (b00 on a fleet idle since 05:13Z)

b00 aborted on the 2 % gate (as on Micro); no re-run, so there are no warm-burst gates on Small.

| b00, cold | Micro (03:55, attempt 1) | **Small (05:35)** |
|---|---|---|
| requests / HTTP 503 | 601 / 246 (**40.9 %**) | 600 / 74 (**12.3 %**) |
| burst p50 / p95 / max | 1,849 / 3,093 / 3,416 ms | 2,411 / **4,464** / 4,847 ms |
| app-side pool Σ peak (5 s carry) | **199** (cap 200) | **400** (cap 400) |
| builds on the saved rev / distinct instances | 220 / 189 | **421 / 389** |
| build ms avg / max | 1,119 / 1,880 | 1,682 / 3,036 |
| distinct instances in the minute | 479 | 489 |
| EMAXCONN in logs / probe | 246 / 0 of 64 | 74 / **3 of 63** (05:35:44, :46, :48) |
| hint outcomes (server) | 211 satisfied, 188 error | 366 satisfied, 34 error, 0 fresh/memo/deferred |
| admin save+reload (1 save) | 2,703 ms | 2,867 ms |

## 2. Supavisor backend pool (1 s sampler, own backend excluded)

| Phase | samples | pooled backends max | active max | idle-in-tx max | busy (active + idle-in-tx) max | samples with busy ≥ 15 | max tx age | max active stmt | Lock/LWLock waits |
|---|---|---|---|---|---|---|---|---|---|
| k6 baseline | 42 | 2 | 0 | 0 | 0 | 0 | 0 ms | 0 ms | 0 |
| k6 b00 (05:35:42–48) | 6 | 17 | 4 | 12 | **16** | 3 | 177 ms | 40 ms | 0 |
| k6 after abort | 88 | 17 | 1 | 0 | 1 | 0 | 0 | 0 | 0 |
| browsers join (05:38–05:39:23) | 60 | 18 | 1 | 2 | 2 | 0 | 270 ms | 4 ms | 0 |
| browsers edits (05:39:23–05:44:02) | 279 | 18 | 16 | 13 | **16** | 23 (≈ 2 per save) | 174 ms | 84 ms | 0 |
| browsers clean-up (12 soft-deletes) | 19 | 18 | 14 | 13 | 16 | 10 | 126 ms | 58 ms | 0 |

The pool grew from 2 to 17 pooled backends on the first burst and stayed there (15 opened = the default pool size). Every sample with busy ≥ 10 had busy = 16, i.e. all pooled backends non-idle at once. The only wait event seen was `Client:ClientRead` (backend idle in a transaction waiting for the app). For comparison, from the 2 s `pooler-clients` CSVs: Micro `r2-baseline-2` busy max 17, ≥ 15 in 14 of 175 samples; Small browsers busy max 17, ≥ 15 in 19 of 179; Micro cold b00 busy max 2 (0 samples ≥ 15).

## 3. Browsers, 30 pages + 470 SDK, warm (`small-warm`, 05:38:55–05:44:15)

| Scope | Micro `r2-baseline-2` p50 / p95 / max | **Small** p50 / p95 / max | missing |
|---|---|---|---|
| all pairs (n 6,000) | 1,304 / 1,943 / 3,336 | 1,436 / **3,103** / 4,161 — **FAIL** (≤ 3,000) | 0 |
| edit × page (n 360) | 1,638 / 2,147 / 3,336 | 1,595 / 2,189 / 2,525 — PASS | 0 |
| edit × SDK (n 5,640) | 1,289 / 1,920 / 2,893 | 1,423 / **3,115** / 4,161 — FAIL | 0 |
| broadcast `rev` → pages (PUT start) | 738 / 916 | 712 / 1,069 | 360/360 |
| broadcast `rev` → SDK (PUT start) | 729 / 964 | 781 / **1,600** | 5,640/5,640 |

- Per save, pages p95 1,889–2,346 ms (Micro 1,819–3,245). SDK p95 1,796–2,520 ms on 9 saves; **3,173 / 3,719 / 2,899 ms on edits 5, 6, 12**, whose SDK broadcast arrival p95 was 1,270 / 2,416 / 2,190 ms and whose p50 gap broadcast → applied was 1,437 / 1,668 / 950 ms (other saves 456–651 ms; Micro 351–734 ms). Edit 6 (rev 709) had the most builds (525 in its first 5 s) and the only Prisma pool `max waiting` > 1 (10, bucket 05:41:30).
- Hint outcomes: SDK 10,303 hinted fetches, all `satisfied`; pages 807, all `satisfied`; rechecks 0, exhausted 0, 0 fetch failures; server side 11,114 `hint-fetch`, all `satisfied`. Monotonic: 0 regressions (21,440 SDK applies, 360 page versions).
- Pool Σ peak **147** (Micro 160); EMAXCONN 0 in logs, 0 of 179 probes; 0 build failures; coalesced 3,493.
- Builds per save (first 5 s after the save rev's first build): **242–525 on 42–75 instances** (Micro `r2-baseline-2`: 215–326 on 47–100). Whole-interval totals 480–783 per save rev (Micro 408–537).
- Population: SDK all joined after 15.3 s (Micro 10.4 s); 4 SDK worker threads both runs.

## What Small changed and what it did not

Small raised the client cap to 400 and the cold 500-burst's 503 share fell from 41 % to 12 %, but the cold fleet answered with twice as many instances (389 vs 189) and the app-side Σ reached the new cap exactly (400), so EMAXCONN still occurred (74 in logs, 3 probe refusals) and b00 still aborted, now with a higher p95 (4.46 s vs 3.09 s). Warm, the browsers run stayed far below the cap (Σ 147, 0 EMAXCONN) and pages held their Micro latency (p95 2,189 vs 2,147 ms), while SDK p95 rose to 3,115 ms on three saves with late broadcast arrival and a longer broadcast → applied gap. The Supavisor backend pool (15, unchanged by the resize) was fully busy for ~2 s on every save on both Micro and Small, with sub-300 ms transactions and 0 lock waits.
