// @vitest-environment node
//
// scripts/check-testing-md.mjs fails CI when an integration test file or
// an E2E spec has no TESTING.md row (or a row outlives its file). Pinned
// here: the table parser and the diff, each with a positive control so a
// parser that finds nothing can't pass as "no problems". No database.
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { checkTestingMd, diffRows, parseTables } from "../../../scripts/check-testing-md.mjs";

const FIXTURE = [
  "### Integration",
  "",
  "| Integration file | Writes? | What it creates, and its cleanup |",
  "|---|---|---|",
  "| `board-picks.test.ts` | **writes** | rows; `afterAll` deletes them |",
  "| `prisma-pool-txleak.test.ts` | read-only | `SELECT` only |",
  "",
  "Prose that mentions `not-a-row.test.ts` stays out of the table.",
  "",
  "```md",
  "| Spec | Writes? | Needs |",
  "| `fenced-example.spec.ts` | GET only | — |",
  "```",
  "",
  "| Spec | Writes? | Needs |",
  "|---|---|---|",
  "| `album.spec.ts` | GET only | `E2E_ALBUM_ID` |",
].join("\r\n");

describe("parseTables", () => {
  it("reads the first-column backticked names of each table, stopping at its end", () => {
    expect(parseTables(FIXTURE, ["Integration file", "Spec"])).toEqual({
      "Integration file": ["board-picks.test.ts", "prisma-pool-txleak.test.ts"],
      Spec: ["album.spec.ts"],
    });
  });

  it("returns null for a header that isn't there", () => {
    expect(parseTables(FIXTURE, ["Unit file"])).toEqual({ "Unit file": null });
  });
});

describe("diffRows", () => {
  it("reports files without a row and rows without a file", () => {
    expect(diffRows(["a.test.ts", "new.test.ts"], ["a.test.ts", "gone.test.ts"])).toEqual({
      missing: ["new.test.ts"],
      stale: ["gone.test.ts"],
      duplicate: [],
    });
  });

  it("reports a name listed twice", () => {
    expect(diffRows(["a.test.ts"], ["a.test.ts", "a.test.ts"]).duplicate).toEqual(["a.test.ts"]);
  });
});

describe("checkTestingMd", () => {
  it("passes when the tables list exactly the files (positive control)", () => {
    expect(
      checkTestingMd(FIXTURE, {
        integration: ["board-picks.test.ts", "prisma-pool-txleak.test.ts"],
        e2e: ["album.spec.ts"],
      }),
    ).toEqual([]);
  });

  it("fails on an unlisted file and on a stale row", () => {
    const problems = checkTestingMd(FIXTURE, {
      integration: ["board-picks.test.ts", "prisma-pool-txleak.test.ts", "global-search.test.ts"],
      e2e: [],
    });
    expect(problems).toHaveLength(2);
    expect(problems[0]).toContain("global-search.test.ts: no row");
    expect(problems[1]).toContain("`album.spec.ts`: no such file");
  });

  it("fails when a table header is renamed away", () => {
    const problems = checkTestingMd(FIXTURE.replaceAll("| Spec |", "| E2E spec |"), {
      integration: ["board-picks.test.ts", "prisma-pool-txleak.test.ts"],
      e2e: ["album.spec.ts"],
    });
    expect(problems).toEqual(['TESTING.md: no table with first header cell "Spec"']);
  });

  it("finds both tables in the checked-in TESTING.md", () => {
    const tables = parseTables(readFileSync("TESTING.md", "utf8"), ["Integration file", "Spec"]);
    expect(tables["Integration file"]?.length).toBeGreaterThan(0);
    expect(tables.Spec?.length).toBeGreaterThan(0);
  });
});
