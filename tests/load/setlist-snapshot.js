// n12 ramp: open-model load on GET /api/setlist, 20 → 50 → 100 → 200 rps.
//
// Why open model (constant-arrival-rate) and not a VU loop: a closed
// loop of N "viewers" slows down when the server slows down, so it
// quietly offers *less* load exactly when the server is struggling and
// the run under-reports the problem. Real pollers don't back off — the
// 5 s interval fires regardless of how long the last request took — so
// arrival rate is the honest model. Each stage is its own scenario so
// the gates and the achieved-rps check apply per stage.
//
// Abort behaviour: k6 thresholds are cumulative over a scenario, not
// sliding windows, so "p95 ≥ 5 s for 30 s" is approximated as "the
// stage's cumulative p95 crosses 5 s, evaluated after a 30 s grace".
// Same for the 2 % error abort. Aborting stops the whole run, which is
// the intent: a later stage only offers more load.
//
//   k6 run -e BASE_URL=... -e EVENT_ID=... -e EXPECTED_ROWS=... \
//          tests/load/setlist-snapshot.js
//
// STAGE_SECONDS (default 120) and MAX_RPS (default 200) shorten or cap
// the ramp for a smoke run.

import { getSnapshot, requireEnv, GATES } from "./lib/config.js";
import { stageRows, markdownTable, resultsDir, stamp } from "./lib/report.js";

requireEnv("EVENT_ID");

const STAGE_SECONDS = parseInt(__ENV.STAGE_SECONDS || "120", 10);
const MAX_RPS = parseInt(__ENV.MAX_RPS || "200", 10);
const RATES = [20, 50, 100, 200].filter((r) => r <= MAX_RPS);

const stages = RATES.map((rps, i) => ({
  scenario: `s${String(rps).padStart(3, "0")}`,
  targetRps: rps,
  seconds: STAGE_SECONDS,
  startSeconds: i * STAGE_SECONDS,
}));

const scenarios = {};
const thresholds = {};
for (const s of stages) {
  scenarios[s.scenario] = {
    executor: "constant-arrival-rate",
    rate: s.targetRps,
    timeUnit: "1s",
    duration: `${s.seconds}s`,
    startTime: `${s.startSeconds}s`,
    // preAllocated ≈ rps × expected latency (s) with headroom; max
    // covers a server that has slowed to ~5 s responses. If k6 still
    // runs out it records dropped_iterations, which the report shows.
    preAllocatedVUs: Math.max(10, s.targetRps),
    maxVUs: s.targetRps * 6,
    exec: "snapshot",
    tags: { stage: s.scenario },
  };
  // Pass gates (reported; don't stop the run).
  thresholds[`http_req_duration{scenario:${s.scenario}}`] = [
    `p(95)<=${GATES.passP95}`,
    `p(99)<=${GATES.passP99}`,
    // Abort gate.
    { threshold: `p(95)<${GATES.abortP95}`, abortOnFail: true, delayAbortEval: "30s" },
  ];
  thresholds[`snapshot_errors{scenario:${s.scenario}}`] = [
    `rate<=${GATES.passErrorRate}`,
    { threshold: `rate<${GATES.abortErrorRate}`, abortOnFail: true, delayAbortEval: "30s" },
  ];
  // Placeholders so the per-stage submetrics exist in handleSummary.
  thresholds[`http_reqs{scenario:${s.scenario}}`] = ["count>=0"];
  thresholds[`dropped_iterations{scenario:${s.scenario}}`] = ["count>=0"];
}

export const options = {
  scenarios,
  thresholds,
  // p(99) isn't in k6's default trend stats.
  summaryTrendStats: ["avg", "min", "med", "p(90)", "p(95)", "p(99)", "max"],
};

export function snapshot() {
  getSnapshot();
}

export function handleSummary(data) {
  const rows = stageRows(data, stages);
  const md =
    `## Ramp — ${new Date().toISOString()}\n\n` +
    `BASE_URL=${__ENV.BASE_URL || "http://localhost:3000"} EVENT_ID=${__ENV.EVENT_ID} ` +
    `stage=${STAGE_SECONDS}s\n\n` +
    markdownTable(rows) +
    "\nHighest passing rate → use as HOLD_RPS for the hold run.\n";
  const base = `${resultsDir()}/${stamp()}-ramp`;
  return {
    stdout: md,
    [`${base}.md`]: md,
    [`${base}.json`]: JSON.stringify({ rows, metrics: data.metrics }, null, 2),
  };
}
