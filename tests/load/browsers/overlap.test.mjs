// node --test tests/load/browsers/overlap.test.mjs
//
// Pins the pure parts of `run.mjs --drill=overlap` (overlap.mjs): the
// flags and their refusal rules, the gate anchoring (last original
// request start, head = highest committed rev), group convergence, the
// SDK (rev, capturedAt) monotonicity, the page-stall SUSPECT rule, the
// reload / role / reaction gates and the reaction ack-hold verdict. The
// I/O around them is exercised by the smoke run (README).
import test from "node:test";
import assert from "node:assert/strict";
import {
  parseOverlapFlags, faultSpecProblem, groupAnchor, pageGroupConvergence, sdkGroupConvergence, subMonotonicityRC,
  pageStallSuspect, reloadVerdict, roleLatency, reactionVerdict, ackHoldVerdict, rolesOf,
} from "./overlap.mjs";
import { editorContentOk } from "./admin.mjs";

test("flags: defaults, values, refusals", () => {
  assert.deepEqual(parseOverlapFlags({}, { drill: null, deploymentUrl: false }), { cfg: null });
  assert.match(parseOverlapFlags({ "overlap-gap": "300" }, { drill: "double-save", deploymentUrl: false }).error, /--overlap-gap need\(s\) --drill=overlap/);
  const d = parseOverlapFlags({}, { drill: "overlap", deploymentUrl: false }).cfg;
  assert.deepEqual(d, { gapMs: 250, thirdAtMs: 0, faultA: null, reloadAt: [], catalogAtMs: 0, reactions: 0, pageReaction: false, probes: true, quietTailS: 0 });
  assert.deepEqual(rolesOf(d), ["A", "B"]);
  const f = parseOverlapFlags({
    "overlap-gap": "250", "overlap-third-at": "500", "overlap-reload-at": "150,450", "overlap-catalog-at": "400",
    "overlap-reactions": "40", "overlap-page-reaction": "1", "overlap-probes": "0", "overlap-quiet-tail": "120",
  }, { drill: "overlap", deploymentUrl: false }).cfg;
  assert.deepEqual(f, { gapMs: 250, thirdAtMs: 500, faultA: null, reloadAt: [150, 450], catalogAtMs: 400, reactions: 40, pageReaction: true, probes: false, quietTailS: 120 });
  assert.deepEqual(rolesOf(f), ["A", "B", "C"]);
  // The header fault needs a deployment URL: the dev alias is never armed.
  assert.match(parseOverlapFlags({ "overlap-fault-a": "slowset=1500" }, { drill: "overlap", deploymentUrl: false }).error, /refusing: --overlap-fault-a needs --deployment-url/);
  assert.equal(parseOverlapFlags({ "overlap-fault-a": "slowset=1500" }, { drill: "overlap", deploymentUrl: true }).cfg.faultA, "slowset=1500");
  // Lookup-side modes, bad values, bad shapes.
  assert.match(parseOverlapFlags({ "overlap-fault-a": "slow=400" }, { drill: "overlap", deploymentUrl: true }).error, /not a job-side mode/);
  assert.match(parseOverlapFlags({ "overlap-fault-a": "absent" }, { drill: "overlap", deploymentUrl: true }).error, /not a job-side mode/);
  assert.equal(faultSpecProblem("slowset=1500,locale=ja"), null);
  assert.equal(faultSpecProblem("slowbuild=1500"), null);
  assert.equal(faultSpecProblem("seterror"), null);
  assert.match(faultSpecProblem("seterror=1"), /takes no value/);
  assert.match(faultSpecProblem("slowset"), /positive integer/);
  assert.match(faultSpecProblem("locale=fr"), /ko\|ja\|en/);
  assert.match(faultSpecProblem("slowset=1 500"), /whitespace/);
  // Above the server's caps: refused here, not as 400s on every A save.
  assert.match(faultSpecProblem("slowbuild=6000"), /capped at 5000 ms/);
  assert.match(faultSpecProblem("slowset=10001"), /capped at 10000 ms/);
  assert.match(faultSpecProblem("slowjob=10001"), /capped at 10000 ms/);
  assert.equal(faultSpecProblem("slowbuild=5000"), null);
  assert.equal(faultSpecProblem("slowset=10000"), null);
  assert.match(parseOverlapFlags({ "overlap-third-at": "200" }, { drill: "overlap", deploymentUrl: false }).error, /later than --overlap-gap/);
  assert.match(parseOverlapFlags({ "overlap-reload-at": "150,x" }, { drill: "overlap", deploymentUrl: false }).error, /comma list/);
  assert.match(parseOverlapFlags({ "overlap-gap": "-5" }, { drill: "overlap", deploymentUrl: false }).error, /integer ≥ 0/);
  assert.match(parseOverlapFlags({ "overlap-page-reaction": "yes" }, { drill: "overlap", deploymentUrl: false }).error, /0\|1/);
});

test("gate anchoring: head = highest committed rev, clock = last ORIGINAL start", () => {
  // A started first, B 250 ms later, yet the Event row lock let B commit
  // first (rev 30 < 31): the head is A's rev, the clock B's start.
  const saves = [
    { who: "A", startedAt: 1000, ms: 600, status: 200, rev: 31 },
    { who: "B", startedAt: 1250, ms: 300, status: 200, rev: 30 },
  ];
  const a = groupAnchor(saves);
  assert.equal(a.head, 31);
  assert.equal(a.headWho, "A");
  assert.equal(a.lastStart, 1250);
  assert.equal(a.firstStart, 1000);
  assert.equal(a.lastResponse, 1600);
  assert.equal(a.allOk, true);
  assert.deepEqual(a.older, [{ who: "B", rev: 30 }]);
  // A failed save still counts for the clock (the operator clicked) but
  // not for the head, and the group is not allOk.
  const b = groupAnchor([...saves, { who: "C", startedAt: 1500, ms: 100, status: 503, rev: null }]);
  assert.equal(b.lastStart, 1500);
  assert.equal(b.head, 31);
  assert.equal(b.allOk, false);
});

test("group convergence: pages need every committed marker, SDK the head", () => {
  const opt = { from: 1250, firstStart: 1000, deadline: 1250 + 30000 };
  assert.deepEqual(pageGroupConvergence({ 7: 2000, 8: 2600 }, ["7", "8"], opt), { ok: true, lat: 1350, latFirst: 1600, missing: [] });
  assert.equal(pageGroupConvergence({ 7: 2000 }, ["7", "8"], opt).ok, false);
  // Intermediate revs may be skipped: a client that jumped straight to the
  // head converged.
  assert.deepEqual(sdkGroupConvergence([[1900, 29], [2300, 31]], 31, opt), { ok: true, lat: 1050, latFirst: 1300 });
  assert.equal(sdkGroupConvergence([[1900, 30]], 31, opt).ok, false);
});

test("SDK (rev, capturedAt) monotonicity", () => {
  assert.equal(subMonotonicityRC([[1, 30, "n", 100], [2, 31, "n", 200], [3, 31, "p", 250]]).regressions.length, 0);
  assert.equal(subMonotonicityRC([[1, 31, "n", 200], [2, 30, "p", 300]]).regressions.length, 1);
  // Same rev, older capture applied after a newer one.
  const r = subMonotonicityRC([[1, 31, "n", 200], [2, 31, "p", 150]]);
  assert.equal(r.regressions.length, 1);
  assert.match(r.regressions[0].what, /capturedAt/);
  // No capturedAt (older server): rev only.
  assert.equal(subMonotonicityRC([[1, 31, "n", null], [2, 31, "p", 150]]).regressions.length, 0);
});

test("SUSPECT: ≥ 80 % warm/cache yet all > 1 s; flag only", () => {
  const row = (src, s, e) => [0, "ja", s, e, src, "satisfied", 30];
  const stall = Array.from({ length: 30 }, () => row("warm", 100, 2400));
  assert.equal(pageStallSuspect(stall, 30).suspect, true);
  // One fast hit breaks "all > 1 s".
  assert.equal(pageStallSuspect([...stall.slice(1), row("warm", 100, 300)], 30).suspect, false);
  // Mostly builds: < 80 % hits → not the stall signature.
  assert.equal(pageStallSuspect([...stall.slice(0, 20), ...Array.from({ length: 10 }, () => row("build", 100, 2400))], 30).suspect, false);
  // Too few pages to call it.
  assert.equal(pageStallSuspect(stall.slice(0, 2), 2).suspect, false);
});

test("reloads, per-role PUT latency, raw reactions", () => {
  const r = reloadVerdict([
    { k: 1, status: 200, contentOk: true, ms: 800 },
    { k: 1, status: 200, contentOk: false, ms: 400 }, // a 200 that is not the editor
    { k: "control", status: 200, contentOk: true, ms: 500 },
    { k: "control", status: 200, contentOk: true, ms: 600 },
  ]);
  assert.equal(r.pass, false);
  assert.equal(r.window.bad, 1);
  assert.equal(r.control.p50, 500);
  assert.equal(reloadVerdict([{ k: 2, status: 200, contentOk: true, ms: 3100 }]).pass, false);
  assert.equal(reloadVerdict([]).pass, null);
  const roles = roleLatency([
    { who: "A", status: 200, rev: 1, ms: 400 }, { who: "A", status: 200, rev: 3, ms: 1600 },
    { who: "B", status: 200, rev: 2, ms: 300 }, { who: "B", status: 503, rev: null, ms: 50 },
  ]);
  assert.deepEqual([roles.A.pass, roles.A.values, roles.B.pass, roles.B.failed], [false, [400, 1600], false, 1]);
  assert.equal(reactionVerdict([{ status: 200, ms: 100 }, { status: 502, ms: 50 }]).pass, false);
  assert.equal(reactionVerdict([{ status: 200, ms: 100 }, { status: 200, ms: 1400 }]).pass, true);
  assert.equal(reactionVerdict([]).pass, null);
});

test("editor content check: both labels and the event id", () => {
  const html = '<h1>이벤트 편집</h1><label>시작 시각 (UTC) *</label><script>self.__next_f.push([1,"{\\"initialData\\":{\\"id\\":111,\\"type\\""])</script>';
  assert.equal(editorContentOk(html, 111), true);
  assert.equal(editorContentOk(html, 11), false); // 11 is followed by a digit
  assert.equal(editorContentOk(html.replace("이벤트 편집", ""), 111), false); // login page / error boundary
  assert.equal(editorContentOk('<h1>이벤트 편집</h1>시작 시각 (UTC) {"id":111,', 111), true);
});

test("ack hold: exposure required, gate on the display", () => {
  const base = {
    clickAt: 1000,
    ack: { recvAt: 1300, status: 200, ackAtMs: 5000, count: 4, reactionId: "r" },
    held: { reqAt: 900, capturedAtMs: 4800, count: 3, releasedAt: 1310, rev: 30 },
    // held response at 1310 (captured 4800 ≤ 5000), release at 9000.
    responses: [[1310, 4800, 3, 30], [9000, 5200, 5, 31]],
    samples: [[990, 3, "false", "7"], [1005, 4, "true", "7"], [9010, 5, "true", "8"]],
  };
  const ok = ackHoldVerdict(base);
  assert.equal(ok.exercised, true);
  assert.equal(ok.pass, true);
  assert.equal(ok.releaseCount, 5);
  // The held snapshot's lower count reached the display → FAIL.
  const dropped = ackHoldVerdict({ ...base, samples: [[1005, 4, "true", "7"], [1320, 3, "true", "7"], [9010, 5, "true", "8"]] });
  assert.equal(dropped.pass, false);
  assert.equal(dropped.drops, 1);
  // Never released in the window → FAIL (exercised).
  const noRel = ackHoldVerdict({ ...base, responses: [[1310, 4800, 3, 30]] });
  assert.deepEqual([noRel.exercised, noRel.pass], [true, false]);
  // After the release the display must equal the releasing snapshot.
  assert.equal(ackHoldVerdict({ ...base, samples: [[1005, 4, "true", "7"]] }).pass, false);
  // Not exercised (never a pass): no held response, held newer than the
  // ack, held count not lower, released before the ack, button not found.
  assert.equal(ackHoldVerdict({ ...base, held: null }).exercised, false);
  assert.equal(ackHoldVerdict({ ...base, held: { ...base.held, capturedAtMs: 5100 } }).pass, null);
  assert.equal(ackHoldVerdict({ ...base, held: { ...base.held, count: 4 } }).exercised, false);
  assert.equal(ackHoldVerdict({ ...base, held: { ...base.held, releasedAt: 1200 } }).exercised, false);
  assert.match(ackHoldVerdict({ ...base, samples: [[990, null, null, null]] }).reason, /not found/);
  assert.match(ackHoldVerdict({ error: "reaction button not found in the DOM (selector unstable?)" }).reason, /selector unstable/);
});
