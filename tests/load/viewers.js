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
//
// The notification burst (one per save in a burst cycle and at cold
// start): BURST_SIZE requests, each fired at U(0, JITTER_MS) after the
// save returned — the R1 scheduler's jitter on a postgres_changes
// notification. Each asks for `?minRev=<appliedRev + 1>` (appliedRev =
// the `rev` of the last snapshot the admin VU saw before the save), the
// value `SnapshotAcceptance.notificationMinRev()` sends. OLD_SHARE of
// them model pre-R1 tabs still open from before the deploy: no
// `minRev`, and OLD_REPEATS more requests OLD_REPEAT_MS apart (a v0.18
// tab refetches once per change event: k+1 times).
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
// What "builds per save" means here: we have no Vercel log access, so
// the `x-snapshot-source` header (build | cache | repair) is the proxy.
// It is a LOWER bound: a background stale-while-revalidate rebuild is
// never attributed to a response, and a build whose response went to a
// request outside this run (another agent, a real browser) is not seen.
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
  GATES,
} from "./lib/config.js";
import { resultsDir, stamp } from "./lib/report.js";
import { NOTE, ANON_PREFIX } from "./lib/constants.js";
import {
  adminSaveReload,
  adminWriteLatency,
  adminVisibleFirst,
  adminLostEdit,
  adminWrites,
} from "./admin-writes.js";

requireEnv("EVENT_ID");
requireEnv("EVENT_SLUG");
requireEnv("ADMIN_PASSWORD");

// ── knobs ─────────────────────────────────────────────────────────
const num = (name, def) => (__ENV[name] != null && __ENV[name] !== "" ? parseFloat(__ENV[name]) : def);

const POLL_RPS = num("POLL_RPS", 25);
const SSR_RPS = num("SSR_RPS", POLL_RPS * 0.1);
const STEADY_START = num("STEADY_START", 15);
const STEADY_SECONDS = num("STEADY_SECONDS", 600);
const ADMIN_CYCLES = num("ADMIN_CYCLES", 6);
const QUIET_CYCLES = num("QUIET_CYCLES", 2);
const ADMIN_FIRST = num("ADMIN_FIRST", 40);
const ADMIN_SPACING = num("ADMIN_SPACING", 70);
const SAVE_GAP = num("SAVE_GAP", 4);
const BURST_SIZE = num("BURST_SIZE", 500);
const JITTER_MS = num("JITTER_MS", 500);
const OLD_SHARE = num("OLD_SHARE", 0.2);
const OLD_REPEATS = num("OLD_REPEATS", 1);
const OLD_REPEAT_MS = num("OLD_REPEAT_MS", 1000);
const COLD_START = (__ENV.COLD_START || "1") !== "0";
const REACTIONS = num("REACTIONS", 500);
const REACTION_SECONDS = num("REACTION_SECONDS", 10);
const REACTION_AT = num("REACTION_AT", 440);
const ABORT_ERR_RATE = num("ABORT_ERR_RATE", GATES.abortErrorRate);
const ABORT_P95_MS = num("ABORT_P95_MS", GATES.abortP95);
const ACCEPT_ENCODING = __ENV.ACCEPT_ENCODING ?? "gzip, deflate, br";
const BURST_GATE_P95 = num("BURST_GATE_P95", 3000);
const POOLER_GATE = num("POOLER_GATE", 140);

// Each admin cycle briefly adds two rows (cold start: one), and the
// admin VU runs them strictly one after another, so a correct snapshot
// has between EXPECTED_ROWS and EXPECTED_ROWS + 2 rows. ROW_SLACK below
// 2 would count our own rows as bad bodies.
if (EXPECTED_ROWS != null && ROW_SLACK < 2) {
  throw new Error("viewers.js adds up to 2 rows at a time: set ROW_SLACK=2 (or more) with EXPECTED_ROWS");
}

const COOKIE_NAME = "admin_session"; // src/lib/admin-session.ts
const REACTION_TYPES = ["waiting", "best", "surprise", "moved"]; // VALID_TYPES in the route
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
  const c = { n: i + 1, kind, at: ADMIN_FIRST + i * ADMIN_SPACING, bursts: [] };
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
  other: new Counter("snap_src_other"),
};
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
  "burst_latency{client:r1}": ["max>=0"],
  "burst_latency{client:old}": ["max>=0"],
  "burst_errors{client:r1}": ["rate>=0"],
  "burst_errors{client:old}": ["rate>=0"],
  "burst_fresh{client:old,wave:1}": ["rate>=0"],
  "burst_fresh{client:old,wave:2}": ["rate>=0"],
  burst_rev_ok: ["rate>=0"],
};
for (const phase of ["poll", "burst"]) {
  for (const s of Object.keys(SRC)) thresholds[`snap_src_${s}{phase:${phase}}`] = ["count>=0"];
}
for (const b of PLAN.bursts) {
  thresholds[`burst_latency{burst:${b.id}}`] = ["max>=0"];
  thresholds[`burst_errors{burst:${b.id}}`] = ["rate>=0"];
  thresholds[`burst_rev_ok{burst:${b.id}}`] = ["rate>=0"];
  for (const s of Object.keys(SRC)) thresholds[`snap_src_${s}{burst:${b.id}}`] = ["count>=0"];
}

export const options = {
  scenarios,
  thresholds,
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

function withMinRev(url, minRev) {
  return minRev == null ? url : `${url}&minRev=${minRev}`;
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
  return v === "build" || v === "cache" || v === "repair" ? v : "other";
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

// One burst request. `appliedRev` is the pre-save revision; a response
// at > appliedRev carries the save.
async function burstRequest(burstId, minRev, client, wave, appliedRev) {
  const locale = pickLocale();
  const tags = { name: "snapshot", phase: "burst", burst: burstId, client, wave: String(wave), locale };
  const res = await http.asyncRequest("GET", withMinRev(snapshotUrl(locale), minRev), null, {
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
  return { ok: r.ok, ms: res.timings.duration };
}

// Fires the whole burst and returns a promise of its summary. Request
// i starts at U(0, JITTER_MS) after the call; old-build tabs repeat.
function fireBurst(burstId, appliedRev) {
  burstsFired.add(1);
  const minRev = appliedRev == null ? null : appliedRev + 1;
  const all = [];
  for (let i = 0; i < BURST_SIZE; i++) {
    const at = Math.random() * JITTER_MS;
    const old = Math.random() < OLD_SHARE;
    all.push(delay(at).then(() => burstRequest(burstId, old ? null : minRev, old ? "old" : "r1", 1, appliedRev)));
    if (old) {
      for (let k = 1; k <= OLD_REPEATS; k++) {
        all.push(delay(at + k * OLD_REPEAT_MS).then(() => burstRequest(burstId, null, "old", k + 1, appliedRev)));
      }
    }
  }
  return Promise.all(all).then((rs) => {
    const ms = rs.map((r) => r.ms).sort((a, b) => a - b);
    const errors = rs.filter((r) => !r.ok).length;
    const p95 = ms.length ? ms[Math.min(ms.length - 1, Math.ceil(0.95 * ms.length) - 1)] : 0;
    return { n: rs.length, errors, p95, max: ms.length ? ms[ms.length - 1] : 0 };
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
  const burstP = okWrite && burstId ? fireBurst(burstId, appliedRev) : null;
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
        `[burst ${burstId}] ${label} appliedRev=${appliedRev} n=${b.n} errors=${b.errors} p95=${Math.round(b.p95)}ms max=${Math.round(b.max)}ms`,
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
  exec.test.abort(
    `${e.message} — stop and reconcile the event` + (leftover.length ? ` (rows NOT cleaned up: ${leftover.join(", ")})` : ""),
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
    for (const c of PLAN.cycles) {
      const wait = c.at - elapsedS();
      if (wait > 0) await delay(wait * 1000);
      else console.warn(`[admin] cycle ${c.n} starts ${(-wait).toFixed(1)}s late (previous cycle overran its slot)`);
      console.log(`[admin] cycle ${c.n} (${c.kind}) at ${elapsedS().toFixed(1)}s`);
      await cycle(c.kind === "burst" ? "burst" : "steady", c.kind === "burst" ? c.bursts : null);
    }
    // Final reconciliation read: the event must be back at its baseline.
    await delay(3000);
    const { body } = await readSnapshot({ window: "cleanup" });
    if (body) finalRows.add(body.items.length);
  } catch (e) {
    await cleanupAndAbort(e);
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

function srcCells(data, sel) {
  const n = {};
  let total = 0;
  for (const s of Object.keys(SRC)) {
    n[s] = cnt(data, `snap_src_${s}{${sel}}`);
    total += n[s];
  }
  return { ...n, total };
}

export function handleSummary(data) {
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
    rows.push(
      `| ${b.id} | ${b.label} | ${n ?? 0} | ${ms(val(data, `burst_latency{burst:${b.id}}`, "med"))} / ${ms(p95)} / ` +
        `${ms(val(data, `burst_latency{burst:${b.id}}`, "max"))} | ${pct(val(data, `burst_errors{burst:${b.id}}`, "rate"))} | ` +
        `${s.build} / ${s.cache} / ${s.repair}${s.other ? ` (+${s.other} other)` : ""} | ${s.build + s.repair} | ` +
        `${pct(val(data, `burst_rev_ok{burst:${b.id}}`, "rate"), 1)} |`,
    );
  }
  const fired = cnt(data, "bursts_fired");
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
    `| pooler client peak (Supabase dashboard) | ___ / 200 | ≤ ${POOLER_GATE} | _orchestrator_ |`,
  ];

  const plan =
    `- cold start: ${COLD_START ? "1 save + burst b00 at t=0" : "off"}; steady ${STEADY_START}s → ${STEADY_START + STEADY_SECONDS}s ` +
    `(poll ${POLL_RPS} rps + SSR ${SSR_RPS} rps)\n` +
    `- admin cycles (SAVE_GAP ${SAVE_GAP}s): ${PLAN.cycles.map((c) => `c${c.n} ${c.kind} @${c.at}s`).join(", ")}\n` +
    `- bursts: ${BURST_SIZE} req over U(0, ${JITTER_MS} ms), old-build share ${OLD_SHARE * 100} % ×${OLD_REPEATS + 1} (repeat +${OLD_REPEAT_MS} ms)\n` +
    `- reactions: ${REACTIONS} POST+DELETE over ${REACTION_SECONDS}s @${REACTION_AT}s\n` +
    `- setup: start rev ${sd.startRev ?? "—"}, clock offset ${sd.clockOffsetMs != null ? Math.round(sd.clockOffsetMs) : "—"} ms ` +
    `(±${sd.clockErrMs != null ? Math.round(sd.clockErrMs) : "—"} ms), run ${runS != null ? Math.round(runS) : "—"}s\n`;

  const md =
    `## Viewers (500-viewer model) — ${new Date().toISOString()}\n\n` +
    `BASE_URL=${BASE_URL} EVENT_ID=${EVENT_ID} EXPECTED_ROWS=${EXPECTED_ROWS ?? "—"} ROW_SLACK=${ROW_SLACK} ` +
    `BODY_SAMPLE_RATE=${BODY_SAMPLE_RATE}\n\n` +
    plan +
    "\n### Gates\n\n| Gate | measured | gate | verdict |\n|---|---|---|---|\n" +
    gates.join("\n") +
    "\n\n### Steady streams\n\n" +
    `- poll: ${pollN} req, achieved ${pollAchieved.toFixed(1)} rps, p50 ${ms(val(data, "http_req_duration{scenario:poll}", "med"))} / ` +
    `p95 ${ms(val(data, "http_req_duration{scenario:poll}", "p(95)"))} / p99 ${ms(val(data, "http_req_duration{scenario:poll}", "p(99)"))}, ` +
    `errors ${pct(val(data, "snapshot_errors{scenario:poll}", "rate"), 3)}; ` +
    `source build/cache/repair ${pollSrc.build} / ${pollSrc.cache} / ${pollSrc.repair}${pollSrc.other ? ` (+${pollSrc.other} other)` : ""}\n` +
    `- SSR event page: ${ssrN} req, achieved ${(STEADY_SECONDS > 0 ? ssrN / STEADY_SECONDS : 0).toFixed(2)} rps, ` +
    `p95 ${ms(val(data, "http_req_duration{scenario:ssr}", "p(95)"))} / p99 ${ms(val(data, "http_req_duration{scenario:ssr}", "p(99)"))}, ` +
    `errors ${pct(val(data, "ssr_errors", "rate"), 3)}\n` +
    "\n### Notification bursts\n\n" +
    "`x-snapshot-source` is our proxy for builds per save (no Vercel log access). It is a **lower bound**: a background " +
    "stale-while-revalidate rebuild is never attributed to a response, and builds whose response went to someone else are not seen. " +
    "Count the `[liveSnapshot] build` log lines in Vercel for the real number when log access exists.\n\n" +
    "| Burst | save | requests | p50 / p95 / max | err % | build / cache / repair | builds (build+repair) | rev ≥ minRev (R1 reqs) |\n" +
    "|---|---|---|---|---|---|---|---|\n" +
    rows.join("\n") +
    "\n\n" +
    `- all bursts: ${burstSrc.total} req; build ${burstSrc.build}, cache ${burstSrc.cache}, repair ${burstSrc.repair}` +
    `${burstSrc.other ? `, other ${burstSrc.other}` : ""} → **${fired ? ((burstSrc.build + burstSrc.repair) / fired).toFixed(2) : "—"} builds per save** (header proxy)\n` +
    `- R1 requests (minRev): p95 ${ms(val(data, "burst_latency{client:r1}", "p(95)"))}, errors ${pct(val(data, "burst_errors{client:r1}", "rate"), 3)}, ` +
    `rev ≥ minRev ${pct(val(data, "burst_rev_ok", "rate"), 1)}\n` +
    `- old-build requests (no minRev): p95 ${ms(val(data, "burst_latency{client:old}", "p(95)"))}, errors ${pct(val(data, "burst_errors{client:old}", "rate"), 3)}, ` +
    `post-save rev on 1st request ${pct(val(data, "burst_fresh{client:old,wave:1}", "rate"), 1)}, on the repeat ${pct(val(data, "burst_fresh{client:old,wave:2}", "rate"), 1)}\n` +
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
    "\nPooler client peak: read it off the Supabase dashboard (Database → Connections / Reports) for the run window; " +
    "the `pg-connections.mjs` CSV next to this file counts Postgres backends, which Supavisor multiplexes.\n";

  const base = `${resultsDir()}/${stamp()}-viewers`;
  return {
    stdout: md,
    [`${base}.md`]: md,
    [`${base}.json`]: JSON.stringify({ plan: PLAN, setup: sd, metrics: data.metrics }, null, 2),
  };
}
