// Apply policy.sql to the dev DB (or drop it again with --drop, used to
// run the "no policy → private join denied" control).
// Usage: ENV_DIR=<checkout with .env> node tests/load/realtime/apply-policy.mjs [--drop]
import fs from "node:fs";
import { loadEnv, assertDev, pgClient, parseArgs } from "./lib.mjs";
loadEnv();
assertDev();
const args = parseArgs(process.argv.slice(2));

(async () => {
  const c = pgClient();
  await c.connect();
  if (args.drop) {
    await c.query("DROP POLICY IF EXISTS event_broadcast_receive ON realtime.messages");
    console.log("dropped event_broadcast_receive (if it existed)");
  } else {
    await c.query(fs.readFileSync(new URL("./policy.sql", import.meta.url), "utf8"));
    console.log("applied policy.sql");
  }
  const r = await c.query("select policyname, roles, cmd, qual from pg_policies where schemaname = 'realtime'");
  console.table(r.rows);
  await c.end();
})().catch((e) => { console.error(e.message); process.exit(1); });
