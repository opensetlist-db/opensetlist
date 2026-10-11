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

## Repeat: small-warm-2 (2026-10-11, 05:59:51–06:05:07 UTC)

Same population and recipe as `small-warm`: 30 pages + 470 SDK clients in 4 worker threads, 12 edits, 25 s pause, Supabase Small, event 111, no k6. Before the run the fleet was warmed with 20 curl loads of the event page (ja/ko/en, 05:58:25–05:58:59). All 20 returned 200; the first took 3.5 s and the rest 0.44–0.71 s. The side-cars started at 05:59:12, which gave 39 s of baseline. Files:

- `2026-10-11T06-05-07-374Z-browsers.md`
- `vercel-logs-history-summary-small-warm-2.md` (the history files of both deployments, concatenated)
- side-car CSVs `…T05-59-12…` (`pooler-clients.csv`, `supavisor-backends.csv`)

### Two differences from `small-warm`

1. **The alias moved to a new deployment mid-run.**
   - Before the switch, the alias served `dpl_Wbm7QT6C` (`opensetlist-btccuj33b`), the same deployment `small-warm` ran on.
   - At **06:02:17.9Z** (its first log line), PR #576's deployment `opensetlist-6op7ijh37` (`571bbc0`, created 06:01:21Z) took over the alias. The old fleet's last log line is at 06:02:24.4.
   - Edits 1–5 ran on the same build as `small-warm`.
   - Edit 6 (insert at 06:02:22.9) is the first save on a cold fleet: rev 746 had 219 builds on 89 instances in 5 s.
   - Edits 7–12 ran on the new fleet, which was warm by then.
   - Pages served by the new deployment include PR #575's notification skip. Pages on edits 1–5 do not.
2. **The SDK workers ran the worktree's scheduler at `e64c6a3`, which does not contain PR #575** (`fd927db`). That is the same SDK code `small-warm` used.

**How the logs were fetched.** `npx vercel logs` on the alias only returns logs for the deployment the alias points to at fetch time. So the window before the switch was fetched from `opensetlist-btccuj33b` by name. `opensetlist-n0zho94ky`, PR #575's dev deployment, has no logs in the window: it never served the alias during the run.

**Raw per-client records.** The browsers JSON keeps only per-save distributions. To get per-client timing, the run was started from an untracked copy of `run.mjs` with one extra line. That line writes the SDK clients' `bcasts` / `reqs` / `applied` and the pages' `bcasts` / `fetches` to a scratch file when the workers stop. Nothing else was changed, the copy was deleted after the run, and the 3.7 MB dump stays out of git.

All fetch timing below comes from that dump:

- `reqs` rows are `[tStart … tEnd]` as recorded in the worker.
- So "fetch start → applied" covers the request, the body parse and the acceptance check in the worker.
- An SDK client does no rendering: applying a snapshot is just the acceptance check, so the apply term is 0.

### Headline

| Scope | `small-warm` p50 / p95 / max | **`small-warm-2`** p50 / p95 / max | missing |
|---|---|---|---|
| all pairs (n 6,000) | 1,436 / 3,103 / 4,161 FAIL | 1,405 / **2,145** / 2,992 — **PASS** | 0 |
| edit × page (n 360) | 1,595 / 2,189 / 2,525 | 1,611 / 2,158 / 2,603 — PASS | 0 |
| edit × SDK (n 5,640) | 1,423 / 3,115 / 4,161 FAIL | 1,390 / **2,145** / 2,992 — PASS | 0 |
| SDK, edits 1–5 only (before the switch, same build as `small-warm`) | per save below | 1,462 / 2,083 / 2,523 | 0 |
| SDK, edits 6–12 (after the switch) / 7–12 (new fleet warm) | — | 1,353 / 2,224 / 2,992 · 1,342 / 2,020 / 2,946 | 0 |
| broadcast `rev` → SDK (PUT start) | 781 / 1,600 | 797 / **1,232** (max 1,305) | 5,640/5,640 |
| broadcast `rev` → pages (PUT start) | 712 / 1,069 | 708 / 964 | 360/360 |

Other checks for the whole run:

- **Broadcast → SDK p95:** 1,232 ms, against 1,600 in `small-warm` and 964 on Micro (`r2-baseline-2`).
- **Hint outcomes:** all `satisfied` — 10,962 SDK notification fetches, 860 page notification fetches and 11,826 server-side `hint-fetch` lines. Rechecks 0, exhausted 0, fetch failures 0.
- **Monotonic:** 0 regressions.
- **SDK connections:** 2 `CHANNEL_ERROR` episodes (transport failure), both rejoined. All SDK clients had joined after 13.6 s.

### Per save (PUT start = 0)

| edit | rev | fleet | PUT ms | pages p50/p95/max | pages bcast p50/p95 | SDK p50/p95/max | SDK bcast p50/p95 | bcast → fetch start p50/p95 | fetch start → applied p50/p95 | bcast → applied p50/p95 | SDK delivered by insert-hint / PUT-hint fetch | hinted (PUT rev) fetch ms p50/p95 | builds first 5 s / inst | Σ pool peak (5 s carry) | backends busy max (samples ≥ 15) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 736 | old | 635 | 1,552 / 1,851 / 1,874 | 708 / 770 | 1,869 / 2,318 / 2,494 | 1,170 / 1,303 | −494 / 641 | 1,069 / 1,825 | 733 / 1,088 | 313 / 153 | 488 / 728 | 336 / 55 | 104 | 16 (2) |
| 2 | 738 | old | 692 | 1,620 / 2,004 / 2,023 | 758 / 810 | 1,338 / 1,934 / 2,181 | 854 / 910 | 152 / 627 | 530 / 912 | 492 / 1,114 | 200 / 260 | 435 / 731 | 227 / 51 | 99 | 16 (1) |
| 3 | 740 | old | 900 | 1,376 / 1,814 / 1,908 | 914 / 924 | 1,568 / 2,065 / 2,523 | 1,095 / 1,251 | −263 / 386 | 874 / 1,466 | 525 / 894 | 359 / 111 | 439 / 770 | 272 / 77 | 123 | 16 (2) |
| 4 | 742 | old | 504 | 1,427 / 1,849 / 1,879 | 555 / 594 | 1,378 / 1,871 / 2,380 | 804 / 820 | −423 / 389 | 1,077 / 1,671 | 741 / 1,178 | 393 / 75 | 356 / 689 | 306 / 48 | 83 | 16 (1) |
| 5 | 744 | old | 565 | 1,536 / 2,158 / 2,199 | 586 / 611 | 1,223 / 1,871 / 2,145 | 797 / 830 | −212 / 480 | 671 / 1,025 | 503 / 1,116 | 324 / 143 | 527 / 923 | 327 / 55 | 103 | 15 (1) |
| 6 | 746 | **new, cold** | 563 | 1,644 / 2,568 / 2,603 | 613 / 627 | 1,534 / **2,533** / 2,992 | 616 / 627 | −285 / 519 | 1,198 / **2,132** | 916 / 1,918 | 336 / 128 | 348 / 1,515 | 219 / **89** | 132 | 16 (2) |
| 7 | 748 | new | 578 | 1,563 / 1,840 / 1,867 | 614 / 629 | 1,121 / 1,684 / 2,122 | 630 / 671 | −198 / 514 | 639 / 913 | 477 / 1,050 | 340 / 124 | 447 / 690 | 277 / 46 | 88 | 16 (1) |
| 8 | 750 | new | 622 | 1,711 / 2,324 / 2,423 | 692 / 832 | 1,499 / 2,379 / 2,946 | 695 / 866 | −305 / 454 | 1,030 / **2,035** | 796 / 1,681 | 363 / 103 | 364 / 1,103 | 318 / 65 | 112 | 16 (2) |
| 9 | 752 | new | 821 | 1,631 / 1,967 / 1,970 | 878 / 884 | 1,365 / 1,812 / 1,970 | 903 / 947 | 138 / 477 | 465 / 991 | 456 / 919 | 156 / 310 | 344 / 572 | 220 / 53 | 99 | 16 (1) |
| 10 | 754 | new | 892 | 1,862 / 2,259 / 2,275 | 973 / 976 | 1,477 / 2,125 / 2,267 | 969 / 981 | 121 / 460 | 669 / 1,115 | 511 / 1,160 | 198 / 268 | 449 / 788 | 238 / 44 | 86 | 16 (2) |
| 11 | 756 | new | 670 | 1,750 / 2,140 / 2,143 | 750 / 754 | 1,347 / 1,931 / 2,271 | 910 / 929 | −332 / 463 | 741 / 1,226 | 520 / 1,116 | 253 / 214 | 499 / 872 | 274 / 59 | 112 | 16 (1) |
| 12 | 758 | new | 527 | 1,611 / 1,941 / 2,078 | 601 / 703 | 1,215 / 1,739 / 2,104 | 597 / 605 | −268 / 504 | 766 / 1,138 | 615 / 1,136 | 289 / 178 | 448 / 770 | 238 / 50 | 99 | 16 (10, incl. clean-up) |

**How to read the columns:**

- **Fetch columns.** "bcast → fetch start" and "fetch start → applied" refer to the first fetch whose body carried rev ≥ the PUT's rev. A negative "bcast → fetch start" means that fetch started before the PUT's broadcast arrived.
- **Which fetch delivered the save.** In every save, most SDK clients got the PUT's rev from the **insert's** notification fetch (`hint` = insert rev). That fetch was already in flight when the PUT committed, so the PUT's own broadcast did not trigger the fetch that delivered it.
- **Hinted fetch ms.** Covers the notification fetches whose ticket was the PUT's rev (73–294 per save).
- **Builds.** `[liveSnapshot] build` lines for the save's rev within 5 s of its first build. Whole-interval totals are 408–597 (see the summary's table).
- **Backends.** From the 1 s Supavisor sampler; busy = active + idle in transaction, over a 25 s window starting at each insert.
  - Total backends max 20 throughout (incl. 2 `auth_query`).
  - Max transaction age 104–321 ms (321 on edit 6), max active statement ≤ 80 ms.
  - 0 Lock/LWLock waits.

Pool and error figures:

- **Prisma `max waiting`:** ≤ 1 in every bucket after the join (`small-warm` had 10 on edit 6).
- **Σ pool peak:** 132, at 06:02:20 — the bucket of the switch, where instances of both fleets were carried.
- **Errors:** EMAXCONN 0 in logs and 0 of 182 probes. 0 build failures. Coalesced 3,328.

### SDK pairs > 2.5 s, broken down (medians; p95 in brackets)

| edit | pairs | PUT ms | PUT end → bcast arrival | bcast arrival → fetch start | fetch start → applied | apply |
|---|---|---|---|---|---|---|
| 3 | 2 | 900 | 237 (350) | 282 (413) | 970 (973) | 0 |
| 6 | 28 | 563 | 53 (65) | −220 (662) — 16 of 28 fetches started before the bcast | **2,283 (2,629)** | 0 |
| 8 | 10 | 622 | 62 (78) | −365 (−126) — all 10 started before the bcast | **2,246 (2,468)** | 0 |

40 of 5,640 pairs (0.7 %) took longer than 2.5 s. On edit 6 they were spread over all four workers; on edit 8 they were on workers 2–3.

For these pairs the broadcast was prompt: on edits 6 and 8 it arrived within 65 ms of the PUT returning. The time went to the fetch. The fetch started 0.2–0.4 s before the broadcast arrived (the insert's notification fetch, or on the cold fleet the PUT-hint fetch) and took ~2.2–2.3 s to return the PUT's rev.

- **Edit 6** was the first save on the newly aliased deployment: 89 instances built rev 746 within 5 s, hinted fetch p95 1,515 ms, max transaction age 321 ms.
- **Edit 8** had the most builds of any save after the switch: 318 on 65 instances, hinted fetch p95 1,103 ms.

### The three slow saves of `small-warm` against this run

| | SDK p50 / p95 | SDK bcast p50 / p95 | bcast → applied p50 | PUT ms |
|---|---|---|---|---|
| `small-warm` edit 5 (rev 707) | 2,442 / 3,173 | 1,005 / 1,270 | 1,437 | 638 |
| `small-warm` edit 6 (rev 709) | 2,812 / 3,719 | 1,144 / 2,416 | 1,668 | 501 |
| `small-warm` edit 12 (rev 719) | 2,324 / 2,899 | 1,374 / 2,190 | 950 | 1,048 |
| `small-warm-2` worst (edit 6, cold fleet) | 1,534 / 2,533 | 616 / 627 | 916 | 563 |
| `small-warm-2` worst warm (edit 8) | 1,499 / 2,379 | 695 / 866 | 796 | 622 |
| `small-warm-2` worst before the switch (edit 1) | 1,869 / 2,318 | 1,170 / 1,303 | 733 | 635 |

In `small-warm`, on those three saves:

- the whole SDK population was late (p50 2.3–2.8 s);
- the broadcast arrived late (p95 up to 2.4 s);
- the gap from broadcast to applied was long (p50 0.95–1.67 s).

In this run:

- no save had an SDK p50 above 1,869 ms;
- no save's broadcast p95 was above 1,303 ms;
- the largest per-save broadcast → applied p50 was 916 ms.

**Late arrival by worker.** On edits 1, 3, 4 and 11, workers 0–1 received the broadcast 250–470 ms later than workers 2–3. On edit 1, for example, p50/p95 was 1,296/1,305 for workers 0–1 against 736–828 / 772–836 for workers 2–3, while the 30 pages saw it at 708/770. Within one worker the arrivals were never more than 100 ms apart. The data cannot tell whether Realtime delivered to those sockets late or the two worker threads' event loops read them late.

### Verdict

**The 3.1 s SDK tail did not reproduce.**

- **Headline:** SDK p95 was 2,145 ms (PASS), against 3,115 ms in `small-warm`.
- **Saves before the switch:** edits 1–5 ran on the same deployment, fleet size class and SDK code as `small-warm`. Their SDK p95 was 2,083 ms, and no save's broadcast p95 was above 1,303 ms.
- **What caused the old tail:** in `small-warm` the tail came with late broadcast arrival (broadcast p95 2.2–2.4 s on two of its three slow saves). That did not happen in this run.
- **What is left:** the pairs above 2.5 s in this run (0.7 %) are dominated by the fetch: ~2.2 s from fetch start to applied, the broadcast within ~60 ms of the PUT returning, apply 0. They are concentrated on the first save after the switch (cold fleet) and on the save with the heaviest build storm.
- **Pages:** unchanged, p95 2,158 vs 2,189 ms.

One repeat cannot rule out the late broadcast happening again. It does show that late broadcasts are not something Small always does at this population.
