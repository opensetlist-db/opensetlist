// node --test tests/load/browsers/hostmon.test.mjs
//
// Pins the pure parts of the load-host self-monitoring: the lag
// reservoir, the window aggregation and the INVALID rule. The monitors
// themselves are timers and are exercised by every smoke run.
import test from "node:test";
import assert from "node:assert/strict";
import { createLagRecorder, lagOver, validity, summarizeHost, competingProcesses, LAG_INVALID_MS, SILENT_INVALID_MS } from "./hostmon.mjs";

test("competingProcesses: side-cars allowed, offenders named", () => {
  const procs = [
    { pid: 1, name: "node.exe", cmd: "node --no-warnings tests/load/browsers/run.mjs --pages=30" }, // self
    { pid: 2, name: "node.exe", cmd: "node tests\\load\\vercel-logs-capture.mjs --segment=280" },
    { pid: 3, name: "node.exe", cmd: "\"C:\\nodejs\\node.exe\" \"C:\\npm\\node_modules\\npm\\bin\\npx-cli.js\" vercel logs https://x --follow --scope s" },
    { pid: 4, name: "node.exe", cmd: "node tests/load/pooler-clients.mjs" },
    { pid: 5, name: "node.exe", cmd: "\"C:\\nodejs\\node.exe\" \"C:\\x\\node_modules\\vercel\\dist\\vc.js\" logs https://x --since 2026-10-11T09:00:00Z --until 2026-10-11T09:20:00Z" },
    { pid: 6, name: "node.exe", cmd: "node tests/load/vercel-logs-summary.mjs h.txt --add-hours=7" },
    { pid: 7, name: "node.exe", cmd: "node tests/load/warm-join.mjs a.json b.txt" },
    { pid: 8, name: "node.exe", cmd: "node tests/load/browsers/run.mjs --pages=2" },
    { pid: 9, name: "k6.exe", cmd: "k6 run viewers.js" },
    { pid: 10, name: "node.exe", cmd: "node C:/work/other-project/server.js" },
  ];
  const out = competingProcesses(procs, 1, 0);
  assert.deepEqual(out.map((p) => [p.pid, p.why]), [
    [5, "vercel logs history fetch"],
    [6, "vercel-logs-summary"],
    [7, "warm-join"],
    [8, "another tests/load node process"],
    [9, "k6 run (a concurrent burst doubles the population)"],
  ]);
});

test("summarizeHost: per-phase CPU / memory figures", () => {
  // [t, load1, hostCpuPct, procCpuPct, rssMB, freeMemMB, threads]
  const samples = [
    [1_000, 0, 10, 2, 300, 8_000, 1],
    [2_000, 0, 30, 4, 320, 7_900, 5],
    [3_000, 0, 90, 40, 400, 7_000, 5],
  ];
  const [a, b] = summarizeHost(samples, [{ name: "join", from: 0, to: 2_000 }, { name: "edits", from: 2_500, to: 4_000 }]);
  assert.equal(a.n, 2);
  assert.equal(a.hostCpuMax, 30);
  assert.equal(a.procCpuP50, 2);
  assert.equal(a.rssMaxMB, 320);
  assert.equal(a.freeMemMinMB, 7_900);
  assert.equal(a.threadsMax, 5);
  assert.equal(b.hostCpuP50, 90);
});

test("lag recorder: per-bucket percentiles, run max and spikes", () => {
  const r = createLagRecorder({ bucketMs: 10_000 });
  for (let i = 0; i < 100; i++) r.record(i * 100, i === 50 ? 1_500 : i % 10);
  r.record(12_000, 3);
  const s = r.summary();
  assert.equal(s.n, 101);
  assert.equal(s.max, 1_500);
  assert.equal(s.maxAt, 5_000);
  assert.equal(s.buckets.length, 2);
  const [b0, b1] = s.buckets;
  assert.equal(b0[0], 0);
  assert.equal(b0[1], 100);
  assert.equal(b0[5], 1_500);
  assert.equal(b0[3], 9); // p95 of 0..9 repeated (+ one outlier)
  assert.deepEqual(b1, [10_000, 1, 3, 3, 3, 3]);
  assert.deepEqual(s.spikes, [[5_000, 1_500]]);
});

test("summary is non-destructive and includes the open bucket", () => {
  const r = createLagRecorder();
  r.record(1, 5);
  assert.equal(r.summary().buckets.length, 1);
  r.record(2, 7);
  assert.equal(r.summary().buckets[0][1], 2);
});

test("lagOver: worst bucket inside the window", () => {
  const r = createLagRecorder({ bucketMs: 10_000 });
  r.record(1_000, 900); // bucket 0, outside the window below
  r.record(21_000, 10);
  r.record(31_000, 20);
  const w = lagOver(r.summary(), 20_000, 40_000);
  assert.equal(w.buckets, 2);
  assert.equal(w.max, 20);
  assert.equal(lagOver(null).max, null);
});

test("validity: a > 1 s lag inside the window invalidates; outside does not", () => {
  const r = createLagRecorder();
  r.record(5_000, LAG_INVALID_MS + 1);
  r.record(50_000, 4_000); // after the window
  const lags = [{ thread: "worker 1", summary: r.summary() }];
  const v = validity({ lags, heartbeats: {}, from: 0, to: 10_000 });
  assert.equal(v.invalid, true);
  assert.equal(v.reasons.length, 1);
  assert.equal(v.reasons[0].thread, "worker 1");
  assert.equal(v.reasons[0].at, 5_000 - (LAG_INVALID_MS + 1), "stall start");
  const ok = validity({ lags: [{ thread: "main", summary: (() => { const x = createLagRecorder(); x.record(1, LAG_INVALID_MS); return x.summary(); })() }], heartbeats: {}, from: 0, to: 10 });
  assert.equal(ok.invalid, false, "exactly the threshold is still valid");
});

test("validity: heartbeat gaps (sender clock) and a silent tail", () => {
  const hb = (ts) => ts.map((t) => [t + 5, t, 0]);
  const steady = hb([1_000, 2_000, 3_000, 4_000, 5_000, 6_000, 7_000, 8_000, 9_000, 10_000]);
  assert.equal(validity({ lags: [], heartbeats: { 0: steady }, from: 0, to: 10_000 }).invalid, false);
  const gap = hb([1_000, 2_000, 2_000 + SILENT_INVALID_MS + 500, 6_600, 7_600, 8_600, 9_600]);
  const v = validity({ lags: [], heartbeats: { 2: gap }, from: 0, to: 10_000 });
  assert.equal(v.invalid, true);
  assert.match(v.reasons[0].what, /no heartbeat for 3500 ms/);
  assert.equal(v.reasons[0].thread, "worker 2");
  const dead = validity({ lags: [], heartbeats: { 3: hb([1_000, 2_000]) }, from: 0, to: 10_000 });
  assert.equal(dead.invalid, true);
  assert.match(dead.reasons[0].what, /last 8000 ms/);
  const never = validity({ lags: [], heartbeats: { 4: [] }, from: 0, to: 10_000, workerStarted: { 4: 500 } });
  assert.equal(never.invalid, true);
});
