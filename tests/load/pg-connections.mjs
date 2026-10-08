// n12 side-car: sample Postgres backend connections during a k6 run.
//
// Run in a second terminal for the length of the run:
//
//   node tests/load/pg-connections.mjs [intervalSeconds=5]
//
// Writes tests/load/results/<date>/<stamp>-pg-connections.csv and
// prints the running peak. Ctrl+C to stop.
//
// What this does and does NOT measure: pg_stat_activity counts
// *backend* connections — Supavisor's server-side pool into Postgres.
// The n12 gate is on *pooler client* connections (Vercel function
// instances → Supavisor), which only the Supabase dashboard shows
// (Database → Connections / Reports). The two diverge under load:
// thousands of pooler clients can multiplex onto a few dozen backends
// in transaction mode. Keep this CSV as the DB-side view and read the
// gate number off the dashboard.
//
// Connects with DATABASE_URL_UNPOOLED (direct / session pooler) from
// .env so the sampler itself doesn't occupy a transaction-pooler slot.
// .env must point at the dev DB (CLAUDE.md hard rule) — this script
// never writes, but run it against the same DB the k6 target uses.

import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const intervalMs = (parseFloat(process.argv[2] ?? "5") || 5) * 1000;
const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL_UNPOOLED (or DATABASE_URL) is not set");
  process.exit(1);
}

const now = new Date();
const dir = path.join("tests", "load", "results", now.toISOString().slice(0, 10));
fs.mkdirSync(dir, { recursive: true });
const file = path.join(dir, `${now.toISOString().replace(/[:.]/g, "-")}-pg-connections.csv`);
fs.writeFileSync(file, "ts,total,active,idle,idle_in_tx,other,max_connections\n");

const client = new pg.Client({ connectionString: url });
await client.connect();
const { rows: maxRows } = await client.query("show max_connections");
const maxConnections = Number(maxRows[0].max_connections);

let peak = 0;
async function sample() {
  // Client backends on this database only — excludes autovacuum,
  // walsender, Supabase's own background workers on other DBs.
  const { rows } = await client.query(`
    select coalesce(state, 'null') as state, count(*)::int as n
    from pg_stat_activity
    where datname = current_database() and backend_type = 'client backend'
    group by 1`);
  const by = Object.fromEntries(rows.map((r) => [r.state, r.n]));
  const total = rows.reduce((s, r) => s + r.n, 0);
  const active = by.active ?? 0;
  const idle = by.idle ?? 0;
  const idleTx = by["idle in transaction"] ?? 0;
  const other = total - active - idle - idleTx;
  peak = Math.max(peak, total);
  fs.appendFileSync(
    file,
    `${new Date().toISOString()},${total},${active},${idle},${idleTx},${other},${maxConnections}\n`,
  );
  process.stdout.write(
    `\r${new Date().toISOString()}  total=${total} active=${active} idle=${idle} peak=${peak}/${maxConnections}   `,
  );
}

const timer = setInterval(() => {
  sample().catch((e) => console.error("\nsample failed:", e.message));
}, intervalMs);
await sample();

process.on("SIGINT", async () => {
  clearInterval(timer);
  await client.end().catch(() => {});
  console.log(`\npeak backends ${peak}/${maxConnections} → ${file}`);
  process.exit(0);
});
