#!/usr/bin/env node
// Browser QA for operator-only admin pages (album cover, series logo,
// event logo, …). The harness (scripts/admin-qa/harness.mjs) logs in,
// creates and always deletes a dev-DB fixture, runs the generic checks
// and captures every state; a scenario module per page drives the page.
//
// Usage (against a running production build — scripts/serve-build.sh):
//   node scripts/admin-qa.mjs --scenario album-cover --out <dir>
//     [--base http://localhost:3111]
//     [--browser chromium|webkit]    default chromium
//     [--mode full|quick] / --quick  default full; widths per mode are in
//                                    the scenario (`quick` for WebKit, a
//                                    full WebKit run is slow on Windows)
//     [--upload]                     scenario opt-in for steps that write
//                                    to the dev R2 bucket (album-cover: one
//                                    real upload); off by default
//     [--webp <dir>]                 also write every capture as WebP q90,
//                                    split into .partN.webp above 16,000 px
//                                    (the wiki stores evidence as WebP)
//     [--list]                       list the scenarios and exit
//
// --scenario takes a name under scripts/admin-qa/scenarios/ or a path to a
// .mjs file. ADMIN_PASSWORD and DATABASE_URL_UNPOOLED come from the
// .env/.env.local of the checkout holding the current directory (.env.local
// wins); neither is ever printed.
//
// Writes <out>/<scenario>-<state>-<width>[-webkit].png and
// <out>/results-<scenario>-<browser>-<mode>.json; exits 1 on any FAIL.
//
// The fixture lives in the SHARED dev DB: hold the execution-board DB
// mutation slot (wiki output/redesign/execution-board.md) before a run,
// and release it with the cleanup result afterwards.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { BROWSERS, checkoutRoot, loadEnv, runScenario } from "./admin-qa/harness.mjs";

// Scenarios ship with the script; .env/.env.local come from the checkout
// under test (see checkoutRoot), which differs for an extracted copy.
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const scenarioDir = path.join(scriptDir, "admin-qa", "scenarios");
const repoRoot = checkoutRoot(path.resolve(scriptDir, ".."));

const { values: args } = parseArgs({
  options: {
    scenario: { type: "string" },
    out: { type: "string" },
    base: { type: "string", default: "http://localhost:3111" },
    browser: { type: "string", default: "chromium" },
    mode: { type: "string", default: "full" },
    // Same spelling as redesign-shell-qa.mjs; wins over --mode.
    quick: { type: "boolean", default: false },
    upload: { type: "boolean", default: false },
    webp: { type: "string" },
    list: { type: "boolean", default: false },
  },
});

if (args.list) {
  for (const f of fs.readdirSync(scenarioDir).filter((f) => f.endsWith(".mjs"))) console.log(f.replace(/\.mjs$/, ""));
  process.exit(0);
}
if (!args.scenario || !args.out) {
  console.error("usage: node scripts/admin-qa.mjs --scenario <name|path.mjs> --out <dir> [--base URL] [--browser chromium|webkit] [--mode full|quick] [--upload] [--webp <dir>]");
  process.exit(2);
}
if (!BROWSERS[args.browser]) {
  console.error(`--browser must be one of: ${Object.keys(BROWSERS).join(", ")}`);
  process.exit(2);
}

const scenarioPath = args.scenario.endsWith(".mjs")
  ? path.resolve(args.scenario)
  : path.join(scenarioDir, `${args.scenario}.mjs`);
const scenario = (await import(pathToFileURL(scenarioPath).href)).default;

// The cwd picks the checkout whose .env is read (see checkoutRoot): say
// which one, so a run started from the wrong directory shows it.
console.log(`checkout: ${repoRoot}`);
console.log(
  "reminder: this run INSERTs and deletes fixture rows in the shared dev DB — hold the redesign execution-board DB slot",
);

const summary = await runScenario({
  scenario,
  browserName: args.browser,
  mode: args.quick ? "quick" : args.mode,
  base: args.base.replace(/\/+$/, ""),
  outDir: path.resolve(args.out),
  env: loadEnv(repoRoot),
  opts: { upload: args.upload, webp: args.webp ? path.resolve(args.webp) : null },
});

console.log(`\n${summary.passed}/${summary.passed + summary.failed} PASS (${summary.scenario}, ${summary.browser}, ${summary.mode})`);
if (summary.webp.length) console.log(`webp: ${summary.webp.length} files → ${args.webp}`);
process.exit(summary.failed ? 1 : 0);
