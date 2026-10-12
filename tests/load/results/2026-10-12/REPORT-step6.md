# n14 qualification step 6 — deployment transitions with open tabs (2026-10-12)

Step 6 of the Fes qualification order: both deployment transitions (warming ON→OFF→ON on the same commit; R2→R1 rollback and the return) under 500 open tabs, with saves around each switch, new arrivals on the target, in-flight fetch/recheck exposure, real R1 tabs against the R2 server, and positive per-request deployment attribution. Design agreed with Codex (3 rounds, wiki Decisions log 2026-10-12 "Codex discussion on step 6"); tooling in PR #588 (Codex code review 2 cycles). **No server change**: the candidate is dev `5475bf2`.

## Setup

| item | value |
|---|---|
| candidate | dev `5475bf2` (steps 2–5 unchanged); R1 = dev `385e5f0` (the commit before the R2 transport PR #572: writers already broadcast `rev`, no `x-snapshot-verify`, `postgres_changes` client, no warming code; schema identical) |
| deployments | all `vercel deploy -e …` from the tree (never `redeploy`, which drops `-e`): ON-A `6l87uqc8o` = `dpl_FAt2Sp33…` (the alias's incumbent, dev HEAD build), OFF-1 `fvbdesrew` = `dpl_7H9E2oNx…` (`LIVE_WARM_ENTRIES=0`), ON-B `8kis2jv91` = `dpl_F5VocFca…`, ON-C `e7i9t0p57` = `dpl_5nR6mGHX…`, R1-1 `meqyujqe8` = `dpl_GN57F4US…`; twins OFF-1t `fz4puazfz`, R1-1t `btb4zk5cq` (ON-A′ `j3su3g2p0` deployed but not used: T2 started from ON-B, the deployment T1 left on the alias) |
| twin verification (before the runs, on the twins only) | OFF-1t: one save + hinted fetches → writer lines 4, `[liveWarm]` lines 0, warm lookups 0, `source=warm` 0 (verify header still present = R2 build) → **OFF proven**; R1-1t: `[liveWarm]` 0, `x-snapshot-verify` absent on 6/6 hinted answers, 200s → **R1 proven** |
| switch mechanism | dev alias `opensetlist-git-dev-…` moved with `vercel alias set <target>` by `step6-switch.sh` on the load laptop (recorded exception: one process, 3.8–4.6 s wall, 165–334 ms CPU; T0's pseudo-switches ran the same CLI; one T0 call took 28 s — Vercel-side, not CPU). No merge/push to `dev` during the runs |
| population | 30 Chromium pages + 470 SDK clients (430 natural, 20 hold subset, 20 ahead-hint subset) joined on the alias, settle 20 s; arrivals 10 pages + 100 SDK at P + 10 s after every switch (T2's R1 switch: 15 real R1 pages + 100 SDK); populations grow and are reported as they are (T1 500 → 610 → 720 → 830; T2 500 → 615 → 725; pages up to 60 / 55); 70-row fixture in every run (synthetic Fes bound) |
| timeline per switch | saves at P −30 / −1 / +1 / +5 / +11 / +15 / +30 / +60 s (PUT on a dedicated anchor; T2's return adds insert / update / soft-delete), identity guard through the target's immutable URL before the first write after the switch, probe 1 hinted fetch/s, route marker 2/s (`/<locale>/privacy` `data-dpl-id`), reactions/wishes smoke from one old page per locale at P + 20 s |
| attribution | every response's `X-Vercel-Id` ↔ `vercel logs --json` record `id` + `deploymentId` (exported per leg window [P − 40 s, P + 75 s], limit 5000, 30 s slices — a full-window export of T0 ran > 1 h at the CLI's ~30 records/s and was abandoned) |
| Skew Protection | active for framework assets (`data-dpl-id` on the document, every `/_next/static/...` with `?dpl=`); the page's own `/api/setlist` fetch carries no pin (0 of 7,497–12,440 SDK requests, 0 of 503–1,034 page API requests per run); a request WITH a `__vdpl` cookie is served by that old deployment (platform honours cookie pins — verified before the runs) |
| validity | load-host lag/heartbeat/CPU gates **valid in every run** (whole window, switch CLIs included) |

Verdicts per switch, separately: **continuity** (every planned save 2xx, 0 missing, every eligible client ≥ the saved rev within 30 s of the first attempt, every continuously connected R2 client received the committed broadcast, 0 × 5xx / transport failures / malformed bodies / unexpected reloads / page errors / monotonicity regressions), **performance** (per-save per-population p95 ≤ 3 s, kept visible), **arrivals** (time-to-usable = later of complete 70-row setlist and hydration/channel readiness, p95 ≤ 3 s), **smoke** (reaction 200 + wish 403 "locked" on an ongoing event = expected), **guard**, **exposure** (pending hinted ≥ 20 / pending recheck ≥ 5 / old answer after cutover ≥ 5 / arrival saves), plus the join's attribution, propagation, OFF/R1 evidence and resources.

## Overview (harness side; the join's attribution/propagation/evidence sections follow)

| run | leg | switch | CLI wall / CPU | first target response (live) | continuity | performance (failing saves, SDK p95) | arrivals (time-to-usable p95, wave 0) | smoke | exposure |
|---|---|---|---|---|---|---|---|---|---|
| T0 | 1 | pseudo (ON-A → ON-A) | 3.8 s / 272 ms | P + 4.3 s | **PASS** | PASS | **FAIL** 3,317 ms (10 pages) | PASS | pendingHinted NOT · oldAnswer ✓ (hold 20/20) · arrivalSdk NOT · arrivalPages ✓ |
| T0 | 2 | pseudo | 28.1 s / 287 ms | P + 29.0 s | **PASS** | PASS | **FAIL** 3,324 | PASS | pendingHinted NOT · oldAnswer NOT · arrivalSdk ✓ · arrivalPages ✓ |
| T0 | 3 | pseudo | 4.5 s / 243 ms | P + 5.0 s | **PASS** | **FAIL** (+60 s save, 730 SDK: 3,110) | PASS 2,737 | PASS | pendingHinted NOT · oldAnswer ✓ · arrivalSdk ✓ · arrivalPages ✓ |
| T1 | 1 | ON-A → **OFF-1** | 3.8 s / 242 ms | P + 7.4 s (old deployment still answered until +7.5 s) | **PASS** | **FAIL** (+5 s 3,502; +11 s 6,686 / pages 6,573; +15 s 4,961 / pages 4,790; +30 s 3,093) | **FAIL** 6,850 | PASS | pendingHinted NOT · oldAnswer ✓ · arrivalSdk NOT · arrivalPages ✓ |
| T1 | 2 | OFF-1 → **ON-A (existing)** | 4.0 s / 273 ms | P + 5.0 s | **PASS** | **FAIL** (−1 s 3,323; +1 s 3,691 / pages 3,657; +11 s 3,560) | **FAIL** 3,186 | PASS | pendingHinted NOT · oldAnswer ✓ · arrivalSdk NOT · arrivalPages ✓; stale first answers after the return **0 / 791** |
| T1 | 3 | ON-A → **ON-B (fresh)** | 4.6 s / 166 ms | P + 7.3 s | **PASS** | **FAIL** (+11 s 4,335 / pages 3,295; +60 s 3,367 / pages 3,358) | **FAIL** 4,755 | PASS | pendingHinted NOT · oldAnswer ✓ · arrivalSdk NOT · arrivalPages ✓ |
| T2 | 1 | ON-B → **R1-1** | 4.1 s / 334 ms | P + 8.3 s | **PASS** | **FAIL** (+5 s 3,407; +11 s 4,778 / pages 4,859; +15 s pages **17,011** = the 15 R1 pages just loaded on R1 reaching the save by poll) | **FAIL** R1 cohort 7,309 (15 real R1 pages, builds {r1: 15}) | PASS | pendingHinted NOT · oldAnswer NOT (hold: 20 held → deadline) · arrivalSdk NOT · arrivalPages ✓ |
| T2 | 2 | R1-1 → **ON-C (fresh)** + insert / update / soft-delete | 4.1 s / 165 ms | P + 7.4 s | **PASS** | **FAIL** (−1 s 3,220; +1 s 3,503 / pages 3,604; +5 s 3,778; +11 s 3,370 / pages 4,341; insert 3,232) | **FAIL** 5,162 (arrivals: 7 R2 pages + 3 that still loaded R1) | PASS | pendingHinted NOT · **pendingRecheck ✓** (ahead-hint 20/20 tickets queued at P) · oldAnswer ✓ · arrivalSdk NOT · arrivalPages ✓ |

Every run: validity valid; every switch: guard ok (1.7–3.0 s through the target's immutable URL; the first post-switch save gated ≤ 2.6 s), all planned saves 2xx (8 per leg + 3 after-switch ops in T2), 0 missing, 0 × 5xx / transport / malformed / reloads / page errors, 0 regressions, broadcast received by every eligible SDK client and R2 page, 0 pinned API requests, framework assets fetched after the switch pinned to their own deployment with 0 × 404 (200–600 per switch). Fixture cleanup / verify PASS after every run; event 111 back to 23 rows.

## Findings

1. **Open tabs survive every transition (continuity PASS, 8 switches).** ON→OFF, OFF→ON (existing), ON→ON (fresh), ON→R1 and R1→ON: all saves committed, every client reached the saved revisions within the 30 s acceptance (in practice ≤ 7 s; the one 17 s is the R1 pages' own poll, see 4), every broadcast arrived, no errors, no regressions, no reloads. The rollback compatibility paths behave as designed: against R1 the R2 tabs still receive the `rev` broadcast (R1 writers send it) and read without a verify header (satisfied when at/above the hint, else one recheck); against OFF the hinted reads fall back to the generic path.
2. **Convergence right after a switch misses the 3 s target (performance FAIL on every real switch).** The saves at −1 … +15 s around a switch converge SDK p95 3.2–6.7 s (pages up to 6.6 s): the target fleet is cold (every arrival builds; the first writes on the target take 1.1–1.4 s), on OFF there is no warm entry (step 5's 70-row warm-miss cost, ~5 s), and the population is large (610–830). T0's pseudo-switches (no deployment change) stay under 3 s except the +60 s save on 730 clients (3.1 s) — so ~0.5–3.5 s of the excess is the switch itself. This is the **measured rollback cost**: 3–7 s for the saves made within ~30 s of a promotion/rollback, 0 missing.
3. **Propagation of an alias move: 5–8 s from the CLI start to the first target response, with both deployments answering for ~0.2–3 s** (route marker; T1: last old response 0.1 s after the first target one on the OFF switch, 2.5 s on the return, 3.7 s on the fresh switch; T2: 0.2 s / 3.0 s). Within that overlap 2–4 probe answers per switch still came from the old deployment after the first target answer. The CLI itself took 3.8–4.6 s (one T0 pseudo-call 28 s). The join's per-request attribution refines these bounds (next section).
4. **Real R1 tabs against the R2 server work (T2, 15 pages + 3 arrival pages that loaded R1).** After the return to ON-C, all 15 R1 pages received the `postgres_changes` events for the insert (2.4 s after the save), the update (0.47 s) and the soft-delete (as UPDATE with `isDeleted`, 1.14 s), fetched and updated the DOM within 0.9–3.1 s of the save; reactions from old pages 200, wishes 403 (locked). The R1 pages' first save after their own load (P + 15 s on R1) reached them by their poll (17 s) — R1's `postgres_changes` registration is slower than SUBSCRIBED (known; the R1 build's own behaviour).
5. **Existing-deployment return is clean**: after OFF-1 → ON-A the first 791 target answers carried the committed head (0 stale), the old warm namespace was reused without serving stale content.
6. **Arrivals on a just-promoted deployment take 3–7 s to usable at 70 rows** (p95 per wave: T1 6.9 / 3.2 / 4.8 s, T2 7.3 (R1 cohort) / 5.2 s; T0 on the warm incumbent 2.7–3.3 s) — step 5's "first page loads after a fresh deployment" finding, now on real switches: edge assets cold + 70-row SSR + hydration; nothing failed (unusable 0).
7. **Exposure**: the natural "hinted fetch pending across the boundary" condition did not occur in any switch (5–8 s between CLI start and the first target answer is longer than any in-flight hinted fetch; the harness could only find pending fetches in that window if saves landed inside it — the ±1 s saves were answered by the old deployment before the switch propagated), so "pending hinted fetch" is **NOT EXERCISED** everywhere and stated as such; "old answer after cutover, then convergence" was produced by the hold subset on 7 of 8 switches (20/20; on the R1 switch the 20 held answers ran into their deadline and are excluded); "pending recheck across the switch" was exercised once by design (T2 return: 20/20 synthetic tickets queued before the switch). Arrival SDK exposure (≥ 20 unjoined at the +11 s save) was NOT EXERCISED (100 SDK arrivals subscribe within ~2 s); arrival page exposure was exercised in every switch.
8. **Ops / harness**: `vercel redeploy` cannot be used for env-specific pairs (step 5); full-window JSON log exports are impractical (~30 records/s through the CLI) — per-leg windows only; the per-switch CLI exception on the laptop cost 165–334 ms CPU and never tripped validity.

## Join (attribution, propagation bounds, OFF/R1 evidence, resources)

Per-leg JSON log exports ([P − 40 s, P + 75 s], limit 5000, 30 s slices, no slice saturated) joined by request id (`transition-join-step6-T*.md`). Responses outside the exported windows are classified "not exported" (T1 11,691, mostly between legs) and excluded from coverage.

**Attribution inside the exported windows**: T1 29,874 / 29,874 consistent (0 unmatched; 6 Vercel records were incomplete — `responseStatusCode: 0`, empty `logs[]` — attributed by id/deployment/path, status not compared); T2 18,259 / 18,259; T0 29,451 / 29,571 (120 unmatched = no log record with that id, none within 5 s of a window edge — the only unexplained gap of the day, 0.4 %). Function instrumentation complete wherever expected (T1 17,235 → 17,235; T2 5,362 → 5,362; T0 16,803 → 16,803): every save has its `[liveWriter]` line, every hinted read its `hint-fetch` line. Pins: 0 on every API request in every run.

**Propagation (log-attributed; the harness's live route-marker boundary was within −0.75 … +0 s of it)**

| run / switch | first target response (all traffic) | first target probe | last old response | old still answering after the first target probe | steady on target | off-target probes after | 60 s sustained |
|---|---|---|---|---|---|---|---|
| T1-1 ON-A → OFF-1 | cliStart + 6.2 s (17:51:19.278) | +6.9 s | +15.2 s (last old request started +14.1 s) | 1.0 s | cliEnd + 5.1 s | 1 (→ ON-A) | no (the 1 off-target) |
| T1-2 OFF-1 → ON-A | +4.1 s | +5.9 s | +13.5 s | 1.0 s | cliEnd + 3.9 s | 1 | no |
| T1-3 ON-A → ON-B | +6.5 s | +4.9 s | +13.9 s | 3.0 s | cliEnd + 4.3 s | 3 (→ ON-A) | no |
| T2-1 ON-B → R1-1 | +6.2 s | +7.4 s | +14.6 s | 0.2 s | cliEnd + 3.5 s | 0 | **yes** |
| T2-2 R1-1 → ON-C | +4.8 s | +5.5 s | +14.6 s | 3.0 s | — | 3 (→ R1-1 at +6.5 / +8.5 / +12.5 s) | no |
| T0-1 / -3 pseudo | cliEnd + 0.03 / 0.37 s | — | — | — | — | 0 | yes |
| T0-2 pseudo (28 s CLI) | cliEnd + 0.24 s | — | — | — | — | 0 | NOT EXERCISED (13 / 98 defining probes unattributed) |

Reading: after `vercel alias set` returns (3.8–4.6 s), the first target answer arrives 0–3 s later, and the old deployment keeps answering some requests for a further 1–3 s (up to +14 s for responses whose requests had started before); in that interval 1–3 of the 1/s probes and 840–1,281 of all requests (T2) were still served by the old deployment. "Sustained target routing over 60 s" is therefore "no" on 4 of 5 real switches by the strict rule (any off-target probe after the first target one) — the mixed interval is the propagation cost, not a routing fault.

**Target role evidence**: OFF-1 (T1-1): manifest `LIVE_WARM_ENTRIES=0`; the leg's 8 saves were served 4 by ON-A (−30 … +5 s, before the alias moved) and 4 by OFF-1 (+11 … +60 s), all with writer lines; on OFF-1 0 `[liveWarm]` lines, 0 warm lookups, 0 `source=warm` across 4,364 hinted reads → **OFF proven in force**; the return to ON-A shows 12 warm-job starts again. R1-1 (T2-1): 9,208 records, 4 saves served with writer lines, 4,329 hinted reads, 0 `[liveWarm]` lines, 0 verify headers → **R1 proven**. ON-B / ON-C: warm jobs seen.

**Exposure (log-attributed)**: pending hinted fetch 0 clients on every switch (NOT EXERCISED, as the harness said); pending recheck 0 by the join's rule on T2-2 (the harness counted 20 queued tickets at P from the ahead-hint subset; the join requires a dispatched recheck spanning the boundary and found none — the rechecks dispatched after the first target answer) → NOT EXERCISED in the stricter reading; **old answer after cutover → converged: T1 179 / 353 / 262 natural clients + 22 / 33 / 23 hold, T2 178 + 7 and 308 + 25, all converged to the leg head** — the natural count the harness could not see without logs.

**Resources across deployments** (Σ = per-instance pool totals, bucket maxima, estimate): T1 combined peak 154 (ON-A 90 / OFF-1 119 / ON-B 93; 95 instances at 17:55:25, the OFF→ON-A return), writer acquire max 1,686 ms on OFF-1 (its first write, +11 s save) and 963 ms on ON-B; T2 combined 183 (ON-B 33 / R1-1 111 / ON-C 129; 109 instances), acquire max 472 ms on R1-1; T0 103 (67 instances), acquire max 210 ms; EMAXCONN 0 everywhere.

**R1 cohort (T2-2, join)**: insert / update / soft-delete each reached 18 / 18 R1 pages (15 cohort + 3 arrival pages that had loaded R1) with the correct change type (I, U, U + `isDeleted`), follow-up fetches attributed to ON-C, DOM updated < 16 s (the harness's own table: 0.9–3.1 s).

## Verdict of step 6

| question | answer | verdict |
|---|---|---|
| open tabs across ON→OFF→ON and ON→R1→ON | continuity on all 8 switches: saves 2xx, 0 missing, broadcasts received, no errors/reloads/regressions, ≤ 30 s (in practice ≤ 7 s; R1 pages' own poll 17 s once) | **PASS** |
| convergence right after a switch | saves within −1 … +15 s of a real switch: SDK p95 3.2–6.7 s, pages up to 6.6 s (cold target + OFF warm-miss at 70 rows + 610–830 clients); T0 pseudo ≤ 3.1 s | **VALID + FAIL** (3 s) — the measured rollback cost |
| propagation of an alias move | first target answer 4–7 s after the CLI start; old deployment still answering for 1–3 s after that; attribution 100 % inside the windows | measured (compatibility rehearsal, not production promotion) |
| R1 tabs against the R2 server | 18 real R1 pages received insert / update / soft-delete via postgres_changes and updated the DOM | **PASS** |
| existing-deployment return | 0 / 791 stale first answers | **PASS** |
| OFF / R1 in force on the targets | proven from the targets' own logs | **PASS** |
| arrivals on a just-promoted deployment | 3–7 s to usable at 70 rows, 0 unusable | FAIL (3 s) — known from step 5 |
| in-flight exposure | pending hinted fetch never occurred naturally (NOT EXERCISED); old-answer-after-cutover exercised with 178–353 natural clients per switch; pending recheck exercised only in the harness's reading | partial, stated |

## Rollback acceptance for the runbook

- **Rollback 1 (promote the OFF deployment of the same commit)**: open tabs keep updating; saves made within ~30 s of the promotion converge in 3–7 s (warm-miss cost at Fes size), later saves normally; arrivals in the first minute take up to ~7 s to usable. Return promotion to ON: clean (0 stale first answers).
- **Rollback 2 (promote the last R1)**: open R2 tabs keep updating (R1 writers broadcast; reads without a verify header satisfy at/above the hint, below-hint inconclusive answers recheck once); new arrivals get R1 pages (postgres_changes), which also keep working after the return to R2; the first save after an R1 page loads may reach it by its poll (~17 s).
- Either way: never promote/rollback inside the last minutes before doors (cold target fleet), make the first post-switch save after ~30 s, verify it at a connected listener (step 5 wake procedure), and record the three deployment IDs (ON, OFF, last R1) with the return promotion.
- Step 8 must still prove the production side: promotion / Instant Rollback mechanics, auto-assignment state after a rollback, propagation on the production domain.

## Files

`REPORT-step6.md`, `browsers-step6-T{0,1,2}.out.log` / `.err.log`, `<stamp>-browsers-transition.md`, `transition-join-step6-T*.md`, `switch-T*-*.json` (operator switch files), `step6-manifest-T*.json`, twin verification `<stamp>-step6-twins.json` (gitignored; summarised above), side-car outputs. Not committed: `*.json`, `*.jsonl` log exports, timelines.
