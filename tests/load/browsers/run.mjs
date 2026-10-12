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
// `--pause` seconds apart (admin.mjs). `--edit-mode` picks the shape of
// one edit: `pair` (default) = insert-after + PUT (two saves, two
// broadcasts; the PUT's notification fetch always meets the 1 s cooldown
// the insert's opened), `standalone` = ONE PUT that puts the next marker
// on an "anchor" row the run created before the population joined (one
// save, one broadcast — the clean single-save case), `mixed` = pair on
// odd edits, standalone on even ones. Measurement: PUT start → marker
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
// double-save | lost-final | poison | spam | verify-ambiguity | overlap`,
// see the README and the per-drill comments below. `overlap` (n14
// qualification step 4) replaces the edit shape for the whole run: every
// edit is a GROUP of 2–3 concurrent PUTs on three anchor rows, judged per
// group against its head (overlap.mjs; exposure from the server logs:
// ../overlap-join.mjs). `poison` and `spam` are the two guest-
// broadcast drills: an anonymous supabase-js client (anon key, like any
// visitor) joins the public `event:<id>` channel and sends forged `rev`
// broadcasts in the exact shape the writer sends, so the clients cannot
// tell them apart from real hints. They only mean something against R2
// clients (which treat the broadcast as their notification); R1 pages
// ignore broadcasts.
//
// Writer warming (server flag LIVE_WARM_ENTRIES=1, observed only): every
// notification fetch's `x-snapshot-source` is recorded (pages and SDK),
// the per-save tables give warm hits ÷ hinted fetches and the first
// hinted request's start − commit (commit proxy = the PUT's response),
// the gate table an informational "warming" row, and the JSON a `warm`
// section with each client's first hinted fetch per save — the input of
// ../warm-join.mjs, which lines it up with the warm job's completion
// from the Vercel history logs (the harness cannot see those live).
//
// Measurement validity (every run): the main thread and every SDK
// worker thread run an event-loop lag monitor (100 ms tick), the workers
// send a heartbeat each second, and the workers time their own 8 s
// deadline timers. A lag sample > 1 s on any thread, or a worker silent
// for > 3 s, inside the measurement window makes the run INVALID (exit
// code 3; a banner names the thread and the time; the gates are still
// printed, labelled "measurement invalid"): the load host, not the
// system under test, delayed the timestamps. See hostmon.mjs.
//
// Results: tests/load/results/<UTC date>/<stamp>-browsers.md (+ .json,
// gitignored) and <stamp>-timelines.jsonl (gitignored, stays local): one
// line per SDK client and per page with its full request / apply /
// broadcast timeline, so a run can be re-analysed client by client
// afterwards (the JSON keeps only per-save aggregates for SDK clients). All timestamps in the files are UTC ISO so the run can be
// aligned with a concurrent k6 burst from another stream.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { Worker } from "node:worker_threads";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { loadEnv, assertDev, parseArgs, dist, sleep, pgClient, isDeploymentBaseUrl } from "../realtime/lib.mjs";
import { adminLogin, getSnapshot, insertAfter, putSong, activeRows, pickMarkerSongs, cleanup, findUnacknowledgedInsert } from "./admin.mjs";
import { putSongRaw, createSong, updateSongTitle, deleteSong, postReaction, deleteReaction, reloadEditor } from "./admin.mjs";
import {
  parseOverlapFlags, rolesOf, isOkSave, groupAnchor, pageGroupConvergence, sdkGroupConvergence, subMonotonicityRC,
  pageStallSuspect, reloadVerdict, roleLatency, reactionVerdict, ackHoldVerdict, probePlan,
} from "./overlap.mjs";
import { REACTION_TYPES, ANON_PREFIX } from "../lib/constants.js";
import { launchPages } from "./pages.mjs";
import { parseSnapshotVerify } from "../../../src/lib/snapshotVerify.ts";
import { NOTIFICATION_COOLDOWN_MS as COOLDOWN_MS } from "../../../src/lib/liveScheduler.ts";
import {
  startLagMonitor, lagOver, validity, LAG_INVALID_MS, SILENT_INVALID_MS, startHostSampler, summarizeHost, HOST_SAMPLE_ROW,
  hostBusy, listProcesses, competingProcesses, HOST_BUSY_LIMIT_PCT,
} from "./hostmon.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

loadEnv();
process.env.BASE_URL = process.env.BASE_URL || "https://opensetlist-git-dev-opensetlist-projects.vercel.app";
const args = parseArgs(process.argv.slice(2));
// --deployment-url: run against ONE preview deployment's own URL instead
// of the dev alias. The fault drills need this (LIVE_WARM_FAULT is bound
// to a deployment at deploy time, so each fault is its own deployment and
// the shared alias never carries one). The URL shape alone cannot tell a
// preview from a production deployment, which is why assertDev refuses
// it by default; with the flag, the shape is checked here and main()
// additionally proves — before the first admin write — that the target's
// snapshot of the event carries the dev database's current revision.
const DEPLOYMENT_URL = args["deployment-url"] === true || args["deployment-url"] === "true";
if (DEPLOYMENT_URL) {
  assertDev({ requireBase: false });
  if (!isDeploymentBaseUrl(process.env.BASE_URL)) {
    console.error("refusing: --deployment-url needs BASE_URL = https://opensetlist-<hash>-opensetlist-projects.vercel.app");
    process.exit(2);
  }
} else {
  assertDev({ requireBase: true });
}

const int = (k, d) => (args[k] === undefined ? d : parseInt(args[k], 10));
const BASE = process.env.BASE_URL.replace(/\/$/, "");
const EVENT_ID = String(args["event-id"] ?? "111");
const EVENT_PATH = args["event-path"] ?? "/events/111/rehearsal-lovelive-fes-2020-day1";
const PAGES = int("pages", 30);
const SUBS = int("subs", 470);
const EDITS = int("edits", 12);
const PAUSE_MS = Math.round(parseFloat(args.pause ?? "25") * 1000);
const AFTER_ROW = int("after-row", 2);
// See the header. insert-after cannot carry a song (the route takes only
// { eventId, afterPosition }), so a single-save edit is a PUT that swaps
// the marker song on a row the run created up front.
const EDIT_MODE = String(args["edit-mode"] ?? "pair");
if (!["pair", "standalone", "mixed"].includes(EDIT_MODE)) {
  console.error("--edit-mode must be pair|standalone|mixed");
  process.exit(2);
}
const modeOf = (k) => (EDIT_MODE === "mixed" ? (k % 2 === 1 ? "pair" : "standalone") : EDIT_MODE);
const NEEDS_ANCHOR = EDIT_MODE !== "pair";
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
// Host isolation guard (see hostGuard()): warn by default, refuse to
// start with --strict-host.
const STRICT_HOST = args["strict-host"] === true || args["strict-host"] === "true";
// Self-test of the INVALID path: `--debug-stall=<ms>` makes SDK worker 0
// busy-wait that long right before the first edit, i.e. exactly the
// failure the validity monitors exist to catch. Expect exit code 3 and
// the banner naming "worker 0". Never use it for a measurement.
const DEBUG_STALL_MS = int("debug-stall", 0);
const GATE_P95_MS = int("gate-p95", 3000);
// camelCase spellings accepted too (doubleSave, lostFinal, …).
const DRILL = args.drill ? String(args.drill).replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`) : null;
if (DRILL && !["silent-loss", "ws-blocked", "reconnect", "double-save", "lost-final", "poison", "spam", "verify-ambiguity", "overlap"].includes(DRILL)) {
  console.error(`unknown --drill=${args.drill}`);
  process.exit(2);
}
// overlap (n14 qualification step 4): see overlap.mjs for the flags, their
// defaults and the refusal rules (all checked here, before anything is
// created). `OV` is null for every other run.
const OVERLAP = DRILL === "overlap";
const OV_PARSED = parseOverlapFlags(args, { drill: DRILL, deploymentUrl: DEPLOYMENT_URL });
if (OV_PARSED.error) {
  console.error(OV_PARSED.error);
  process.exit(2);
}
const OV = OV_PARSED.cfg;
// Reaction types: the page's ack-hold click uses the LAST type, the raw
// reactions cycle over the others, so the clicked button's count changes
// only by the page's own reaction (the ack-hold verdict compares exact
// counts).
const OV_PAGE_RX_TYPE_INDEX = REACTION_TYPES.length - 1;
const OV_RAW_RX_TYPES = REACTION_TYPES.slice(0, -1);
// The ack-hold test needs a reaction button on anchor row A at click
// time, i.e. a song already on the row: group 1's save A puts the first
// one there, so the earliest group that can run the test is group 2.
const OV_REACTION_GROUP = 2;
// A short run id for the drill's dedicated song titles and raw reaction
// anonIds (`n14run2-<run>-<k>-<i>`: the prefix viewers-check.mjs knows).
const RUN_ID = Date.now().toString(36);
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
// standalone / mixed: the row every single-save edit rewrites. Its
// position is tracked (each pair insert above it shifts it down by one)
// AND re-read from the DB before each standalone save, because the PUT
// writes `position` too: a stale value would move the row or trip the
// (eventId, position) unique index.
let anchor = null; // { id, position }
// overlap: the three anchor rows { A, B, C: { id, position } }, the
// dedicated catalog-edit songs (S5) and every reaction id this run
// created (raw + the page's own), all removed by finalize().
const ovAnchors = {};
const ovSongs = [];
const ovReactionIds = [];
// Measurement validity (see the header and hostmon.mjs). The main
// thread's monitor starts at load: it owns every page timestamp
// (Playwright events land here) and the admin driver's save clock.
const mainLag = startLagMonitor();
const heartbeats = {}; // worker idx → [[recvT, sendT, lagMaxSinceLast], …]
const workerStarted = {}; // worker idx → spawn time
let workerMeta = []; // per worker: { worker, lag, deadlineLate, timedOut }
// Host telemetry, 1 s: load average, host CPU busy (all cores), this
// process's CPU (all its threads, incl. the SDK workers), RSS, free
// memory, thread count. Summarised per phase in the report, raw in the
// JSON — the context for a lag spike (was the HOST busy, or only us?).
// Chromium runs in separate processes, so its CPU shows in the host
// figure, not in the process figure.
const hostMon = startHostSampler({ threads: () => 1 + workers.length });

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
        batch: batchPer, every: 1000, localeOf: LOCALE_OF, workerIdx: w,
        // overlap: record anchor row A's song title per response.
        anchorId: OVERLAP ? ovAnchors.A?.id ?? null : null,
      },
    });
    workerStarted[w] = Date.now();
    heartbeats[w] = [];
    const waiters = {};
    worker.on("message", (m) => {
      if (m.type === "hb") {
        heartbeats[w].push([Date.now(), m.t, m.lagMax]);
        return;
      }
      const q = waiters[m.type];
      if (q && q.length) q.shift()(m);
    });
    worker.on("error", (e) => log(`worker ${w} error: ${e.message}`));
    const ask = (cmd, type, extra = {}) => new Promise((resolve) => {
      (waiters[type] ||= []).push(resolve);
      worker.postMessage({ cmd, ...extra });
    });
    workers.push({ worker, n, ask, idx: w });
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
// A broadcast the proxy DROPPED (marker "x") was recorded on the way
// through the proxy but never reached Chromium, so it is not an arrival;
// counting it would make a silent-loss / lost-final run report a
// delivery (and a timestamp) the page never saw.
const pageNoted = (rec, { rev, id, ty }) =>
  rec.bcasts.some(([, r, w]) => w !== "x" && r !== null && rev != null && r >= rev) || rec.notes.some(([, t, i]) => t === ty && i === id);

async function stopWorkers() {
  const results = await Promise.all(workers.map((w) => Promise.race([
    w.ask("stop", "result"),
    sleep(20000).then(() => ({ worker: w.idx, clients: [], timedOut: true })),
  ])));
  await Promise.allSettled(workers.map((w) => w.worker.terminate()));
  workerMeta = results.map((r, i) => ({ worker: r.worker ?? workers[i].idx, lag: r.lag ?? null, deadlineLate: r.deadlineLate ?? [], timedOut: !!r.timedOut, clients: r.clients.length }));
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
// A message whose slot has already passed by a whole interval (a slow ack
// held the loop) is SKIPPED, not sent late: catching up would send a
// back-to-back burst above the configured rate, and the drill's claim is
// "N messages per second", not "N × SECS messages". Skipped slots are
// reported so the achieved rate is visible.
async function runSpam(g, latestRev) {
  const total = Math.round(SPAM_RATE * SPAM_SECS);
  const interval = 1000 / SPAM_RATE;
  const start = Date.now();
  let sent = 0;
  let skipped = 0;
  for (let j = 0; j < total; j++) {
    const due = start + j * interval;
    const now = Date.now();
    if (now < due) await sleep(due - now);
    else if (now > due + interval) {
      skipped++;
      continue;
    }
    const rev = SPAM_REV === "max" ? Number.MAX_SAFE_INTEGER : SPAM_REV === "stale" ? latestRev() : latestRev() + 1;
    await g.send(rev, `spam ${j + 1}/${total}`);
    sent++;
  }
  return { sent, skipped, planned: total, ms: Date.now() - start };
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
  // null for a standalone edit (no insert): the insert-based columns are
  // then simply empty for it.
  const tIns = edit.ins?.startedAt ?? null;
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
  //
  // Writer warming: `warm` = how many of those notification fetches the
  // server answered from the save's warm entry (`x-snapshot-source:
  // warm`), and `first` = each client's FIRST notification fetch of the
  // save, timed against the commit proxy (`tCommit`, the PUT's response
  // = the end of the attempt that succeeded: the server commits, then
  // answers, then starts the warm job in `after()`). warm-join.mjs puts
  // these next to the warm job's completion from the Vercel logs.
  const hintStats = () => ({ notif: 0, warm: 0, verify: {}, res: {}, rechecks: 0, recheckOk: 0, exhausted: 0, first: [] });
  const tCommit = (edit.put.successAt ?? tPut) + (edit.put.ms ?? 0);
  const out = {
    pages: { lat: [], latFromSuccess: [], latFromInsert: [], missing: 0, drilledLat: [], drilledMissing: 0, notifPut: [], notifIns: [], bcastPut: [], hint: hintStats() },
    subs: { lat: [], latFromSuccess: [], latFromInsert: [], missing: 0, drilledLat: [], drilledMissing: 0, notifPut: [], notifIns: [], bcastPut: [], bcastIns: [], hint: hintStats() },
  };
  const bumpK = (o, k) => { o[k] = (o[k] || 0) + 1; };
  for (const r of pageRecs) {
    // An R2 page's notification fetch for this save: `hint=1` with
    // minRev = put.rev (pages expose no ticket, the URL is the evidence).
    let first = null;
    for (const f of r.fetches) {
      if (!f[6] || f[1] !== edit.put.rev) continue;
      out.pages.hint.notif++;
      if (f[3] === "warm") out.pages.hint.warm++;
      bumpK(out.pages.hint.verify, verifyKindOf(f[5]));
      // Responses are recorded in arrival order; the first REQUEST is
      // the one that left first (a miss that built can answer later).
      const start = f[7] ?? f[0];
      if (!first || start < first.start) first = { start, f };
    }
    // [page idx, locale, request start − commit ms, response − commit ms,
    //  source, verify kind, minRev sent]
    //  + body rev (appended in step 4: warm-join's "served newer than key")
    if (first) out.pages.hint.first.push([r.idx, r.locale, first.start - tCommit, first.f[0] - tCommit, first.f[3], verifyKindOf(first.f[5]), first.f[1], first.f[4] ?? null]);
    const bpp = firstAfter(r.bcasts || [], ([t, rev, w]) => w !== "x" && rev === edit.put.rev && t >= tPut - 50);
    if (bpp) out.pages.bcastPut.push(bpp[0] - tPut);
  }
  for (const r of subRecs) {
    let firstDone = false;
    for (const q of r.reqs || []) {
      if (q[3] !== edit.put.rev) continue;
      if (q[4]) {
        out.subs.hint.notif++;
        if (q[12] === "warm") out.subs.hint.warm++;
        if (q[7]) bumpK(out.subs.hint.verify, q[7]);
        // reqs are in dispatch order: the first one is the first fetch.
        // [client idx, locale, send − commit ms, end − commit ms (null
        //  if it never settled), source (null = no 200), verify kind,
        //  minRev sent]
        if (!firstDone) {
          firstDone = true;
          out.subs.hint.first.push([r.idx, r.locale, q[0] - tCommit, q[10] == null ? null : q[10] - tCommit, q[12] ?? null, q[7] ?? null, q[5], q[8] ?? null]);
        }
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
      if (!drilled && tIns != null) bucket.latFromInsert.push(seen - tIns);
      if (!drilled) bucket.latFromSuccess.push(seen - tPutOk);
    } else if (drilled) bucket.drilledMissing++;
    else bucket.missing++;
    const nu = firstAfter(r.notes, ([t, ty, id]) => id === edit.id && ty === "U" && t >= tPut && t < noteEnd);
    if (nu) bucket.notifPut.push(nu[0] - tPut);
    const ni = tIns == null ? null : firstAfter(r.notes, ([t, ty, id]) => id === edit.id && ty === "I" && t >= tIns && t < noteEnd);
    if (ni) bucket.notifIns.push(ni[0] - tIns);
  }
  for (const r of subRecs) {
    const a = firstAfter(r.applied, ([, rev]) => rev >= edit.put.rev);
    const ok = a != null && a[0] <= deadline;
    const drilled = isDrilledSub(r, edit);
    const bucket = out.subs;
    if (ok) {
      (drilled ? bucket.drilledLat : bucket.lat).push(a[0] - tPut);
      if (!drilled && tIns != null) bucket.latFromInsert.push(a[0] - tIns);
      if (!drilled) bucket.latFromSuccess.push(a[0] - tPutOk);
    } else if (drilled) bucket.drilledMissing++;
    else bucket.missing++;
    const bp = firstAfter(r.bcasts, ([t, rev, w]) => w !== "x" && rev === edit.put.rev && t >= tPut - 50);
    if (bp) bucket.bcastPut.push(bp[0] - tPut);
    const bi = tIns == null ? null : firstAfter(r.bcasts, ([t, rev, w]) => w !== "x" && rev === edit.ins.rev && t >= tIns - 50);
    if (bi) bucket.bcastIns.push(bi[0] - tIns);
  }
  return out;
}

const ms = (v) => (v == null ? "—" : `${v}`);
const dline = (d) => `${d.n} | ${ms(d.p50)} | ${ms(d.p95)} | ${ms(d.max)}`;

// ─── monotonicity ───
// Marker song → rev of the save that put it on its row, plus which
// markers a later save on the SAME row replaced (removing those is the
// expected outcome, not a regression): the superseded save of a double
// save, and every earlier marker on the standalone anchor row. A marker
// is "replaced" by every higher-rev marker on its row, not only the next
// one — a page may skip an intermediate version entirely.
function markerIndex(edits) {
  const rev = new Map();
  const byRow = new Map(); // row id → [[songId, rev], …]
  const add = (row, songId, r) => {
    rev.set(songId, r);
    if (!byRow.has(row)) byRow.set(row, []);
    byRow.get(row).push([songId, r]);
  };
  for (const e of edits) {
    if (e.double) {
      for (const x of [e.double.first, e.double.second]) if (x) add(e.id, String(x.song.id), x.put.rev);
    } else {
      add(e.id, String(e.song.id), e.put.rev);
    }
  }
  const replacedBy = new Map(); // songId → Set of songIds that replace it
  for (const list of byRow.values()) {
    for (const [id, r] of list) {
      const later = list.filter(([, r2]) => r2 > r).map(([x]) => x);
      if (later.length) replacedBy.set(id, new Set(later));
    }
  }
  return { rev, replacedBy };
}
const replacedPresent = (idx, id, present) => [...(idx.replacedBy.get(id) || [])].some((x) => present.has(x));

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
      if (!replacedPresent(idx, id, present)) regressions.push({ t, what: `marker ${id} (rev ${idx.rev.get(id)}) disappeared` });
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

// ─── host isolation guard ───
// Nothing else may run on the load host during a run: a busy host or a
// concurrent heavy process (a history log fetch, the summariser, another
// run, k6) stalls the worker threads and turns the run INVALID at best,
// or skews it below the INVALID thresholds at worst. Checked once, before
// anything is created: host CPU busy (POSIX: 1-min load ÷ cores;
// Windows: a 2 s CPU sample, loadavg is always 0 there) > 60 %, or a
// competing process (hostmon.mjs `competingProcesses`; the log capture
// and the pooler samplers are allowed). Warn, or with --strict-host
// refuse. The result goes into the report and the JSON either way.
let hostCheck = null;
async function hostGuard() {
  const busy = await hostBusy(2000);
  const procs = listProcesses();
  const competing = procs ? competingProcesses(procs) : null;
  const problems = [];
  if (busy.pct != null && busy.pct > HOST_BUSY_LIMIT_PCT) problems.push(`host CPU ${busy.pct} % busy (${busy.how}) > ${HOST_BUSY_LIMIT_PCT} %`);
  for (const p of competing || []) problems.push(`pid ${p.pid}: ${p.why} — ${String(p.cmd).slice(0, 120)}`);
  hostCheck = { busyPct: busy.pct, how: busy.how, competing: competing?.map(({ pid, why, cmd }) => ({ pid, why, cmd: String(cmd).slice(0, 300) })) ?? null, processListOk: procs != null, problems, strict: STRICT_HOST };
  if (procs == null) log("host guard: could not list processes (not checked)");
  if (!problems.length) {
    log(`host guard: ok (CPU ${busy.pct} % busy, ${busy.how}; no competing processes)`);
    return;
  }
  for (const m of problems) log(`host guard WARNING: ${m}`);
  if (STRICT_HOST) throw new Error(`--strict-host: the load host is not isolated (${problems.length} problem(s)); nothing was created`);
  log("host guard: continuing (no --strict-host); expect an INVALID verdict if the host stalls");
}

// ─── overlap drill (--drill=overlap) ───
// One probe: a hinted fetch for key (locale, minRev) exactly as a
// notification fetch would send it. The row is the `probe` population's
// (design §2.2): [tStart, locale, minRev, status, source, bodyRev,
// capturedAt, anchorTitle, tEnd]. anchorTitle = anchor row A's song
// `originalTitle` in the body — the content evidence of the catalog-edit
// race (a warm entry captured before the title change).
const PROBE_ROW = ["tStart", "locale", "minRev", "status (0 = network)", "x-snapshot-source", "body rev", "body capturedAt (epoch ms, PostgreSQL clock)", "anchor A song originalTitle", "tEnd"];
async function probeOnce(locale, minRev) {
  const t0 = Date.now();
  try {
    const res = await fetch(`${BASE}/api/setlist?eventId=${EVENT_ID}&locale=${locale}&minRev=${minRev}&hint=1`, { signal: AbortSignal.timeout(15000) });
    const source = res.headers.get("x-snapshot-source");
    let body = null;
    try { body = await res.json(); } catch { /* non-JSON error body */ }
    const cap = typeof body?.capturedAt === "string" ? Date.parse(body.capturedAt) : NaN;
    const item = Array.isArray(body?.items) ? body.items.find((x) => String(x?.id) === String(ovAnchors.A?.id)) : null;
    return [t0, locale, minRev, res.status, source, Number.isSafeInteger(body?.rev) ? body.rev : null, Number.isFinite(cap) ? cap : null, item?.songs?.[0]?.song?.originalTitle ?? null, Date.now()];
  } catch {
    return [t0, locale, minRev, 0, null, null, null, null, Date.now()];
  }
}

// Probes of one group (design §2.3): every committed rev of the group —
// the ACTUAL revs the saves returned, never R+1 arithmetic — × 3 locales
// at +1 s, +2 s, +4 s after the last save's response. Each row is tagged
// with the offset and the save (who) whose key it reads; the older key(s)
// are the interesting ones once the population has merged onto the head.
// Reported apart; never part of a convergence gate.
async function runProbes(anchorInfo) {
  const plan = probePlan(anchorInfo.committed);
  const byOff = new Map();
  for (const x of plan) {
    if (!byOff.has(x.off)) byOff.set(x.off, []);
    byOff.get(x.off).push(x);
  }
  const out = [];
  for (const [off, list] of [...byOff.entries()].sort((a, b) => a[0] - b[0])) {
    const due = anchorInfo.lastResponse + off;
    if (Date.now() < due) await sleep(due - Date.now());
    const rows = await Promise.all(list.map((x) => probeOnce(x.locale, x.rev).then((row) => ({ off, who: x.who, head: x.rev === anchorInfo.head, row }))));
    out.push(...rows);
  }
  return out;
}

// One overlap group k. Every action is scheduled from ONE start instant
// t0 (save A's dispatch), none awaits another: save A at 0 (with the
// fault header, if any), B at --overlap-gap, C at --overlap-third-at,
// editor reloads at --overlap-reload-at, the catalog edit at
// --overlap-catalog-at, n raw reactions spread over [0, 3 s]. The saves
// are NOT retried (a retried A landing after B would change which save is
// the head mid-measurement — same reason as double-save); a failed save
// is recorded with its status and the group fails the "all saves
// committed" gate. Returns the group record plus its still-running
// background work (probes, the page reaction trace).
async function overlapGroup(k, { songFor, reactionPage, aMarkerIds }) {
  const roles = rolesOf(OV);
  // Re-read the anchors' positions (the PUT writes `position`; a stale
  // value would move the row or trip the (eventId, position) index).
  const ids = roles.map((w) => ovAnchors[w].id);
  const pos = await withPg(async (pg) => (await pg.query(`select id::text as id, position from "SetlistItem" where id = any($1::bigint[])`, [ids])).rows)
    .catch((e) => { log(`  anchor position read failed (${e.message}); using tracked positions`); return []; });
  for (const r of pos) for (const w of roles) if (ovAnchors[w].id === r.id) ovAnchors[w].position = Number(r.position);

  const g = { k, saves: [], reloads: [], catalog: null, reactions: [], t0: null };
  let ahRun = null;
  if (OV.pageReaction && k === OV_REACTION_GROUP && reactionPage != null && pagePop.armAckHold) {
    const arm = await pagePop.armAckHold(reactionPage, {
      anchorId: ovAnchors.A.id, markerIds: aMarkerIds, typeIndex: OV_PAGE_RX_TYPE_INDEX,
      reactionType: REACTION_TYPES[OV_PAGE_RX_TYPE_INDEX],
      // Long enough for a releasing snapshot: the next group's notification
      // fetch, or the periodic poll (20 s ± 4 s) when this is the last group.
      windowMs: 30000,
    });
    ahRun = arm.run().then((tr) => {
      if (tr?.ack?.reactionId) ovReactionIds.push(tr.ack.reactionId);
      return tr;
    });
  }
  const t0 = Date.now();
  g.t0 = t0;
  const at = (off, fn) => sleep(Math.max(0, t0 + off - Date.now())).then(fn);
  const offsetOf = { A: 0, B: OV.gapMs, C: OV.thirdAtMs };
  const saveP = roles.map((who) => at(offsetOf[who], async () => {
    const song = songFor(k, who);
    const row = ovAnchors[who];
    const fault = who === "A" ? OV.faultA : null;
    const r = await putSongRaw({ base: BASE, cookie, id: row.id, position: row.position, songId: song.id, fault });
    if (r.error) saveFailures.push({ k, op: `put (overlap ${who})`, attempt: 1, at: iso(r.startedAt), error: r.error });
    return { k, who, rowId: row.id, song, startedAt: r.startedAt, ms: r.ms, status: r.status, rev: r.rev, attempts: 1, fault, error: r.error };
  }));
  const reloadP = OV.reloadAt.map((off) => at(off, () => reloadEditor({ base: BASE, cookie, eventId: EVENT_ID }).then((r) => ({ k, off, ...r }))));
  const dedicated = OV.catalogAtMs > 0 ? ovSongs[k - 1] : null;
  const catP = dedicated
    ? at(OV.catalogAtMs, () => {
      const to = `${dedicated.title}-c${k}`;
      return updateSongTitle({ base: BASE, cookie, song: dedicated, originalTitle: to })
        .then((r) => ({ k, songId: dedicated.id, from: dedicated.title, to, ...r }));
    })
    : null;
  const rxP = Array.from({ length: OV.reactions }, (_, i) => at(Math.round((i * 3000) / Math.max(1, OV.reactions)), () => {
    const reactionType = OV_RAW_RX_TYPES[i % OV_RAW_RX_TYPES.length];
    return postReaction({ base: BASE, setlistItemId: ovAnchors.A.id, reactionType, anonId: `${ANON_PREFIX}${RUN_ID}-${k}-${i}` })
      .then((r) => {
        if (r.reactionId) ovReactionIds.push(r.reactionId);
        return { k, i, reactionType, ...r };
      });
  }));
  g.saves = await Promise.all(saveP);
  g.anchor = groupAnchor(g.saves);
  const probeP = OV.probes && g.anchor.committed.length ? runProbes(g.anchor) : Promise.resolve([]);
  g.reloads = await Promise.all(reloadP);
  g.catalog = catP ? await catP : null;
  g.reactions = await Promise.all(rxP);
  const txt = g.saves.map((s) => `${s.who} ${s.status}${s.rev != null ? ` rev ${s.rev}` : ""} ${s.ms} ms`).join(", ");
  log(`group ${k}: ${txt}; head ${g.anchor.head ?? "—"}${g.catalog ? `; catalog PUT ${g.catalog.status} ${g.catalog.ms} ms` : ""}${g.reloads.length ? `; reloads ${g.reloads.map((r) => `${r.status}/${r.ms}ms${r.contentOk ? "" : "/content-FAIL"}`).join(" ")}` : ""}${g.reactions.length ? `; reactions ${g.reactions.filter((r) => r.status >= 200 && r.status < 300).length}/${g.reactions.length} ok` : ""}`);
  return { g, probeP, ahRun };
}

// Control reloads of the editor (no save in flight): before the first
// group, in every pause, after the last group — the in-window ÷ control
// ratio's denominator. Sequential, ~1 s apart.
async function controlReloads(n, phase) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const r = await reloadEditor({ base: BASE, cookie, eventId: EVENT_ID });
    out.push({ k: "control", phase, ...r });
    if (i < n - 1) await sleep(1000);
  }
  return out;
}

// ─── main ───
async function main() {
  const runStart = Date.now();
  await hostGuard();
  log(`browsers run: base=${BASE} event=${EVENT_ID} pages=${PAGES} subs=${SUBS} (workers=${SUB_WORKERS}) edits=${EDITS} pause=${PAUSE_MS}ms drill=${DRILL ?? "none"}`);

  // DB: recorded starting rows (for the position restore) + marker songs.
  const pg = pgClient();
  await pg.connect();
  let songs;
  let startRev;
  try {
    original = await activeRows(pg, EVENT_ID);
    // double-save needs one more marker for its second PUT. overlap: one
    // per save of every group (groups × roles), minus save A's when the
    // catalog edit is on (A then gets a dedicated song per group).
    songs = OVERLAP
      ? await pickMarkerSongs(pg, EDITS * (rolesOf(OV).length - (OV.catalogAtMs > 0 ? 1 : 0)))
      : await pickMarkerSongs(pg, EDITS + (DRILL === "double-save" ? 1 : 0));
    startRev = Number((await pg.query(`select "setlistRevision" as r from "Event" where id = $1`, [EVENT_ID])).rows[0].r);
  } finally {
    await pg.end();
  }
  if (original.length < AFTER_ROW) throw new Error(`event ${EVENT_ID} has ${original.length} active rows, need ≥ ${AFTER_ROW}`);
  const afterPosition = original[AFTER_ROW - 1].position;
  log(`event ${EVENT_ID}: ${original.length} active rows, rev ${startRev}; inserting after row ${AFTER_ROW} (position ${afterPosition}); markers ${songs.map((s) => s.id).join(",")}`);

  // --deployment-url: before any write, the target must serve THIS event
  // exactly as the dev database has it right now: the same revision AND
  // the same active rows (ids with their positions, in order). A
  // production deployment of the same URL shape reads the production
  // database; its event 111, if the id exists at all, has rows created
  // by a different autoincrement sequence at different positions and a
  // revision counter on its own trajectory, so it cannot reproduce this
  // id/position list at this revision — revision + row count alone could
  // coincide, the id list cannot. Read-only: a mismatch stops the run
  // with nothing created. The minRev fetch bypasses cached snapshots; a
  // concurrent dev save between the pg read and the fetch shows up as a
  // revision mismatch, which also aborts (re-run). The API serialises
  // the BigInt ids as JSON numbers, exact below 2^53; SetlistItem ids
  // are in the thousands, so the string comparison against pg's text
  // ids is exact here.
  if (DEPLOYMENT_URL) {
    const snap = await getSnapshot(BASE, EVENT_ID, { locale: "ko", minRev: startRev });
    const served = (Array.isArray(snap.items) ? snap.items : []).map((it) => `${it.id}@${Number(it.position)}`).join(",");
    const expected = original.map((r) => `${r.id}@${r.position}`).join(",");
    if (Number(snap.rev) !== startRev || served !== expected) {
      throw new Error(`--deployment-url: ${BASE} serves event ${EVENT_ID} at rev ${snap.rev} with rows [${served.slice(0, 120)}], the dev database has rev ${startRev} with rows [${expected.slice(0, 120)}] — not the dev deployment; nothing was created`);
    }
    log(`deployment-url check: ${BASE} serves event ${EVENT_ID} at rev ${startRev} with the dev database's ${original.length} rows (ids and positions match)`);
  }

  cookie = await adminLogin(BASE);

  // standalone / mixed: create the anchor row now, before any viewer
  // joins, so its own insert is not part of any measured save. It sits
  // right after row AFTER_ROW, i.e. exactly where pair inserts land —
  // which shifts it down by one per pair insert (tracked below).
  // (overlap creates its own three anchors below; --edit-mode is ignored
  // for it.)
  if (NEEDS_ANCHOR && !OVERLAP) {
    const a = await insertAfter({ base: BASE, cookie, eventId: EVENT_ID, afterPosition });
    created.push(a.id);
    anchor = { id: a.id, position: a.position };
    log(`anchor row ${a.id} @${a.position} created (rev ${a.rev}) for ${EDIT_MODE} edits`);
  }

  // overlap: THREE anchor rows (A, B and — with --overlap-third-at — C),
  // created before any viewer joins, so the drill's saves are pure
  // concurrent PUTs on distinct rows. Each insert lands right after row
  // AFTER_ROW and pushes the earlier ones down; the positions are re-read
  // from the database before every group anyway. S5 (--overlap-catalog-
  // at): one dedicated song per group for save A, created now (its own
  // cache expiry happens before the measurement), soft-deleted at the
  // clean-up; a real catalog song is never edited.
  if (OVERLAP) {
    for (const who of rolesOf(OV)) {
      const a = await insertAfter({ base: BASE, cookie, eventId: EVENT_ID, afterPosition });
      created.push(a.id);
      ovAnchors[who] = { id: a.id, position: a.position };
      log(`overlap anchor ${who}: row ${a.id} (rev ${a.rev})`);
    }
    if (OV.catalogAtMs > 0) {
      for (let k = 1; k <= EDITS; k++) {
        const song = await createSong({ base: BASE, cookie, title: `n14-overlap-${RUN_ID}-${k}` });
        ovSongs.push(song);
      }
      log(`overlap: ${ovSongs.length} dedicated song(s) for save A created (${ovSongs.map((x) => x.id).join(",")})`);
    }
  }

  // Populations.
  const drillPageSet = new Set(Array.from({ length: Math.min(DRILL_PAGES, PAGES) }, (_, i) => i));
  const routeMode = (idx) => {
    if (DRILL === "ws-blocked" && drillPageSet.has(idx)) return "blocked";
    if (DRILL === "silent-loss" && DROP_VIA === "proxy" && drillPageSet.has(idx)) return "proxy";
    if (DRILL === "reconnect") return "proxy";
    if (DRILL === "lost-final" && DROP_VIA === "proxy" && drillPageSet.has(idx)) return "proxy";
    return "none";
  };
  const popStart = Date.now();
  if (SUBS > 0) startWorkers();
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
  const settleStart = Date.now();
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
  // overlap: 3 control reloads of the admin editor before the first group.
  const ovReloadControls = [];
  if (OVERLAP && OV.reloadAt.length) ovReloadControls.push(...(await controlReloads(3, "before")));

  // Edits.
  const edits = [];
  // overlap: per group the record + its background work (see overlapGroup).
  const ovGroups = [];
  const ovPending = [];
  const ovRoles = OVERLAP ? rolesOf(OV) : [];
  const ovPlain = OVERLAP ? ovRoles.filter((w) => !(w === "A" && OV.catalogAtMs > 0)) : [];
  const ovSongFor = (k, who) => (who === "A" && OV.catalogAtMs > 0 ? ovSongs[k - 1] : songs[(k - 1) * ovPlain.length + ovPlain.indexOf(who)]);
  // The page that runs the reaction ack-hold test: the lowest-index page
  // that is not routed by a websocket drill (overlap routes none).
  const ovReactionPage = OVERLAP && OV.pageReaction ? (pagePop.pages.findIndex((p) => p && p.rec.mode === "none" && p.rec.loadedAt) ?? -1) : -1;
  const drillEvents = [];
  // Newest real save rev seen by the admin driver (spam --spam-rev).
  let latestRev = startRev;
  const noteRev = (r) => {
    if (Number.isSafeInteger(r) && r > latestRev) latestRev = r;
  };
  let spamP = null;
  if (DEBUG_STALL_MS > 0 && workers.length) {
    log(`--debug-stall: blocking worker 0 for ${DEBUG_STALL_MS} ms (self-test; this run must come out INVALID)`);
    workers[0].worker.postMessage({ cmd: "debugStall", ms: DEBUG_STALL_MS });
  }
  const editsStart = Date.now();
  for (let k = 1; k <= EDITS; k++) {
    const due = editsStart + (k - 1) * PAUSE_MS;
    if (Date.now() < due) await sleep(due - Date.now());
    if (OVERLAP) {
      const aMarkerIds = Array.from({ length: EDITS }, (_, i) => ovSongFor(i + 1, "A").id);
      const { g, probeP, ahRun } = await overlapGroup(k, { songFor: ovSongFor, reactionPage: ovReactionPage >= 0 ? ovReactionPage : null, aMarkerIds });
      ovGroups.push(g);
      ovPending.push(probeP.then((rows) => { g.probes = rows; }));
      if (ahRun) ovPending.push(ahRun.then((tr) => { g.pageReaction = tr; }));
      for (const s of g.saves) {
        if (!isOkSave(s)) continue;
        noteRev(s.rev);
        // One entry per committed save: the per-save tables, the hint
        // accounting, the DOM monotonicity (markerIndex: a later group's
        // marker on the same anchor row replaces the earlier one) and the
        // warm section all work on these unchanged.
        edits.push({ k, who: s.who, mode: "overlap", id: s.rowId, song: s.song, ins: null, put: { startedAt: s.startedAt, successAt: s.startedAt, ms: s.ms, rev: s.rev, attempts: 1 }, double: null });
      }
      // 2 control reloads in the pause (after the probes' +4 s).
      if (OV.reloadAt.length && k < EDITS) {
        for (const f of [0.6, 0.8]) {
          const t = due + Math.round(PAUSE_MS * f);
          if (Date.now() < t) await sleep(t - Date.now());
          ovReloadControls.push(...(await controlReloads(1, `pause ${k}`)));
        }
      }
      continue;
    }
    const song = songs[k - 1];
    const drillThis = k === DRILL_EDIT;
    const mode = modeOf(k);
    if (mode === "standalone") {
      // Re-read the anchor's position (see `anchor`); the tracked value
      // is the fallback when the DB read fails. Before any drill action,
      // so a drill's timing relative to the save is unchanged.
      const p = await withPg(async (pg) => (await pg.query(`select position from "SetlistItem" where id = $1`, [anchor.id])).rows[0]?.position)
        .catch((e) => { log(`  anchor position read failed (${e.message}); using tracked ${anchor.position}`); return null; });
      if (p != null) anchor.position = Number(p);
    }

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
    for (let attempt = 1; attempt <= 2 && !ins && mode === "pair"; attempt++) {
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
    // A committed pair insert at or above the anchor shifts it down.
    if (ins && anchor && anchor.position >= ins.position) anchor.position++;
    // The row this edit's PUT(s) write: the fresh row of a pair, or the
    // anchor of a standalone edit.
    const target = mode === "pair" ? ins : anchor;

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
    if (target && drillThis && (DRILL === "lost-final" || hookSilent)) {
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
    if (target && drillThis && DRILL === "verify-ambiguity") {
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
    if (target && DRILL === "double-save" && drillThis) {
      // Two PUTs on the same row, the 2nd started DOUBLE_GAP_MS after the
      // 1st without waiting for it. Both take the Event row lock, so they
      // commit one after the other; which one commits last is decided by
      // the lock, not by the start order, so the FINAL state is the save
      // with the higher rev. No retries here: a retried 1st PUT landing
      // after the 2nd would change which save is final mid-measurement.
      const second = songs[EDITS];
      const fire = (s, delayMs) => sleep(delayMs).then(() => {
        const t = Date.now();
        return putSong({ base: BASE, cookie, id: target.id, position: target.position, songId: s.id })
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
    } else if (target) {
      const putFirst = Date.now();
      for (let attempt = 1; attempt <= 2 && !put; attempt++) {
        try {
          put = await putSong({ base: BASE, cookie, id: target.id, position: target.position, songId: song.id });
          Object.assign(put, { successAt: put.startedAt, startedAt: putFirst, attempts: attempt });
        } catch (e) {
          saveFailures.push({ k, op: mode === "pair" ? "put" : "put (standalone)", attempt, at: iso(Date.now()), error: e.message });
          log(`edit ${k}: PUT failed (${e.message})`);
          await sleep(1000);
          // A stale anchor position fails on the unique index: re-read it
          // before the retry.
          if (mode === "standalone") {
            const p = await withPg(async (pg) => (await pg.query(`select position from "SetlistItem" where id = $1`, [anchor.id])).rows[0]?.position).catch(() => null);
            if (p != null) anchor.position = Number(p);
          }
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
    if (!target || !put) {
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
    const edit = { k, mode, id: target.id, song: finalSong, ins, put, double };
    edits.push(edit);
    log(`edit ${k} [${mode}]: row ${target.id} @${target.position}${ins ? ` insert ${ins.ms} ms (rev ${ins.rev}${ins.attempts > 1 ? `, ${ins.attempts} attempts` : ""})` : ""} → song ${finalSong.id} "${finalSong.title}" put ${put.ms} ms (rev ${put.rev}${put.attempts > 1 ? `, ${put.attempts} attempts` : ""})${double ? " [double save]" : ""}`);

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
  // overlap: the last save in the list is not necessarily the head (the
  // Event row lock orders the commits), so wait for the highest rev from
  // the last save's start instead.
  const lastRev = OVERLAP && edits.length ? Math.max(...edits.map((e) => e.put.rev)) : last?.put.rev;
  const lastStartAt = OVERLAP && edits.length ? Math.max(...edits.map((e) => e.put.startedAt)) : last?.put.startedAt;
  while (last && Date.now() < lastStartAt + TIMEOUT_MS) {
    const pagesDone = pagePop.pages.every((p) => !p || edits.every((e) => p.rec.seen[e.song.id] != null));
    const subsDone = SUBS === 0 || (await subsReached(lastRev)) >= SUBS;
    if (pagesDone && subsDone) break;
    await sleep(500);
  }
  const editsEnd = Date.now();
  // overlap, after the measurement window: 3 control reloads, the quiet
  // tail (--overlap-quiet-tail: sparse probes of the LAST group's keys
  // every 10 s — how long an older / stale entry stays readable through
  // the 90 s TTL; the window is censored at the tail's end), then the
  // background work of every group.
  let ovTail = [];
  if (OVERLAP) {
    if (OV.reloadAt.length) ovReloadControls.push(...(await controlReloads(3, "after")));
    const lg = ovGroups[ovGroups.length - 1];
    if (OV.quietTailS > 0 && lg?.anchor.committed.length) {
      const tailEnd = Date.now() + OV.quietTailS * 1000;
      log(`overlap quiet tail: probing group ${lg.k}'s keys every 10 s for ${OV.quietTailS} s`);
      while (Date.now() < tailEnd) {
        const rows = await Promise.all(probePlan(lg.anchor.committed, ["ja", "ko", "en"], [0]).map((x) => probeOnce(x.locale, x.rev).then((row) => ({ who: x.who, head: x.rev === lg.anchor.head, row }))));
        ovTail.push(...rows);
        const next = Math.min(tailEnd, Date.now() + 10000);
        if (Date.now() < next) await sleep(next - Date.now());
      }
    }
    await Promise.all(ovPending);
  }
  // The spam runs its full length even when the edits finished first:
  // its duration is part of the drill's definition. The edit window
  // above is already closed, so this only delays the clean-up.
  if (spamP) {
    const s = await spamP;
    drillEvents.push({ k: DRILL_EDIT, what: `guest spam done: ${s.sent} of ${s.planned} messages in ${Math.round(s.ms / 1000)} s${s.skipped ? ` (${s.skipped} slots skipped after slow acks)` : ""}`, at: iso(Date.now()) });
  }
  return {
    runStart, popStart, settleStart, popSummary, edits, drillEvents, drillPageSet, startRev, editsStart, editsEnd, afterPosition,
    ...(OVERLAP ? { overlap: { groups: ovGroups, controls: ovReloadControls, tail: ovTail, reactionPage: ovReactionPage >= 0 ? ovReactionPage : null } } : {}),
  };
}

async function finalize(state, aborted) {
  if (finalized) return null;
  finalized = true;
  log(aborted ? `aborting (${aborted}) — cleaning up` : "cleaning up");
  if (guest) await guest.close();
  // overlap: every reaction this run created (raw ones by their returned
  // id — the n14run2- prefix is only the safety net for viewers-check.mjs
  // — and the page's own, whose browser anonId carries no prefix), then
  // the rows below, then the dedicated songs (soft-deleted; a song row is
  // never hard-deleted).
  let ovClean = null;
  if (OVERLAP) {
    ovClean = { reactions: { deleted: 0, failed: [] }, songs: { deleted: 0, failed: [] } };
    for (const id of [...new Set(ovReactionIds)]) {
      const r = await deleteReaction({ base: BASE, reactionId: id });
      if (r.status >= 200 && r.status < 300) ovClean.reactions.deleted++;
      else ovClean.reactions.failed.push(id);
    }
  }
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
  if (ovClean && cookie) {
    for (const song of ovSongs) {
      const r = await deleteSong({ base: BASE, cookie, id: song.id });
      if (r.status >= 200 && r.status < 300) ovClean.songs.deleted++;
      else ovClean.songs.failed.push(song.id);
    }
    log(`overlap cleanup: reactions deleted ${ovClean.reactions.deleted}/${new Set(ovReactionIds).size}${ovClean.reactions.failed.length ? ` FAILED ${ovClean.reactions.failed.join(",")}` : ""}; songs soft-deleted ${ovClean.songs.deleted}/${ovSongs.length}${ovClean.songs.failed.length ? ` FAILED ${ovClean.songs.failed.join(",")}` : ""}`);
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
  return { clean, verify, subRecs, pageRecs, ovClean };
}

function report(state, fin) {
  const { edits, popSummary, drillEvents, drillPageSet } = state;
  const { pageRecs, subRecs, clean, verify } = fin;
  const drillK = DRILL_EDIT;

  // ─── measurement validity ───
  // Window: from the population start (the first SDK client's first
  // request) to the end of the edit window. Clean-up, worker shutdown
  // and this report run after it and cannot move a measured timestamp.
  const vFrom = state.popStart ?? state.runStart;
  const vTo = state.editsEnd;
  const mainSummary = mainLag.recorder.summary();
  const lagThreads = [{ thread: "main", summary: mainSummary }, ...workerMeta.map((m) => ({ thread: `worker ${m.worker}`, summary: m.lag }))];
  const valid = validity({ lags: lagThreads, heartbeats, from: vFrom, to: vTo, workerStarted });
  // ─── host telemetry per phase ───
  // join = population start → all joined (+ guest), settle = the quiet
  // time before the first edit, edits = first edit → last edit settled,
  // drill = the drilled edit's window (its first drill action or save →
  // its timeout, clipped to the edit window; the spam's send window).
  const phases = [
    { name: "join", from: state.popStart, to: state.settleStart },
    { name: "settle", from: state.settleStart, to: state.editsStart },
    { name: "edits", from: state.editsStart, to: state.editsEnd },
  ];
  if (DRILL) {
    let from = null;
    let to = null;
    if (DRILL === "spam" && guest?.sends.length) {
      from = guest.sends[0][0];
      to = guest.sends[guest.sends.length - 1][0] + 3000;
    } else if (DRILL === "ws-blocked" || OVERLAP) {
      from = state.editsStart;
      to = state.editsEnd;
    } else {
      const de = edits.find((e) => e.k === DRILL_EDIT);
      const ts = drillEvents.map((d) => d.atMs ?? Date.parse(d.at)).filter(Number.isFinite);
      if (de) ts.push(de.ins?.startedAt ?? de.put.startedAt);
      if (ts.length) {
        from = Math.min(...ts);
        to = Math.min(state.editsEnd, Math.max(...ts, de ? de.put.startedAt + TIMEOUT_MS : 0));
      }
    }
    if (from != null) phases.push({ name: `drill ${DRILL}`, from, to });
  }
  const hostPhases = summarizeHost(hostMon.samples, phases.filter((p) => p.from != null && p.to != null));

  const threadRows = lagThreads.map(({ thread, summary }) => {
    const w = thread === "main" ? null : Number(thread.split(" ")[1]);
    const meta = w == null ? null : workerMeta.find((m) => m.worker === w);
    const hbs = w == null ? [] : heartbeats[w] || [];
    let hbGapMax = null;
    for (let i = 1; i < hbs.length; i++) hbGapMax = Math.max(hbGapMax ?? 0, hbs[i][1] - hbs[i - 1][1]);
    const late = dist((meta?.deadlineLate || []).map((x) => x[1]));
    return {
      thread, window: lagOver(summary, vFrom, vTo), whole: summary ? { max: summary.max, maxAt: summary.maxAt, n: summary.n } : null,
      over1s: (summary?.spikes || []).filter(([t, l]) => t >= vFrom && t <= vTo && l > LAG_INVALID_MS).length,
      heartbeats: hbs.length, hbGapMax, deadlines: late, resultTimedOut: meta?.timedOut ?? false,
    };
  });

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
    (DRILL === "reconnect" && (e.k === drillK || (e.k > drillK && notRejoinedAt(r.joinAt, e.put.startedAt)))) ||
    // overlap: the ack-hold page held one response back on purpose in its
    // group; its delay there is the test, not a delivery result.
    (OVERLAP && OV.pageReaction && e.k === OV_REACTION_GROUP && r.idx === state.overlap?.reactionPage);
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
  const retried = rows.filter(({ e }) => e.put.attempts > 1 || e.ins?.attempts > 1 || e.ins?.adopted);
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
    // On the anchor row a LATER standalone save may replace the final
    // marker before the window ends; showing that later marker counts as
    // having converged past the double save.
    const pagesOk = pageMono.filter((m) => (m.present.has(fin) || replacedPresent(idx, fin, m.present)) && !(sup && m.present.has(sup))).length;
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
  // overlap: `edits` holds one entry per committed SAVE, so "skipped" =
  // groups with at least one save that did not commit.
  const skippedEdits = OVERLAP ? (state.overlap?.groups ?? []).filter((g) => !g.anchor.allOk).length : EDITS - edits.length;
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

  // ─── overlap: per-group gates, client side (design §2.6) ───
  // Clock of every gate: the group's LAST original request start (the
  // operator's last click); target: the group's HEAD (highest committed
  // rev — the commit order is the Event row lock's, not the start
  // order's). Pages converge when the DOM shows every committed save's
  // marker of the group (distinct anchor rows → all visible at the end;
  // intermediate revs may be skipped by batch merging and need not be
  // rendered); SDK clients when they applied a snapshot with rev ≥ head.
  // From the FIRST save's start: informational. The server-side gates
  // (acquireMs, pool timeouts, EMAXCONN, builds per save, Σ, exposure)
  // need the history logs: ../overlap-join.mjs.
  let overlap = null;
  if (OVERLAP && state.overlap) {
    const O = state.overlap;
    const groups = O.groups.map((g) => {
      const a = g.anchor;
      const markers = g.saves.filter(isOkSave).map((x) => String(x.song.id));
      const conv = { pages: [], pagesFirst: [], pagesMissing: 0, drilledPages: [], subs: [], subsFirst: [], subsMissing: 0 };
      if (a.head != null) {
        const opt = { from: a.lastStart, firstStart: a.firstStart, deadline: a.lastStart + TIMEOUT_MS };
        for (const r of pageRecs) {
          const c = pageGroupConvergence(r.seen, markers, opt);
          if (OV.pageReaction && g.k === OV_REACTION_GROUP && r.idx === O.reactionPage) { conv.drilledPages.push(c.ok ? c.lat : null); continue; }
          if (c.ok) { conv.pages.push(c.lat); conv.pagesFirst.push(c.latFirst); } else conv.pagesMissing++;
        }
        for (const r of subRecs) {
          const c = sdkGroupConvergence(r.applied, a.head, opt);
          if (c.ok) { conv.subs.push(c.lat); conv.subsFirst.push(c.latFirst); } else conv.subsMissing++;
        }
      } else {
        conv.pagesMissing = pageRecs.length;
        conv.subsMissing = subRecs.length;
      }
      return { g, a, markers, conv };
    });
    const flat = (f) => groups.flatMap((x) => f(x));
    const pagesConv = summarize(flat((x) => x.conv.pages), groups.reduce((s, x) => s + x.conv.pagesMissing, 0));
    const subsConv = summarize(flat((x) => x.conv.subs), groups.reduce((s, x) => s + x.conv.subsMissing, 0));
    const fromFirst = dist(flat((x) => [...x.conv.pagesFirst, ...x.conv.subsFirst]));
    const rc = subRecs.map((r) => ({ r, ...subMonotonicityRC(r.appliedAll) }));
    const rcN = rc.reduce((s, m) => s + m.regressions.length, 0);
    const allSaves = O.groups.flatMap((g) => g.saves);
    const roles = roleLatency(allSaves);
    const reloads = O.groups.flatMap((g) => g.reloads);
    const reloadV = reloadVerdict([...reloads, ...O.controls]);
    const rxAll = O.groups.flatMap((g) => g.reactions);
    const rxV = reactionVerdict(rxAll);
    const ahGroup = O.groups.find((g) => g.k === OV_REACTION_GROUP);
    const ahV = OV.pageReaction
      ? ackHoldVerdict(ahGroup ? ahGroup.pageReaction ?? { error: "trace missing" } : { error: `needs ≥ ${OV_REACTION_GROUP} groups (anchor row A has no song before group 1's save lands)` })
      : null;
    // 5xx anywhere the run looked: admin saves, editor reloads, catalog
    // edits, raw reactions, the page's reaction, probes, every SDK and
    // page snapshot response. (EMAXCONN lives in the server logs only.)
    const is5 = (st) => st >= 500;
    const probesAll = [...O.groups.flatMap((g) => g.probes || []), ...O.tail];
    const fivexx = {
      saves: allSaves.filter((x) => is5(x.status)).length,
      reloads: [...reloads, ...O.controls].filter((x) => is5(x.status)).length,
      catalog: O.groups.filter((g) => g.catalog && is5(g.catalog.status)).length,
      reactions: rxAll.filter((x) => is5(x.status)).length + (ahGroup?.pageReaction?.ack && is5(ahGroup.pageReaction.ack.status) ? 1 : 0),
      probes: probesAll.filter((x) => is5(x.row[3])).length,
      sdk: subRecs.reduce((s, r) => s + (r.reqs || []).filter((q) => is5(q[6])).length, 0),
      pages: pageRecs.reduce((s, r) => s + r.fetches.filter((f) => is5(f[2])).length, 0),
    };
    const fivexxTotal = Object.values(fivexx).reduce((s, v) => s + v, 0);
    const passOf = (d, gate) => (d.n === 0 && d.missing === 0 ? null : d.missing === 0 && d.p95 != null && d.p95 <= gate);
    const gates = [
      { name: "all intended saves committed (2xx)", value: `${groups.filter((x) => x.a.allOk).length}/${groups.length} groups`, gate: "every group", pass: groups.length ? groups.every((x) => x.a.allOk) : false },
      { name: "5xx anywhere (saves, reloads, catalog, reactions, probes, SDK, pages)", value: `${fivexxTotal} (${Object.entries(fivexx).filter(([, v]) => v).map(([k2, v]) => `${k2} ${v}`).join(", ") || "none"})`, gate: "0", pass: fivexxTotal === 0 },
      { name: "convergence to head from the last save start — pages", value: `${dline(pagesConv)}, missing ${pagesConv.missing}`, gate: `p95 ≤ ${GATE_P95_MS}, 0 missing`, pass: passOf(pagesConv, GATE_P95_MS) },
      { name: "convergence to head from the last save start — SDK", value: `${dline(subsConv)}, missing ${subsConv.missing}`, gate: `p95 ≤ ${GATE_P95_MS}, 0 missing`, pass: SUBS === 0 ? null : passOf(subsConv, GATE_P95_MS) },
      { name: "DOM monotonicity (pages: marker-derived version never goes back)", value: `${monoPagesN} regressions`, gate: "0", pass: pageRecs.length ? monoPagesN === 0 : null },
      { name: "(rev, capturedAt) monotonicity (SDK applied)", value: `${rcN} regressions on ${rc.filter((m) => m.regressions.length).length} client(s)`, gate: "0", pass: subRecs.length ? rcN === 0 : null },
      ...Object.entries(roles).map(([who, r]) => ({ name: `PUT latency, original attempt — save ${who}`, value: `p95 ${ms(r.p95)}, all [${r.values.join(", ")}]${r.failed ? `, ${r.failed} failed` : ""}`, gate: "p95 ≤ 1500", pass: r.pass })),
      ...(OV.reloadAt.length ? [{ name: "admin editor reloads in the save window", value: `n ${reloadV.window.n}, p50 / max ${ms(reloadV.window.p50)} / ${ms(reloadV.window.max)}, bad ${reloadV.window.bad}`, gate: "200 + content ok + ≤ 3000 ms each", pass: reloadV.pass }] : []),
      ...(OV.reactions ? [{ name: "raw reactions", value: `n ${rxV.n}, p95 ${ms(rxV.p95)}, max ${ms(rxV.max)}, non-2xx ${rxV.non2xx}`, gate: "p95 ≤ 1500, 0 × 5xx", pass: rxV.pass }] : []),
      ...(ahV ? [{ name: "page reaction ack hold", value: ahV.exercised ? `held ${ahV.heldCount} < ack ${ahV.ackCount}; drops ${ahV.drops}; release ${ahV.released ? `count ${ahV.releaseCount}, shown ${ahV.finalShown}` : "none"}` : `NOT EXERCISED — ${ahV.reason}`, gate: "never below the ack until capturedAt > ackAt; then = that snapshot", pass: ahV.pass }] : []),
    ];
    const pass = gates.every((x) => x.pass !== false);
    overlap = { groups, pagesConv, subsConv, fromFirst, rc, rcN, roles, reloadV, rxV, ahV, fivexx, fivexxTotal, gates, pass, probesAll };
  }

  // Under overlap the per-save rows (each save from its OWN start) stay in
  // the report as information; the group gates (clock = the group's last
  // save start, target = its head) decide.
  if (OVERLAP) {
    verdicts.primary.gate = `informational under --drill=overlap (per save, from each save's own start); the group gates decide`;
    verdicts.primary.pass = null;
    verdicts.pages.pass = null;
    verdicts.subs.pass = null;
  }

  // ─── SUSPECT: page-side browser stall (every run; overlap.mjs
  // pageStallSuspect) ───
  // Banner + JSON only: the verdicts and the exit code are unchanged, and
  // it is never an automatic INVALID — it is decided afterwards from the
  // host telemetry and independent evidence (the SDK clients on the same
  // save, the observer).
  const suspectSaves = rows
    .map(({ e, s }) => ({ k: e.k, who: e.who ?? null, rev: e.put.rev, ...pageStallSuspect(s.pages.hint.first, pageRecs.length) }))
    .filter((x) => x.suspect);

  // ─── hint accounting ───
  // SDK: from each client's own request log (the scheduler's descriptor
  // + what came back). Pages: from the URLs and headers they sent / got
  // (an R2 page's notification fetch carries `hint=1`; an R1 build never
  // does).
  const bumpK = (o, k) => { o[k] = (o[k] || 0) + 1; };
  const resolved = (res) => res === "satisfied" || res === "disproved" || res === "superseded";
  const hintTotals = { reqs: 0, notif: 0, notifWarm: 0, notifSources: {}, notifVerify: {}, verify: {}, res: {}, rechecks: 0, recheckOk: 0, exhausted: 0, byShape: {}, failKinds: {}, serverRevMax: null };
  for (const r of subRecs) {
    for (const q of r.reqs || []) {
      hintTotals.reqs++;
      // e.g. "notification +hint=1", "periodic generic +H", "recheck +H"
      bumpK(hintTotals.byShape, `${q[1]}${q[2] ? " generic" : ""}${q[3] != null ? (q[4] ? " +hint=1" : " +H") : ""}`);
      if (q[7]) bumpK(hintTotals.verify, q[7]);
      if (q[4]) {
        hintTotals.notif++;
        if (q[12] === "warm") hintTotals.notifWarm++;
        bumpK(hintTotals.notifSources, q[12] ?? "no 200");
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
  const pageHint = { fetches: 0, notif: 0, notifWarm: 0, notifSources: {}, notifVerify: {}, verify: {} };
  for (const r of pageRecs) {
    for (const f of r.fetches) {
      pageHint.fetches++;
      if (f[2] === 200) bumpK(pageHint.verify, verifyKindOf(f[5]));
      if (f[6]) {
        pageHint.notif++;
        if (f[3] === "warm") pageHint.notifWarm++;
        bumpK(pageHint.notifSources, f[2] === 200 ? f[3] ?? "none" : `HTTP ${f[2]}`);
        if (f[2] === 200) bumpK(pageHint.notifVerify, verifyKindOf(f[5]));
      }
    }
  }
  const warmTxt = (w, n) => `${w}/${n}${n ? ` (${((w / n) * 100).toFixed(1)} %)` : ""}`;

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
      // The cooldown binds EVERY request that carries a hint ticket —
      // notification fetches, rechecks, and also a retry or a generic
      // maintenance request the ticket rides along on (the scheduler
      // holds any ticket-carrying dispatch to the ticket cooldown edge).
      // Filtering by reason would let a regression on the retry/generic
      // path pass the gate.
      const bound = inWin.filter((q) => q[3] != null).map((q) => q[0]).sort((a, b) => a - b);
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
  } else if (OVERLAP && overlap) {
    verdicts.drill = {
      drill: DRILL, gate: "every overlap group gate (see \"Overlap drill\"): saves committed, 0 × 5xx, pages and SDK p95 ≤ gate from the last save start with 0 missing, 0 regressions, PUT p95 ≤ 1.5 s per role, reloads / reactions / ack hold when enabled",
      ...summarize(overlap.groups.flatMap((x) => [...x.conv.pages, ...x.conv.subs]), overlap.pagesConv.missing + overlap.subsConv.missing),
      pass: overlap.pass,
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
  // An invalid measurement still prints every gate (the numbers are
  // useful for diagnosis), but no verdict may read as a result.
  const v = (x) => `${x == null ? "n/a" : x ? "**PASS**" : "**FAIL**"}${valid.invalid ? " (measurement invalid)" : ""}`;
  const lines = [];
  lines.push(`# Browsers run — ${new Date(state.runStart).toISOString()}`);
  lines.push("");
  if (valid.invalid) {
    lines.push("> **VERDICT: INVALID — the load host stalled; this run measured the laptop, not the system.**");
    for (const r of valid.reasons.slice(0, 8)) lines.push(`> - ${r.thread}: ${r.what} at ${iso(r.at)}`);
    if (valid.reasons.length > 8) lines.push(`> - … ${valid.reasons.length - 8} more (JSON \`validity.reasons\`)`);
    lines.push(`> Thresholds: a lag sample > ${LAG_INVALID_MS} ms on any thread, or a worker without a heartbeat for > ${SILENT_INVALID_MS} ms, between ${iso(vFrom)} and ${iso(vTo)}. Re-run with nothing else on the host (see README "Host isolation").`);
    lines.push("");
  }
  if (suspectSaves.length) {
    lines.push("> **SUSPECT: page-side browser stall** — on these saves ≥ 80 % of the pages got their hinted fetch from `warm` / `cache`, yet every one of them took > 1 s (a warm or cache answer costs the server tens of ms; all pages waiting in lock-step points at the one Chromium process, which the Node-thread validity monitors do not watch):");
    for (const x of suspectSaves) lines.push(`> - save ${x.k}${x.who ?? ""} (rev ${x.rev}): ${x.hits}/${x.pages} pages hit, fastest ${x.minMs} ms, p50 ${x.p50} ms`);
    lines.push("> Verdicts and exit code are unchanged (not INVALID): decide with the host telemetry below and independent evidence (the SDK clients on the same save, the observer).");
    lines.push("");
  }
  lines.push(`- Target: ${BASE}${EVENT_PATH} (event ${EVENT_ID}, start rev ${state.startRev}, ${original.length} active rows; insert after row ${AFTER_ROW} = position ${state.afterPosition})`);
  lines.push(`- Population: ${PAGES} Chromium pages (ja/ko/en 70/20/10), ${SUBS} SDK subscribers in ${SUB_WORKERS} worker thread(s)`);
  const modeTxt = { pair: "(insert-after + PUT marker song) — edit mode pair", standalone: "(ONE PUT swapping the marker song on the anchor row) — edit mode standalone", mixed: "pair on odd edits, standalone on even — edit mode mixed" }[EDIT_MODE];
  if (OVERLAP) lines.push(`- Edits: ${EDITS} overlap group(s) × ${rolesOf(OV).length} concurrent PUTs (${rolesOf(OV).join(", ")}) on anchor rows ${rolesOf(OV).map((w) => ovAnchors[w]?.id).join(", ")}, every ${PAUSE_MS / 1000} s; timeout ${TIMEOUT_MS / 1000} s; drill: overlap (see "Overlap drill")`);
  else lines.push(`- Edits: ${EDITS} × ${modeTxt}${anchor ? ` (anchor row ${anchor.id})` : ""}, every ${PAUSE_MS / 1000} s; timeout ${TIMEOUT_MS / 1000} s; drill: ${DRILL ?? "none"}${DRILL ? ` (edit ${DRILL === "ws-blocked" ? "all" : drillK}, pages ${DRILL === "reconnect" ? "all + all SDK" : `${Math.min(DRILL_PAGES, PAGES)}`})` : ""}`);
  lines.push(`- Window (UTC): run start ${iso(state.runStart)}, first edit ${iso(state.editsStart)}, last edit settled ${iso(state.editsEnd)}, end ${iso(Date.now())}`);
  lines.push(`- Label: ${args.label ?? "—"}`);
  if (hostCheck) lines.push(`- Host guard at start: CPU ${hostCheck.busyPct ?? "—"} % busy (${hostCheck.how}); ${hostCheck.processListOk ? `${hostCheck.competing.length} competing process(es)` : "process list unavailable"}${hostCheck.problems.length ? ` — **${hostCheck.problems.join("; ").replace(/\|/g, "/")}**` : ""}${STRICT_HOST ? " (--strict-host)" : ""}`);
  lines.push("");
  lines.push(valid.invalid ? "## Gate verdicts — measurement invalid (see the banner)" : "## Gate verdicts");
  lines.push("");
  lines.push("Latency = save (the PUT that makes the marker exist; in a pair edit the insert-after came before it) request start of its FIRST attempt → marker link in the page DOM / SDK client applied a snapshot with rev ≥ the PUT's rev. Missing = not seen within the timeout. Monotonic: no page/client ever went back to an older version.");
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
  } else if (overlap) {
    lines.push(`| drill overlap: groups, pages + SDK, last save start → head | ${dline(verdicts.drill)} | ${verdicts.drill.missing} | every group gate in "Overlap drill" | ${v(verdicts.drill.pass)} |`);
  } else if (verdicts.drill) {
    lines.push(`| drill ${DRILL} (drilled pairs) | ${dline(drilled)} | ${drilled.missing} | ${verdicts.drill.gate} | ${v(verdicts.drill.pass)} |`);
  }
  lines.push(`| monotonic DOM (pages: version shown never decreases) | ${P} pages, ${pageVersions} versions | — | — | — | ${monoPagesN} regressions on ${monoPagesBad.length} page(s) | 0 | ${v(P ? monoPagesN === 0 : null)} |`);
  lines.push(`| monotonic applied rev (SDK) | ${M} clients, ${subApplies} applies | — | — | — | ${monoSubsN} regressions on ${monoSubsBad.length} client(s) | 0 | ${v(M ? monoSubsN === 0 : null)} |`);
  if (DRILL === "reconnect") lines.push(`| reconnect handoff: regressions after the drop (pages / SDK) | — | — | — | — | ${afterDrop(pageMono)} / ${afterDrop(subMono)} | 0 | ${v(afterDrop(pageMono) + afterDrop(subMono) === 0)} |`);
  // Writer warming, informational: it changes where a notification
  // fetch's answer comes from, not what a client must see. Reader
  // builds per save live only in the Vercel logs (vercel-logs-summary.mjs
  // "Warming" on the history re-fetch).
  lines.push(`| warming: warm hits ÷ hinted fetches (\`x-snapshot-source: warm\`) | SDK ${warmTxt(hintTotals.notifWarm, hintTotals.notif)}, pages ${warmTxt(pageHint.notifWarm, pageHint.notif)} | — | — | — | — | informational; reader builds per save: \`vercel-logs-summary.mjs\` "Warming" on the history logs; arrival vs warm-complete: \`warm-join.mjs\` | n/a |`);
  lines.push(`| edits with a retried save (clock from the 1st attempt) | ${dline(retriedFirst)} | ${retriedFirst.missing} | informational — ${retried.length} edit(s); from the successful attempt p50/p95/max ${ms(retriedOk.p50)}/${ms(retriedOk.p95)}/${ms(retriedOk.max)} | n/a |`);
  lines.push("");
  lines.push(`Insert-start based (insert-after request start → marker; pair edits only), non-drilled: pages ${dline(dist(all.pagesIns))} · SDK ${dline(dist(all.subsIns))} (n | p50 | p95 | max).`);
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
  lines.push("| # | mode | row | marker song | insert start (UTC) | ins ms | rev | save (PUT) start (UTC) | save ms | save rev |");
  lines.push("|---|---|---|---|---|---|---|---|---|---|");
  const tries = (x) => (x.attempts > 1 ? ` (${x.attempts} attempts)` : "");
  const markOf = (e) => {
    const nDrilled = pageRecs.filter((r) => isDrilledPage(r, e)).length + subRecs.filter((r) => isDrilledSub(r, e)).length;
    return `${e.k}${e.who ?? ""}${nDrilled ? ` (drill: ${nDrilled})` : ""}${e.double ? " (double save)" : ""}`;
  };
  for (const { e } of rows) {
    lines.push(`| ${markOf(e)} | ${e.mode} | ${e.id} | ${e.song.id} ${e.song.title.replace(/\|/g, "/")} | ${e.ins ? iso(e.ins.startedAt) : "—"} | ${e.ins ? `${ms(e.ins.ms)}${e.ins.adopted ? " (adopted)" : ""}${tries(e.ins)}` : "—"} | ${ms(e.ins?.rev)} | ${iso(e.put.startedAt)} | ${e.put.ms}${tries(e.put)} | ${e.put.rev} |`);
  }
  // Two tables, one per population: the gate is judged over both, but a
  // page (real React render, R1 or R2 build) and an SDK client (the R2
  // client logic without a DOM) fail differently, so they are read apart.
  const kinds = (o) => Object.entries(o).map(([k, n]) => `${k} ${n}`).join(", ") || "—";
  lines.push("");
  lines.push("### Per save — pages (save start → marker in the DOM)");
  lines.push("");
  lines.push("| # | save rev | seen | p50 / p95 / max ms | missing | bcast → page p50 / p95 (n) | pg → page (n) | notification fetches (hint=1) | their x-snapshot-verify | warm / hinted | 1st hinted request start − commit p50 / p95 |");
  lines.push("|---|---|---|---|---|---|---|---|---|---|---|");
  for (const { e, s } of rows) {
    const pl = dist([...s.pages.lat, ...s.pages.drilledLat]);
    const bp = dist(s.pages.bcastPut);
    const pf = dist(s.pages.hint.first.map((x) => x[2]));
    lines.push(`| ${markOf(e)} | ${e.put.rev} | ${pl.n}/${P} | ${ms(pl.p50)} / ${ms(pl.p95)} / ${ms(pl.max)} | ${s.pages.missing + s.pages.drilledMissing} | ${ms(bp.p50)} / ${ms(bp.p95)} (${bp.n}) | ${s.pages.notifPut.length} | ${s.pages.hint.notif} | ${kinds(s.pages.hint.verify)} | ${s.pages.hint.warm}/${s.pages.hint.notif} | ${ms(pf.p50)} / ${ms(pf.p95)} |`);
  }
  lines.push("");
  lines.push("### Per save — SDK clients (save start → applied rev ≥ save rev)");
  lines.push("");
  lines.push("| # | save rev | reached | p50 / p95 / max ms | missing | bcast → SDK p50 / p95 (n) | notification fetches | their x-snapshot-verify | ticket resolutions | rechecks (resolved) | exhausted | warm / hinted | 1st hinted send − commit p50 / p95 |");
  lines.push("|---|---|---|---|---|---|---|---|---|---|---|---|---|");
  for (const { e, s } of rows) {
    const sl = dist([...s.subs.lat, ...s.subs.drilledLat]);
    const bp = dist(s.subs.bcastPut);
    const h = s.subs.hint;
    const sf = dist(h.first.map((x) => x[2]));
    lines.push(`| ${markOf(e)} | ${e.put.rev} | ${sl.n}/${M} | ${ms(sl.p50)} / ${ms(sl.p95)} / ${ms(sl.max)} | ${s.subs.missing + s.subs.drilledMissing} | ${ms(bp.p50)} / ${ms(bp.p95)} (${bp.n}) | ${h.notif} | ${kinds(h.verify)} | ${kinds(h.res)} | ${h.rechecks} (${h.recheckOk}) | ${h.exhausted} | ${h.warm}/${h.notif} | ${ms(sf.p50)} / ${ms(sf.p95)} |`);
  }
  lines.push("");
  lines.push("## Hint outcomes (whole run)");
  lines.push("");
  lines.push(`- SDK: ${hintTotals.reqs} requests; notification fetches (hint=1) ${hintTotals.notif}, their x-snapshot-verify: ${kinds(hintTotals.notifVerify)}; all 200 responses: ${kinds(hintTotals.verify)}`);
  lines.push(`  - ticket resolutions: ${kinds(hintTotals.res)}; rechecks ${hintTotals.rechecks} (${hintTotals.notif ? ((hintTotals.rechecks / hintTotals.notif) * 100).toFixed(1) : "—"} % of notification fetches), resolved on the recheck ${hintTotals.recheckOk}; hints exhausted ${hintTotals.exhausted}; highest serverRev held ${hintTotals.serverRevMax ?? "—"}`);
  lines.push(`  - request shapes (reason / generic / ticket): ${kinds(hintTotals.byShape)}; failures by kind: ${kinds(hintTotals.failKinds)}`);
  lines.push(`  - notification fetches by x-snapshot-source: ${kinds(hintTotals.notifSources)} (warm ${warmTxt(hintTotals.notifWarm, hintTotals.notif)})`);
  lines.push(`- Pages: ${pageHint.fetches} /api/setlist responses; notification fetches (hint=1) ${pageHint.notif}, their x-snapshot-verify: ${kinds(pageHint.notifVerify)}; all 200 responses: ${kinds(pageHint.verify)} (an R1 page build sends no hint=1)`);
  lines.push(`  - notification fetches by x-snapshot-source: ${kinds(pageHint.notifSources)} (warm ${warmTxt(pageHint.notifWarm, pageHint.notif)})`);
  lines.push("");
  lines.push("## Measurement validity (load host)");
  lines.push("");
  lines.push(`Event-loop lag = how late a 100 ms interval tick ran, per thread, inside the measurement window ${iso(vFrom)} → ${iso(vTo)} (p50 = median of the 10 s buckets' p50, p95 / p99 / max = the worst bucket). Heartbeats: one per second per worker, from its own loop. Deadline timers: fired − armed − 8,000 ms for every SDK request that hit the 8 s deadline. INVALID if any lag sample > ${LAG_INVALID_MS} ms or any heartbeat gap > ${SILENT_INVALID_MS} ms.`);
  lines.push("");
  lines.push("| thread | lag p50 / p95 / p99 / max ms | samples > 1 s | heartbeats (max gap ms) | deadline timers fired: n, late p50 / p95 / max ms |");
  lines.push("|---|---|---|---|---|");
  for (const t of threadRows) {
    const w = t.window;
    lines.push(`| ${t.thread}${t.resultTimedOut ? " (no result: stop timed out)" : ""} | ${ms(w.p50)} / ${ms(w.p95)} / ${ms(w.p99)} / ${ms(w.max)} | ${t.over1s} | ${t.thread === "main" ? "—" : `${t.heartbeats} (${ms(t.hbGapMax)})`} | ${t.thread === "main" ? "—" : `${t.deadlines.n}, ${ms(t.deadlines.p50)} / ${ms(t.deadlines.p95)} / ${ms(t.deadlines.max)}`} |`);
  }
  lines.push("");
  lines.push(`Verdict: ${valid.invalid ? `**INVALID** (${valid.reasons.length} reason(s))` : "valid"}.`);
  lines.push("");
  lines.push(`Host (1 s samples; ${hostMon.ncpu} logical cores, ${hostMon.totalMemMB} MB): host CPU = busy share of all cores; process CPU = this process (main + SDK workers) as a share of all cores; Chromium is in the host figure only. load1 is always 0 on Windows.`);
  lines.push("");
  lines.push("| phase | s | host CPU p50 / max % | process CPU p50 / max % | RSS max MB | free mem min MB | load1 max | threads |");
  lines.push("|---|---|---|---|---|---|---|---|");
  for (const p of hostPhases) lines.push(`| ${p.name} | ${((p.to - p.from) / 1000).toFixed(1)} | ${ms(p.hostCpuP50)} / ${ms(p.hostCpuMax)} | ${ms(p.procCpuP50)} / ${ms(p.procCpuMax)} | ${ms(p.rssMaxMB)} | ${ms(p.freeMemMinMB)} | ${ms(p.load1Max)} | ${p.threadsMax} |`);
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
  if (overlap) {
    const O = state.overlap;
    lines.push("");
    lines.push("## Overlap drill");
    lines.push("");
    lines.push(`- ${EDITS} group(s), each: save A at 0${OV.faultA ? ` (header \`x-live-warm-fault: ${OV.faultA}\`)` : ""}, B at +${OV.gapMs} ms${OV.thirdAtMs ? `, C at +${OV.thirdAtMs} ms` : ""} after A's START (not awaited); anchors ${rolesOf(OV).map((w) => `${w} = row ${ovAnchors[w]?.id}`).join(", ")}${OV.reloadAt.length ? `; editor reloads at +${OV.reloadAt.join(", +")} ms` : ""}${OV.catalogAtMs ? `; catalog edit (dedicated song of A) at +${OV.catalogAtMs} ms` : ""}${OV.reactions ? `; ${OV.reactions} raw reactions on row A over [0, 3 s]` : ""}${OV.pageReaction ? `; page reaction ack hold on page ${O.reactionPage ?? "—"} in group ${OV_REACTION_GROUP}` : ""}${OV.quietTailS ? `; quiet tail ${OV.quietTailS} s` : ""}`);
    lines.push("- Clocks: every time here is this machine's clock. The exposure classification (did B commit during A's job, did the builds overlap, was publication reversed, did the catalog race happen) needs the server's own timestamps and is NOT in this report: run `node tests/load/overlap-join.mjs <this>.json <history log>` (server `at*` fields are the functions' `Date.now()`; `captureAt` / `capturedAt` are PostgreSQL `now()` — a third clock).");
    lines.push("- Page gate = DOM monotonicity (versions derived from marker links never go backwards), not (rev, capturedAt): a page exposes no applied rev. SDK gate = (rev, capturedAt) of every applied snapshot.");
    lines.push("");
    lines.push("| gate (overlap, client side) | value | gate | verdict |");
    lines.push("|---|---|---|---|");
    for (const x of overlap.gates) lines.push(`| ${x.name} | ${String(x.value).replace(/\|/g, "/")} | ${x.gate} | ${v(x.pass)} |`);
    lines.push(`| server side: acquireMs ≤ 500 per save, no pool_acquire_timeout / 503, 0 EMAXCONN, builds per save vs S0, Σ, backend busy | — | \`overlap-join.mjs\` + summariser on the history logs | n/a here |`);
    lines.push("");
    lines.push(`From the FIRST save's start (informational): pages + SDK ${dline(overlap.fromFirst)} (n | p50 | p95 | max).`);
    lines.push("");
    lines.push("### Per group");
    lines.push("");
    lines.push("| group | saves (who: status rev ms) | head (who) | last start (UTC) | pages from last start p50 / p95 / max (n) | missing | SDK from last start p50 / p95 / max (n) | missing | reloads (status / ms / content) | catalog edit | raw reactions ok / n, p95 |");
    lines.push("|---|---|---|---|---|---|---|---|---|---|---|");
    for (const { g, a, conv } of overlap.groups) {
      const pd = dist(conv.pages);
      const sd = dist(conv.subs);
      const rx = g.reactions;
      const rxd = dist(rx.map((r) => r.ms));
      lines.push(`| ${g.k} | ${g.saves.map((x) => `${x.who}: ${x.status} ${x.rev ?? "—"} ${x.ms}`).join("; ")} | ${a.head ?? "—"} (${a.headWho ?? "—"}) | ${iso(a.lastStart)} | ${ms(pd.p50)} / ${ms(pd.p95)} / ${ms(pd.max)} (${pd.n})${conv.drilledPages.length ? ` + ack-hold page ${conv.drilledPages.map(ms).join(",")}` : ""} | ${conv.pagesMissing} | ${ms(sd.p50)} / ${ms(sd.p95)} / ${ms(sd.max)} (${sd.n}) | ${conv.subsMissing} | ${g.reloads.map((r) => `+${r.off}: ${r.status} / ${r.ms} / ${r.contentOk ? "ok" : "**FAIL**"}`).join("; ") || "—"} | ${g.catalog ? `${g.catalog.status} at ${iso(g.catalog.startedAt)}, ack ${g.catalog.ms} ms` : "—"} | ${rx.length ? `${rx.filter((r) => r.status >= 200 && r.status < 300).length} / ${rx.length}, ${ms(rxd.p95)}` : "—"} |`);
    }
    if (OV.reloadAt.length) {
      const rv = overlap.reloadV;
      lines.push("");
      lines.push(`Editor reloads (\`GET /admin/events/${EVENT_ID}/edit\`, request start → body drained): in window n ${rv.window.n} p50 ${ms(rv.window.p50)} max ${ms(rv.window.max)} ms; controls (before / pauses / after) n ${rv.control.n} p50 ${ms(rv.control.p50)} max ${ms(rv.control.max)} ms${rv.control.bad ? `, ${rv.control.bad} failed the content check` : ""}; in-window ÷ control median: p50 ${rv.ratioMedian == null ? "—" : rv.ratioMedian.toFixed(2)}, max ${rv.ratioMax == null ? "—" : rv.ratioMax.toFixed(2)} (diagnostic, not a gate).`);
    }
    if (overlap.ahV) {
      const a = overlap.ahV;
      const tr = O.groups.find((g) => g.k === OV_REACTION_GROUP)?.pageReaction;
      lines.push("");
      lines.push(`Page reaction ack hold (page ${O.reactionPage ?? "—"}, group ${OV_REACTION_GROUP}, type ${REACTION_TYPES[OV_PAGE_RX_TYPE_INDEX]}): ${a.exercised ? `exercised — held snapshot rev ${tr?.held?.rev ?? "—"} count ${a.heldCount} (captured ${tr?.held?.capturedAtMs != null ? iso(tr.held.capturedAtMs) : "—"} ≤ ackAt ${tr?.ack?.ackAt ?? "—"}), acknowledged count ${a.ackCount}; display drops below the ack before the release: ${a.drops}; released ${a.released ? `by a response at ${iso(a.releaseAt)} with count ${a.releaseCount}, shown 1 s later ${a.finalShown}` : "never in the window"} → ${a.reason}` : `**not exercised** — ${a.reason}`}.`);
    }
    // Probes: per group and key (committed rev), per locale, the sources
    // at +1 / +2 / +4 s (body rev when ≠ the key).
    const groupsWithProbes = O.groups.filter((g) => (g.probes || []).length);
    if (groupsWithProbes.length) {
      lines.push("");
      lines.push("### Probes (hinted fetches per committed key; never part of a gate)");
      lines.push("");
      lines.push("Per key (the ACTUAL rev a save returned) and locale: `x-snapshot-source` at +1 / +2 / +4 s after the last save's response; `→N` = body rev N ≠ key. First `warm` = observed readability of that key's entry (an upper bound: the probe clock is this machine's).");
      lines.push("");
      lines.push("| group | key (who) | ja | ko | en |");
      lines.push("|---|---|---|---|---|");
      for (const g of groupsWithProbes) {
        for (const c of g.anchor.committed) {
          const cell = (loc) => [1000, 2000, 4000].map((off) => {
            const p = g.probes.find((x) => x.off === off && x.row[1] === loc && x.row[2] === c.rev);
            if (!p) return "—";
            const [, , key, st, src, br] = p.row;
            return `${st === 200 ? src ?? "none" : `HTTP ${st}`}${br != null && br !== key ? `→${br}` : ""}`;
          }).join(" / ");
          lines.push(`| ${g.k} | ${c.rev} (${c.who}${c.rev === g.anchor.head ? ", head" : ""}) | ${cell("ja")} | ${cell("ko")} | ${cell("en")} |`);
        }
      }
    }
    if (O.tail.length) {
      const warmN = O.tail.filter((x) => x.row[4] === "warm").length;
      // The last probe round = every probe sent within 1 s of the last one
      // (a round's probes leave together); still warm there = censored.
      const lastT = Math.max(...O.tail.map((x) => x.row[0]));
      const lastWarm = O.tail.filter((x) => x.row[4] === "warm").map((x) => x.row[0]).sort((a, b) => a - b).pop() ?? null;
      const censored = O.tail.some((x) => x.row[0] >= lastT - 1000 && x.row[4] === "warm");
      lines.push("");
      lines.push(`Quiet tail (${OV.quietTailS} s, every 10 s, group ${O.groups[O.groups.length - 1]?.k}'s keys): ${O.tail.length} probes, ${warmN} answered \`warm\`; last warm at ${iso(lastWarm)}${censored ? " — **censored** (still warm at the tail's end)" : ""}. Titles seen on row A: ${[...new Set(O.tail.map((x) => x.row[7]).filter(Boolean))].join(", ") || "—"}.`);
    }
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
    lines.push(OVERLAP ? `${skippedEdits} of ${EDITS} groups with a save that did not commit (overlap saves are never retried). Each failed save:` : `${skippedEdits} of ${EDITS} edits skipped (both attempts failed). Each failed attempt:`);
    lines.push("");
    for (const f of saveFailures) lines.push(`- edit ${f.k} ${f.op} attempt ${f.attempt} at ${f.at}: ${f.error}`);
    lines.push("");
  }
  lines.push("## Clean-up");
  lines.push("");
  lines.push(`- Soft-deleted ${clean?.deleted.length ?? 0}/${created.length} created rows${clean?.failed.length ? `; **NOT deleted: ${clean.failed.join(", ")}**` : ""}; position restore: ${JSON.stringify(clean?.restore ?? null)}`);
  lines.push(`- Verify: ${JSON.stringify(verify)}${RESTORE ? "" : " (samePositions is expected to be false without --restore-positions: insert-after shifted rows below the insertion point and soft-delete does not compact)"}`);
  if (fin.ovClean) lines.push(`- Overlap: reactions deleted by id ${fin.ovClean.reactions.deleted}/${new Set(ovReactionIds).size}${fin.ovClean.reactions.failed.length ? ` **NOT deleted: ${fin.ovClean.reactions.failed.join(", ")}** (raw ones carry \`${ANON_PREFIX}\`: \`viewers-check.mjs --delete\`)` : ""}; dedicated songs soft-deleted ${fin.ovClean.songs.deleted}/${ovSongs.length}${fin.ovClean.songs.failed.length ? ` **NOT deleted: ${fin.ovClean.songs.failed.join(", ")}**` : ""}`);
  lines.push("");
  const md = lines.join("\n");

  // ─── timelines side file (JSONL) ───
  // One JSON object per line. The first line documents every row layout,
  // so the file is readable without this source. The rows are exactly
  // what the worker / page recorder keeps (no re-shaping), so a later
  // analysis sees what the run saw.
  const lateByIdx = new Map();
  for (const m of workerMeta) for (const x of m.deadlineLate || []) {
    if (!lateByIdx.has(x[2])) lateByIdx.set(x[2], []);
    lateByIdx.get(x[2]).push([x[0], x[1]]);
  }
  const timelines = [
    {
      kind: "header", version: 1, runStart: iso(state.runStart), base: BASE, eventId: EVENT_ID, drill: DRILL, label: args.label ?? null,
      clock: "epoch ms of the load host (Date.now()); same clock as the report's UTC times",
      kinds: {
        thread: "one per thread: main (pages + admin driver) and each SDK worker; lag = 10 s buckets + spikes, heartbeats, deadline timers",
        save: "one per writer save (insert-after / PUT), in run order",
        sdk: "one per SDK client",
        page: "one per Chromium page",
      },
      rows: {
        "thread.lag.buckets": ["bucketStart", "n", "p50", "p95", "p99", "max"],
        "thread.lag.spikes": ["t", "lagMs (> 200)"],
        "thread.heartbeats": ["recvT (main clock)", "sendT (worker clock)", "lagMaxSinceLastMs"],
        "thread.deadlineLate": ["t", "lateMs = fired - armed - 8000", "client idx"],
        "sdk.reqs": ["tStart", "reason", "generic 0/1", "hint", "notify 0/1", "minRev", "status (0 = network / deadline)", "verify kind", "body rev", "hint resolution", "tEnd", "outcome ok|failed|cancelled", "x-snapshot-source", "body capturedAt (epoch ms, PostgreSQL clock)", "anchor A song originalTitle (overlap drill, else null)"],
        "sdk.applied": ["t", "rev", "fetch reason", "body capturedAt (epoch ms)"],
        "sdk.bcasts": ["t", "rev", "n news | d duplicate | x dropped by drill | i invalid"],
        "sdk.exhausted": ["t", "hint"],
        "sdk.lag.deadlineLate": ["t", "lateMs"],
        "page.reqs": ["tResponse", "minRev", "status", "x-snapshot-source", "body rev", "x-snapshot-verify (raw)", "hint=1", "request start", "body capturedAt (epoch ms)"],
        "page.applied": ["t", "marker song ids added", "removed"],
        "page.bcasts": ["t", "rev", "n | x (dropped by the proxy drill)"],
        "page.notes": ["t", "postgres_changes type I/U/D", "row id"],
      },
    },
    ...lagThreads.map(({ thread, summary }) => {
      const w = thread === "main" ? null : Number(thread.split(" ")[1]);
      return {
        kind: "thread", thread, lag: summary,
        ...(w == null ? {} : { heartbeats: heartbeats[w] || [], deadlineLate: workerMeta.find((m) => m.worker === w)?.deadlineLate || [] }),
      };
    }),
    ...edits.flatMap((e) => [
      ...(e.ins ? [{ kind: "save", k: e.k, op: "insert-after", id: e.id, start: e.ins.startedAt, successStart: e.ins.successAt ?? e.ins.startedAt, ms: e.ins.ms, rev: e.ins.rev, attempts: e.ins.attempts ?? 1 }] : []),
      { kind: "save", k: e.k, op: "put", mode: e.mode, id: e.id, song: e.song.id, start: e.put.startedAt, successStart: e.put.successAt ?? e.put.startedAt, ms: e.put.ms, rev: e.put.rev, attempts: e.put.attempts ?? 1, double: !!e.double, ...(e.who ? { who: e.who } : {}) },
    ]),
    ...subRecs.map((r) => ({
      kind: "sdk", idx: r.idx, worker: r.worker ?? null, locale: r.locale,
      reqs: r.reqs, applied: r.appliedAll, bcasts: r.bcasts, exhausted: r.exhausted,
      subscribedAt: r.subscribedAt, fallbacks: r.fallbacks, recreates: r.recreates, failKinds: r.failKinds,
      lag: { thread: `worker ${r.worker ?? "?"}`, deadlineLate: lateByIdx.get(r.idx) || [] },
    })),
    ...pageRecs.map((r) => ({
      kind: "page", idx: r.idx, worker: null, locale: r.locale, mode: r.mode,
      reqs: r.fetches, applied: r.dom, bcasts: r.bcasts, notes: r.notes,
      openedAt: r.openedAt, loadedAt: r.loadedAt, joinAt: r.joinAt,
      // Page events are timestamped by the browser (DOM) or by Playwright
      // callbacks on the main thread; the main thread's lag is the one
      // that can delay the latter.
      lag: { thread: "main" },
    })),
  ].map((o) => JSON.stringify(o));

  const json = {
    config: { base: BASE, eventId: EVENT_ID, eventPath: EVENT_PATH, pages: PAGES, subs: SUBS, subWorkers: SUB_WORKERS, edits: EDITS, editMode: EDIT_MODE, anchorRow: anchor?.id ?? null, pauseMs: PAUSE_MS, timeoutMs: TIMEOUT_MS, drill: DRILL, drillPages: DRILL_PAGES, drillEdit: DRILL_EDIT, label: args.label ?? null,
      ...(DRILL === "poison" ? { poisonRev: POISON_REV, poisonLeadMs: POISON_LEAD_MS } : {}),
      ...(DRILL === "spam" ? { spamRate: SPAM_RATE, spamSecs: SPAM_SECS, spamRev: SPAM_REV } : {}),
      ...(OVERLAP ? { overlap: OV, overlapAnchors: ovAnchors, overlapReactionGroup: OV_REACTION_GROUP, runId: RUN_ID } : {}) },
    window: { runStart: iso(state.runStart), editsStart: iso(state.editsStart), editsEnd: iso(state.editsEnd), end: iso(Date.now()) },
    verdicts, popSummary, rejoin, drillEvents,
    // Measurement validity: the verdict, why, and each thread's lag
    // series (10 s buckets [start, n, p50, p95, p99, max] + every sample
    // > 200 ms), heartbeats and deadline-timer lateness.
    validity: {
      invalid: valid.invalid, reasons: valid.reasons.map((r) => ({ ...r, atIso: iso(r.at) })), window: { from: iso(vFrom), to: iso(vTo) },
      thresholds: { lagMs: LAG_INVALID_MS, silentMs: SILENT_INVALID_MS },
      threads: threadRows,
      lag: { main: mainSummary, workers: workerMeta.map((m) => ({ worker: m.worker, lag: m.lag, timedOut: m.timedOut })) },
      heartbeats, deadlineLate: Object.fromEntries(workerMeta.map((m) => [m.worker, m.deadlineLate])),
    },
    host: {
      guard: hostCheck,
      ncpu: hostMon.ncpu, totalMemMB: hostMon.totalMemMB, platform: process.platform,
      phases: hostPhases.map((p) => ({ ...p, fromIso: iso(p.from), toIso: iso(p.to) })),
      row: HOST_SAMPLE_ROW, samples: hostMon.samples,
    }, saveFailures, clean, verify, doubleSave,
    guest: guest ? { status: guest.status, joinMs: guest.joinMs, sends: guest.sends } : null,
    hints: { sdk: hintTotals, pages: pageHint }, poison, spam, ambiguity,
    // Input of warm-join.mjs: per save, the commit proxy and every
    // client's first notification fetch of it (see editStats). Absolute
    // epoch ms (this machine's clock) so the Vercel log times can be
    // lined up; the per-request offsets are relative to `putEnd`.
    warm: {
      commitProxy: "PUT end = start of the successful PUT attempt + its duration (the server commits, answers, then runs the warm job in after())",
      sdkRow: ["idx", "locale", "sendMinusCommitMs", "endMinusCommitMs", "source", "verify", "minRev", "bodyRev"],
      pageRow: ["idx", "locale", "requestStartMinusCommitMs", "responseMinusCommitMs", "source", "verify", "minRev", "bodyRev"],
      saves: rows.map(({ e, s }) => ({
        k: e.k, ...(e.who ? { who: e.who } : {}), mode: e.mode, rev: e.put.rev, insRev: e.ins?.rev ?? null, double: !!e.double,
        putStart: e.put.successAt ?? e.put.startedAt, putMs: e.put.ms ?? null,
        putEnd: (e.put.successAt ?? e.put.startedAt) + (e.put.ms ?? 0),
        putEndIso: iso((e.put.successAt ?? e.put.startedAt) + (e.put.ms ?? 0)),
        sdk: s.subs.hint.first, pages: s.pages.hint.first,
        sdkWarm: s.subs.hint.warm, sdkHinted: s.subs.hint.notif, pagesWarm: s.pages.hint.warm, pagesHinted: s.pages.hint.notif,
      })),
      // overlap: the groups (every intended save, failed ones included,
      // with the gate anchors) — warm-join.mjs / overlap-join.mjs group
      // the per-save rows above by `k`.
      ...(overlap ? {
        groups: state.overlap.groups.map((g) => ({
          k: g.k, head: g.anchor.head, headWho: g.anchor.headWho, lastStart: g.anchor.lastStart, firstStart: g.anchor.firstStart, lastResponse: g.anchor.lastResponse, allOk: g.anchor.allOk,
          saves: g.saves.map((x) => ({ who: x.who, rowId: x.rowId, songId: x.song.id, rev: x.rev, status: x.status, putStart: x.startedAt, putMs: x.ms, putEnd: x.startedAt + x.ms, fault: x.fault, error: x.error })),
        })),
      } : {}),
    },
    // Page-side browser stall SUSPECT flags (every run; see the banner).
    suspect: { rule: "pages' first hinted fetch of a save: warm|cache on ≥ 80 % of pages, every one > 1 s (≥ 3 pages)", saves: suspectSaves },
    // overlap: everything the drill did and measured, per group, plus the
    // probe population. Clocks: this machine's epoch ms, except
    // `capturedAt` (PostgreSQL now()) and a reaction's `ackAt` (PostgreSQL
    // clock_timestamp()).
    ...(overlap ? {
      overlap: {
        gates: overlap.gates, pass: overlap.pass, fivexx: overlap.fivexx, roles: overlap.roles, reloads: overlap.reloadV, reactions: overlap.rxV, ackHold: overlap.ahV,
        convergence: { pages: overlap.pagesConv, subs: overlap.subsConv, fromFirstStart: overlap.fromFirst },
        rcRegressions: overlap.rc.filter((m) => m.regressions.length).map((m) => ({ idx: m.r.idx, regressions: m.regressions })),
        controls: state.overlap.controls,
        reactionPage: state.overlap.reactionPage,
        groups: overlap.groups.map(({ g, a, markers, conv }) => ({
          k: g.k, t0: g.t0, anchor: a, markers,
          saves: g.saves.map((x) => ({ k: x.k, who: x.who, rowId: x.rowId, songId: x.song.id, songTitle: x.song.title, startedAt: x.startedAt, ms: x.ms, status: x.status, rev: x.rev, attempts: x.attempts, fault: x.fault, error: x.error })),
          reloads: g.reloads, catalog: g.catalog, reactions: g.reactions,
          pageReaction: g.pageReaction ?? null,
          convergence: { pages: conv.pages, pagesFromFirst: conv.pagesFirst, pagesMissing: conv.pagesMissing, ackHoldPage: conv.drilledPages, subs: dist(conv.subs), subsFromFirst: dist(conv.subsFirst), subsMissing: conv.subsMissing },
        })),
      },
      probe: {
        row: PROBE_ROW,
        groups: state.overlap.groups.map((g) => ({ k: g.k, committed: g.anchor.committed, head: g.anchor.head, lastResponse: g.anchor.lastResponse, probes: (g.probes || []).map((x) => ({ off: x.off, who: x.who, head: x.head, row: x.row })) })),
        tail: state.overlap.tail,
      },
    } : {}),
    // Every page's DOM-derived version history and every client's
    // regressions (the full per-client apply log is too large to keep).
    monotonic: {
      pages: pageMono.map((m) => ({ idx: m.r.idx, versions: m.versions, regressions: m.regressions })),
      subs: monoSubsBad.map((m) => ({ idx: m.r.idx, regressions: m.regressions })),
    },
    edits: rows.map(({ e, s }) => ({
      k: e.k, mode: e.mode, id: e.id, song: e.song,
      insert: e.ins ? { start: iso(e.ins.startedAt), ms: e.ins.ms, rev: e.ins.rev, position: e.ins.position } : null,
      put: { start: iso(e.put.startedAt), successStart: iso(e.put.successAt ?? e.put.startedAt), attempts: e.put.attempts ?? 1, ms: e.put.ms, rev: e.put.rev },
      pages: { lat: s.pages.lat, drilledLat: s.pages.drilledLat, missing: s.pages.missing, drilledMissing: s.pages.drilledMissing, notifPut: s.pages.notifPut, notifIns: s.pages.notifIns },
      subs: { latDist: dist(s.subs.lat), drilledDist: dist(s.subs.drilledLat), missing: s.subs.missing, drilledMissing: s.subs.drilledMissing, notifPut: dist(s.subs.notifPut), bcastPut: dist(s.subs.bcastPut), bcastIns: dist(s.subs.bcastIns) },
    })),
    pages: pageRecs,
  };
  return { md, json, timelines };
}

function writeResults(md, json, timelines) {
  const now = new Date();
  const dir = path.join(HERE, "..", "results", now.toISOString().slice(0, 10));
  fs.mkdirSync(dir, { recursive: true });
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  const base = path.join(dir, `${stamp}-browsers${DRILL ? `-${DRILL}` : ""}`);
  fs.writeFileSync(`${base}.md`, md);
  fs.writeFileSync(`${base}.json`, JSON.stringify(json, null, 1));
  if (timelines) fs.writeFileSync(path.join(dir, `${stamp}-timelines.jsonl`), timelines.join("\n") + "\n");
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
      const { md, json, timelines } = report(mainState, fin);
      const base = writeResults(md, json, timelines);
      log(`partial results: ${base}.md`);
    }
    process.exit(130);
  });
}

try {
  mainState = await main();
  const fin = await finalize(mainState, null);
  const { md, json, timelines } = report(mainState, fin);
  const base = writeResults(md, json, timelines);
  console.log("\n" + md);
  log(`results: ${base}.md`);
  // INVALID (3) outranks pass / fail: the gates were not measured.
  if (json.validity.invalid) {
    log(`VERDICT: INVALID — ${json.validity.reasons.length} host stall(s), first: ${json.validity.reasons[0].thread} ${json.validity.reasons[0].what} at ${json.validity.reasons[0].atIso}`);
    process.exit(3);
  }
  // null (nothing in scope, e.g. every pair drilled) is not a failure.
  process.exit(json.verdicts.primary.pass !== false && json.verdicts.drill?.pass !== false && json.verdicts.monotonic.pass !== false ? 0 : 1);
} catch (e) {
  log(`ERROR: ${e.stack || e.message}`);
  await finalize(mainState, `error: ${e.message}`);
  process.exit(2);
}
