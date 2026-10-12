// node --test tests/load/fixtures/fes-rows.test.mjs
//
// The fixture's pure invariants (fes-rows-lib.mjs): clone count from the
// live row count, encore ordering after cloning, which originals move,
// the clean-up's restore plan and the verifier's table.
import test from "node:test";
import assert from "node:assert/strict";
import { cloneCount, planFixture, planRestore, verifyAgainst, encoreOrderError, rowContentKey } from "./fes-rows-lib.mjs";

// Event 111's shape: 22 ordinary rows at 1..22, one encore row at 23.
const ev111 = () =>
  Array.from({ length: 23 }, (_, i) => ({ id: String(1424 + i), position: i + 1, isEncore: i === 22, status: "confirmed" }));

test("clone count is computed from the live rows and the anchor reserve", () => {
  assert.equal(cloneCount({ active: 23, target: 70, reserve: 1 }), 46);
  assert.equal(cloneCount({ active: 23, target: 27, reserve: 1 }), 3);
  assert.equal(cloneCount({ active: 25, target: 70, reserve: 1 }), 44);
  assert.throws(() => cloneCount({ active: 70, target: 70, reserve: 0 }), /already has/);
  assert.throws(() => cloneCount({ active: 23, target: 0 }), /positive/);
  assert.throws(() => cloneCount({ active: 23, target: 70, reserve: -1 }), /non-negative/);
});

test("70-row plan: two full copies, ordinary clones before the encore block, encore clones appended", () => {
  const rows = ev111();
  const p = planFixture(rows, { clones: 46 });
  assert.equal(p.clones.length, 46);
  assert.equal(p.finalRows.length, 69);
  // Every source row cloned exactly twice (k mod 23).
  const per = new Map();
  for (const c of p.clones) per.set(c.sourceId, (per.get(c.sourceId) || 0) + 1);
  assert.ok([...per.values()].every((n) => n === 2));
  assert.equal(per.size, 23);
  // Ordinary clones at 23..66, the original encore 23 → 67, encore clones 68, 69.
  const ord = p.clones.filter((c) => !c.isEncore).map((c) => c.position).sort((a, b) => a - b);
  assert.deepEqual(ord, Array.from({ length: 44 }, (_, i) => 23 + i));
  assert.deepEqual(p.shifted, [{ id: "1446", from: 23, to: 67 }]);
  assert.deepEqual(p.clones.filter((c) => c.isEncore).map((c) => c.position).sort((a, b) => a - b), [68, 69]);
  assert.equal(encoreOrderError(p.finalRows), null);
  // Ordinary originals never move.
  for (const r of rows.filter((x) => !x.isEncore)) assert.equal(p.finalRows.find((f) => f.id === r.id).position, r.position);
});

test("small plan (target 27, reserve 1): 3 ordinary clones, the encore shifts by 3", () => {
  const p = planFixture(ev111(), { clones: 3 });
  assert.deepEqual(p.clones.map((c) => [c.sourceId, c.position, c.isEncore]), [["1424", 23, false], ["1425", 24, false], ["1426", 25, false]]);
  assert.deepEqual(p.shifted, [{ id: "1446", from: 23, to: 26 }]);
});

test("positions with gaps: ordinary originals keep theirs, the tail is consecutive after the last ordinary row", () => {
  const rows = [
    { id: "1", position: 1, isEncore: false },
    { id: "2", position: 4, isEncore: false },
    { id: "3", position: 9, isEncore: true },
    { id: "4", position: 12, isEncore: true },
  ];
  const p = planFixture(rows, { clones: 4 });
  const pos = Object.fromEntries(p.finalRows.map((r) => [r.id, r.position]));
  assert.equal(pos["1"], 1);
  assert.equal(pos["2"], 4);
  assert.deepEqual(p.clones.map((c) => [c.sourceId, c.position]), [["1", 5], ["2", 6], ["3", 9], ["4", 10]]);
  assert.deepEqual(p.shifted, [{ id: "3", from: 9, to: 7 }, { id: "4", from: 12, to: 8 }]);
  assert.equal(encoreOrderError(p.finalRows), null);
});

test("all-encore or no-encore events stay valid", () => {
  const noEnc = [1, 2, 3].map((i) => ({ id: String(i), position: i, isEncore: false }));
  const p = planFixture(noEnc, { clones: 2 });
  assert.deepEqual(p.shifted, []);
  assert.deepEqual(p.clones.map((c) => c.position), [4, 5]);
  const allEnc = [5, 6].map((i) => ({ id: String(i), position: i, isEncore: true }));
  const q = planFixture(allEnc, { clones: 2 });
  assert.deepEqual(q.shifted, []);
  assert.deepEqual(q.clones.map((c) => c.position), [7, 8]);
});

test("refusals: rumoured rows, duplicate positions, an already-broken encore order", () => {
  assert.throws(() => planFixture([{ id: "1", position: 1, isEncore: false, status: "rumoured" }], { clones: 1 }), /rumoured/);
  assert.throws(() => planFixture([{ id: "1", position: 1, isEncore: false }, { id: "2", position: 1, isEncore: false }], { clones: 1 }), /duplicate/);
  assert.throws(() => planFixture([{ id: "1", position: 1, isEncore: true }, { id: "2", position: 2, isEncore: false }], { clones: 1 }), /encore order/);
  assert.throws(() => planFixture([], { clones: 1 }), /no active rows/);
});

test("restore plan: originals back to recorded positions; foreign rows block only on a target position", () => {
  const original = ev111().map(({ id, position }) => ({ id, position }));
  // After the 70-row run + clean-up soft-delete: encore at 67, a leftover anchor at 30.
  const current = original.map((r) => (r.id === "1446" ? { ...r, position: 67 } : r)).concat([{ id: "9999", position: 30 }]);
  const r = planRestore(original, current);
  assert.deepEqual(r.moves, [{ id: "1446", from: 67, to: 23 }]);
  assert.deepEqual(r.blocking, []);
  assert.deepEqual(r.foreign, [{ id: "9999", position: 30 }]);
  // A leftover anchor ON a recorded position blocks.
  const r2 = planRestore(original, current.map((x) => (x.id === "9999" ? { ...x, position: 23 } : x)));
  assert.deepEqual(r2.blocking, [{ id: "9999", position: 23 }]);
  // A recorded row deleted meanwhile is reported, not fatal.
  const r3 = planRestore(original, current.filter((x) => x.id !== "1430"));
  assert.deepEqual(r3.missing, ["1430"]);
});

test("verifier: identical content passes; a moved row, a live clone, a rewound revision fail", () => {
  const row = (id, position, extra = {}) => ({
    id, position, isEncore: false, stageType: "full_group", unitName: null, note: null, status: "confirmed", performanceType: "live_performance", type: "song",
    songs: [{ songId: "1", order: 0 }], members: [{ stageIdentityId: "a", realPersonId: null }], artists: [{ artistId: "7" }], ...extra,
  });
  const event = { status: "ongoing", startTime: "2026-10-01 10:00:00", setlistRevision: "10" };
  const before = { event, rows: [row("1", 1), row("2", 2, { isEncore: true })] };
  const okNow = { event: { ...event, setlistRevision: "12" }, rows: [row("2", 2, { isEncore: true }), row("1", 1)] };
  const t = verifyAgainst({ before, now: okNow, clonesNow: [{ id: "5", isDeleted: true }], revAfterFixture: "11" });
  assert.ok(t.every((x) => x.ok), JSON.stringify(t.filter((x) => !x.ok)));

  const bad = verifyAgainst({
    before,
    now: { event: { ...event, setlistRevision: "11" }, rows: [row("1", 1), row("2", 3, { isEncore: true, members: [] })] },
    clonesNow: [{ id: "5", isDeleted: false }, { id: "6", isDeleted: null }],
    revAfterFixture: "11",
  });
  const failed = bad.filter((x) => !x.ok).map((x) => x.check);
  assert.ok(failed.includes("positions"));
  assert.ok(failed.includes("scalar content + junction content"));
  assert.ok(failed.includes("members links"));
  assert.ok(failed.includes("clones soft-deleted"));
  assert.ok(failed.includes("revision strictly increased (never rewound)"));
});

test("row content key ignores junction order but not song order values", () => {
  const a = { isEncore: false, songs: [{ songId: "1", order: 0 }, { songId: "2", order: 1 }], members: [{ stageIdentityId: "x", realPersonId: null }, { stageIdentityId: "y", realPersonId: "p" }], artists: [] };
  const b = { ...a, songs: [...a.songs].reverse(), members: [...a.members].reverse() };
  assert.equal(rowContentKey(a), rowContentKey(b));
  const c = { ...a, songs: [{ songId: "1", order: 1 }, { songId: "2", order: 0 }] };
  assert.notEqual(rowContentKey(a), rowContentKey(c));
});
