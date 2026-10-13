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
| `viewers.js` | n14 run #2 **500-viewer model** on the R1 live path: cold-cache start, 25 rps periodic poll (`?minRev`) + 10 % SSR, admin cycles with a 500-request notification burst (`?minRev=appliedRev+1`, U(0, 500 ms) jitter, 20 % old-build tabs ×2) after every save, a 500-tap reaction POST/DELETE burst. Per-burst `x-snapshot-source` counts, PASS/FAIL per gate. `HINT_MODE=r2`: the R2 notification (`?minRev=<saved rev>&hint=1`, `x-snapshot-verify` outcomes, one recheck on an inconclusive answer) | n14 run #2, R2 baseline |
| `viewers-check.mjs` | Node, dev DB only: after a `viewers.js` run, lists leftover `n14run2-` reactions (`--delete` removes exactly those) and live rows carrying its note | after `viewers.js` |
| `pg-connections.mjs` | Node side-car: samples `pg_stat_activity` every 5 s into a CSV | second terminal during runs |
| `pooler-clients.mjs` | Node side-car, dev only: every 2 s one CSV row with the Supabase metrics endpoint's pooler gauges (needs a service-role key), `pg_stat_activity` backends by state / `application_name`, and a transaction-pooler connect probe that records `EMAXCONN`. Stops on the STOP file | detached, n14 run #2b |
| `vercel-logs-capture.mjs` | `vercel logs --follow` of the dev alias into one text file, restarted in overlapping segments (the CLI stops after ~5 min). Stops on the STOP file | detached, n14 run #2b |
| `vercel-logs-summary.mjs` | turns a log capture into markdown: builds per `rev` with distinct instances, build failures / repair reads / coalescing, `EMAXCONN` API vs SSR, admin write timings, instances per minute, Σ per-instance pool size per 5 s, hint outcomes (`[setlist] hint-fetch … verify=`) per kind and minute, repair reads split by `hint=`. `node --test tests/load/vercel-logs-summary.test.mjs` pins it to the run #2 capture | after a run |
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
| `HINT_MODE` | `r1` | `r1`: the new-build tabs send `?minRev=<appliedRev + 1>` (the R1 page). `r2`: they send `?minRev=<rev from the save response>&hint=1` (the R2 broadcast carries the exact rev); a 200 that is inconclusive (`x-snapshot-verify` memo / deferred / missing-or-malformed) AND below that rev gets ONE recheck 1,000 ms + U(0, 500 ms) later, same `minRev`, no `hint`. Old-build tabs are the same in both. Either mode counts the header per burst (column `verify none / satisfied / fresh / memo / deferred / missing`) and prints a run-level **hint outcomes** line (+ rechecks: count, share of notification fetches, outcome split, "hint exhausted" = recheck still inconclusive below the rev) and `fresh refutations of a committed save` — a `fresh=<dbRev>` below a rev that was already committed when the request started, a server provenance bug, must be 0. Rechecks count in the whole-run gates and the burst abort's error rate, not in the burst latency |
| `DRAIN_S` | 90 | quiet tail with **no requests** from any scenario, while the test keeps running so the side-car samplers see the pools drain. It starts when the last admin cycle, the steady window (`STEADY_START + STEADY_SECONDS`) and the reaction window are all over — k6 VUs share no state, so the steady streams cannot be stopped early from the admin VU. Size `STEADY_SECONDS` to the cycles if the drain should follow the last burst directly. The report prints the actual cycle starts, the last cycle's end and the drain start. `0` = no drain. No drain after an abort (the run ends at once) |

The smoke used:

```bash
tests/load/run.sh viewers.js -e POLL_RPS=1 -e SSR_RPS=0.2 -e STEADY_START=8 \
  -e STEADY_SECONDS=60 -e ADMIN_CYCLES=1 -e QUIET_CYCLES=1 -e ADMIN_FIRST=15 \
  -e ADMIN_SPACING=30 -e SAVE_GAP=1 -e BURST_SIZE=5 -e OLD_SHARE=0.4 \
  -e REACTIONS=5 -e REACTION_SECONDS=5 -e REACTION_AT=40 -e BODY_SAMPLE_RATE=1
```

### Step 5 fixture (`fixtures/fes-rows.mjs`) and k6 admission mode (`ADMISSION=1`)

n14 qualification step 5 (cold admission). Two tools, both dev only:

**Fes-size fixture.** `fixtures/fes-rows.mjs` grows event 111 to a
synthetic largest-Fes setlist by cloning its own active rows (scalars,
songs with `order`, members incl. the nullable `realPersonId`, artists),
so the snapshot has a real show's structure, just more of it. The clone
count comes from the live row count: `--target=70 --anchor-reserve=1` on
23 rows = 46 clones (two full copies), and the harness's / probe's blank
anchor is the 70th row. Ordinary clones go **before** the encore block
and encore clones after it (every admin PUT validates the whole event's
encore order); the shifted encore originals are recorded. One
transaction locks the Event row first, parks/moves positions around the
partial unique index, and bumps `setlistRevision` **without**
`realtime.send` and without a cache purge: quarantined preparation, run
with **no client of ours connected** (no SDK cohort, no observer, no tab),
before the redeploy that gives the run fresh cache namespaces. It refuses
when the row count is not `--expect-rows` or when any row of the event was
created/deleted in the last `--quiet-s` (120) s — never run it while
another stream works on the event. The manifest
`results/<UTC date>/fixture-<label>.json` is written before COMMIT (ids)
and finalised after; every clone's `createdAt` is the transaction's
`now()` (`txNow` in the manifest) as a last-resort recovery key.

```bash
node tests/load/fixtures/fes-rows.mjs --target=70 --anchor-reserve=1 --label=A2 --expect-rows=23
```

Clean-up order after the run (the probe's/harness's anchor first):

1. `node tests/load/admission-probe.mjs --cleanup=<probe file>` (k6 runs)
   or the harness's own clean-up — the anchor must be gone, otherwise
   step 2 refuses (a foreign active row on a recorded position);
2. `node tests/load/fixtures/fes-rows.mjs --cleanup=<manifest> --publish`:
   soft-deletes the clones (junctions stay with the soft-deleted parent),
   restores every original row to its recorded pre-fixture position,
   bumps the revision (no broadcast), then `--publish` publishes through
   the writer path (one admin login; a no-op re-delete of an
   already-deleted clone bumps, broadcasts and purges) and the
   verification table runs (ids in order, positions, encore flags, scalar
   + junction content, link counts, event status/startTime, clones
   deleted, revision strictly above the fixture's — never rewound);
3. `node tests/load/fixtures/fes-rows.mjs --verify=<manifest>` any time
   later. `node tests/load/browsers/restore.mjs --compact --yes` is the
   recovery tool only when a position check FAILED: it publishes only
   when it actually moves rows, so after an exact restore it is a no-op.

Sizes (**after** a run, never before a cold boundary — the reads build
and cache snapshots on the target):
`node tests/load/fixtures/fes-rows.mjs --sizes --base=<url> [--out=<file>]`
prints, per locale (ja/ko/en), the API JSON bytes, the identity wire
bytes and `content-length`, and the compressed `content-encoding` / wire
bytes / `content-length`. The warm codec payload is not visible over
HTTP: read `bytes=` from the run's `[liveWarm] set event=111 locale=<l> …`
lines (and `[liveWarm] skip … reason=oversize`) and compare max per locale
with `WARM_MAX_BYTES` = 1,000,000 (`src/lib/liveWarm.ts`).

**k6 admission mode (A1).** `ADMISSION=1` makes `viewers.js` send
**nothing** before t=0: no `setup()` reads, no admin login, no
cold-start save / `b00`, no admin cycles, no reactions. The clock offset,
event sanity, the admin cookie, the anchor row and the marker songs come
from `PROBE_FILE`, written by `admission-probe.mjs` **before** the
boundary against the **precursor** deployment (never the measurement
one). After t=0:

| t | what |
|---|---|
| 0 → `ARRIVAL_SECONDS` | `ARRIVALS` generic initial reads (no `hint`, no `minRev`), 70/20/10 ja/ko/en, evenly spread, open-loop; each arrival is one viewer whose build (R2 / R1 / pre-R1) is drawn once from `SHAPE_MIX` |
| 0 → `SSR_SECONDS` | event-page SSR at `SSR_RPS` (independent scenario, 70/20/10 locales, redirects not followed) |
| `ADMISSION_SAVES` | PUT on the probe's anchor (next marker song), on its own timer from t=0. At the PUT response, only the viewers admitted by then fetch: R2 `minRev=savedRev&hint=1` (+ one quiet recheck when inconclusive and below), R1 `minRev=appliedRev+1`, pre-R1 no `minRev` + one repeat `OLD_REPEAT_MS` later on the same locale |
| `STEADY_START` → +`STEADY_SECONDS` | the periodic poll (the hold), as in the normal model |

| Knob | Default (admission mode) | Meaning |
|---|---|---|
| `ADMISSION` | `0` | `1` = this mode |
| `PROBE_FILE` | — (required) | the probe JSON (absolute, or repo-root relative). Holds the admin cookie: gitignored, never commit/upload |
| `ARRIVALS` / `ARRIVAL_SECONDS` | 500 / 10 | the admission wave |
| `SSR_RPS` / `SSR_SECONDS` | 10 / 60 | SSR window from t=0 |
| `ADMISSION_SAVES` | `5,20` | save offsets (s from t=0); empty = none |
| `SHAPE_MIX` | `60/25/15` | R2 / R1 / pre-R1 weights (normalised); per-save counts are recorded |
| `ANCHOR_ID` + `ANCHOR_POSITION` | probe's anchor | edit another dedicated anchor instead (never a fixture/original row — the PUT recreates its junctions) |
| `STEADY_SECONDS` | 60 | hold length (`POLL_RPS`, `STEADY_START` as above) |
| `WAVE_GATE_P95` / `SSR_GATE_P95` | 1000 / 3000 ms | soft wave gate / SSR gate |
| `EXPECTED_ROWS`, `ROW_SLACK` | — / 0 | set `EXPECTED_ROWS` to the probe's `rows` (anchor included); admission adds no rows |

Gates (handleSummary; `adm_http_5xx` and `adm_transport_errors` are also
`count==0` thresholds): 0 × 5xx and 0 transport failures over **every**
request (arrivals, notification fetches, rechecks, PUTs, SSR, polls), 0 ×
503, every save committed, wave p95 ≤ 1 s (soft), all arrivals admitted,
SSR p95 ≤ 3 s with 0 errors, saved head per shape on each viewer's final
fetch (R2 `rev === savedRev` after its recheck, R1 `rev ≥ savedRev`,
pre-R1 `rev ≥ savedRev` on the repeat — the first and repeat requests are
counted apart), 0 bad bodies, 0 dropped iterations. Per save the report
gives exposure at PUT start → response (admitted viewers / outstanding
arrivals / this VU's in-flight requests; k6 has no SUBSCRIBED/DOM
signal), PUT status/ms/rev and its scheduled-vs-actual start, and per
shape the viewers, requests per wave, exact (`=`) and at-or-beyond (`≥`)
counts, the final claim and p95; arrivals also show scheduled-vs-actual
start lag and the first-read source split. Σ / builds per instance come
from the logs (`vercel-logs-summary.mjs`). Output:
`results/<UTC date>/<stamp>-viewers.md` (+ `-viewers.json` metrics) and
`<stamp>-k6-admission.json` — `{ kind: "k6-admission", t0, probe,
fixture, anchor, knobs, saves: [{ id, offsetS, scheduledAt, putStart,
putEnd, putMs, status, rev, marker, exposure: { atPutStart, atPutEnd },
shapes: { r2, r1, pre } }], arrivals: { total, completed, admitted,
errors, byShape, byLocale, latency, startLag, sources }, ssr, poll,
errors, shapeFinal, gates }` (epoch ms on the k6 host;
`probe.clock.offsetMs` = precursor server − laptop, ±`errMs`), the
optional k6 input of `admission-join.mjs`.

Operator sequence (A1):

```bash
# 0. (A2/A4 only) fixture, with no client of ours connected
node tests/load/fixtures/fes-rows.mjs --target=70 --anchor-reserve=1 --label=A1 --expect-rows=23
# 1. probe the PRECURSOR deployment (identity check, 5 clock reads, 1 login, anchor)
node tests/load/admission-probe.mjs --base=https://opensetlist-<hash>-opensetlist-projects.vercel.app --label=A1 \
  [--fixture=tests/load/results/<date>/fixture-A1.json]
# 2. redeploy (same commit, new BUILD_KEY); no request to the new deployment
# 3. k6 against the measurement URL — its first request is the wave
ADMISSION=1 PROBE_FILE=<abs path printed by the probe> EVENT_ID=111 EVENT_SLUG=rehearsal-lovelive-fes-2020-day1 \
  EXPECTED_ROWS=<probe rows> BASE_URL=<measurement url> tests/load/run.sh viewers.js
# 4. after: sizes, then anchor clean-up, then fixture clean-up (+ publish) and verify
node tests/load/fixtures/fes-rows.mjs --sizes --base=<measurement url>
node tests/load/admission-probe.mjs --cleanup=tests/load/results/<date>/admission-probe-A1.json
node tests/load/fixtures/fes-rows.mjs --cleanup=tests/load/results/<date>/fixture-A1.json --publish
```

Knobs can be shell env vars (k6 reads the process environment) or `-e`
flags after `run.sh viewers.js`. Smoke:
`-e ADMISSION=1 -e PROBE_FILE=… -e ARRIVALS=10 -e SSR_RPS=1 -e SSR_SECONDS=15
-e ADMISSION_SAVES=5 -e POLL_RPS=1 -e STEADY_SECONDS=10 -e DRAIN_S=0 -e BODY_SAMPLE_RATE=1`.

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
sampled (`--metrics=a,b` to choose). **Measured on dev 2026-10-10 (run
#2b-1): these `pgbouncer_*` gauges belong to the project's dedicated
PgBouncer, not to Supavisor** — `pgbouncer_used_clients` stayed at 1 and
`pgbouncer_config_max_client_connections` at 200 through a burst that put
153 app connections on `aws-1-…pooler.supabase.com:6543`. The endpoint
exposes no Supavisor client gauge, so the metric columns are kept only
for the record. **The pooler-client measure is the app-side Σ of per-instance
Prisma pool totals** from `vercel-logs-summary.mjs` ("Prisma pool totals per
5 s", 5 s carry = the pool's idle timeout) **plus the probe's `EMAXCONN`
count below**; the gate is Σ peak ≤ 140 and 0 EMAXCONN. (b) backends by state and
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

**Always re-fetch the run in history mode afterwards.** In run #2b-1 the
`--follow` capture kept only 29 % of the entries (b00: 85 builds / 67
instances against the true 171 / 152), so the follow file is a live view,
not the record. Fetch `npx vercel logs <alias> --since <ISO> --until <ISO>
--limit 5000 --expand --scope opensetlist-projects` in ~20 s windows over
the run (entries go to stderr — redirect `2>`), concatenate, and summarise
that file; the summariser drops duplicates from overlapping windows.

Reading it: the pooler row of the k6 gate table = the "Prisma pool totals
per 5 s" peak from the log summary (Σ of each instance's last reported
pool size, held for `--carry=5` s — the pool's idle timeout) and the
probe's `EMAXCONN` count from the CSV (the metrics columns do not see
Supavisor — see above); builds per save = the log summary's builds per
`rev`, not the k6 header split.

## n14 R2 baseline run (R2-A + B1, no warming)

R2 switches the live page from `postgres_changes` to the transactional
`rev` broadcast and adds the hint contract (the page sends the broadcast's
exact rev as `minRev` with `hint=1`; the server answers
`x-snapshot-verify`; an inconclusive answer earns one quiet recheck). This
baseline is the **warmer-off control**: the R2 build on the dev preview
(jitter 500 ms; record the dev Supabase compute size in the report — the
release plan is Small), nothing else new, so a later warming
run has something to be compared with. Same event, env and preflight as
run #2b-1 (event 111 at 23 rows, positions 1..23, `ongoing`). Two separate
measurements, **never at the same time** (see (b)).

**(a) k6 — 500-request hinted bursts.** Side-cars exactly as in run #2b-1
(`pooler-clients.mjs` + `vercel-logs-capture.mjs` via `Start-Process`, ~30 s
of baseline first), then, in Git Bash:

```bash
tests/load/run.sh viewers.js -e HINT_MODE=r2 -e BURST_SIZE=500 -e JITTER_MS=500 \
  -e BURST_GAP_S=8 -e ADMIN_CYCLES=4 -e DRAIN_S=90
```

Afterwards: STOP file, **history-mode re-fetch** of the run window (as in
run #2b-1 — the `--follow` file is not the record) and
`vercel-logs-summary.mjs` on it; `viewers-check.mjs`; `restore.mjs --compact
--yes`. Read: the per-burst `verify` column and the run-level **hint
outcomes** line (expect `satisfied` to dominate, `fresh refutations of a
committed save` = 0, rechecks a small share, `missing` = 0 — a `missing` on
the R2 build means the header is not being sent); the log summary's
"Hint outcomes" table (server side of the same requests) and `rev-read` by
`hint=` (how many 1-row reads the notification fetches cost); builds per
`rev` against run #2b-1's 199–290 per warm save on 38–73 instances — R2-A
moves the transport, not the storm, so a similar number is the expected
control value. Old-build tabs (20 %) still model R1 tabs open across the
deploy.

**(b) Browsers — 30 pages + 470 SDK clients on the R2 client, alone.** The
SDK clients run the R2 client logic (broadcast-driven notification
fetches, the page's own acceptance / scheduler / verify parser); the pages
run whatever the preview serves. Nothing waits for `postgres_changes`
registration any more (`--wait-pg-ready` is off by default; an R2 client
registers none). Same side-cars + history re-fetch, so builds per save can
be counted for this run too:

```bash
node --no-warnings tests/load/browsers/run.mjs --pages=30 --subs=470 --edits=12 --pause=25 --label=r2-baseline
```

**Nothing else runs on the load host during a browsers run; fetch and
summarise logs afterwards.** Only the live side-cars (`vercel-logs-capture.mjs`,
`pooler-clients.mjs`) may run next to it; the history re-fetch,
`vercel-logs-summary.mjs` and `warm-join.mjs` come after the run ends. The
run warns at start when the host is busy or a competing process is found
(`--strict-host` refuses), and a stalled load-host thread during the run
turns the verdict into **INVALID** (exit 3) instead of FAIL — re-run, don't
read it (`browsers/README.md`, "Measurement validity", "Host isolation").
Each run also leaves `<stamp>-timelines.jsonl` (per-client timelines,
gitignored, local only) next to the report. `--edit-mode=standalone` (one
save per edit) or `mixed` measures the single-save case next to the default
insert-after + PUT pair.

**Do not start a k6 burst during it** — that was the run #2 recipe and is
now the 1,000-client trap: under R2 every one of these 500 clients fetches
on the broadcast by itself, so the browsers run IS the 500-viewer burst; a
concurrent `viewers.js` would add another 500 notification fetches per save
(and its own saves on the same event) and measure an audience twice the
one being sized. The report has one per-save table for pages and one for
SDK clients: save → DOM / save → applied rev p50/p95/max, missing, the
broadcast arrival, the save's notification fetches and their
`x-snapshot-verify` kinds, and (SDK) ticket resolutions, rechecks and
exhausted hints; plus a whole-run "Hint outcomes" section.

**(c) Drills** (one per run, after the baseline; commands and gates in
`browsers/README.md`):

- **Hint poisoning** (`--drill=poison`): a guest anon client sends one
  forged `{ kind: "setlist", rev: 9007199254740991 }` on the public
  channel, then the honest saves run. Gated: ≤ 1 recheck of the forged hint
  per SDK client, no client's `serverRev` (read from its acceptance state)
  ever ≥ the forged rev, the forgery received; honest saves under the
  primary gate.
- **Paired spam** (`--drill=spam`): the guest sends 2 msgs/s for 60 s
  during real saves. Gated: per SDK client, notification + recheck starts
  ≥ 1 s apart (the shared cooldown) and 0 HTTP / network / deadline
  failures in the window; per-client request rates reported.
- **Verification ambiguity** (`--drill=verify-ambiguity`): right before the
  drilled PUT a helper sends `/api/setlist?…&minRev=<rev + 1000>` on all 3
  locales (`--prime-per-locale`, default 1) so the instances that serve
  them memoise the pre-save revision for 1 s, then the save follows 150 ms
  later. Reports the memo share among the save's notification fetches and
  whether each memo answer was resolved by the one recheck (the gate);
  n/a when no memo was seen — which instance serves what is Vercel's
  choice, so raise `--prime-per-locale` for a wider net.
- **Lost final / silent loss / reconnect / double save**: on the
  broadcast path. The SDK workers drop valid payloads before `noteHint`;
  the pages lose the notification through the websocket proxy (every `rev`
  broadcast frame, and postgres_changes on an R1 build) or, with
  `--drop-via=hook`, through the page's own `__osl.dropNextNotification`.
  Gates unchanged.
- **R2 tabs during a real R1 rollback** (manual): start the browsers run
  with a long window (`--edits=8 --pause=40`), redeploy the last R1 build to
  the dev preview mid-run, keep editing, then redeploy R2. Expect no
  `x-snapshot-verify` (missing) → body satisfied or one recheck, 0 missing,
  0 failures; the redeploy itself is a cold start, judge it apart.
- **Sustained spam + real saves + background traffic** (k6 + `--drill=spam`
  long): `--drill=spam --spam-secs=300 --edits=12`, and from Git Bash a
  background-only `viewers.js` with **no saves and no bursts** — `-e
  ADMIN_CYCLES=0 -e QUIET_CYCLES=0 -e COLD_START=0 -e POLL_RPS=1 -e
  SSR_RPS=2.5 -e REACTIONS=500 -e REACTION_AT=60 -e STEADY_SECONDS=300 -e
  DRAIN_S=0`, with `EXPECTED_ROWS` unset (the browsers run adds a row per
  edit). The SDK clients already produce the periodic polls, so k6 adds
  only the page loads and reactions; its admin/burst gates read n/a or
  FAIL in this mode by construction.

**Harness smoke (2026-10-11, 2 pages + 5 SDK, event 111, dev preview still
on R1 server and R1 page build).** Every run: primary gate PASS, 0 missing,
0 monotonicity regressions. Without the `x-snapshot-verify` header every
answer is `missing`; the R1 server's repair path served the saved rev, so
the honest saves' notification fetches were satisfied without a recheck.

| Run | Result |
|---|---|
| no drill (2 edits) | pairs p95 1,579 ms; SDK: 26 hinted fetches, all `missing` + satisfied, 0 rechecks; pages (R1 build) received the `rev` broadcast 4/4 at p50 456 ms vs postgres_changes 569 ms |
| `poison` | PASS: 5/5 SDK received the forgery; per client 1 notification fetch + 1 recheck (both inconclusive) → exhausted; 0 clients with serverRev ≥ forged (max held 453) |
| `spam` (`--spam-secs=20`) | PASS: 40 msgs, all acked `ok`; per client ≤ 0.98 hinted requests/s, smallest gap 1,000 ms; 0 failures; 104 hinted fetches, 1 recheck (new spam hints keep superseding the carried ticket) |
| `verify-ambiguity` | n/a (by design on R1): 3 priming requests, 5 hinted fetches all `missing` + satisfied; memo needs the R2 server |
| `lost-final` | PASS: drilled max 21.5 s (gate 26 s); SDK delivered by `periodic` 5/5; proxy dropped 7 frames per page |
| `silent-loss --drop-via=hook` | PASS: 1 page, hook armed and consumed (0 left), repaired by the periodic poll at 15.5 s |
| `double-save` | PASS: pages 2/2, SDK 5/5 converged to the final save (rev 480), p95 1,320 ms |
| `reconnect` | PASS: rejoin p95 pages 1.2 s / SDK 1.24 s, 0 re-creations, 0 handoff regressions |

## n14 warming run (writer warming, `LIVE_WARM_ENTRIES=1`)

Writer warming (`src/lib/liveWarm.ts`) builds every locale's snapshot
once, right after a save commits (in the save request's `after()`), and
stores it in the Vercel Runtime Cache under `<event>:<locale>:<rev>` for
90 s. A notification fetch (`hint=1&minRev=R`) first looks that key up
(≤ 300 ms) and, on a hit, is answered from it (`x-snapshot-source: warm`,
`x-snapshot-verify: satisfied`) instead of building. The question this
run answers: how much of the per-save build storm (215–525 builds on
40–100 instances at 500 clients) disappears, and whether the hinted
fetches arrive late enough to find the entry. The harness only observes;
the flag is a server env the operator sets on the preview (a change needs
a redeploy).

**Two deployments, same day, same fleet state:**

| | flag off (control) | flag on |
|---|---|---|
| server env | `LIVE_WARM_ENTRIES` unset | `LIVE_WARM_ENTRIES=1` (optional third variant: `+ LIVE_WARM_CONCURRENCY=1`, sequential builds) |
| reference | the Small control (`results/2026-10-11/REPORT-small-control.md`); re-run it on the day when the fleet / compute differs | this run |
| expected | 0 `[liveWarm]` / `warm-lookup` lines, `warm` never a source | one warm job per save, warm hits on most hinted fetches that arrive after warm-complete |

Preflight as in the R2 baseline (event 111 at 23 rows, positions 1..23,
`ongoing`; record the Supabase compute size). Confirm the flag before the
run: one admin save, then `curl -si
"$BASE_URL/api/setlist?eventId=111&locale=ja&minRev=<its rev>&hint=1"` →
`x-snapshot-source: warm` within 90 s, and the Vercel logs show
`[liveWarm] start … done` for that rev. With the flag off the same
request answers `build` / `cache` / `repair`.

**Side-cars** exactly as in run #2b-1 (`pooler-clients.mjs` +
`vercel-logs-capture.mjs` via `Start-Process`, ~30 s of baseline; the
1 s Supavisor backend sampler from the Small control if it is at hand),
and **always the history re-fetch afterwards**, one file per measurement
window (the `--follow` file is a live view, not the record). The
summariser and `warm-join.mjs` need the complete record: the warm job's
lines sit in the save request's entry, and the `--follow` capture kept
only 29 % of the entries in run #2b-1.

**(a) k6 alone** (Git Bash) — the same hinted bursts as the R2 baseline:

```bash
tests/load/run.sh viewers.js -e HINT_MODE=r2 -e BURST_SIZE=500 -e JITTER_MS=500 \
  -e BURST_GAP_S=8 -e ADMIN_CYCLES=4 -e DRAIN_S=90
```

Read in the k6 report: the per-burst source split `build / cache /
repair / warm` and `warm W/N hinted`, the **warm hits** line under the
hint outcomes. Note that k6 fires its burst over U(0, 500 ms) from the
moment the save RETURNED, i.e. from about when the warm job starts, so a
large share of k6 requests arrives before warm-complete by construction
— k6 measures the storm with warming on, the browsers run measures the
real arrival pattern (broadcast delivery + the client's jitter).

**(b) Browsers alone** (never with a concurrent k6 burst, see the R2
baseline):

```bash
node --no-warnings tests/load/browsers/run.mjs --pages=30 --subs=470 --edits=12 --pause=25 --label=warm-on
```

Run it with nothing else on the host (see the R2 baseline (b): the
history re-fetch and the summariser come afterwards; an INVALID verdict,
exit 3, means the load host stalled — re-run). The report's per-save
tables add `warm / hinted` and the first hinted
request's start − commit (commit proxy = the PUT's response); the gate
table adds an informational **warming** row (hit rate SDK / pages). The
JSON's `warm` section holds every client's first hinted fetch per save
for the join below.

**Afterwards**, per window (k6, browsers):

```powershell
New-Item -ItemType File "$out/warm.STOP" | Out-Null
# history re-fetch of the window (see run #2b-1), then:
node tests/load/vercel-logs-summary.mjs <history.txt> --add-hours=7 --out="$out/vercel-logs-history-summary-warm-<k6|browsers>.md"
node tests/load/warm-join.mjs <stamp>-browsers.json <browsers-history.txt> --add-hours=7 --out="$out/warm-join.md"
node tests/load/viewers-check.mjs
node --no-warnings tests/load/browsers/restore.mjs --compact --yes
```

- `vercel-logs-summary.mjs` → **Warming** section: the run-level **warm
  hit rate = hits ÷ hinted fetches**; per warm job the start → done ms
  (≈ warm-complete − commit), each locale's `set` (rev, bytes, build / set
  ms, ok) and `skip` reasons, `schedule-failed` / `job-failed` counts; per
  save rev the builds split into **warm** (the job's own 3) and **reader**
  builds (every other build of that rev — the storm that is left), the
  `warm-lookup` results (hit / miss / stale / invalid / error / timeout /
  memo-miss / capped)
  and their ms p50 / p95; lookups per minute. Compare reader builds per
  save, distinct instances per save, the pool Σ peak and the backend busy
  max against the control.
- `warm-join.mjs` → per save and locale: warm-complete − commit (rebuilt
  from the job's buildMs + setMs over 2 workers, `--warm-concurrency=1`
  for the sequential variant; "unaccounted" = done ms − the rebuilt end),
  the share of first hinted fetches (SDK / pages) that left after it, and
  the hit rate after vs before. Hits ≈ "after" means the entry is used as
  soon as it exists; a large "before" share means the clients outrun the
  job and only a later trigger (e.g. a ready signal or more jitter) could
  help — the design question this run settles.
- The latency gates are the same as the control's (save → visible p95 ≤
  3 s, 0 missing, 0 regressions); report save → visible p95 pages and SDK
  per save next to the control's.

**(c) Drills to repeat with the flag on** (`browsers/README.md` for the
commands; one per run): warm entries change what a notification fetch
returns, so the drills whose correctness depends on that answer run again:

- **double-save** (`--drill=double-save`): two saves R₁ < R₂ ~300 ms apart.
  R₁'s job may store a snapshot with rev R₂ under key R₁ (stored with its
  actual rev, never relabelled); every client must still converge on R₂
  with 0 regressions. Check `warm-join` for both revs.
- **lost-final** (`--drill=lost-final`): the last save's notification is
  dropped, so no hinted fetch exists for it; the periodic repair poll
  (generic, never a lookup) must deliver it — expect delivering reason
  `periodic`, no `warm` source on that save, max ≤ 26 s.
- **spam, short** (`--drill=spam --spam-secs=20`): every forged `ahead`
  rev becomes a notification fetch for a key no save wrote — a `miss`
  (bounded at 300 ms) and then the normal path. Gate unchanged (cooldown
  respected, 0 hard failures); additionally read the summariser's
  lookup misses and their ms p95 during the spam window, and that no
  forged rev ever shows `warm`.

## n14 qualification step 4 — overlapping warm jobs (`--drill=overlap`)

Step 4 keeps the warming implementation and qualifies it when two or
three saves' warm jobs genuinely overlap: B commits while A's job is
still building or publishing, builds hold pool connections at the same
time, a locale's entry is published in reverse order, a catalog edit
expires the warm tag between A's capture and A's publication. Per-save
faults (`x-live-warm-fault` on save A only, see "Warming fault drills")
make one of two saves slow or failing deterministically; they need an
armed one-off preview (`LIVE_WARM_FAULT_ARMED=1`, header-only, no
`LIVE_WARM_FAULT`) and `--deployment-url` — the dev alias ignores the
header, so the harness refuses `--overlap-fault-a` without it. The drill,
its flags and its client-side gates: `browsers/README.md`, "Overlap
drill".

**Afterwards, per run** (history re-fetch of the deployment as usual;
nothing else on the host while the run is live):

```powershell
node tests/load/vercel-logs-summary.mjs <history.txt> --add-hours=7 --out="$out/vercel-logs-history-summary-<S>.md"
node tests/load/overlap-join.mjs <stamp>-browsers-overlap.json <history.txt> --add-hours=7 --timelines=<stamp>-timelines.jsonl --out="$out/overlap-join-<S>.md"
node tests/load/warm-join.mjs <stamp>-browsers-overlap.json <history.txt> --add-hours=7 --out="$out/warm-join-<S>.md"
node tests/load/viewers-check.mjs
node --no-warnings tests/load/browsers/restore.mjs --compact --yes
```

- `overlap-join.mjs` classifies every group from the server's explicit
  timestamps (`at=` on every `[liveWriter]` / `[liveWarm]` /
  `[dataCache] expire-warm` line — a history-mode log stamps a request's
  lines with the request's START, so entry times cannot time a job):
  (i) B's writer `at` < A's last SUCCESSFUL set `at` (publication = `ok=true`
  sets only); (ii) A / B `[txStartAt, txEndAt]` intersect (database
  occupancy; queued time excluded) — build-invocation overlap reported
  apart; (iii) per locale, B's successful set before A's (cross-instance
  differences < 100 ms = indeterminate); (iv) per locale, the catalog race
  (A captured before the expiry started, the expiry finished before A's
  set started, B published before the expiry; B's key gone at the +1 s
  probe), stale service **proven only by content** (a `warm` answer after
  the expiry with the pre-edit title; probes and, with `--timelines`, SDK
  responses), censored when still stale at the last observation; S3
  (`seterror`): A's builds ran, nothing published, A's key missed while
  B's job ran. Three clocks, never mixed silently: the functions'
  `Date.now()` (`at*`), PostgreSQL `now()` (`captureAt` / the body's
  `capturedAt`, the reaction `ackAt`), this machine (the browsers JSON).
  It also checks the fault evidence (A's job `fault=<label> source=header`,
  none on B / C), acquireMs ≤ 500 per save, pool timeouts, EMAXCONN, builds
  in [group start, +10 s] per committed save, commit → entry stored per
  key and locale (server clock) and the first `warm` probe per key. A
  group whose intended race did not happen is **not exercised**; the
  minimum fixed beforehand is ≥ 4 of 6 groups (S5: ≥ 3 of 6) — below it
  the run is NOT EXERCISED and is re-run once with the gap adjusted (both
  runs stay in the record). A log from a server without the `at=` fields
  is reported UNCLASSIFIABLE. The scenario is derived from the run's
  flags (`--scenario=S0..S6` overrides).
- `vercel-logs-summary.mjs` adds, on such logs: every save of a route
  with ≤ 12 saves with its commit `at`; a "Warm expiry" section for the
  `expire-warm` lines with the request they belong to; the job records
  carry the new fields (start `fault` / `source`, per-locale `at`,
  `setStartAt`, `captureAt`, `buildStartAt` / `buildEndAt`, `txStartAt` /
  `txEndAt`, `holdMs`).
- `warm-join.mjs` uses `set at − writer at` per locale when the log has
  the fields (offsets column "at"; older logs keep the "rebuilt"
  reconstruction), keys entries by `(event, atLeastRev)` only, adds "entry
  rev ≠ key rev" (a job for R stored a newer snapshot) and "served newer
  than key" (a warm answer whose body rev is above the key), and lists
  `warm.groups` of an overlap run.

What the first execution (2026-10-12, `tests/load/results/2026-10-12/REPORT-step4.md`)
taught about running it:

- Unfaulted overlap needs commits within ~100 ms of each other: real warm
  jobs publish ja/ko ≈ 55–110 ms and en ≈ 250 ms after the commit, so
  `--overlap-gap=250` (and 100) exercised 1 of 6 groups and S4 as designed
  0 of 6. A three-writer run exercised 4/6 only at `--overlap-gap=60
  --overlap-third-at=120`. Expect the gap re-run for S1/S4 and keep both.
- `slowbuild=<ms>` saturates the A instance's pg pool (max 2) for ≈ 2 × hold
  (ja/ko in parallel, en queued), so any writer routed to that instance
  waits in its pre-transaction lookup — visible as a slow PUT with a small
  `acquireMs`. 1500 ms (~14× the real hold, p95 108 / max 229 ms) fails the
  PUT gate on co-located B/C; 500 ms passes.
- The stale late fill of S5 is not a 2 s window: the superseded key's entry
  serves the pre-edit content until its 90 s TTL. The 120 s quiet tail is
  what shows it — keep `--overlap-quiet-tail=120` on S5.
- `--deployment-url` accepts only `opensetlist-<hash>-opensetlist-projects.vercel.app`;
  for a branch preview use the hash URL from `vercel inspect <git alias>`.
- The Vercel firewall denies `POST /api/admin/login` after ~5 rapid logins
  from one IP (`X-Vercel-Mitigated: deny`, clears in about a minute). One
  login per run; don't verify headers in a loop right before a run.
- `tests/load/results/2026-10-11/supavisor-backends.mjs` stops on a STOP
  file in ITS OWN directory unless `--out-dir=<dir>` (with `=`) points at
  the run's results dir; without it the run script waits forever on the
  sampler, and `--out-dir <dir>` (space) makes it exit at start.

Tests (Node's runner, like the other harness tests):
`node --test tests/load/*.test.mjs tests/load/browsers/*.test.mjs tests/load/realtime/*.test.mjs`.

## n14 qualification step 5 — cold admission (`--phase=admission`, `--drill=idle-broadcast`)

Step 5 qualifies the candidate when the audience ARRIVES: 30 pages + 470
SDK clients admitted onto a **fresh deployment** while saves happen
(A0 / A0′, A2 with the 70-row fixture and the I3 final phase, A4 with
warm lookups returning null), the k6 fetch-shape mix (A1, its own
section), and the first save after an idle period plus the runbook's wake
procedure (I1 / I2, with the independent observer as a second vantage
point). The harness side — prepare → boundary → admit, exposure, gates,
cohorts, eligibility, record formats — is in `browsers/README.md`,
"Admission phase" and "Idle-broadcast drill"; the server / observer /
k6 join is `admission-join.mjs`.

**Cold trigger = a fresh deployment**: `vercel redeploy` of the
deployment the dev alias serves (same commit, same settings) → a new
`BUILD_KEY`, so new generic-snapshot and warm namespaces, and no request
of ours reaches it before T0 (the harness proves its side: 0 outbound
requests in the boundary wait). It does NOT prove every function process
was cold; the first-arrival `x-snapshot-source` mix is reported instead.

**A0 / A0′ — operator sequence (dev alias):**

```powershell
$out = "tests/load/results/<UTC date>"
# 0. host isolation (nothing else on the laptop); the observer is optional for A runs
# 1. the precursor = what the alias serves now (keep the output)
npx vercel inspect opensetlist-git-dev-opensetlist-projects.vercel.app --scope opensetlist-projects
# 2. start the harness: prepare (login, anchor row, manifest), then it WAITS for the admit file
node --no-warnings tests/load/browsers/run.mjs --phase=admission --pages=30 --subs=470 --edits=0 `
  --admit-file="$out/admit-A0.json" --strict-host --restore-positions --label=step5-A0
# 3. when it logs "boundary: waiting for --admit-file": redeploy the precursor and wait for Ready
npx vercel redeploy <precursor URL> --scope opensetlist-projects
#    the alias must now point at the NEW deployment (if not: npx vercel alias set <new URL> opensetlist-git-dev-opensetlist-projects.vercel.app)
npx vercel inspect opensetlist-git-dev-opensetlist-projects.vercel.app --scope opensetlist-projects
# 4. T0 = the moment this file appears (the harness polls every 100 ms); the binding goes into the run record
'{"precursorId":"dpl_…","measurementId":"dpl_…"}' | Out-File -Encoding utf8 "$out/admit-A0.json"
```

Nothing else may touch the measurement deployment between the redeploy
and the admit file — no browser tab, no `curl`, no `vercel logs
--follow` against it (log capture reads Vercel's log API, not the
deployment; start it, if at all, against the project). A0′ repeats the
whole sequence with a second redeploy.

**A2** (70 rows + steady tail + I3): run the fixture script first
(`tests/load/fixtures/fes-rows.mjs`, see its section), then the harness
with `--rows-manifest=<fixture json> --edits=8 --edit-mode=mixed
--pause=25 --final-cohort=20,20`; the fixture's own clean-up after the
harness's. **A4** (warm lookups return null, 70 rows): a one-off
deployment pair — the precursor deployed with `LIVE_WARM_FAULT=getnull`
and `LIVE_WARM_FAULT_ARMED=1` ("Warming fault drills"), verified by the
harness's identity guard, then `vercel redeploy` of it = the measurement
deployment:

```powershell
$env:BASE_URL = "<precursor URL>"
node --no-warnings tests/load/browsers/run.mjs --deployment-url --guard-precursor=<precursor URL> --phase=admission `
  --pages=30 --subs=470 --edits=0 --rows-manifest=<fixture json> --admit-file="$out/admit-A4.json" --strict-host --restore-positions --label=step5-A4
# after `vercel redeploy <precursor URL>` is Ready — the admit file names the measurement deployment:
'{"base":"https://opensetlist-<new hash>-opensetlist-projects.vercel.app","precursorId":"dpl_…","measurementId":"dpl_…"}' | Out-File -Encoding utf8 "$out/admit-A4.json"
```

The harness refuses a measurement base equal to the precursor, and one
generic read at T0 must show the dev manifest before the first save
writes through the new deployment. Delete the pair afterwards; the
evidence comes from `admission-join.mjs --fault=getnull` (armed line,
zero warm hits, tagged miss / memo-miss, no invalid / blocked fault).

**I1 / I2 — operator sequence.** The idle clock starts at max(the last
restore broadcast, the last disconnect of ANY client of ours, the
observer included) and needs ≥ 30 min; never open the Supabase Realtime
Inspector as a subscriber during it. Pick the connect instant `T` far
enough ahead for the workflow to start (≥ 3 min):

```powershell
gh workflow run n14-observer.yml --ref <branch with connect_at> `
  -f base=https://opensetlist-git-dev-opensetlist-projects.vercel.app -f minutes=6 -f clients=5 `
  -f connect_at=<T> -f label=step5-I1a
node --no-warnings tests/load/browsers/run.mjs --drill=idle-broadcast --pages=0 --cohort-incumbents=20 `
  --connect-at=<T> --first-save-file="$out/first-save-I1a.txt" --strict-host --restore-positions --timeout=60 --label=step5-I1a
# watch the observer's live log; at `[observer] ready clients=5/5 subscribed_at=… at=<R>` release the save:
'<R + 6 s, ISO>' | Out-File -Encoding ascii "$out/first-save-I1a.txt"     # empty file = 6 s after it appears
# afterwards
gh run download <run id> -n n14-observer-<run id> -D "$out/observer-I1a"
```

I2 adds `--wake --cohort-fresh=20` (the check save is verified by
broadcast at every connected local client; a miss → one retry save, a
second miss → "escalate" in the report; the fresh cohort joins at
+`--wake-gap`=600 s). Two cycles each of I1 and I2, plus I3 inside A2
(design: five controls).

**Reading the observer while it runs.** `gh run view --log` (and
`--log-failed`) only returns a run's logs once it has COMPLETED — for an
in-progress run the CLI answers that the logs will be available when it
is complete (the per-job logs download, `GET
/repos/{owner}/{repo}/actions/jobs/{job_id}/logs`, is the same archive).
The live stream is the GitHub web UI: `gh run list --workflow
n14-observer.yml -L 1`, then `gh run view <run id> --web`, open the
"Observe event broadcasts" job and watch the "Run observer" step, which
streams the `[observer] ready …` / `[observer] connected …` lines as they
are printed. (Checked against the documented CLI / API behaviour, not
exercised live from this branch.) If the live view is not available,
release the save at a fixed `connect_at + 8 s` (`--first-save-at=<T+8 s>`
instead of the file); the post-hoc eligibility in `admission-join.mjs
--observer=` decides for the observer's clients either way — the report
must say which of the two happened. Until this branch is merged, the
`connect_at` input exists only on it: dispatch with `--ref <branch>`.

**Afterwards, per run** (history re-fetch of the window as usual; nothing
else on the host while the run is live):

```powershell
node tests/load/vercel-logs-summary.mjs <history.txt> --add-hours=7 --out="$out/vercel-logs-history-summary-<run>.md"
node tests/load/admission-join.mjs <stamp>-browsers-admission.json <history.txt> --add-hours=7 `
  [--observer="$out/observer-<run>/<stamp>-observer-<label>.jsonl"] [--k6=<k6 summary json>] [--fault=getnull] --out="$out/admission-join-<run>.md"
node tests/load/viewers-check.mjs
node --no-warnings tests/load/browsers/restore.mjs --compact --yes
```

`admission-join.mjs` puts per save the harness's exposure, stale first
answers, convergence per population and broadcast receipt vs reason next
to the server's commit `at` (inside [PUT start, PUT response] /
indeterminate below 100 ms / a clock offset) and the writer acquire
(gate ≤ 500 ms); the admission window (builds per minute and per
instance, warm-job vs reader builds, instances by first appearance, 503
hint fetches, EMAXCONN); **Σ** (sum of per-instance pool totals) with its
completeness — log coverage of the window, the largest gap between
entries, instances that never logged a pool line, the bucket-maxima
caveat; the A4 fault evidence; and the I-cycle eligibility + arrival
tables for the harness's cohorts and the observer's clients (same rule).

**k6 summary shape for admission-join (A1, optional).** `--k6=<file>`
expects one JSON object; every field is optional and rendered when
present:

```json
{
  "T0": 1791784076509,
  "arrivals": { "total": 500, "byShape": { "generic": 500 }, "p95Ms": 640, "fivexx": 0, "s503": 0, "transport": 0 },
  "saves": [{ "rev": 1574, "putStart": 1791784081521, "putEnd": 1791784082013, "status": 200,
              "admitted": 300, "outstanding": 200, "httpInFlight": 40 }],
  "shapes": { "R2": { "notified": 180, "exactHead": 180 }, "R1": { "notified": 75 }, "preR1": { "notified": 45 } },
  "ssr": { "requests": 600, "p95Ms": 900 }
}
```

Times are epoch ms of the k6 host; `saves[].admitted` / `outstanding` /
`httpInFlight` are the k6 side's exposure evidence at the save's
response (k6 has no SUBSCRIBED or DOM to count). The file `viewers.js`
writes in `ADMISSION=1` mode (`kind: "k6-admission"`, see the k6 section) is
accepted as-is: `admission-join.mjs` maps it onto these fields
(`normaliseK6`) and keeps the original under `raw`.

## n14 qualification step 6 — deployment transitions (`--phase=transition`)

Step 6 qualifies **switching the dev alias between deployments while
tabs stay open**: rollback 1 (ON → OFF, `LIVE_WARM_ENTRIES=0`), rollback
2 (ON → R1 = `385e5f0`, no warming, no `x-snapshot-verify`,
`postgres_changes` pages), and the returns (to an EXISTING ON deployment
and to a FRESH one). No server change; dev DB only, event 111. The
harness side — switch-file protocol, timeline, identity guard, route
marker, probe, controlled subsets, arrivals, smoke, exposure, verdicts,
record formats — is in `browsers/README.md`, "Transition phase"; the
attribution of every recorded `x-vercel-id` to a deployment is
`transition-join.mjs` (its own section).

**Rules for the whole run day.** Nobody merges or pushes to `dev` while
the runs are on (a push redeploys and MOVES the alias on its own). Every
deployment is `vercel deploy -e …` from the tree — never `vercel
redeploy`, which drops deployment-level `-e` env. The alias moves only
with `vercel alias set`. After the last run: alias back to the dev HEAD
deployment and verified, tabs closed, logs exported — only then delete
the run's deployments.

**Deployments (8; record commit, env, role, twin, ids):** ON-A (dev HEAD,
Preview env, the incumbent), OFF-1 + its twin OFF-1t (`-e
LIVE_WARM_ENTRIES=0`; the twin is verified — save + hinted fetch → no
`[liveWarm]` lines — so the measurement target stays untouched), ON-B
(fresh return target), ON-A′ (T2's incumbent), R1-1 + twin R1-1t
(`385e5f0`: no `x-snapshot-verify`, `postgres_changes` page), ON-C
(fresh return target for T2).

```powershell
$alias = "opensetlist-git-dev-opensetlist-projects.vercel.app"
# deploy (from the matching tree; never `redeploy`)
npx vercel deploy --scope opensetlist-projects                                  # ON-x
npx vercel deploy --scope opensetlist-projects -e LIVE_WARM_ENTRIES=0           # OFF-1 / OFF-1t
npx vercel inspect <url> --scope opensetlist-projects                           # id, env, state — keep the output
```

**Operator sequence for one run (e.g. T1: ON-A → OFF-1 → ON-A → ON-B):**

```powershell
$out = "tests/load/results/<UTC date>"
# 0. host isolation (side-cars allowed: pooler samplers, log capture); the alias serves the incumbent
# 1. start the harness; it prepares, joins 30 pages + 470 SDK, settles, then polls switch file 1
node --no-warnings tests/load/browsers/run.mjs --phase=transition --pages=30 --subs=470 `
  --switch-files="$out/t1-a.json,$out/t1-b.json,$out/t1-c.json" --strict-host --label=step6-T1
# 2. per switch, ≥ 60 s ahead: write the plan (P on a whole second; leave ≥ --leg-gap 90 s after
#    the previous leg's last save before P - 30 s)
$P = (Get-Date).ToUniversalTime().AddSeconds(75).ToString("yyyy-MM-ddTHH:mm:ss.000Z")
@{ plannedAt = $P; kind = "off"; label = "ON-A→OFF-1" } | ConvertTo-Json | Out-File -Encoding utf8 "$out/t1-a.json"
#    (kind: pseudo | off | return | fresh | r1 | return-from-r1;
#     after a return from R1 add  afterSwitchSaves = "insert,update,delete")
# 3. at P: move the alias, timing the CLI process, then MERGE the result into the same file
$s = (Get-Date).ToUniversalTime()
$p = Start-Process npx -ArgumentList "vercel alias set <OFF-1 url> $alias --scope opensetlist-projects" -NoNewWindow -PassThru -Wait
$e = (Get-Date).ToUniversalTime()
$j = Get-Content "$out/t1-a.json" -Raw | ConvertFrom-Json
$j | Add-Member cliStart $s.ToString("o"); $j | Add-Member cliEnd $e.ToString("o")
$j | Add-Member cliCpuMs ([int]$p.TotalProcessorTime.TotalMilliseconds)
$j | Add-Member target @{ url = "https://<OFF-1 hash>-opensetlist-projects.vercel.app"; id = "dpl_…" }
$j | ConvertTo-Json -Depth 4 | Out-File -Encoding utf8 "$out/t1-a.json"
# 4. the harness runs the leg on its own: saves at P-30 … P+60 s, the identity guard through
#    target.url, the route marker, the subsets, arrivals at P+10 s, the smoke at P+20 s.
#    Repeat 2–3 for the next switch file.
# 5. after the run: alias back to the dev HEAD deployment, verify, then
node tests/load/browsers/restore.mjs --compact --yes
# 6. export the Vercel request logs per deployment (bounded windows) and join:
#    transition-join.mjs (its own section)
```

- **T0** (control): ON-A only, three `kind: "pseudo"` switch files; at
  each P run comparable read-only CLI work (e.g. `vercel inspect`) and
  write the CURRENT deployment as `target` — same timeline, same
  arrivals, same CLI overhead.
- **T1**: ON-A → OFF-1 (`off`) → ON-A (`return`: stale-first-answer
  check) → ON-B (`fresh`); the hold subset acts at every switch.
- **T2**: ON-A′ → R1-1 (`r1`: the arrival's page part is the 15-page R1
  cohort) → ON-C (`return-from-r1` + `afterSwitchSaves:
  "insert,update,delete"`: the ahead-hint subset is armed before it and
  the R1 tabs see all three change types).
- The alias CLI runs on the load laptop as a recorded exception: its
  start / end and process CPU go into the switch file; the INVALID
  thresholds apply to the whole window as in every run.
- Re-runs only for NOT EXERCISED exposure (exit 4) or INVALID (exit 3);
  a reduced population is a separate configuration and the original
  result is kept. A failed identity guard aborts the timeline (exit 2)
  before any further write.

## n14 qualification step 7 — 5-minute spam + real saves + background k6 (`--phase=spam7`)

Step 7 qualifies the live path **under a sustained guest spammer**:
forged `rev` broadcasts at 2 msgs/s for 300 s (≈ 1,000 deliveries/s at
500 receivers), `ahead` and `max`, while 12 mixed edits (18 measured
writes + the anchor) land and a background-only k6 runs. Small,
warming ON, 30 pages + 470 SDK, dev DB event 111, no server change.
Release rule: pass → no new machinery; fail → fix or explicit
acceptance of the degraded target (the report gives the worst per-save /
per-population p95, max, share > 3 s, affected saves). Harness side —
timeline, sender, receivers, predeclared gates, verdicts, JSON shape —
in `browsers/README.md`, "Spam phase"; server logs, k6 summary and
side-cars: `spam7-join.mjs`.

| run | flags (besides `--phase=spam7 --pages=30 --subs=470 --strict-host --declared-process=<k6 pid>`) | notes |
|---|---|---|
| P0 | `--spam-rev=none` | control: same save schedule, recovery from the scheduled attack end |
| P1 | `--spam-rev=ahead` | primary |
| P2 | `--spam-rev=max` | primary |
| P1r | `--spam-rev=ahead --save-offsets=12.25,37.25,…,287.25` | repeat, shifted against the 2/s sender phase |
| P3 | `--spam-rev=stale --spam-secs=60 --save-offsets=-20,70` | ignore-path control, head held fixed in the block |
| P4 | `--spam-rate=10` with the worse of ahead/max | optional stress, informational |

**Background k6** (on the load laptop, started BEFORE the harness, its
pid passed as `--declared-process`): `viewers.js` with `POLL_RPS=1
SSR_RPS=2.5 REACTIONS=500 ADMIN_CYCLES=0 QUIET_CYCLES=0 COLD_START=0
HINT_MODE=r2 DRAIN_S=0 STEADY_START=0`, a steady window covering
baseline → recovery (≥ 420 s after the harness's readiness), the 500
reaction POST+DELETE pairs aligned with the save at spam + 135 s (P1r:
+137.25 s). The harness accepts exactly that pid (+ descendants);
anything else unknown still refuses, and is re-checked mid-spam and at
the measurement end (INVALID if found). If k6 exits before the recovery
end the background aspect is NOT EXERCISED.

**Order per run:** fixture (70 rows) → side-cars → k6 (pid) → harness →
`node tests/load/browsers/restore.mjs --compact --yes` → log fetch
(after the measurement only) → `spam7-join.mjs`. Exit codes: 0 VALID +
PASS, 1 VALID + FAIL, 3 INVALID (host corruption), 4 NOT EXERCISED
(insufficient declared load: exposure below the predeclared minimums,
fixture not served, background ended early, no eligible stale receipt).
A FAIL outranks NOT EXERCISED: service failures under an under-driven
attack are still failures.

```bash
node --no-warnings tests/load/browsers/run.mjs --phase=spam7 --pages=30 --subs=470 --spam-rev=ahead --strict-host --declared-process=12345 --label=step7-P1
```

## Independent observer (`observer.mjs`, `n14-observer.yml`)

(Dev only. The production read-only mode, `--prod-readonly`, is a
separate client documented under "n14 qualification step 8".)

The browsers harness stamps every broadcast arrival on the laptop that
also runs the load. When a save's notification looks late, the report
alone cannot say whether the service was slow or the laptop was
saturated. The observer is a second vantage point on another host and
network: a few SDK clients (`browsers/subs-worker.mjs` run unchanged
in a worker, i.e. the same R2 page model with hinted fetches), one
plain `/api/setlist` poller every 5 s without Realtime, and a 100 ms
event-loop lag sampler. It never writes and needs no database URL or
admin password.

**When to start it.** Before the run's population join, so its clients
are subscribed when the measured saves happen, and with a window that
covers the whole run (`minutes` ≥ the run's length; max 60). Saves
before its clients' first SUBSCRIBED time cannot be in its report.

- On GitHub (preferred: different host and network): Actions →
  "n14 — independent observer" → Run workflow (`base`, `minutes`,
  `clients`, `label`). Results are the `n14-observer-<run id>` artifact.
  It costs Actions minutes for the whole window, and only one observer
  runs at a time.
- Locally (smoke, or a second machine):
  `node --no-warnings tests/load/observer.mjs --event=111 --clients=5 --minutes=10 --label=<s> [--out=<dir>]`
  (Node ≥ 22.18; env as for the harness, only `NEXT_PUBLIC_SUPABASE_URL`
  and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are read; Ctrl-C stops early and
  still writes the files).

**Output.** `<stamp>-observer[-<label>].jsonl` (one line per broadcast
arrival, request, applied snapshot, poll and lag sample; `t` is epoch
ms UTC) and `.md`: per rev the first arrival (UTC), the spread across
the observer's clients, the hinted fetch p50 / p95 and its
`x-snapshot-source` mix (`warm` = served from the writer-warmed entry),
applied − first arrival, when the plain poller first saw the rev; revs
the clients applied that no client got as a broadcast; event-loop lag
p95 / max; the host.

**Reading it next to the harness report.** Line up the same rev:

- Observer on time, harness late → the load host is the suspect
  (check the harness's own lag / CPU); the service delivered.
- Both late by a similar amount → the service (Realtime fan-out or the
  writer) was late.
- Observer's hinted fetch p95 high too → `/api/setlist` was slow for
  everyone; the plain poller's latency at that time is the floor
  without hints.
- Observer's own lag p95 in the hundreds of ms → its numbers for that
  window are not trustworthy either.

It is a relative observer: a GitHub runner is in the US, ~150–200 ms
RTT from the Seoul project, and that RTT is in every number it records.
Compare arrivals per rev (both hosts' clocks are NTP-synced, so tens of
ms of skew at worst — fine for second-scale spikes), not its absolute
latency with the laptop's.

**One-time setup (repository variables).** The workflow reads the DEV
project's public URL and anon key from repository *variables* (they
ship in every page bundle, so they are not secrets): Settings → Secrets
and variables → Actions → Variables → New repository variable:

- `N14_DEV_SUPABASE_URL` = the dev project's `NEXT_PUBLIC_SUPABASE_URL`
  (`https://nddawybyuedsrshhxikx.supabase.co`)
- `N14_DEV_SUPABASE_ANON_KEY` = the dev project's
  `NEXT_PUBLIC_SUPABASE_ANON_KEY`

The observer refuses any other Supabase project and any base URL other
than localhost or the dev preview alias.

## Warming fault drills (`LIVE_WARM_FAULT`)

"A warm miss takes the old path" proves a fallback, not capacity when
misses are widespread. These drills run the 500-viewer load while the
warm cache is absent, slow, failing or only partly published. Platform
knobs cannot produce these faults. `RUNTIME_CACHE_TIMEOUT` only
configures the SDK's fallback HTTP client, and a deployed function
prefers the request-context cache. A different namespace only moves the
key prefix. The SDK turns HTTP errors into `null`, which is a plain
`miss`. So `src/lib/liveWarm.ts` injects the fault itself, around the
cache `get` / `set` and around the warm job's per-locale step (see
"Fault injection" there).

**Arming: two server env vars, on a disposable preview deployment
only.** Set `LIVE_WARM_FAULT_ARMED=1` and `LIVE_WARM_FAULT=<spec>`, plus
`LIVE_WARM_ENTRIES=1`, because the writer modes need warming on. The
code refuses to inject when `VERCEL_ENV=production`: it logs
`[liveWarm] fault-blocked` and the deployment behaves normally. Never
add these vars to the Production environment anyway. Vercel binds env
vars at deploy time, so each spec needs its own deployment. Use one of
these:

```bash
# one-off CLI deployment (always a preview without --prod; vars apply to it alone)
vercel deploy -e LIVE_WARM_ENTRIES=1 -e LIVE_WARM_FAULT_ARMED=1 -e LIVE_WARM_FAULT=slow=400
# or: vars scoped to a throwaway git branch's previews, then push that branch
vercel env add LIVE_WARM_FAULT_ARMED preview fault/drill-slow   # value 1
vercel env add LIVE_WARM_FAULT preview fault/drill-slow         # value slow=400
```

Point `BASE_URL` at that deployment's URL and pass `--deployment-url` to
`browsers/run.mjs` (Deployment Protection bypass as usual), never at the
shared dev alias. The harness refuses deployment-specific URLs by default
because the same URL shape serves production deployments; the flag
accepts the shape and, before the first admin write, checks that the
target serves event 111 at the dev database's current revision with
exactly its active rows (ids and positions — a production deployment
cannot reproduce that list). `vercel-logs-capture.mjs` has
no such flag: skip the live capture and rely on the history re-fetch
(`vercel logs <deployment url> --since … --until …`). The side-car
samplers read the database and need no URL. Remove the deployment and the
branch-scoped vars afterwards. "Saves after the fault" means switching to
an unarmed deployment of the same commit, because the fault cannot be
lifted in place.

**Spec.** Modes are comma-separated and combine, e.g. `slow=400,locale=ja`.
An unknown or malformed token makes the whole spec inert, logged as
`fault-invalid … injected=none`. **In the logs the spec is encoded as
one token:** `=` becomes `:` and `,` becomes `+`, with whitespace
removed. So `LIVE_WARM_FAULT=slow=400,locale=ja` is logged as
`fault=slow:400+locale:ja`. The encoding keeps an inner `locale=ja`
from being read as the line's own `locale` field. The input syntax stays
as written.

| Drill | Spec | Expected in the logs |
|---|---|---|
| cache absent (no entry anywhere) | `absent` | the first `warm-lookup` per key per instance → `result=miss`, near-0 ms (the `get` is skipped); repeats of that key within the 250 ms miss memo → `memo-miss` (at 500 viewers most lookups of a save are `memo-miss`; what must be 0 is `hit`) |
| absent, with real cache latency | `getnull` | `result=miss` at the normal lookup ms, repeats `memo-miss` within 250 ms; 0 `hit` |
| one missing locale (partial publication) | `locale=ja` (ja carries ~70 % of the traffic, the worst case); `locale=en` for the sparse case | per job `skip locale=ja reason=fault-locale`; ja lookups `miss`, ko/en `hit` |
| failed writes, visible | `seterror` | per locale `set … ok=false` + `set-error … injected fault: seterror`; lookups `miss` / `memo-miss`, 0 `hit` |
| failed writes, silent (what the SDK's swallowed errors look like) | `setskip` | `set … ok=true`, yet lookups `miss` / `memo-miss`, 0 `hit` |
| reads over the 300 ms deadline | `slow=400` | `result=timeout` at ~300 ms for the lookups that started or joined the key's `get` early; repeats on that key answer `memo-miss` for 1 s. NOT "no hits": about a third of lookups still `hit` through same-key coalescing — a late joiner receives the in-flight `get` (which settles at ~400 ms) within its own 300 ms deadline |
| slow but in time (control) | `slow=150` | `result=hit` at ≥ 150 ms |
| cache errors | `geterror` | `result=error` + `lookup-error … injected fault: geterror` |
| slow warming, arrivals before publication | `slowjob=<ms>` (e.g. 1000) | job `done ms` ≥ ⌈3 / concurrency⌉ × ms; `warm-join` shows more first hinted fetches before warm-complete. The sleep is before the build and holds nothing (no capture, no connection) |
| stale late fill: captured on time, published late | `slowset=<ms>` (1–10000, e.g. 1500); env spec, or per save in the `x-live-warm-fault` header (below) | `start … fault=slowset:<ms> source=header\|env`; per locale `set … holdMs=0` with `buildEndAt − buildStartAt` normal and `setStartAt − buildEndAt` ≥ ms; lookups for that key `miss` / `memo-miss` until the locale's `set … at=`; the entry carries the state at `captureAt` (DB clock), which a later save or catalog expiry may already have superseded |
| DB-held slow build (connection held) | `slowbuild=<ms>` (1–5000, e.g. 1500 — the builder's transaction timeout is 10 s, so larger values make the spec invalid); env spec or header | `start … fault=slowbuild:<ms> source=header\|env`; per locale `set … holdMs=<ms>` with `txEndAt − txStartAt` ≥ ms; at concurrency 2 two locales' `[txStartAt, txEndAt]` overlap (both of the instance's pool connections held) and the third locale's `txStartAt` ≥ the earlier `txEndAt`; queueing shows as `txStartAt − buildStartAt` and is not a held connection |
| per-save fault (one of several overlapping saves) | header `x-live-warm-fault: <spec>` on an admin setlist-item save (`POST /api/admin/setlist-items`, `PUT /api/admin/setlist-items/<id>`, `insert-after`, `swap`); job-side modes only: `slowjob`, `slowset`, `slowbuild`, `seterror`, `setskip`, `locale`. Needs `LIVE_WARM_FAULT_ARMED=1` on a non-production deployment; `LIVE_WARM_FAULT` not needed | that save's job only: `start … fault=<encoded spec> source=header`; other saves' jobs have no `fault=` (or the env one with `source=env`). A malformed spec or a lookup-side mode (`absent`, `slow`, `getnull`, `geterror`) → HTTP 400 with nothing written. Unarmed or production: the header is ignored (no `fault=`, save normal) |

**Verify the fault before trusting a run.** A run in which the fault was
not active is invalid. It is not a pass.

1. After the deploy, make one admin save and send one hinted `curl`
   (`…&minRev=<rev>&hint=1`) per locale. What the response must be
   depends on the mode: `absent`, `getnull`, `geterror`, `seterror` and
   `setskip` → never `x-snapshot-source: warm`; `slow=400` → a single
   curl is `timeout` → not `warm` (under load about a third of lookups
   still hit through same-key coalescing, see the table — so judge
   `slow=400` by `result=timeout` in the logs, not by "zero hits");
   `locale=ja` → not `warm` for ja, but ko and en ARE `warm`; `slow=150`,
   `slowjob=…`, `slowset=…` and `slowbuild=…` → `warm` once the delayed
   job has published (they slow the path, they do not break it).
   A `warm` where the table says none = the fault is not active. In the Vercel logs
   the request shows `[liveWarm] fault armed mode=<encoded spec>` (for
   example `mode=slow:400+locale:ja`). It is logged once per instance
   on first use.
2. In the run's history capture, check the following. Every
   `[liveWarm] start` and `[setlist] warm-lookup` line ends in
   `fault=<encoded spec>`, and that must be exactly the intended spec
   (e.g. `fault=slow:400+locale:ja`). There are 0 `fault-invalid` and 0
   `fault-blocked` lines. The result distribution matches the table
   above. Any of these means the fault leaked: a `hit` under `absent`,
   `getnull`, `seterror` or `setskip`, or a `hit` on a ja lookup under
   `locale=ja`.
3. The summariser needs no change. It tolerates the extra `fault=` key
   and lists `fault-locale` under the skip reasons, which do not count as
   warm builds. Quote the `fault armed` line and the result split in the
   report next to the gates. The gates are the usual 500-viewer ones,
   including 0 × 5xx, with saves during the fault.

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

## n14 qualification step 6 — joins, attribution smoke, JSON log export

Step 6 switches the dev alias between deployments while tabs stay open
(design: ON → OFF → ON, ON → R1 → ON). The harness side
(`run.mjs --phase=transition`, section above) records what every client
saw; the three tools here establish **which deployment answered each
request** and what that means for the switch. Harness / tooling only — no
`src/` change.

| tool | what it does |
|---|---|
| `vercel-logs-json.sh <deployment> <since ISO> <until ISO> <out.jsonl> [limit=1000]` | complete JSON Lines export of one deployment's request logs for a window |
| `attribution-smoke.mjs --base=<alias> --deployment=<immutable url \| dpl_id>` | pre-run proof that responses join to log records (10 SDK reads + 1 page load) |
| `transition-join.mjs <browsers-transition.json> --logs=<dpl>=<a.jsonl>,…` | the step-6 join: attribution, propagation, exposure, OFF / R1 evidence, resources, continuity |

### Attribution: `X-Vercel-Id` ↔ `vercel logs --json`

Every response carries `X-Vercel-Id: sfo1::icn1::<reqid>`; the record that
`vercel logs <deployment> --json` emits for that request has `id = <reqid>`
plus `deploymentId`, `requestPath` (no query string), `requestMethod`,
`responseStatusCode`, `domain`, `source` (`serverless` for API routes,
`serverless-middleware` for pages), `timestamp` (epoch ms, request start at
the edge) and the nested function lines in `logs[]` (`[liveWriter]`,
`[liveWarm]`, `[setlist] warm-lookup` / `hint-fetch`, `[liveSnapshot]
build`, `[prisma] pool`, EMAXCONN). The top-level `message` is only the
first nested line. One record per request id (verified 1:1 on the alias,
2026-10-12, CLI 63.1.2).

The join reports two things separately:

- **request attribution** — the id matched a record AND the record's
  deployment / path / status / method agree with the response;
- **function instrumentation** — the record also carries the lines the
  serving deployment must log for that request: a 2xx save → a
  `[liveWriter]` line (every role); a hinted `/api/setlist` read on an R2
  deployment (ON / OFF) → a `[setlist] hint-fetch` line (R1 logs none).
  A request can be attributed while its nested lines are still missing:
  background (`after()`) lines land in the record later — hence the
  second export pass.

### `vercel-logs-json.sh` — export caveats

- **`--limit` defaults to 100** and, when a window holds more, the CLI
  returns the NEWEST records: the oldest part of the window disappears
  silently (50 req/s fills 100 records in 2 s). The script cuts the window
  into `SLICE_S` (60 s) slices fetched with a high limit and splits any
  slice that returns ≥ limit records in half, recursively (down to
  `MIN_SLICE_MS`, 1 s). A slice still saturated there, or one the CLI
  never answered after 3 attempts, is reported (`saturated=` /
  `failed=`) and the script exits 3: an export is never silently short.
- `--since` / `--until` are both inclusive at ms precision, so adjacent
  slices share a millisecond: records are deduplicated by `id`; of two
  copies the one with more `logs[]` lines wins.
- **Second pass**: the output is merged by id into an existing file, so
  re-running the same command a few minutes after the run adds the
  background-job lines that arrived late (`new=` / `enriched=` in the
  coverage line). Run it once right after the run and once ~5 min later.
- **Retention**: runtime logs are kept for a limited, plan-dependent time,
  and a deleted deployment's logs are gone — export every deployment
  (both passes) before the cleanup deletes it.
- The CLI's banner goes to STDERR (kept in a temp file, its tail printed
  when a call fails); JSON goes to STDOUT. In a git worktree (no
  `.vercel/`) the script passes `--project opensetlist` (`VERCEL_PROJECT`).
- Coverage line: `slices= splits= saturated= failed= maxPerSlice=
  hitLimit= limit= sliceS= records= raw= dupes= existing= new= enriched=
  deployments= span=`. Live check:
  `results/2026-10-12/2026-10-12T15-40Z-logs-export-check.md` (a 57-record
  window exported at `limit=20` recovers the same 57 ids as `limit=1000`).

### `attribution-smoke.mjs` — before every run day

```bash
node tests/load/attribution-smoke.mjs \
  --base=https://<dev alias> --deployment=https://opensetlist-<hash>-opensetlist-projects.vercel.app
```

10 SDK-style reads on the alias (5 generic, 5 `minRev=<head>&hint=1`, plain
`fetch` like subs-worker.mjs) + 1 Playwright load of the event page; the
page's document and **every** `/api/setlist` request it actually issues
are kept (the denominator is what the page sent). Per request: status,
`x-vercel-id`, source / verify, `x-vercel-cache` / `cache-control` / `age`,
request-side pin evidence (`x-deployment-id` header, `__vdpl` cookie, `dpl`
query) — framework assets' pins are counted apart (Skew Protection pins
assets; the custom setlist fetch is expected unpinned). After `--wait-s`
(15 s) it exports the deployment's logs for the window (a second pass 20 s
later if anything is unmatched) and joins. Writes
`results/<UTC date>/<stamp>-attribution-smoke.{json,md}` (+ the `.jsonl`
export, gitignored); exit 0 only when every request matched a record of
the expected deployment with path / status / method consistent. First
run: `results/2026-10-12/2026-10-12T15-34-00Z-attribution-smoke.md` —
13/13 (10 SDK + document + 2 page `/api/setlist`) on
`dpl_FAt2Sp33CvHnRohZyHkH5bUHZ4X5`; page API requests 0/2 pinned; 58 of
103 framework assets carried `?dpl=`, 44 an `x-deployment-id` header.

### `transition-join.mjs` — inputs

```bash
node tests/load/transition-join.mjs <stamp>-browsers-transition.json \
  --logs=dpl_A=a.jsonl,dpl_B=b.jsonl,dpl_C=c.jsonl \
  [--switch-files=s1.json,s2.json,s3.json] [--manifest=deployments.json] \
  [--sustain-s=60] [--bucket=5] [--carry=5] --out=<md> [--json[=<file>]]
```

- `--logs`: one export per deployment that served anything in the run
  (incumbent, every target, twins if they were hit). The record's own
  `deploymentId` is the attribution; the key only labels the file.
- `--switch-files`: the operator's switch records, in switch order; a file
  may be one JSON object or JSON Lines (`{"plannedAt"}` first, then the
  CLI record appended) — merged per switch, and they win over the
  harness's copy for `cliStart` / `cliEnd` / `target`.
- `--windows=<from>,<to>[;<from>,<to>…]` (ISO or epoch ms): the log
  export windows (e.g. the per-leg windows [plannedAt − 40 s, plannedAt
  + 75 s]). Without it they are inferred from the union of every
  deployment's records (blocks split at 30 s gaps — slightly narrower
  than the real windows). A response whose edge request time (the epoch
  ms inside its request id, `<pfx>-<ms>-<hex>`) lies outside them is
  **not exported**: counted apart, never as unmatched; attribution
  coverage is computed inside the windows. Log records with
  `responseStatusCode: 0` and empty response fields (Vercel logs a few
  incomplete records — 6 of 30 988 in T1, every one a 200 to the client)
  attribute by id / deployment / path and are listed as incomplete.
- Switch times may be ISO strings (operator files) or epoch ms (harness);
  every instant is normalised to epoch ms when the switch records merge.
- `--manifest`: the deployment manifest written by the deploy script —
  `{ "deployments": [{ "id": "dpl_…", "url": "https://…", "role":
  "ON-A|OFF-1|ON-B|ON-A′|R1-1|ON-C|OFF-1t|R1-1t", "commit": "5475bf2",
  "env": { "LIVE_WARM_ENTRIES": "0" }, "effectiveFlag": "0", "twin":
  "…", "identity": "…" }] }`. Role kind: `R1…` or commit `385e5f0` → R1;
  `OFF…` or flag `0` → OFF; `ON…` or flag `1` → ON. Roles are never
  inferred from logs — the OFF / R1 evidence is exactly the check that
  the logs match the declared role.

**Harness JSON contract** (`transition` section; read defensively — the
first present alias of each field wins, rows may be objects or arrays
with a section-level `cols` / `reqCols` list):

| what | where / fields |
|---|---|
| switches | `transition.switches[]`: `name?, kind?` (`pseudo`, `off`, `r1`, `existing-return`, `fresh`, …), `plannedAt, cliStart, cliEnd, cliCpuMs, target {url, id}, from? {url, id}`; `transition.initialDeploymentId` (or `incumbent.id`) names the first switch's old deployment when `from` is absent |
| saves | `transition.saves[]`: `k?, who?, rev, status, putStart, putEnd, firstAttemptAt?, method?, path?, leg?` (switch index), `label?, scheduledOffsetMs?, actualOffsetMs?, offsetFromCliEndMs?, arrival?, songId?,` **`vercelId`** |
| responses | `transition.responses[]` (flat, with `pop`) and/or `transition.{sdk,pages,probe,saves,smoke,guard,documents}.{responses\|reqs\|rows}[]` and `transition.{sdk,pages}.clients[].reqs[]` |
| request id | `vercelId` \| `xVercelId` \| `reqId` \| `x-vercel-id` — full header or bare `<reqid>` |
| timing | `tStart` \| `reqStart` \| `start` \| `sentAt`; `tEnd` \| `end` \| `respAt` \| `receivedAt` \| `t`; exposure stages `headersAt`, `bodyAt`, `evalAt`, `settledAt` |
| who | `pop` (`sdk`, `page`, `probe`, `save`, `smoke`, `guard`, `document`), `client` \| `clientId` \| `idx`, `subset` (`hold`, `aheadHint`, null), `cohort` (`incumbent`, `arrival`, `r1`), `switchIdx` |
| request | `method`, `path` \| `url`, `host`, `notify` (hint=1 sent; else read from the URL), `minRev`, `hint`, `reason` (`initial`, `notify`, `recheck`, `periodic`, …), `queuedAt` (recheck ticket queued) |
| response | `status` (0 = network / deadline), `bodyValid`, `rev`, `source`, `verify` (null = header absent), `resolution`, `cache {xVercelCache, cacheControl, age}`, `pin {header, cookie, query}`, `clientBuild` (document `data-dpl-id`) |
| clients | `transition.sdk.clients[]` in subs-worker.mjs's record shape (+ `cohort`, `subset`, `switchIdx`); `transition.pages.clients[]` in pages.mjs's shape (+ `cohort`, `notes` rows `[t, type, rowId, isDeleted]`) |
| optional | `transition.rechecks[] {client, queuedAt, dispatchedAt, settledAt, subset, switchIdx}`, `transition.smoke[]` (reactions / wishes: `switchIdx, locale, kind, submitStatus, persisted, refreshed, identityRetained, vercelId`), `transition.arrivals`, `transition.verdicts` (printed verbatim) |

**The real harness shape** (`run.mjs --phase=transition`, detected by
`transition.sdk` / `transition.probe` being arrays) is read as follows —
the table above stays as the fallback for other producers:

| source | population | notes |
|---|---|---|
| `transition.probe[]` | `probe` | main-thread record `{tStart, tHeaders, tBody, status, vercelId, verifyRaw, hint, minRev, pin, …}`; response = `tBody`; `hint` present → hinted (`hint=1`); path `/api/setlist` |
| `switches[].route[]` | `route` | route marker (HTML); its `dpl` (data-dpl-id) must equal the record's deploymentId, else inconsistent |
| `switches[].guard.attempts[].rec` | `guard` | immutable target URL — attributed, never used for routing |
| `switches[].smoke[]` | `smoke` | every sub-request object with a `vercelId` (`post`, `counts`, `wish`); method not compared |
| `transition.saves[]` | `save` | `startedAt` → `startedAt + ms`; `leg` = 1-based switch `k`; `offS` 11 / 15 = arrival saves; method not compared (op-dependent) |
| `transition.sdk[].reqs` | `sdk` | ARRAY rows by `SDK_REQ_COLS` (checked against `transition.rows.sdkReqs` label prefixes — a reordered harness throws); response = `bodyAt` (col 18), settled = col 10; `cohort` `incumbent` / `hold` / `ahead` / `arrival-<k>` / `r1-<k>` → cohort + subset + switch; a synthetic ahead-hint row = cohort `ahead` AND col 29 (never the rev alone) |
| `transition.pages[].fetches` / `.navs` | `page` / `document` | rows by `PAGE_FETCH_COLS`; navs `[t, url, status, x-vercel-id, data-dpl-id]` |

Per switch the join uses `baselineDpl` as the old deployment, the
harness's `window {from, to}` as the leg window, and prints the
harness's provisional `boundary` / `firstTargetLive` / `routing` (live
route marker, no logs) next to the log-attributed bounds that replace
them. A switch whose target is its baseline (or `kind: "pseudo"`) is a
**pseudo-switch**: no old side; the first target response is the first
response whose request started after `cliEnd`, and "old answer after
cutover" means a request sent before `cliStart` and evaluated after the
boundary (a held answer). Pending rechecks are derived from the ahead
subset's rows: `recheckQueued` (col 27) queues the ticket at that row's
`evalAt`; the recheck is the client's next notification fetch.
Regressions need `appliedAll`, which the real client records do not
carry — the column reads `—` and the harness's monotonicity check
covers it. First end-to-end run:
`results/2026-10-12/2026-10-12T15-58-05-326Z-transition-join.md`.

The identity guard (`pop: "guard"`, through the immutable target URL) and
the smoke are attributed but excluded from propagation: only alias
traffic (`sdk`, `page`, `probe`, `route`, `document`) says where the
alias routed.

### `transition-join.mjs` — how to read the report

- **Attribution** — per population (controlled subsets apart) and per
  deployment: responses, with request id, matched, consistent (= request
  attribution coverage), inconsistent, unmatched, instrumentation
  expected → present; pin evidence per population; every unattributed
  response with its offset to the nearest `cliStart`.
- **Propagation per switch** (harness clock only): CLI start / end; per
  population (probe, SDK, pages, all) the first target response (start →
  end), last old-deployment request START, last old response END (an old
  request finishing after a target response is not continued old
  routing), old starts after `cliStart`; **sustained target routing**
  over the predeclared window [cliEnd, cliEnd + 60 s]: 0 probe flip-backs
  to the old deployment after the first target probe, probe gaps ≤ 3 s,
  last probe on the target. Complete attribution of the probe requests
  started in [cliStart − 10 s, cliEnd + 60 s] is **required** — one
  unattributed and the profile is **NOT EXERCISED** (behavioural verdicts
  stand). The record − harness offset distribution in the header is
  latency plus clock offset: bounds closer than its spread are
  indeterminate.
- **Exposure** (measured against the first attributed target response
  over all alias populations, T): pending hinted fetch — natural SDK
  hinted fetches dispatched before `cliStart`, unresolved after T
  (`settledAt`, else `evalAt` / `bodyAt` / `tEnd`), ≥ 20 distinct
  clients, with stage counts and old-deployment attribution; pending
  recheck — ahead-hint subset tickets queued before `cliStart` and
  resolved after T, ≥ 5, split into *queued* (recheck dispatched after
  T) and *dispatched* (in flight across T); old answer after cutover —
  clients with an old-deployment 200 completing after T followed by a
  target answer at ≥ that rev without regression (client `appliedAll`),
  ≥ 5, natural vs controlled; arrival saves (+11 / +15 s or
  `arrival: true`) — SDK arrivals not joined at the PUT response ≥ 20 and
  arrival pages incomplete ≥ 3, independently. Each **EXERCISED** /
  **NOT EXERCISED**.
- **Target role evidence** — OFF absence is **PASS** only with positive
  evidence: manifest `LIVE_WARM_ENTRIES=0`, every 2xx save of the leg
  attributed and carrying its writer line, every hinted read of the leg
  attributed, then 0 `[liveWarm] start`, 0 warm-lookup lines, 0
  `source=warm` responses on that deployment; anything missing → **NOT
  EXERCISED**, a warm trace → **FAIL**. R1: 0 `[liveWarm]` lines of any
  kind and 0 responses with a verify header. ON targets show whether a
  warm job was seen.
- **Drain** — the old deployment after T in 10 s buckets: requests, pool
  lines, max pool total, instances logging. An instance that stops
  logging has not necessarily closed its pooler connections.
- **Continuity / performance** per save × SDK group (cohort × subset):
  eligible incumbents (subscribed by the first save attempt), p50 / p95 /
  max, missing at 30 s → continuity PASS / FAIL (proposed operational
  acceptance; supersession counts), p95 ≤ 3 s kept visible, joined-after
  clients timed from max(join, PUT response), broadcast receipts, the
  applying fetch's reasons (satisfied first fetch / recheck / periodic
  repair …), regressions. A group with no eligible client reads `n/a`.
- **Existing-deployment return** (switch `kind: existing-return`, or a
  target already seen in the run): each alias client's first target
  answer against the committed head at its request start, by source.
- **R1 cohort**: per change type (INSERT / UPDATE / soft-delete = UPDATE
  with `isDeleted` / DELETE) the receipts after the switch, the page's
  next `/api/setlist` fetch and next DOM change, and how many DOM
  updates came before the earliest periodic repair (16 s).
- **Resources across deployments** — Σ per deployment and combined
  (vercel-logs-summary's estimator run on the JSON export: per-instance
  maxima per bucket, carried ≤ `--carry` s, silent instances invisible,
  record times are request starts; an app-side estimate, not the
  pooler's count), writer lines / acquire max, EMAXCONN, requests and
  builds per deployment per minute.
- **Reactions / wishes smoke** and the harness's provisional verdicts
  (verbatim) close the report.

## n14 qualification step 7 — spam7-join, log completeness

The server side of the 5-minute spam run (`run.mjs --phase=spam7`):
fetch the deployment's text history logs completely and checkably, then
join them with the harness JSON, the k6 background run and the side-cars.
Both tools are read-only (they only call `vercel logs` / read files).

### `history-fetch.sh` — complete text export

```bash
# right after the measurement (dev alias or the deployment URL):
tests/load/history-fetch.sh <alias-or-deployment> <since ISO> <until ISO> results/<date>/<stamp>-history.txt [slices=20] [limit=5000]
# ~5 min later, same arguments — merges the late after() lines in:
tests/load/history-fetch.sh <alias-or-deployment> <since ISO> <until ISO> results/<date>/<stamp>-history.txt 20 5000 --second-pass
```

Env: `VERCEL_SCOPE` (opensetlist-projects), `VERCEL_PROJECT` (opensetlist —
needed in a worktree), `MIN_SLICE_MS` (5000), `PAR` (= slices). Fetch the
window with a few seconds of margin on both sides (the reconciliation
below pads by 5 s).

- **Disjoint slices.** The window is cut into `slices` equal slices
  `[a, b)`, fetched in parallel as `--since a --until b − 1 ms` (both
  bounds are inclusive at ms precision). Text records carry no request id
  and identical headers within 10 ms are routine, so overlapping slices
  could not be deduplicated afterwards; disjoint bounds make it
  unnecessary.
- **Saturation by REQUEST RECORDS, not lines.** `--limit` counts records
  and keeps the NEWEST when a window holds more. A record = one header
  line + any number of nested lines (or none), so the line count says
  nothing. Each slice's records are counted with the summariser's own
  header parser AND read from the CLI's closing `Fetched N logs` line; a
  slice at ≥ limit (either count) is split in half and both halves are
  re-fetched, recursively down to `MIN_SLICE_MS`; still at the limit there
  → `status=saturated`. A failed CLI call is retried once, then
  `status=failed`. Saturated / failed slices or a CLI count that disagrees
  with the parsed records → exit 3.
- **Text mode writes to STDERR.** In text mode the CLI prints the banner,
  the records and `Fetched N logs` on stderr and nothing on stdout
  (verified 2026-10-12, CLI 63.1.2 — the opposite of `--json`), so the
  script captures both streams; the banner is skipped by the parsers.
- **Second pass.** `--second-pass` re-fetches the file's own slices
  (splits included) and merges each slice by content, never across
  slices: records grouped by their exact header; a pass-1 record pairs
  with an identical pass-2 record first, else with one whose nested lines
  are a strict superset (`enriched` — the later copy wins); unmatched
  pass-2 records are `new`; unmatched pass-1 records are kept and counted
  as `pass1Only` (non-zero = pass 2 came back short).
- **Self-describing output.** `### capture history-fetch … tz=<±hhmm>
  passes=…` header (the CLI machine's UTC offset — history times are
  local clock without a date; spam7-join derives `--add-hours` from it),
  one `### capture slice from= to= records= status= pass1= cli= [pass2=
  identical= enriched= new= pass1Only=]` marker per slice, and a footer
  printed on stdout too:
  `slices= records= saturated= resplit= failed= passes= pass2Failed=
  identical= enriched= new= pass1Only= cliUnknown= cliMismatch=
  maxPerSlice= limit= span=`. Every marker starts with `### capture`, which
  vercel-logs-summary.mjs skips, so the file also feeds the summariser.
- Merge / count logic: `history-merge.mjs` (`count`, `slices`, `assemble`).
- **Live check (dev alias, 2026-10-12, read-only):** 60 GETs on
  `/api/setlist` (20 with `minRev&hint=1`) at 2 req/s, then a 2-minute
  window in 20 slices: 60 records, 20 hint-fetch lines, 0 saturated, 0
  failed, CLI count = parsed count in every slice, ~20 s per pass; second
  pass 60 identical / 0 new / 0 pass1Only. The same window at `limit=5`
  (`MIN_SLICE_MS=1000`): 15 re-splits into 35 slices, the same 60
  records. The join on that file reconciled 20 hint-fetch lines against 20
  hinted request starts from this host (±5 s padding) → ok.

### `spam7-join.mjs` — server / k6 / side-car join

```bash
node tests/load/spam7-join.mjs results/<date>/<stamp>-browsers-spam7.json results/<date>/<stamp>-history.txt \
  --k6=results/<date>/<k6 stamp>-viewers.json \
  --pooler=results/<date>/<stamp>-pooler-clients.csv --backends=results/<date>/<stamp>-supavisor-backends.csv \
  --out=results/<date>/spam7-join-<run>.md --json
```

Options: `--k6-md=` (default: the `.md` next to the k6 JSON — the
configured rates are read from it), `--poll-rps= --ssr-rps= --steady-s=
--reactions=` (override), `--add-hours=` (default: from the fetch header's
`tz=`), `--bucket=5 --carry=5` (Σ estimator), `--pad-s=5`.

Reports: resource gates; log completeness and reconciliation; server
outcomes per minute (window) and per 10 s (spam start → recovery end) —
hint-fetch kinds (satisfied / memo / deferred / fresh / none / error =
hinted 503), builds split warm-job / reader, uncached revision reads
(`rev-read`, hint=1, timeouts — a memo answer has no line of its own and
shows only as `verify=memo` on hinted requests), warm-lookup results (hit
/ miss / timeout / memo-miss / capped), pool waiting, build-failed,
EMAXCONN, instances, requests; first vs last attack minute; every write
joined to its `[liveWriter]` line by rev (commit `at` vs the PUT
interval); Σ peak / baseline / after the last send; side-car maxima per
phase and per 10 s after the last send; the k6 summary.

**Completeness rules** (Codex step-7 round 2 §4):

- The fetch must be known (history-fetch.sh header), cover the
  measurement window, have no gaps between slices, no failed and no
  saturated slice (a slice at ≥ limit counts as saturated whatever its
  marker says), two passes with every slice re-fetched, and agree with
  the CLI's own counts.
- **Reconciliation** against the harness: one `[liveWriter]` `ok=true`
  line per 2xx harness write, matched by rev (18 measured writes + the
  anchor); `[setlist] hint-fetch` lines in the window within
  `[lo, hi]`, where lo = harness hinted requests that started inside the
  window shrunk by 5 s, hi = those inside the window grown by 5 s (plus
  k6's own `hint_fetches`). Below lo = shortfall (incomplete); above hi =
  excess (an unexplained client — reported, not an incompleteness).
- **A resource gate without complete evidence is UNESTABLISHED, never
  PASS**; positive evidence (an EMAXCONN line, Σ ≥ 300, an acquire > 500
  ms) is a FAIL either way. Writer acquire is judged per write (its line
  exists or the write is UNESTABLISHED). Σ additionally needs every
  instance that did database work (rev-read / writer / build-failed) to
  have logged a pool line — otherwise the pooler side-car must cover the
  window below the gate. Honest latency keeps its own (harness) verdict.
- Σ after the last send is an estimate: an instance is carried `--carry`
  s after its last pool line, so **silent instances expire by
  construction** — a falling Σ means instances stopped logging; when no
  pool line follows the last send the join says so instead of calling it
  a drain. The pooler-clients (used / active / waiting clients, probe,
  backends, idle in tx) and supavisor-backends (backends, active, idle in
  tx, max tx age, lock waits) side-cars are the corroboration.
- Text mode has no status codes: server-side 503 evidence is `verify=error`
  hint fetches, `build-failed` lines and error-level records; the
  authoritative 503 counts are the harness's buckets and k6.
- **k6**: counts only, never the thresholds' tolerated error rates. 5xx =
  the sum of status-tagged `http_reqs{…status:5xx…}` submetrics when
  present; otherwise 0 is established only when `http_req_failed` has 0
  failed requests of any kind; a non-zero failed count leaves 5xx
  unestablished (per-stream bad counts listed). Generator OK = poll and
  SSR achieved ≥ 95 % of the configured rate over the steady window,
  reaction pairs ≥ 95 % of `REACTIONS`, 0 dropped iterations; SHORT is an
  INVALID candidate for the orchestrator, not a service result.

**Harness JSON fields read** (`json.spam7`, alias `json.spam`; accessor
aliases in the file header):

| field | used for |
|---|---|
| `phases.baselineStart`, `phases.recoveryEnd` (required; epoch ms or ISO) | the measurement window |
| `phases.spamStart`, `phases.lastSend` (else max `sends[].sentAt`), `phases.spamEnd` / `attackEnd` (P0) | per-10 s range, first / last attack minute, drain start, side-car phases |
| `sends[]` | count; lastSend fallback |
| `writes[]` `{k, label, rev, putStart, putEnd, status, anchor \| kind:"anchor"}` (+ `anchor` object) | writer reconciliation and acquire gate |
| `hintedStarts[]` (exact) or `buckets[]` `{t \| s, hinted \| sdkNotification + pagesHinted / pages, s503}` with `bucketMs` | expected hint-fetch lines; harness 503 total |
| `declaredProcess`, `config.label`, `config.base` | echoed |

## n14 qualification step 8 — production verification (read-only tools)

Step 8 proves on **opensetlist.com** what steps 1–7 proved on dev: the
wake procedure, promotion / rollback propagation on the production domain,
and a clean release. It adds no load. Four tools may point at production,
and only to look:

| tool | what | production needs |
|---|---|---|
| `observer.mjs --prod-readonly` | N supabase-js listeners on `event:<id>` + one hinted GET per receipt | `--prod-readonly`, the anon key via `--anon-key-env` |
| `wake-check.mjs` | Chromium pages per locale waiting for the operator's save | `--prod-readonly` |
| `transition-sampler.mjs` | doc + `/api/setlist` sampling across a promotion / rollback | `--prod-readonly`, `--event-id` **and** `--path` |
| `attribution-smoke.mjs` | unchanged, except: off the dev alias `--event-id` is required | `--event-id` |

### Guards (`prod-readonly.mjs`, tests in `prod-readonly.test.mjs`)

- **Never by accident.** A production / deployment URL is refused unless
  `--prod-readonly` is on the command line. Without it, `observer.mjs`
  keeps its dev-only guard unchanged (dev project + dev alias / localhost),
  and refuses the prod-only flags (`--supabase-url`, `--anon-key-env`, …)
  instead of silently observing dev.
- **Read-only by construction.** In these tools only an allow-list of
  flags is accepted; anything else is refused before a socket opens. Flags
  other harness commands use to save, log in or inject (`--admin`,
  `--save-offsets`, `--cleanup`, `--spam-*`, `--publish`, `--send`,
  `--fixture`, `--drop*`, …) are named as write-capable in the refusal.
  None of the tools reads `ADMIN_PASSWORD`, a DB URL or a service key.
  `wake-check`'s pages abort every non-GET request (`readOnly` in
  `pages.mjs`) — no impression, reaction, wish or Sentry event is filed on
  the operator's behalf; the count is reported.
- **Anon key only.** `--anon-key-env=<NAME>` names the variable holding the
  key; names containing SERVICE / SECRET / PASSWORD / DATABASE / ADMIN are
  refused, and the value must be a JWT with `role: anon` (or an
  `sb_publishable_…` key) whose `ref` matches `--supabase-url`. A
  service-role key under an innocent name is refused too. The key is never
  printed or written; the project ref appears masked (`abcd…`).
- Allowed bases: `https://opensetlist.com` (or `www.`), an immutable
  `opensetlist-<hash>-opensetlist-projects.vercel.app` deployment URL, the
  dev alias, localhost.

Refusals verified from the CLI (exit 2, nothing on the network):
`observer.mjs --base=https://opensetlist.com` (dev guard),
`observer.mjs --supabase-url=…` without the flag,
`observer.mjs --prod-readonly … --admin` / `--save-offsets=0,30 --cleanup`,
`--anon-key-env=SUPABASE_SERVICE_ROLE_KEY`, the service-role value under
`MY_KEY`, `wake-check.mjs --base=https://opensetlist.com` without the
flag, `wake-check.mjs --prod-readonly … --admin`, `transition-sampler.mjs`
without `--path`, `attribution-smoke.mjs --base=https://opensetlist.com`
without `--event-id`.

### Production read-only observer (`observer.mjs --prod-readonly`)

```bash
PROD_SUPABASE_ANON_KEY=… node tests/load/observer.mjs --prod-readonly \
  --base=https://opensetlist.com --event-id=<n> \
  --supabase-url=https://<prod ref>.supabase.co --anon-key-env=PROD_SUPABASE_ANON_KEY \
  [--listeners=3] [--duration-s=900] [--add-listener-after-s=<s>] [--locales=ja,ko,en] \
  [--stop-file=<path>] [--out=<dir>] [--label=<name>]
```

A separate, small client (`observer-prod.mjs`), not the subs-worker page
model: no periodic polls, no drills, never a channel send. It first GETs
`/api/setlist?eventId=<n>` (the event exists, starting rev; anything but
200 → exit 2), then subscribes the listeners (and one fresh listener at
`--add-listener-after-s`), and per receipt records the RAW broadcast time
and the exact rev from the payload (a receipt is the frame itself, never
inferred from a fetch), then separately one hinted GET
`?minRev=<rev>&hint=1` with its own start / end, status,
`x-snapshot-source`, `x-snapshot-verify`, body rev, `x-vercel-id`.
Payloads that are not `{kind:"setlist", rev:<int>}` are listed (the
channel is public) and trigger nothing. Ends at `--duration-s` or when the
STOP file (default `<out>/observer-prod.STOP`) is newer than the start;
writes `<stamp>-observer-prod[-label].{json,md}`:

- verdict: every listener SUBSCRIBED; every initial listener SUBSCRIBED
  **before the first save's broadcast**; stayed connected (no
  CHANNEL_ERROR / TIMED_OUT / CLOSED / socket drop before our stop); every
  rev reached every listener that was subscribed before it; every hinted
  GET 200 with body rev ≥ rev; the fresh listener received every save
  after its SUBSCRIBED; 5xx count;
- per rev: received / total, received / eligible (subscribed before the
  rev's first receipt), missing listeners, spread, GET sources / elapsed;
- per receipt: broadcast received (UTC), Δ first, GET start / end, headers;
- per listener: connect attempt, first SUBSCRIBED, join ms, subscribed
  before the first save, rejoins, closes with times, socket drops,
  recreates, revs received.

Clock: all times are the **receiver** host's clock, UTC; compare with the
save time from the admin UI / `vercel logs` (`[liveWriter]`) allowing for
NTP skew. The first receipt time of a rev is the client-side proof that
committed broadcast delivery works; whether today's `realtime.messages`
partition exists is invisible to a client (the operator's prod SQL check).

### Wake check (`wake-check.mjs`)

```bash
node tests/load/wake-check.mjs --prod-readonly --base=https://opensetlist.com --event-id=<n> \
  [--locales=ja,ko,en] [--pages=2] [--poll-only=1] [--expect-saves=2] [--wait-s=600] \
  [--deployment=dpl_…] [--event-path=/events/<n>/<slug>] [--stop-file=<path>] [--out=<dir>] [--label=<name>] [--headed]
```

Opens `pages` **live** pages per locale + `--poll-only` pages (default
**1**) whose Realtime websocket is blocked (pages.mjs routeMode `blocked`), settles
10 s, takes the baseline rev and prints
`[wake-check] READY pages=… baseline_rev=… at=…` — **the operator saves
now**. The first rev above the baseline is the check save (R1), the next
the second save (R2). About 5 s after R1 it opens one **post-save** page
per locale (a viewer who reloads after the save; a new page, so the live
pages' continuity stays measurable). Ends at `--wait-s` (from READY) or
the STOP file (default `<out>/wake-check.STOP`).

Overall verdict: any check FAIL → **FAIL** (exit 1). Otherwise **PASS**
(exit 0) only if `--expect-saves` distinct revs were observed (default 2:
the check save AND the second, "stays connected" save) and at least one
websocket-blocked page ran; with fewer saves (e.g. the operator never made
save 2, or no save at all) or `--poll-only=0` the overall is **NOT
EXERCISED** (exit 4), never PASS. The report prints which saves were
observed (`check save R1: rev …` · `second save R2: not observed`) and why
the run is NOT EXERCISED. `--expect-saves=1` is for a check-save-only run
(e.g. a T−10 check without a second save); the second-save checks then
read NOT EXERCISED without blocking the overall.

Checks (each PASS / FAIL / NOT EXERCISED): pages 200 with rows painted;
R1 seen in the DOM of every live page; R1's broadcast **frame** at every
live page; DOM ≤ 3 s after the frame (frame time and DOM time are separate
columns); the same three for R2 (the "listener stays connected" save);
websocket-blocked page shows R1 by polling within 9 s of the first live
frame (5 s ± 1 s fallback cadence + the 3 s DOM budget) and received no
frame; post-save loads SSR-seeded at rev ≥ R1 (`initialRev` in the RSC
payload) with the server-rendered paint (last row-text report by
DOMContentLoaded) equal to the live pages' content of that locale; 0
reloads (a 308 hop is not a reload); 0 page errors; 0 × 5xx; one
websocket per live page, never closed; every page `visibilityState =
visible`; with `--deployment=dpl_…`, every page's `data-dpl-id` matches.
Informational: per locale, whether a hinted fetch for R1 was answered
`x-snapshot-source: warm` — **which instance** served it is not in any
header (`x-vercel-id` = edge PoP :: function region :: request id), so the
warm reads' request ids are listed for a `vercel logs` join
(`[liveWriter] instance=` vs the read) to say "warm on a different
instance".

DOM = the rows' visible text (pages.mjs `rowText`: every `<SetlistRow>`
`<li>`, text inside `<button>` excluded so other viewers' reaction counts
never look like an update). The save must change something visible — add
a row (R1), delete it (R2).

Foreground: the live hook tears its channel down on `document.hidden`.
Every page is its own context launched with background / occlusion
throttling disabled and headless pages report `visible`; the table
records it per page. With `--headed`, do not minimise the windows.

Dev smoke (2026-10-12, dev alias, event 111, no save made): 6 live + 1
poll-only page opened (load 0.9–3.8 s, rows at 0.6–3.3 s, websocket at
1.1–3.9 s), READY at baseline rev 1912, timed out after 45 s →
`NOT EXERCISED`; reloads / errors / 5xx 0, live sockets 6/6 never closed,
7/7 visible, 0 non-GET requests attempted.

End-to-end on dev (2026-10-12 23:09–23:13 UTC, event 111): observer
`--prod-readonly` (dev alias + dev project, 3 listeners +
`--add-listener-after-s=60`) and wake-check (2 × ja/ko/en + 1 poll-only)
side by side; ONE admin login, save 1 = append a blank row at the tail
(rev 1913, 23:10:00.714), save 2 ≈ 90 s later = soft-delete it (rev 1914,
23:11:31.313); `restore.mjs --compact --yes` → 0 rows moved,
`viewers-check.mjs` → 23 live rows, setlistRevision 1914.
- observer: both revs reached every listener subscribed before them
  (1913: 3/3 initial, spread 6 ms; 1914: 4/4 incl. the fresh listener,
  spread 7 ms); first receipt 0.51 s / 0.48 s after the save request
  started; 7/7 hinted GETs 200 `warm` / `satisfied`, 207–1621 ms; no
  close, rejoin or socket drop.
- wake-check: **PASS**. Frames at 6/6 live pages for both revs; frame→DOM
  324–634 ms (1913) and 226–659 ms (1914); the websocket-blocked page
  showed 1913 by polling 1573 ms after the first live frame with 0
  frames (24 refused socket attempts); the three post-save loads (opened
  5 s after R1) were SSR-seeded `live 1913` with the server paint equal
  to the live pages' content (24 rows); warm reads for 1913 in ja 1/1,
  ko 2/2, en 2/2 hinted fetches; one live ja page's fetch for 1913 left
  0.42 s after the frame with `minRev=1913` but without `hint=1` (the
  scheduler issued it as a non-notify request) and was answered `build`
  — so it is not counted as a hinted read; 0 reloads / page errors / 5xx / non-GET
  attempts; 10/10 pages visible.

### Transition sampler (`transition-sampler.mjs`)

```bash
node tests/load/transition-sampler.mjs --prod-readonly --base=https://opensetlist.com \
  --event-id=<n> --path=/ja/events/<n>/<slug> --expect=dpl_<target> \
  [--duration-s=300] [--interval-ms=250] [--stop-file=<path>] [--out=<dir>] [--label=<name>]
```

Start it ~30 s before the click. Two loops every 250 ms (≤ 4 in flight
each): the canonical event page (no redirect hop) — its `data-dpl-id` is
the serving deployment — and `/api/setlist` (x-vercel-id kept for a
`vercel logs` join; mapping ids to deployments with `vercel inspect` is
the operator's side). Output `<stamp>-transition-sampler[-label].{json,md}`:
first answer from `--expect`, last answer from any other deployment (the
old tail, and its overlap with the first expected answer), "sustained
from", flips, the per-deployment timeline, statuses and 5xx / transport
errors per loop, and the **unattributed** document answers (no
`data-dpl-id`: errors, 5xx, error pages). Verdict SWITCHED / NOT SUSTAINED
/ NOT SWITCHED / ALREADY SWITCHED / NO DATA (no attributed answer) /
INSUFFICIENT ATTRIBUTION (more than 20 % of document answers Exit code: 0 only for SWITCHED, 1 for NOT SWITCHED / NOT SUSTAINED, 4 (NOT EXERCISED) for ALREADY SWITCHED / INSUFFICIENT ATTRIBUTION / NO DATA — a caller must not read "the sampler ran" as "the switch happened".
unattributed — the gaps could hide the old deployment's tail, so no
switch is claimed). Switch latency = first expected answer − the
click time the operator writes down. Dev smoke: 20 s on the dev alias,
`--expect` = the serving deployment → ALREADY SWITCHED, 79 / 80 samples all
200.

### Operator sequence (step 8)

Operator = Vercel / admin / GitHub actions on production. Harness = the
command run beside it (read-only, from the laptop). Record every
deployment id and click time (UTC).

**A. Release (v0.19.0)**

| # | operator | harness beside it |
|---|---|---|
| 1 | merge the dev → main release PR (prod still serves the previous tag) | – |
| 2 | dispatch `backup.yml` (pre-release backup); wait green | – |
| 3 | dispatch `migrate-prod.yml` **on main** — the schema (`Event.setlistRevision`, post-deploy.sql) lands before the app that reads it; wait green | – |
| 4 | verify the column (prod SQL check: `Event.setlistRevision` present, publication / `realtime.send` / partitions as in `wiki/output/n14-prod-realtime-send-check.sql`) | – |
| 5 | freeze `LIVE_WARM_ENTRIES` in the Vercel **production** env to the decided value (it only takes effect on the next build) | – |
| 6 | annotated tag `v0.19.0` → production deploy; note the deployment id (ON) | `transition-sampler.mjs --expect=<ON dpl>` across the deploy's promotion (optional) |

**B. Smoke on a fixture event** (short-lived, clearly labelled public
event, e.g. "[TEST] OpenSetlist smoke — delete me"; the operator creates
and later deletes it — nothing here writes)

| # | operator | harness beside it |
|---|---|---|
| 1 | create the fixture event (ongoing, a few rows); tell the id | `attribution-smoke.mjs --base=https://opensetlist.com --deployment=<ON dpl> --event-id=<fixture>` |
| 2 | – | start `observer.mjs --prod-readonly … --event-id=<fixture> --duration-s=1500 --add-listener-after-s=420` and `wake-check.mjs --prod-readonly … --event-id=<fixture> --poll-only=1 --wait-s=1200 --deployment=<ON dpl>`; phone on the event page |
| 3 | after both READY / SUBSCRIBED lines: **save #1 = add a row** | both record R1 |
| 4 | wait ≥ 10 min (after the fresh listener's SUBSCRIBED at +7 min): **save #2 = delete that row** | both record R2; then touch the STOP files |
| 5 | (≥ 30 min idle, then repeat 2–4: idle-tenant check) | same |
| 6 | delete the fixture event; check it left the listings and the sitemap | `curl -s https://opensetlist.com/sitemap.xml \| grep -c "/events/<fixture>/"` → 0 (after the sitemap's revalidation); `/ja/events/<fixture>` → 404 |

**C. T−10 rehearsal on the real Fes event (read-only)** — no save on the
real event in step 8:
`wake-check.mjs --prod-readonly --event-id=107 --wait-s=300` (loads, rows,
sockets, foreground; save checks NOT EXERCISED by design) and
`observer.mjs --prod-readonly --event-id=107 --duration-s=300`
(subscribe / stay connected). The real T−10 check save is the show day's
runbook step.

**D. Rollback drill** (on the fixture event; recreate it if B deleted it)

| # | operator | harness beside it |
|---|---|---|
| 1 | build the OFF deployment of the **same commit** (`LIVE_WARM_ENTRIES` unset) as a production deployment without assigning the domain; note its id (OFF) | start `wake-check.mjs --prod-readonly … --wait-s=1800` and `observer.mjs --prod-readonly … --duration-s=1800` (continuity across both switches) |
| 2 | – | `transition-sampler.mjs --prod-readonly … --expect=<OFF dpl>` (start ~30 s before the click) |
| 3 | **Instant Rollback** to OFF; write down the click time | sampler: first / last / sustained |
| 4 | +30 s: a save on the fixture event; verify it at a listener | observer + wake-check record it |
| 5 | – | `transition-sampler.mjs … --expect=<ON dpl>` |
| 6 | **promote ON** back; click time; check the production domain auto-assignment state in Vercel afterwards (a rollback can leave it off) | sampler |
| 7 | +30 s: a save; verify | observer + wake-check; then STOP files |
| 8 | – | `vercel logs` export per deployment for the window ([liveWriter] acquire, 5xx, instances) |

Three deployment ids go in the report (ON, OFF, and "last R1" — R1 never
reached production, so that leg is NOT EXERCISED by construction).
