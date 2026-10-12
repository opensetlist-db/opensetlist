// node --test tests/load/browsers/transition.test.mjs
//
// The pure parts of n14 step 6 (transition.mjs): flag refusals, the
// switch-file protocol, the save schedule and the leg quiet, pin
// evidence and the probe's resolution, the live routing rules, the hold
// gate's state machine, the predeclared exposure classifications, the
// outcome / receipt / readiness helpers and the verdict vocabulary.
import test from "node:test";
import assert from "node:assert/strict";
import {
  parseTransitionFlags, signedList, parseSwitchFile, saveSchedule, quietDue, waves, pinEvidence, isPinned, dplIdOf, probeResolution,
  firstTargetLive, routingProfile, boundaryOf, releaseAt, createHoldGate, Q, SDK_ROW_TX, pendingHinted, pendingRecheck, oldAnswerAfterCutover,
  arrivalExposure, headAt, clientOutcome, broadcastReceipt, updateGap, pageBuild, pageReadyAt, timeToUsable, staleFirstAfter, firstRowsAt,
  continuityVerdict, transitionVerdict,
} from "./transition.mjs";

const P = Date.UTC(2026, 9, 12, 6, 0, 0);

// An SDK request row with the transition columns (subs-worker.mjs).
function row(o) {
  const r = new Array(SDK_ROW_TX.length).fill(null);
  r[Q.notify] = 0;
  r[Q.synthetic] = 0;
  r[Q.pin] = "none";
  for (const [k, v] of Object.entries(o)) r[Q[k]] = v;
  return r;
}

test("flags: refusals and defaults", () => {
  const base = { phase: "transition", drill: null, deploymentUrl: false, subs: 470 };
  assert.equal(parseTransitionFlags({}, { ...base, phase: null }).cfg, null);
  assert.match(parseTransitionFlags({ "switch-files": "a.json" }, { ...base, phase: null }).error, /need\(s\) --phase=transition/);
  assert.match(parseTransitionFlags({}, base).error, /--switch-files/);
  assert.match(parseTransitionFlags({ "switch-files": "a.json" }, { ...base, drill: "spam" }).error, /no drill/);
  assert.match(parseTransitionFlags({ "switch-files": "a.json" }, { ...base, deploymentUrl: true }).error, /ALIAS/);
  assert.match(parseTransitionFlags({ "switch-files": "a.json,a.json" }, base).error, /twice/);
  assert.match(parseTransitionFlags({ "switch-files": "a.json", "transition-saves": "1,5" }, base).error, /before/);
  assert.match(parseTransitionFlags({ "switch-files": "a.json", "transition-saves": "-1,-5,3" }, base).error, /increasing/);
  assert.match(parseTransitionFlags({ "switch-files": "a.json", arrivals: "10" }, base).error, /arrivals/);
  assert.match(parseTransitionFlags({ "switch-files": "a.json", "hold-subset": "300" }, base).error, /out of range/);
  assert.match(parseTransitionFlags({ "switch-files": "a.json", "hold-subset": "3", "ahead-hint-subset": "2" }, { ...base, subs: 5 }).error, /carved out/);
  assert.match(parseTransitionFlags({ "switch-files": "a.json", "route-window": "-10,20,30" }, base).error, /route-window/);
  const c = parseTransitionFlags({ "switch-files": "a.json, b.json" }, base).cfg;
  assert.deepEqual(c.files, ["a.json", "b.json"]);
  assert.deepEqual(c.savesS, [-30, -1, 1, 5, 11, 15, 30, 60]);
  assert.equal(c.legGapS, 90);
  assert.deepEqual(c.arrivals, { pages: 10, sdk: 100, atS: 10 });
  assert.equal(c.r1Cohort, 15);
  assert.equal(c.hold.n, 20);
  assert.deepEqual(c.hold.atS, [-1, 1, 3]);
  assert.equal(c.ahead.n, 20);
  assert.equal(c.ahead.offset, 5);
  assert.deepEqual(c.ahead.atS, [-1.2]);
  assert.equal(c.continuityMs, 30000);
  assert.deepEqual(c.min, { pending: 20, recheck: 5, old: 5, arrivalSdk: 20, arrivalPages: 3 });
  const smoke = parseTransitionFlags({ "switch-files": "s.json", arrivals: "1,2", "hold-subset": "1", "ahead-hint-subset": "1" }, { ...base, subs: 5 }).cfg;
  assert.deepEqual(smoke.arrivals, { pages: 1, sdk: 2, atS: 10 });
  assert.equal(smoke.hold.n + smoke.ahead.n, 2);
  assert.deepEqual(signedList("-30,+1,5", "x").list, [-30, 1, 5]);
});

test("switch file: two-step protocol, BOM, validation", () => {
  assert.equal(parseSwitchFile("").error, "empty");
  assert.match(parseSwitchFile('{"plannedAt":').error, /not JSON/);
  assert.match(parseSwitchFile('{"kind":"r1"}').error, /plannedAt/);
  assert.match(parseSwitchFile(JSON.stringify({ plannedAt: new Date(P).toISOString(), kind: "rollback" })).error, /kind/);
  assert.match(parseSwitchFile(JSON.stringify({ plannedAt: P, afterSwitchSaves: "update" })).error, /need insert/);
  assert.match(parseSwitchFile(JSON.stringify({ plannedAt: P, afterSwitchSaves: "insert,drop" })).error, /subset/);
  assert.match(parseSwitchFile(JSON.stringify({ plannedAt: P, cliStart: P + 5000, cliEnd: P })).error, /before cliStart/);
  const a = parseSwitchFile("﻿" + JSON.stringify({ plannedAt: new Date(P).toISOString(), kind: "return-from-r1", label: "R1→ON-C", afterSwitchSaves: "delete,insert,update" }));
  assert.equal(a.plannedAt, P);
  assert.equal(a.kind, "return-from-r1");
  assert.deepEqual(a.afterSwitchSaves, ["insert", "update", "delete"]);
  assert.equal(a.complete, false);
  const b = parseSwitchFile(JSON.stringify({ plannedAt: P, cliStart: new Date(P + 100).toISOString(), cliEnd: P + 4200, cliCpuMs: 812, target: { url: "https://opensetlist-abc123def-opensetlist-projects.vercel.app/", id: "dpl_X" } }));
  assert.equal(b.complete, true);
  assert.equal(b.cliStart, P + 100);
  assert.equal(b.target.url, "https://opensetlist-abc123def-opensetlist-projects.vercel.app");
  assert.equal(b.cliCpuMs, 812);
});

test("schedule, leg quiet, waves", () => {
  assert.deepEqual(saveSchedule(P, [-30, 1.5]).map((s) => s.due), [P - 30000, P + 1500]);
  assert.deepEqual(quietDue(P, null, 90), { due: P, delayMs: 0 });
  assert.deepEqual(quietDue(P, P - 100000, 90), { due: P, delayMs: 0 });
  assert.deepEqual(quietDue(P, P - 60000, 90), { due: P + 30000, delayMs: 30000 });
  assert.deepEqual(waves([1, 2, 3, 4, 5], [-1, 1]).map((w) => w.idxs), [[1, 3, 5], [2, 4]]);
});

test("pin evidence, dpl id, probe resolution", () => {
  assert.equal(pinEvidence("https://h/api/setlist?eventId=1", {}), "none");
  assert.equal(pinEvidence("/_next/static/a.js?dpl=dpl_A", {}), "query=dpl_A");
  assert.equal(pinEvidence("https://h/api/setlist", { "x-deployment-id": "dpl_B", cookie: "a=1; __vdpl=dpl_C; b=2" }), "header=dpl_B|cookie=dpl_C");
  assert.equal(isPinned("none"), false);
  assert.equal(isPinned("cookie=dpl_C"), true);
  assert.equal(dplIdOf('<html lang="ja" data-dpl-id="dpl_FAt2Sp33"><head>'), "dpl_FAt2Sp33");
  assert.equal(dplIdOf("<html>"), null);
  assert.equal(probeResolution(10, null, null), "none");
  assert.equal(probeResolution(10, 10, null), "satisfied");
  // R1: no verify header → below-hint answers are inconclusive.
  assert.equal(probeResolution(9, 10, null), "inconclusive");
  assert.equal(probeResolution(9, 10, "fresh=9"), "disproved");
  assert.equal(probeResolution(null, 10, "none"), "inconclusive");
});

test("live routing: first target, pseudo-switch, profile, boundary, release", () => {
  const rows = [
    { reqStart: P - 1000, respAt: P - 900, dpl: "dpl_A" },
    { reqStart: P + 1000, respAt: P + 1100, dpl: "dpl_A" },
    { reqStart: P + 2000, respAt: P + 2150, dpl: "dpl_B" },
    { reqStart: P + 2400, respAt: P + 2600, dpl: "dpl_A" },
    { reqStart: P + 3000, respAt: P + 3100, dpl: "dpl_B" },
  ];
  assert.equal(firstTargetLive(rows, { baseline: "dpl_A", targetId: null }).row.respAt, P + 2150);
  assert.equal(firstTargetLive(rows, { baseline: "dpl_A", targetId: "dpl_C" }), null);
  // Pseudo (T0): target = baseline → the first marker started after cliEnd.
  assert.equal(firstTargetLive(rows, { baseline: "dpl_A", targetId: "dpl_A", cliEnd: P + 1500 }).row.reqStart, P + 2400);
  assert.equal(firstTargetLive(rows, { baseline: "dpl_A", targetId: "dpl_A" }), null);
  const ft = firstTargetLive(rows, { baseline: "dpl_A", targetId: "dpl_B" }).row;
  const prof = routingProfile(rows, { baseline: "dpl_A", targetId: "dpl_B", firstTarget: ft, windowMs: 1000 });
  assert.equal(prof.lastOldReqStart, P + 2400);
  assert.equal(prof.lastOldResponse, P + 2600);
  assert.equal(prof.offTarget, 1);
  assert.equal(prof.sustained, false);
  assert.deepEqual(boundaryOf({ firstTarget: ft, cliEnd: P + 5000 }), { at: P + 2150, how: "route marker (data-dpl-id)" });
  assert.equal(boundaryOf({ firstTarget: null, cliEnd: P + 5000 }).at, P + 5000);
  assert.equal(boundaryOf({ firstTarget: null, cliEnd: null }).at, null);
  assert.deepEqual(releaseAt({ firstTargetAt: P + 2150, plannedAt: P, capS: 30 }), { at: P + 2350, why: "target+200ms" });
  assert.deepEqual(releaseAt({ firstTargetAt: null, plannedAt: P, capS: 30 }), { at: P + 30000, why: "cap" });
  assert.deepEqual(releaseAt({ firstTargetAt: P + 29900, plannedAt: P, capS: 30 }), { at: P + 30000, why: "cap" });
});

test("hold gate: idle passes, armed holds, release resolves all, re-arm", async () => {
  let t = 1000;
  const g = createHoldGate(() => t);
  assert.equal(g.hold(1), null);
  g.arm();
  const a = g.hold(1);
  t = 1100;
  const b = g.hold(2);
  assert.equal(g.snapshot().entries.length, 2);
  t = 3000;
  assert.equal(g.release("target+200ms"), 2);
  const [ea, eb] = await Promise.all([a, b]);
  assert.deepEqual([ea.heldAt, ea.releasedAt, eb.heldAt], [1000, 3000, 1100]);
  assert.equal(g.state, "released");
  assert.equal(g.hold(3), null);
  assert.equal(g.release(), 0);
  assert.equal(g.snapshot().why, "target+200ms");
  g.arm();
  assert.equal(g.snapshot().entries.length, 0);
  assert.notEqual(g.hold(4), null);
});

test("exposure: pending hinted fetch across the boundary", () => {
  const cliStart = P;
  const boundary = P + 3000;
  const clients = [
    { idx: 1, reqs: [row({ tStart: P - 200, notify: 1, tEnd: P + 3500, hint: 9, status: 200, res: "satisfied" })] },
    { idx: 2, reqs: [row({ tStart: P - 200, notify: 1, tEnd: P + 100, hint: 9 })] },
    { idx: 3, reqs: [row({ tStart: P + 10, notify: 1, tEnd: P + 4000, hint: 9 })] },
    { idx: 4, reqs: [row({ tStart: P - 10, notify: 1, tEnd: null, hint: 9 })] },
    { idx: 5, reqs: [row({ tStart: P - 10, notify: 1, tEnd: P + 9000, hint: 9, synthetic: 1 })] },
  ];
  const x = pendingHinted(clients, { cliStart, boundary, min: 2 });
  assert.deepEqual(x.rows.map((r) => r.idx), [1, 4]);
  assert.equal(x.exercised, true);
  assert.equal(pendingHinted(clients, { cliStart: null, boundary, min: 1 }).exercised, false);
});

test("exposure: pending recheck queued vs dispatched (synthetic tickets only)", () => {
  const syn = [42];
  const c = (idx, nEnd, rc) => ({ idx, reqs: [row({ tStart: nEnd - 150, reason: "notification", notify: 1, hint: 42, res: "inconclusive", tEnd: nEnd, recheckQueued: 1, synthetic: 1 }), ...(rc ? [row({ tStart: rc[0], reason: "recheck", hint: 42, tEnd: rc[1], res: "disproved", synthetic: 1 })] : [])] });
  const clients = [
    c(1, P - 800, [P + 300, P + 450]), // queued across cliStart
    c(2, P - 1500, [P - 100, P + 80]), // dispatched, unsettled at cliStart
    c(3, P - 2500, [P - 1400, P - 1200]), // settled before
    c(4, P + 200, [P + 1300, P + 1400]), // inconclusive only after cliStart
    { idx: 5, reqs: [row({ tStart: P - 900, reason: "notification", notify: 1, hint: 42, res: "disproved", tEnd: P - 700, verify: "fresh", synthetic: 1 })] },
  ];
  const x = pendingRecheck(clients, { cliStart: P, syntheticRevs: syn, min: 2 });
  assert.deepEqual([x.queued, x.dispatched, x.count, x.exercised], [1, 1, 2, true]);
  assert.equal(x.per.find((p) => p.idx === 3).state, "recheck settled before cliStart");
  assert.equal(x.per.find((p) => p.idx === 4).state, "inconclusive after cliStart");
  assert.match(x.per.find((p) => p.idx === 5).state, /disproved/);
});

test("exposure: old answer after cutover, then convergence without regression", () => {
  const cliStart = P;
  const boundary = P + 2000;
  const clients = [
    // held: dispatched before, evaluated after the boundary, then converged
    { idx: 1, reqs: [row({ tStart: P - 900, status: 200, evalAt: P + 2200, heldAt: P - 700, releasedAt: P + 2200, rev: 10 })], applied: [[P + 2200, 10], [P + 5000, 12]] },
    // regression after → not ok
    { idx: 2, reqs: [row({ tStart: P - 900, status: 200, evalAt: P + 2300, rev: 10 })], applied: [[P + 2300, 11], [P + 2400, 10], [P + 5000, 12]] },
    // evaluated before the boundary → not a candidate
    { idx: 3, reqs: [row({ tStart: P - 900, status: 200, evalAt: P + 1000, rev: 10 })], applied: [[P + 5000, 12]] },
    // never converged
    { idx: 4, reqs: [row({ tStart: P - 900, status: 200, evalAt: P + 2500, rev: 10 })], applied: [[P + 2500, 10]] },
  ];
  const x = oldAnswerAfterCutover(clients, { cliStart, boundary, headRev: 12, min: 1 });
  assert.equal(x.candidates, 3);
  assert.equal(x.count, 1);
  assert.equal(x.per.find((p) => p.idx === 2).regressions, 1);
  assert.equal(x.exercised, true);
});

test("arrival exposure: SDK unjoined at the PUT response, pages incomplete", () => {
  const save = { putStart: P + 11000, putEnd: P + 11400, rev: 20 };
  const sdk = [
    { idx: 1, subscribedAt: [P + 10500], connLog: [[P + 10500, 1, "SUBSCRIBED"]] },
    { idx: 2, subscribedAt: [P + 11600], connLog: [[P + 11600, 1, "SUBSCRIBED"]] },
    { idx: 3, subscribedAt: [], connLog: [] },
  ];
  const pages = [
    { navStart: P + 10100, completeAt: P + 12000 },
    { navStart: P + 10200, completeAt: P + 10900 },
    { navStart: P + 12000, completeAt: P + 13000 },
  ];
  const x = arrivalExposure(sdk, pages, save, { sdkMin: 2, pagesMin: 1 });
  assert.deepEqual([x.sdk.unjoined, x.sdk.connected, x.sdk.exposed], [2, 1, true]);
  assert.deepEqual([x.pages.incomplete, x.pages.future, x.pages.settled, x.pages.exposed], [1, 1, 1, true]);
});

test("outcomes, head, receipt, gaps", () => {
  const saves = [{ rev: 10, putEnd: P + 500 }, { rev: 11, putEnd: P + 2500 }];
  assert.equal(headAt(saves, P), null);
  assert.equal(headAt(saves, P + 1000), 10);
  assert.equal(headAt(saves, P + 3000), 11);
  const save = { rev: 10, putStart: P, putEnd: P + 500 };
  const opt = { clock: P, timeoutMs: 30000 };
  assert.deepEqual(clientOutcome({ applied: [[P + 900, 10, "notification"]] }, save, opt), { outcome: "satisfied-first-fetch", ms: 900, superseded: false, exhausted: false });
  assert.equal(clientOutcome({ applied: [[P + 2100, 10, "recheck"]] }, save, opt).outcome, "rechecked");
  const rep = clientOutcome({ applied: [[P + 21000, 11, "periodic"]], exhausted: [[P + 3000, 10]] }, save, opt);
  assert.deepEqual([rep.outcome, rep.superseded, rep.exhausted], ["periodic-repaired", true, true]);
  assert.equal(clientOutcome({ applied: [[P + 31000, 10, "periodic"]] }, save, opt).outcome, "missing");
  const conn = (t) => [[t, 1, "SUBSCRIBED"]];
  const r = broadcastReceipt([
    { idx: 1, connLog: conn(P - 5000), bcasts: [[P + 600, 10, "n"]] },
    { idx: 2, connLog: conn(P - 5000), bcasts: [[P + 600, 10, "s"]] },
    { idx: 3, connLog: [[P - 5000, 1, "SUBSCRIBED"], [P + 2000, 0, "CLOSED"]], bcasts: [] },
    { idx: 4, connLog: conn(P + 100), bcasts: [] },
  ], save);
  assert.deepEqual([r.eligible, r.received, r.missingIdx], [2, 1, [2]]);
  const reqs = [row({ status: 200, tEnd: P }), row({ status: 0, tEnd: P + 1000 }), row({ status: 200, tEnd: P + 5000 }), row({ status: 200, tEnd: P + 6000 })];
  assert.equal(updateGap(reqs, P, P + 10000), 5000);
  assert.equal(updateGap(reqs.slice(0, 1), P, P + 10000), null);
});

test("page build, readiness per cohort, time to usable, rows", () => {
  const r1 = { pgReadyAt: [P + 900], joinAt: [P + 700], notes: [], navStart: P, completeAt: P + 600 };
  const r2 = { pgReadyAt: [], joinAt: [P + 1200], notes: [], navStart: P, completeAt: P + 800 };
  assert.equal(pageBuild(r1), "r1");
  assert.equal(pageBuild(r2), "r2");
  assert.equal(pageBuild({ pgReadyAt: [], joinAt: [], notes: [] }), "unknown");
  assert.equal(pageBuild({ pgReadyAt: [], joinAt: [], notes: [[P, "U", "1"]] }), "r1");
  assert.equal(pageReadyAt(r1), P + 900);
  assert.equal(pageReadyAt(r2), P + 1200);
  // The LATER of complete setlist and readiness.
  assert.equal(timeToUsable(r1), 900);
  assert.equal(timeToUsable(r2), 1200);
  assert.equal(timeToUsable({ ...r2, completeAt: null }), null);
  const log = [[P, ["1", "2"]], [P + 500, ["1", "", "2"]], [P + 900, ["1", "7", "2"]]];
  assert.equal(firstRowsAt(log, P + 100, (rows) => rows.length === 3), P + 500);
  assert.equal(firstRowsAt(log, P + 100, (rows) => rows.includes("7")), P + 900);
  assert.equal(firstRowsAt(log, P + 1000, (rows) => rows.length === 4), null);
});

test("stale first answers after an existing-ON return", () => {
  const saves = [{ rev: 10, putEnd: P - 5000 }, { rev: 11, putEnd: P + 1000 }];
  const x = staleFirstAfter([
    { who: "a", tStart: P - 100, rev: 9 },
    { who: "b", tStart: P + 200, rev: 10 },
    { who: "c", tStart: P + 200, rev: 9 },
    { who: "d", tStart: P + 2000, rev: 10 },
    { who: "e", tStart: P + 2000, rev: null },
  ], saves, P);
  assert.deepEqual([x.eligible, x.stale, x.unknown], [4, 2, 1]);
  assert.deepEqual(x.staleList.map((r) => [r.who, r.head]), [["c", 10], ["d", 11]]);
});

test("verdicts", () => {
  assert.deepEqual(continuityVerdict([{ name: "a", pass: true }, { name: "b", pass: null }]), { pass: true, failed: [] });
  assert.deepEqual(continuityVerdict([{ name: "a", pass: false }]).failed, ["a"]);
  const ok = { k: 1, verdicts: { continuity: "PASS", performance: "PASS" }, exposureVerdicts: { pendingHinted: "EXERCISED" } };
  assert.equal(transitionVerdict({ invalid: true, switches: [ok] }).exit, 3);
  assert.deepEqual([transitionVerdict({ invalid: false, switches: [ok] }).verdict, transitionVerdict({ invalid: false, switches: [ok] }).exit], ["VALID + PASS", 0]);
  const ne = { ...ok, exposureVerdicts: { pendingHinted: "NOT EXERCISED" } };
  assert.equal(transitionVerdict({ invalid: false, switches: [ok, ne] }).exit, 4);
  const fail = { ...ne, verdicts: { continuity: "PASS", performance: "FAIL" } };
  const v = transitionVerdict({ invalid: false, switches: [fail] });
  assert.deepEqual([v.verdict, v.exit, v.failed], ["VALID + FAIL", 1, ["switch 1 performance"]]);
});
