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
// n14 qualification step 5 (cold admission): `--phase=admission`
// replaces the "join everybody, settle, then edit" start with prepare →
// boundary wait → admit: everything that needs the deployment before
// the measurement (login, the dedicated anchor row, the run manifest)
// happens first, then NOTHING is sent until the operator's boundary
// (`--admit-at` / `--admit-file`, after the `vercel redeploy`), then the
// pages (concurrency 5) and the SDK clients (50/s) start together at T0
// and the admission saves run on their own timer from T0
// (`--admission-saves=5,20,45`), concurrently with the launches. The
// per-save exposure (SDK / page), the population-split convergence, the
// stale first answers and the admission gates are in the report's
// "Admission" section (pure logic: admission.mjs; server side:
// ../admission-join.mjs). `--final-cohort=20,20` adds the I3 control at
// the end (20 incumbents kept, 20 fresh clients, save 6 s after they are
// ready, +40 s save). `--drill=idle-broadcast` (I1 / I2 with `--wake`) is
// the first-save-after-idle drill: SDK cohorts only, scheduled from
// `--connect-at` / `--first-save-at`, eligibility computed post hoc.
// See README.md "Admission phase" / "Idle-broadcast drill".
//
// n14 qualification step 7 (5-minute spam + real saves + background
// k6): `--phase=spam7` runs the standard join, then baseline
// (--baseline-secs) → guest spam (--spam-secs, `{ kind, rev, runId, k }`
// at --spam-rate, --spam-rev ahead|max|stale|none) → recovery
// (--recovery-secs) → measurement end → clean-up, with one never-retried
// mixed edit per --save-offsets entry on its own timer from the spam
// start. The "Spam (n14 step 7)" section judges exposure, honest latency
// per save per population, writes, errors, drain, cooldown, the durable
// watermark and the stale control (pure logic: spam7.mjs; server side:
// ../spam7-join.mjs). `--declared-process=<pid>` lets the host guard
// accept that one process (the background k6) and its descendants.
// See README.md "Spam phase".
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
import dc from "node:diagnostics_channel";
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
import {
  parseStep5Flags, parseAdmitFile, firstSaveFromFile, fixtureIdsOf, expectedRows, completeAt, connOf, connectedThrough, firstSub,
  sdkExposure, pageExposure, exposureLabel, sdkConvergence, pageConvergence, staleFirstAnswers, receiptVsReason,
  admissionVerdict, idleEligibility, idleArrivals, summarizeArrivals,
} from "./admission.mjs";
import {
  parseTransitionFlags, parseSwitchFile, saveSchedule, quietDue, waves, pinEvidence, isPinned, dplIdOf, probeResolution, firstTargetLive,
  routingProfile, boundaryOf, releaseAt, SDK_ROW_TX, Q, pendingHinted, pendingRecheck, oldAnswerAfterCutover, arrivalExposure, clientOutcome,
  broadcastReceipt, updateGap, pageBuild, pageReadyAt, timeToUsable, staleFirstAfter, firstRowsAt, continuityVerdict, transitionVerdict,
} from "./transition.mjs";
import { insertAfterRaw, softDeleteRaw } from "./admin.mjs";
import { parseSnapshotVerify } from "../../../src/lib/snapshotVerify.ts";
import { NOTIFICATION_COOLDOWN_MS as COOLDOWN_MS } from "../../../src/lib/liveScheduler.ts";
import {
  startLagMonitor, lagOver, validity, LAG_INVALID_MS, SILENT_INVALID_MS, startHostSampler, summarizeHost, HOST_SAMPLE_ROW,
  hostBusy, listProcesses, competingProcesses, HOST_BUSY_LIMIT_PCT, listAllProcessesAsync, pidAlive,
} from "./hostmon.mjs";
import {
  parseSpam7Flags, slotSchedule, forgedRev, exposure as spamExposure, staleEligibility, pageServerRevAt, classifyStratum, STRATA, latSummary,
  sdkReqCategory, rateBuckets, rolling, baselineStats, drainThreshold, confirmDrain, aggregateState, sampleAt, reboundRequests, cooldownCheck,
  watermarkViolations, ticketDropRecovery, processTree, spam7Verdict, EXPOSURE_MIN, TIMELY_MS,
} from "./spam7.mjs";

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
// `let`: with --phase=admission --deployment-url the measurement
// deployment's URL is only known after the redeploy and may arrive in the
// admit file (see admissionPhase); everything that talks to it reads
// BASE at call time.
let BASE = process.env.BASE_URL.replace(/\/$/, "");
const EVENT_ID = String(args["event-id"] ?? "111");
const EVENT_PATH = args["event-path"] ?? "/events/111/rehearsal-lovelive-fes-2020-day1";
const PAGES = int("pages", 30);
const SUBS = int("subs", 470);
// n14 step 7 (see the spam7 section below and spam7.mjs
// `parseSpam7Flags`): S7 = the --phase=spam7 config, null otherwise.
// Parsed this early because it decides the edit count (one edit per
// --save-offsets entry) and the edit mode (mixed). Checked here, before
// anything is created.
const S7P = parseSpam7Flags(args, { phase: args.phase === undefined ? null : String(args.phase), drill: args.drill ? String(args.drill) : null });
if (S7P.error) {
  console.error(S7P.error);
  process.exit(2);
}
const S7 = S7P.cfg;
const EDITS = S7 ? S7.edits : int("edits", 12);
const PAUSE_MS = Math.round(parseFloat(args.pause ?? "25") * 1000);
const AFTER_ROW = int("after-row", 2);
// See the header. insert-after cannot carry a song (the route takes only
// { eventId, afterPosition }), so a single-save edit is a PUT that swaps
// the marker song on a row the run created up front.
const EDIT_MODE = String(args["edit-mode"] ?? (S7 ? "mixed" : "pair"));
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
// --declared-process=<pid> (n14 step 7): ONE process that is part of the
// experiment (the background k6 on this laptop). The host guard accepts
// exactly that pid plus its descendants by parent PID; every other
// unknown process still counts as competing (and refuses under
// --strict-host). Its command line, start and end are recorded in the
// JSON; it is re-checked mid-spam and at the measurement end.
const DECLARED_PID = args["declared-process"] === undefined ? null : Number(args["declared-process"]);
if (DECLARED_PID !== null && !(Number.isSafeInteger(DECLARED_PID) && DECLARED_PID > 0)) {
  console.error(`--declared-process must be a pid (got ${args["declared-process"]})`);
  process.exit(2);
}
// Self-test of the INVALID path: `--debug-stall=<ms>` makes SDK worker 0
// busy-wait that long right before the first edit, i.e. exactly the
// failure the validity monitors exist to catch. Expect exit code 3 and
// the banner naming "worker 0". Never use it for a measurement.
const DEBUG_STALL_MS = int("debug-stall", 0);
const GATE_P95_MS = int("gate-p95", 3000);
// camelCase spellings accepted too (doubleSave, lostFinal, …).
const DRILL = args.drill ? String(args.drill).replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`) : null;
if (DRILL && !["silent-loss", "ws-blocked", "reconnect", "double-save", "lost-final", "poison", "spam", "verify-ambiguity", "overlap", "idle-broadcast"].includes(DRILL)) {
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
// n14 step 5 (see the header and admission.mjs `parseStep5Flags`): ADM =
// the --phase=admission config, IDLE = the --drill=idle-broadcast config;
// null otherwise. Checked here, before anything is created.
const PHASE = args.phase === undefined ? null : String(args.phase);
const S5 = parseStep5Flags(args, { phase: PHASE, drill: DRILL, deploymentUrl: DEPLOYMENT_URL, pages: PAGES });
if (S5.error) {
  console.error(S5.error);
  process.exit(2);
}
const ADM = S5.cfg.admission;
const IDLE = S5.cfg.idle;
// n14 step 6 (see the transition section below and transition.mjs
// `parseTransitionFlags`): TXC = the --phase=transition config, null
// otherwise. Checked here, before anything is created.
const TXP = parseTransitionFlags(args, { phase: PHASE, drill: DRILL, deploymentUrl: DEPLOYMENT_URL, subs: SUBS });
if (TXP.error) {
  console.error(TXP.error);
  process.exit(2);
}
const TXC = TXP.cfg;
// With a deployment-specific URL the identity guard would fetch a
// snapshot from the measurement deployment before T0 — exactly the
// warming this phase must avoid — so it has to run against the
// precursor instead.
if (ADM && DEPLOYMENT_URL && !ADM.precursor) {
  console.error("--phase=admission --deployment-url needs --guard-precursor=<precursor deployment URL>: the identity guard must not touch the measurement deployment before T0");
  process.exit(2);
}
if (ADM?.precursor && !isDeploymentBaseUrl(ADM.precursor)) {
  console.error("--guard-precursor must be https://opensetlist-<hash>-opensetlist-projects.vercel.app");
  process.exit(2);
}
// Where prepare talks to: the precursor (deployment-URL runs) or the
// alias, which still points at the precursor until the redeploy.
const PREP_BASE = ADM?.precursor ?? BASE;
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
const GUEST_DRILL = DRILL === "poison" || DRILL === "spam" || (S7 != null && S7.spamRev !== "none");
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
    spawnWorker({ offset, n: Math.min(per, SUBS - offset), batch: batchPer });
  }
}

// One SDK worker thread with clients [offset, offset + n). `cohort`
// labels its clients' records (step 5: "incumbent" / "fresh"); worker
// indices continue across calls, so a cohort spawned later (I2 / I3) is
// covered by the same validity monitors.
function spawnWorker({ offset, n, batch, cohort = null }) {
  const w = workers.length;
  {
    const worker = new Worker(path.join(HERE, "subs-worker.mjs"), {
      workerData: {
        offset, n, base: BASE, eventId: EVENT_ID,
        supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
        anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
        batch, every: 1000, localeOf: LOCALE_OF, workerIdx: w,
        // overlap: record anchor row A's song title per response.
        anchorId: OVERLAP ? ovAnchors.A?.id ?? null : null,
        cohort,
        // n14 step 6: per-response evidence columns + subset commands.
        transition: !!TXC,
        // n14 step 7: the watermark history (serverRevLog).
        spam7: !!S7,
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
    const entry = { worker, n, ask, idx: w, cohort, offset };
    workers.push(entry);
    return entry;
  }
}

// SDK clients connected right now (current, not "ever subscribed"),
// optionally only those of the given worker entries.
async function subsConnected(list = workers) {
  const all = await Promise.all(list.map((w) => w.ask("progress", "progress")));
  return all.reduce((a, p) => a + p.joined, 0);
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
    // n14 step 7: one message with the step-7 payload (`{ kind, rev,
    // runId, k }`), NOT awaited by the sender loop — the loop keeps its
    // slot schedule while acks are outstanding (an attacker does not wait
    // for acks either); the caller records the ack result and latency
    // per message. Same `closed` guard as send().
    async fire(payload) {
      if (g.closed) return { result: "closed", ms: 0 };
      const t = Date.now();
      let r;
      try {
        r = await ch.send({ type: "broadcast", event: "rev", payload });
      } catch (e) {
        r = `threw: ${String(e?.message || e).slice(0, 80)}`;
      }
      return { result: r, ms: Date.now() - t };
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
// `allowGone` (n14 step 6, transition only): marker song id → the start
// of the save that soft-deleted its row on purpose; a disappearance at
// or after that instant is the expected outcome, not a regression.
function pageMonotonicity(r, idx, until, allowGone = null) {
  const present = new Set();
  let maxV = -Infinity;
  const versions = [];
  const regressions = [];
  for (const [t, added, removed] of r.dom || []) {
    if (t >= until) break;
    let touched = false;
    // An intended deletion lowers the shown version legitimately: the
    // version baseline restarts from what remains.
    let deletedNow = false;
    for (const id of added) if (idx.rev.has(id)) { present.add(id); touched = true; }
    for (const id of removed) {
      if (!idx.rev.has(id)) continue;
      present.delete(id);
      touched = true;
      const deleted = allowGone?.has(id) && t >= allowGone.get(id);
      if (deleted) deletedNow = true;
      if (!replacedPresent(idx, id, present) && !deleted) regressions.push({ t, what: `marker ${id} (rev ${idx.rev.get(id)}) disappeared` });
    }
    if (!touched) continue;
    let v = -Infinity;
    for (const id of present) v = Math.max(v, idx.rev.get(id));
    const shown = Number.isFinite(v) ? v : null;
    if (!versions.length || versions[versions.length - 1][1] !== shown) versions.push([t, shown]);
    if (deletedNow) maxV = v;
    else if (v < maxV) regressions.push({ t, what: `version ${maxV} → ${shown ?? "none"}` });
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
// --declared-process (see DECLARED_PID): the declared process's record —
// pid, name, command line, start (OS creation time, UTC), the descendant
// pids accepted with it, its end (first poll that found it gone), and
// every re-check of the host during the run (`checks`).
let declared = null;
// The pids the guard accepts as declared: the declared pid + descendants,
// recomputed at every check (k6 may spawn children later).
async function declaredTree() {
  const all = await listAllProcessesAsync();
  if (!all) return { all: null, tree: new Set([DECLARED_PID]) };
  return { all, tree: processTree(all, DECLARED_PID) };
}
// Mid-run / end-of-measurement re-check (async: never blocks the main
// thread). Records undeclared competing node / k6 processes and whether
// the declared one is still alive; the step-7 report turns a competing
// process into an INVALID reason (undeclared competing work).
async function recheckHost(label) {
  const at = Date.now();
  const all = await listAllProcessesAsync();
  if (!all) return { label, at, ok: null, competing: null, declaredAlive: DECLARED_PID ? pidAlive(DECLARED_PID) : null };
  const allow = DECLARED_PID ? processTree(all, DECLARED_PID) : null;
  const nodeK6 = all.filter((p) => /^(node|k6)(\.exe)?$/i.test(String(p.name || "")));
  const competing = competingProcesses(nodeK6, process.pid, process.ppid, allow).map(({ pid, why, cmd }) => ({ pid, why, cmd: String(cmd).slice(0, 300) }));
  const out = { label, at, ok: competing.length === 0, competing, declaredAlive: DECLARED_PID ? pidAlive(DECLARED_PID) : null, declaredTree: allow ? [...allow] : null };
  if (declared) declared.checks.push(out);
  return out;
}
async function hostGuard() {
  const busy = await hostBusy(2000);
  const procs = listProcesses();
  let allow = null;
  if (DECLARED_PID) {
    if (!pidAlive(DECLARED_PID)) throw new Error(`--declared-process=${DECLARED_PID}: no such process; nothing was created`);
    const { all, tree } = await declaredTree();
    const me = all?.find((p) => p.pid === DECLARED_PID) ?? null;
    allow = tree;
    declared = {
      pid: DECLARED_PID, name: me?.name ?? null, cmd: me ? String(me.cmd).slice(0, 1000) : null, startedAt: me?.startedAt ?? null,
      tree: [...tree], descendants: (all || []).filter((p) => tree.has(p.pid) && p.pid !== DECLARED_PID).map((p) => ({ pid: p.pid, name: p.name, cmd: String(p.cmd).slice(0, 300) })),
      seenAt: new Date().toISOString(), endedAt: null, checks: [],
    };
    log(`declared process ${DECLARED_PID} (${declared.name ?? "?"}, started ${declared.startedAt ?? "?"}): ${String(declared.cmd ?? "").slice(0, 160)}${tree.size > 1 ? ` (+ ${tree.size - 1} descendant(s))` : ""}`);
  }
  const competing = procs ? competingProcesses(procs, process.pid, process.ppid, allow) : null;
  const problems = [];
  if (busy.pct != null && busy.pct > HOST_BUSY_LIMIT_PCT) problems.push(`host CPU ${busy.pct} % busy (${busy.how}) > ${HOST_BUSY_LIMIT_PCT} %`);
  for (const p of competing || []) problems.push(`pid ${p.pid}: ${p.why} — ${String(p.cmd).slice(0, 120)}`);
  hostCheck = { busyPct: busy.pct, how: busy.how, competing: competing?.map(({ pid, why, cmd }) => ({ pid, why, cmd: String(cmd).slice(0, 300) })) ?? null, processListOk: procs != null, problems, strict: STRICT_HOST, declaredPid: DECLARED_PID };
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

// --deployment-url identity guard (see the comment inside). `target` =
// the deployment it reads from: BASE normally; with --phase=admission the
// PRECURSOR (--guard-precursor), so the measurement deployment receives
// no request before T0 (the guard's snapshot read would warm it).
async function identityGuard(target, startRev) {
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
  const snap = await getSnapshot(target, EVENT_ID, { locale: "ko", minRev: startRev });
  const served = (Array.isArray(snap.items) ? snap.items : []).map((it) => `${it.id}@${Number(it.position)}`).join(",");
  const expected = original.map((r) => `${r.id}@${r.position}`).join(",");
  if (Number(snap.rev) !== startRev || served !== expected) {
    throw new Error(`--deployment-url: ${target} serves event ${EVENT_ID} at rev ${snap.rev} with rows [${served.slice(0, 120)}], the dev database has rev ${startRev} with rows [${expected.slice(0, 120)}] — not the dev deployment; nothing was created`);
  }
  log(`deployment-url check: ${target} serves event ${EVENT_ID} at rev ${startRev} with the dev database's ${original.length} rows (ids and positions match)`);
}

// The standard start (every mode except --phase=admission and
// --drill=idle-broadcast): identity guard, login, anchors, then the whole
// population joins and settles before the first edit.
async function standardJoin({ startRev, afterPosition }) {
  if (DEPLOYMENT_URL) await identityGuard(BASE, startRev);
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
    // rev / startedAt / ms: step 7 reports the anchor as the preparation
    // write next to the measured ones (nothing else reads them).
    anchor = { id: a.id, position: a.position, rev: a.rev, startedAt: a.startedAt, ms: a.ms };
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
    ? await launchPages({ count: PAGES, base: BASE, eventPath: EVENT_PATH, eventId: EVENT_ID, localeOf: LOCALE_OF, routeMode, headless: !args.headed, concurrency: PAGE_CONCURRENCY, log, spam7: !!S7 })
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
  return { popStart, popSummary, settleStart, drillPageSet, admission: null };
}

// ─── n14 step 5: shared helpers ───
const sleepUntil = (t) => sleep(Math.max(0, t - Date.now()));
// The population stub when no Chromium page runs (or before the launch
// promise resolved): every method a run touches, all no-ops.
const emptyPop = () => ({ pages: [], joined: () => 0, pgReady: () => 0, setDropNotify() {}, armHookDrop: async () => 0, disarmHookDrop: async () => 0, hookDropPending: async () => null, dropSockets: () => 0, close: async () => {} });

// The run manifest: every active row of the event with what the page
// renders from it (songs in order — the page's complete-setlist check
// compares against these, by order and multiplicity) and what a fixture
// clone copies (members incl. a nullable realPersonId, artists, the row
// attributes), plus the event revision — read in ONE repeatable-read
// transaction so rows and revision belong together.
async function readManifest(pg) {
  await pg.query("begin isolation level repeatable read");
  try {
    const r = await pg.query(
      `select si.id::text as id, si.position, si."isEncore" as "isEncore", si.type::text as type, si.status::text as status,
              si."stageType"::text as "stageType", si."performanceType"::text as "performanceType",
              coalesce((select json_agg(json_build_object('songId', sis."songId"::text, 'order', sis."order") order by sis."order" asc nulls last, sis.id)
                          from "SetlistItemSong" sis where sis."setlistItemId" = si.id), '[]'::json) as songs,
              coalesce((select json_agg(json_build_object('stageIdentityId', m."stageIdentityId", 'realPersonId', m."realPersonId") order by m."stageIdentityId")
                          from "SetlistItemMember" m where m."setlistItemId" = si.id), '[]'::json) as members,
              coalesce((select json_agg(a."artistId"::text order by a."artistId")
                          from "SetlistItemArtist" a where a."setlistItemId" = si.id), '[]'::json) as artists
         from "SetlistItem" si
        where si."eventId" = $1 and si."isDeleted" = false
        order by si."isEncore", si.position, si."createdAt"`,
      [EVENT_ID],
    );
    const rev = Number((await pg.query(`select "setlistRevision" as r from "Event" where id = $1`, [EVENT_ID])).rows[0].r);
    await pg.query("commit");
    return { rev, rows: r.rows.map((x) => ({ ...x, position: Number(x.position) })) };
  } catch (e) {
    await pg.query("rollback").catch(() => {});
    throw e;
  }
}

// Outbound-request watch for the boundary wait: every HTTP request this
// process creates (undici = fetch) and every TCP client socket it opens
// is recorded. Between the end of prepare and T0 there must be none — no
// worker thread and no Chromium exist yet, so this main thread is the
// only possible sender.
function watchOutbound(into) {
  const onHttp = (m) => into.push([Date.now(), "http", `${m.request?.method ?? "?"} ${m.request?.origin ?? ""}${String(m.request?.path ?? "").split("?")[0]}`]);
  const onTcp = (m) => into.push([Date.now(), "tcp", `${m.socket?.remoteAddress ?? "?"}:${m.socket?.remotePort ?? "?"}`]);
  dc.subscribe("undici:request:create", onHttp);
  dc.subscribe("net.client.socket", onTcp);
  return () => {
    dc.unsubscribe("undici:request:create", onHttp);
    dc.unsubscribe("net.client.socket", onTcp);
  };
}

// Wait until every CONNECTED SDK client has applied rev ≥ `rev` and every
// open page shows `songId` (or a later marker on the same row), bounded by
// `until`.
async function waitConverged(rev, { songIds = [], until }) {
  while (Date.now() < until) {
    const pagesDone = !pagePop || pagePop.pages.every((p) => !p || songIds.length === 0 || songIds.some((id) => p.rec.seen[id] != null));
    const conn = workers.length ? await subsConnected() : 0;
    const subsDone = !workers.length || (await subsReached(rev)) >= conn;
    if (pagesDone && subsDone) return true;
    await sleep(500);
  }
  return false;
}

// ─── n14 step 5: --phase=admission ───
// prepare → boundary wait → admit (design §1.1). Returns the same shape
// as standardJoin plus the admission record and the admission saves as
// edits (mode "admission").
async function admissionPhase({ startRev, afterPosition, songs }) {
  const A = { prepBase: PREP_BASE, base: null, saves: [], guardRead: null, boundary: null, prepare: null, manifest: null, manifestFile: null, anchor: null, fixture: null };
  const prepStart = Date.now();
  // Identity guard against the PRECURSOR (deployment-URL runs; on the
  // alias the guard does not exist).
  if (DEPLOYMENT_URL) await identityGuard(PREP_BASE, startRev);
  // One login per run (the Vercel firewall rate-limits the login route).
  cookie = await adminLogin(PREP_BASE);
  // The ONE dedicated anchor row: every admission save (and every
  // standalone steady edit, and the I3 saves) PUTs its marker here. A
  // measured PUT deletes and recreates the row's three junction
  // collections, so it must never touch an original or fixture row.
  const a = await insertAfter({ base: PREP_BASE, cookie, eventId: EVENT_ID, afterPosition });
  created.push(a.id);
  anchor = { id: a.id, position: a.position };
  A.anchor = { id: a.id, position: a.position, rev: a.rev };
  log(`admission prepare: anchor row ${a.id} @${a.position} (rev ${a.rev}) via ${PREP_BASE}`);
  const m = await withPg((pg) => readManifest(pg));
  // The fixture (A2 / A4): mark the clone rows.
  if (ADM.rowsManifest) {
    const fx = JSON.parse(fs.readFileSync(ADM.rowsManifest, "utf8"));
    const ids = fixtureIdsOf(fx);
    for (const r of m.rows) r.fixture = ids.has(r.id);
    A.fixture = { file: ADM.rowsManifest, label: fx.label ?? null, cloneIds: [...ids], clonesActive: m.rows.filter((r) => r.fixture).length };
    log(`admission prepare: fixture ${ADM.rowsManifest}: ${A.fixture.clonesActive}/${ids.size} clone rows active`);
  }
  for (const r of m.rows) r.anchor = r.id === a.id;
  A.manifest = m;
  // The pre-anchor original rows (positions as recorded at the start):
  // what the clean-up restores to with --restore-positions.
  A.preAnchor = original.map((r) => ({ ...r }));
  const now = new Date();
  const dir = path.join(HERE, "..", "results", now.toISOString().slice(0, 10));
  fs.mkdirSync(dir, { recursive: true });
  A.manifestFile = path.join(dir, `${now.toISOString().replace(/[:.]/g, "-")}-admission-manifest.json`);
  fs.writeFileSync(A.manifestFile, JSON.stringify({ eventId: EVENT_ID, prepBase: PREP_BASE, base: BASE, label: args.label ?? null, startRev, rev: m.rev, anchor: A.anchor, preAnchor: A.preAnchor, rows: m.rows, fixture: A.fixture, writtenAt: now.toISOString() }, null, 1));
  A.prepare = { startedAt: prepStart, endedAt: Date.now(), rows: m.rows.length, rev: m.rev };
  log(`admission prepare done: ${m.rows.length} active rows at rev ${m.rev}; manifest ${A.manifestFile}`);

  // ── boundary wait: NOTHING goes out until the operator's boundary ──
  const outbound = [];
  const unwatch = watchOutbound(outbound);
  const waitFrom = Date.now();
  let admit = null;
  if (ADM.admitAt != null) {
    log(`boundary: waiting until --admit-at ${iso(ADM.admitAt)} (${Math.round((ADM.admitAt - Date.now()) / 1000)} s); no request until then`);
    await sleepUntil(ADM.admitAt);
  } else {
    log(`boundary: waiting for --admit-file ${ADM.admitFile} (touch it after the redeploy finished and the alias switched); no request until then`);
    while (!fs.existsSync(ADM.admitFile)) await sleep(100);
    // The writer may still be writing; a short pause, then read once.
    await sleep(100);
    admit = parseAdmitFile(fs.readFileSync(ADM.admitFile, "utf8"));
  }
  const T0 = Date.now();
  unwatch();
  A.boundary = { waitFrom, T0, waitMs: T0 - waitFrom, outbound, admitFile: admit, admitAt: ADM.admitAt };
  log(`boundary: T0 ${iso(T0)} after ${A.boundary.waitMs} ms; outbound requests during the wait: ${outbound.length}${outbound.length ? ` (${outbound.slice(0, 3).map((x) => x[2]).join("; ")})` : ""}`);
  if (admit?.base) {
    const b = String(admit.base).replace(/\/$/, "");
    if (!DEPLOYMENT_URL || !isDeploymentBaseUrl(b)) throw new Error(`admit file names base ${b}: only accepted with --deployment-url and a deployment URL`);
    BASE = b;
  }
  if (DEPLOYMENT_URL && BASE === PREP_BASE) throw new Error(`the measurement deployment is the precursor (${BASE}): it received the prepare requests, nothing to measure`);
  A.base = BASE;

  // ── admit: pages + SDK + saves, all from T0 ──
  if (SUBS > 0) startWorkers();
  pagePop = emptyPop();
  const pagesP = PAGES > 0
    ? launchPages({ count: PAGES, base: BASE, eventPath: EVENT_PATH, eventId: EVENT_ID, localeOf: LOCALE_OF, routeMode: () => "none", headless: !args.headed, concurrency: PAGE_CONCURRENCY, log, admission: true }).then((p) => { pagePop = p; return p; })
    : Promise.resolve(pagePop);
  // Deployment-URL runs: the measurement deployment's identity, checked
  // with ONE generic read at T0 (part of the admission wave, reported
  // apart) before the first save may write through it. The alias needs
  // none (assertDev already pinned it).
  if (DEPLOYMENT_URL) {
    const t = Date.now();
    try {
      const snap = await getSnapshot(BASE, EVENT_ID, { locale: "ko" });
      const served = (snap.items || []).map((it) => `${it.id}@${Number(it.position)}`).sort().join(",");
      const expected = m.rows.map((r) => `${r.id}@${r.position}`).sort().join(",");
      A.guardRead = { at: t, ms: Date.now() - t, status: 200, rev: snap.rev, ok: served === expected && Number(snap.rev) >= m.rev };
    } catch (e) {
      A.guardRead = { at: t, ms: Date.now() - t, status: Number(/HTTP (\d+)/.exec(e.message)?.[1] ?? 0), rev: null, ok: false, error: e.message };
    }
    if (!A.guardRead.ok) throw new Error(`measurement deployment ${BASE} does not serve the dev manifest (rev ${A.guardRead.rev ?? "—"}, ${A.guardRead.error ?? "rows differ"}) — no save written`);
    log(`measurement identity: ${BASE} serves the manifest's ${m.rows.length} rows at rev ${A.guardRead.rev}`);
  }
  const saveP = ADM.savesS.map((sec, i) => sleepUntil(T0 + sec * 1000).then(async () => {
    const song = songs[i];
    // Not retried (like the overlap drill): the schedule is the
    // experiment; a failed save is a gate failure, not something to hide.
    const r = await putSongRaw({ base: BASE, cookie, id: anchor.id, position: anchor.position, songId: song.id });
    if (r.error) saveFailures.push({ k: `a${i + 1}`, op: "put (admission)", attempt: 1, at: iso(r.startedAt), error: r.error });
    log(`admission save a${i + 1} (+${sec} s): ${r.status} rev ${r.rev ?? "—"} ${r.ms} ms`);
    return { k: `a${i + 1}`, i, offsetS: sec, song, ...r };
  }));
  // Join wait, concurrently with the saves.
  let joinedAt = null;
  let lastPrint = 0;
  while (true) {
    const sj = SUBS > 0 ? await subsConnected() : 0;
    const pj = pagePop.joined();
    if (sj >= SUBS && pj >= PAGES) { joinedAt = Date.now(); break; }
    if (Date.now() - T0 > JOIN_TIMEOUT_MS) { log("join timeout — the shortfall fails the join gate"); break; }
    if (Date.now() - lastPrint > 3000) { lastPrint = Date.now(); log(`  admitted: pages ${pj}/${PAGES} (launching), SDK connected ${sj}/${SUBS}`); }
    await sleep(250);
  }
  A.saves = await Promise.all(saveP);
  await pagesP;
  const ok = A.saves.filter((x) => isOkSave(x));
  if (ok.length) {
    const last = ok[ok.length - 1];
    await waitConverged(Math.max(...ok.map((x) => x.rev)), { songIds: [String(last.song.id)], until: last.startedAt + TIMEOUT_MS });
  }
  A.end = Date.now();
  const popSummary = {
    pagesJoined: pagePop.joined(), pagesPgReady: pagePop.pgReady(),
    ...(SUBS > 0 ? await subsProgress() : { joined: 0 }),
    allJoinedSec: joinedAt ? (joinedAt - T0) / 1000 : null, allPgReadySec: null,
  };
  log(`admission window done: ${JSON.stringify(popSummary)}`);
  A.T0 = T0;
  const admissionEdits = ok.map((x) => ({ k: x.k, mode: "admission", id: anchor.id, song: x.song, ins: null, put: { startedAt: x.startedAt, successAt: x.startedAt, ms: x.ms, rev: x.rev, attempts: 1 }, double: null }));
  return { popStart: T0, popSummary, settleStart: A.end, drillPageSet: new Set(), admission: A, admissionEdits };
}

// One save on the anchor row for the step-5 schedules (I1/I2/I3): not
// retried, recorded, logged. Returns the putSongRaw result + song.
async function anchorSave(k, song, mode, edits) {
  const r = await putSongRaw({ base: BASE, cookie, id: anchor.id, position: anchor.position, songId: song.id });
  if (r.error) saveFailures.push({ k, op: `put (${mode})`, attempt: 1, at: iso(r.startedAt), error: r.error });
  else edits.push({ k, mode, id: anchor.id, song, ins: null, put: { startedAt: r.startedAt, successAt: r.startedAt, ms: r.ms, rev: r.rev, attempts: 1 }, double: null });
  log(`save ${k} [${mode}]: ${r.status} rev ${r.rev ?? "—"} ${r.ms} ms`);
  return { ...r, song };
}

// Wait until every client of the given workers is connected (or the join
// timeout); returns the time they were.
async function waitCohort(list, n) {
  const from = Date.now();
  while (Date.now() - from < JOIN_TIMEOUT_MS) {
    if ((await subsConnected(list)) >= n) return Date.now();
    await sleep(200);
  }
  log(`cohort join timeout: ${await subsConnected(list)}/${n} connected`);
  return Date.now();
}

// ─── n14 step 5: I3, the admission run's final phase (--final-cohort) ───
// The pages leave; of the SDK population, the first `incumbents`
// connected clients stay connected (NOT stopped — the finalizer would
// otherwise stop every worker before the control) and every other client
// is stopped; then `fresh` new clients join at the qualified rate, 6 s
// after they are all connected a save, +40 s another save. Eligibility of
// the fresh cohort (connected 6 s … 90 s at the save) is decided post hoc
// (admission.mjs idleEligibility).
async function finalCohortPhase({ songs, edits }) {
  const fc = ADM.finalCohort;
  const F = { startedAt: Date.now(), wantIncumbents: fc.incumbents, fresh: fc.fresh, incumbents: [], saves: [] };
  if (PAGES > 0 && pagePop) {
    await pagePop.close();
    F.pagesClosedAt = Date.now();
  }
  const conn = (await Promise.all(workers.map((w) => w.ask("connected", "connected")))).flatMap((r) => r.idxs).sort((x, y) => x - y);
  F.incumbents = conn.slice(0, fc.incumbents);
  if (F.incumbents.length < fc.incumbents) log(`I3: only ${F.incumbents.length}/${fc.incumbents} incumbents connected`);
  await Promise.all(workers.map((w) => w.ask("retire", "retired", { keep: F.incumbents })));
  F.retiredAt = Date.now();
  const fw = spawnWorker({ offset: SUBS, n: fc.fresh, batch: Math.max(1, Math.min(SUB_BATCH, fc.fresh)), cohort: "fresh" });
  F.freshStartedAt = Date.now();
  F.freshReadyAt = await waitCohort([fw], fc.fresh);
  log(`I3: ${F.incumbents.length} incumbents kept, ${fc.fresh} fresh connected after ${F.freshReadyAt - F.freshStartedAt} ms; save in 6 s`);
  const p = await withPg(async (pg) => (await pg.query(`select position from "SetlistItem" where id = $1`, [anchor.id])).rows[0]?.position).catch(() => null);
  if (p != null) anchor.position = Number(p);
  await sleepUntil(F.freshReadyAt + 6000);
  const s1 = await anchorSave("f1", songs[0], "final", edits);
  await sleepUntil(s1.startedAt + 40000);
  const s2 = await anchorSave("f2", songs[1], "final", edits);
  F.saves = [s1, s2].map((x) => ({ status: x.status, rev: x.rev, startedAt: x.startedAt, ms: x.ms, song: x.song.id }));
  if (s2.rev != null) await waitConverged(s2.rev, { until: s2.startedAt + TIMEOUT_MS });
  F.endedAt = Date.now();
  return F;
}

// ─── n14 step 5: --drill=idle-broadcast (I1 / I2) ───
// SDK cohorts only (design §1.5). Nothing broadcasts before the first
// save: the login is not a save, and the anchor row is created BY the
// first measured save (insert-after = one save, one broadcast), so the
// idle period ends exactly there. I1: incumbents connect at
// --connect-at, first save at --first-save-at, quiet ≥ 40 s, then the
// --idle-saves PUTs (marker on the new anchor). I2 (--wake): the first
// save is the CHECK save — its rev must arrive by broadcast at every
// connected local client within --wake-check-timeout (else one retry
// save, then "escalate" is recorded); everyone stays connected; at first
// save + --wake-gap the fresh cohort joins; 6 s after it is connected a
// save, +40 s another.
async function mainIdle(runStart) {
  const I = IDLE;
  const pg = pgClient();
  await pg.connect();
  let songs;
  let startRev;
  try {
    original = await activeRows(pg, EVENT_ID);
    songs = await pickMarkerSongs(pg, I.wake ? 3 : I.savesS.length);
    startRev = Number((await pg.query(`select "setlistRevision" as r from "Event" where id = $1`, [EVENT_ID])).rows[0].r);
  } finally {
    await pg.end();
  }
  if (original.length < AFTER_ROW) throw new Error(`event ${EVENT_ID} has ${original.length} active rows, need ≥ ${AFTER_ROW}`);
  const afterPosition = original[AFTER_ROW - 1].position;
  cookie = await adminLogin(BASE);
  log(`idle-broadcast ${I.wake ? "I2 (wake)" : "I1"}: ${I.incumbents} incumbents connect at ${iso(I.connectAt)}, first save at ${I.firstSaveFile ? `the instant in --first-save-file ${I.firstSaveFile}` : iso(I.firstSaveAt)}${I.wake ? `, fresh ${I.fresh} at +${I.wakeGapS} s` : `, then +${I.savesS.join(" s, +")} s`}; start rev ${startRev}`);
  await sleepUntil(I.connectAt);
  const popStart = Date.now();
  const inc = spawnWorker({ offset: 0, n: I.incumbents, batch: I.incumbents, cohort: "incumbent" });
  if (I.firstSaveFile) {
    // Released at run time (see admission.mjs parseStep5Flags). Bounded:
    // past connect + max-age no client can be eligible any more.
    const giveUp = I.connectAt + I.maxAgeS * 1000;
    let lastLog = 0;
    while (!fs.existsSync(I.firstSaveFile)) {
      if (Date.now() > giveUp) throw new Error(`--first-save-file ${I.firstSaveFile} did not appear within --max-age of --connect-at — cycle NOT EXERCISED`);
      if (Date.now() - lastLog > 2000) { lastLog = Date.now(); log(`  incumbents connected ${await subsConnected([inc])}/${I.incumbents}; waiting for --first-save-file`); }
      await sleep(100);
    }
    const seenAt = Date.now();
    await sleep(50);
    I.firstSaveAt = firstSaveFromFile(fs.readFileSync(I.firstSaveFile, "utf8"), seenAt);
    log(`first save released for ${iso(I.firstSaveAt)}`);
  }
  while (Date.now() < I.firstSaveAt - 500) {
    log(`  incumbents connected ${await subsConnected([inc])}/${I.incumbents}`);
    await sleep(Math.min(2000, Math.max(0, I.firstSaveAt - 500 - Date.now())));
  }
  const connectedAtSave = await subsConnected([inc]);
  await sleepUntil(I.firstSaveAt);
  const edits = [];
  const events = [];
  // Save 1 = the anchor insert.
  let first;
  try {
    first = await insertAfter({ base: BASE, cookie, eventId: EVENT_ID, afterPosition });
  } catch (e) {
    saveFailures.push({ k: "s1", op: "insert-after (idle first save)", attempt: 1, at: iso(Date.now()), error: e.message });
    throw new Error(`idle first save failed (${e.message}) — cycle NOT EXERCISED`);
  }
  created.push(first.id);
  anchor = { id: first.id, position: first.position };
  edits.push({ k: "s1", mode: I.wake ? "idle-check" : "idle-first", id: first.id, song: { id: "blank", title: "(anchor insert: blank row)" }, ins: null, put: { startedAt: first.startedAt, successAt: first.startedAt, ms: first.ms, rev: first.rev, attempts: 1 }, double: null });
  log(`save s1 (anchor insert): rev ${first.rev} ${first.ms} ms`);
  let wake = null;
  let si = 0;
  if (!I.wake) {
    for (const [i, off] of I.savesS.entries()) {
      await sleepUntil(first.startedAt + off * 1000);
      await anchorSave(`s${i + 2}`, songs[si++], "idle", edits);
    }
  } else {
    wake = { check: [], escalate: null, fresh: null };
    const verify = async (rev) => {
      const until = Date.now() + I.wakeCheckS * 1000;
      let noted = 0;
      let conn = 0;
      while (true) {
        conn = await subsConnected([inc]);
        noted = await subsNoted(rev);
        if ((noted >= conn && conn > 0) || Date.now() > until) break;
        await sleep(200);
      }
      return { rev, noted, connected: conn, ok: conn > 0 && noted >= conn, at: Date.now() };
    };
    let chk = await verify(first.rev);
    wake.check.push({ save: "s1", ...chk });
    log(`wake check: rev ${first.rev} by broadcast at ${chk.noted}/${chk.connected} connected clients → ${chk.ok ? "ok" : "MISSED"}`);
    if (!chk.ok) {
      // The runbook rule: one retry save; still missing → escalate.
      events.push({ k: "s1", what: `check save rev ${first.rev} reached ${chk.noted}/${chk.connected} by broadcast within ${I.wakeCheckS} s — retry save`, at: iso(Date.now()) });
      const r = await anchorSave("s1r", songs[si++], "idle-check-retry", edits);
      if (r.rev != null) {
        chk = await verify(r.rev);
        wake.check.push({ save: "s1r", ...chk });
      }
      if (!chk.ok) {
        wake.escalate = "check save missed twice — escalate: the clients must be reloaded / reconnected before the show relies on them (README, wake procedure)";
        events.push({ k: "s1r", what: wake.escalate, at: iso(Date.now()) });
      }
    }
    await sleepUntil(first.startedAt + I.wakeGapS * 1000);
    const fw = spawnWorker({ offset: I.incumbents, n: I.fresh, batch: I.fresh, cohort: "fresh" });
    const freshStartedAt = Date.now();
    const freshReadyAt = await waitCohort([fw], I.fresh);
    wake.fresh = { n: I.fresh, startedAt: freshStartedAt, readyAt: freshReadyAt };
    log(`wake: fresh cohort ${I.fresh} connected after ${freshReadyAt - freshStartedAt} ms; save in 6 s`);
    await sleepUntil(freshReadyAt + 6000);
    const w1 = await anchorSave("w1", songs[si++], "idle-wake", edits);
    await sleepUntil(w1.startedAt + 40000);
    await anchorSave("w2", songs[si++], "idle-wake", edits);
  }
  const last = edits[edits.length - 1];
  if (last?.put.rev != null) await waitConverged(last.put.rev, { until: last.put.startedAt + TIMEOUT_MS });
  const editsEnd = Date.now();
  const popSummary = { pagesJoined: 0, pagesPgReady: 0, ...(await subsProgress()), allJoinedSec: null, allPgReadySec: null };
  return {
    runStart, popStart, settleStart: I.firstSaveAt, popSummary, edits, drillEvents: events, drillPageSet: new Set(), startRev,
    editsStart: first.startedAt, editsEnd, afterPosition, admission: null, finalPhase: null,
    idle: { cfg: I, connectedAtSave, wake },
  };
}

// ─── n14 step 6: --phase=transition ───
// Deployment transitions with open tabs (design §2; README "Transition
// phase"). The population joins on the dev ALIAS and settles; then, per
// switch file, the operator moves the alias at `plannedAt` (P) with
// `vercel alias set` and appends the CLI times + the target; the
// harness runs the predeclared timeline around P: saves at
// --transition-saves, the identity guard through the target's immutable
// URL as soon as the file names it (gating the next write), the route
// marker (live positive identification of the serving deployment), the
// controlled subsets, the arrivals at P + 10 s and the reaction / wish
// smoke from old pages. The probe runs for the whole window. Everything
// is recorded per response with its full `x-vercel-id`, so
// ../transition-join.mjs can attribute each one to a deployment from the
// Vercel request logs afterwards — the harness itself only classifies
// against a PROVISIONAL boundary (transition.mjs `boundaryOf`).
const txReactionIds = [];
const txWishIds = [];

// One recorded request from this main thread (probe, route marker,
// guard). The common per-response record — the shape the join reads
// (README "Transition phase" → records):
//   { pop, k, tStart, tHeaders, tBody, status, vercelId, xVercelCache,
//     cacheControl, age, source, verifyRaw, verifyKind, rev, bodyOk,
//     hint, minRev, locale, resolution, pin, dpl, bytes, error }
// `hint` is the minRev a hinted request sent; `resolution` what a
// client with no other state would compute (transition.mjs
// probeResolution); `dpl` = the document's data-dpl-id (route marker);
// `pin` = pin evidence of the request as sent (this process sends no
// header and no cookie: "none" unless the URL carries `dpl`).
async function txFetch(pop, url, { k = null, hint = null, minRev = null, locale = null, html = false, items = false } = {}) {
  const tStart = Date.now();
  const base = { pop, k, tStart, hint, minRev, locale, pin: pinEvidence(url, {}) };
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000), redirect: "manual" });
    const tHeaders = Date.now();
    const txt = await res.text();
    const tBody = Date.now();
    const h = (n) => res.headers.get(n);
    let rev = null;
    let bodyOk = false;
    let dpl = null;
    let served = null;
    if (html) {
      dpl = dplIdOf(txt);
      bodyOk = res.status === 200 && dpl != null;
    } else {
      try {
        const b = JSON.parse(txt);
        bodyOk = !!b && Array.isArray(b.items);
        rev = Number.isSafeInteger(b?.rev) ? b.rev : null;
        if (items && bodyOk) served = b.items.map((it) => `${it.id}@${Number(it.position)}`).sort().join(",");
      } catch { /* malformed: bodyOk stays false */ }
    }
    const verifyRaw = h("x-snapshot-verify");
    return {
      ...base, tHeaders, tBody, status: res.status, vercelId: h("x-vercel-id"), xVercelCache: h("x-vercel-cache"), cacheControl: h("cache-control"), age: h("age"),
      source: h("x-snapshot-source"), verifyRaw, verifyKind: html ? null : verifyKindOf(verifyRaw), rev, bodyOk,
      resolution: hint != null ? probeResolution(rev, hint, verifyRaw) : null, dpl, bytes: Buffer.byteLength(txt), error: null,
      ...(served != null ? { served } : {}),
    };
  } catch (e) {
    return { ...base, tHeaders: null, tBody: Date.now(), status: 0, vercelId: null, xVercelCache: null, cacheControl: null, age: null, source: null, verifyRaw: null, verifyKind: null, rev: null, bodyOk: false, resolution: null, dpl: null, bytes: null, error: String(e?.message || e).slice(0, 120) };
  }
}

const readSwitch = (p) => {
  try { return parseSwitchFile(fs.readFileSync(p, "utf8")); } catch { return null; }
};

// The probe population (design §2): one hinted fetch per
// --probe-interval on the alias from this thread, minRev = the latest
// CONFIRMED committed rev (a save's 2xx response), locales rotating.
// Fire-and-forget on a fixed schedule (a slow answer delays nothing).
function startProbe(T) {
  if (!TXC.probeIntervalMs) return async () => {};
  let stop = false;
  const pending = [];
  const loop = (async () => {
    const t0 = Date.now();
    for (let i = 0; !stop; i++) {
      const locale = ["ja", "ko", "en"][i % 3];
      const minRev = T.latestRev;
      pending.push(txFetch("probe", `${BASE}/api/setlist?eventId=${EVENT_ID}&locale=${locale}&minRev=${minRev}&hint=1`, { hint: minRev, minRev, locale }).then((r) => { T.probe.push(r); }));
      await sleepUntil(t0 + (i + 1) * TXC.probeIntervalMs);
    }
  })();
  return async () => { stop = true; await loop; await Promise.all(pending); };
}

// Live positive identification (transition.mjs firstTargetLive) on every
// route-marker answer and when the switch file completes.
function txDetect(L) {
  if (L.firstTarget || L.baselineDpl == null) return;
  const rows = L.route.filter((r) => r.phase !== "baseline" && r.dpl).map((r) => ({ reqStart: r.tStart, respAt: r.tBody, dpl: r.dpl, vercelId: r.vercelId }));
  const ft = firstTargetLive(rows, { baseline: L.baselineDpl, targetId: L.file?.target?.id ?? null, cliEnd: L.file?.cliEnd ?? null });
  if (!ft) return;
  L.firstTarget = { ...ft.row, how: ft.how, seenAt: Date.now() };
  log(`switch ${L.k}: first target response seen live (${ft.how}): ${ft.row.dpl} at +${((ft.row.respAt - L.plannedAt) / 1000).toFixed(1)} s`);
  L.onTarget?.(L.firstTarget);
}

// The route marker (design: positive live attribution): a document of
// the app that needs no database (/<locale>/privacy — Skew Protection
// stamps `data-dpl-id` on it), --route-marker per second over
// --route-window around P, plus one baseline read at the leg start (the
// incumbent's id). Labelled population `route`; outside every gate.
async function routeLoop(L) {
  if (!TXC.routeRate) return;
  const from = L.plannedAt + TXC.routeWindowS[0] * 1000;
  const to = L.plannedAt + TXC.routeWindowS[1] * 1000;
  const iv = 1000 / TXC.routeRate;
  const pending = [];
  for (let i = 0; ; i++) {
    const due = from + i * iv;
    if (due > to) break;
    await sleepUntil(due);
    const locale = ["ja", "ko", "en"][i % 3];
    pending.push(txFetch("route", `${BASE}/${locale}/privacy`, { k: L.k, locale, html: true }).then((r) => { L.route.push(r); txDetect(L); }));
  }
  await Promise.all(pending);
}

// Identity guard on the ACTUAL target (design §2): one generic read
// through the target's immutable URL, compared with the dev database's
// active rows (ids AND positions) and revision read just before it —
// an alias read could still reach the incumbent and falsely "verify"
// the target. Up to 3 attempts (a concurrent save between the DB read
// and the fetch shows as a mismatch). Gates the next write.
async function runGuard(L) {
  const g = { k: L.k, targetUrl: L.file.target.url, targetId: L.file.target.id, completeSeenAt: L.completeSeenAt, startedAt: Date.now(), attempts: [], ok: false, error: null };
  if (!isDeploymentBaseUrl(g.targetUrl)) {
    g.error = `target.url ${g.targetUrl} is not https://opensetlist-<hash>-opensetlist-projects.vercel.app`;
  } else {
    for (let a = 1; a <= 3 && !g.ok; a++) {
      let m;
      try { m = await withPg((pg) => readManifest(pg)); } catch (e) { g.attempts.push({ a, error: `pg: ${e.message}` }); continue; }
      const expected = m.rows.map((r) => `${r.id}@${r.position}`).sort().join(",");
      const r = await txFetch("guard", `${g.targetUrl}/api/setlist?eventId=${EVENT_ID}&locale=ko&minRev=${m.rev}`, { k: L.k, minRev: m.rev, locale: "ko", items: true });
      const ok = r.status === 200 && r.served === expected && r.rev != null && r.rev >= m.rev;
      g.attempts.push({ a, dbRev: m.rev, dbRows: m.rows.length, ok, rec: { ...r, served: undefined } });
      g.ok = ok;
      if (!ok) await sleep(500);
    }
    if (!g.ok) g.error = `target ${g.targetUrl} does not serve the dev manifest (${g.attempts.map((x) => x.error ?? `rev ${x.rec?.rev ?? "—"} vs db ${x.dbRev}, status ${x.rec?.status}`).join("; ")})`;
  }
  g.endedAt = Date.now();
  g.ms = g.endedAt - g.startedAt;
  L.guard = g;
  log(`switch ${L.k}: identity guard through ${g.targetUrl}: ${g.ok ? "ok" : `FAILED — ${g.error}`} (${g.ms} ms)`);
  return g;
}

// Switch-file watcher: keeps the latest parse; once cliStart / cliEnd /
// target are in, starts the guard (and re-runs the live detection: the
// target id may now disambiguate). Bounded: P + 180 s.
async function watchFile(L) {
  const giveUp = L.plannedAt + 180000;
  while (Date.now() < giveUp) {
    const p = readSwitch(L.path);
    if (p && !p.error) {
      L.file = p;
      if (p.complete) {
        L.completeSeenAt = Date.now();
        log(`switch ${L.k}: file complete — cli ${iso(p.cliStart)} → ${iso(p.cliEnd)} (${p.cliCpuMs ?? "—"} ms CPU), target ${p.target.id ?? "—"} ${p.target.url}`);
        txDetect(L);
        L.guardP = runGuard(L);
        await L.guardP;
        return;
      }
    }
    await sleep(200);
  }
  L.fileTimeout = true;
  log(`switch ${L.k}: the switch file never named cliStart / cliEnd / target (by P + 180 s) — the leg's exposure and guard are NOT EXERCISED`);
}

// Before a write: wait for a running guard; a failed guard stops the run
// (nothing more is written through an unproven deployment).
async function txGate(L) {
  if (!L.guardP) return 0;
  const t = Date.now();
  const g = await L.guardP;
  if (!g.ok) throw new Error(`switch ${L.k}: identity guard failed — ${g.error}; no further save written`);
  return Date.now() - t;
}

// Re-read the anchor's position (an after-return insert above it shifts
// it; the PUT writes `position`).
async function txAnchorPos() {
  const p = await withPg(async (pg) => (await pg.query(`select position from "SetlistItem" where id = $1`, [anchor.id])).rows[0]?.position).catch(() => null);
  if (p != null) anchor.position = Number(p);
}

function txRecordSave(T, L, s, r, extra) {
  const rec = {
    k: `${L.k}.${s.i}${extra.op === "put" ? "" : `-${extra.op}`}`, leg: L.k, i: s.i, op: extra.op, offS: s.offS, scheduledAt: s.due, quietDelayMs: s.quietDelayMs ?? 0,
    startedAt: r.startedAt, lateMs: r.startedAt - s.due, gatedMs: extra.gatedMs ?? 0, fromCliEndMs: null,
    ms: r.ms, headersMs: r.headersMs ?? null, status: r.status, rev: r.rev ?? null, vercelId: r.vercelId ?? null,
    rowId: extra.rowId ?? null, songId: extra.songId ?? null, error: r.error ?? null,
  };
  L.saves.push(rec);
  T.saves.push(rec);
  if (r.error) saveFailures.push({ k: rec.k, op: `${extra.op} (transition)`, attempt: 1, at: iso(r.startedAt), error: r.error });
  if (isOkSave(r) && r.rev != null && r.rev > T.latestRev) T.latestRev = r.rev;
  log(`switch ${L.k} save ${rec.k} [${extra.op}] P${s.offS >= 0 ? "+" : ""}${s.offS}s: ${r.status} rev ${r.rev ?? "—"} ${r.ms} ms (late ${rec.lateMs} ms${rec.gatedMs ? `, gated ${rec.gatedMs} ms by the guard` : ""}${rec.quietDelayMs ? `, delayed ${rec.quietDelayMs} ms by --leg-gap` : ""})`);
  return rec;
}

// The leg's saves: the PUT timeline on the anchor, then (switch file
// `afterSwitchSaves`) the INSERT / UPDATE / soft-DELETE, each its own
// save, --after-switch-gap apart after the last planned save. Never
// retried (the schedule is the experiment); sequential (each waits for
// the previous one and for the guard; the lateness is recorded).
async function legSaves(T, L) {
  const sched = saveSchedule(L.plannedAt, TXC.savesS);
  for (const s of sched) {
    const q = quietDue(s.due, T.prevLastSaveStart, TXC.legGapS);
    s.quietDelayMs = q.delayMs;
    if (q.delayMs) L.spacingViolated = true;
    await sleepUntil(q.due);
    const gatedMs = await txGate(L);
    const song = T.songs[T.si++];
    const r = await putSongRaw({ base: BASE, cookie, id: anchor.id, position: anchor.position, songId: song.id });
    const rec = txRecordSave(T, L, s, r, { op: "put", gatedMs, rowId: anchor.id, songId: String(song.id) });
    if (isOkSave(r)) T.edits.push({ k: rec.k, mode: "transition", id: anchor.id, song, ins: null, put: { startedAt: r.startedAt, successAt: r.startedAt, ms: r.ms, rev: r.rev, attempts: 1 }, double: null });
  }
  const after = L.file?.afterSwitchSaves ?? [];
  if (after.length) {
    const lastOff = TXC.savesS[TXC.savesS.length - 1];
    let row = null;
    let ins = null;
    let song = null;
    for (const [j, op] of after.entries()) {
      const offS = lastOff + (j + 1) * TXC.afterSwitchGapS;
      const s = { i: sched.length + j, offS, due: L.plannedAt + Math.round(offS * 1000) };
      await sleepUntil(s.due);
      const gatedMs = await txGate(L);
      if (op === "insert") {
        const r = await insertAfterRaw({ base: BASE, cookie, eventId: EVENT_ID, afterPosition: T.afterPosition });
        txRecordSave(T, L, s, r, { op, gatedMs, rowId: r.id });
        if (r.id) {
          created.push(r.id);
          row = { id: r.id, position: r.position };
          ins = r;
          await txAnchorPos();
        }
      } else if (op === "update") {
        if (!row) { L.warnings.push("update skipped: the insert failed"); continue; }
        song = T.songs[T.si++];
        const r = await putSongRaw({ base: BASE, cookie, id: row.id, position: row.position, songId: song.id });
        txRecordSave(T, L, s, r, { op, gatedMs, rowId: row.id, songId: String(song.id) });
        if (isOkSave(r)) T.edits.push({ k: `${L.k}.${s.i}-update`, mode: "transition-after", id: row.id, song, ins: ins && ins.rev != null ? { startedAt: ins.startedAt, successAt: ins.startedAt, ms: ins.ms, rev: ins.rev, attempts: 1, position: ins.position } : null, put: { startedAt: r.startedAt, successAt: r.startedAt, ms: r.ms, rev: r.rev, attempts: 1 }, double: null });
      } else if (op === "delete") {
        if (!row) { L.warnings.push("delete skipped: the insert failed"); continue; }
        const r = await softDeleteRaw({ base: BASE, cookie, id: row.id });
        txRecordSave(T, L, s, r, { op, gatedMs, rowId: row.id });
        if (isOkSave(r)) {
          // Gone on purpose: the page monotonicity check must not call the
          // marker's disappearance a regression from here on.
          if (song) T.allowGone.set(String(song.id), r.startedAt);
          const at = created.indexOf(row.id);
          if (at >= 0) created.splice(at, 1);
          await txAnchorPos();
        }
      }
    }
  }
  const last = L.saves[L.saves.length - 1];
  if (last) T.prevLastSaveStart = last.startedAt;
}

// Hold subset (controlled, design §2): armed 0.5 s before the first
// --hold-at wave; each wave's clients get a controlled `resume` fetch at
// P + its offset (dispatched while the incumbent still serves, if the
// operator is on time); every response that completes while armed is
// held client-side, released at the first target response seen live +
// 200 ms (or the cap), so "an old answer applied after the cutover, then
// a follow-up that converges" is produced even if natural traffic does
// not. The worker keeps every real deadline.
async function holdTask(T, L, targetSeen) {
  const w = T.holdWorker;
  const H = { idxs: T.holdIdxs, waves: waves(T.holdIdxs, TXC.hold.atS), armedAt: null, triggers: [], release: null, gate: null };
  L.hold = H;
  const P = L.plannedAt;
  await sleepUntil(P + Math.min(...TXC.hold.atS) * 1000 - 500);
  H.armedAt = (await w.ask("holdArm", "holdArmAck", { idxs: T.holdIdxs })).at;
  const trigP = H.waves.map(async (wv) => {
    await sleepUntil(P + wv.offS * 1000);
    const r = await w.ask("trigger", "triggerAck", { idxs: wv.idxs, reason: "resume" });
    H.triggers.push({ offS: wv.offS, at: r.at, ok: r.ok, idxs: wv.idxs });
  });
  const capAt = P + TXC.hold.capS * 1000;
  const first = await Promise.race([targetSeen, sleepUntil(capAt).then(() => null)]);
  const rel = releaseAt({ firstTargetAt: first?.respAt ?? null, plannedAt: P, capS: TXC.hold.capS });
  await sleepUntil(rel.at);
  const r = await w.ask("holdRelease", "holdReleaseAck", { why: rel.why });
  H.release = { at: r.at, plannedAt: rel.at, why: rel.why, released: r.released };
  H.gate = r.gate;
  log(`switch ${L.k}: hold subset released (${rel.why}); ${r.released} response(s) were held`);
  await Promise.all(trigP);
}

// Ahead-hint subset (controlled, before a return from R1): at each
// --ahead-hint-at offset its wave gets a SYNTHETIC hint (latest
// committed rev + --ahead-hint-offset) through the client's own
// broadcast path; on R1 the notification fetch is answered below the
// hint without a verify header → inconclusive → the recheck is queued
// (≥ 1 s) and lands across the switch. The scheduler state at P is
// recorded (the queued tickets). Excluded from every denominator.
async function aheadTask(T, L) {
  const w = T.aheadWorker;
  const P = L.plannedAt;
  const A = { idxs: T.aheadIdxs, waves: waves(T.aheadIdxs, TXC.ahead.atS), rev: null, injects: [], stateAtP: null };
  L.ahead = A;
  const injP = A.waves.map(async (wv) => {
    await sleepUntil(P + wv.offS * 1000);
    if (A.rev == null) {
      A.rev = T.latestRev + TXC.ahead.offset;
      T.syntheticRevs.add(A.rev);
    }
    const r = await w.ask("inject", "injectAck", { idxs: wv.idxs, rev: A.rev });
    A.injects.push({ offS: wv.offS, at: r.at, rev: A.rev, sent: r.sent, news: r.news });
  });
  const stP = (async () => {
    await sleepUntil(P);
    const st = await w.ask("state", "state");
    const mine = new Set(T.aheadIdxs);
    A.stateAtP = { at: Date.now(), clients: st.clients.filter((c) => mine.has(c.idx)).map((c) => ({ idx: c.idx, serverRev: c.serverRev, pendingHint: c.pendingHint, carriedHint: c.carriedHint, carriedHintPhase: c.carriedHintPhase, inFlight: c.inFlight, scheduledReason: c.scheduledReason, scheduledAt: c.scheduledAt })) };
  })();
  await Promise.all([...injP, stP]);
  log(`switch ${L.k}: ahead-hint rev ${A.rev} injected (${A.injects.map((x) => `${x.news}/${x.sent} news`).join(", ")}); at P ${A.stateAtP.clients.filter((c) => c.carriedHintPhase === "recheck").length}/${A.stateAtP.clients.length} tickets queued for a recheck`);
}

// Arrivals at P + 10 s (design §2): --arrivals pages + SDK clients join
// the alias; after a switch the operator marked `"kind":"r1"` the page
// part is the R1 cohort (--r1-cohort real R1 pages: whatever the alias
// serves R1 builds then; classified post hoc by behaviour). Retained to
// the end of the run (populations reported as they grow).
async function arrivalTask(T, L) {
  await sleepUntil(L.plannedAt + TXC.arrivals.atS * 1000);
  const r1 = L.kind === "r1" && TXC.r1Cohort > 0;
  const nPages = r1 ? TXC.r1Cohort : TXC.arrivals.pages;
  const nSdk = TXC.arrivals.sdk;
  const cohort = `${r1 ? "r1" : "arrival"}-${L.k}`;
  const A = { at: Date.now(), cohort, r1, sdk: null, pages: null };
  L.arrivals = A;
  if (nSdk > 0) {
    const e = spawnWorker({ offset: T.nextSubOffset, n: nSdk, batch: Math.max(1, Math.min(SUB_BATCH, nSdk)), cohort });
    A.sdk = { n: nSdk, worker: e.idx, offset: T.nextSubOffset };
    T.nextSubOffset += nSdk;
  }
  if (nPages > 0) {
    A.pages = { n: nPages, firstIdx: null, startedAt: Date.now(), doneAt: null };
    if (pagePop?.extend) {
      const r = await pagePop.extend({ count: nPages, cohort });
      A.pages.firstIdx = r.firstIdx;
    } else {
      pagePop = await launchPages({ count: nPages, base: BASE, eventPath: EVENT_PATH, eventId: EVENT_ID, localeOf: LOCALE_OF, routeMode: () => "none", headless: !args.headed, concurrency: PAGE_CONCURRENCY, log, admission: true, transition: true, cohort });
      A.pages.firstIdx = 0;
    }
    A.pages.doneAt = Date.now();
  }
  T.growth.push({ at: Date.now(), k: L.k, cohort, pages: pagePop?.pages.filter(Boolean).length ?? 0, sdk: T.nextSubOffset });
  log(`switch ${L.k}: arrivals ${cohort}: ${nPages} page(s) + ${nSdk} SDK; population now ${pagePop?.pages.filter(Boolean).length ?? 0} pages + ${T.nextSubOffset} SDK`);
}

// The anonymous identity of a smoke page (localStorage key of
// src/lib/anonId.ts), created like getAnonId() when the page has none.
const ANON_KEY = "opensetlist_anon_id";
const pageAnon = (i) => pagePop.evaluate(i, (key) => {
  let id = localStorage.getItem(key);
  if (!id) { id = crypto.randomUUID(); localStorage.setItem(key, id); }
  return id;
}, ANON_KEY).catch(() => null);

// Reaction / wish smoke from ONE OLD page per locale after the switch
// (design §2): from inside the page (its origin, cookies, localStorage —
// what the page's own UI would send): POST a reaction on the anchor
// with the page's anon id, read the counts back (refresh), POST a wish;
// then persistence (the reaction row in the DB with that anon id) and
// retained identity (the anon id before the switch = at the smoke =
// in the row). The reaction and the wish are deleted right away.
// A wish on an ongoing event is locked by design (403) — expected.
async function smokeTask(T, L) {
  if (!T.smokePages.length) return;
  const before = {};
  for (const i of T.smokePages) before[i] = await pageAnon(i);
  await sleepUntil(L.plannedAt + TXC.smokeAtS * 1000);
  for (const [j, i] of T.smokePages.entries()) {
    const type = REACTION_TYPES[(L.k + j) % REACTION_TYPES.length];
    const page = pagePop.pages[i];
    const out = { k: L.k, page: i, locale: page?.rec.locale ?? null, type, at: Date.now(), anonBeforeSwitch: before[i] ?? null };
    try {
      const r = await pagePop.evaluate(i, async ({ eventId, anchorId, type: rt, songId, key }) => {
        const rec = async (url, init) => {
          const tStart = Date.now();
          try {
            const res = await fetch(url, init);
            const tHeaders = Date.now();
            let body = null;
            try { body = await res.json(); } catch { /* not JSON */ }
            return { tStart, tHeaders, tBody: Date.now(), status: res.status, vercelId: res.headers.get("x-vercel-id"), body };
          } catch (e) {
            return { tStart, tHeaders: null, tBody: Date.now(), status: 0, vercelId: null, body: null, error: String(e).slice(0, 120) };
          }
        };
        const anon = localStorage.getItem(key);
        const post = await rec("/api/reactions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ setlistItemId: String(anchorId), reactionType: rt, anonId: anon }) });
        const counts = await rec(`/api/reactions?eventId=${eventId}`);
        const wish = await rec(`/api/events/${eventId}/wishes`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ songId: Number(songId) }) });
        const trim = (x, pick) => ({ ...x, body: x.body ? pick(x.body) : null });
        return {
          anon, anonAfter: localStorage.getItem(key),
          post: trim(post, (b) => ({ reactionId: b.reactionId ?? null, ackAt: b.ackAt ?? null, count: b.counts?.[rt] ?? null, error: b.error ?? null })),
          counts: trim(counts, (b) => ({ count: b?.[String(anchorId)]?.[rt] ?? 0 })),
          wish: trim(wish, (b) => ({ id: b.id ?? null, error: b.error ?? null })),
        };
      }, { eventId: EVENT_ID, anchorId: anchor.id, type, songId: T.wishSong.id, key: ANON_KEY });
      Object.assign(out, r ?? { error: "page gone" });
    } catch (e) {
      out.error = String(e?.message || e).slice(0, 160);
    }
    const reactionId = out.post?.body?.reactionId ?? null;
    if (reactionId) {
      txReactionIds.push(reactionId);
      try {
        const row = await withPg(async (pg) => (await pg.query(`select "anonId" as a, "reactionType" as t, "setlistItemId"::text as s from "SetlistItemReaction" where id = $1`, [reactionId])).rows[0] ?? null);
        out.persisted = row ? { anonId: row.a, type: row.t, item: row.s } : null;
      } catch (e) { out.persisted = { error: e.message }; }
      const d = await deleteReaction({ base: BASE, reactionId });
      out.reactionDelete = d.status;
      if (d.status >= 200 && d.status < 300) txReactionIds.splice(txReactionIds.indexOf(reactionId), 1);
    }
    const wishId = out.wish?.body?.id ?? null;
    if (wishId) {
      txWishIds.push(wishId);
      const d = await fetch(`${BASE}/api/events/${EVENT_ID}/wishes/${wishId}`, { method: "DELETE", signal: AbortSignal.timeout(15000) }).then((x) => x.status).catch(() => 0);
      out.wishDelete = d;
      if (d >= 200 && d < 300) txWishIds.splice(txWishIds.indexOf(wishId), 1);
    }
    const okPost = out.post && out.post.status >= 200 && out.post.status < 300 && !!reactionId;
    const wishOk = out.wish && ((out.wish.status >= 200 && out.wish.status < 300) || (out.wish.status === 403 && /locked/i.test(out.wish.body?.error ?? "")));
    out.checks = {
      submitted: okPost,
      persisted: !!out.persisted && out.persisted.anonId === out.anon,
      refreshed: (out.counts?.body?.count ?? 0) >= 1,
      identityRetained: out.anon != null && out.anon === out.anonBeforeSwitch && out.anon === out.anonAfter,
      wish: !!wishOk,
      no5xx: ![out.post, out.counts, out.wish].some((x) => x && x.status >= 500),
    };
    out.pass = Object.values(out.checks).every(Boolean);
    L.smoke.push(out);
    log(`switch ${L.k}: smoke page ${i} (${out.locale}): reaction ${out.post?.status ?? "—"}, wish ${out.wish?.status ?? "—"} → ${out.pass ? "ok" : `FAIL ${JSON.stringify(out.checks)}`}`);
  }
}

async function runLeg(T, k, filePath) {
  const L = { k, path: filePath, file: null, kind: null, plannedAt: null, seenAt: null, noticeS: null, completeSeenAt: null, fileTimeout: false, route: [], baselineDpl: null, firstTarget: null, saves: [], guard: null, guardP: null, hold: null, ahead: null, arrivals: null, smoke: [], warnings: [], spacingViolated: false };
  T.legs.push(L);
  log(`switch ${k}: waiting for ${filePath} (its plannedAt, ≥ ${TXC.noticeMinS} s ahead)`);
  let lastLog = Date.now();
  while (true) {
    const p = readSwitch(filePath);
    if (p && !p.error) { L.file = p; break; }
    if (Date.now() - lastLog > 30000) { lastLog = Date.now(); log(`  still waiting for ${filePath}${p?.error ? ` (${p.error})` : ""}`); }
    await sleep(200);
  }
  L.seenAt = Date.now();
  L.plannedAt = L.file.plannedAt;
  L.kind = L.file.kind;
  // Notice = how far ahead the operator WROTE the plan (the file's
  // mtime when the harness first read it; the harness may only reach
  // this leg later, e.g. after the previous one).
  let written = L.seenAt;
  try { written = Math.min(L.seenAt, fs.statSync(filePath).mtimeMs); } catch { /* keep seenAt */ }
  L.fileWrittenAt = Math.round(written);
  L.noticeS = (L.plannedAt - L.fileWrittenAt) / 1000;
  if (L.noticeS < TXC.noticeMinS) L.warnings.push(`short notice: plannedAt only ${L.noticeS.toFixed(1)} s after the file appeared (≥ ${TXC.noticeMinS} s predeclared)`);
  log(`switch ${k}: ${L.kind ?? "(no kind)"} ${L.file.label ?? ""} planned at ${iso(L.plannedAt)} (in ${((L.plannedAt - L.seenAt) / 1000).toFixed(1)} s; written ${L.noticeS.toFixed(1)} s ahead)${L.file.afterSwitchSaves.length ? `; after-switch saves ${L.file.afterSwitchSaves.join(", ")}` : ""}`);
  // Baseline: the incumbent's deployment id, as the alias serves it now.
  if (TXC.routeRate) {
    for (let a = 0; a < 3 && L.baselineDpl == null; a++) {
      const b = await txFetch("route", `${BASE}/ja/privacy`, { k, locale: "ja", html: true });
      b.phase = "baseline";
      L.route.push(b);
      L.baselineDpl = b.dpl;
    }
    if (L.baselineDpl == null) L.warnings.push("route marker baseline unreadable: no live identification this leg (boundary = cliEnd)");
  }
  // A plan that is already late would fire the missed saves as a burst
  // — a different experiment. Stop before anything of this leg runs.
  const firstDue = L.plannedAt + TXC.savesS[0] * 1000;
  if (firstDue < Date.now() - 2000) throw new Error(`switch ${k}: plannedAt ${iso(L.plannedAt)} leaves no time for the first save (due ${iso(firstDue)}, ${Math.round((Date.now() - firstDue) / 1000)} s ago) — write the plan ≥ ${TXC.noticeMinS} s ahead`);
  const targetSeen = new Promise((res) => { L.onTarget = res; });
  const tasks = [watchFile(L), routeLoop(L), arrivalTask(T, L), smokeTask(T, L)];
  if (T.holdWorker) tasks.push(holdTask(T, L, targetSeen));
  if (T.aheadWorker && L.kind === "return-from-r1") tasks.push(aheadTask(T, L));
  // The leg's background tasks (route window to P + 70 s, the file
  // watcher up to P + 180 s, smoke, arrivals) must not hold up the NEXT
  // leg's plan, which the operator may have scheduled right after this
  // leg's last save + --leg-gap: the caller moves on once the saves are
  // done and awaits `rest` before the window closes. Every task is
  // bounded; none outlives the run (after an abort they would otherwise
  // spawn arrivals into the teardown).
  const settleTasks = async () => {
    const res = await Promise.allSettled(tasks);
    for (const r of res) if (r.status === "rejected") L.warnings.push(`task failed: ${String(r.reason?.message ?? r.reason).slice(0, 160)}`);
    L.endedAt = Date.now();
    if (L.file?.cliEnd != null) for (const s of L.saves) s.fromCliEndMs = s.startedAt - L.file.cliEnd;
  };
  try {
    await legSaves(T, L);
  } catch (e) {
    await settleTasks();
    throw e;
  }
  return { L, rest: settleTasks() };
}

async function mainTransition(runStart) {
  const T = {
    cfg: TXC, legs: [], saves: [], probe: [], growth: [], edits: [], latestRev: null, prevLastSaveStart: null,
    syntheticRevs: new Set(), allowGone: new Map(), songs: [], si: 0, wishSong: null, smokePages: [],
    holdWorker: null, aheadWorker: null, holdIdxs: [], aheadIdxs: [], nextSubOffset: 0, manifest: null, manifestFile: null, anchor: null,
  };
  // DB: recorded rows + enough unused marker songs (every planned PUT of
  // every leg + one after-return UPDATE per leg + the wish song).
  const pg = pgClient();
  await pg.connect();
  let startRev;
  try {
    original = await activeRows(pg, EVENT_ID);
    T.songs = await pickMarkerSongs(pg, TXC.files.length * (TXC.savesS.length + 1) + 1);
    T.wishSong = T.songs.pop();
    startRev = Number((await pg.query(`select "setlistRevision" as r from "Event" where id = $1`, [EVENT_ID])).rows[0].r);
  } finally {
    await pg.end();
  }
  if (original.length < AFTER_ROW) throw new Error(`event ${EVENT_ID} has ${original.length} active rows, need ≥ ${AFTER_ROW}`);
  T.afterPosition = original[AFTER_ROW - 1].position;
  // ONE admin login (the firewall rate-limits the login route), then the
  // dedicated anchor (every timeline PUT writes its marker here; never
  // an original row), then the manifest the guards compare with.
  cookie = await adminLogin(BASE);
  const a = await insertAfter({ base: BASE, cookie, eventId: EVENT_ID, afterPosition: T.afterPosition });
  created.push(a.id);
  anchor = { id: a.id, position: a.position };
  T.anchor = { id: a.id, position: a.position, rev: a.rev };
  T.latestRev = a.rev ?? startRev;
  T.manifest = await withPg((pg2) => readManifest(pg2));
  T.latestRev = Math.max(T.latestRev, T.manifest.rev);
  const now = new Date();
  const dir = path.join(HERE, "..", "results", now.toISOString().slice(0, 10));
  fs.mkdirSync(dir, { recursive: true });
  T.manifestFile = path.join(dir, `${now.toISOString().replace(/[:.]/g, "-")}-transition-manifest.json`);
  fs.writeFileSync(T.manifestFile, JSON.stringify({ eventId: EVENT_ID, base: BASE, label: args.label ?? null, startRev, rev: T.manifest.rev, anchor: T.anchor, rows: T.manifest.rows, switchFiles: TXC.files, writtenAt: now.toISOString() }, null, 1));
  log(`transition prepare: anchor row ${a.id} @${a.position} (rev ${a.rev}); manifest ${T.manifest.rows.length} rows at rev ${T.manifest.rev}`);

  // Population (design §2): the natural SDK clients, then the two
  // controlled subsets in their own workers (cohorts "hold" / "ahead",
  // carved out of --subs), and the pages — all on the alias, 50/s.
  const popStart = Date.now();
  const nat = SUBS - TXC.hold.n - TXC.ahead.n;
  const per = Math.ceil(nat / SUB_WORKERS);
  const batchPer = Math.max(1, Math.round(SUB_BATCH / SUB_WORKERS));
  for (let off = 0; off < nat; off += per) spawnWorker({ offset: off, n: Math.min(per, nat - off), batch: batchPer, cohort: "incumbent" });
  T.nextSubOffset = nat;
  if (TXC.hold.n) {
    T.holdWorker = spawnWorker({ offset: T.nextSubOffset, n: TXC.hold.n, batch: Math.min(SUB_BATCH, TXC.hold.n), cohort: "hold" });
    T.holdIdxs = Array.from({ length: TXC.hold.n }, (_, i) => T.nextSubOffset + i);
    T.nextSubOffset += TXC.hold.n;
  }
  if (TXC.ahead.n) {
    T.aheadWorker = spawnWorker({ offset: T.nextSubOffset, n: TXC.ahead.n, batch: Math.min(SUB_BATCH, TXC.ahead.n), cohort: "ahead" });
    T.aheadIdxs = Array.from({ length: TXC.ahead.n }, (_, i) => T.nextSubOffset + i);
    T.nextSubOffset += TXC.ahead.n;
  }
  pagePop = PAGES > 0
    ? await launchPages({ count: PAGES, base: BASE, eventPath: EVENT_PATH, eventId: EVENT_ID, localeOf: LOCALE_OF, routeMode: () => "none", headless: !args.headed, concurrency: PAGE_CONCURRENCY, log, admission: true, transition: true, cohort: "incumbent" })
    : emptyPop();
  let joinedAt = null;
  let lastPrint = 0;
  while (true) {
    const sj = SUBS > 0 ? await subsConnected() : 0;
    const pj = pagePop.joined();
    if (sj >= SUBS && pj >= PAGES) { joinedAt = Date.now(); break; }
    if (Date.now() - popStart > JOIN_TIMEOUT_MS) { log("join timeout — measuring whoever joined"); break; }
    if (Date.now() - lastPrint > 3000) { lastPrint = Date.now(); log(`  joined: pages ${pj}/${PAGES} subs ${sj}/${SUBS}`); }
    await sleep(500);
  }
  const popSummary = { pagesJoined: pagePop.joined(), pagesPgReady: pagePop.pgReady(), ...(SUBS > 0 ? await subsProgress() : { joined: 0 }), allJoinedSec: joinedAt ? (joinedAt - popStart) / 1000 : null, allPgReadySec: null };
  T.growth.push({ at: Date.now(), k: null, cohort: "initial", pages: pagePop.pages.filter(Boolean).length, sdk: T.nextSubOffset });
  // Smoke pages: the first initial page of each locale.
  for (const loc of ["ja", "ko", "en"]) {
    const i = pagePop.pages.findIndex((p) => p && p.rec.locale === loc);
    if (i >= 0) T.smokePages.push(i);
  }
  const settleMs = args.settle === undefined ? 20000 : SETTLE_MS;
  log(`population: ${JSON.stringify(popSummary)}; settling ${settleMs / 1000}s`);
  const settleStart = Date.now();
  await sleep(settleMs);

  const stopProbe = startProbe(T);
  const editsStart = Date.now();
  const rests = [];
  try {
    for (const [k, f] of TXC.files.entries()) rests.push((await runLeg(T, k + 1, f)).rest);
    await Promise.all(rests);
  } catch (e) {
    await Promise.allSettled(rests);
    // A failed identity guard (or any error inside a leg) stops the
    // timeline, but the run still reports what it measured up to here
    // (verdict ABORTED, exit 2) — the evidence of WHY matters.
    T.aborted = e.message;
    log(`transition ABORTED: ${e.message}`);
  } finally {
    // The last saves' convergence (bounded), then the window closes.
    const lastPut = [...T.saves].reverse().find((s) => isOkSave(s));
    if (lastPut) await waitConverged(T.latestRev, { until: lastPut.startedAt + TXC.continuityMs });
    await stopProbe();
  }
  const editsEnd = Date.now();
  return {
    runStart, popStart, settleStart, popSummary, edits: T.edits, drillEvents: [], drillPageSet: new Set(), startRev,
    editsStart, editsEnd, afterPosition: T.afterPosition, admission: null, finalPhase: null, transition: T,
  };
}

// ─── n14 step 7: 5-minute spam + real saves (--phase=spam7) ───
// Timeline after readiness (the standard join + settle, anchor and guest
// included): baseline (--baseline-secs) → spam (--spam-secs) → recovery
// (--recovery-secs) → measurement end → clean-up. Every phase boundary is
// an explicit instant on THIS host's clock (state.spam7.phases) so the
// k6 background, the side-cars and the server logs can be lined up with
// it; the validity window, the failure accounting and the monotonicity
// check all run from the baseline start to the measurement end, and
// nothing is cleaned up before it (Codex round 1 item 3: the old spam
// drill closed its window before the spam finished, then cleaned up
// while measuring).
//
// The honest saves run on their own timer from the spam start
// (--save-offsets, P0 keeps the same schedule without a sender), each
// edit an independent task: a slow save never shifts the next one, and
// none is retried (a retried save would change which write the clock
// and the server logs refer to; a failure is recorded and gates the
// run). Pair edits (odd k): insert-after, then the PUT on the new row;
// standalone (even k): the PUT on the anchor row, its position re-read
// from the DB 2 s before the due time (pair inserts above it shift it).
const SPAM7_MAX_OUTSTANDING_ACKS = 20;
// Browser responsiveness: a page round trip (CDP → renderer → back)
// slower than this is a demonstrated browser stall (the DOM timestamps
// of every page are then suspect) → INVALID, like a Node thread's lag.
const SPAM7_BROWSER_INVALID_MS = LAG_INVALID_MS;
const SPAM7_BROWSER_EVERY_MS = 5000;

async function mainSpam7(runStart) {
  const C = S7;
  const pg = pgClient();
  await pg.connect();
  let songs;
  let startRev;
  try {
    original = await activeRows(pg, EVENT_ID);
    songs = await pickMarkerSongs(pg, C.edits);
    startRev = Number((await pg.query(`select "setlistRevision" as r from "Event" where id = $1`, [EVENT_ID])).rows[0].r);
  } finally {
    await pg.end();
  }
  if (original.length < AFTER_ROW) throw new Error(`event ${EVENT_ID} has ${original.length} active rows, need ≥ ${AFTER_ROW}`);
  const afterPosition = original[AFTER_ROW - 1].position;
  log(`event ${EVENT_ID}: ${original.length} active rows, rev ${startRev}; markers ${songs.map((s) => s.id).join(",")}`);

  const pop = await standardJoin({ startRev, afterPosition });

  // The post-preparation committed head: the `ahead` base and the
  // watermark check's "pre-existing" bound (NOT startRev — the anchor
  // insert already moved it). Plus the fixture as served: the snapshot at
  // that head must carry exactly the DB's active rows (ids in order), so
  // the declared population really reads the declared fixture.
  const prep = await withPg(async (pg2) => ({
    rev: Number((await pg2.query(`select "setlistRevision" as r from "Event" where id = $1`, [EVENT_ID])).rows[0].r),
    rows: await activeRows(pg2, EVENT_ID),
  }));
  let fixture;
  try {
    const snap = await getSnapshot(BASE, EVENT_ID, { locale: "ko", minRev: prep.rev });
    const served = (Array.isArray(snap.items) ? snap.items : []).map((it) => String(it.id));
    const db = prep.rows.map((r) => String(r.id));
    fixture = { startRows: original.length, dbRows: db.length, servedItems: served.length, servedRev: Number(snap.rev), head: prep.rev, match: Number(snap.rev) === prep.rev && served.join(",") === db.join(",") };
  } catch (e) {
    fixture = { startRows: original.length, dbRows: prep.rows.length, head: prep.rev, match: false, error: e.message };
  }
  log(`spam7 prepare: head ${prep.rev} (start ${startRev}); fixture ${JSON.stringify(fixture)}`);

  const S = {
    cfg: C, runId: RUN_ID, initialHead: prep.rev, fixture, afterPosition,
    sends: [], writes: [], edits: [], strata: [], stateSamples: [], browserProbe: [], hostChecks: [], headObserved: null, phases: {},
  };
  let latestRev = prep.rev;
  const noteRev = (r) => {
    if (Number.isSafeInteger(r) && r > latestRev) latestRev = r;
  };

  const baselineStart = Date.now();
  const spamStart = baselineStart + Math.round(C.baselineSecs * 1000);
  const attackEnd = spamStart + Math.round(C.spamSecs * 1000);
  // spamEnd = the scheduled attack end (also for P0, which sends nothing);
  // attackEndScheduled is the older alias.
  S.phases = { baselineStart, spamStart, spamEnd: attackEnd, attackEndScheduled: attackEnd };
  log(`spam7: baseline from ${iso(baselineStart)}, spam ${iso(spamStart)} → ${iso(attackEnd)} (scheduled)`);

  // Samplers (all stop at the measurement end).
  let sampling = true;
  // 1 Hz aggregated SDK worker state: pending batches, carried tickets,
  // in-flight ticket requests (the drain gate's "outstanding work").
  const stateLoop = (async () => {
    while (sampling && SUBS > 0) {
      const t0 = Date.now();
      try {
        S.stateSamples.push(aggregateState(t0, await subsState()));
      } catch { /* a worker gone: the sample is missing, the gate then sees "unknown" */ }
      await sleep(Math.max(0, 1000 - (Date.now() - t0)));
    }
  })();
  // Browser responsiveness: one page round trip every 5 s, rotating over
  // the pages ([t, page idx, rtt ms | null = no answer within 10 s]).
  const browserLoop = (async () => {
    let i = 0;
    while (sampling && PAGES > 0) {
      const t0 = Date.now();
      const idx = i++ % PAGES;
      const r = await Promise.race([pagePop.evaluate(idx, () => Date.now()).catch(() => null), sleep(10000).then(() => "timeout")]);
      S.browserProbe.push([t0, idx, r === "timeout" ? null : Date.now() - t0]);
      await sleep(Math.max(0, SPAM7_BROWSER_EVERY_MS - (Date.now() - t0)));
    }
  })();
  // The declared process: alive poll every 2 s (its end is recorded).
  const declaredLoop = (async () => {
    while (sampling && declared) {
      if (declared.endedAt == null && !pidAlive(DECLARED_PID)) {
        declared.endedAt = new Date().toISOString();
        log(`declared process ${DECLARED_PID} ended at ${declared.endedAt}`);
      }
      await sleep(2000);
    }
  })();

  // The honest saves.
  const saveTasks = C.offsets.map((off, i) => spam7Edit(S, i + 1, off, spamStart + Math.round(off * 1000), songs[i], noteRev));

  // stale (P3): just before the block, record whether every client has
  // observed the head the block will hold (SDK serverRev; pages: the
  // highest body rev they fetched). Not blocking — the eligibility rule
  // (rev ≤ the client's own serverRev at receipt) judges each receipt
  // regardless; this says how clean the control was.
  const headCheck = C.spamRev === "stale"
    ? sleepUntil(spamStart - 1500).then(async () => {
      const head = latestRev;
      const st = SUBS > 0 ? await subsState() : [];
      const now = Date.now();
      const pagesOk = pagePop.pages.filter((p) => p && (pageServerRevAt(p.rec.fetches, now) ?? -1) >= head).length;
      S.headObserved = { at: now, head, sdk: st.filter((c) => c.serverRev != null && c.serverRev >= head).length, sdkDeclared: SUBS, pages: pagesOk, pagesDeclared: PAGES };
      S.headObserved.verified = S.headObserved.sdk === SUBS && pagesOk === PAGES;
      log(`stale control: head ${head} observed by SDK ${S.headObserved.sdk}/${SUBS}, pages ${pagesOk}/${PAGES} (body-rev proxy)`);
    })
    : Promise.resolve();

  const midCheck = sleepUntil(spamStart + Math.round(C.spamSecs * 500)).then(() => recheckHost("mid-spam")).then((c) => S.hostChecks.push(c));

  // The sender.
  if (guest) {
    await sleepUntil(spamStart);
    log(`spam7: sender ${C.spamRev} ${C.spamRate}/s for ${C.spamSecs} s`);
    await spam7Sender(S, guest, () => latestRev);
  }
  const sent = S.sends.filter((s) => s.sentAt != null);
  S.phases.firstSend = sent.length ? sent[0].sentAt : null;
  // P0 (no sender) / nothing sent: the recovery boundary is the
  // scheduled attack end (design §0).
  S.phases.lastSend = sent.length ? sent[sent.length - 1].sentAt : attackEnd;
  const recoveryEnd = Math.max(attackEnd, S.phases.lastSend) + Math.round(C.recoverySecs * 1000);
  S.phases.recoveryEnd = recoveryEnd;
  if (guest) log(`spam7: sender done — ${sent.length}/${S.sends.length} sent, last ${iso(S.phases.lastSend)}; recovery until ${iso(recoveryEnd)}`);

  await Promise.all([...saveTasks, headCheck]);
  // Never cut the last save's arrivals off: the measurement ends at the
  // recovery end or the last PUT's timeout, whichever is later.
  const lastPut = S.edits.reduce((a, e) => Math.max(a, e.put.startedAt), 0);
  const measurementEnd = Math.max(recoveryEnd, lastPut ? lastPut + TIMEOUT_MS : 0);
  await sleepUntil(measurementEnd);
  S.phases.measurementEnd = measurementEnd;
  await midCheck;
  S.hostChecks.push(await recheckHost("measurement end"));
  sampling = false;
  await Promise.all([stateLoop, browserLoop, declaredLoop]);
  S.edits.sort((a, b) => a.k - b.k);
  log(`spam7: measurement end ${iso(measurementEnd)}`);
  return {
    runStart, popStart: pop.popStart, settleStart: pop.settleStart, popSummary: pop.popSummary, edits: S.edits, drillEvents: [], drillPageSet: new Set(),
    startRev, editsStart: baselineStart, editsEnd: measurementEnd, afterPosition, admission: null, finalPhase: null, spam7: S,
  };
}

// The sender (design §1): slot k due at spamStart + (k − 1) / rate; the
// payload `{ kind: "setlist", rev, runId, k }`. Per message: slot time,
// actual send time, forged rev, ack result + latency, or why the slot was
// skipped ("late" = the loop itself was > one interval behind — it never
// bursts to catch up; "acks outstanding" = more than
// SPAM7_MAX_OUTSTANDING_ACKS unanswered sends, i.e. Realtime stopped
// acknowledging; "closed" = the guest was closed by the clean-up).
async function spam7Sender(S, g, latest) {
  const C = S.cfg;
  const slots = slotSchedule(S.phases.spamStart, C.spamRate, C.spamSecs);
  const interval = 1000 / C.spamRate;
  const acks = [];
  let outstanding = 0;
  for (const s of slots) {
    if (Date.now() < s.slotAt) await sleep(s.slotAt - Date.now());
    const row = { k: s.k, slotAt: s.slotAt, sentAt: null, rev: null, ack: null, ackMs: null, skip: null };
    S.sends.push(row);
    if (g.closed) { row.skip = "closed"; continue; }
    if (Date.now() > s.slotAt + interval) { row.skip = "late"; continue; }
    if (outstanding >= SPAM7_MAX_OUTSTANDING_ACKS) { row.skip = "acks outstanding"; continue; }
    row.rev = forgedRev(C.spamRev, latest());
    row.sentAt = Date.now();
    outstanding++;
    acks.push(g.fire({ kind: "setlist", rev: row.rev, runId: RUN_ID, k: s.k }).then(({ result, ms: m }) => {
      row.ack = result;
      row.ackMs = m;
      outstanding--;
    }));
  }
  await Promise.all(acks);
}

// One step-7 edit (see the section header). Writes are recorded in
// S.writes ([every attempt, failed ones included]); a committed edit goes
// to S.edits in the shape the per-save code expects. The SDK strata are
// sampled at the PUT dispatch: the state request is posted right before
// the PUT and answered by the worker threads while it runs (a few ms
// after its start), so the PUT itself is not delayed.
async function spam7Edit(S, k, off, due, song, noteRev) {
  const mode = modeOf(k);
  if (mode === "standalone") {
    await sleepUntil(due - 2000);
    const p = await withPg(async (pg) => (await pg.query(`select position from "SetlistItem" where id = $1`, [anchor.id])).rows[0]?.position)
      .catch((e) => { log(`  anchor position read failed (${e.message}); using tracked ${anchor.position}`); return null; });
    if (p != null) anchor.position = Number(p);
  }
  await sleepUntil(due);
  const rec = (op, r, extra = {}) => {
    const w = { k, op, mode, offsetS: off, due, startedAt: r.startedAt, lateMs: r.startedAt - due, ms: r.ms, status: r.status, rev: r.rev ?? null, error: r.error ?? null, vercelId: r.vercelId ?? null, ...extra };
    S.writes.push(w);
    if (w.error) saveFailures.push({ k, op, attempt: 1, at: iso(r.startedAt), error: w.error });
    return w;
  };
  let ins = null;
  if (mode === "pair") {
    const r = await insertAfterRaw({ base: BASE, cookie, eventId: EVENT_ID, afterPosition: S.afterPosition });
    rec("insert", r, { rowId: r.id });
    if (r.error || !r.id) {
      log(`edit ${k}: insert-after FAILED (${r.error}) — not retried; the edit is lost`);
      // A 5xx can come after the commit: adopt such a row for the clean-up
      // (never for the measurement).
      const orphan = await withPg((pg) => findUnacknowledgedInsert(pg, EVENT_ID, {
        sinceMs: r.startedAt, position: S.afterPosition + 1, knownIds: new Set([...created, ...original.map((x) => x.id)]),
      })).catch(() => null);
      if (orphan) {
        created.push(orphan.id);
        S.writes[S.writes.length - 1].orphanRowId = orphan.id;
      }
      return;
    }
    created.push(r.id);
    noteRev(r.rev);
    if (anchor && anchor.position >= r.position) anchor.position++;
    ins = { startedAt: r.startedAt, successAt: r.startedAt, ms: r.ms, id: r.id, position: r.position, rev: r.rev, attempts: 1 };
  }
  const target = mode === "pair" ? ins : anchor;
  const stateAsked = Date.now();
  const stP = SUBS > 0 ? subsState().then((cl) => ({ at: Date.now(), cl })).catch(() => null) : Promise.resolve(null);
  const r = await putSongRaw({ base: BASE, cookie, id: target.id, position: target.position, songId: song.id });
  const w = rec("put", r, { rowId: target.id, songId: String(song.id) });
  const st = await stP;
  if (r.error) {
    log(`edit ${k}: PUT FAILED (${r.error}) — not retried; the edit is lost`);
    return;
  }
  if (r.rev == null) w.rev = r.rev = (await getSnapshot(BASE, EVENT_ID)).rev;
  noteRev(r.rev);
  // Strata rows: [client idx, stratum, carried phase, in-flight reason].
  S.strata.push({
    k, rev: r.rev, putStart: r.startedAt, askedAt: stateAsked, answeredAt: st?.at ?? null,
    clients: st ? st.cl.map((c) => [c.idx, classifyStratum(c), c.carriedHintPhase ?? null, c.inFlight ? c.inFlightReq?.reason ?? "untracked" : null]) : null,
  });
  const edit = { k, mode, id: target.id, song, ins, put: { startedAt: r.startedAt, successAt: r.startedAt, ms: r.ms, rev: r.rev, attempts: 1 }, double: null, offsetS: off, due };
  S.edits.push(edit);
  log(`edit ${k} [${mode}] @${off >= 0 ? "+" : ""}${off} s: row ${target.id}${ins ? ` insert ${ins.ms} ms (rev ${ins.rev})` : ""} → song ${song.id} put ${r.ms} ms (rev ${r.rev})`);
}

// ─── main ───
async function main() {
  const runStart = Date.now();
  await hostGuard();
  log(IDLE
    ? `browsers run: base=${BASE} event=${EVENT_ID} drill=idle-broadcast (SDK cohorts only; --pages / --subs / --edits not used)`
    : `browsers run: base=${BASE} event=${EVENT_ID} pages=${PAGES} subs=${SUBS} (workers=${SUB_WORKERS}) edits=${EDITS} pause=${PAUSE_MS}ms drill=${DRILL ?? "none"}${ADM ? ` phase=admission (prepare via ${PREP_BASE})` : ""}`);
  if (IDLE) return await mainIdle(runStart);
  if (S7) {
    log(`phase=spam7: baseline ${S7.baselineSecs} s → spam ${S7.spamRev} ${S7.spamRate}/s × ${S7.spamSecs} s → recovery ${S7.recoverySecs} s; ${S7.edits} mixed edit(s) at spam ${S7.offsets.map((o) => (o >= 0 ? `+${o}` : `${o}`)).join(",")} s; declared process ${DECLARED_PID ?? "none"}; --edits / --pause not used`);
    return await mainSpam7(runStart);
  }
  if (TXC) {
    log(`phase=transition: ${TXC.files.length} switch file(s) ${TXC.files.join(", ")}; saves at P${TXC.savesS.map((s) => (s >= 0 ? `+${s}` : `${s}`)).join(",")} s; arrivals ${TXC.arrivals.pages} pages + ${TXC.arrivals.sdk} SDK at P+${TXC.arrivals.atS} s (R1 cohort ${TXC.r1Cohort}); subsets hold ${TXC.hold.n}, ahead-hint ${TXC.ahead.n} (of --subs); --edits not used`);
    return await mainTransition(runStart);
  }

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
    // admission: one marker per admission save first, then the steady
    // edits', then the two I3 saves (--final-cohort).
    songs = OVERLAP
      ? await pickMarkerSongs(pg, EDITS * (rolesOf(OV).length - (OV.catalogAtMs > 0 ? 1 : 0)))
      : ADM
        ? await pickMarkerSongs(pg, ADM.savesS.length + EDITS + (ADM.finalCohort ? 2 : 0))
        : await pickMarkerSongs(pg, EDITS + (DRILL === "double-save" ? 1 : 0));
    startRev = Number((await pg.query(`select "setlistRevision" as r from "Event" where id = $1`, [EVENT_ID])).rows[0].r);
  } finally {
    await pg.end();
  }
  if (original.length < AFTER_ROW) throw new Error(`event ${EVENT_ID} has ${original.length} active rows, need ≥ ${AFTER_ROW}`);
  const afterPosition = original[AFTER_ROW - 1].position;
  log(`event ${EVENT_ID}: ${original.length} active rows, rev ${startRev}; inserting after row ${AFTER_ROW} (position ${afterPosition}); markers ${songs.map((s) => s.id).join(",")}`);

  // Start: the standard join, or step 5's prepare → boundary → admit.
  const pop = ADM
    ? await admissionPhase({ startRev, afterPosition, songs: songs.slice(0, ADM.savesS.length) })
    : await standardJoin({ startRev, afterPosition });
  if (ADM) songs = songs.slice(ADM.savesS.length);
  const { popStart, popSummary, settleStart, drillPageSet } = pop;
  // overlap: 3 control reloads of the admin editor before the first group.
  const ovReloadControls = [];
  if (OVERLAP && OV.reloadAt.length) ovReloadControls.push(...(await controlReloads(3, "before")));

  // Edits. Admission: the admission saves are already in (mode
  // "admission"), so the per-save tables, the hint accounting, the DOM
  // monotonicity and the warm section cover them unchanged.
  const edits = [...(pop.admissionEdits ?? [])];
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
  // I3 (--final-cohort): before the edit window closes, so its saves are
  // inside the validity window and the monotonicity check.
  let finalPhase = null;
  if (ADM?.finalCohort) finalPhase = await finalCohortPhase({ songs: songs.slice(EDITS, EDITS + 2), edits });
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
    admission: pop.admission, finalPhase,
    ...(OVERLAP ? { overlap: { groups: ovGroups, controls: ovReloadControls, tail: ovTail, reactionPage: ovReactionPage >= 0 ? ovReactionPage : null } } : {}),
  };
}

async function finalize(state, aborted) {
  if (finalized) return null;
  finalized = true;
  log(aborted ? `aborting (${aborted}) — cleaning up` : "cleaning up");
  if (guest) await guest.close();
  // transition: smoke reactions / wishes whose immediate delete failed
  // (normally none are left).
  let txClean = null;
  if (TXC && (txReactionIds.length || txWishIds.length)) {
    txClean = { reactions: [], wishes: [] };
    for (const id of [...txReactionIds]) txClean.reactions.push([id, (await deleteReaction({ base: BASE, reactionId: id })).status]);
    for (const id of [...txWishIds]) txClean.wishes.push([id, await fetch(`${BASE}/api/events/${EVENT_ID}/wishes/${id}`, { method: "DELETE", signal: AbortSignal.timeout(15000) }).then((x) => x.status).catch(() => 0)]);
    log(`transition cleanup: reactions ${JSON.stringify(txClean.reactions)}, wishes ${JSON.stringify(txClean.wishes)}`);
  }
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
  return { clean, verify, subRecs, pageRecs, ovClean, txClean };
}

// ─── n14 step 5: report sections ───
// Compact per-client records (JSON `admission.sdk` / `idle.sdk`, the
// input of ../admission-join.mjs): the subscription timeline, the first
// request and the first successful snapshot, every valid raw broadcast
// receipt and every applied snapshot. Tiny per client (no bodies).
function compactSdk(r) {
  const reqs = r.reqs || [];
  const q0 = reqs[0] ?? null;
  const ok = reqs.find((q) => q[6] === 200 && q[11] === "ok") ?? null;
  return {
    idx: r.idx, worker: r.worker ?? null, cohort: r.cohort ?? null, locale: r.locale,
    attemptAt: r.attemptAt, subscribedAt: r.subscribedAt, connLog: r.connLog ?? null, stoppedAt: r.stoppedAt ?? null,
    fallbacks: r.fallbacks, recreates: r.recreates ?? [],
    // The client's FIRST request (its `initial` fetch): start, status,
    // body rev — the "first answer" of the stale-first-answer count.
    first: q0 ? { reqStart: q0[0], reason: q0[1], status: q0[6], rev: q0[8], source: q0[12], respAt: q0[10], bytes: q0[15] ?? null, outcome: q0[11] } : null,
    // The first SUCCESSFUL snapshot (time-to-first-snapshot).
    firstOk: ok ? { reqStart: ok[0], reason: ok[1], respAt: ok[10], rev: ok[8], source: ok[12], bytes: ok[15] ?? null } : null,
    bcasts: (r.bcasts || []).filter(([, rev]) => rev != null),
    applied: r.appliedAll || [],
    http5xx: reqs.filter((q) => q[6] >= 500).length,
    http503: reqs.filter((q) => q[6] === 503).length,
    failKinds: r.failKinds || {},
  };
}

// Compact per-page record (JSON `admission.pages`). `markers` = the
// run's marker song ids (only those `seen` times are kept).
function compactPage(r, expected, until, markers) {
  const c = completeAt(r.rowsLog, expected, until);
  let first = null;
  for (const f of r.fetches) {
    const st = f[7] ?? f[0];
    if (!first || st < first.reqStart) first = { reqStart: st, status: f[2], source: f[3], rev: f[4] };
  }
  const hyd = [r.firstApiReqAt, r.wsOpenAt].filter((x) => x != null);
  const seen = {};
  for (const id of markers) if (r.seen[id] != null) seen[id] = r.seen[id];
  return {
    idx: r.idx, locale: r.locale, wave: r.wave ?? null, launchedAt: r.launchedAt ?? r.openedAt,
    navStart: r.navStart ?? null, ttfbMs: r.ttfbMs ?? null, dclMs: r.dclMs ?? null, docStatus: r.docStatus ?? null, docBytes: r.docBytes ?? null,
    seed: r.seed ?? { kind: "unknown", rev: null },
    completeAt: c.t, completeMs: c.t != null && r.navStart != null ? c.t - r.navStart : null, matched: c.matched, total: c.total,
    hydratedAt: hyd.length ? Math.min(...hyd) : null,
    hydratedMs: hyd.length && r.navStart != null ? Math.min(...hyd) - r.navStart : null,
    firstFetch: first, joinAt: r.joinAt, seen,
    http5xx: (r.docStatus >= 500 ? 1 : 0) + r.fetches.filter((f) => f[2] >= 500).length,
    http503: (r.docStatus === 503 ? 1 : 0) + r.fetches.filter((f) => f[2] === 503).length,
    errors: r.errors.slice(0, 5),
  };
}

// The step-5 save list (every committed save of the run, in order):
// putStart = the FIRST attempt's start (the gate's clock), putEnd = the
// successful attempt's response on this host (the commit's upper bound).
const saveListOf = (edits) => edits.map((e) => ({
  k: e.k, mode: e.mode, rev: e.put.rev, songId: String(e.song.id), rowId: e.id,
  putStart: e.put.startedAt, putEnd: (e.put.successAt ?? e.put.startedAt) + (e.put.ms ?? 0), putMs: e.put.ms ?? null,
}));

// One cohort control (I1 / I2 / I3): eligibility of `cohort` for `save`,
// arrival rows for every client of `clients`, and the verdict: NOT
// EXERCISED unless the predeclared eligibility holds; then PASS iff
// every eligible client received the save's raw broadcast AND applied it
// within the timeout (else FAIL — the idle-broadcast defect, with the
// repair that brought the client forward measured).
function cohortCycle(name, save, cohort, clients, { maxAgeS, timeoutMs }) {
  const elig = idleEligibility(cohort, save, { maxAgeS });
  const rows = idleArrivals(clients, save, { timeoutMs });
  const eligSet = new Set(elig.per.filter((p) => p.eligible).map((p) => p.idx));
  const eligRows = rows.filter((r) => eligSet.has(r.idx));
  const sum = summarizeArrivals(eligRows);
  const verdict = !elig.exercised ? "NOT EXERCISED" : sum.received === sum.n && sum.applied === sum.n ? "PASS" : "FAIL";
  return { name, save, elig, rows, eligible: sum, all: summarizeArrivals(rows), verdict, maxAgeS };
}

function cycleLines(c) {
  const out = [];
  const s = c.save;
  out.push(`#### ${c.name} — save ${s.k} rev ${s.rev} at ${iso(s.putStart)} (PUT ${s.putMs} ms): **${c.verdict}**`);
  out.push("");
  out.push(`- Eligibility (connected 6 s … ${c.maxAgeS} s before the save, without interruption through its response): ${c.elig.eligible}/${c.elig.total} eligible; cohort first-SUBSCRIBED spread ${c.elig.spreadS == null ? "—" : `${c.elig.spreadS.toFixed(1)} s`} (≤ 30 s: ${c.elig.spreadOk ? "yes" : "**no**"})${c.elig.per.filter((p) => !p.eligible).length ? `; not eligible: ${c.elig.per.filter((p) => !p.eligible).slice(0, 6).map((p) => `${p.idx} (${p.why})`).join(", ")}` : ""}`);
  out.push(`- Eligible clients: raw broadcast received ${c.eligible.received}/${c.eligible.n} (PUT response → receipt p50 / p95 / max ${ms(c.eligible.bcast.p50)} / ${ms(c.eligible.bcast.p95)} / ${ms(c.eligible.bcast.max)} ms); applied ${c.eligible.applied}/${c.eligible.n}, by ${JSON.stringify(c.eligible.reasons)}; repair (applied without the broadcast; healthy periodic poll 20 s ± 4 s — measured, not a bound) p50 / max ${ms(c.eligible.repair.p50)} / ${ms(c.eligible.repair.max)} ms (n ${c.eligible.repair.n})`);
  out.push(`- All local clients of the run on this save: received ${c.all.received}/${c.all.n}, applied ${c.all.applied}/${c.all.n} by ${JSON.stringify(c.all.reasons)}`);
  out.push("");
  out.push("| client | cohort | connected since (UTC) | age at save s | eligible | broadcast ms after PUT response | applying fetch | apply ms after PUT start | repair ms |");
  out.push("|---|---|---|---|---|---|---|---|---|");
  for (const r of c.rows) {
    const e = c.elig.per.find((p) => p.idx === r.idx);
    out.push(`| ${r.idx} | ${r.cohort ?? "—"} | ${e ? iso(e.since) : "—"} | ${e?.ageS == null ? "—" : e.ageS.toFixed(1)} | ${e ? (e.eligible ? "yes" : `no — ${e.why}`) : "(other cohort)"} | ${ms(r.bcastMs)} | ${r.reason} | ${ms(r.applyMs)} | ${ms(r.repairMs)} |`);
  }
  out.push("");
  return out;
}

const I3_MAX_AGE_S = 90;

function admissionReport(state, fin, { valid, idx, monotonicPass }) {
  const A = state.admission;
  const T0 = A.T0;
  const markers = [...new Set(state.edits.map((e) => String(e.song.id)))];
  const anchorMarkers = state.edits.filter((e) => e.id === A.anchor.id).map((e) => String(e.song.id));
  const expected = expectedRows(A.manifest.rows, { [A.anchor.id]: ["", ...anchorMarkers] });
  // After the first steady edit the expected rows change (a pair edit
  // inserts a row): the complete-setlist check only looks before it.
  const until = EDITS > 0 ? state.editsStart : Infinity;
  const sdk = fin.subRecs.map(compactSdk);
  const sdkMain = sdk.filter((c) => c.cohort !== "fresh");
  const pages = fin.pageRecs.map((r) => compactPage(r, expected, until, markers));
  const pagesClosedAt = state.finalPhase?.pagesClosedAt ?? Infinity;
  const saves = saveListOf(state.edits).map((sv) => {
    const sx = sdkExposure(sdk, sv, { min: ADM.sdkMin });
    const px = pageExposure(pages, sv, { min: ADM.pagesMin });
    const lbl = exposureLabel(sx, px);
    return {
      ...sv,
      label: sv.mode === "final" ? `I3 final phase (${lbl})` : lbl,
      sdkExposure: sx, pageExposure: px,
      sdkConv: sdkConvergence(sdk, sv, { timeoutMs: TIMEOUT_MS }),
      pageConv: sv.putStart < pagesClosedAt && pages.length ? pageConvergence(pages, sv, { timeoutMs: TIMEOUT_MS, replacedBy: idx.replacedBy }) : null,
      stale: staleFirstAnswers(sdkMain, pages, sv),
      receipt: receiptVsReason(sdk, sv),
    };
  });
  const scheduled = A.saves.map((x) => ({ k: x.k, offsetS: x.offsetS, status: x.status, rev: x.rev, ms: x.ms, startedAt: x.startedAt, lateMs: x.startedAt - (T0 + x.offsetS * 1000), error: x.error ?? null }));
  const nonFinal = saves.filter((s) => s.mode !== "final");
  const sdkExercised = nonFinal.some((s) => s.sdkExposure.exposed);
  const pageExercised = nonFinal.some((s) => s.pageExposure.exposed);

  // ── gates ──
  const httpFail = (e) => /HTTP 5\d\d/.test(e ?? "");
  const fivexx = {
    saves: A.saves.filter((x) => x.status >= 500).length + saveFailures.filter((f) => !String(f.op).includes("admission") && httpFail(f.error)).length,
    pages: pages.reduce((a, p) => a + p.http5xx, 0),
    sdk: sdk.reduce((a, c) => a + c.http5xx, 0),
    guard: A.guardRead && A.guardRead.status >= 500 ? 1 : 0,
  };
  const s503 = { pages: pages.reduce((a, p) => a + p.http503, 0), sdk: sdk.reduce((a, c) => a + c.http503, 0), saves: A.saves.filter((x) => x.status === 503).length };
  const fivexxTotal = Object.values(fivexx).reduce((a, v) => a + v, 0);
  const s503Total = Object.values(s503).reduce((a, v) => a + v, 0);
  const transport = A.saves.filter((x) => x.status === 0).length + saveFailures.filter((f) => !/HTTP \d/.test(f.error ?? "") && !String(f.op).includes("admission")).length;
  const sdkJoined = sdkMain.filter((c) => firstSub(c) != null && firstSub(c) - T0 <= JOIN_TIMEOUT_MS).length;
  const pagesJoined = pages.filter((p) => p.joinAt?.length && p.joinAt[0] - T0 <= JOIN_TIMEOUT_MS).length;
  const completeD = dist(pages.map((p) => p.completeMs).filter((v) => v != null));
  const incomplete = pages.filter((p) => p.completeAt == null);
  const seedKinds = pages.reduce((a, p) => ((a[p.seed.kind] = (a[p.seed.kind] || 0) + 1), a), {});
  const degraded = ADM.expectLiveSeed ? pages.filter((p) => p.seed.kind !== "live").length : 0;
  const firstSnap = dist(sdkMain.map((c) => (c.firstOk ? c.firstOk.respAt - c.attemptAt : null)).filter((v) => v != null));
  const noFirst = sdkMain.filter((c) => !c.firstOk).length;
  const pool = (f) => saves.flatMap(f);
  const convSdkBefore = { ...dist(pool((s) => s.sdkConv.before.values)), missing: saves.reduce((a, s) => a + s.sdkConv.before.missing, 0) };
  const convSdkAfter = { ...dist(pool((s) => s.sdkConv.after.values)), missing: saves.reduce((a, s) => a + s.sdkConv.after.missing, 0) };
  const convPgBefore = { ...dist(pool((s) => s.pageConv?.before.values ?? [])), missing: saves.reduce((a, s) => a + (s.pageConv?.before.missing ?? 0), 0) };
  const convPgAfter = { ...dist(pool((s) => s.pageConv?.after.values ?? [])), missing: saves.reduce((a, s) => a + (s.pageConv?.after.missing ?? 0), 0) };
  const rc = fin.subRecs.reduce((a, r) => a + subMonotonicityRC(r.appliedAll).regressions.length, 0);
  const putD = dist(saves.map((s) => s.putMs).filter((v) => v != null));
  const convPass = (d) => (d.n === 0 && d.missing === 0 ? null : d.missing === 0 && d.p95 != null && d.p95 <= GATE_P95_MS);
  // Foreign saves between prepare and the first admission save: a first
  // answer (SDK first read, page SSR seed) that started before our first
  // save yet carries a rev ABOVE the manifest's means somebody else wrote
  // the event in between (another stream, a fixture script). The
  // complete-setlist check compares against the manifest, so such a run
  // measured a different setlist — it fails here, loudly, instead of as
  // a mysterious "incomplete".
  // A first read that STARTED before our first save can still be answered
  // after its commit and then carries OUR rev — that is not a foreign write.
  // So the test is not "started before the PUT" but "a rev that is neither
  // the manifest's nor one of this run's own saves": revisions are
  // sequential per event, so any such number came from another writer.
  const ourRevs = new Set(saves.map((s) => s.rev).filter((r) => r != null));
  const headRevs = [
    ...sdkMain.filter((c) => c.first?.rev != null).map((c) => c.first.rev),
    ...pages.filter((p) => p.seed?.rev != null).map((p) => p.seed.rev),
  ].filter((r) => !ourRevs.has(r));
  const headAtT0 = headRevs.length ? Math.max(...headRevs) : null;
  const gates = [
    { name: "outbound requests between prepare end and T0", value: `${A.boundary.outbound.length}`, gate: "0", pass: A.boundary.outbound.length === 0 },
    { name: "event unchanged between prepare and the first admission save (first answers not from this run's saves vs manifest rev)", value: `foreign head seen ${headAtT0 ?? "—"}, manifest ${A.manifest.rev}`, gate: "≤ manifest rev", pass: headAtT0 == null ? null : headAtT0 <= A.manifest.rev },
    { name: "all intended saves committed (admission saves never retried)", value: `${A.saves.filter(isOkSave).length}/${A.saves.length} admission${saveFailures.length ? `; ${saveFailures.length} failed attempt(s) in total` : ""}`, gate: "all 2xx", pass: A.saves.every(isOkSave) && saveFailures.length === 0 },
    { name: "5xx anywhere (saves, pages incl. the document, SDK, guard read)", value: `${fivexxTotal} (${Object.entries(fivexx).filter(([, v]) => v).map(([k, v]) => `${k} ${v}`).join(", ") || "none"})`, gate: "0", pass: fivexxTotal === 0 },
    { name: "503 (subset of the above)", value: `${s503Total}`, gate: "0", pass: s503Total === 0 },
    { name: "transport failures on saves", value: `${transport}`, gate: "0", pass: transport === 0 },
    { name: `all joined within --join-timeout (${JOIN_TIMEOUT_MS / 1000} s from T0)`, value: `SDK ${sdkJoined}/${sdkMain.length}, pages ${pagesJoined}/${pages.length}`, gate: "all", pass: sdkJoined === sdkMain.length && pagesJoined === pages.length },
    { name: "pages: complete expected setlist, navigation start →", value: `${dline(completeD)}${incomplete.length ? `; **${incomplete.length} incomplete** (best ordered match ${incomplete.slice(0, 4).map((p) => `p${p.idx} ${p.matched}/${p.total}`).join(", ")})` : ""}`, gate: `p95 ≤ ${GATE_P95_MS}, every page`, pass: pages.length ? incomplete.length === 0 && completeD.p95 != null && completeD.p95 <= GATE_P95_MS : null },
    { name: "pages: degraded SSR seed (no live seed in the HTML)", value: `${degraded} (seeds ${JSON.stringify(seedKinds)})${ADM.expectLiveSeed ? "" : " — not judged (--expect-live-seed=false)"}`, gate: "0", pass: pages.length ? degraded === 0 : null },
    { name: "SDK: time to first snapshot (start → first 200 applied)", value: `${dline(firstSnap)}${noFirst ? `; **${noFirst} without one**` : ""}`, gate: `p95 ≤ ${GATE_P95_MS}, all`, pass: sdkMain.length ? noFirst === 0 && firstSnap.p95 != null && firstSnap.p95 <= GATE_P95_MS : null },
    { name: "convergence SDK joined-before (from PUT start)", value: `${dline(convSdkBefore)}, missing ${convSdkBefore.missing}`, gate: `p95 ≤ ${GATE_P95_MS}, 0 missing`, pass: convPass(convSdkBefore) },
    { name: "convergence SDK joined-after (from max(subscribedAt, PUT response))", value: `${dline(convSdkAfter)}, missing ${convSdkAfter.missing}`, gate: `p95 ≤ ${GATE_P95_MS}, 0 missing`, pass: convPass(convSdkAfter) },
    { name: "convergence pages joined-before (from PUT start; marker or a later one on the anchor)", value: `${dline(convPgBefore)}, missing ${convPgBefore.missing}`, gate: `p95 ≤ ${GATE_P95_MS}, 0 missing`, pass: convPass(convPgBefore) },
    { name: "convergence pages joined-after (from max(channel join, PUT response))", value: `${dline(convPgAfter)}, missing ${convPgAfter.missing}`, gate: `p95 ≤ ${GATE_P95_MS}, 0 missing`, pass: convPass(convPgAfter) },
    { name: "monotonicity (pages: DOM version; SDK: applied rev and (rev, capturedAt))", value: `${monotonicPass ? "0" : "≥ 1"} DOM/rev regressions, ${rc} (rev, capturedAt) regressions`, gate: "0", pass: monotonicPass && rc === 0 },
    { name: "PUT end-to-end (every save of the run)", value: `${dline(putD)}`, gate: "p95 ≤ 1500", pass: putD.n ? putD.p95 <= 1500 : null },
  ];
  const verdict = admissionVerdict({ invalid: valid.invalid, sdkExercised, pageExercised, gates });

  // I3 (--final-cohort).
  let final = null;
  if (state.finalPhase) {
    const F = state.finalPhase;
    const fresh = sdk.filter((c) => c.cohort === "fresh");
    const kept = sdk.filter((c) => F.incumbents.includes(c.idx));
    const local = [...kept, ...fresh];
    const fs1 = saves.find((s) => s.k === "f1");
    const fs2 = saves.find((s) => s.k === "f2");
    final = {
      phase: F,
      cycles: [
        ...(fs1 ? [cohortCycle("I3 — fresh cohort, first save 6 s after join", fs1, fresh, local, { maxAgeS: I3_MAX_AGE_S, timeoutMs: TIMEOUT_MS })] : []),
        ...(fs2 ? [cohortCycle("I3 — +40 s save", fs2, fresh, local, { maxAgeS: I3_MAX_AGE_S + 40, timeoutMs: TIMEOUT_MS })] : []),
      ],
      incumbentsThrough: fs1 ? kept.filter((c) => connectedThrough(connOf(c), F.retiredAt, fs1.putEnd)).length : null,
    };
  }

  // ── markdown ──
  const L = [];
  const yes = (x) => (x == null ? "n/a" : x ? "**PASS**" : "**FAIL**");
  L.push("## Admission (n14 step 5)");
  L.push("");
  L.push(`**Verdict: ${verdict.verdict}** — SDK aspect: ${verdict.sdk}; page aspect: ${verdict.page}${verdict.failed?.length ? `; failed: ${verdict.failed.join("; ")}` : ""}.`);
  L.push("");
  L.push(`- Prepare via ${A.prepBase} (${iso(A.prepare.startedAt)} → ${iso(A.prepare.endedAt)}): anchor row ${A.anchor.id} @${A.anchor.position} (rev ${A.anchor.rev}); manifest ${A.prepare.rows} active rows at rev ${A.prepare.rev}${A.fixture ? `, ${A.fixture.clonesActive} fixture clones (${A.fixture.file})` : ""}; file \`${path.basename(A.manifestFile)}\``);
  L.push(`- Boundary: waited ${(A.boundary.waitMs / 1000).toFixed(1)} s (${A.boundary.admitAt != null ? `--admit-at ${iso(A.boundary.admitAt)}` : `--admit-file ${ADM.admitFile}`}); **outbound requests during the wait: ${A.boundary.outbound.length}**${A.boundary.outbound.length ? ` — ${A.boundary.outbound.slice(0, 5).map(([t, k, w]) => `${iso(t)} ${k} ${w}`).join("; ")}` : ""}${A.boundary.admitFile?.measurementId || A.boundary.admitFile?.precursorId ? `; admit file: precursor ${A.boundary.admitFile.precursorId ?? "—"} → measurement ${A.boundary.admitFile.measurementId ?? "—"}` : ""}`);
  L.push(`- T0 ${iso(T0)}; measurement base ${A.base}; pages ${PAGES} at concurrency ${PAGE_CONCURRENCY}, SDK ${SUBS} at ${SUB_BATCH}/s, all started at T0; admission saves at +${ADM.savesS.join(" s, +")} s on their own timer (scheduled vs actual start: ${scheduled.map((x) => `${x.k} +${x.lateMs} ms`).join(", ")})${A.guardRead ? `; measurement identity read at T0: ${A.guardRead.ok ? "ok" : "FAILED"} (rev ${A.guardRead.rev ?? "—"}, ${A.guardRead.ms} ms)` : ""}`);
  L.push(`- Exposure minimums (predeclared): SDK ≥ ${ADM.sdkMin} connected through the save AND ≥ ${ADM.sdkMin} not yet SUBSCRIBED at its PUT response; pages ≥ ${ADM.pagesMin} navigated by the PUT start and not yet complete. Clocks: this host only (PUT response = upper bound of the commit); the server's commit \`at\` is a cross-check in \`admission-join.mjs\`.`);
  L.push("- Resource diet: images, fonts and media are aborted on every page (the DOM is all that is measured); analytics and the Sentry tunnel too.");
  L.push("");
  L.push("| admission gate | value | gate | verdict |");
  L.push("|---|---|---|---|");
  for (const g of gates) L.push(`| ${g.name} | ${String(g.value).replace(/\|/g, "/")} | ${g.gate} | ${yes(g.pass)}${valid.invalid ? " (measurement invalid)" : ""} |`);
  L.push(`| server side: writer acquire ≤ 500 ms, EMAXCONN 0, Σ < 300 with completeness, builds per minute / instance | — | \`admission-join.mjs\` on the history logs | n/a here |`);
  L.push("");
  L.push("### Per save — exposure, convergence, first answers");
  L.push("");
  L.push("Convergence: joined-before from the PUT start, joined-after from max(subscribedAt / channel join, PUT response); p95 ms (n) / missing. Stale first answers = clients whose first read started after the PUT response but carried a lower rev (SDK: first request; pages: SSR seed) — counted, not a gate. Broadcast = clients that received this save's raw `rev` broadcast, separate from the reason of the fetch that applied it.");
  L.push("");
  L.push("| save | label | rev | PUT start (UTC) | ms | SDK connected / not yet / dropped | pages in flight / future / settled | SDK before | SDK after | pages before | pages after | stale first: SDK / pages | broadcast received / population | applied by |");
  L.push("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|");
  const cv = (d) => (d ? `${ms(d.p95)} (${d.n}) / ${d.missing}` : "—");
  for (const s of saves) {
    L.push(`| ${s.k} | ${s.label} | ${s.rev} | ${iso(s.putStart)} | ${ms(s.putMs)} | ${s.sdkExposure.connected} / ${s.sdkExposure.notYet} / ${s.sdkExposure.disconnected} | ${s.pageExposure.inflight} / ${s.pageExposure.future} / ${s.pageExposure.settled} | ${cv(s.sdkConv.before)} | ${cv(s.sdkConv.after)} | ${cv(s.pageConv?.before)} | ${cv(s.pageConv?.after)} | ${s.stale.sdk.stale}/${s.stale.sdk.eligible} / ${s.stale.pages.stale}/${s.stale.pages.eligible} | ${s.receipt.received} / ${s.receipt.population} | ${JSON.stringify(s.receipt.reasons)} |`);
  }
  L.push("");
  const srcs = sdkMain.reduce((a, c) => { const k = c.firstOk?.source ?? "none"; a[k] = (a[k] || 0) + 1; return a; }, {});
  const bytes = dist(sdkMain.map((c) => c.firstOk?.bytes).filter((v) => v != null));
  L.push(`SDK first snapshot: sources ${JSON.stringify(srcs)}; body bytes p50 / max ${ms(bytes.p50)} / ${ms(bytes.max)}; first-answer revs ${JSON.stringify(sdkMain.reduce((a, c) => { const k = c.first?.rev ?? "—"; a[k] = (a[k] || 0) + 1; return a; }, {}))}.`);
  L.push("");
  if (pages.length) {
    L.push("### Pages (every page)");
    L.push("");
    L.push("Times in ms from the page's navigation start (browser timeOrigin) unless noted; launch = navigation start − T0 (scheduled vs actual: wave × concurrency). Complete = the ordered rows match the manifest (multiplicity, per-row song order, medleys, the blank anchor or any run marker on it); matched = best ordered match before the first steady edit. Hydrated = first /api/setlist request or first Realtime socket.");
    L.push("");
    L.push("| page | locale | wave | launch ms after T0 | doc | TTFB | DCL | complete | rows matched | hydrated | channel joined | first fetch (source, rev) | SSR seed | errors |");
    L.push("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|");
    for (const p of pages) {
      L.push(`| ${p.idx} | ${p.locale} | ${p.wave ?? "—"} | ${p.navStart != null ? p.navStart - T0 : "—"} | ${p.docStatus ?? "—"} | ${ms(p.ttfbMs)} | ${ms(p.dclMs)} | ${p.completeMs != null ? p.completeMs : "**INCOMPLETE**"} | ${p.matched}/${p.total} | ${ms(p.hydratedMs)} | ${p.joinAt?.length && p.navStart != null ? p.joinAt[0] - p.navStart : "—"} | ${p.firstFetch ? `${p.firstFetch.source ?? p.firstFetch.status}, ${p.firstFetch.rev ?? "—"}` : "—"} | ${p.seed.kind}${p.seed.rev != null ? ` ${p.seed.rev}` : ""} | ${p.errors.length ? p.errors[0].slice(0, 60).replace(/\|/g, "/") : ""} |`);
    }
    L.push("");
  }
  if (final) {
    L.push("### I3 — final phase (`--final-cohort`)");
    L.push("");
    L.push(`- ${final.phase.incumbents.length}/${final.phase.wantIncumbents} incumbents kept connected (others stopped at ${iso(final.phase.retiredAt)}${final.phase.pagesClosedAt ? `, pages closed at ${iso(final.phase.pagesClosedAt)}` : ""}); ${final.incumbentsThrough ?? "—"} of them continuously connected through the first I3 save; ${final.phase.fresh} fresh clients started ${iso(final.phase.freshStartedAt)}, all connected ${iso(final.phase.freshReadyAt)}.`);
    L.push("");
    for (const c of final.cycles) L.push(...cycleLines(c));
  }
  const json = {
    config: ADM, T0, base: A.base, prepBase: A.prepBase, prepare: A.prepare, anchor: A.anchor, fixture: A.fixture, manifestFile: A.manifestFile,
    boundary: A.boundary, guardRead: A.guardRead, scheduled,
    expectedRows: expected,
    saves: saves.map((s) => ({ ...s, sdkConv: { before: { ...s.sdkConv.before, values: undefined }, after: { ...s.sdkConv.after, values: undefined }, notJoined: s.sdkConv.notJoined }, pageConv: s.pageConv ? { before: { ...s.pageConv.before, values: undefined }, after: { ...s.pageConv.after, values: undefined } } : null })),
    gates, verdict, exercised: { sdk: sdkExercised, page: pageExercised },
    final: final ? { phase: final.phase, incumbentsThrough: final.incumbentsThrough, cycles: final.cycles.map((c) => ({ name: c.name, save: c.save, verdict: c.verdict, elig: c.elig, eligible: c.eligible, all: c.all, rows: c.rows })) } : null,
    pages, sdk,
  };
  return { lines: L, json, verdict };
}

function idleReport(state, fin) {
  const I = state.idle.cfg;
  const sdk = fin.subRecs.map(compactSdk);
  const inc = sdk.filter((c) => c.cohort === "incumbent");
  const fresh = sdk.filter((c) => c.cohort === "fresh");
  const saves = saveListOf(state.edits);
  const by = (k) => saves.find((s) => s.k === k);
  const cycles = [];
  const s1 = by("s1");
  if (s1) cycles.push(cohortCycle(I.wake ? "I2 — check save (incumbents)" : "I1 — first save after idle", s1, inc, sdk, { maxAgeS: I.maxAgeS, timeoutMs: TIMEOUT_MS }));
  // Later saves: arrival tables only (the cohort is older than max-age by
  // then, so "eligible" would be false by design) — except the wake
  // cycle's first post-fresh save, which is the fresh cohort's control.
  const info = [];
  for (const s of saves.filter((x) => x.k !== "s1")) {
    if (s.k === "w1") cycles.push(cohortCycle("I2 — fresh cohort, save 6 s after join (incumbents kept)", s, fresh, sdk, { maxAgeS: I.maxAgeS, timeoutMs: TIMEOUT_MS }));
    else info.push({ save: s, sum: summarizeArrivals(idleArrivals(sdk, s, { timeoutMs: TIMEOUT_MS })) });
  }
  const verdict = cycles.some((c) => c.verdict === "FAIL") ? "FAIL" : cycles.every((c) => c.verdict === "NOT EXERCISED") ? "NOT EXERCISED" : cycles.some((c) => c.verdict === "NOT EXERCISED") ? "PARTLY NOT EXERCISED" : "PASS";
  const L = [];
  L.push(`## Idle-broadcast drill (${I.wake ? "I2, wake procedure" : "I1"})`);
  L.push("");
  L.push(`**Verdict: ${verdict}** (${cycles.map((c) => `${c.name}: ${c.verdict}`).join("; ")}).`);
  L.push("");
  L.push(`- Connect at ${iso(I.connectAt)} (${I.incumbents} incumbents; ${state.idle.connectedAtSave}/${I.incumbents} connected just before the first save), first save ${iso(I.firstSaveAt)} (scheduled; actual ${iso(s1?.putStart)}), max-age ${I.maxAgeS} s${I.wake ? `, wake gap ${I.wakeGapS} s, fresh ${I.fresh}` : `, later saves at +${I.savesS.join(" s, +")} s`}.`);
  L.push("- The idle period itself (≥ 30 min since the last broadcast AND the last client disconnect, incl. the observer) is the operator's precondition; this run cannot see it. The observer's clients are joined in afterwards by `admission-join.mjs --observer=`.");
  if (state.idle.wake) {
    const w = state.idle.wake;
    L.push(`- Wake check: ${w.check.map((c) => `save ${c.save} rev ${c.rev} by broadcast at ${c.noted}/${c.connected} → ${c.ok ? "ok" : "**MISSED**"}`).join("; ")}${w.escalate ? ` — **${w.escalate}**` : ""}; fresh cohort ${w.fresh ? `started ${iso(w.fresh.startedAt)}, connected ${iso(w.fresh.readyAt)}` : "—"}.`);
  }
  L.push("");
  for (const c of cycles) L.push(...cycleLines(c));
  if (info.length) {
    L.push("#### Later saves (arrivals, informational)");
    L.push("");
    for (const x of info) L.push(`- ${x.save.k} rev ${x.save.rev}: broadcast ${x.sum.received}/${x.sum.n}, applied ${x.sum.applied}/${x.sum.n} by ${JSON.stringify(x.sum.reasons)}; receipt p95 ${ms(x.sum.bcast.p95)} ms`);
    L.push("");
  }
  const json = {
    config: I, wake: state.idle.wake, connectedAtSave: state.idle.connectedAtSave, verdict,
    cycles: cycles.map((c) => ({ name: c.name, save: c.save, verdict: c.verdict, elig: c.elig, eligible: c.eligible, all: c.all, rows: c.rows })),
    later: info, sdk,
  };
  return { lines: L, json, verdict };
}

// ─── n14 step 6: the transition section ───
// Per switch, SEPARATE verdicts (design §2): continuity, performance,
// exposure, arrivals, smoke; plus the live routing profile, the R1
// cohort, the existing-ON return's stale first answers and the pin
// evidence. Clock: this host. Every classification against "the first
// target response" uses the PROVISIONAL boundary (route marker, else
// cliEnd); ../transition-join.mjs re-derives it from the Vercel logs.
const PAGE_ROW_TX = ["tResponse", "minRev", "status", "x-snapshot-source", "body rev", "x-snapshot-verify (raw)", "hint=1", "request start", "body capturedAt", "x-vercel-id", "x-vercel-cache", "cache-control", "age", "pin evidence", "body complete t", "request path + query"];

function transitionReport(state, fin, { valid, pageMono, subMono }) {
  const T = state.transition;
  const C = TXC;
  const bumpK = (o, k) => { o[k] = (o[k] || 0) + 1; };
  const is2xx = (s) => s.status >= 200 && s.status < 300;
  const sdkAll = fin.subRecs.map((r) => ({
    idx: r.idx, worker: r.worker ?? null, cohort: r.cohort ?? null, locale: r.locale, attemptAt: r.attemptAt, subscribedAt: r.subscribedAt,
    connLog: r.connLog ?? null, statusLog: r.statusLog ?? null, stoppedAt: r.stoppedAt ?? null, fallbacks: r.fallbacks, recreates: r.recreates ?? [],
    reqs: r.reqs || [], applied: r.appliedAll || [], bcasts: r.bcasts || [], exhausted: r.exhausted || [], trig: r.trig || [], failKinds: r.failKinds || {},
  }));
  const natural = sdkAll.filter((c) => c.cohort !== "hold" && c.cohort !== "ahead");
  const holdC = sdkAll.filter((c) => c.cohort === "hold");
  const aheadC = sdkAll.filter((c) => c.cohort === "ahead");
  const mi = markerIndex(state.edits);
  const markers = [...new Set(state.edits.map((e) => String(e.song.id)))];
  const anchorMarkers = state.edits.filter((e) => e.id === T.anchor.id).map((e) => String(e.song.id));
  const expected = expectedRows(T.manifest.rows, { [T.anchor.id]: ["", ...anchorMarkers] });
  const baseRows = expected.length;
  // The complete-setlist check only holds while no after-return insert
  // is on the page: judge each page up to the first insert after its
  // navigation start.
  const inserts = T.saves.filter((s) => s.op === "insert" && isOkSave(s)).map((s) => s.startedAt).sort((a, b) => a - b);
  const untilFor = (nav) => inserts.find((t) => t > (nav ?? 0)) ?? Infinity;
  const recByIdx = new Map(fin.pageRecs.map((r) => [r.idx, r]));
  const pages = fin.pageRecs.map((r) => {
    const c = compactPage(r, expected, untilFor(r.navStart), markers);
    const p = {
      ...c, cohort: r.cohort ?? null, docDplId: r.docDplId ?? null, docVercelId: r.docVercelId ?? null,
      joinAt: r.joinAt, pgReadyAt: r.pgReadyAt, notes: r.notes, bcasts: r.bcasts, fetches: r.fetches,
      assets: r.assets ?? [], navs: r.navs ?? [], reqFailed: r.reqFailed ?? [], pageErrs: r.pageErrs ?? [], seenAll: r.seen, goneAll: r.gone,
    };
    p.build = pageBuild(p);
    p.readyAt = pageReadyAt(p);
    p.timeToUsableMs = timeToUsable(p);
    return p;
  });
  const saveL = T.saves.filter((s) => isOkSave(s)).map((s) => ({ k: s.k, leg: s.leg, op: s.op, offS: s.offS, rev: s.rev, songId: s.songId, rowId: s.rowId, putStart: s.startedAt, putEnd: s.startedAt + s.ms, putMs: s.ms }));
  // The marker of an after-return UPDATE disappears with the row's
  // soft-delete: pages that navigated after that cannot show it.
  const goneAtOf = (songId) => T.allowGone.get(String(songId)) ?? null;
  const predFor = (s, legSaves) => {
    if (s.op === "insert") return (rows) => rows.length === baseRows + 1;
    const upd = legSaves.find((x) => x.op === "update" && x.rowId === s.rowId);
    if (s.op === "update") return (rows) => rows.some((sig) => sig.split("+").includes(String(s.songId)));
    return (rows) => rows.length === baseRows && !(upd && rows.some((sig) => sig.split("+").includes(String(upd.songId))));
  };
  const gateOk = (d) => (d.n ? d.p95 != null && d.p95 <= GATE_P95_MS : null);

  const switches = T.legs.map((L) => {
    const F = L.file || {};
    const P = L.plannedAt;
    const saves = saveL.filter((s) => s.leg === L.k);
    const starts = L.saves.map((s) => s.startedAt);
    const from = Math.min(P, ...starts) - 5000;
    const to = (starts.length ? Math.max(...starts) : P) + C.continuityMs;
    const inWin = (t) => t != null && t >= from && t <= to;
    const boundary = boundaryOf({ firstTarget: L.firstTarget, cliEnd: F.cliEnd ?? null });
    const cliStart = F.cliStart ?? null;
    const routeRows = L.route.filter((r) => r.phase !== "baseline").map((r) => ({ reqStart: r.tStart, respAt: r.tBody, dpl: r.dpl }));
    const routing = routingProfile(routeRows, { baseline: L.baselineDpl, targetId: F.target?.id ?? null, firstTarget: L.firstTarget ? { reqStart: L.firstTarget.reqStart, respAt: L.firstTarget.respAt, dpl: L.firstTarget.dpl } : null });

    // ── per save: convergence (continuity 30 s + performance 3 s),
    // broadcast receipt, outcomes ──
    const perSave = saves.map((sv) => {
      const sdkConv = sdkConvergence(natural, sv, { timeoutMs: C.continuityMs });
      let pageConv = null;
      let pageStruct = null;
      const goneAt = sv.op === "update" ? goneAtOf(sv.songId) : null;
      const pop = pages.filter((p) => p.navStart != null && p.navStart <= sv.putStart + C.continuityMs && !(goneAt != null && p.navStart >= goneAt));
      if (sv.op === "put" || sv.op === "update") {
        pageConv = pop.length ? pageConvergence(pop, sv, { timeoutMs: C.continuityMs, replacedBy: mi.replacedBy }) : null;
      } else {
        // Structural saves: pages open at the save, DOM row list.
        const pred = predFor(sv, saves);
        const open = pages.filter((p) => p.navStart != null && p.navStart <= sv.putStart);
        const lat = [];
        let missing = 0;
        for (const p of open) {
          const t = firstRowsAt(recByIdx.get(p.idx)?.rowsLog, sv.putStart, pred);
          if (t != null && t <= sv.putStart + C.continuityMs) lat.push(t - sv.putStart);
          else missing++;
        }
        pageStruct = { ...dist(lat), values: lat, missing };
      }
      const receipt = broadcastReceipt(natural, sv);
      const r2pages = pages.filter((p) => p.build === "r2" && p.joinAt.length && p.joinAt[0] <= sv.putStart && p.navs.length <= 1);
      const pagesReceived = r2pages.filter((p) => p.bcasts.some(([, rev, w]) => rev === sv.rev && w !== "x")).length;
      const outcomes = {};
      for (const c of natural) {
        const fs1 = firstSub(c);
        if (fs1 == null) continue;
        const clock = fs1 <= sv.putStart ? sv.putStart : Math.max(fs1, sv.putEnd);
        const o = clientOutcome(c, sv, { clock, timeoutMs: C.continuityMs });
        bumpK(outcomes, o.outcome);
        if (o.superseded) bumpK(outcomes, "(superseded)");
        if (o.exhausted) bumpK(outcomes, "(ticket exhausted)");
      }
      const perf = {
        sdkBefore: { ...sdkConv.before, values: undefined, pass: gateOk(sdkConv.before) },
        sdkAfter: { ...sdkConv.after, values: undefined, pass: gateOk(sdkConv.after) },
        pagesBefore: pageConv ? { ...pageConv.before, values: undefined, pass: gateOk(pageConv.before) } : null,
        pagesAfter: pageConv ? { ...pageConv.after, values: undefined, pass: gateOk(pageConv.after) } : null,
        pagesStruct: pageStruct ? { ...pageStruct, values: undefined, pass: gateOk(pageStruct) } : null,
      };
      const missing = sdkConv.before.missing + sdkConv.after.missing + (pageConv ? pageConv.before.missing + pageConv.after.missing : 0) + (pageStruct?.missing ?? 0);
      return { ...sv, missing, sdkNotJoined: sdkConv.notJoined, perf, receipt: { sdk: receipt, pages: { eligible: r2pages.length, received: pagesReceived } }, outcomes };
    });

    // ── continuity (window [from, to]) ──
    const sdkRowsIn = sdkAll.flatMap((c) => c.reqs.filter((q) => inWin(q[Q.tStart])).map((q) => ({ c, q })));
    const pageFetchIn = pages.flatMap((p) => p.fetches.filter((f) => inWin(f[0])).map((f) => ({ p, f })));
    const probeIn = T.probe.filter((r) => inWin(r.tStart));
    const smokeReqs = L.smoke.flatMap((s) => [s.post, s.counts, s.wish].filter(Boolean));
    const guardRecs = (L.guard?.attempts || []).map((a) => a.rec).filter(Boolean);
    const fivexx = {
      saves: L.saves.filter((s) => s.status >= 500).length,
      sdk: sdkRowsIn.filter(({ q }) => q[Q.status] >= 500).length,
      pages: pageFetchIn.filter(({ f }) => f[2] >= 500).length + pages.filter((p) => inWin(p.navStart) && p.docStatus >= 500).length,
      probe: probeIn.filter((r) => r.status >= 500).length,
      route: L.route.filter((r) => r.status >= 500).length,
      guard: guardRecs.filter((r) => r.status >= 500).length,
      smoke: smokeReqs.filter((r) => r.status >= 500).length,
    };
    // A hold-subset request that failed while HELD is the controlled
    // delay meeting the real 8 s deadline, not a transport failure.
    const transport = {
      saves: L.saves.filter((s) => s.status === 0).length,
      sdk: sdkRowsIn.filter(({ q }) => q[Q.status] === 0 && q[Q.outcome] === "failed" && q[Q.heldAt] == null).length,
      pages: pages.reduce((a, p) => a + p.reqFailed.filter(([t, u]) => inWin(t) && u.startsWith("/api/setlist")).length, 0),
      probe: probeIn.filter((r) => r.status === 0).length,
    };
    const heldDeadline = sdkRowsIn.filter(({ q }) => q[Q.heldAt] != null && q[Q.outcome] === "failed").length;
    const malformed = {
      sdk: sdkRowsIn.filter(({ q }) => q[Q.status] === 200 && q[Q.outcome] === "failed" && (q[Q.failKind] === "network" || q[Q.failKind] === "body")).length,
      pages: pageFetchIn.filter(({ f }) => f[2] === 200 && f[14] != null && f[4] == null).length,
      probe: probeIn.filter((r) => r.status === 200 && !r.bodyOk).length,
    };
    const reloads = pages.reduce((a, p) => a + p.navs.slice(1).filter(([t]) => inWin(t)).length, 0);
    const pageErrors = pages.reduce((a, p) => a + p.pageErrs.filter(([t]) => inWin(t)).length, 0);
    const monoSdk = subMono.reduce((a, m) => a + m.regressions.filter((x) => inWin(x.t)).length, 0);
    const monoPages = pageMono.reduce((a, m) => a + m.regressions.filter((x) => inWin(x.t)).length, 0);
    const missing = perSave.reduce((a, s) => a + s.missing, 0);
    const notJoined = perSave.reduce((a, s) => Math.max(a, s.sdkNotJoined), 0);
    const bMissSdk = perSave.reduce((a, s) => a + s.receipt.sdk.missing, 0);
    const bMissPages = perSave.reduce((a, s) => a + (s.receipt.pages.eligible - s.receipt.pages.received), 0);
    const plannedSaves = C.savesS.length + (F.afterSwitchSaves?.length ?? 0);
    const sum = (o) => Object.values(o).reduce((a, v) => a + v, 0);
    const checks = [
      { name: "every planned save 2xx (never retried)", value: `${L.saves.filter(is2xx).length}/${plannedSaves}`, pass: L.saves.length === plannedSaves && L.saves.every(is2xx) },
      { name: `every eligible client ≥ the saved rev within ${C.continuityMs / 1000} s of the first save attempt (incumbents from the PUT start, arrivals from max(join, PUT response))`, value: `${missing} missing${notJoined ? `; ${notJoined} SDK never joined` : ""}`, pass: missing === 0 && notJoined === 0 },
      { name: "every continuously connected eligible R2 client received the committed broadcast", value: `SDK ${bMissSdk} missed, R2 pages ${bMissPages} missed`, pass: bMissSdk === 0 && bMissPages === 0 },
      { name: "5xx (saves, SDK, pages incl. documents, probe, route marker, guard, smoke)", value: `${sum(fivexx)} ${JSON.stringify(fivexx)}`, pass: sum(fivexx) === 0 },
      { name: "transport failures (held hold-subset deadlines excluded, listed apart)", value: `${sum(transport)} ${JSON.stringify(transport)}; held → deadline ${heldDeadline}`, pass: sum(transport) === 0 },
      { name: "malformed bodies", value: `${sum(malformed)} ${JSON.stringify(malformed)}`, pass: sum(malformed) === 0 },
      { name: "unexpected reloads (pages)", value: `${reloads}`, pass: reloads === 0 },
      { name: "page errors", value: `${pageErrors}`, pass: pageErrors === 0 },
      { name: "monotonicity regressions (SDK applied rev, pages DOM version)", value: `SDK ${monoSdk}, pages ${monoPages}`, pass: monoSdk === 0 && monoPages === 0 },
    ];
    const cont = continuityVerdict(checks);

    // ── performance (kept visible even when continuity passes) ──
    const perfFails = perSave.flatMap((s) => Object.entries(s.perf).filter(([, d]) => d && d.pass === false).map(([pop]) => `${s.k} ${pop} p95 ${s.perf[pop].p95}`));

    // ── exposure (provisional boundary) ──
    const bnd = boundary.at;
    const headRev = saves.length ? Math.max(...saves.map((s) => s.rev)) : null;
    const pend = pendingHinted(natural, { cliStart, boundary: bnd, min: C.min.pending });
    const recheck = L.ahead ? pendingRecheck(aheadC, { cliStart, syntheticRevs: [L.ahead.rev], min: C.min.recheck }) : null;
    const oldNat = oldAnswerAfterCutover(natural, { cliStart, boundary: bnd, headRev, until: to, min: C.min.old });
    const oldHold = oldAnswerAfterCutover(holdC, { cliStart, boundary: bnd, headRev, until: to, min: C.min.old });
    const arrCohort = L.arrivals?.cohort ?? null;
    const arrSdk = natural.filter((c) => arrCohort && c.cohort === arrCohort);
    const arrPages = pages.filter((p) => arrCohort && p.cohort === arrCohort);
    const arrSaves = L.arrivals ? saves.filter((s) => s.putStart >= L.arrivals.at && s.putStart <= L.arrivals.at + 6000) : [];
    const arrX = arrSaves.map((s) => ({ k: s.k, offS: s.offS, ...arrivalExposure(arrSdk, arrPages, s, { sdkMin: C.min.arrivalSdk, pagesMin: C.min.arrivalPages }) }));
    const ex = (b) => (b ? "EXERCISED" : "NOT EXERCISED");
    const exposureVerdicts = {
      pendingHinted: ex(pend.exercised),
      ...(recheck ? { pendingRecheck: ex(recheck.exercised) } : {}),
      oldAnswer: ex(oldNat.count + oldHold.count >= C.min.old),
      ...(C.arrivals.sdk > 0 ? { arrivalSdk: ex(arrX.some((x) => x.sdk.exposed)) } : {}),
      ...(arrPages.length || (L.arrivals?.pages?.n ?? 0) > 0 ? { arrivalPages: ex(arrX.some((x) => x.pages.exposed)) } : {}),
    };

    // ── arrivals ──
    const usable = arrPages.map((p) => p.timeToUsableMs);
    const usableD = dist(usable.filter((v) => v != null));
    const wave0 = dist(arrPages.filter((p) => p.wave === 0).map((p) => p.timeToUsableMs).filter((v) => v != null));
    const firstSnap = arrSdk.map((c) => {
      const q = c.reqs.find((r) => r[Q.status] === 200 && r[Q.outcome] === "ok");
      return q && c.attemptAt != null ? q[Q.tEnd] - c.attemptAt : null;
    });
    const firstSnapD = dist(firstSnap.filter((v) => v != null));
    const arrivals = {
      cohort: arrCohort, r1: !!L.arrivals?.r1, at: L.arrivals?.at ?? null,
      pages: { n: arrPages.length, usable: usableD, wave0, unusable: usable.filter((v) => v == null).length, builds: arrPages.reduce((a, p) => (bumpK(a, p.build), a), {}) },
      sdk: { n: arrSdk.length, firstSnapshot: firstSnapD, without: firstSnap.filter((v) => v == null).length },
    };
    const arrivalsPass = !L.arrivals ? null
      : (arrPages.length === 0 || (arrivals.pages.unusable === 0 && gateOk(usableD) !== false))
        && (arrSdk.length === 0 || (arrivals.sdk.without === 0 && gateOk(firstSnapD) !== false));

    // ── R1 cohort: change receipts → fetch → DOM, after-return saves ──
    const afterOps = L.saves.filter((s) => ["insert", "update", "delete"].includes(s.op) && isOkSave(s));
    const r1Pages = pages.filter((p) => p.build === "r1");
    const r1Cohort = {
      pages: r1Pages.map((p) => ({ idx: p.idx, cohort: p.cohort, locale: p.locale, docDplId: p.docDplId, pgReadyAt: p.pgReadyAt[0] ?? null })),
      ops: afterOps.length ? r1Pages.map((p) => ({
        idx: p.idx,
        ops: afterOps.map((s) => {
          const note = (p.notes || []).find((n) => n[2] === String(s.rowId) && n[0] >= s.startedAt - 50);
          const fAfter = note ? p.fetches.find((f) => (f[7] ?? f[0]) >= note[0]) : null;
          const dom = firstRowsAt(recByIdx.get(p.idx)?.rowsLog, s.startedAt, predFor(s, L.saves));
          return { op: s.op, k: s.k, rev: s.rev, rowId: s.rowId, noteAt: note?.[0] ?? null, noteType: note?.[1] ?? null, isDeleted: note?.[3] ?? null, fetchStart: fAfter ? (fAfter[7] ?? fAfter[0]) : null, fetchVercelId: fAfter?.[9] ?? null, fetchVerify: fAfter ? fAfter[5] : null, domAt: dom, domMs: dom != null ? dom - s.startedAt : null };
        }),
      })) : [],
    };

    // ── existing-ON return: stale first answers after the boundary ──
    let staleAfterReturn = null;
    if (L.kind === "return" && bnd != null) {
      const rows = [];
      for (const c of natural) {
        const q = c.reqs.find((r) => r[Q.tStart] >= bnd && r[Q.status] === 200);
        if (q) rows.push({ who: `sdk ${c.idx}`, tStart: q[Q.tStart], rev: q[Q.rev], vercelId: q[Q.vercelId] ?? null });
      }
      for (const p of pages) {
        const f = p.fetches.find((x) => (x[7] ?? x[0]) >= bnd && x[2] === 200);
        if (f) rows.push({ who: `page ${p.idx}`, tStart: f[7] ?? f[0], rev: f[4], vercelId: f[9] ?? null });
      }
      const pr = T.probe.find((r) => r.tStart >= bnd && r.status === 200);
      if (pr) rows.push({ who: "probe", tStart: pr.tStart, rev: pr.rev, vercelId: pr.vercelId });
      staleAfterReturn = staleFirstAfter(rows, saveL, bnd);
    }

    // ── pins (Skew Protection evidence, design §0) ──
    const after = cliStart ?? P;
    const assetsAfter = pages.flatMap((p) => p.assets.filter(([t]) => t >= after));
    const pins = {
      sdkPinned: sdkRowsIn.filter(({ q }) => isPinned(q[Q.pin])).length, sdkRows: sdkRowsIn.length,
      pageApiPinned: pageFetchIn.filter(({ f }) => isPinned(f[13])).length, pageApiRows: pageFetchIn.length,
      probePinned: probeIn.filter((r) => isPinned(r.pin)).length,
      assetsAfterSwitch: assetsAfter.length, assetsAfterPinned: assetsAfter.filter(([, , q]) => q != null).length, assetsAfter404: assetsAfter.filter(([, st]) => st === 404).length,
      // "no chunk 404 after the switch" is only a claim when old tabs
      // actually fetched framework assets after it.
      noChunk404Claim: assetsAfter.length ? (assetsAfter.some(([, st]) => st === 404) ? "FAILED (404 after the switch)" : "holds for the assets fetched") : "NOT EXERCISED (no asset fetched after the switch)",
    };
    const gaps = dist(natural.map((c) => updateGap(c.reqs, from, to)).filter((v) => v != null));

    const smokePass = L.smoke.length ? L.smoke.every((s) => s.pass) : null;
    const verdicts = {
      continuity: cont.pass ? "PASS" : "FAIL",
      performance: perfFails.length ? "FAIL" : "PASS",
      ...(arrivalsPass === null ? {} : { arrivals: arrivalsPass ? "PASS" : "FAIL" }),
      ...(smokePass === null ? {} : { smoke: smokePass ? "PASS" : "FAIL" }),
      ...(L.guard ? { guard: L.guard.ok ? "PASS" : "FAIL" } : {}),
    };
    return {
      k: L.k, file: L.path, kind: L.kind, label: F.label ?? null, afterSwitchSaves: F.afterSwitchSaves ?? [],
      plannedAt: P, seenAt: L.seenAt, fileWrittenAt: L.fileWrittenAt ?? null, noticeS: L.noticeS, cliStart, cliEnd: F.cliEnd ?? null, cliCpuMs: F.cliCpuMs ?? null, target: F.target ?? null,
      completeSeenAt: L.completeSeenAt, fileTimeout: L.fileTimeout, warnings: L.warnings, spacingViolated: L.spacingViolated, endedAt: L.endedAt ?? null,
      baselineDpl: L.baselineDpl, firstTargetLive: L.firstTarget ? { ...L.firstTarget } : null, boundary, routing, guard: L.guard,
      saves: L.saves, hold: L.hold, ahead: L.ahead, arrivalsPlan: L.arrivals, smoke: L.smoke, route: L.route,
      window: { from, to }, perSave, continuity: { checks, ...cont, fivexx, transport, malformed, heldDeadline }, performance: { fails: perfFails },
      exposure: { boundary, pendingHinted: pend, pendingRecheck: recheck, oldAnswer: { natural: oldNat, hold: oldHold, total: oldNat.count + oldHold.count, min: C.min.old }, arrivals: arrX },
      exposureVerdicts, arrivals, r1Cohort, staleAfterReturn, pins, updateGaps: gaps, verdicts,
    };
  });

  const verdict = T.aborted ? { verdict: "ABORTED", exit: 2, reason: T.aborted, failed: [`aborted: ${T.aborted}`], notExercised: [] } : transitionVerdict({ invalid: valid.invalid, switches });

  // ── markdown ──
  const M = [];
  const v = (x) => (x === "PASS" ? "**PASS**" : x === "FAIL" ? "**FAIL**" : x ?? "n/a");
  M.push("## Transition (n14 step 6)");
  M.push("");
  M.push(`**Verdict: ${verdict.verdict}**${verdict.failed?.length ? ` — failed: ${verdict.failed.join("; ")}` : ""}${verdict.notExercised?.length ? ` — not exercised: ${verdict.notExercised.join("; ")}` : ""}${valid.invalid ? " (measurement invalid — see the banner)" : ""}.`);
  M.push("");
  M.push(`- Anchor row ${T.anchor.id} (rev ${T.anchor.rev}); manifest ${T.manifest.rows.length} rows at rev ${T.manifest.rev} (\`${path.basename(T.manifestFile)}\`). Population: ${PAGES} pages + ${SUBS} SDK (${SUBS - C.hold.n - C.ahead.n} natural, hold ${C.hold.n}, ahead-hint ${C.ahead.n}); growth ${T.growth.map((g) => `${g.cohort}: ${g.pages}p + ${g.sdk}s`).join(" → ")}.`);
  M.push(`- Saves at P${C.savesS.map((s) => (s >= 0 ? `+${s}` : `${s}`)).join(", ")} s on the anchor (never retried); continuity ${C.continuityMs / 1000} s from the first save attempt; performance p95 ≤ ${GATE_P95_MS} ms per save per population; leg gap ${C.legGapS} s; probe every ${C.probeIntervalMs} ms (${T.probe.length} requests); route marker ${C.routeRate}/s over P${C.routeWindowS[0]}…+${C.routeWindowS[1]} s.`);
  M.push("- The boundary (\"first target response\") is PROVISIONAL here: the route marker's live identification (`data-dpl-id`), else cliEnd. `../transition-join.mjs` attributes every recorded `x-vercel-id` to its deployment from the Vercel logs.");
  M.push("");
  M.push("| switch | kind | P (UTC) | CLI (s) | target | first target live | guard | continuity | performance | arrivals | smoke | exposure |");
  M.push("|---|---|---|---|---|---|---|---|---|---|---|---|");
  for (const s of switches) {
    M.push(`| ${s.k} ${s.label ?? ""} | ${s.kind ?? "—"} | ${iso(s.plannedAt)} | ${s.cliStart != null ? `${((s.cliStart - s.plannedAt) / 1000).toFixed(1)}…${((s.cliEnd - s.plannedAt) / 1000).toFixed(1)} (${s.cliCpuMs ?? "—"} ms CPU)` : "—"} | ${s.target?.id ?? "—"} | ${s.firstTargetLive ? `+${((s.firstTargetLive.respAt - s.plannedAt) / 1000).toFixed(1)} s` : "—"} | ${v(s.verdicts.guard)} | ${v(s.verdicts.continuity)} | ${v(s.verdicts.performance)} | ${v(s.verdicts.arrivals)} | ${v(s.verdicts.smoke)} | ${Object.entries(s.exposureVerdicts).map(([k2, x]) => `${k2} ${x === "EXERCISED" ? "✓" : "NOT"}`).join(", ")} |`);
  }
  M.push("");
  for (const s of switches) {
    M.push(`### Switch ${s.k}${s.label ? ` — ${s.label}` : ""} (${s.kind ?? "no kind"})`);
    M.push("");
    if (s.warnings.length) M.push(`- **Warnings:** ${s.warnings.join("; ")}`);
    M.push(`- File \`${path.basename(s.file)}\` seen ${iso(s.seenAt)} (notice ${s.noticeS?.toFixed(1)} s), complete ${iso(s.completeSeenAt)}${s.fileTimeout ? " — **never completed**" : ""}; target ${s.target?.url ?? "—"}; baseline ${s.baselineDpl ?? "—"}.`);
    M.push(`- Live routing (route marker): first target ${s.firstTargetLive ? `${iso(s.firstTargetLive.respAt)} (${s.firstTargetLive.how})` : "—"}; last old request start ${iso(s.routing.lastOldReqStart)}, last old response ${iso(s.routing.lastOldResponse)}; sustained target routing over ${s.routing.windowMs / 1000} s: ${s.routing.sustained == null ? "not covered" : s.routing.sustained ? "yes" : `**no** (${s.routing.offTarget} off-target)`}. Boundary: ${iso(s.boundary.at)} (${s.boundary.how}).`);
    if (s.guard) M.push(`- Identity guard through ${s.guard.targetUrl}: ${s.guard.ok ? "ok" : `**FAILED** — ${s.guard.error}`} (${s.guard.ms} ms, ${s.guard.attempts.length} attempt(s), started ${s.guard.completeSeenAt != null ? `${s.guard.startedAt - s.guard.completeSeenAt} ms after the file completed` : "—"}).`);
    M.push(`- Saves: ${s.saves.map((x) => `${x.k} ${x.op} P${x.offS >= 0 ? "+" : ""}${x.offS}s ${x.status} rev ${x.rev ?? "—"} ${x.ms} ms (late ${x.lateMs}${x.fromCliEndMs != null ? `, cliEnd${x.fromCliEndMs >= 0 ? "+" : ""}${(x.fromCliEndMs / 1000).toFixed(1)} s` : ""}${x.gatedMs ? `, gated ${x.gatedMs}` : ""})`).join("; ")}.`);
    M.push("");
    M.push("| check (continuity) | value | verdict |");
    M.push("|---|---|---|");
    for (const c of s.continuity.checks) M.push(`| ${c.name} | ${String(c.value).replace(/\|/g, "/")} | ${c.pass == null ? "n/a" : c.pass ? "**PASS**" : "**FAIL**"} |`);
    M.push("");
    M.push("| save | op | rev | SDK before p95 (n) / miss | SDK after p95 (n) / miss | pages before | pages after | pages DOM rows (structural) | broadcast SDK recv / eligible | R2 pages recv / eligible | outcomes |");
    M.push("|---|---|---|---|---|---|---|---|---|---|---|");
    const cv = (d) => (d ? `${ms(d.p95)} (${d.n}) / ${d.missing}` : "—");
    for (const x of s.perSave) M.push(`| ${x.k} | ${x.op} | ${x.rev} | ${cv(x.perf.sdkBefore)} | ${cv(x.perf.sdkAfter)} | ${cv(x.perf.pagesBefore)} | ${cv(x.perf.pagesAfter)} | ${cv(x.perf.pagesStruct)} | ${x.receipt.sdk.received} / ${x.receipt.sdk.eligible} | ${x.receipt.pages.received} / ${x.receipt.pages.eligible} | ${JSON.stringify(x.outcomes).replace(/\|/g, "/")} |`);
    M.push("");
    M.push(`- Performance: ${s.performance.fails.length ? `**FAIL** — ${s.performance.fails.join("; ")}` : "every save × population p95 ≤ the gate"}.`);
    const e = s.exposure;
    M.push(`- Exposure (provisional boundary): pending hinted fetch ${e.pendingHinted.count} (≥ ${e.pendingHinted.min}) → ${s.exposureVerdicts.pendingHinted}; ${e.pendingRecheck ? `pending recheck ${e.pendingRecheck.count} (queued ${e.pendingRecheck.queued}, dispatched ${e.pendingRecheck.dispatched}; ≥ ${e.pendingRecheck.min}) → ${s.exposureVerdicts.pendingRecheck}; ` : ""}old answer after cutover, converged without regression: natural ${e.oldAnswer.natural.count}/${e.oldAnswer.natural.candidates}, hold ${e.oldAnswer.hold.count}/${e.oldAnswer.hold.candidates} (≥ ${e.oldAnswer.min}) → ${s.exposureVerdicts.oldAnswer}; arrival saves ${e.arrivals.map((x) => `${x.k} (P+${x.offS}): SDK unjoined ${x.sdk.unjoined}${x.sdk.exposed ? " ✓" : ""}, pages incomplete ${x.pages.incomplete}${x.pages.exposed ? " ✓" : ""}`).join("; ") || "none in the window"}.`);
    if (s.hold) M.push(`- Hold subset: armed ${iso(s.hold.armedAt)}, triggers ${s.hold.triggers.map((t) => `P${t.offS >= 0 ? "+" : ""}${t.offS}s ${t.ok}`).join(", ")}, released ${iso(s.hold.release?.at)} (${s.hold.release?.why}); ${s.hold.gate?.entries?.length ?? 0} response(s) held; held → deadline ${s.continuity.heldDeadline}.`);
    if (s.ahead) M.push(`- Ahead-hint subset: synthetic rev ${s.ahead.rev} (${s.ahead.injects.map((x) => `P${x.offS}s ${x.news}/${x.sent} news`).join(", ")}); at P ${s.ahead.stateAtP?.clients.filter((c) => c.carriedHintPhase === "recheck").length ?? 0} ticket(s) queued for a recheck.`);
    if (s.arrivalsPlan) M.push(`- Arrivals ${s.arrivals.cohort}${s.arrivals.r1 ? " (R1 cohort)" : ""} at ${iso(s.arrivals.at)}: pages ${s.arrivals.pages.n} (builds ${JSON.stringify(s.arrivals.pages.builds)}), time to usable (later of complete setlist and readiness) p50 / p95 / max ${ms(s.arrivals.pages.usable.p50)} / ${ms(s.arrivals.pages.usable.p95)} / ${ms(s.arrivals.pages.usable.max)} ms, wave 0 p95 ${ms(s.arrivals.pages.wave0.p95)}, unusable ${s.arrivals.pages.unusable}; SDK ${s.arrivals.sdk.n}, first snapshot p50 / p95 ${ms(s.arrivals.sdk.firstSnapshot.p50)} / ${ms(s.arrivals.sdk.firstSnapshot.p95)} ms, without ${s.arrivals.sdk.without}.`);
    if (s.smoke.length) M.push(`- Reaction / wish smoke (old pages): ${s.smoke.map((x) => `p${x.page} ${x.locale}: reaction ${x.post?.status ?? "—"}, wish ${x.wish?.status ?? "—"} → ${x.pass ? "ok" : `**FAIL** ${JSON.stringify(x.checks)}`}`).join("; ")}.`);
    if (s.r1Cohort.pages.length) {
      M.push(`- R1 pages (postgres_changes registered): ${s.r1Cohort.pages.length} — ${s.r1Cohort.pages.map((p) => `p${p.idx} ${p.locale} ${p.docDplId ?? "?"}`).join(", ")}.`);
      if (s.r1Cohort.ops.length) {
        M.push("");
        M.push("| R1 page | op | rev | change received (ms after save) | type / isDeleted | fetch start (ms) | DOM updated (ms) |");
        M.push("|---|---|---|---|---|---|---|");
        for (const p of s.r1Cohort.ops) for (const o of p.ops) {
          const sv = s.saves.find((x) => x.k === o.k);
          const rel = (t) => (t == null || !sv ? "—" : t - sv.startedAt);
          M.push(`| ${p.idx} | ${o.op} | ${o.rev} | ${rel(o.noteAt)} | ${o.noteType ?? "—"} / ${o.isDeleted ?? "—"} | ${rel(o.fetchStart)} | ${o.domMs ?? "**never**"} |`);
        }
        M.push("");
      }
    }
    if (s.staleAfterReturn) M.push(`- Existing-ON return, first answers after the boundary: ${s.staleAfterReturn.stale}/${s.staleAfterReturn.eligible} stale${s.staleAfterReturn.staleList.length ? ` (${s.staleAfterReturn.staleList.slice(0, 6).map((x) => `${x.who} rev ${x.rev} < ${x.head}`).join(", ")})` : ""} — reported, not a gate.`);
    M.push(`- Pins: SDK ${s.pins.sdkPinned}/${s.pins.sdkRows} requests pinned, page API ${s.pins.pageApiPinned}/${s.pins.pageApiRows}, probe ${s.pins.probePinned}; framework assets after the switch ${s.pins.assetsAfterSwitch} (pinned ${s.pins.assetsAfterPinned}, 404 ${s.pins.assetsAfter404}) — "no chunk 404 after the switch": ${s.pins.noChunk404Claim}. Update gaps (natural SDK, max interval between successful responses in the window) p50 / max ${ms(s.updateGaps.p50)} / ${ms(s.updateGaps.max)} ms.`);
    M.push("");
  }

  const json = {
    version: 1,
    config: C, base: BASE, eventId: EVENT_ID, label: args.label ?? null,
    clock: "epoch ms of the load host (Date.now()); the switch file's cliStart / cliEnd come from the same laptop",
    anchor: T.anchor, manifest: { file: T.manifestFile, rev: T.manifest.rev, rows: T.manifest.rows.length },
    populations: { initial: { pages: PAGES, sdkNatural: SUBS - C.hold.n - C.ahead.n, hold: C.hold.n, ahead: C.ahead.n }, growth: T.growth },
    subsets: { hold: { idxs: T.holdIdxs, worker: T.holdWorker?.idx ?? null }, ahead: { idxs: T.aheadIdxs, worker: T.aheadWorker?.idx ?? null } },
    syntheticRevs: [...T.syntheticRevs],
    aborted: T.aborted ?? null,
    verdict,
    switches,
    saves: T.saves,
    probe: T.probe,
    rows: { sdkReqs: SDK_ROW_TX, pageFetches: PAGE_ROW_TX, pageNotes: ["t", "type I/U/D", "row id", "isDeleted", "table"], pageAssets: ["t", "status", "dpl query (null = unpinned)", "path"], pageNavs: ["t", "url", "status", "x-vercel-id", "data-dpl-id"], pageReqFailed: ["t", "path", "failure"] },
    sdk: sdkAll,
    pages: pages.map(({ seenAll, goneAll, ...p }) => ({ ...p, seen: seenAll, gone: goneAll })),
  };
  return { lines: M, json, verdict };
}

// ─── n14 step 7: the "Spam (n14 step 7)" section ───
// Everything judged here runs on the records the run kept (sender rows,
// receipts, request rows, the 1 Hz worker-state samples), through the
// pure functions of spam7.mjs. `valid` is the run's validity object; the
// step-7 extras (a browser round trip over the limit, an undeclared
// competing process found by a mid-run re-check) are ADDED to it here,
// so the banner, the JSON and the exit code all see one verdict.
function spam7Report(state, fin, { valid, monotonicPass }) {
  const S = state.spam7;
  const C = S.cfg;
  const P = S.phases;
  const { pageRecs, subRecs } = fin;
  const from = P.baselineStart;
  const to = P.measurementEnd;
  const pageBy = new Map(pageRecs.map((r) => [r.idx, r]));
  const subBy = new Map(subRecs.map((r) => [r.idx, r]));
  const sendsByK = new Map(S.sends.map((s) => [s.k, s]));
  const pct1 = (x) => (x == null ? "—" : `${(x * 100).toFixed(1)} %`);

  // ── validity extras (INVALID = host corruption only) ──
  const extra = [];
  for (const [t, idx, rtt] of S.browserProbe) {
    if (t < from || t > P.recoveryEnd) continue;
    if (rtt == null || rtt > SPAM7_BROWSER_INVALID_MS) extra.push({ thread: `browser (page ${idx})`, what: rtt == null ? "no answer to a page round trip within 10 s" : `page round trip ${rtt} ms`, at: t, ms: rtt });
  }
  for (const c of S.hostChecks || []) {
    if (c.competing?.length) extra.push({ thread: "host", what: `undeclared competing process(es) at the ${c.label} re-check: ${c.competing.map((p) => `${p.pid} ${p.why}`).join("; ")}`, at: c.at, ms: null });
  }
  if (extra.length) {
    valid.reasons.push(...extra);
    valid.reasons.sort((a, b) => a.at - b.at);
    valid.invalid = true;
  }

  // ── genuine committed revisions (by this run) ──
  const okW = (w) => w.status >= 200 && w.status < 300 && !w.error;
  const genuine = new Map();
  for (const w of S.writes) if (okW(w) && w.rev != null && !genuine.has(w.rev)) genuine.set(w.rev, w.startedAt);
  const isGenuine = (h, t) => h <= S.initialHead || (genuine.has(h) && t >= genuine.get(h));
  const commitList = S.writes.filter((w) => okW(w) && w.rev != null).map((w) => ({ rev: w.rev, start: w.startedAt, commitAt: w.startedAt + (w.ms ?? 0) }));

  // ── exposure ──
  const sdkRc = subRecs.map((r) => ({ idx: r.idx, rows: (r.bcasts || []).filter((b) => b[3] === RUN_ID).map((b) => [b[4], b[0], b[2], b[5] ?? null]) }));
  const pageRc = pageRecs.map((r) => ({ idx: r.idx, rows: (r.bcasts || []).filter((b) => b[3] === RUN_ID).map((b) => [b[4], b[0], b[2] === "x" ? "x" : "?", pageServerRevAt(r.fetches, b[0])]) }));
  const exp = spamExposure({ sends: S.sends, receipts: { sdk: sdkRc, pages: pageRc }, declared: { sdk: SUBS, pages: PAGES }, spamStart: P.spamStart, spamSecs: C.spamSecs });
  const stale = C.spamRev === "stale" ? staleEligibility(sdkRc, sendsByK) : null;
  const pagesStaleEligible = C.spamRev === "stale" ? staleEligibility(pageRc, sendsByK) : null;

  // ── honest latency per save per population (+ SDK strata) ──
  const saves = S.edits.map((e) => {
    const tPut = e.put.startedAt;
    const deadline = tPut + TIMEOUT_MS;
    const sid = String(e.song.id);
    const pl = [];
    let pm = 0;
    for (let i = 0; i < PAGES; i++) {
      const seen = pageBy.get(i)?.seen[sid];
      if (seen != null && seen <= deadline) pl.push(seen - tPut);
      else pm++;
    }
    const sl = [];
    let sm = 0;
    const byIdx = new Map();
    for (let i = 0; i < SUBS; i++) {
      const r = subBy.get(i);
      const a = r ? firstAfter(r.applied, ([, rev]) => rev >= e.put.rev) : null;
      if (a && a[0] <= deadline) { sl.push(a[0] - tPut); byIdx.set(i, a[0] - tPut); } else { sm++; byIdx.set(i, null); }
    }
    const st = S.strata.find((x) => x.k === e.k);
    const strata = Object.fromEntries(STRATA.map((n) => [n, { lat: [], missing: 0 }]));
    let unclassified = SUBS;
    if (st?.clients) {
      unclassified = 0;
      for (const [idx, cls] of st.clients) {
        if (!cls) { unclassified++; continue; }
        const v = byIdx.get(idx);
        if (v == null) strata[cls].missing++;
        else strata[cls].lat.push(v);
      }
    }
    return {
      k: e.k, mode: e.mode, offsetS: e.offsetS, rev: e.put.rev, putStart: tPut, putMs: e.put.ms, sampleLagMs: st?.answeredAt != null ? st.answeredAt - st.askedAt : null,
      pages: latSummary(pl, pm, GATE_P95_MS), sdk: latSummary(sl, sm, GATE_P95_MS),
      strata: Object.fromEntries(STRATA.map((n) => [n, { n: strata[n].lat.length + strata[n].missing, ...latSummary(strata[n].lat, strata[n].missing, GATE_P95_MS) }])),
      strataUnclassified: unclassified,
      raw: { pl, pm, sl, sm, strata },
    };
  });
  const failedEdits = C.edits - S.edits.length;
  const aggPages = latSummary(saves.flatMap((x) => x.raw.pl), saves.reduce((a, x) => a + x.raw.pm, 0), GATE_P95_MS);
  const aggSdk = latSummary(saves.flatMap((x) => x.raw.sl), saves.reduce((a, x) => a + x.raw.sm, 0), GATE_P95_MS);
  const strataAgg = Object.fromEntries(STRATA.map((n) => {
    const lat = saves.flatMap((x) => x.raw.strata[n].lat);
    const miss = saves.reduce((a, x) => a + x.raw.strata[n].missing, 0);
    return [n, { n: lat.length + miss, exercised: lat.length + miss > 0, ...latSummary(lat, miss, GATE_P95_MS) }];
  }));
  const worstOf = (pop) => saves.reduce((w, x) => (w == null || (x[pop].p95 ?? -1) > (w[pop].p95 ?? -1) ? x : w), null);

  // ── writes ──
  const expectedWrites = Array.from({ length: C.edits }, (_, i) => (modeOf(i + 1) === "pair" ? 2 : 1)).reduce((a, v) => a + v, 0);
  const okWrites = S.writes.filter(okW);
  const putMs = S.writes.filter((w) => w.op === "put" && okW(w)).map((w) => w.ms);
  const putD = dist(putMs);
  const allD = dist(okWrites.map((w) => w.ms));
  const writes = {
    expected: expectedWrites, attempted: S.writes.length, ok: okWrites.length, failed: S.writes.filter((w) => !okW(w)),
    put: putD, all: allD, anchor: anchor ? { id: anchor.id, rev: anchor.rev ?? null, ms: anchor.ms ?? null, startedAt: anchor.startedAt ?? null } : null,
    pass: okWrites.length === expectedWrites && S.writes.length === expectedWrites,
    putPass: putD.n > 0 && putD.p95 <= 1500,
  };

  // ── failures (baseline start → measurement end) ──
  const inWin = (t) => t != null && t >= from && t <= to;
  const errs = { sdk: { s5xx: 0, transport: 0, malformed: 0, http4xx: 0, gap: 0 }, pages: { s5xx: 0, failedRequests: 0, reloads: 0, pageErrors: 0, http4xx: 0 }, saves: 0 };
  for (const r of subRecs) {
    for (const q of r.reqs || []) {
      if (!inWin(q[0])) continue;
      if (q[6] >= 500) errs.sdk.s5xx++;
      else if (q[11] === "failed" && q[7] == null) {
        if (q[6] === 0) errs.sdk.transport++;
        else if (q[6] === 200) errs.sdk.malformed++;
        else errs.sdk.http4xx++;
      } else if (q[11] === "failed") errs.sdk.gap++;
    }
  }
  for (const r of pageRecs) {
    for (const f of r.fetches) {
      if (!inWin(f[7] ?? f[0])) continue;
      if (f[2] >= 500) errs.pages.s5xx++;
      else if (f[2] >= 400) errs.pages.http4xx++;
    }
    errs.pages.failedRequests += (r.reqFailed || []).filter(([t]) => inWin(t)).length;
    errs.pages.reloads += (r.docLoads || []).slice(1).filter(([t]) => inWin(t)).length;
    errs.pages.pageErrors += (r.pageErrs || []).filter(([t]) => inWin(t)).length;
  }
  errs.saves = S.writes.filter((w) => w.status >= 500 || w.status === 0).length;
  errs.total = errs.sdk.s5xx + errs.sdk.transport + errs.sdk.malformed + errs.pages.s5xx + errs.pages.failedRequests + errs.pages.reloads + errs.pages.pageErrors + errs.saves;
  errs.pass = errs.total === 0;

  // ── request rate, baseline, drain ──
  const sdkRows = [];
  for (const r of subRecs) for (const q of r.reqs || []) sdkRows.push([q[0], sdkReqCategory(q), q[6]]);
  const pageRows = pageRecs.flatMap((r) => r.fetches.map((f) => [f[7] ?? f[0], f[2], !!f[6]]));
  const buckets = rateBuckets({ from: P.baselineStart, to: P.recoveryEnd, sdk: sdkRows, pages: pageRows });
  const totals = buckets.map((b) => b.total);
  const roll = rolling(totals);
  buckets.forEach((b, i) => { b.roll10 = roll[i]; });
  const base = baselineStats(totals.slice(0, Math.round(C.baselineSecs)));
  const threshold = drainThreshold(base.mu, base.s10);
  const stateAt = (t) => (SUBS === 0 ? { t, pending: 0, carried: 0, inFlightTicket: 0 } : sampleAt(S.stateSamples, t));
  const dr = confirmDrain({ totals, from: P.baselineStart, lastSend: P.lastSend, threshold, stateAt });
  const rebound = dr.confirm ? reboundRequests(subRecs, { from: dr.confirm.to, to: P.recoveryEnd, isGenuine }) : null;
  let later = null;
  if (dr.confirm) {
    const ci = Math.round((dr.confirm.to - P.baselineStart) / 1000);
    const after = roll.slice(ci).filter((v) => v != null);
    const st = S.stateSamples.filter((x) => x.t > dr.confirm.to && x.t <= P.recoveryEnd);
    later = {
      maxRoll10: after.length ? Math.max(...after) : null, overThreshold: after.filter((v) => v > threshold).length,
      maxPending: st.reduce((a, x) => Math.max(a, x.pending), 0), maxCarried: st.reduce((a, x) => Math.max(a, x.carried), 0), maxInFlightTicket: st.reduce((a, x) => Math.max(a, x.inFlightTicket), 0),
    };
  }
  const drain = { mu: base.mu, s10: base.s10, baselineWindows: base.windows, threshold, ...dr, rebound, later, pass: !!dr.confirm && dr.withinDeadline && rebound != null && rebound.count === 0 };
  const pagesHinted = new Map();
  for (const r of pageRecs) for (const f of r.fetches) {
    const t = f[7] ?? f[0];
    if (!f[6] || t < P.baselineStart || t >= P.recoveryEnd) continue;
    const s = Math.floor((t - P.baselineStart) / 1000);
    pagesHinted.set(s, (pagesHinted.get(s) || 0) + 1);
  }
  const peaks = {
    sdkNotificationPerS: buckets.reduce((a, b) => Math.max(a, b.notification), 0),
    sdkRecheckPerS: buckets.reduce((a, b) => Math.max(a, b.recheck), 0),
    pagesHintedPerS: [...pagesHinted.values()].reduce((a, v) => Math.max(a, v), 0),
    totalPerS: buckets.reduce((a, b) => Math.max(a, b.total), 0),
    roll10Max: roll.reduce((a, v) => (v == null ? a : Math.max(a, v)), 0),
    s503: buckets.reduce((a, b) => a + b.s503, 0),
  };
  const phaseRate = (a, b) => {
    const xs = buckets.filter((x) => x.t >= a && x.t < b);
    return xs.length ? xs.reduce((s, x) => s + x.total, 0) / xs.length : null;
  };
  const rates = { baseline: phaseRate(P.baselineStart, P.spamStart), spam: phaseRate(P.spamStart, P.lastSend), recovery: phaseRate(P.lastSend, P.recoveryEnd) };

  const cool = cooldownCheck(subRecs, { from: P.baselineStart, to: P.recoveryEnd, cooldownMs: COOLDOWN_MS });
  const wm = watermarkViolations(subRecs, { genuine, initialHead: S.initialHead, until: P.measurementEnd });
  const td = ticketDropRecovery(subRecs, { saves: commitList, initialHead: S.initialHead, isForged: (h, t) => !isGenuine(h, t), until: P.measurementEnd });
  const probeRtt = dist(S.browserProbe.map((x) => x[2]).filter((x) => x != null));

  // ── gates, aspects, verdict ──
  const gates = [
    { name: `honest latency per save — pages (p95 ≤ ${GATE_P95_MS} ms, 0 missing, every save)`, value: `${saves.filter((x) => x.pages.pass === false).length} save(s) failing; aggregate p95 ${ms(aggPages.p95)} max ${ms(aggPages.max)} missing ${aggPages.missing}${failedEdits ? `; **${failedEdits} edit(s) not saved**` : ""}`, pass: PAGES === 0 ? null : failedEdits === 0 && saves.every((x) => x.pages.pass !== false) },
    { name: `honest latency per save — SDK (p95 ≤ ${GATE_P95_MS} ms, 0 missing, every save)`, value: `${saves.filter((x) => x.sdk.pass === false).length} save(s) failing; aggregate p95 ${ms(aggSdk.p95)} max ${ms(aggSdk.max)} missing ${aggSdk.missing}${failedEdits ? `; **${failedEdits} edit(s) not saved**` : ""}`, pass: SUBS === 0 ? null : failedEdits === 0 && saves.every((x) => x.sdk.pass !== false) },
    { name: "writes: every measured write 2xx, never retried", value: `${writes.ok}/${writes.expected} (attempted ${writes.attempted})`, pass: writes.pass },
    { name: "PUT end-to-end p95 ≤ 1500 ms", value: `n ${putD.n}, p95 ${ms(putD.p95)}, max ${ms(putD.max)}`, pass: writes.putPass },
    { name: "0 × 5xx / transport / malformed / reloads / page errors (baseline → measurement end)", value: `${errs.total} (SDK 5xx ${errs.sdk.s5xx}, transport ${errs.sdk.transport}, malformed ${errs.sdk.malformed}; pages 5xx ${errs.pages.s5xx}, failed ${errs.pages.failedRequests}, reloads ${errs.pages.reloads}, errors ${errs.pages.pageErrors}; saves ${errs.saves})`, pass: errs.pass },
    { name: "drain: a 10 s interval ≤ threshold completed ≤ 30 s after the last send, 0 outstanding tickets then, no rebound after", value: dr.confirm ? `${iso(dr.confirm.from)} → ${iso(dr.confirm.to)} (${(dr.confirm.completedAfterLastSendMs / 1000).toFixed(1)} s after the last send), ${dr.confirm.avg.toFixed(1)} req/s ≤ ${threshold.toFixed(1)}; rebound ${rebound?.count ?? "—"}` : `not confirmed before the recovery end (threshold ${threshold.toFixed(1)} req/s)`, pass: drain.pass },
    { name: `cooldown: ticket-carrying requests ≥ ${COOLDOWN_MS} ms apart per SDK client`, value: `${cool.tooClose} too close on ${cool.clientsBad} client(s); min gap ${ms(cool.minGap)}`, pass: SUBS === 0 ? null : cool.pass },
    { name: "durable watermark: serverRev only ever a genuine committed revision", value: `${wm.violations} violation(s) on ${wm.clients} client(s) (${wm.checked} watermark changes checked)`, pass: SUBS === 0 ? null : wm.pass },
    { name: "monotonic (pages DOM version / SDK applied rev)", value: monotonicPass ? "0 regressions" : "regressions (see the gate table)", pass: monotonicPass },
    ...(stale ? [{ name: "stale control: every ELIGIBLE stale hint ignored (rev ≤ the client's serverRev at receipt; SDK)", value: `${stale.notedEligible} noted of ${stale.eligible} eligible; ${stale.nonEligible} not eligible (${stale.nonEligibleNoted} noted, correctly)`, pass: stale.pass }] : []),
  ];
  const notExercised = [];
  if (C.spamRev !== "none" && !exp.exercised) notExercised.push(`spam exposure ${C.spamRev} ${C.spamRate}/s: ${exp.reasons.join("; ")}`);
  if (!S.fixture.match) notExercised.push(`fixture not verified in the served snapshot (${JSON.stringify(S.fixture)})`);
  if (declared?.endedAt && Date.parse(declared.endedAt) < P.recoveryEnd) notExercised.push(`declared background process ${declared.pid} ended at ${declared.endedAt}, before the recovery end`);
  if (stale && stale.eligible === 0) notExercised.push("stale control: no eligible receipt (no client had the forged rev ≤ its serverRev)");
  const diagnostics = [
    ...STRATA.filter((n) => !strataAgg[n].exercised).map((n) => `stratum ${n}: NOT EXERCISED (no SDK client in it at any PUT start)`),
    ...(td.exercised ? [] : ["ticket-drop recovery: NOT EXERCISED (no forged ticket exhausted while its client was behind, then converged by a generic request without a save)"]),
  ];
  const verdict = spam7Verdict({ invalid: valid.invalid, gates, notExercised });

  // ── markdown ──
  const vv = (x) => (x == null ? "n/a" : x ? "**PASS**" : "**FAIL**");
  const L = [];
  L.push("## Spam (n14 step 7)");
  L.push("");
  L.push(`**VERDICT: ${verdict.verdict}**${verdict.failed.length ? ` — failed: ${verdict.failed.join("; ")}` : ""}${verdict.notExercised.length ? ` — not exercised: ${verdict.notExercised.join("; ")}` : ""}`);
  L.push("");
  L.push(`- Spam: \`${C.spamRev}\` at ${C.spamRate}/s for ${C.spamSecs} s (payload \`{ kind: "setlist", rev, runId: "${RUN_ID}", k }\`); baseline ${C.baselineSecs} s, recovery ${C.recoverySecs} s; saves at spam ${C.offsets.map((o) => (o >= 0 ? `+${o}` : `${o}`)).join(", ")} s (${C.edits} mixed edits = ${expectedWrites} measured writes + the anchor)`);
  L.push(`- Phases (UTC): baseline ${iso(P.baselineStart)} · spam ${iso(P.spamStart)} · first send ${iso(P.firstSend)} · last send ${iso(P.lastSend)} (scheduled attack end ${iso(P.attackEndScheduled)}) · recovery end ${iso(P.recoveryEnd)} · measurement end ${iso(P.measurementEnd)}`);
  L.push(`- Post-preparation head ${S.initialHead}; fixture: ${S.fixture.startRows} rows at start, ${S.fixture.dbRows} active after preparation, served ${S.fixture.servedItems ?? "—"} items at rev ${S.fixture.servedRev ?? "—"} → ${S.fixture.match ? "match" : "**MISMATCH**"}`);
  L.push(`- Declared populations: ${SUBS} SDK, ${PAGES} pages; declared process: ${declared ? `${declared.pid} ${declared.name ?? ""} started ${declared.startedAt ?? "?"}, ended ${declared.endedAt ?? "after the run"} — \`${String(declared.cmd ?? "").slice(0, 160).replace(/\|/g, "/")}\`` : "none"}`);
  L.push(`- Host re-checks: ${(S.hostChecks || []).map((c) => `${c.label} ${c.ok == null ? "not checked" : c.ok ? "clean" : `**${c.competing.length} competing**`}`).join("; ") || "—"}; browser round trips ${dist(S.browserProbe.map((x) => x[2]).filter((x) => x != null)).n}/${S.browserProbe.length} answered, p50 ${ms(probeRtt.p50)} / max ${ms(probeRtt.max)} ms (INVALID > ${SPAM7_BROWSER_INVALID_MS} ms)`);
  if (S.headObserved) L.push(`- Stale control head check (${iso(S.headObserved.at)}): head ${S.headObserved.head} observed by SDK ${S.headObserved.sdk}/${S.headObserved.sdkDeclared}, pages ${S.headObserved.pages}/${S.headObserved.pagesDeclared} (body-rev proxy) → ${S.headObserved.verified ? "verified" : "**not all**"}`);
  L.push("");
  L.push("| Gate | value | verdict |");
  L.push("|---|---|---|");
  for (const g of gates) L.push(`| ${g.name} | ${String(g.value).replace(/\|/g, "/")} | ${vv(g.pass)}${valid.invalid ? " (measurement invalid)" : ""} |`);
  L.push(`| exposure (predeclared: sends ≥ ${EXPOSURE_MIN.send * 100} % per 10 s, ack ≥ ${EXPOSURE_MIN.ack * 100} %, timely ≤ ${TIMELY_MS} ms ≥ ${EXPOSURE_MIN.timely * 100} % of planned per 10 s and ≥ ${EXPOSURE_MIN.perClient * 100} % per client) | ${C.spamRev === "none" ? "no sender (control)" : exp.exercised ? "exercised" : exp.reasons.join("; ").replace(/\|/g, "/")} | ${C.spamRev === "none" ? "n/a" : exp.exercised ? "EXERCISED" : "**NOT EXERCISED**"} |`);
  L.push("");
  if (C.spamRev !== "none") {
    L.push("### Exposure");
    L.push("");
    L.push(`Sender: ${exp.sent}/${exp.planned} sent, ${exp.skipped} skipped (${Object.entries(S.sends.reduce((o, s) => { if (s.skip) o[s.skip] = (o[s.skip] || 0) + 1; return o; }, {})).map(([k, v]) => `${k} ${v}`).join(", ") || "none"}); ack ok ${exp.ackOk}/${exp.sent} (${pct1(exp.ackShare)}), ack ms p50/p95/max ${ms(exp.ackMs.p50)}/${ms(exp.ackMs.p95)}/${ms(exp.ackMs.max)}; send − slot ms p95/max ${ms(exp.sendLateMs.p95)}/${ms(exp.sendLateMs.max)}.`);
    L.push("");
    L.push("| 10 s bucket (from spam start) | planned | sent | skipped | ack ok | achieved /s | timely SDK (of planned) | timely pages (of planned) |");
    L.push("|---|---|---|---|---|---|---|---|");
    for (const b of exp.buckets) {
      if (!b.planned) continue;
      const sh = (pop, n) => (n > 0 ? pct1(b.timely[pop] / (b.planned * n)) : "—");
      L.push(`| +${b.i * 10} s | ${b.planned} | ${b.sent} | ${b.skipped} | ${b.ackOk} | ${(b.sent / 10).toFixed(1)} | ${sh("sdk", SUBS)} | ${sh("pages", PAGES)} |`);
    }
    L.push("");
    L.push("| population | declared | recorded | timely / planned deliveries | worst bucket | per-client min | clients < 95 % | late (> 2 s) | duplicates | delivery ms p50/p95/max |");
    L.push("|---|---|---|---|---|---|---|---|---|---|");
    for (const [pop, x] of Object.entries(exp.populations)) L.push(`| ${pop} | ${x.declared} | ${x.recorded} | ${x.timelyTotal}/${x.plannedDeliveries} | ${pct1(x.bucketMin)} | ${pct1(x.perClientMin)} | ${x.clientsBelow} | ${x.late} | ${x.duplicates} | ${ms(x.delivery.p50)}/${ms(x.delivery.p95)}/${ms(x.delivery.max)} |`);
    L.push("");
    if (stale) {
      L.push(`Stale control (SDK, eligible = forged rev ≤ the client's serverRev at receipt): eligible ${stale.eligible}, ignored ${stale.ignored}, **noted ${stale.notedEligible}**; not eligible ${stale.nonEligible} (noted ${stale.nonEligibleNoted} — a lagging client noting news is correct); unknown serverRev ${stale.unknown}.${pagesStaleEligible ? ` Pages (body-rev proxy, outcome not observable): eligible ${pagesStaleEligible.eligible}, not eligible ${pagesStaleEligible.nonEligible}.` : ""}`);
      L.push("");
    }
  }
  L.push("### Honest latency per save (PUT first-attempt start → page DOM marker / SDK applied rev ≥ PUT rev)");
  L.push("");
  L.push(`Every edit × client pair of the declared populations counts (no exclusions). Missing = not within ${TIMEOUT_MS / 1000} s. Strata = the SDK client's state at the PUT dispatch.`);
  L.push("");
  L.push("| save | offset s | mode | rev | PUT ms | pages p95 / max / missing / > 3 s | SDK p95 / max / missing / > 3 s | strata n (none / queued / in-flight ticket / other ticket fetch) | SDK p95 per stratum |");
  L.push("|---|---|---|---|---|---|---|---|---|");
  const cell = (x) => `${ms(x.p95)} / ${ms(x.max)} / ${x.missing} / ${pct1(x.overShare)} ${vv(x.pass)}`;
  for (const x of saves) L.push(`| ${x.k} | ${x.offsetS} | ${x.mode} | ${x.rev} | ${x.putMs} | ${cell(x.pages)} | ${cell(x.sdk)} | ${STRATA.map((n) => x.strata[n].n).join(" / ")}${x.strataUnclassified ? ` (+${x.strataUnclassified} unsampled)` : ""} | ${STRATA.map((n) => ms(x.strata[n].p95)).join(" / ")} |`);
  L.push(`| **all** | | | | | ${cell(aggPages)} | ${cell(aggSdk)} | ${STRATA.map((n) => strataAgg[n].n).join(" / ")} | ${STRATA.map((n) => ms(strataAgg[n].p95)).join(" / ")} |`);
  L.push("");
  const wp = worstOf("pages");
  const ws = worstOf("sdk");
  if (wp || ws) L.push(`Worst save: pages ${wp ? `save ${wp.k} p95 ${ms(wp.pages.p95)} max ${ms(wp.pages.max)} > 3 s ${pct1(wp.pages.overShare)}` : "—"}; SDK ${ws ? `save ${ws.k} p95 ${ms(ws.sdk.p95)} max ${ms(ws.sdk.max)} > 3 s ${pct1(ws.sdk.overShare)}` : "—"}; saves failing: pages ${saves.filter((x) => x.pages.pass === false).length}, SDK ${saves.filter((x) => x.sdk.pass === false).length} (the degraded target, should the gate fail).`);
  if (diagnostics.length) L.push(`Diagnostics: ${diagnostics.join("; ")}.`);
  L.push("");
  L.push("### Writes (never retried)");
  L.push("");
  L.push(`Anchor (preparation): row ${writes.anchor?.id ?? "—"} rev ${writes.anchor?.rev ?? "—"} ${writes.anchor?.ms ?? "—"} ms. Measured: ${writes.ok}/${writes.expected} 2xx; PUT ms p50/p95/max ${ms(putD.p50)}/${ms(putD.p95)}/${ms(putD.max)}; all writes p95 ${ms(allD.p95)}. Writer acquire (≤ 500 ms) is in the server logs (spam7-join.mjs).`);
  L.push("");
  L.push("| save | op | due offset s | start late ms | ms | status | rev | x-vercel-id |");
  L.push("|---|---|---|---|---|---|---|---|");
  for (const w of S.writes) L.push(`| ${w.k} | ${w.op} | ${w.offsetS} | ${w.lateMs} | ${w.ms} | ${w.status}${w.error ? ` **${String(w.error).slice(0, 60).replace(/\|/g, "/")}**` : ""} | ${w.rev ?? "—"} | ${w.vercelId ?? "—"} |`);
  L.push("");
  L.push("### Request rate and drain");
  L.push("");
  L.push(`Snapshot requests (SDK + pages) per second by request start, each counted once (k6 traffic excluded). Baseline μ ${base.mu.toFixed(2)} req/s, s₁₀ ${base.s10.toFixed(2)} (SD of ${base.windows.length} non-overlapping 10 s averages) → threshold μ + max(0.5 μ, 2, 2 s₁₀) = **${threshold.toFixed(2)} req/s**. Phase means: baseline ${rates.baseline?.toFixed(1) ?? "—"}, spam ${rates.spam?.toFixed(1) ?? "—"}, recovery ${rates.recovery?.toFixed(1) ?? "—"} req/s.`);
  L.push("");
  L.push(`- First rate-quiet interval: ${dr.firstQuiet ? `${iso(dr.firstQuiet.from)} → ${iso(dr.firstQuiet.to)} (${dr.firstQuiet.avg.toFixed(1)} req/s; tickets then: pending ${dr.firstQuiet.state?.pending ?? "?"}, carried ${dr.firstQuiet.state?.carried ?? "?"}, in-flight ${dr.firstQuiet.state?.inFlightTicket ?? "?"})` : "none"}`);
  L.push(`- Confirming interval: ${dr.confirm ? `${iso(dr.confirm.from)} → ${iso(dr.confirm.to)}, completed ${(dr.confirm.completedAfterLastSendMs / 1000).toFixed(1)} s after the last send (${dr.withinDeadline ? "≤ 30 s" : "**> 30 s**"}), ${dr.confirm.avg.toFixed(1)} req/s; outstanding at its end: pending ${dr.confirm.state.pending}, carried ${dr.confirm.state.carried}, in-flight ticket ${dr.confirm.state.inFlightTicket}` : "**none before the recovery end**"}`);
  L.push(`- After it (to the recovery end): forged ticket / recheck rebound ${rebound ? `**${rebound.count}**${rebound.count ? ` (${JSON.stringify(rebound.byReason)})` : ""}, genuine-ticket requests ${rebound.genuine}` : "—"}; ${later ? `max rolling 10 s ${later.maxRoll10?.toFixed(1) ?? "—"} req/s (${later.overThreshold} s over the threshold), max outstanding pending/carried/in-flight ${later.maxPending}/${later.maxCarried}/${later.maxInFlightTicket}` : ""}`);
  L.push(`- Peaks: SDK notification fetches ${peaks.sdkNotificationPerS}/s, rechecks ${peaks.sdkRecheckPerS}/s, page hinted fetches ${peaks.pagesHintedPerS}/s, all snapshot requests ${peaks.totalPerS}/s (rolling 10 s max ${peaks.roll10Max.toFixed(1)}); 503s ${peaks.s503}. Cooldown: min gap ${ms(cool.minGap)} ms.`);
  L.push("");
  L.push("| 10 s from baseline start | notification | recheck | generic | other SDK | pages | 503 | total req/s |");
  L.push("|---|---|---|---|---|---|---|---|");
  for (let i = 0; i < buckets.length; i += 10) {
    const xs = buckets.slice(i, i + 10);
    const sum = (k) => xs.reduce((a, b) => a + b[k], 0);
    L.push(`| +${i} s | ${sum("notification")} | ${sum("recheck")} | ${sum("generic")} | ${sum("other")} | ${sum("pages")} | ${sum("s503")} | ${(sum("total") / xs.length).toFixed(1)} |`);
  }
  L.push("");
  L.push("### Durable state and ticket-drop recovery");
  L.push("");
  L.push(`- Watermark: ${wm.checked} serverRev changes checked against the post-preparation head ${S.initialHead} and this run's ${genuine.size} committed revisions → ${wm.violations} violation(s)${wm.examples.length ? `: ${wm.examples.slice(0, 3).map((x) => `client ${x.idx} rev ${x.rev} (${x.why})`).join("; ")}` : ""}`);
  L.push(`- Forged tickets exhausted: ${td.counts.forgedExhausted} (expected under spam, not failures) — client current ${td.counts.current}, recovered by a generic request without a save ${td.counts.recovered}, repaired by a later save ${td.counts["repaired-by-save"]}, via a ticket path ${td.counts["ticket-path"]}, not converged ${td.counts["not-converged"]} → ${td.exercised ? "EXERCISED" : "NOT EXERCISED"}`);
  for (const r of td.rows.filter((x) => x.cls === "recovered").slice(0, 5)) L.push(`  - client ${r.idx}: exhausted ${r.hint} at ${iso(r.exhaustedAt)} with rev ${r.appliedRev} < head ${r.head}; converged ${r.delayMs} ms later by ${r.reason}`);
  L.push("");

  // ── JSON (README "spam7 JSON") ──
  const rel = (t) => (t == null ? null : t - P.spamStart);
  const json = {
    config: { ...C, label: args.label ?? null, base: BASE, runId: RUN_ID, timelyMs: TIMELY_MS, exposureMin: EXPOSURE_MIN, declared: { sdk: SUBS, pages: PAGES }, gateP95Ms: GATE_P95_MS, putGateMs: 1500, drainDeadlineMs: 30000, timeoutMs: TIMEOUT_MS, maxOutstandingAcks: SPAM7_MAX_OUTSTANDING_ACKS, browserInvalidMs: SPAM7_BROWSER_INVALID_MS },
    phases: P, phasesIso: Object.fromEntries(Object.entries(P).map(([k, v]) => [k, iso(v)])),
    initialHead: S.initialHead, fixture: S.fixture, headObserved: S.headObserved,
    declaredProcess: declared, hostChecks: S.hostChecks || [],
    // sends: the detailed sender rows plus the canonical aliases the join
    // reads (ackOk boolean, skipped boolean; `skip` keeps the reason).
    sends: S.sends.map((s) => ({ ...s, ackOk: s.ack === "ok", skipped: s.sentAt == null })),
    receipts: {
      row: ["k", "receivedAt − spamStart ms", "outcome (SDK: n noted | d ignored | x dropped | i invalid; pages: x dropped by a proxy | ? not observable)", "serverRev at receipt (SDK: the acceptance watermark; pages: highest body rev fetched before — a proxy)"],
      sdk: sdkRc.map((c) => ({ idx: c.idx, rows: c.rows.map(([k, t, o, s]) => [k, rel(t), o, s]) })),
      pages: pageRc.map((c) => ({ idx: c.idx, rows: c.rows.map(([k, t, o, s]) => [k, rel(t), o, s]) })),
    },
    exposure: { ...exp, populations: Object.fromEntries(Object.entries(exp.populations || {}).map(([k, v]) => [k, v])) },
    stale, pagesStale: pagesStaleEligible,
    saves: saves.map((x) => ({ ...x, raw: undefined, pagesLat: x.raw.pl, sdkLat: dist(x.raw.sl) })),
    latency: { pages: aggPages, sdk: aggSdk, gateP95Ms: GATE_P95_MS, failedEdits },
    strata: {
      row: ["client idx", "stratum (none | queued-ticket | inflight-ticket | other-ticket-fetch)", "carried ticket phase", "in-flight request reason"],
      aggregate: strataAgg,
      saves: S.strata.map((x) => ({ k: x.k, rev: x.rev, putStart: x.putStart, askedAt: x.askedAt, answeredAt: x.answeredAt, clients: x.clients })),
    },
    // writes: the canonical list for the join — the anchor (preparation)
    // and every measured write incl. the pair INSERTs, one row each
    // (never retried → attempts 1); putStart / putEnd = the request's
    // start / response on this host (any op, not only PUTs).
    writes: [
      ...(anchor?.startedAt != null ? [{ k: 0, op: "anchor", rev: anchor.rev ?? null, putStart: anchor.startedAt, putEnd: anchor.startedAt + (anchor.ms ?? 0), status: 200, attempts: 1, rowId: anchor.id }] : []),
      ...S.writes.map((w) => ({ k: w.k, op: w.op, rev: w.rev, putStart: w.startedAt, putEnd: w.startedAt + (w.ms ?? 0), status: w.status, attempts: 1, rowId: w.rowId ?? null, error: w.error })),
    ],
    writesDetail: S.writes,
    writesSummary: { expected: writes.expected, attempted: writes.attempted, ok: writes.ok, put: putD, all: allD, anchor: writes.anchor, pass: writes.pass, putPass: writes.putPass },
    // Request-START epoch ms of every hint=1 request (SDK + pages) in the
    // measurement window — reconciled by the join against the server's
    // hint-fetch lines.
    hintedStarts: [
      ...subRecs.flatMap((r) => (r.reqs || []).filter((q) => q[4] === 1 && q[0] >= from && q[0] <= to).map((q) => q[0])),
      ...pageRecs.flatMap((r) => r.fetches.filter((f) => f[6] && (f[7] ?? f[0]) >= from && (f[7] ?? f[0]) <= to).map((f) => f[7] ?? f[0])),
    ].sort((a, b) => a - b),
    errors: errs,
    // 1 s buckets: the canonical names (sdkNotification, sdkRecheck,
    // sdkGeneric, pagesHinted, pagesGeneric, s503) plus sdkOther, total
    // and the trailing 10 s average.
    buckets: buckets.map((b) => ({ t: b.t, sdkNotification: b.notification, sdkRecheck: b.recheck, sdkGeneric: b.generic, sdkOther: b.other, pagesHinted: b.pagesHinted, pagesGeneric: b.pagesGeneric, s503: b.s503, total: b.total, roll10: b.roll10 })),
    rates, peaks,
    drain: { ...drain, rebound },
    workerState: S.stateSamples,
    cooldown: cool, watermark: wm, ticketDrop: td,
    browserProbe: { row: ["t", "page idx", "round trip ms (null = no answer in 10 s)"], samples: S.browserProbe, rtt: probeRtt },
    gates, notExercised, diagnostics, verdict,
  };
  return { lines: L, json, verdict };
}

function report(state, fin) {
  const { edits, popSummary, drillEvents, drillPageSet } = state;
  const { pageRecs, subRecs, clean, verify } = fin;
  const drillK = DRILL_EDIT;

  // ─── measurement validity ───
  // Window: from the population start (the first SDK client's first
  // request) to the end of the edit window. Clean-up, worker shutdown
  // and this report run after it and cannot move a measured timestamp.
  // Step 7: baseline start → measurement end (design §0: validity covers
  // baseline → recovery; the join before it is not measured).
  const vFrom = state.spam7 ? state.spam7.phases.baselineStart : state.popStart ?? state.runStart;
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
  if (state.spam7) {
    const P = state.spam7.phases;
    phases.push(
      { name: "spam7 baseline", from: P.baselineStart, to: P.spamStart },
      { name: "spam7 spam", from: P.spamStart, to: P.lastSend },
      { name: "spam7 recovery", from: P.lastSend, to: P.recoveryEnd },
    );
  }
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
  const pageMono = pageRecs.map((r) => ({ r, ...pageMonotonicity(r, idx, state.editsEnd, state.transition?.allowGone ?? null) }));
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
  // Step 5: the admission / I3 / idle saves are scheduled, never retried,
  // and judged by their own section; only the numbered steady edits count
  // here.
  const skippedEdits = OVERLAP
    ? (state.overlap?.groups ?? []).filter((g) => !g.anchor.allOk).length
    : IDLE || TXC ? 0 : ADM ? EDITS - edits.filter((e) => typeof e.k === "number").length : EDITS - edits.length;
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

  // ─── n14 step 5 sections ───
  // Under --phase=admission / --drill=idle-broadcast the per-save rows
  // (every client from the PUT start) stay as information: a client that
  // joined after a save cannot be judged from its start. The step-5
  // section decides (population-split clocks, exposure, eligibility).
  const adm = ADM && state.admission ? admissionReport(state, fin, { valid, idx, monotonicPass: verdicts.monotonic.pass }) : null;
  const idl = IDLE && state.idle ? idleReport(state, fin) : null;
  const trn = TXC && state.transition ? transitionReport(state, fin, { valid, pageMono, subMono }) : null;
  // Step 7: the "Spam (n14 step 7)" section decides (per save, per
  // population, plus exposure / drain / writes / errors / watermark).
  const s7 = S7 && state.spam7 ? spam7Report(state, fin, { valid, monotonicPass: verdicts.monotonic.pass }) : null;
  if (s7) {
    verdicts.primary.gate = "informational under --phase=spam7 (pooled); the Spam (n14 step 7) section decides per save and per population";
    verdicts.primary.pass = null;
    verdicts.pages.pass = null;
    verdicts.subs.pass = null;
  }
  if (trn) {
    verdicts.primary.gate = "informational under --phase=transition (every client from each save's own start, arrivals included); the Transition section decides";
    verdicts.primary.pass = null;
    verdicts.pages.pass = null;
    verdicts.subs.pass = null;
  }
  if (adm || idl) {
    verdicts.primary.gate = `informational under ${ADM ? "--phase=admission" : "--drill=idle-broadcast"} (every client from each save's own start); the ${ADM ? "Admission" : "Idle-broadcast"} section decides`;
    verdicts.primary.pass = null;
    verdicts.pages.pass = null;
    verdicts.subs.pass = null;
  }

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
  } else if (idl) {
    verdicts.drill = {
      drill: DRILL, gate: "every exercised cohort control: each eligible client receives the save's raw broadcast and applies it within the timeout (see \"Idle-broadcast drill\")",
      ...dist([]), missing: 0, pass: idl.verdict === "FAIL" ? false : idl.verdict === "PASS" ? true : null,
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
  lines.push(IDLE
    ? `- Population: SDK cohorts only — ${IDLE.incumbents} incumbents${IDLE.wake ? ` + ${IDLE.fresh} fresh` : ""} (--drill=idle-broadcast)`
    : `- Population: ${PAGES} Chromium pages (ja/ko/en 70/20/10), ${SUBS} SDK subscribers in ${SUB_WORKERS} worker thread(s)${ADM?.finalCohort ? ` (+ ${ADM.finalCohort.fresh} fresh in the I3 final phase)` : ""}`);
  const modeTxt = { pair: "(insert-after + PUT marker song) — edit mode pair", standalone: "(ONE PUT swapping the marker song on the anchor row) — edit mode standalone", mixed: "pair on odd edits, standalone on even — edit mode mixed" }[EDIT_MODE];
  if (IDLE) lines.push(`- Edits: the idle-broadcast schedule (first save = the anchor insert, then PUTs on it; see "Idle-broadcast drill"); timeout ${TIMEOUT_MS / 1000} s`);
  else if (OVERLAP) lines.push(`- Edits: ${EDITS} overlap group(s) × ${rolesOf(OV).length} concurrent PUTs (${rolesOf(OV).join(", ")}) on anchor rows ${rolesOf(OV).map((w) => ovAnchors[w]?.id).join(", ")}, every ${PAUSE_MS / 1000} s; timeout ${TIMEOUT_MS / 1000} s; drill: overlap (see "Overlap drill")`);
  else lines.push(`- Edits: ${EDITS} × ${modeTxt}${anchor ? ` (anchor row ${anchor.id})` : ""}, every ${PAUSE_MS / 1000} s; timeout ${TIMEOUT_MS / 1000} s; drill: ${DRILL ?? "none"}${DRILL ? ` (edit ${DRILL === "ws-blocked" ? "all" : drillK}, pages ${DRILL === "reconnect" ? "all + all SDK" : `${Math.min(DRILL_PAGES, PAGES)}`})` : ""}`);
  lines.push(`- Window (UTC): run start ${iso(state.runStart)}, first edit ${iso(state.editsStart)}, last edit settled ${iso(state.editsEnd)}, end ${iso(Date.now())}`);
  lines.push(`- Label: ${args.label ?? "—"}`);
  if (hostCheck) lines.push(`- Host guard at start: CPU ${hostCheck.busyPct ?? "—"} % busy (${hostCheck.how}); ${hostCheck.processListOk ? `${hostCheck.competing.length} competing process(es)` : "process list unavailable"}${hostCheck.problems.length ? ` — **${hostCheck.problems.join("; ").replace(/\|/g, "/")}**` : ""}${STRICT_HOST ? " (--strict-host)" : ""}`);
  lines.push("");
  if (ADM) lines.push(`- Phase: admission — prepare via ${PREP_BASE}, measured on ${BASE}${DEPLOYMENT_URL ? " (deployment URL)" : ""}`);
  if (TXC) lines.push(`- Phase: transition — ${TXC.files.length} switch(es) on ${BASE}`);
  if (S7) lines.push(`- Phase: spam7 — ${S7.spamRev} ${S7.spamRate}/s × ${S7.spamSecs} s, baseline ${S7.baselineSecs} s, recovery ${S7.recoverySecs} s on ${BASE}`);
  if (adm || idl || trn || s7) lines.push("");
  if (s7) lines.push(...s7.lines);
  if (trn) lines.push(...trn.lines);
  if (adm) lines.push(...adm.lines);
  if (idl) lines.push(...idl.lines);
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
  // Step 7 records its sends per slot in the spam7 section (sender table).
  if (guest && !S7) {
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
        "sdk.reqs": ["tStart", "reason", "generic 0/1", "hint", "notify 0/1", "minRev", "status (0 = network / deadline)", "verify kind", "body rev", "hint resolution", "tEnd", "outcome ok|failed|cancelled", "x-snapshot-source", "body capturedAt (epoch ms, PostgreSQL clock)", "anchor A song originalTitle (overlap drill, else null)", "body bytes (200, decoded)"],
        "sdk.statusLog": ["t", "status", "current channel 1 | retired 0"],
        "sdk.connLog": ["t", "up 1 | down 0", "status (SUBSCRIBED / CHANNEL_ERROR / TIMED_OUT / CLOSED / STOPPED)"],
        "page.rowsLog": ["t", "row signatures in DOM order (song ids joined by +, \"\" = no song link) — --phase=admission only"],
        "sdk.applied": ["t", "rev", "fetch reason", "body capturedAt (epoch ms)"],
        "sdk.bcasts": ["t", "rev", "n news | d duplicate | x dropped by drill | i invalid", "+ runId, k, serverRev at receipt — only on a step-7 forged message (payload with runId)"],
        ...(S7 ? { "sdk.serverRevLog": ["t", "serverRev (the acceptance watermark, on every change)"], "page.bcasts (step 7)": ["t", "rev", "n | x", "runId (forged only)", "k (forged only)"] } : {}),
        "sdk.exhausted": ["t", "hint"],
        "sdk.lag.deadlineLate": ["t", "lateMs"],
        "page.reqs": ["tResponse", "minRev", "status", "x-snapshot-source", "body rev", "x-snapshot-verify (raw)", "hint=1", "request start", "body capturedAt (epoch ms)"],
        "page.applied": ["t", "marker song ids added", "removed"],
        "page.bcasts": ["t", "rev", "n | x (dropped by the proxy drill)"],
        "page.notes": ["t", "postgres_changes type I/U/D", "row id"],
        ...(TXC ? {
          "sdk.reqs (transition)": SDK_ROW_TX,
          "page.reqs (transition)": ["tResponse", "minRev", "status", "x-snapshot-source", "body rev", "x-snapshot-verify (raw)", "hint=1", "request start", "body capturedAt (epoch ms)", "x-vercel-id", "x-vercel-cache", "cache-control", "age", "pin evidence", "body complete t", "request path + query"],
          "page.notes (transition)": ["t", "postgres_changes type I/U/D", "row id", "record isDeleted (true / false / null)", "table"],
        } : {}),
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
      cohort: r.cohort ?? null, attemptAt: r.attemptAt, stoppedAt: r.stoppedAt ?? null, statusLog: r.statusLog ?? null, connLog: r.connLog ?? null,
      ...(TXC ? { trig: r.trig ?? [] } : {}),
      ...(S7 ? { serverRevLog: r.serverRevLog ?? [] } : {}),
      lag: { thread: `worker ${r.worker ?? "?"}`, deadlineLate: lateByIdx.get(r.idx) || [] },
    })),
    ...pageRecs.map((r) => ({
      kind: "page", idx: r.idx, worker: null, locale: r.locale, mode: r.mode,
      reqs: r.fetches, applied: r.dom, bcasts: r.bcasts, notes: r.notes,
      openedAt: r.openedAt, loadedAt: r.loadedAt, joinAt: r.joinAt,
      ...(r.rowsLog ? { rowsLog: r.rowsLog, navStart: r.navStart, ttfbMs: r.ttfbMs, dclMs: r.dclMs, docStatus: r.docStatus, seed: r.seed, wave: r.wave, firstApiReqAt: r.firstApiReqAt, wsOpenAt: r.wsOpenAt } : {}),
      ...(TXC ? { cohort: r.cohort ?? null, docDplId: r.docDplId ?? null, docVercelId: r.docVercelId ?? null, pgReadyAt: r.pgReadyAt, assets: r.assets, navs: r.navs, reqFailed: r.reqFailed, pageErrs: r.pageErrs } : {}),
      ...(S7 ? { docLoads: r.docLoads ?? [], reqFailed: r.reqFailed ?? [], pageErrs: r.pageErrs ?? [] } : {}),
      // Page events are timestamped by the browser (DOM) or by Playwright
      // callbacks on the main thread; the main thread's lag is the one
      // that can delay the latter.
      lag: { thread: "main" },
    })),
  ].map((o) => JSON.stringify(o));

  const json = {
    config: { base: BASE, phase: PHASE, prepBase: ADM ? PREP_BASE : null, eventId: EVENT_ID, eventPath: EVENT_PATH, pages: PAGES, subs: SUBS, subWorkers: SUB_WORKERS, edits: EDITS, editMode: EDIT_MODE, anchorRow: anchor?.id ?? null, pauseMs: PAUSE_MS, timeoutMs: TIMEOUT_MS, drill: DRILL, drillPages: DRILL_PAGES, drillEdit: DRILL_EDIT, label: args.label ?? null,
      ...(DRILL === "poison" ? { poisonRev: POISON_REV, poisonLeadMs: POISON_LEAD_MS } : {}),
      ...(DRILL === "spam" ? { spamRate: SPAM_RATE, spamSecs: SPAM_SECS, spamRev: SPAM_REV } : {}),
      ...(S7 ? { spam7: S7, runId: RUN_ID } : {}),
      ...(DECLARED_PID ? { declaredPid: DECLARED_PID } : {}),
      ...(OVERLAP ? { overlap: OV, overlapAnchors: ovAnchors, overlapReactionGroup: OV_REACTION_GROUP, runId: RUN_ID } : {}) },
    window: { runStart: iso(state.runStart), editsStart: iso(state.editsStart), editsEnd: iso(state.editsEnd), end: iso(Date.now()) },
    verdicts, popSummary, rejoin, drillEvents,
    // n14 step 5 (null otherwise): the admission section (config,
    // boundary, per-save exposure / convergence / stale first answers,
    // gates, verdict, every page, every SDK client compact) and the
    // idle-broadcast drill (cohort cycles, eligibility, arrivals). The
    // input of ../admission-join.mjs.
    admission: adm ? adm.json : null,
    idle: idl ? idl.json : null,
    // n14 step 6 (null otherwise): the transition section — switches,
    // saves, guard, route marker, probe, subsets, arrivals, smoke,
    // exposure, verdicts, every SDK client / page with its per-response
    // rows (README "Transition phase"). The input of
    // ../transition-join.mjs.
    transition: trn ? trn.json : null,
    // n14 step 7 (null otherwise): the spam7 section — phases, sender
    // rows, receipts (compact), exposure, per-save latency and strata,
    // writes, errors, 1 s request buckets, drain, worker state, cooldown,
    // watermark, ticket-drop recovery, gates and verdict (README "spam7
    // JSON"). The input of ../spam7-join.mjs.
    spam7: s7 ? s7.json : null,
    declaredProcess: declared,
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
    // transition: every page is in `transition.pages` (with its
    // per-response rows); not repeated here.
    pages: TXC ? null : ADM ? pageRecs.map(({ rowsLog, ...rest }) => ({ ...rest, rowsLogEntries: rowsLog?.length ?? 0 })) : pageRecs,
  };
  return { md, json, timelines };
}

function writeResults(md, json, timelines) {
  const now = new Date();
  const dir = path.join(HERE, "..", "results", now.toISOString().slice(0, 10));
  fs.mkdirSync(dir, { recursive: true });
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  const base = path.join(dir, `${stamp}-browsers${DRILL ? `-${DRILL}` : ADM ? "-admission" : TXC ? "-transition" : S7 ? "-spam7" : ""}`);
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
  // Step 5: the section's verdict decides; NOT EXERCISED = exit 4 (the
  // run measured something else — re-run, do not read it as a pass).
  if (json.admission) {
    const vv = json.admission.verdict.verdict;
    log(`ADMISSION VERDICT: ${vv}`);
    process.exit(vv === "VALID + PASS" ? 0 : vv === "NOT EXERCISED" ? 4 : 1);
  }
  // Step 6: the transition verdict decides (ABORTED = exit 2).
  if (json.transition) {
    const tv = json.transition.verdict;
    log(`TRANSITION VERDICT: ${tv.verdict}${tv.failed?.length ? ` — failed: ${tv.failed.join("; ")}` : ""}${tv.notExercised?.length ? ` — not exercised: ${tv.notExercised.join("; ")}` : ""}`);
    process.exit(tv.exit);
  }
  // Step 7: the spam7 verdict decides (FAIL 1 > NOT EXERCISED 4 > PASS 0;
  // INVALID 3 was handled above).
  if (json.spam7) {
    const sv = json.spam7.verdict;
    log(`SPAM7 VERDICT: ${sv.verdict}${sv.failed.length ? ` — failed: ${sv.failed.join("; ")}` : ""}${sv.notExercised.length ? ` — not exercised: ${sv.notExercised.join("; ")}` : ""}`);
    process.exit(sv.exit);
  }
  if (json.idle) {
    log(`IDLE-BROADCAST VERDICT: ${json.idle.verdict}`);
    process.exit(json.idle.verdict === "PASS" ? 0 : json.idle.verdict === "FAIL" ? 1 : 4);
  }
  // null (nothing in scope, e.g. every pair drilled) is not a failure.
  process.exit(json.verdicts.primary.pass !== false && json.verdicts.drill?.pass !== false && json.verdicts.monotonic.pass !== false ? 0 : 1);
} catch (e) {
  log(`ERROR: ${e.stack || e.message}`);
  await finalize(mainState, `error: ${e.message}`);
  process.exit(2);
}
