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
// completed-request count over the stage's nominal duration.
//
// Verdicts, in order of precedence:
//   GEN-LIMIT  k6 dropped iterations (ran out of VUs). The stage did not
//              offer the load it claims, so it is not a capacity result
//              whatever its latency was — fix the generator (more VUs /
//              a bigger machine) and re-run. Never a HOLD_RPS candidate,
//              even if achieved rps still clears 95 %: the requests that
//              were never sent are exactly the ones a slow server would
//              have failed.
//   FAIL       any gate missed; `why` lists which.
//   PASS       every gate met, including ≥ 1 sampled body checked.
export function stageRows(data, stages) {
  // When a run aborts, a stage's nominal duration overstates how long it
  // actually ran, and count/nominal would report a healthy-but-cut-short
  // stage as "achieved 20 %". Divide by the time the stage really had.
  const runSeconds = data.state ? data.state.testRunDurationMs / 1000 : Infinity;
  return stages.map(({ scenario, targetRps, seconds, startSeconds = 0 }) => {
    const reqs = sub(data, "http_reqs", scenario);
    const dur = sub(data, "http_req_duration", scenario);
    const errs = sub(data, "snapshot_errors", scenario);
    const bad = sub(data, "snapshot_bad_body", scenario);
    const droppedM = sub(data, "dropped_iterations", scenario);
    const count = reqs ? reqs.values.count : 0;
    const ranSeconds = Math.max(0, Math.min(seconds, runSeconds - startSeconds));
    const cutShort = ranSeconds < seconds - 1;
    const achieved = ranSeconds > 0 ? count / ranSeconds : 0;
    const dropped = droppedM ? droppedM.values.count : 0;
    const p95 = dur ? dur.values["p(95)"] : null;
    const p99 = dur ? dur.values["p(99)"] : null;
    const errRate = errs ? errs.values.rate : null;
    // Rate metrics report `passes` = samples that were true (here: a bad
    // body) and `fails` = false (a good body).
    const badCount = bad ? bad.values.passes : 0;
    const sampled = bad ? bad.values.passes + bad.values.fails : 0;
    const ran = count > 0;

    const why = [];
    if (achieved < targetRps * GATES.achievedRatio) why.push("achieved < 95 %");
    if (p95 == null || p95 > GATES.passP95) why.push("p95");
    if (p99 == null || p99 > GATES.passP99) why.push("p99");
    if (errRate == null || errRate > GATES.passErrorRate) why.push("http errors");
    if (sampled === 0) why.push("no body sampled");
    else if (badCount / sampled > GATES.passBadBodyRate) why.push("bad bodies");

    let verdict;
    if (!ran) verdict = "not run (aborted earlier)";
    else if (dropped > 0) verdict = "GEN-LIMIT";
    else verdict = why.length === 0 ? "PASS" : `FAIL (${why.join(", ")})`;
    // A stage the run cut off never proved it can hold its rate for the
    // full window, whatever its numbers looked like until then.
    if (ran && cutShort && verdict === "PASS") verdict = `CUT SHORT (${Math.round(ranSeconds)}s of ${seconds}s)`;
    else if (ran && cutShort) verdict += ` · cut short at ${Math.round(ranSeconds)}s`;

    return {
      scenario,
      targetRps,
      achievedRps: Math.round(achieved * 10) / 10,
      requests: count,
      dropped,
      p95,
      p99,
      errRate,
      badBodies: badCount,
      sampledBodies: sampled,
      verdict,
    };
  });
}

export function markdownTable(rows) {
  const head =
    "| Stage | target rps | achieved rps | requests | dropped | p95 / p99 | http err % | bad bodies / sampled | Verdict |\n" +
    "|---|---|---|---|---|---|---|---|---|\n";
  return (
    head +
    rows
      .map(
        (r) =>
          `| ${r.scenario} | ${r.targetRps} | ${r.achievedRps} | ${r.requests} | ${r.dropped} | ` +
          `${fmtMs(r.p95)} / ${fmtMs(r.p99)} | ` +
          `${r.errRate == null ? "—" : (r.errRate * 100).toFixed(3)} | ` +
          `${r.badBodies} / ${r.sampledBodies} | ${r.verdict} |`,
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

// Per-window admin verdicts: the steady `admin` scenario and each
// burst-window cycle. A write that fails or never becomes visible
// aborts the run, so a window that shows "not run" after an abort is
// itself a finding — read the abort message.
export function adminWindowTable(data, scenarios) {
  const rows = scenarios.map((sc) => {
    const lat = sub(data, "admin_save_reload", sc);
    const vis = sub(data, "admin_visible_first", sc);
    const lost = sub(data, "admin_lost_edit", sc);
    const writes = sub(data, "admin_writes", sc);
    const n = writes ? writes.values.count : 0;
    if (!lat || n === 0) return `| ${sc} | 0 | — | — | — | not run |`;
    const p95 = lat.values["p(95)"];
    const visRate = vis ? vis.values.rate : null;
    const lostRate = lost ? lost.values.rate : null;
    const pass = p95 <= GATES.adminP95 && visRate === 1 && (lostRate == null || lostRate === 0);
    return (
      `| ${sc} | ${n} | ${fmtMs(p95)} | ${visRate == null ? "—" : (visRate * 100).toFixed(1) + " %"} | ` +
      `${lostRate == null ? "—" : (lostRate * 100).toFixed(1) + " %"} | ${pass ? "PASS" : "FAIL"} |`
    );
  });
  return (
    "\n### Admin by window\n\n" +
    "| Window | writes | save+reload p95 | visible first | lost | Verdict |\n" +
    "|---|---|---|---|---|---|\n" +
    rows.join("\n") +
    "\n"
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
