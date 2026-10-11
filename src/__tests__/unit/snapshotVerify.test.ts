import { describe, it, expect } from "vitest";
import { parseSnapshotVerify } from "@/lib/snapshotVerify";

describe("parseSnapshotVerify — x-snapshot-verify grammar", () => {
  it("parses the bare tokens", () => {
    expect(parseSnapshotVerify("none")).toEqual({ kind: "none" });
    expect(parseSnapshotVerify("satisfied")).toEqual({ kind: "satisfied" });
    expect(parseSnapshotVerify("deferred")).toEqual({ kind: "deferred" });
  });

  it("parses fresh=<dbRev>", () => {
    expect(parseSnapshotVerify("fresh=0")).toEqual({ kind: "fresh", dbRev: 0 });
    expect(parseSnapshotVerify("fresh=41")).toEqual({ kind: "fresh", dbRev: 41 });
    expect(parseSnapshotVerify(`fresh=${Number.MAX_SAFE_INTEGER}`)).toEqual({
      kind: "fresh",
      dbRev: Number.MAX_SAFE_INTEGER,
    });
  });

  it("parses memo=<rev>;age=<ms>", () => {
    expect(parseSnapshotVerify("memo=12;age=340")).toEqual({
      kind: "memo",
      rev: 12,
      ageMs: 340,
    });
    expect(parseSnapshotVerify("memo=0;age=0")).toEqual({ kind: "memo", rev: 0, ageMs: 0 });
  });

  it("tolerates surrounding whitespace", () => {
    expect(parseSnapshotVerify("  fresh=3 ")).toEqual({ kind: "fresh", dbRev: 3 });
  });

  it("absent or malformed → missing (an R1 server after a rollback reads as inconclusive, never as a refutation)", () => {
    for (const value of [
      null,
      "",
      "SATISFIED",
      "fresh",
      "fresh=",
      "fresh=-1",
      "fresh=1.5",
      "fresh=1e3",
      "fresh=0x10",
      "fresh= 3",
      `fresh=${Number.MAX_SAFE_INTEGER + 2}`,
      "fresh=99999999999999999999",
      "memo=3",
      "memo=3;age=",
      "memo=3;age=-5",
      "memo=;age=5",
      "memo=3;age=5;x=1",
      "memo=3,age=5",
      "stale",
      "satisfied;extra",
    ]) {
      expect(parseSnapshotVerify(value)).toEqual({ kind: "missing" });
    }
  });
});
