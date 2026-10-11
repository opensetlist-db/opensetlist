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
// thread can sample the host, and run.mjs turns a stall into the verdict
// INVALID (not FAIL) — see `validity()` below.
//
// No dependencies beyond node:os / node:child_process, so the worker can
// import it cheaply and `hostmon.test.mjs` can pin the pure parts.

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
        reasons.push({ thread, what: `event-loop lag ${lag} ms`, at: t, ms: lag });
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
