// n12 admin mutation loop: the operator's live entry, under load.
//
// One VU, sequential — exactly one operator saves during a show. Each
// cycle performs the five write shapes the spec asks for and checks
// that every write is visible in the very next /api/setlist snapshot:
//
//   1. POST   /api/admin/setlist-items              append a row
//   2. PUT    /api/admin/setlist-items/<id>         change its song
//   3. POST   /api/admin/setlist-items/insert-after blank row after it
//   4. POST   /api/admin/setlist-items/swap         swap the two rows
//   5. DELETE /api/admin/setlist-items/<id>  ×2     remove both
//
// = 6 writes per cycle; the default 4 cycles = 24 timed saves (spec:
// ≥ 20). The rows are always appended *after* the current last
// position, so no existing row on the test event is shifted or edited;
// insert-after at the tail shifts nothing. Deletes are the app's soft
// delete, so the event ends the run with the same visible rows plus
// some isDeleted rows (harmless — the partial unique index only covers
// active rows).
//
// `admin_save_reload` = write latency + the follow-up snapshot latency,
// i.e. what the operator experiences as "saved and the page shows it".
// A write that isn't visible in that first snapshot is retried up to 3
// times 1 s apart; one that never shows up counts as a lost edit and
// stops the loop (spec: "any timeout or uncertain write → stop,
// reconcile the event").
//
// Standalone:
//   k6 run -e BASE_URL=... -e EVENT_ID=... -e ADMIN_PASSWORD=... \
//          tests/load/admin-writes.js
// It is also imported as a scenario by hold.js.

import http from "k6/http";
import { sleep } from "k6";
import { Trend, Rate, Counter } from "k6/metrics";
import exec from "k6/execution";
import { BASE_URL, EVENT_ID, baseHeaders, snapshotUrl, requireEnv, GATES } from "./lib/config.js";
import { adminSection, resultsDir, stamp } from "./lib/report.js";

export const adminSaveReload = new Trend("admin_save_reload", true);
export const adminWriteLatency = new Trend("admin_write_latency", true);
export const adminVisibleFirst = new Rate("admin_visible_first");
export const adminLostEdit = new Rate("admin_lost_edit");
export const adminWrites = new Counter("admin_writes");

const CYCLES = parseInt(__ENV.ADMIN_CYCLES || "4", 10);
// Gap between cycles so the 24 writes spread across the hold instead
// of landing in the first 30 s.
const CYCLE_PAUSE = parseFloat(__ENV.ADMIN_CYCLE_PAUSE || "20");
const NOTE = "n12-load-test";

let loggedIn = false;

// Stop the whole run (not just this iteration): after an uncertain
// write the event's state is unknown and further load results would be
// measured against a setlist nobody has reconciled. Callers clean up
// their own rows first (see the catch in adminCycle).
function stop(msg) {
  exec.test.abort(msg);
}

function jsonHeaders() {
  return { ...baseHeaders(), "Content-Type": "application/json" };
}

function login() {
  const res = http.post(
    `${BASE_URL}/api/admin/login`,
    JSON.stringify({ password: requireEnv("ADMIN_PASSWORD") }),
    { headers: jsonHeaders(), tags: { name: "admin_login" } },
  );
  // The session cookie lands in this VU's cookie jar and rides along
  // on every later request automatically.
  if (res.status !== 200) stop(`admin login failed: HTTP ${res.status}`);
  loggedIn = true;
}

// Always a full-body snapshot with a fixed locale: the visibility check
// needs the body, and ja is the default locale the admin page renders.
function readSnapshot() {
  const res = http.get(snapshotUrl("ja"), {
    headers: baseHeaders(),
    tags: { name: "admin_reload" },
    timeout: "30s",
  });
  if (res.status !== 200) return { res, body: null };
  try {
    return { res, body: JSON.parse(res.body) };
  } catch {
    return { res, body: null };
  }
}

// Run one write, then poll the snapshot until `isVisible(body)` holds.
// `onAck(res)` runs as soon as the server acknowledged the write and
// before any visibility check, so a created row's id is recorded for
// cleanup even if the check below fails. Failures throw; adminCycle
// cleans up and then aborts the run.
function timedWrite(label, doWrite, isVisible, onAck) {
  const res = doWrite();
  adminWrites.add(1);
  adminWriteLatency.add(res.timings.duration, { op: label });
  // The create routes answer 201, the rest 200.
  if (res.status < 200 || res.status >= 300) {
    adminLostEdit.add(true, { op: label });
    throw new Error(`${label}: HTTP ${res.status} ${String(res.body).slice(0, 200)}`);
  }
  if (onAck) onAck(res);
  let snap = readSnapshot();
  const first = snap.body != null && isVisible(snap.body);
  adminVisibleFirst.add(first, { op: label });
  adminSaveReload.add(res.timings.duration + snap.res.timings.duration, { op: label });
  let visible = first;
  for (let i = 0; i < 3 && !visible; i++) {
    sleep(1);
    snap = readSnapshot();
    visible = snap.body != null && isVisible(snap.body);
  }
  adminLostEdit.add(!visible, { op: label });
  if (!visible) throw new Error(`${label}: write acknowledged but never visible`);
  return { res, body: snap.body };
}

const byId = (body, id) => body.items.find((it) => String(it.id) === String(id));

function songIdsOf(item) {
  return (item.songs || []).map((s) => Number(s.song.id));
}

export function adminCycle() {
  if (!loggedIn) login();

  const { body: start } = readSnapshot();
  if (!start || start.items.length === 0) {
    stop("test event has no setlist rows — seed it first (see README)");
  }
  const last = start.items[start.items.length - 1];
  const maxPos = Math.max(...start.items.map((it) => it.position));
  // Borrow two real song ids from the event so the rows look like the
  // real thing (song join + translations on the read path).
  const songPool = [];
  for (const it of start.items) for (const id of songIdsOf(it)) if (!songPool.includes(id)) songPool.push(id);
  if (songPool.length < 2) stop("test event needs at least two distinct songs");
  const [songA, songB] = songPool;
  // Same encore flag as the current tail so validateEncoreOrder accepts
  // an append after an encore block.
  const isEncore = !!last.isEncore;
  const created = [];

  try {
    // 1. append
    const posA = maxPos + 1;
    let idA = null;
    timedWrite(
      "create",
      () =>
        http.post(
          `${BASE_URL}/api/admin/setlist-items`,
          JSON.stringify({ eventId: EVENT_ID, position: posA, isEncore, note: NOTE, songIds: [songA] }),
          { headers: jsonHeaders(), tags: { name: "admin_create" } },
        ),
      // Visibility predicate can't know the id until the response is
      // parsed, so match by position + song instead.
      (b) => b.items.some((it) => it.position === posA && songIdsOf(it).includes(songA)),
      (r) => {
        idA = JSON.parse(r.body).id;
        created.push(idA);
      },
    );

    // 2. edit (change the song)
    timedWrite(
      "update",
      () =>
        http.put(
          `${BASE_URL}/api/admin/setlist-items/${idA}`,
          JSON.stringify({ position: posA, isEncore, note: NOTE, songIds: [songB] }),
          { headers: jsonHeaders(), tags: { name: "admin_update" } },
        ),
      (b) => {
        const it = byId(b, idA);
        return !!it && songIdsOf(it).includes(songB) && !songIdsOf(it).includes(songA);
      },
    );

    // 3. insert-after the tail (shifts nothing)
    const posB = posA + 1;
    let idB = null;
    timedWrite(
      "insert_after",
      () =>
        http.post(
          `${BASE_URL}/api/admin/setlist-items/insert-after`,
          JSON.stringify({ eventId: EVENT_ID, afterPosition: posA }),
          { headers: jsonHeaders(), tags: { name: "admin_insert_after" } },
        ),
      (b) => b.items.some((it) => it.position === posB),
      (r) => {
        idB = JSON.parse(r.body).id;
        created.push(idB);
      },
    );

    // 4. swap
    timedWrite(
      "swap",
      () =>
        http.post(
          `${BASE_URL}/api/admin/setlist-items/swap`,
          JSON.stringify({ itemIdA: idA, itemIdB: idB }),
          { headers: jsonHeaders(), tags: { name: "admin_swap" } },
        ),
      (b) => {
        const a = byId(b, idA);
        const bb = byId(b, idB);
        return !!a && !!bb && a.position === posB && bb.position === posA;
      },
    );

    // 5. delete both
    for (const id of [idA, idB]) {
      timedWrite(
        "delete",
        () =>
          http.del(`${BASE_URL}/api/admin/setlist-items/${id}`, null, {
            headers: baseHeaders(),
            tags: { name: "admin_delete" },
          }),
        (b) => !byId(b, id),
        () => created.splice(created.indexOf(id), 1),
      );
    }
  } catch (e) {
    // Clean up *before* aborting so a failed run doesn't leave n12 rows
    // visible on the event. Best-effort and untimed; whatever this
    // can't remove is listed in the abort message for the operator.
    const leftover = [];
    for (const id of created) {
      const r = http.del(`${BASE_URL}/api/admin/setlist-items/${id}`, null, {
        headers: baseHeaders(),
        tags: { name: "admin_cleanup" },
      });
      if (r.status !== 200) leftover.push(id);
    }
    stop(
      `${e.message} — stop and reconcile the event` +
        (leftover.length ? ` (rows NOT cleaned up: ${leftover.join(", ")})` : ""),
    );
  }

  // Don't sleep after the final cycle — the run is over.
  if (exec.scenario.iterationInTest < CYCLES - 1) sleep(CYCLE_PAUSE);
}

export const adminScenario = (startTime = "0s") => ({
  executor: "shared-iterations",
  vus: 1,
  iterations: CYCLES,
  startTime,
  // 4 cycles × (6 writes + pauses) — generous so a slow server is
  // measured rather than cut off.
  maxDuration: "30m",
  exec: "adminCycle",
});

export const adminThresholds = {
  admin_save_reload: [`p(95)<=${GATES.adminP95}`],
  admin_lost_edit: ["rate==0"],
  admin_visible_first: ["rate==1"],
};

export const options = {
  scenarios: { admin: adminScenario() },
  thresholds: adminThresholds,
  summaryTrendStats: ["avg", "min", "med", "p(90)", "p(95)", "p(99)", "max"],
};

export default adminCycle;

export function handleSummary(data) {
  const md = `## Admin writes — ${new Date().toISOString()}\n` + adminSection(data);
  const base = `${resultsDir()}/${stamp()}-admin`;
  return { stdout: md, [`${base}.md`]: md };
}
