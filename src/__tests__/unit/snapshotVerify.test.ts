import { describe, it, expect } from "vitest";
import {
  formatSnapshotVerify,
  parseSnapshotVerify,
  SNAPSHOT_VERIFY_HEADER,
  type ServerSnapshotVerify,
} from "@/lib/snapshotVerify";

// `x-snapshot-verify` wire grammar: the server formats it, the live
// page parses it. Anything the parser does not recognise must come out
// as `missing` (inconclusive), never as a refutation.

describe("x-snapshot-verify", () => {
  it("header name is lower-case (fetch Headers lookups are case-insensitive anyway)", () => {
    expect(SNAPSHOT_VERIFY_HEADER).toBe("x-snapshot-verify");
  });

  it.each<[ServerSnapshotVerify, string]>([
    [{ kind: "none" }, "none"],
    [{ kind: "satisfied" }, "satisfied"],
    [{ kind: "deferred" }, "deferred"],
    [{ kind: "fresh", dbRev: 0 }, "fresh=0"],
    [{ kind: "fresh", dbRev: 1234 }, "fresh=1234"],
    [{ kind: "memo", rev: 7, ageMs: 0 }, "memo=7;age=0"],
    [{ kind: "memo", rev: 7, ageMs: 980 }, "memo=7;age=980"],
    [{ kind: "fresh", dbRev: Number.MAX_SAFE_INTEGER }, `fresh=${Number.MAX_SAFE_INTEGER}`],
  ])("formats %o as %s and parses it back", (value, wire) => {
    expect(formatSnapshotVerify(value)).toBe(wire);
    expect(parseSnapshotVerify(wire)).toEqual(value);
  });

  it.each([
    null, // header absent (older server, or a 503)
    "",
    "fresh",
    "fresh=",
    "fresh=-1",
    "fresh=1.5",
    "fresh=1e3",
    "fresh=9007199254740993", // > MAX_SAFE_INTEGER
    "fresh=12;age=3",
    "memo=7",
    "memo=7;age=",
    "memo=7;age=-1",
    "memo=;age=3",
    "memo=7; age=3",
    "SATISFIED",
    "satisfied=1",
    "missing",
    "none,satisfied",
  ])("parses %o as missing (inconclusive)", (raw) => {
    expect(parseSnapshotVerify(raw)).toEqual({ kind: "missing" });
  });

  it("tolerates surrounding whitespace", () => {
    expect(parseSnapshotVerify(" fresh=3 ")).toEqual({ kind: "fresh", dbRev: 3 });
  });
});
