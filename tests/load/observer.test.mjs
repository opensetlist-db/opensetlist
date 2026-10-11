// node --test tests/load/observer.test.mjs
//
// One save (rev 21) seen by 3 clients: two got the broadcast as news and
// made a hinted fetch (one warm, one build), the third got it as a
// duplicate after a periodic poll had already applied rev 21. The plain
// poller saw rev 21 1.5 s after the first arrival. Plus a client record
// from subs-worker.mjs to pin the row decoding.
import test from "node:test";
import assert from "node:assert/strict";
import { summarize, toMarkdown, recordToLines } from "./observer.mjs";

const T = Date.UTC(2026, 9, 11, 14, 10, 0, 0);
const JSONL = [
  { kind: "meta", host: "runner-1", platform: "linux", node: "v22.20.0", base: "https://x", event: "111", clients: 3, label: "ci", startedAt: new Date(T - 60000).toISOString() },
  { kind: "broadcast", client: 0, t: T, rev: 21, what: "n" },
  { kind: "broadcast", client: 1, t: T + 40, rev: 21, what: "n" },
  { kind: "broadcast", client: 2, t: T + 90, rev: 21, what: "d" },
  // a duplicate delivery to client 0 must not move its first arrival
  { kind: "broadcast", client: 0, t: T + 500, rev: 21, what: "d" },
  // invalid payload: ignored by the per-rev table
  { kind: "broadcast", client: 1, t: T + 600, rev: null, what: "i" },
  { kind: "request", client: 0, t: T + 5, tEnd: T + 125, durationMs: 120, reason: "notification", notify: 1, hint: 21, status: 200, source: "warm", rev: 21 },
  { kind: "request", client: 1, t: T + 45, tEnd: T + 345, durationMs: 300, reason: "notification", notify: 1, hint: 21, status: 200, source: "build", rev: 21 },
  // not hinted (periodic): excluded from the rev's hinted stats
  { kind: "request", client: 2, t: T - 400, tEnd: T - 300, durationMs: 100, reason: "periodic", notify: 0, hint: null, status: 200, source: "cache", rev: 21 },
  { kind: "applied", client: 2, t: T - 300, rev: 21, reason: "periodic" },
  { kind: "applied", client: 0, t: T + 125, rev: 21, reason: "notification" },
  { kind: "applied", client: 1, t: T + 345, rev: 21, reason: "notification" },
  { kind: "poll", client: "poller", t: T - 3500, tEnd: T - 3400, durationMs: 100, status: 200, rev: 20 },
  { kind: "poll", client: "poller", t: T + 1400, tEnd: T + 1500, durationMs: 100, status: 200, rev: 21 },
  { kind: "poll", client: "poller", t: T + 6400, tEnd: T + 6600, durationMs: 200, status: 200, rev: 21 },
  ...[0, 1, 2, 3, 250].map((lagMs, i) => ({ kind: "lag", t: T + i * 100, lagMs })),
];

test("per-rev arrivals, hinted fetches, applied and poller", () => {
  const s = summarize(JSONL);
  assert.equal(s.revs.length, 1);
  const r = s.revs[0];
  assert.equal(r.rev, 21);
  assert.equal(r.clients, 3);
  assert.equal(r.firstArrival, T);
  assert.equal(r.spreadMs, 90);
  assert.equal(r.hinted.n, 2);
  assert.equal(r.hinted.p50, 120);
  assert.equal(r.hinted.p95, 300);
  assert.deepEqual(r.hinted.sources, { warm: 1, build: 1 });
  assert.deepEqual(r.applied, { n: 3, min: -300, max: 345 });
  assert.equal(r.pollerSeenAt, 1500);
  assert.deepEqual(s.poller.statuses, { 200: 3 });
  assert.equal(s.lag.max, 250);
  assert.equal(s.lag.p95, 250);
  assert.equal(s.lag.p50, 2);
});

test("markdown carries the host, the rev row and the lag line", () => {
  const md = toMarkdown(summarize(JSONL));
  assert.match(md, /host: `runner-1`/);
  assert.match(md, /\| 21 \| 14:10:00\.000 \| 3 \| 90 \| 120 \/ 300 \| 2 \| warm 1, build 1 \| -300…345 \(3\) \| 1500 \|/);
  assert.match(md, /p95 250 · max 250 ms/);
});

test("a rev applied by a poll but never broadcast is listed; the start rev is not", () => {
  const extra = [
    { kind: "applied", client: 0, t: T - 9000, rev: 19, reason: "initial" },
    { kind: "applied", client: 0, t: T - 5000, rev: 20, reason: "periodic" },
    { kind: "applied", client: 1, t: T - 4000, rev: 20, reason: "periodic" },
  ];
  const s = summarize([...JSONL, ...extra]);
  assert.deepEqual(s.unnotified, [{ rev: 20, firstAppliedAt: T - 5000, reason: "periodic" }]);
  assert.match(toMarkdown(s), /rev 20: first applied 14:09:55\.000 by a `periodic` fetch/);
  assert.deepEqual(summarize(JSONL).unnotified, []);
});

test("no broadcast → explicit empty section", () => {
  const md = toMarkdown(summarize(JSONL.filter((l) => l.kind !== "broadcast")));
  assert.match(md, /No `rev` broadcast arrived/);
});

test("recordToLines decodes a subs-worker client record", () => {
  const rec = {
    idx: 4, locale: "ko", subscribedAt: [T], statuses: { SUBSCRIBED: 1 }, errors: {}, fallbacks: [], recreates: [],
    bcasts: [[T, 21, "n"]],
    reqs: [[T + 1, "notification", 0, 21, 1, 21, 200, "satisfied", 21, "satisfied", T + 81, "ok", "warm"]],
    appliedAll: [[T + 81, 21, "notification"]], failKinds: {}, exhausted: [],
  };
  const lines = recordToLines(rec);
  const req = lines.find((l) => l.kind === "request");
  assert.deepEqual(
    { client: req.client, hint: req.hint, notify: req.notify, minRev: req.minRev, status: req.status, verify: req.verify, rev: req.rev, source: req.source, durationMs: req.durationMs },
    { client: 4, hint: 21, notify: 1, minRev: 21, status: 200, verify: "satisfied", rev: 21, source: "warm", durationMs: 80 },
  );
  assert.equal(lines.find((l) => l.kind === "client").subscribed, 1);
  const s = summarize(lines);
  assert.equal(s.revs[0].hinted.sources.warm, 1);
});
