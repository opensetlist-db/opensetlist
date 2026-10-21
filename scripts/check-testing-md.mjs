#!/usr/bin/env node
// Fails when an integration test file or an E2E spec has no row in
// TESTING.md, or when a row names a file that no longer exists.
//
//   node scripts/check-testing-md.mjs        # check (CI lint job)
//   npm run check:testing-md                 # same
//
// Why: both suites run against the shared dev Supabase (integration
// directly, E2E through the app), and TESTING.md's "Integration file" and
// "Spec" tables are where a session learns what each one writes there and
// how it cleans up. A suite added without its row is invisible to the next
// session that has to judge whether a run is safe. Reviewers only caught
// the omission by reading closely, so the rule is checked mechanically.
//
// What is checked: every `src/__tests__/integration/*.test.ts` against the
// first column of the table headed "| Integration file |", and every
// `tests/e2e/*.spec.ts` against the table headed "| Spec |". Only the
// first backticked name in that column counts. Helpers (setup.ts, devPg.ts,
// tests/e2e/helpers/) are not test files and need no row.
//
// Exit: 1 when a file has no row, a row names a missing file, or a table
// header can't be found (renaming a header must not turn the check into a
// silent pass); 0 otherwise. Node built-ins only, no database.

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const SUITES = [
  { key: "integration", header: "Integration file", dir: "src/__tests__/integration", suffix: ".test.ts" },
  { key: "e2e", header: "Spec", dir: "tests/e2e", suffix: ".spec.ts" },
];

// Returns { [header]: string[] | null } — the backticked first-column names
// of the table whose first header cell is exactly `header`, or null when no
// such table exists. A table ends at the first line that doesn't start
// with "|"; the |---| separator row and rows without a backticked first
// cell are skipped.
export function parseTables(markdown, headers) {
  const lines = markdown.split(/\r?\n/);
  const out = {};
  for (const header of headers) {
    out[header] = null;
    const start = lines.findIndex((l) => firstCell(l) === header);
    if (start === -1) continue;
    const names = [];
    for (let i = start + 1; i < lines.length && lines[i].trimStart().startsWith("|"); i++) {
      const m = /^`([^`]+)`/.exec(firstCell(lines[i]) ?? "");
      if (m) names.push(m[1]);
    }
    out[header] = names;
  }
  return out;
}

function firstCell(line) {
  const t = line.trim();
  if (!t.startsWith("|")) return null;
  return t.slice(1).split("|")[0].trim();
}

// files: names present on disk; rows: names listed in the table.
export function diffRows(files, rows) {
  const listed = new Set(rows);
  const present = new Set(files);
  return {
    missing: files.filter((f) => !listed.has(f)).sort(),
    stale: rows.filter((r) => !present.has(r)).sort(),
  };
}

// Pure core of the CLI: returns the problem lines (empty = pass).
export function checkTestingMd(markdown, filesBySuite) {
  const tables = parseTables(markdown, SUITES.map((s) => s.header));
  const problems = [];
  for (const s of SUITES) {
    const rows = tables[s.header];
    if (rows === null) {
      problems.push(`TESTING.md: no table with first header cell "${s.header}"`);
      continue;
    }
    const { missing, stale } = diffRows(filesBySuite[s.key], rows);
    for (const f of missing) problems.push(`${s.dir}/${f}: no row in the "${s.header}" table of TESTING.md`);
    for (const r of stale) problems.push(`TESTING.md "${s.header}" row \`${r}\`: no such file in ${s.dir}/`);
  }
  return problems;
}

function listSuite({ dir, suffix }) {
  return readdirSync(new URL(`../${dir}/`, import.meta.url), { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(suffix))
    .map((e) => e.name);
}

function main() {
  const markdown = readFileSync(new URL("../TESTING.md", import.meta.url), "utf8");
  const filesBySuite = Object.fromEntries(SUITES.map((s) => [s.key, listSuite(s)]));
  const problems = checkTestingMd(markdown, filesBySuite);
  if (problems.length > 0) {
    for (const p of problems) console.error(p);
    console.error(
      `\n${problems.length} problem(s). Add a row per test file saying what it writes to the dev DB and how it cleans up; delete rows for removed files.`,
    );
    process.exit(1);
  }
  const counts = SUITES.map((s) => `${filesBySuite[s.key].length} ${s.key}`).join(", ");
  console.log(`check-testing-md: OK (${counts} files, all listed in TESTING.md)`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
