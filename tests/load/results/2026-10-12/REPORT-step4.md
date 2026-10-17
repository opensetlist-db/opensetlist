# n14 qualification step 4 — overlapping warm jobs (2026-10-12)

Step 4 of the Fes qualification order (harness validity → two flag-on 500 sessions → cache fault drills → **overlapping warm jobs** → cold admission → transition drills → spam → prod). Design: Codex discussion 2026-10-11 (2 rounds, converged) — qualify on **proven exposure** (server-clock evidence that the race actually happened), with a per-save fault header on the candidate so one of two overlapping saves can be made slow / failing deterministically.

## Setup

| item | value |
|---|---|
| candidate | branch `feature/n14-qual-step4` (PR #586 → dev): server `2f44e76` (fault header `x-live-warm-fault`, `slowset` / `slowbuild` modes, server-clock `at*` fields), harness `d05e947` (`--drill=overlap`, probes, `overlap-join.mjs`) |
| armed preview | `opensetlist-83prdlajn-opensetlist-projects.vercel.app` — one-off `vercel deploy` of the branch with `LIVE_WARM_ENTRIES=1 LIVE_WARM_FAULT_ARMED=1`, **no `LIVE_WARM_FAULT`** (header-only faults). Verified before the drills: a save with the header logs `fault=<spec> source=header`, a save without it has no `fault=`, `slow=400` / `bogus` → 400 |
| unarmed deployment | `opensetlist-j3p5jprkz-opensetlist-projects.vercel.app` — the branch's Vercel preview build of `d05e947` (Preview env: `LIVE_WARM_ENTRIES=1`, not armed). The dev alias still runs `52898bc` (PR #586 unmerged at run time), so the unarmed runs used the branch deployment instead of the alias — same code the alias gets after the merge. Header-ignored check on it at 03:58:47Z: PUT with `x-live-warm-fault: slowset=1500` → 200, rev 1446, all three locales `x-snapshot-source: warm` at +0.6 s (a 1.5 s slowset would have made that impossible) |
| database | dev Supabase **Small** (Supavisor pool 15, max clients 400), event 111, 23 live rows; `restore.mjs --compact --yes` after every run (final state 23 rows) |
| load host | 30 Chromium pages + 470 SDK clients (`--pages=30 --subs=470 --pause=25 --strict-host`), event-loop lag monitor on every thread; nothing else of ours during a run (an unrelated `next dev` of another project ran on the host from 03:05Z; every run's validity verdict is **valid** — lag and heartbeat gates never fired) |
| effective warm concurrency | one job per save, three locales via `Promise.all` on a per-instance pg pool of **max 2** (so a held build occupies the whole pool of its instance) |
| side-cars | `pooler-clients.mjs` (Supavisor client metrics, 2 s), `supavisor-backends.mjs` (backend states, 1 s). The backend sampler produced data for **S2 only**: its STOP-file path is its own directory, so S2's run script stalled 68 min after the harness finished (released by hand; the harness and restore were unaffected), and the `--out-dir` fix I added for S3+ used the wrong flag form (`--out-dir X` instead of `--out-dir=X`), so the sampler exited at start. Backend busy for S3+ is therefore **not available**; the pooler-clients peak backend count is reported instead |
| clocks | exposure classification uses the server function clock (`at*` = `Date.now()` on the instance) for writer commit / set / expiry; `captureAt` is PostgreSQL `now()` (a different clock); probe and client times are the load host's |
| logs | Vercel runtime logs re-fetched per run window (`history-fetch-par.sh`), summarised (`vercel-logs-summary.mjs`), joined (`warm-join.mjs`, `overlap-join.mjs`) — files `*-step4-<S>.md` in this directory |

Gates (per group, per population): all intended saves 2xx; 0 × 5xx anywhere; convergence to the group's head from the **last** save's request start p95 ≤ 3 s, 0 missing (pages: marker-derived DOM version; SDK: applied rev); DOM / (rev, capturedAt) monotonicity 0 regressions; PUT latency (original attempt) p95 ≤ 1.5 s per role; admin editor reloads 200 + complete + ≤ 3 s each; raw reactions p95 ≤ 1.5 s, 0 × 5xx; page reaction count never below the acknowledged value before a post-ack snapshot. Server: acquireMs ≤ 500 per save, 0 `pool_acquire_timeout` / 503, 0 EMAXCONN. Exposure minimum: ≥ 4/6 groups (S5: ≥ 3/6), else NOT EXERCISED and one re-run with the gap adjusted (both stay in the record).

## RB re-baseline vs step 2 (unarmed, 8 mixed edits, 500 viewers)

| metric | step 2 Session A (`0bfc67b`, dev alias) | RB (`d05e947`, branch deployment) | reading |
|---|---|---|---|
| save → visible, all pairs p50 / p95 / max | 1,354 / **1,671** / 2,386 (n 6,000) | 1,308 / **1,649** / 2,735 (n 4,000) | same |
| pages p95 / SDK p95 | 1,666 / 1,672 | 1,649 / 1,649 | same |
| missing / monotonicity regressions / 5xx / EMAXCONN | 0 / 0 / 0 / 0 | 0 / 0 / 0 / 0 | same |
| warm hits ÷ hinted fetches | SDK 9,864/9,867, pages 632/632 | SDK 6,706/6,706, pages 435/435 | 100 % both |
| warm-join: first hinted fetch after warm-complete; hit rate after / before | 98 %; 100 % / 99 % | 93 %; 100 % / 100 % | same |
| warm jobs (count × duration) | 12 × 94–258 ms | 18 × 96–232 ms | same |
| builds per save rev (summariser): PUT after an insert / standalone PUT over its 25 s life | 5–10 / 155–255 | 5–22 / 180–274 | same shape (standalone = periodic generic regenerations, as in step 2) |
| snapshot sources (SDK + pages) | — | warm 6,706 · cache 4,954 · build 431 | — |
| pooler peak backends (pooler-clients) | Σ 61 | 29 | — |
| retried saves / failed writer kinds | 0 / 0 | 0 / 0 | same |

**No observed regression** from the step-4 server change when unarmed (the change is header plumbing behind one env compare, two job-side fault modes, and extra log fields).

## Overview

| run | target | A fault / drill flags | validity | exercised | pages p50 / p95 / max | SDK p50 / p95 / max | missing | acquire max | PUT p95 A / B / C | reload max | 5xx / EMAXCONN | builds per save [start, +10 s] | peak backends | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| RB | unarmed | 8 mixed edits (step-2 line) | valid | — | 1,175 / 1,649 / 1,878 | 1,315 / 1,649 / 2,735 | 0 | — | — | — | 0 / 0 | see above | 29 | **VALID + PASS** |
| S0 control | unarmed | gap 3000 | valid | n/a (none intended) | 906 / 1,136 / 1,221 | 910 / 1,127 / 1,504 | 0 | 4 | 600 / 442 | — | 0 / 0 | 34.5–67.5 | 29 | **VALID + PASS** |
| S1 | unarmed | gap 250 | valid | **1/6** | 874 / 1,656 / 1,768 | 1,235 / 1,627 / 2,162 | 0 | 5 | 567 / 523 | — | 0 / 0 | 32.5–59 | 29 | gates PASS, **NOT EXERCISED** |
| S1b (re-run) | unarmed | gap 100 | valid | **1/6** | 883 / 1,683 / 1,793 | 1,328 / 1,711 / 2,543 | 0 | 4 | 485 / 492 | — | 0 / 0 | 29.5–66.5 | 29 | gates PASS, **NOT EXERCISED** |
| S2 | armed | `slowset=1500`, gap 250 | valid | **6/6** | 752 / 1,118 / 1,610 | 1,085 / 1,338 / 2,265 | 0 | 14 | 469 / 600 | — | 0 / 0 | 83–117.5 | 32 | **VALID + PASS** |
| S3 | armed | `seterror`, gap 250 | valid | **6/6** | 777 / 1,110 / 1,684 | 1,146 / 1,522 / 2,403 | 0 | 7 | 492 / 718 | — | 0 / 0 | 71–137 | 29 | **VALID + PASS** |
| S4 | unarmed | gap 250, C at 500, reloads 150 / 450 | valid | **0/6** | 1,454 / 1,716 / 1,817 | 1,429 / 1,738 / 2,290 | 0 | 5 | 480 / 557 / 614 | 970 | 0 / 0 | 22–49 | 29 | gates PASS, **NOT EXERCISED** |
| S4b (re-run) | unarmed | gap 60, C at 120, reloads 150 / 450 | valid | **4/6** | 868 / 1,785 / 1,999 | 1,496 / 2,090 / 2,600 | 0 | 25 | 653 / 720 / 702 | 904 | 0 / 0 | 19–32.7 | 29 | **VALID + PASS** |
| S5 | armed | `slowset=1500`, gap 250, catalog edit +400, 40 reactions, page reaction, quiet tail 120 s | valid | **4/6** (min 3) | 836 / 1,213 / 1,856 | 1,274 / 1,871 / 3,435 | 0 | 12 | 499 / 566 | — | 0 / 0 | 146.5–214.5 | 29 | **VALID + PASS** (stale late fill reproduced, see S5) |
| S6 | armed | `slowbuild=1500`, gap 250, C at 500, reloads, 40 reactions | valid | **6/6** | 2,177 / 2,668 / 2,859 | 2,164 / 2,690 / 2,874 | 0 | 166 | 493 / **2,286** / **1,847** | 708 | 0 / 0 | 64.3–127 | 30 | **VALID + FAIL** (PUT latency B, C) |
| S6b (informational) | armed | as S6 with `slowbuild=500` | valid | **6/6** | 1,458 / 2,193 / 2,589 | 1,458 / 2,223 / 2,994 | 0 | 342 | 458 / 1,330 / 881 | 718 | 0 / 0 | 57–77 | 30 | **VALID + PASS** |

Convergence is measured from the request start of the group's **last** original save to the group's head (highest committed rev); the first save's own latency is absorbed (informational columns in the per-run `.md`). All runs: 0 `pool_acquire_timeout`, 0 failed writer kinds, 0 EMAXCONN, 0 × 5xx on saves, reloads, catalog edits, reactions, probes, SDK and pages. Total `[liveSnapshot] build` lines per run window: RB 1,917 · S0 1,748 · S1 1,656 · S1b 1,521 · S2 2,383 · S3 2,407 · S4 1,879 · S4b 1,679 · S5 4,802 · S6 3,344 · S6b 3,082 (S5 and S6 include the catalog expiry refills and the slow jobs' reader fallbacks).

## Per-run

Full per-group exposure tables, commit → entry-stored offsets and probe results: `overlap-join-step4-<S>.md`; harness gate tables: `browsers-step4-<S>.out.log`; per-locale warm offsets: `warm-join-step4-<S>.md`.

### S0 — control (gap 3000)

B starts 3 s after A: no (i) / (ii), publication in order in every group, 0 misses during B. Builds per save 34.5–67.5 in [start, +10 s] — the drill's own cost baseline for the two-writer groups (the generic notification fetches of 500 clients land on 40–60 instances). PUT A p95 600 (one 600 ms save), B 442.

### S1 / S1b — two unfaulted writers (gap 250, then 100)

| run | group | B commit − A commit (ms) | (i) B during A's job | (ii) tx / build overlap | publication | exercised |
|---|---|---|---|---|---|---|
| S1 (250) | 1–6 | 234, 195, **106**, 145, 166, 246 | only g3 | only g3 (yes / yes) | in order except g3 indeterminate (< 100 ms cross-instance) | **1/6** |
| S1b (100) | 1–6 | 149, 93, **130**, 121, 124, 133 | g2, g3, g6 | g3 yes / yes; g2 no / yes; g6 no / no | g3 indeterminate, others in order | **1/6** |

Real warm jobs finish 60–200 ms after the commit (ja/ko sets ≈ 55–110 ms, en ≈ 100–250 ms), so a second save started 100–250 ms after the first commits after the first job has already published; the overlap that S1 wants (B commits while A's job is in flight AND their builder transactions overlap) occurred in one group per run and both of those groups converged in order with 0 misses. Both runs pass every gate (SDK p95 1,627 / 1,711; PUT p95 ≤ 567). **Reading:** the unfaulted two-writer overlap is not reproducible at a reliable rate on this deployment because the jobs are short — which is itself the measured fact; the mechanics of the overlap (reversed publication, failed set, held build) are qualified under injected faults in S2 / S3 / S6 where exposure was 6/6. The informational gap-600 run was dropped (gap 250 already does not overlap).

### S2 — A `slowset=1500` (publication of A's captured state delayed 1.5 s per locale), gap 250

Fault evidence: `[liveWarm] start … fault=slowset:1500 source=header` on exactly the 6 A jobs, no `fault=` on B. Exposure 6/6: B committed 170–300 ms after A, during A's job; **publication reversed in ja / ko / en in every group** (B's locale published 55–434 ms after its commit, A's 1,548–1,597 ms for ja/ko and 3,092–3,167 ms for en); A's en slot stored rev R+1 (`→N`) because the en build began after B committed. Probes: key R first `warm` at +2 s (ja/ko) / +4 s (en) after the group; key R+1 at +1 s. Misses on A's key during B's window 45–180 per group, all answered by the reader path. Gates all PASS (pages p95 1,118, SDK p95 1,338, 0 missing, PUT p95 469 / 600). Backend sampler (this run only): busy max 16 of 16 for 1–2 one-second samples around each save pair, tx age max 204 ms at the saves (461 ms once during the population join), 2 lock waits (join).

### S3 — A `seterror` (A builds, publishes nothing), gap 250

Fault evidence: `fault=seterror source=header` ×6; `[liveWarm] set … ok=false` 18 = 3 locales × 6 A jobs (set-error lines 18, job-failed 0, schedule-failed 0). Exposure 6/6 (A's failed sets while B warms). Misses on key R during B 45–180; every miss served by the reader build; B's key warmed normally (sets 55–434 ms after commit). Gates all PASS (pages p95 1,110, SDK p95 1,522, 0 missing, PUT p95 492 / 718).

### S4 / S4b — third writer + admin SSR during the jobs

S4 as designed (gap 250, C at +500, reloads at +150 / +450): 0/6 exercised (same reason as S1), all gates PASS — 12 in-window editor reloads 200 + content ok, p50 572 / max 970 ms; PUT p95 A 480 / B 557 / C 614. **S4b** (gap 60, C at +120): B committed 61–103 ms and C 112–176 ms after A; exposure **4/6** (g1, g2, g3, g5 with tx + build overlap; g2 publication reversed in all three locales because B committed first and A's job overtook it; g4 / g6 no tx overlap). Gates all PASS: pages p95 1,785, SDK p95 2,090 / max 2,600, 0 missing; PUT p95 653 / 720 / 702; reloads 12 × 200, max 904 ms; acquire max 25 ms. Three writers plus editor SSR on top of two in-flight jobs cost no acquire wait and no visible regression.

### S5 — catalog edit during warming (`slowset=1500`, catalog PUT at +400 ms, 40 raw reactions + 1 page reaction, quiet tail 120 s)

Per group: A (header fault) at 0, B at +250, `PUT /api/admin/songs/<dedicated song>` (title → `…-c<k>`) at +400 — `revalidatePublicData()` expires the Next public data tag and the Runtime Cache tag `warm-public-data` (every warm entry). Exposure (iv) — B published before the expiry AND A captured before it — in groups 2, 3, 5, 6 (ja + ko): **4/6 ≥ 3**. Groups 1 and 4: B's publication landed after the expiry (B's key was also wiped), so the stale-late-fill condition held but not the "fresh entry wiped" one.

**Content-proven staleness** (a `warm` answer after the expiry whose anchor-row title is the pre-edit one):

| group | expiry (start → done, server clock) | A captured before expiry (ja / ko) | stale `warm` answers ja / ko (probes of key R at +2 s / +4 s) | first → last stale probe answer |
|---|---|---|---|---|
| 1 | 03:33:00.201 → .206 | 299 / 298 ms | 2 / 2 | 03:33:02.416 → 03:33:04.417 |
| 2 | 03:33:25.223 → .229 | 310 / 310 | 2 / 2 | 03:33:27.436 → 03:33:29.448 |
| 3 | 03:33:50.161 → .190 | 322 / 322 | 2 / 2 | 03:33:52.377 → 03:33:54.378 |
| 4 | 03:34:15.160 → .186 | 338 / 361 | 2 / 3 | 03:34:16.461 → 03:34:19.462 |
| 5 | 03:34:40.126 → .134 | 282 / 281 | 2 / 2 | 03:34:42.321 → 03:34:44.316 (ko **censored**: still stale at the last probe) |
| 6 | 03:35:05.189 → .195 | 377 / 377 | 2 / 2 | 03:35:07.306 → 03:35:09.307, then the quiet tail below |

en never raced: with `slowset` the en build starts after the two 1.5 s ja/ko sleeps, i.e. after the catalog PUT, so it captured the new title. Per group the +1 s probe of key R was answered from the head (`cache→R+1`, new title) because A's entry did not exist yet; the +2 s and +4 s probes of key R were answered by A's late fill (captured pre-edit, published ~1.6 s after A's commit ≈ 2.2 s after the expiry) — **25 stale answers** in the six groups, all on the superseded key R, ja/ko.

**Duration — the quiet tail (group 6, probes every 10 s for 120 s on keys 1380 = A and 1381 = B):** 72 probes, 26 `warm`. Key 1380 ja/ko answered `warm` with the **pre-edit title 18 times, from 03:35:07.7 to 03:36:30.1** (≈ 85 s after A's publication), then stopped being warm — i.e. the stale entry lived until its `WARM_TTL_SECONDS` = 90 s TTL. Key 1380 en answered `warm` with the new title (its build was post-edit); key 1381 (the head) was never warm after the expiry (its entries were wiped and nobody rebuilt them through the warm path). So the stale late fill is **not a 2 s window but an entry that serves the pre-edit content for up to 90 s to any request whose hint is ≤ R on that locale**; a request for the head (R+1 or `minRev=R+1`) was fresh throughout. Pages and SDK clients followed the broadcast to the head and converged with the new content (0 missing; `warm-join` "served newer than key" 0); the editor's own saves were unaffected. Reactions: 240 raw POSTs p95 812 / max 1,276 ms, 0 non-2xx; page ack-hold exercised in group 2 — held snapshot rev 1373 showed count 0 (captured before the ack), acknowledged count 1, display never dropped below 1 until a post-ack snapshot → PASS. Convergence pages p95 1,213, SDK p95 1,871 / max 3,435 (the ack-hold page's group). Cleanup: 241/241 reactions deleted, 6/6 dedicated songs soft-deleted.

**Reading:** the late fill is real: a job whose capture predates the catalog edit publishes after the expiry, and that entry then lives its full TTL (90 s). The *chance* of it is bounded by the job's publication delay (injected 1.5 s here; real jobs publish within ~250 ms of the commit, so a real catalog edit has to land inside a ~250 ms window after a save to be affected), the *exposure* is bounded by the key: only a request whose hint is ≤ the superseded rev on that locale sees it, and only until the next save moves everyone to a fresh head. The probes asked for the superseded key deliberately; no page or SDK client did. Decision (design §0): no code fix for R1; runbook below; the warm-tag expiry stays.

### S6 — DB-held slow build on A (`slowbuild=1500`), C at +500, reloads, 40 reactions → VALID + FAIL on the PUT-latency gate

Fault evidence: `fault=slowbuild:1500 source=header` ×6; the held builder transactions are visible as `txEndAt − txStartAt` 1,534–1,699 ms (ja/ko in parallel on both pool connections) and the en build queued ~1.7 s for a connection then held 1.5 s itself → the A instance's pool (max 2) is saturated ≈ 3.2 s per group. Exposure 6/6 (tx + build overlap in every group).

| group | B instance = A's? | B PUT ms | C instance = A's? | C PUT ms | B / C acquireMs | writer `at` − A `at` |
|---|---|---|---|---|---|---|
| 1 | no | 409 | no | 807 | 3 / 141 | 232 / 893 |
| 2 | **yes** (23474348) | **2,286** | no | 489 | 81 / 6 | 2,106 / 546 |
| 3 | no | 428 | **yes** (c212c486) | **1,669** | 4 / 41 | 201 / 1,713 |
| 4 | no | 460 | no | 594 | 3 / 31 | 277 / 679 |
| 5 | **yes** (346ff1ce) | **1,978** | no | 503 | 80 / 54 | 1,826 / 602 |
| 6 | **yes** (4d2f9cb9) | **2,036** | **yes** | **1,847** | 166 / 88 | 1,825 / 1,881 |

Every slow PUT is a writer that Vercel routed to the instance running A's held job. Its `acquireMs` is small (41–166) because the wait is **before** `liveWriterTransaction`: the route's pre-transaction `findItemEventId` lookup queues on the instance's pg pool until the held build releases a connection (not counted in `acquireMs`; the writer `at` ≈ A + 1.8–2.1 s confirms). No `pool_acquire_timeout`, no 503, no 5xx, acquire ≤ 500 everywhere. Convergence still PASS (pages p95 2,668 / max 2,859; SDK p95 2,690 / max 2,874 — the late B/C commits move the clock origin, so the gate absorbs their wait) but close to the 3 s line; reloads 12 × 200, max 708 ms (none landed on a saturated instance); reactions p95 1,266 / max 2,165 (PASS). Monotonicity 0 regressions; publication reversed in g1 / g3 / g4 and "in order" where B committed after A's ja/ko had already published.

Scale check: the real build hold on this deployment, `txEndAt − txStartAt` over the 198 non-fault warm sets in S2 + S3 + S5 + S6, is **p50 38 / p95 108 / max 229 ms** — the injected 1,500 ms is ~14× the observed worst case. **S6b** (`slowbuild=500`, ~2.2× the real max): same mechanism, co-located B 1,191–1,330 ms (groups 2, 4, 6), C ≤ 881, all gates PASS, SDK p95 2,223 / max 2,994. So a co-located writer pays ≈ hold + queue, linearly; with real builds the penalty is ≤ ~0.5 s and invisible in the gates (S4b, acquire max 25 ms). The FAIL is recorded as **VALID + FAIL (PUT latency gate, under a 14× injected hold)**; the candidate's unfaulted behaviour under three writers is S4b.

## Runbook — catalog edits during a show

Catalog edits (`PUT /api/admin/songs/<id>` and any other `revalidatePublicData()` caller) are **outside the supported show workflow**. If one has to happen during a show: make a revision-bumping setlist save on **every** active event afterwards and verify the changed content in all three locales at the resulting heads (hinted fetch with `minRev=<head>` per locale → `x-snapshot-source` + the title). If that fails, or a strict freshness guarantee for catalog edits during shows is required, the release blocks on a separate invalidation design (catalog generation in the cache identity, reader lookup cost to be qualified). Measured in S5: a warm job whose capture predates the edit refills its key after the expiry, and that entry then answers requests for the superseded key (hint ≤ that rev, same locale) with the pre-edit content for up to its 90 s TTL (`WARM_TTL_SECONDS`); the head key is fresh. The revision-bumping save is what moves every client to a fresh head — do it on every active event, right after the catalog edit.

## Findings

1. **Overlapping warm jobs converge correctly** under every injected condition: reversed publication (S2, 18 locale reversals), a job that publishes nothing (S3, 18 failed sets), a DB-held build (S6/S6b, 36 held transactions), three writers plus editor SSR (S4b) — 0 missing, 0 monotonicity regressions, 0 × 5xx, 0 acquire timeouts across 11 runs / 144 drill saves + 8 RB edits / 5,500 clients. Convergence p95 1.1–2.7 s.
2. **Unfaulted overlap is rare by construction** (S1, S1b, S4: 1/6, 1/6, 0/6): real jobs publish ja/ko within ~55–110 ms and en within ~250 ms of the commit, so two admin saves must commit within ~100 ms of each other to overlap. Exercised groups converged in order.
3. **A DB-held build penalises co-located writers linearly** (S6/S6b): the per-instance pool of 2 is the ceiling; the wait sits in the writer's pre-transaction lookup and is invisible to `acquireMs`. Real holds are ≤ 229 ms (p95 108), so the real penalty is ≤ ~0.5 s; at a 14× injected hold the PUT gate fails (B p95 2,286, C 1,847) while convergence still passes.
4. **Catalog expiry during warming produces a stale late fill on the superseded key** (S5): 25 content-proven stale `warm` answers in the groups plus 18 in the quiet tail — the pre-edit entry of key R (ja/ko) stayed readable for ≈ 85 s, i.e. its 90 s TTL; the head key was fresh throughout and no page or SDK client saw stale content. Reachable only by a hint ≤ R; a real edit has to land within ~250 ms after a save to be captured at all. Runbook (revision-bumping save on every active event), no code fix (design §0).
5. **Unarmed candidate = step 2** (RB): p95 1,649 vs 1,671, 100 % warm hits, same builds-per-save shape.
6. Harness/ops: `supavisor-backends.mjs` STOP-file and `--out-dir=` handling cost the backend samples for S3+ (fixed in the run script for the next step; the sampler itself is unchanged); the Vercel firewall denies `POST /api/admin/login` after ~5 rapid logins from one IP (`X-Vercel-Mitigated: deny`, clears within a minute) — one login per run, so the harness never hits it; the step-3 "transient 403" was the same thing.

## Follow-ups (not for R1)

- Count the pre-transaction lookups in the writer latency log (or move `findItemEventId` inside the transaction) so a pool wait is attributable from the logs.
- Warm build vs writer pool: sequential locales, or a separate low-priority pool, or pool max 2 → 3 per instance (Supavisor budget: 15 pool / 400 clients — needs the cold-admission numbers from step 5 first).
- `supavisor-backends.mjs`: default the STOP file to the results dir of the current UTC date and accept `--out-dir X`.
- Firewall: document the login rate limit in the harness README; keep one login per run.
- Steps 5–8 as planned: cold admission with mixed tabs (+ first-save-after-join broadcast), ON↔OFF and R2→R1 transition drills, 5-min spam with real saves, prod verification.

## Files

`REPORT-step4.md` (this), `browsers-step4-<S>.out.log` / `.err.log` (harness output per run), `overlap-join-step4-<S>.md`, `warm-join-step4-<S>.md`, `vercel-logs-history-summary-step4-<S>.md`, `backends-step4-S2.md`, `<stamp>-browsers-overlap.md` / `<stamp>-browsers.md` (harness result markdown), `<stamp>-pooler-clients.csv`, `2026-10-12T02-13-02-947Z-supavisor-backends.csv` (S2), `pooler-clients-step4-<S>.out` / `.err`, `supavisor-backends-step4-<S>.out` / `.err`. Not committed: `*.json`, `*-timelines.jsonl`, `*-vercel-logs-history-*.txt`, `*-pooler-metrics.txt`.
