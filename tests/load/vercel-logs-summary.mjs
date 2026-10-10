// Summarise a `npx vercel logs` text capture of a load run.
//
//   node tests/load/vercel-logs-summary.mjs <logfile> [--add-hours=N]
//        [--bucket=5] [--carry=5] [--out=<file.md>]
//
// Prints markdown tables (and writes them to --out when given):
//   - builds per `rev` — real executions of the snapshot builder, one
//     `[liveSnapshot] build … rev= ms= instance=` line each. This, not the
//     `x-snapshot-source` response header, is the build count: coalesced
//     waiters share the first request's result object, header included,
//     so the header over-counts;
//   - snapshot failure lines: `build-failed` (by error class), `rev-read`
//     (the bounded repair revision read; `rev=timeout` counted apart), and
//     `coalesced waiters=N`;
//   - `EMAXCONN` (Supavisor's "max client connections reached") split by
//     the request the error belongs to: an `/api/…` route vs an SSR page;
//   - `[liveWriter]` admin save timings per route (acquire = waiting for a
//     pool connection, exec = first statement → commit) and `ok=false`;
//   - `[setlist] slow-hit` cache hits that took long;
//   - distinct function instances per minute (any line with `instance=`);
//   - the SUM of per-instance Prisma pool sizes per time bucket, from
//     `[prisma] pool total= idle= waiting= instance=` lines — the best
//     app-side approximation of how many pooler clients the deployment
//     holds. An instance only logs when it does pool work, so two sums are
//     given: "reported" (instances that logged in the bucket) and
//     "carried" (each instance's last reported total, held for --carry
//     seconds after its last line — set it to the pool's idle timeout; an
//     idle pool keeps its connections until then);
//   - everything else, counted by its `[tag]` under "other", so new log
//     kinds are visible before this script learns them.
//
// Input format (Vercel CLI 63, text mode): each entry is a header line
//   `HH:MM:SS.cc  <host>  <level>  [λ] <METHOD> <path>`
// followed by the entry's message line(s) and a blank line, newest first.
// Times are the CLI machine's LOCAL clock with no date: `--add-hours`
// shifts them for display (e.g. +7 turns PDT into UTC so they line up
// with the k6 / browsers reports); a capture that crosses local midnight
// is not handled. CLI preamble lines and `### capture …` markers written
// by vercel-logs-capture.mjs are skipped.
import fs from "node:fs";
import { fileURLToPath } from "node:url";

// Two header shapes, one per CLI mode:
//   history  `14:03:55.97  <host>  info   λ GET /api/setlist`
//   --follow `14:50:33.25  ℹ️  GET  ---  <host>     /api/setlist`
//            (level as an icon, then the status or `---`, then a
//            `-----` rule line before the message)
const HEADER_HISTORY = /^(\d{1,2}):(\d{2}):(\d{2})(?:\.(\d+))?\s+(\S+\.\S+)\s+(info|error|warning|warn|fatal|debug|log)\s+(?:[^\sA-Z]+\s+)?([A-Z]+)\s+(\S+)/;
const HEADER_FOLLOW = /^(\d{1,2}):(\d{2}):(\d{2})(?:\.(\d+))?\s+(\S+)\s+([A-Z]+)\s+(\S+)\s+(\S+\.\S+)\s+(\/\S*)/;
const META = /^(Vercel CLI\b|Resolving deployment|Fetching (project|logs)|Fetched \d+ logs|Streaming logs for|waiting for new logs|TIME\s+HOST|### capture|<claude-code-hint|-{10,}$)/;

function parseHeader(line) {
  let m = HEADER_HISTORY.exec(line);
  if (m) return { hms: m, level: m[6], method: m[7], path: m[8] };
  m = HEADER_FOLLOW.exec(line);
  if (m) {
    // ℹ️ info, ⚠️ warning, anything else (❌ / ✖ / ⛔) error.
    const level = m[5].includes("ℹ") ? "info" : m[5].includes("⚠") ? "warning" : "error";
    return { hms: m, level, method: m[6], path: m[9] };
  }
  return null;
}

function kv(line) {
  const out = {};
  for (const m of line.matchAll(/([A-Za-z_][\w]*)=(\S+)/g)) out[m[1]] = m[2];
  return out;
}

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

function pct(values, p) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)];
}

// Parse the capture into typed records. Exported for the test.
//
// First pass: group lines into entries (header + message lines). A
// capture made of overlapping `--follow` segments repeats the entries of
// the overlap, so an entry identical (header and message) to one in the
// PREVIOUS segment is dropped; within one segment nothing is deduplicated.
export function parseLog(text) {
  const entries = [];
  const loose = []; // message lines before the first header
  let cur = null;
  let seg = 0;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (!line.trim()) continue;
    if (line.startsWith("### capture segment start")) { seg++; cur = null; continue; }
    const h = parseHeader(line);
    if (h) {
      cur = { key: line, h, lines: [], seg };
      entries.push(cur);
      continue;
    }
    if (META.test(line.trim())) continue;
    if (cur) { cur.lines.push(line); cur.key += `\n${line}`; } else loose.push(line);
  }
  const bySeg = new Map();
  for (const e of entries) {
    if (!bySeg.has(e.seg)) bySeg.set(e.seg, new Set());
    bySeg.get(e.seg).add(e.key);
  }
  let duplicates = 0;
  const kept = entries.filter((e) => {
    const prev = bySeg.get(e.seg - 1);
    if (prev && prev.has(e.key)) { duplicates++; return false; }
    return true;
  });

  const recs = [];
  const other = new Map();
  const classify = (line, entry) => {
    const base = { t: entry?.t ?? null, path: entry?.path ?? null };
    const f = kv(line);
    let kind = null;
    // Order matters: `build-failed` before `build`.
    if (/\[liveSnapshot\] build-failed\b/.test(line)) kind = "buildFailed";
    else if (/\[liveSnapshot\] build\s/.test(line)) kind = "build";
    // `rev-read-error` is the console.error companion of a `rev=error`
    // line (same read, logged twice) — keep it out of the rev-read
    // count or every error would count as two reads.
    else if (/\[liveSnapshot\] rev-read-error\b/.test(line)) kind = "revReadError";
    else if (/\[liveSnapshot\] rev-read\b/.test(line)) kind = "revRead";
    // `coalesced` (first read) and `coalesced-repair` (rev-keyed rebuild)
    // both carry `waiters=N`; one request can appear in each, so they
    // are summed as "coalesce events", not as requests.
    else if (/\[liveSnapshot\] coalesced(-repair)?\b/.test(line)) kind = "coalesced";
    else if (/\[prisma\] pool\b/.test(line)) kind = "pool";
    // `[liveWriter] failed route=… kind=…` has no acquire/exec fields;
    // it is the pre-execution failure companion of an `ok=false` line.
    else if (/\[liveWriter\] failed\b/.test(line)) kind = "writerFailed";
    else if (/\[liveWriter\]/.test(line)) kind = "writer";
    else if (/\[setlist\] slow-hit\b/.test(line)) kind = "slowHit";
    else if (/EMAXCONN/.test(line)) kind = "emaxconn";
    if (kind) {
      recs.push({ kind, ...base, f, api: (entry?.path ?? "").startsWith("/api/"), emax: /EMAXCONN/.test(line) });
    } else {
      const tag = /^\s*(\[[^\]]{1,40}\]\s*\S*)/.exec(line)?.[1] ?? `untagged: ${line.trim().slice(0, 50)}`;
      other.set(tag, (other.get(tag) || 0) + 1);
    }
  };
  for (const line of loose) classify(line, null);
  for (const e of kept) {
    const m = e.h.hms;
    const t = (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]) + (m[4] ? Number(`0.${m[4]}`) : 0);
    const entry = { t, level: e.h.level, method: e.h.method, path: e.h.path };
    recs.push({ kind: "request", ...entry });
    for (const line of e.lines) classify(line, entry);
  }
  return { recs, other, entries: kept.length, duplicates };
}

export function summarise(text, { bucketS = 5, carryS = 5 } = {}) {
  const { recs, other, entries, duplicates } = parseLog(text);
  const by = (k) => recs.filter((r) => r.kind === k);
  const requests = by("request");

  // builds per rev
  const revs = new Map();
  for (const r of by("build")) {
    const rev = r.f.rev ?? "?";
    let g = revs.get(rev);
    if (!g) revs.set(rev, (g = { rev, builds: 0, instances: new Set(), locales: {}, ms: [], tMin: Infinity, tMax: -Infinity }));
    g.builds++;
    if (r.f.instance) g.instances.add(r.f.instance);
    if (r.f.locale) g.locales[r.f.locale] = (g.locales[r.f.locale] || 0) + 1;
    const ms = num(r.f.ms);
    if (ms != null) g.ms.push(ms);
    if (r.t != null) { g.tMin = Math.min(g.tMin, r.t); g.tMax = Math.max(g.tMax, r.t); }
  }
  const builds = [...revs.values()]
    .sort((a, b) => (num(a.rev) ?? Infinity) - (num(b.rev) ?? Infinity))
    .map((g) => ({
      rev: g.rev, builds: g.builds, instances: g.instances.size, locales: g.locales,
      avgMs: g.ms.length ? Math.round(g.ms.reduce((a, b) => a + b, 0) / g.ms.length) : null,
      maxMs: g.ms.length ? Math.max(...g.ms) : null,
      from: Number.isFinite(g.tMin) ? g.tMin : null, to: Number.isFinite(g.tMax) ? g.tMax : null,
    }));

  // failures / repair / coalescing
  const failedByErr = {};
  for (const r of by("buildFailed")) {
    const cls = String(r.f.err ?? "?").split(":")[0];
    failedByErr[cls] = (failedByErr[cls] || 0) + 1;
  }
  const revReads = by("revRead");
  const revReadTimeouts = revReads.filter((r) => r.f.rev === "timeout").length;
  const revReadMs = revReads.map((r) => num(r.f.ms)).filter((v) => v != null);
  const coalesced = by("coalesced");
  const waiters = coalesced.map((r) => num(r.f.waiters)).filter((v) => v != null);

  // EMAXCONN
  // Every line that names EMAXCONN: the unhandled Prisma errors (their own
  // log entries) plus any typed line that carries it in a field, e.g. a
  // `build-failed … err=…EMAXCONN…` once the route catches the error.
  const emax = recs.filter((r) => r.emax);
  const emaxconn = {
    total: emax.length,
    api: emax.filter((r) => r.api).length,
    ssr: emax.filter((r) => !r.api).length,
    inTypedLines: emax.filter((r) => r.kind !== "emaxconn").length,
  };

  // writer
  const writerRoutes = new Map();
  for (const r of by("writer")) {
    const route = r.f.route ?? "?";
    let g = writerRoutes.get(route);
    if (!g) writerRoutes.set(route, (g = { route, n: 0, acquire: [], exec: [], failed: 0 }));
    g.n++;
    const a = num(r.f.acquireMs);
    const e = num(r.f.execMs);
    if (a != null) g.acquire.push(a);
    if (e != null) g.exec.push(e);
    if (r.f.ok === "false") g.failed++;
  }
  // Pre-execution failure kinds (pool_acquire_timeout / pooler_cap /
  // tx_max_wait / other) per route, from the `[liveWriter] failed` lines.
  const writerFailedKinds = new Map();
  for (const r of by("writerFailed")) {
    const route = r.f.route ?? "?";
    const kinds = writerFailedKinds.get(route) ?? new Map();
    kinds.set(r.f.kind ?? "?", (kinds.get(r.f.kind ?? "?") || 0) + 1);
    writerFailedKinds.set(route, kinds);
    if (!writerRoutes.has(route)) writerRoutes.set(route, { route, n: 0, acquire: [], exec: [], failed: 0 });
  }
  const writers = [...writerRoutes.values()].map((g) => ({
    route: g.route, n: g.n, failed: g.failed,
    failedKinds: [...(writerFailedKinds.get(g.route) ?? new Map()).entries()].map(([k, v]) => `${k} ${v}`).join(", "),
    acquireP50: pct(g.acquire, 0.5), acquireP95: pct(g.acquire, 0.95),
    execP50: pct(g.exec, 0.5), execP95: pct(g.exec, 0.95),
  }));
  const revReadErrors = by("revReadError").length;

  const slow = by("slowHit").map((r) => num(r.f.ms)).filter((v) => v != null);

  // instances per minute (any record that names an instance)
  const minutes = new Map();
  const minuteOf = (t) => Math.floor(t / 60);
  for (const r of recs) {
    if (r.t == null) continue;
    const m = minuteOf(r.t);
    let g = minutes.get(m);
    if (!g) minutes.set(m, (g = { minute: m, instances: new Set(), builds: 0, emaxconn: 0, requests: 0 }));
    if (r.f?.instance) g.instances.add(r.f.instance);
    if (r.kind === "build") g.builds++;
    if (r.emax) g.emaxconn++;
    if (r.kind === "request") g.requests++;
  }
  const perMinute = [...minutes.values()].sort((a, b) => a.minute - b.minute)
    .map((g) => ({ minute: g.minute, instances: g.instances.size, builds: g.builds, emaxconn: g.emaxconn, requests: g.requests }));

  // pool totals per bucket
  const pools = by("pool")
    .filter((r) => r.t != null && r.f.instance && num(r.f.total) != null)
    .map((r) => ({ t: r.t, inst: r.f.instance, total: num(r.f.total), idle: num(r.f.idle), waiting: num(r.f.waiting) }))
    .sort((a, b) => a.t - b.t);
  const poolBuckets = [];
  if (pools.length) {
    const first = Math.floor(pools[0].t / bucketS) * bucketS;
    const last = pools[pools.length - 1].t;
    const lastSeen = new Map(); // inst → { t, total }
    let i = 0;
    for (let b = first; b <= last; b += bucketS) {
      const inBucket = new Map(); // inst → max total in this bucket
      let waiting = 0;
      for (; i < pools.length && pools[i].t < b + bucketS; i++) {
        const p = pools[i];
        inBucket.set(p.inst, Math.max(inBucket.get(p.inst) ?? 0, p.total));
        waiting = Math.max(waiting, p.waiting ?? 0);
        lastSeen.set(p.inst, { t: p.t, total: p.total });
      }
      let carried = 0;
      let carriedN = 0;
      for (const [inst, s] of lastSeen) {
        const v = inBucket.has(inst) ? inBucket.get(inst) : b - s.t <= carryS ? s.total : null;
        if (v != null) { carried += v; carriedN++; }
      }
      const reported = [...inBucket.values()].reduce((a, v) => a + v, 0);
      poolBuckets.push({ t: b, reportingInstances: inBucket.size, reported, carriedInstances: carriedN, carried, maxWaiting: waiting });
    }
  }

  const otherSorted = [...other.entries()].sort((a, b) => b[1] - a[1]);
  return {
    entries, duplicates,
    requests: {
      total: requests.length,
      setlistApi: requests.filter((r) => r.path.startsWith("/api/setlist")).length,
      otherApi: requests.filter((r) => r.path.startsWith("/api/") && !r.path.startsWith("/api/setlist")).length,
      pages: requests.filter((r) => !r.path.startsWith("/api/")).length,
      errors: requests.filter((r) => r.level === "error").length,
    },
    builds, buildTotal: by("build").length,
    buildFailed: { total: by("buildFailed").length, byErr: failedByErr },
    revRead: { total: revReads.length, timeouts: revReadTimeouts, errors: revReadErrors, p50: pct(revReadMs, 0.5), max: revReadMs.length ? Math.max(...revReadMs) : null },
    coalesced: { lines: coalesced.length, waitersSum: waiters.reduce((a, b) => a + b, 0), waitersMax: waiters.length ? Math.max(...waiters) : null },
    emaxconn, writers,
    slowHit: { total: slow.length, maxMs: slow.length ? Math.max(...slow) : null },
    perMinute, poolBuckets,
    poolPeak: poolBuckets.reduce((m, b) => Math.max(m, b.carried), 0),
    other: otherSorted,
  };
}

const clock = (t, addH = 0) => {
  if (t == null) return "—";
  const s = (((t + addH * 3600) % 86400) + 86400) % 86400;
  const hh = String(Math.floor(s / 3600)).padStart(2, "0");
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const ss = String(Math.floor(s % 60)).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
};
const d = (v) => (v == null ? "—" : String(v));

export function toMarkdown(s, { addHours = 0, bucketS = 5, carryS = 5, source = "" } = {}) {
  const L = [];
  const tz = addHours ? `log clock ${addHours > 0 ? "+" : ""}${addHours} h` : "log clock (CLI machine local time)";
  L.push(`## Vercel runtime logs${source ? ` — ${source}` : ""}`);
  L.push("");
  L.push(`${s.entries} entries${s.duplicates ? ` (+${s.duplicates} repeated by overlapping capture segments, dropped)` : ""}; requests: /api/setlist ${s.requests.setlistApi}, other API ${s.requests.otherApi}, pages ${s.requests.pages}; error-level entries ${s.requests.errors}. Times: ${tz}.`);
  L.push("");
  L.push(`### Builds per rev (\`[liveSnapshot] build\` lines: ${s.buildTotal})`);
  L.push("");
  L.push("| rev | builds | distinct instances | locales | build ms avg / max | first – last |");
  L.push("|---|---|---|---|---|---|");
  for (const b of s.builds) {
    L.push(`| ${b.rev} | ${b.builds} | ${b.instances} | ${Object.entries(b.locales).map(([k, v]) => `${k} ${v}`).join(", ")} | ${d(b.avgMs)} / ${d(b.maxMs)} | ${clock(b.from, addHours)} – ${clock(b.to, addHours)} |`);
  }
  L.push("");
  L.push("### Failures, repair reads, coalescing");
  L.push("");
  L.push("| what | count | detail |");
  L.push("|---|---|---|");
  L.push(`| EMAXCONN (pooler client cap) | ${s.emaxconn.total} | API ${s.emaxconn.api}, SSR ${s.emaxconn.ssr}${s.emaxconn.inTypedLines ? ` (${s.emaxconn.inTypedLines} inside build-failed / writer lines)` : ""} |`);
  L.push(`| \`[liveSnapshot] build-failed\` | ${s.buildFailed.total} | ${Object.entries(s.buildFailed.byErr).map(([k, v]) => `${k} ${v}`).join(", ") || "—"} |`);
  L.push(`| \`[liveSnapshot] rev-read\` (repair revision read) | ${s.revRead.total} | rev=timeout ${s.revRead.timeouts}, rev=error ${s.revRead.errors}; ms p50 ${d(s.revRead.p50)} / max ${d(s.revRead.max)} |`);
  L.push(`| \`[liveSnapshot] coalesced\` | ${s.coalesced.lines} | waiters sum ${s.coalesced.waitersSum}, max ${d(s.coalesced.waitersMax)} |`);
  L.push(`| \`[setlist] slow-hit\` | ${s.slowHit.total} | max ${d(s.slowHit.maxMs)} ms |`);
  L.push("");
  if (s.writers.length) {
    L.push("### Admin writes (`[liveWriter]`)");
    L.push("");
    L.push("| route | saves | acquire ms p50 / p95 | exec ms p50 / p95 | ok=false | failed kinds |");
    L.push("|---|---|---|---|---|---|");
    for (const w of s.writers) L.push(`| ${w.route} | ${w.n} | ${d(w.acquireP50)} / ${d(w.acquireP95)} | ${d(w.execP50)} / ${d(w.execP95)} | ${w.failed} | ${w.failedKinds || "—"} |`);
    L.push("");
  }
  L.push("### Per minute");
  L.push("");
  L.push("| minute | requests | distinct instances | builds | EMAXCONN |");
  L.push("|---|---|---|---|---|");
  for (const m of s.perMinute) L.push(`| ${clock(m.minute * 60, addHours).slice(0, 5)} | ${m.requests} | ${m.instances} | ${m.builds} | ${m.emaxconn} |`);
  L.push("");
  L.push(`### Prisma pool totals per ${bucketS} s (app-side estimate of pooler clients)`);
  L.push("");
  if (!s.poolBuckets.length) {
    L.push("No `[prisma] pool total=… instance=…` lines in this capture.");
  } else {
    L.push(`Peak carried sum: **${s.poolPeak}** (carry ${carryS} s). "reported" = instances that logged in the bucket (max total each); "carried" also counts an instance's last total for ${carryS} s after its last line.`);
    L.push("");
    L.push("| bucket | reporting instances | Σ total (reported) | instances (carried) | Σ total (carried) | max waiting |");
    L.push("|---|---|---|---|---|---|");
    for (const b of s.poolBuckets) {
      if (!b.reportingInstances && !b.carriedInstances) continue;
      L.push(`| ${clock(b.t, addHours)} | ${b.reportingInstances} | ${b.reported} | ${b.carriedInstances} | ${b.carried} | ${b.maxWaiting} |`);
    }
  }
  L.push("");
  L.push("### Other lines");
  L.push("");
  if (!s.other.length) L.push("none");
  else {
    L.push("| kind | count |");
    L.push("|---|---|");
    for (const [k, v] of s.other.slice(0, 15)) L.push(`| ${k.replace(/\|/g, "/")} | ${v} |`);
    if (s.other.length > 15) L.push(`| (${s.other.length - 15} more kinds) | ${s.other.slice(15).reduce((a, [, v]) => a + v, 0)} |`);
  }
  L.push("");
  return L.join("\n");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const file = process.argv.slice(2).find((a) => !a.startsWith("--"));
  if (!file) {
    console.error("usage: node tests/load/vercel-logs-summary.mjs <logfile> [--add-hours=N] [--bucket=5] [--carry=5] [--out=file.md]");
    process.exit(2);
  }
  const opt = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith("--")).map((a) => {
    const [k, v] = a.slice(2).split("=");
    return [k, v ?? true];
  }));
  const bucketS = parseFloat(opt.bucket ?? "5") || 5;
  const carryS = parseFloat(opt.carry ?? "5");
  const addHours = parseFloat(opt["add-hours"] ?? "0") || 0;
  const s = summarise(fs.readFileSync(file, "utf8"), { bucketS, carryS });
  const md = toMarkdown(s, { addHours, bucketS, carryS, source: file.replace(/\\/g, "/").split("/").pop() });
  if (opt.out) fs.writeFileSync(opt.out, md);
  console.log(md);
}
