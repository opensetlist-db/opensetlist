# Real browsers + SDK subscribers (task n14, run #2)

Measures what a viewer of the live event page actually experiences when
the operator edits the setlist: **save → the new row on screen**, for
real Chromium pages and for a large population of supabase-js clients
that behave like the R1 page. Dev only (same guard as `../realtime/`).

| File | Role |
|---|---|
| `run.mjs` | Orchestrator: populations, edits, drills, measurement, report. |
| `pages.mjs` | Headless Chromium pages (one browser context each) on `/<locale>/events/111/...`, ja/ko/en 70/20/10. A MutationObserver (init script) reports, with the page's own clock, when each song link `a[href*="/songs/<id>/"]` appears. Websocket frames and `/api/setlist` responses are recorded from CDP for diagnosis; drills use `page.routeWebSocket` on the Realtime endpoint. |
| `subs-worker.mjs` | Worker thread holding a slice of the SDK population. Each client imports the page's **real** `liveScheduler.ts`, `snapshotAcceptance.ts`, `snapshotFreshness.ts` and `realtimeRecovery.ts` from `src/lib` (Node type stripping) and subscribes like `useRealtimeEventChannel`: `postgres_changes` on `SetlistItem` (no server filter, client-side scope check) → jittered U(0, 500 ms) fetch with `minRev = appliedRev + 1`, ≥ 1 s cooldown, single-flight + dirty follow-up; 20 s ± 4 s repair poll; jittered catch-up on every SUBSCRIBED; `Retry-After` floor; the hook's channel recovery — on CHANNEL_ERROR / TIMED_OUT / CLOSED keep the channel (realtime-js rejoins it), poll at 5 s ± 1 s, re-create only after `REJOIN_GRACE_MS` (60 s) + randomized backoff, max 3 per budget, budget refunded after 5 min healthy. Each client also listens for the server's `rev` broadcast on the same channel and records its arrival (R2 transport, unused by R1 pages). |
| `admin.mjs` | Admin driver: login, insert-after, PUT, soft-delete, marker-song picking, optional position restore. |
| `restore.mjs` | Recovery for a hard-killed run: list active rows, soft-delete given ids, optionally compact positions (`--compact --yes`, see below). |

## One edit

1. `POST /api/admin/setlist-items/insert-after { afterPosition: <row 2> }` → a blank row ("曲名確認中") at position 3.
2. `PUT /api/admin/setlist-items/<id> { songIds: [<marker>] }` → the row shows the marker song.

Marker songs are real songs that no `SetlistItemSong` has ever referenced,
so their link can't already be on the page and each run gets fresh ones.
Both saves return the new `rev`.

**Primary latency** = PUT request start → (page) marker link in the DOM /
(SDK) first applied snapshot with `rev ≥` the PUT's rev. Not seen within
`--timeout` (30 s) = **missing**. Gate: **p95 ≤ 3 s and 0 missing** over all
(edit × page) and (edit × client) pairs that no drill degrades on purpose.
The report also gives insert-start based numbers and the arrival of the
R1 notification (postgres_changes UPDATE of the row) vs the R2 broadcast
(`rev`) on the same clients.

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

## Full-scale commands (run one at a time)

From the repo root (`.env`/`.env.local` in the cwd, or `ENV_DIR=<checkout>`).
`BASE_URL` defaults to the dev preview alias; the guard refuses anything
but localhost / `opensetlist-git-dev-*.vercel.app`. Node ≥ 22.18 (type
stripping); `--no-warnings` only hides the "module type" notice for the
imported `.ts` files. If Chromium is missing: `npx playwright install chromium`.

```sh
# Main measurement: 30 pages + 470 SDK clients, 12 edits 25 s apart.
# Start the k6 burst from the other stream after the "population:" line
# (or at any point); the report's UTC timestamps align the two.
node --no-warnings tests/load/browsers/run.mjs --pages=30 --subs=470 --edits=12 --pause=25 --label=run2-main

# Drill: silent loss. 10 pages drop every postgres_changes frame from the
# last edit's insert until they show its marker (socket stays healthy);
# the 20 s ± 4 s repair poll must bring them there. Gate: max ≤ 24 s, 0 missing.
node --no-warnings tests/load/browsers/run.mjs --pages=30 --subs=470 --edits=3 --pause=25 --drill=silent-loss --drill-pages=10 --label=run2-silent-loss

# Drill: websocket blocked. 10 pages never get a socket (every attempt is
# closed before reaching Supabase) → the page's R3 fallback polls every
# 5 s ± 1 s. Gate (informational): max ≤ 7 s, 0 missing.
node --no-warnings tests/load/browsers/run.mjs --pages=30 --subs=470 --edits=3 --pause=25 --drill=ws-blocked --drill-pages=10 --label=run2-ws-blocked

# Drill: reconnect storm. Right before edit 2, every page socket and every
# SDK socket is force-closed at once (unclean close, like a network blip);
# edit 2 follows 1 s later. Reports catch-up latency and rejoin times.
# --pause=40: R1 pages fall back to 5 s polling on the socket error and
# only retry realtime after 30 s, so edit 3 then measures the recovered state.
node --no-warnings tests/load/browsers/run.mjs --pages=30 --subs=470 --edits=3 --pause=40 --drill=reconnect --drill-edit=2 --label=run2-reconnect
# The report adds "reconnect handoff: regressions after the drop": no page
# or client may show an older version across the polling → realtime
# handoff (an in-flight fallback poll landing after the catch-up).

# Drill: double save (fast correction). On edit --drill-edit (default the
# middle one) a second PUT with another marker hits the same row
# --double-gap=300 ms after the first started, without waiting for it.
# Both take the Event row lock, so the save with the higher rev is the
# final state. Gate: every page shows the final marker (and not the
# replaced one) and every SDK client applied ≥ the final rev by the end of
# the edit window, with 0 monotonicity regressions. Latency of that edit =
# final save start → final state, inside the primary gate.
node --no-warnings tests/load/browsers/run.mjs --pages=30 --subs=470 --edits=3 --pause=25 --drill=double-save --label=run2b-double-save

# Drill: lost final notification. The LAST edit's PUT notification is
# dropped on every page (websocket proxy) and every SDK client (worker
# drops its notifications) — after the insert's own notification was
# delivered and its fetches settled (--lost-settle=2000 ms), so exactly the
# last save is lost and nothing later can rescue it. Only the periodic
# repair poll (20 s ± 4 s) can deliver it. Gate: max ≤ --lost-gate=26000 ms
# (24 s + fetch/render), 0 missing. The report lists the repairing fetch
# per page (a periodic poll sends the applied rev as minRev) and the fetch
# reason that delivered the save to each SDK client (expect "periodic").
node --no-warnings tests/load/browsers/run.mjs --pages=30 --subs=470 --edits=3 --pause=25 --drill=lost-final --label=run2b-lost-final
```

`--drill` also accepts the camelCase names (`doubleSave`, `lostFinal`).
Small smoke (used to check the harness, ~1 min each, 2 rows created and
soft-deleted): `--pages=2 --subs=5 --edits=2 --pause=12 --drill=doubleSave`
/ `--drill=lostFinal`; afterwards `restore.mjs --compact --yes`.

Results: `tests/load/results/<UTC date>/<stamp>-browsers[-<drill>].md` (+ `.json`,
gitignored, with per-page raw data). Exit code 0 = gates passed.

Other flags: `--event-id`, `--event-path`, `--after-row=2`, `--timeout=30`,
`--settle=10`, `--join-timeout=120`, `--wait-pg-ready=false` (by default the
run waits until every page/client has its postgres_changes registration,
up to `--pg-ready-timeout=180` s, and reports how long that took),
`--sub-workers=N` (default ⌈subs/120⌉), `--sub-batch=50` (SDK joins per
second), `--page-concurrency=5`, `--drill-edit=k` (ignored by lost-final:
always the last edit), `--reconnect-lead=1000`, `--double-gap=300`,
`--lost-gate=26000`, `--lost-settle=2000`, `--gate-p95=3000`, `--headed`.
Exit code 1 also when a monotonicity regression was seen.

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
rehearsal**, not to this tool.
