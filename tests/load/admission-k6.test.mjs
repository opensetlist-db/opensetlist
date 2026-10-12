// node --test tests/load/admission-k6.test.mjs
//
// viewers.js admission mode's pure logic (tests/load/lib/admission.mjs):
// SHAPE_MIX parsing, per-viewer shape draws, save schedule parsing, the
// notification parameters per shape, the saved-head claims, exposure.
import test from "node:test";
import assert from "node:assert/strict";
import { parseShapeMix, pickShape, parseSaves, arrivalOffsetMs, notificationParams, headCheck, exposure, pct } from "./lib/admission.mjs";

test("SHAPE_MIX parses as weights in r2/r1/pre order and refuses typos", () => {
  assert.deepEqual(parseShapeMix("60/25/15"), { r2: 0.6, r1: 0.25, pre: 0.15 });
  assert.deepEqual(parseShapeMix("6/2.5/1.5"), { r2: 0.6, r1: 0.25, pre: 0.15 });
  assert.deepEqual(parseShapeMix("1/0/0"), { r2: 1, r1: 0, pre: 0 });
  for (const bad of ["60/25", "60/25/x", "-1/1/1", "0/0/0", "", undefined, "0.3"]) assert.throws(() => parseShapeMix(bad));
});

test("pickShape follows the cumulative mix; a zero share is never drawn", () => {
  const mix = parseShapeMix("60/25/15");
  assert.equal(pickShape(mix, 0), "r2");
  assert.equal(pickShape(mix, 0.5999), "r2");
  assert.equal(pickShape(mix, 0.6), "r1");
  assert.equal(pickShape(mix, 0.8499), "r1");
  assert.equal(pickShape(mix, 0.85), "pre");
  assert.equal(pickShape(mix, 0.9999), "pre");
  const noPre = parseShapeMix("50/50/0");
  assert.equal(pickShape(noPre, 0.99999999), "r1");
  // Proportions over a deterministic grid.
  const n = { r2: 0, r1: 0, pre: 0 };
  for (let i = 0; i < 1000; i++) n[pickShape(mix, i / 1000)]++;
  assert.deepEqual(n, { r2: 600, r1: 250, pre: 150 });
});

test("ADMISSION_SAVES: sorted, unique, positive seconds; empty = none", () => {
  assert.deepEqual(parseSaves("5,20"), [5, 20]);
  assert.deepEqual(parseSaves("20, 5,5"), [5, 20]);
  assert.deepEqual(parseSaves(""), []);
  assert.deepEqual(parseSaves("2.5"), [2.5]);
  for (const bad of ["0", "5,x", "-3"]) assert.throws(() => parseSaves(bad));
});

test("arrivals are spread evenly over the window, starting at t=0", () => {
  assert.equal(arrivalOffsetMs(0, 500, 10), 0);
  assert.equal(arrivalOffsetMs(250, 500, 10), 5000);
  assert.equal(arrivalOffsetMs(499, 500, 10), 9980);
});

test("notification parameters per shape", () => {
  assert.deepEqual(notificationParams("r2", { savedRev: 42, appliedRev: 40 }), { minRev: 42, hint: true });
  assert.deepEqual(notificationParams("r1", { savedRev: 42, appliedRev: 41 }), { minRev: 42, hint: false });
  assert.deepEqual(notificationParams("r1", { savedRev: 42, appliedRev: 39 }), { minRev: 40, hint: false });
  assert.deepEqual(notificationParams("r1", { savedRev: 42, appliedRev: null }), { minRev: 42, hint: false });
  assert.deepEqual(notificationParams("pre", { savedRev: 42, appliedRev: 41 }), { minRev: null, hint: false });
  assert.throws(() => notificationParams("x", { savedRev: 1 }));
});

test("saved-head claims: r2 exact, others at-or-beyond", () => {
  assert.deepEqual(headCheck("r2", 42, 42), { eq: true, ge: true, claim: true });
  assert.deepEqual(headCheck("r2", 43, 42), { eq: false, ge: true, claim: false });
  assert.deepEqual(headCheck("r1", 43, 42), { eq: false, ge: true, claim: true });
  assert.deepEqual(headCheck("pre", 41, 42), { eq: false, ge: false, claim: false });
  assert.deepEqual(headCheck("r1", null, 42), { eq: false, ge: false, claim: false });
});

test("exposure counts outstanding arrivals, never negative", () => {
  assert.deepEqual(exposure({ admitted: 120, arrivalsTotal: 500, arrivalsDone: 130, inFlight: 15 }), { admitted: 120, outstanding: 370, inFlight: 15 });
  assert.deepEqual(exposure({ admitted: 500, arrivalsTotal: 500, arrivalsDone: 500, inFlight: 0 }), { admitted: 500, outstanding: 0, inFlight: 0 });
  assert.equal(pct([1, 2, 3, 4], 0.95), 4);
  assert.equal(pct([], 0.5), null);
});
