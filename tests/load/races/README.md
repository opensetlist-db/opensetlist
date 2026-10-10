# Cache races on the dev preview (task n14, run #2)

Node scripts that drive the **deployed dev preview** and the **dev
database** to check the n14 live path where the integration suite
(`src/__tests__/integration/n14-live-path.test.ts`) cannot: with the real
Vercel Data Cache, several function instances and real `revalidateTag`
propagation. Spec: wiki `output/task-n14-live-path-broadcast.md`, "Run #2",
third bullet.

The invariant every race checks: **a client that applies snapshots with
the `(rev, capturedAt)` acceptance rule and asks `?minRev=<its rev + 1>`
after a notification converges to the committed state within its repair
period (≤ 24 s) and never applies a snapshot that goes backwards.** Some
races also check the stricter targets the 3 s freshness requirement rests
on (stale-after-purge ≤ the 2 s TTL, `minRev` answered on the first try).
Race 5 and the race 4 replay use the app's own `SnapshotAcceptance`
(imported from `src/lib/snapshotAcceptance.ts`; Node ≥ 22.6 strips the
types), not a copy.

## Commands

From the repo root (`.env` / `.env.local` must be there, or set
`ENV_DIR` to a checkout that has them; a worktree without
`node_modules` resolves the packages from the parent checkout's):

```sh
export BASE_URL=https://opensetlist-git-dev-opensetlist-projects.vercel.app

# full run (the orchestrator's command, ~10 min, run ALONE — no other
# load stream or operator on event 111 at the same time)
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON tests/load/races/races.mjs --race=all --scale=full

# smoke (~2.5 min)
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON tests/load/races/races.mjs --race=all --scale=smoke

# a subset
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON tests/load/races/races.mjs --race=1,2 --scale=full

# after a crash: soft-delete leftover rows (note `n14-races*`) and drop
# leftover throwaway events (slug `n14-races-status-*`)
node tests/load/races/races.mjs --race=cleanup
```

Flags: `--scale=smoke|full` (presets at the top of `races.mjs`),
`--out=<dir>` (default `tests/load/results/<UTC date>/`),
`--r4-conns=<n>` / `--r4-secs=<s>` (race 4 pool starvation, see below).
The `--disable-warning` flag only silences Node's "module type not
specified" notice for the `.ts` import.

Output: `tests/load/results/<UTC date>/<stamp>-races.md` (committed) and
`…-races.json` (raw, gitignored). The header line "Foreign saves on event
111" counts revisions this run did not produce — if it is not 0, somebody
else wrote to the event during the run and the timings are contaminated;
re-run alone. Exit code 3 = event 111 did not end at its starting row
count or a row of this tool is still live.

## Safety

- `assertDev({ requireBase: true })` from `../realtime/lib.mjs`
  (Supabase URL + `DATABASE_URL_UNPOOLED` must be the dev project,
  `BASE_URL` must be localhost or the `opensetlist-git-dev-*` alias) plus
  the same field-level check on `DATABASE_URL`, which race 4 uses.
- Event **111** is hard-coded. One scratch row is appended after the last
  position (admin `POST`); every "save" a race needs is an admin `PUT` on
  that row (a real setlist writer: lock → bump `setlistRevision` →
  `realtime.send` → commit → expire `event:111`). The 23 existing rows are
  never touched. The scratch row is soft-deleted at the end, also on
  Ctrl-C; the run checks the visible row count before and after.
- Race 6 inserts one throwaway `Event` directly with pg (slug
  `n14-races-status-<ts>`, no translations, no rows) and hard-deletes it.
- The admin password is read from `.env` and never printed. One login per
  run (the Firewall rate-limits `/api/admin/login` per IP).

## Races

| # | `--race=` | What it does | PASS when |
|---|---|---|---|
| 1 | `1` | Commit during an in-flight build: save (purge, cold) → burst of N parallel ja GETs and, `delay` ms in, a save. Then either poll without `minRev` for P s, or fire `minRev=<new rev>` at the ack. Records rev / capturedAt / servedAt / source / x-vercel-id per response. | no response SENT > 2 s after the ack is older than the save; `minRev` at the ack returns the new rev first try; converged by the end |
| 2 | `2` | Notification before the tag purge: warm the ja entry, save, then K parallel `minRev=<new rev>` at ack + 0/50/100/200/500 ms, on receipt of the save's Realtime broadcast (public `event:111`), and for two back-to-back saves (the 1 s revision memo). | no response below the requested (committed) revision |
| 3 | `3` | Sparse locale: warm `en`, idle past the TTL, save, then one `en` with `minRev` and one without (and the reverse order, informative); latency vs a warm ja hit. | both at the new rev |
| 4 | `4` | Failed regeneration, approximated by starving the 6543 transaction pool with `--r4-conns` × `pg_sleep(--r4-secs)` (warm cache, then purged cache), 1 rps open-loop requests during and after. A pre-connected probe `SELECT 1` must queue ≥ half the sleep, else the race reports "not saturated". | pool saturated; nothing applied backwards (per-stream replay); converged after release. 5xx / slow hits are documented as findings |
| 5 | `5` | Stale response arriving last: A (cold en build, no minRev), save, B (`minRev`) at the ack; A's delivery throttled 0/400/900/1500 ms (a slow downlink — the server-side content is real); both replayed in arrival order through `SnapshotAcceptance`. | every trial ends at the committed rev, nothing applied backwards, and ≥ 1 trial really had the stale A arrive last and rejected |
| 6 | `6` | Status boundary without a write: throwaway event `scheduled`, startTime = now + 30 s; poll `/api/setlist` every 1 s and the SSR page every 2 s across the boundary. | API `upcoming` before / `ongoing` after (±1 s skew) with a constant rev, at least one `ongoing` response from a snapshot captured before startTime (no rebuild needed); SSR `isOngoing` flips |

Notes on the measurements:

- `x-vercel-id` is per request (`<edge>::<region>::<id>`), not per
  function instance. Instance ids only exist in the
  `[liveSnapshot] build … instance=<id>` log lines; pull the Vercel
  runtime logs for the run's window to attribute builds to instances.
- `servedAt` is the function's clock and `capturedAt` the database's; the
  scripts compare them only with each other, never with the generator's
  clock.
- Prisma stores `DateTime` as `timestamp without time zone` in UTC;
  `lib.mjs` makes node-pg parse that type as UTC (its default is local
  time, which shifted race 6 by the laptop's −7 h in the first smoke).
- Race 4's pool size: on 2026-10-10, 15 sleepers did not saturate the
  dev transaction pool (a 16th query ran at once); with 25 only ~17 were
  active server-side and further queries queued. Hence the default of 22.
  If the race reports "not saturated", raise `--r4-conns`.
