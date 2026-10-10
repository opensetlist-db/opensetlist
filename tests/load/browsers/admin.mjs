// Admin driver for the browsers run (dev only): the operator's
// "insert a row near the top and fill in the song" edit, plus the
// clean-up that puts event 111 back the way it was.
//
// One edit = TWO saves, because that is the only way to get a row with
// a visible, unique title into the middle of a setlist through the real
// admin API:
//
//   1. POST /api/admin/setlist-items/insert-after  { afterPosition }
//      → a blank song row ("曲名確認中" publicly — no title, no link),
//        shifting every later row down by one.
//   2. PUT  /api/admin/setlist-items/<id>          { songIds: [marker] }
//      → the row now shows the marker song's title, rendered as a link
//        `/<locale>/songs/<songId>/<slug>` that the page-side observer
//        looks for.
//
// The primary latency is measured from the START of save 2 (the save
// that makes the marker exist); save-1-start latencies are reported
// alongside. Both saves return the new `rev` (Event.setlistRevision)
// in their JSON body, which is what the SDK subscribers are measured
// against.
//
// Marker songs: real Song rows that no SetlistItemSong row (deleted or
// not) has ever referenced, so their link can't already be on the page
// (setlist, wishes, predictions) and every run gets fresh ones — the
// rows this run soft-deletes keep their song links, so the next run's
// query skips those songs automatically.
//
// Position restore (OPT-IN, `--restore-positions`): insert-after shifts
// the pre-existing rows below the insertion point down by one per edit,
// and the soft-delete route does not compact positions. The page
// numbers rows by index (<ActualSetlist> passes `bucketIndex`), so
// nothing visible changes and the order is intact, but every run
// ratchets the stored positions of rows 3..23 up by K. Putting them
// back means writing the pre-existing rows directly in SQL, which the
// run must not do on its own (shared test event — "never edit or move
// the pre-existing rows" outside the app's own save paths), so it only
// happens when the operator asks for it. `restorePositions` puts every row that
// was active at the start back on its recorded position, in ONE
// transaction that first takes the same `SELECT … FOR UPDATE` lock on
// the Event row that every admin writer takes (src/lib/liveBroadcast.ts
// `lockEvent`), so it can't interleave with another save. It refuses
// (and only reports) when the active row set is not exactly the one it
// recorded plus rows that sit beyond the recorded tail — e.g. another
// stream's appended rows are left alone and must not collide.
// After the SQL, one more soft-delete of an already-deleted row of ours
// runs through the API: that route bumps the revision, broadcasts and
// purges the snapshot cache (`revalidateEventData`) — so no viewer or
// cache keeps the shifted positions.
import { sleep } from "../realtime/lib.mjs";

const COOKIE_NAME = "admin_session";

export async function adminLogin(base) {
  const pw = process.env.ADMIN_PASSWORD;
  if (!pw) throw new Error("ADMIN_PASSWORD is not set (.env)");
  const res = await fetch(`${base}/api/admin/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password: pw }),
  });
  // getSetCookie() returns each Set-Cookie separately; pick ours.
  const cookies = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [res.headers.get("set-cookie") || ""];
  const mine = cookies.map((c) => c.split(";")[0]).find((c) => c.startsWith(`${COOKIE_NAME}=`));
  if (res.status !== 200 || !mine) throw new Error(`admin login failed: HTTP ${res.status}`);
  return mine;
}

export async function getSnapshot(base, eventId, { locale = "ja", minRev = null } = {}) {
  const url = `${base}/api/setlist?eventId=${eventId}&locale=${locale}${minRev != null ? `&minRev=${minRev}` : ""}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`snapshot HTTP ${res.status}`);
  return res.json();
}

async function timedJson(label, url, init) {
  const startedAt = Date.now();
  let res;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(30000) });
  } catch (e) {
    throw new Error(`${label}: ${e.message}`);
  }
  const ms = Date.now() - startedAt;
  let body = null;
  try { body = await res.json(); } catch { /* non-JSON error body */ }
  if (!res.ok) throw new Error(`${label}: HTTP ${res.status} ${JSON.stringify(body)?.slice(0, 200)}`);
  return { startedAt, ms, body };
}

export async function insertAfter({ base, cookie, eventId, afterPosition }) {
  const r = await timedJson("insert-after", `${base}/api/admin/setlist-items/insert-after`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ eventId: String(eventId), afterPosition }),
  });
  return { startedAt: r.startedAt, ms: r.ms, id: String(r.body.id), position: r.body.position, rev: r.body.rev ?? null };
}

export async function putSong({ base, cookie, id, position, songId }) {
  // Everything else at its route default (full_group, confirmed,
  // live_performance, type song). No performers: the row is a test
  // marker, and the route rewrites links from scratch anyway.
  const r = await timedJson("put", `${base}/api/admin/setlist-items/${id}`, {
    method: "PUT",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ position, isEncore: false, type: "song", status: "confirmed", songIds: [Number(songId)] }),
  });
  return { startedAt: r.startedAt, ms: r.ms, rev: r.body.rev ?? null };
}

export async function softDelete({ base, cookie, id }) {
  const r = await timedJson("delete", `${base}/api/admin/setlist-items/${id}`, { method: "DELETE", headers: { cookie } });
  return { ms: r.ms, rev: r.body?.rev ?? null };
}

// Active rows of the event, straight from the DB (not the cached
// snapshot): the clean-up must see exactly what is committed.
export async function activeRows(pg, eventId) {
  const r = await pg.query(
    `select id::text as id, position from "SetlistItem" where "eventId" = $1 and "isDeleted" = false order by position`,
    [eventId],
  );
  return r.rows.map((x) => ({ id: x.id, position: Number(x.position) }));
}

// After a failed insert-after (HTTP 5xx, timeout): did the row get
// committed anyway? Looks for an active row of the event, created since
// `sinceMs` (DB clock vs ours: 5 s of slack), sitting right after the
// insertion point, that is neither a recorded starting row nor one of
// ours — another stream only ever appends at the tail, far below.
export async function findUnacknowledgedInsert(pg, eventId, { sinceMs, position, knownIds }) {
  const r = await pg.query(
    `select id::text as id, position from "SetlistItem"
      where "eventId" = $1 and "isDeleted" = false and position = $2
        and "createdAt" >= ($3::timestamptz at time zone 'UTC') - interval '5 seconds'`,
    [eventId, position, new Date(sinceMs).toISOString()],
  );
  return r.rows.map((x) => ({ id: x.id, position: Number(x.position) })).find((x) => !knownIds.has(x.id)) ?? null;
}

export async function pickMarkerSongs(pg, k) {
  const r = await pg.query(
    `select s.id::text as id, s.slug, s."originalTitle" as title
       from "Song" s
      where s."isDeleted" = false
        and s.slug is not null and s.slug <> ''
        and not exists (select 1 from "SetlistItemSong" sis where sis."songId" = s.id)
      order by s.id
      limit $1`,
    [k],
  );
  if (r.rows.length < k) throw new Error(`only ${r.rows.length} unused songs available for ${k} markers`);
  return r.rows;
}

export async function restorePositions(pg, eventId, original) {
  const origById = new Map(original.map((r) => [r.id, r.position]));
  const maxOrig = Math.max(...original.map((r) => r.position));
  try {
    await pg.query("begin");
    const lock = await pg.query(`select id from "Event" where id = $1 for update`, [eventId]);
    if (!lock.rows.length) throw new Error("event not found");
    const now = await activeRows(pg, eventId);
    // Recorded rows that are gone now were deleted by someone else
    // meanwhile (another stream's own test row, typically) — they only
    // free positions, so they never block the restore.
    const missing = original.filter((r) => !now.some((x) => x.id === r.id));
    const foreign = now.filter((x) => !origById.has(x.id));
    // A row we don't know about is only tolerated beyond the recorded
    // tail, where restoring can't collide with it (another stream's
    // appends). Anything else: leave the event alone and say so.
    const blocking = foreign.filter((x) => x.position <= maxOrig);
    if (blocking.length) {
      await pg.query("rollback");
      return { restored: 0, skipped: `unknown active rows inside the recorded range: ${blocking.map((r) => `${r.id}@${r.position}`).join(",")}` };
    }
    const moved = now.filter((x) => origById.has(x.id) && origById.get(x.id) !== x.position);
    if (!moved.length) {
      await pg.query("commit");
      return { restored: 0, ...(missing.length ? { goneMeanwhile: missing.map((r) => r.id) } : {}) };
    }
    const ids = moved.map((x) => x.id);
    const pos = moved.map((x) => origById.get(x.id));
    // Two steps through a parking range: the partial unique index on
    // (eventId, position) is checked row by row, so a single UPDATE
    // that moves rows down by K could hit a not-yet-moved neighbour.
    await pg.query(
      `update "SetlistItem" set position = position + 1000000 where id = any($1::bigint[]) and "eventId" = $2`,
      [ids, eventId],
    );
    await pg.query(
      `update "SetlistItem" si set position = v.pos
         from unnest($1::bigint[], $2::int[]) as v(id, pos)
        where si.id = v.id and si."eventId" = $3`,
      [ids, pos, eventId],
    );
    await pg.query("commit");
    return { restored: moved.length, ...(missing.length ? { goneMeanwhile: missing.map((r) => r.id) } : {}) };
  } catch (e) {
    try { await pg.query("rollback"); } catch { /* connection gone */ }
    return { restored: 0, error: e.message };
  }
}

// Soft-delete every created row (retrying each a few times), then
// restore positions and publish the result through one API save.
export async function cleanup({ base, cookie, pg, eventId, created, original, restore = true, log = console.log }) {
  const out = { deleted: [], failed: [], restore: null, finalRev: null };
  for (const id of [...created].reverse()) {
    let ok = false;
    for (let attempt = 0; attempt < 3 && !ok; attempt++) {
      try {
        const r = await softDelete({ base, cookie, id });
        out.finalRev = r.rev ?? out.finalRev;
        ok = true;
      } catch (e) {
        log(`  delete ${id} failed (attempt ${attempt + 1}): ${e.message}`);
        await sleep(1000);
      }
    }
    (ok ? out.deleted : out.failed).push(id);
  }
  if (restore && pg && original && out.failed.length === 0) {
    out.restore = await restorePositions(pg, eventId, original);
    if (out.restore.restored > 0 && created.length) {
      // Re-delete one of our (already deleted) rows: a no-op on the data
      // that bumps the revision, broadcasts and purges the cached
      // snapshot, so the restored positions are what everyone reads.
      try {
        const r = await softDelete({ base, cookie, id: created[0] });
        out.finalRev = r.rev ?? out.finalRev;
      } catch (e) {
        out.restore.publishError = e.message;
      }
    }
  }
  return out;
}
