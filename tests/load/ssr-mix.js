// n12 SSR mix: people opening the ongoing event page from an X link.
//
// While an event is `ongoing` the page skips its data cache, so every
// open is a full server render with its own DB reads — a different
// cost profile from the polled snapshot. In the hold run this is 10 %
// of the offered rate (see hold.js); standalone it runs at SSR_RPS
// (default 10) for SSR_SECONDS (default 120) to size the page alone.
//
//   k6 run -e BASE_URL=... -e EVENT_ID=... -e EVENT_SLUG=... tests/load/ssr-mix.js

import { getEventPage, requireEnv, GATES } from "./lib/config.js";
import { resultsDir, stamp } from "./lib/report.js";

export function ssr() {
  getEventPage();
}

requireEnv("EVENT_ID");
requireEnv("EVENT_SLUG");

const RPS = parseInt(__ENV.SSR_RPS || "10", 10);
const SECONDS = parseInt(__ENV.SSR_SECONDS || "120", 10);

export const options = {
  scenarios: {
    ssr: {
      executor: "constant-arrival-rate",
      rate: RPS,
      timeUnit: "1s",
      duration: `${SECONDS}s`,
      preAllocatedVUs: Math.max(10, RPS * 2),
      maxVUs: RPS * 10,
      exec: "ssr",
    },
  },
  thresholds: {
    "http_req_duration{scenario:ssr}": [`p(95)<=${GATES.passP95 * 2}`],
    ssr_errors: [`rate<=${GATES.passErrorRate}`],
  },
  summaryTrendStats: ["avg", "min", "med", "p(90)", "p(95)", "p(99)", "max"],
};

export function handleSummary(data) {
  const d = data.metrics["http_req_duration{scenario:ssr}"];
  const e = data.metrics.ssr_errors;
  const n = data.metrics.http_reqs ? data.metrics.http_reqs.values.count : 0;
  const md =
    `## SSR event page — ${new Date().toISOString()}\n\n` +
    `target ${RPS} rps, achieved ${(n / SECONDS).toFixed(1)} rps, ` +
    `p95 ${d ? Math.round(d.values["p(95)"]) : "—"} ms / p99 ${d ? Math.round(d.values["p(99)"]) : "—"} ms, ` +
    `errors ${e ? (e.values.rate * 100).toFixed(3) : "—"} %\n`;
  const base = `${resultsDir()}/${stamp()}-ssr`;
  return { stdout: md, [`${base}.md`]: md };
}
