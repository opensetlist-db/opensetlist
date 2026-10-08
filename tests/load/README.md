# Capacity harness (n12)

k6 load tests for show-night traffic on an `ongoing` event. They answer
one question before the Fes: does `/api/setlist` + the ongoing event page
+ live admin entry hold at the viewer counts we expect? If not, which
mitigation fixes it? The spec, with the gates and the decision rule, is
the wiki page `output/task-n12-capacity-experiment`.

| Script | What it offers | Used in |
|---|---|---|
| `setlist-snapshot.js` | open-model ramp on `GET /api/setlist`, 20 → 50 → 100 → 200 rps, 2 min per stage, 70/20/10 ja/ko/en | run 1 (ramp) |
| `hold.js` | 90 % snapshot + 10 % SSR at `HOLD_RPS` for 5–10 min, the admin loop running at the same time, edit bursts in the last ~70 s | run 2 (hold) |
| `edit-burst.js` | 500 then 2,000 snapshot requests, each spread over 5 s (Realtime Path B refetch after one save) | inside hold, or standalone |
| `admin-writes.js` | 1 operator, 4 cycles × 6 timed saves (create, update, insert-after, swap, delete ×2), each checked in the next snapshot | inside hold, or standalone |
| `ssr-mix.js` | `GET /ja/events/<id>/<slug>` alone, to size the page path | standalone |
| `pg-connections.mjs` | Node side-car: samples `pg_stat_activity` every 5 s into a CSV | second terminal during runs |
| `run.sh` | wrapper: creates `results/<UTC date>/`, passes the common env vars | every run |

## Before the first run

1. **Read the real limits (operator, dashboard).** Record them in the
   wiki page's Results section: Supabase prod + dev compute size, pooler
   mode, **pooler client connection limit**, Realtime concurrent-
   connection setting, spend cap; Vercel function region + max
   duration. Dev must match prod on compute, pooler mode and region, or
   the numbers don't transfer. As of 2026-10-08 dev reports
   `max_connections = 60` (a small compute), so check this first.
2. **Test event.** Use a dev event with about 50 real-shaped rows
   (performers, a medley, reactions, wishes): the rehearsal event from
   `fes1-2020-rehearsal-script` once it has been entered. Set its status
   to **`ongoing`** with the admin override. `/api/setlist` is uncached
   either way, but the event page skips its data cache only while
   `ongoing`, so without the override the SSR numbers measure the
   cached path. Note the visible row count; it goes in `EXPECTED_ROWS`.
3. **Preview protection.** The dev preview sits behind Vercel
   Deployment Protection. Put the project's "Protection Bypass for
   Automation" secret in `VERCEL_BYPASS`. Then check with one request
   that the bypass works before you trust a run:
   `curl -s -o /dev/null -w '%{http_code}\n' -H "x-vercel-protection-bypass: $VERCEL_BYPASS" "$BASE_URL/api/setlist?eventId=$EVENT_ID&locale=ja"`
   must print `200`, not `401`.
4. **Firewall.** Every request comes from one IP. Make sure Vercel
   Firewall / Attack Challenge Mode won't challenge or rate-limit that
   IP during the window, or the run measures the firewall. Spec rule:
   don't treat generator, firewall or protection limits as app capacity.
5. **Install k6** (`winget install GrafanaLabs.k6`, or the portable zip
   from the GitHub releases). If it isn't on PATH, set `K6=/path/to/k6`.
6. Tell anyone else using the dev DB about the window (n10/n11 share it).

## Environment

| Var | Required | Meaning |
|---|---|---|
| `BASE_URL` | yes | e.g. the dev preview URL; default `http://localhost:3000` |
| `EVENT_ID` | yes | test event id |
| `EVENT_SLUG` | hold, ssr | the event's DB slug. Redirects are not followed, so a wrong slug shows up as a 308 error |
| `EXPECTED_ROWS` | recommended | visible row count at start. Sampled bodies outside `[N, N+ROW_SLACK]` count as errors |
| `ROW_SLACK` | hold: `2` | the admin loop adds up to 2 rows for a while |
| `VERCEL_BYPASS` | preview | protection bypass secret |
| `ADMIN_PASSWORD` | hold, admin | logs in via `/api/admin/login` |
| `HOLD_RPS` | hold | highest rate that passed the ramp |
| `HOLD_SECONDS` | — | default 600 (spec: 5–10 min) |
| `BODY_SAMPLE_RATE` | — | share of snapshot bodies parsed and validated, default 0.1. The status code is checked on every response |
| `STAGE_SECONDS`, `MAX_RPS` | — | shorten or cap the ramp for a smoke run |
| `BURST_SIZES` | — | default `500,2000` |
| `ADMIN_CYCLES`, `ADMIN_CYCLE_PAUSE` | — | default 4 cycles, 20 s apart. For a 600 s hold, `ADMIN_CYCLE_PAUSE=90` spreads the saves over the hold |

## Run order

```bash
export BASE_URL=https://<dev-preview> EVENT_ID=<id> EVENT_SLUG=<slug> \
       EXPECTED_ROWS=<n> VERCEL_BYPASS=<secret> ADMIN_PASSWORD=<pw>

# terminal 2, for the whole session (.env must point at the dev DB)
node tests/load/pg-connections.mjs

# 1. ramp: stops itself if a stage hits p95 ≥ 5 s or > 2 % errors
tests/load/run.sh setlist-snapshot.js

# 2. hold at the highest PASS stage from the ramp table, plus admin + bursts
HOLD_RPS=100 ROW_SLACK=2 tests/load/run.sh hold.js -e ADMIN_CYCLE_PAUSE=90
```

Every run writes `results/<date>/<stamp>-<kind>.md` (the per-stage
table) and, for the ramp and hold runs, a `.json` with the raw metrics
(ignored by git). Watch Supabase → Database → connections, Vercel →
Functions and Sentry during each run, and save screenshots into the
same `results/<date>/` folder. Then write `results/<date>/REPORT.md`
and copy its summary row into the wiki page.

## Reading the result

- **Achieved rps** must be ≥ 95 % of the target, or the stage doesn't
  count. A non-zero **dropped** column means k6 ran out of VUs. That is
  a generator limit (or a server so slow that every VU is waiting), not
  a pass.
- **Pass:** snapshot p95 ≤ 1 s and p99 ≤ 2 s, errors ≤ 0.1 %, admin
  save+reload p95 ≤ 3 s with every write visible, and pooler client
  peak ≤ 70 % of the configured limit. Read the pooler number off the
  dashboard. The CSV counts Postgres *backends*, which Supavisor
  multiplexes, so it understates client pressure.
- **Abort** is approximated, because k6 thresholds are cumulative per
  scenario, not sliding windows. A stage aborts once its cumulative p95
  reaches 5 s or its error rate reaches 2 %, checked after a 30 s grace.
- The admin loop aborts the run on any failed or never-visible write.
  It first soft-deletes the rows it created, and the abort message
  lists any it could not remove. Reconcile the event before the next
  run.

## Cleanup

The admin loop appends rows after the current last position and
soft-deletes them again, so no existing row is moved or edited. The
event keeps its visible rows plus some `isDeleted` rows. Remove the
`ongoing` override once testing is done.
