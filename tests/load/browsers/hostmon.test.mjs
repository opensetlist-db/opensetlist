// node --test tests/load/browsers/hostmon.test.mjs
//
// Pins the pure parts of the load-host self-monitoring: the lag
// reservoir, the window aggregation and the INVALID rule. The monitors
// themselves are timers and are exercised by every smoke run.
import test from "node:test";
import assert from "node:assert/strict";
import { createLagRecorder, lagOver, validity, LAG_INVALID_MS, SILENT_INVALID_MS } from "./hostmon.mjs";

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
  assert.equal(v.reasons[0].at, 5_000);
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
