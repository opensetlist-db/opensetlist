// Remove what the probes leave behind on dev:
//  - realtime.messages rows written by `realtime.send` from the probes
//    (payload tagged "probe": true). They would age out with the daily
//    partitions anyway; deleting them keeps the integration-test window
//    (one realtime.messages row per save) free of probe noise.
//  - reports any live SetlistItem rows with an `rt-` probe note (the admin
//    saves delete their own row; a leftover means a run died mid-save).
// Usage: ENV_DIR=<checkout with .env> node tests/load/realtime/cleanup.mjs
import { loadEnv, assertDev, pgClient } from "./lib.mjs";

loadEnv();
assertDev();

const c = pgClient();
await c.connect();
try {
  const d = await c.query(`delete from realtime.messages where payload->>'probe' = 'true' and topic like 'event:%'`);
  console.log(`deleted probe realtime.messages rows: ${d.rowCount}`);
  const si = await c.query(`select id, "eventId", position, note from "SetlistItem" where note like 'rt-%' and "isDeleted" = false`);
  if (si.rows.length) {
    console.log("live probe SetlistItem rows (delete via the admin UI/API):");
    console.table(si.rows);
  } else {
    console.log("no live probe SetlistItem rows");
  }
} finally {
  await c.end();
}
