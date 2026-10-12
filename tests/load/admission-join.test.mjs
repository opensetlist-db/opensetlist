// node --test tests/load/admission-join.test.mjs
//
// Synthetic step-5 harness JSON + history-mode Vercel log + observer
// artifact, joined by admission-join.mjs: the server commit cross-check
// (inside / indeterminate / clock offset), the admission window view
// (builds per minute and per instance, warm-job vs reader builds,
// 503 / EMAXCONN), Σ with its completeness, the A4 fault evidence, and
// the observer's clients judged by the same idle eligibility rule.
import test from "node:test";
import assert from "node:assert/strict";
import { join, normaliseK6, toMarkdown, faultEvidence, observerClients } from "./admission-join.mjs";

const T = Date.UTC(2026, 9, 12, 14, 10, 0, 0);
// History header at T + sec (log clock = UTC here, --add-hours 0).
const hdr = (sec, path, method = "GET") => {
  const t = new Date(T + sec * 1000);
  const p2 = (n) => String(n).padStart(2, "0");
  return `${p2(t.getUTCHours())}:${p2(t.getUTCMinutes())}:${p2(t.getUTCSeconds())}.${p2(Math.floor(t.getUTCMilliseconds() / 10))}  opensetlist-x.vercel.app  info     ${method} ${path}`;
};
const entry = (sec, lines, path = "/api/setlist", method = "GET") => [hdr(sec, path, method), ...lines, ""].join("\n");

function admissionLog({ writerAt = 5200, hit = false } = {}) {
  return [
    entry(0.5, ["[liveWarm] fault armed mode=getnull instance=a"]),
    entry(1, ["[liveSnapshot] build event=111 locale=ja rev=49 items=70 ms=900 instance=a", "[prisma] pool total=3 idle=0 waiting=2 instance=a"]),
    entry(1.5, ["[liveSnapshot] build event=111 locale=ko rev=49 items=70 ms=950 instance=b", "[prisma] pool total=4 idle=0 waiting=1 instance=b"]),
    entry(2, [`[setlist] warm-lookup event=111 locale=ja minRev=49 result=${hit ? "hit" : "miss"} ms=3 instance=a fault=getnull`]),
    entry(2.2, ["[setlist] warm-lookup event=111 locale=ja minRev=49 result=memo-miss ms=0 instance=a fault=getnull"]),
    entry(3, ["[setlist] hint-fetch event=111 locale=ja minRev=49 verify=error instance=c"]),
    // The admission save: writer + its warm job (one locale set, built on
    // instance d inside the job window).
    entry(5, [
      `[liveWriter] route=update acquireMs=12 execMs=40 rev=50 ok=true at=${T + writerAt} instance=d`,
      `[liveWarm] start event=111 rev=50 at=${T + 5300} instance=d`,
      "[liveSnapshot] build event=111 locale=ja rev=50 items=70 ms=800 instance=d",
      `[liveWarm] set event=111 locale=ja atLeastRev=50 rev=50 bytes=500000 buildMs=800 setMs=5 ok=true buildStartAt=${T + 5310} buildEndAt=${T + 6110} txStartAt=${T + 5320} txEndAt=${T + 6100} holdMs=0 captureAt=${T + 5320} setStartAt=${T + 6110} at=${T + 6115} instance=d`,
      `[liveWarm] done event=111 rev=50 ms=900 at=${T + 6200} instance=d`,
      "[prisma] pool total=2 idle=1 waiting=0 instance=d",
    ], "/api/admin/setlist-items/9", "PUT"),
    entry(30, ["[liveSnapshot] build event=111 locale=en rev=50 items=70 ms=700 instance=b"]),
    // outside the window (save end + 30 s): not counted
    entry(50, ["[liveSnapshot] build event=111 locale=en rev=50 items=70 ms=700 instance=e"]),
  ].join("\n");
}

const SAVE = {
  k: "a1", mode: "admission", label: "SDK + page admission save", rev: 50, songId: "900", putStart: T + 5000, putEnd: T + 5400, putMs: 400,
  sdkExposure: { connected: 120, notYet: 300, disconnected: 0 }, pageExposure: { inflight: 6, future: 10, settled: 0 },
  stale: { sdk: { stale: 1, eligible: 10 }, pages: { stale: 0, eligible: 3 } },
  sdkConv: { before: { p95: 900, missing: 0 }, after: { p95: 300, missing: 0 } }, pageConv: null,
  receipt: { received: 110, population: 420, reasons: { notification: 400, catchup: 20 } },
};
const ADM_JSON = {
  config: { label: "A4-test", base: "https://opensetlist-abc123-opensetlist-projects.vercel.app" },
  admission: {
    T0: T, saves: [SAVE], gates: [], exercised: { sdk: true, page: true },
    verdict: { verdict: "VALID + PASS", sdk: "VALID + PASS", page: "VALID + PASS" },
    boundary: { outbound: [], waitMs: 1000 }, final: null,
  },
};

test("server commit cross-check: inside / indeterminate / clock offset", () => {
  let j = join(ADM_JSON, { logText: admissionLog() });
  assert.equal(j.saves[0].writer.acquireMs, 12);
  assert.equal(j.saves[0].commitOrder, "inside [PUT start, PUT response]");
  j = join(ADM_JSON, { logText: admissionLog({ writerAt: 5450 }) });
  assert.match(j.saves[0].commitOrder, /^indeterminate \(\+50 ms/);
  j = join(ADM_JSON, { logText: admissionLog({ writerAt: 4400 }) });
  assert.match(j.saves[0].commitOrder, /outside by -600 ms → clock offset/);
});

test("admission window: builds per minute (warm vs reader), instances by first appearance, 503, Σ completeness", () => {
  const j = join(ADM_JSON, { logText: admissionLog() });
  const s = j.server;
  // Minute 14:10: 4 builds (a, b, d, b), 1 of them the warm job's; the
  // build at +50 s (instance e) is after the window.
  assert.deepEqual(s.perMinute.map((m) => [m.builds, m.warm, m.reader]), [[4, 1, 3]]);
  assert.deepEqual(s.perInstance.map((x) => x.instance), ["a", "b", "c", "d"]);
  assert.equal(s.perInstance.find((x) => x.instance === "d").warm, 1);
  assert.equal(s.hint503, 1);
  assert.equal(s.emax, 0);
  // Σ: a=3 and b=4 (1 s / 1.5 s) are still carried (≤ 5 s) into the
  // bucket where d reports 2 → 9; instance c never
  // logged a pool line → listed as silent (not in Σ).
  assert.equal(s.sigma.peak.carried, 9);
  assert.deepEqual(s.sigma.silentInstances, ["c"]);
  assert.equal(s.coverage.coversFrom, false);
  const md = toMarkdown(j);
  assert.match(md, /Σ \(sum of per-instance Prisma pool totals\)\*\*: peak 9/);
  assert.match(md, /WITHOUT any pool line \(c\)/);
  assert.match(md, /Writer acquire max 12 ms \(gate ≤ 500: \*\*PASS\*\*\)/);
});

test("A4 fault evidence: armed, zero hits, tagged lookups — and a hit breaks it", () => {
  const ok = faultEvidence(admissionLog(), "getnull");
  assert.equal(ok.armed, 1);
  assert.equal(ok.hits, 0);
  assert.deepEqual(ok.results, { miss: 1, "memo-miss": 1 });
  assert.equal(ok.complete, true);
  const bad = faultEvidence(admissionLog({ hit: true }), "getnull");
  assert.equal(bad.hits, 1);
  assert.equal(bad.complete, false);
  const inv = faultEvidence(`${admissionLog()}\n${entry(9, ["[liveWarm] fault-invalid mode=getnul injected=none instance=z"])}`, "getnull");
  assert.equal(inv.invalid, 1);
  assert.equal(inv.complete, false);
  // join() turns it on by itself when fault lines are present.
  assert.equal(join(ADM_JSON, { logText: admissionLog() }).fault.complete, true);
});

// Idle run: the I1 cycle's save at T + 100 s; two observer clients — one
// connected 20 s before (eligible, got the broadcast), one 3 s before
// (too young: not eligible).
const S1 = { k: "s1", mode: "idle-first", rev: 60, songId: "blank", putStart: T + 100_000, putEnd: T + 100_300, putMs: 300 };
const IDLE_JSON = {
  config: { label: "I1-test" },
  idle: {
    config: { maxAgeS: 90 }, verdict: "PASS",
    cycles: [{ name: "I1 — first save after idle", save: S1, verdict: "PASS", elig: { eligible: 20, total: 20, spreadS: 1 }, eligible: { n: 20, received: 20, applied: 20, reasons: { notification: 20 }, repair: { max: null } } }],
    later: [],
  },
};
const OBS = [
  { kind: "meta", host: "runner", connectAt: new Date(T + 80_000).toISOString(), connectedAt: new Date(T + 80_000).toISOString(), readyAt: new Date(T + 81_000).toISOString() },
  { kind: "broadcast", client: 0, t: T + 100_400, rev: 60, what: "n" },
  { kind: "applied", client: 0, t: T + 100_900, rev: 60, reason: "notification" },
  { kind: "applied", client: 1, t: T + 121_000, rev: 60, reason: "periodic" },
  { kind: "client", client: 0, locale: "ja", subscribedAtAll: [T + 80_000], connLog: [[T + 80_000, 1, "SUBSCRIBED"]], fallbacksAll: [] },
  { kind: "client", client: 1, locale: "ko", subscribedAtAll: [T + 97_000], connLog: [[T + 97_000, 1, "SUBSCRIBED"]], fallbacksAll: [] },
].map((o) => JSON.stringify(o)).join("\n");

test("observer clients judged by the same eligibility rule; receipts per save", () => {
  const o = observerClients(OBS);
  assert.equal(o.clients.length, 2);
  assert.equal(o.clients[0].timelines, true);
  const j = join(IDLE_JSON, { observerText: OBS });
  const c = j.cycles[0].observer;
  assert.equal(c.elig.eligible, 1);
  assert.match(c.elig.per.find((p) => p.idx === "obs-1").why, /< 6 s/);
  assert.deepEqual([c.sum.n, c.sum.received, c.sum.applied], [1, 1, 1]);
  const r = j.observer.receipts[0];
  assert.deepEqual([r.n, r.received, r.applied], [2, 1, 2]);
  assert.equal(r.reasons.periodic, 1);
  const md = toMarkdown(j);
  assert.match(md, /\| obs-1 \| .* \| no — connected only 3\.0 s before the save/);
});

test("k6 summary (A1) is optional and rendered when given; a non-step-5 JSON is refused", () => {
  const k6 = { T0: T, arrivals: { total: 500, byShape: { generic: 500 }, p95Ms: 640, fivexx: 0, s503: 0, transport: 0 }, saves: [{ rev: 50, putStart: T + 5000, putEnd: T + 5400, status: 200, admitted: 300, outstanding: 200, httpInFlight: 40 }], shapes: { R2: { notified: 180 } } };
  const md = toMarkdown(join(ADM_JSON, { k6 }));
  assert.match(md, /## k6 admission \(A1\)/);
  assert.match(md, /arrivals 500 by shape \{"generic":500\}; wave p95 640 ms/);
  assert.match(md, /admitted 300, outstanding arrivals 200, HTTP in flight 40/);
  assert.throws(() => join({ config: {} }), /neither an `admission` nor an `idle` section/);
});

test("the viewers.js ADMISSION=1 summary (kind k6-admission) is normalised to the rendered shape", () => {
  const k6 = {
    kind: "k6-admission", version: 1, t0: T,
    arrivals: { total: 500, byShape: { r2: 300, r1: 125, pre: 75 }, latency: { p95: 641.6 } },
    errors: { http5xx: { total: 0 }, http503: { total: 0 }, transport: { total: 1 } },
    saves: [{ rev: 50, putStart: T + 5000, putEnd: T + 5400, status: 200, exposure: { atPutStart: { admitted: 200, outstanding: 300, inFlight: 40 }, atPutEnd: { admitted: 230, outstanding: 270, inFlight: 35 } } }],
    shapeFinal: { r2: { n: 300, ok: 300, rate: 1 } },
    ssr: { rps: 10, requests: 600, latency: { p95: 1200.2 }, errorRate: 0 },
  };
  const n = normaliseK6(k6);
  assert.equal(n.T0, T);
  assert.equal(n.arrivals.p95Ms, 642);
  assert.equal(n.arrivals.transport, 1);
  assert.deepEqual(n.saves[0], { rev: 50, putStart: T + 5000, putEnd: T + 5400, status: 200, admitted: 230, outstanding: 270, httpInFlight: 35 });
  assert.equal(n.ssr.p95Ms, 1200);
  const md = toMarkdown(join(ADM_JSON, { k6 }));
  assert.match(md, /admitted 230, outstanding arrivals 270, HTTP in flight 35/);
  assert.match(md, /transport 1/);
  // The minimal documented shape passes through untouched.
  assert.deepEqual(normaliseK6({ T0: 1 }), { T0: 1 });
});
