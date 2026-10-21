#!/usr/bin/env node
// Browser QA for public pages (artist detail, album detail, …). The harness
// (scripts/page-qa/harness.mjs) owns the browser setup, the locale × width
// layout matrix, the reduced-motion and canonical helpers, timeouts and the
// report; a scenario module per page (scripts/page-qa/scenarios/) holds
// only that page's checks. A page ticket adds a scenario instead of writing
// its own QA script (copy `artist-detail`). Admin pages have their own
// harness, scripts/admin-qa.mjs.
//
// Usage (from the root of the checkout to test, against a running
// production build — start one with scripts/serve-build.sh <port>). The
// script may also be a copy extracted from another branch (e.g. into a
// redesign worktree's .claude/tmp/, with page-qa/ beside it): the scenarios
// come from beside the script, messages/ from the checkout holding the cwd.
//   node scripts/page-qa.mjs --scenario artist-detail --out <dir>
//     [--base http://localhost:3121]
//     [--browser chromium|webkit]   default chromium
//     [--quick]                      matrix limited to ko × 390/1100/1440
//                                    (use for WebKit: a full WebKit run is
//                                    several times slower on Windows)
//     [--timeout <s>]                per Playwright action/navigation,
//                                    default 60; a section gets 4× (a layout
//                                    cell 2×) before it is recorded as a
//                                    "(timeout)" FAIL and skipped
//     [--timeout-min <min>]          whole run, default 45; past it the
//                                    results so far are written and it exits 1
//     [--fixture <json>]             fixture ids for the scenario's fixture
//                                    checks (keys: --list shows them); the
//                                    harness never writes to the DB — create
//                                    and delete the rows yourself, holding
//                                    the execution-board dev DB slot
//     [--only-fixture]               run the fixture checks alone
//     [--list]                       list the scenarios and exit
//
// --scenario takes a name under scripts/page-qa/scenarios/ or a path to a
// .mjs file.
//
// Writes, as it goes, every line to stdout AND <out>/<stem>.log, then
// <out>/<stem>.json (summary + every check), where <stem> is
// <scenario>-<browser>[-quick][-fixture] (-fixture whenever --fixture is
// given). Exits 1 on any FAIL (including a
// timeout), 2 on a usage error.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { BROWSERS, checkoutRoot, messageNamespaces, runScenario } from "./page-qa/harness.mjs";

// Scenarios ship with the script; messages/ comes from the checkout under
// test (see checkoutRoot), which differs when this script is an extracted copy.
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const scenarioDir = path.join(scriptDir, "page-qa", "scenarios");
const repoRoot = checkoutRoot(path.resolve(scriptDir, ".."));

const usage = (msg) => {
  if (msg) console.error(msg);
  console.error(
    "usage: node scripts/page-qa.mjs --scenario <name|path.mjs> --out <dir> [--base URL] [--browser chromium|webkit] [--quick] " +
      "[--timeout <s>] [--timeout-min <min>] [--fixture <json>] [--only-fixture] | --list",
  );
  process.exit(2);
};

const { values: args } = parseArgs({
  options: {
    scenario: { type: "string" },
    out: { type: "string" },
    base: { type: "string", default: "http://localhost:3121" },
    browser: { type: "string", default: "chromium" },
    quick: { type: "boolean", default: false },
    timeout: { type: "string", default: "60" },
    "timeout-min": { type: "string", default: "45" },
    fixture: { type: "string" },
    "only-fixture": { type: "boolean", default: false },
    list: { type: "boolean", default: false },
  },
});

const load = async (p) => (await import(pathToFileURL(p).href)).default;

if (args.list) {
  for (const f of fs.readdirSync(scenarioDir).filter((f) => f.endsWith(".mjs"))) {
    const s = await load(path.join(scenarioDir, f));
    const fx = s.fixture ? `  (fixture: ${s.fixture.needs.join(", ")} — ${s.fixture.about})` : "";
    console.log(`${s.name}${fx}`);
  }
  process.exit(0);
}
if (!args.scenario || !args.out) usage();
if (!BROWSERS[args.browser]) usage(`--browser must be one of: ${Object.keys(BROWSERS).join(", ")}`);

const timeoutMs = Number(args.timeout) * 1000;
const runMs = Number(args["timeout-min"]) * 60_000;
// setTimeout fires at once above 2^31 ms (~24.8 days); a day is plenty.
if (!(timeoutMs > 0) || !(runMs > 0) || timeoutMs > 86_400_000 || runMs > 86_400_000) {
  usage("--timeout and --timeout-min must be positive numbers, at most one day");
}

const scenarioPath = args.scenario.endsWith(".mjs")
  ? path.resolve(args.scenario)
  : path.join(scenarioDir, `${args.scenario}.mjs`);
if (!fs.existsSync(scenarioPath)) usage(`no scenario at ${scenarioPath} (--list shows the names)`);
const scenario = await load(scenarioPath);

let fixture = null;
if (args.fixture) {
  if (!scenario.fixture) usage(`scenario ${scenario.name} has no fixture checks`);
  try {
    fixture = JSON.parse(fs.readFileSync(args.fixture, "utf8"));
  } catch (e) {
    usage(`--fixture ${args.fixture}: ${e.message}`);
  }
  const missing = scenario.fixture.needs.filter((k) => fixture[k] == null);
  if (missing.length) usage(`--fixture ${args.fixture} lacks ${missing.join(", ")}`);
} else if (args["only-fixture"]) {
  usage("--only-fixture needs --fixture <json>");
}

// The cwd picks the checkout (see checkoutRoot): say which one, so a run
// started from the wrong directory shows it on the first line.
console.log(`checkout: ${repoRoot}`);
const summary = await runScenario({
  scenario,
  browserName: args.browser,
  quick: args.quick,
  base: args.base.replace(/\/+$/, ""),
  outDir: path.resolve(args.out),
  timeoutMs,
  runMs,
  fixture,
  onlyFixture: args["only-fixture"],
  namespaces: messageNamespaces(repoRoot),
});
process.exit(summary.failed ? 1 : 0);
