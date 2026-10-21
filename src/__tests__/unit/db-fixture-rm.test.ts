// @vitest-environment node
//
// scripts/db-fixture-rm.mjs hard-deletes QA fixture rows from the shared
// dev DB. Its argument cross-checks (explicit ids, a name prefix, and an
// expected count that must agree) are the first guard and run before any
// connection, so they are pinned here. No database.
import { describe, it, expect } from "vitest";
import { parseArgs, UsageError } from "../../../scripts/db-fixture-rm.mjs";

const ASSET = "0b6f3d2e-6a4c-4f0e-9d8a-2c1b3a4d5e6f";

describe("parseArgs", () => {
  it("collects ids per type and the guards", () => {
    const opts = parseArgs([
      "--series", "41,42", "--events", "901", "--assets", ASSET,
      "--prefix", "[QA] ", "--asset-prefix", "dev/qa/", "--expect", "4", "--dry-run",
    ]);
    expect(opts.ids).toEqual({ Event: ["901"], EventSeries: ["41", "42"], Album: [], ImageAsset: [ASSET] });
    expect(opts).toMatchObject({ prefix: "[QA] ", assetPrefix: "dev/qa/", expect: 4, dryRun: true });
  });

  it("allows assets alone without a name prefix", () => {
    expect(parseArgs(["--assets", ASSET, "--asset-prefix", "dev/qa/", "--expect", "1"]).prefix).toBeNull();
  });

  it.each([
    ["no ids", ["--prefix", "[QA] ", "--expect", "1"]],
    ["no --expect", ["--series", "41", "--prefix", "[QA] "]],
    ["--expect disagreeing with the ids", ["--series", "41,42", "--prefix", "[QA] ", "--expect", "1"]],
    ["no --prefix for named rows", ["--series", "41", "--expect", "1"]],
    ["a too-short prefix", ["--series", "41", "--prefix", " Q ", "--expect", "1"]],
    ["assets without --asset-prefix", ["--assets", ASSET, "--expect", "1"]],
    ["a non-numeric id", ["--events", "9x", "--prefix", "[QA] ", "--expect", "1"]],
    ["a non-uuid asset id", ["--assets", "abc", "--asset-prefix", "dev/qa/", "--expect", "1"]],
    ["a duplicate id across repeats", ["--series", "41", "--series", "41", "--prefix", "[QA] ", "--expect", "2"]],
    ["a flag eaten as a value", ["--series", "41", "--prefix", "--expect", "1"]],
    ["an unknown argument", ["--series", "41", "--prefix", "[QA] ", "--expect", "1", "--force"]],
  ])("refuses %s", (_name, argv) => {
    expect(() => parseArgs(argv)).toThrow(UsageError);
  });
});
