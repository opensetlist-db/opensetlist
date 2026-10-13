# n14 qualification — step 8: production verification of v0.19.0 (2026-10-13 UTC)

The live setlist path shipped to production in v0.19.0 on 2026-10-12 (main `8953a6a`, PR #591). Step 8 proves the production side of what steps 1–7 proved on dev: the release landed cleanly, the wake procedure works on opensetlist.com, Instant Rollback and promotion propagate on the production domain, and a rollback target exists. **Not a load test**: a handful of instrumented listeners and page loads, nothing else. Everything the tooling did was GET + Realtime subscribe with the public anon key; every write was the operator's, in the production admin UI. Verdicts: PASS / FAIL / NOT EXERCISED per check. Tooling: `observer.mjs --prod-readonly`, `wake-check.mjs`, `transition-sampler.mjs`, `attribution-smoke.mjs` (PR #593). Runbook: wiki `output/n14-step8-prod-runbook.md`.

## Summary

| check | result | verdict |
|---|---|---|
| A release | schema migrated and verified before the tag; tag deploy green; **4-minute schema race** at the merge (Vercel deploys `main` on merge, not on the tag): 15 SSR 500s on `/ko/songs/*` 23:19:27–23:20:21Z, 0 after | PASS with an incident recorded; release flow corrected (PR #594) |
| B wake procedure (fixture event 109) | save 1 (rev 4) and save 2 (rev 5): every listener (3, then 4 incl. a fresh one) received the exact rev within 5 ms of each other, 0.5 s after the save; 6/6 live pages DOM ≤ 1.13 s after the frame; poll-only page by the poll in 2.0 s; post-save pages SSR-seeded in all three locales; hinted fetches `warm`; 0 reloads / errors / 5xx; sockets never closed | PASS |
| C Instant Rollback → warming-OFF twin → promote back | leg 1 (rollback): first OFF answer 5.1 s after the CLI started, old deployment's last answer 4.3 s later, sustained from +9.6 s; save 3 (rev 6) at +80 s reached 2/2 listeners and 3/3 pages, arrivals on the OFF deployment SSR-seeded; leg 2 (promote): first ON answer 6.3 s after the CLI started, old tail 1.0 s, sustained from +6.3 s; save 4 (rev 7) reached 2/2 and 3/3; 1,236 API samples all 200 | PASS |
| D logs | one `[liveWriter]` line per save (revs 4–7), acquire 3–4 ms, exec 19–71 ms; 0 error-level records in the B and C windows on both deployments | PASS |
| E prerequisites | Supabase **Micro** (Small from 10/20), Vercel Pro icn1, `LIVE_WARM_ENTRIES=1` frozen before the tag, backup 38321328762, spend cap OFF; R1 leg of the rollback NOT EXERCISED (never released); tenant-idle NOT EXERCISED | recorded |

Rollback targets on record: ON `dpl_84mZdx7b4ES7hafdQSNr9zagHrzk` (`opensetlist-p37dyza6i`, serving), OFF twin `dpl_8trbJx15YxL3tF9dexocYu2eJFq3` (`opensetlist-q2c51htwx`, same commit, `LIVE_WARM_ENTRIES=0`, proven by this drill), last resort v0.18.1 `dpl_DiKeQVWjYrTN7PybRPHJs92ENjkf` (no live path, pages poll; its return transition NOT EXERCISED).

## A. Release record

| step | when (UTC) | evidence |
|---|---|---|
| PR #590 notes → dev, #592 main → dev (observer-workflow conflict), #591 dev → main merged | 2026-10-12 23:07 / 23:12 / 23:16 | main `8953a6a` |
| **Vercel Git integration deployed `main` to production at the merge** | 23:16:16 | `dpl_84mZdx7b4ES7hafdQSNr9zagHrzk` (ON) |
| `backup.yml` dispatch | 23:17–23:19 | run 38321328762 success |
| `migrate-prod.yml` dispatch on `main`: `prisma db push` + `post-deploy.sql` + `db pull --print` shows `setlistRevision BigInt @default(0)` | 23:20:22 | run 38321514995 success |
| `LIVE_WARM_ENTRIES=1` added to the Vercel production env | 23:19 | `vercel env ls production` |
| annotated tag `v0.19.0` on `8953a6a` → tag-triggered migrate-prod (no-op) | 23:25 | run 38321908360 success |
| incident: new app on the old schema | 23:16–23:20 | 15 error records, all `GET /ko/songs/<id>` SSR, `The column t4.setlistRevision does not exist`, first 23:19:27.61, last 23:20:21; 0 errors 23:21–23:40 |

The memory/CLAUDE.md assumption "production deploys on the tag" was wrong: the Vercel Git integration deploys `main` on the merge; the tag only runs `migrate-prod`. Corrected order (PR #594): backup → `migrate-prod.yml --ref dev` → verify → merge → tag. The additive column was harmless to v0.18.1 while it served, which is why the order can be swapped safely.

Realtime prerequisites on production were verified by the operator on 2026-10-11 (`realtime.send` present, committed delivery, publication tables); not re-run after the migration (the B receipts are the functional proof: 4 broadcasts, 4/4 revs delivered).

## B. Wake procedure on production (fixture event 109 `/ko/events/109/smoke-test-v0190`, created by the operator, 3 rows, ongoing)

Tools: observer `--prod-readonly` 3 listeners (ja/ko/en) + 1 fresh listener at +600 s; wake-check 2 live pages × ja/ko/en + 1 poll-only (WebSocket blocked) + 3 post-save pages; all SUBSCRIBED / READY before the first save (listeners 00:51:31Z, pages 00:52:27Z, baseline rev 3). Operator saves: save 1 insert (rev 4) 00:54:07Z; save 2 delete (rev 5) 01:01:45Z.

| | rev 4 (insert) | rev 5 (delete) |
|---|---|---|
| listeners that received the exact rev | 3/3 eligible (spread 5 ms; first receipt 00:54:07.654) | 4/4 incl. the fresh listener (joined 01:01:31.5, spread 5 ms; 01:01:45.565) |
| follow-up hinted GET | 200, body rev ≥ rev, `warm` / `satisfied` | same |
| live pages: broadcast frame | 6/6 | 6/6 |
| live pages: DOM ≤ 3 s after the frame | 6/6, worst 751 ms | 6/6, worst 1,127 ms |
| poll-only page (0 frames) | showed rev 4 1,970 ms after the first live frame (budget 9 s) | — |
| post-save pages (ja/ko/en, opened +5 s) | 3/3 SSR-seeded at rev 4, first paint = live content; load 647–1,166 ms | — |
| hygiene | 0 reloads, 0 page errors, 0 × 5xx, 6/6 sockets never closed, 10/10 pages visible, 10/10 served by `dpl_84mZ…` | |
| server | `[liveWriter] route=admin-create acquireMs=3 execMs=68 rev=4` · `admin-delete acquireMs=4 execMs=28 rev=5` (instance `077fbf0a`); 686 records 00:53–01:03Z, 0 errors; hinted fetches answered `x-snapshot-source: warm` (warm-job log lines did not appear in this export) | |

Wake-check verdict **PASS** (2 of 2 expected saves observed); observer: every rev reached every eligible listener, fresh-listener check PASS. Clock caveat: all times are the receiver host's clock (UTC); the save times are the writer's `at` (server clock) ± NTP skew. Files: `2026-10-13T00-51-30-831Z-observer-prod-step8-B.{md,json}`, `2026-10-13T00-52-13-170Z-wake-check-step8-B.{md,json}`, `2026-10-13T00-53-00Z-vercel-logs-history-step8-B.txt`.

T−10 rehearsal, read-only, on the real Fes event 107: `attribution-smoke.mjs` 14/14 requests attributed to `dpl_84mZ…`, SDK and page fetches 200, hinted fetches `satisfied`; the canonical document after the 308 redirect had no request id recorded (tool limitation, row 12). `2026-10-12T23-34-41Z-attribution-smoke.{md,json}`.

## C. Instant Rollback and promotion on the production domain

OFF twin built with `vercel deploy --prod --skip-domain -e LIVE_WARM_ENTRIES=0` from `8953a6a` (01:04Z, `dpl_8trbJx15YxL3tF9dexocYu2eJFq3`), not promoted. Per leg: transition sampler on `/ja/events/109/smoke-test-v0190` + `/api/setlist` every 250 ms, 2 observer listeners, wake-check 1 live page × ja/ko/en + 1 poll-only + 3 post-save pages, all ready before the switch.

| | leg 1: `vercel rollback` → OFF | leg 2: `vercel promote` → ON |
|---|---|---|
| CLI start → "Success" | 01:09:18.5 → 01:09:23.4 (2 s reported) | 01:12:55.8 → 01:13:01.0 (2 s reported) |
| first document answer from the target | 01:09:23.66 (+5.1 s) | 01:13:02.16 (+6.3 s) |
| last answer from the old deployment | 01:09:27.91 (tail 4.25 s after the first target answer; 7 flips) | 01:13:01.90 (tail 0.99 s; 3 flips) |
| sustained on the target from | 01:09:28.16 | 01:13:02.16 |
| API samples | 733 × 200, 0 errors | 503 × 200, 0 errors |
| open pages / listeners across the switch | 3/3 live pages kept their socket; 2/2 listeners connected | same |
| operator save after the switch | save 3 insert rev 6 at 01:10:39Z: listeners 2/2 (2 ms spread), frames 3/3, DOM ≤ 571 ms, poll-only 668 ms | save 4 delete rev 7 at 01:13:24Z: 2/2, 3/3, poll-only 1,491 ms |
| arrivals on the new deployment (post-save pages) | 3/3 SSR-seeded at rev 6 (OFF twin) | 3/3 SSR-seeded at rev 7 (ON) |
| server | OFF twin: `[liveWriter] admin-create acquireMs=3 execMs=71 rev=6` (instance `3e40e52d`), 1,706 records, 0 errors | ON: `admin-delete acquireMs=3 execMs=19 rev=7`, 1,239 records, 0 errors |

Both legs: sampler **SWITCHED**, wake-check **PASS** (1 of 1 expected save), no 5xx anywhere. Compared with dev step 6 (`vercel alias set`: first target answer 4–7 s, old tail 1–3 s): the same order of magnitude; the rollback leg's longer tail (4.3 s) is within the "both answer for a few seconds" expectation. Auto-assignment: after `vercel promote` the domain follows the promoted deployment; the earlier `rollback` state was superseded (CLI reported success both times; no pending rollback left — `vercel rollback status` not needed). Files: `*transition-sampler*step8-C1|C2*`, `*observer-prod-step8-C1|C2*`, `*wake-check-step8-C1|C2*`, `2026-10-13T01-05-00Z-vercel-logs-history-step8-C-<dpl>.txt`.

Operator-script lessons (not findings): Git Bash rewrites `/events/…` arguments into Windows paths (`MSYS_NO_PATHCONV=1` in `step8-C.sh`); the worktree must be on a commit that contains the tooling (the first C1 attempt ran at the release commit). Attempt logs kept as `*-attempt1|2.*`.

## D. Clean-up

Operator soft-deleted event 109 at about 01:19Z. Verified by GET at 01:21Z: `/ko/events`, `/ja/events`, `/en/events` contain no link to event 109; `sitemap.xml` has no `/events/109` URL; `/ko/events/109/smoke-test-v0190` answers **404**. Observation (not a gate): `/api/setlist?eventId=109` still answers **200** with the last snapshot (rev 8 — the deletion bumped the revision — 3 items, `status: null`, `x-snapshot-source: cache`); the snapshot route filters deleted *items* but not a deleted *event*, and the page's 404 is what users see. Harmless for a smoke event (public setlist data of a non-existent page); worth a follow-up ticket if deleted events should answer 404 on the API too.

## Verdict

**Step 8 PASS.** Production mechanics behave as qualified on dev: broadcast delivery and DOM convergence well inside 3 s, poll repair inside its budget, SSR seeding correct, Instant Rollback and promotion propagate in 5–6 s with a short two-deployment overlap, open tabs survive both, the writer acquires in milliseconds, 0 × 5xx. Known and accepted: the forged-rev flood limitation (REPORT-step7.md); the deploy-order race at this release (fixed in the flow, not in code); R1 and tenant-idle legs NOT EXERCISED. The Fes runs on Supabase Small (from 10/20) with the same build and `LIVE_WARM_ENTRIES=1`; the runbook's T−10 check on 11/14 is exactly check B with the Fes event. n14 qualification complete.
