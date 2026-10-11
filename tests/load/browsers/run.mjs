// n14 — real browsers + SDK subscribers on the live event page (dev
// only). See README.md in this folder for the full-scale commands.
//
// Population: `--pages` headless Chromium pages (ja/ko/en 70/20/10) on
// the event page — whatever build the preview serves, R1 or R2 — + `--subs`
// supabase-js clients that behave like the R2 page (subs-worker.mjs:
// broadcast-driven, the page's own acceptance / scheduler / verify
// parser). Pages and SDK clients are reported separately per save.
// Edits: an admin driver inserts a row after
// the 2nd row and fills in a never-used "marker" song, `--edits` times,
// `--pause` seconds apart (admin.mjs). Measurement: PUT start → marker
// link in each page's DOM, and PUT start → each SDK client applying a
// snapshot with rev ≥ the PUT's rev. The clock starts at the FIRST
// attempt of a save: a retried save keeps its original start, because
// the operator's wait began at the first click (retried edits are also
// listed separately). Missing within `--timeout` s = failure. Gate: p95
// ≤ 3 s, 0 missing (pairs a drill deliberately degrades are judged by
// that drill's own gate instead).
//
// Monotonicity (every run): no viewer may ever go back to an older
// version. SDK clients record every applied snapshot's rev; for pages the
// version is derived from which marker songs the DOM shows (see
// monotonicity() below). Any decrease is a failure.
//
// Drills (one per run): `--drill=silent-loss | ws-blocked | reconnect |
// double-save | lost-final | poison | spam | verify-ambiguity`, see the
// README and the per-drill comments below. `poison` and `spam` are the two guest-
// broadcast drills: an anonymous supabase-js client (anon key, like any
// visitor) joins the public `event:<id>` channel and sends forged `rev`
// broadcasts in the exact shape the writer sends, so the clients cannot
// tell them apart from real hints. They only mean something against R2
// clients (which treat the broadcast as their notification); R1 pages
// ignore broadcasts.
//
// Results: tests/load/results/<UTC date>/<stamp>-browsers.md (+ .json,
// gitignored). All timestamps in the files are UTC ISO so the run can be
// aligned with a concurrent k6 burst from another stream.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { Worker } from "node:worker_threads";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { loadEnv, assertDev, parseArgs, dist, sleep, pgClient } from "../realtime/lib.mjs";
import { adminLogin, getSnapshot, insertAfter, putSong, activeRows, pickMarkerSongs, cleanup, findUnacknowledgedInsert } from "./admin.mjs";
import { launchPages } from "./pages.mjs";
import { parseSnapshotVerify } from "../../../src/lib/snapshotVerify.ts";
import { NOTIFICATION_COOLDOWN_MS as COOLDOWN_MS } from "../../../src/lib/liveScheduler.ts";

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
// Off by default: an R2 page / SDK client registers no postgres_changes,
// so there is nothing to wait for. `--wait-pg-ready=true` only makes
// sense with an R1 page build (the SDK clients never register).
const WAIT_PG_READY = args["wait-pg-ready"] === "true" || args["wait-pg-ready"] === true;
const PG_READY_TIMEOUT_MS = int("pg-ready-timeout", 180) * 1000;
const SUB_WORKERS = args["sub-workers"] ? int("sub-workers", 1) : Math.max(1, Math.min(os.cpus().length - 2, Math.ceil(SUBS / 120)));
const SUB_BATCH = int("sub-batch", 50); // joins per second across all workers
const PAGE_CONCURRENCY = int("page-concurrency", 5);
const RESTORE = !!args["restore-positions"]; // opt-in, see admin.mjs "Position restore"
const GATE_P95_MS = int("gate-p95", 3000);
// camelCase spellings accepted too (doubleSave, lostFinal, …).
const DRILL = args.drill ? String(args.drill).replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`) : null;
if (DRILL && !["silent-loss", "ws-blocked", "reconnect", "double-save", "lost-final", "poison", "spam", "verify-ambiguity"].includes(DRILL)) {
  console.error(`unknown --drill=${args.drill}`);
  process.exit(2);
}
const GUEST_DRILL = DRILL === "poison" || DRILL === "spam";
// silent-loss: a subset of pages loses the notification for ONE edit.
// ws-blocked: pages with the websocket blocked for the whole run.
// reconnect: every socket (pages + SDK) is force-closed right before ONE edit.
// double-save: ONE edit gets a second PUT on the same row ~300 ms after
//   the first (an operator correcting a song right away); every client
//   must converge to the save with the higher rev, never going back.
// lost-final: the notification of the run's LAST save (the last edit's
//   PUT) is dropped on every page and SDK client; only the periodic
//   repair poll (20 s ± 4 s) can deliver it.
// poison: right before edit --drill-edit (default 1) a guest sends ONE
//   forged broadcast `{ kind: "setlist", rev: --poison-rev }` (default
//   Number.MAX_SAFE_INTEGER), waits --poison-lead ms, then the honest
//   saves run as usual. A correct client spends one notification fetch +
//   at most one recheck on it and keeps no watermark from it, so every
//   honest save after it must still pass the primary gate.
// spam: from edit --drill-edit (default 1) on, a guest sends
//   --spam-rate (2) forged broadcasts per second for --spam-secs (60) s,
//   concurrently with the real saves. Expect the clients' notification
//   fetch rate to stay bounded by the shared 1 s cooldown and the real
//   saves to land with 0 failures.
const DRILL_PAGES = int("drill-pages", DRILL === "silent-loss" ? Math.max(1, Math.ceil(PAGES / 2)) : PAGES);
// silent-loss drills the LAST edit by default: a later edit's notification
// would otherwise repair the drilled pages before the periodic poll does.
// lost-final is the last edit by definition. The guest drills start at
// the first edit so every honest save comes after (poison) or during
// (spam) the forged traffic.
const DRILL_EDIT =
  DRILL === "lost-final"
    ? EDITS
    : int("drill-edit", DRILL === "silent-loss" ? EDITS : GUEST_DRILL ? 1 : Math.max(1, Math.ceil(EDITS / 2)));
// Guest-broadcast drills (see above).
const POISON_REV = args["poison-rev"] === undefined ? Number.MAX_SAFE_INTEGER : Number(args["poison-rev"]);
// Long enough for the forged hint's jittered notification fetch (≤ 0.5 s
// + response), its recheck (settle + max(1 s, cooldown) + U(0, 0.5 s))
// and the recheck's response, so the first honest save meets a client
// that has already finished with the forgery.
const POISON_LEAD_MS = int("poison-lead", 4000);
const SPAM_RATE = parseFloat(args["spam-rate"] ?? "2");
const SPAM_SECS = parseFloat(args["spam-secs"] ?? "60");
// Which rev each spam message claims:
//   ahead  the latest real save's rev + 1 — always one step newer than
//          the truth until the next real save, i.e. the most plausible
//          forgery (every message looks like a real, unseen save);
//   max    Number.MAX_SAFE_INTEGER every time;
//   stale  the latest real save's rev — a duplicate a correct client
//          drops without any fetch.
const SPAM_REV = String(args["spam-rev"] ?? "ahead");
if (DRILL === "poison" && !(Number.isSafeInteger(POISON_REV) && POISON_REV >= 0)) {
  console.error(`--poison-rev must be a safe integer, got ${args["poison-rev"]}`);
  process.exit(2);
}
if (DRILL === "spam" && (!["ahead", "max", "stale"].includes(SPAM_REV) || !(SPAM_RATE > 0) || !(SPAM_SECS > 0))) {
  console.error("--spam-rev must be ahead|max|stale, --spam-rate and --spam-secs > 0");
  process.exit(2);
}
// verify-ambiguity: right before the drilled edit's PUT, a helper sends
// --prime-per-locale requests per locale with `minRev = <current rev> +
// --prime-offset` (no hint). Each lands on some instance whose cached
// snapshot is older than that minRev, so the instance does its 1-row
// revision read and REMEMBERS the pre-save revision for 1 s (the
// server's revMemo). The PUT starts --prime-lead ms after the priming
// requests were sent (not awaited: waiting for their responses would
// spend most of the 1 s window before the save even commits); a hinted
// notification fetch that then lands on a primed instance inside the
// window, with an older snapshot in hand, is answered `memo=<old>` —
// inconclusive — and the client's ONE recheck must bring the save.
// Which instance serves which request is Vercel's choice, so the memo
// share is a measurement, not a guarantee.
const PRIME_PER_LOCALE = int("prime-per-locale", 1);
const PRIME_OFFSET = int("prime-offset", 1000);
const PRIME_LEAD_MS = int("prime-lead", 150);
// silent-loss / lost-final: how the pages lose the notification —
// "proxy" (the websocket proxy drops every notification frame while the
// drill is on; R1 and R2 builds alike) or "hook" (the page's own
// `__osl.dropNextNotification`: drops the next VALID notification once;
// armed right before the drilled PUT, after the insert's notification
// was delivered, so it is the PUT's notification that is lost).
const DROP_VIA = String(args["drop-via"] ?? "proxy");
if (!["proxy", "hook"].includes(DROP_VIA)) {
  console.error("--drop-via must be proxy|hook");
  process.exit(2);
}
const RECONNECT_LEAD_MS = int("reconnect-lead", 1000);
// Silent-loss repair gate (spec): periodic poll 20 s ± 4 s → ≤ 24 s incl. fetch/render.
const SILENT_GATE_MS = int("silent-gate", 24000);
// ws-blocked: fallback poll 5 s ± 1 s → expect ≤ ~7 s incl. fetch/render (informational).
const BLOCKED_GATE_MS = int("blocked-gate", 7000);
// lost-final: the periodic poll fires 20 s ± 4 s after the previous tick,
// so the dropped save is picked up ≤ 24 s after it + one fetch + render.
const LOST_GATE_MS = int("lost-gate", 26000);
// lost-final: after the last edit's insert, wait until its notification
// reached the population and the fetches it triggered are done before
// the PUT, so the drop hits exactly the last save and nothing else.
const LOST_SETTLE_MS = int("lost-settle", 2000);
// double-save: start of the 2nd PUT after the start of the 1st.
const DOUBLE_GAP_MS = int("double-gap", 300);

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
let guest = null; // guest broadcaster of the poison / spam drills

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

// SDK clients that received a valid, not-dropped `rev` broadcast with
// rev ≥ `rev` (the notification of that save reached them).
async function subsNoted(rev) {
  const all = await Promise.all(workers.map((w) => w.ask("noted", "noted", { rev })));
  return all.reduce((a, r) => a + r.count, 0);
}

async function subsDropNotify(on) {
  await Promise.all(workers.map((w) => w.ask("dropNotify", "dropNotifyAck", { on })));
}

// Every SDK client's acceptance + scheduler state right now.
async function subsState() {
  const all = await Promise.all(workers.map((w) => w.ask("state", "state")));
  return all.flatMap((r) => r.clients);
}

async function subsProgress() {
  const all = await Promise.all(workers.map((w) => w.ask("progress", "progress")));
  return all.reduce((a, p) => ({ joined: a.joined + p.joined }), { joined: 0 });
}

// A page has received the notification of the save that produced `rev`
// (R2 build: a `rev` broadcast ≥ rev, dropped or not, counts as "it
// reached the page"; R1 build: the postgres_changes `ty` event for row
// `id`).
const pageNoted = (rec, { rev, id, ty }) =>
  rec.bcasts.some(([, r]) => r !== null && rev != null && r >= rev) || rec.notes.some(([, t, i]) => t === ty && i === id);

async function stopWorkers() {
  const results = await Promise.all(workers.map((w) => Promise.race([
    w.ask("stop", "result"),
    sleep(20000).then(() => ({ clients: [] })),
  ])));
  await Promise.allSettled(workers.map((w) => w.worker.terminate()));
  return results.flatMap((r) => r.clients);
}

// ─── guest broadcaster (poison / spam drills) ───
// A plain supabase-js client with the public anon key — exactly what any
// visitor of the page holds — on the same public channel the writer
// broadcasts to. Nothing here needs a privilege the public lacks, which
// is the point: the client contract has to survive whatever this sends.
//
// The payload is the writer's own shape (`{ kind, rev }`, no marker
// field), so a client cannot tell a forgery from a real hint by its
// shape; the report tells them apart by rev and send time instead.
// `ack: true` makes `send` resolve with the server's verdict ("ok" |
// "timed out" | "error"), recorded per message, so a Realtime-side
// rate limit or rejection shows in the report instead of looking like a
// client that ignored the message. `self: false` (the default) keeps the
// guest from receiving its own messages.
async function openGuest() {
  const c = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const ch = c.channel(`event:${EVENT_ID}`, { config: { private: false, broadcast: { ack: true, self: false } } });
  const t0 = Date.now();
  const status = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve("no-reply"), 10000);
    ch.subscribe((s) => {
      if (s === "SUBSCRIBED" || s === "CHANNEL_ERROR" || s === "TIMED_OUT") {
        clearTimeout(timer);
        resolve(s);
      }
    });
  });
  const g = {
    joined: status === "SUBSCRIBED",
    status,
    joinMs: Date.now() - t0,
    sends: [], // [t, rev, result, label]
    closed: false,
    async send(rev, label) {
      // After close() (clean-up, Ctrl-C) a still-running spam loop must
      // go quiet: realtime-js would push a send on a left channel over
      // the REST endpoint instead, i.e. keep spamming the population.
      if (g.closed) return "closed";
      const t = Date.now();
      let r;
      try {
        r = await ch.send({ type: "broadcast", event: "rev", payload: { kind: "setlist", rev } });
      } catch (e) {
        r = `threw: ${String(e?.message || e).slice(0, 80)}`;
      }
      g.sends.push([t, rev, r, label]);
      return r;
    },
    async close() {
      g.closed = true;
      await c.removeAllChannels().catch(() => {});
    },
  };
  return g;
}

// The spam loop: SPAM_RATE messages per second for SPAM_SECS, on a fixed
// schedule from its start (a slow ack delays one message, not the rest).
// `latestRev()` = the newest real save rev the admin driver has seen.
async function runSpam(g, latestRev) {
  const total = Math.round(SPAM_RATE * SPAM_SECS);
  const start = Date.now();
  for (let j = 0; j < total; j++) {
    const due = start + (j * 1000) / SPAM_RATE;
    if (Date.now() < due) await sleep(due - Date.now());
    const rev = SPAM_REV === "max" ? Number.MAX_SAFE_INTEGER : SPAM_REV === "stale" ? latestRev() : latestRev() + 1;
    await g.send(rev, `spam ${j + 1}/${total}`);
  }
  return { sent: total, ms: Date.now() - start };
}

// ─── measurement helpers ───
// Raw `x-snapshot-verify` value (a page's recorded response header) →
// the kind the page's own parser makes of it (absent / malformed →
// "missing").
const verifyKindOf = (raw) => parseSnapshotVerify(raw ?? null).kind;

const firstAfter = (arr, pred) => {
  for (const x of arr) if (pred(x)) return x;
  return null;
};

function summarize(lat, missing) {
  const d = dist(lat);
  return { ...d, missing };
}

function editStats(edit, pageRecs, subRecs, { isDrilledPage, isDrilledSub, notesUntil }) {
  // startedAt = first attempt (the gate's clock); successAt = the attempt
  // that worked, reported next to it for retried edits only.
  const tPut = edit.put.startedAt;
  const tPutOk = edit.put.successAt ?? tPut;
  const tIns = edit.ins.startedAt;
  const deadline = tPut + TIMEOUT_MS;
  // A notification only counts for this save if it arrives inside the
  // measurement window and before the clean-up starts — the clean-up's
  // soft-delete of the same row is an UPDATE too.
  const noteEnd = Math.min(deadline, notesUntil);
  // Per-save hint accounting: the requests that carried THIS save's
  // revision as their ticket (`hint === put.rev`) — its notification
  // fetches, their verification kinds and resolutions, and its rechecks.
  // A ticket merged into a larger one (a later save's broadcast in the
  // same batch) is counted under the larger save, where it was checked.
  const hintStats = () => ({ notif: 0, verify: {}, res: {}, rechecks: 0, recheckOk: 0, exhausted: 0 });
  const out = {
    pages: { lat: [], latFromSuccess: [], latFromInsert: [], missing: 0, drilledLat: [], drilledMissing: 0, notifPut: [], notifIns: [], bcastPut: [], hint: hintStats() },
    subs: { lat: [], latFromSuccess: [], latFromInsert: [], missing: 0, drilledLat: [], drilledMissing: 0, notifPut: [], notifIns: [], bcastPut: [], bcastIns: [], hint: hintStats() },
  };
  const bumpK = (o, k) => { o[k] = (o[k] || 0) + 1; };
  for (const r of pageRecs) {
    // An R2 page's notification fetch for this save: `hint=1` with
    // minRev = put.rev (pages expose no ticket, the URL is the evidence).
    for (const f of r.fetches) {
      if (!f[6] || f[1] !== edit.put.rev) continue;
      out.pages.hint.notif++;
      bumpK(out.pages.hint.verify, verifyKindOf(f[5]));
    }
    const bpp = firstAfter(r.bcasts || [], ([t, rev]) => rev === edit.put.rev && t >= tPut - 50);
    if (bpp) out.pages.bcastPut.push(bpp[0] - tPut);
  }
  for (const r of subRecs) {
    for (const q of r.reqs || []) {
      if (q[3] !== edit.put.rev) continue;
      if (q[4]) {
        out.subs.hint.notif++;
        if (q[7]) bumpK(out.subs.hint.verify, q[7]);
      }
      if (q[9] && q[9] !== "none") bumpK(out.subs.hint.res, q[9]);
      if (q[1] === "recheck") {
        out.subs.hint.rechecks++;
        if (q[9] === "satisfied" || q[9] === "superseded" || q[9] === "disproved") out.subs.hint.recheckOk++;
      }
    }
    out.subs.hint.exhausted += (r.exhausted || []).filter(([, h]) => h === edit.put.rev).length;
  }
  for (const r of pageRecs) {
    const seen = r.seen[edit.song.id];
    const ok = seen != null && seen <= deadline;
    const drilled = isDrilledPage(r, edit);
    const bucket = out.pages;
    if (ok) {
      (drilled ? bucket.drilledLat : bucket.lat).push(seen - tPut);
      if (!drilled) bucket.latFromInsert.push(seen - tIns);
      if (!drilled) bucket.latFromSuccess.push(seen - tPutOk);
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
      if (!drilled) bucket.latFromSuccess.push(a[0] - tPutOk);
    } else if (drilled) bucket.drilledMissing++;
    else bucket.missing++;
    const bp = firstAfter(r.bcasts, ([t, rev]) => rev === edit.put.rev && t >= tPut - 50);
    if (bp) bucket.bcastPut.push(bp[0] - tPut);
    const bi = firstAfter(r.bcasts, ([t, rev]) => rev === edit.ins.rev && t >= tIns - 50);
    if (bi) bucket.bcastIns.push(bi[0] - tIns);
  }
  return out;
}

const ms = (v) => (v == null ? "—" : `${v}`);
const dline = (d) => `${d.n} | ${ms(d.p50)} | ${ms(d.p95)} | ${ms(d.max)}`;

// ─── monotonicity ───
// Marker song → rev of the save that put it on its row, plus, for a
// double save, which marker the final save replaced (removing that one is
// the expected outcome, not a regression).
function markerIndex(edits) {
  const rev = new Map();
  const replacedBy = new Map();
  for (const e of edits) {
    if (e.double) {
      for (const x of [e.double.first, e.double.second]) if (x) rev.set(String(x.song.id), x.put.rev);
      if (e.double.superseded) replacedBy.set(String(e.double.superseded.song.id), String(e.double.final.song.id));
    } else {
      rev.set(String(e.song.id), e.put.rev);
    }
  }
  return { rev, replacedBy };
}

// A page exposes no "applied rev", so its version is derived from the
// DOM: the highest rev among the marker songs it currently shows. Every
// marker is added by one save and only goes away when its row is deleted
// (the clean-up, after `until`) or when a later save on the same row
// replaces it (double save). So, replaying the page's DOM log up to
// `until`, a regression is either
//   - the version going down (a newer marker vanished, or a replaced
//     marker came back without the newer one), or
//   - a marker disappearing that no newer marker replaced (an older
//     snapshot applied over a newer one, even if a higher marker of
//     another row keeps the max unchanged).
// `versions` is the page's applied-version history, in order.
function pageMonotonicity(r, idx, until) {
  const present = new Set();
  let maxV = -Infinity;
  const versions = [];
  const regressions = [];
  for (const [t, added, removed] of r.dom || []) {
    if (t >= until) break;
    let touched = false;
    for (const id of added) if (idx.rev.has(id)) { present.add(id); touched = true; }
    for (const id of removed) {
      if (!idx.rev.has(id)) continue;
      present.delete(id);
      touched = true;
      const by = idx.replacedBy.get(id);
      if (!(by && present.has(by))) regressions.push({ t, what: `marker ${id} (rev ${idx.rev.get(id)}) disappeared` });
    }
    if (!touched) continue;
    let v = -Infinity;
    for (const id of present) v = Math.max(v, idx.rev.get(id));
    const shown = Number.isFinite(v) ? v : null;
    if (!versions.length || versions[versions.length - 1][1] !== shown) versions.push([t, shown]);
    if (v < maxV) regressions.push({ t, what: `version ${maxV} → ${shown ?? "none"}` });
    maxV = Math.max(maxV, v);
  }
  return { versions, regressions, present };
}

// SDK clients log every applied snapshot ([t, rev, reason]).
function subMonotonicity(r) {
  let maxV = -Infinity;
  const regressions = [];
  for (const [t, rev, reason] of r.appliedAll || []) {
    if (rev < maxV) regressions.push({ t, what: `applied rev ${rev} after ${maxV} (${reason})` });
    maxV = Math.max(maxV, rev);
  }
  return { regressions };
}

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
    // double-save needs one more marker for its second PUT.
    songs = await pickMarkerSongs(pg, EDITS + (DRILL === "double-save" ? 1 : 0));
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
    if (DRILL === "silent-loss" && DROP_VIA === "proxy" && drillPageSet.has(idx)) return "proxy";
    if (DRILL === "reconnect") return "proxy";
    if (DRILL === "lost-final" && DROP_VIA === "proxy" && drillPageSet.has(idx)) return "proxy";
    return "none";
  };
  if (SUBS > 0) startWorkers();
  const popStart = Date.now();
  pagePop = PAGES > 0
    ? await launchPages({ count: PAGES, base: BASE, eventPath: EVENT_PATH, eventId: EVENT_ID, localeOf: LOCALE_OF, routeMode, headless: !args.headed, concurrency: PAGE_CONCURRENCY, log })
    : { pages: [], joined: () => 0, pgReady: () => 0, setDropNotify() {}, armHookDrop: async () => 0, disarmHookDrop: async () => 0, hookDropPending: async () => null, dropSockets: () => 0, close: async () => {} };
  const realtimePages = pagePop.pages.filter((p) => p && p.rec.mode !== "blocked").length;

  // Wait for joins. An R2 page / SDK client is live at SUBSCRIBED (a
  // broadcast join has no DB-side registration). Only with
  // --wait-pg-ready=true (an R1 page build) does the run also wait for
  // the pages' postgres_changes registration.
  let joinedAt = null;
  let pgReadyAt = null;
  let lastPrint = 0;
  while (true) {
    const s = SUBS > 0 ? await subsProgress() : { joined: 0 };
    const pj = pagePop.joined();
    const pr = pagePop.pgReady();
    const allJoined = s.joined >= SUBS && pj >= PAGES;
    if (allJoined && joinedAt === null) joinedAt = Date.now();
    if (pr >= realtimePages && pgReadyAt === null && realtimePages > 0) pgReadyAt = Date.now();
    if (Date.now() - lastPrint > 3000) {
      lastPrint = Date.now();
      log(`  joined: pages ${pj}/${PAGES} subs ${s.joined}/${SUBS}${WAIT_PG_READY ? `; pg_changes ready: pages ${pr}/${realtimePages}` : ""}`);
    }
    if (joinedAt && (!WAIT_PG_READY || pgReadyAt)) break;
    if (!joinedAt && Date.now() - popStart > JOIN_TIMEOUT_MS) { log("join timeout — measuring whoever joined; the shortfall counts as missing updates"); break; }
    if (joinedAt && Date.now() - joinedAt > PG_READY_TIMEOUT_MS) { log("pg_changes registration timeout — continuing"); break; }
    await sleep(500);
  }
  const popSummary = {
    pagesJoined: pagePop.joined(),
    // R1 page builds only; 0 on an R2 build.
    pagesPgReady: pagePop.pgReady(),
    ...(SUBS > 0 ? await subsProgress() : { joined: 0 }),
    allJoinedSec: joinedAt ? (joinedAt - popStart) / 1000 : null,
    allPgReadySec: WAIT_PG_READY && pgReadyAt ? (pgReadyAt - popStart) / 1000 : null,
  };
  log(`population: ${JSON.stringify(popSummary)}; settling ${SETTLE_MS / 1000}s`);
  // The guest joins during the settle time, so its join does not shift
  // the edit schedule; a guest that cannot join makes the drill
  // meaningless, so the run stops (after the usual clean-up) instead of
  // reporting honest saves as if they had been poisoned.
  if (GUEST_DRILL) {
    guest = await openGuest();
    log(`guest broadcaster: ${guest.status} after ${guest.joinMs} ms`);
    if (!guest.joined) throw new Error(`guest could not join event:${EVENT_ID} (${guest.status})`);
  }
  await sleep(SETTLE_MS);

  // Edits.
  const edits = [];
  const drillEvents = [];
  // Newest real save rev seen by the admin driver (spam --spam-rev).
  let latestRev = startRev;
  const noteRev = (r) => {
    if (Number.isSafeInteger(r) && r > latestRev) latestRev = r;
  };
  let spamP = null;
  const editsStart = Date.now();
  for (let k = 1; k <= EDITS; k++) {
    const due = editsStart + (k - 1) * PAUSE_MS;
    if (Date.now() < due) await sleep(due - Date.now());
    const song = songs[k - 1];
    const drillThis = k === DRILL_EDIT;

    if (DRILL === "poison" && drillThis) {
      const t = Date.now();
      const r = await guest.send(POISON_REV, "poison");
      drillEvents.push({ k, what: `guest broadcast { kind: "setlist", rev: ${POISON_REV} } → ${r}; honest saves follow in ${POISON_LEAD_MS} ms`, at: iso(t), atMs: t });
      log(`  drill: forged rev ${POISON_REV} sent (${r}); editing in ${POISON_LEAD_MS} ms`);
      await sleep(POISON_LEAD_MS);
    }
    if (DRILL === "spam" && drillThis) {
      const t = Date.now();
      spamP = runSpam(guest, () => latestRev);
      drillEvents.push({ k, what: `guest spam started: ${SPAM_RATE}/s for ${SPAM_SECS} s, rev mode ${SPAM_REV}`, at: iso(t), atMs: t });
      log(`  drill: spam ${SPAM_RATE}/s × ${SPAM_SECS} s (${SPAM_REV}) running alongside the saves`);
    }

    if (DRILL === "silent-loss" && DROP_VIA === "proxy" && drillThis) {
      pagePop.setDropNotify(drillPageSet, true);
      drillEvents.push({ k, what: `proxy drops notification frames (rev broadcast / postgres_changes) on pages ${[...drillPageSet].join(",")}`, at: iso(Date.now()) });
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
    // so it is simply retried once.
    //
    // Clock: `startedAt` of both saves is the start of their FIRST
    // attempt, whatever attempt succeeded (`successAt`). A retry costs the
    // viewer the failed attempt plus the back-off, so the latency the
    // gate judges must include it; `attempts` > 1 marks the edit as
    // retried and the report also shows those edits on their own.
    let ins = null;
    let put = null;
    const insFirst = Date.now();
    let insAttempts = 0;
    for (let attempt = 1; attempt <= 2 && !ins; attempt++) {
      const tryStart = Date.now();
      insAttempts = attempt;
      try {
        ins = await insertAfter({ base: BASE, cookie, eventId: EVENT_ID, afterPosition });
        created.push(ins.id);
        noteRev(ins.rev);
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
    if (ins) Object.assign(ins, { successAt: ins.startedAt, startedAt: insFirst, attempts: insAttempts });

    // Drills that must hit the PUT and nothing else (lost-final, a hook-
    // driven silent-loss, verify-ambiguity's memo priming): wait until the
    // insert's own notification has reached the population (≤ 5 s) and
    // the fetches it triggered are done (plus, for the priming, the 1 s
    // memo window those fetches may have opened), THEN act, THEN save.
    const hookSilent = DRILL === "silent-loss" && DROP_VIA === "hook";
    if (ins && drillThis && (DRILL === "lost-final" || hookSilent || DRILL === "verify-ambiguity")) {
      const until = Date.now() + 5000;
      const realtimeIdx = [...drillPageSet].filter((i) => pagePop.pages[i] && pagePop.pages[i].rec.mode !== "blocked");
      const seenIns = { rev: ins.rev, id: ins.id, ty: "I" };
      while (Date.now() < until) {
        const pagesNoted = realtimeIdx.every((i) => pageNoted(pagePop.pages[i].rec, seenIns));
        const subsNotedN = SUBS > 0 && ins.rev != null ? await subsNoted(ins.rev) : SUBS;
        if (pagesNoted && subsNotedN >= SUBS) break;
        await sleep(200);
      }
      await sleep(LOST_SETTLE_MS);
    }
    if (ins && drillThis && (DRILL === "lost-final" || hookSilent)) {
      const lost = DRILL === "lost-final";
      if (DROP_VIA === "hook") {
        const armed = await pagePop.armHookDrop([...drillPageSet]);
        drillEvents.push({ k, what: `page hook __osl.dropNextNotification armed on ${armed} page(s)${lost ? " + SDK clients drop every notification" : ""} (insert notification delivered first)`, at: iso(Date.now()) });
      } else {
        pagePop.setDropNotify(drillPageSet, true);
        drillEvents.push({ k, what: `proxy drops notification frames on pages ${[...drillPageSet].join(",")}${lost ? " + all SDK clients" : ""} (insert notification delivered first)`, at: iso(Date.now()) });
      }
      if (lost && SUBS > 0) await subsDropNotify(true);
    }
    let prime = null;
    if (ins && drillThis && DRILL === "verify-ambiguity") {
      // See the PRIME_* constants. Sent, not awaited; the PUT follows
      // PRIME_LEAD_MS later.
      const minRev = latestRev + PRIME_OFFSET;
      const t0 = Date.now();
      const reqs = [];
      for (const locale of ["ja", "ko", "en"]) {
        for (let j = 0; j < PRIME_PER_LOCALE; j++) {
          reqs.push(
            fetch(`${BASE}/api/setlist?eventId=${EVENT_ID}&locale=${locale}&minRev=${minRev}`, { signal: AbortSignal.timeout(15000) })
              .then(async (r) => {
                await r.arrayBuffer().catch(() => {});
                return { locale, status: r.status, verify: r.headers.get("x-snapshot-verify"), ms: Date.now() - t0 };
              })
              .catch((e) => ({ locale, status: 0, verify: null, ms: Date.now() - t0, error: String(e?.message || e).slice(0, 60) })),
          );
        }
      }
      prime = { at: t0, minRev, promise: Promise.all(reqs) };
      await sleep(PRIME_LEAD_MS);
    }

    let double = null;
    if (ins && DRILL === "double-save" && drillThis) {
      // Two PUTs on the same row, the 2nd started DOUBLE_GAP_MS after the
      // 1st without waiting for it. Both take the Event row lock, so they
      // commit one after the other; which one commits last is decided by
      // the lock, not by the start order, so the FINAL state is the save
      // with the higher rev. No retries here: a retried 1st PUT landing
      // after the 2nd would change which save is final mid-measurement.
      const second = songs[EDITS];
      const fire = (s, delayMs) => sleep(delayMs).then(() => {
        const t = Date.now();
        return putSong({ base: BASE, cookie, id: ins.id, position: ins.position, songId: s.id })
          .then((r) => ({ song: s, put: { ...r, successAt: r.startedAt, attempts: 1 } }))
          .catch((e) => {
            saveFailures.push({ k, op: `put (double-save ${s === song ? "1st" : "2nd"})`, attempt: 1, at: iso(t), error: e.message });
            return null;
          });
      });
      const [a, b] = await Promise.all([fire(song, 0), fire(second, DOUBLE_GAP_MS)]);
      for (const x of [a, b]) if (x && x.put.rev == null) x.put.rev = (await getSnapshot(BASE, EVENT_ID)).rev;
      const ok = [a, b].filter(Boolean).sort((x, y) => x.put.rev - y.put.rev);
      if (ok.length) {
        const fin = ok[ok.length - 1];
        double = { first: a, second: b, final: fin, superseded: ok.length === 2 ? ok[0] : null };
        put = fin.put;
        drillEvents.push({ k, what: `double save: song ${song.id} @${iso(a?.put.startedAt)} rev ${a?.put.rev ?? "failed"}, song ${second.id} @${iso(b?.put.startedAt)} rev ${b?.put.rev ?? "failed"} → final ${fin.song.id}`, at: iso(Date.now()) });
      }
    } else if (ins) {
      const putFirst = Date.now();
      for (let attempt = 1; attempt <= 2 && !put; attempt++) {
        try {
          put = await putSong({ base: BASE, cookie, id: ins.id, position: ins.position, songId: song.id });
          Object.assign(put, { successAt: put.startedAt, startedAt: putFirst, attempts: attempt });
        } catch (e) {
          saveFailures.push({ k, op: "put", attempt, at: iso(Date.now()), error: e.message });
          log(`edit ${k}: PUT failed (${e.message})`);
          await sleep(1000);
        }
      }
    }
    const lostFinalOn = DRILL === "lost-final" && drillThis;
    if (prime) {
      const res = await prime.promise;
      const kinds = {};
      for (const r of res) kinds[`${r.status} ${verifyKindOf(r.verify)}`] = (kinds[`${r.status} ${verifyKindOf(r.verify)}`] || 0) + 1;
      drillEvents.push({ k, what: `memo priming: ${res.length} request(s) minRev=${prime.minRev} sent ${PRIME_LEAD_MS} ms before the PUT; responses ${JSON.stringify(kinds)}, ms ${res.map((r) => r.ms).join("/")}`, at: iso(prime.at), atMs: prime.at });
    }
    if (!ins || !put) {
      log(`edit ${k} SKIPPED (save failed twice) — continuing`);
      if ((DRILL === "silent-loss" || DRILL === "lost-final") && drillThis) pagePop.setDropNotify(drillPageSet, false);
      if (lostFinalOn && SUBS > 0) await subsDropNotify(false);
      continue;
    }
    // A writer that doesn't return rev (older deployment): take it from
    // the next snapshot instead.
    if (put.rev == null) put.rev = (await getSnapshot(BASE, EVENT_ID)).rev;
    noteRev(put.rev);
    const finalSong = double ? double.final.song : song;
    const edit = { k, id: ins.id, song: finalSong, ins, put, double };
    edits.push(edit);
    log(`edit ${k}: row ${ins.id} @${ins.position} insert ${ins.ms} ms (rev ${ins.rev}${ins.attempts > 1 ? `, ${ins.attempts} attempts` : ""}) → song ${finalSong.id} "${finalSong.title}" put ${put.ms} ms (rev ${put.rev}${put.attempts > 1 ? `, ${put.attempts} attempts` : ""})${double ? " [double save]" : ""}`);

    if ((DRILL === "silent-loss" || DRILL === "lost-final") && drillThis) {
      // Keep swallowing notifications on the drilled pages (and, for
      // lost-final, the SDK clients) until each of them shows the marker:
      // ANY later notification (another save, another stream's test row)
      // would otherwise trigger the repair and the drill would measure the
      // push, not the periodic poll. Bounded by the timeout, and by the
      // next edit's start when the drilled edit is not the last one
      // (default for silent-loss, always for lost-final: it is).
      const nextDue = k < EDITS ? editsStart + k * PAUSE_MS : Infinity;
      const until = Math.min(put.startedAt + TIMEOUT_MS, nextDue);
      while (Date.now() < until) {
        const pagesPending = [...drillPageSet].some((i) => pagePop.pages[i] && pagePop.pages[i].rec.seen[finalSong.id] == null);
        const subsPending = lostFinalOn && SUBS > 0 && (await subsReached(put.rev)) < SUBS;
        if (!pagesPending && !subsPending) break;
        await sleep(lostFinalOn ? 250 : 100);
      }
      pagePop.setDropNotify(drillPageSet, false);
      // A hook drop the page never consumed (its PUT notification never
      // came, or came before the arm) would eat a LATER notification:
      // disarm it, and say how many were left.
      const unconsumed = DROP_VIA === "hook" ? await pagePop.disarmHookDrop([...drillPageSet]) : 0;
      if (lostFinalOn && SUBS > 0) await subsDropNotify(false);
      drillEvents.push({ k, what: `${Date.now() >= nextDue ? "stop dropping (next edit due — later notifications may have repaired)" : "stop dropping (drilled clients repaired or timeout)"}${DROP_VIA === "hook" ? `; hook drops left unconsumed: ${unconsumed}` : ""}`, at: iso(Date.now()) });
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
  // The spam runs its full length even when the edits finished first:
  // its duration is part of the drill's definition. The edit window
  // above is already closed, so this only delays the clean-up.
  if (spamP) {
    const s = await spamP;
    drillEvents.push({ k: DRILL_EDIT, what: `guest spam done: ${s.sent} messages in ${Math.round(s.ms / 1000)} s`, at: iso(Date.now()) });
  }
  return { runStart, popSummary, edits, drillEvents, drillPageSet, startRev, editsStart, editsEnd, afterPosition };
}

async function finalize(state, aborted) {
  if (finalized) return null;
  finalized = true;
  log(aborted ? `aborting (${aborted}) — cleaning up` : "cleaning up");
  if (guest) await guest.close();
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
    ((DRILL === "silent-loss" || DRILL === "lost-final") && e.k === drillK && drillPageSet.has(r.idx)) ||
    (DRILL === "ws-blocked" && drillPageSet.has(r.idx)) ||
    (DRILL === "reconnect" && (e.k === drillK || (e.k > drillK && notRejoinedAt(r.joinAt, e.put.startedAt))));
  const isDrilledSub = (r, e) =>
    (DRILL === "lost-final" && e.k === drillK) ||
    (DRILL === "reconnect" && (e.k === drillK || (e.k > drillK && notRejoinedAt(r.subscribedAt, e.put.startedAt))));

  const all = { pagesLat: [], subsLat: [], pagesMissing: 0, subsMissing: 0, drilledLat: [], drilledMissing: 0, pagesIns: [], subsIns: [], notifPagesPut: [], bcastPagesPut: [], bcastPut: [] };
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
    all.bcastPagesPut.push(...s.pages.bcastPut);
    all.bcastPut.push(...s.subs.bcastPut);
    rows.push({ e, s });
  }
  // Edits where a save needed a second attempt (or an insert was adopted
  // after a failed response): their latency already counts from the first
  // attempt above; here they are also shown alone, with the successful
  // attempt's clock next to it, so a retry storm can't hide in the p95.
  const retried = rows.filter(({ e }) => e.put.attempts > 1 || e.ins.attempts > 1 || e.ins.adopted);
  const retriedFirst = summarize(retried.flatMap(({ s }) => [...s.pages.lat, ...s.subs.lat]), retried.reduce((a, { s }) => a + s.pages.missing + s.subs.missing, 0));
  const retriedOk = dist(retried.flatMap(({ s }) => [...s.pages.latFromSuccess, ...s.subs.latFromSuccess]));

  // Monotonicity over the whole edit window (the clean-up's deletes come
  // after editsEnd and legitimately remove every marker).
  const idx = markerIndex(edits);
  const pageMono = pageRecs.map((r) => ({ r, ...pageMonotonicity(r, idx, state.editsEnd) }));
  const subMono = subRecs.map((r) => ({ r, ...subMonotonicity(r) }));
  const monoPagesBad = pageMono.filter((m) => m.regressions.length);
  const monoSubsBad = subMono.filter((m) => m.regressions.length);
  const monoPagesN = pageMono.reduce((a, m) => a + m.regressions.length, 0);
  const monoSubsN = subMono.reduce((a, m) => a + m.regressions.length, 0);
  const pageVersions = pageMono.reduce((a, m) => a + m.versions.length, 0);
  const subApplies = subRecs.reduce((a, r) => a + (r.appliedAll?.length ?? 0), 0);
  // Reconnect drill: the same, only after the sockets were dropped — the
  // polling → realtime handoff is where an older in-flight poll response
  // could land after a newer catch-up.
  const afterDrop = (list) => (dropAt == null ? 0 : list.reduce((a, m) => a + m.regressions.filter((x) => x.t > dropAt).length, 0));

  // Double save: every client must end on the final save (final marker
  // shown and the replaced one gone; SDK applied ≥ the final rev) by the
  // end of the edit window.
  let doubleSave = null;
  const de = DRILL === "double-save" ? edits.find((e) => e.k === drillK && e.double) : null;
  if (de) {
    const fin = String(de.double.final.song.id);
    const sup = de.double.superseded ? String(de.double.superseded.song.id) : null;
    const pagesOk = pageMono.filter((m) => m.present.has(fin) && !(sup && m.present.has(sup))).length;
    const subsOk = subRecs.filter((r) => {
      const before = (r.appliedAll || []).filter(([t]) => t < state.editsEnd);
      return before.length && Math.max(...before.map(([, rev]) => rev)) >= de.put.rev;
    }).length;
    const lat = rows.find(({ e }) => e === de).s;
    const d = dist([...lat.pages.lat, ...lat.subs.lat]);
    doubleSave = { finalSong: fin, supersededSong: sup, finalRev: de.put.rev, gapMs: de.double.second && de.double.first ? de.double.second.put.startedAt - de.double.first.put.startedAt : null, pagesOk, subsOk, pages: pageRecs.length, subs: subRecs.length, latency: d };
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
  verdicts.monotonic = {
    gate: "0 regressions (pages: DOM version; SDK: applied rev)",
    pageRegressions: monoPagesN, pagesWithRegressions: monoPagesBad.length,
    subRegressions: monoSubsN, subsWithRegressions: monoSubsBad.length,
    pass: monoPagesN === 0 && monoSubsN === 0,
  };

  // ─── hint accounting ───
  // SDK: from each client's own request log (the scheduler's descriptor
  // + what came back). Pages: from the URLs and headers they sent / got
  // (an R2 page's notification fetch carries `hint=1`; an R1 build never
  // does).
  const bumpK = (o, k) => { o[k] = (o[k] || 0) + 1; };
  const resolved = (res) => res === "satisfied" || res === "disproved" || res === "superseded";
  const hintTotals = { reqs: 0, notif: 0, notifVerify: {}, verify: {}, res: {}, rechecks: 0, recheckOk: 0, exhausted: 0, byShape: {}, failKinds: {}, serverRevMax: null };
  for (const r of subRecs) {
    for (const q of r.reqs || []) {
      hintTotals.reqs++;
      // e.g. "notification +hint=1", "periodic generic +H", "recheck +H"
      bumpK(hintTotals.byShape, `${q[1]}${q[2] ? " generic" : ""}${q[3] != null ? (q[4] ? " +hint=1" : " +H") : ""}`);
      if (q[7]) bumpK(hintTotals.verify, q[7]);
      if (q[4]) {
        hintTotals.notif++;
        if (q[7]) bumpK(hintTotals.notifVerify, q[7]);
      }
      if (q[9] && q[9] !== "none") bumpK(hintTotals.res, q[9]);
      if (q[1] === "recheck") {
        hintTotals.rechecks++;
        if (resolved(q[9])) hintTotals.recheckOk++;
      }
    }
    hintTotals.exhausted += (r.exhausted || []).length;
    for (const [k, v] of Object.entries(r.failKinds || {})) hintTotals.failKinds[k] = (hintTotals.failKinds[k] || 0) + v;
    if (r.serverRevMax != null && (hintTotals.serverRevMax == null || r.serverRevMax > hintTotals.serverRevMax)) hintTotals.serverRevMax = r.serverRevMax;
  }
  const pageHint = { fetches: 0, notif: 0, notifVerify: {}, verify: {} };
  for (const r of pageRecs) {
    for (const f of r.fetches) {
      pageHint.fetches++;
      if (f[2] === 200) bumpK(pageHint.verify, verifyKindOf(f[5]));
      if (f[6]) {
        pageHint.notif++;
        if (f[2] === 200) bumpK(pageHint.notifVerify, verifyKindOf(f[5]));
      }
    }
  }

  // ─── poison: what the forged hint cost ───
  let poison = null;
  if (DRILL === "poison") {
    const ev = drillEvents.find((d) => d.atMs && d.what.startsWith("guest broadcast"));
    const per = subRecs.map((r) => {
      const carrying = (r.reqs || []).filter((q) => q[3] === POISON_REV);
      return {
        idx: r.idx,
        received: r.bcasts.some(([, rev]) => rev === POISON_REV),
        noted: r.bcasts.some(([, rev, w]) => rev === POISON_REV && w === "n"),
        carrying: carrying.length,
        notif: carrying.filter((q) => q[4]).length,
        rechecks: carrying.filter((q) => q[1] === "recheck").length,
        res: carrying.map((q) => q[9]).filter(Boolean),
        exhausted: (r.exhausted || []).filter(([, h]) => h === POISON_REV).length,
        watermark: r.serverRevMax != null && r.serverRevMax >= POISON_REV,
      };
    });
    const tooMany = per.filter((p) => p.rechecks > 1).length;
    const poisoned = per.filter((p) => p.watermark).length;
    const received = per.filter((p) => p.received).length;
    const resCounts = {};
    for (const p of per) for (const x of p.res) bumpK(resCounts, x);
    const pagesCarrying = pageRecs.map((r) => r.fetches.filter((f) => f[1] === POISON_REV).length);
    poison = {
      at: ev?.at ?? null, per, received, noted: per.filter((p) => p.noted).length, tooMany, poisoned, resCounts,
      carryingMax: per.reduce((a, p) => Math.max(a, p.carrying), 0),
      rechecksTotal: per.reduce((a, p) => a + p.rechecks, 0),
      exhaustedTotal: per.reduce((a, p) => a + p.exhausted, 0),
      pagesCarryingMax: pagesCarrying.reduce((a, v) => Math.max(a, v), 0),
      pagesCarryingTotal: pagesCarrying.reduce((a, v) => a + v, 0),
      // No client received the forgery → the drill did not happen.
      verdict: { pass: SUBS === 0 ? null : received === 0 ? false : tooMany === 0 && poisoned === 0 },
    };
  }

  // ─── spam: per-client request rate under forged hints ───
  let spam = null;
  if (DRILL === "spam" && guest && guest.sends.length) {
    const from = guest.sends[0][0];
    // + the last message's notification fetch and its recheck.
    const to = guest.sends[guest.sends.length - 1][0] + 3000;
    const secs = (to - from) / 1000;
    const per = subRecs.map((r) => {
      const inWin = (r.reqs || []).filter((q) => q[0] >= from && q[0] <= to);
      // The cooldown binds the non-generic hint-driven requests
      // (notification fetches and rechecks); a periodic tick or a retry
      // may legitimately carry a ticket inside the window.
      const bound = inWin.filter((q) => !q[2] && (q[1] === "notification" || q[1] === "recheck")).map((q) => q[0]).sort((a, b) => a - b);
      let minGap = null;
      let tooClose = 0;
      for (let i = 1; i < bound.length; i++) {
        const g = bound[i] - bound[i - 1];
        minGap = minGap === null ? g : Math.min(minGap, g);
        if (g < COOLDOWN_MS - 5) tooClose++;
      }
      // Failures that are not a verdict on a hint: HTTP / network /
      // deadline / malformed body (a server-proven gap has a verify kind).
      const hardFails = inWin.filter((q) => q[11] === "failed" && q[7] == null).length;
      return {
        idx: r.idx, requests: inWin.length, bound: bound.length, minGap, tooClose, hardFails,
        received: r.bcasts.filter(([t]) => t >= from && t <= to).length,
        noted: r.bcasts.filter(([t, , w]) => t >= from && t <= to && w === "n").length,
      };
    });
    const pagesNotif = pageRecs.map((r) => r.fetches.filter((f) => f[6] && f[0] >= from && f[0] <= to).length);
    const tooClose = per.filter((p) => p.tooClose > 0).length;
    const hardFails = per.reduce((a, p) => a + p.hardFails, 0);
    const gaps = per.map((p) => p.minGap).filter((g) => g != null);
    spam = {
      from: iso(from), to: iso(to), secs, per, tooClose, hardFails,
      boundMaxRate: per.reduce((a, p) => Math.max(a, p.bound / secs), 0),
      requestsMaxRate: per.reduce((a, p) => Math.max(a, p.requests / secs), 0),
      minGap: gaps.length ? Math.min(...gaps) : null,
      receivedMedian: dist(per.map((p) => p.received)).p50,
      pagesNotifMaxRate: pagesNotif.reduce((a, v) => Math.max(a, v / secs), 0),
      verdict: { pass: SUBS === 0 ? null : tooClose === 0 && hardFails === 0 },
    };
  }

  // ─── verify-ambiguity: memo answers and their rechecks ───
  let ambiguity = null;
  const ae = DRILL === "verify-ambiguity" ? edits.find((e) => e.k === drillK) : null;
  if (ae) {
    const h = ae.put.rev;
    let memoClients = 0;
    let memoRecheckOk = 0;
    let memoRecheckBad = 0;
    let memoNoRecheck = 0;
    const notifVerify = {};
    let notif = 0;
    for (const r of subRecs) {
      const qs = (r.reqs || []).filter((q) => q[3] === h);
      const n1 = qs.find((q) => q[4]);
      if (!n1) continue;
      notif++;
      if (n1[7]) bumpK(notifVerify, n1[7]);
      if (n1[7] !== "memo" || n1[9] !== "inconclusive") continue;
      memoClients++;
      const rc = qs.find((q) => (q[1] === "recheck" || q[1] === "retry") && q[0] > n1[0]);
      if (!rc) memoNoRecheck++;
      else if (resolved(rc[9])) memoRecheckOk++;
      else memoRecheckBad++;
    }
    const pagesVerify = {};
    for (const r of pageRecs) for (const f of r.fetches) if (f[6] && f[1] === h && f[2] === 200) bumpK(pagesVerify, verifyKindOf(f[5]));
    ambiguity = {
      rev: h, notif, notifVerify, memoClients, memoShare: notif ? memoClients / notif : null,
      memoRecheckOk, memoRecheckBad, memoNoRecheck, pagesVerify,
      verdict: { pass: memoClients === 0 ? null : memoRecheckBad === 0 && memoNoRecheck === 0 },
    };
  }

  if (DRILL === "double-save") {
    const conv = doubleSave ? doubleSave.pagesOk + doubleSave.subsOk : 0;
    const total = doubleSave ? doubleSave.pages + doubleSave.subs : 0;
    verdicts.drill = {
      drill: DRILL, gate: "every client converges to the final save, 0 regressions",
      ...(doubleSave ? doubleSave.latency : dist([])), missing: total - conv,
      pass: doubleSave ? conv === total && verdicts.monotonic.pass : false,
    };
  } else if (DRILL === "poison" && poison) {
    // The honest saves are judged by the primary gate (no pair is
    // degraded on purpose); this row judges what the forgery cost.
    verdicts.drill = {
      drill: DRILL, gate: "≤ 1 recheck of the forged hint per SDK client, serverRev never ≥ the forged rev, forged broadcast received",
      ...dist([]), missing: 0, ...poison.verdict,
    };
  } else if (DRILL === "spam" && spam) {
    verdicts.drill = {
      drill: DRILL, gate: `notification / recheck starts ≥ ${COOLDOWN_MS} ms apart per SDK client, 0 HTTP / network / deadline failures during the spam`,
      ...dist([]), missing: 0, ...spam.verdict,
    };
  } else if (DRILL === "verify-ambiguity" && ambiguity) {
    verdicts.drill = {
      drill: DRILL, gate: "every SDK client answered `memo` for the drilled save resolves it on its one recheck (n/a when no memo was observed)",
      ...dist([]), missing: 0, ...ambiguity.verdict,
    };
  } else if (DRILL) {
    const gate = DRILL === "silent-loss" ? SILENT_GATE_MS : DRILL === "ws-blocked" ? BLOCKED_GATE_MS : DRILL === "lost-final" ? LOST_GATE_MS : null;
    verdicts.drill = { drill: DRILL, gate: gate == null ? "informational (catch-up after reconnect)" : `max ≤ ${gate} ms, 0 missing`, ...drilled, pass: gate == null ? null : drilled.n > 0 && drilled.missing === 0 && drilled.max <= gate };
  }

  // Population diagnostics.
  const pageJoin = dist(pageRecs.filter((r) => r.joinAt.length && r.loadedAt).map((r) => r.joinAt[0] - r.openedAt));
  const pagePg = dist(pageRecs.filter((r) => r.pgReadyAt.length).map((r) => r.pgReadyAt[0] - r.openedAt));
  const subJoin = dist(subRecs.filter((r) => r.subscribedAt.length).map((r) => r.subscribedAt[0] - r.attemptAt));
  const statusTotals = {};
  const errTotals = {};
  const fetchReasons = {};
  const sources = {};
  let fallbacks = 0;
  let recreates = 0;
  let retryAfter = 0;
  let fetchFailures = 0;
  for (const r of subRecs) {
    for (const [k, v] of Object.entries(r.statuses)) statusTotals[k] = (statusTotals[k] || 0) + v;
    for (const [k, v] of Object.entries(r.errors)) errTotals[k] = (errTotals[k] || 0) + v;
    for (const [k, v] of Object.entries(r.fetches)) fetchReasons[k] = (fetchReasons[k] || 0) + v;
    for (const [k, v] of Object.entries(r.sources)) sources[k] = (sources[k] || 0) + v;
    fallbacks += r.fallbacks.length;
    recreates += r.recreates?.length ?? 0;
    retryAfter += r.retryAfter ?? 0;
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
        subsRecreatesAfterDrop: subRecs.reduce((a, r) => a + (r.recreates || []).filter(([x]) => x > t).length, 0),
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
  lines.push("Latency = PUT (the save that makes the marker exist) request start of its FIRST attempt → marker link in the page DOM / SDK client applied a snapshot with rev ≥ the PUT's rev. Missing = not seen within the timeout. Monotonic: no page/client ever went back to an older version.");
  lines.push("");
  lines.push("| Scope | n | p50 ms | p95 ms | max ms | missing | gate | verdict |");
  lines.push("|---|---|---|---|---|---|---|---|");
  lines.push(`| all pairs (pages + SDK) | ${dline(combined)} | ${combined.missing} | p95 ≤ ${GATE_P95_MS}, 0 missing${skippedEdits ? `, **${skippedEdits} edit(s) not saved**` : ""} | ${v(verdicts.primary.pass)} |`);
  lines.push(`| edit × page | ${dline(pagesD)} | ${pagesD.missing} | same | ${v(verdicts.pages.pass)} |`);
  lines.push(`| edit × SDK client | ${dline(subsD)} | ${subsD.missing} | same | ${v(verdicts.subs.pass)} |`);
  if (DRILL === "double-save") {
    const dd = verdicts.drill;
    lines.push(`| drill double-save (edit ${drillK}: final save start → final state) | ${dline(dd)} | ${dd.missing} not converged | ${dd.gate} | ${v(dd.pass)} |`);
  } else if (poison) {
    lines.push(`| drill poison (forged rev ${POISON_REV}) | ${poison.received}/${M} SDK received | — | — | — | ${poison.tooMany} client(s) > 1 recheck, ${poison.poisoned} with serverRev ≥ forged | ${verdicts.drill.gate} | ${v(verdicts.drill.pass)} |`);
  } else if (spam) {
    lines.push(`| drill spam (${guest.sends.length} msgs, ${spam.secs.toFixed(0)} s) | ${M} SDK | — | — | — | ${spam.tooClose} client(s) under the cooldown, ${spam.hardFails} hard failure(s) | ${verdicts.drill.gate} | ${v(verdicts.drill.pass)} |`);
  } else if (ambiguity) {
    lines.push(`| drill verify-ambiguity (rev ${ambiguity.rev}) | ${ambiguity.notif} notification fetches | — | — | — | memo ${ambiguity.memoClients} → recheck ok ${ambiguity.memoRecheckOk}, not ok ${ambiguity.memoRecheckBad}, none ${ambiguity.memoNoRecheck} | ${verdicts.drill.gate} | ${v(verdicts.drill.pass)} |`);
  } else if (verdicts.drill) {
    lines.push(`| drill ${DRILL} (drilled pairs) | ${dline(drilled)} | ${drilled.missing} | ${verdicts.drill.gate} | ${v(verdicts.drill.pass)} |`);
  }
  lines.push(`| monotonic DOM (pages: version shown never decreases) | ${P} pages, ${pageVersions} versions | — | — | — | ${monoPagesN} regressions on ${monoPagesBad.length} page(s) | 0 | ${v(P ? monoPagesN === 0 : null)} |`);
  lines.push(`| monotonic applied rev (SDK) | ${M} clients, ${subApplies} applies | — | — | — | ${monoSubsN} regressions on ${monoSubsBad.length} client(s) | 0 | ${v(M ? monoSubsN === 0 : null)} |`);
  if (DRILL === "reconnect") lines.push(`| reconnect handoff: regressions after the drop (pages / SDK) | — | — | — | — | ${afterDrop(pageMono)} / ${afterDrop(subMono)} | 0 | ${v(afterDrop(pageMono) + afterDrop(subMono) === 0)} |`);
  lines.push(`| edits with a retried save (clock from the 1st attempt) | ${dline(retriedFirst)} | ${retriedFirst.missing} | informational — ${retried.length} edit(s); from the successful attempt p50/p95/max ${ms(retriedOk.p50)}/${ms(retriedOk.p95)}/${ms(retriedOk.max)} | n/a |`);
  lines.push("");
  lines.push(`Insert-start based (insert-after request start → marker), non-drilled: pages ${dline(dist(all.pagesIns))} · SDK ${dline(dist(all.subsIns))} (n | p50 | p95 | max).`);
  lines.push("");
  lines.push("## Notification paths (PUT start → arrival)");
  lines.push("");
  lines.push("An R1 page build (what the preview runs until R2 deploys, or after a rollback) is notified by postgres_changes and ignores the broadcast; an R2 build only has the broadcast. The SDK clients are always R2.");
  lines.push("");
  lines.push("| Path | delivered / expected | p50 ms | p95 ms | max ms |");
  lines.push("|---|---|---|---|---|");
  const nP = dist(all.notifPagesPut);
  const bP = dist(all.bcastPagesPut);
  const bS = dist(all.bcastPut);
  lines.push(`| postgres_changes UPDATE → pages (R1 build) | ${nP.n} / ${P * edits.length} | ${ms(nP.p50)} | ${ms(nP.p95)} | ${ms(nP.max)} |`);
  lines.push(`| broadcast \`rev\` → pages | ${bP.n} / ${P * edits.length} | ${ms(bP.p50)} | ${ms(bP.p95)} | ${ms(bP.max)} |`);
  lines.push(`| broadcast \`rev\` → SDK | ${bS.n} / ${M * edits.length} | ${ms(bS.p50)} | ${ms(bS.p95)} | ${ms(bS.max)} |`);
  lines.push("");
  lines.push("## Per edit");
  lines.push("");
  lines.push("| # | row | marker song | insert start (UTC) | ins ms | rev | PUT start (UTC) | PUT ms | rev |");
  lines.push("|---|---|---|---|---|---|---|---|---|");
  const tries = (x) => (x.attempts > 1 ? ` (${x.attempts} attempts)` : "");
  const markOf = (e) => {
    const nDrilled = pageRecs.filter((r) => isDrilledPage(r, e)).length + subRecs.filter((r) => isDrilledSub(r, e)).length;
    return `${e.k}${nDrilled ? ` (drill: ${nDrilled})` : ""}${e.double ? " (double save)" : ""}`;
  };
  for (const { e } of rows) {
    lines.push(`| ${markOf(e)} | ${e.id} | ${e.song.id} ${e.song.title.replace(/\|/g, "/")} | ${iso(e.ins.startedAt)} | ${ms(e.ins.ms)}${e.ins.adopted ? " (adopted)" : ""}${tries(e.ins)} | ${ms(e.ins.rev)} | ${iso(e.put.startedAt)} | ${e.put.ms}${tries(e.put)} | ${e.put.rev} |`);
  }
  // Two tables, one per population: the gate is judged over both, but a
  // page (real React render, R1 or R2 build) and an SDK client (the R2
  // client logic without a DOM) fail differently, so they are read apart.
  const kinds = (o) => Object.entries(o).map(([k, n]) => `${k} ${n}`).join(", ") || "—";
  lines.push("");
  lines.push("### Per save — pages (PUT start → marker in the DOM)");
  lines.push("");
  lines.push("| # | PUT rev | seen | p50 / p95 / max ms | missing | bcast → page p50 / p95 (n) | pg → page (n) | notification fetches (hint=1) | their x-snapshot-verify |");
  lines.push("|---|---|---|---|---|---|---|---|---|");
  for (const { e, s } of rows) {
    const pl = dist([...s.pages.lat, ...s.pages.drilledLat]);
    const bp = dist(s.pages.bcastPut);
    lines.push(`| ${markOf(e)} | ${e.put.rev} | ${pl.n}/${P} | ${ms(pl.p50)} / ${ms(pl.p95)} / ${ms(pl.max)} | ${s.pages.missing + s.pages.drilledMissing} | ${ms(bp.p50)} / ${ms(bp.p95)} (${bp.n}) | ${s.pages.notifPut.length} | ${s.pages.hint.notif} | ${kinds(s.pages.hint.verify)} |`);
  }
  lines.push("");
  lines.push("### Per save — SDK clients (PUT start → applied rev ≥ PUT rev)");
  lines.push("");
  lines.push("| # | PUT rev | reached | p50 / p95 / max ms | missing | bcast → SDK p50 / p95 (n) | notification fetches | their x-snapshot-verify | ticket resolutions | rechecks (resolved) | exhausted |");
  lines.push("|---|---|---|---|---|---|---|---|---|---|---|");
  for (const { e, s } of rows) {
    const sl = dist([...s.subs.lat, ...s.subs.drilledLat]);
    const bp = dist(s.subs.bcastPut);
    const h = s.subs.hint;
    lines.push(`| ${markOf(e)} | ${e.put.rev} | ${sl.n}/${M} | ${ms(sl.p50)} / ${ms(sl.p95)} / ${ms(sl.max)} | ${s.subs.missing + s.subs.drilledMissing} | ${ms(bp.p50)} / ${ms(bp.p95)} (${bp.n}) | ${h.notif} | ${kinds(h.verify)} | ${kinds(h.res)} | ${h.rechecks} (${h.recheckOk}) | ${h.exhausted} |`);
  }
  lines.push("");
  lines.push("## Hint outcomes (whole run)");
  lines.push("");
  lines.push(`- SDK: ${hintTotals.reqs} requests; notification fetches (hint=1) ${hintTotals.notif}, their x-snapshot-verify: ${kinds(hintTotals.notifVerify)}; all 200 responses: ${kinds(hintTotals.verify)}`);
  lines.push(`  - ticket resolutions: ${kinds(hintTotals.res)}; rechecks ${hintTotals.rechecks} (${hintTotals.notif ? ((hintTotals.rechecks / hintTotals.notif) * 100).toFixed(1) : "—"} % of notification fetches), resolved on the recheck ${hintTotals.recheckOk}; hints exhausted ${hintTotals.exhausted}; highest serverRev held ${hintTotals.serverRevMax ?? "—"}`);
  lines.push(`  - request shapes (reason / generic / ticket): ${kinds(hintTotals.byShape)}; failures by kind: ${kinds(hintTotals.failKinds)}`);
  lines.push(`- Pages: ${pageHint.fetches} /api/setlist responses; notification fetches (hint=1) ${pageHint.notif}, their x-snapshot-verify: ${kinds(pageHint.notifVerify)}; all 200 responses: ${kinds(pageHint.verify)} (an R1 page build sends no hint=1)`);
  lines.push("");
  lines.push("## Population");
  lines.push("");
  const pagesPgN = pageRecs.filter((r) => r.pgReadyAt.length).length;
  lines.push(`- Pages: ${pageRecs.filter((r) => r.loadedAt).length}/${P} loaded; channel joined ${pageRecs.filter((r) => r.joinAt.length).length}${pagesPgN ? `; pg_changes registered ${pagesPgN} (R1 build)` : ""}; visibility ${JSON.stringify(Object.fromEntries(Object.entries(pageRecs.reduce((a, r) => ((a[r.visibility] = (a[r.visibility] || 0) + 1), a), {}))))}; locales ${JSON.stringify(pageRecs.reduce((a, r) => ((a[r.locale] = (a[r.locale] || 0) + 1), a), {}))}`);
  lines.push(`  - open → join ms: n=${pageJoin.n} p50=${ms(pageJoin.p50)} p95=${ms(pageJoin.p95)} max=${ms(pageJoin.max)}${pagePg.n ? `; open → pg_changes ready: n=${pagePg.n} p50=${ms(pagePg.p50)} p95=${ms(pagePg.p95)} max=${ms(pagePg.max)}` : ""}`);
  lines.push(`  - /api/setlist responses seen: ${pageFetches} (${JSON.stringify(pageSources)}); page errors: ${pageRecs.reduce((a, r) => a + r.errors.length, 0)}; ws opens ${pageRecs.reduce((a, r) => a + r.wsOpens, 0)}, closes ${pageRecs.reduce((a, r) => a + r.wsCloses, 0)}; rev broadcasts seen ${pageRecs.reduce((a, r) => a + r.bcasts.length, 0)}; dropped notification frames ${pageRecs.reduce((a, r) => a + r.droppedFrames, 0)}, blocked attempts ${pageRecs.reduce((a, r) => a + r.blockedAttempts, 0)}`);
  lines.push(`- SDK: ${subRecs.filter((r) => r.subscribedAt.length).length}/${M} joined; all joined after ${popSummary.allJoinedSec ?? "—"} s (from population start)`);
  lines.push(`  - subscribe → SUBSCRIBED ms: n=${subJoin.n} p50=${ms(subJoin.p50)} p95=${ms(subJoin.p95)} max=${ms(subJoin.max)}`);
  lines.push(`  - statuses ${JSON.stringify(statusTotals)}; disconnected episodes (polling while realtime-js rejoins) ${fallbacks}; channel re-creations ${recreates}; fetch failures ${fetchFailures} (with Retry-After ${retryAfter}); fetches by reason ${JSON.stringify(fetchReasons)}; X-Snapshot-Source ${JSON.stringify(sources)}`);
  if (Object.keys(errTotals).length) lines.push(`  - channel errors: ${JSON.stringify(errTotals)}`);
  if (poison) {
    lines.push("");
    lines.push("## Poison drill");
    lines.push("");
    lines.push(`- forged \`{ kind: "setlist", rev: ${POISON_REV} }\` sent ${poison.at ?? "—"}; received by ${poison.received}/${M} SDK clients (news for ${poison.noted})`);
    lines.push(`- requests carrying the forged hint: ${poison.per.reduce((a, p) => a + p.carrying, 0)} (max ${poison.carryingMax} per client); notification fetches ${poison.per.reduce((a, p) => a + p.notif, 0)}; rechecks ${poison.rechecksTotal} (clients with > 1: ${poison.tooMany}); resolutions ${kinds(poison.resCounts)}; exhausted ${poison.exhaustedTotal}`);
    lines.push(`- durable watermark: clients whose serverRev ever reached the forged rev: **${poison.poisoned}**; highest serverRev held by any client ${hintTotals.serverRevMax ?? "—"}`);
    lines.push(`- pages: /api/setlist requests with minRev = the forged rev: ${poison.pagesCarryingTotal} (max ${poison.pagesCarryingMax} per page; an R1 build ignores the broadcast → 0)`);
  }
  if (spam) {
    lines.push("");
    lines.push("## Spam drill");
    lines.push("");
    lines.push(`- window ${spam.from} → ${spam.to} (${spam.secs.toFixed(1)} s, last message + 3 s); messages received per SDK client p50 ${spam.receivedMedian ?? "—"}`);
    lines.push(`- per SDK client: hint-driven requests (notification + recheck) max ${spam.boundMaxRate.toFixed(2)}/s, all requests max ${spam.requestsMaxRate.toFixed(2)}/s; smallest gap between two hint-driven starts ${spam.minGap ?? "—"} ms (cooldown ${COOLDOWN_MS} ms; clients under it: ${spam.tooClose}); HTTP / network / deadline failures ${spam.hardFails}`);
    lines.push(`- pages: notification fetches (hint=1) max ${spam.pagesNotifMaxRate.toFixed(2)}/s per page (an R1 build ignores the broadcast → 0)`);
  }
  if (ambiguity) {
    lines.push("");
    lines.push("## Verify-ambiguity drill");
    lines.push("");
    lines.push(`- drilled save rev ${ambiguity.rev}: SDK notification fetches ${ambiguity.notif}, x-snapshot-verify ${kinds(ambiguity.notifVerify)}; memo share ${ambiguity.memoShare == null ? "—" : `${(ambiguity.memoShare * 100).toFixed(1)} %`} (${ambiguity.memoClients} client(s))`);
    lines.push(`- after a memo answer: recheck resolved ${ambiguity.memoRecheckOk}, recheck NOT resolved ${ambiguity.memoRecheckBad}, no recheck ${ambiguity.memoNoRecheck}; pages' notification fetches for that rev: ${kinds(ambiguity.pagesVerify)}`);
    lines.push("- memo only appears when a hinted fetch lands on a primed instance within 1 s AND its snapshot read still returned the pre-save revision (a coalesced read that began before the commit, or a cache entry the purge had not reached yet); Vercel decides the routing, so 0 memo is a valid outcome (verdict n/a), not a pass.");
  }
  if (rejoin) {
    lines.push("");
    lines.push("## Reconnect drill");
    lines.push("");
    lines.push(`- Rejoin after force-close: pages n=${rejoin.pages.n} p50=${ms(rejoin.pages.p50)} p95=${ms(rejoin.pages.p95)} max=${ms(rejoin.pages.max)}; SDK n=${rejoin.subs.n} p50=${ms(rejoin.subs.p50)} p95=${ms(rejoin.subs.p95)} max=${ms(rejoin.subs.max)}; SDK clients that entered the disconnected (polling) state: ${rejoin.subsFallbacksAfterDrop}; channel re-creations after the drop: ${rejoin.subsRecreatesAfterDrop} (0 expected: realtime-js rejoins within the 60 s grace)`);
  }
  if (doubleSave) {
    lines.push("");
    lines.push("## Double-save drill");
    lines.push("");
    lines.push(`- 2nd PUT started ${ms(doubleSave.gapMs)} ms after the 1st; final save = song ${doubleSave.finalSong} (rev ${doubleSave.finalRev})${doubleSave.supersededSong ? `, replaced song ${doubleSave.supersededSong}` : " (the other PUT failed)"}`);
    lines.push(`- converged by the end of the edit window: pages ${doubleSave.pagesOk}/${doubleSave.pages} (final marker shown, replaced one gone), SDK ${doubleSave.subsOk}/${doubleSave.subs} (applied ≥ rev ${doubleSave.finalRev}); final save start → final state p50/p95/max ${ms(doubleSave.latency.p50)}/${ms(doubleSave.latency.p95)}/${ms(doubleSave.latency.max)} ms`);
  }
  if (monoPagesBad.length || monoSubsBad.length) {
    lines.push("");
    lines.push("## Monotonicity regressions (first 10)");
    lines.push("");
    for (const m of monoPagesBad.slice(0, 10)) lines.push(`- page ${m.r.idx} (${m.r.locale}): ${m.regressions.slice(0, 3).map((x) => `${iso(x.t)} ${x.what}`).join("; ")}`);
    for (const m of monoSubsBad.slice(0, 10)) lines.push(`- SDK ${m.r.idx}: ${m.regressions.slice(0, 3).map((x) => `${iso(x.t)} ${x.what}`).join("; ")}`);
  }
  if (guest) {
    // Send results by the server's verdict, and the time span, so a
    // Realtime rate limit (results other than "ok") is visible.
    const results = {};
    for (const [, , r] of guest.sends) results[r] = (results[r] || 0) + 1;
    const ts = guest.sends.map(([t]) => t);
    const revs = [...new Set(guest.sends.map(([, rev]) => rev))];
    lines.push("");
    lines.push("## Guest broadcasts");
    lines.push("");
    lines.push(`- anon client on public \`event:${EVENT_ID}\`: ${guest.status} after ${guest.joinMs} ms; ${guest.sends.length} message(s) \`{ kind: "setlist", rev }\` sent ${ts.length ? `${iso(Math.min(...ts))} → ${iso(Math.max(...ts))}` : "—"}; results ${JSON.stringify(results)}`);
    lines.push(`- revs claimed: ${revs.length <= 6 ? revs.join(", ") : `${revs.slice(0, 3).join(", ")} … ${revs.slice(-2).join(", ")} (${revs.length} distinct)`}${DRILL === "spam" ? ` (mode ${SPAM_REV})` : ""}`);
  }
  if (drillEvents.length) {
    lines.push("");
    lines.push("## Drill events");
    lines.push("");
    for (const d of drillEvents) lines.push(`- edit ${d.k} ${d.at}: ${d.what}`);
  }
  if (DRILL === "lost-final") {
    // Which fetch delivered the dropped save to each SDK client: the first
    // applied snapshot with rev ≥ the PUT's rev. "periodic" is the repair
    // poll this drill exists to prove.
    const e = edits.find((x) => x.k === drillK);
    if (e) {
      const reasons = {};
      for (const r of subRecs) {
        const a = (r.appliedAll || []).find(([t, rev]) => t >= e.put.startedAt && rev >= e.put.rev);
        const k = a ? a[2] : "never";
        reasons[k] = (reasons[k] || 0) + 1;
      }
      lines.push("");
      lines.push(`SDK clients: fetch reason that delivered the dropped save ${JSON.stringify(reasons)}; dropped notifications recorded ${subRecs.reduce((a, r) => a + r.bcasts.filter(([, , w]) => w === "x").length, 0)}.`);
    }
  }
  if (DRILL === "silent-loss" || DRILL === "ws-blocked" || DRILL === "lost-final") {
    // Which request repaired each drilled page: the first /api/setlist
    // response carrying rev ≥ the PUT's rev. A notification-triggered
    // request sends minRev = applied + 1; a periodic / fallback poll
    // sends the highest rev it has already seen.
    lines.push("");
    lines.push("| drilled page | edit | locale | PUT → marker ms | dropped notification frames (proxy) | repairing fetch: ms after PUT, minRev, source |");
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
    config: { base: BASE, eventId: EVENT_ID, eventPath: EVENT_PATH, pages: PAGES, subs: SUBS, subWorkers: SUB_WORKERS, edits: EDITS, pauseMs: PAUSE_MS, timeoutMs: TIMEOUT_MS, drill: DRILL, drillPages: DRILL_PAGES, drillEdit: DRILL_EDIT, label: args.label ?? null,
      ...(DRILL === "poison" ? { poisonRev: POISON_REV, poisonLeadMs: POISON_LEAD_MS } : {}),
      ...(DRILL === "spam" ? { spamRate: SPAM_RATE, spamSecs: SPAM_SECS, spamRev: SPAM_REV } : {}) },
    window: { runStart: iso(state.runStart), editsStart: iso(state.editsStart), editsEnd: iso(state.editsEnd), end: iso(Date.now()) },
    verdicts, popSummary, rejoin, drillEvents, saveFailures, clean, verify, doubleSave,
    guest: guest ? { status: guest.status, joinMs: guest.joinMs, sends: guest.sends } : null,
    hints: { sdk: hintTotals, pages: pageHint }, poison, spam, ambiguity,
    // Every page's DOM-derived version history and every client's
    // regressions (the full per-client apply log is too large to keep).
    monotonic: {
      pages: pageMono.map((m) => ({ idx: m.r.idx, versions: m.versions, regressions: m.regressions })),
      subs: monoSubsBad.map((m) => ({ idx: m.r.idx, regressions: m.regressions })),
    },
    edits: rows.map(({ e, s }) => ({
      k: e.k, id: e.id, song: e.song,
      insert: { start: iso(e.ins.startedAt), ms: e.ins.ms, rev: e.ins.rev, position: e.ins.position },
      put: { start: iso(e.put.startedAt), successStart: iso(e.put.successAt ?? e.put.startedAt), attempts: e.put.attempts ?? 1, ms: e.put.ms, rev: e.put.rev },
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
  process.exit(json.verdicts.primary.pass !== false && json.verdicts.drill?.pass !== false && json.verdicts.monotonic.pass !== false ? 0 : 1);
} catch (e) {
  log(`ERROR: ${e.stack || e.message}`);
  await finalize(mainState, `error: ${e.message}`);
  process.exit(2);
}
