#!/usr/bin/env node
// See docs/palette-verification.md for config schemas and the canary gate.
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { compareCss, compareGlobals } from "./palette/static-equivalence.mjs";
import { compareQa } from "./palette/compare.mjs";
import { runPaired } from "./palette/paired.mjs";

const read = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const { values: args } = parseArgs({ options: {
  mode: { type: "string" }, before: { type: "string" }, after: { type: "string" },
  config: { type: "string" }, cases: { type: "string" }, canary: { type: "string" },
  out: { type: "string" }, expand: { type: "boolean", default: false },
  browser: { type: "string", default: "chromium" }, timeout: { type: "string", default: "30" },
  "run-timeout": { type: "string", default: "10" },
} });

try {
  if (!args.before || !args.after || !args.out || !["static", "paired", "qa"].includes(args.mode))
    throw new Error("usage: palette-verify.mjs --mode static|paired|qa --before <dir|URL|json> --after <dir|URL|json> --out <dir> [--config json | --cases json --canary key --expand]");
  const out = path.resolve(args.out);
  fs.mkdirSync(out, { recursive: true });
  let report;
  if (args.mode === "paired") {
    if (!args.cases || !args.canary) throw new Error("paired mode requires --cases and --canary");
    const timeoutMs = Number(args.timeout) * 1000, runMs = Number(args["run-timeout"]) * 60000;
    if (![timeoutMs, runMs].every((n) => Number.isFinite(n) && n > 0 && n <= 86400000))
      throw new Error("timeouts must be positive finite numbers, at most one day");
    report = await runPaired({ before: args.before, after: args.after, cases: read(args.cases),
      canary: args.canary, out, expand: args.expand, browserName: args.browser, timeoutMs, runMs });
  } else if (args.mode === "qa") {
    report = compareQa(read(args.before), read(args.after));
  } else {
    if (!args.config) throw new Error("static mode requires --config");
    const config = read(args.config);
    if (!Array.isArray(config.files) || !config.files.length || !config.globals || !config.variables ||
        !Array.isArray(config.addedVariables)) throw new Error("config requires files[], globals, variables{}, addedVariables[]");
    const listed = [...config.files, config.globals];
    for (const file of listed) {
      if (typeof file !== "string" || path.isAbsolute(file) || file.split(/[\\/]/).includes("..") || !file.endsWith(".css"))
        throw new Error("config paths must be relative CSS file paths without ..");
    }
    const files = listed.map((file) => path.posix.normalize(file.replaceAll("\\", "/")));
    if (new Set(files).size !== files.length) throw new Error("config files/globals must be unique");
    config.files = files.slice(0, -1);
    config.globals = files.at(-1);
    const beforeDir = path.resolve(args.before), afterDir = path.resolve(args.after);
    const cssFiles = (dir, prefix = "src") => {
      const folder = path.join(dir, prefix);
      if (!fs.existsSync(folder)) return [];
      return fs.readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
        const file = `${prefix}/${entry.name}`;
        return entry.isDirectory() ? cssFiles(dir, file) : entry.isFile() && file.endsWith(".css") ? [file] : [];
      });
    };
    const inventory = [...new Set([...cssFiles(beforeDir), ...cssFiles(afterDir)])];
    const unexpected = inventory.filter((file) => !files.includes(file) &&
      (!fs.existsSync(path.join(beforeDir, file)) || !fs.existsSync(path.join(afterDir, file)) ||
       !fs.readFileSync(path.join(beforeDir, file)).equals(fs.readFileSync(path.join(afterDir, file)))));
    const rows = files.map((file) => {
      const b = fs.readFileSync(path.join(beforeDir, file), "utf8");
      const a = fs.readFileSync(path.join(afterDir, file), "utf8");
      return { file, ...(file === config.globals ? compareGlobals(b, a, config) : compareCss(b, a, config)) };
    });
    // A variable inherited from :root can be shadowed by unchanged CSS in
    // another module. Audit both complete source inventories, rather than
    // treating only the edited modules as the variable's possible scope.
    const scopeConflicts = [];
    for (const [side, dir] of [["before", beforeDir], ["after", afterDir]]) {
      for (const file of inventory.filter((file) => file !== config.globals && fs.existsSync(path.join(dir, file)))) {
        const source = fs.readFileSync(path.join(dir, file), "utf8");
        const audit = compareCss(source, source, { ...config, addedVariables: side === "before" ? config.addedVariables : [] });
        if (!audit.equal) scopeConflicts.push({ side, file, differences: audit.differences });
      }
    }
    const substitutions = rows.reduce((total, row) => total + (row.substitutions?.length ?? 0), 0);
    const countMatches = config.expectedSubstitutions === undefined || substitutions === config.expectedSubstitutions;
    report = { equal: !unexpected.length && !scopeConflicts.length && countMatches && rows.every((r) => r.equal),
      before: beforeDir, after: afterDir, substitutions, expectedSubstitutions: config.expectedSubstitutions,
      inventoryScope: "src/**/*.css", unexpectedChangedCss: unexpected, scopeConflicts, rows };
  }
  const file = path.join(out, `${args.mode}-report.json`);
  fs.writeFileSync(file, JSON.stringify(report, null, 2) + "\n");
  const passed = args.mode === "paired" ? report.status === "passed" : report.equal;
  console.log("%s: %s; full report: %s", args.mode, passed ? "PASS" : "FAIL", file);
  process.exitCode = passed ? 0 : 1;
} catch (error) {
  console.error("palette-verify: %s", error.message ?? error);
  process.exitCode = 2;
}
