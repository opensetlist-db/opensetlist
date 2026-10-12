// node --test tests/load/browsers/spam7.test.mjs
//
// The pure parts of n14 step 7 (spam7.mjs): flag refusals and defaults,
// the slot schedule and forged revs, the exposure maths (per 10 s bucket
// and per client, against the FIXED declared population), the stale
// control's eligibility rule, the strata classification, the request-rate
// buckets / baseline / drain threshold and confirming-interval logic, the
// rebound and cooldown checks, the durable-watermark check, ticket-drop
// recovery, the declared process tree and the verdict precedence.
import test from "node:test";
import assert from "node:assert/strict";
import {
  parseSpam7Flags, DEFAULT_OFFSETS, slotSchedule, forgedRev, firstReceipts, exposure, staleEligibility, pageServerRevAt, classifyStratum,
  latSummary, sdkReqCategory, rateBuckets, rolling, baselineStats, drainThreshold, confirmDrain, aggregateState, sampleAt, reboundRequests,
  cooldownCheck, watermarkViolations, ticketDropRecovery, processTree, spam7Verdict,
} from "./spam7.mjs";

const T0 = Date.UTC(2026, 9, 12, 6, 0, 0);

test("flags: refusals and defaults", () => {
  const p = { phase: "spam7", drill: null };
  assert.equal(parseSpam7Flags({}, { phase: null, drill: null }).cfg, null);
  assert.match(parseSpam7Flags({ "baseline-secs": "60" }, { phase: null, drill: null }).error, /need\(s\) --phase=spam7/);
  assert.match(parseSpam7Flags({}, { ...p, drill: "spam" }).error, /no drill/);
  assert.match(parseSpam7Flags({ "edit-mode": "pair" }, p).error, /mixed/);
  const d = parseSpam7Flags({}, p).cfg;
  assert.deepEqual(d, { baselineSecs: 60, spamSecs: 300, recoverySecs: 60, spamRate: 2, spamRev: "ahead", offsets: DEFAULT_OFFSETS, edits: 12 });
  assert.match(parseSpam7Flags({ "spam-rev": "forged" }, p).error, /--spam-rev/);
  assert.equal(parseSpam7Flags({ "spam-rev": "none" }, p).cfg.spamRev, "none");
  assert.match(parseSpam7Flags({ "spam-rate": "0" }, p).error, /--spam-rate/);
  assert.match(parseSpam7Flags({ "save-offsets": "10,5" }, p).error, /increasing/);
  assert.match(parseSpam7Flags({ "save-offsets": "-70,10" }, p).error, /before the baseline/);
  assert.match(parseSpam7Flags({ "save-offsets": "10,360" }, p).error, /recovery end/);
  assert.match(parseSpam7Flags({ "save-offsets": "1,x" }, p).error, /comma list/);
  // P3: stale holds the head fixed — no save inside [0, spam-secs).
  assert.match(parseSpam7Flags({ "spam-rev": "stale", "spam-secs": "60", "save-offsets": "-20,30" }, p).error, /holds the head fixed/);
  const p3 = parseSpam7Flags({ "spam-rev": "stale", "spam-secs": "60", "save-offsets": "-20,70" }, p).cfg;
  assert.deepEqual([p3.offsets, p3.edits, p3.spamSecs], [[-20, 70], 2, 60]);
  // The repeat's phase shift.
  assert.equal(parseSpam7Flags({ "save-offsets": "12.25,37.25" }, p).cfg.offsets[0], 12.25);
});

test("slot schedule and forged revs", () => {
  const s = slotSchedule(T0, 2, 3);
  assert.deepEqual(s.map((x) => [x.k, x.slotAt - T0]), [[1, 0], [2, 500], [3, 1000], [4, 1500], [5, 2000], [6, 2500]]);
  assert.equal(slotSchedule(T0, 2, 300).length, 600);
  assert.equal(forgedRev("ahead", 41), 42);
  assert.equal(forgedRev("stale", 41), 41);
  assert.equal(forgedRev("max", 41), Number.MAX_SAFE_INTEGER);
});

test("first receipts: duplicates counted apart, earliest kept", () => {
  const { first, dup } = firstReceipts([[1, 100], [2, 200], [1, 90], [null, 5]]);
  assert.equal(dup, 1);
  assert.equal(first.get(1), 90);
  assert.equal(first.size, 2);
});

// 2 msgs/s for 20 s = 40 slots in 2 buckets; every slot sent at its slot
// time with an ok ack unless overridden.
function sends({ skip = new Set(), nack = new Set() } = {}) {
  return slotSchedule(T0, 2, 20).map((x) => ({ ...x, sentAt: skip.has(x.k) ? null : x.slotAt, ack: skip.has(x.k) ? null : nack.has(x.k) ? "timed out" : "ok", ackMs: 20, rev: 9 }));
}
// Every client of `n` receives every sent message `delay` ms after its send.
function clients(n, ss, { delay = 50, except = () => false } = {}) {
  return Array.from({ length: n }, (_, idx) => ({ idx, rows: ss.filter((s) => s.sentAt != null && !except(idx, s.k)).map((s) => [s.k, s.sentAt + delay]) }));
}

test("exposure: full coverage is exercised", () => {
  const ss = sends();
  const e = exposure({ sends: ss, receipts: { sdk: clients(10, ss), pages: clients(3, ss) }, declared: { sdk: 10, pages: 3 }, spamStart: T0, spamSecs: 20 });
  assert.equal(e.exercised, true);
  assert.equal(e.buckets.length, 2);
  assert.equal(e.populations.sdk.bucketMin, 1);
  assert.equal(e.populations.sdk.perClientMin, 1);
  assert.equal(e.populations.pages.timelyTotal, 120);
  assert.equal(e.ackShare, 1);
});

test("exposure: the FIXED declared population counts a missing client against coverage", () => {
  const ss = sends();
  // 20 declared, only 19 recorded: per-bucket timely = 19/20 = 95 % (ok),
  // but the absent client has 0 % → per-client minimum fails.
  const e = exposure({ sends: ss, receipts: { sdk: clients(19, ss) }, declared: { sdk: 20 }, spamStart: T0, spamSecs: 20 });
  assert.equal(e.populations.sdk.bucketMin, 0.95);
  assert.equal(e.populations.sdk.clientsBelow, 1);
  assert.equal(e.exercised, false);
  assert.match(e.reasons.join(";"), /1\/20 client/);
});

test("exposure: one slow bucket fails the per-bucket rule even when the window total is high", () => {
  const ss = sends();
  // Bucket 0 (k 1..20): every delivery late (3 s) for 10 % of slots → 90 % timely in bucket 0.
  const late = new Set([1, 2]);
  const rc = Array.from({ length: 10 }, (_, idx) => ({ idx, rows: ss.map((s) => [s.k, s.sentAt + (late.has(s.k) ? 3000 : 50)]) }));
  const e = exposure({ sends: ss, receipts: { sdk: rc }, declared: { sdk: 10 }, spamStart: T0, spamSecs: 20 });
  assert.equal(e.populations.sdk.bucketShares[0].share, 0.9);
  assert.equal(e.populations.sdk.bucketShares[1].share, 1);
  assert.equal(e.populations.sdk.late, 20);
  assert.equal(e.exercised, false);
  // The window total is 95 % per client — the per-client rule alone passes.
  assert.equal(e.populations.sdk.perClientMin, 38 / 40);
  assert.equal(e.populations.sdk.clientsBelow, 0);
});

test("exposure: sender shortfall and acks", () => {
  // Bucket 1 (k 21..40) loses 2 slots → 18/20 = 90 % sent.
  const ss = sends({ skip: new Set([21, 22]) });
  const e = exposure({ sends: ss, receipts: { sdk: clients(5, ss) }, declared: { sdk: 5 }, spamStart: T0, spamSecs: 20 });
  assert.equal(e.sendMin, 0.9);
  assert.equal(e.skipped, 2);
  assert.match(e.reasons[0], /planned slots sent/);
  // Planned deliveries count the skipped slots too: bucket 1 = 18/20.
  assert.equal(e.populations.sdk.bucketShares[1].share, 0.9);
  // Per client: 38 of 38 SENT messages → 100 %.
  assert.equal(e.populations.sdk.perClientMin, 1);
  const n = exposure({ sends: sends({ nack: new Set([1]) }), receipts: { sdk: [] }, declared: { sdk: 0 }, spamStart: T0, spamSecs: 20 });
  assert.equal(n.ackShare, 39 / 40);
  assert.match(n.reasons.join(";"), /ack ok/);
  assert.equal(exposure({ sends: [], receipts: {}, declared: { sdk: 5 }, spamStart: T0, spamSecs: 20 }).exercised, null);
});

test("stale eligibility: only rev ≤ the client's own serverRev at receipt is judged", () => {
  const byK = new Map([[1, { k: 1, rev: 50 }], [2, { k: 2, rev: 50 }], [3, { k: 3, rev: 50 }]]);
  const r = staleEligibility([
    { idx: 0, rows: [[1, 1, "d", 50], [2, 2, "d", 51]] }, // eligible, ignored
    { idx: 1, rows: [[1, 1, "n", 49], [2, 2, "d", 50]] }, // lagging: noting news is correct; then eligible + ignored
    { idx: 2, rows: [[3, 3, "n", 50], [1, 1, "d", null]] }, // eligible but noted → violation; unknown serverRev
  ], byK);
  assert.deepEqual([r.eligible, r.ignored, r.notedEligible, r.nonEligible, r.nonEligibleNoted, r.unknown], [4, 3, 1, 1, 1, 1]);
  assert.equal(r.pass, false);
  assert.equal(r.examples[0].idx, 2);
  assert.equal(staleEligibility([{ idx: 0, rows: [[1, 1, "n", 10]] }], byK).pass, null);
});

test("page serverRev proxy: highest 200 body rev that arrived before t", () => {
  const f = [[100, null, 200, "cache", 5], [200, 5, 503, null, null], [300, 6, 200, "build", 7], [400, 7, 200, "warm", 6]];
  assert.equal(pageServerRevAt(f, 250), 5);
  assert.equal(pageServerRevAt(f, 500), 7);
  assert.equal(pageServerRevAt(f, 50), null);
});

test("strata classification", () => {
  assert.equal(classifyStratum({ inFlight: false, carriedHint: null, pendingHint: null }), "none");
  assert.equal(classifyStratum({ inFlight: false, carriedHint: 9, carriedHintPhase: "recheck", pendingHint: null }), "queued-ticket");
  assert.equal(classifyStratum({ inFlight: false, carriedHint: null, pendingHint: 9 }), "queued-ticket");
  assert.equal(classifyStratum({ inFlight: true, inFlightReq: { reason: "recheck", hint: 9 }, carriedHint: null, pendingHint: null }), "inflight-ticket");
  assert.equal(classifyStratum({ inFlight: true, inFlightReq: { reason: "notification", hint: 9 } }), "inflight-ticket");
  assert.equal(classifyStratum({ inFlight: true, inFlightReq: { reason: "periodic", hint: 9 } }), "other-ticket-fetch");
  // A generic flight without a ticket while a recheck waits = queued.
  assert.equal(classifyStratum({ inFlight: true, inFlightReq: { reason: "periodic", hint: null }, carriedHint: 9, carriedHintPhase: "recheck" }), "queued-ticket");
  // in flight but the record shows no open row (null) → judged by carried / pending only.
  assert.equal(classifyStratum({ inFlight: true, inFlightReq: null, carriedHint: null, pendingHint: null }), "none");
  assert.equal(classifyStratum(null), null);
});

test("latency summary: missing and > 3 s share; gate", () => {
  const s = latSummary([100, 200, 3500], 0);
  assert.equal(s.over, 1);
  assert.equal(s.overShare, 1 / 3);
  assert.equal(s.pass, false);
  assert.equal(latSummary([100, 200], 1).pass, false);
  assert.equal(latSummary(Array(20).fill(100), 0).pass, true);
  assert.equal(latSummary([], 0).pass, null);
});

test("request categories and 1 s buckets (each request once, by start)", () => {
  assert.equal(sdkReqCategory([0, "notification", 0, 9, 1]), "notification");
  assert.equal(sdkReqCategory([0, "recheck", 0, 9, 0]), "recheck");
  assert.equal(sdkReqCategory([0, "periodic", 1, null, 0]), "generic");
  // A generic carrying a ticket is generic (counted once).
  assert.equal(sdkReqCategory([0, "periodic", 1, 9, 0]), "generic");
  assert.equal(sdkReqCategory([0, "retry", 0, 9, 0]), "other");
  const b = rateBuckets({ from: T0, to: T0 + 3000, sdk: [[T0 + 10, "notification", 200], [T0 + 999, "recheck", 503], [T0 + 1000, "generic", 200], [T0 + 3000, "generic", 200], [T0 - 1, "generic", 200]], pages: [[T0 + 2500, 503, true], [T0 + 2600, 200, false]] });
  assert.equal(b.length, 3);
  assert.deepEqual(b.map((x) => x.total), [2, 1, 2]);
  assert.deepEqual([b[2].pagesHinted, b[2].pagesGeneric], [1, 1]);
  assert.deepEqual(b.map((x) => x.s503), [1, 0, 1]);
  assert.equal(b[0].notification + b[0].recheck, 2);
  assert.equal(b[2].pages, 2);
});

test("rolling 10 s average, baseline μ / s₁₀, drain threshold", () => {
  const r = rolling([10, 10, 10, 20], 2);
  assert.deepEqual(r, [null, 10, 10, 15]);
  // 20 s of baseline: windows [10 avg, 30 avg] → μ 20, s₁₀ = SD(10, 30) = 14.142…
  const b = baselineStats([...Array(10).fill(10), ...Array(10).fill(30)]);
  assert.equal(b.mu, 20);
  assert.deepEqual(b.windows, [10, 30]);
  assert.ok(Math.abs(b.s10 - Math.SQRT2 * 10) < 1e-9);
  assert.equal(baselineStats(Array(9).fill(5)).s10, 0);
  // max(0.5 μ, 2, 2 s₁₀) — never stacked.
  assert.equal(drainThreshold(26, 1), 39);
  assert.equal(drainThreshold(0, 0), 2);
  assert.equal(drainThreshold(10, 4), 18);
});

test("drain: first quiet interval at/after the last send, completed ≤ 30 s, tickets 0 at its end", () => {
  // Buckets from T0: 0..19 s spam (50/s), then quiet (20/s); last send at T0 + 19.5 s.
  const totals = [...Array(20).fill(50), ...Array(60).fill(20)];
  const samples = [];
  for (let s = 0; s <= 80; s++) samples.push({ t: T0 + s * 1000 + 100, pending: 0, carried: s < 32 ? 3 : 0, inFlightTicket: 0 });
  const stateAt = (t) => sampleAt(samples, t);
  const d = confirmDrain({ totals, from: T0, lastSend: T0 + 19500, threshold: 25, stateAt });
  // First quiet window starts at bucket 20 (ceil(19.5)) and ends at 30 s,
  // but 3 tickets are still carried then → the confirming one ends at 32 s.
  assert.equal(d.firstQuiet.from, T0 + 20000);
  assert.equal(d.firstQuiet.stateOk, false);
  assert.equal(d.confirm.to, T0 + 32000);
  assert.equal(d.confirm.completedAfterLastSendMs, 12500);
  assert.equal(d.withinDeadline, true);
  // Completion beyond 30 s is reported but not "within".
  const late = confirmDrain({ totals: [...Array(20).fill(50), ...Array(25).fill(30), ...Array(30).fill(20)], from: T0, lastSend: T0 + 19500, threshold: 25, stateAt: () => ({ pending: 0, carried: 0, inFlightTicket: 0 }) });
  // a = 40: five 30s + five 20s = 25 req/s ≤ 25 → ends at 50 s = 30.5 s after the last send.
  assert.equal(late.confirm.to, T0 + 50000);
  assert.equal(late.withinDeadline, false);
  // Unknown worker state (no sample) never confirms.
  assert.equal(confirmDrain({ totals: Array(30).fill(1), from: T0, lastSend: T0, threshold: 5, stateAt: () => null }).confirm, null);
  // sampleAt: first sample at/after t within the slack.
  assert.equal(sampleAt([{ t: 10 }, { t: 5000 }], 11), null);
  assert.equal(sampleAt([{ t: 10 }, { t: 1500 }], 11).t, 1500);
});

test("worker state aggregate: in-flight ticket joined from the active request record", () => {
  const a = aggregateState(T0, [
    { idx: 0, pendingHint: null, carriedHint: null, inFlight: true, inFlightReq: { reason: "recheck", hint: 9 } },
    { idx: 1, pendingHint: 9, carriedHint: 9, carriedHintPhase: "recheck", inFlight: false, inFlightReq: null },
    { idx: 2, pendingHint: null, carriedHint: null, inFlight: true, inFlightReq: { reason: "periodic", hint: null } },
  ]);
  assert.deepEqual([a.clients, a.pending, a.carried, a.carriedRecheck, a.inFlight, a.inFlightTicket], [3, 1, 1, 1, 2, 1]);
  assert.equal(a.examples.length, 2);
});

test("rebound after the confirming interval: forged tickets / rechecks only", () => {
  const isGenuine = (h, t) => h <= 10 || (h === 11 && t >= T0 + 5000);
  const r = reboundRequests([
    { idx: 0, reqs: [[T0 + 1000, "recheck", 0, 99, 0], [T0 + 2000, "periodic", 1, null, 0]] },
    { idx: 1, reqs: [[T0 + 6000, "notification", 0, 11, 1], [T0 + 7000, "notification", 0, 12, 1], [T0 + 99000, "recheck", 0, 99, 0]] },
  ], { from: T0, to: T0 + 10000, isGenuine });
  assert.equal(r.count, 2);
  assert.equal(r.genuine, 1);
  assert.deepEqual(r.byReason, { recheck: 1, notification: 1 });
});

test("cooldown: ticket-carrying starts per client", () => {
  const c = cooldownCheck([
    { idx: 0, reqs: [[T0, "notification", 0, 9, 1], [T0 + 1200, "recheck", 0, 9, 0], [T0 + 1300, "periodic", 1, null, 0]] },
    { idx: 1, reqs: [[T0, "notification", 0, 9, 1], [T0 + 600, "retry", 0, 9, 0]] },
  ], { from: T0, to: T0 + 5000, cooldownMs: 1000 });
  assert.equal(c.tooClose, 1);
  assert.equal(c.clientsBad, 1);
  assert.equal(c.minGap, 600);
  assert.equal(c.pass, false);
});

test("durable watermark: only genuine committed revisions, never before their save", () => {
  const genuine = new Map([[11, T0 + 1000], [12, T0 + 2000]]);
  const w = watermarkViolations([
    { idx: 0, serverRevLog: [[T0, 10], [T0 + 1500, 11], [T0 + 2500, 12]] },
    { idx: 1, serverRevLog: [[T0 + 500, 11]] }, // an `ahead` forgery held before its save started
    { idx: 2, serverRevLog: [[T0 + 500, Number.MAX_SAFE_INTEGER]] },
    { idx: 3, serverRevLog: [[T0 + 99000, 13]] }, // after the measurement (clean-up): not checked
  ], { genuine, initialHead: 10, until: T0 + 10000 });
  assert.equal(w.checked, 5);
  assert.equal(w.violations, 2);
  assert.equal(w.clients, 2);
  assert.equal(w.pass, false);
  assert.match(w.examples[0].why, /before the save/);
  assert.match(w.examples[1].why, /not a committed revision/);
});

test("ticket-drop recovery: stale → generic convergence without an intervening save", () => {
  const saves = [{ rev: 11, start: T0 + 1000, commitAt: T0 + 1200 }, { rev: 12, start: T0 + 60000, commitAt: T0 + 60200 }];
  const isForged = (h) => h > 12;
  const r = ticketDropRecovery([
    // behind (10 < 11) when the forged 99 ticket exhausts; periodic brings 11 before save 12.
    { idx: 0, exhausted: [[T0 + 5000, 99]], appliedAll: [[T0, 10, "initial"], [T0 + 20000, 11, "periodic"]] },
    // current: had 11 already.
    { idx: 1, exhausted: [[T0 + 5000, 99]], appliedAll: [[T0 + 1500, 11, "notification"]] },
    // behind; only the later save repairs it.
    { idx: 2, exhausted: [[T0 + 5000, 99]], appliedAll: [[T0, 10, "initial"], [T0 + 61000, 12, "notification"]] },
    // a genuine ticket exhausting is not counted.
    { idx: 3, exhausted: [[T0 + 5000, 11]], appliedAll: [[T0, 10, "initial"]] },
    // behind and never converged.
    { idx: 4, exhausted: [[T0 + 5000, 99]], appliedAll: [[T0, 10, "initial"]] },
  ], { saves, initialHead: 10, isForged, until: T0 + 90000 });
  assert.deepEqual(r.counts, { forgedExhausted: 4, current: 1, recovered: 1, "repaired-by-save": 1, "ticket-path": 0, "not-converged": 1 });
  assert.equal(r.exercised, true);
  assert.equal(r.rows.find((x) => x.cls === "recovered").delayMs, 15000);
});

test("declared process tree: descendants by parent pid only", () => {
  const procs = [{ pid: 10, ppid: 1 }, { pid: 11, ppid: 10 }, { pid: 12, ppid: 11 }, { pid: 13, ppid: 1 }, { pid: 14, ppid: 99 }];
  assert.deepEqual([...processTree(procs, 10)].sort(), [10, 11, 12]);
  assert.deepEqual([...processTree(procs, 77)], [77]);
});

test("verdict precedence: INVALID > FAIL > NOT EXERCISED > PASS", () => {
  const ok = [{ name: "a", pass: true }, { name: "b", pass: null }];
  const bad = [...ok, { name: "c", pass: false }];
  assert.equal(spam7Verdict({ invalid: true, gates: bad, notExercised: ["x"] }).exit, 3);
  const f = spam7Verdict({ invalid: false, gates: bad, notExercised: ["x"] });
  assert.deepEqual([f.verdict, f.exit, f.failed], ["VALID + FAIL", 1, ["c"]]);
  assert.equal(spam7Verdict({ invalid: false, gates: ok, notExercised: ["x"] }).exit, 4);
  assert.deepEqual(spam7Verdict({ invalid: false, gates: ok, notExercised: [] }), { verdict: "VALID + PASS", exit: 0, failed: [], notExercised: [] });
});
