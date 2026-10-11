# Real browsers + SDK subscribers (task n14)

Measures what a viewer of the live event page actually experiences when
the operator edits the setlist: **save → the new row on screen**, for
real Chromium pages and for a large population of supabase-js clients
that behave like the **R2** page. Dev only (same guard as `../realtime/`).

| File | Role |
|---|---|
| `run.mjs` | Orchestrator: populations, edits, drills, measurement, report. |
| `pages.mjs` | Headless Chromium pages (one browser context each) on `/<locale>/events/111/...`, ja/ko/en 70/20/10, running whatever build the preview serves (R1 or R2). A MutationObserver (init script) reports, with the page's own clock, when each song link `a[href*="/songs/<id>/"]` appears. Websocket frames (the `rev` broadcast — JSON or the 2.0.0 binary user-broadcast frame — and, on an R1 build, postgres_changes) and `/api/setlist` responses (`minRev`, `hint=1`, `x-snapshot-verify`, body rev) are recorded from CDP; drills use `page.routeWebSocket` on the Realtime endpoint, or the page's own `__osl.dropNextNotification` hook. |
| `subs-worker.mjs` | Worker thread holding a slice of the SDK population. Each client imports the page's **real** `snapshotAcceptance.ts`, `liveScheduler.ts`, `snapshotVerify.ts`, `snapshotFreshness.ts`, `realtimeRecovery.ts` and `liveBroadcast.ts` from `src/lib` (Node type stripping) and mirrors `useRealtimeEventChannel` + `useLiveSnapshot`: ONE subscription, the `rev` broadcast; the handler validates `{ kind: "setlist", rev }`, `noteHint(rev)` → `requestFetch("notification")`; the scheduler drains the batch at dispatch (`captureHint`) and describes each request (`{reason, generic, hint, notify}`); the URL is `minRev = max(serverRev, H)` (or `serverRev`) with `&hint=1` iff `notify`; `x-snapshot-verify` parsed by the page's parser; `evaluate(gen, body, verify, hint)` → resolved / inconclusive (one recheck, then exhausted); 8 s deadline, n13 retry schedule, `Retry-After` floor; the hook's channel recovery (keep the channel on CHANNEL_ERROR / TIMED_OUT / CLOSED, 5 s ± 1 s polling, re-create only after 60 s + randomized backoff, max 3 per budget). Per client it records every broadcast and what the handler did with it, every request (descriptor, minRev, status, verify kind, body rev, hint resolution), exhausted tickets and the highest `serverRev` ever held. |
| `hostmon.mjs` | Load-host self-monitoring, shared by `run.mjs` and the workers: event-loop lag monitor (100 ms tick, 10 s buckets), the INVALID rule, the 1 s host sampler, the host isolation guard. `node --test tests/load/browsers/hostmon.test.mjs` pins the pure parts. |
| `admin.mjs` | Admin driver: login, insert-after, PUT, soft-delete, marker-song picking, optional position restore. |
| `restore.mjs` | Recovery for a hard-killed run: list active rows, soft-delete given ids, optionally compact positions (`--compact --yes`, see below). |

## One edit (`--edit-mode`)

`pair` (default):

1. `POST /api/admin/setlist-items/insert-after { afterPosition: <row 2> }` → a blank row ("曲名確認中") at position 3.
2. `PUT /api/admin/setlist-items/<id> { songIds: [<marker>] }` → the row shows the marker song.

`standalone`: ONE save per edit. insert-after cannot carry a song (the
route takes only `{ eventId, afterPosition }`), so the run creates one
blank **anchor row** after row 2 before any viewer joins, and each edit
is a single PUT that swaps the anchor's marker song: one save, one
broadcast. In a pair the PUT's notification fetch always meets the 1 s
cooldown the insert's fetch opened, so the pair measures "save after a
save"; standalone measures the clean single save. The anchor's position
is re-read from the DB before each standalone save (the PUT writes
`position`; pair inserts above it shift it).

`mixed`: pair on odd edits, standalone on even ones (both shapes in one
run, same population).

Marker songs are real songs that no `SetlistItemSong` has ever referenced,
so their link can't already be on the page and each run gets fresh ones.
Every save returns the new `rev`. The report names the mode in its header
and per edit; the per-save tables' "save rev" is the PUT's rev in every
mode. Monotonicity treats every higher-rev marker on the same row as a
replacement (the anchor chain, a double save).

**Primary latency** = save (PUT) request start → (page) marker link in the DOM /
(SDK) first applied snapshot with `rev ≥` the PUT's rev. Not seen within
`--timeout` (30 s) = **missing**. Gate: **p95 ≤ 3 s and 0 missing** over all
(edit × page) and (edit × client) pairs that no drill degrades on purpose.
The report gives the gate per population, then **one per-save table for
pages and one for SDK clients** (p50/p95/max, missing, broadcast arrival,
the save's notification fetches with their `x-snapshot-verify` kinds, and
for SDK clients the ticket resolutions, rechecks and exhausted hints), a
whole-run "Hint outcomes" section, insert-start based numbers, and the
notification arrival per path (postgres_changes → R1 pages, broadcast →
pages, broadcast → SDK). With writer warming on the server, both per-save
tables also give `warm / hinted` (notification fetches answered with
`x-snapshot-source: warm`) and the first hinted request's start − commit,
the gate table an informational "warming" row, and the JSON a `warm`
section for `../warm-join.mjs` (see `../README.md`, "n14 warming run").

**The clock starts at the first attempt.** A failed save is retried once
(insert-after only after checking that the failed attempt did not commit;
the PUT is idempotent), but the latency of both saves is measured from
the start of their FIRST attempt — the viewer's wait began at the first
click. Edits that needed a retry (or adopted a committed-but-failed
insert) get their own row in the gate table, with the latency from the
successful attempt next to it (informational), and the per-edit table
shows the attempt count.

**Monotonic DOM (every run, gated).** No viewer may ever go back to an
older version. SDK clients log every snapshot the real acceptance rule
applied (`[t, rev, fetch reason]`); any decrease is a regression. Pages
expose no applied rev, so the run keeps each page's full DOM log and
derives the version shown = the highest rev among the marker songs on the
page; a regression is that version going down, or a marker disappearing
without a newer save replacing it (before the clean-up). Two rows in the
gate table (pages / SDK), 0 regressions required; the JSON has every
page's version history.

All created rows are soft-deleted at the end, on error, and on Ctrl-C.

## Measurement validity — verdict INVALID

The run's timestamps come from the load host. If a thread there stalls,
requests leave late (or never), 8 s deadline timers fire late, and the
report would blame the server: in a flag-on spam / lost-final drill two
of four SDK worker threads stalled while other work ran on the laptop,
and the harness reported 224 "missing" + 594 deadline failures that
never reached Vercel. So every run checks itself:

- **Event-loop lag** on the main thread (pages, admin driver) and in
  every SDK worker: a 100 ms interval; lag = how late each tick ran,
  kept as 10 s buckets (n, p50, p95, p99, max) plus every sample
  > 200 ms with its time, and the run-wide max.
- **Heartbeats**: each worker posts one per second from its own loop.
- **Deadline timers**: every SDK request that hit the 8 s deadline
  records fired − armed − 8,000 ms (a healthy loop: a few ms).

A lag sample > 1,000 ms on any thread, or a worker without a heartbeat
for > 3,000 ms, between the population start and the end of the edit
window makes the verdict **INVALID**: exit code **3**, a banner at the
top of the report naming the thread and the time, every gate still
printed but labelled "measurement invalid". INVALID outranks pass and
fail — re-run on a quiet host; it says nothing about the system. The
report's "Measurement validity" section has the per-thread table, the
JSON `validity` the series. `--debug-stall=<ms>` blocks worker 0 that
long before the first edit to test this path (expect exit 3). Idle
reference on the Windows load laptop (12 logical cores): lag p95 ≈ 15
ms (timer granularity), max < 150 ms during Chromium start-up.

**Host telemetry**: a 1 s sampler of `os.loadavg()` (always 0 on
Windows), host CPU busy (all cores, from `os.cpus()`), this process's
CPU (main + workers; Chromium shows in the host figure only), RSS, free
memory and the thread count, summarised per phase (join / settle /
edits / drill) in the report and raw in the JSON (`host`).

## Host isolation

**Nothing else runs on the load host during a run; fetch and summarise
logs afterwards.** At start the run checks the host: CPU busy > 60 %
(POSIX: 1-min load ÷ cores; Windows: a 2 s CPU sample), or a competing
process — another `tests/load` node process, a `vercel logs` history
fetch, `vercel-logs-summary`, `warm-join`, k6 — prints a warning (the
live `vercel-logs-capture.mjs` with its `vercel logs --follow` child and
the `pooler-clients.mjs` / `pg-connections.mjs` samplers are allowed).
`--strict-host` refuses to start instead (exit 2, nothing created). The
check is in the report header and the JSON (`host.guard`).

## Full-scale commands (run one at a time)

From the repo root (`.env`/`.env.local` in the cwd, or `ENV_DIR=<checkout>`).
`BASE_URL` defaults to the dev preview alias; the guard refuses anything
but localhost / `opensetlist-git-dev-*.vercel.app`. Node ≥ 22.18 (type
stripping); `--no-warnings` only hides the "module type" notice for the
imported `.ts` files. If Chromium is missing: `npx playwright install chromium`.

```sh
# Main measurement: 30 pages + 470 SDK clients, 12 edits 25 s apart. Run it
# ALONE — under R2 these 500 clients are the notification burst; a
# concurrent k6 burst would make it a 1,000-client test (../README.md,
# "n14 R2 baseline run").
node --no-warnings tests/load/browsers/run.mjs --pages=30 --subs=470 --edits=12 --pause=25 --label=r2-baseline
```

| Drill | What it does | Gate |
|---|---|---|
| `silent-loss` | 10 pages (`--drill-pages`) lose the notification of the last edit: `--drop-via=proxy` (default) drops every notification frame (`rev` broadcast, and postgres_changes on an R1 build) from that edit's insert until they show its marker; `--drop-via=hook` arms the page's `__osl.dropNextNotification` right before the PUT (after the insert's notification arrived), so the hook drops the PUT's notification before `noteHint`; an unconsumed arm is cleared afterwards and counted. The 20 s ± 4 s repair poll must bring them there | max ≤ 24 s, 0 missing |
| `ws-blocked` | 10 pages never get a socket → the page's fallback polls every 5 s ± 1 s | informational: max ≤ 7 s, 0 missing |
| `reconnect` | right before `--drill-edit`, every page and SDK socket is force-closed (unclean); the edit follows `--reconnect-lead` ms later | catch-up informational; 0 regressions across the handoff |
| `double-save` | a second PUT with another marker hits the same row `--double-gap` ms after the first | every client converges to the final save, 0 regressions |
| `lost-final` | the last PUT's notification is dropped on every page (proxy or hook, as above) and every SDK client (the worker drops valid payloads before `noteHint`), after the insert's notification was delivered and settled (`--lost-settle`) | max ≤ `--lost-gate`=26 s, 0 missing; delivering fetch reason per SDK client (expect `periodic`) |
| `poison` | a guest anon client sends ONE forged `{ kind: "setlist", rev: --poison-rev }` (default 2^53 − 1) before `--drill-edit` (default 1), then waits `--poison-lead`=4000 ms; the honest saves follow | ≤ 1 recheck of the forged hint per SDK client, no client's `serverRev` ever ≥ the forged rev, forgery received; honest saves under the primary gate |
| `spam` | the guest sends `--spam-rate`=2 msgs/s for `--spam-secs`=60 alongside the real saves; `--spam-rev=ahead` (latest real rev + 1) / `max` / `stale` | per SDK client, notification + recheck starts ≥ 1 s apart (the shared cooldown), 0 HTTP / network / deadline failures in the window; per-client rates reported |
| `verify-ambiguity` | after `--drill-edit`'s insert settled, a helper sends `--prime-per-locale`=1 request per locale with `minRev = rev + --prime-offset`=1000 (no hint) so the instances serving them memoise the pre-save revision for 1 s; the PUT starts `--prime-lead`=150 ms later (priming not awaited) | every SDK client answered `memo` for that save resolves it on its one recheck; memo share reported; n/a when no memo was observed (routing is Vercel's) |

```sh
node --no-warnings tests/load/browsers/run.mjs --pages=30 --subs=470 --edits=3 --pause=25 --drill=silent-loss --drill-pages=10 --label=r2-silent-loss
node --no-warnings tests/load/browsers/run.mjs --pages=30 --subs=470 --edits=3 --pause=25 --drill=ws-blocked --drill-pages=10 --label=r2-ws-blocked
node --no-warnings tests/load/browsers/run.mjs --pages=30 --subs=470 --edits=3 --pause=40 --drill=reconnect --drill-edit=2 --label=r2-reconnect
node --no-warnings tests/load/browsers/run.mjs --pages=30 --subs=470 --edits=3 --pause=25 --drill=double-save --label=r2-double-save
node --no-warnings tests/load/browsers/run.mjs --pages=30 --subs=470 --edits=3 --pause=25 --drill=lost-final --label=r2-lost-final
node --no-warnings tests/load/browsers/run.mjs --pages=30 --subs=470 --edits=3 --pause=25 --drill=poison --label=r2-poison
node --no-warnings tests/load/browsers/run.mjs --pages=30 --subs=470 --edits=3 --pause=25 --drill=spam --label=r2-spam
node --no-warnings tests/load/browsers/run.mjs --pages=30 --subs=470 --edits=3 --pause=25 --drill=verify-ambiguity --drill-edit=2 --prime-per-locale=20 --label=r2-verify-ambiguity
```

**Guest-broadcast drills.** `poison` and `spam` open one extra supabase-js
client with the public anon key (what any visitor has), join the public
`event:<id>` channel and send forged `rev` broadcasts in the writer's exact
payload shape (no marker field; the report tells them apart by rev and send
time). Sends use `ack: true`, so each message's server verdict is in the
report's "Guest broadcasts" section and the JSON (`guest.sends`). An R1 page
build ignores broadcasts, so on R1 pages these drills only exercise the SDK
clients.

**Against an R1 server** (the dev preview before the R2 PR deploys, or
after a rollback) every response lacks `x-snapshot-verify` → `missing` →
inconclusive whenever the body is below the hint, so every such
notification fetch takes exactly one recheck: that is the rollback-
compatibility path, and a valid smoke. `memo` never appears there.

`--drill` also accepts the camelCase names (`doubleSave`, `lostFinal`,
`verifyAmbiguity`). Small smoke (~1 min each, 2 rows created and
soft-deleted): `--pages=2 --subs=5 --edits=2 --pause=12 --drill=<name>`;
afterwards `restore.mjs --compact --yes`.

Results: `tests/load/results/<UTC date>/<stamp>-browsers[-<drill>].md` (+ `.json`,
gitignored, with per-page raw data, `hints`, `validity`, `host`, and the
drill's per-client detail) and **`<stamp>-timelines.jsonl`** — one line per
thread, per save, per SDK client and per page with the full request /
apply / broadcast timeline exactly as recorded (the JSON keeps only
per-save aggregates for SDK clients); its first line documents every row
layout. The `.jsonl` is gitignored and **stays local** on the load host
(tens of MB at full scale); keep it next to the report for later
analysis. Exit code 0 = gates passed; 1 also when a monotonicity
regression was seen or a drill gate failed; 2 = error / refused
(`--strict-host`); **3 = INVALID** (host stall, see above).

Other flags: `--edit-mode=pair|standalone|mixed`, `--strict-host`,
`--debug-stall=<ms>` (self-test only), `--event-id`, `--event-path`, `--after-row=2`, `--timeout=30`,
`--settle=10`, `--join-timeout=120`, `--wait-pg-ready=true` (only for an R1
page build: also wait for the pages' postgres_changes registration, up to
`--pg-ready-timeout=180` s; off by default — an R2 page / SDK client is live
at SUBSCRIBED), `--sub-workers=N` (default ⌈subs/120⌉), `--sub-batch=50`
(SDK joins per second), `--page-concurrency=5`, `--drill-edit=k` (ignored
by lost-final: always the last edit), `--reconnect-lead=1000`,
`--double-gap=300`, `--lost-gate=26000`, `--lost-settle=2000`,
`--drop-via=proxy|hook`, `--gate-p95=3000`, `--headed`; guest drills:
`--poison-rev`, `--poison-lead=4000`, `--spam-rate=2`, `--spam-secs=60`,
`--spam-rev=ahead|max|stale` (`--drill-edit` defaults to 1 for both; a
guest that cannot join the channel stops the run, clean-up first);
verify-ambiguity: `--prime-per-locale=1`, `--prime-offset=1000`,
`--prime-lead=150`.

## Positions (read before running repeatedly)

insert-after shifts every row below the insertion point down by one, and
the soft-delete route does not compact. The page numbers rows by index,
so nothing visible changes and the order is intact, but the stored
positions of rows 3..23 grow by the number of edits on every run. The
run does **not** fix this by default — that would mean writing the
pre-existing rows directly. With the owner's OK:

- `--restore-positions` on `run.mjs` puts every row that was active at the
  start back on its recorded position (one transaction holding the Event
  row lock, then a no-op API re-delete to bump the revision and purge the
  snapshot cache), or
- `node tests/load/browsers/restore.mjs --compact --yes` renumbers the
  event's active rows to 1..N in their current order.

## Not implemented here

"Mixed old/new tabs across a deployment change" and "real rollback with
tabs open" need a deployment (R1 → R2 and back) and belong to the **R2
rehearsal**, not to this tool (`../README.md`, "n14 R2 baseline run", (c)).
