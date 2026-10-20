import { describe, it, expect } from "vitest";
import {
  findStarterOutsideCatalog,
  parseStarterInput,
  readStarterMap,
} from "@/lib/board/starterPicks";
import { boardColumnLabel } from "@/lib/board/thresholds";
import { boardFragment, groupIdFromFragment } from "@/lib/board/fragment";
import { parseCsvBooleanCell } from "@/lib/admin-input";

describe("readStarterMap (lenient read of Event.boardStarterSongIds)", () => {
  it("passes a well-formed map through", () => {
    expect(readStarterMap({ "1": ["10", "11"], "2": ["20"] })).toEqual({
      "1": ["10", "11"],
      "2": ["20"],
    });
  });

  it("null / non-object / array → empty", () => {
    expect(readStarterMap(null)).toEqual({});
    expect(readStarterMap("x")).toEqual({});
    expect(readStarterMap([["1", ["10"]]])).toEqual({});
  });

  it("drops malformed entries one by one instead of failing the board", () => {
    expect(
      readStarterMap({
        "1": ["10", 11, "abc", "10", "0", "12", "13", "14"],
        x: ["20"],
        "3": "30",
        "4": [],
      }),
    ).toEqual({ "1": ["10", "12", "13"] }); // dedup, non-decimal dropped, cap 3
  });
});

describe("parseStarterInput (strict admin write)", () => {
  const groups = ["1", "2"];

  it("normalizes: empty arrays dropped, all-empty → null", () => {
    expect(parseStarterInput({ "1": ["10"], "2": [] }, groups)).toEqual({
      ok: true,
      value: { "1": ["10"] },
    });
    expect(parseStarterInput({ "1": [], "2": [] }, groups)).toEqual({
      ok: true,
      value: null,
    });
    expect(parseStarterInput({}, groups)).toEqual({ ok: true, value: null });
    expect(parseStarterInput(null, groups)).toEqual({ ok: true, value: null });
  });

  it("accepts exactly 3 per group, rejects 4", () => {
    expect(parseStarterInput({ "1": ["10", "11", "12"] }, groups).ok).toBe(true);
    expect(parseStarterInput({ "1": ["10", "11", "12", "13"] }, groups)).toEqual({
      ok: false,
      error: { code: "starter.tooMany", groupId: "1" },
    });
  });

  it.each([
    [[], { code: "starter.notObject" }],
    ["x", { code: "starter.notObject" }],
    [{ "9": ["10"] }, { code: "starter.unknownGroup", groupId: "9" }],
    [{ "1": "10" }, { code: "starter.notArray", groupId: "1" }],
    [{ "1": [10] }, { code: "starter.badSongId", groupId: "1" }],
    [{ "1": ["-1"] }, { code: "starter.badSongId", groupId: "1" }],
    [{ "1": ["10", "10"] }, { code: "starter.duplicate", groupId: "1", songId: "10" }],
  ])("rejects %j", (input, error) => {
    expect(parseStarterInput(input, groups)).toEqual({ ok: false, error });
  });

  it("keeps BigInt-range ids exact (strings, never numbers)", () => {
    const big = "9007199254740993"; // 2^53 + 1 — a JS number would round it
    expect(parseStarterInput({ "1": [big] }, groups)).toEqual({
      ok: true,
      value: { "1": [big] },
    });
  });
});

describe("findStarterOutsideCatalog", () => {
  const catalogs = new Map([
    ["1", new Set(["10", "11"])],
    ["2", new Set(["20"])],
  ]);

  it("null when every pick is in its group's catalog", () => {
    expect(findStarterOutsideCatalog({ "1": ["10", "11"], "2": ["20"] }, catalogs)).toBeNull();
  });

  it("a song from ANOTHER group's catalog is still outside", () => {
    expect(findStarterOutsideCatalog({ "1": ["20"] }, catalogs)).toEqual({
      groupId: "1",
      songId: "20",
    });
  });

  it("a group with no catalog loaded rejects everything", () => {
    expect(findStarterOutsideCatalog({ "3": ["30"] }, catalogs)).toEqual({
      groupId: "3",
      songId: "30",
    });
  });
});

describe("boardColumnLabel thresholds", () => {
  it.each([
    [0, 0, "operator"],
    [1, 1, "early"],
    [4, 4, "early"],
    [12, 4, "early"], // many submissions, few people → still early
    [3, 0, "early"], // legacy-only rows: submissions, no participants → never operator
    [5, 5, "ok"],
    [9, 7, "ok"],
  ] as const)("submissions=%i participants=%i → %s", (s, p, label) => {
    expect(boardColumnLabel(s, p)).toBe(label);
  });
});

describe("board fragment", () => {
  const groups = [
    { groupId: "1", slug: "hasunosora" },
    { groupId: "2", slug: "liella" },
  ];

  it("round-trips a slug to its group id", () => {
    expect(boardFragment("liella")).toBe("#board-liella");
    expect(groupIdFromFragment(boardFragment("liella"), groups)).toBe("2");
  });

  it.each(["", "#", "#liella", "#board-", "#board-unknown", "#board-%E0%A4%A"])(
    "%j selects nothing",
    (hash) => {
      expect(groupIdFromFragment(hash, groups)).toBeNull();
    },
  );
});

describe("parseCsvBooleanCell (events CSV boardEnabled column)", () => {
  it.each([
    [undefined, undefined],
    [null, undefined],
    ["", undefined],
    ["  ", undefined],
    ["true", true],
    ["TRUE", true],
    ["1", true],
    ["yes", true],
    ["false", false],
    ["0", false],
    ["No", false],
    ["on", "invalid"],
    ["2", "invalid"],
  ] as const)("%j → %j", (raw, expected) => {
    expect(parseCsvBooleanCell(raw)).toBe(expected);
  });
});
