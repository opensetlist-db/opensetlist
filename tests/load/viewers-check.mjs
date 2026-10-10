// Post-run check for viewers.js (n14 run #2), dev DB only.
//
// viewers.js deletes every reaction it creates through the app's own
// DELETE route and soft-deletes every setlist row through the admin
// API. This script verifies that from the database side, because a
// POST that timed out on the client may still have committed (the k6
// report can only say "possibly left"):
//
//   - live SetlistItemReaction rows whose anonId starts with `n14run2-`
//     (the prefix only viewers.js uses). `--delete` removes exactly
//     those rows — scoped to the prefix, nothing else.
//   - live SetlistItem rows carrying viewers.js's note, and the live
//     row count of the event (EVENT_ID, default 111). Setlist rows are
//     only reported: remove a leftover through the admin API/UI so the
//     revision bump and cache purge happen.
//
// Usage: node tests/load/viewers-check.mjs [--delete] [--event=111]
// (ENV_DIR=<checkout with .env> when this worktree has no .env.)
import { loadEnv, assertDev, pgClient, parseArgs } from "./realtime/lib.mjs";
import { NOTE, ANON_PREFIX } from "./lib/constants.js";

const ANON_LIKE = `${ANON_PREFIX}%`;

loadEnv();
assertDev();

const args = parseArgs(process.argv.slice(2));
const eventId = String(args.event ?? process.env.EVENT_ID ?? "111");
if (!/^\d+$/.test(eventId)) {
  console.error("--event must be a numeric event id");
  process.exit(2);
}

const c = pgClient();
await c.connect();
try {
  const rx = await c.query(
    `select id, "setlistItemId"::text as item, "reactionType", "anonId", "createdAt"
       from "SetlistItemReaction" where "anonId" like $1 order by "createdAt"`,
    [ANON_LIKE],
  );
  console.log(`${ANON_PREFIX} reactions still present: ${rx.rows.length}`);
  if (rx.rows.length) {
    console.table(rx.rows.slice(0, 20));
    if (args.delete) {
      const d = await c.query(`delete from "SetlistItemReaction" where "anonId" like $1`, [ANON_LIKE]);
      console.log(`deleted ${d.rowCount} n14run2 reactions`);
    } else {
      console.log("re-run with --delete to remove them");
    }
  }

  const si = await c.query(
    `select id::text, position, "isDeleted" from "SetlistItem"
      where "eventId" = $1 and note = $2 and "isDeleted" = false`,
    [eventId, NOTE],
  );
  console.log(`live viewers.js setlist rows on event ${eventId}: ${si.rows.length}`);
  if (si.rows.length) console.table(si.rows);

  const live = await c.query(
    `select count(*)::int as n from "SetlistItem" where "eventId" = $1 and "isDeleted" = false`,
    [eventId],
  );
  const ev = await c.query(`select status, "setlistRevision"::text as rev from "Event" where id = $1`, [eventId]);
  console.log(
    `event ${eventId}: ${live.rows[0].n} live rows, status ${ev.rows[0]?.status}, setlistRevision ${ev.rows[0]?.rev}`,
  );
} finally {
  await c.end();
}
