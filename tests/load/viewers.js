// n14 run #2: the 500-viewer model on the R1 live path.
//
// One event (EVENT_ID, the `ongoing` rehearsal event on dev), five
// traffic shapes on one timeline:
//
//   t=0            cold start: one admin save (append a row) and right
//                  after it the first notification burst — on a cache
//                  that the save just invalidated (2 s snapshot TTL +
//                  `revalidateEventData` tag purge). The row is removed
//                  again (untimed, verified) before the steady streams.
//   STEADY_START   periodic poll, POLL_RPS (500 viewers / 20 s ± 4 s
//                  = 25 rps), 70/20/10 ja/ko/en, each poll carrying
//                  `?minRev=<highest rev this VU has seen>` like the
//                  R1 client's `minRevToSend()`; plus SSR_RPS of the
//                  ongoing event page (default 10 % of POLL_RPS).
//   ADMIN_FIRST…   ADMIN_CYCLES "burst" cycles + QUIET_CYCLES "quiet"
//                  cycles, ADMIN_SPACING apart. A cycle is admin-
//                  writes.js's six saves (create, update, insert-after,
//                  swap, delete ×2), SAVE_GAP seconds apart. In a burst
//                  cycle every save is followed by a notification burst
//                  (below); a quiet cycle measures the operator under
//                  the steady streams only. The two are judged
//                  separately (`window: burst | steady`), like hold.js
//                  judges its admin windows.
//   REACTION_AT    REACTIONS reaction taps in REACTION_SECONDS: POST,
//                  then DELETE of the row it created.
//   drain          DRAIN_S (default 90) seconds of NO traffic at the end:
//                  it starts once the last admin cycle, the steady window
//                  and the reaction window are all over, and the test
//                  keeps running through it so the side-car samplers
//                  (pooler-clients.mjs, the Vercel log capture) record
//                  the pools draining after the last burst. Set
//                  STEADY_SECONDS so the steady window ends near the last
//                  cycle, or the drain only starts after it (the report
//                  prints both times). DRAIN_S=0 ends right away.
//
// Cycle spacing: by default cycle k starts at ADMIN_FIRST + k*ADMIN_SPACING
// (fixed slots). With BURST_GAP_S set, cycle 1 starts at ADMIN_FIRST and
// every later cycle starts BURST_GAP_S seconds after the previous one
// FINISHED — "nearby" repeated bursts that land while the previous
// bursts' function instances (and their idle DB pools) are still warm.
//
// The notification burst (one per save in a burst cycle and at cold
// start): BURST_SIZE requests, each fired at U(0, JITTER_MS) after the
// save returned — the R1 scheduler's jitter on a postgres_changes
// notification. Each asks for `?minRev=<appliedRev + 1>` (appliedRev =
// the `rev` of the last snapshot the admin VU saw before the save), the
// value `SnapshotAcceptance.notificationMinRev()` sends. OLD_SHARE of
// them model pre-R1 tabs still open from before the deploy: no
// `minRev`, and OLD_REPEATS more requests OLD_REPEAT_MS apart (a v0.18
// tab refetches once per change event: k+1 times). Old tabs keep their
// own timing whatever JITTER_MS says: their first request is at
// U(0, 500 ms) (OLD_JITTER_MS, a constant) — they run the old build's
// scheduler, so a JITTER_MS experiment must only move the R1 clients,
// or a comparison between two runs would change two things at once.
//
// Why the admin loop and the bursts run on ONE VU with async requests:
// k6 has no shared state between VUs, so a burst that must start "right
// after the save returns" has to be fired by the VU that made the save.
// Synchronous `http.*` calls block the VU's event loop and would hold
// the burst's timers until they return, so everything on that VU after
// login is `http.asyncRequest` + timers. That is also why this file
// carries an async copy of admin-writes.js's cycle instead of importing
// it (same writes, same visibility check, same clean-up-then-abort).
// The burst therefore comes from one process over a few multiplexed
// HTTP/2 connections, not 500 browsers; per-request server work is the
// same, connection setup is not modelled.
//
// What "builds per save" means here: the `x-snapshot-source` header
// (build | cache | repair) is only a rough proxy — coalesced waiters share
// the first request's result object, header included, so it over-counts
// builds, while background rebuilds are never attributed to a response.
// The real count is the `[liveSnapshot] build` log lines: capture the
// Vercel logs during the run (vercel-logs-capture.mjs) and run
// vercel-logs-summary.mjs on them.
//
// `warm` (writer warming, server flag LIVE_WARM_ENTRIES=1) is a fourth
// source: the hinted fetch was answered from the entry the save's own
// warm job stored for exactly that minRev — no build at all. It is
// counted in the source split like the others and, for the r2 hinted
// fetches, as "warm hits ÷ hinted fetches" per burst and in the hint-
// outcomes line. Counting only: nothing the VUs do depends on it. With
// the flag off it stays 0 (the control).
//
// Burst errors: k6's end-of-test data has no way to carry strings from a
// VU to handleSummary except check names, so after each burst the admin
// VU records its distinct error bodies (status + first 80 characters, at
// most 5 per burst; the rest are lumped into "(other bodies)") as failed
// checks named `burst-error <id> | <body>`, one failed check per
// occurrence. handleSummary lists them per burst.
//
// Notification model (HINT_MODE). `r1` (default) is the above: the new-
// build tabs send `minRev = appliedRev + 1`, the R1 page's guess. `r2`
// is the R2 hint contract: the broadcast payload carries the exact saved
// revision, so a notification fetch sends `minRev = <rev from the save
// response>&hint=1` (the transient hint H; the durable server-observed
// watermark is ≤ H here, so max(serverRev, H) = H). Old-build tabs are
// the same in both modes. Every 200 burst response's `x-snapshot-verify`
// header is counted per burst (none / satisfied / fresh / memo / deferred
// / missing — "missing" also takes a malformed value, which the R2 client
// treats exactly like an absent header: inconclusive). In `r2`, a hint-
// carrying response that is inconclusive (memo / deferred / missing) AND
// still below H (`body.rev < minRev`) fires ONE recheck, 1,000 ms (the
// server's 1 s revision-memo window) + U(0, 500 ms) later, with the same
// minRev and no `hint` — the client's quiet recheck. A recheck that is
// inconclusive again is "hint exhausted" (the real client then leaves it
// to the periodic poll). Rechecks are viewer snapshot requests like any
// other (whole-run gates, error bodies, the burst abort's error rate)
// but stay out of the burst latency trend, so the per-burst p95 keeps
// meaning "the notification wave" across runs.
//
// One provenance check rides along in both modes: the burst fires after
// the save RETURNED, i.e. after its commit, so a `fresh=<dbRev>` with
// dbRev below the saved revision — a fresh read "disproving" a revision
// that was already committed when the request began — is a server bug.
// Counted as `verify_fresh_violation`, must be 0.
//
// Requests send `Accept-Encoding: gzip, deflate, br` (ACCEPT_ENCODING)
// like a browser; k6 decodes the body. Without it each snapshot is
// ~47 KB on the wire and a 600-request burst is ~28 MB into one laptop.
//
// Run (see tests/load/README.md for the side-car + full command):
//   EXPECTED_ROWS=23 ROW_SLACK=2 tests/load/run.sh viewers.js
//
// Safety: the admin VU only appends rows after the last position and
// insert-afters its own rows, soft-deletes everything it created, and
// on any failed/never-visible write — or a burst over ABORT_ERR_RATE
// errors / ABORT_P95_MS p95 — cleans up first, then aborts the run. No
// threshold has abortOnFail: a threshold abort would kill the admin VU
// mid-cycle and leave rows behind. Reactions use anonIds prefixed
// `n14run2-`; `node tests/load/viewers-check.mjs` lists (and with
// `--delete` removes) any that a failed DELETE left behind.

import http from "k6/http";
import { check } from "k6";
import { Trend, Rate, Counter } from "k6/metrics";
import exec from "k6/execution";
import { setTimeout } from "k6/timers";
import {
  BASE_URL,
  EVENT_ID,
  EXPECTED_ROWS,
  ROW_SLACK,
  BODY_SAMPLE_RATE,
  baseHeaders,
  pickLocale,
  snapshotUrl,
  validateSnapshotBody,
  snapshotErrors,
  snapshotBadBody,
  snapshotRequests,
  getEventPage,
  requireEnv,
  ssrErrors,
  GATES,
} from "./lib/config.js";
import { resultsDir, stamp } from "./lib/report.js";
import { NOTE, ANON_PREFIX, ADMIN_COOKIE_NAME as COOKIE_NAME, REACTION_TYPES } from "./lib/constants.js";
import {
  adminSaveReload,
  adminWriteLatency,
  adminVisibleFirst,
  adminLostEdit,
  adminWrites,
} from "./admin-writes.js";
import { parseShapeMix, pickShape, parseSaves, arrivalOffsetMs, notificationParams, headCheck, exposure, SHAPES } from "./lib/admission.mjs";

// Admission mode (n14 step 5, run A1) — see the "admission mode" block
// further down. Decided first: it changes which env vars are required
// (no ADMIN_PASSWORD: the probe already logged in) and some defaults.
const ADMISSION = (__ENV.ADMISSION || "0") === "1";

requireEnv("EVENT_ID");
requireEnv("EVENT_SLUG");
if (!ADMISSION) requireEnv("ADMIN_PASSWORD");

// ── knobs ─────────────────────────────────────────────────────────
const num = (name, def) => (__ENV[name] != null && __ENV[name] !== "" ? parseFloat(__ENV[name]) : def);

// Admission mode only changes DEFAULTS here (an explicit env var still
// wins): SSR at the admission rate, a shorter hold, no admin cycles, no
// reactions, no cold start — the admission wave must be the first
// traffic after t=0.
const POLL_RPS = num("POLL_RPS", 25);
const SSR_RPS = num("SSR_RPS", ADMISSION ? 10 : POLL_RPS * 0.1);
const STEADY_START = num("STEADY_START", 15);
const STEADY_SECONDS = num("STEADY_SECONDS", ADMISSION ? 60 : 600);
const ADMIN_CYCLES = num("ADMIN_CYCLES", ADMISSION ? 0 : 6);
const QUIET_CYCLES = num("QUIET_CYCLES", ADMISSION ? 0 : 2);
const ADMIN_FIRST = num("ADMIN_FIRST", 40);
const ADMIN_SPACING = num("ADMIN_SPACING", 70);
const SAVE_GAP = num("SAVE_GAP", 4);
const BURST_SIZE = num("BURST_SIZE", 500);
const JITTER_MS = num("JITTER_MS", 500);
const OLD_SHARE = num("OLD_SHARE", 0.2);
const OLD_REPEATS = num("OLD_REPEATS", 1);
const OLD_REPEAT_MS = num("OLD_REPEAT_MS", 1000);
const COLD_START = (__ENV.COLD_START || (ADMISSION ? "0" : "1")) !== "0";
const REACTIONS = num("REACTIONS", ADMISSION ? 0 : 500);
const REACTION_SECONDS = num("REACTION_SECONDS", 10);
const REACTION_AT = num("REACTION_AT", 440);
const ABORT_ERR_RATE = num("ABORT_ERR_RATE", GATES.abortErrorRate);
const ABORT_P95_MS = num("ABORT_P95_MS", GATES.abortP95);
const ACCEPT_ENCODING = __ENV.ACCEPT_ENCODING ?? "gzip, deflate, br";
const BURST_GATE_P95 = num("BURST_GATE_P95", 3000);
// Unset = fixed ADMIN_SPACING slots; set = this many seconds between the
// end of one cycle and the start of the next (see the header).
const BURST_GAP_S = __ENV.BURST_GAP_S != null && __ENV.BURST_GAP_S !== "" ? parseFloat(__ENV.BURST_GAP_S) : null;
const DRAIN_S = num("DRAIN_S", 90);
// Pinned, deliberately not a knob: see the header (old-build tabs).
const OLD_JITTER_MS = 500;
const ERROR_BODIES_PER_BURST = 5;
const ERROR_BODY_CHARS = 80;
const ERR_CHECK_PREFIX = "burst-error ";
const POOLER_GATE = num("POOLER_GATE", 140);
// See the header ("Notification model"). The value doubles as the k6
// `client` tag of the new-build tabs' burst requests (r1 | r2).
const HINT_MODE = (__ENV.HINT_MODE || "r1").toLowerCase();
if (HINT_MODE !== "r1" && HINT_MODE !== "r2") throw new Error(`HINT_MODE must be r1 or r2, got ${__ENV.HINT_MODE}`);
const NEW_CLIENT = HINT_MODE;
// The R2 client's recheck delay: max(1 s memo window, 1 s cooldown) +
// U(0, jitter). Pinned to the contract, not knobs.
const RECHECK_BASE_MS = 1000;
const RECHECK_SPREAD_MS = 500;
const VERIFY_KINDS = ["none", "satisfied", "fresh", "memo", "deferred", "missing"];
const INCONCLUSIVE = new Set(["memo", "deferred", "missing"]);

// Each admin cycle briefly adds two rows (cold start: one), and the
// admin VU runs them strictly one after another, so a correct snapshot
// has between EXPECTED_ROWS and EXPECTED_ROWS + 2 rows. ROW_SLACK below
// 2 would count our own rows as bad bodies. (Admission mode adds no row
// — its saves edit the probe's anchor — so ROW_SLACK=0 is right there.)
if (!ADMISSION && EXPECTED_ROWS != null && ROW_SLACK < 2) {
  throw new Error("viewers.js adds up to 2 rows at a time: set ROW_SLACK=2 (or more) with EXPECTED_ROWS");
}

const OPS = ["create", "update", "insert_after", "swap", "delete", "delete"];

// ── plan: cycles, bursts, timeline ───────────────────────────────
// Quiet cycles are spread evenly among the burst cycles so the steady-
// window admin numbers aren't all taken at the start or end of the run.
const TOTAL_CYCLES = ADMIN_CYCLES + QUIET_CYCLES;
const quietIdx = new Set();
for (let k = 0; k < QUIET_CYCLES; k++) quietIdx.add(Math.floor(((k + 0.5) * TOTAL_CYCLES) / QUIET_CYCLES));
export const PLAN = { cycles: [], bursts: [] };
if (COLD_START) PLAN.bursts.push({ id: "b00", label: "cold start · create" });
for (let i = 0; i < TOTAL_CYCLES; i++) {
  const kind = quietIdx.has(i) ? "quiet" : "burst";
  // `at` = null: starts BURST_GAP_S after the previous cycle ended.
  const at = BURST_GAP_S == null ? ADMIN_FIRST + i * ADMIN_SPACING : i === 0 ? ADMIN_FIRST : null;
  const c = { n: i + 1, kind, at, bursts: [] };
  if (kind === "burst") {
    for (const op of OPS) {
      const id = `b${String(PLAN.bursts.length + (COLD_START ? 0 : 1)).padStart(2, "0")}`;
      PLAN.bursts.push({ id, label: `c${c.n} · ${op}` });
      c.bursts.push(id);
    }
  }
  PLAN.cycles.push(c);
}
const PLANNED_SAVES = (COLD_START ? 1 : 0) + TOTAL_CYCLES * OPS.length;

// ── metrics ──────────────────────────────────────────────────────
const burstLatency = new Trend("burst_latency", true);
const burstErrors = new Rate("burst_errors");
// R1 burst requests only: did the response carry rev ≥ the minRev we
// asked for? The server only guarantees that when its own DB read sees
// the new revision (the 1 s per-instance revision memo can serve an
// older one), so < 100 % is a finding to read, not automatically a bug.
const burstRevOk = new Rate("burst_rev_ok");
// Every burst request: did it get the post-save revision? By client
// (r1 / old) and wave (old tabs' 1st vs repeat request).
const burstFresh = new Rate("burst_fresh");
const burstsFired = new Counter("bursts_fired");
const SRC = {
  build: new Counter("snap_src_build"),
  cache: new Counter("snap_src_cache"),
  repair: new Counter("snap_src_repair"),
  warm: new Counter("snap_src_warm"),
  other: new Counter("snap_src_other"),
};
// r2 hinted notification fetches (tag burst), and those answered with
// `x-snapshot-source: warm` — the warm hit rate's two halves.
const hintFetches = new Counter("hint_fetches");
const hintWarm = new Counter("hint_warm");
// `x-snapshot-verify` per 200 burst response: tags kind (VERIFY_KINDS),
// burst, client (r1 | r2 | old) and req (first = the notification wave
// incl. old tabs' repeats, recheck = the r2 recheck).
const verifyOutcome = new Counter("verify_outcome");
// A header value that is neither absent nor one of the five shapes
// (also counted as kind=missing above): a server bug worth seeing.
const verifyMalformed = new Counter("verify_malformed");
const verifyFreshViolation = new Counter("verify_fresh_violation");
// r2 only: rechecks fired (tag burst), and rechecks that were still
// inconclusive below H (the client drops the hint: "hint exhausted").
const hintRechecks = new Counter("hint_rechecks");
const hintExhausted = new Counter("hint_exhausted");
const recheckLatency = new Trend("recheck_latency", true);
const reactionLatency = new Trend("reaction_latency", true);
const reactionErrors = new Rate("reaction_errors");
const reactionAckOk = new Rate("reaction_ack_ok");
// ackAt − (request start on the server clock). Positive = ackAt after
// the tap was sent, as it must be. Clock offset estimated in setup().
const reactionAckLead = new Trend("reaction_ack_lead", true);
const reactionLeftover = new Counter("reaction_leftover");
// A Trend, not a Gauge: an empty Gauge reports 0, which would read as
// "0 rows" after an abort instead of "not measured".
const finalRows = new Trend("final_row_count");
// Timeline markers (seconds since the test start), one sample each, so
// the report can say when cycles ran and when the quiet drain began.
const cycleStartS = new Trend("admin_cycle_start_s");
const lastCycleEndS = new Trend("admin_last_cycle_end_s");
const drainStartS = new Trend("drain_start_s");

// ── options ─────────────────────────────────────────────────────
const perMinute = (rps) => Math.max(1, Math.round(rps * 60));
const scenarios = {
  admin: {
    executor: "per-vu-iterations",
    vus: 1,
    iterations: 1,
    startTime: "0s",
    // The admin VU paces itself to the plan; a slow server must be
    // measured, not cut off mid-cycle (that would leave rows behind).
    maxDuration: "90m",
    gracefulStop: "5m",
    exec: "adminMain",
  },
  poll: {
    executor: "constant-arrival-rate",
    rate: perMinute(POLL_RPS),
    timeUnit: "1m",
    duration: `${STEADY_SECONDS}s`,
    startTime: `${STEADY_START}s`,
    preAllocatedVUs: Math.max(5, Math.ceil(POLL_RPS * 2)),
    maxVUs: Math.max(20, Math.ceil(POLL_RPS * 20)),
    exec: "poll",
  },
};
if (SSR_RPS > 0) {
  scenarios.ssr = {
    executor: "constant-arrival-rate",
    rate: perMinute(SSR_RPS),
    timeUnit: "1m",
    duration: `${STEADY_SECONDS}s`,
    startTime: `${STEADY_START}s`,
    preAllocatedVUs: Math.max(3, Math.ceil(SSR_RPS * 4)),
    maxVUs: Math.max(10, Math.ceil(SSR_RPS * 20)),
    exec: "ssr",
  };
}
if (REACTIONS > 0) {
  scenarios.reactions = {
    executor: "constant-arrival-rate",
    rate: REACTIONS,
    timeUnit: `${REACTION_SECONDS}s`,
    duration: `${REACTION_SECONDS}s`,
    startTime: `${REACTION_AT}s`,
    preAllocatedVUs: Math.min(REACTIONS, Math.max(5, Math.ceil((REACTIONS / REACTION_SECONDS) * 2))),
    maxVUs: REACTIONS,
    exec: "reaction",
    gracefulStop: "60s",
  };
}

// Gates are thresholds too (k6 exits 99 when one fails), none aborts.
// The rest are "count>=0"/"max>=0" placeholders whose only job is to
// make the tagged submetric exist in handleSummary (see lib/report.js).
const thresholds = {
  [`http_req_duration{name:snapshot}`]: [`p(95)<=${GATES.passP95}`],
  snapshot_errors: [`rate<=${GATES.passErrorRate}`],
  snapshot_bad_body: [`rate<=${GATES.passBadBodyRate}`],
  burst_latency: [`p(95)<=${BURST_GATE_P95}`],
  [`admin_save_reload{window:steady}`]: [`p(95)<=${GATES.adminP95}`],
  [`admin_save_reload{window:burst}`]: [`p(95)<=${GATES.adminP95}`],
  admin_lost_edit: ["rate==0"],
  reaction_errors: [`rate<=${GATES.passErrorRate}`],
  reaction_ack_ok: ["rate==1"],
  "http_req_duration{scenario:poll}": ["max>=0"],
  "http_reqs{scenario:poll}": ["count>=0"],
  "dropped_iterations{scenario:poll}": ["count>=0"],
  "snapshot_errors{scenario:poll}": ["rate>=0"],
  "http_req_duration{scenario:ssr}": ["max>=0"],
  "http_reqs{scenario:ssr}": ["count>=0"],
  "dropped_iterations{scenario:ssr}": ["count>=0"],
  ssr_errors: ["rate>=0"],
  "dropped_iterations{scenario:reactions}": ["count>=0"],
  "reaction_latency{op:post}": ["max>=0"],
  "reaction_latency{op:delete}": ["max>=0"],
  "reaction_errors{op:post}": ["rate>=0"],
  "reaction_errors{op:delete}": ["rate>=0"],
  reaction_ack_lead: ["max>=-1e12"],
  reaction_leftover: ["count>=0"],
  "admin_visible_first{window:steady}": ["rate>=0"],
  "admin_visible_first{window:burst}": ["rate>=0"],
  "admin_writes{window:steady}": ["count>=0"],
  "admin_writes{window:burst}": ["count>=0"],
  "admin_lost_edit{window:steady}": ["rate>=0"],
  "admin_lost_edit{window:burst}": ["rate>=0"],
  admin_writes: ["count>=0"],
  admin_visible_first: ["rate>=0"],
  bursts_fired: ["count>=0"],
  final_row_count: ["max>=0"],
  snapshot_rows: ["max>=0"],
  [`burst_latency{client:${NEW_CLIENT}}`]: ["max>=0"],
  "burst_latency{client:old}": ["max>=0"],
  [`burst_errors{client:${NEW_CLIENT}}`]: ["rate>=0"],
  "burst_errors{client:old}": ["rate>=0"],
  verify_malformed: ["count>=0"],
  verify_fresh_violation: ["count>=0"],
  hint_rechecks: ["count>=0"],
  hint_exhausted: ["count>=0"],
  hint_fetches: ["count>=0"],
  hint_warm: ["count>=0"],
  recheck_latency: ["max>=0"],
  "snapshot_errors{phase:recheck}": ["rate>=0"],
  "burst_fresh{client:old,wave:1}": ["rate>=0"],
  "burst_fresh{client:old,wave:2}": ["rate>=0"],
  burst_rev_ok: ["rate>=0"],
  admin_last_cycle_end_s: ["max>=0"],
  drain_start_s: ["max>=0"],
};
for (const phase of ["poll", "burst"]) {
  for (const s of Object.keys(SRC)) thresholds[`snap_src_${s}{phase:${phase}}`] = ["count>=0"];
}
for (const c of PLAN.cycles) thresholds[`admin_cycle_start_s{cycle:c${c.n}}`] = ["max>=0"];
for (const k of VERIFY_KINDS) {
  thresholds[`verify_outcome{client:${NEW_CLIENT},kind:${k},req:first}`] = ["count>=0"];
  thresholds[`verify_outcome{kind:${k},req:recheck}`] = ["count>=0"];
}
for (const b of PLAN.bursts) {
  thresholds[`burst_latency{burst:${b.id}}`] = ["max>=0"];
  thresholds[`burst_errors{burst:${b.id}}`] = ["rate>=0"];
  thresholds[`burst_rev_ok{burst:${b.id}}`] = ["rate>=0"];
  for (const s of Object.keys(SRC)) thresholds[`snap_src_${s}{burst:${b.id}}`] = ["count>=0"];
  for (const k of VERIFY_KINDS) thresholds[`verify_outcome{burst:${b.id},kind:${k},req:first}`] = ["count>=0"];
  if (HINT_MODE === "r2") {
    thresholds[`hint_rechecks{burst:${b.id}}`] = ["count>=0"];
    thresholds[`hint_fetches{burst:${b.id}}`] = ["count>=0"];
    thresholds[`hint_warm{burst:${b.id}}`] = ["count>=0"];
  }
}

// ── admission mode (ADMISSION=1, n14 step 5 run A1) ──────────────
// The cold-admission model: a fresh deployment (new BUILD_KEY ⇒ empty
// snapshot + warm namespaces) whose FIRST traffic is the admission wave.
// Everything the normal start-up does before t=0 is bypassed, because on
// a fresh deployment it would be the traffic that warms it:
//   * setup() makes NO request — the clock offset, event sanity, the
//     admin session cookie, the anchor row and the marker songs come
//     from PROBE_FILE, written by tests/load/admission-probe.mjs BEFORE
//     the boundary against the PRECURSOR deployment;
//   * no admin login, no cold-start save + b00, no admin cycles, no
//     reactions.
// Timeline from t=0 (the test start):
//   0 → ARRIVAL_SECONDS   ARRIVALS generic initial reads (no `hint`, no
//                         `minRev` — what a page's first fetch sends;
//                         giving arrivals `hint=1` would hand them the
//                         notification warming they don't get in
//                         reality), 70/20/10 ja/ko/en, evenly spread,
//                         open-loop; each arrival is one viewer whose
//                         client build (R2 / R1 / pre-R1) is drawn once
//                         from SHAPE_MIX;
//   0 → SSR_SECONDS       event-page SSR loads at SSR_RPS (independent
//                         scenario, 70/20/10 locales);
//   ADMISSION_SAVES       admin PUTs on the probe's anchor (each a new
//                         marker song), on their own timer from t=0 —
//                         concurrent with the wave, not after it. On each
//                         save, ONLY viewers already admitted at the PUT
//                         response fetch, by their build:
//                           R2  minRev=savedRev&hint=1 (one quiet recheck
//                               when inconclusive and below, like the
//                               burst model's r2),
//                           R1  minRev=appliedRev+1,
//                           pre no minRev, one repeat OLD_REPEAT_MS later
//                               on the SAME locale (repeats counted apart);
//                         jitter U(0, JITTER_MS) (pre: U(0, 500 ms));
//   STEADY_START → +STEADY_SECONDS   the periodic poll (the hold), as today.
// Exposure evidence per save (k6 cannot see SUBSCRIBED or the DOM): at
// PUT start and at PUT response, admitted viewers, outstanding arrivals
// and this VU's in-flight HTTP requests; SSR runs through the saves by
// construction (0 → 60 s).
// The whole admission model runs on ONE VU with async requests, for the
// same reason as the burst model: only the VU that made the save knows
// when it returned and which viewers were admitted by then.
const ARRIVALS = num("ARRIVALS", 500);
const ARRIVAL_SECONDS = num("ARRIVAL_SECONDS", 10);
const SSR_SECONDS = num("SSR_SECONDS", 60);
const SHAPE_MIX_RAW = __ENV.SHAPE_MIX || "60/25/15";
const ADMISSION_SAVES_RAW = __ENV.ADMISSION_SAVES ?? "5,20";
const WAVE_GATE_P95 = num("WAVE_GATE_P95", 1000);
const SSR_GATE_P95 = num("SSR_GATE_P95", 3000);
const ADM_KINDS = ["arrival", "shape", "recheck", "put", "ssr", "poll"];
const ADM_LOCALES = ["ja", "ko", "en"];
const ADM_WAVES = ["1", "2", "recheck"];
const MIX = ADMISSION ? parseShapeMix(SHAPE_MIX_RAW) : null;
const SAVE_OFFSETS = ADMISSION ? parseSaves(ADMISSION_SAVES_RAW) : [];
const saveId = (i) => `s${i + 1}`;
// Submetric name with a FIXED tag order: thresholds and handleSummary
// must spell the same string.
const sub = (metric, tags) => `${metric}{${Object.entries(tags).map(([k, v]) => `${k}:${v}`).join(",")}}`;

// The probe file (init context: k6 only allows open() here). k6 resolves
// a relative open() path against the SCRIPT's directory (tests/load/),
// not the shell's — so the path is tried as given, then repo-root
// relative. The file holds the admin cookie; nothing below prints it.
function loadProbe() {
  const pf = __ENV.PROBE_FILE;
  if (!pf) throw new Error("ADMISSION=1 needs PROBE_FILE=<…/admission-probe-<label>.json> (node tests/load/admission-probe.mjs, before the boundary)");
  let raw = null;
  for (const p of [pf, `../../${pf}`]) {
    try {
      raw = open(p);
      break;
    } catch (_) {
      /* next candidate */
    }
  }
  if (raw == null) throw new Error(`PROBE_FILE not readable: ${pf}`);
  const p = JSON.parse(raw);
  if (p.kind !== "admission-probe") throw new Error(`${pf} is not an admission probe file`);
  if (String(p.eventId) !== String(EVENT_ID)) throw new Error(`probe is for event ${p.eventId}, EVENT_ID=${EVENT_ID}`);
  if (!p.cookie) throw new Error("probe file has no admin cookie");
  const anchorId = __ENV.ANCHOR_ID || (p.anchor && p.anchor.id);
  const anchorPos = __ENV.ANCHOR_ID ? parseInt(__ENV.ANCHOR_POSITION || "", 10) : p.anchor && p.anchor.position;
  if (SAVE_OFFSETS.length && (!anchorId || !Number.isInteger(anchorPos))) {
    throw new Error("admission saves need an anchor: the probe's (--anchor=create) or ANCHOR_ID + ANCHOR_POSITION");
  }
  if (SAVE_OFFSETS.length && !(Array.isArray(p.markers) && p.markers.length)) throw new Error("probe file has no marker songs");
  if (EXPECTED_ROWS != null && EXPECTED_ROWS !== p.rows) console.warn(`EXPECTED_ROWS=${EXPECTED_ROWS} but the probe saw ${p.rows} active rows — bodies will be judged against EXPECTED_ROWS`);
  return { ...p, anchorId: anchorId ? String(anchorId) : null, anchorPos, file: pf };
}
const PROBE = ADMISSION ? loadProbe() : null;

const admT0 = new Trend("adm_t0_ms");
const admArrivalLatency = new Trend("adm_arrival_latency", true);
const admArrivalLag = new Trend("adm_arrival_start_lag", true);
const admArrivalErr = new Rate("adm_arrival_errors");
const admViewers = new Counter("adm_viewers");
const admPutStart = new Trend("adm_put_start_ms");
const admPutEnd = new Trend("adm_put_end_ms");
const admPutMs = new Trend("adm_put_ms", true);
const admPutLag = new Trend("adm_put_start_lag", true);
const admSaveRev = new Trend("adm_save_rev");
const admSaveStatus = new Trend("adm_save_status");
const admExposure = new Trend("adm_exposure");
const admShapeViewers = new Counter("adm_shape_viewers");
const admShapeReqs = new Counter("adm_shape_reqs");
const admShapeLatency = new Trend("adm_shape_latency", true);
const admShapeLag = new Trend("adm_shape_start_lag", true);
const admHeadEq = new Rate("adm_head_eq");
const admHeadGe = new Rate("adm_head_ge");
const admHeadFinal = new Rate("adm_head_final");
const admMarkerOk = new Rate("adm_marker_ok");
const adm5xx = new Counter("adm_http_5xx");
const adm503 = new Counter("adm_http_503");
const adm4xx = new Counter("adm_http_4xx");
const admTransport = new Counter("adm_transport_errors");

const ADM_SCENARIOS = {
  admission: {
    executor: "per-vu-iterations",
    vus: 1,
    iterations: 1,
    startTime: "0s",
    maxDuration: `${Math.ceil(Math.max(SSR_SECONDS, STEADY_START + STEADY_SECONDS, (SAVE_OFFSETS[SAVE_OFFSETS.length - 1] || 0) + 60, ARRIVAL_SECONDS + 60) + DRAIN_S + 300)}s`,
    gracefulStop: "2m",
    exec: "admissionMain",
  },
};
if (SSR_RPS > 0 && SSR_SECONDS > 0) {
  ADM_SCENARIOS.ssr = {
    executor: "constant-arrival-rate",
    rate: perMinute(SSR_RPS),
    timeUnit: "1m",
    duration: `${SSR_SECONDS}s`,
    startTime: "0s",
    preAllocatedVUs: Math.max(3, Math.ceil(SSR_RPS * 4)),
    maxVUs: Math.max(10, Math.ceil(SSR_RPS * 20)),
    exec: "ssrAdmission",
  };
}
if (POLL_RPS > 0 && STEADY_SECONDS > 0) ADM_SCENARIOS.poll = { ...scenarios.poll };

// Gates are judged in handleSummary (several have no samples in a small
// smoke, which a k6 threshold would misread); the two hard zero-count
// gates are also thresholds, so k6 exits 99 on them. The rest are
// placeholders that make the tagged submetrics exist (lib/report.js).
const ADM_THRESHOLDS = {
  adm_http_5xx: ["count==0"],
  adm_transport_errors: ["count==0"],
  adm_http_503: ["count>=0"],
  adm_http_4xx: ["count>=0"],
  adm_t0_ms: ["max>=0"],
  adm_arrival_latency: ["max>=0"],
  adm_arrival_start_lag: ["max>=-1e12"],
  adm_arrival_errors: ["rate>=0"],
  adm_shape_start_lag: ["max>=-1e12"],
  adm_marker_ok: ["rate>=0"],
  drain_start_s: ["max>=0"],
  snapshot_bad_body: ["rate>=0"],
  snapshot_rows: ["max>=0"],
  ssr_errors: ["rate>=0"],
  "http_req_duration{scenario:ssr}": ["max>=0"],
  "http_reqs{scenario:ssr}": ["count>=0"],
  "dropped_iterations{scenario:ssr}": ["count>=0"],
  "http_req_duration{scenario:poll}": ["max>=0"],
  "http_reqs{scenario:poll}": ["count>=0"],
  "dropped_iterations{scenario:poll}": ["count>=0"],
  "snapshot_errors{scenario:poll}": ["rate>=0"],
};
for (const k of ADM_KINDS) {
  ADM_THRESHOLDS[sub("adm_http_5xx", { kind: k })] = ["count>=0"];
  ADM_THRESHOLDS[sub("adm_http_503", { kind: k })] = ["count>=0"];
  ADM_THRESHOLDS[sub("adm_http_4xx", { kind: k })] = ["count>=0"];
  ADM_THRESHOLDS[sub("adm_transport_errors", { kind: k })] = ["count>=0"];
}
for (const l of ADM_LOCALES) ADM_THRESHOLDS[sub("adm_arrival_latency", { locale: l })] = ["max>=0"];
for (const s of SHAPES) {
  ADM_THRESHOLDS[sub("adm_viewers", { shape: s })] = ["count>=0"];
  ADM_THRESHOLDS[sub("adm_shape_start_lag", { shape: s })] = ["max>=-1e12"];
  ADM_THRESHOLDS[sub("adm_head_final", { shape: s })] = ["rate>=0"];
}
for (const ph of ["arrival", "shape", "poll"]) for (const s of Object.keys(SRC)) ADM_THRESHOLDS[sub(`snap_src_${s}`, { phase: ph })] = ["count>=0"];
SAVE_OFFSETS.forEach((_, i) => {
  const save = saveId(i);
  for (const m of ["adm_put_start_ms", "adm_put_end_ms", "adm_put_ms", "adm_put_start_lag", "adm_save_rev", "adm_save_status"]) {
    ADM_THRESHOLDS[sub(m, { save })] = ["max>=-1e12"];
  }
  for (const at of ["start", "end"]) for (const what of ["admitted", "outstanding", "inflight"]) ADM_THRESHOLDS[sub("adm_exposure", { save, at, what })] = ["max>=0"];
  ADM_THRESHOLDS[sub("adm_marker_ok", { save })] = ["rate>=0"];
  for (const s of SHAPES) {
    ADM_THRESHOLDS[sub("adm_shape_viewers", { save, shape: s })] = ["count>=0"];
    ADM_THRESHOLDS[sub("adm_shape_latency", { save, shape: s })] = ["max>=0"];
    ADM_THRESHOLDS[sub("adm_head_final", { save, shape: s })] = ["rate>=0"];
    for (const wave of ADM_WAVES) {
      ADM_THRESHOLDS[sub("adm_shape_reqs", { save, shape: s, wave })] = ["count>=0"];
      ADM_THRESHOLDS[sub("adm_head_eq", { save, shape: s, wave })] = ["rate>=0"];
      ADM_THRESHOLDS[sub("adm_head_ge", { save, shape: s, wave })] = ["rate>=0"];
    }
  }
});

export const options = {
  scenarios: ADMISSION ? ADM_SCENARIOS : scenarios,
  thresholds: ADMISSION ? ADM_THRESHOLDS : thresholds,
  summaryTrendStats: ["count", "avg", "min", "med", "p(90)", "p(95)", "p(99)", "max"],
  // Setup does a handful of requests; the default 60 s is plenty, but a
  // cold preview can take a while to answer the first one.
  setupTimeout: "120s",
};

// ── shared helpers ───────────────────────────────────────────────
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function viewerHeaders() {
  const h = baseHeaders();
  if (ACCEPT_ENCODING) h["Accept-Encoding"] = ACCEPT_ENCODING;
  return h;
}

function withMinRev(url, minRev, hint = false) {
  if (minRev == null) return url;
  return `${url}&minRev=${minRev}${hint ? "&hint=1" : ""}`;
}

// `x-snapshot-verify` → { kind, rev, malformed }. The five shapes of the
// R2 contract; anything else — absent (an R1 server) or unparseable — is
// "missing", which the R2 client treats as inconclusive. `rev` is the
// dbRev of `fresh=` / the remembered rev of `memo=`.
function verifyOf(res) {
  const h = res.headers || {};
  const raw = h["X-Snapshot-Verify"] ?? h["x-snapshot-verify"];
  if (raw == null || raw === "") return { kind: "missing", rev: null, malformed: false };
  const v = String(raw).trim();
  if (v === "none" || v === "satisfied" || v === "deferred") return { kind: v, rev: null, malformed: false };
  let m = /^fresh=(\d+)$/.exec(v);
  if (m) return { kind: "fresh", rev: Number(m[1]), malformed: false };
  m = /^memo=(\d+);age=\d+$/.exec(v);
  if (m) return { kind: "memo", rev: Number(m[1]), malformed: false };
  return { kind: "missing", rev: null, malformed: true };
}

// `rev` without parsing the whole ~47 KB body: it is a top-level key
// written after `items`, so the last `"rev":` in the text is the one.
function revOf(text) {
  if (typeof text !== "string") return null;
  const i = text.lastIndexOf('"rev":');
  if (i < 0) return null;
  const m = /^"rev":(\d+)/.exec(text.slice(i, i + 32));
  return m ? Number(m[1]) : null;
}

function sourceOf(res) {
  const h = res.headers || {};
  const v = (h["X-Snapshot-Source"] || h["x-snapshot-source"] || "").toLowerCase();
  return v === "build" || v === "cache" || v === "repair" || v === "warm" ? v : "other";
}

let badLogged = 0;
let errLogged = 0;

// Status + sampled body validation for every viewer snapshot (poll or
// burst), shared so both feed the same whole-run gates.
function recordViewerSnapshot(res, tags) {
  const ok = res.status === 200;
  snapshotRequests.add(1, tags);
  snapshotErrors.add(!ok, tags);
  if (ok && Math.random() < BODY_SAMPLE_RATE) {
    let good;
    let rows = null;
    try {
      const body = JSON.parse(res.body);
      rows = Array.isArray(body.items) ? body.items.length : null;
      good = validateSnapshotBody(body);
    } catch {
      good = false;
    }
    snapshotBadBody.add(!good, tags);
    // A few lines per VU say WHY a body was bad. The usual cause on a
    // shared dev event is someone else adding rows during the run (the
    // row count leaves [EXPECTED_ROWS, +ROW_SLACK]); `snapshot_rows`
    // min/max in the report shows the same thing in aggregate.
    if (!good && badLogged < 3) {
      badLogged++;
      console.warn(`[bad body] ${tags.phase}${tags.burst ? ` ${tags.burst}` : ""}: rows=${rows} (expected ${EXPECTED_ROWS}..${EXPECTED_ROWS + ROW_SLACK})`);
    }
  }
  if (!ok && errLogged < 3) {
    errLogged++;
    console.warn(
      `[error] ${tags.phase}${tags.burst ? ` ${tags.burst}` : ""}: HTTP ${res.status} ${res.error || ""} ` +
        `${typeof res.body === "string" ? res.body.slice(0, 160) : ""}`,
    );
  }
  const src = ok ? sourceOf(res) : "other";
  SRC[src].add(1, tags);
  return { ok, rev: ok ? revOf(res.body) : null, src };
}

// ── setup: event sanity + clock offset for the ackAt check ───────
export function setup() {
  // Admission mode: NO request before t=0 — everything comes from the
  // probe file (see the admission block above).
  if (ADMISSION) {
    return {
      items: [],
      startRev: PROBE.rev,
      clockOffsetMs: PROBE.clock ? PROBE.clock.offsetMs : null,
      clockErrMs: PROBE.clock ? PROBE.clock.errMs : null,
      startedAt: new Date().toISOString(),
      admission: true,
    };
  }
  const items = [];
  let rev = null;
  // Offset = server clock − local clock, from the response's `servedAt`
  // (set at response time on the Vercel function; Vercel and Supabase
  // clocks are NTP-synced) against the local send/receive midpoint. The
  // sample with the smallest round trip bounds the error at ±RTT/2.
  let best = null;
  for (let i = 0; i < 5; i++) {
    const t0 = Date.now();
    const res = http.get(snapshotUrl("ja"), { headers: viewerHeaders(), tags: { name: "setup" }, timeout: "60s" });
    const t1 = Date.now();
    if (res.status !== 200) throw new Error(`setup: /api/setlist HTTP ${res.status}`);
    const body = JSON.parse(res.body);
    if (i === 0) {
      if (body.status !== "ongoing") throw new Error(`setup: event ${EVENT_ID} status is ${body.status}, expected ongoing`);
      if (EXPECTED_ROWS != null && body.items.length !== EXPECTED_ROWS) {
        throw new Error(`setup: event has ${body.items.length} rows, EXPECTED_ROWS=${EXPECTED_ROWS} — reconcile first`);
      }
      for (const it of body.items) items.push(String(it.id));
      rev = body.rev;
    }
    const served = Date.parse(body.servedAt);
    if (Number.isFinite(served)) {
      const rtt = t1 - t0;
      if (!best || rtt < best.rtt) best = { rtt, offset: served - (t0 + t1) / 2 };
    }
  }
  if (!best) throw new Error("setup: no servedAt in the snapshot — is R1 deployed?");
  return { items, startRev: rev, clockOffsetMs: best.offset, clockErrMs: best.rtt / 2, startedAt: new Date().toISOString() };
}

// ── steady streams ───────────────────────────────────────────────
// Highest revision this VU (≈ one viewer) has been shown: the R1
// client's `minRevToSend()` on a periodic fetch.
let knownRev = null;

export function poll() {
  const locale = pickLocale();
  const tags = { name: "snapshot", phase: "poll", locale };
  const res = http.get(withMinRev(snapshotUrl(locale), knownRev), {
    headers: viewerHeaders(),
    responseType: "text",
    tags,
    timeout: "30s",
  });
  const r = recordViewerSnapshot(res, tags);
  check(res, { "poll 200": (x) => x.status === 200 });
  if (ADMISSION) tallyStatus(res, "poll");
  if (r.rev != null && (knownRev == null || r.rev > knownRev)) knownRev = r.rev;
}

export function ssr() {
  getEventPage();
}

// ── reactions ────────────────────────────────────────────────────
function jsonParse(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function checkAck(body, startLocal, data, op) {
  const ack = body && typeof body.ackAt === "string" ? Date.parse(body.ackAt) : NaN;
  if (!Number.isFinite(ack)) {
    reactionAckOk.add(false, { op });
    return;
  }
  const lead = ack - (startLocal + data.clockOffsetMs);
  reactionAckLead.add(lead, { op });
  // The offset is only known to ±RTT/2, so that much slack.
  reactionAckOk.add(lead >= -data.clockErrMs, { op });
}

export function reaction(data) {
  const itemId = data.items[Math.floor(Math.random() * data.items.length)];
  const reactionType = REACTION_TYPES[Math.floor(Math.random() * REACTION_TYPES.length)];
  const anonId = `${ANON_PREFIX}${exec.vu.idInTest}-${exec.scenario.iterationInTest}-${Math.random().toString(36).slice(2, 10)}`;
  const headers = { ...baseHeaders(), "Content-Type": "application/json" };

  let start = Date.now();
  const post = http.post(
    `${BASE_URL}/api/reactions`,
    JSON.stringify({ setlistItemId: itemId, reactionType, anonId }),
    { headers, tags: { name: "reaction_post", op: "post" }, timeout: "30s" },
  );
  reactionLatency.add(post.timings.duration, { op: "post" });
  const pb = post.status === 200 ? jsonParse(post.body) : null;
  const postOk = !!pb && typeof pb.reactionId === "string";
  reactionErrors.add(!postOk, { op: "post" });
  if (!postOk) {
    // A timed-out POST may still have committed; the anonId prefix lets
    // viewers-check.mjs find it.
    if (post.status === 0) reactionLeftover.add(1);
    return;
  }
  checkAck(pb, start, data, "post");

  start = Date.now();
  const del = http.del(`${BASE_URL}/api/reactions`, JSON.stringify({ reactionId: pb.reactionId }), {
    headers,
    tags: { name: "reaction_delete", op: "delete" },
    timeout: "30s",
  });
  reactionLatency.add(del.timings.duration, { op: "delete" });
  const db = del.status === 200 ? jsonParse(del.body) : null;
  const delOk = !!db && db.ok === true;
  reactionErrors.add(!delOk, { op: "delete" });
  if (!delOk) {
    reactionLeftover.add(1);
    return;
  }
  checkAck(db, start, data, "delete");
}

// ── admin VU: async copy of admin-writes.js + the bursts ─────────
let sessionToken = null;
let lastRev = null; // rev of the last snapshot the admin VU saw
const created = []; // ids of our rows not yet deleted

function login() {
  // Sync is fine here: nothing is scheduled on the event loop yet.
  const res = http.post(
    `${BASE_URL}/api/admin/login`,
    JSON.stringify({ password: requireEnv("ADMIN_PASSWORD") }),
    { headers: { ...baseHeaders(), "Content-Type": "application/json" }, tags: { name: "admin_login" } },
  );
  if (res.status !== 200) exec.test.abort(`admin login failed: HTTP ${res.status}`);
  const c = res.cookies[COOKIE_NAME];
  if (!c || !c.length) exec.test.abort(`admin login returned no ${COOKIE_NAME} cookie`);
  sessionToken = c[0].value;
}

function adminParams(name, extra = {}) {
  return {
    headers: { ...baseHeaders(), "Content-Type": "application/json" },
    cookies: { [COOKIE_NAME]: sessionToken },
    tags: { name, ...extra },
    timeout: "30s",
  };
}

const adminPost = (path, body, name, tags) =>
  http.asyncRequest("POST", `${BASE_URL}${path}`, JSON.stringify(body), adminParams(name, tags));
const adminPut = (path, body, name, tags) =>
  http.asyncRequest("PUT", `${BASE_URL}${path}`, JSON.stringify(body), adminParams(name, tags));
const adminDel = (path, name, tags) => http.asyncRequest("DELETE", `${BASE_URL}${path}`, null, adminParams(name, tags));

// Full-body ja snapshot, no minRev — exactly admin-writes.js's reload.
async function readSnapshot(tags = {}) {
  const res = await http.asyncRequest("GET", snapshotUrl("ja"), null, {
    headers: viewerHeaders(),
    tags: { name: "admin_reload", ...tags },
    timeout: "30s",
  });
  const body = res.status === 200 ? jsonParse(res.body) : null;
  if (body && Number.isSafeInteger(body.rev) && (lastRev == null || body.rev > lastRev)) lastRev = body.rev;
  return { res, body: body && Array.isArray(body.items) ? body : null };
}

const byId = (body, id) => body.items.find((it) => String(it.id) === String(id));
const songIdsOf = (item) => (item.songs || []).map((s) => Number(s.song.id));

// Counts one 200 response's verification outcome; returns it.
// `savedRev` = the revision the burst's save committed (null if the save
// response had none): see "provenance check" in the header.
function recordVerify(res, vtags, minRev, savedRev) {
  const v = verifyOf(res);
  verifyOutcome.add(1, { ...vtags, kind: v.kind });
  if (v.malformed) verifyMalformed.add(1, vtags);
  if (v.kind === "fresh" && minRev != null && savedRev != null && v.rev < savedRev) verifyFreshViolation.add(1, vtags);
  return v;
}

// One burst request; resolves to a LIST of results — the request, plus
// its recheck when one was due. `appliedRev` is the pre-save revision (a
// response at > appliedRev carries the save); `hint` marks an r2
// notification fetch (`&hint=1`, eligible for a recheck).
async function burstRequest(burstId, minRev, client, wave, appliedRev, savedRev, hint) {
  const locale = pickLocale();
  const tags = { name: "snapshot", phase: "burst", burst: burstId, client, wave: String(wave), locale };
  const res = await http.asyncRequest("GET", withMinRev(snapshotUrl(locale), minRev, hint), null, {
    headers: viewerHeaders(),
    responseType: "text",
    tags,
    timeout: "30s",
  });
  const r = recordViewerSnapshot(res, tags);
  burstLatency.add(res.timings.duration, tags);
  burstErrors.add(!r.ok, tags);
  if (r.ok && appliedRev != null) burstFresh.add(r.rev != null && r.rev > appliedRev, tags);
  if (r.ok && minRev != null) burstRevOk.add(r.rev != null && r.rev >= minRev, tags);
  // Warm hit rate: every hinted fetch counts in the denominator (a 503
  // too — it was eligible for the lookup and did not get a warm answer).
  if (hint) {
    hintFetches.add(1, { burst: burstId });
    if (r.ok && r.src === "warm") hintWarm.add(1, { burst: burstId });
  }
  const out =[{ ok: r.ok, ms: res.timings.duration, err: r.ok ? null : errorBody(res), recheck: false }];
  if (!r.ok) return out; // error responses carry no header (and the harness models no retry)
  const v = recordVerify(res, { burst: burstId, client, req: "first" }, minRev, savedRev);
  // Satisfied by the body whatever the header says (rev ≥ H); `fresh`
  // disproves H, `none` cannot happen with a minRev — only the
  // inconclusive kinds below H earn a recheck.
  if (hint && INCONCLUSIVE.has(v.kind) && (r.rev == null || r.rev < minRev)) {
    await delay(RECHECK_BASE_MS + Math.random() * RECHECK_SPREAD_MS);
    out.push(await recheckRequest(burstId, minRev, client, savedRev, locale));
  }
  return out;
}

// The R2 client's quiet recheck: same minRev (H), no `hint`, same locale
// (one tab). Its own HTTP failure is an ordinary failure, so it feeds the
// whole-run error gate and the burst's error count.
async function recheckRequest(burstId, minRev, client, savedRev, locale) {
  const tags = { name: "snapshot", phase: "recheck", burst: burstId, client, locale };
  hintRechecks.add(1, { burst: burstId });
  const res = await http.asyncRequest("GET", withMinRev(snapshotUrl(locale), minRev, false), null, {
    headers: viewerHeaders(),
    responseType: "text",
    tags,
    timeout: "30s",
  });
  const r = recordViewerSnapshot(res, tags);
  recheckLatency.add(res.timings.duration, tags);
  if (r.ok) {
    const v = recordVerify(res, { burst: burstId, client, req: "recheck" }, minRev, savedRev);
    if (INCONCLUSIVE.has(v.kind) && (r.rev == null || r.rev < minRev)) hintExhausted.add(1, { burst: burstId });
  }
  return { ok: r.ok, ms: res.timings.duration, err: r.ok ? null : errorBody(res), recheck: true };
}

// "HTTP 500: <first 80 chars of the body, whitespace collapsed>", or the
// transport error for status 0 — the key for counting distinct failures.
function errorBody(res) {
  const body = typeof res.body === "string" ? res.body.replace(/\s+/g, " ").trim().slice(0, ERROR_BODY_CHARS) : "";
  const what = body || (res.error ? String(res.error).slice(0, ERROR_BODY_CHARS) : "(empty body)");
  // `|` would break the markdown table the name ends up in.
  return `HTTP ${res.status}: ${what}`.replace(/\|/g, "/");
}

// One failed check per occurrence, named after the body (see header).
// Returns the distinct bodies with their counts, first ones first.
function recordErrorBodies(burstId, errs) {
  const counts = new Map();
  for (const e of errs) counts.set(e, (counts.get(e) || 0) + 1);
  let k = 0;
  for (const [body, n] of counts) {
    const name = `${ERR_CHECK_PREFIX}${burstId} | ${k < ERROR_BODIES_PER_BURST ? body : "(other bodies)"}`;
    for (let i = 0; i < n; i++) check(null, { [name]: () => false });
    k++;
  }
  return [...counts.entries()];
}

// Fires the whole burst and returns a promise of its summary. Request
// i starts at U(0, JITTER_MS) after the call — U(0, OLD_JITTER_MS) for an
// old-build tab, which then repeats. `savedRev` = the `rev` of the save
// response (what the R2 broadcast carries); r2 mode sends it as minRev.
// The summary's n / errors include r2 rechecks (the abort's error rate
// covers every request the burst caused); p95 / max are the
// notification wave's only (see the header).
function fireBurst(burstId, appliedRev, savedRev) {
  burstsFired.add(1);
  let minRev = appliedRev == null ? null : appliedRev + 1;
  const hint = HINT_MODE === "r2";
  if (hint) {
    if (savedRev != null) minRev = savedRev;
    // Every admin writer route returns `rev`; without it the exact-rev
    // model is impossible, so say so instead of silently measuring r1.
    else console.warn(`[burst ${burstId}] save response has no rev — r2 falls back to appliedRev + 1 = ${minRev}`);
  }
  const all = [];
  for (let i = 0; i < BURST_SIZE; i++) {
    const old = Math.random() < OLD_SHARE;
    const at = Math.random() * (old ? OLD_JITTER_MS : JITTER_MS);
    all.push(
      delay(at).then(() =>
        old
          ? burstRequest(burstId, null, "old", 1, appliedRev, savedRev, false)
          : burstRequest(burstId, minRev, NEW_CLIENT, 1, appliedRev, savedRev, hint && minRev != null),
      ),
    );
    if (old) {
      for (let k = 1; k <= OLD_REPEATS; k++) {
        all.push(delay(at + k * OLD_REPEAT_MS).then(() => burstRequest(burstId, null, "old", k + 1, appliedRev, savedRev, false)));
      }
    }
  }
  return Promise.all(all).then((lists) => {
    const rs = lists.flat();
    const ms = rs.filter((r) => !r.recheck).map((r) => r.ms).sort((a, b) => a - b);
    const errs = rs.filter((r) => !r.ok).map((r) => r.err);
    const p95 = ms.length ? ms[Math.min(ms.length - 1, Math.ceil(0.95 * ms.length) - 1)] : 0;
    const bodies = recordErrorBodies(burstId, errs);
    return {
      n: rs.length,
      rechecks: rs.filter((r) => r.recheck).length,
      errors: errs.length,
      p95,
      max: ms.length ? ms[ms.length - 1] : 0,
      bodies,
      minRev,
    };
  });
}

// One timed save: write → (burst) → reload until visible. Throws on a
// failed or never-visible write; `onAck` runs before the visibility
// check so a created id is recorded for clean-up even if that fails.
async function timedSave(label, window, burstId, doWrite, isVisible, onAck) {
  const appliedRev = lastRev;
  let visibleBody = null;
  const wtags = { op: label, window };
  const res = await doWrite();
  // The burst starts the moment the save returned — before we even
  // look at the status, like a client reacting to the DB notification.
  // A failed save produces no notification, so no burst then.
  const okWrite = res.status >= 200 && res.status < 300;
  // The committed revision, as every admin writer route returns it — the
  // value the R2 broadcast carries to the tabs.
  const saved = okWrite ? jsonParse(res.body) : null;
  const savedRev = saved && Number.isSafeInteger(saved.rev) ? saved.rev : null;
  const burstP = okWrite && burstId ? fireBurst(burstId, appliedRev, savedRev) : null;
  adminWrites.add(1, wtags);
  adminWriteLatency.add(res.timings.duration, wtags);
  try {
    if (!okWrite) {
      adminLostEdit.add(true, wtags);
      throw new Error(`${label}: HTTP ${res.status} ${String(res.body).slice(0, 200)}`);
    }
    if (onAck) onAck(res);
    let snap = await readSnapshot({ window });
    const first = snap.body != null && isVisible(snap.body);
    adminVisibleFirst.add(first, wtags);
    adminSaveReload.add(res.timings.duration + snap.res.timings.duration, wtags);
    let visible = first;
    for (let i = 0; i < 3 && !visible; i++) {
      await delay(1000);
      snap = await readSnapshot({ window });
      visible = snap.body != null && isVisible(snap.body);
    }
    adminLostEdit.add(!visible, wtags);
    if (!visible) throw new Error(`${label}: write acknowledged but never visible`);
    visibleBody = snap.body;
  } finally {
    if (burstP) {
      const b = await burstP;
      console.log(
        `[burst ${burstId}] ${label} appliedRev=${appliedRev} savedRev=${savedRev} minRev=${b.minRev}${HINT_MODE === "r2" ? "+hint" : ""} ` +
          `n=${b.n}${b.rechecks ? ` (${b.rechecks} rechecks)` : ""} errors=${b.errors} p95=${Math.round(b.p95)}ms max=${Math.round(b.max)}ms` +
          (b.bodies.length
            ? ` bodies=${JSON.stringify(b.bodies.slice(0, ERROR_BODIES_PER_BURST).map(([body, n]) => `${n}x ${body}`))}` +
              (b.bodies.length > ERROR_BODIES_PER_BURST ? ` (+${b.bodies.length - ERROR_BODIES_PER_BURST} more distinct)` : "")
            : ""),
      );
      if (b.errors / b.n > ABORT_ERR_RATE || b.p95 > ABORT_P95_MS) {
        throw new Error(
          `burst ${burstId} over the abort gate (errors ${b.errors}/${b.n}, p95 ${Math.round(b.p95)} ms) — stopping before the pooler melts`,
        );
      }
    }
  }
  return visibleBody;
}

async function cleanupAndAbort(e) {
  const leftover = [];
  for (const id of created.slice()) {
    const r = await adminDel(`/api/admin/setlist-items/${id}`, "admin_cleanup");
    if (r.status !== 200) leftover.push(id);
  }
  // The abort ends the k6 run at once, so there is no in-run drain; the
  // side-car samplers keep recording, which is why the operator must not
  // create the STOP file before DRAIN_S has passed.
  exec.test.abort(
    `${e.message} — stop and reconcile the event` +
      (leftover.length ? ` (rows NOT cleaned up: ${leftover.join(", ")})` : "") +
      ` — wait ${DRAIN_S}s before creating the STOP file so the samplers record the drain`,
  );
}

// admin-writes.js's six saves, async. `burstIds` = one per save, or
// null for a quiet cycle.
async function cycle(window, burstIds) {
  const { body: start } = await readSnapshot({ window });
  if (!start || start.items.length === 0) throw new Error("test event has no setlist rows");
  const last = start.items[start.items.length - 1];
  const maxPos = Math.max(...start.items.map((it) => it.position));
  const songPool = [];
  for (const it of start.items) for (const id of songIdsOf(it)) if (!songPool.includes(id)) songPool.push(id);
  if (songPool.length < 2) throw new Error("test event needs at least two distinct songs");
  const [songA, songB] = songPool;
  const isEncore = !!last.isEncore;
  const bid = (i) => (burstIds ? burstIds[i] : null);
  const gap = () => delay(SAVE_GAP * 1000);

  const posA = maxPos + 1;
  let idA = null;
  let seen = await timedSave(
    "create",
    window,
    bid(0),
    () =>
      adminPost(
        "/api/admin/setlist-items",
        { eventId: EVENT_ID, position: posA, isEncore, note: NOTE, songIds: [songA] },
        "admin_create",
        { window },
      ),
    // By id (known from the ack, which runs first), not by position: a
    // concurrent insert higher up the setlist shifts every position
    // below it, and a position predicate would then call a visible
    // write lost. Same for the predicates below.
    (b) => {
      const it = byId(b, idA);
      return !!it && songIdsOf(it).includes(songA);
    },
    (r) => {
      idA = JSON.parse(r.body).id;
      created.push(idA);
    },
  );
  await gap();

  // Our row's CURRENT position, from the snapshot that showed the last
  // write: if anyone inserted above it meanwhile, posA is stale, and a
  // PUT/insert-after at a stale position would land on someone else's
  // row. (The full run has the event to itself; the smoke may not.)
  const posOfA = () => byId(seen, idA).position;
  seen = await timedSave(
    "update",
    window,
    bid(1),
    () =>
      adminPut(
        `/api/admin/setlist-items/${idA}`,
        { position: posOfA(), isEncore, note: NOTE, songIds: [songB] },
        "admin_update",
        { window },
      ),
    (b) => {
      const it = byId(b, idA);
      return !!it && songIdsOf(it).includes(songB) && !songIdsOf(it).includes(songA);
    },
  );
  await gap();

  let idB = null;
  await timedSave(
    "insert_after",
    window,
    bid(2),
    () =>
      adminPost(
        "/api/admin/setlist-items/insert-after",
        { eventId: EVENT_ID, afterPosition: posOfA() },
        "admin_insert_after",
        { window },
      ),
    (b) => {
      const a = byId(b, idA);
      const bb = byId(b, idB);
      return !!a && !!bb && bb.position > a.position;
    },
    (r) => {
      idB = JSON.parse(r.body).id;
      created.push(idB);
    },
  );
  await gap();

  await timedSave(
    "swap",
    window,
    bid(3),
    () => adminPost("/api/admin/setlist-items/swap", { itemIdA: idA, itemIdB: idB }, "admin_swap", { window }),
    (b) => {
      const a = byId(b, idA);
      const bb = byId(b, idB);
      return !!a && !!bb && a.position > bb.position;
    },
  );

  const dels = [idA, idB];
  for (let i = 0; i < dels.length; i++) {
    await gap();
    const id = dels[i];
    await timedSave(
      "delete",
      window,
      bid(4 + i),
      () => adminDel(`/api/admin/setlist-items/${id}`, "admin_delete", { window }),
      (b) => !byId(b, id),
      () => created.splice(created.indexOf(id), 1),
    );
  }
}

// Cold start: one timed save (window "burst" — its reload runs inside
// the cold burst), then an untimed, verified delete of the same row so
// the event is back to its baseline before the steady streams begin.
async function coldStart() {
  const { body: start } = await readSnapshot({ window: "burst" });
  if (!start || start.items.length === 0) throw new Error("test event has no setlist rows");
  const last = start.items[start.items.length - 1];
  const pos = Math.max(...start.items.map((it) => it.position)) + 1;
  const song = songIdsOf(start.items.find((it) => songIdsOf(it).length > 0) || last)[0];
  let id = null;
  await timedSave(
    "create",
    "burst",
    PLAN.bursts[0].id,
    () =>
      adminPost(
        "/api/admin/setlist-items",
        { eventId: EVENT_ID, position: pos, isEncore: !!last.isEncore, note: NOTE, songIds: song ? [song] : [] },
        "admin_create",
        { window: "burst" },
      ),
    (b) => !!byId(b, id),
    (r) => {
      id = JSON.parse(r.body).id;
      created.push(id);
    },
  );
  const r = await adminDel(`/api/admin/setlist-items/${id}`, "admin_cleanup");
  if (r.status !== 200) throw new Error(`cold start: delete of row ${id} failed: HTTP ${r.status}`);
  created.splice(created.indexOf(id), 1);
  for (let i = 0; i < 4; i++) {
    const { body } = await readSnapshot({ window: "cleanup" });
    if (body && !byId(body, id)) return;
    await delay(1000);
  }
  throw new Error(`cold start: deleted row ${id} still visible`);
}

const elapsedS = () => exec.instance.currentTestRunDuration / 1000;

export async function adminMain() {
  login();
  try {
    if (COLD_START) {
      await coldStart();
      console.log(`[admin] cold start done at ${elapsedS().toFixed(1)}s`);
    }
    let prevEnd = null;
    for (const c of PLAN.cycles) {
      const at = c.at != null ? c.at : prevEnd + BURST_GAP_S;
      const wait = at - elapsedS();
      if (wait > 0) await delay(wait * 1000);
      else if (c.at != null) console.warn(`[admin] cycle ${c.n} starts ${(-wait).toFixed(1)}s late (previous cycle overran its slot)`);
      console.log(`[admin] cycle ${c.n} (${c.kind}) at ${elapsedS().toFixed(1)}s`);
      cycleStartS.add(elapsedS(), { cycle: `c${c.n}` });
      await cycle(c.kind === "burst" ? "burst" : "steady", c.kind === "burst" ? c.bursts : null);
      prevEnd = elapsedS();
    }
    lastCycleEndS.add(elapsedS());
    // Final reconciliation read: the event must be back at its baseline.
    await delay(3000);
    const { body } = await readSnapshot({ window: "cleanup" });
    if (body) finalRows.add(body.items.length);
  } catch (e) {
    // No drain after an abort: exec.test.abort() ends the run at once.
    // The side-car samplers are separate processes, so they still record
    // the drain — wait DRAIN_S before touching the STOP file.
    await cleanupAndAbort(e);
    return;
  }
  await drain();
}

// Quiet tail: no request from any scenario. It starts when the last of
// the traffic windows is over — this VU's cycles (now), the steady
// streams, the reaction burst — and lasts DRAIN_S. Those other windows
// are fixed in the options; they cannot be cut short from here (k6 VUs
// share no state), which is why the steady window has to be sized to
// the cycles for a drain right after the last burst.
async function drain() {
  if (DRAIN_S <= 0) return;
  const steadyEnd = POLL_RPS > 0 || SSR_RPS > 0 ? STEADY_START + STEADY_SECONDS : 0;
  const reactionEnd = REACTIONS > 0 ? REACTION_AT + REACTION_SECONDS : 0;
  const start = Math.max(elapsedS(), steadyEnd, reactionEnd);
  if (start > elapsedS() + 1) {
    console.log(`[admin] cycles done at ${elapsedS().toFixed(1)}s; waiting for the steady/reaction windows to end at ${start.toFixed(0)}s`);
    await delay((start - elapsedS()) * 1000);
  }
  drainStartS.add(elapsedS());
  console.log(`[admin] drain: no requests from ${elapsedS().toFixed(1)}s for ${DRAIN_S}s`);
  await delay(DRAIN_S * 1000);
}

// ── admission mode: runtime ─────────────────────────────────────
// Status tally for the admission gates: every request of the run (the
// wave, notification fetches, rechecks, the PUTs, SSR, the hold's
// polls) — "0 × 5xx and 0 transport failures" is about all of them.
function tallyStatus(res, kind) {
  const s = res.status;
  if (s === 0) admTransport.add(1, { kind });
  else if (s >= 500) {
    adm5xx.add(1, { kind });
    if (s === 503) adm503.add(1, { kind });
  } else if (s >= 400) adm4xx.add(1, { kind });
}

// SSR event page for the admission window: like getEventPage() (no
// redirect following — a 308 means EVENT_SLUG is wrong), but over the
// 70/20/10 locale mix of the arrivals and with the status tally.
export function ssrAdmission() {
  const locale = pickLocale();
  const res = http.get(`${BASE_URL}/${locale}/events/${EVENT_ID}/${__ENV.EVENT_SLUG}`, {
    headers: baseHeaders(),
    redirects: 0,
    responseType: "none",
    tags: { name: "ssr_event_page", locale },
    timeout: "30s",
  });
  ssrErrors.add(res.status !== 200);
  check(res, { "event page 200": (r) => r.status === 200 });
  tallyStatus(res, "ssr");
}

// One notification fetch of one admitted viewer for one save. Updates
// the viewer's applied revision (the R1 shape's next minRev) and
// returns the response's rev (null on failure).
async function shapeFetch(save, v, wave, minRev, hint, savedRev, scheduledAt, st) {
  const startedAt = Date.now();
  admShapeLag.add(startedAt - scheduledAt, { shape: v.shape });
  const kind = wave === "recheck" ? "recheck" : "shape";
  const tags = { name: "snapshot", phase: kind === "recheck" ? "recheck" : "shape", save, shape: v.shape, wave, locale: v.locale };
  st.inFlight++;
  const res = await http.asyncRequest("GET", withMinRev(snapshotUrl(v.locale), minRev, hint), null, {
    headers: viewerHeaders(),
    responseType: "text",
    tags,
    timeout: "30s",
  });
  st.inFlight--;
  const r = recordViewerSnapshot(res, tags);
  tallyStatus(res, kind);
  admShapeReqs.add(1, { save, shape: v.shape, wave });
  if (wave !== "recheck") admShapeLatency.add(res.timings.duration, { save, shape: v.shape });
  if (!r.ok) return { rev: null, verify: null };
  if (r.rev != null && (v.appliedRev == null || r.rev > v.appliedRev)) v.appliedRev = r.rev;
  const h = headCheck(v.shape, r.rev, savedRev);
  admHeadEq.add(h.eq, { save, shape: v.shape, wave });
  admHeadGe.add(h.ge, { save, shape: v.shape, wave });
  // Marker check, sampled: a response AT the saved head must show this
  // save's marker on the anchor (content consistent with its rev). A
  // response beyond it may carry a later save's marker, so it is not
  // judged — "marker checks follow the returned revision".
  if (h.eq && Math.random() < BODY_SAMPLE_RATE) {
    const body = jsonParse(res.body);
    const it = body && Array.isArray(body.items) ? body.items.find((x) => String(x.id) === PROBE.anchorId) : null;
    admMarkerOk.add(!!it && songIdsOf(it).map(String).includes(String(st.markerOf[save])), { save });
  }
  return { rev: r.rev, verify: verifyOf(res) };
}

// All notification fetches of one admitted viewer for one save; records
// the per-shape claim on the viewer's FINAL state for this save:
//   r2  — exact saved head after the (optional) recheck;
//   r1  — at or beyond the saved head;
//   pre — at or beyond it on the repeat (the tab's last fetch).
async function notifyViewer(save, v, savedRev, putEnd, st) {
  const p = notificationParams(v.shape, { savedRev, appliedRev: v.appliedRev });
  const at = Math.random() * (v.shape === "pre" ? OLD_JITTER_MS : JITTER_MS);
  await delay(at);
  let r = await shapeFetch(save, v, "1", p.minRev, p.hint, savedRev, putEnd + at, st);
  if (v.shape === "r2" && r.verify && INCONCLUSIVE.has(r.verify.kind) && (r.rev == null || r.rev < p.minRev)) {
    const wait = RECHECK_BASE_MS + Math.random() * RECHECK_SPREAD_MS;
    await delay(wait);
    r = await shapeFetch(save, v, "recheck", p.minRev, false, savedRev, putEnd + at + wait, st);
  }
  if (v.shape === "pre") {
    const due = putEnd + at + OLD_REPEAT_MS;
    await delay(Math.max(0, due - Date.now()));
    r = await shapeFetch(save, v, "2", null, false, savedRev, due, st);
  }
  admHeadFinal.add(headCheck(v.shape, r.rev, savedRev).claim, { save, shape: v.shape });
}

async function admissionSave(i, t0, st) {
  const save = saveId(i);
  const scheduled = t0 + SAVE_OFFSETS[i] * 1000;
  await delay(Math.max(0, scheduled - Date.now()));
  const marker = PROBE.markers[i % PROBE.markers.length];
  st.markerOf[save] = marker.id;
  const exp = () => exposure({ admitted: st.viewers.length, arrivalsTotal: ARRIVALS, arrivalsDone: st.arrivalsDone, inFlight: st.inFlight });
  const e0 = exp();
  const putStart = Date.now();
  st.inFlight++;
  const res = await http.asyncRequest(
    "PUT",
    `${BASE_URL}/api/admin/setlist-items/${PROBE.anchorId}`,
    // Same body as the browsers harness's putSongRaw: the anchor stays an
    // ordinary row (isEncore false) at its own position, so the whole-
    // event encore validation passes; only the song changes.
    JSON.stringify({ position: PROBE.anchorPos, isEncore: false, type: "song", status: "confirmed", songIds: [String(marker.id)] }),
    {
      headers: { ...baseHeaders(), "Content-Type": "application/json" },
      cookies: { [PROBE.cookieName || COOKIE_NAME]: PROBE.cookie },
      tags: { name: "admission_put", save },
      timeout: "30s",
    },
  );
  st.inFlight--;
  const putEnd = Date.now();
  tallyStatus(res, "put");
  // Exposure at the response BEFORE the cohort is fixed: the viewers
  // admitted by now are the ones that receive this save's notification.
  const e1 = exp();
  const body = res.status >= 200 && res.status < 300 ? jsonParse(res.body) : null;
  const savedRev = body && Number.isSafeInteger(body.rev) ? body.rev : null;
  admPutStart.add(putStart, { save });
  admPutEnd.add(putEnd, { save });
  admPutMs.add(res.timings.duration, { save });
  admPutLag.add(putStart - scheduled, { save });
  admSaveStatus.add(res.status, { save });
  if (savedRev != null) admSaveRev.add(savedRev, { save });
  for (const [at, e] of [["start", e0], ["end", e1]]) {
    admExposure.add(e.admitted, { save, at, what: "admitted" });
    admExposure.add(e.outstanding, { save, at, what: "outstanding" });
    admExposure.add(e.inFlight, { save, at, what: "inflight" });
  }
  console.log(
    `[admission ${save}] @${((putStart - t0) / 1000).toFixed(2)}s (scheduled ${SAVE_OFFSETS[i]}s) PUT ${res.status} ${Math.round(res.timings.duration)}ms rev=${savedRev} ` +
      `marker=${marker.id}; at response: admitted ${e1.admitted}, outstanding arrivals ${e1.outstanding}, in flight ${e1.inFlight}`,
  );
  if (savedRev == null) {
    console.warn(`[admission ${save}] save failed (HTTP ${res.status} ${String(res.body).slice(0, 160)}) — no notification fetches`);
    return;
  }
  const cohort = st.viewers.slice();
  for (const s of SHAPES) {
    const n = cohort.filter((v) => v.shape === s).length;
    if (n) admShapeViewers.add(n, { save, shape: s });
  }
  await Promise.all(cohort.map((v) => notifyViewer(save, v, savedRev, putEnd, st)));
}

async function admissionArrival(i, t0, st) {
  const scheduled = t0 + arrivalOffsetMs(i, ARRIVALS, ARRIVAL_SECONDS);
  await delay(Math.max(0, scheduled - Date.now()));
  const locale = pickLocale();
  const shape = pickShape(MIX, Math.random());
  const startedAt = Date.now();
  admArrivalLag.add(startedAt - scheduled);
  const tags = { name: "snapshot", phase: "arrival", locale, shape };
  st.inFlight++;
  const res = await http.asyncRequest("GET", snapshotUrl(locale), null, {
    headers: viewerHeaders(),
    responseType: "text",
    tags,
    timeout: "30s",
  });
  st.inFlight--;
  st.arrivalsDone++;
  const r = recordViewerSnapshot(res, tags);
  tallyStatus(res, "arrival");
  admArrivalLatency.add(res.timings.duration, { locale });
  admArrivalErr.add(!r.ok);
  if (!r.ok) return; // not admitted: no snapshot, no notification handling (no retry modelled)
  st.viewers.push({ locale, shape, appliedRev: r.rev });
  admViewers.add(1, { shape });
}

export async function admissionMain() {
  const t0 = Date.now();
  admT0.add(t0);
  const st = { viewers: [], arrivalsDone: 0, inFlight: 0, markerOf: {} };
  console.log(`[admission] t0=${new Date(t0).toISOString()} arrivals ${ARRIVALS}/${ARRIVAL_SECONDS}s, saves @${SAVE_OFFSETS.join(",") || "none"}s, mix ${SHAPE_MIX_RAW}`);
  const work = [];
  for (let i = 0; i < ARRIVALS; i++) work.push(admissionArrival(i, t0, st));
  SAVE_OFFSETS.forEach((_, i) => work.push(admissionSave(i, t0, st)));
  await Promise.all(work);
  console.log(`[admission] wave + saves done at ${elapsedS().toFixed(1)}s: ${st.viewers.length}/${ARRIVALS} admitted`);
  // Hold until the SSR and poll windows are over, then the quiet drain
  // (see drain() — same purpose: the side-car samplers see the pools
  // drain with no traffic of ours).
  const end = Math.max(SSR_RPS > 0 ? SSR_SECONDS : 0, POLL_RPS > 0 && STEADY_SECONDS > 0 ? STEADY_START + STEADY_SECONDS : 0);
  if (end > elapsedS()) await delay((end - elapsedS()) * 1000);
  if (DRAIN_S > 0) {
    drainStartS.add(elapsedS());
    console.log(`[admission] drain: no requests from ${elapsedS().toFixed(1)}s for ${DRAIN_S}s`);
    await delay(DRAIN_S * 1000);
  }
}

// ── report ──────────────────────────────────────────────────────
const M = (data, key) => data.metrics[key];
// null (rendered "—", judged n/a or FAIL) when the metric has no
// samples: k6 reports an empty trend as all-zero stats and an empty
// rate as 0, which would read as "p95 0 ms, PASS" after a setup abort.
const val = (data, key, stat) => {
  const m = M(data, key);
  if (!m || !m.values) return null;
  const v = m.values;
  if (m.type === "trend" && !v.count) return null;
  if (m.type === "rate" && !(v.passes + v.fails)) return null;
  return v[stat] != null && !Number.isNaN(v[stat]) ? v[stat] : null;
};
const ms = (v) => (v == null ? "—" : `${Math.round(v)} ms`);
const pct = (v, d = 2) => (v == null ? "—" : `${(v * 100).toFixed(d)} %`);
const cnt = (data, key) => val(data, key, "count") ?? 0;
const verdict = (ok) => (ok == null ? "n/a" : ok ? "**PASS**" : "**FAIL**");
const fmtS = (v) => (v == null ? "—" : `${v.toFixed(1)}s`);

function srcCells(data, sel) {
  const n = {};
  let total = 0;
  for (const s of Object.keys(SRC)) {
    n[s] = cnt(data, `snap_src_${s}{${sel}}`);
    total += n[s];
  }
  return { ...n, total };
}

// ── admission mode: summary ─────────────────────────────────────
// Markdown (gates + the "Admission" section + the hold's steady streams)
// and `<stamp>-k6-admission.json`, the machine-readable record that
// tests/load/admission-join.mjs may read (optional input there). Epoch
// ms are LAPTOP clock (k6 host); `probe.clock` is the precursor's
// servedAt offset (server − laptop, ±errMs) for converting them — only
// an estimate for the fresh deployment's instances (design §0).
const rateNP = (data, key) => {
  const m = M(data, key);
  if (!m || !m.values) return { n: 0, ok: 0, rate: null };
  const n = (m.values.passes || 0) + (m.values.fails || 0);
  return { n, ok: m.values.passes || 0, rate: n ? m.values.passes / n : null };
};
const trendStats = (data, key) => ({
  n: val(data, key, "count") ?? 0,
  p50: val(data, key, "med"),
  p95: val(data, key, "p(95)"),
  p99: val(data, key, "p(99)"),
  max: val(data, key, "max"),
});
const r0 = (v) => (v == null ? null : Math.round(v));

function admissionSummary(data) {
  const sd = data.setup_data || {};
  const t0 = val(data, "adm_t0_ms", "max");
  const saves = SAVE_OFFSETS.map((off, i) => {
    const save = saveId(i);
    const g = (m) => val(data, sub(m, { save }), "max");
    const expo = (at) => ({
      admitted: val(data, sub("adm_exposure", { save, at, what: "admitted" }), "max"),
      outstanding: val(data, sub("adm_exposure", { save, at, what: "outstanding" }), "max"),
      inFlight: val(data, sub("adm_exposure", { save, at, what: "inflight" }), "max"),
    });
    const shapes = {};
    for (const s of SHAPES) {
      const waves = {};
      for (const wave of ADM_WAVES) {
        const reqs = cnt(data, sub("adm_shape_reqs", { save, shape: s, wave }));
        if (!reqs) continue;
        waves[wave] = { requests: reqs, eq: rateNP(data, sub("adm_head_eq", { save, shape: s, wave })), ge: rateNP(data, sub("adm_head_ge", { save, shape: s, wave })) };
      }
      shapes[s] = {
        viewers: cnt(data, sub("adm_shape_viewers", { save, shape: s })),
        waves,
        latency: trendStats(data, sub("adm_shape_latency", { save, shape: s })),
        claim: s === "r2" ? "rev === savedRev (after recheck)" : s === "r1" ? "rev >= savedRev" : "rev >= savedRev on the repeat",
        final: rateNP(data, sub("adm_head_final", { save, shape: s })),
      };
    }
    return {
      id: save,
      offsetS: off,
      scheduledAt: t0 != null ? t0 + off * 1000 : null,
      putStart: g("adm_put_start_ms"),
      putEnd: g("adm_put_end_ms"),
      putMs: r0(g("adm_put_ms")),
      startLagMs: r0(g("adm_put_start_lag")),
      status: g("adm_save_status"),
      rev: g("adm_save_rev"),
      marker: PROBE.markers && PROBE.markers.length ? String(PROBE.markers[i % PROBE.markers.length].id) : null,
      exposure: { atPutStart: expo("start"), atPutEnd: expo("end") },
      marker_ok: rateNP(data, sub("adm_marker_ok", { save })),
      shapes,
    };
  });
  const byShape = Object.fromEntries(SHAPES.map((s) => [s, cnt(data, sub("adm_viewers", { shape: s }))]));
  const arrivalSrc = srcCells(data, "phase:arrival");
  const arrErr = rateNP(data, "adm_arrival_errors");
  const arrivals = {
    total: ARRIVALS,
    seconds: ARRIVAL_SECONDS,
    completed: val(data, "adm_arrival_latency", "count") ?? 0,
    admitted: SHAPES.reduce((a, s) => a + byShape[s], 0),
    errors: arrErr.ok,
    byShape,
    byLocale: Object.fromEntries(ADM_LOCALES.map((l) => [l, trendStats(data, sub("adm_arrival_latency", { locale: l }))])),
    latency: trendStats(data, "adm_arrival_latency"),
    startLag: trendStats(data, "adm_arrival_start_lag"),
    sources: arrivalSrc,
  };
  const kinds = (m) => Object.fromEntries(ADM_KINDS.map((k) => [k, cnt(data, sub(m, { kind: k }))]));
  const errors = {
    http5xx: { total: cnt(data, "adm_http_5xx"), byKind: kinds("adm_http_5xx") },
    http503: { total: cnt(data, "adm_http_503"), byKind: kinds("adm_http_503") },
    transport: { total: cnt(data, "adm_transport_errors"), byKind: kinds("adm_transport_errors") },
    http4xx: { total: cnt(data, "adm_http_4xx"), byKind: kinds("adm_http_4xx") },
  };
  const ssr = {
    rps: SSR_RPS,
    seconds: SSR_SECONDS,
    requests: cnt(data, "http_reqs{scenario:ssr}"),
    latency: trendStats(data, "http_req_duration{scenario:ssr}"),
    errorRate: val(data, "ssr_errors", "rate"),
    dropped: cnt(data, "dropped_iterations{scenario:ssr}"),
  };
  const poll = {
    rps: POLL_RPS,
    window: [STEADY_START, STEADY_START + STEADY_SECONDS],
    requests: cnt(data, "http_reqs{scenario:poll}"),
    latency: trendStats(data, "http_req_duration{scenario:poll}"),
    errorRate: val(data, "snapshot_errors{scenario:poll}", "rate"),
    dropped: cnt(data, "dropped_iterations{scenario:poll}"),
    sources: srcCells(data, "phase:poll"),
  };
  const badM = M(data, "snapshot_bad_body");
  const bad = badM ? badM.values.passes : 0;
  const sampled = badM ? badM.values.passes + badM.values.fails : 0;
  const shapeFinal = Object.fromEntries(SHAPES.map((s) => [s, rateNP(data, sub("adm_head_final", { shape: s }))]));
  const savesOk = saves.filter((s) => s.status != null && s.status >= 200 && s.status < 300 && s.rev != null).length;

  const gates = [];
  const gate = (name, measured, threshold, ok, soft = false) => gates.push({ gate: name, measured, threshold, verdict: ok == null ? "n/a" : ok ? "PASS" : soft ? "SOFT FAIL" : "FAIL", soft });
  gate("5xx, all requests", `${errors.http5xx.total} (${ADM_KINDS.filter((k) => errors.http5xx.byKind[k]).map((k) => `${k} ${errors.http5xx.byKind[k]}`).join(", ") || "none"})`, "0", errors.http5xx.total === 0);
  gate("503, all requests", `${errors.http503.total}`, "0", errors.http503.total === 0);
  gate("transport failures, all requests", `${errors.transport.total} (${ADM_KINDS.filter((k) => errors.transport.byKind[k]).map((k) => `${k} ${errors.transport.byKind[k]}`).join(", ") || "none"})`, "0", errors.transport.total === 0);
  gate("admission saves committed", `${savesOk} / ${SAVE_OFFSETS.length}`, "all", savesOk === SAVE_OFFSETS.length);
  gate("arrival wave p95 (soft)", `${r0(arrivals.latency.p95) ?? "—"} ms (n=${arrivals.completed}, max ${r0(arrivals.latency.max) ?? "—"} ms)`, `≤ ${WAVE_GATE_P95} ms`, arrivals.latency.p95 == null ? null : arrivals.latency.p95 <= WAVE_GATE_P95, true);
  gate("all arrivals admitted", `${arrivals.admitted} / ${ARRIVALS}`, "all", arrivals.admitted === ARRIVALS);
  gate("SSR p95", `${r0(ssr.latency.p95) ?? "—"} ms (n=${ssr.requests}, errors ${pct(ssr.errorRate, 3)})`, `≤ ${SSR_GATE_P95} ms, 0 errors`, ssr.latency.p95 == null ? null : ssr.latency.p95 <= SSR_GATE_P95 && !ssr.errorRate);
  for (const s of SHAPES) {
    const f = shapeFinal[s];
    gate(`saved head, ${s} (${s === "r2" ? "rev = savedRev after recheck" : s === "r1" ? "rev ≥ savedRev" : "rev ≥ savedRev on the repeat"})`, `${f.ok} / ${f.n}`, "100 %", f.n ? f.ok === f.n : null);
  }
  gate("bad bodies / sampled", `${bad} / ${sampled} (rows ${val(data, "snapshot_rows", "min") ?? "—"}–${val(data, "snapshot_rows", "max") ?? "—"})`, "0, ≥ 1 sampled", sampled > 0 && bad === 0);
  gate("generator: SSR + poll dropped iterations", `${ssr.dropped + poll.dropped}`, "0", ssr.dropped + poll.dropped === 0);

  const summary = {
    kind: "k6-admission",
    version: 1,
    label: PROBE.label,
    base: BASE_URL,
    eventId: String(EVENT_ID),
    t0,
    t0Iso: t0 != null ? new Date(t0).toISOString() : null,
    clocks: "epoch ms on the k6 host (laptop); probe.clock = precursor servedAt offset (server − laptop)",
    probe: {
      file: PROBE.file,
      label: PROBE.label,
      at: PROBE.at,
      precursorBase: PROBE.precursorBase,
      revAtProbe: PROBE.revAtProbe,
      rev: PROBE.rev,
      rows: PROBE.rows,
      clock: PROBE.clock ? { offsetMs: PROBE.clock.offsetMs, errMs: PROBE.clock.errMs } : null,
    },
    fixture: PROBE.fixture || null,
    anchor: { id: PROBE.anchorId, position: PROBE.anchorPos },
    knobs: {
      ARRIVALS, ARRIVAL_SECONDS, SHAPE_MIX: SHAPE_MIX_RAW, ADMISSION_SAVES: ADMISSION_SAVES_RAW, SSR_RPS, SSR_SECONDS,
      POLL_RPS, STEADY_START, STEADY_SECONDS, JITTER_MS, OLD_JITTER_MS, OLD_REPEAT_MS, DRAIN_S, ACCEPT_ENCODING, BODY_SAMPLE_RATE,
    },
    saves,
    arrivals,
    ssr,
    poll,
    errors,
    shapeFinal,
    gates,
    runSeconds: data.state ? Math.round(data.state.testRunDurationMs / 1000) : null,
  };

  const n = (v) => (v == null ? "—" : String(v));
  const saveRows = saves.map((s) => {
    const sh = (k) => {
      const x = s.shapes[k];
      const w = Object.entries(x.waves).map(([wave, o]) => `${wave === "1" ? "" : `${wave}: `}${o.requests} req, = ${o.eq.ok}/${o.eq.n}, ≥ ${o.ge.ok}/${o.ge.n}`).join("; ");
      return `${x.viewers} viewers · ${w || "—"} · final ${x.final.ok}/${x.final.n} · p95 ${ms(x.latency.p95)}`;
    };
    const e0 = s.exposure.atPutStart;
    const e1 = s.exposure.atPutEnd;
    return (
      `| ${s.id} | ${s.offsetS}s (+${n(s.startLagMs)} ms) | ${n(s.status)} · ${ms(s.putMs)} · rev ${n(s.rev)} | ` +
      `${n(e0.admitted)} / ${n(e0.outstanding)} / ${n(e0.inFlight)} → ${n(e1.admitted)} / ${n(e1.outstanding)} / ${n(e1.inFlight)} | ` +
      `${sh("r2")} | ${sh("r1")} | ${sh("pre")} | ${s.marker_ok.ok}/${s.marker_ok.n} |`
    );
  });
  const md =
    `## Viewers — admission mode (A1) — ${new Date().toISOString()}\n\n` +
    `BASE_URL=${BASE_URL} EVENT_ID=${EVENT_ID} EXPECTED_ROWS=${EXPECTED_ROWS ?? "—"} probe=${PROBE.label} (precursor ${PROBE.precursorBase}, rev ${PROBE.rev}, ` +
    `${PROBE.rows} rows${PROBE.fixture ? `, fixture ${PROBE.fixture.label}` : ""}) anchor ${PROBE.anchorId}@${PROBE.anchorPos}\n\n` +
    `- t0 ${summary.t0Iso ?? "—"}; arrivals ${ARRIVALS} over ${ARRIVAL_SECONDS}s (generic reads, 70/20/10), SHAPE_MIX ${SHAPE_MIX_RAW} (r2/r1/pre), ` +
    `saves @${ADMISSION_SAVES_RAW || "none"}s; SSR ${SSR_RPS} rps 0→${SSR_SECONDS}s; poll ${POLL_RPS} rps ${STEADY_START}→${STEADY_START + STEADY_SECONDS}s; drain ${DRAIN_S}s\n` +
    `- probe clock offset ${sd.clockOffsetMs != null ? Math.round(sd.clockOffsetMs) : "—"} ms (±${sd.clockErrMs != null ? Math.round(sd.clockErrMs) : "—"} ms, precursor) — run ${summary.runSeconds ?? "—"}s\n` +
    "\n### Gates\n\n| Gate | measured | gate | verdict |\n|---|---|---|---|\n" +
    gates.map((x) => `| ${x.gate} | ${x.measured} | ${x.threshold} | **${x.verdict}** |`).join("\n") +
    `\n| Σ pool estimate / builds per instance (vercel-logs-summary.mjs) | ___ | < 300, completeness stated | _orchestrator_ |\n` +
    "\n## Admission\n\n" +
    `- **wave**: ${arrivals.completed}/${ARRIVALS} answered, ${arrivals.admitted} admitted (r2 ${byShape.r2} / r1 ${byShape.r1} / pre ${byShape.pre}), ` +
    `${arrivals.errors} errors; latency p50 ${ms(arrivals.latency.p50)} / p95 ${ms(arrivals.latency.p95)} / p99 ${ms(arrivals.latency.p99)} / max ${ms(arrivals.latency.max)}\n` +
    `- per locale p95: ${ADM_LOCALES.map((l) => `${l} ${ms(arrivals.byLocale[l].p95)} (n=${arrivals.byLocale[l].n})`).join(", ")}\n` +
    `- scheduled → actual start lag: p50 ${ms(arrivals.startLag.p50)} / p95 ${ms(arrivals.startLag.p95)} / max ${ms(arrivals.startLag.max)} (generator health; latency is measured from the actual start)\n` +
    `- first-read source build/cache/repair/warm: ${arrivalSrc.build} / ${arrivalSrc.cache} / ${arrivalSrc.repair} / ${arrivalSrc.warm}${arrivalSrc.other ? ` (+${arrivalSrc.other} other)` : ""} (header proxy — count builds from the logs)\n` +
    `- notification fetch start lag (scheduled → actual): ${SHAPES.map((s) => `${s} p95 ${ms(val(data, sub("adm_shape_start_lag", { shape: s }), "p(95)"))}`).join(", ")}\n` +
    `- 4xx (not gated, read them): ${errors.http4xx.total}\n\n` +
    "Exposure columns: admitted / outstanding arrivals / this VU's in-flight requests, at PUT start → at PUT response. " +
    "Shape cells: viewers notified · per wave requests, `=` exact saved head, `≥` at or beyond (wave 1 unlabeled; `2` = pre-R1 repeat; `recheck` = R2 recheck) · final claim · p95.\n\n" +
    "| Save | at (start lag) | PUT status · ms · rev | exposure | R2 | R1 | pre-R1 | marker ok (sampled) |\n|---|---|---|---|---|---|---|---|\n" +
    saveRows.join("\n") +
    "\n\n### Steady streams (hold)\n\n" +
    `- poll: ${poll.requests} req, p50 ${ms(poll.latency.p50)} / p95 ${ms(poll.latency.p95)} / p99 ${ms(poll.latency.p99)}, errors ${pct(poll.errorRate, 3)}, ` +
    `source build/cache/repair/warm ${poll.sources.build} / ${poll.sources.cache} / ${poll.sources.repair} / ${poll.sources.warm}\n` +
    `- SSR event page (0→${SSR_SECONDS}s): ${ssr.requests} req, p50 ${ms(ssr.latency.p50)} / p95 ${ms(ssr.latency.p95)} / p99 ${ms(ssr.latency.p99)} / max ${ms(ssr.latency.max)}, errors ${pct(ssr.errorRate, 3)}\n`;

  const base = `${resultsDir()}/${stamp()}`;
  return {
    stdout: md,
    [`${base}-viewers.md`]: md,
    [`${base}-viewers.json`]: JSON.stringify({ admission: true, setup: sd, metrics: data.metrics }, null, 2),
    [`${base}-k6-admission.json`]: JSON.stringify(summary, null, 2),
  };
}

export function handleSummary(data) {
  if (ADMISSION) return admissionSummary(data);
  const sd = data.setup_data || {};
  const runS = data.state ? data.state.testRunDurationMs / 1000 : null;

  // whole-run snapshot gate
  const snapP95 = val(data, "http_req_duration{name:snapshot}", "p(95)");
  const snapP99 = val(data, "http_req_duration{name:snapshot}", "p(99)");
  const snapN = val(data, "http_req_duration{name:snapshot}", "count");
  const snapErr = val(data, "snapshot_errors", "rate");
  const badM = M(data, "snapshot_bad_body");
  const bad = badM ? badM.values.passes : 0;
  const sampled = badM ? badM.values.passes + badM.values.fails : 0;

  // Distinct error bodies per burst, from the `burst-error <id> | <body>`
  // checks the admin VU records (see the header).
  const errBodies = {};
  for (const c of (data.root_group && data.root_group.checks) || []) {
    if (!c.name.startsWith(ERR_CHECK_PREFIX)) continue;
    const rest = c.name.slice(ERR_CHECK_PREFIX.length);
    const cut = rest.indexOf(" | ");
    const id = cut < 0 ? rest : rest.slice(0, cut);
    (errBodies[id] ||= []).push({ body: cut < 0 ? "?" : rest.slice(cut + 3), n: c.fails });
  }

  // bursts
  const rows = [];
  let worstP95 = null;
  let worstId = null;
  for (const b of PLAN.bursts) {
    const n = val(data, `burst_latency{burst:${b.id}}`, "count");
    const s = srcCells(data, `burst:${b.id}`);
    const p95 = val(data, `burst_latency{burst:${b.id}}`, "p(95)");
    if (n && (worstP95 == null || p95 > worstP95)) {
      worstP95 = p95;
      worstId = b.id;
    }
    const em = M(data, `burst_errors{burst:${b.id}}`);
    const errN = em && em.values ? em.values.passes : 0;
    const vc = VERIFY_KINDS.map((k) => cnt(data, `verify_outcome{burst:${b.id},kind:${k},req:first}`)).join(" / ");
    const re =
      HINT_MODE === "r2"
        ? ` · rechecks ${cnt(data, `hint_rechecks{burst:${b.id}}`)} · warm ${cnt(data, `hint_warm{burst:${b.id}}`)}/${cnt(data, `hint_fetches{burst:${b.id}}`)} hinted`
        : "";
    rows.push(
      `| ${b.id} | ${b.label} | ${n ?? 0} | ${ms(val(data, `burst_latency{burst:${b.id}}`, "med"))} / ${ms(p95)} / ` +
        `${ms(val(data, `burst_latency{burst:${b.id}}`, "max"))} | ${errN} (${pct(val(data, `burst_errors{burst:${b.id}}`, "rate"))}) | ` +
        `${s.build} / ${s.cache} / ${s.repair} / ${s.warm}${s.other ? ` (+${s.other} other)` : ""} | ${s.build + s.repair} | ` +
        `${pct(val(data, `burst_rev_ok{burst:${b.id}}`, "rate"), 1)} | ${vc}${re} |`,
    );
  }
  const fired = cnt(data, "bursts_fired");
  // Hint outcomes: the new-build tabs' notification fetches (first wave),
  // then the r2 rechecks.
  const vFirst = Object.fromEntries(VERIFY_KINDS.map((k) => [k, cnt(data, `verify_outcome{client:${NEW_CLIENT},kind:${k},req:first}`)]));
  const vRe = Object.fromEntries(VERIFY_KINDS.map((k) => [k, cnt(data, `verify_outcome{kind:${k},req:recheck}`)]));
  const notifN = VERIFY_KINDS.reduce((a, k) => a + vFirst[k], 0);
  const rechecks = cnt(data, "hint_rechecks");
  const exhausted = cnt(data, "hint_exhausted");
  const hintedN = cnt(data, "hint_fetches");
  const warmN = cnt(data, "hint_warm");
  const kindLine = (o) => VERIFY_KINDS.map((k) => `${k} ${o[k]}`).join(", ");
  const hintLines =
    `- **hint outcomes** (${NEW_CLIENT} notification fetches, 200 responses, \`x-snapshot-verify\`; HINT_MODE=${HINT_MODE}): ` +
    `${notifN} — ${kindLine(vFirst)}; malformed ${cnt(data, "verify_malformed")} (counted as missing); ` +
    `fresh refutations of a committed save ${cnt(data, "verify_fresh_violation")} (must be 0)\n` +
    (HINT_MODE === "r2"
      ? `- **rechecks**: ${rechecks} (${notifN ? pct(rechecks / notifN, 2) : "—"} of notification fetches), ` +
        `p95 ${ms(val(data, "recheck_latency", "p(95)"))}, errors ${pct(val(data, "snapshot_errors{phase:recheck}", "rate"), 3)}; ` +
        `outcome ${kindLine(vRe)}; still inconclusive below H (hint exhausted) ${exhausted}\n` +
        `- **warm hits** (\`x-snapshot-source: warm\`, writer warming): ${warmN} of ${hintedN} hinted fetches ` +
        `(${hintedN ? pct(warmN / hintedN, 1) : "—"}; 0 with LIVE_WARM_ENTRIES off)\n`
      : "");
  const burstSrc = srcCells(data, "phase:burst");
  const pollSrc = srcCells(data, "phase:poll");

  // steady
  const pollN = cnt(data, "http_reqs{scenario:poll}");
  const pollAchieved = STEADY_SECONDS > 0 ? pollN / STEADY_SECONDS : 0;
  const dropped =
    cnt(data, "dropped_iterations{scenario:poll}") +
    cnt(data, "dropped_iterations{scenario:ssr}") +
    cnt(data, "dropped_iterations{scenario:reactions}");
  const ssrN = cnt(data, "http_reqs{scenario:ssr}");

  // admin
  const admSteadyP95 = val(data, "admin_save_reload{window:steady}", "p(95)");
  const admBurstP95 = val(data, "admin_save_reload{window:burst}", "p(95)");
  const writes = cnt(data, "admin_writes");
  const lost = val(data, "admin_lost_edit", "rate");
  const finalN = val(data, "final_row_count", "max");

  // reactions
  const rxErr = val(data, "reaction_errors", "rate");
  const rxAck = val(data, "reaction_ack_ok", "rate");
  const rxPostN = val(data, "reaction_latency{op:post}", "count") ?? 0;
  const rxDelN = val(data, "reaction_latency{op:delete}", "count") ?? 0;
  const leftovers = cnt(data, "reaction_leftover");

  const g = (name, measured, gate, ok) => `| ${name} | ${measured} | ${gate} | ${verdict(ok)} |`;
  const gates = [
    g("snapshot p95, whole run (polls + bursts)", `${ms(snapP95)} (p99 ${ms(snapP99)}, n=${snapN ?? 0})`, `≤ ${GATES.passP95} ms`, snapP95 == null ? null : snapP95 <= GATES.passP95),
    g("snapshot errors, whole run", pct(snapErr, 3), `≤ ${GATES.passErrorRate * 100} %`, snapErr == null ? null : snapErr <= GATES.passErrorRate),
    g(
      "bad bodies / sampled",
      `${bad} / ${sampled} (rows seen ${val(data, "snapshot_rows", "min") ?? "—"}–${val(data, "snapshot_rows", "max") ?? "—"})`,
      "0, ≥ 1 sampled",
      sampled > 0 && bad === 0,
    ),
    g("burst windows p95 (worst burst)", `${ms(worstP95)} (${worstId ?? "—"}); all bursts ${ms(val(data, "burst_latency", "p(95)"))}`, `≤ ${BURST_GATE_P95} ms`, worstP95 == null ? null : worstP95 <= BURST_GATE_P95),
    g("bursts fired", `${fired} / ${PLAN.bursts.length}`, "all", fired === PLAN.bursts.length),
    g("admin save+reload p95, steady window", ms(admSteadyP95), `≤ ${GATES.adminP95} ms`, admSteadyP95 == null ? null : admSteadyP95 <= GATES.adminP95),
    g("admin save+reload p95, burst windows", ms(admBurstP95), `≤ ${GATES.adminP95} ms`, admBurstP95 == null ? null : admBurstP95 <= GATES.adminP95),
    g("every write visible", `lost ${pct(lost, 1)}; writes ${writes} / ${PLANNED_SAVES}`, "0 lost, all done", lost === 0 && writes === PLANNED_SAVES),
    g("event back at baseline", `${finalN ?? "—"} rows`, EXPECTED_ROWS != null ? `${EXPECTED_ROWS}` : "(EXPECTED_ROWS unset)", EXPECTED_ROWS == null || finalN == null ? null : finalN === EXPECTED_ROWS),
    g("reaction errors", `${pct(rxErr, 3)} (POST ${rxPostN}, DELETE ${rxDelN})`, `≤ ${GATES.passErrorRate * 100} %`, rxErr == null ? null : rxErr <= GATES.passErrorRate),
    g("reaction ackAt present and ≥ request start", pct(rxAck, 2), "100 %", rxAck == null ? null : rxAck === 1),
    g("reactions cleaned up", `${leftovers} possibly left (POST timeout / DELETE failed)`, "0 (check: node tests/load/viewers-check.mjs)", leftovers === 0),
    g("generator: poll achieved ≥ 95 %, dropped = 0", `${pollAchieved.toFixed(1)} of ${POLL_RPS} rps, dropped ${dropped}`, "≥ 95 %, 0", pollAchieved >= POLL_RPS * GATES.achievedRatio && dropped === 0),
    `| pooler client peak (pooler-clients.mjs metrics / probe; vercel-logs-summary.mjs pool sum) | ___ / 200 | ≤ ${POOLER_GATE}, 0 EMAXCONN | _orchestrator_ |`,
  ];

  const plan =
    `- cold start: ${COLD_START ? "1 save + burst b00 at t=0" : "off"}; steady ${STEADY_START}s → ${STEADY_START + STEADY_SECONDS}s ` +
    `(poll ${POLL_RPS} rps + SSR ${SSR_RPS} rps)\n` +
    `- admin cycles (SAVE_GAP ${SAVE_GAP}s${BURST_GAP_S != null ? `, BURST_GAP_S ${BURST_GAP_S}s after each cycle's end` : ""}): ` +
    `${PLAN.cycles.map((c) => `c${c.n} ${c.kind} @${c.at != null ? c.at : "+gap"}s → ran @${fmtS(val(data, `admin_cycle_start_s{cycle:c${c.n}}`, "max"))}`).join(", ")}\n` +
    `- bursts: ${BURST_SIZE} req; ${NEW_CLIENT.toUpperCase()} tabs over U(0, ${JITTER_MS} ms) with ` +
    `${HINT_MODE === "r2" ? "minRev = saved rev + hint=1 (one recheck at +1–1.5 s when inconclusive)" : "minRev = appliedRev + 1"}, old-build share ${OLD_SHARE * 100} % over U(0, ${OLD_JITTER_MS} ms, pinned) ×${OLD_REPEATS + 1} (repeat +${OLD_REPEAT_MS} ms)\n` +
    `- timeline: last cycle ended @${fmtS(val(data, "admin_last_cycle_end_s", "max"))}, steady window ended @${STEADY_START + STEADY_SECONDS}s, ` +
    `quiet drain (no requests) from @${fmtS(val(data, "drain_start_s", "max"))} for ${DRAIN_S}s\n` +
    `- reactions: ${REACTIONS} POST+DELETE over ${REACTION_SECONDS}s @${REACTION_AT}s\n` +
    `- setup: start rev ${sd.startRev ?? "—"}, clock offset ${sd.clockOffsetMs != null ? Math.round(sd.clockOffsetMs) : "—"} ms ` +
    `(±${sd.clockErrMs != null ? Math.round(sd.clockErrMs) : "—"} ms), run ${runS != null ? Math.round(runS) : "—"}s\n`;

  const md =
    `## Viewers (500-viewer model) — ${new Date().toISOString()}\n\n` +
    `BASE_URL=${BASE_URL} EVENT_ID=${EVENT_ID} EXPECTED_ROWS=${EXPECTED_ROWS ?? "—"} ROW_SLACK=${ROW_SLACK} ` +
    `BODY_SAMPLE_RATE=${BODY_SAMPLE_RATE} HINT_MODE=${HINT_MODE}\n\n` +
    plan +
    "\n### Gates\n\n| Gate | measured | gate | verdict |\n|---|---|---|---|\n" +
    gates.join("\n") +
    "\n\n### Steady streams\n\n" +
    `- poll: ${pollN} req, achieved ${pollAchieved.toFixed(1)} rps, p50 ${ms(val(data, "http_req_duration{scenario:poll}", "med"))} / ` +
    `p95 ${ms(val(data, "http_req_duration{scenario:poll}", "p(95)"))} / p99 ${ms(val(data, "http_req_duration{scenario:poll}", "p(99)"))}, ` +
    `errors ${pct(val(data, "snapshot_errors{scenario:poll}", "rate"), 3)}; ` +
    `source build/cache/repair/warm ${pollSrc.build} / ${pollSrc.cache} / ${pollSrc.repair} / ${pollSrc.warm}${pollSrc.other ? ` (+${pollSrc.other} other)` : ""}\n` +
    `- SSR event page: ${ssrN} req, achieved ${(STEADY_SECONDS > 0 ? ssrN / STEADY_SECONDS : 0).toFixed(2)} rps, ` +
    `p95 ${ms(val(data, "http_req_duration{scenario:ssr}", "p(95)"))} / p99 ${ms(val(data, "http_req_duration{scenario:ssr}", "p(99)"))}, ` +
    `errors ${pct(val(data, "ssr_errors", "rate"), 3)}\n` +
    "\n### Notification bursts\n\n" +
    "`x-snapshot-source` is only a rough proxy for builds per save: coalesced waiters share the first request's result " +
    "(header included), so it over-counts, and background rebuilds are never attributed. The real number is the " +
    "`[liveSnapshot] build` log lines — run `node tests/load/vercel-logs-summary.mjs` on the run's Vercel log capture.\n\n" +
    `| Burst | save | requests | p50 / p95 / max | errors (%) | build / cache / repair / warm | builds (build+repair) | rev ≥ minRev (${NEW_CLIENT} reqs) | verify none / satisfied / fresh / memo / deferred / missing (all clients, 1st wave) |\n` +
    "|---|---|---|---|---|---|---|---|---|\n" +
    rows.join("\n") +
    "\n\n" +
    `- all bursts: ${burstSrc.total} req; build ${burstSrc.build}, cache ${burstSrc.cache}, repair ${burstSrc.repair}, warm ${burstSrc.warm}` +
    `${burstSrc.other ? `, other ${burstSrc.other}` : ""} → **${fired ? ((burstSrc.build + burstSrc.repair) / fired).toFixed(2) : "—"} builds per save** (header proxy)\n` +
    `- ${NEW_CLIENT.toUpperCase()} requests (minRev): p95 ${ms(val(data, `burst_latency{client:${NEW_CLIENT}}`, "p(95)"))}, errors ${pct(val(data, `burst_errors{client:${NEW_CLIENT}}`, "rate"), 3)}, ` +
    `rev ≥ minRev ${pct(val(data, "burst_rev_ok", "rate"), 1)}\n` +
    hintLines +
    `- old-build requests (no minRev): p95 ${ms(val(data, "burst_latency{client:old}", "p(95)"))}, errors ${pct(val(data, "burst_errors{client:old}", "rate"), 3)}, ` +
    `post-save rev on 1st request ${pct(val(data, "burst_fresh{client:old,wave:1}", "rate"), 1)}, on the repeat ${pct(val(data, "burst_fresh{client:old,wave:2}", "rate"), 1)}\n` +
    "\n#### Burst error bodies (distinct, first " + ERROR_BODY_CHARS + " chars, ≤ " + ERROR_BODIES_PER_BURST + " per burst)\n\n" +
    (Object.keys(errBodies).length
      ? PLAN.bursts
          .filter((b) => errBodies[b.id])
          .map((b) => `- ${b.id} (${b.label}): ` + errBodies[b.id].map((e) => `${e.n}× \`${e.body.replace(/`/g, "'")}\``).join("; "))
          .join("\n") + "\n"
      : "none\n") +
    "\n### Admin by window\n\n| Window | writes | save+reload p95 | visible first | lost |\n|---|---|---|---|---|\n" +
    ["steady", "burst"]
      .map(
        (w) =>
          `| ${w} | ${cnt(data, `admin_writes{window:${w}}`)} | ${ms(val(data, `admin_save_reload{window:${w}}`, "p(95)"))} | ` +
          `${pct(val(data, `admin_visible_first{window:${w}}`, "rate"), 1)} | ${pct(val(data, `admin_lost_edit{window:${w}}`, "rate"), 1)} |`,
      )
      .join("\n") +
    "\n\n### Reactions\n\n" +
    `- POST: ${rxPostN}, p50 ${ms(val(data, "reaction_latency{op:post}", "med"))} / p95 ${ms(val(data, "reaction_latency{op:post}", "p(95)"))} / ` +
    `max ${ms(val(data, "reaction_latency{op:post}", "max"))}, errors ${pct(val(data, "reaction_errors{op:post}", "rate"), 3)}\n` +
    `- DELETE: ${rxDelN}, p50 ${ms(val(data, "reaction_latency{op:delete}", "med"))} / p95 ${ms(val(data, "reaction_latency{op:delete}", "p(95)"))} / ` +
    `max ${ms(val(data, "reaction_latency{op:delete}", "max"))}, errors ${pct(val(data, "reaction_errors{op:delete}", "rate"), 3)}\n` +
    `- ackAt − request start (server clock): min ${ms(val(data, "reaction_ack_lead", "min"))}, p50 ${ms(val(data, "reaction_ack_lead", "med"))}, ` +
    `max ${ms(val(data, "reaction_ack_lead", "max"))}\n` +
    "\nPooler client peak: from the `pooler-clients.mjs` CSV next to this file (Supabase metrics when the service-role key " +
    "is set; its transaction-pooler probe records EMAXCONN either way) and the per-5 s pool sum in `vercel-logs-summary.mjs`. " +
    "`pg_stat_activity` backends are Supavisor's server side, not the client count.\n";

  const base = `${resultsDir()}/${stamp()}-viewers`;
  return {
    stdout: md,
    [`${base}.md`]: md,
    [`${base}.json`]: JSON.stringify({ plan: PLAN, setup: sd, metrics: data.metrics }, null, 2),
  };
}
