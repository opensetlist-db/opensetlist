// node --test tests/load/browsers/admission.test.mjs
//
// The pure parts of n14 step 5 (admission.mjs): flag refusals, the
// rendered-rows matcher (order + multiplicity + the anchor's
// alternatives), connection timelines, SDK / page exposure, the
// population-split convergence, stale first answers, receipt vs reason,
// the verdict vocabulary and the idle-broadcast eligibility.
import test from "node:test";
import assert from "node:assert/strict";
import {
  parseStep5Flags, parseAdmitFile, firstSaveFromFile, fixtureIdsOf, expectedRows, matchRows, completeAt, connOf, connectedAt, connectedThrough, upSince,
  sdkExposure, pageExposure, exposureLabel, sdkConvergence, pageSeenFor, pageConvergence, staleFirstAnswers, receiptVsReason,
  admissionVerdict, idleEligibility, idleArrivals, summarizeArrivals,
} from "./admission.mjs";

const NOW = Date.UTC(2026, 9, 12, 5, 0, 0);
const T0 = NOW + 60_000;

test("flags: refusals and defaults", () => {
  const base = { phase: "admission", drill: null, deploymentUrl: false, pages: 30, now: NOW };
  assert.match(parseStep5Flags({}, base).error, /exactly one boundary/);
  assert.match(parseStep5Flags({ "admit-at": new Date(T0).toISOString(), "admit-file": "x" }, base).error, /exactly one boundary/);
  assert.match(parseStep5Flags({ "admit-at": new Date(NOW - 1000).toISOString() }, base).error, /past/);
  assert.match(parseStep5Flags({ "admit-at": "tomorrow" }, base).error, /ISO/);
  assert.match(parseStep5Flags({ "admit-file": "a", "guard-precursor": "https://x" }, base).error, /--deployment-url/);
  assert.match(parseStep5Flags({ "admit-file": "a", "admission-saves": "20,5" }, base).error, /increasing/);
  assert.match(parseStep5Flags({ "admit-file": "a" }, { ...base, phase: null }).error, /need\(s\) --phase=admission/);
  assert.match(parseStep5Flags({ "admit-file": "a" }, { ...base, drill: "idle-broadcast" }).error, /own experiment/);
  const ok = parseStep5Flags({ "admit-file": "a", "final-cohort": "20,20" }, base).cfg.admission;
  assert.deepEqual(ok.savesS, [5, 20, 45]);
  assert.deepEqual(ok.finalCohort, { incumbents: 20, fresh: 20 });
  assert.equal(ok.sdkMin, 100);
  assert.equal(ok.pagesMin, 5);
  assert.equal(ok.expectLiveSeed, true);
  assert.equal(parseStep5Flags({}, { ...base, phase: null }).cfg.admission, null);
});

test("flags: idle-broadcast", () => {
  const base = { phase: null, drill: "idle-broadcast", deploymentUrl: false, pages: 0, now: NOW };
  const at = (s) => new Date(NOW + s * 1000).toISOString();
  assert.match(parseStep5Flags({}, { ...base, pages: 30 }).error, /--pages=0/);
  assert.match(parseStep5Flags({ "first-save-at": at(70) }, base).error, /--connect-at/);
  assert.match(parseStep5Flags({ "connect-at": at(60), "first-save-at": at(63) }, base).error, /≥ 6 s/);
  assert.match(parseStep5Flags({ "connect-at": at(60), "first-save-at": at(200) }, base).error, /max-age/);
  assert.match(parseStep5Flags({ "connect-at": at(60), "first-save-at": at(70), "idle-saves": "20,100" }, base).error, /40 s of quiet/);
  assert.match(parseStep5Flags({ "connect-at": at(60), "first-save-at": at(70), "cohort-fresh": "20" }, base).error, /--wake/);
  const i1 = parseStep5Flags({ "connect-at": at(60), "first-save-at": at(70) }, base).cfg.idle;
  assert.equal(i1.incumbents, 20);
  assert.equal(i1.fresh, 0);
  assert.deepEqual(i1.savesS, [40, 100]);
  const i2 = parseStep5Flags({ "connect-at": at(60), "first-save-at": at(70), wake: true }, base).cfg.idle;
  assert.equal(i2.wake, true);
  assert.equal(i2.fresh, 20);
  assert.equal(i2.wakeGapS, 600);
  assert.match(parseStep5Flags({ "cohort-incumbents": "5" }, { ...base, drill: null }).error, /need\(s\) --drill=idle-broadcast/);
  // the first save released at run time instead
  assert.match(parseStep5Flags({ "connect-at": at(60) }, base).error, /exactly one of --first-save-at/);
  assert.match(parseStep5Flags({ "connect-at": at(60), "first-save-at": at(70), "first-save-file": "f" }, base).error, /exactly one/);
  const f = parseStep5Flags({ "connect-at": at(60), "first-save-file": "go.txt" }, base).cfg.idle;
  assert.equal(f.firstSaveFile, "go.txt");
  assert.equal(f.firstSaveAt, null);
  assert.equal(firstSaveFromFile("2026-10-12T05:01:10Z\n", 0), Date.parse("2026-10-12T05:01:10Z"));
  assert.equal(firstSaveFromFile("", NOW), NOW + 6000);
});

test("admit file and fixture ids", () => {
  assert.deepEqual(parseAdmitFile(""), { raw: "" });
  assert.equal(parseAdmitFile("redeployed").raw, "redeployed");
  const j = parseAdmitFile('{"base":"https://opensetlist-abc123-opensetlist-projects.vercel.app","measurementId":"dpl_2"}');
  assert.equal(j.measurementId, "dpl_2");
  assert.ok(j.base.startsWith("https://"));
  const ids = fixtureIdsOf({ clones: [{ id: 5 }, { id: "6" }], createdIds: [7], rows: [{ id: 8, clone: true }, { id: 9 }] });
  assert.deepEqual([...ids].sort(), ["5", "6", "7", "8"]);
});

// Manifest: 3 original rows (one a medley), a fixture clone that repeats
// row 1's song, the blank anchor, and an encore row stored at a LOWER
// position than the last main row (it must still render last).
const MANIFEST = [
  { id: "1", position: 1, isEncore: false, songs: [{ songId: "100", order: 1 }] },
  { id: "2", position: 2, isEncore: false, songs: [{ songId: "201", order: 2 }, { songId: "200", order: 1 }] },
  { id: "A", position: 3, isEncore: false, songs: [] },
  { id: "C", position: 4, isEncore: false, songs: [{ songId: "100", order: null }] },
  { id: "E", position: 0, isEncore: true, songs: [{ songId: "300", order: 1 }] },
];

test("expected rows: DOM order, per-row song order, multiplicity, anchor alternatives", () => {
  const exp = expectedRows(MANIFEST, { A: ["900", "901"] });
  assert.deepEqual(exp.map((r) => r.id), ["1", "2", "A", "C", "E"]);
  assert.deepEqual(exp[1].accept, ["200+201"]);
  assert.deepEqual(exp[2].accept, ["", "900", "901"]);
  // complete
  assert.deepEqual(matchRows(["100", "200+201", "", "100", "300"], exp), { matched: 5, total: 5, complete: true });
  // the anchor shows a run marker: still complete
  assert.equal(matchRows(["100", "200+201", "901", "100", "300"], exp).complete, true);
  // the clone row missing (only the originals rendered): a song-id SET
  // would pass, the ordered match does not
  assert.deepEqual(matchRows(["100", "200+201", "", "300"], exp), { matched: 3, total: 5, complete: false });
  // medley order swapped
  assert.equal(matchRows(["100", "201+200", "", "100", "300"], exp).matched, 4);
  // an extra row is never complete
  assert.equal(matchRows(["100", "200+201", "", "100", "300", "999"], exp).complete, false);
});

test("completeAt: first complete signature before the cut-off, else the best partial", () => {
  const exp = expectedRows(MANIFEST, { A: ["900"] });
  const log = [
    [T0 + 100, []],
    [T0 + 200, ["100", "200+201"]],
    [T0 + 900, ["100", "200+201", "", "100", "300"]],
  ];
  assert.deepEqual(completeAt(log, exp), { t: T0 + 900, matched: 5, total: 5, complete: true });
  const cut = completeAt(log, exp, T0 + 500);
  assert.equal(cut.t, null);
  assert.equal(cut.matched, 2);
});

// One client's connection log: up at 1000, down 5000, up 7000.
const CONN = [[1000, 1, "SUBSCRIBED"], [5000, 0, "CHANNEL_ERROR"], [7000, 1, "SUBSCRIBED"]];

test("connection timelines", () => {
  assert.equal(connectedAt(CONN, 999), false);
  assert.equal(connectedAt(CONN, 1000), true);
  assert.equal(connectedAt(CONN, 6000), false);
  assert.equal(connectedThrough(CONN, 2000, 4999), true);
  assert.equal(connectedThrough(CONN, 2000, 5000), false);
  assert.equal(upSince(CONN, 8000), 7000);
  assert.equal(upSince(CONN, 6000), null);
  // fallback reconstruction for a record without connLog
  const rebuilt = connOf({ subscribedAt: [1000, 7000], fallbacks: [[5000, "CHANNEL_ERROR"]] });
  assert.deepEqual(rebuilt.map(([t, u]) => [t, u]), [[1000, 1], [5000, 0], [7000, 1]]);
});

const save = { k: "a1", rev: 50, songId: "900", putStart: T0 + 5000, putEnd: T0 + 5400 };
const client = (idx, conn, extra = {}) => ({ idx, connLog: conn, subscribedAt: conn.filter(([, u]) => u === 1).map(([t]) => t), applied: [], bcasts: [], ...extra });

test("SDK exposure: connected through / not yet / dropped / stopped", () => {
  const sdk = [
    client(0, [[T0 + 1000, 1, "SUBSCRIBED"]]), // connected through
    client(1, [[T0 + 5200, 1, "SUBSCRIBED"]]), // subscribed inside the save → neither through nor "not yet"
    client(2, [[T0 + 9000, 1, "SUBSCRIBED"]]), // not yet
    client(3, []), // never
    client(4, [[T0 + 1000, 1, "SUBSCRIBED"], [T0 + 5100, 0, "CLOSED"]]), // dropped during the save
    client(5, [[T0 + 1000, 1, "SUBSCRIBED"]], { stoppedAt: T0 + 2000 }), // retired before
  ];
  const x = sdkExposure(sdk, save, { min: 1 });
  assert.deepEqual({ c: x.connected, n: x.notYet, d: x.disconnected, s: x.stopped, total: x.total }, { c: 1, n: 2, d: 2, s: 1, total: 5 });
  assert.equal(x.exposed, true);
  assert.equal(sdkExposure(sdk, save, { min: 2 }).exposed, false);
});

test("page exposure and labels", () => {
  const pages = [
    { navStart: T0 + 1000, completeAt: T0 + 6000 }, // in flight
    { navStart: T0 + 1000, completeAt: null }, // in flight (never completed)
    { navStart: T0 + 1000, completeAt: T0 + 3000 }, // settled
    { navStart: T0 + 8000, completeAt: T0 + 9000 }, // future
    { navStart: null, completeAt: null }, // never launched → future
  ];
  const px = pageExposure(pages, save, { min: 2 });
  assert.deepEqual({ i: px.inflight, f: px.future, s: px.settled }, { i: 2, f: 2, s: 1 });
  assert.equal(px.exposed, true);
  const no = { exposed: false };
  const yes = { exposed: true };
  assert.equal(exposureLabel(yes, yes), "SDK + page admission save");
  assert.equal(exposureLabel(yes, no), "SDK admission save");
  assert.equal(exposureLabel(no, yes), "page admission save");
  assert.equal(exposureLabel(no, no), "after admission");
});

test("SDK convergence: joined-before from PUT start, joined-after from max(subscribedAt, PUT response)", () => {
  const sdk = [
    client(0, [[T0 + 1000, 1, "SUBSCRIBED"]], { applied: [[T0 + 4000, 49, "initial"], [T0 + 6000, 50, "notification"]] }), // before: 1000
    client(1, [[T0 + 1000, 1, "SUBSCRIBED"]], { applied: [[T0 + 4000, 49, "initial"]] }), // before: missing
    client(2, [[T0 + 9000, 1, "SUBSCRIBED"]], { applied: [[T0 + 8000, 50, "initial"]] }), // after: applied before its clock → 0
    client(3, [[T0 + 5300, 1, "SUBSCRIBED"]], { applied: [[T0 + 7400, 50, "catchup"]] }), // after: clock = PUT response 5400 → 2000
    client(4, [], { applied: [[T0 + 8000, 50, "initial"]] }), // never subscribed
  ];
  const c = sdkConvergence(sdk, save, { timeoutMs: 30000 });
  assert.deepEqual(c.before.values, [1000]);
  assert.equal(c.before.missing, 1);
  assert.deepEqual(c.before.missingIdx, [1]);
  assert.deepEqual(c.after.values.sort((a, b) => a - b), [0, 2000]);
  assert.equal(c.after.missing, 0);
  assert.equal(c.notJoined, 1);
});

test("page convergence follows a later marker on the same anchor", () => {
  const replacedBy = new Map([["900", new Set(["901"])]]);
  assert.equal(pageSeenFor({ 901: T0 + 7000 }, save, replacedBy), T0 + 7000);
  assert.equal(pageSeenFor({ 900: T0 + 6500, 901: T0 + 7000 }, save, replacedBy), T0 + 6500);
  const pages = [
    { joinAt: [T0 + 2000], seen: { 900: T0 + 6500 } }, // before: 1500
    { joinAt: [T0 + 9000], seen: { 901: T0 + 8000 } }, // after: SSR already carried a later marker → 0
    { joinAt: [], seen: {} }, // never joined, never seen → after, missing
  ];
  const c = pageConvergence(pages, save, { timeoutMs: 30000, replacedBy });
  assert.deepEqual(c.before.values, [1500]);
  assert.deepEqual(c.after.values, [0]);
  assert.equal(c.after.missing, 1);
});

test("stale first answers: only reads that started after the PUT response", () => {
  const sdk = [
    { first: { reqStart: T0 + 5000, rev: 49 } }, // started before the PUT response: not eligible
    { first: { reqStart: T0 + 6000, rev: 49 } }, // stale
    { first: { reqStart: T0 + 6000, rev: 50 } }, // fresh
    { first: { reqStart: T0 + 6000, rev: null } }, // failed first request: unknown
  ];
  const pages = [
    { navStart: T0 + 6000, seed: { kind: "live", rev: 49 } }, // stale SSR seed
    { navStart: T0 + 6000, seed: { kind: "absent", rev: null }, firstFetch: { rev: 50 } }, // degraded seed → first fetch
    { navStart: T0 + 1000, seed: { kind: "live", rev: 48 } }, // before: not eligible
  ];
  const s = staleFirstAnswers(sdk, pages, save);
  assert.deepEqual({ e: s.sdk.eligible, st: s.sdk.stale, u: s.sdk.unknown }, { e: 3, st: 1, u: 1 });
  assert.deepEqual(s.sdk.staleRevs, { 49: 1 });
  assert.deepEqual({ e: s.pages.eligible, st: s.pages.stale }, { e: 2, st: 1 });
});

test("raw broadcast receipt reported apart from the applying fetch's reason", () => {
  const sdk = [
    { bcasts: [[T0 + 5500, 50, "n"]], applied: [[T0 + 5800, 50, "notification"]] },
    { bcasts: [], applied: [[T0 + 20000, 50, "periodic"]] },
    { bcasts: [[T0 + 5500, 50, "x"]], applied: [] }, // dropped by a drill: not a receipt
    { bcasts: [[T0 + 5500, 50, "d"]], applied: [[T0 + 4000, 51, "catchup"]], stoppedAt: T0 + 100 }, // retired: out
  ];
  const r = receiptVsReason(sdk, save);
  assert.equal(r.population, 3);
  assert.equal(r.received, 1);
  assert.deepEqual(r.reasons, { notification: 1, periodic: 1, never: 1 });
  assert.deepEqual(r.receivedReasons, { notification: 1 });
});

test("verdict vocabulary", () => {
  const gates = [{ name: "a", pass: true }, { name: "b", pass: null }];
  assert.equal(admissionVerdict({ invalid: true, sdkExercised: true, pageExercised: true, gates }).verdict, "INVALID");
  assert.equal(admissionVerdict({ invalid: false, sdkExercised: false, pageExercised: false, gates }).verdict, "NOT EXERCISED");
  const v = admissionVerdict({ invalid: false, sdkExercised: true, pageExercised: false, gates });
  assert.deepEqual([v.verdict, v.sdk, v.page], ["VALID + PASS", "VALID + PASS", "NOT EXERCISED"]);
  const f = admissionVerdict({ invalid: false, sdkExercised: true, pageExercised: true, gates: [...gates, { name: "c", pass: false }] });
  assert.equal(f.verdict, "VALID + FAIL");
  assert.deepEqual(f.failed, ["c"]);
});

test("idle eligibility: age window, continuity, cohort spread", () => {
  const S = { k: "s1", rev: 60, putStart: T0 + 100_000, putEnd: T0 + 100_300 };
  const at = (s) => S.putStart - s * 1000;
  const ok = [client(0, [[at(10), 1, "SUBSCRIBED"]]), client(1, [[at(12), 1, "SUBSCRIBED"]])];
  const e = idleEligibility(ok, S, { maxAgeS: 90 });
  assert.equal(e.exercised, true);
  assert.equal(e.eligible, 2);
  assert.equal(e.spreadS, 2);
  // too young, too old, reconnected, not connected
  const bad = [
    client(0, [[at(3), 1, "SUBSCRIBED"]]),
    client(1, [[at(200), 1, "SUBSCRIBED"]]),
    client(2, [[at(60), 1, "SUBSCRIBED"], [at(30), 0, "CLOSED"], [at(20), 1, "SUBSCRIBED"]]),
    client(3, []),
  ];
  const b = idleEligibility(bad, S, { maxAgeS: 90 });
  assert.equal(b.exercised, false);
  assert.match(b.per[0].why, /< 6 s/);
  assert.match(b.per[1].why, /> --max-age 90/);
  // reconnected 20 s before: its CURRENT connection is 20 s old → eligible
  assert.equal(b.per[2].eligible, true);
  assert.equal(b.per[3].why, "not connected at the save");
  // spread > 30 s → not exercised even when each client is eligible
  const spread = [client(0, [[at(10), 1, "SUBSCRIBED"]]), client(1, [[at(80), 1, "SUBSCRIBED"]])];
  const sp = idleEligibility(spread, S, { maxAgeS: 90 });
  assert.equal(sp.eligible, 2);
  assert.equal(sp.spreadOk, false);
  assert.equal(sp.exercised, false);
});

test("idle arrivals: broadcast receipt, applying reason, repair time", () => {
  const S = { k: "s1", rev: 60, putStart: T0, putEnd: T0 + 300 };
  const rows = idleArrivals([
    { idx: 0, bcasts: [[T0 + 500, 60, "n"]], applied: [[T0 + 900, 60, "notification"]] },
    { idx: 1, bcasts: [], applied: [[T0 + 21000, 60, "periodic"]] },
    { idx: 2, bcasts: [], applied: [] },
    // joined after the save: its catch-up is not a repair — out
    { idx: 3, attemptAt: T0 + 5000, subscribedAt: [T0 + 5300], bcasts: [], applied: [[T0 + 5400, 60, "initial"]] },
    { idx: 4, subscribedAt: [T0 + 400], bcasts: [], applied: [[T0 + 5400, 60, "catchup"]] },
    // stopped before the save — out
    { idx: 5, stoppedAt: T0 - 1, subscribedAt: [T0 - 9000], bcasts: [], applied: [] },
  ], S, { timeoutMs: 60000 });
  assert.deepEqual(rows.map((r) => [r.bcastMs, r.reason, r.repairMs]), [[200, "notification", null], [null, "periodic", 21000], [null, "never", null]]);
  const s = summarizeArrivals(rows);
  assert.equal(s.received, 1);
  assert.equal(s.applied, 2);
  assert.deepEqual(s.reasons, { notification: 1, periodic: 1, never: 1 });
  assert.equal(s.repair.max, 21000);
});
