// n14 run #2 — real browsers + SDK subscribers on the live event page
// (dev only). See README.md in this folder for the full-scale commands.
//
// Population: `--pages` headless Chromium pages (ja/ko/en 70/20/10) on
// the event page + `--subs` supabase-js clients that behave like the R1
// page (subs-worker.mjs). Edits: an admin driver inserts a row after
// the 2nd row and fills in a never-used "marker" song, `--edits` times,
// `--pause` seconds apart (admin.mjs). Measurement: PUT start → marker
// link in each page's DOM, and PUT start → each SDK client applying a
// snapshot with rev ≥ the PUT's rev. Missing within `--timeout` s =
// failure. Gate: p95 ≤ 3 s, 0 missing (pairs a drill deliberately
// degrades are judged by that drill's own gate instead).
//
// Drills (one per run): `--drill=silent-loss | ws-blocked | reconnect`,
// see the README and the per-drill comments below.
//
// Results: tests/load/results/<UTC date>/<stamp>-browsers.md (+ .json,
// gitignored). All timestamps in the files are UTC ISO so the run can be
// aligned with a concurrent k6 burst from another stream.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { Worker } from "node:worker_threads";
import { fileURLToPath } from "node:url";
import { loadEnv, assertDev, parseArgs, dist, sleep, pgClient } from "../realtime/lib.mjs";
import { adminLogin, getSnapshot, insertAfter, putSong, activeRows, pickMarkerSongs, cleanup, findUnacknowledgedInsert } from "./admin.mjs";
import { launchPages } from "./pages.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

loadEnv();
process.env.BASE_URL = process.env.BASE_URL || "https://opensetlist-git-dev-opensetlist-projects.vercel.app";
assertDev({ requireBase: true });

const args = parseArgs(process.argv.slice(2));
const int = (k, d) => (args[k] === undefined ? d : parseInt(args[k], 10));
const BASE = process.env.BASE_URL.replace(/\/$/, "");
const EVENT_ID = String(args["event-id"] ?? "111");
const EVENT_PATH = args["event-path"] ?? "/events/111/rehearsal-lovelive-fes-2020-day1";
const PAGES = int("pages", 30);
const SUBS = int("subs", 470);
const EDITS = int("edits", 12);
const PAUSE_MS = Math.round(parseFloat(args.pause ?? "25") * 1000);
const AFTER_ROW = int("after-row", 2);
const TIMEOUT_MS = int("timeout", 30) * 1000;
const SETTLE_MS = int("settle", 10) * 1000;
const JOIN_TIMEOUT_MS = int("join-timeout", 120) * 1000;
const WAIT_PG_READY = args["wait-pg-ready"] !== "false";
const PG_READY_TIMEOUT_MS = int("pg-ready-timeout", 180) * 1000;
const SUB_WORKERS = args["sub-workers"] ? int("sub-workers", 1) : Math.max(1, Math.min(os.cpus().length - 2, Math.ceil(SUBS / 120)));
const SUB_BATCH = int("sub-batch", 50); // joins per second across all workers
const PAGE_CONCURRENCY = int("page-concurrency", 5);
const RESTORE = !!args["restore-positions"]; // opt-in, see admin.mjs "Position restore"
const GATE_P95_MS = int("gate-p95", 3000);
const DRILL = args.drill ?? null;
if (DRILL && !["silent-loss", "ws-blocked", "reconnect"].includes(DRILL)) {
  console.error(`unknown --drill=${DRILL}`);
  process.exit(2);
}
// silent-loss: a subset of pages loses the notification for ONE edit.
// ws-blocked: pages with the websocket blocked for the whole run.
// reconnect: every socket (pages + SDK) is force-closed right before ONE edit.
const DRILL_PAGES = int("drill-pages", DRILL === "silent-loss" ? Math.max(1, Math.ceil(PAGES / 2)) : PAGES);
// silent-loss drills the LAST edit by default: a later edit's notification
// would otherwise repair the drilled pages before the periodic poll does.
const DRILL_EDIT = int("drill-edit", DRILL === "silent-loss" ? EDITS : Math.max(1, Math.ceil(EDITS / 2)));
const RECONNECT_LEAD_MS = int("reconnect-lead", 1000);
// Silent-loss repair gate (spec): periodic poll 20 s ± 4 s → ≤ 24 s incl. fetch/render.
const SILENT_GATE_MS = int("silent-gate", 24000);
// ws-blocked: fallback poll 5 s ± 1 s → expect ≤ ~7 s incl. fetch/render (informational).
const BLOCKED_GATE_MS = int("blocked-gate", 7000);

const LOCALE_OF = ["ja", "ko", "ja", "en", "ja", "ja", "ko", "ja", "ja", "ja"]; // 70/20/10
const iso = (t) => (t == null ? null : new Date(t).toISOString());
const log = (...a) => console.log(`[${new Date().toISOString().slice(11, 23)}]`, ...a);

// ─── run state (module scope so the abort path can clean up) ───
const created = [];
let original = null;
let cookie = null;
let pagePop = null;
const workers = [];
const saveFailures = [];
let finalized = false;

// Short-lived DB connection for one check (session pooler; holding one
// open for the whole run would pin a pooler client for minutes).
async function withPg(fn) {
  const pg = pgClient();
  await pg.connect();
  try {
    return await fn(pg);
  } finally {
    await pg.end().catch(() => {});
  }
}

// ─── SDK subscriber workers ───
function startWorkers() {
  const per = Math.ceil(SUBS / SUB_WORKERS);
  const batchPer = Math.max(1, Math.round(SUB_BATCH / SUB_WORKERS));
  for (let w = 0, offset = 0; w < SUB_WORKERS && offset < SUBS; w++, offset += per) {
    const n = Math.min(per, SUBS - offset);
    const worker = new Worker(path.join(HERE, "subs-worker.mjs"), {
      workerData: {
        offset, n, base: BASE, eventId: EVENT_ID,
        supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
        anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
        batch: batchPer, every: 1000, localeOf: LOCALE_OF,
      },
    });
    const waiters = {};
    worker.on("message", (m) => {
      const q = waiters[m.type];
      if (q && q.length) q.shift()(m);
    });
    worker.on("error", (e) => log(`worker ${w} error: ${e.message}`));
    const ask = (cmd, type, extra = {}) => new Promise((resolve) => {
      (waiters[type] ||= []).push(resolve);
      worker.postMessage({ cmd, ...extra });
    });
    workers.push({ worker, n, ask });
  }
}

// How many SDK clients have applied a snapshot with rev ≥ `rev`.
async function subsReached(rev) {
  const all = await Promise.all(workers.map((w) => w.ask("reached", "reached", { rev })));
  return all.reduce((a, r) => a + r.count, 0);
}

async function subsProgress() {
  const all = await Promise.all(workers.map((w) => w.ask("progress", "progress")));
  return all.reduce((a, p) => ({ joined: a.joined + p.joined, pgReady: a.pgReady + p.pgReady }), { joined: 0, pgReady: 0 });
}

async function stopWorkers() {
  const results = await Promise.all(workers.map((w) => Promise.race([
    w.ask("stop", "result"),
    sleep(20000).then(() => ({ clients: [] })),
  ])));
  await Promise.allSettled(workers.map((w) => w.worker.terminate()));
  return results.flatMap((r) => r.clients);
}

// ─── measurement helpers ───
const firstAfter = (arr, pred) => {
  for (const x of arr) if (pred(x)) return x;
  return null;
};

function summarize(lat, missing) {
  const d = dist(lat);
  return { ...d, missing };
}

function editStats(edit, pageRecs, subRecs, { isDrilledPage, isDrilledSub, notesUntil }) {
  const tPut = edit.put.startedAt;
  const tIns = edit.ins.startedAt;
  const deadline = tPut + TIMEOUT_MS;
  // A notification only counts for this save if it arrives inside the
  // measurement window and before the clean-up starts — the clean-up's
  // soft-delete of the same row is an UPDATE too.
  const noteEnd = Math.min(deadline, notesUntil);
  const out = {
    pages: { lat: [], latFromInsert: [], missing: 0, drilledLat: [], drilledMissing: 0, notifPut: [], notifIns: [] },
    subs: { lat: [], latFromInsert: [], missing: 0, drilledLat: [], drilledMissing: 0, notifPut: [], notifIns: [], bcastPut: [], bcastIns: [] },
  };
  for (const r of pageRecs) {
    const seen = r.seen[edit.song.id];
    const ok = seen != null && seen <= deadline;
    const drilled = isDrilledPage(r, edit);
    const bucket = out.pages;
    if (ok) {
      (drilled ? bucket.drilledLat : bucket.lat).push(seen - tPut);
      if (!drilled) bucket.latFromInsert.push(seen - tIns);
    } else if (drilled) bucket.drilledMissing++;
    else bucket.missing++;
    const nu = firstAfter(r.notes, ([t, ty, id]) => id === edit.id && ty === "U" && t >= tPut && t < noteEnd);
    if (nu) bucket.notifPut.push(nu[0] - tPut);
    const ni = firstAfter(r.notes, ([t, ty, id]) => id === edit.id && ty === "I" && t >= tIns && t < noteEnd);
    if (ni) bucket.notifIns.push(ni[0] - tIns);
  }
  for (const r of subRecs) {
    const a = firstAfter(r.applied, ([, rev]) => rev >= edit.put.rev);
    const ok = a != null && a[0] <= deadline;
    const drilled = isDrilledSub(r, edit);
    const bucket = out.subs;
    if (ok) {
      (drilled ? bucket.drilledLat : bucket.lat).push(a[0] - tPut);
      if (!drilled) bucket.latFromInsert.push(a[0] - tIns);
    } else if (drilled) bucket.drilledMissing++;
    else bucket.missing++;
    const nu = firstAfter(r.notes, ([t, ty, id]) => id === edit.id && ty === "U" && t >= tPut && t < noteEnd);
    if (nu) bucket.notifPut.push(nu[0] - tPut);
    const ni = firstAfter(r.notes, ([t, ty, id]) => id === edit.id && ty === "I" && t >= tIns && t < noteEnd);
    if (ni) bucket.notifIns.push(ni[0] - tIns);
    const bp = firstAfter(r.bcasts, ([t, rev]) => rev === edit.put.rev && t >= tPut - 50);
    if (bp) bucket.bcastPut.push(bp[0] - tPut);
    const bi = firstAfter(r.bcasts, ([t, rev]) => rev === edit.ins.rev && t >= tIns - 50);
    if (bi) bucket.bcastIns.push(bi[0] - tIns);
  }
  return out;
}

const ms = (v) => (v == null ? "—" : `${v}`);
const dline = (d) => `${d.n} | ${ms(d.p50)} | ${ms(d.p95)} | ${ms(d.max)}`;

// ─── main ───
async function main() {
  const runStart = Date.now();
  log(`browsers run: base=${BASE} event=${EVENT_ID} pages=${PAGES} subs=${SUBS} (workers=${SUB_WORKERS}) edits=${EDITS} pause=${PAUSE_MS}ms drill=${DRILL ?? "none"}`);

  // DB: recorded starting rows (for the position restore) + marker songs.
  const pg = pgClient();
  await pg.connect();
  let songs;
  let startRev;
  try {
    original = await activeRows(pg, EVENT_ID);
    songs = await pickMarkerSongs(pg, EDITS);
    startRev = Number((await pg.query(`select "setlistRevision" as r from "Event" where id = $1`, [EVENT_ID])).rows[0].r);
  } finally {
    await pg.end();
  }
  if (original.length < AFTER_ROW) throw new Error(`event ${EVENT_ID} has ${original.length} active rows, need ≥ ${AFTER_ROW}`);
  const afterPosition = original[AFTER_ROW - 1].position;
  log(`event ${EVENT_ID}: ${original.length} active rows, rev ${startRev}; inserting after row ${AFTER_ROW} (position ${afterPosition}); markers ${songs.map((s) => s.id).join(",")}`);

  cookie = await adminLogin(BASE);

  // Populations.
  const drillPageSet = new Set(Array.from({ length: Math.min(DRILL_PAGES, PAGES) }, (_, i) => i));
  const routeMode = (idx) => {
    if (DRILL === "ws-blocked" && drillPageSet.has(idx)) return "blocked";
    if (DRILL === "silent-loss" && drillPageSet.has(idx)) return "proxy";
    if (DRILL === "reconnect") return "proxy";
    return "none";
  };
  if (SUBS > 0) startWorkers();
  const popStart = Date.now();
  pagePop = PAGES > 0
    ? await launchPages({ count: PAGES, base: BASE, eventPath: EVENT_PATH, eventId: EVENT_ID, localeOf: LOCALE_OF, routeMode, headless: !args.headed, concurrency: PAGE_CONCURRENCY, log })
    : { pages: [], joined: () => 0, pgReady: () => 0, setDropPg() {}, dropSockets: () => 0, close: async () => {} };
  const realtimePages = pagePop.pages.filter((p) => p && p.rec.mode !== "blocked").length;

  // Wait for joins (and, by default, postgres_changes registration —
  // otherwise the first edits would measure registration lag, not the
  // steady state; registration time is reported either way).
  let joinedAt = null;
  let pgReadyAt = null;
  let lastPrint = 0;
  while (true) {
    const s = SUBS > 0 ? await subsProgress() : { joined: 0, pgReady: 0 };
    const pj = pagePop.joined();
    const pr = pagePop.pgReady();
    const allJoined = s.joined >= SUBS && pj >= PAGES;
    if (allJoined && joinedAt === null) joinedAt = Date.now();
    const allReady = s.pgReady >= SUBS && pr >= realtimePages;
    if (allReady && pgReadyAt === null) pgReadyAt = Date.now();
    if (Date.now() - lastPrint > 3000) {
      lastPrint = Date.now();
      log(`  joined: pages ${pj}/${PAGES} subs ${s.joined}/${SUBS}; pg_changes ready: pages ${pr}/${realtimePages} subs ${s.pgReady}/${SUBS}`);
    }
    if (joinedAt && (!WAIT_PG_READY || pgReadyAt)) break;
    if (!joinedAt && Date.now() - popStart > JOIN_TIMEOUT_MS) { log("join timeout — measuring whoever joined; the shortfall counts as missing updates"); break; }
    if (joinedAt && Date.now() - joinedAt > PG_READY_TIMEOUT_MS) { log("pg_changes registration timeout — continuing"); break; }
    await sleep(500);
  }
  const popSummary = {
    pagesJoined: pagePop.joined(), pagesPgReady: pagePop.pgReady(),
    ...(SUBS > 0 ? await subsProgress() : { joined: 0, pgReady: 0 }),
    allJoinedSec: joinedAt ? (joinedAt - popStart) / 1000 : null,
    allPgReadySec: pgReadyAt ? (pgReadyAt - popStart) / 1000 : null,
  };
  log(`population: ${JSON.stringify(popSummary)}; settling ${SETTLE_MS / 1000}s`);
  await sleep(SETTLE_MS);

  // Edits.
  const edits = [];
  const drillEvents = [];
  const editsStart = Date.now();
  for (let k = 1; k <= EDITS; k++) {
    const due = editsStart + (k - 1) * PAUSE_MS;
    if (Date.now() < due) await sleep(due - Date.now());
    const song = songs[k - 1];
    const drillThis = k === DRILL_EDIT;

    if (DRILL === "silent-loss" && drillThis) {
      pagePop.setDropPg(drillPageSet, true);
      drillEvents.push({ k, what: `drop postgres_changes frames on pages ${[...drillPageSet].join(",")}`, at: iso(Date.now()) });
    }
    if (DRILL === "reconnect" && drillThis) {
      const t = Date.now();
      const closedPages = pagePop.dropSockets(pagePop.pages.map((_, i) => i));
      const dropped = await Promise.all(workers.map((w) => w.ask("drop", "dropped")));
      const closedSubs = dropped.reduce((a, d) => a + d.ok, 0);
      drillEvents.push({ k, what: `force-closed ${closedPages} page sockets + ${closedSubs} SDK sockets`, at: iso(t), atMs: t });
      log(`  drill: closed ${closedPages} page + ${closedSubs} SDK sockets; editing in ${RECONNECT_LEAD_MS} ms`);
      await sleep(RECONNECT_LEAD_MS);
    }

    // A failed save is recorded and the run goes on with the next edit
    // (the report lists it under "Failed saves"); delivery is only
    // measured for edits whose two saves both succeeded.
    //
    // insert-after is retried once, but only after checking the DB that
    // the failed attempt did not commit a row anyway (a 5xx can come
    // after the commit) — such a row is adopted instead, so no blank row
    // is ever left behind or inserted twice.
    // The PUT is idempotent (it rewrites the row's links from scratch),
    // so it is simply retried once; the measured start is the retry's.
    let ins = null;
    let put = null;
    for (let attempt = 1; attempt <= 2 && !ins; attempt++) {
      const tryStart = Date.now();
      try {
        ins = await insertAfter({ base: BASE, cookie, eventId: EVENT_ID, afterPosition });
        created.push(ins.id);
      } catch (e) {
        saveFailures.push({ k, op: "insert-after", attempt, at: iso(tryStart), error: e.message });
        log(`edit ${k}: insert-after failed (${e.message})`);
        await sleep(1000);
        const orphan = await withPg((pg) => findUnacknowledgedInsert(pg, EVENT_ID, {
          sinceMs: tryStart, position: afterPosition + 1, knownIds: new Set([...created, ...original.map((r) => r.id)]),
        })).catch((err) => { log(`  orphan check failed: ${err.message}`); return null; });
        if (orphan) {
          created.push(orphan.id);
          log(`  …but row ${orphan.id} was committed; using it (insert latency unknown)`);
          ins = { startedAt: tryStart, ms: null, id: orphan.id, position: orphan.position, rev: null, adopted: true };
        }
      }
    }
    if (ins) {
      for (let attempt = 1; attempt <= 2 && !put; attempt++) {
        try {
          put = await putSong({ base: BASE, cookie, id: ins.id, position: ins.position, songId: song.id });
        } catch (e) {
          saveFailures.push({ k, op: "put", attempt, at: iso(Date.now()), error: e.message });
          log(`edit ${k}: PUT failed (${e.message})`);
          await sleep(1000);
        }
      }
    }
    if (!ins || !put) {
      log(`edit ${k} SKIPPED (save failed twice) — continuing`);
      if (DRILL === "silent-loss" && drillThis) pagePop.setDropPg(drillPageSet, false);
      continue;
    }
    // A writer that doesn't return rev (older deployment): take it from
    // the next snapshot instead.
    if (put.rev == null) put.rev = (await getSnapshot(BASE, EVENT_ID)).rev;
    const edit = { k, id: ins.id, song, ins, put };
    edits.push(edit);
    log(`edit ${k}: row ${ins.id} @${ins.position} insert ${ins.ms} ms (rev ${ins.rev}) → song ${song.id} "${song.title}" put ${put.ms} ms (rev ${put.rev})`);

    if (DRILL === "silent-loss" && drillThis) {
      // Keep swallowing notifications on the drilled pages until each of
      // them shows the marker: ANY later notification (another save,
      // another stream's test row) would otherwise trigger the repair
      // and the drill would measure the push, not the periodic poll.
      // Bounded by the timeout, and by the next edit's start when the
      // drilled edit is not the last one (default: it is).
      const nextDue = k < EDITS ? editsStart + k * PAUSE_MS : Infinity;
      const until = Math.min(put.startedAt + TIMEOUT_MS, nextDue);
      while (Date.now() < until && [...drillPageSet].some((i) => pagePop.pages[i] && pagePop.pages[i].rec.seen[song.id] == null)) {
        await sleep(100);
      }
      pagePop.setDropPg(drillPageSet, false);
      drillEvents.push({ k, what: Date.now() >= nextDue ? "stop dropping (next edit due — later notifications may have repaired)" : "stop dropping (drilled pages repaired or timeout)", at: iso(Date.now()) });
    }
  }

  // Wait for the last edit to land everywhere (or its timeout): every
  // page shows every marker and every SDK client has applied the last
  // PUT's revision. Ending earlier would cut slow (periodic-poll)
  // arrivals of the last edit off as "missing".
  const last = edits[edits.length - 1];
  while (last && Date.now() < last.put.startedAt + TIMEOUT_MS) {
    const pagesDone = pagePop.pages.every((p) => !p || edits.every((e) => p.rec.seen[e.song.id] != null));
    const subsDone = SUBS === 0 || (await subsReached(last.put.rev)) >= SUBS;
    if (pagesDone && subsDone) break;
    await sleep(500);
  }
  const editsEnd = Date.now();
  return { runStart, popSummary, edits, drillEvents, drillPageSet, startRev, editsStart, editsEnd, afterPosition };
}

async function finalize(state, aborted) {
  if (finalized) return null;
  finalized = true;
  log(aborted ? `aborting (${aborted}) — cleaning up` : "cleaning up");
  let clean = null;
  if (created.length && cookie) {
    const pg = pgClient();
    let pgOk = false;
    try { await pg.connect(); pgOk = true; } catch (e) { log(`pg connect failed: ${e.message} (positions not restored)`); }
    try {
      clean = await cleanup({ base: BASE, cookie, pg: pgOk ? pg : null, eventId: EVENT_ID, created, original, restore: RESTORE, log });
    } finally {
      if (pgOk) await pg.end().catch(() => {});
    }
    log(`cleanup: deleted ${clean.deleted.length}/${created.length}${clean.failed.length ? ` FAILED ${clean.failed.join(",")}` : ""}; restore ${JSON.stringify(clean.restore)}`);
  }
  // Verify the event is back to its starting rows, from a fresh read.
  let verify = null;
  try {
    const pg = pgClient();
    await pg.connect();
    const now = await activeRows(pg, EVENT_ID);
    await pg.end();
    const snap = await getSnapshot(BASE, EVENT_ID, { minRev: clean?.finalRev ?? null });
    // Compare against the recorded rows that are still active (another
    // stream may have deleted its own row meanwhile): same relative
    // order, same positions, and none of our rows left active.
    const kept = (original ?? []).filter((r) => now.some((x) => x.id === r.id));
    const nowKept = now.filter((x) => kept.some((r) => r.id === x.id));
    const sameOrder = kept.every((r, i) => nowKept[i]?.id === r.id);
    const samePos = kept.every((r) => nowKept.find((x) => x.id === r.id)?.position === r.position);
    const oursActive = now.filter((x) => created.includes(x.id)).map((x) => x.id);
    verify = { dbActive: now.length, snapshotItems: snap.items.length, snapshotRev: snap.rev, startRows: original?.length ?? null, goneMeanwhile: (original?.length ?? 0) - kept.length, sameOrder, samePositions: samePos, oursStillActive: oursActive };
    log(`verify: ${JSON.stringify(verify)}`);
  } catch (e) {
    verify = { error: e.message };
    log(`verify failed: ${e.message}`);
  }
  const subRecs = workers.length ? await stopWorkers() : [];
  const pageRecs = pagePop ? pagePop.pages.filter(Boolean).map((p) => p.rec) : [];
  if (pagePop) await pagePop.close();
  return { clean, verify, subRecs, pageRecs };
}

function report(state, fin) {
  const { edits, popSummary, drillEvents, drillPageSet } = state;
  const { pageRecs, subRecs, clean, verify } = fin;
  const drillK = DRILL_EDIT;
  // Reconnect drill: the drilled edit is judged as catch-up for every
  // page and client; a LATER edit is too for any page/client that had
  // not rejoined the channel by that edit's PUT (the R3 fallback keeps
  // a dropped tab on 5 s polling until its 30 s recovery attempt, so
  // the next edit can still land inside the degraded window).
  const dropAt = DRILL === "reconnect" ? drillEvents.find((d) => d.atMs)?.atMs ?? null : null;
  const notRejoinedAt = (times, t) => dropAt != null && !times.some((x) => x > dropAt && x <= t);
  const isDrilledPage = (r, e) =>
    (DRILL === "silent-loss" && e.k === drillK && drillPageSet.has(r.idx)) ||
    (DRILL === "ws-blocked" && drillPageSet.has(r.idx)) ||
    (DRILL === "reconnect" && (e.k === drillK || (e.k > drillK && notRejoinedAt(r.joinAt, e.put.startedAt))));
  const isDrilledSub = (r, e) =>
    DRILL === "reconnect" && (e.k === drillK || (e.k > drillK && notRejoinedAt(r.subscribedAt, e.put.startedAt)));

  const all = { pagesLat: [], subsLat: [], pagesMissing: 0, subsMissing: 0, drilledLat: [], drilledMissing: 0, pagesIns: [], subsIns: [], notifPagesPut: [], notifSubsPut: [], bcastPut: [], notifSubsCount: 0, bcastCount: 0 };
  const rows = [];
  for (const e of edits) {
    const s = editStats(e, pageRecs, subRecs, { isDrilledPage, isDrilledSub, notesUntil: state.editsEnd });
    all.pagesLat.push(...s.pages.lat);
    all.subsLat.push(...s.subs.lat);
    all.pagesMissing += s.pages.missing;
    all.subsMissing += s.subs.missing;
    all.drilledLat.push(...s.pages.drilledLat, ...s.subs.drilledLat);
    all.drilledMissing += s.pages.drilledMissing + s.subs.drilledMissing;
    all.pagesIns.push(...s.pages.latFromInsert);
    all.subsIns.push(...s.subs.latFromInsert);
    all.notifPagesPut.push(...s.pages.notifPut);
    all.notifSubsPut.push(...s.subs.notifPut);
    all.bcastPut.push(...s.subs.bcastPut);
    rows.push({ e, s });
  }
  const pagesD = summarize(all.pagesLat, all.pagesMissing);
  const subsD = summarize(all.subsLat, all.subsMissing);
  const combined = summarize([...all.pagesLat, ...all.subsLat], all.pagesMissing + all.subsMissing);
  const drilled = summarize(all.drilledLat, all.drilledMissing);
  // null = nothing in scope (e.g. every page is drilled) → "n/a", not FAIL.
  const pass = (d, gate) => (d.n === 0 && d.missing === 0 ? null : d.missing === 0 && d.p95 != null && d.p95 <= gate);
  // An edit whose save failed twice was never delivered to anyone, so
  // the run can't claim the gate for the planned edit count.
  const skippedEdits = EDITS - edits.length;
  const primaryPass = pass(combined, GATE_P95_MS);
  const verdicts = {
    primary: { gate: `p95 ≤ ${GATE_P95_MS} ms, 0 missing, all ${EDITS} edits saved`, ...combined, skippedEdits, pass: skippedEdits > 0 ? false : primaryPass },
    pages: { ...pagesD, pass: pass(pagesD, GATE_P95_MS) },
    subs: { ...subsD, pass: SUBS === 0 ? null : pass(subsD, GATE_P95_MS) },
  };
  if (DRILL) {
    const gate = DRILL === "silent-loss" ? SILENT_GATE_MS : DRILL === "ws-blocked" ? BLOCKED_GATE_MS : null;
    verdicts.drill = { drill: DRILL, gate: gate == null ? "informational (catch-up after reconnect)" : `max ≤ ${gate} ms, 0 missing`, ...drilled, pass: gate == null ? null : drilled.n > 0 && drilled.missing === 0 && drilled.max <= gate };
  }

  // Population diagnostics.
  const pageJoin = dist(pageRecs.filter((r) => r.joinAt.length && r.loadedAt).map((r) => r.joinAt[0] - r.openedAt));
  const pagePg = dist(pageRecs.filter((r) => r.pgReadyAt.length).map((r) => r.pgReadyAt[0] - r.openedAt));
  const subJoin = dist(subRecs.filter((r) => r.subscribedAt.length).map((r) => r.subscribedAt[0] - r.attemptAt));
  const subPg = dist(subRecs.filter((r) => r.pgReadyAt.length).map((r) => r.pgReadyAt[0] - r.attemptAt));
  const statusTotals = {};
  const errTotals = {};
  const fetchReasons = {};
  const sources = {};
  let fallbacks = 0;
  let fetchFailures = 0;
  for (const r of subRecs) {
    for (const [k, v] of Object.entries(r.statuses)) statusTotals[k] = (statusTotals[k] || 0) + v;
    for (const [k, v] of Object.entries(r.errors)) errTotals[k] = (errTotals[k] || 0) + v;
    for (const [k, v] of Object.entries(r.fetches)) fetchReasons[k] = (fetchReasons[k] || 0) + v;
    for (const [k, v] of Object.entries(r.sources)) sources[k] = (sources[k] || 0) + v;
    fallbacks += r.fallbacks.length;
    fetchFailures += r.failures;
  }
  const pageFetches = pageRecs.reduce((a, r) => a + r.fetches.length, 0);
  const pageSources = {};
  for (const r of pageRecs) for (const f of r.fetches) pageSources[f[3] ?? "none"] = (pageSources[f[3] ?? "none"] || 0) + 1;

  // Reconnect drill: rejoin latency after the drop.
  let rejoin = null;
  if (DRILL === "reconnect") {
    const ev = drillEvents.find((d) => d.atMs);
    if (ev) {
      const t = ev.atMs;
      rejoin = {
        pages: dist(pageRecs.map((r) => r.joinAt.find((x) => x > t)).filter((x) => x != null).map((x) => x - t)),
        subs: dist(subRecs.map((r) => r.subscribedAt.find((x) => x > t)).filter((x) => x != null).map((x) => x - t)),
        subsFallbacksAfterDrop: subRecs.filter((r) => r.fallbacks.some(([x]) => x > t)).length,
      };
    }
  }

  const P = pageRecs.length;
  const M = subRecs.length;
  const v = (x) => (x == null ? "n/a" : x ? "**PASS**" : "**FAIL**");
  const lines = [];
  lines.push(`# Browsers run — ${new Date(state.runStart).toISOString()}`);
  lines.push("");
  lines.push(`- Target: ${BASE}${EVENT_PATH} (event ${EVENT_ID}, start rev ${state.startRev}, ${original.length} active rows; insert after row ${AFTER_ROW} = position ${state.afterPosition})`);
  lines.push(`- Population: ${PAGES} Chromium pages (ja/ko/en 70/20/10), ${SUBS} SDK subscribers in ${SUB_WORKERS} worker thread(s)`);
  lines.push(`- Edits: ${EDITS} × (insert-after + PUT marker song), every ${PAUSE_MS / 1000} s; timeout ${TIMEOUT_MS / 1000} s; drill: ${DRILL ?? "none"}${DRILL ? ` (edit ${DRILL === "ws-blocked" ? "all" : drillK}, pages ${DRILL === "reconnect" ? "all + all SDK" : `${Math.min(DRILL_PAGES, PAGES)}`})` : ""}`);
  lines.push(`- Window (UTC): run start ${iso(state.runStart)}, first edit ${iso(state.editsStart)}, last edit settled ${iso(state.editsEnd)}, end ${iso(Date.now())}`);
  lines.push(`- Label: ${args.label ?? "—"}`);
  lines.push("");
  lines.push("## Gate verdicts");
  lines.push("");
  lines.push("Latency = PUT (the save that makes the marker exist) request start → marker link in the page DOM / SDK client applied a snapshot with rev ≥ the PUT's rev. Missing = not seen within the timeout.");
  lines.push("");
  lines.push("| Scope | n | p50 ms | p95 ms | max ms | missing | gate | verdict |");
  lines.push("|---|---|---|---|---|---|---|---|");
  lines.push(`| all pairs (pages + SDK) | ${dline(combined)} | ${combined.missing} | p95 ≤ ${GATE_P95_MS}, 0 missing${skippedEdits ? `, **${skippedEdits} edit(s) not saved**` : ""} | ${v(verdicts.primary.pass)} |`);
  lines.push(`| edit × page | ${dline(pagesD)} | ${pagesD.missing} | same | ${v(verdicts.pages.pass)} |`);
  lines.push(`| edit × SDK client | ${dline(subsD)} | ${subsD.missing} | same | ${v(verdicts.subs.pass)} |`);
  if (verdicts.drill) lines.push(`| drill ${DRILL} (drilled pairs) | ${dline(drilled)} | ${drilled.missing} | ${verdicts.drill.gate} | ${v(verdicts.drill.pass)} |`);
  lines.push("");
  lines.push(`Insert-start based (insert-after request start → marker), non-drilled: pages ${dline(dist(all.pagesIns))} · SDK ${dline(dist(all.subsIns))} (n | p50 | p95 | max).`);
  lines.push("");
  lines.push("## Notification paths (PUT start → arrival)");
  lines.push("");
  lines.push("| Path | delivered / expected | p50 ms | p95 ms | max ms |");
  lines.push("|---|---|---|---|---|");
  const nP = dist(all.notifPagesPut);
  const nS = dist(all.notifSubsPut);
  const bS = dist(all.bcastPut);
  lines.push(`| R1 postgres_changes UPDATE → pages | ${nP.n} / ${P * edits.length} | ${ms(nP.p50)} | ${ms(nP.p95)} | ${ms(nP.max)} |`);
  lines.push(`| R1 postgres_changes UPDATE → SDK | ${nS.n} / ${M * edits.length} | ${ms(nS.p50)} | ${ms(nS.p95)} | ${ms(nS.max)} |`);
  lines.push(`| R2 broadcast \`rev\` → SDK | ${bS.n} / ${M * edits.length} | ${ms(bS.p50)} | ${ms(bS.p95)} | ${ms(bS.max)} |`);
  lines.push("");
  lines.push("## Per edit");
  lines.push("");
  lines.push("| # | row | marker song | insert start (UTC) | ins ms | rev | PUT start (UTC) | PUT ms | rev | pages seen | pages p50/p95/max | SDK seen | SDK p50/p95/max | pg→pages | pg→SDK | bcast→SDK p50/p95 |");
  lines.push("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|");
  for (const { e, s } of rows) {
    const pl = dist([...s.pages.lat, ...s.pages.drilledLat]);
    const sl = dist([...s.subs.lat, ...s.subs.drilledLat]);
    const bp = dist(s.subs.bcastPut);
    const nDrilled = pageRecs.filter((r) => isDrilledPage(r, e)).length + subRecs.filter((r) => isDrilledSub(r, e)).length;
    const mark = nDrilled ? ` (drill: ${nDrilled})` : "";
    lines.push(`| ${e.k}${mark} | ${e.id} | ${e.song.id} ${e.song.title.replace(/\|/g, "/")} | ${iso(e.ins.startedAt)} | ${ms(e.ins.ms)}${e.ins.adopted ? " (adopted)" : ""} | ${ms(e.ins.rev)} | ${iso(e.put.startedAt)} | ${e.put.ms} | ${e.put.rev} | ${pl.n}/${P} | ${ms(pl.p50)}/${ms(pl.p95)}/${ms(pl.max)} | ${sl.n}/${M} | ${ms(sl.p50)}/${ms(sl.p95)}/${ms(sl.max)} | ${s.pages.notifPut.length}/${P} | ${s.subs.notifPut.length}/${M} | ${ms(bp.p50)}/${ms(bp.p95)} (${bp.n}) |`);
  }
  lines.push("");
  lines.push("## Population");
  lines.push("");
  lines.push(`- Pages: ${pageRecs.filter((r) => r.loadedAt).length}/${P} loaded; channel joined ${pageRecs.filter((r) => r.joinAt.length).length}; pg_changes registered ${pageRecs.filter((r) => r.pgReadyAt.length).length}; visibility ${JSON.stringify(Object.fromEntries(Object.entries(pageRecs.reduce((a, r) => ((a[r.visibility] = (a[r.visibility] || 0) + 1), a), {}))))}; locales ${JSON.stringify(pageRecs.reduce((a, r) => ((a[r.locale] = (a[r.locale] || 0) + 1), a), {}))}`);
  lines.push(`  - open → join ms: n=${pageJoin.n} p50=${ms(pageJoin.p50)} p95=${ms(pageJoin.p95)} max=${ms(pageJoin.max)}; open → pg_changes ready: n=${pagePg.n} p50=${ms(pagePg.p50)} p95=${ms(pagePg.p95)} max=${ms(pagePg.max)}`);
  lines.push(`  - /api/setlist responses seen: ${pageFetches} (${JSON.stringify(pageSources)}); page errors: ${pageRecs.reduce((a, r) => a + r.errors.length, 0)}; ws opens ${pageRecs.reduce((a, r) => a + r.wsOpens, 0)}, closes ${pageRecs.reduce((a, r) => a + r.wsCloses, 0)}, dropped pg frames ${pageRecs.reduce((a, r) => a + r.droppedFrames, 0)}, blocked attempts ${pageRecs.reduce((a, r) => a + r.blockedAttempts, 0)}`);
  lines.push(`- SDK: ${subRecs.filter((r) => r.subscribedAt.length).length}/${M} joined; pg_changes registered ${subRecs.filter((r) => r.pgReadyAt.length).length}; all joined after ${popSummary.allJoinedSec ?? "—"} s, all registered after ${popSummary.allPgReadySec ?? "—"} s (from population start)`);
  lines.push(`  - subscribe → SUBSCRIBED ms: n=${subJoin.n} p50=${ms(subJoin.p50)} p95=${ms(subJoin.p95)} max=${ms(subJoin.max)}; subscribe → pg_changes ready: n=${subPg.n} p50=${ms(subPg.p50)} p95=${ms(subPg.p95)} max=${ms(subPg.max)}`);
  lines.push(`  - statuses ${JSON.stringify(statusTotals)}; R3 fallbacks ${fallbacks}; fetch failures ${fetchFailures}; fetches by reason ${JSON.stringify(fetchReasons)}; X-Snapshot-Source ${JSON.stringify(sources)}`);
  if (Object.keys(errTotals).length) lines.push(`  - channel errors: ${JSON.stringify(errTotals)}`);
  if (rejoin) {
    lines.push("");
    lines.push("## Reconnect drill");
    lines.push("");
    lines.push(`- Rejoin after force-close: pages n=${rejoin.pages.n} p50=${ms(rejoin.pages.p50)} p95=${ms(rejoin.pages.p95)} max=${ms(rejoin.pages.max)}; SDK n=${rejoin.subs.n} p50=${ms(rejoin.subs.p50)} p95=${ms(rejoin.subs.p95)} max=${ms(rejoin.subs.max)}; SDK clients that went to the R3 polling fallback: ${rejoin.subsFallbacksAfterDrop}`);
  }
  if (drillEvents.length) {
    lines.push("");
    lines.push("## Drill events");
    lines.push("");
    for (const d of drillEvents) lines.push(`- edit ${d.k} ${d.at}: ${d.what}`);
  }
  if (DRILL === "silent-loss" || DRILL === "ws-blocked") {
    // Which request repaired each drilled page: the first /api/setlist
    // response carrying rev ≥ the PUT's rev. A notification-triggered
    // request sends minRev = applied + 1; a periodic / fallback poll
    // sends the highest rev it has already seen.
    lines.push("");
    lines.push("| drilled page | edit | locale | PUT → marker ms | dropped pg frames | repairing fetch: ms after PUT, minRev, source |");
    lines.push("|---|---|---|---|---|---|");
    for (const e of edits) {
      for (const r of pageRecs) {
        if (!isDrilledPage(r, e)) continue;
        const tPut = e.put.startedAt;
        const seen = r.seen[e.song.id];
        const f = r.fetches.find((x) => x[0] >= tPut && x[4] != null && x[4] >= e.put.rev);
        lines.push(`| ${r.idx} | ${e.k} | ${r.locale} | ${seen != null ? seen - tPut : "MISSING"} | ${r.droppedFrames} | ${f ? `${f[0] - tPut}, ${f[1]}, ${f[3]}` : "—"} |`);
      }
    }
  }
  lines.push("");
  if (saveFailures.length || skippedEdits) {
    lines.push("## Failed saves");
    lines.push("");
    lines.push(`${skippedEdits} of ${EDITS} edits skipped (both attempts failed). Each failed attempt:`);
    lines.push("");
    for (const f of saveFailures) lines.push(`- edit ${f.k} ${f.op} attempt ${f.attempt} at ${f.at}: ${f.error}`);
    lines.push("");
  }
  lines.push("## Clean-up");
  lines.push("");
  lines.push(`- Soft-deleted ${clean?.deleted.length ?? 0}/${created.length} created rows${clean?.failed.length ? `; **NOT deleted: ${clean.failed.join(", ")}**` : ""}; position restore: ${JSON.stringify(clean?.restore ?? null)}`);
  lines.push(`- Verify: ${JSON.stringify(verify)}${RESTORE ? "" : " (samePositions is expected to be false without --restore-positions: insert-after shifted rows below the insertion point and soft-delete does not compact)"}`);
  lines.push("");
  const md = lines.join("\n");

  const json = {
    config: { base: BASE, eventId: EVENT_ID, eventPath: EVENT_PATH, pages: PAGES, subs: SUBS, subWorkers: SUB_WORKERS, edits: EDITS, pauseMs: PAUSE_MS, timeoutMs: TIMEOUT_MS, drill: DRILL, drillPages: DRILL_PAGES, drillEdit: DRILL_EDIT, label: args.label ?? null },
    window: { runStart: iso(state.runStart), editsStart: iso(state.editsStart), editsEnd: iso(state.editsEnd), end: iso(Date.now()) },
    verdicts, popSummary, rejoin, drillEvents, saveFailures, clean, verify,
    edits: rows.map(({ e, s }) => ({
      k: e.k, id: e.id, song: e.song,
      insert: { start: iso(e.ins.startedAt), ms: e.ins.ms, rev: e.ins.rev, position: e.ins.position },
      put: { start: iso(e.put.startedAt), ms: e.put.ms, rev: e.put.rev },
      pages: { lat: s.pages.lat, drilledLat: s.pages.drilledLat, missing: s.pages.missing, drilledMissing: s.pages.drilledMissing, notifPut: s.pages.notifPut, notifIns: s.pages.notifIns },
      subs: { latDist: dist(s.subs.lat), drilledDist: dist(s.subs.drilledLat), missing: s.subs.missing, drilledMissing: s.subs.drilledMissing, notifPut: dist(s.subs.notifPut), bcastPut: dist(s.subs.bcastPut), bcastIns: dist(s.subs.bcastIns) },
    })),
    pages: pageRecs,
  };
  return { md, json };
}

function writeResults(md, json) {
  const now = new Date();
  const dir = path.join(HERE, "..", "results", now.toISOString().slice(0, 10));
  fs.mkdirSync(dir, { recursive: true });
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  const base = path.join(dir, `${stamp}-browsers${DRILL ? `-${DRILL}` : ""}`);
  fs.writeFileSync(`${base}.md`, md);
  fs.writeFileSync(`${base}.json`, JSON.stringify(json, null, 1));
  return base;
}

// Abort path: Ctrl-C (or a kill) still soft-deletes our rows and
// restores positions before exiting.
let mainState = null;
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, async () => {
    if (finalized) process.exit(130);
    const fin = await finalize(mainState, sig);
    if (fin && mainState) {
      const { md, json } = report(mainState, fin);
      const base = writeResults(md, json);
      log(`partial results: ${base}.md`);
    }
    process.exit(130);
  });
}

try {
  mainState = await main();
  const fin = await finalize(mainState, null);
  const { md, json } = report(mainState, fin);
  const base = writeResults(md, json);
  console.log("\n" + md);
  log(`results: ${base}.md`);
  // null (nothing in scope, e.g. every pair drilled) is not a failure.
  process.exit(json.verdicts.primary.pass !== false && json.verdicts.drill?.pass !== false ? 0 : 1);
} catch (e) {
  log(`ERROR: ${e.stack || e.message}`);
  await finalize(mainState, `error: ${e.message}`);
  process.exit(2);
}
