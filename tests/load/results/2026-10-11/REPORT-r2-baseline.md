# n14 R2 baseline — warmer-off control on the R2 build (2026-10-11, 03:55–04:51 UTC)

Target: dev preview `opensetlist-git-dev-opensetlist-projects.vercel.app`, **Supabase Micro** (200 pooler clients). Builds: dev `6f98bff` (PR #572: R2 client + `x-snapshot-verify` + pool guard) for the k6 runs and the first 7 edits of the first browsers run; dev `83cfe06` (PR #573: Prisma 7.10.0, no live-path change) from **04:24:52Z** — the alias flipped in the middle of the first browsers run, so that run is reported with the boundary and a second, clean browsers baseline (`r2-baseline-2`) was run after the drills. Jitter 500 ms. Event 111 (23 rows). Executed by an operator agent per `tests/load/README.md` → "n14 R2 baseline run"; the report is written by the orchestrator from the committed summaries.

Files next to this report: k6 `…T03-55-39…-viewers.md` (attempt 1, cold, aborted) and `…T04-05-48…-viewers.md` (attempt 2); browsers `…T04-26-50…-browsers.md` (`r2-baseline`, redeploy inside) and `…T04-50-42…-browsers.md` (`r2-baseline-2`, clean); drills `…-browsers-{poison,spam,verify-ambiguity,lost-final,silent-loss,double-save,reconnect}.md`; history-mode log summaries `vercel-logs-history-summary-{k6-attempt1,k6,browsers,browsers-2}.md`; side-car CSVs. Raw logs > 2 MB and `.json` files stay out of git.

## Headline

**The hint contract works exactly as designed, the transport switch landed, and the 500-viewer save → visible p95 is 1.94 s (inside the 3 s gate) — but not the 1.3–1.6 s the transport change was expected to buy, because the build storm is unchanged and now sits inside the critical path of every client. On Micro the pooler cap is still reached: a cold fleet answers a 500-burst with 41 % HTTP 503, and even warm fleets peak at Σ 160–189 of 200 clients.**

| Hypothesis (from the R2 design) | Result |
|---|---|
| H1 save → visible drops from the R1 transport's 2.16 s p95 to ~1.3–1.6 s | **Not confirmed.** Clean baseline: all pairs p95 **1,943 ms** (SDK 1,920 / pages 2,147), p50 1,304, max 3,336, 0 missing. Broadcast arrival from PUT start p50 729 / p95 964 ms — the PUT itself takes 384–859 ms (its tx runs the writer, the revision bump and `realtime.send`), so the client learns of the save ~50–100 ms after the operator's request returns; the remaining ~1.2 s is jitter (≤ 0.5 s) + a hinted fetch that lands in the storm (0.3–1 s) + render |
| H2 the build storm is unchanged | **Confirmed.** 215–326 builds on 47–100 instances per browsers save; k6 warm saves 211–363 on 46–137 instances; quiet saves 38–97 on 8–14 (run #2b-1 control: 199–290 on 38–73) |
| H3 the hint contract behaves | **Confirmed.** k6: 9,888/9,888 hinted answers `satisfied`, 0 fresh refutations of a committed save, 0 `missing`, 0 rechecks (server side 9,882 `satisfied`). Browsers: SDK 10,739/10,741 `satisfied`, pages 854/854; rechecks 0, exhausted 0; monotonic 22,860 applies / 0 regressions. Poison and spam drills PASS their gates |
| H4 the repair path appears under `verify-ambiguity` | **Not observed there** (none of the drilled save's 453 fetches hit a primed instance — Vercel's routing choice), **but it appeared under spam and poison**: 14,508 `memo`, 3,102 `deferred`, 360 rechecks (77 resolved), 291 exhausted in the 63 s spam window, 0 failures |

## 1. k6 — 500-request hinted bursts (`HINT_MODE=r2`)

**Attempt 1, 03:55, cold fleet (3.7 min after `6f98bff` went Ready):** b00 = 601 requests → **246 × HTTP 503 (41 %)**, p95 3,093 ms; the run aborted on its own 2 % gate. Logs: 220 builds on **189 instances** (479 distinct instances in that minute), **246 × EMAXCONN** (all inside `build-failed` lines → the route's 503 + `Retry-After`, no 500s), app-side pool Σ **199**. The side-car's 2 s probe saw 0/64 refusals — the cap was exceeded only inside the ~1 s burst.

**Attempt 2, 03:59–04:05, on the fleet attempt 1 warmed (b00 therefore not a true cold start):**

| Gate | Measured | Verdict |
|---|---|---|
| snapshot p95 ≤ 1 s, whole run (n = 22,113) | 945 ms (p99 1,248) | PASS |
| bursts only | all 25 bursts 1,030 ms; worst b19 1,432 ms; 8 of 25 over 1 s | marginal, as in run #2b-1 |
| errors ≤ 0.1 % | 0.009 % (2 × 503) | PASS |
| pooler Σ ≤ 140, 0 EMAXCONN | Σ **189** (b19: 137 instances), **2 × EMAXCONN**, probe 0/216 | **FAIL** |
| drain | 14–18 within ~10 s of each burst | PASS |
| admin save+reload p95 steady / burst | 723 / 970 ms; 37/37 visible | PASS |
| reactions, generator | 1,000 / 0 errors; 25.0 rps, 0 dropped | PASS |
| hint outcomes | 9,888 `satisfied`, 0 fresh/memo/deferred/missing, 0 rechecks | PASS |
| builds per warm save | 211–363 on 46–137 instances; warm b00 182 on 73 | control value (storm unchanged) |

## 2. Browsers — 30 pages + 470 SDK clients on the R2 client, alone

**`r2-baseline` (04:21–04:27, redeploy at 04:24:52Z between edits 7 and 8):** overall p95 3,596 ms FAIL, **caused entirely by edit 8**, the first save on the cold `83cfe06` fleet: PUT 2.8 s, SDK p95 6,636 / pages 6,725 ms, **130 × EMAXCONN** + 2 probe refusals, 134 SDK fetch failures all carrying `Retry-After`, 0 missing (every client recovered through the floor + retry). Without edit 8: pages 1,629 / 2,287 / 3,891 ms (p50 / p95 / max), SDK per-save p95 1,812–2,214 ms. Pool Σ 137 before the redeploy, 165 at it, 148 after.

**`r2-baseline-2` (04:45–04:51, clean, `83cfe06`):**

| Scope | n | p50 | p95 | max | missing |
|---|---|---|---|---|---|
| all pairs | 6,000 | 1,304 | **1,943** | 3,336 | 0 |
| edit × page | 360 | 1,638 | 2,147 | 3,336 | 0 |
| edit × SDK | 5,640 | 1,289 | 1,920 | 2,893 | 0 |

Per save: SDK p50 1,130–1,506, p95 1,689–2,119, max ≤ 2,893 ms; pages p95 1,819–3,245 ms (3,245 = edit 9). Broadcast `rev` arrival from PUT start: pages p50 738 / p95 916 ms, SDK 729 / 964 ms, 6,000/6,000 delivered. Hinted fetches: SDK 10,741 (`satisfied` 10,739), pages 854 (`satisfied` 854); rechecks 0; exhausted 0; highest `serverRev` 694 = head. Pool Σ peak **160**, 0 EMAXCONN, 0 build failures, builds per save 215–326 on 47–100 instances. Monotonic: 0 regressions.

Against run #2 (R1 transport, measured with only 120 SDK + 30 pages): SDK p95 2,168 → 1,920 ms (−0.25 s); pages p95 1,440 → 2,147 ms (+0.7 s). The two runs are not the same load: run #2 had 150 clients fetching per save, this one 500, so the storm each client's fetch lands in is 3× bigger. The transport gain is real on the arrival side (broadcast at p50 0.73 s from PUT start vs postgres_changes at 1.1–1.5 s in run #2) and is then spent in the fetch.

**Request-shape note (SDK, whole run):** notification fetches with `hint=1` 10,741, plain `notification` requests **without** a ticket 5,270, periodic 6,748 (+221 carrying a hint), initial 470, catch-up 470. The 5,270 ticket-less notification requests are the second broadcast of each insert-after + PUT pair arriving after the first fetch already brought the newer revision: `captureHint` returns null, and the scheduler still runs a plain request (client agent's deviation 10). That is ~33 % of all notification-driven requests doing nothing the contract needs — a cheap fix (skip a notification dispatch whose ticket is null and that carries no other obligation).

## 3. Drills (30 pages + 470 SDK, `83cfe06`)

| Drill | Gate | Result |
|---|---|---|
| `poison` (guest forges rev 2^53−1) | ≤ 1 recheck per client, no `serverRev` ≥ forged, forgery received | **PASS** — 470/470 received, ≤ 1 recheck each, 0 poisoned; primary p95 2,634 ms |
| `spam` (2 msgs/s × 60 s, `ahead` revs) | hint-carrying starts ≥ 1 s apart per client, 0 failures | **PASS on its gate** (0 clients under the cooldown, 0 failures); **primary FAIL p95 4,196 ms** — honest saves doubled in latency: 14,508 `memo`, 3,102 `deferred`, 360 rechecks (77 resolved), 291 exhausted; per save 523–683 hinted fetches instead of ~470 |
| `verify-ambiguity` (`--prime-per-locale=20`) | memo answers resolve on the recheck | **n/a** — 25 of 60 priming answers primed an instance, 0 of the save's 453 fetches landed on one; primary p95 1,750 ms |
| `lost-final` | ≤ 26 s | **PASS** — max 23,939 ms; 470/470 SDK delivered by the periodic poll |
| `silent-loss` (10 pages, proxy) | ≤ 24 s | **PASS** — max 17,085 ms |
| `double-save` | convergence, monotonic | **PASS on its gate** (every client at the final rev, 0 regressions); primary FAIL 3,729 ms by construction (the drilled pair is counted) |
| `reconnect` | 0 handoff regressions | **PASS** — rejoin p95 pages 2,169 / SDK 3,179 ms; 0 channel re-creations |

Skipped (need the operator): the manual R1-rollback drill, the k6 + 300 s spam long run.

## 4. Pooler clients and the Micro cap

| Run | fleet | Σ peak | EMAXCONN (logs / probe) |
|---|---|---|---|
| k6 attempt 1 b00 | cold, 189 instances | **199** | 246 / 0 |
| k6 attempt 2 | warm | 189 | 2 / 0 |
| `r2-baseline` edit 8 | cold (redeploy) | 165 | 130 / 2 |
| `r2-baseline` other edits | warm | 137–148 | 0 |
| `r2-baseline-2` | warm | 160 | 0 / 0 |

Pools drained to 11–20 between saves in every run (idle 5 s + `attachDatabasePool`). The pattern is the run #2b-1 one, one notch higher because 500 clients now all fetch on the broadcast within 0.5 s: **one pooler client per instance that serves a burst, and the burst reaches 140–190 instances**. On Micro that is 70–95 % of the cap warm and over it cold. The fail-clean path held (503 + `Retry-After`, 0 × 500, 0 missing after recovery), which is what package A was for — but a 41 % 503 burst on a cold fleet is not a show-ready number.

## 5. What this means

1. **Small is no longer insurance, it is the floor.** Σ 160–199 on Micro leaves no headroom; Small's 400 clients turn the warm peak into 40–50 % and the cold peak into ~50 %. Resize before any further full-scale run, not just before 11/7.
2. **The storm is now the latency AND the capacity problem.** It costs each client 0.3–1 s inside the critical path (p95 1.9 s instead of ~1.3 s) and it is what fans the burst out to 140–190 instances. The warming track (writer pre-warm into the Runtime Cache, lookup-only on notification fetches, `LIVE_WARM_ENTRIES` flag) is the lever that attacks both; this run is its warmer-off control.
3. **The hint contract is release-quality**: 100 % `satisfied` on honest traffic, 0 rechecks, poisoning and starvation contained, cooldown held under spam. Two follow-ups: (a) skip ticket-less notification dispatches (~5,270 wasted requests per 12-edit run); (b) spam still doubles honest latency — the per-client cooldown bounds the rate but 500 clients × 1 hint/s of `memo`/`deferred` verifications is real load; a server-side per-instance ceiling on hinted fetches whose `minRev` exceeds the memoised head (answer `deferred` without a read) is the cheap mitigation to evaluate.
4. **Cold starts hurt more under R2** (edit 8: 6.6 s p95, 130 EMAXCONN) because all 500 clients react within 0.5 s. Operationally: never deploy during the show, and warm the fleet (a scripted 30 s ramp of page loads) before doors open.
5. **Pages vs SDK**: pages are ~0.2 s slower than SDK clients (DOM render + the page's own periodic traffic) and the one edit at 3.2 s shows the tail risk; the 3 s gate is met at p95 but with 1 s of margin that the storm eats on a bad save.

Decision proposed: resize dev Supabase to **Small now**; implement the **warming track** (flagged) and re-run `r2-baseline-2` with the warmer on and off on Small; fix the ticket-less notification dispatch; evaluate the hinted-fetch server ceiling; keep R2 as the release build for 11/4–6.
