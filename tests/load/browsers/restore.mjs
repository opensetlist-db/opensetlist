// Recovery for the browsers run (dev only): soft-delete leftover marker
// rows and compact the event's positions back to 1..N.
//
// run.mjs normally does both itself (and restores the exact recorded
// positions). This is for a run that was killed hard (no SIGINT
// handler ran) or whose restore was skipped. It:
//
//   1. prints the event's active rows (id@position); a leftover marker
//      row is the one the run log / report names. Pass
//      `--delete=<id,id,...>` to soft-delete specific rows through the
//      admin API (only ids that are active rows of the event);
//   2. with `--compact --yes`: in one transaction holding the Event row
//      lock (same as every admin writer), renumbers active rows by
//      `dense_rank()` over their current position — order is kept and
//      rumoured siblings sharing a position keep sharing it — then
//      publishes the change with one no-op re-delete of an
//      already-deleted row of the event (bumps the revision, broadcasts,
//      purges the snapshot cache).
//
// Usage:
//   node tests/load/browsers/restore.mjs                      # report only
//   node tests/load/browsers/restore.mjs --delete=1532,1533
//   node tests/load/browsers/restore.mjs --compact --yes
import { loadEnv, assertDev, parseArgs, pgClient } from "../realtime/lib.mjs";
import { adminLogin, softDelete, activeRows } from "./admin.mjs";

loadEnv();
process.env.BASE_URL = process.env.BASE_URL || "https://opensetlist-git-dev-opensetlist-projects.vercel.app";
assertDev({ requireBase: true });
const args = parseArgs(process.argv.slice(2));
const BASE = process.env.BASE_URL.replace(/\/$/, "");
const EVENT_ID = String(args["event-id"] ?? "111");

const pg = pgClient();
await pg.connect();
try {
  const rows = await activeRows(pg, EVENT_ID);
  console.log(`event ${EVENT_ID}: ${rows.length} active rows: ${rows.map((r) => `${r.id}@${r.position}`).join(" ")}`);

  let cookie = null;
  if (args.delete) {
    cookie = await adminLogin(BASE);
    for (const id of String(args.delete).split(",").filter(Boolean)) {
      if (!rows.some((r) => r.id === id)) { console.log(`  ${id}: not an active row of event ${EVENT_ID}, skipped`); continue; }
      const r = await softDelete({ base: BASE, cookie, id });
      console.log(`  deleted ${id} (rev ${r.rev})`);
    }
  }

  if (args.compact) {
    if (!args.yes) {
      console.log("--compact needs --yes (it rewrites positions of every active row of the event)");
      process.exit(2);
    }
    await pg.query("begin");
    await pg.query(`select id from "Event" where id = $1 for update`, [EVENT_ID]);
    const plan = await pg.query(
      `select id::text as id, position, dense_rank() over (order by position)::int as target
         from "SetlistItem" where "eventId" = $1 and "isDeleted" = false`,
      [EVENT_ID],
    );
    const moved = plan.rows.filter((r) => Number(r.position) !== r.target);
    if (moved.length) {
      const ids = moved.map((r) => r.id);
      await pg.query(`update "SetlistItem" set position = position + 1000000 where id = any($1::bigint[]) and "eventId" = $2`, [ids, EVENT_ID]);
      await pg.query(
        `update "SetlistItem" si set position = v.pos from unnest($1::bigint[], $2::int[]) as v(id, pos) where si.id = v.id and si."eventId" = $3`,
        [ids, moved.map((r) => r.target), EVENT_ID],
      );
    }
    await pg.query("commit");
    console.log(`compacted: ${moved.length} rows moved`);
    if (moved.length) {
      const del = await pg.query(`select id::text as id from "SetlistItem" where "eventId" = $1 and "isDeleted" = true order by id desc limit 1`, [EVENT_ID]);
      if (del.rows.length) {
        cookie ||= await adminLogin(BASE);
        const r = await softDelete({ base: BASE, cookie, id: del.rows[0].id });
        console.log(`published via no-op re-delete of ${del.rows[0].id} (rev ${r.rev})`);
      } else {
        console.log("no deleted row to publish through — the snapshot cache keeps old positions until the next save");
      }
    }
    const after = await activeRows(pg, EVENT_ID);
    console.log(`after: ${after.map((r) => `${r.id}@${r.position}`).join(" ")}`);
  }
} catch (e) {
  try { await pg.query("rollback"); } catch { /* not in a transaction */ }
  console.error(e.message);
  process.exitCode = 1;
} finally {
  await pg.end();
}
