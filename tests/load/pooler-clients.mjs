// Pooler-client sampler for load runs on the dev project (dev only).
//
// Why this exists: the gate that failed the 500-viewer burst is the
// Supavisor *client* cap (200 on Micro, 400 on Small) — every Vercel
// function instance's Prisma pool is a set of pooler clients. Neither
// tool we had shows that number: the Supabase dashboard chart ("Shared
// Pooler client connections") has never loaded during a run, and
// `pg_stat_activity` (pg-connections.mjs) only sees Postgres *backends*,
// i.e. Supavisor's own server-side pool, which multiplexes many clients
// onto ~15 backends. So every `--interval` seconds (default 2) this
// writes ONE CSV row with three independent readings:
//
//   (a) metrics — Supabase's Prometheus endpoint
//       `https://<ref>.supabase.co/customer/v1/privileged/metrics`
//       (HTTP basic auth: user `service_role`, password = the service-role
//       / secret API key). On the first fetch every metric name that
//       mentions supavisor / pooler / pgbouncer / client is written to
//       `<stamp>-pooler-metrics.txt` and the client- and backend-
//       connection gauges are picked from them (override with
//       `--metrics=name1,name2`). If the key is not in the env, or the
//       endpoint answers non-200, or no such metric exists, the CSV header
//       says so and the metric columns stay empty — (b) and (c) still run.
//   (b) backends — `pg_stat_activity` client backends grouped by state and
//       `application_name`, over one session held for the whole run
//       (DATABASE_URL_UNPOOLED). Supavisor's backends show up here; this
//       is the "is the 15-backend pool itself the wall?" view.
//   (c) probe — a fresh connection through the TRANSACTION pooler
//       (DATABASE_URL, the URL the app uses) + `select 1`, then closed.
//       When the client cap is reached Supavisor refuses it with
//       `EMAXCONN`, exactly like the app's own connections; in run #2 the
//       orchestrator's one-off connection failing that way was the only
//       evidence that the peak reached 200. `--no-probe` turns it off.
//
// Its own footprint: (b) holds one client for the whole run and (c) holds
// one for a few hundred ms every interval. Both connect with
// application_name `n14-pooler-sampler`; the `ours` column counts those
// backends, but only a DIRECT DATABASE_URL_UNPOOLED keeps that name —
// through the session pooler the backend is Supavisor's and shows up as
// `Supavisor`, so `ours` is 0 there and the sampler's 1–2 clients are
// simply part of the count.
//
// Lifetime: stops when the STOP file appears (default
// `tests/load/results/<UTC date>/run2b.STOP`; a STOP file older than the
// sampler's start is ignored, so a leftover from the previous run does not
// stop the next one) or after `--max-minutes` (default 90, a safety net
// for a forgotten sampler). It is meant to be launched DETACHED so it
// outlives the shell that started it — see tests/load/README.md for the
// PowerShell `Start-Process` line.
//
// Usage: node tests/load/pooler-clients.mjs [--interval=2] [--seconds=N]
//          [--max-minutes=90] [--stop-file=<path>] [--metrics=a,b] [--no-probe]
// (ENV_DIR=<checkout with .env> when the cwd has no .env.)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { loadEnv, assertDev, isDevDatabaseUrl, parseArgs, DEV_REF } from "./realtime/lib.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP_NAME = "n14-pooler-sampler";

loadEnv();
assertDev();

const args = parseArgs(process.argv.slice(2));
const intervalMs = Math.max(500, (parseFloat(args.interval ?? "2") || 2) * 1000);
// --seconds: a bounded run (smoke tests); otherwise STOP file / max-minutes.
const runForMs = args.seconds ? parseFloat(args.seconds) * 1000 : null;
const maxMs = (parseFloat(args["max-minutes"] ?? "90") || 90) * 60_000;
const startedAt = Date.now();
const day = new Date(startedAt).toISOString().slice(0, 10);
const outDir = args["out-dir"] ?? path.join(HERE, "results", day);
const stopFile = args["stop-file"] ?? path.join(outDir, "run2b.STOP");
fs.mkdirSync(outDir, { recursive: true });
const stamp = new Date(startedAt).toISOString().replace(/[:.]/g, "-");
const csvFile = path.join(outDir, `${stamp}-pooler-clients.csv`);
const namesFile = path.join(outDir, `${stamp}-pooler-metrics.txt`);

// The probe goes through the app's own transaction-pooler URL, so it must
// pass the same dev check as DATABASE_URL_UNPOOLED does in assertDev().
const probeOn = !args["no-probe"];
if (probeOn && !isDevDatabaseUrl(process.env.DATABASE_URL || "")) {
  console.error(`refusing: DATABASE_URL is not the dev project (${DEV_REF}); use --no-probe to skip the pooler probe`);
  process.exit(2);
}

// Prisma-style query params (`pgbouncer=true`, `connection_limit=1`) mean
// nothing to node-postgres; strip everything but sslmode so they can never
// be forwarded as startup parameters.
function plainPgUrl(raw) {
  const u = new URL(raw);
  for (const k of [...u.searchParams.keys()]) if (k !== "sslmode") u.searchParams.delete(k);
  return u.toString();
}

// ── (a) Prometheus metrics ─────────────────────────────────────────
const KEY_VARS = ["SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SECRET_KEY", "SERVICE_ROLE_KEY"];
const keyVar = KEY_VARS.find((k) => process.env[k]);
const metricsUrl = `${new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).origin}/customer/v1/privileged/metrics`;
const INTERESTING = /supavisor|pooler|pgbouncer|client/i;

// Prometheus text exposition: `name{l1="v",...} value [ts]` or `name value`.
function parsePrometheus(text) {
  const out = [];
  for (const line of text.split("\n")) {
    if (!line || line.startsWith("#")) continue;
    const m = /^([a-zA-Z_:][a-zA-Z0-9_:]*)(\{(.*)\})?\s+(\S+)/.exec(line);
    if (!m) continue;
    const labels = {};
    if (m[3]) for (const l of m[3].matchAll(/([a-zA-Z_][a-zA-Z0-9_]*)="((?:[^"\\]|\\.)*)"/g)) labels[l[1]] = l[2];
    const value = Number(m[4]);
    if (Number.isFinite(value)) out.push({ name: m[1], labels, value });
  }
  return out;
}

async function fetchMetrics() {
  const auth = Buffer.from(`service_role:${process.env[keyVar]}`).toString("base64");
  const res = await fetch(metricsUrl, { headers: { authorization: `Basic ${auth}` }, signal: AbortSignal.timeout(10_000) });
  const text = await res.text();
  return { status: res.status, series: res.ok ? parsePrometheus(text) : [] };
}

// Per metric name: the sum over its series. When a series carries the
// project ref in any label (a multi-tenant exporter), only those series
// count — another tenant's clients are not ours.
function sumByName(series, names) {
  const out = {};
  for (const name of names) {
    const rows = series.filter((s) => s.name === name);
    const mine = rows.filter((s) => Object.values(s.labels).some((v) => v.includes(DEV_REF)));
    out[name] = rows.length ? (mine.length ? mine : rows).reduce((a, s) => a + s.value, 0) : null;
  }
  return out;
}

let metricNames = []; // the columns, fixed after the first fetch
let metricsNote;
if (!keyVar) {
  // Still find out whether the endpoint exists, without credentials.
  let probe = "unreachable";
  try {
    const r = await fetch(metricsUrl, { signal: AbortSignal.timeout(10_000) });
    probe = `HTTP ${r.status} without a key`;
  } catch (e) {
    probe = `unreachable (${e.message})`;
  }
  metricsNote = `unavailable: no service-role key in the env (${KEY_VARS.join(" / ")}); endpoint ${probe}; fallback = backends + probe only`;
} else {
  try {
    const first = await fetchMetrics();
    if (first.status !== 200) {
      metricsNote = `unavailable: endpoint answered HTTP ${first.status} with ${keyVar}; fallback = backends + probe only`;
    } else {
      const all = [...new Set(first.series.map((s) => s.name))].sort();
      const hits = all.filter((n) => INTERESTING.test(n));
      fs.writeFileSync(namesFile, `# ${metricsUrl} at ${new Date().toISOString()}: ${all.length} metric names, ${hits.length} matching ${INTERESTING}\n${hits.join("\n")}\n`);
      console.log(`metrics endpoint OK: ${all.length} names; matching ${INTERESTING}:\n  ${hits.join("\n  ") || "(none)"}`);
      if (args.metrics) {
        metricNames = String(args.metrics).split(",").map((s) => s.trim()).filter((n) => all.includes(n));
      } else {
        // Client gauges first, then backend/server gauges, plus Postgres'
        // own backend count for cross-checking (b).
        const pool = (n) => /supavisor|pooler|pgbouncer/i.test(n);
        const clients = hits.filter((n) => pool(n) && /client/i.test(n) && /conn/i.test(n));
        const servers = hits.filter((n) => pool(n) && /(server|backend|db)/i.test(n) && /conn/i.test(n));
        metricNames = [...new Set([...clients, ...servers, ...all.filter((n) => n === "pg_stat_database_num_backends")])];
      }
      metricsNote = metricNames.length
        ? `ok: sampling ${metricNames.join(", ")} (all matching names in ${path.basename(namesFile)})`
        : `endpoint ok but no supavisor/pooler client-connection metric (names in ${path.basename(namesFile)}); fallback = backends + probe only`;
    }
  } catch (e) {
    metricsNote = `unavailable: ${e.message}; fallback = backends + probe only`;
  }
}

// ── (b) backends ───────────────────────────────────────────────────
let session = null;
async function backendSample() {
  if (!session) {
    session = new pg.Client({
      connectionString: plainPgUrl(process.env.DATABASE_URL_UNPOOLED),
      connectionTimeoutMillis: 10_000,
      application_name: APP_NAME,
    });
    session.on("error", () => { session = null; });
    await session.connect();
  }
  try {
    const { rows } = await session.query(`
      select coalesce(nullif(application_name, ''), '-') as app, coalesce(state, 'null') as state, count(*)::int as n
        from pg_stat_activity
       where backend_type = 'client backend'
       group by 1, 2
       order by 3 desc`);
    return rows;
  } catch (e) {
    const s = session;
    session = null;
    await s?.end().catch(() => {});
    throw e;
  }
}

// ── (c) transaction-pooler probe ───────────────────────────────────
async function probe() {
  const t = Date.now();
  const c = new pg.Client({ connectionString: plainPgUrl(process.env.DATABASE_URL), connectionTimeoutMillis: 5_000, application_name: APP_NAME });
  c.on("error", () => {});
  try {
    await c.connect();
    await c.query("select 1");
    return { ms: Date.now() - t, result: "ok" };
  } catch (e) {
    const msg = String(e.message || e);
    return { ms: Date.now() - t, result: /EMAXCONN/.test(msg) ? "EMAXCONN" : msg.replace(/[,\n\r"]/g, " ").slice(0, 60) };
  } finally {
    await c.end().catch(() => {});
  }
}

// ── loop ───────────────────────────────────────────────────────────
const withTimeout = (p, ms, what) =>
  Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`${what} timed out after ${ms} ms`)), ms))]);
const csvQuote = (s) => `"${String(s).replace(/"/g, '""')}"`;
const metricCols = metricNames.map((n) => `m_${n}`);

fs.writeFileSync(
  csvFile,
  [
    `# pooler-clients sampler, dev project ${DEV_REF}, started ${new Date(startedAt).toISOString()}, pid ${process.pid}, interval ${intervalMs} ms`,
    `# metrics (${metricsUrl}): ${metricsNote}`,
    `# backends: pg_stat_activity client backends via DATABASE_URL_UNPOOLED (one held session, application_name ${APP_NAME})`,
    `# probe: ${probeOn ? "fresh connection through DATABASE_URL (transaction pooler) + select 1 each interval" : "off"}`,
    `# stop: ${stopFile} (newer than start) or ${runForMs ? `${runForMs / 1000} s` : `${maxMs / 60000} min`}`,
    ["ts", ...metricCols, "backends_total", "active", "idle", "idle_in_tx", "other", "ours", "probe_ms", "probe_result", "by_app_state", "errors"].join(","),
  ].join("\n") + "\n",
);
console.log(`metrics: ${metricsNote}`);
console.log(`writing ${csvFile}; stop with ${stopFile}`);

const peak = { backends: 0, metric: {}, probeFails: 0, emaxconn: 0, samples: 0 };

async function sampleOnce() {
  const ts = new Date().toISOString();
  const [m, b, p] = await Promise.allSettled([
    metricNames.length ? withTimeout(fetchMetrics(), intervalMs * 3, "metrics") : Promise.resolve(null),
    withTimeout(backendSample(), intervalMs * 3, "backends"),
    probeOn ? withTimeout(probe(), 8_000, "probe") : Promise.resolve(null),
  ]);
  const errors = [];
  let mv = {};
  if (m.status === "fulfilled" && m.value) {
    if (m.value.status === 200) mv = sumByName(m.value.series, metricNames);
    else errors.push(`metrics HTTP ${m.value.status}`);
  } else if (m.status === "rejected") errors.push(`metrics: ${m.reason.message}`);
  let total = "", active = "", idle = "", idleTx = "", other = "", ours = "", byApp = "";
  if (b.status === "fulfilled") {
    const rows = b.value;
    const sum = (f) => rows.filter(f).reduce((a, r) => a + r.n, 0);
    total = sum(() => true);
    active = sum((r) => r.state === "active");
    idle = sum((r) => r.state === "idle");
    idleTx = sum((r) => r.state.startsWith("idle in transaction"));
    other = total - active - idle - idleTx;
    ours = sum((r) => r.app === APP_NAME);
    byApp = rows.map((r) => `${r.app}/${r.state}:${r.n}`).join("|");
    peak.backends = Math.max(peak.backends, total);
  } else errors.push(`backends: ${b.reason.message}`);
  let probeMs = "", probeResult = "";
  if (p.status === "fulfilled" && p.value) {
    probeMs = p.value.ms;
    probeResult = p.value.result;
    if (probeResult !== "ok") peak.probeFails++;
    if (probeResult === "EMAXCONN") peak.emaxconn++;
  } else if (p.status === "rejected") {
    probeResult = "timeout";
    peak.probeFails++;
  }
  for (const [k, v] of Object.entries(mv)) if (v != null) peak.metric[k] = Math.max(peak.metric[k] ?? -Infinity, v);
  peak.samples++;
  const row = [ts, ...metricNames.map((n) => mv[n] ?? ""), total, active, idle, idleTx, other, ours, probeMs, probeResult, csvQuote(byApp), csvQuote(errors.join("; "))];
  fs.appendFileSync(csvFile, row.join(",") + "\n");
  const mtxt = metricNames.length ? ` ${metricNames.map((n) => `${n}=${mv[n] ?? "?"}`).join(" ")}` : "";
  console.log(`${ts}${mtxt} backends=${total} (active ${active}, idle-in-tx ${idleTx}) probe=${probeResult}${probeMs !== "" ? `/${probeMs}ms` : ""}${errors.length ? ` errors=${errors.join("; ")}` : ""}`);
}

function stopReason() {
  try {
    const st = fs.statSync(stopFile);
    if (st.mtimeMs >= startedAt) return "STOP file";
  } catch { /* no STOP file yet */ }
  const ran = Date.now() - startedAt;
  if (runForMs != null && ran >= runForMs) return `--seconds=${runForMs / 1000}`;
  if (ran >= maxMs) return `--max-minutes=${maxMs / 60000}`;
  return null;
}

let stopping = null;
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => { stopping = sig; });

let next = Date.now();
while (!stopping) {
  const why = stopReason();
  if (why) { stopping = why; break; }
  await sampleOnce();
  // Fixed cadence; a slow sample skips ticks instead of bunching up.
  next += intervalMs;
  while (next <= Date.now()) next += intervalMs;
  await new Promise((r) => setTimeout(r, next - Date.now()));
}

const summary =
  `# end ${new Date().toISOString()} (${stopping}): ${peak.samples} samples; peak backends ${peak.backends}; ` +
  `probe failures ${peak.probeFails} (EMAXCONN ${peak.emaxconn})` +
  (Object.keys(peak.metric).length ? `; metric peaks ${Object.entries(peak.metric).map(([k, v]) => `${k}=${v}`).join(", ")}` : "");
fs.appendFileSync(csvFile, summary + "\n");
console.log(summary);
await session?.end().catch(() => {});
process.exit(0);
