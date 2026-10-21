import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

// TESTING.md's integration-file table is how a session learns which
// integration suites write to the shared dev DB and how each cleans up.
// A suite added without a row is invisible to that check, and reviewers
// have missed it before, so the table's completeness is enforced here
// rather than left to reviewer instructions.

const REPO_ROOT = path.resolve(__dirname, "../../..");
const INTEGRATION_DIR = path.join(REPO_ROOT, "src/__tests__/integration");
const TESTING_MD = path.join(REPO_ROOT, "TESTING.md");
const TABLE_HEADER =
  "| Integration file | Writes? | What it creates, and its cleanup |";

function integrationTestFiles(): string[] {
  return fs
    .readdirSync(INTEGRATION_DIR)
    .filter((name) => name.endsWith(".test.ts"))
    .sort();
}

// Returns the first-column file names of the table under TABLE_HEADER.
// The table ends at the first line that is not a `|` row; the `|---|`
// separator row is skipped. Throws when the header is missing or no row
// parses, so every check below fails at collection instead of comparing
// against an empty list and passing vacuously.
function listedFileNames(markdown: string): string[] {
  const lines = markdown.split(/\r?\n/);
  const headerIdx = lines.findIndex((line) => line.trim() === TABLE_HEADER);
  if (headerIdx === -1) {
    throw new Error(`TESTING.md has no line equal to: ${TABLE_HEADER}`);
  }

  const names: string[] = [];
  for (const line of lines.slice(headerIdx + 1)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("|")) break;
    const firstCell = trimmed.split("|")[1]?.trim() ?? "";
    if (/^:?-+:?$/.test(firstCell)) continue;
    names.push(firstCell.replace(/`/g, "").trim());
  }
  if (names.length === 0) {
    throw new Error("TESTING.md integration-file table parsed no rows");
  }
  return names.sort();
}

describe("TESTING.md integration-file table", () => {
  const files = integrationTestFiles();
  const listed = listedFileNames(fs.readFileSync(TESTING_MD, "utf8"));

  it("parses real rows (positive control)", () => {
    // A parser that reads the wrong column or strips too much would still
    // return a non-empty list; pin one long-standing suite on both sides.
    expect(listed).toContain("prisma-pool-txleak.test.ts");
    expect(files).toContain("prisma-pool-txleak.test.ts");
  });

  it("lists every integration test file", () => {
    const listedSet = new Set(listed);
    const missing = files.filter((name) => !listedSet.has(name));
    expect(
      missing,
      `Add a TESTING.md row (what it writes to the dev DB, and its cleanup) for: ${missing.join(", ")}`,
    ).toEqual([]);
  });

  it("has no rows for files that no longer exist", () => {
    const present = new Set(files);
    const stale = listed.filter((name) => !present.has(name));
    expect(
      stale,
      `Remove stale TESTING.md rows (no such file in src/__tests__/integration): ${stale.join(", ")}`,
    ).toEqual([]);
  });

  it("has no duplicate rows", () => {
    // Two rows for one file can describe its writes differently.
    const dupes = listed.filter((name, i) => listed.indexOf(name) !== i);
    expect(dupes, `Duplicate TESTING.md rows: ${dupes.join(", ")}`).toEqual([]);
  });
});
