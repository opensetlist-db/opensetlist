import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

// TESTING.md's integration-file table is how a session learns which
// integration suites write to the shared dev DB and how each cleans up.
// A suite added without a row is invisible to that check (a redesign
// ticket shipped one that way and no reviewer noticed), so the table's
// completeness is enforced here instead of by reviewer instructions.

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
// separator row is skipped. Returns null when the header is missing so
// the caller can fail loudly rather than compare against an empty set.
function tableFileNames(markdown: string): string[] | null {
  const lines = markdown.split(/\r?\n/);
  const headerIdx = lines.findIndex((line) => line.trim() === TABLE_HEADER);
  if (headerIdx === -1) return null;

  const names: string[] = [];
  for (const line of lines.slice(headerIdx + 1)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("|")) break;
    const firstCell = trimmed.split("|")[1]?.trim() ?? "";
    if (/^:?-+:?$/.test(firstCell)) continue;
    names.push(firstCell.replace(/`/g, "").trim());
  }
  return names.sort();
}

describe("TESTING.md integration-file table", () => {
  const files = integrationTestFiles();
  const rows = tableFileNames(fs.readFileSync(TESTING_MD, "utf8"));

  it("has the expected header and parses rows from it", () => {
    expect(rows, `TESTING.md has no line equal to: ${TABLE_HEADER}`).not.toBeNull();
    // Positive control: a header change or a parser bug that yields an
    // empty or wrong set must fail here, not pass the checks below
    // vacuously. prisma-pool-txleak is the long-standing read-only suite.
    expect(rows!.length).toBeGreaterThan(0);
    expect(rows).toContain("prisma-pool-txleak.test.ts");
    expect(files).toContain("prisma-pool-txleak.test.ts");
  });

  it("lists every integration test file", () => {
    const listed = new Set(rows ?? []);
    const missing = files.filter((name) => !listed.has(name));
    expect(
      missing,
      `Add a TESTING.md row (what it writes to the dev DB, and its cleanup) for: ${missing.join(", ")}`,
    ).toEqual([]);
  });

  it("has no rows for files that no longer exist", () => {
    const present = new Set(files);
    const stale = (rows ?? []).filter((name) => !present.has(name));
    expect(
      stale,
      `Remove stale TESTING.md rows (no such file in src/__tests__/integration): ${stale.join(", ")}`,
    ).toEqual([]);
  });

  it("has no duplicate rows", () => {
    const dupes = (rows ?? []).filter((name, i, all) => all.indexOf(name) !== i);
    expect(dupes, `Duplicate TESTING.md rows: ${dupes.join(", ")}`).toEqual([]);
  });
});
