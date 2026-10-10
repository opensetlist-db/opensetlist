# Realtime probes (task n14)

Node scripts that measure Supabase Realtime **broadcast** behaviour at
event scale on the **dev** project: how fast N viewers can join a
channel (public or private), what happens when they all reconnect at
once, and whether a transactional `realtime.send()` from Postgres
reaches every one of them. They decide the `private` flag for the n14
live path (wiki: `output/task-n14-live-path-broadcast.md`, section
"Private-channel admission probe").

Each simulated viewer is its own `createClient()` with its own websocket,
like a browser tab. 500 clients in one Node process work fine; the
all-at-once variants are partly client-bound (TLS handshakes on one
event loop), so treat their join times as an upper bound.

## Safety guard

Every script calls `assertDev()` (in `lib.mjs`) before it opens a socket
or a DB connection and **exits** unless both `NEXT_PUBLIC_SUPABASE_URL`
and `DATABASE_URL_UNPOOLED` contain the dev project ref
`nddawybyuedsrshhxikx`. `BASE_URL` (used for background HTTP load and
admin saves) refuses the production hostnames. Never point these at
prod, and do not use prod event ids.

## Setup

```sh
# from the repo root; .env / .env.local are gitignored, so in a worktree
# point ENV_DIR at a checkout that has them
export ENV_DIR=/path/to/checkout-with-env
```

Dependencies are only what the repo already has: `@supabase/supabase-js`,
`pg`, `dotenv`, and Node ≥ 22 (native `WebSocket`/`fetch`). The scripts
are ES modules, so they resolve packages from the repo-root
`node_modules` (`NODE_PATH` is ignored by ESM); a worktree without its
own `node_modules` needs `npm ci` or a link to one.

## Scripts

| Script | What it does |
|---|---|
| `inspect.mjs` | Read-only: RLS on `realtime.messages`, policies, `realtime.topic()`/`realtime.send()` signatures, grants. |
| `policy.sql` | The receive-only Realtime Authorization policy for `event:*` topics (what R1 would ship in `prisma/post-deploy.sql`). |
| `apply-policy.mjs` | Applies `policy.sql` to dev (`--drop` removes it again, e.g. to re-run the "no policy → denied" control). |
| `join-storm.mjs` | N clients join one channel in batches or all at once; per-client subscribe → `SUBSCRIBED` latency, `CHANNEL_ERROR`/`TIMED_OUT` counts and server error texts. `--send`: one `realtime.send` from Postgres, delivery at +1/+3/+10 s. `--neg`: forged sends must not reach private subscribers. `--spam-rps/--spam-secs`: sustained client-broadcast spam. |
| `reconnect-storm.mjs` | Holds N subscribers, then all disconnect + rejoin within `--spread` ms, `--storms` times; resubscribe latency and post-storm delivery. Optional `--load-rps` (open-loop `GET /api/setlist`) and `--admin` (one create+delete per storm via `/api/admin/*`, `ADMIN_PASSWORD`). |
| `cleanup.mjs` | Deletes the probes' `realtime.messages` rows (payload `"probe": true`) and reports any live `rt-` SetlistItem rows. Run after a session. |

Examples:

```sh
node tests/load/realtime/inspect.mjs
node tests/load/realtime/apply-policy.mjs

# the gate: 500 private joins, 100 every 2 s, then one transactional send
node tests/load/realtime/join-storm.mjs --n=500 --private --batch=100 --every=2000 --send
# all at once
node tests/load/realtime/join-storm.mjs --n=500 --private --batch=0 --send
# negative checks on a small private population
node tests/load/realtime/join-storm.mjs --n=10 --private --batch=0 --send --neg
# public comparison / broker spam
node tests/load/realtime/join-storm.mjs --n=500 --batch=100 --every=2000 --send
node tests/load/realtime/join-storm.mjs --n=500 --spam-rps=2 --spam-secs=120

# reconnect storm ×3 (BASE_URL defaults to the dev preview)
node tests/load/realtime/reconnect-storm.mjs --n=500 --storms=3 --spread=1500
node tests/load/realtime/reconnect-storm.mjs --n=30 --private --ramp-batch=5 --storms=3
```

Every run ends with a `SUMMARY {json}` line for the record.

## The gate (n14)

Private channel `event:111`, receive-only policy in place:

- 500 joins started within 10 s: subscribe → `SUBSCRIBED` **p95 ≤ 1 s,
  p99 ≤ 2 s**, every client joined **≤ 5 s** after its attempt, **zero**
  authorization timeouts / `too_many_joins`;
- the next `realtime.send(..., true)` reaches **every** joined client;
- reconnect storm: 500 connected → all reconnect within 1–2 s, ×3,
  with 50 rps snapshot load and an admin save per storm;
- negatives: a guest cannot publish on the private channel, and a
  public broadcast on the same topic name does not reach private
  subscribers.

Results and the verdict are recorded in the wiki task doc (`## Results`).

## Cautions (learned the hard way on dev)

- **Private joins hit Realtime's authorization DB pool** (size 2 on both
  projects). On dev every private join held a pool connection for
  ~0.85 s, so admission tops out around 3 joins/s and larger storms turn
  into `TIMED_OUT` + `IncreaseConnectionPool: Please increase your
  connection pool size`. Supabase's authorization circuit breaker can
  trip on repeated timeouts, so keep private runs small and bounded once
  the failure is visible; don't loop them.
- **`--load-rps` goes through the real app and the Supavisor pooler.**
  50 rps of uncached `/api/setlist` against the dev preview exhausted the
  pooler's 200 client connections (`EMAXCONN`), and the preview returned
  500 for ~5 minutes after the load stopped, until idle function
  instances released their connections. Watch the pooler and keep load
  runs short.
- Clean up: `realtime.send` rows land in `realtime.messages` (daily
  partitions, auto-pruned). The probes tag their payloads with
  `"probe": true`; `cleanup.mjs` deletes them by that tag. Admin saves
  delete the row they create.
