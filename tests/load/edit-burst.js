// n12 edit burst: what one operator save does to the server while
// Realtime is healthy.
//
// Every Realtime subscriber refetches the full snapshot after each
// setlist push (`useRealtimeEventChannel` → `fetchSnapshot`, Path B),
// so one save fans out to N near-simultaneous /api/setlist requests.
// Modelled as N requests spread evenly over 5 s (open model): 500,
// then — after a 30 s gap so the two don't overlap — 2,000.
//
// Standalone: k6 run -e BASE_URL=... -e EVENT_ID=... tests/load/edit-burst.js
// Also imported by hold.js, which fires the bursts after the hold.
// BURST_SIZES="500,2000" overrides the sizes.

import { getSnapshot, requireEnv, GATES } from "./lib/config.js";
import { stageRows, markdownTable, resultsDir, stamp } from "./lib/report.js";

export const BURST_SECONDS = 5;
export const BURST_SIZES = (__ENV.BURST_SIZES || "500,2000")
  .split(",")
  .map((s) => parseInt(s.trim(), 10))
  .filter((n) => n > 0);

// Bursts start at `offsetSeconds`, each 35 s after the previous one.
export function burstStages(offsetSeconds = 0) {
  return BURST_SIZES.map((n, i) => ({
    scenario: `burst${n}`,
    size: n,
    targetRps: n / BURST_SECONDS,
    seconds: BURST_SECONDS,
    startSeconds: offsetSeconds + i * (BURST_SECONDS + 30),
  }));
}

export function burstScenarios(stages) {
  const scenarios = {};
  const thresholds = {};
  for (const s of stages) {
    scenarios[s.scenario] = {
      executor: "constant-arrival-rate",
      rate: s.targetRps,
      timeUnit: "1s",
      duration: `${s.seconds}s`,
      startTime: `${s.startSeconds}s`,
      // A burst is short, so allocate up front rather than letting k6
      // spin VUs up mid-burst (which itself delays arrivals).
      preAllocatedVUs: Math.min(s.size, 1000),
      maxVUs: s.size,
      exec: "burst",
      tags: { stage: s.scenario },
      gracefulStop: "30s",
    };
    // Report-only: a burst is a spike, so it never aborts the run.
    thresholds[`http_req_duration{scenario:${s.scenario}}`] = [
      `p(95)<=${GATES.passP95}`,
      `p(99)<=${GATES.passP99}`,
    ];
    thresholds[`snapshot_errors{scenario:${s.scenario}}`] = [`rate<=${GATES.passErrorRate}`];
    thresholds[`http_reqs{scenario:${s.scenario}}`] = ["count>=0"];
    thresholds[`dropped_iterations{scenario:${s.scenario}}`] = ["count>=0"];
  }
  return { scenarios, thresholds };
}

export function burst() {
  getSnapshot();
}

// ── standalone entry ──────────────────────────────────────────────
requireEnv("EVENT_ID");
const stages = burstStages(0);
const { scenarios, thresholds } = burstScenarios(stages);

export const options = {
  scenarios,
  thresholds,
  summaryTrendStats: ["avg", "min", "med", "p(90)", "p(95)", "p(99)", "max"],
};

export function handleSummary(data) {
  const md = `## Edit burst — ${new Date().toISOString()}\n\n` + markdownTable(stageRows(data, stages));
  const base = `${resultsDir()}/${stamp()}-burst`;
  return { stdout: md, [`${base}.md`]: md };
}
