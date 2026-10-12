# n14 qualification — step 7: 5-minute guest spam + real saves + background k6 (2026-10-12)

Candidate: dev HEAD `978de71`; the alias `opensetlist-git-dev-opensetlist-projects.vercel.app` served the ON-C build (`dpl_5nR6mGHXsx2z1TsgChikER9ZHB5q`, deployed in step 6 from that commit) for every run. Warming ON, Supabase Small (Supavisor pool 15 backends / 400 clients), Prisma pool `max: 2`, `connectionTimeoutMillis` 5 s, rev memo 1 s. **Harness only — no `src/` change in this step** (branch `feature/n14-qual-step7`, PR #589). Design: Codex-agreed, 2 rounds (wiki Decisions log 2026-10-12; "Qualification runs — definitions → Step 7"). Verdicts: VALID + PASS / VALID + FAIL / INVALID (host corruption only) / NOT EXERCISED (insufficient declared exposure); a resource gate without complete log evidence reads UNESTABLISHED, never PASS.

## Summary

| run | spam | exposure | honest saves | drain | watermark | server (Σ / EMAXCONN / writer acquire) | verdict |
|---|---|---|---|---|---|---|---|
| P0 | none | n/a | 18/18 2xx; SDK p95 per save 1.70–2.64 s, missing 0; pages p95 1.24–2.28 s, **missing 1** (page 10: HTTP 500 on its document load during the join, never joined) | PASS (26 req/s 10 s after the scheduled end) | PASS | 98 / 0 / 18 ms, complete | VALID + FAIL (pages missing 1; cooldown 986 ms once) — the service's gates PASS |
| P1 | `ahead` 2/s × 300 s | EXERCISED (600/600, timely ≥ 99.7 %) | **0/18 — every save 503 `db_busy`** | PASS (21.5 s) | PASS | Σ 173 / EMAXCONN 0 / no writer line (pre-transaction failure); **32,135 failed builds**, 912 SSR error records; complete | **VALID + FAIL** |
| P2 | `max` 2/s × 300 s | EXERCISED (600/600) | **0/18 — every save 503 `db_busy`** | PASS (21.5 s) | PASS | Σ 271 / **EMAXCONN 55** / no writer line; 32,316 failed builds, 899 SSR error records, 231 instances; complete | **VALID + FAIL** |
| P3 | `stale` 2/s × 60 s | EXERCISED (120/120) | 3/3 2xx; SDK p95 2.06 s, pages 1.71 s, missing 0 | PASS (12.5 s) | PASS; 56,400/56,400 eligible stale hints ignored | Σ 26 / 0 / 24 ms, complete | VALID + PASS |

**Finding.** A guest flooding the public channel with a `rev` the cache cannot satisfy (`ahead` or `max`) saturates the database connection pool on every instance for as long as the flood lasts. Consequences, in order of severity: **every honest save fails** (12/12 in P1 and in P2, 503 `db_busy`); **every server-rendered page load fails** (about 900 error-level SSR records per run, matching k6's 2.5 req/s of fresh visitors, `timeout exceeded when trying to connect`); reactions and impressions time out; in P2 the pooler's 400-client cap was reached (EMAXCONN 55, 231 instances in the first spam minute). What survives: the **open** pages and SDK clients keep showing the last committed setlist (their fetches are answered from the stale cache: 0 × 5xx on reads, forged revs never enter durable state) and the request rate drains within 22 s of the last message. A stale forged rev costs nothing (P3). **Decision (owner, 2026-10-12): accepted as a known limitation; no fix, no re-qualification; step 8 proceeds on the unchanged candidate** (see "Decision"). The owner took that decision on the write-path result; the SSR consequence was found afterwards in the server logs and is recorded here for the same decision.

## Question

A guest can send to the public channel `event:<id>`. If one sends forged `{ kind: "setlist", rev }` broadcasts at the show rate (2 msgs/s to 500 subscribers, about 1,000 deliveries/s) for 5 minutes, do the operator's honest saves still reach every open page and SDK client within 3 s, with 0 missing and 0 × 5xx, and does the server's request rate drain afterwards?

## Procedure (identical for every run)

`scratchpad/drills/step7-run.sh <P> <spam-rev>`, then `step7-post.sh <P>`:

1. 70-row fixture on dev event 111 (`fes-rows.mjs --target=70 --anchor-reserve=1 --expect-rows=23`; 46 clones, no broadcast), then the side-cars `pooler-clients.mjs` and `supavisor-backends.mjs`.
2. k6 `viewers.js` as the ONE declared background process (`POLL_RPS=1 SSR_RPS=2.5 REACTIONS=500 REACTION_AT≈338 ADMIN_CYCLES=0 QUIET_CYCLES=0 COLD_START=0 HINT_MODE=r2 DRAIN_S=0 STEADY_START=0`, steady 683 s); its Windows pid is handed to the harness as `--declared-process`.
3. `run.mjs --phase=spam7 --pages=30 --subs=470 --edit-mode=mixed --baseline-secs=60 --spam-secs=300 --recovery-secs=60 --spam-rate=2 --spam-rev=<P> --save-offsets=10,35,…,285 --strict-host --restore-positions`: join (30 pages + 470 SDK), served snapshot verified against the DB, anchor, settle, then **baseline 60 s, spam 300 s (12 mixed edits = 6 insert+PUT pairs + 6 standalone PUTs, never retried), recovery 60 s, measurement end**, then soft-delete and position restore.
4. After the measurement: fixture `--cleanup --publish`, `restore.mjs --compact --yes`, fixture `--verify`; then `history-fetch.sh` (20 disjoint slices, saturation judged by request-record count, second pass at least 60 s later for delayed `after()` lines) and `spam7-join.mjs` (history × k6 summary × side-cars; log completeness + reconciliation).

Sender payload `{ kind: "setlist", rev, runId, k }`; `ahead` = post-preparation head + 1 refreshed from every save's response, `max` = 2^53 − 1, `stale` = the sender's latest committed rev. Receivers record `(runId, k, serverRev)` on handler entry, before the app classifies the message; `k` never reaches acceptance or scheduling.

## Runs

| run | spam | saves | k6 | result files |
|---|---|---|---|---|
| P0 | none (control) | 12 at +10 … +285 s | declared; ended 44 s before the recovery end (steady 515 s was too short; fixed for P1+) | `2026-10-12T21-20-13-998Z-browsers-spam7.{md,json}`, `join-step7-P0.md`, history `…T21-10-17Z-vercel-logs-history-step7-P0.txt` |
| P1 | `ahead` 2/s × 300 s (600 msgs) | 12 at +10 … | declared, covered the window | `2026-10-12T21-41-34-479Z-browsers-spam7.{md,json}`, `join-step7-P1.md` |
| P2 | `max` 2/s × 300 s | 12 at +10 … | declared | see below |
| P3 | `stale` 2/s × 60 s, head held fixed | −20 s, +70 s | declared | see below |

Not run, by the owner's decision after P1 (2026-10-12): P1r (phase-shifted repeat), P4 (10/s stress) and P5 (no k6). They would only sharpen a fix decision that was not taken; see "Decision".

Two earlier P0 attempts aborted before the measurement (operator script: the harness's `--declared-process` needs the Windows pid, not Git Bash's `$!`; a fixture manifest is never overwritten; the fixture waits for 120 s of quiet). Artifacts `*-P0-attempt1.*`; event 111 was restored and verified after each.

## P0 — control (no spam): VALID + FAIL on two gates, neither the service's

| gate | value | verdict |
|---|---|---|
| honest latency per save — SDK (470) | every save PASS; p95 per save 1.70–2.64 s, aggregate p95 2.09 s, max 3.34 s (1 of 5,640 pairs > 3 s), missing 0 | PASS |
| honest latency per save — pages (30) | p95 per save 1.24–2.28 s; **missing 1 on every save** (page 10, see below) | FAIL |
| writes | 18/18 2xx, never retried; PUT p95 1.00 s; writer acquire max 18 ms over 19 writes, every one with its `[liveWriter]` line | PASS |
| 0 × 5xx in the window | 0 (SDK, pages, saves, probe) | PASS |
| drain | baseline μ 24.97 req/s, s₁₀ 2.85, threshold 37.45; spam-phase mean 53.7 (saves only), recovery 24.8; confirming interval 10 s after the scheduled attack end at 26.2 req/s, tickets 0/0/0, rebound 0 | PASS |
| cooldown (ticket-carrying requests ≥ 1 s apart per client) | 1 pair at 986 ms on 1 client (21:15:52.930Z) | FAIL |
| durable watermark | 8,900 serverRev changes, 0 forged values | PASS |
| Σ / EMAXCONN (server logs, complete evidence) | Σ peak 98 (reported 31), EMAXCONN 0 | PASS |
| k6 background | poll 1.00 rps, SSR 2.49 rps, 501 reaction pairs; 3 SSR failures of 1,284 (status codes are not in the k6 JSON, so 5xx for k6 is **unestablished**); ended 21:19:16Z before the recovery end, so the background is **NOT EXERCISED** for the last 44 s | — |

- **Page 10 never joined.** Its document load returned **HTTP 500 at 21:10:59Z**, during the 500-client join and before the measurement window. The server log for that minute holds 10 error-level records, all `GET /ja/events/111/…` SSR, and 9 `[liveSnapshot] build-failed … Transaction API error: Unable to start a transaction in the given time` (5.0 s) on 3 instances (`09db38f5` ×3, `1d4b4c3c` ×2, `3a62f2ef` ×4) plus `timeout exceeded when trying to connect`. The fixture had just moved the event to 69 rows without a broadcast, so every instance built on its first arrival (414 reader builds in the join minute across 89 instances) and some could not get a pooler backend within 5 s. The three failed k6 SSR requests are the same event. Step 5 (fresh deployment, check save before admission) did not show this; here the join hit a long-running deployment whose cache had just been invalidated. Under the fixed-population rule the page counts as missing on all 12 saves; the SDK gate and the 29 joined pages are the honest-latency baseline for the control.
- **Cooldown 986 ms.** One pair on one client; worker 0's event loop lagged up to 427 ms in the same second (heartbeats 21:15:51–53Z), so the harness's `Date.now()` at the runner can trail the scheduler's dispatch clock by more than the 14 ms shortfall. Reported as measured. The server-side peak stays bounded (notification fetches 463/s at a save, rolling 10 s max 123.9 req/s).

## P1 — `ahead` 2/s × 300 s with k6: VALID + FAIL — every honest save failed

Exposure **EXERCISED**: 600/600 sent (0 skipped, send − slot p95 14 ms), ack 600/600, ack p95 157 ms; timely receipts (≤ 2 s) 99.7–100 % of planned in every 10 s bucket for SDK and pages; per-client coverage ≥ 95 % for all 500. Host valid (lag, heartbeats and CPU within thresholds, mid-spam and end re-checks clean, browser probe max 4 ms); k6 covered the window.

| gate | value | verdict |
|---|---|---|
| writes | **0/18 2xx, all 12 edits lost**: every insert-after answered **HTTP 503 `db_busy`** after 2.3–2.8 s, every PUT 503 `db_busy` after 5.4–5.7 s; `[liveWriter]` has **no line** for any of them (pre-transaction failure: pool acquire timeout) | FAIL |
| honest latency (pages, SDK) | nothing to measure, 12 edits not saved | FAIL |
| 0 × 5xx | 12 (all saves); SDK 5xx 0, pages 5xx 0, hinted fetches answered 503: 0 | FAIL |
| drain | baseline μ 24.2, s₁₀ 10.9, threshold 45.9; spam-phase mean **101.0 req/s**, recovery 39.7; confirming interval completed 21.5 s after the last send (43.8 req/s), tickets 0/0/0, rebound 0 | PASS |
| cooldown | 0 too close, min gap 1,000 ms | PASS |
| durable watermark | 470 serverRev changes, 0 forged values | PASS |
| ticket-drop recovery | 470 forged tickets exhausted; nothing to recover (no committed revision) | NOT EXERCISED |
| Σ / EMAXCONN | Σ peak 173 (reported 124) at 21:35:15Z, EMAXCONN 0; complete evidence (40,079 records, 20 slices, 0 saturated, second pass +75 records) | PASS |

Server side per minute (join, complete evidence: 40,079 records, 20 slices, 0 saturated, second pass +75): hinted fetches 4,200–4,300/min (about 70/s), answered `deferred` 22,246 of 23,230 (memo 898, fresh 86, satisfied 0, answered 503: 0); warm lookups miss 3,300–3,600/min; **uncached rev-reads 4,849 in the window, 4,762 of them timed out**; **failed builds 4,400–6,000/min, 32,135 in the window** (`[liveSnapshot] build-failed … Transaction API error: Unable to start a transaction in the given time`, every one preceded by Next's `revalidating cache with key …event-live-snapshot`), successful reader builds 1,060 (646 in the first spam minute); pool-waiting lines only in the first minute (max 17); 38 instances steady (89 at the join, 90 in the window). Error-level records in the window: 912 `GET /ja|ko|en/events/111/…` SSR renders (`timeout exceeded when trying to connect`, the same failure that gave page 10 its 500 in P0) and 450 `/api/impressions`; k6 logged `request timeout` on SSR and on the reaction burst (k6 was stopped at the harness's exit, so it left no summary and its status counts are unestablished). Clients: 22,742 notification fetches (hint=1), ticket resolutions inconclusive 29,300, 470 hints exhausted, rechecks 442 (1.9 %), source cache 96 %.

Mechanism (`src/lib/liveSnapshot.ts`, `src/lib/prisma.ts`, `src/lib/liveWriterTx.ts`; from the logs, not re-tested in isolation): a forged `rev` the cache cannot satisfy makes every hinted fetch past the 1 s memo (a) perform the bounded uncached `SELECT "setlistRevision"` and (b) revalidate the Runtime Cache entry for the snapshot, which is a 70-row build inside an interactive transaction. With 38–45 instances and 70 hinted fetches/s, those builds (one per instance per locale per revalidation) and rev-reads all contend for the Supavisor pool of 15 backends; the builds fail at their 5 s transaction-start bound, the rev-reads at theirs, the stale entry is still served (`deferred`, HTTP 200), and the next hinted fetch starts the same two operations again. Each instance's two pool slots are therefore permanently occupied by waiting reads, so anything else that needs the pool on that instance fails: the writer's **pre-transaction lookup** waits `connectionTimeoutMillis` (5 s) and the route answers 503 `db_busy` (the insert-after's lookup is bounded at about 2.4 s); the event page's SSR queries (reaction counts, impressions) time out and the render fails; reaction and impression writes time out. Open clients are unaffected only because their reads are answered from the stale cache.

What the operator would see: every save answers "데이터베이스 연결이 혼잡합니다" for as long as the spam lasts; open pages keep showing the last committed setlist; visitors opening the page get an error; nothing distinguishes this from a database outage except the Supabase Realtime message rate.

## P2 — `max` (2^53 − 1) 2/s × 300 s with k6: VALID + FAIL — identical to P1

Exposure EXERCISED (600/600 sent and acked, ack p95 23 ms, send − slot p95 14 ms; timely receipts ≥ 99.7 % per bucket). Writes **0/18**: every insert-after 503 `db_busy` at 2.34–2.40 s, every PUT 503 `db_busy` at 5.35–5.41 s, no `[liveWriter]` line. SDK 5xx 0, pages 5xx 0, 3 malformed SDK responses (bodies that failed to parse; counted as errors, 0 × 5xx FAIL = 12 saves + 3). Drain PASS (baseline μ 24.5, threshold 44.8; confirming interval 21.5 s after the last send at 42.6 req/s; tickets 0/0/0; rebound 0). Cooldown PASS (min gap 1,000 ms). Watermark PASS (470 changes, 0 forged). Monotonic PASS. Host valid. The forged value does not matter: any `minRev` the cache cannot satisfy produces the same server behaviour.

Server side (join, complete evidence: 39,801 records, 0 saturated, second pass +20): the same shape as P1 — hinted fetches 23,114 (22,513 `deferred`, answered 503: 0), rev-reads 5,351 of which 5,278 timed out, **failed builds 32,316**, successful reader builds 864, 899 SSR error records, 454 `/api/impressions` errors — plus a worse first minute: **231 instances** in the spam's first minute (P1: 89), Σ peak **271** (P1: 173), **EMAXCONN 55 lines** (17 of them as `build-failed … (EMAXCONN) max client connections reached, limit: 400`), pool-waiting max 12 over 151 lines. The resource gate therefore reads **FAIL** for P2 (EMAXCONN present) and PASS for Σ (< 300). The scale-out is Vercel reacting to the slow, failing builds; nothing in the forged value itself differs from `ahead`. (The first join run for P2 was produced with P3's harness JSON by a file-picking mistake in the operator script and was discarded; `join-step7-P2.md` is the corrected join. k6 left no summary, as in P1.)

## P3 — `stale` 2/s × 60 s, head held fixed: VALID + PASS (ignore path works, costs nothing)

Timeline baseline 60 s / spam 60 s / recovery 60 s; one pair edit at −20 s (in the baseline), one standalone PUT at +70 s (in the recovery); the head (rev 1906) was verified on every client before the block and no save happened inside it. Sender 120/120 sent and acked (ack p95 31 ms). **Stale control: 56,400 eligible receipts (forged rev ≤ the client's own serverRev at receipt), 56,400 ignored, 0 noted**; 0 not-eligible receipts (no client was behind). Pages: 3,600 eligible frames (body-rev proxy). Writes 3/3 2xx (insert 968 ms, PUTs 878 / 507 ms); honest latency pages p95 1.71 s max 2.66 s, SDK p95 2.06 s max 2.70 s, missing 0; 0 × 5xx; cooldown min gap 1,000 ms; watermark 1,860 changes, 0 forged; drain PASS (confirming interval 12.5 s after the last send; the baseline μ 40.3 req/s and threshold 114.5 are inflated by the −20 s save inside the baseline, so this run's drain threshold is weak evidence — the rate itself, 74.5 req/s in the confirming interval, is the post-save recheck wave). A stale forged rev therefore produces no fetch at all: the server-side cost of the spam comes entirely from hints the cache cannot satisfy.

## Decision (owner, 2026-10-12): no fix, no re-qualification — recorded as a known limitation

The owner's assessment: a deliberate attack on OpenSetlist during the Fes is very unlikely, and the goal of this qualification is a service that stays stable under many ordinary users, not one hardened against a targeted broadcast flood. Step 7 therefore ends with the finding recorded, and step 8 (production verification) proceeds on the unchanged candidate. The release rule of 2026-10-11 ("pass → no new machinery; fail → fix or explicit acceptance") is satisfied by this explicit acceptance.

What the finding means for ordinary load (the actual goal): the pool saturation happens only when hinted fetches carry a `minRev` the cache can never satisfy, i.e. only with forged broadcasts. Honest broadcasts carry the committed rev, whose snapshot the warm job writes within about a second, so under real users the rev-read and any revalidation happen once per instance per save; the P0 control (500 clients, 12 saves, 70 rows, background k6) shows the writer acquiring in ≤ 18 ms, SDK p95 per save 1.7–2.6 s and Σ 98. Nothing in P1/P2 points at a capacity problem with 500 honest viewers; steps 4–6 cover that. The one ordinary-load observation worth carrying forward is P0's join: a 500-client arrival onto a long-running deployment whose cache had just been invalidated produced 9 failed builds and one page's HTTP 500 — the runbook's "check save before doors" (step 5) is what prevents that at the Fes.

Runbook note (what to do if it ever happens): the symptom is every save answering "데이터베이스 연결이 혼잡합니다", visitors opening the event page getting an error, open pages still showing the last setlist, and the Supabase Realtime dashboard showing a message rate far above the save rate. There is no in-app mitigation. Options at the time: wait it out (the server recovers within about 20 s of the flood stopping, as the drain gate shows), or disable the channel's public broadcast at Supabase (Realtime → channel policies) and let the 20 ± 4 s poll carry updates for the rest of the show.

If this limitation is ever to be closed, the candidates ranked by effort (not scheduled): (1) on a hinted fetch whose `minRev` the cache cannot satisfy, serve the cached entry without revalidating it and back off the uncached rev-read per instance (honest saves are served by the warm cache, so the cost falls on the warm-miss path only); (2) a dedicated single-connection pool for the live writers so reader storms cannot starve writes (does not protect SSR); (3) signed broadcasts (server-side key, clients verify) so forged hints are dropped before any fetch; (4) private channels, already rejected on 2026-10-10 because Realtime Authorization admits only about 3 joins/s.
