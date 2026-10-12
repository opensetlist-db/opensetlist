// node --test tests/load/transition-sampler.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { samplerSummary, samplerMarkdown } from "./transition-sampler.mjs";

const T = Date.UTC(2026, 10, 1, 3, 0, 0, 0);
const doc = (dt, dpl, status = 200) => ({ kind: "doc", tStart: T + dt, tEnd: T + dt + 120, status, dpl, vercelId: "icn1::icn1::x", error: null });
const api = (dt, status = 200, error = null) => ({ kind: "api", tStart: T + dt, tEnd: T + dt + 80, status, dpl: null, vercelId: "icn1::icn1::y", error });

test("switch with an old tail: first expected, last old, sustained, flips", () => {
  const s = samplerSummary([
    doc(0, "dpl_OLD"), doc(250, "dpl_OLD"), doc(500, "dpl_NEW"), doc(750, "dpl_OLD"), doc(1000, "dpl_NEW"), doc(1250, "dpl_NEW"),
    api(125), api(375), api(625, 502), api(875, 0, "TimeoutError"),
  ], "dpl_NEW");
  assert.equal(s.verdict, "SWITCHED");
  assert.equal(s.firstExpected.tStart, T + 500);
  assert.equal(s.lastOld.tStart, T + 750);
  assert.equal(s.sustainedFrom, T + 1000);
  assert.equal(s.overlapMs, 250);
  assert.equal(s.flips, 3);
  assert.deepEqual(s.oldIds, ["dpl_OLD"]);
  assert.equal(s.api.bad, 2);
  assert.equal(s.api.badAfterSwitch, 2);
  const md = samplerMarkdown(s, { base: "https://opensetlist.com", baseKind: "prod", path: "/ja/events/107/x", eventId: "107", host: "h", startedAt: "a", endedAt: "b", endReason: "duration", intervalMs: 250 });
  assert.match(md, /— SWITCHED/);
  assert.match(md, /\| 03:00:01\.000 \| 03:00:01\.250 \| dpl_NEW \(expected\) \| 2 \|/);
});

test("verdicts: not switched / already switched / not sustained / no data", () => {
  assert.equal(samplerSummary([doc(0, "dpl_OLD")], "dpl_NEW").verdict, "NOT SWITCHED");
  assert.equal(samplerSummary([doc(0, "dpl_NEW")], "dpl_NEW").verdict, "ALREADY SWITCHED");
  assert.equal(samplerSummary([doc(0, "dpl_OLD"), doc(250, "dpl_NEW"), doc(500, "dpl_OLD")], "dpl_NEW").verdict, "NOT SUSTAINED");
  assert.equal(samplerSummary([doc(0, null, 500), api(10)], "dpl_NEW").verdict, "NO DATA");
});
