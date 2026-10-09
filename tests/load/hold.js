// n12 hold: the show-night mix at the highest rate that passed the ramp.
//
//   snapshot polling   90 % of HOLD_RPS   (/api/setlist, 70/20/10 locale)
//   SSR event page     10 % of HOLD_RPS   (/ja/events/<id>/<slug>)
//   admin writes       1 operator, ADMIN_CYCLES × 6 timed saves
//   edit bursts        BURST_SIZES snapshots in 5 s each, fired inside
//                      the last ~70 s of the hold — on top of the
//                      polling load, which is when a real save lands
//
//   k6 run -e BASE_URL=... -e EVENT_ID=... -e EVENT_SLUG=... \
//          -e EXPECTED_ROWS=... -e ROW_SLACK=2 -e ADMIN_PASSWORD=... \
//          -e HOLD_RPS=100 -e HOLD_SECONDS=600 tests/load/hold.js
//
// ROW_SLACK=2 because the admin loop briefly adds up to two rows; see
// lib/config.js.

import { getSnapshot, getEventPage, requireEnv, GATES } from "./lib/config.js";
import { stageRows, markdownTable, adminSection, resultsDir, stamp } from "./lib/report.js";
import { adminCycle, adminScenario, adminThresholds } from "./admin-writes.js";
import { burst, burstStages, burstScenarios, BURST_SECONDS } from "./edit-burst.js";

export { adminCycle, burst };

requireEnv("EVENT_ID");
requireEnv("EVENT_SLUG");
requireEnv("ADMIN_PASSWORD");

const HOLD_RPS = parseInt(requireEnv("HOLD_RPS"), 10);
const HOLD_SECONDS = parseInt(__ENV.HOLD_SECONDS || "600", 10);
// SSR first so the two always add up to HOLD_RPS (rounding 90 % of a
// small rate separately would offer more than was asked for).
const SSR_RPS = Math.max(1, Math.round(HOLD_RPS * 0.1));
const SNAP_RPS = HOLD_RPS - SSR_RPS;

const bursts = burstStages(Math.max(0, HOLD_SECONDS - (BURST_SECONDS + 30) * 2));
const burstCfg = burstScenarios(bursts);

const holdStage = { scenario: "hold", targetRps: SNAP_RPS, seconds: HOLD_SECONDS };

export const options = {
  scenarios: {
    hold: {
      executor: "constant-arrival-rate",
      rate: SNAP_RPS,
      timeUnit: "1s",
      duration: `${HOLD_SECONDS}s`,
      preAllocatedVUs: Math.max(10, SNAP_RPS),
      maxVUs: SNAP_RPS * 6,
      exec: "snapshot",
    },
    ssr: {
      executor: "constant-arrival-rate",
      rate: SSR_RPS,
      timeUnit: "1s",
      duration: `${HOLD_SECONDS}s`,
      preAllocatedVUs: Math.max(10, SSR_RPS * 2),
      maxVUs: SSR_RPS * 10,
      exec: "ssr",
    },
    // 30 s in, so the first save lands on a warmed-up server.
    admin: adminScenario("30s"),
    ...burstCfg.scenarios,
  },
  thresholds: {
    "http_req_duration{scenario:hold}": [
      `p(95)<=${GATES.passP95}`,
      `p(99)<=${GATES.passP99}`,
      { threshold: `p(95)<${GATES.abortP95}`, abortOnFail: true, delayAbortEval: "30s" },
    ],
    "snapshot_errors{scenario:hold}": [
      `rate<=${GATES.passErrorRate}`,
      { threshold: `rate<${GATES.abortErrorRate}`, abortOnFail: true, delayAbortEval: "30s" },
    ],
    "snapshot_bad_body{scenario:hold}": [`rate<=${GATES.passBadBodyRate}`],
    "http_reqs{scenario:hold}": ["count>=0"],
    "dropped_iterations{scenario:hold}": ["count>=0"],
    "http_req_duration{scenario:ssr}": [`p(95)<=${GATES.passP95 * 2}`],
    ssr_errors: [`rate<=${GATES.passErrorRate}`],
    "http_reqs{scenario:ssr}": ["count>=0"],
    ...adminThresholds,
    ...burstCfg.thresholds,
  },
  summaryTrendStats: ["avg", "min", "med", "p(90)", "p(95)", "p(99)", "max"],
};

export function snapshot() {
  getSnapshot();
}

export function ssr() {
  getEventPage();
}

export function handleSummary(data) {
  const ssrDur = data.metrics["http_req_duration{scenario:ssr}"];
  const ssrReqs = data.metrics["http_reqs{scenario:ssr}"];
  const ssrErr = data.metrics.ssr_errors;
  const md =
    `## Hold — ${new Date().toISOString()}\n\n` +
    `BASE_URL=${__ENV.BASE_URL || "http://localhost:3000"} EVENT_ID=${__ENV.EVENT_ID} ` +
    `HOLD_RPS=${HOLD_RPS} (snapshot ${SNAP_RPS} + SSR ${SSR_RPS}) for ${HOLD_SECONDS}s\n\n` +
    "### Snapshot polling + edit bursts\n\n" +
    markdownTable(stageRows(data, [holdStage, ...bursts])) +
    "\n### SSR event page\n\n" +
    `- achieved ${ssrReqs ? (ssrReqs.values.count / HOLD_SECONDS).toFixed(1) : "—"} rps of ${SSR_RPS}\n` +
    `- p95 ${ssrDur ? Math.round(ssrDur.values["p(95)"]) : "—"} ms, p99 ${ssrDur ? Math.round(ssrDur.values["p(99)"]) : "—"} ms\n` +
    `- errors ${ssrErr ? (ssrErr.values.rate * 100).toFixed(3) : "—"} %\n` +
    adminSection(data) +
    "\nPooler peak / limit: read from the Supabase dashboard + pg-connections CSV (not visible to k6).\n";
  const base = `${resultsDir()}/${stamp()}-hold`;
  return {
    stdout: md,
    [`${base}.md`]: md,
    [`${base}.json`]: JSON.stringify(data.metrics, null, 2),
  };
}
