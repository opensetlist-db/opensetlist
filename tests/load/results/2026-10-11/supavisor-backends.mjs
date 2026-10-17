// One-off side-car for the first Small control run (dev only).
//
// Question it answers: once the Supavisor client cap (400 on Small) is no
// longer the wall, is Supavisor's *backend* pool (default pool size 15,
// unchanged by the compute resize) the next one? Every second it reads
// pg_stat_activity over one held session (DATABASE_URL_UNPOOLED) and
// writes one CSV row about the backends Supavisor opened
// (application_name LIKE 'Supavisor%', the sampler's own backend
// excluded by pid — DATABASE_URL_UNPOOLED goes through the session
// pooler here, so this session is itself a Supavisor backend):
//   active / idle in transaction / idle / other counts, auth_query count,
//   the oldest open transaction age (max now() - xact_start) and the
//   longest-running active statement (max now() - query_start) among
//   them, the count waiting on Lock or LWLock, and the wait events seen.
//
// Stops on the same STOP file as pooler-clients.mjs (newer than start) or
// after --max-minutes (default 90). Usage, from the repo root:
//   node tests/load/results/2026-10-11/supavisor-backends.mjs [--interval=1]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { loadEnv, assertDev, parseArgs, DEV_REF } from "../../realtime/lib.mjs";

loadEnv();
assertDev();

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = parseArgs(process.argv.slice(2));
const intervalMs = Math.max(250, (parseFloat(args.interval ?? "1") || 1) * 1000);
const maxMs = (parseFloat(args["max-minutes"] ?? "90") || 90) * 60_000;
const startedAt = Date.now();
const outDir = args["out-dir"] ?? HERE;
const stopFile = args["stop-file"] ?? path.join(outDir, "run2b.STOP");
const stamp = new Date(startedAt).toISOString().replace(/[:.]/g, "-");
fs.mkdirSync(outDir, { recursive: true });
const csvFile = path.join(outDir, `${stamp}-supavisor-backends.csv`);

function plainPgUrl(raw) {
  const u = new URL(raw);
  for (const k of [...u.searchParams.keys()]) if (k !== "sslmode") u.searchParams.delete(k);
  return u.toString();
}

const SQL = `
  select count(*) filter (where state = 'active')::int as active,
         count(*) filter (where state like 'idle in transaction%')::int as idle_tx,
         count(*) filter (where state = 'idle')::int as idle,
         count(*) filter (where state is null or (state <> 'active' and state <> 'idle' and state not like 'idle in transaction%'))::int as other,
         count(*) filter (where application_name = 'Supavisor (auth_query)')::int as auth_query,
         coalesce(round(extract(epoch from max(now() - xact_start)) * 1000), 0)::int as max_xact_ms,
         coalesce(round(extract(epoch from max(now() - query_start) filter (where state = 'active')) * 1000), 0)::int as max_active_ms,
         count(*) filter (where wait_event_type in ('Lock', 'LWLock'))::int as lock_waits,
         coalesce(string_agg(distinct wait_event_type || ':' || wait_event, '|') filter (where state <> 'idle' and wait_event is not null), '') as waits
    from pg_stat_activity
   where backend_type = 'client backend'
     and application_name like 'Supavisor%'
     and pid <> pg_backend_pid()`;

let session = null;
async function sample() {
  if (!session) {
    session = new pg.Client({ connectionString: plainPgUrl(process.env.DATABASE_URL_UNPOOLED), connectionTimeoutMillis: 10_000, application_name: "n14-supavisor-backends" });
    session.on("error", () => { session = null; });
    await session.connect();
  }
  try {
    return (await session.query(SQL)).rows[0];
  } catch (e) {
    const s = session; session = null; await s?.end().catch(() => {});
    throw e;
  }
}

const q = (s) => `"${String(s).replace(/"/g, '""')}"`;
fs.writeFileSync(csvFile,
  `# supavisor-backends sampler, dev project ${DEV_REF}, started ${new Date(startedAt).toISOString()}, interval ${intervalMs} ms, own backend excluded\n` +
  `ts,total,active,idle_in_tx,idle,other,auth_query,max_xact_ms,max_active_ms,lock_waits,waits,error\n`);

const peak = { active: 0, idle_tx: 0, total: 0, max_xact_ms: 0, lock_waits: 0, samples: 0, errors: 0 };
let stopping = null;
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => { stopping = sig; });
let next = Date.now();
while (!stopping) {
  try { if (fs.statSync(stopFile).mtimeMs >= startedAt) { stopping = "STOP file"; break; } } catch { /* none yet */ }
  if (Date.now() - startedAt >= maxMs) { stopping = "max-minutes"; break; }
  const ts = new Date().toISOString();
  try {
    const r = await Promise.race([sample(), new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), intervalMs * 3))]);
    const total = r.active + r.idle_tx + r.idle + r.other;
    fs.appendFileSync(csvFile, [ts, total, r.active, r.idle_tx, r.idle, r.other, r.auth_query, r.max_xact_ms, r.max_active_ms, r.lock_waits, q(r.waits), ""].join(",") + "\n");
    peak.active = Math.max(peak.active, r.active); peak.idle_tx = Math.max(peak.idle_tx, r.idle_tx);
    peak.total = Math.max(peak.total, total); peak.max_xact_ms = Math.max(peak.max_xact_ms, r.max_xact_ms);
    peak.lock_waits = Math.max(peak.lock_waits, r.lock_waits);
  } catch (e) {
    peak.errors++;
    fs.appendFileSync(csvFile, [ts, "", "", "", "", "", "", "", "", "", "", q(String(e.message).slice(0, 80))].join(",") + "\n");
  }
  peak.samples++;
  next += intervalMs;
  while (next <= Date.now()) next += intervalMs;
  await new Promise((res) => setTimeout(res, next - Date.now()));
}
const line = `# end ${new Date().toISOString()} (${stopping}): ${peak.samples} samples, ${peak.errors} errors; peak total ${peak.total}, active ${peak.active}, idle-in-tx ${peak.idle_tx}, max xact age ${peak.max_xact_ms} ms, lock waits ${peak.lock_waits}`;
fs.appendFileSync(csvFile, line + "\n");
console.log(line);
await session?.end().catch(() => {});
process.exit(0);
