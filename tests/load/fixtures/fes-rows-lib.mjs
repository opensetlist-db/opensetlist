// Pure planning / comparison logic for the step-5 Fes-size fixture
// (`fes-rows.mjs`). No I/O here, so `fes-rows.test.mjs` can pin the
// invariants that matter without a database:
//
//   * the clone count is computed from the LIVE row count, never
//     hard-coded (event 111 has 23 rows today; tomorrow it may not);
//   * the encore invariant (`validateEncoreOrder`, src/lib/validation.ts)
//     holds after the fixture: every ordinary row precedes every encore
//     row. The admin PUT validates the WHOLE event on every save
//     (src/app/api/admin/setlist-items/[id]/route.ts), so a fixture that
//     appended a full copy of the setlist — ordinary rows after the
//     original encore — would turn every measured save into a 400;
//   * positions stay unique among active non-rumoured rows (the partial
//     unique index `setlist_item_event_position_finalized_unique` in
//     prisma/post-deploy.sql), and the plan says which ORIGINAL rows
//     move, so the clean-up can put them back exactly.

// The scalar columns copied onto a clone and compared by the verifier.
// `position` is deliberately absent (the plan assigns it), as are the
// soft-delete columns and `createdAt` (a clone is a new row).
export const SCALAR_COLUMNS = ["isEncore", "stageType", "unitName", "note", "status", "performanceType", "type"];

// Parking offset for the two-step position moves (same technique as
// `restorePositions` in tests/load/browsers/admin.mjs and restore.mjs
// `--compact`): the unique index is checked row by row, so moving a
// block of rows by K in one UPDATE can collide with a not-yet-moved
// neighbour. Rows are first parked far above any real position, then
// written to their targets.
export const PARK_OFFSET = 1_000_000;

// Mirrors validateEncoreOrder (src/lib/validation.ts) — the test layer
// cannot import the app's TypeScript. Returns null when valid.
export function encoreOrderError(rows) {
  const enc = rows.filter((r) => r.isEncore).map((r) => r.position);
  const ord = rows.filter((r) => !r.isEncore).map((r) => r.position);
  if (!enc.length || !ord.length) return null;
  const minEnc = Math.min(...enc);
  const maxOrd = Math.max(...ord);
  return minEnc <= maxOrd ? `encore row at position ${minEnc} precedes ordinary row at position ${maxOrd}` : null;
}

// How many clones bring the event to `target` active rows, counting
// `reserve` rows that someone else adds later (the harness's blank
// anchor: `--anchor-reserve=1`). Throws when the event is already at or
// above the target — the fixture never deletes rows to "reach" it.
export function cloneCount({ active, target, reserve = 0 }) {
  if (!Number.isInteger(target) || target <= 0) throw new Error(`--target must be a positive integer, got ${target}`);
  if (!Number.isInteger(reserve) || reserve < 0) throw new Error(`--anchor-reserve must be a non-negative integer, got ${reserve}`);
  const n = target - reserve - active;
  if (n <= 0) throw new Error(`event already has ${active} active rows; target ${target} with reserve ${reserve} needs ${n} clones`);
  return n;
}

// The plan. `rows` = the event's active rows (id, position, isEncore,
// status), any order. Clone k copies source row k mod N in setlist
// order, so two full copies of a 23-row setlist (46 clones) reproduce
// its exact mix: the same stage types, member counts, the medley, the
// encore. Final order:
//
//   ordinary originals (positions UNCHANGED)
//   ordinary clones    (appended after the last ordinary original)
//   encore originals   (shifted down past the ordinary clones)
//   encore clones      (appended at the end)
//
// so ordinary rows keep preceding encore rows, and the only originals
// that move are the encore ones (recorded as `shifted` for the restore).
// The tail is numbered consecutively from (last ordinary position + 1);
// with no ordinary original it starts at the first encore position.
//
// Refusals (the fixture is a measurement precondition, not a repair
// tool — reconcile the event first):
//   * rumoured rows: they may legally share a position (conflict
//     siblings), which this numbering does not model;
//   * duplicate positions among the active rows;
//   * an event that already violates the encore order.
export function planFixture(rows, { clones }) {
  if (!rows.length) throw new Error("event has no active rows to clone");
  if (!Number.isInteger(clones) || clones <= 0) throw new Error(`clone count must be a positive integer, got ${clones}`);
  const sorted = [...rows].sort((a, b) => a.position - b.position);
  const rumoured = sorted.filter((r) => r.status === "rumoured");
  if (rumoured.length) throw new Error(`event has rumoured rows (${rumoured.map((r) => r.id).join(",")}) — reconcile them first`);
  const seen = new Set();
  for (const r of sorted) {
    if (seen.has(r.position)) throw new Error(`duplicate active position ${r.position} — run restore.mjs --compact first`);
    seen.add(r.position);
  }
  const encErr = encoreOrderError(sorted);
  if (encErr) throw new Error(`event already violates the encore order (${encErr})`);

  const sources = [];
  for (let k = 0; k < clones; k++) sources.push(sorted[k % sorted.length]);
  const ordOrig = sorted.filter((r) => !r.isEncore);
  const encOrig = sorted.filter((r) => r.isEncore);
  const ordClones = sources.map((s, k) => ({ k, sourceId: s.id, isEncore: false, src: s })).filter((c) => !c.src.isEncore);
  const encClones = sources.map((s, k) => ({ k, sourceId: s.id, isEncore: true, src: s })).filter((c) => c.src.isEncore);

  let next = ordOrig.length ? ordOrig[ordOrig.length - 1].position + 1 : encOrig[0].position;
  const cloneSlots = [];
  for (const c of ordClones) cloneSlots.push({ k: c.k, sourceId: c.sourceId, isEncore: false, position: next++ });
  const shifted = [];
  for (const r of encOrig) {
    const to = next++;
    if (to !== r.position) shifted.push({ id: r.id, from: r.position, to });
  }
  for (const c of encClones) cloneSlots.push({ k: c.k, sourceId: c.sourceId, isEncore: true, position: next++ });
  cloneSlots.sort((a, b) => a.k - b.k);

  // Self-check of the result: unique positions, encore order, row count.
  const finalRows = [
    ...ordOrig.map((r) => ({ id: r.id, position: r.position, isEncore: false })),
    ...encOrig.map((r) => ({ id: r.id, position: shifted.find((s) => s.id === r.id)?.to ?? r.position, isEncore: true })),
    ...cloneSlots.map((c) => ({ id: `clone#${c.k}`, position: c.position, isEncore: c.isEncore })),
  ].sort((a, b) => a.position - b.position);
  const pos = new Set(finalRows.map((r) => r.position));
  if (pos.size !== finalRows.length) throw new Error("internal: planned positions collide");
  const after = encoreOrderError(finalRows);
  if (after) throw new Error(`internal: plan violates the encore order (${after})`);
  return { clones: cloneSlots, shifted, finalRows };
}

// Inverse of the plan's moves for the clean-up: which ORIGINAL rows sit
// somewhere other than their recorded pre-fixture position now, and
// whether putting them back collides with an active row we do not own.
//
// `original` = the manifest's pre-fixture rows [{id, position}];
// `current`  = the event's active rows right now (after the clones are
// soft-deleted, inside the same transaction). Rows we do not know
// ("foreign" — a leftover harness anchor, another stream's row) block
// the restore only when one sits on a target position; a recorded row
// that is gone (deleted by someone meanwhile) is reported, not fatal.
export function planRestore(original, current) {
  const origPos = new Map(original.map((r) => [String(r.id), Number(r.position)]));
  const now = new Map(current.map((r) => [String(r.id), Number(r.position)]));
  const moves = [];
  for (const [id, pos] of origPos) {
    if (now.has(id) && now.get(id) !== pos) moves.push({ id, from: now.get(id), to: pos });
  }
  const missing = [...origPos.keys()].filter((id) => !now.has(id));
  const foreign = [...now.entries()].filter(([id]) => !origPos.has(id)).map(([id, position]) => ({ id, position }));
  const targets = new Set(origPos.values());
  const blocking = foreign.filter((f) => targets.has(f.position));
  return { moves, missing, foreign, blocking };
}

// Canonical, order-independent form of one row's content for the
// verifier: scalar columns + the three junction collections.
export function rowContentKey(row) {
  const scal = SCALAR_COLUMNS.map((c) => `${c}=${row[c] ?? null}`).join(";");
  const songs = [...(row.songs || [])].map((s) => `${s.songId}:${s.order ?? "-"}`).sort().join(",");
  const members = [...(row.members || [])].map((m) => `${m.stageIdentityId}:${m.realPersonId ?? "-"}`).sort().join(",");
  const artists = [...(row.artists || [])].map((a) => `${a.artistId}`).sort().join(",");
  return `${scal}|songs=${songs}|members=${members}|artists=${artists}`;
}

// The verification table. `before` = the manifest's pre-fixture snapshot
// ({ rows, event }); `now` = the same shape read from the DB after the
// clean-up; `clonesNow` = [{ id, isDeleted }] for every created clone.
// Returns [{ check, ok, detail }]. Revision: strictly greater than the
// manifest's revision AFTER the fixture (never rewound, see fes-rows.mjs).
export function verifyAgainst({ before, now, clonesNow, revAfterFixture }) {
  const out = [];
  const add = (check, ok, detail) => out.push({ check, ok, detail });
  const b = [...before.rows].sort((x, y) => x.position - y.position);
  const n = [...now.rows].sort((x, y) => x.position - y.position);
  const bIds = b.map((r) => r.id).join(",");
  const nIds = n.map((r) => r.id).join(",");
  add("active row ids (in order)", bIds === nIds, bIds === nIds ? `${n.length} rows` : `expected ${b.length} [${bIds.slice(0, 120)}], got ${n.length} [${nIds.slice(0, 120)}]`);
  const posDiff = b.filter((r) => n.find((x) => x.id === r.id)?.position !== r.position);
  add("positions", posDiff.length === 0, posDiff.length ? posDiff.map((r) => `${r.id}: ${r.position}→${n.find((x) => x.id === r.id)?.position ?? "gone"}`).join(", ") : "all at recorded positions");
  const encB = b.filter((r) => r.isEncore).map((r) => r.id).join(",");
  const encN = n.filter((r) => r.isEncore).map((r) => r.id).join(",");
  add("encore flags", encB === encN && !encoreOrderError(n), encB === encN ? `encore rows [${encN}]` : `expected [${encB}], got [${encN}]`);
  const contentDiff = b.filter((r) => {
    const x = n.find((y) => y.id === r.id);
    return !x || rowContentKey(x) !== rowContentKey(r);
  });
  add("scalar content + junction content", contentDiff.length === 0, contentDiff.length ? `differs: ${contentDiff.map((r) => r.id).join(",")}` : "identical");
  const cnt = (rows, k) => rows.reduce((a, r) => a + (r[k] || []).length, 0);
  for (const k of ["songs", "members", "artists"]) {
    add(`${k} links`, cnt(b, k) === cnt(n, k), `${cnt(b, k)} → ${cnt(n, k)}`);
  }
  add("event status", before.event.status === now.event.status, `${before.event.status} → ${now.event.status}`);
  add("event startTime", before.event.startTime === now.event.startTime, `${before.event.startTime} → ${now.event.startTime}`);
  const liveClones = clonesNow.filter((c) => !c.isDeleted);
  const missingClones = clonesNow.filter((c) => c.isDeleted == null);
  add("clones soft-deleted", liveClones.length === 0 && missingClones.length === 0, `${clonesNow.length - liveClones.length - missingClones.length}/${clonesNow.length} deleted${liveClones.length ? `; still active: ${liveClones.map((c) => c.id).join(",")}` : ""}${missingClones.length ? `; not found: ${missingClones.map((c) => c.id).join(",")}` : ""}`);
  const revOk = revAfterFixture != null && Number(now.event.setlistRevision) > Number(revAfterFixture);
  add("revision strictly increased (never rewound)", revOk, `fixture ${revAfterFixture} → now ${now.event.setlistRevision}`);
  return out;
}

/**
 * What a failed COMMIT means for the manifest. `committing` = the error
 * happened while the COMMIT statement was in flight (before that, the
 * rollback is certain). A server-side rejection carries a 5-character
 * SQLSTATE (`code`, e.g. 40001) and means the transaction is gone. A
 * connection-level failure (ECONNRESET, timeout, no code) is ambiguous: the
 * server may still be committing. `liveCount` = planned clone rows found by
 * a fresh connection, polled a few times; 0 rows during an in-flight COMMIT
 * is NOT proof of rollback (the transaction may become visible a moment
 * later), so the answer is `unknown` and --cleanup must not trust it.
 */
export function commitOutcome({ committing, code, liveCount }) {
  if (!committing) return "rolled-back";
  if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) return "rolled-back";
  if (liveCount > 0) return "committed";
  return "unknown";
}
