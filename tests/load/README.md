# Capacity harness (n12)

k6 load tests for show-night traffic on an `ongoing` event. They answer
one question before the Fes: does `/api/setlist` + the ongoing event page
+ live admin entry hold at the viewer counts we expect? If not, which
mitigation fixes it? The spec, with the gates and the decision rule, is
the wiki page `output/task-n12-capacity-experiment`.

| Script | What it offers | Used in |
|---|---|---|
| `setlist-snapshot.js` | open-model ramp on `GET /api/setlist`, 20 → 50 → 100 → 200 rps, 2 min per stage, 70/20/10 ja/ko/en | run 1 (ramp) |
| `hold.js` | 90 % snapshot + 10 % SSR at `HOLD_RPS` for 5–10 min, the admin loop running at the same time, edit bursts in the last ~70 s, plus **one admin cycle inside each burst** (judged separately as `admin_burst500` / `admin_burst2000`) | run 2 (hold) |
| `edit-burst.js` | 500 then 2,000 snapshot requests, each spread over 5 s (Realtime Path B refetch after one save) | inside hold, or standalone |
| `admin-writes.js` | 1 operator, 4 cycles × 6 timed saves (create, update, insert-after, swap, delete ×2), each checked in the next snapshot | inside hold, or standalone |
| `ssr-mix.js` | `GET /ja/events/<id>/<slug>` alone, to size the page path | standalone |
| `viewers.js` | n14 run #2 **500-viewer model** on the R1 live path: cold-cache start, 25 rps periodic poll (`?minRev`) + 10 % SSR, admin cycles with a 500-request notification burst (`?minRev=appliedRev+1`, U(0, 500 ms) jitter, 20 % old-build tabs ×2) after every save, a 500-tap reaction POST/DELETE burst. Per-burst `x-snapshot-source` counts, PASS/FAIL per gate | n14 run #2 |
| `viewers-check.mjs` | Node, dev DB only: after a `viewers.js` run, lists leftover `n14run2-` reactions (`--delete` removes exactly those) and live rows carrying its note | after `viewers.js` |
| `pg-connections.mjs` | Node side-car: samples `pg_stat_activity` every 5 s into a CSV | second terminal during runs |
| `pooler-clients.mjs` | Node side-car, dev only: every 2 s one CSV row with the Supabase metrics endpoint's pooler gauges (needs a service-role key), `pg_stat_activity` backends by state / `application_name`, and a transaction-pooler connect probe that records `EMAXCONN`. Stops on the STOP file | detached, n14 run #2b |
| `vercel-logs-capture.mjs` | `vercel logs --follow` of the dev alias into one text file, restarted in overlapping segments (the CLI stops after ~5 min). Stops on the STOP file | detached, n14 run #2b |
| `vercel-logs-summary.mjs` | turns a log capture into markdown: builds per `rev` with distinct instances, build failures / repair reads / coalescing, `EMAXCONN` API vs SSR, admin write timings, instances per minute, Σ per-instance pool size per 5 s. `node --test tests/load/vercel-logs-summary.test.mjs` pins it to the run #2 capture | after a run |
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
| `ROW_SLACK` | hold: `4` | each admin cycle adds up to 2 rows for a while, and under overload a burst-window cycle can still be running when the next one starts |
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
HOLD_RPS=100 ROW_SLACK=4 tests/load/run.sh hold.js -e ADMIN_CYCLE_PAUSE=90
```

Every run writes `results/<date>/<stamp>-<kind>.md` (the per-stage
table) and, for the ramp and hold runs, a `.json` with the raw metrics
(ignored by git). Watch Supabase → Database → connections, Vercel →
Functions and Sentry during each run, and save screenshots into the
same `results/<date>/` folder. Then write `results/<date>/REPORT.md`
and copy its summary row into the wiki page.

## n14 run #2 — the 500-viewer model (`viewers.js`)

One ~11-minute run against the R1 preview, all on event 111
(`rehearsal-lovelive-fes-2020-day1`, `ongoing`, 23 rows). Timeline
with the defaults:

| t | what |
|---|---|
| 0 s | **cold start**: one admin save (append) → burst `b00` right after it returns, on the cache the save just purged; the row is deleted again (untimed, verified) |
| 15 s → 615 s | **steady**: `GET /api/setlist` at `POLL_RPS`=25 (70/20/10 ja/ko/en, each VU sending `?minRev=<highest rev it has seen>` like the client's periodic fetch) + the ongoing event page at `SSR_RPS`=2.5 |
| 40 s + k·70 s | **admin cycles** (8): 6 "burst" cycles — admin-writes.js's six saves `SAVE_GAP`=4 s apart, each followed by a burst — and 2 "quiet" cycles (no bursts) that give the steady-window admin number. 1 + 36 = **37 bursts** |
| 440 s | **reactions**: 500 POST `/api/reactions` + the matching DELETE in 10 s, anonId `n14run2-…`, random existing row + type |

A **burst** = `BURST_SIZE`=500 snapshot requests, each at U(0, `JITTER_MS`=500 ms)
after the save returned, with `?minRev=<appliedRev+1>` (what
`notificationMinRev()` sends; appliedRev = the rev the admin VU saw before
the save). `OLD_SHARE`=20 % of them are pre-R1 tabs: no `minRev`, and one
more request (`OLD_REPEATS`=1) `OLD_REPEAT_MS`=1000 ms later. The admin
VU fires the burst itself with async requests (k6 VUs share no state, so
"right after the save" can only be known there) — it comes from one
process over multiplexed HTTP/2, not 500 browsers.

Old-build tabs keep their own timing: their first request is always at
U(0, 500 ms), whatever `JITTER_MS` says, so a jitter experiment moves only
the R1 clients and two runs stay comparable.

Per burst the report has the request count, p50/p95/max, the error count
(and %), the `x-snapshot-source` split (build / cache / repair), the share
of R1 requests that got `rev ≥ minRev`, and the **distinct error bodies**
(status + first 80 characters, at most 5 per burst; k6 can only carry
strings from a VU to the summary as check names, so they show up as failed
`burst-error <id> | …` checks too). The header split is only a rough
proxy for builds: coalesced waiters share the first request's result
(header included), so it over-counts. Count builds from the logs with
`vercel-logs-summary.mjs`.

Gates (PASS/FAIL table at the top of the report; k6 also exits 99 when a
gate threshold fails): snapshot p95 ≤ 1 s and errors ≤ 0.1 % over **all**
viewer snapshot requests (polls + bursts); every sampled body valid;
worst burst p95 ≤ 3 s; admin save+reload p95 ≤ 3 s in the steady
(quiet-cycle) and the burst windows, judged separately; every write
visible and the event back at `EXPECTED_ROWS`; reaction errors ≤ 0.1 %,
`ackAt` present and ≥ request start (clock offset estimated in setup from
`servedAt`, tolerance ±RTT/2); generator achieved ≥ 95 % with 0 dropped.
The pooler-client row (≤ 140 of 200, 0 `EMAXCONN`) is filled in by hand
from `pooler-clients.mjs` and `vercel-logs-summary.mjs` (see the run #2b-1
recipe below).

Safety: no threshold aborts (a threshold abort would kill the admin VU
mid-cycle and leave rows behind). The admin VU itself aborts, after
soft-deleting its rows, on a failed / never-visible write or when one
burst exceeds `ABORT_ERR_RATE` (2 %) errors or `ABORT_P95_MS` (5 s) p95.
Setup refuses to start unless the event is `ongoing` with exactly
`EXPECTED_ROWS` rows. Run it alone: another writer on the same event
shifts positions under the admin loop and its rows count as bad bodies.

```bash
export BASE_URL=https://opensetlist-git-dev-opensetlist-projects.vercel.app \
       EVENT_ID=111 EVENT_SLUG=rehearsal-lovelive-fes-2020-day1 \
       EXPECTED_ROWS=23 ROW_SLACK=2
export ADMIN_PASSWORD="$(grep '^ADMIN_PASSWORD=' .env | cut -d= -f2- | tr -d '\r' | sed -E 's/^"(.*)"$/\1/')"

# terminal 2, started first and stopped (Ctrl+C) after the run; .env must point at dev
node tests/load/pg-connections.mjs

# terminal 1 — full scale, every knob at its default (K6=<path> if k6 is not on PATH)
tests/load/run.sh viewers.js

# afterwards: no n14run2 reactions, no live rows with the run's note, 23 rows
node tests/load/viewers-check.mjs
```

Writes `results/<UTC date>/<stamp>-viewers.md` (+ `.json`). Every knob
is an env var / `-e`: `POLL_RPS`, `SSR_RPS`, `STEADY_START`,
`STEADY_SECONDS`, `ADMIN_CYCLES`, `QUIET_CYCLES`, `ADMIN_FIRST`,
`ADMIN_SPACING`, `SAVE_GAP`, `BURST_SIZE`, `JITTER_MS`, `OLD_SHARE`,
`OLD_REPEATS`, `OLD_REPEAT_MS`, `COLD_START` (0 = off), `REACTIONS`,
`REACTION_SECONDS`, `REACTION_AT`, `ABORT_ERR_RATE`, `ABORT_P95_MS`,
`BURST_GATE_P95`, `ACCEPT_ENCODING` (default `gzip, deflate, br`, like a
browser; a raw snapshot is ~47 KB), `BODY_SAMPLE_RATE`, and:

| Knob | Default | Meaning |
|---|---|---|
| `BURST_GAP_S` | unset | unset: cycle k starts at `ADMIN_FIRST + k·ADMIN_SPACING`. Set: cycle 1 at `ADMIN_FIRST`, every later cycle `BURST_GAP_S` seconds after the previous one **ended** — repeated bursts that land on still-warm instances |
| `DRAIN_S` | 90 | quiet tail with **no requests** from any scenario, while the test keeps running so the side-car samplers see the pools drain. It starts when the last admin cycle, the steady window (`STEADY_START + STEADY_SECONDS`) and the reaction window are all over — k6 VUs share no state, so the steady streams cannot be stopped early from the admin VU. Size `STEADY_SECONDS` to the cycles if the drain should follow the last burst directly. The report prints the actual cycle starts, the last cycle's end and the drain start. `0` = no drain. No drain after an abort (the run ends at once) |

The smoke used:

```bash
tests/load/run.sh viewers.js -e POLL_RPS=1 -e SSR_RPS=0.2 -e STEADY_START=8 \
  -e STEADY_SECONDS=60 -e ADMIN_CYCLES=1 -e QUIET_CYCLES=1 -e ADMIN_FIRST=15 \
  -e ADMIN_SPACING=30 -e SAVE_GAP=1 -e BURST_SIZE=5 -e OLD_SHARE=0.4 \
  -e REACTIONS=5 -e REACTION_SECONDS=5 -e REACTION_AT=40 -e BODY_SAMPLE_RATE=1
```

## n14 run #2b-1 — 500 cold burst + nearby repeats, with pooler measurement

Same event and env as run #2 above. What is new is the measurement around
the k6 run: the pooler-client number the Supabase dashboard never showed,
and the Vercel logs that count real builds per save.

**Side-cars run detached.** A load session outlives a 10-minute shell, and
detached `bash -c` loops did not start on the Windows load machine, so both
samplers are started with PowerShell `Start-Process` (the process survives
the shell that started it) and stop on a STOP file in the results folder
(a STOP file older than the sampler is ignored). From the repo root, in
PowerShell:

```powershell
$out = "tests/load/results/$((Get-Date).ToUniversalTime().ToString('yyyy-MM-dd'))"
New-Item -ItemType Directory -Force $out | Out-Null
$env:ENV_DIR = "F:/work/ClaudeCode/opensetlist4"   # only if the cwd has no .env / .env.local
Start-Process -FilePath node -ArgumentList 'tests/load/pooler-clients.mjs' -WorkingDirectory (Get-Location) `
  -WindowStyle Hidden -RedirectStandardOutput "$out/pooler-clients.out" -RedirectStandardError "$out/pooler-clients.err"
Start-Process -FilePath node -ArgumentList 'tests/load/vercel-logs-capture.mjs' -WorkingDirectory (Get-Location) `
  -WindowStyle Hidden -RedirectStandardOutput "$out/vercel-logs-capture.out" -RedirectStandardError "$out/vercel-logs-capture.err"
Get-Content "$out/pooler-clients.out" -Tail 3     # a row every 2 s; let it record ~30 s of baseline
```

`pooler-clients.mjs` writes `<stamp>-pooler-clients.csv`; its header says
which readings it has. (a) the Supabase metrics endpoint needs the dev
project's service-role (or `sb_secret_…`) key in `.env.local` as
`SUPABASE_SERVICE_ROLE_KEY` (or `SUPABASE_SECRET_KEY`); without it the
header says "unavailable" and the metric columns stay empty — the endpoint
exists on dev (HTTP 401 without a key). With a key, every metric name
matching supavisor / pooler / pgbouncer / client goes to
`<stamp>-pooler-metrics.txt` and the client/backend connection gauges are
sampled (`--metrics=a,b` to choose). (b) backends by state and
`application_name` (`Supavisor` rows are the pooler's server side). (c)
`probe_result`: a fresh connection through the transaction pooler every
2 s; `EMAXCONN` there means the 200-client cap was hit at that moment.
Options: `--interval=2`, `--max-minutes=90` (safety stop), `--no-probe`,
`--seconds=N` (bounded smoke). `vercel-logs-capture.mjs` writes
`<stamp>-vercel-logs.txt` (`--segment=280 --overlap=15`, `--max-minutes=90`);
it needs a logged-in Vercel CLI (`npx vercel whoami`).

**k6** (Git Bash, env as in the run #2 block above):

```bash
tests/load/run.sh viewers.js -e BURST_SIZE=500 -e JITTER_MS=500 -e BURST_GAP_S=8 \
  -e ADMIN_CYCLES=4 -e DRAIN_S=90
```

The cold-start burst (b00), then 4 burst cycles + 2 quiet cycles (default
`QUIET_CYCLES`), each starting 8 s after the previous one ended, so the
bursts land on instances whose pools are still open. With the default
600 s steady window the 90 s drain begins at ~615 s; for a drain right
after the last burst add `-e STEADY_SECONDS=280 -e REACTION_AT=150` (a
cycle takes ~30–45 s at `SAVE_GAP=4`; the report's timeline line shows
where the last cycle really ended — adjust next time). The 2 % / 5 s
per-burst abort gate still applies; after an abort the run ends at once,
so wait ~90 s before the STOP file to let the samplers see the drain.

**Afterwards:**

```powershell
New-Item -ItemType File "$out/run2b.STOP" | Out-Null   # both side-cars exit within a few seconds
node tests/load/vercel-logs-summary.mjs (Get-ChildItem "$out/*-vercel-logs.txt" | Select-Object -Last 1).FullName `
  --add-hours=7 --out="$out/vercel-logs-summary.md"   # +7: PDT log clock → UTC, to line up with the k6 report
node tests/load/viewers-check.mjs                      # 0 n14run2 reactions, 0 live rows with the note, 23 rows
node --no-warnings tests/load/browsers/restore.mjs --compact --yes   # event 111 positions back to 1..23
```

Reading it: the pooler row of the k6 gate table = metrics peak (if
available) and the probe's `EMAXCONN` count from the CSV, plus the
"Prisma pool totals per 5 s" peak from the log summary (Σ of each
instance's last reported pool size, held for `--carry=5` s — the pool's
idle timeout); builds per save = the log summary's builds per `rev`, not
the k6 header split.

## Reading the result

- **Achieved rps** must be ≥ 95 % of the target, or the stage doesn't
  count. A non-zero **dropped** column means k6 ran out of VUs (or the
  server was so slow that every VU was waiting). The stage is marked
  **GEN-LIMIT**, not PASS, even when achieved rps still clears 95 %.
  Never use it as `HOLD_RPS`. Add VUs or a bigger generator and re-run.
- **Two error columns, two gates.** `http err %` counts non-200 and
  transport errors over every request (gate ≤ 0.1 %). `bad bodies /
  sampled` counts malformed JSON or a wrong row count over the sampled
  bodies only (gate: 0). They are kept apart because dividing body
  failures by all requests would dilute them by `BODY_SAMPLE_RATE`. A
  stage with no sampled body can't pass. For the confirmation hold, use
  `BODY_SAMPLE_RATE=1` when the generator keeps dropped at 0.
- **Pass:** snapshot p95 ≤ 1 s and p99 ≤ 2 s, both error gates met,
  dropped = 0, admin save+reload p95 ≤ 3 s with every write visible, and
  pooler client peak ≤ 70 % of the configured limit. Read the pooler number off the
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
