// n14 qualification step 5 — the "largest Fes" fixture (dev only).
//
// Grows the rehearsal event (111) to a synthetic Fes-size setlist by
// cloning its own active rows, so the cold-admission runs measure a
// snapshot with the row structure of a real show: the same stage-type
// mix, member links (incl. the nullable realPersonId), artist links, the
// 6-song medley and the encore block — just more of it. With today's 23
// rows, `--target=70 --anchor-reserve=1` = 23 originals + 46 clones (two
// full copies), and the harness's blank anchor makes the 70th row.
//
//   node tests/load/fixtures/fes-rows.mjs --target=70 --anchor-reserve=1 --label=A2
//   node tests/load/fixtures/fes-rows.mjs --cleanup=<manifest> [--publish]
//   node tests/load/fixtures/fes-rows.mjs --verify=<manifest>
//   node tests/load/fixtures/fes-rows.mjs --sizes --base=<url>      (AFTER a run only)
//
// ── Why direct SQL, and why this transaction shape ───────────────
// The admin API cannot build an exact structural clone: its PUT creates
// member links from stage-identity ids only (no explicit realPersonId),
// and one row = several saves (insert + PUT). The fixture therefore
// writes the rows in ONE transaction that:
//
//   1. locks the Event row FIRST (`SELECT … FOR UPDATE`, the same lock
//      every admin writer takes — src/lib/liveBroadcast.ts `lockEvent`),
//      so the source rows it reads and the positions it allocates cannot
//      interleave with a save;
//   2. reads the active rows and plans positions (fes-rows-lib.mjs
//      `planFixture`): ordinary clones go BEFORE the encore block and
//      encore clones after it — every measured admin PUT validates the
//      whole event's encore order, and an appended copy would 400 them;
//   3. parks the encore originals that must shift, inserts the clones and
//      their SetlistItemSong (with `order`) / SetlistItemMember (with the
//      nullable `realPersonId`) / SetlistItemArtist rows, then moves the
//      parked originals to their new positions — the partial unique index
//      on (eventId, position) is checked row by row, hence the parking;
//   4. bumps `Event.setlistRevision` by 1 WITHOUT `realtime.send` and
//      without any cache purge.
//
// Step 4 is deliberate. The fixture is a QUARANTINED preparation step:
// it runs before a fresh deployment (new BUILD_KEY ⇒ new snapshot and
// warm namespaces), so nothing it would warm or purge survives into the
// measurement anyway, and a broadcast would only reach clients that must
// not exist at that moment. It MUST run with no client of ours connected
// (no harness SDK cohort, no observer, no browser tab on the event): if
// one were, its missing broadcast is "preparation traffic", never the
// idle-broadcast defect, and that idle cycle's isolation is broken. The
// revision bump still matters: any cached snapshot taken before the
// fixture is below the new head, so a `minRev` read can never accept it.
//
// ── Recovery ─────────────────────────────────────────────────────
// The manifest (`tests/load/results/<UTC date>/fixture-<label>.json`) is
// written BEFORE COMMIT with the inserted ids (state `pending-commit`)
// and finalised after it (`committed`). A process that dies before the
// commit leaves nothing (the transaction rolls back with the session); one
// that dies between commit and finalisation leaves a pending manifest
// that already names every created row — `--cleanup` accepts both. As a
// last resort every clone carries `createdAt` = the transaction's own
// `now()` (recorded as `txNow`), so
//   select id from "SetlistItem" where "eventId" = 111 and "createdAt" = '<txNow>'
// finds exactly the rows of one fixture transaction.
//
// ── Clean-up order ───────────────────────────────────────────────
// After the run (the harness has soft-deleted its own anchor first):
//   1. `--cleanup=<manifest>`: one transaction, Event lock first —
//      soft-delete the clones (`isDeleted`, `deletedAt`; the junction rows
//      stay with their soft-deleted parent, the schema's convention for
//      SetlistItem), restore every ORIGINAL row to its recorded
//      pre-fixture position (parking again), bump the revision +1 without
//      a broadcast; then verify and print the PASS/FAIL table.
//   2. publish through the normal writer path, so caches and any open tab
//      drop the fixture rows: `--publish` here (one admin login, then a
//      no-op re-delete of an already soft-deleted clone through
//      DELETE /api/admin/setlist-items/<id> — that route bumps the
//      revision, broadcasts and purges the event cache; the same trick
//      restore.mjs uses). `restore.mjs --compact --yes` publishes ONLY
//      when it moves rows, and after an exact restore it moves none — it
//      is the recovery tool when the positions could NOT be restored.
//   3. `--verify=<manifest>` again (revisions only ever increase; the
//      verifier checks "greater than the fixture's revision").
import fs from "node:fs";
import path from "node:path";
import https from "node:https";
import http from "node:http";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import { loadEnv, assertDev, parseArgs, pgClient, isAllowedBaseUrl, isDeploymentBaseUrl } from "../realtime/lib.mjs";
import { adminLogin, softDelete } from "../browsers/admin.mjs";
import { cloneCount, planFixture, planRestore, verifyAgainst, encoreOrderError, PARK_OFFSET, SCALAR_COLUMNS } from "./fes-rows-lib.mjs";

const REPO = path.resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const DEFAULT_BASE = "https://opensetlist-git-dev-opensetlist-projects.vercel.app";

loadEnv();
assertDev();
const args = parseArgs(process.argv.slice(2));
const EVENT_ID = String(args["event-id"] ?? "111");
const utcDate = () => new Date().toISOString().slice(0, 10);
const log = (...a) => console.log(...a);

// ── DB reads ─────────────────────────────────────────────────────
// Everything the verifier compares, for the event's ACTIVE rows: the
// scalar columns, songs (with order), members (with realPersonId) and
// artists. Positions are numbers; ids are strings (BigInt → text).
async function readState(pg, eventId) {
  const ev = await pg.query(
    `select status::text as status, "startTime"::text as "startTime", "setlistRevision"::text as "setlistRevision"
       from "Event" where id = $1`,
    [eventId],
  );
  if (!ev.rows.length) throw new Error(`event ${eventId} not found`);
  const items = await pg.query(
    `select id::text as id, position, "isEncore", "stageType"::text as "stageType", "unitName", note,
            status::text as status, "performanceType"::text as "performanceType", type::text as type
       from "SetlistItem" where "eventId" = $1 and "isDeleted" = false order by position, id`,
    [eventId],
  );
  const ids = items.rows.map((r) => r.id);
  // Sequential: one pg Client runs one query at a time anyway (and
  // queuing several on it is deprecated in pg 8).
  const songs = await pg.query(`select "setlistItemId"::text as item, "songId"::text as "songId", "order" from "SetlistItemSong" where "setlistItemId" = any($1::bigint[])`, [ids]);
  const members = await pg.query(`select "setlistItemId"::text as item, "stageIdentityId", "realPersonId" from "SetlistItemMember" where "setlistItemId" = any($1::bigint[])`, [ids]);
  const artists = await pg.query(`select "setlistItemId"::text as item, "artistId"::text as "artistId" from "SetlistItemArtist" where "setlistItemId" = any($1::bigint[])`, [ids]);
  const group = (res, map) => {
    const m = new Map();
    for (const r of res.rows) (m.get(r.item) || m.set(r.item, []).get(r.item)).push(map(r));
    return m;
  };
  const S = group(songs, (r) => ({ songId: r.songId, order: r.order }));
  const M = group(members, (r) => ({ stageIdentityId: r.stageIdentityId, realPersonId: r.realPersonId }));
  const A = group(artists, (r) => ({ artistId: r.artistId }));
  const rows = items.rows.map((r) => ({
    ...r,
    position: Number(r.position),
    songs: (S.get(r.id) || []).sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
    members: M.get(r.id) || [],
    artists: A.get(r.id) || [],
  }));
  return { event: ev.rows[0], rows };
}

const linkCounts = (rows) => ({
  songs: rows.reduce((a, r) => a + r.songs.length, 0),
  members: rows.reduce((a, r) => a + r.members.length, 0),
  artists: rows.reduce((a, r) => a + r.artists.length, 0),
});

// Two-step position move through the parking range (see fes-rows-lib.mjs
// PARK_OFFSET). `moves` = [{ id, to }].
async function moveRows(pg, eventId, moves) {
  if (!moves.length) return;
  const ids = moves.map((m) => m.id);
  await pg.query(`update "SetlistItem" set position = position + ${PARK_OFFSET} where id = any($1::bigint[]) and "eventId" = $2`, [ids, eventId]);
  await pg.query(
    `update "SetlistItem" si set position = v.pos from unnest($1::bigint[], $2::int[]) as v(id, pos) where si.id = v.id and si."eventId" = $3`,
    [ids, moves.map((m) => m.to), eventId],
  );
}

function writeJson(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  // Write-then-rename: a crash mid-write must not leave a truncated
  // manifest in place of the pending one (the recovery depends on it).
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(obj, null, 2));
  fs.renameSync(`${file}.tmp`, file);
}

function readManifest(p) {
  const file = path.resolve(p);
  const m = JSON.parse(fs.readFileSync(file, "utf8"));
  if (m.kind !== "fes-rows-fixture") throw new Error(`${file} is not a fes-rows fixture manifest`);
  return { file, m };
}

function printTable(rows) {
  const w = Math.max(...rows.map((r) => r.check.length));
  for (const r of rows) log(`  ${r.ok ? "PASS" : "FAIL"}  ${r.check.padEnd(w)}  ${r.detail}`);
  const fails = rows.filter((r) => !r.ok).length;
  log(fails ? `  → ${fails} FAIL` : "  → all PASS");
  return fails === 0;
}

// ── create ──────────────────────────────────────────────────────
async function create() {
  const label = String(args.label || "");
  if (!/^[A-Za-z0-9_.-]+$/.test(label)) throw new Error("--label=<name> is required ([A-Za-z0-9_.-])");
  const target = parseInt(args.target, 10);
  const reserve = args["anchor-reserve"] == null ? 0 : parseInt(args["anchor-reserve"], 10);
  const file = path.join(REPO, "tests", "load", "results", utcDate(), `fixture-${label}.json`);
  if (fs.existsSync(file)) throw new Error(`${file} exists — pick another --label (a manifest is never overwritten: it may be the only record of live clones)`);

  const pg = pgClient();
  await pg.connect();
  let manifest = null;
  try {
    await pg.query("begin");
    const lock = await pg.query(`select id from "Event" where id = $1 for update`, [EVENT_ID]);
    if (!lock.rows.length) throw new Error(`event ${EVENT_ID} not found`);
    const txNow = (await pg.query(`select to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') as t`)).rows[0].t;
    const before = await readState(pg, EVENT_ID);
    const n = cloneCount({ active: before.rows.length, target, reserve });
    const plan = planFixture(before.rows, { clones: n });
    log(`event ${EVENT_ID}: ${before.rows.length} active rows, rev ${before.event.setlistRevision}, status ${before.event.status}`);
    log(`plan: ${n} clones (target ${target}, anchor reserve ${reserve}); ${plan.clones.filter((c) => !c.isEncore).length} ordinary before the encore block, ${plan.clones.filter((c) => c.isEncore).length} encore appended; originals shifted: ${plan.shifted.map((s) => `${s.id} ${s.from}→${s.to}`).join(", ") || "none"}`);

    // Park the originals that move, so the clone inserts can take their
    // old slots without tripping the per-row unique check.
    if (plan.shifted.length) {
      await pg.query(`update "SetlistItem" set position = position + ${PARK_OFFSET} where id = any($1::bigint[]) and "eventId" = $2`, [plan.shifted.map((s) => s.id), EVENT_ID]);
    }
    const created = [];
    const cols = SCALAR_COLUMNS.map((c) => `"${c}"`).join(", ");
    for (const c of plan.clones) {
      // Scalars copied from the source row in SQL (no JS round trip of
      // enum values); `isEncore` is part of SCALAR_COLUMNS and equals the
      // plan's, which the plan derived from the same source row.
      const ins = await pg.query(
        `insert into "SetlistItem" ("eventId", position, ${cols}, "isDeleted", "createdAt")
         select "eventId", $2, ${cols}, false, now() at time zone 'UTC' from "SetlistItem" where id = $1 and "eventId" = $3
         returning id::text as id`,
        [c.sourceId, c.position, EVENT_ID],
      );
      if (ins.rows.length !== 1) throw new Error(`clone of ${c.sourceId} not inserted`);
      const id = ins.rows[0].id;
      // Junctions: new uuid ids (the tables' Prisma @default(uuid()) is
      // client-side, so the DB has no default to rely on).
      const s = await pg.query(
        `insert into "SetlistItemSong" (id, "setlistItemId", "songId", "order")
         select gen_random_uuid()::text, $1, "songId", "order" from "SetlistItemSong" where "setlistItemId" = $2`,
        [id, c.sourceId],
      );
      const m = await pg.query(
        `insert into "SetlistItemMember" (id, "setlistItemId", "stageIdentityId", "realPersonId")
         select gen_random_uuid()::text, $1, "stageIdentityId", "realPersonId" from "SetlistItemMember" where "setlistItemId" = $2`,
        [id, c.sourceId],
      );
      const a = await pg.query(
        `insert into "SetlistItemArtist" (id, "setlistItemId", "artistId")
         select gen_random_uuid()::text, $1, "artistId" from "SetlistItemArtist" where "setlistItemId" = $2`,
        [id, c.sourceId],
      );
      created.push({ id, k: c.k, sourceId: c.sourceId, position: c.position, isEncore: c.isEncore, songs: s.rowCount, members: m.rowCount, artists: a.rowCount });
    }
    if (plan.shifted.length) {
      await pg.query(
        `update "SetlistItem" si set position = v.pos from unnest($1::bigint[], $2::int[]) as v(id, pos) where si.id = v.id and si."eventId" = $3`,
        [plan.shifted.map((s) => s.id), plan.shifted.map((s) => s.to), EVENT_ID],
      );
    }
    // No realtime.send, no cache purge — see the header (quarantined).
    const rev = await pg.query(`update "Event" set "setlistRevision" = "setlistRevision" + 1 where id = $1 returning "setlistRevision"::text as rev`, [EVENT_ID]);
    const revAfter = rev.rows[0].rev;

    // Self-check before commit: the DB now holds exactly the plan.
    const after = await readState(pg, EVENT_ID);
    const wantRows = before.rows.length + n;
    if (after.rows.length !== wantRows) throw new Error(`self-check: ${after.rows.length} active rows, expected ${wantRows}`);
    const enc = encoreOrderError(after.rows);
    if (enc) throw new Error(`self-check: encore order violated (${enc})`);
    if (new Set(after.rows.map((r) => r.position)).size !== after.rows.length) throw new Error("self-check: duplicate positions");
    for (const c of created) {
      const src = before.rows.find((r) => r.id === c.sourceId);
      if (c.songs !== src.songs.length || c.members !== src.members.length || c.artists !== src.artists.length) {
        throw new Error(`self-check: clone ${c.id} of ${c.sourceId} has ${c.songs}/${c.members}/${c.artists} links, source ${src.songs.length}/${src.members.length}/${src.artists.length}`);
      }
    }

    manifest = {
      kind: "fes-rows-fixture",
      version: 1,
      state: "pending-commit",
      label,
      eventId: EVENT_ID,
      writtenAt: new Date().toISOString(),
      txNow,
      target,
      anchorReserve: reserve,
      clones: n,
      recovery: `select id from "SetlistItem" where "eventId" = ${EVENT_ID} and "createdAt" = '${txNow}'`,
      revBefore: before.event.setlistRevision,
      revAfter,
      before,
      plan: { shifted: plan.shifted, clones: plan.clones },
      created,
      junctions: {
        created: {
          songs: created.reduce((a, c) => a + c.songs, 0),
          members: created.reduce((a, c) => a + c.members, 0),
          artists: created.reduce((a, c) => a + c.artists, 0),
        },
        before: linkCounts(before.rows),
        after: linkCounts(after.rows),
      },
    };
    writeJson(file, manifest);
    log(`manifest (pending-commit): ${path.relative(REPO, file)}`);
    await pg.query("commit");
    manifest.state = "committed";
    manifest.committedAt = new Date().toISOString();
    const post = await readState(pg, EVENT_ID);
    manifest.after = { event: post.event, activeRows: post.rows.length, rows: post.rows.map((r) => ({ id: r.id, position: r.position, isEncore: r.isEncore })) };
    manifest.originalsAfter = before.rows.map((r) => ({ id: r.id, before: r.position, after: post.rows.find((x) => x.id === r.id)?.position ?? null }));
    writeJson(file, manifest);
    const jc = manifest.junctions;
    log(`committed: ${created.length} clones (ids ${created[0].id}…${created[created.length - 1].id}); active rows ${before.rows.length} → ${post.rows.length} (+${reserve} reserved = ${post.rows.length + reserve}); rev ${before.event.setlistRevision} → ${post.event.setlistRevision} (no broadcast)`);
    log(`links: songs ${jc.before.songs} → ${jc.after.songs}, members ${jc.before.members} → ${jc.after.members}, artists ${jc.before.artists} → ${jc.after.artists}`);
    log(`manifest (committed): ${path.relative(REPO, file)}`);
    log(`clean-up later: node tests/load/fixtures/fes-rows.mjs --cleanup=${path.relative(REPO, file).replace(/\\/g, "/")} --publish`);
  } catch (e) {
    try { await pg.query("rollback"); } catch { /* connection gone */ }
    if (manifest && manifest.state === "pending-commit") {
      // The rollback ran (or the session died, which also rolls back):
      // say so in the manifest so --cleanup does not chase phantom rows.
      manifest.state = "rolled-back";
      manifest.error = e.message;
      writeJson(file, manifest);
    }
    throw e;
  } finally {
    await pg.end();
  }
}

// ── cleanup ─────────────────────────────────────────────────────
async function cleanup() {
  const { file, m } = readManifest(args.cleanup);
  if (m.eventId !== EVENT_ID) throw new Error(`manifest is for event ${m.eventId}, not ${EVENT_ID}`);
  if (m.state === "rolled-back") { log("manifest says the fixture rolled back — nothing to clean up"); return true; }
  const ids = m.created.map((c) => c.id);
  const origIds = new Set(m.before.rows.map((r) => r.id));
  if (ids.some((id) => origIds.has(id))) throw new Error("manifest lists an original row as a clone — refusing");
  const pg = pgClient();
  await pg.connect();
  try {
    await pg.query("begin");
    await pg.query(`select id from "Event" where id = $1 for update`, [EVENT_ID]);
    const del = await pg.query(
      `update "SetlistItem" set "isDeleted" = true, "deletedAt" = now() at time zone 'UTC'
        where id = any($1::bigint[]) and "eventId" = $2 and "isDeleted" = false returning id::text as id`,
      [ids, EVENT_ID],
    );
    const cur = await pg.query(`select id::text as id, position from "SetlistItem" where "eventId" = $1 and "isDeleted" = false`, [EVENT_ID]);
    const r = planRestore(m.before.rows, cur.rows);
    if (r.blocking.length) {
      await pg.query("rollback");
      log(`refusing: active rows not in the manifest sit on recorded positions: ${r.blocking.map((b) => `${b.id}@${b.position}`).join(", ")}`);
      log("soft-delete them first (the harness anchor: its own clean-up, or restore.mjs --delete=<id>), then re-run --cleanup. Nothing was changed.");
      return false;
    }
    await moveRows(pg, EVENT_ID, r.moves);
    const rev = await pg.query(`update "Event" set "setlistRevision" = "setlistRevision" + 1 where id = $1 returning "setlistRevision"::text as rev`, [EVENT_ID]);
    await pg.query("commit");
    m.cleanup = {
      at: new Date().toISOString(),
      softDeleted: del.rows.length,
      alreadyDeleted: ids.length - del.rows.length,
      moves: r.moves,
      foreignActive: r.foreign,
      goneMeanwhile: r.missing,
      rev: rev.rows[0].rev,
    };
    writeJson(file, m);
    log(`cleanup: soft-deleted ${del.rows.length} clones (${ids.length - del.rows.length} already deleted); restored ${r.moves.length} original positions (${r.moves.map((x) => `${x.id} ${x.from}→${x.to}`).join(", ") || "none moved"}); rev → ${rev.rows[0].rev} (no broadcast)`);
    if (r.foreign.length) log(`note: active rows not in the manifest (left alone, beyond the recorded positions): ${r.foreign.map((f) => `${f.id}@${f.position}`).join(", ")}`);
    if (r.missing.length) log(`note: recorded rows no longer active: ${r.missing.join(", ")}`);
  } catch (e) {
    try { await pg.query("rollback"); } catch { /* connection gone */ }
    throw e;
  } finally {
    await pg.end();
  }

  if (args.publish) {
    // Publication through the writer path: DELETE of an already
    // soft-deleted clone is a data no-op that bumps the revision,
    // broadcasts and purges the event cache (route comment: "Deleting an
    // already-deleted row still bumps"). One admin login — the Vercel
    // firewall rate-limits /api/admin/login.
    process.env.BASE_URL = String(args.base || process.env.BASE_URL || DEFAULT_BASE);
    assertDev({ requireBase: true });
    const base = process.env.BASE_URL.replace(/\/$/, "");
    const cookie = await adminLogin(base);
    const r = await softDelete({ base, cookie, id: ids[0] });
    m.cleanup.published = { at: new Date().toISOString(), base, via: ids[0], rev: r.rev };
    writeJson(file, m);
    log(`published via no-op re-delete of clone ${ids[0]} on ${base} (rev ${r.rev})`);
  } else {
    log("NOT published yet: caches and open tabs may still hold the fixture rows. Publish through the writer path:");
    log(`  node tests/load/fixtures/fes-rows.mjs --cleanup=${path.relative(REPO, file).replace(/\\/g, "/")} --publish   (re-running is safe: nothing left to delete or move)`);
  }
  const ok = await verify(file);
  log("");
  log("follow-up: `node tests/load/browsers/restore.mjs --compact --yes` only if a position check FAILED (it compacts and then");
  log("publishes through the normal writer path — but only when it actually moved rows; after an exact restore it is a no-op).");
  return ok;
}

// ── verify ──────────────────────────────────────────────────────
async function verify(manifestPath) {
  const { m } = readManifest(manifestPath);
  const pg = pgClient();
  await pg.connect();
  try {
    const now = await readState(pg, EVENT_ID);
    const ids = m.created.map((c) => c.id);
    const cl = await pg.query(`select id::text as id, "isDeleted" from "SetlistItem" where id = any($1::bigint[]) and "eventId" = $2`, [ids, EVENT_ID]);
    const clonesNow = ids.map((id) => ({ id, isDeleted: cl.rows.find((r) => r.id === id)?.isDeleted ?? null }));
    const rows = verifyAgainst({ before: m.before, now, clonesNow, revAfterFixture: m.revAfter });
    log(`verify ${m.label} (event ${EVENT_ID}): ${now.rows.length} active rows now, ${m.before.rows.length} before the fixture`);
    return printTable(rows);
  } finally {
    await pg.end();
  }
}

// ── sizes ───────────────────────────────────────────────────────
// Raw GET without automatic decompression (node:https, not fetch — fetch
// decodes the body and hides the wire size): wire bytes = what crossed
// the network, JSON bytes = the decoded body.
function rawGet(url, headers) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith("https:") ? https : http;
    const req = lib.get(url, { headers }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, buf: Buffer.concat(chunks) }));
      res.on("error", reject);
    });
    req.setTimeout(30000, () => req.destroy(new Error("timeout")));
    req.on("error", reject);
  });
}

function decode(buf, enc) {
  if (!enc || enc === "identity") return buf;
  if (enc === "br") return zlib.brotliDecompressSync(buf);
  if (enc === "gzip") return zlib.gunzipSync(buf);
  if (enc === "deflate") return zlib.inflateSync(buf);
  throw new Error(`unknown content-encoding ${enc}`);
}

async function sizes() {
  // AFTER a run only: these reads build/cache snapshots on the target,
  // so before a cold boundary they would warm the very deployment the
  // admission run must find cold.
  const base = String(args.base || process.env.BASE_URL || DEFAULT_BASE).replace(/\/$/, "");
  if (!isAllowedBaseUrl(base) && !isDeploymentBaseUrl(base)) throw new Error("--base must be the dev alias, localhost, or an opensetlist-<hash> preview deployment URL");
  const extra = process.env.VERCEL_BYPASS ? { "x-vercel-protection-bypass": process.env.VERCEL_BYPASS } : {};
  log(`sizes: ${base} event ${EVENT_ID} (run AFTER the measurement, never before a cold boundary)`);
  log("| locale | rows | rev | JSON bytes | identity: wire / content-length | compressed: encoding / wire / content-length | x-snapshot-source |");
  log("|---|---|---|---|---|---|---|");
  const out = [];
  for (const locale of ["ja", "ko", "en"]) {
    const url = `${base}/api/setlist?eventId=${EVENT_ID}&locale=${locale}`;
    const plain = await rawGet(url, { ...extra, "accept-encoding": "identity" });
    const comp = await rawGet(url, { ...extra, "accept-encoding": "gzip, deflate, br" });
    const enc = comp.headers["content-encoding"] || "identity";
    const json = decode(comp.buf, enc);
    let body = null;
    try { body = JSON.parse(json.toString("utf8")); } catch { /* reported below */ }
    const row = {
      locale,
      status: [plain.status, comp.status],
      rows: body?.items?.length ?? null,
      rev: body?.rev ?? null,
      jsonBytes: json.length,
      identity: { wire: plain.buf.length, contentLength: plain.headers["content-length"] ?? null, encoding: plain.headers["content-encoding"] ?? "identity" },
      compressed: { encoding: enc, wire: comp.buf.length, contentLength: comp.headers["content-length"] ?? null },
      source: comp.headers["x-snapshot-source"] ?? null,
    };
    out.push(row);
    log(`| ${locale} | ${row.rows ?? "?"} | ${row.rev ?? "?"} | ${row.jsonBytes} | ${row.identity.wire} / ${row.identity.contentLength ?? "—"}${row.identity.encoding !== "identity" ? ` (${row.identity.encoding}!)` : ""} | ${enc} / ${row.compressed.wire} / ${row.compressed.contentLength ?? "—"} | ${row.source ?? "—"} |`);
  }
  log("");
  log("warm codec payload (what the writer's warm job stores per locale) is NOT visible over HTTP. Read it from the run's");
  log("Vercel log capture: every `[liveWarm] set event=<id> locale=<l> … rev=<n> bytes=<n> …` line carries it, and");
  log("`[liveWarm] skip … reason=oversize … bytes=<n>` marks a payload over the cap. Compare max(bytes) per locale with");
  log("WARM_MAX_BYTES = 1,000,000 (src/lib/liveWarm.ts): headroom = 1 − max(bytes) / 1,000,000. e.g.");
  log("  grep -o '\\[liveWarm\\] set event=" + EVENT_ID + " locale=[a-z]* .* bytes=[0-9]*' <capture> | sed -E 's/.*locale=([a-z]+).* bytes=([0-9]+).*/\\1 \\2/' | sort -k1,1 -k2,2n");
  if (args.out) {
    writeJson(path.resolve(String(args.out)), { base, eventId: EVENT_ID, at: new Date().toISOString(), locales: out });
    log(`written: ${args.out}`);
  }
}

// ── main ────────────────────────────────────────────────────────
try {
  let ok = true;
  if (args.cleanup) ok = await cleanup();
  else if (args.verify) ok = await verify(String(args.verify));
  else if (args.sizes) await sizes();
  else if (args.target) await create();
  else {
    log("usage: --target=<n> --anchor-reserve=<k> --label=<name> | --cleanup=<manifest> [--publish] | --verify=<manifest> | --sizes --base=<url>");
    process.exitCode = 2;
  }
  if (!ok) process.exitCode = 1;
} catch (e) {
  console.error(`error: ${e.message}`);
  process.exitCode = 1;
}
