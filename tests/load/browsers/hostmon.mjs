// Load-host self-monitoring for the browsers run (dev only).
//
// Why this exists: a run measures "save → the client applied it" with
// timestamps taken on the load host. If the host itself stalls — another
// process eats the CPU, a worker thread's event loop is blocked by a
// burst of JSON parsing, the laptop throttles — the clients' requests
// leave late (or never), their 8 s deadline timers fire late, and the
// report blames the server for a delay that happened on the laptop.
// Exactly that happened in a flag-on spam / lost-final drill: 2 of the 4
// SDK worker threads stalled, their requests never reached Vercel and the
// deadline timers fired up to 6.8 s late, which the harness reported as
// 224 "missing" + 594 deadline failures — a FAIL that was really a broken
// measurement.
//
// So every thread that takes timestamps (the main thread: pages, admin
// driver; each SDK worker) runs an event-loop lag monitor, the main
// thread samples the host, and run.mjs turns a stall into the verdict
// INVALID (not FAIL) — see `validity()` below.
//
// No dependencies beyond node:os / node:child_process, so the worker can
// import it cheaply and `hostmon.test.mjs` can pin the pure parts.

import os from "node:os";
import { execFileSync, execFile } from "node:child_process";

// Lag monitor tick and bucket width. 100 ms is fine-grained enough to
// see a 1 s stall as ~10 missing ticks folded into one large sample, and
// cheap (10 callbacks/s per thread). Windows timers have ~15.6 ms
// granularity, so an idle Windows host shows a lag p95 of ~15 ms — that
// is the floor, not a problem.
export const LAG_INTERVAL_MS = 100;
export const LAG_BUCKET_MS = 10_000;
// A single lag sample above this on ANY thread inside the measurement
// window invalidates the run: a thread that was blocked for more than a
// second may have delayed any timestamp, request or timer it owns by that
// much, which is a third of the 3 s latency gate.
export const LAG_INVALID_MS = 1_000;
// A worker heartbeat gap above this invalidates the run: the worker
// posts one heartbeat per second from its own event loop, so a 3 s gap
// means the thread was blocked (or dead) for at least ~2 s.
export const SILENT_INVALID_MS = 3_000;
export const HEARTBEAT_MS = 1_000;
// Samples above this are kept individually (with their time) so the
// report and the timelines file can say WHEN a thread stalled, not only
// that it did. Capped so a pathological run cannot grow without bound.
export const LAG_SPIKE_MS = 200;
const SPIKE_CAP = 2_000;

// Nearest-rank percentile on a sorted array (same convention as
// realtime/lib.mjs `dist`, so the numbers line up with the report's).
function pct(sorted, p) {
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))];
}

// Reservoir of lag samples: exact p50/p95/p99/max per bucket (a bucket
// holds ≤ 100 samples at the default tick, so keeping them until the
// bucket closes is cheap), plus the run-wide max and every spike.
export function createLagRecorder({ bucketMs = LAG_BUCKET_MS } = {}) {
  const closed = []; // [bucketStart, n, p50, p95, p99, max]
  let cur = null; // { start, samples }
  let n = 0;
  let max = 0;
  let maxAt = null;
  const spikes = []; // [t, lagMs]
  let spikesDropped = 0;
  const close = () => {
    if (!cur || !cur.samples.length) return;
    const s = cur.samples.sort((a, b) => a - b);
    closed.push([cur.start, s.length, pct(s, 0.5), pct(s, 0.95), pct(s, 0.99), s[s.length - 1]]);
  };
  return {
    record(t, lag) {
      const start = Math.floor(t / bucketMs) * bucketMs;
      if (!cur || cur.start !== start) {
        close();
        cur = { start, samples: [] };
      }
      cur.samples.push(lag);
      n++;
      if (lag > max) {
        max = lag;
        maxAt = t;
      }
      if (lag > LAG_SPIKE_MS) {
        if (spikes.length < SPIKE_CAP) spikes.push([t, lag]);
        else spikesDropped++;
      }
    },
    // Non-destructive: the open bucket is summarised too, so a summary
    // taken mid-run (heartbeat) or at the end includes the latest samples.
    summary() {
      const out = closed.slice();
      if (cur && cur.samples.length) {
        const s = cur.samples.slice().sort((a, b) => a - b);
        out.push([cur.start, s.length, pct(s, 0.5), pct(s, 0.95), pct(s, 0.99), s[s.length - 1]]);
      }
      return { n, max, maxAt, bucketMs, buckets: out, spikes: spikes.slice(), spikesDropped };
    },
  };
}

// Whole-range p50/p95/p99 from bucket summaries is not exact; for the
// report's "idle lag" line the bucket p95s' median and the max are what
// matter, so this aggregates within [from, to]: max over the buckets'
// max, and the p95 = the highest bucket p95 (conservative).
export function lagOver(summary, from = -Infinity, to = Infinity) {
  const bs = (summary?.buckets || []).filter(([t]) => t + (summary.bucketMs ?? LAG_BUCKET_MS) > from && t <= to);
  if (!bs.length) return { buckets: 0, p50: null, p95: null, p99: null, max: null };
  const med = (i) => pct(bs.map((b) => b[i]).sort((a, b) => a - b), 0.5);
  return {
    buckets: bs.length,
    p50: med(2),
    p95: Math.max(...bs.map((b) => b[3])),
    p99: Math.max(...bs.map((b) => b[4])),
    max: Math.max(...bs.map((b) => b[5])),
  };
}

// The monitor itself: `setInterval(tick)`; lag = how much later than
// scheduled the tick ran (performance.now() is monotonic; Date.now() is
// the timestamp the report aligns with everything else). `onTick` is
// called after each sample (the worker uses it for heartbeats).
export function startLagMonitor({ intervalMs = LAG_INTERVAL_MS, bucketMs = LAG_BUCKET_MS, onTick } = {}) {
  const recorder = createLagRecorder({ bucketMs });
  let prev = performance.now();
  const timer = setInterval(() => {
    const now = performance.now();
    const lag = Math.max(0, Math.round(now - prev - intervalMs));
    prev = now;
    recorder.record(Date.now(), lag);
    if (onTick) onTick(lag);
  }, intervalMs);
  // A monitor must never be what keeps a process alive.
  if (typeof timer.unref === "function") timer.unref();
  return { recorder, stop: () => clearInterval(timer), intervalMs };
}

// ─── validity ───
// heartbeats: per worker, [[recvT, sendT, lagMaxSinceLast], ...] in
// arrival order. lags: [{ thread, summary }] (main + each worker's own
// final summary when it reported one). Window = the measurement window
// [from, to]: outside it (join of late joiners is still inside; the
// clean-up and the report are outside) a stall cannot touch a measured
// timestamp.
//
// Returns { invalid, reasons: [{ thread, what, at, ms }] }.
export function validity({ lags, heartbeats, from, to, workerStarted = {} }) {
  const reasons = [];
  for (const { thread, summary } of lags) {
    if (!summary) continue;
    for (const [t, lag] of summary.spikes || []) {
      if (t >= from && t <= to + LAG_INTERVAL_MS && lag > LAG_INVALID_MS) {
        // `at` = when the stall began (the late tick fires at its end).
        reasons.push({ thread, what: `event loop blocked ${lag} ms (lag sample)`, at: t - lag, ms: lag });
      }
    }
  }
  for (const [w, hbs] of Object.entries(heartbeats)) {
    const thread = `worker ${w}`;
    // Sender-side gaps (the worker's own clock between two heartbeats it
    // sent): the worker's loop was blocked. Receive-side gaps with a
    // normal sender gap are the main thread's stall, which its own lag
    // monitor already reports.
    for (let i = 1; i < hbs.length; i++) {
      const gap = hbs[i][1] - hbs[i - 1][1];
      const t = hbs[i][1];
      if (gap > SILENT_INVALID_MS && t >= from && hbs[i - 1][1] <= to) {
        reasons.push({ thread, what: `no heartbeat for ${gap} ms`, at: hbs[i - 1][1], ms: gap });
      }
    }
    // The heartbeat also carries the worker's own lag max since its last
    // beat (index 2). It is the only lag evidence left for a worker whose
    // result never arrived (stopWorkers() timed out) — exactly the worker
    // most likely to have stalled — and a 1–3 s stall shows up here but
    // not as a heartbeat gap. Summaries and heartbeats may both report
    // the same stall; two independent signals are kept.
    for (const hb of hbs) {
      const t = hb[1];
      const lagMax = hb[2];
      if (typeof lagMax === "number" && lagMax > LAG_INVALID_MS && t >= from && t <= to + SILENT_INVALID_MS) {
        reasons.push({ thread, what: `event loop blocked ${lagMax} ms (heartbeat lag max)`, at: t - lagMax, ms: lagMax });
      }
    }
    // Silent until the end of the window (dead or blocked for good). A
    // worker that has not sent its first heartbeat yet is judged from
    // its start.
    const last = hbs.length ? hbs[hbs.length - 1][1] : workerStarted[w] ?? from;
    if (to - Math.max(last, from) > SILENT_INVALID_MS) {
      reasons.push({ thread, what: `no heartbeat for the last ${to - Math.max(last, from)} ms of the window`, at: last, ms: to - Math.max(last, from) });
    }
  }
  // Duplicate spikes from the same stall (worker summary AND its
  // heartbeat gap) are both kept: they are two independent signals.
  reasons.sort((a, b) => a.at - b.at);
  return { invalid: reasons.length > 0, reasons };
}
// ─── host telemetry (main thread) ───
// One sample per second: [t, load1, hostCpuPct, procCpuPct, rssMB,
// freeMemMB, threads]. hostCpuPct = busy share of all cores since the
// previous sample (from os.cpus() tick counters — the only host-wide CPU
// figure on Windows, where os.loadavg() is always [0, 0, 0]); procCpuPct
// = this process's user+system CPU (all its threads) over the same wall
// time, as a share of ALL cores, so 100 % = every core busy with us.
export const HOST_SAMPLE_ROW = ["t", "load1", "hostCpuPct", "procCpuPct", "rssMB", "freeMemMB", "threads"];

function cpuTimes() {
  let idle = 0;
  let total = 0;
  for (const c of os.cpus()) {
    for (const v of Object.values(c.times)) total += v;
    idle += c.times.idle;
  }
  return { idle, total };
}

export function startHostSampler({ intervalMs = 1000, threads = () => 1 } = {}) {
  const samples = [];
  const ncpu = os.cpus().length || 1;
  let prevCpu = cpuTimes();
  let prevProc = process.cpuUsage();
  let prevWall = performance.now();
  const timer = setInterval(() => {
    const cpu = cpuTimes();
    const proc = process.cpuUsage();
    const wall = performance.now();
    const dt = cpu.total - prevCpu.total;
    const hostPct = dt > 0 ? Math.round((1 - (cpu.idle - prevCpu.idle) / dt) * 1000) / 10 : null;
    const procUs = proc.user - prevProc.user + (proc.system - prevProc.system);
    const wallUs = (wall - prevWall) * 1000;
    const procPct = wallUs > 0 ? Math.round((procUs / (wallUs * ncpu)) * 1000) / 10 : null;
    prevCpu = cpu;
    prevProc = proc;
    prevWall = wall;
    samples.push([
      Date.now(),
      Math.round(os.loadavg()[0] * 100) / 100,
      hostPct,
      procPct,
      Math.round(process.memoryUsage().rss / 1048576),
      Math.round(os.freemem() / 1048576),
      threads(),
    ]);
  }, intervalMs);
  if (typeof timer.unref === "function") timer.unref();
  return { samples, stop: () => clearInterval(timer), ncpu, totalMemMB: Math.round(os.totalmem() / 1048576) };
}

// Per-phase summary of the host samples: phases = [{ name, from, to }].
export function summarizeHost(samples, phases) {
  const col = (rows, i) => rows.map((r) => r[i]).filter((v) => v != null).sort((a, b) => a - b);
  return phases.map(({ name, from, to }) => {
    const rows = samples.filter(([t]) => t >= from && t <= to);
    const host = col(rows, 2);
    const proc = col(rows, 3);
    const rss = col(rows, 4);
    const free = col(rows, 5);
    const load = col(rows, 1);
    return {
      name, from, to, n: rows.length,
      hostCpuP50: pct(host, 0.5), hostCpuMax: host.length ? host[host.length - 1] : null,
      procCpuP50: pct(proc, 0.5), procCpuMax: proc.length ? proc[proc.length - 1] : null,
      rssMaxMB: rss.length ? rss[rss.length - 1] : null,
      freeMemMinMB: free.length ? free[0] : null,
      load1Max: load.length ? load[load.length - 1] : null,
      threadsMax: rows.reduce((a, r) => Math.max(a, r[6] ?? 0), 0),
    };
  });
}

// ─── host isolation guard ───
// Load-host processes that may run next to a measurement: the side-car
// samplers (pooler gauges, `pg_stat_activity`, the 1 s Supavisor backend
// sampler that lives next to its results) and the live log capture (and
// the `vercel logs --follow` child it spawns). Anything else from tests/load — a second run, the
// history re-fetch (`vercel logs --since/--until`, which pulls and
// prints tens of MB), the summariser, warm-join — competes for the same
// cores and is exactly what stalled the workers before.
const ALLOWED_LOAD_SCRIPTS = ["vercel-logs-capture.mjs", "pooler-clients.mjs", "pg-connections.mjs", "supavisor-backends.mjs"];

// procs: [{ pid, name, cmd }]. Returns the competing ones with a reason.
// `allow` (n14 step 7, `run.mjs --declared-process=<pid>`): a Set of pids
// declared as part of the experiment — the declared process and its
// descendants by parent PID (spam7.mjs `processTree`) — which never
// compete. An exact-pid exception, not a category: a second k6 or any
// other unknown process still competes.
export function competingProcesses(procs, selfPid = process.pid, parentPid = process.ppid, allow = null) {
  const out = [];
  for (const p of procs) {
    if (p.pid === selfPid || p.pid === parentPid) continue;
    if (allow && allow.has(p.pid)) continue;
    const cmd = String(p.cmd || "").replace(/\\/g, "/");
    const name = String(p.name || "").toLowerCase();
    if (/(^|\/)k6(\.exe)?$/.test(name) || /(^|[\s/"])k6(\.exe)?"?\s+run\b/.test(cmd)) {
      out.push({ ...p, why: "k6 run (a concurrent burst doubles the population)" });
      continue;
    }
    // Order matters: the allowed side-cars first (the capture's own
    // command line contains "vercel-logs"), then the named offenders,
    // then the Vercel CLI itself — `npx vercel logs …` and the CLI's own
    // node process (`…/vercel/dist/vc.js" logs …`) both have `logs` as
    // the word after the vercel path.
    if (ALLOWED_LOAD_SCRIPTS.some((s) => cmd.includes(s))) continue;
    if (/vercel-logs-summary/.test(cmd)) { out.push({ ...p, why: "vercel-logs-summary" }); continue; }
    if (/warm-join/.test(cmd)) { out.push({ ...p, why: "warm-join" }); continue; }
    if (/\bvercel[^\s"]*"?\s+logs\b/.test(cmd)) {
      if (/--follow\b/.test(cmd)) continue; // the live capture's own child
      out.push({ ...p, why: "vercel logs history fetch" });
      continue;
    }
    if (/tests\/load\//.test(cmd)) out.push({ ...p, why: "another tests/load node process" });
  }
  return out;
}

// Process list with command lines. Windows: CIM via PowerShell (wmic is
// gone on current builds); elsewhere ps. Errors → null (the guard then
// says it could not check rather than claiming the host is clean).
export function listProcesses() {
  try {
    if (process.platform === "win32") {
      const out = execFileSync(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-Command",
          "Get-CimInstance Win32_Process -Filter \"Name='node.exe' or Name='k6.exe'\" | Select-Object ProcessId,Name,CommandLine | ConvertTo-Json -Compress"],
        { encoding: "utf8", timeout: 15000, windowsHide: true },
      );
      const j = out.trim() ? JSON.parse(out) : [];
      return (Array.isArray(j) ? j : [j]).map((x) => ({ pid: x.ProcessId, name: x.Name, cmd: x.CommandLine ?? "" }));
    }
    const out = execFileSync("ps", ["-eo", "pid=,comm=,args="], { encoding: "utf8", timeout: 15000 });
    return out.split("\n").filter(Boolean).map((l) => {
      const m = l.trim().match(/^(\d+)\s+(\S+)\s+(.*)$/);
      return m ? { pid: Number(m[1]), name: m[2], cmd: m[3] } : null;
    }).filter((p) => p && (/node|k6/.test(p.name)));
  } catch {
    return null;
  }
}

// n14 step 7: EVERY process with its parent pid, start time (UTC ISO)
// and command line — the declared process's tree and record need
// non-node processes too (k6, or a harmless stand-in for a smoke).
// ASYNC (execFile, not execFileSync): it also runs mid-measurement, and
// a synchronous PowerShell call would block the main thread — whose lag
// is itself a validity signal — for a second or more. Errors → null.
export function listAllProcessesAsync() {
  return new Promise((resolve) => {
    const done = (err, out) => {
      if (err) return resolve(null);
      try {
        if (process.platform === "win32") {
          const j = out.trim() ? JSON.parse(out) : [];
          return resolve((Array.isArray(j) ? j : [j]).map((x) => ({ pid: x.ProcessId, ppid: x.ParentProcessId ?? null, name: x.Name, cmd: x.CommandLine ?? "", startedAt: x.Start ?? null })));
        }
        const now = Date.now();
        resolve(out.split("\n").filter(Boolean).map((l) => {
          const m = l.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/);
          return m ? { pid: Number(m[1]), ppid: Number(m[2]), name: m[4], cmd: m[5], startedAt: new Date(now - Number(m[3]) * 1000).toISOString() } : null;
        }).filter(Boolean));
      } catch {
        resolve(null);
      }
    };
    if (process.platform === "win32") {
      execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
        "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CommandLine,@{n='Start';e={if ($_.CreationDate) { $_.CreationDate.ToUniversalTime().ToString('o') } else { $null }}} | ConvertTo-Json -Compress"],
      { encoding: "utf8", timeout: 30000, windowsHide: true, maxBuffer: 64 * 1024 * 1024 }, done);
    } else {
      execFile("ps", ["-eo", "pid=,ppid=,etimes=,comm=,args="], { encoding: "utf8", timeout: 15000, maxBuffer: 64 * 1024 * 1024 }, done);
    }
  });
}

// Whether a pid is alive right now (signal 0 = existence check, nothing
// is delivered; EPERM = alive but not ours). Cheap enough to poll.
export function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e?.code === "EPERM";
  }
}

// Host CPU busy share right now: POSIX → 1-min load average ÷ cores;
// Windows (loadavg is always 0) → a `sampleMs` os.cpus() sample.
export async function hostBusy(sampleMs = 2000) {
  const ncpu = os.cpus().length || 1;
  if (process.platform !== "win32") {
    return { pct: Math.round((os.loadavg()[0] / ncpu) * 1000) / 10, how: `loadavg ${os.loadavg()[0].toFixed(2)} / ${ncpu} cores` };
  }
  const a = cpuTimes();
  await new Promise((r) => setTimeout(r, sampleMs));
  const b = cpuTimes();
  const dt = b.total - a.total;
  const pctBusy = dt > 0 ? Math.round((1 - (b.idle - a.idle) / dt) * 1000) / 10 : null;
  return { pct: pctBusy, how: `${sampleMs / 1000} s CPU sample over ${ncpu} cores` };
}

export const HOST_BUSY_LIMIT_PCT = 60;
