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
| `overlap.mjs` | `--drill=overlap`: flag parsing and refusal rules, gate anchoring (last original start, head), group convergence, SDK (rev, capturedAt) monotonicity, the page-stall SUSPECT rule, reload / role / reaction / ack-hold verdicts — pure, pinned by `node --test tests/load/browsers/overlap.test.mjs`. |
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
the `pooler-clients.mjs` / `pg-connections.mjs` / `supavisor-backends.mjs` samplers are allowed).
`--strict-host` refuses to start instead (exit 2, nothing created). The
check is in the report header and the JSON (`host.guard`).

`--declared-process=<pid>` (n14 step 7) declares ONE process as part of
the experiment — the background k6 of step 7. The guard accepts exactly
that pid plus its descendants by parent PID; any other unknown process
still competes (a second k6 included). Its name, command line and OS
start time are recorded (JSON `declaredProcess`), its end by a 2 s
alive poll; under `--phase=spam7` the host is re-checked asynchronously
mid-spam and at the measurement end, and an undeclared competing
process found then makes the run INVALID.

## Full-scale commands (run one at a time)

From the repo root (`.env`/`.env.local` in the cwd, or `ENV_DIR=<checkout>`).
`BASE_URL` defaults to the dev preview alias; the guard refuses anything
but localhost / `opensetlist-git-dev-*.vercel.app`. A one-off preview
deployment's own URL (`opensetlist-<hash>-opensetlist-projects.vercel.app`,
the fault drills) needs `--deployment-url`, which also checks before the
first write that the target serves event 111 at the dev database's
revision with exactly its rows (ids and positions; ../README.md,
"Warming fault drills"). Node ≥ 22.18 (type
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
`--settle=10`, `--join-timeout=120`, overlap: `--overlap-*` (see "Overlap drill"), `--wait-pg-ready=true` (only for an R1
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

## Overlap drill (`--drill=overlap`, n14 qualification step 4)

Qualifies writer warming under **genuinely overlapping warm jobs**. The
drill replaces the edit shape for the whole run: `--edits=N` = N
**groups**, `--pause` s apart, and every group fires two or three admin
PUTs on three **anchor rows** (created after row 2 before the population
joins, soft-deleted at the clean-up) **without awaiting each other**:

| t (from save A's start) | action |
|---|---|
| 0 | save A (`PUT …/setlist-items/<anchor A>`), with `x-live-warm-fault: <spec>` when `--overlap-fault-a` is set |
| `--overlap-gap` (250) | save B |
| `--overlap-third-at` (0 = none) | save C |
| `--overlap-reload-at=<ms,ms>` | authenticated `GET /admin/events/<id>/edit` (status, request start → body drained, bytes, content check: "이벤트 편집" + "시작 시각 (UTC)" + the event id in the initial data — a 200 that is a login page or an error boundary fails); plus CONTROL reloads: 3 before the first group, 2 in every pause, 3 after the last group |
| `--overlap-catalog-at` (0 = none) | `PUT /api/admin/songs/<A's song>` with the COMPLETE payload, only `originalTitle` → `<base>-c<k>`. A's marker is then a **dedicated song per group** (`n14-overlap-<run>-<k>`, created before the population joins, soft-deleted at the clean-up); a real catalog song is never edited |
| [0, 3 s] | `--overlap-reactions=<n>` raw `POST /api/reactions` on anchor row A (`anonId` `n14run2-<run>-<k>-<i>`, types other than the last one; deleted by id at the clean-up, the prefix is the safety net for `viewers-check.mjs --delete`) |

Saves are **never retried** (a retried A landing after B would change the
head mid-measurement); a failed save is a gate failure. Marker songs are
group-specific (A, B, C each), so a page's first sight of a marker is
this group's.

- `--overlap-fault-a=<spec>` — a job-side spec (`slowjob|slowset|slowbuild=<ms>`, `seterror`, `setskip`, `locale=<l>`, comma-combined) sent on save A only. **Refused (exit 2) without `--deployment-url`**: the dev alias is never armed, the header would be ignored and the scenario silently not exercised. Lookup-side modes (`absent`, `slow`, `getnull`, `geterror`) are refused too (the server would answer 400).
- `--overlap-probes=1` (default on; `0` = off) — after each group, hinted `GET /api/setlist?…&minRev=<rev>&hint=1` for **every committed rev** of the group (the revs the saves actually returned, never R+1) × ja/ko/en at +1 / +2 / +4 s after the last save's response. Reported apart (sources per key and locale, `→N` when the body rev ≠ key); never part of a gate.
- `--overlap-quiet-tail=<s>` (default 0) — after the last group, probe its keys every 10 s for that long (how long an older / stale entry stays readable through the 90 s TTL; censored at the tail's end).
- `--overlap-page-reaction=1` — the reaction **ack-hold test** on the lowest-index page, in group 2 (anchor row A needs a song before a reaction button exists, which group 1's save A provides): the page's FIRST hinted `/api/setlist` request of the group is sent for real but its response held; the reaction button of anchor row A is clicked (the last reaction type); once `POST /api/reactions` answers (`reactionId`, `counts`, `ackAt`) the held, pre-click snapshot is released, and the button's displayed count is sampled every 20 ms in the page. Exposure (else "not exercised", never a pass): held `capturedAt ≤ ackAt` with a lower count, released after the ack. Gate: from the ack on, the display never drops below the acknowledged count until a response with `capturedAt > ackAt` arrives; 1 s later it shows that response's count. The page is excluded from that group's convergence (its delay is the test). Its reaction is deleted by id.

**Gates (per group; every group's value shown).** Clock = the group's
**last original request start**; target = the group's **head** (highest
committed rev — the Event row lock, not the start order, decides it).
Pages converge when the DOM shows every committed save's marker of the
group, SDK clients when they applied rev ≥ head (intermediate revs may be
skipped). All saves 2xx; 0 × 5xx anywhere (saves, reloads, catalog,
reactions, probes, SDK, pages); pages p95 and SDK p95 ≤ `--gate-p95`, 0
missing; **DOM monotonicity** on pages (marker-derived versions never go
back — a page exposes no applied rev) and **(rev, capturedAt)**
monotonicity on SDK clients; original-attempt PUT p95 ≤ 1.5 s per role
(A, B, C); reloads in the window 200 + content ok + ≤ 3 s (control ratio
diagnostic only); raw reactions p95 ≤ 1.5 s, 0 × 5xx; the ack hold. From
the first save's start: informational. The per-save tables stay
(informational under this drill). The server-side gates and the
**exposure** classification (did B commit during A's job, did the builds
hold connections at the same time, reversed publication per locale, the
catalog race) need the history logs: `../overlap-join.mjs` (see
`../README.md`, "n14 qualification step 4").

```sh
# smoke (dev alias, unarmed: no --overlap-fault-a), ~1 min, 3 anchor rows + 2 songs created and removed
node --no-warnings tests/load/browsers/run.mjs --pages=2 --subs=4 --edits=2 --pause=8 --drill=overlap --overlap-gap=250 --overlap-third-at=500 --overlap-reload-at=150,450 --overlap-reactions=4 --overlap-page-reaction=1 --overlap-catalog-at=400 --label=smoke-overlap
# a step-4 scenario on the armed preview, e.g. S2
BASE_URL=https://opensetlist-<hash>-opensetlist-projects.vercel.app node --no-warnings tests/load/browsers/run.mjs --deployment-url --pages=30 --subs=470 --edits=6 --pause=25 --strict-host --drill=overlap --overlap-gap=250 --overlap-fault-a=slowset=1500 --label=step4-S2
```

**SUSPECT (every run).** Step 3's page-side stall signature — one save's
first hinted fetches come back `warm` / `cache` on ≥ 80 % of the pages
(≥ 3 pages) yet EVERY one of them takes > 1 s — prints a SUSPECT banner
and goes into the JSON (`suspect`). Verdicts and the exit code are
unchanged: it is decided afterwards from the host telemetry and
independent evidence (SDK clients on the same save, the observer), never
an automatic INVALID.

## Admission phase (`--phase=admission`, n14 qualification step 5)

Qualifies **cold admission**: 30 pages + 470 SDK clients arriving on a
fresh deployment while saves happen. The standard start (join everybody,
settle, then edit) is replaced by three steps:

1. **prepare** — the identity guard (only with `--deployment-url`, and
   then against `--guard-precursor`), ONE admin login, ONE dedicated
   **anchor row** (inserted after row 2; every admission save, every
   standalone steady edit and the I3 saves PUT their marker here — a
   measured PUT deletes and recreates the row's three junction
   collections, so it never touches an original or fixture row), then
   the **run manifest** (`<stamp>-admission-manifest.json` in the
   results dir, written before the boundary): every active row with its
   songs in order, members (incl. a nullable `realPersonId`), artists,
   row attributes, the event revision (one repeatable-read read), the
   pre-anchor original rows (what `--restore-positions` restores), and
   with `--rows-manifest=<fixture json>` which rows are fixture clones
   (accepted shapes: `clones: [{ id }]`, `createdIds: [id]`,
   `created: [...]`, or `items` / `rows` entries flagged `clone: true`).
   Prepare talks to the precursor (deployment-URL runs) or to the alias,
   which still points at the precursor until the redeploy.
2. **boundary wait** — `--admit-at=<ISO UTC>` or `--admit-file=<path>`
   (exactly one). Nothing is sent: every HTTP request (undici) and TCP
   socket this process opens in the wait is recorded and the report
   prints the count (gate 0). The admit file may be empty (`touch`) or
   JSON naming the measurement deployment and the binding:
   `{ "base": "https://opensetlist-<hash>-opensetlist-projects.vercel.app", "precursorId": "dpl_…", "measurementId": "dpl_…", "inspect": "<vercel inspect output>" }`
   (`base` is accepted only with `--deployment-url`; a measurement base
   equal to the precursor aborts the run before T0).
3. **admit** at T0 — pages (`--page-concurrency`, 5) and SDK clients
   (`--sub-batch`, 50/s) start together; the admission saves run on
   their own timer from T0 (`--admission-saves=5,20,45` s), concurrent
   with the launches, never retried; with `--deployment-url` one generic
   read at T0 proves the measurement deployment serves the manifest
   before the first save may write through it. Then the normal edit loop
   (`--edits`, `--edit-mode`, `--pause`; A2: `--edits=8
   --edit-mode=mixed`), then the optional **I3 final phase**
   (`--final-cohort=20,20`): the pages close, the first 20 connected SDK
   clients stay connected (the others are stopped — the finalizer would
   otherwise stop everybody), 20 fresh clients join, 6 s after they are
   all connected a save, +40 s another; then teardown.

Per-client records (JSON `admission.sdk` / `admission.pages`, timelines):
SDK — `attemptAt`, every SUBSCRIBED, the full `statusLog` /
`connLog` (so "continuously connected through instant t" is derivable),
the first request and the first successful snapshot (request start,
response, rev, `x-snapshot-source`, body bytes), every raw broadcast
receipt, every applied snapshot (rev, capturedAt, fetch reason); pages —
launch wave, navigation start (the browser's timeOrigin), TTFB,
DOMContentLoaded, the document's status and bytes, the **SSR seed**
(`initialRev` in the HTML: `live <rev>`, `absent` = the degraded path
`[eventPage] live seed unavailable`, `unknown`), hydration readiness
(first `/api/setlist` request or first Realtime socket), the first fetch
(source, rev), the channel join, and the **complete expected setlist**
time: the setlist rows as rendered (every `<li>` with `<SetlistRow>`'s
`grid-cols-[28px_1fr]` grid, in DOM order: main rows, then encore rows;
per row its song links `/songs/<id>` in order — a medley is several, a
blank / non-song row none) compared with the manifest by **order and
multiplicity** (a fixture's clones repeat song ids; a set comparison
would pass with only the originals rendered); the anchor row may show
blank or any of the run's markers. Checked against the live page (23/23
rows incl. the medley and the encore, ja and ko). If the markup changes
the "rows matched n/m" column drops — a page is never "complete" by
accident. Only rows before the first steady edit are judged (a pair edit
changes the expected rows). Images, fonts and media stay aborted.

**Exposure (predeclared, per save, this host's clock only).** SDK: at
the PUT response, ≥ `--exposure-sdk-min` (100) clients SUBSCRIBED and
continuously connected through the save AND ≥ 100 not yet SUBSCRIBED →
"SDK admission save". Pages, separately: ≥ `--exposure-pages-min` (5)
pages navigated by the PUT start whose complete setlist came later →
"page admission save" (unlaunched pages are future arrivals). Neither →
"after admission" (still gated). No SDK-admission save in the run → the
SDK aspect is **NOT EXERCISED**; no page-admission save → the page aspect
is; neither → the run is (exit 4).

**Gates** ("Admission" section; the per-save tables stay as
information): 0 outbound requests in the boundary wait; the event
unchanged between prepare and the first save (no first answer above the
manifest's rev — a foreign save would make every page "incomplete");
every save 2xx; 0 × 5xx anywhere (saves, page documents and fetches, SDK,
the T0 identity read), 0 × 503, 0 transport failures; everybody joined
within `--join-timeout` from T0; pages: complete setlist p95 ≤ 3 s from
navigation start, every page complete, 0 degraded seeds
(`--expect-live-seed=false` only for a deliberately non-live event); SDK
time to first snapshot p95 ≤ 3 s, everybody got one; convergence per
population — **joined-before** (SUBSCRIBED / channel joined ≤ PUT start)
from the PUT start, **joined-after** from max(subscribedAt / join, PUT
response) — p95 ≤ 3 s, 0 missing, pages following the returned revision
(a later marker on the anchor counts); 0 monotonicity regressions (DOM
version, applied rev, (rev, capturedAt)); PUT p95 ≤ 1.5 s. **Stale first
answers** (a first read that started after the PUT response but carried
a lower rev: SDK first request, page SSR seed) are counted per save, not a
gate. The raw broadcast receipt of each save is reported next to the
reason of the fetch that applied it. Verdict: **VALID + PASS / VALID +
FAIL / INVALID** (host stall, as before) **/ NOT EXERCISED**; SUSPECT
stays a banner. Exit codes: 0 pass, 1 fail, 3 invalid, 4 not exercised.
Server side (acquire ≤ 500 ms, EMAXCONN, Σ with completeness, builds per
minute / instance, A4 fault evidence): `../admission-join.mjs`.

```sh
# smoke on the dev alias (no redeploy), ~2.5 min, 1 anchor row created and removed
AT=$(node -e "console.log(new Date(Date.now()+45000).toISOString())")
node --no-warnings tests/load/browsers/run.mjs --phase=admission --pages=2 --subs=5 --sub-workers=1 --edits=1 --edit-mode=standalone --admit-at=$AT --admission-saves=5,15 --exposure-sdk-min=1 --exposure-pages-min=1 --final-cohort=2,2 --restore-positions --label=smoke-admission
# A0 (dev alias; the operator touches the admit file after the redeploy — ../README.md "n14 qualification step 5")
node --no-warnings tests/load/browsers/run.mjs --phase=admission --pages=30 --subs=470 --edits=0 --admit-file=admit-A0.json --strict-host --restore-positions --label=step5-A0
```

## Idle-broadcast drill (`--drill=idle-broadcast`, n14 step 5 I-cycles)

The first save after an idle period, and the runbook's **wake
procedure**. SDK cohorts only (`--pages=0`, required; `--subs` /
`--edits` are not used). Nothing broadcasts before the first save: the
login is not a save and the anchor row is created BY the first measured
save (an insert-after = one save, one broadcast), so the idle period
ends exactly there.

- **I1**: `--cohort-incumbents` (20) clients connect at `--connect-at`
  (the observer's `connect_at` — same instant); the first save at
  `--first-save-at` (= observer readiness + 6 s) or released at run time
  through `--first-save-file=<path>` (content = the ISO instant; empty =
  6 s after the file appeared; nothing by `--connect-at + --max-age` →
  aborted, NOT EXERCISED); ≥ 40 s of quiet; then PUTs on the anchor at
  `--idle-saves=40,100` s after the first save.
- **I2** (`--wake`): the first save is the **check save** — its rev must
  arrive by broadcast at every connected local client within
  `--wake-check-timeout` (10 s); a miss is recorded, one retry save is
  made and verified, a second miss records "escalate" (the clients must
  be reloaded / reconnected before the show relies on them); everyone
  stays connected; at first save + `--wake-gap` (600 s) the fresh cohort
  (`--cohort-fresh`, 20) joins; 6 s after it is all connected a save,
  +40 s another.
- **Eligibility, post hoc** (per client, per cycle save): connected 6 s …
  `--max-age` (90) s before the save, without interruption through its
  PUT response, cohort first-SUBSCRIBED spread ≤ 30 s. The predeclared
  rule needs EVERY cohort client eligible — otherwise the cycle is **NOT
  EXERCISED** (a longer readiness period or a reconnect is a different
  experiment), never silently reported as this one.
- **Per client, per save**: the raw broadcast receipt (ms after the PUT
  response), the reason of the fetch that applied the save, the repair
  time (applied without the broadcast) — healthy repair is the periodic
  poll, 20 s ± 4 s: reported as measured, never as a bound. The
  population of a save = clients that had subscribed by its response.
- Verdict per cycle: PASS = every eligible client received the raw
  broadcast and applied the save; FAIL = the idle-broadcast defect (with
  the repair that brought the client forward); exit 0 / 1 / 4 (any FAIL
  / all NOT EXERCISED). The observer's clients are judged by the same
  rule in `../admission-join.mjs --observer=<artifact>`.

```sh
# I1 (after ≥ 30 min idle: no broadcast and no client of ours, incl. the observer)
node --no-warnings tests/load/browsers/run.mjs --drill=idle-broadcast --pages=0 --cohort-incumbents=20 --connect-at=<T> --first-save-file=first-save.txt --strict-host --restore-positions --timeout=60 --label=step5-I1a
# I2 (wake procedure)
node --no-warnings tests/load/browsers/run.mjs --drill=idle-broadcast --pages=0 --wake --cohort-incumbents=20 --cohort-fresh=20 --connect-at=<T> --first-save-at=<T+8s> --strict-host --restore-positions --timeout=60 --label=step5-I2a
```

## Transition phase (`--phase=transition`, n14 qualification step 6)

Qualifies **deployment transitions with open tabs**: the dev alias is
moved between deployments (ON → OFF → ON, ON → R1 → ON, pseudo-switches
for the T0 control) while 30 pages + 470 SDK clients stay open on it.
The harness never calls `vercel`; the OPERATOR moves the alias and tells
the harness through **switch files**. Pure logic: `transition.mjs`
(tests: `transition.test.mjs`); attribution of every response to a
deployment: `../transition-join.mjs` (Vercel request logs).

**Start.** ONE admin login, ONE dedicated anchor row (every timeline
PUT writes its marker here), the run manifest
(`<stamp>-transition-manifest.json`), then the population joins the
alias (SDK 50/s, pages at `--page-concurrency`) and settles `--settle`
(default 20 s here). The controlled subsets are **carved out of
`--subs`** (natural = subs − hold − ahead), each in its own worker
(cohorts `hold` / `ahead`), so the declared population stays the
declared population. The probe starts after the settle and runs to the
end.

**Switch-file protocol** (`--switch-files=a.json,b.json,…`, one per
switch, processed in order; the harness polls every 200 ms, a
half-written file is just "not yet"; ISO or epoch-ms instants; a BOM is
tolerated):

1. ≥ 60 s before the switch (`--notice-min`; shorter notice is recorded
   as a warning, the run goes on) the operator writes
   `{ "plannedAt": "<ISO>", "kind": "<kind>", "label": "ON-A→OFF-1", "afterSwitchSaves": "insert,update,delete" }`.
   `kind` ∈ `pseudo` (T0, no move), `off`, `return` (back to an
   EXISTING ON deployment → stale-first-answer check), `fresh` (a fresh
   ON target), `r1` (the arrivals' page part becomes the R1 cohort),
   `return-from-r1` (the ahead-hint subset is armed). `afterSwitchSaves`
   (optional; update / delete need insert) = the INSERT / UPDATE /
   soft-DELETE run as separate saves after the leg's last planned save,
   `--after-switch-gap` (10 s) apart — the R1 tabs' three change types.
2. At P the operator runs `vercel alias set <target> <alias>` and, right
   after it returned, MERGES into the same file
   `{ "cliStart": "<ISO>", "cliEnd": "<ISO>", "cliCpuMs": 812, "target": { "url": "https://opensetlist-<hash>-opensetlist-projects.vercel.app", "id": "dpl_…" } }`.
   T0 pseudo-switches write the CURRENT deployment as the target.

**Per leg** (all relative to P = `plannedAt`):

- **Saves** at `--transition-saves` (default `-30,-1,+1,+5,+11,+15,+30,+60`
  s; at least one before and one after P) — PUTs on the anchor, never
  retried, sequential (each waits for the previous one; scheduled vs
  actual start = `lateMs`, offset from the file's cliEnd =
  `fromCliEndMs`). **Leg quiet**: no save of a leg starts before the
  previous leg's last save + `--leg-gap` (90 s); a save delayed by that
  is recorded (`quietDelayMs`) and the leg flagged `spacingViolated`.
- **Identity guard on the actual target**: as soon as the file names
  `target`, ONE generic read through the target's IMMUTABLE URL
  (`minRev` = the DB revision just read) must serve the dev database's
  active rows — ids AND positions — at ≥ that revision (an alias read
  could still reach the incumbent and falsely "verify" the target). It
  gates the NEXT write (`gatedMs` on that save); a failed guard stops the
  timeline (verdict ABORTED, exit 2, the measured part is still
  reported). `target.url` must have the deployment-URL shape.
- **Route marker** (population `route`, outside every gate): a document
  that needs no database (`/<locale>/privacy`) at `--route-marker` per s
  (2) over `--route-window` (`-10,70` s), plus one baseline read at the
  leg start. Its `data-dpl-id` (Skew Protection stamps the serving
  deployment on `<html>`) positively identifies the deployment live:
  the first marker served by the target (or, target unknown yet, by a
  non-baseline deployment; for a pseudo-switch, the first marker that
  started after cliEnd) = the leg's **provisional boundary** ("first
  target response"); without it, cliEnd. The join replaces it with the
  log-attributed one. Also: last old request start / response, and
  sustained target routing over 60 s.
- **Probe** (population `probe`, whole run): one hinted fetch per
  `--probe-interval` (1000 ms) on the alias, `minRev` = the latest
  CONFIRMED committed rev (a save's 2xx response), locales rotating.
- **Hold subset** (`--hold-subset`, 20): armed 0.5 s before the first
  `--hold-at` wave (`-1,1,3` s; clients round-robin over the waves); each
  wave gets a controlled `resume` fetch (recorded in the client's
  `trig`); every response that completes while armed is held CLIENT-SIDE
  (an async gate — the worker thread never blocks, the lag monitor and
  the real 8 s deadline keep running; a hold that outlives the deadline
  becomes the real deadline failure, counted apart as "held → deadline")
  and released at the first target response seen live + 200 ms, or at
  `--hold-cap` (30 s). Produces "old answer after the cutover, then a
  follow-up converges".
- **Ahead-hint subset** (`--ahead-hint-subset`, 20; only before a switch
  of kind `return-from-r1`): at `--ahead-hint-at` (`-1.2` s) its clients
  get a SYNTHETIC hint = latest committed rev + `--ahead-hint-offset` (5)
  through the client's own broadcast path (`noteHint` → notification
  fetch; receipts marked `s` / `sd`, never counted as broadcasts, and
  requests carrying it flagged `synthetic`). On R1 the answer is below
  the hint without a verify header → inconclusive → the recheck is queued
  (≥ 1 s) and lands across the switch. The scheduler state at P is
  recorded (`stateAtP`: tickets in the recheck phase).
- **Arrivals** at P + 10 s: `--arrivals=<pages>,<sdk>` (`10,100`), new
  cohort `arrival-<k>`; after a `kind: "r1"` switch the page part is the
  **R1 cohort** (`--r1-cohort`, 15, cohort `r1-<k>`) — whatever the alias
  serves then, classified post hoc by behaviour: a page that registered
  `postgres_changes` is R1 (an R2 page never does); readiness per cohort
  (R1 = postgres_changes registered, R2 = channel joined). Arrivals are
  retained; the population growth is reported.
- **Reaction / wish smoke** at P + `--smoke-at` (20 s) from ONE OLD
  (initial) page per locale, from inside the page (its origin, cookies,
  localStorage): POST a reaction on the anchor with the page's anon id,
  read the counts back, POST a wish; then the reaction row's `anonId`
  from the DB (persistence) and the anon id before the switch = at the
  smoke = in the row (retained identity). Both are deleted at once. A
  wish on an ongoing event is LOCKED by design (403 "locked") — expected.

**Records** (JSON `transition`, see "Row formats"): every response with
its FULL `x-vercel-id`, status, body validity, rev, `x-snapshot-source`,
the raw `x-snapshot-verify` (absent = R1), the hint and the resolution
the client computed, recheck queued, pin evidence (request header
`x-deployment-id`, cookie `__vdpl`, `dpl` query — "none" expected for
every API request), `x-vercel-cache` / `cache-control` / `age`, and the
milestones request start / headers received / body complete /
acceptance evaluated / scheduler settled. Pages: the document's
`data-dpl-id` (the build the tab runs) and `x-vercel-id`, every
framework asset response (status, `dpl` pin), failed requests,
main-frame navigations, page errors, and the raw `postgres_changes`
receipts with `isDeleted` (a soft-delete is an UPDATE).

**Exposure (predeclared, per switch; PROVISIONAL boundary)**: pending
hinted fetch — ≥ 20 natural clients with a hinted request dispatched
before cliStart and not settled at the boundary; pending recheck (ahead
subset) — ≥ 5 synthetic tickets answered inconclusive before cliStart
whose recheck settled after it (queued = dispatched after cliStart,
dispatched = in flight at cliStart); old answer after cutover — ≥ 5
clients (natural + hold, counted apart) with a 200 dispatched before
cliStart and evaluated after the boundary, then converged to the leg's
head without a regression; arrival saves (the saves within 6 s after the
arrival start, i.e. +11 / +15) — SDK ≥ 20 arrivals not yet SUBSCRIBED at
the PUT response, pages ≥ 3 arrivals navigated but incomplete, judged
independently. Each EXERCISED / NOT EXERCISED.

**Verdicts per switch, separate**: *continuity* — every planned save
2xx; every eligible client (incumbents from the PUT start, arrivals from
max(join, PUT response) — admission.mjs's split) ≥ the saved rev (pages:
the marker or a later one; structural saves: the DOM row list) within
`--continuity-timeout` (30 s) of the first save attempt, supersession
allowed; every continuously connected R2 client (SDK: connected through
PUT start … PUT response + 10 s; R2 pages: joined before the save, not
reloaded) received the committed broadcast; 0 × 5xx anywhere, 0
transport failures, 0 malformed bodies, 0 unexpected reloads, 0 page
errors, 0 monotonicity regressions (in the leg window); outcomes per
save counted (satisfied-first-fetch / rechecked / periodic-repaired /
other reasons / superseded / ticket exhausted). *Performance* — per
save per population (SDK before / after, pages before / after /
structural) p95 ≤ `--gate-p95` (3 s), kept visible even when continuity
passes (OFF at 70 rows and R1 may fail: that is the rollback's measured
cost). *Arrivals* — time to usable = the LATER of complete setlist and
readiness, every page usable, p95 ≤ the gate (all waves; wave 0
reported); SDK first snapshot. *Smoke*, *guard*. Plus the R1 cohort table
(per R1 page and after-return save: change received, type / isDeleted,
next fetch start, DOM update), the existing-ON return's stale first
answers (reported, not a gate), pin evidence ("no chunk 404 after the
switch" only claimed when old tabs fetched assets after it), update gaps.
Validity as in every run (whole window). Run verdict: INVALID (3) >
VALID + FAIL (1) > NOT EXERCISED (4: an exposure missed — re-run that
switch, the behavioural verdicts stand) > VALID + PASS (0); ABORTED = 2.

```sh
# smoke on the dev alias with a simulated (pseudo) switch: the switch file's
# target is the deployment the alias already serves
#   npx vercel inspect <alias> --scope opensetlist-projects → its immutable URL + dpl id
node --no-warnings tests/load/browsers/run.mjs --phase=transition --pages=2 --subs=5 --sub-workers=1 --arrivals=1,2 --hold-subset=1 --ahead-hint-subset=1 --switch-files=s1.json --transition-saves=-20,-1,1,5,11,15 --after-switch-gap=5 --label=smoke-transition
node tests/load/browsers/restore.mjs --compact --yes
# T1 (three switches; the operator writes t1-a/b/c.json — ../README.md "n14 qualification step 6")
node --no-warnings tests/load/browsers/run.mjs --phase=transition --pages=30 --subs=470 --switch-files=t1-a.json,t1-b.json,t1-c.json --strict-host --label=step6-T1
```

## Spam phase (`--phase=spam7`, n14 qualification step 7)

Qualifies **sustained guest spam + real saves + background k6**: a
guest (anon key, like any visitor) sends forged `rev` broadcasts for
five minutes while 12 mixed edits land; judged on honest page / SDK
latency per save, save success, 0 missing, 0 × 5xx, bounded and
draining request rate. Pure logic: `spam7.mjs` (tests:
`spam7.test.mjs`); server logs / k6 / side-car join:
`../spam7-join.mjs`. Existing modes (incl. `--drill=spam`) are
unchanged.

**Timeline.** Standard start (ONE admin login, the anchor row, the
population joins and settles, the guest joins during the settle), then
explicit instants on this host's clock: **baseline**
`--baseline-secs` (60) → **spam** `--spam-secs` (300) → **recovery**
`--recovery-secs` (60, from the later of the scheduled attack end and
the last send) → **measurement end** (the recovery end, or the last
PUT + `--timeout` if later) → clean-up. Validity (lag / heartbeat,
browser round trips, host re-checks), the failure accounting and the
monotonicity check cover baseline start → measurement end; nothing is
cleaned up before it.

**Saves.** One edit per `--save-offsets` entry (default
`10,35,…,285`; the repeat `12.25,37.25,…,287.25`), seconds from the spam
start, each on its own timer, mixed shape (odd k = insert-after + PUT on
the new row, even k = PUT on the anchor) = 18 measured writes + the
anchor. **Never retried**: a failed write is recorded (status, error,
x-vercel-id) and gates the run; a 5xx insert that committed anyway is
adopted for the clean-up only. The latency clock is the PUT's start.

**Sender.** Slot k due at spamStart + (k − 1) / `--spam-rate` (2);
payload `{ kind: "setlist", rev, runId, k }` (the app validates only
`kind` / `rev`). `--spam-rev`: `ahead` = latest committed rev + 1 (base
= the post-preparation head, refreshed from every save's response),
`max` = 2^53 − 1, `stale` = the latest committed rev, `none` = P0
control (no guest; the same schedule and "attack end"). Sends are not
awaited per slot (acks recorded per message); a slot is skipped only
when the loop is > one interval late or > 20 acks are outstanding.
`stale` refuses saves inside the spam block (P3:
`--spam-secs=60 --spam-rev=stale --save-offsets=-20,70`); just before
the block the run records whether every client observed the head.

**Receivers.** SDK clients record each forged message on handler entry
— receipt time, serverRev, then the outcome (`n` noted / `d` ignored /
`x` dropped / `i` invalid); pages record the frame (`?` = the page's
own handler is not observable; serverRev = a proxy, the highest body
rev fetched before). `k` never reaches acceptance or the scheduler.

**Predeclared gates** (FIXED declared populations = `--subs` /
`--pages`, idx 0 … n − 1; a client without a record counts as zero):

| aspect | rule | outcome |
|---|---|---|
| exposure | sends ≥ 95 % of planned slots in every 10 s bucket; ack ok ≥ 99 %; timely (first receipt ≤ 2 s after the actual send) ≥ 95 % of planned deliveries (slots × declared) per 10 s bucket per population AND ≥ 95 % of the sent messages per client | else NOT EXERCISED |
| honest latency | every edit × client pair; per save per population p95 ≤ `--gate-p95` (3000), 0 missing | FAIL |
| writes | every measured write 2xx; PUT p95 ≤ 1500 ms | FAIL |
| errors | 0 × (SDK 5xx / transport / malformed body, page 5xx / failed `/api/setlist` request / reload / page error, save 5xx / transport) | FAIL |
| drain | a full 10 s interval ≤ μ + max(0.5 μ, 2, 2 s₁₀) starting at/after the last send, completed ≤ 30 s after it, with 0 pending batches / carried tickets / in-flight ticket requests at its end (1 Hz worker state; in-flight = `getState().inFlight` joined with the worker's open request row), and no forged-ticket / recheck rebound until the recovery end | FAIL |
| cooldown | ticket-carrying requests ≥ 1 s apart per SDK client (baseline → recovery) | FAIL |
| watermark | every serverRev value ≤ the post-preparation head, or a rev this run's save returned, held no earlier than that save's start | FAIL |
| monotonic | pages DOM version / SDK applied rev never decrease | FAIL |
| stale (P3) | every ELIGIBLE receipt (forged rev ≤ the client's serverRev at receipt) ignored | FAIL; no eligible receipt → NOT EXERCISED |
| fixture | the snapshot at the post-preparation head serves exactly the DB's active rows | else NOT EXERCISED |
| background | the declared process alive until the recovery end | else NOT EXERCISED |

μ = mean snapshot requests/s of the baseline (SDK + pages, each request
once by its START, k6 excluded), s₁₀ = sample SD of the non-overlapping
10 s averages. Diagnostics (never gate): SDK strata at each PUT dispatch
(`none` / `queued-ticket` = carried or batched ticket / `inflight-ticket`
= notification or recheck carrying one / `other-ticket-fetch` = a
generic, retry, catch-up carrying one; empty = NOT EXERCISED), latency
per stratum, ticket-drop recovery (a forged ticket exhausted while the
client was behind, then converged by a non-ticket request before any
later save), peaks. Verdict: **INVALID (3)** host corruption only (lag
/ heartbeat, browser round trip > 1 s or unanswered, undeclared
competing process at a re-check) > **VALID + FAIL (1)** > **NOT
EXERCISED (4)** > **VALID + PASS (0)**.

```bash
# P1 (primary, ahead) — k6 started first, its pid declared (../README.md "n14 qualification step 7")
node --no-warnings tests/load/browsers/run.mjs --phase=spam7 --pages=30 --subs=470 --spam-rev=ahead --strict-host --declared-process=<k6 pid> --label=step7-P1
# P0 control / P2 max / P1r repeat / P3 stale
… --spam-rev=none --label=step7-P0
… --spam-rev=max --label=step7-P2
… --spam-rev=ahead --save-offsets=12.25,37.25,62.25,87.25,112.25,137.25,162.25,187.25,212.25,237.25,262.25,287.25 --label=step7-P1r
… --spam-rev=stale --spam-secs=60 --save-offsets=-20,70 --label=step7-P3
node tests/load/browsers/restore.mjs --compact --yes
```

### spam7 JSON (`<stamp>-browsers-spam7.json` → `spam7`)

Times are epoch ms of the load host unless noted.

```
spam7: {
  config: { baselineSecs, spamSecs, recoverySecs, spamRate, spamRev, offsets[], edits, label, base, runId, timelyMs, exposureMin{send,ack,timely,perClient},
            declared{sdk,pages}, gateP95Ms, putGateMs, drainDeadlineMs, timeoutMs, maxOutstandingAcks, browserInvalidMs },
  phases: { baselineStart, spamStart, spamEnd (= scheduled attack end, also P0), attackEndScheduled (alias), firstSend|null,
            lastSend (P0: = spamEnd), recoveryEnd, measurementEnd },  phasesIso: same keys, ISO,
  initialHead, fixture{ startRows, dbRows, servedItems, servedRev, head, match, error? }, headObserved (stale only){ at, head, sdk, sdkDeclared, pages, pagesDeclared, verified },
  declaredProcess: { pid, name, cmd, startedAt (OS, UTC ISO), tree[pids], descendants[{pid,name,cmd}], seenAt, endedAt|null, checks[] } | null,
  hostChecks: [{ label: "mid-spam"|"measurement end", at, ok|null, competing[{pid,why,cmd}], declaredAlive, declaredTree }],
  sends: [{ k, slotAt, sentAt|null, rev, ack ("ok"|"timed out"|"error"|…|null), ackOk, ackMs, skip (null|"late"|"acks outstanding"|"closed"), skipped }],
  receipts: { row: [k, receivedAt − spamStart ms, outcome, serverRevAtReceipt], sdk: [{ idx, rows[] }], pages: [{ idx, rows[] }] },
  exposure: { exercised (null = no sender), reasons[], planned, sent, skipped, ackOk, ackShare, sendMin, ackMs{dist}, sendLateMs{dist},
              buckets[{ i, from, planned, sent, skipped, ackOk, timely{sdk,pages} }],
              populations{ sdk|pages: { declared, recorded, received, duplicates, late, plannedDeliveries, timelyTotal, bucketMin, bucketShares[{i,share}],
                                        perClientMin, clientsBelow, worst[{idx,timely,share,present}], delivery{dist} } } },
  stale: { eligible, ignored, notedEligible, nonEligible, nonEligibleNoted, unknown, examples[], pass } | null,  pagesStale: same (proxy) | null,
  saves: [{ k, mode, offsetS, rev, putStart, putMs, sampleLagMs, pages{lat}, sdk{lat}, strata{ none|queued-ticket|inflight-ticket|other-ticket-fetch: {n, …lat} },
            strataUnclassified, pagesLat[], sdkLat{dist} }],          lat = { n, p50, p95, p99, max, missing, over, overShare, pass }
  latency: { pages{lat}, sdk{lat}, gateP95Ms, failedEdits },
  strata: { row: [idx, stratum, carriedPhase, inFlightReason], aggregate{stratum: {n, exercised, …lat}}, saves[{ k, rev, putStart, askedAt, answeredAt, clients[row] }] },
  writes: [{ k (0 = anchor), op: "anchor"|"insert"|"put", rev, putStart, putEnd, status, attempts (1), rowId, error }],
  writesDetail: [{ k, op, mode, offsetS, due, startedAt, lateMs, ms, status, rev, error, vercelId, rowId, songId?, orphanRowId? }],
  writesSummary: { expected, attempted, ok, put{dist}, all{dist}, anchor{id,rev,ms,startedAt}, pass, putPass },
  hintedStarts: [request-start ms of every hint=1 request, SDK + pages, baselineStart … measurementEnd],
  errors: { sdk{s5xx,transport,malformed,http4xx,gap}, pages{s5xx,failedRequests,reloads,pageErrors,http4xx}, saves, total, pass },
  buckets: [{ t, sdkNotification, sdkRecheck, sdkGeneric, sdkOther, pagesHinted, pagesGeneric, s503, total, roll10 }],   1 s, baselineStart … recoveryEnd
  rates{baseline,spam,recovery}, peaks{ sdkNotificationPerS, sdkRecheckPerS, pagesHintedPerS, totalPerS, roll10Max, s503 },
  drain: { mu, s10, baselineWindows[], threshold, confirm{from,to,avg,state,stateOk,completedAfterLastSendMs}|null, withinDeadline,
           firstQuiet (same shape)|null, rebound{count,genuine,byReason,examples}|null, later{maxRoll10,overThreshold,maxPending,maxCarried,maxInFlightTicket}|null, pass },
  workerState: [{ t, clients, pending, carried, carriedRecheck, inFlight, inFlightTicket, examples[] }],   1 Hz
  cooldown{ tooClose, clientsBad, minGap, examples, pass }, watermark{ checked, violations, clients, examples[{idx,t,rev,why}], pass },
  ticketDrop{ counts{forgedExhausted,current,recovered,repaired-by-save,ticket-path,not-converged}, rows[], exercised },
  browserProbe{ row, samples[[t, pageIdx, rttMs|null]], rtt{dist} },
  gates[{name,value,pass}], notExercised[], diagnostics[], verdict{ verdict, exit, failed[], notExercised[] }
}
```

The top-level JSON also carries `declaredProcess` and, in `config`,
`spam7` (the parsed flags), `runId`, `declaredPid`. Timelines: SDK rows
add `serverRevLog` ([t, serverRev] on every change), pages add
`docLoads` / `reqFailed` / `pageErrs`.

## Row formats (timelines `.jsonl` and JSON)

The timelines' first line documents every layout. Columns added in step
4 are APPENDED (existing positions never move):

| row | columns (0-based) |
|---|---|
| `sdk.reqs` | 0 tStart, 1 reason, 2 generic, 3 hint, 4 notify, 5 minRev, 6 status, 7 verify kind, 8 body rev, 9 hint resolution, 10 tEnd, 11 outcome, 12 x-snapshot-source, **13 body capturedAt** (epoch ms, PostgreSQL clock), **14 anchorTitle** (overlap only: anchor row A's song `originalTitle` in the body — the snapshot carries the raw `originalTitle` plus a locale-filtered translation, and the catalog edit changes `originalTitle`; null otherwise) |
| `sdk.applied` | 0 t, 1 rev, 2 fetch reason, **3 body capturedAt** |
| `page.reqs` | 0 tResponse, 1 minRev, 2 status, 3 x-snapshot-source, 4 body rev, 5 x-snapshot-verify, 6 hint=1, 7 request start, **8 body capturedAt** (pages stay DOM-measured: this is what arrived, not what React applied) |
| `save` | + `who` (overlap: A / B / C) |
| JSON `warm.saves[].sdk` / `.pages` | 0 idx, 1 locale, 2 start − commit, 3 end − commit, 4 source, 5 verify, 6 minRev, **7 body rev**; saves + `who`; new `warm.groups` (overlap: every intended save with its anchors) |
| JSON `probe` (overlap) | `row`: 0 tStart, 1 locale, 2 minRev, 3 status, 4 source, 5 body rev, 6 capturedAt, 7 anchorTitle, 8 tEnd; `groups[].probes[]` = `{ off, who, head, row }`, `tail[]` |
| `sdk.reqs` (step 5) | **15 body bytes** (a 200's body, UTF-8 after decoding) |
| `sdk` line (step 5) | + `cohort`, `attemptAt`, `stoppedAt`, **`statusLog`** [t, status, current channel 1 / retired 0], **`connLog`** [t, up 1 / down 0, status] (up/down transitions incl. a final `STOPPED`) |
| `page` line (admission) | + `rowsLog` [t, row signatures in DOM order: song ids joined by `+`, `""` = no song link], `navStart`, `ttfbMs`, `dclMs`, `docStatus`, `seed` { kind live / absent / unknown, rev }, `wave`, `firstApiReqAt`, `wsOpenAt` |
| JSON `admission` | `config`, `T0`, `base`, `prepBase`, `prepare`, `anchor`, `fixture`, `manifestFile`, `boundary` { waitFrom, T0, waitMs, outbound [t, http / tcp, target], admitFile }, `guardRead`, `scheduled` (scheduled vs actual save start), `expectedRows`, `saves[]` (k, mode, rev, putStart, putEnd, putMs, label, sdkExposure, pageExposure, sdkConv, pageConv, stale, receipt), `gates`, `verdict`, `exercised`, `final` (I3), `pages[]`, `sdk[]` (compact per client: subscription timeline, first / firstOk, bcasts, applied) — the input of `../admission-join.mjs` |
| JSON `idle` | `config`, `wake` (check results, escalation, fresh cohort times), `connectedAtSave`, `verdict`, `cycles[]` (name, save, verdict, elig, eligible, all, rows), `later[]`, `sdk[]` |
| `sdk.reqs` (transition) | **16 x-vercel-id**, 17 headersAt, 18 bodyAt, 19 evalAt (acceptance evaluated), 20 heldAt, 21 releasedAt (hold subset), 22 x-vercel-cache, 23 cache-control, 24 age, 25 x-snapshot-verify raw (null = absent), 26 pin evidence, 27 recheck queued 0/1, 28 fail kind, 29 synthetic hint 0/1; tEnd (10) = scheduler settled; `sdk` line + `trig` [t, reason] |
| `page.reqs` (transition) | **9 x-vercel-id**, 10 x-vercel-cache, 11 cache-control, 12 age, 13 pin evidence, 14 body complete t, 15 request path + query |
| `page.notes` (transition) | + 3 record `isDeleted`, 4 table |
| `page` line (transition) | + `cohort`, `docDplId`, `docVercelId`, `pgReadyAt`, `assets` [t, status, dpl query, path], `navs` [t, url, status, x-vercel-id, data-dpl-id] (document loads; a later one = a reload), `reqFailed` [t, path, failure], `pageErrs` [t, message] |
| JSON `transition` | `version`, `config`, `anchor`, `manifest`, `populations` {initial, growth[]}, `subsets`, `syntheticRevs`, `aborted`, `verdict` {verdict, exit, failed[], notExercised[]}, `switches[]`, `saves[]`, `probe[]` (main-thread response records), `rows` (column names), `sdk[]` (per client: cohort, connLog, statusLog, reqs with the transition columns, applied, bcasts, exhausted, trig), `pages[]` (compact + cohort, build, docDplId, readyAt, timeToUsableMs, fetches, notes, bcasts, assets, navs, reqFailed, pageErrs, seen, gone) — the input of `../transition-join.mjs` |
| JSON `overlap` | `gates`, `pass`, `fivexx`, `roles`, `reloads`, `reactions`, `ackHold`, `convergence`, `controls`, `groups[]` (`saves {k, who, startedAt, ms, status, rev, attempts, fault}`, `reloads {k, off, at, ms, status, bytes, contentOk}`, `catalog {k, startedAt, ackAt, status, from, to}`, `reactions`, `pageReaction` trace) |

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
