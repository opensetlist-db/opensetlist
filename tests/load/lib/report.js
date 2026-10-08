// handleSummary helpers: turn k6's end-of-test data into the per-stage
// row the n12 Results table wants (achieved rps, p95/p99, error %),
// plus a pass/fail verdict against GATES.
//
// Per-stage numbers come from tagged submetrics. k6 only materialises a
// submetric (e.g. `http_req_duration{scenario:s050}`) in the summary
// data when a threshold references it, which is why every script
// declares thresholds for each of its scenarios — some of them are
// pure "always true" placeholders whose only job is to make the
// submetric appear here.

import { GATES } from "./config.js";

function sub(data, metric, scenario) {
  return data.metrics[`${metric}{scenario:${scenario}}`];
}

function fmtMs(v) {
  return v == null ? "—" : `${Math.round(v)} ms`;
}

// `stages` = [{ scenario, targetRps, seconds }]. Achieved rps is the
// completed-request count over the stage's nominal duration — requests
// that k6 had to drop because it ran out of VUs never reach
// http_reqs, so a generator-bound stage shows up as < 95 % here
// instead of hiding inside a healthy latency number.
export function stageRows(data, stages) {
  return stages.map(({ scenario, targetRps, seconds }) => {
    const reqs = sub(data, "http_reqs", scenario);
    const dur = sub(data, "http_req_duration", scenario);
    const errs = sub(data, "snapshot_errors", scenario);
    const dropped = sub(data, "dropped_iterations", scenario);
    const count = reqs ? reqs.values.count : 0;
    const achieved = count / seconds;
    const p95 = dur ? dur.values["p(95)"] : null;
    const p99 = dur ? dur.values["p(99)"] : null;
    const errRate = errs ? errs.values.rate : null;
    const ran = count > 0;
    const pass =
      ran &&
      achieved >= targetRps * GATES.achievedRatio &&
      p95 != null && p95 <= GATES.passP95 &&
      p99 != null && p99 <= GATES.passP99 &&
      errRate != null && errRate <= GATES.passErrorRate;
    return {
      scenario,
      targetRps,
      achievedRps: Math.round(achieved * 10) / 10,
      requests: count,
      dropped: dropped ? dropped.values.count : 0,
      p95,
      p99,
      errRate,
      verdict: !ran ? "not run (aborted earlier)" : pass ? "PASS" : "FAIL",
    };
  });
}

export function markdownTable(rows) {
  const head =
    "| Stage | target rps | achieved rps | requests | dropped | p95 / p99 | err % | Verdict |\n" +
    "|---|---|---|---|---|---|---|---|\n";
  return (
    head +
    rows
      .map(
        (r) =>
          `| ${r.scenario} | ${r.targetRps} | ${r.achievedRps} | ${r.requests} | ${r.dropped} | ` +
          `${fmtMs(r.p95)} / ${fmtMs(r.p99)} | ` +
          `${r.errRate == null ? "—" : (r.errRate * 100).toFixed(3)} | ${r.verdict} |`,
      )
      .join("\n") +
    "\n"
  );
}

// Admin save+reload block, shared by the hold run and the standalone
// admin-writes run.
export function adminSection(data) {
  const lat = data.metrics.admin_save_reload;
  const vis = data.metrics.admin_visible_first;
  const lost = data.metrics.admin_lost_edit;
  const writes = data.metrics.admin_writes;
  if (!lat) return "";
  const p95 = lat.values["p(95)"];
  const pass =
    p95 <= GATES.adminP95 &&
    (!lost || lost.values.rate === 0) &&
    (!vis || vis.values.rate === 1);
  return (
    "\n### Admin save + reload\n\n" +
    `- writes: ${writes ? writes.values.count : "?"}\n` +
    `- save+reload p95: ${fmtMs(p95)} (gate ≤ ${GATES.adminP95} ms)\n` +
    `- visible in the first snapshot after the write: ${vis ? (vis.values.rate * 100).toFixed(1) : "?"} %\n` +
    `- lost edits (never visible after retries): ${lost ? (lost.values.rate * 100).toFixed(1) : "?"} %\n` +
    `- verdict: **${pass ? "PASS" : "FAIL"}**\n`
  );
}

// `results/<YYYY-MM-DD>/` — operator copies dashboard screenshots
// into the same folder, per the spec. Date is the run's UTC date.
export function resultsDir() {
  return `tests/load/results/${new Date().toISOString().slice(0, 10)}`;
}

export function stamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}
